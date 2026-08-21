/**
 * FVL-04.018 — deterministic transformation pipeline. A closed, declarative
 * set of operations (`TRANSFORMATION_OPS`) — configuration, never code; no
 * `eval`, no scripting language, no LLM. Every operation either produces a
 * real value or a structured, named error — never a silent guess. Final
 * shape/reference validation remains the EXISTING Data Exchange validator's
 * job; this pipeline only prepares a candidate value.
 */
import type { TransformationOp } from "../schemas/connector";
import { convertUnit } from "./unitConversion";

export interface TransformationContext {
  /** Resolves `sourceEntity + sourceRecordId + canonicalEntity` to a real
   *  canonical record code via the persistent Crosswalk Registry
   *  (FVL-04.017) — tier 1 of the required relationship-resolution
   *  precedence (FVL-04.018 hardening, F3): (1) crosswalk, (2) an explicit
   *  canonical code already present elsewhere in the SAME source record
   *  (`resolve_crosswalk`'s own `fallbackCanonicalField` config), (3)
   *  unresolved. Never a name match. */
  resolveCrosswalk?: (sourceEntity: string, sourceRecordId: string, canonicalEntity: string) => string | undefined;
  /** The staged record's own entity, used as `resolve_crosswalk`'s default
   *  `sourceEntity` when the step's own config does not override it. */
  currentEntity?: string;
  /** The full raw field map of the source record currently being mapped —
   *  needed so `resolve_crosswalk`'s explicit-canonical-code fallback (tier
   *  2) can read a DIFFERENT field already on the same row, never a guess. */
  sourceRecordFields?: Record<string, string | null>;
}

