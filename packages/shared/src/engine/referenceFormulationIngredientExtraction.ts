import { z } from "zod";
import { referenceFormulationSourceSchema, type ReferenceFormulationSource } from "../schemas/referenceFormulationSource";
import {
  analyzeReferenceFormulationLayout,
  referenceFormulationLayoutInputSchema,
  type ReferenceFormulationLayoutInput,
  type ReferenceFormulationTableCandidate,
} from "./referenceFormulationParserContract";

export const REFERENCE_FORMULATION_INGREDIENT_PARSER_VERSION = "formulab-reference-formulation-ingredients-v1";

const fieldEvidenceSchema = z.object({
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  pageNumber: z.number().int().positive(),
  blockIndex: z.number().int().nonnegative(),
  rowIndex: z.number().int().nonnegative(),
  cellIndex: z.number().int().nonnegative(),
  headerRowIndex: z.number().int().nonnegative(),
  header: z.string().trim().min(1),
  excerpt: z.string().trim().min(1),
  source: z.enum(["digital", "ocr", "mixed", "unknown"]),
  confidence: z.number().finite().min(0).max(1).optional(),
  position: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict().optional(),
}).strict();

const citedCellSchema = z.object({ rawValue: z.string().trim().min(1), evidence: fieldEvidenceSchema }).strict();

export const referenceFormulationIngredientLineSchema = z.object({
  id: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  orderIndex: z.number().int().positive(),
  pageNumber: z.number().int().positive(),
  tableBlockIndex: z.number().int().nonnegative(),
  rowIndex: z.number().int().nonnegative(),
  rawRow: z.array(z.string()),
  ingredientName: citedCellSchema.optional(),
  supplierProductCode: citedCellSchema.optional(),
  inciOrChemicalName: citedCellSchema.optional(),
  function: citedCellSchema.optional(),
  phase: citedCellSchema.optional(),
  amount: citedCellSchema.optional(),
  unit: citedCellSchema.optional(),
  basis: citedCellSchema.optional(),
  quantitySemantics: z.enum(["explicit_amount", "q_s", "not_stated"]),
  reviewRequired: z.literal(true),
}).strict().superRefine((line, context) => {
  if (line.quantitySemantics === "q_s" && !line.amount) {
    context.addIssue({ code: "custom", path: ["amount"], message: "Explicit q.s. semantics require a cited source amount cell." });
  }
});

export type ReferenceFormulationIngredientLine = z.infer<typeof referenceFormulationIngredientLineSchema>;
export type ReferenceFormulationIngredientExtractionWarning =
  | "no_ingredient_table_candidates"
  | "no_ingredient_rows"
  | "ingredient_name_missing"
  | "ambiguous_ingredient_columns"
  | "ambiguous_table_headers"
  | "summary_rows_excluded"
  | "quantity_semantics_q_s_requires_review"
  | "ocr_ingredient_rows_require_review";

export interface ReferenceFormulationIngredientExtractionResult {
  sourceId: string;
  acquisitionCode: string;
  sourceDocumentHash: string;
  parserVersion: typeof REFERENCE_FORMULATION_INGREDIENT_PARSER_VERSION;
  lines: ReferenceFormulationIngredientLine[];
  warnings: ReferenceFormulationIngredientExtractionWarning[];
  reviewRequired: true;
}

function qSValue(value: string): boolean {
  return /(?:^|\b)(?:q\s*\.?\s*s\.?|q\.s\.|qs|quantum\s+satis|quantity\s+sufficient)(?:\b|$)/i.test(value);
}

function citedCell(input: {
  rawValue: string | undefined;
  columnIndex: number | undefined;
  header: string | undefined;
  row: string[];
  rowIndex: number;
  candidate: ReferenceFormulationTableCandidate;
  sourceDocumentHash: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
}): z.infer<typeof citedCellSchema> | undefined {
  const rawValue = input.rawValue?.trim();
  if (!rawValue || input.columnIndex === undefined || !input.header) return undefined;
  return citedCellSchema.parse({
    rawValue,
    evidence: {
      sourceDocumentHash: input.sourceDocumentHash,
      pageNumber: input.candidate.pageNumber,
      blockIndex: input.candidate.blockIndex,
      rowIndex: input.rowIndex,
      cellIndex: input.columnIndex,
      headerRowIndex: input.candidate.headerRowIndex,
      header: input.header,
      excerpt: rawValue,
      source: input.source,
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.position ? { position: input.position } : {}),
    },
  });
}

