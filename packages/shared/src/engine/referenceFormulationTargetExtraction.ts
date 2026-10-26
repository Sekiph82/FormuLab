import { z } from "zod";
import { referenceFormulationSourceSchema, type ReferenceFormulationSource } from "../schemas/referenceFormulationSource";
import { referenceFormulationLayoutInputSchema, type ReferenceFormulationLayoutInput } from "./referenceFormulationParserContract";

export const REFERENCE_FORMULATION_TARGET_PARSER_VERSION = "formulab-reference-formulation-targets-v1";

const targetEvidenceSchema = z.object({
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  pageNumber: z.number().int().positive(),
  blockIndex: z.number().int().nonnegative(),
  rowIndex: z.number().int().nonnegative().optional(),
  cellIndex: z.number().int().nonnegative().optional(),
  excerpt: z.string().trim().min(1),
  source: z.enum(["digital", "ocr", "mixed", "unknown"]),
  confidence: z.number().finite().min(0).max(1).optional(),
  position: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict().optional(),
}).strict();

export const referenceFormulationTargetCandidateSchema = z.object({
  id: z.string().trim().min(1),
  field: z.enum(["ph", "viscosity", "density", "appearance", "other"]),
  rawPropertyLabel: z.string().trim().min(1),
  rawValue: z.string().trim().min(1).max(2000),
  valueShape: z.enum(["point_or_exact", "range", "approximate", "approximate_range", "unparsed"]),
  resultSemantics: z.enum(["target", "typical_result", "unspecified"]),
  evidence: targetEvidenceSchema,
  reviewRequired: z.literal(true),
}).strict();

export type ReferenceFormulationTargetCandidate = z.infer<typeof referenceFormulationTargetCandidateSchema>;
export type ReferenceFormulationTargetWarning =
  | "no_target_result_section"
  | "no_target_result_candidates"
  | "ambiguous_property_columns"
  | "ocr_target_results_require_review";

export interface ReferenceFormulationTargetExtractionResult {
  sourceId: string;
  acquisitionCode: string;
  sourceDocumentHash: string;
  parserVersion: typeof REFERENCE_FORMULATION_TARGET_PARSER_VERSION;
  candidates: ReferenceFormulationTargetCandidate[];
  warnings: ReferenceFormulationTargetWarning[];
  reviewRequired: true;
}

const TARGET_RESULT_HEADINGS = new Set([
  "finished product", "finished product properties", "product properties", "product specification", "product specifications",
  "specifications", "results", "typical results", "target values", "product characteristics", "physical properties",
]);
const NON_TARGET_HEADINGS = new Set([
  "ingredients", "ingredient composition", "formula composition", "raw materials", "composition", "procedure",
  "manufacturing procedure", "manufacturing process", "process", "method", "preparation", "safety", "regulatory", "storage",
]);

