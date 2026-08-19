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
  ExternalIdEvidence,
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

/** Recognized null-token candidates — reported for a human/mapping profile
 *  to configure, NEVER silently treated as null by discovery itself. A
 *  real `0`/`false`/`"0"` value is deliberately absent from this list. */
const NULL_TOKEN_PATTERN = /^(n\/a|na|null|nil|none|-|\(blank\))$/i;

interface FieldDiscoveryOptions {
  /** True when this exact field/path was explicitly configured (via
   *  `StageOptions.idField`) as the source's own record identifier — the
   *  ONLY thing that ever earns `"configured_external_id"` (FVL-04.015
   *  hardening, C2). */
  isConfiguredExternalId?: boolean;
  /** Mocked DATABASE/REST metadata evidence, for representing a future
   *  connector's own declared primary/foreign key without implementing
   *  FVL-04.021/.022 (hardening, C3) — never set by the real FILE
   *  connector today. */
  isMetadataPrimaryKey?: boolean;
  /** The real path of a sibling field discovered to carry this field's
   *  per-row unit — see `discoverUnitColumnHints` below. */
  unitColumnHint?: string;
}

function discoverField(path: string, values: (string | null | undefined)[], recordCount: number, fieldOpts: FieldDiscoveryOptions = {}): SourceFieldSchema {
  const present = values.filter((v) => v !== undefined);
  const nonNull = present.filter((v): v is string => v !== null);
  const nullCount = present.length - nonNull.length;
  const distinct = new Set(nonNull);
  const types = new Set<SourceFieldType>(nonNull.map(classifyValue));

  const { candidateDateFormat, dateAmbiguous } = types.has("date") || types.has("datetime") ? discoverDateFormat(nonNull) : { dateAmbiguous: false, candidateDateFormat: undefined as string | undefined };
  const decimalConvention = types.has("decimal") ? discoverDecimalConvention(nonNull) : undefined;
  const unitHint = discoverUnitHint(path);
  const isUniqueNonNull = nonNull.length === present.length && nonNull.length > 0 && distinct.size === nonNull.length;

  const observedNullTokens = [...new Set(nonNull.filter((v) => NULL_TOKEN_PATTERN.test(v.trim())))];

  // FVL-04.015 hardening (C1/C2/C3) — identity is never inferred from mere
  // sample uniqueness alone. Explicit configuration and mocked DB/REST
  // metadata (evidence a caller supplies, never guessed here) outrank a
  // plain uniqueness observation; a unique DISPLAY NAME earns only
  // "unique_candidate", never authority.
  let externalIdStatus: ExternalIdEvidence;
  if (fieldOpts.isConfiguredExternalId) externalIdStatus = "configured_external_id";
  else if (fieldOpts.isMetadataPrimaryKey) externalIdStatus = "metadata_primary_key";
  else if (isUniqueNonNull) externalIdStatus = "unique_candidate";
  else externalIdStatus = "unresolved";

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
    unitColumnHint: fieldOpts.unitColumnHint,
    observedNullTokens: observedNullTokens.length > 0 ? observedNullTokens : undefined,
    externalIdStatus,
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

/** FVL-04.015 hardening (C4) — deterministic per-row unit-column discovery.
 *  Two recognized conventions, both structural, neither a semantic guess:
 *
 *  1. Per-field suffix: a field `X` has a sibling literally named
 *     `X_UOM`/`X_Unit`/`XUOM`/`XUnit` (case-insensitive) — unambiguous
 *     regardless of how many quantity-shaped fields the entity has (covers
 *     `Viscosity | ViscosityUnit`).
 *  2. Shared column: a sibling literally named `UOM`/`Unit`
 *     (case-insensitive) exists AND exactly ONE other field in the entity
 *     is numeric-shaped (integer/decimal) — that single field is paired
 *     with it (covers `Quantity | UOM`). Two-or-more numeric fields sharing
 *     one `UOM` column is genuinely ambiguous (which quantity does it
 *     describe?) and is deliberately left unresolved rather than guessed.
 *
 *  An explicit `unitColumnPairs` config, when the caller supplies one,
 *  always wins over both conventions — "explicit configuration/evidence
 *  over header guessing" per the hardening brief.
 */
function discoverUnitColumnHints(fieldPaths: string[], numericFieldPaths: Set<string>, unitColumnPairs?: Record<string, string>): Map<string, string> {
  const hints = new Map<string, string>();
  const byLower = new Map(fieldPaths.map((p) => [p.toLowerCase(), p] as const));

  if (unitColumnPairs) {
    for (const [field, unitField] of Object.entries(unitColumnPairs)) {
      if (fieldPaths.includes(field) && fieldPaths.includes(unitField)) hints.set(field, unitField);
    }
  }

  for (const path of fieldPaths) {
    if (hints.has(path)) continue;
    for (const suffix of ["_uom", "_unit", "uom", "unit"]) {
      const sibling = byLower.get(`${path.toLowerCase()}${suffix}`);
      if (sibling && sibling !== path) {
        hints.set(path, sibling);
        break;
      }
    }
  }

  const sharedUom = byLower.get("uom") ?? byLower.get("unit");
  if (sharedUom) {
    const candidates = [...numericFieldPaths].filter((p) => p !== sharedUom && !hints.has(p));
    if (candidates.length === 1) hints.set(candidates[0], sharedUom);
  }

  return hints;
}

export interface DiscoverEntityOptions {
  /** The field explicitly configured as this entity's own external-ID
   *  source (`StageOptions.idField`) — carried into discovery evidence
   *  rather than re-inferred later from the field's name (C2). */
  configuredIdField?: string;
  /** Mocked DATABASE/REST declared-primary-key field paths — represents
   *  future connector metadata without implementing FVL-04.021/.022 (C3). */
  metadataPrimaryKeyFields?: string[];
  /** Explicit quantity-field -> unit-field pairing, preferred over the
   *  recognized-suffix/shared-column conventions (C4). */
  unitColumnPairs?: Record<string, string>;
}

export function discoverEntitySchema(entity: string, records: StagedSourceRecord[], opts: DiscoverEntityOptions = {}): SourceEntitySchema {
  const fieldPaths = new Set<string>();
  for (const r of records) for (const k of Object.keys(r.fields)) fieldPaths.add(k);
  const sortedPaths = [...fieldPaths].sort();

  const numericFieldPaths = new Set<string>();
  for (const path of sortedPaths) {
    const nonNull = records.map((r) => r.fields[path]).filter((v): v is string => v !== null && v !== undefined);
    if (nonNull.length > 0 && nonNull.every((v) => classifyValue(v) === "integer" || classifyValue(v) === "decimal")) numericFieldPaths.add(path);
  }
  const unitColumnHints = discoverUnitColumnHints(sortedPaths, numericFieldPaths, opts.unitColumnPairs);
  const metadataPkSet = new Set(opts.metadataPrimaryKeyFields ?? []);

  const fields = sortedPaths.map((path) => {
    const values = records.map((r) => (path in r.fields ? r.fields[path] : undefined));
    return discoverField(path, values, records.length, {
      isConfiguredExternalId: path === opts.configuredIdField,
      isMetadataPrimaryKey: metadataPkSet.has(path),
      unitColumnHint: unitColumnHints.get(path),
    });
  });

  return {
    entity,
    recordCount: records.length,
    fields,
    relationshipHints: discoverRelationshipHints(sortedPaths),
  };
}

/**
 * Deterministic structural fingerprint. FVL-04.015 hardening (C6) —
 * strengthened beyond bare `path:observedTypes` to also cover structural
 * metadata that materially affects mapping compatibility: a recognized
 * unit suffix/column pairing, and whether a field's identity role is
 * CONFIGURATION-driven (`configured_external_id`/`metadata_primary_key`/
 * `explicit_primary_key`). Deliberately EXCLUDED: `nullCount`/
 * `sampleCount`/`distinctCount`/`observedNullTokens`/`isUniqueNonNull`
 * (a `unique_candidate` observation) — all of these can legitimately vary
 * batch to batch on an otherwise-identical schema (a different null ratio,
 * a coincidental duplicate value), and the fingerprint must not change
 * merely because one import batch's DATA happened to differ. Never
 * includes extraction timestamp or row count either.
 */
function entityFingerprintInput(schema: SourceEntitySchema): string {
  return schema.fields
    .map((f) => {
      const identityRole = f.externalIdStatus === "unique_candidate" || f.externalIdStatus === "unresolved" || f.externalIdStatus === undefined ? "" : f.externalIdStatus;
      return `${f.path}:${f.observedTypes.join("|")}:${f.unitHint ?? ""}:${f.unitColumnHint ?? ""}:${identityRole}`;
    })
    .join(";");
}

export interface DiscoverSourceSchemaEntityInput {
  entity: string;
  records: StagedSourceRecord[];
  configuredIdField?: string;
  metadataPrimaryKeyFields?: string[];
  unitColumnPairs?: Record<string, string>;
}

export function discoverSourceSchema(
  sourceSystemId: string,
  entities: DiscoverSourceSchemaEntityInput[],
  opts: { sourceProvidedSchemaVersion?: string } = {},
): SourceSchema {
  const entitySchemas = entities.map((e) => discoverEntitySchema(e.entity, e.records, e));
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
    sourceProvidedSchemaVersion: opts.sourceProvidedSchemaVersion,
  };
}
