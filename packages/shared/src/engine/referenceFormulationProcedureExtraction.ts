import { z } from "zod";
import { referenceFormulationSourceSchema, type ReferenceFormulationSource } from "../schemas/referenceFormulationSource";
import { referenceFormulationLayoutInputSchema, type ReferenceFormulationLayoutInput } from "./referenceFormulationParserContract";

export const REFERENCE_FORMULATION_PROCEDURE_PARSER_VERSION = "formulab-reference-formulation-procedure-v1";

export const REFERENCE_FORMULATION_PROCESS_ACTIONS = [
  "addition", "dissolve", "mix", "hold", "heat", "cool", "adjust_ph", "thicken", "appearance_check", "other",
] as const;

const processEvidenceSchema = z.object({
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

const processConditionSchema = z.object({
  kind: z.enum(["temperature", "time", "speed", "ph", "appearance", "homogeneity"]),
  rawValue: z.string().trim().min(1),
  evidence: processEvidenceSchema,
}).strict();

export const referenceFormulationProcedureStepSchema = z.object({
  id: z.string().trim().min(1),
  sequenceOrder: z.number().int().positive(),
  printedStepNumber: z.string().trim().min(1).optional(),
  rawInstruction: z.string().trim().min(1).max(4000),
  rawContextCells: z.array(z.string()),
  actions: z.array(z.enum(REFERENCE_FORMULATION_PROCESS_ACTIONS)).min(1),
  conditions: z.array(processConditionSchema),
  extractionMethod: z.enum(["procedure_section_text", "procedure_table_column"]),
  evidence: processEvidenceSchema,
  reviewRequired: z.literal(true),
}).strict();

export type ReferenceFormulationProcedureStep = z.infer<typeof referenceFormulationProcedureStepSchema>;
export type ReferenceFormulationProcedureWarning =
  | "procedure_section_not_detected"
  | "no_procedure_steps"
  | "ambiguous_procedure_columns"
  | "ocr_process_requires_review";

export interface ReferenceFormulationProcedureResult {
  sourceId: string;
  acquisitionCode: string;
  sourceDocumentHash: string;
  parserVersion: typeof REFERENCE_FORMULATION_PROCEDURE_PARSER_VERSION;
  steps: ReferenceFormulationProcedureStep[];
  warnings: ReferenceFormulationProcedureWarning[];
  reviewRequired: true;
}

const PROCEDURE_HEADINGS = new Set([
  "procedure", "manufacturing procedure", "manufacturing process", "process", "method", "preparation", "processing instructions",
]);
const END_HEADINGS = new Set([
  "ingredients", "ingredient composition", "formula composition", "raw materials", "composition", "finished product", "product properties",
  "specifications", "storage", "safety", "regulatory", "results", "appearance",
]);
const PROCEDURE_TABLE_HEADERS = new Set(["procedure", "instructions", "instruction", "process", "process description", "manufacturing step", "operation"]);
const STEP_TABLE_HEADERS = new Set(["step", "step number", "sequence", "order", "stage"]);

function normalizeLabel(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function detectActions(text: string): Array<typeof REFERENCE_FORMULATION_PROCESS_ACTIONS[number]> {
  const value = text.toLocaleLowerCase("en-US");
  const actions: Array<typeof REFERENCE_FORMULATION_PROCESS_ACTIONS[number]> = [];
  const add = (action: typeof REFERENCE_FORMULATION_PROCESS_ACTIONS[number], pattern: RegExp) => { if (pattern.test(value)) actions.push(action); };
  add("addition", /\b(?:add|added|adding|introduce|charge|incorporate|addition|zugeben|hinzufügen|ajouter|añadir|aggiungere)\b/i);
  add("dissolve", /\b(?:dissolve|dissolved|dissolving|solubilize|until dissolved|auflösen|dissoudre|disolvere)\b/i);
  add("mix", /\b(?:mix|mixing|stir|stirring|agitate|agitating|homogenize|homogenizing|disperse|dispersing|blend|blending|rühren|mélanger|mezclar|miscelare)\b/i);
  add("hold", /\b(?:hold|maintain|keep at|hold for|maintain for|stehen lassen|maintenir|mantener)\b/i);
  add("heat", /\b(?:heat|warm|heating|raise temperature|erhitzen|chauffer|calentar|riscaldare)\b/i);
  add("cool", /\b(?:cool|cooling|cool down|abkühlen|refroidir|enfriar|raffreddare)\b/i);
  add("adjust_ph", /\b(?:adjust\s+(?:the\s+)?p\s*h|p\s*h\s*(?:adjust|adjustment)|neutralize|neutralise|p\s*h\s*adjustment)\b/i);
  add("thicken", /\b(?:thicken|thickening|viscosity|thickener|increase viscosity|verdicken|épaissir|espesar)\b/i);
  add("appearance_check", /\b(?:clear|clarity|transparent|appearance|visual inspection)\b/i);
  if (actions.length === 0) actions.push("other");
  return actions;
}

function conditionsFor(text: string, evidence: z.infer<typeof processEvidenceSchema>): z.infer<typeof processConditionSchema>[] {
  const candidates: Array<{ kind: z.infer<typeof processConditionSchema>["kind"]; pattern: RegExp }> = [
    { kind: "temperature", pattern: /-?\d+(?:[.,]\d+)?(?:\s*(?:-|–|—|to)\s*-?\d+(?:[.,]\d+)?)?\s*(?:°\s*[CF]|°[CF]|degrees?\s*[CF])/gi },
    { kind: "time", pattern: /\b\d+(?:[.,]\d+)?(?:\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?)?\s*(?:seconds?|secs?|s|min(?:ute)?s?|h(?:ours?)?|hrs?)\b/gi },
    { kind: "speed", pattern: /\b\d+(?:[.,]\d+)?(?:\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?)?\s*(?:rpm|r\s*\/\s*min|rev(?:olutions?)?\s*\/\s*min)\b/gi },
    { kind: "ph", pattern: /\bp\s*h\s*(?:(?:adjust(?:ed)?|to|at|of|=|:)?\s*)\d+(?:[.,]\d+)?(?:\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?)?/gi },
    { kind: "appearance", pattern: /\b(?:clear|clarity|transparent|appearance)\b/gi },
    { kind: "homogeneity", pattern: /\b(?:homogeneous|homogeneous mixture|uniform|homogeneity|homogen(?:e|i)ous)\b/gi },
  ];
  const conditions: z.infer<typeof processConditionSchema>[] = [];
  for (const candidate of candidates) {
    for (const match of text.matchAll(candidate.pattern)) {
      if (!match[0].trim()) continue;
      conditions.push(processConditionSchema.parse({ kind: candidate.kind, rawValue: match[0], evidence: { ...evidence, excerpt: match[0] } }));
    }
  }
  return conditions;
}

function printedNumber(value: string): string | undefined {
  return value.trim().match(/^(?:(?:step|stage)\s*)?(\d+(?:\.\d+)*)(?:[.)]|\s+-)\s*/i)?.[1];
}

/** Extract ordered, source-cited process candidates from semantic procedure sections and procedure tables. */
export function extractReferenceFormulationProcedure(input: {
  source: ReferenceFormulationSource;
  pages: ReferenceFormulationLayoutInput["pages"];
}): ReferenceFormulationProcedureResult {
  const source = referenceFormulationSourceSchema.parse(input.source);
  const layout = referenceFormulationLayoutInputSchema.parse({ sourceDocumentHash: source.sourcePdfSha256, pages: input.pages });
  const steps: ReferenceFormulationProcedureStep[] = [];
  const warnings = new Set<ReferenceFormulationProcedureWarning>();
  let inProcedure = false;
  let foundSection = false;

  const appendStep = (inputStep: {
    pageNumber: number; blockIndex: number; rowIndex?: number; text: string; rawContextCells: string[];
    conditionSources?: Array<{ text: string; cellIndex?: number; kind?: z.infer<typeof processConditionSchema>["kind"] }>;
    sourceKind: "digital" | "ocr" | "mixed" | "unknown"; confidence?: number; position?: { x: number; y: number };
    extractionMethod: "procedure_section_text" | "procedure_table_column"; stepNumber?: string; cellIndex?: number;
  }) => {
    const rawInstruction = inputStep.text.trim();
    if (!rawInstruction) return;
    const evidence = processEvidenceSchema.parse({
      sourceDocumentHash: source.sourcePdfSha256,
      pageNumber: inputStep.pageNumber,
      blockIndex: inputStep.blockIndex,
      ...(inputStep.rowIndex !== undefined ? { rowIndex: inputStep.rowIndex } : {}),
      ...(inputStep.cellIndex !== undefined ? { cellIndex: inputStep.cellIndex } : {}),
      excerpt: rawInstruction,
      source: inputStep.sourceKind,
      ...(inputStep.confidence !== undefined ? { confidence: inputStep.confidence } : {}),
      ...(inputStep.position ? { position: inputStep.position } : {}),
    });
    const printedStepNumber = inputStep.stepNumber ?? printedNumber(rawInstruction);
    steps.push(referenceFormulationProcedureStepSchema.parse({
      id: `${source.id}:process:p${inputStep.pageNumber}:b${inputStep.blockIndex}:r${inputStep.rowIndex ?? "text"}:${steps.length + 1}`,
      sequenceOrder: steps.length + 1,
      ...(printedStepNumber ? { printedStepNumber } : {}),
      rawInstruction,
      rawContextCells: [...inputStep.rawContextCells],
      actions: detectActions(rawInstruction),
      conditions: (inputStep.conditionSources ?? [{ text: rawInstruction }]).flatMap((conditionSource) => {
        const conditionEvidence = {
          ...evidence,
          ...(conditionSource.cellIndex !== undefined ? { cellIndex: conditionSource.cellIndex } : {}),
        };
        if (conditionSource.kind) {
          return [processConditionSchema.parse({ kind: conditionSource.kind, rawValue: conditionSource.text, evidence: { ...conditionEvidence, excerpt: conditionSource.text } })];
        }
        return conditionsFor(conditionSource.text, conditionEvidence);
      }),
      extractionMethod: inputStep.extractionMethod,
      evidence,
      reviewRequired: true,
    }));
    if (inputStep.sourceKind === "ocr" || inputStep.sourceKind === "mixed") warnings.add("ocr_process_requires_review");
  };

  for (const page of layout.pages) {
    const ordered = [...page.blocks].sort((left, right) => left.blockIndex - right.blockIndex);
    for (const block of ordered) {
      if (block.type === "heading") {
        const heading = normalizeLabel(block.text);
        if (PROCEDURE_HEADINGS.has(heading)) {
          inProcedure = true;
          foundSection = true;
        } else if (inProcedure && (END_HEADINGS.has(heading) || !PROCEDURE_HEADINGS.has(heading))) {
          inProcedure = false;
        }
        continue;
      }
      if (block.type === "text") {
        if (!inProcedure) continue;
        appendStep({
          pageNumber: page.pageNumber, blockIndex: block.blockIndex, text: block.text, rawContextCells: [],
          sourceKind: block.source, ...(block.confidence !== undefined ? { confidence: block.confidence } : {}),
          ...(block.position ? { position: block.position } : {}), extractionMethod: "procedure_section_text",
        });
        continue;
      }
      if (block.type !== "table") continue;

      const headerRows = block.rows.slice(0, Math.min(3, block.rows.length));
      const procedureColumns = headerRows.flatMap((row, rowIndex) => row.flatMap((cell, cellIndex) =>
        PROCEDURE_TABLE_HEADERS.has(normalizeLabel(cell)) ? [{ rowIndex, cellIndex }] : [],
      ));
      const uniqueProcedureColumns = [...new Map(procedureColumns.map((item) => [item.cellIndex, item])).values()];
      if (uniqueProcedureColumns.length > 1) {
        warnings.add("ambiguous_procedure_columns");
        continue;
      }
      const procedureColumn = uniqueProcedureColumns[0];
      if (!procedureColumn) continue;
      if (!inProcedure) foundSection = true;
      const stepColumn = headerRows[procedureColumn.rowIndex]!.findIndex((cell) => STEP_TABLE_HEADERS.has(normalizeLabel(cell)));
      const conditionKindForHeader = (header: string): z.infer<typeof processConditionSchema>["kind"] | undefined => {
        const label = normalizeLabel(header);
        if (/\b(?:temperature|temp)\b/.test(label)) return "temperature";
        if (/\b(?:time|duration|hold time)\b/.test(label)) return "time";
        if (/\b(?:speed|rpm|agitation rate)\b/.test(label)) return "speed";
        if (/\b(?:ph)\b/.test(label)) return "ph";
        if (/\b(?:appearance|clarity)\b/.test(label)) return "appearance";
        if (/\b(?:homogeneity|homogeneous)\b/.test(label)) return "homogeneity";
        return undefined;
      };
      block.rows.slice(procedureColumn.rowIndex + 1).forEach((row, offset) => {
        const rowIndex = procedureColumn.rowIndex + 1 + offset;
        const instruction = row[procedureColumn.cellIndex]?.trim();
        if (!instruction) return;
        const printed = stepColumn >= 0 ? row[stepColumn]?.trim() : undefined;
        appendStep({
          pageNumber: page.pageNumber, blockIndex: block.blockIndex, rowIndex, cellIndex: procedureColumn.cellIndex,
          text: instruction, rawContextCells: [...row], sourceKind: block.source,
          conditionSources: row.flatMap((text, cellIndex) => text.trim() ? [{ text, cellIndex, ...(conditionKindForHeader(headerRows[procedureColumn.rowIndex]![cellIndex] ?? "") ? { kind: conditionKindForHeader(headerRows[procedureColumn.rowIndex]![cellIndex]!) } : {}) }] : []),
          ...(block.confidence !== undefined ? { confidence: block.confidence } : {}),
          ...(block.position ? { position: block.position } : {}), extractionMethod: "procedure_table_column",
          ...(printed ? { stepNumber: printed } : {}),
        });
      });
    }
  }

  if (!foundSection) warnings.add("procedure_section_not_detected");
  if (steps.length === 0) warnings.add("no_procedure_steps");
  return {
    sourceId: source.id,
    acquisitionCode: source.acquisitionCode,
    sourceDocumentHash: source.sourcePdfSha256,
    parserVersion: REFERENCE_FORMULATION_PROCEDURE_PARSER_VERSION,
    steps,
    warnings: [...warnings],
    reviewRequired: true,
  };
}