function normalizeLabel(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function propertyForLabel(label: string): ReferenceFormulationTargetCandidate["field"] | undefined {
  const normalized = normalizeLabel(label);
  if (/^(?:ph|ph value|target ph)$/.test(normalized)) return "ph";
  if (/^(?:viscosity|viscosity at|target viscosity)$/.test(normalized)) return "viscosity";
  if (/^(?:density|specific gravity|relative density|target density)$/.test(normalized)) return "density";
  if (/^(?:appearance|aspect|visual appearance|target appearance)$/.test(normalized)) return "appearance";
  if (/^(?:property|characteristic|result|target|typical result)$/.test(normalized)) return "other";
  return undefined;
}

function resultSemantics(text: string, section: string | undefined): ReferenceFormulationTargetCandidate["resultSemantics"] {
  if (/\b(?:target|aim|desired|should be|set to)\b/i.test(text) || /target/i.test(section ?? "")) return "target";
  if (/\b(?:typical|representative|measured|result|achieved|observed)\b/i.test(text) || /typical|result/i.test(section ?? "")) return "typical_result";
  return "unspecified";
}

function valueShape(rawValue: string): ReferenceFormulationTargetCandidate["valueShape"] {
  const approximate = /\b(?:approx(?:imately)?|about|around|circa|typical(?:ly)?|~|≈)\b|[~≈]/i.test(rawValue);
  const range = /(?:\d|[.,])\s*(?:-|–|—|\bto\b)\s*(?:\d|[.,])/.test(rawValue);
  if (approximate && range) return "approximate_range";
  if (approximate) return "approximate";
  if (range) return "range";
  if (/\d/.test(rawValue) || /\b(?:clear|cloudy|transparent|viscous|liquid|solid|pale|yellow|colorless|colourless)\b/i.test(rawValue)) return "point_or_exact";
  return "unparsed";
}

function labeledProperty(text: string): { label: string; value: string } | undefined {
  const match = text.match(/^\s*(?<label>[^:：=]{1,80}?)\s*(?:[:：=])\s*(?<value>\S[\s\S]*?)\s*$/);
  if (!match?.groups || !propertyForLabel(match.groups.label!)) return undefined;
  return { label: match.groups.label!.trim(), value: match.groups.value!.trim() };
}

/** Extracts source-stated formulation targets/results without normalizing or applying them to production records. */
export function extractReferenceFormulationTargets(input: {
  source: ReferenceFormulationSource;
  pages: ReferenceFormulationLayoutInput["pages"];
}): ReferenceFormulationTargetExtractionResult {
  const source = referenceFormulationSourceSchema.parse(input.source);
  const layout = referenceFormulationLayoutInputSchema.parse({ sourceDocumentHash: source.sourcePdfSha256, pages: input.pages });
  const candidates: ReferenceFormulationTargetCandidate[] = [];
  const warnings = new Set<ReferenceFormulationTargetWarning>();
  let inTargetResultSection = false;
  let inKnownNonTargetSection = false;
  let foundSection = false;
  let currentSection: string | undefined;

  const addCandidate = (details: {
    field: ReferenceFormulationTargetCandidate["field"];
    label: string;
    value: string;
    pageNumber: number;
    blockIndex: number;
    rowIndex?: number;
    cellIndex?: number;
    sourceKind: "digital" | "ocr" | "mixed" | "unknown";
    confidence?: number;
    position?: { x: number; y: number };
    context?: string;
  }) => {
    const rawValue = details.value.trim();
    if (!rawValue) return;
    const evidence = targetEvidenceSchema.parse({
      sourceDocumentHash: source.sourcePdfSha256,
      pageNumber: details.pageNumber,
      blockIndex: details.blockIndex,
      ...(details.rowIndex !== undefined ? { rowIndex: details.rowIndex } : {}),
      ...(details.cellIndex !== undefined ? { cellIndex: details.cellIndex } : {}),
      excerpt: `${details.label}: ${rawValue}`,
      source: details.sourceKind,
      ...(details.confidence !== undefined ? { confidence: details.confidence } : {}),
      ...(details.position ? { position: details.position } : {}),
    });
    candidates.push(referenceFormulationTargetCandidateSchema.parse({
      id: `${source.id}:target:p${details.pageNumber}:b${details.blockIndex}:r${details.rowIndex ?? "text"}:c${details.cellIndex ?? "text"}:${candidates.length + 1}`,
      field: details.field,
      rawPropertyLabel: details.label,
      rawValue,
      valueShape: valueShape(rawValue),
      resultSemantics: resultSemantics(`${details.label} ${rawValue}`, details.context),
      evidence,
      reviewRequired: true,
    }));
    if (details.sourceKind === "ocr" || details.sourceKind === "mixed") warnings.add("ocr_target_results_require_review");
  };

  for (const page of layout.pages) {
    const ordered = [...page.blocks].sort((left, right) => left.blockIndex - right.blockIndex);
    for (const block of ordered) {
      if (block.type === "heading") {
        const heading = normalizeLabel(block.text);
        if (TARGET_RESULT_HEADINGS.has(heading)) {
          inTargetResultSection = true;
          inKnownNonTargetSection = false;
          foundSection = true;
          currentSection = block.text;
        } else if (NON_TARGET_HEADINGS.has(heading)) {
          inTargetResultSection = false;
          inKnownNonTargetSection = true;
          currentSection = undefined;
        } else {
          inTargetResultSection = false;
          inKnownNonTargetSection = false;
          currentSection = undefined;
        }
        continue;
      }

      if (block.type === "text") {
        if (!inTargetResultSection) continue;
        const labeled = labeledProperty(block.text);
        if (!labeled) continue;
        addCandidate({
          field: propertyForLabel(labeled.label)!, label: labeled.label, value: labeled.value,
          pageNumber: page.pageNumber, blockIndex: block.blockIndex, sourceKind: block.source,
          ...(block.confidence !== undefined ? { confidence: block.confidence } : {}),
          ...(block.position ? { position: block.position } : {}), context: currentSection ?? block.text,
        });
        continue;
      }
      if (block.type !== "table") continue;
      if (inKnownNonTargetSection && !inTargetResultSection) continue;

      const headerRows = block.rows.slice(0, Math.min(3, block.rows.length));
      const mapped = headerRows.flatMap((row, rowIndex) => row.flatMap((label, cellIndex) => {
        const field = propertyForLabel(label);
        return field ? [{ rowIndex, cellIndex, field, label }] : [];
      }));
      const propertyColumns = [...new Map(mapped.map((column) => [column.cellIndex, column])).values()];
      if (propertyColumns.length > 1 && new Set(propertyColumns.map((column) => column.field)).size !== propertyColumns.length) {
        warnings.add("ambiguous_property_columns");
        continue;
      }
      const ingredientLikeHeader = headerRows.some((row) => row.some((label) =>
        /^(?:ingredient|ingredients|raw material|raw materials|trade name|material|amount|quantity|dosage|phase|function)$/i.test(normalizeLabel(label)),
      ));
      if (!inTargetResultSection && ingredientLikeHeader) continue;
      const processLikeHeader = headerRows.some((row) => row.some((label) =>
        /^(?:step|step number|sequence|order|stage|operation|procedure|instruction|instructions|process|process description|manufacturing step)$/i.test(normalizeLabel(label)),
      ));
      if (processLikeHeader) continue;
      if (propertyColumns.length === 0 && !inTargetResultSection) continue;
      if (propertyColumns.length === 0) continue;
      foundSection = true;
      for (const column of propertyColumns) {
        block.rows.slice(column.rowIndex + 1).forEach((row, offset) => {
          const value = row[column.cellIndex]?.trim();
          if (!value) return;
          addCandidate({
            field: column.field, label: column.label, value, pageNumber: page.pageNumber, blockIndex: block.blockIndex,
            rowIndex: column.rowIndex + 1 + offset, cellIndex: column.cellIndex, sourceKind: block.source,
            ...(block.confidence !== undefined ? { confidence: block.confidence } : {}),
            ...(block.position ? { position: block.position } : {}), context: currentSection ?? column.label,
          });
        });
      }
    }
  }

  if (!foundSection) warnings.add("no_target_result_section");
  if (candidates.length === 0) warnings.add("no_target_result_candidates");
  return {
    sourceId: source.id,
    acquisitionCode: source.acquisitionCode,
    sourceDocumentHash: source.sourcePdfSha256,
    parserVersion: REFERENCE_FORMULATION_TARGET_PARSER_VERSION,
    candidates,
    warnings: [...warnings],
    reviewRequired: true,
  };
}
