import { z } from "zod";

export const REFERENCE_FORMULATION_LAYOUT_PARSER_VERSION = "formulab-reference-formulation-layout-v1";

const sourceKind = z.enum(["digital", "ocr", "mixed", "unknown"]);
const positionSchema = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict();

const textBlockSchema = z.object({
  type: z.enum(["heading", "text"]),
  blockIndex: z.number().int().nonnegative(),
  text: z.string().trim().min(1),
  source: sourceKind.default("unknown"),
  confidence: z.number().finite().min(0).max(1).optional(),
  position: positionSchema.optional(),
}).strict();

const tableBlockSchema = z.object({
  type: z.literal("table"),
  blockIndex: z.number().int().nonnegative(),
  rows: z.array(z.array(z.string())).min(1),
  source: sourceKind.default("unknown"),
  confidence: z.number().finite().min(0).max(1).optional(),
  position: positionSchema.optional(),
}).strict();

const pageSchema = z.object({
  pageNumber: z.number().int().positive(),
  blocks: z.array(z.discriminatedUnion("type", [textBlockSchema, tableBlockSchema])),
}).strict().superRefine((page, context) => {
  const indexes = page.blocks.map((block) => block.blockIndex);
  if (new Set(indexes).size !== indexes.length) {
    context.addIssue({ code: "custom", path: ["blocks"], message: "Block indexes must be unique within a page." });
  }
});

export const referenceFormulationLayoutInputSchema = z.object({
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  parserVersion: z.string().trim().min(1).max(120).default(REFERENCE_FORMULATION_LAYOUT_PARSER_VERSION),
  pages: z.array(pageSchema).min(1),
}).strict().superRefine((input, context) => {
  const pageNumbers = input.pages.map((page) => page.pageNumber);
  if (new Set(pageNumbers).size !== pageNumbers.length) {
    context.addIssue({ code: "custom", path: ["pages"], message: "Page numbers must be unique." });
  }
});

export type ReferenceFormulationLayoutInput = z.input<typeof referenceFormulationLayoutInputSchema>;
export type ReferenceFormulationBlock = z.infer<typeof textBlockSchema> | z.infer<typeof tableBlockSchema>;

export const REFERENCE_FORMULATION_TABLE_COLUMNS = [
  "ingredient", "product_code", "inci_or_chemical_name", "function", "phase", "amount", "unit", "basis",
] as const;

export type ReferenceFormulationTableColumn = typeof REFERENCE_FORMULATION_TABLE_COLUMNS[number];

export interface ReferenceFormulationTableCandidate {
  pageNumber: number;
  blockIndex: number;
  headerRowIndex: number;
  columns: Partial<Record<ReferenceFormulationTableColumn, number>>;
  rawHeaders: string[];
  dataRowCount: number;
  source: z.infer<typeof sourceKind>;
  reviewRequired: true;
}

export interface ReferenceFormulationHeading {
  kind: "title" | "ingredients" | "procedure";
  text: string;
  pageNumber: number;
  blockIndex: number;
  source: z.infer<typeof sourceKind>;
  reviewRequired: true;
}

export type ReferenceFormulationLayoutWarning = "no_semantic_headings" | "no_ingredient_table_candidates" | "ambiguous_table_headers";

export interface ReferenceFormulationLayoutResult {
  sourceDocumentHash: string;
  parserVersion: string;
  headings: ReferenceFormulationHeading[];
  ingredientTables: ReferenceFormulationTableCandidate[];
  warnings: ReferenceFormulationLayoutWarning[];
  reviewRequired: true;
}

const HEADING_ALIASES: Record<ReferenceFormulationHeading["kind"], readonly string[]> = {
  title: ["formulation title", "formulation name", "product name", "application"],
  ingredients: ["ingredients", "ingredient composition", "formula composition", "raw materials", "composition"],
  procedure: ["manufacturing procedure", "manufacturing process", "procedure", "method", "preparation", "process"],
};