export interface TransformationOutcome {
  value: string | null | undefined;
  error?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Exported so the Mapping Profile editor's `parse_date` step config UI
 *  offers exactly the formats this engine actually supports — never a
 *  hand-duplicated list that could drift from the real parser. */
export const SUPPORTED_DATE_FORMATS = new Set(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"]);
/** FVL-04.018 hardening (Session 7, Part H1) — a clearly defined supported
 *  convention, not an arbitrary non-empty string. Exported so
 *  `mappingProfile.ts`'s own profile-time config validation checks the
 *  SAME set, never a second hand-maintained list. */
export const SUPPORTED_DECIMAL_SEPARATORS = new Set([".", ","]);
export const SUPPORTED_GROUP_SEPARATORS = new Set([",", ".", " ", "'"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Explicit-config decimal parsing — genuinely different from the
 *  pre-existing heuristic `parseHumanDecimal()` (`decimal.ts`, still used
 *  unchanged by Data Exchange's own CSV validation): this one requires an
 *  explicit configured convention and never guesses. FVL-04.018 hardening
 *  (F5): properly validates thousands-grouping structure — `"1,23,4"` and
 *  `"1.2.3"` are now rejected as malformed rather than silently accepted
 *  by stripping every group-separator occurrence. */
function parseExplicitDecimal(raw: string, decimalSeparator: string, groupSeparator?: string): number | undefined {
  let s = raw.trim();
  if (!s) return undefined;
  if (groupSeparator && groupSeparator === decimalSeparator) return undefined;

  let sign = "";
  if (s.startsWith("-")) {
    sign = "-";
    s = s.slice(1);
  }

  const parts = s.split(decimalSeparator);
  if (parts.length > 2) return undefined; // more than one decimal separator — malformed
  let intPart = parts[0];
  const fracPart = parts.length === 2 ? parts[1] : undefined;
  if (fracPart !== undefined && (!/^\d+$/.test(fracPart) || fracPart.length === 0)) return undefined;

  if (groupSeparator && intPart.includes(groupSeparator)) {
    const groupedRe = new RegExp(`^\\d{1,3}(${escapeRegExp(groupSeparator)}\\d{3})*$`);
    if (!groupedRe.test(intPart)) return undefined;
    intPart = intPart.split(groupSeparator).join("");
  }
  if (!/^\d+$/.test(intPart)) return undefined;

  const normalized = `${sign}${intPart}${fracPart !== undefined ? "." + fracPart : ""}`;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
/** Real calendar validation — FVL-04.018 hardening (F4). Previously only
 *  checked `day <= 31`/`month <= 12`, which silently accepted impossible
 *  dates like 31/02/2026 or 29/02/2025 (non-leap). Now rejects any day
 *  that does not actually exist in that month/year, leap years included. */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const max = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day <= max;
}

function parseExplicitDate(raw: string, format: string): string | undefined {
  const s = raw.trim();
  if (format === "YYYY-MM-DD") {
    if (!ISO_DATE.test(s)) return undefined;
    const [y, m, d] = s.split("-").map((n) => Number.parseInt(n, 10));
    return isValidCalendarDate(y, m, d) ? s : undefined;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return undefined;
  const [, a, b, year] = m;
  let day: string, month: string;
  if (format === "DD/MM/YYYY") [day, month] = [a, b];
  else if (format === "MM/DD/YYYY") [month, day] = [a, b];
  else return undefined;
  const dayNum = Number.parseInt(day, 10);
  const monthNum = Number.parseInt(month, 10);
  const yearNum = Number.parseInt(year, 10);
  if (!isValidCalendarDate(yearNum, monthNum, dayNum)) return undefined;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Applies one transformation step to one value. Never throws — every
 *  failure is a structured `error` string, caught and traced by the caller
 *  (`applyMappingProfile`). */
export function applyTransformation(
  op: TransformationOp,
  value: string | null,
  config: Record<string, unknown> | undefined,
  ctx: TransformationContext = {},
): TransformationOutcome {
  switch (op) {
    case "trim":
      return { value: value === null ? null : value.trim() };
    case "empty_to_null":
      return { value: value === "" ? null : value };
    case "lowercase":
      return { value: value === null ? null : value.toLowerCase() };
    case "uppercase":
      return { value: value === null ? null : value.toUpperCase() };
    case "safe_code_case":
      return { value: value === null ? null : value.trim().toUpperCase().replace(/[\s_]+/g, "-").replace(/[^A-Z0-9-]/g, "") };
    case "constant":
      return { value: typeof config?.value === "string" ? config.value : undefined, error: typeof config?.value === "string" ? undefined : "constant_missing_value" };
    case "copy":
      return { value };
    case "parse_decimal": {
      if (value === null) return { value: null };
      const decimalSeparator = typeof config?.decimalSeparator === "string" ? config.decimalSeparator : undefined;
      const groupSeparator = typeof config?.groupSeparator === "string" ? config.groupSeparator : undefined;
      // FVL-04.018 hardening (Session 7, Part H1) — a clearly defined
      // supported convention, checked at RUNTIME too (never only at
      // profile-validation time), so malformed config can never reach the
      // parser regardless of how it got here.
      if (!decimalSeparator || !SUPPORTED_DECIMAL_SEPARATORS.has(decimalSeparator)) return { value: undefined, error: "decimal_convention_not_configured" };
      if (groupSeparator !== undefined && !SUPPORTED_GROUP_SEPARATORS.has(groupSeparator)) return { value: undefined, error: "invalid_decimal_configuration" };
      if (groupSeparator && groupSeparator === decimalSeparator) return { value: undefined, error: "invalid_decimal_configuration" };
      const n = parseExplicitDecimal(value, decimalSeparator, groupSeparator);
      if (n === undefined) return { value: undefined, error: "ambiguous_or_invalid_decimal" };
      return { value: String(n) };
    }
    case "parse_date": {
      if (value === null) return { value: null };
      const format = typeof config?.format === "string" ? config.format : undefined;
      if (!format || !SUPPORTED_DATE_FORMATS.has(format)) return { value: undefined, error: "date_format_not_configured" };
      const d = parseExplicitDate(value, format);
      if (d === undefined) return { value: undefined, error: "ambiguous_or_invalid_date" };
      return { value: d };
    }
    case "map_enum": {
      if (value === null) return { value: null };
      // FVL-04.018 hardening (Session 7, Part H2) — no blind cast: a
      // malformed `enumMap` (not a plain object, or a value that isn't a
      // string) is a structured configuration error, never a value silently
      // treated as an empty map or an unpredictable runtime shape.
      const rawMap = config?.enumMap;
      if (typeof rawMap !== "object" || rawMap === null || Array.isArray(rawMap)) return { value: undefined, error: "invalid_enum_configuration" };
      const entries = Object.entries(rawMap as Record<string, unknown>);
      if (entries.length === 0 || entries.some(([, v]) => typeof v !== "string")) return { value: undefined, error: "invalid_enum_configuration" };
      const map = Object.fromEntries(entries) as Record<string, string>;
      const caseInsensitive = config?.caseInsensitive !== false;
      const key = caseInsensitive ? Object.keys(map).find((k) => k.toLowerCase() === value.toLowerCase()) : (value in map ? value : undefined);
      if (key === undefined) return { value: undefined, error: "unknown_enum_value" };
      return { value: map[key] };
    }
    case "map_boolean": {
      if (value === null) return { value: null };
      // FVL-04.018 hardening (Session 7, Part H3) — the prior blind
      // `as string[]` cast could THROW at runtime (e.g. `"Y".some(...)` is
      // not a function) if malformed config ever bypassed profile
      // validation. Explicit runtime shape checks make that structurally
      // impossible: a malformed array is a structured error, never a crash.
      const trueValuesRaw = config?.trueValues;
      const falseValuesRaw = config?.falseValues;
      if (!Array.isArray(trueValuesRaw) || !Array.isArray(falseValuesRaw) || trueValuesRaw.some((t) => typeof t !== "string") || falseValuesRaw.some((f) => typeof f !== "string")) {
        return { value: undefined, error: "invalid_boolean_configuration" };
      }
      const trueValues = trueValuesRaw as string[];
      const falseValues = falseValuesRaw as string[];
      const v = value.trim().toLowerCase();
      if (trueValues.some((t) => t.toLowerCase() === v)) return { value: "true" };
      if (falseValues.some((f) => f.toLowerCase() === v)) return { value: "false" };
      return { value: undefined, error: "unknown_boolean_value" };
    }
    case "convert_unit": {
      if (value === null) return { value: null };
      const from = typeof config?.from === "string" ? config.from : undefined;
      const to = typeof config?.to === "string" ? config.to : undefined;
      if (!from || !to) return { value: undefined, error: "unit_conversion_not_configured" };
      const n = Number(value);
      if (!Number.isFinite(n)) return { value: undefined, error: "not_a_number" };
      const outcome = convertUnit(n, from, to);
      if (outcome.error) return { value: undefined, error: outcome.error };
      return { value: String(outcome.value) };
    }
    case "resolve_crosswalk": {
      if (value === null) return { value: null };
      // FVL-04.018 hardening (Session 7, Part H6) — cross-entity
      // relationship resolution now requires an EXPLICIT `sourceEntity`.
      // The same-entity shorthand (resolve against the record's OWN
      // entity) still exists but must be requested explicitly via
      // `sameEntity: true` — never an accidental fallback to whatever
      // `ctx.currentEntity` happens to be.
      const explicitSourceEntity = typeof config?.sourceEntity === "string" ? config.sourceEntity : undefined;
      const sameEntityShorthand = config?.sameEntity === true;
      const sourceEntity = explicitSourceEntity ?? (sameEntityShorthand ? ctx.currentEntity : undefined);
      const canonicalEntity = typeof config?.canonicalEntity === "string" ? config.canonicalEntity : undefined;
      if (!canonicalEntity) return { value: undefined, error: "crosswalk_canonical_entity_not_configured" };
      if (!sourceEntity) return { value: undefined, error: "crosswalk_source_entity_not_configured" };
      if (!ctx.resolveCrosswalk) return { value: undefined, error: "crosswalk_not_configured" };
      // Precedence tier 1: the persistent External ID Crosswalk.
      const resolved = ctx.resolveCrosswalk(sourceEntity, value, canonicalEntity);
      if (resolved !== undefined) return { value: resolved };
      // Precedence tier 2: an explicit canonical code the source/profile
      // already declares on a DIFFERENT field of the same record — never a
      // fuzzy/name-based fallback, only a field the profile names outright.
      const fallbackCanonicalField = typeof config?.fallbackCanonicalField === "string" ? config.fallbackCanonicalField : undefined;
      if (fallbackCanonicalField) {
        const fallbackValue = ctx.sourceRecordFields?.[fallbackCanonicalField];
        if (fallbackValue !== undefined && fallbackValue !== null && fallbackValue !== "") return { value: fallbackValue };
      }
      // Precedence tier 3: unresolved — never a silent name match.
      return { value: undefined, error: "crosswalk_unresolved" };
    }
    case "split": {
      if (value === null) return { value: null };
      const delimiter = typeof config?.delimiter === "string" ? config.delimiter : ",";
      return { value: value.split(delimiter).map((s) => s.trim()).filter(Boolean).join(";") };
    }
    case "join": {
      if (value === null) return { value: null };
      const delimiter = typeof config?.delimiter === "string" ? config.delimiter : ";";
      return { value: value.split(";").join(delimiter) };
    }
    default:
      return { value: undefined, error: "unknown_transformation_op" };
  }
}

/** Runs a full ordered pipeline of steps against one raw value. Stops at
 *  the first error (later steps cannot recover a value that already
 *  failed) and reports which op failed. */
export function applyTransformationPipeline(
  steps: { op: TransformationOp; config?: Record<string, unknown> }[],
  rawValue: string | null,
  ctx: TransformationContext = {},
): { value: string | null | undefined; opsRun: TransformationOp[]; error?: string } {
  let current: string | null = rawValue;
  const opsRun: TransformationOp[] = [];
  for (const step of steps) {
    const outcome = applyTransformation(step.op, current, step.config, ctx);
    opsRun.push(step.op);
    if (outcome.error) return { value: undefined, opsRun, error: outcome.error };
    current = outcome.value ?? null;
  }
  return { value: current, opsRun };
}
