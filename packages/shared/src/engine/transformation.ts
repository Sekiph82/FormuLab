/**
 * FVL-04.018 — deterministic transformation pipeline. A closed, declarative
 * set of operations (`TRANSFORMATION_OPS`) — configuration, never code; no
 * `eval`, no scripting language, no LLM. Every operation either produces a
 * real value or a structured, named error — never a silent guess. Final
 * shape/reference validation remains the EXISTING Data Exchange validator's
 * job; this pipeline only prepares a candidate value.
 */
import type { TransformationOp } from "../schemas/connector";

export interface TransformationContext {
  /** Resolves `sourceEntity + sourceRecordId` to a real canonical record
   *  code via the persistent Crosswalk Registry (FVL-04.017) — the ONLY
   *  legitimate relationship-resolution path besides an explicit canonical
   *  code already present in the source. Never a name match. */
  resolveCrosswalk?: (sourceEntity: string, sourceRecordId: string) => string | undefined;
  /** The staged record's own entity, used as `resolve_crosswalk`'s default
   *  `sourceEntity` when the step's own config does not override it. */
  currentEntity?: string;
}

export interface TransformationOutcome {
  value: string | null | undefined;
  error?: string;
}

const MASS_UNITS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME_UNITS: Record<string, number> = { ml: 1, l: 1000 };

function unitDimension(unit: string): "mass" | "volume" | undefined {
  const u = unit.toLowerCase();
  if (u in MASS_UNITS) return "mass";
  if (u in VOLUME_UNITS) return "volume";
  return undefined;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseExplicitDecimal(raw: string, decimalSeparator: string, groupSeparator?: string): number | undefined {
  let s = raw.trim();
  if (groupSeparator) s = s.split(groupSeparator).join("");
  if (decimalSeparator !== ".") {
    // Guard: a leftover "." that is not the configured decimal separator
    // means the value does not actually match the declared convention —
    // never silently strip it.
    if (s.includes(".") && decimalSeparator !== ".") return undefined;
    s = s.replace(decimalSeparator, ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseExplicitDate(raw: string, format: string): string | undefined {
  const s = raw.trim();
  if (format === "YYYY-MM-DD") return ISO_DATE.test(s) ? s : undefined;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return undefined;
  const [, a, b, year] = m;
  let day: string, month: string;
  if (format === "DD/MM/YYYY") [day, month] = [a, b];
  else if (format === "MM/DD/YYYY") [month, day] = [a, b];
  else return undefined;
  const dayNum = Number.parseInt(day, 10);
  const monthNum = Number.parseInt(month, 10);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return undefined;
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
      if (!decimalSeparator) return { value: undefined, error: "decimal_convention_not_configured" };
      const n = parseExplicitDecimal(value, decimalSeparator, groupSeparator);
      if (n === undefined) return { value: undefined, error: "ambiguous_or_invalid_decimal" };
      return { value: String(n) };
    }
    case "parse_date": {
      if (value === null) return { value: null };
      const format = typeof config?.format === "string" ? config.format : undefined;
      if (!format) return { value: undefined, error: "date_format_not_configured" };
      const d = parseExplicitDate(value, format);
      if (d === undefined) return { value: undefined, error: "ambiguous_or_invalid_date" };
      return { value: d };
    }
    case "map_enum": {
      if (value === null) return { value: null };
      const map = (config?.enumMap ?? {}) as Record<string, string>;
      const caseInsensitive = config?.caseInsensitive !== false;
      const key = caseInsensitive ? Object.keys(map).find((k) => k.toLowerCase() === value.toLowerCase()) : (value in map ? value : undefined);
      if (key === undefined) return { value: undefined, error: "unknown_enum_value" };
      return { value: map[key] };
    }
    case "map_boolean": {
      if (value === null) return { value: null };
      const trueValues = (config?.trueValues as string[] | undefined) ?? [];
      const falseValues = (config?.falseValues as string[] | undefined) ?? [];
      const v = value.trim().toLowerCase();
      if (trueValues.some((t) => t.toLowerCase() === v)) return { value: "true" };
      if (falseValues.some((f) => f.toLowerCase() === v)) return { value: "false" };
      return { value: undefined, error: "unknown_boolean_value" };
    }
    case "convert_unit": {
      if (value === null) return { value: null };
      const from = typeof config?.from === "string" ? config.from.toLowerCase() : undefined;
      const to = typeof config?.to === "string" ? config.to.toLowerCase() : undefined;
      if (!from || !to) return { value: undefined, error: "unit_conversion_not_configured" };
      const n = Number(value);
      if (!Number.isFinite(n)) return { value: undefined, error: "not_a_number" };
      const fromDim = unitDimension(from);
      const toDim = unitDimension(to);
      if (!fromDim || !toDim || fromDim !== toDim) return { value: undefined, error: "incompatible_unit_conversion" };
      const table = fromDim === "mass" ? MASS_UNITS : VOLUME_UNITS;
      const base = n * table[from];
      const result = base / table[to];
      return { value: String(result) };
    }
    case "resolve_crosswalk": {
      if (value === null) return { value: null };
      const sourceEntity = typeof config?.sourceEntity === "string" ? config.sourceEntity : ctx.currentEntity;
      if (!sourceEntity || !ctx.resolveCrosswalk) return { value: undefined, error: "crosswalk_not_configured" };
      const resolved = ctx.resolveCrosswalk(sourceEntity, value);
      if (resolved === undefined) return { value: undefined, error: "crosswalk_unresolved" };
      return { value: resolved };
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