const HEADER_ALIASES: Record<ReferenceFormulationTableColumn, readonly string[]> = {
  ingredient: ["ingredient", "raw material", "trade name", "commercial product", "material"],
  product_code: ["product code", "material code", "item code", "supplier code"],
  inci_or_chemical_name: ["inci", "inci name", "chemical name", "chemical identity"],
  function: ["function", "role", "purpose"],
  phase: ["phase", "step", "stage"],
  amount: ["amount", "quantity", "dosage", "concentration", "percentage", "%", "% w/w", "w/w %", "weight percent"],
  unit: ["unit", "units"],
  basis: ["basis", "weight basis", "basis of calculation"],
};

function normalizeLabel(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function semanticHeading(text: string): ReferenceFormulationHeading["kind"] | undefined {
  const normalized = normalizeLabel(text);
  return (Object.entries(HEADING_ALIASES) as [ReferenceFormulationHeading["kind"], readonly string[]][])
    .find(([, aliases]) => aliases.some((alias) => normalizeLabel(alias) === normalized))?.[0];
}

function mapHeaderColumns(headers: string[]): Partial<Record<ReferenceFormulationTableColumn, number>> {
  const mapping: Partial<Record<ReferenceFormulationTableColumn, number>> = {};
  headers.forEach((header, index) => {
    const normalized = normalizeLabel(header);
    const matches = REFERENCE_FORMULATION_TABLE_COLUMNS.filter((column) =>
      HEADER_ALIASES[column].some((alias) => normalizeLabel(alias) === normalized),
    );
    if (matches.length === 1 && mapping[matches[0]!] === undefined) mapping[matches[0]!] = index;
  });
  return mapping;
}

function isIngredientTable(columns: Partial<Record<ReferenceFormulationTableColumn, number>>): boolean {
  return columns.ingredient !== undefined
    && [columns.amount, columns.phase, columns.function, columns.product_code, columns.inci_or_chemical_name]
      .filter((value) => value !== undefined).length >= 1;
}

/**
 * Identify semantic formulation headings and ingredient-table candidates from page-aware blocks.
 * Geometry is retained as evidence context but never used to locate a supplier-specific template.
 */
export function analyzeReferenceFormulationLayout(input: ReferenceFormulationLayoutInput): ReferenceFormulationLayoutResult {
  const parsed = referenceFormulationLayoutInputSchema.parse(input);
  const headings: ReferenceFormulationHeading[] = [];
  const ingredientTables: ReferenceFormulationTableCandidate[] = [];
  let ambiguousTableHeaders = false;

  for (const page of parsed.pages) {
    for (const block of page.blocks) {
      if (block.type === "heading") {
        const kind = semanticHeading(block.text);
        if (kind) headings.push({ kind, text: block.text, pageNumber: page.pageNumber, blockIndex: block.blockIndex, source: block.source, reviewRequired: true });
      }
      if (block.type !== "table") continue;
      const headerSearchRows = block.rows.slice(0, Math.min(3, block.rows.length));
      const mappedRows = headerSearchRows.map((row) => mapHeaderColumns(row));
      const candidates = mappedRows.map((columns, index) => ({ columns, index })).filter(({ columns }) => isIngredientTable(columns));
      if (candidates.length > 1) ambiguousTableHeaders = true;
      const selected = candidates[0];
      if (!selected) continue;
      ingredientTables.push({
        pageNumber: page.pageNumber,
        blockIndex: block.blockIndex,
        headerRowIndex: selected.index,
        columns: selected.columns,
        rawHeaders: [...headerSearchRows[selected.index]!],
        dataRowCount: Math.max(0, block.rows.length - selected.index - 1),
        source: block.source,
        reviewRequired: true,
      });
    }
  }

  const warnings: ReferenceFormulationLayoutWarning[] = [];
  if (headings.length === 0) warnings.push("no_semantic_headings");
  if (ingredientTables.length === 0) warnings.push("no_ingredient_table_candidates");
  if (ambiguousTableHeaders) warnings.push("ambiguous_table_headers");
  return { sourceDocumentHash: parsed.sourceDocumentHash, parserVersion: parsed.parserVersion, headings, ingredientTables, warnings, reviewRequired: true };
}