/** Extracts raw formulation rows from semantic table candidates without normalizing amounts or applying them to materials. */
export function extractReferenceFormulationIngredientLines(input: {
  source: ReferenceFormulationSource;
  pages: ReferenceFormulationLayoutInput["pages"];
}): ReferenceFormulationIngredientExtractionResult {
  const source = referenceFormulationSourceSchema.parse(input.source);
  const normalizedInput = referenceFormulationLayoutInputSchema.parse({ sourceDocumentHash: source.sourcePdfSha256, pages: input.pages });
  const layout = analyzeReferenceFormulationLayout(normalizedInput);
  const tableBlocks = new Map(normalizedInput.pages.map((page) => [page.pageNumber, page.blocks]));
  const tables = [...layout.ingredientTables].sort((left, right) => left.pageNumber - right.pageNumber || left.blockIndex - right.blockIndex);
  const lines: ReferenceFormulationIngredientLine[] = [];
  const warnings = new Set<ReferenceFormulationIngredientExtractionWarning>();
  if (tables.length === 0) warnings.add("no_ingredient_table_candidates");

  for (const candidate of tables) {
    if (candidate.ambiguousHeaderRows.length > 1) {
      warnings.add("ambiguous_table_headers");
      continue;
    }
    const block = tableBlocks.get(candidate.pageNumber)?.find((item) => item.type === "table" && item.blockIndex === candidate.blockIndex);
    if (!block || block.type !== "table") continue;
    const headers = candidate.rawHeaders;
    const ingredientColumns = headers.flatMap((header, index) => {
      const normalized = header.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
      return ["ingredient", "ingredients", "raw material", "raw materials", "trade name", "commercial product", "material"].includes(normalized) ? [index] : [];
    });
    if (ingredientColumns.length > 1) {
      warnings.add("ambiguous_ingredient_columns");
      continue;
    }

    block.rows.slice(candidate.headerRowIndex + 1).forEach((row, rowOffset) => {
      if (row.every((cell) => !cell.trim())) return;
      const rowIndex = candidate.headerRowIndex + 1 + rowOffset;
      const ingredientColumn = candidate.columns.ingredient;
      const functionColumn = candidate.columns.function;
      const label = ingredientColumn === undefined ? "" : (row[ingredientColumn] ?? "").normalize("NFKC").trim();
      const functionLabel = functionColumn === undefined ? "" : (row[functionColumn] ?? "").trim();
      const summaryLabel = /^(?:total|(?:viscosity|density|specific gravity|relative density|ph|appearance)(?:\s*\([^)]*\))?)$/i.test(label);
      if (summaryLabel && (!functionLabel || /^[-–—]$/.test(functionLabel))) {
        warnings.add("summary_rows_excluded");
        return;
      }
      const common = {
        candidate,
        sourceDocumentHash: source.sourcePdfSha256,
        source: block.source,
        ...(block.confidence !== undefined ? { confidence: block.confidence } : {}),
        ...(block.position ? { position: block.position } : {}),
      };
      const field = (key: keyof ReferenceFormulationTableCandidate["columns"]) => {
        const index = candidate.columns[key];
        return citedCell({ ...common, rawValue: index === undefined ? undefined : row[index], columnIndex: index, header: index === undefined ? undefined : headers[index], row, rowIndex });
      };
      const ingredientName = field("ingredient");
      const supplierProductCode = field("product_code");
      const inciOrChemicalName = field("inci_or_chemical_name");
      const functionValue = field("function");
      const phase = field("phase");
      let amount = field("amount");
      const unit = field("unit");
      const basis = field("basis");
      const qSCellIndex = [candidate.columns.amount, candidate.columns.unit, candidate.columns.basis]
        .find((index) => index !== undefined && qSValue(row[index] ?? ""));
      if (qSCellIndex !== undefined && !amount) {
        amount = citedCell({ ...common, rawValue: row[qSCellIndex], columnIndex: qSCellIndex, header: headers[qSCellIndex], row, rowIndex });
      }
      const qS = qSCellIndex !== undefined;
      const quantitySemantics = qS ? "q_s" as const : amount ? "explicit_amount" as const : "not_stated" as const;
      if (!ingredientName) warnings.add("ingredient_name_missing");
      if (qS) warnings.add("quantity_semantics_q_s_requires_review");
      if (block.source === "ocr") warnings.add("ocr_ingredient_rows_require_review");
      lines.push(referenceFormulationIngredientLineSchema.parse({
        id: `${source.id}:p${candidate.pageNumber}:b${candidate.blockIndex}:r${rowIndex}`,
        sourceDocumentHash: source.sourcePdfSha256,
        orderIndex: lines.length + 1,
        pageNumber: candidate.pageNumber,
        tableBlockIndex: candidate.blockIndex,
        rowIndex,
        rawRow: [...row],
        ...(ingredientName ? { ingredientName } : {}),
        ...(supplierProductCode ? { supplierProductCode } : {}),
        ...(inciOrChemicalName ? { inciOrChemicalName } : {}),
        ...(functionValue ? { function: functionValue } : {}),
        ...(phase ? { phase } : {}),
        ...(amount ? { amount } : {}),
        ...(unit ? { unit } : {}),
        ...(basis ? { basis } : {}),
        quantitySemantics,
        reviewRequired: true,
      }));
    });
  }
  if (lines.length === 0) warnings.add("no_ingredient_rows");
  return {
    sourceId: source.id,
    acquisitionCode: source.acquisitionCode,
    sourceDocumentHash: source.sourcePdfSha256,
    parserVersion: REFERENCE_FORMULATION_INGREDIENT_PARSER_VERSION,
    lines,
    warnings: [...warnings],
    reviewRequired: true,
  };
}
