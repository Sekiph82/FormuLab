import Decimal from "decimal.js";
import { z } from "zod";
import { referenceFormulationSourceSchema, type ReferenceFormulationSource } from "../schemas/referenceFormulationSource";
import { referenceFormulationIngredientLineSchema, type ReferenceFormulationIngredientLine } from "./referenceFormulationIngredientExtraction";

export const REFERENCE_FORMULATION_ARITHMETIC_VERSION = "formulab-reference-formulation-arithmetic-v1";

const declaredTotalSchema = z.object({
  rawValue: z.string().trim().min(1),
  unit: z.string().trim().min(1).optional(),
  basis: z.string().trim().min(1).optional(),
  evidence: z.object({
    sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
    pageNumber: z.number().int().positive(),
    blockIndex: z.number().int().nonnegative(),
    excerpt: z.string().trim().min(1),
    source: z.enum(["digital", "ocr", "mixed", "unknown"]),
    confidence: z.number().finite().min(0).max(1).optional(),
  }).strict(),
}).strict();

const calculatedTotalSchema = z.object({
  kind: z.enum(["exact", "range"]),
  lowerBound: z.string().regex(/^\d+(?:\.\d+)?$/),
  upperBound: z.string().regex(/^\d+(?:\.\d+)?$/),
  unit: z.literal("% w/w"),
}).strict().superRefine((total, context) => {
  if (new Decimal(total.upperBound).lt(total.lowerBound)) {
    context.addIssue({ code: "custom", path: ["upperBound"], message: "Total upper bound cannot be below its lower bound." });
  }
  if ((total.kind === "exact") !== (total.lowerBound === total.upperBound)) {
    context.addIssue({ code: "custom", path: ["kind"], message: "Exact and ranged totals must match their bounds." });
  }
});

export type ReferenceFormulationCalculatedTotal = z.infer<typeof calculatedTotalSchema>;
export type ReferenceFormulationArithmeticStatus = "calculated_only" | "incomplete" | "source_total_not_comparable" | "consistent" | "overlap" | "inconsistent" | "no_ingredient_rows";
export type ReferenceFormulationArithmeticWarning =
  | "no_ingredient_rows"
  | "missing_amount"
  | "q_s_prevents_total"
  | "unknown_unit_or_basis"
  | "invalid_amount_format"
  | "percentage_out_of_range"
  | "duplicate_ingredient_rows"
  | "source_total_not_comparable"
  | "source_total_mismatch"
  | "source_total_overlap"
  | "ocr_arithmetic_requires_review";

export interface ReferenceFormulationArithmeticResult {
  sourceId: string;
  acquisitionCode: string;
  sourceDocumentHash: string;
  parserVersion: typeof REFERENCE_FORMULATION_ARITHMETIC_VERSION;
  sourceDeclaredTotal?: z.infer<typeof declaredTotalSchema>;
  calculatedTotal?: ReferenceFormulationCalculatedTotal;
  arithmeticStatus: ReferenceFormulationArithmeticStatus;
  lineCount: number;
  duplicateLineGroups: string[][];
  warnings: ReferenceFormulationArithmeticWarning[];
  reviewRequired: true;
}

interface NumericInterval { lower: Decimal; upper: Decimal }

function basisIsWeight(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[\s%]/g, "");
  return ["w/w", "byweight", "weight", "weightpercent", "mass/mass", "m/m"].map((item) => item.replace(/[\s%]/g, "")).includes(normalized);
}

function unitIsPercent(value: string | undefined): { isPercent: boolean; implicitWeightBasis: boolean } {
  if (!value) return { isPercent: false, implicitWeightBasis: false };
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  if (/^(?:%|wt\s*%|weight\s*percent|percentage)$/i.test(normalized)) return { isPercent: true, implicitWeightBasis: false };
  if (/^(?:%|wt\s*%)\s*(?:w\s*\/\s*w|by\s+weight|weight)$/i.test(normalized)) return { isPercent: true, implicitWeightBasis: true };
  return { isPercent: false, implicitWeightBasis: false };
}

