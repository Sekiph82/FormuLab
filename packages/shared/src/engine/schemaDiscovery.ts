/**
 * FVL-04.015 — Source Schema Discovery: deterministic profiling of staged
 * source records, never AI inference. Every classification here is a plain
 * function of the observed values — same input always produces the same
 * schema, and genuine ambiguity is reported as ambiguous, never resolved by
 * a guess (a wrong silent guess is worse than an honest "unresolved").
 */
import { fingerprint } from "./connectorFingerprint";
import type {
  DecimalConvention,
  SourceEntitySchema,
  SourceFieldSchema,
  SourceFieldType,
  SourceRelationshipHint,
  SourceSchema,
  StagedSourceRecord,
} from "../schemas/connector";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const INTEGER = /^-?\d+$/;
/** Any string built only from digits, a dot, and/or a comma, with at least
 *  one separator — a candidate decimal, convention undetermined yet. */
const NUMERIC_WITH_SEPARATOR = /^-?\d{1,3}([.,]\d{3})*[.,]\d+$|^-?\d+[.,]\d+$/;
const BOOLEAN_LITERAL = /^(true|false)$/i;

function classifyValue(v: string): SourceFieldType {
  if (ISO_DATETIME.test(v)) return "datetime";
  if (ISO_DATE.test(v)) return "date";
  if (SLASH_DATE.test(v)) return "date";
  if (BOOLEAN_LITERAL.test(v)) return "boolean";
  if (INTEGER.test(v)) return "integer";
  if (NUMERIC_WITH_SEPARATOR.test(v)) return "decimal";
  return "string";
}

/** Evidence-based date-order resolution for `DD/MM/YYYY` vs `MM/DD/YYYY`
 *  slash dates. A value only disambiguates when one of its two numeric
 *  parts exceeds 12 (so it cannot be a month). Conflicting evidence across
 *  samples, or no disambiguating sample at all, stays ambiguous — never a
 *  US-vs-EU default guess. */
function discoverDateFormat(samples: string[]): { candidateDateFormat?: string; dateAmbiguous: boolean } {
  const slashSamples = samples.filter((s) => SLASH_DATE.test(s));
  if (slashSamples.length === 0) {
    if (samples.every((s) => ISO_DATE.test(s))) return { candidateDateFormat: "YYYY-MM-DD", dateAmbiguous: false };
    if (samples.every((s) => ISO_DATETIME.test(s))) return { candidateDateFormat: "ISO_DATETIME", dateAmbiguous: false };
    return { dateAmbiguous: true };
  }
  let sawDmy = false;
  let sawMdy = false;
  for (const s of slashSamples) {
    const m = SLASH_DATE.exec(s)!;
    const first = Number.parseInt(m[1], 10);
    const second = Number.parseInt(m[2], 10);
    if (first > 12 && second <= 12) sawDmy = true;
    else if (second > 12 && first <= 12) sawMdy = true;
    else if (first > 12 && second > 12) return { dateAmbiguous: true };
  }
  if (sawDmy && !sawMdy) return { candidateDateFormat: "DD/MM/YYYY", dateAmbiguous: false };
  if (sawMdy && !sawDmy) return { candidateDateFormat: "MM/DD/YYYY", dateAmbiguous: false };
  return { dateAmbiguous: true };
}

/** Evidence-based decimal-convention resolution. Only resolves when every
 *  sample agrees; any disagreement, or a sample with no disambiguating
 *  evidence at all, is reported `"ambiguous"` — never resolved by host
 *  locale or a majority vote. */
function discoverDecimalConvention(samples: string[]): DecimalConvention {
  const numeric = samples.filter((s) => NUMERIC_WITH_SEPARATOR.test(s));
  if (numeric.length === 0) return "unknown";
  let sawDot = false;
  let sawComma = false;
  let sawUnresolvable = false;
  for (const s of numeric) {
    const hasDot = s.includes(".");
    const hasComma = s.includes(",");
    if (hasDot && hasComma) {
      const lastDot = s.lastIndexOf(".");
      const lastComma = s.lastIndexOf(",");
      if (lastDot > lastComma) sawDot = true;
      else sawComma = true;
      continue;
    }
    if (hasDot) {
      const trailing = s.split(".").pop()!.length;
      if (trailing === 3) sawUnresolvable = true; // could be grouping (US) or 3dp decimal (EU) — genuinely ambiguous
      else sawDot = true;
      continue;
    }
    if (hasComma) {
      const trailing = s.split(",").pop()!.length;
      if (trailing === 3) sawUnresolvable = true;
      else sawComma = true;
    }
  }
  if (sawUnresolvable) return "ambiguous";
  if (sawDot && !sawComma) return "dot";
  if (sawComma && !sawDot) return "comma";
  if (sawDot && sawComma) return "ambiguous";
  return "unknown";
}

