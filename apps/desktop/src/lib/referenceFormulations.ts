import {
  currentReferenceFormulations,
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
  return (await recordReferenceFormulations([input]))[0]!;
}

/**
 * Save several immutable records (every formula of one PDF) in one store write.
 * `existing` is the stored corpus when the caller already holds it; an identical
 * stored record is returned as is, a different one under the same code is refused,
 * and nothing is written unless every record passes.
 */
export async function recordReferenceFormulations(
  inputs: ReferenceFormulationRecord[],
  existing?: readonly { code?: unknown }[],
): Promise<ReferenceFormulationRecord[]> {
  const records = inputs.map((input) => referenceFormulationRecordSchema.parse(input));
  const stored = new Map((existing ?? await listRecords("reference_formulations")).map((row) => [String(row.code), row]));
  const fresh: ReferenceFormulationRecord[] = [];
  const saved = records.map((record) => {
    const sameCode = stored.get(record.code);
    if (!sameCode) {
      fresh.push(record);
      return record;
    }
    const parsedExisting = referenceFormulationRecordSchema.parse(sameCode);
    if (canonicalJson(parsedExisting) === canonicalJson(record)) return parsedExisting;
    throw new Error("Reference formulation records are immutable; use a new record code for a new extraction snapshot.");
  });
  if (fresh.length) await upsertRecords("reference_formulations", fresh);
  return saved;
}

/** Newest parse of each source document; older parses remain stored as history. */
export async function listReferenceFormulations(): Promise<ReferenceFormulationRecord[]> {
  const records = await listRecords("reference_formulations");
  return currentReferenceFormulations(records.map((record) => referenceFormulationRecordSchema.parse(record)));
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
