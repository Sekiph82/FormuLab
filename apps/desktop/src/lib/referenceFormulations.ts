import {
  matchReferenceFormulationProducts,
  referenceFormulationRecordSchema,
  type CommercialProduct,
  type ReferenceFormulationIngredientLine,
  type ReferenceFormulationRecord,
  type ReferenceFormulationSource,
  type ReferenceFormulationProductMatchingResult,
} from "@formulab/shared";
import { loadCrosswalks } from "./connectorPersistence";
import { listRecords, upsertRecords } from "./masterdata";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}";
  }
  return JSON.stringify(value);
}

/** Persist an immutable supplier-reference snapshot without touching production formula records. */
export async function recordReferenceFormulation(input: ReferenceFormulationRecord): Promise<ReferenceFormulationRecord> {
  const record = referenceFormulationRecordSchema.parse(input);
  const existing = await listRecords("reference_formulations");
  const sameCode = existing.find((candidate) => candidate.code === record.code);
  if (sameCode) {
    const parsedExisting = referenceFormulationRecordSchema.parse(sameCode);
    if (canonicalJson(parsedExisting) === canonicalJson(record)) return parsedExisting;
    throw new Error("Reference formulation records are immutable; use a new record code for a new extraction snapshot.");
  }
  await upsertRecords("reference_formulations", [record]);
  return record;
}

export async function listReferenceFormulations(): Promise<ReferenceFormulationRecord[]> {
  const records = await listRecords("reference_formulations");
  return records.map((record) => referenceFormulationRecordSchema.parse(record));
}

/** Resolve supplier product-code candidates against the existing FVL-04 crosswalk collection. */
export async function matchReferenceFormulationProductCandidates(input: {
  source: ReferenceFormulationSource;
  lines: ReferenceFormulationIngredientLine[];
  products: CommercialProduct[];
}): Promise<ReferenceFormulationProductMatchingResult> {
  const crosswalks = await loadCrosswalks();
  return matchReferenceFormulationProducts({ ...input, crosswalks });
}