/** Only ever set from deterministic structural evidence: a header/path
 *  literally ending in a recognized unit token or annotated with
 *  `_unit_suffix` (e.g. `Viscosity_cP`) — never inferred from a bare field
 *  name like "Quantity" alone. */
const UNIT_SUFFIX = /_(kg|g|mg|l|ml|cp|cps|pct|percent)$/i;
function discoverUnitHint(fieldPath: string): string | undefined {
  const m = UNIT_SUFFIX.exec(fieldPath);
  return m ? m[1] : undefined;
}

function discoverField(path: string, values: (string | null | undefined)[], recordCount: number): SourceFieldSchema {
  const present = values.filter((v) => v !== undefined);
  const nonNull = present.filter((v): v is string => v !== null);
  const nullCount = present.length - nonNull.length;
  const distinct = new Set(nonNull);
  const types = new Set<SourceFieldType>(nonNull.map(classifyValue));

  const { candidateDateFormat, dateAmbiguous } = types.has("date") || types.has("datetime") ? discoverDateFormat(nonNull) : { dateAmbiguous: false, candidateDateFormat: undefined as string | undefined };
  const decimalConvention = types.has("decimal") ? discoverDecimalConvention(nonNull) : undefined;
  const unitHint = discoverUnitHint(path);
  const isUniqueNonNull = nonNull.length === present.length && nonNull.length > 0 && distinct.size === nonNull.length;

  return {
    path,
    observedTypes: [...types].sort(),
    nullable: nullCount > 0 || present.length < recordCount,
    nullCount,
    sampleCount: present.length,
    distinctCount: distinct.size,
    candidateDateFormat,
    dateAmbiguous: types.has("date") || types.has("datetime") ? dateAmbiguous : undefined,
    decimalConvention,
    unitHint,
    externalIdStatus: isUniqueNonNull ? "candidate" : "unresolved",
    isUniqueNonNull,
  };
}

function discoverRelationshipHints(fieldPaths: string[]): SourceRelationshipHint[] {
  const hints: SourceRelationshipHint[] = [];
  for (const path of fieldPaths) {
    if (/_id$|Id$|@ref$/i.test(path) && !/^(source_?record_?id)$/i.test(path)) {
      hints.push({ fieldPath: path, reason: `Field name suggests a foreign-key reference — a hint for a mapping profile author, never a validated relationship.` });
    }
  }
  return hints;
}

export function discoverEntitySchema(entity: string, records: StagedSourceRecord[]): SourceEntitySchema {
  const fieldPaths = new Set<string>();
  for (const r of records) for (const k of Object.keys(r.fields)) fieldPaths.add(k);

  const fields = [...fieldPaths].sort().map((path) => {
    const values = records.map((r) => (path in r.fields ? r.fields[path] : undefined));
    return discoverField(path, values, records.length);
  });

  return {
    entity,
    recordCount: records.length,
    fields,
    relationshipHints: discoverRelationshipHints([...fieldPaths]),
  };
}

/** Deterministic structural fingerprint — field paths + observed-type sets
 *  only, never a volatile timestamp or record count. Same structure always
 *  produces the same fingerprint, independent of when it was discovered. */
function entityFingerprintInput(schema: SourceEntitySchema): string {
  return schema.fields.map((f) => `${f.path}:${f.observedTypes.join("|")}`).join(";");
}

export function discoverSourceSchema(sourceSystemId: string, entities: { entity: string; records: StagedSourceRecord[] }[]): SourceSchema {
  const entitySchemas = entities.map((e) => discoverEntitySchema(e.entity, e.records));
  const fingerprintInput = entitySchemas
    .slice()
    .sort((a, b) => a.entity.localeCompare(b.entity))
    .map((s) => `${s.entity}[${entityFingerprintInput(s)}]`)
    .join("||");
  return {
    sourceSystemId,
    entities: entitySchemas,
    fingerprint: fingerprint(fingerprintInput),
    discoveredAt: new Date().toISOString(),
  };
}