function parsePercentInterval(rawValue: string, unit?: string, basis?: string): NumericInterval | undefined {
  const amountMatch = rawValue.trim().match(/^(?<first>\d+(?:[.,]\d+)?)(?:\s*(?:-|–|—|to)\s*(?<second>\d+(?:[.,]\d+)?))?\s*(?<inlineUnit>%|wt\s*%)?\s*(?<inlineBasis>w\s*\/\s*w|by\s+weight)?\s*$/i);
  if (!amountMatch?.groups) return undefined;
  const unitCheck = unitIsPercent(unit ?? amountMatch.groups.inlineUnit);
  const sourceBasis = basis ?? amountMatch.groups.inlineBasis;
  if (sourceBasis !== undefined && !basisIsWeight(sourceBasis)) return undefined;
  const hasWeightBasis = sourceBasis !== undefined ? basisIsWeight(sourceBasis) : unitCheck.implicitWeightBasis;
  if (!unitCheck.isPercent || !hasWeightBasis) return undefined;
  const lower = new Decimal(amountMatch.groups.first!.replace(",", "."));
  const upper = new Decimal((amountMatch.groups.second ?? amountMatch.groups.first)!.replace(",", "."));
  if (lower.lt(0) || upper.gt(100) || upper.lt(lower)) return { lower, upper };
  return { lower, upper };
}

function normalizeName(value: string | undefined): string | undefined {
  return value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** Calculate a source-backed % w/w interval; preserve every source amount and never solve q.s. or repair the formula. */
export function validateReferenceFormulationArithmetic(input: {
  source: ReferenceFormulationSource;
  lines: ReferenceFormulationIngredientLine[];
  sourceDeclaredTotal?: z.input<typeof declaredTotalSchema>;
}): ReferenceFormulationArithmeticResult {
  const source = referenceFormulationSourceSchema.parse(input.source);
  const lines = input.lines.map((line) => referenceFormulationIngredientLineSchema.parse(line));
  if (lines.some((line) => !line.id.startsWith(`${source.id}:`) || line.sourceDocumentHash !== source.sourcePdfSha256)) {
    throw new Error("Ingredient lines must belong to the same immutable formulation source record.");
  }
  const lineFieldEvidence = lines.flatMap((line) => [line.ingredientName, line.supplierProductCode, line.inciOrChemicalName, line.function, line.phase, line.amount, line.unit, line.basis]
    .filter((field): field is NonNullable<typeof field> => field !== undefined)
    .map((field) => field.evidence));
  if (lineFieldEvidence.some((evidence) => evidence.sourceDocumentHash !== source.sourcePdfSha256)) {
    throw new Error("Ingredient field evidence must reference the same source PDF hash.");
  }
  const sourceDeclaredTotal = input.sourceDeclaredTotal ? declaredTotalSchema.parse(input.sourceDeclaredTotal) : undefined;
  if (sourceDeclaredTotal && sourceDeclaredTotal.evidence.sourceDocumentHash !== source.sourcePdfSha256) {
    throw new Error("Declared formula total evidence must reference the same source PDF hash.");
  }
  if (lines.some((line) => line.rawRow.length === 0 || line.pageNumber < 1)) {
    throw new Error("Ingredient lines must retain valid source rows and page provenance.");
  }

  const warnings = new Set<ReferenceFormulationArithmeticWarning>();
  const duplicateGroups = new Map<string, string[]>();
  for (const line of lines) {
    const name = normalizeName(line.ingredientName?.rawValue);
    if (!name) continue;
    duplicateGroups.set(name, [...(duplicateGroups.get(name) ?? []), line.id]);
  }
  const duplicates = [...duplicateGroups.values()].filter((group) => group.length > 1);
  if (duplicates.length > 0) warnings.add("duplicate_ingredient_rows");
  if (lines.some((line) => line.ingredientName?.evidence.source === "ocr" || line.amount?.evidence.source === "ocr")) {
    warnings.add("ocr_arithmetic_requires_review");
  }
  if (sourceDeclaredTotal?.evidence.source === "ocr") warnings.add("ocr_arithmetic_requires_review");

  if (lines.length === 0) {
    warnings.add("no_ingredient_rows");
    return {
      sourceId: source.id, acquisitionCode: source.acquisitionCode, sourceDocumentHash: source.sourcePdfSha256,
      parserVersion: REFERENCE_FORMULATION_ARITHMETIC_VERSION,
      ...(sourceDeclaredTotal ? { sourceDeclaredTotal } : {}),
      arithmeticStatus: "no_ingredient_rows", lineCount: 0, duplicateLineGroups: [], warnings: [...warnings], reviewRequired: true,
    };
  }

  let total = { lower: new Decimal(0), upper: new Decimal(0) };
  let complete = true;
  for (const line of lines) {
    if (line.quantitySemantics === "q_s") {
      warnings.add("q_s_prevents_total");
      complete = false;
      continue;
    }
    if (!line.amount) {
      warnings.add("missing_amount");
      complete = false;
      continue;
    }
    const amountHeader = line.amount.evidence.header;
    const headerCarriesPercentBasis = /%\s*w\s*\/\s*w|\bweight\s*percent\b/i.test(amountHeader);
    const interval = parsePercentInterval(
      line.amount.rawValue,
      line.unit?.rawValue ?? (headerCarriesPercentBasis ? amountHeader : undefined),
      line.basis?.rawValue,
    );
    if (!interval) {
      const amountHasNumericValue = /^\s*\d+(?:[.,]\d+)?(?:\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?)?\s*(?:%|wt\s*%)?\s*$/i.test(line.amount.rawValue);
      warnings.add(amountHasNumericValue ? "unknown_unit_or_basis" : "invalid_amount_format");
      complete = false;
      continue;
    }
    if (interval.lower.lt(0) || interval.upper.gt(100) || interval.upper.lt(interval.lower)) {
      warnings.add("percentage_out_of_range");
      complete = false;
      continue;
    }
    total = { lower: total.lower.plus(interval.lower), upper: total.upper.plus(interval.upper) };
  }

  let calculatedTotal: ReferenceFormulationCalculatedTotal | undefined;
  let arithmeticStatus: ReferenceFormulationArithmeticStatus = "incomplete";
  if (complete) {
    const lowerBound = total.lower.toFixed();
    const upperBound = total.upper.toFixed();
    calculatedTotal = calculatedTotalSchema.parse({ kind: lowerBound === upperBound ? "exact" : "range", lowerBound, upperBound, unit: "% w/w" });
    arithmeticStatus = "calculated_only";
  }

  if (sourceDeclaredTotal) {
    const declaredInterval = parsePercentInterval(sourceDeclaredTotal.rawValue, sourceDeclaredTotal.unit, sourceDeclaredTotal.basis);
    if (!declaredInterval || declaredInterval.lower.lt(0) || declaredInterval.upper.gt(100) || declaredInterval.upper.lt(declaredInterval.lower)) {
      warnings.add("source_total_not_comparable");
      if (complete) arithmeticStatus = "source_total_not_comparable";
    } else if (calculatedTotal) {
      const overlaps = total.lower.lte(declaredInterval.upper) && declaredInterval.lower.lte(total.upper);
      if (!overlaps) {
        arithmeticStatus = "inconsistent";
        warnings.add("source_total_mismatch");
      } else if (total.lower.eq(total.upper) && declaredInterval.lower.eq(declaredInterval.upper) && total.lower.eq(declaredInterval.lower)) {
        arithmeticStatus = "consistent";
      } else {
        arithmeticStatus = "overlap";
        warnings.add("source_total_overlap");
      }
    } else {
      arithmeticStatus = "incomplete";
    }
  }

  return {
    sourceId: source.id,
    acquisitionCode: source.acquisitionCode,
    sourceDocumentHash: source.sourcePdfSha256,
    parserVersion: REFERENCE_FORMULATION_ARITHMETIC_VERSION,
    ...(sourceDeclaredTotal ? { sourceDeclaredTotal } : {}),
    ...(calculatedTotal ? { calculatedTotal } : {}),
    arithmeticStatus,
    lineCount: lines.length,
    duplicateLineGroups: duplicates,
    warnings: [...warnings],
    reviewRequired: true,
  };
}
