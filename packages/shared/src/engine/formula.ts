/**
 * Deterministic formula arithmetic.
 *
 * Every number the builder displays — totals, q.s. remainder, active matter,
 * functional-group sums, batch quantities, scaling — is computed here. The UI
 * renders; it does not calculate. That keeps the numbers testable and identical
 * wherever they appear (screen, export, ERP row).
 *
 * All arithmetic uses Decimal. Binary floating point cannot represent 0.1
 * exactly, so a formula assembled from decimal percentages can total
 * 99.99999999999999% and fail a naive equality check, or drift by grams at
 * 1000 kg batch scale. Neither is acceptable on a factory floor.
 */
import Decimal from "decimal.js";
import { ONE_HUNDRED, PRECISION, dec } from "./decimal";
import type {
  FormulationLine,
  FormulationVersion,
  MaterialFunction,
} from "../schemas/formulation";

/** Percentages are held to 4 dp; that is finer than any dosing pump. */
const PERCENT_DP = PRECISION.percent;
/** Batch quantities to 4 dp of a kg = 0.1 g, below any factory scale. */
const QUANTITY_DP = PRECISION.quantity;

export { ONE_HUNDRED, dec };

/** Decimal → the exact string the schemas store. */
export function toDecimalString(value: Decimal, dp: number = PERCENT_DP): string {
  return value.toFixed(dp);
}

export interface FormulaTotals {
  /** Sum of every authored percentage, excluding q.s. lines. */
  authoredPercent: Decimal;
  /** What a q.s.-to-100 line must absorb. Negative means the formula overflows. */
  qsRemainder: Decimal;
  /** Authored + resolved q.s. Should be exactly 100 for a valid formula. */
  totalPercent: Decimal;
  /** Sum of (line % × active matter %) — real active content, not raw material. */
  totalActiveMatterPercent: Decimal;
  /** Percentage carried by lines with no declared active matter. */
  unknownActivePercent: Decimal;
}

/**
 * Resolve q.s. lines and total the formula.
 *
 * A raw material at 10% that is 70% active contributes 7% active matter, not
 * 10%. Conflating the two is the classic way to ship an under-active product.
 */
export function computeTotals(lines: FormulationLine[]): FormulaTotals {
  let authored = new Decimal(0);
  for (const line of lines) {
    if (line.isQsToHundred) continue;
    authored = authored.plus(dec(line.percent));
  }

  const qsLines = lines.filter((l) => l.isQsToHundred);
  const qsRemainder = ONE_HUNDRED.minus(authored);

  let active = new Decimal(0);
  let unknownActive = new Decimal(0);
  for (const line of lines) {
    const pct = line.isQsToHundred
      ? // Split the remainder evenly if someone declared several q.s. lines.
        qsLines.length > 0
        ? qsRemainder.dividedBy(qsLines.length)
        : new Decimal(0)
      : dec(line.percent);

    if (line.activeMatterPercent === undefined) {
      unknownActive = unknownActive.plus(pct);
      continue;
    }
    active = active.plus(pct.times(dec(line.activeMatterPercent)).dividedBy(ONE_HUNDRED));
  }

  return {
    authoredPercent: authored,
    qsRemainder,
    totalPercent: qsLines.length > 0 ? authored.plus(qsRemainder) : authored,
    totalActiveMatterPercent: active,
    unknownActivePercent: unknownActive,
  };
}

/** The effective percentage of a line, with q.s. resolved. */
export function resolvedPercent(
  line: FormulationLine,
  lines: FormulationLine[],
): Decimal {
  if (!line.isQsToHundred) return dec(line.percent);
  const totals = computeTotals(lines);
  const qsCount = lines.filter((l) => l.isQsToHundred).length || 1;
  return totals.qsRemainder.dividedBy(qsCount);
}

/** Total percentage contributed by each functional group. */
export function functionalGroupTotals(
  lines: FormulationLine[],
): Map<MaterialFunction, Decimal> {
  const out = new Map<MaterialFunction, Decimal>();
  for (const line of lines) {
    const pct = resolvedPercent(line, lines);
    for (const fn of line.functions) {
      out.set(fn, (out.get(fn) ?? new Decimal(0)).plus(pct));
    }
  }
  return out;
}

/**
 * Active-matter total for one functional group — e.g. "total anionic surfactant
 * active", which is what a specification limit actually refers to.
 */
export function functionalActiveTotal(
  lines: FormulationLine[],
  fn: MaterialFunction,
): Decimal {
  let total = new Decimal(0);
  for (const line of lines) {
    if (!line.functions.includes(fn)) continue;
    const pct = resolvedPercent(line, lines);
    const active = line.activeMatterPercent
      ? dec(line.activeMatterPercent)
      : ONE_HUNDRED; // no declaration means treat the material as fully active
    total = total.plus(pct.times(active).dividedBy(ONE_HUNDRED));
  }
  return total;
}

/**
 * Whether a group total can be trusted.
 *
 * `incomplete` is the honest answer when some member of the group has no
 * declared active matter: the number shown is a lower bound, and presenting it
 * as a fact is how a spec limit gets signed off against a figure that was never
 * measured.
 */
export type CompletenessStatus = "complete" | "incomplete" | "not_available";

export interface FunctionalGroupSummary {
  fn: MaterialFunction;
  /** Sum of the raw-material percentages in this group. */
  rawPercent: string;
  /** Sum of active contributions, counting only lines that declare one. */
  activePercent: string;
  /** Raw percentage carried by lines with no declared active matter. */
  unknownActivePercent: string;
  status: CompletenessStatus;
  lineIds: string[];
}

/**
 * Per-group totals with their completeness stated.
 *
 * Unlike `functionalActiveTotal`, missing active-matter data is NOT assumed to
 * mean 100% — it is reported, and the group is marked `incomplete`.
 */
export function functionalSummary(lines: FormulationLine[]): FunctionalGroupSummary[] {
  const groups = new Map<MaterialFunction, FormulationLine[]>();
  for (const line of lines) {
    for (const fn of line.functions) {
      groups.set(fn, [...(groups.get(fn) ?? []), line]);
    }
  }

  const out: FunctionalGroupSummary[] = [];
  for (const [fn, members] of groups) {
    let raw = new Decimal(0);
    let active = new Decimal(0);
    let unknown = new Decimal(0);
    for (const line of members) {
      const pct = resolvedPercent(line, lines);
      raw = raw.plus(pct);
      if (line.activeMatterPercent === undefined) {
        unknown = unknown.plus(pct);
      } else {
        active = active.plus(pct.times(dec(line.activeMatterPercent)).dividedBy(ONE_HUNDRED));
      }
    }
    out.push({
      fn,
      rawPercent: toDecimalString(raw),
      activePercent: toDecimalString(active),
      unknownActivePercent: toDecimalString(unknown),
      status: unknown.isZero() ? "complete" : "incomplete",
      lineIds: members.map((m) => m.id),
    });
  }
  return out.sort((a, b) => a.fn.localeCompare(b.fn));
}

export interface BatchLine {
  lineId: string;
  displayName: string;
  percent: string;
  /** Quantity for the requested batch, in the batch's unit (kg). */
  quantity: string;
}

/**
 * Scale the formula to a batch size. The quantities are what an operator
 * weighs out, so they are rounded once, here, rather than at each display site.
 */
export function scaleToBatch(
  lines: FormulationLine[],
  batchKg: string | Decimal,
): BatchLine[] {
  const batch = dec(batchKg);
  return lines.map((line) => {
    const pct = resolvedPercent(line, lines);
    return {
      lineId: line.id,
      displayName: line.displayName,
      percent: toDecimalString(pct),
      quantity: toDecimalString(batch.times(pct).dividedBy(ONE_HUNDRED), QUANTITY_DP),
    };
  });
}

// --------------------------------------------------------------- q.s. edits ---

/**
 * Make one line the q.s. line, clearing any other.
 *
 * Two q.s. lines make the split ambiguous, so setting one clears the rest
 * unless `allowMultiple` is passed — an explicit override, never a default.
 */
export function setQsLine(
  lines: FormulationLine[],
  lineId: string,
  on: boolean,
  opts: { allowMultiple?: boolean } = {},
): FormulationLine[] {
  return lines.map((l) => {
    if (l.id === lineId) return { ...l, isQsToHundred: on };
    if (on && !opts.allowMultiple) return { ...l, isQsToHundred: false };
    return l;
  });
}

/**
 * Freeze a q.s. line at whatever it currently resolves to.
 *
 * The stored percentage becomes authored, so later edits to other lines no
 * longer move it — which is the whole point of pinning water for a trial.
 */
export function convertQsToFixed(
  lines: FormulationLine[],
  lineId: string,
): FormulationLine[] {
  const line = lines.find((l) => l.id === lineId);
  if (!line || !line.isQsToHundred) return lines;
  const resolved = resolvedPercent(line, lines);
  // Never persist a negative: an overflowing formula is a validation error, not
  // a negative weight an operator could be asked to weigh out.
  const safe = resolved.isNegative() ? new Decimal(0) : resolved;
  return lines.map((l) =>
    l.id === lineId
      ? { ...l, isQsToHundred: false, percent: toDecimalString(safe) }
      : l,
  );
}

/** Turn a fixed line back into the one that absorbs the remainder. */
export function convertFixedToQs(
  lines: FormulationLine[],
  lineId: string,
): FormulationLine[] {
  return setQsLine(lines, lineId, true);
}

// ------------------------------------------------------------- validation ----

/**
 * Four levels, and the distinction between the top two matters:
 *
 *   info      worth knowing
 *   warning   a chemist should look, but the formula is usable
 *   error     the formula is arithmetically or structurally wrong
 *   blocking  the formula must not leave the builder at all
 *
 * `error` and `blocking` both stop progression; `blocking` additionally means
 * the data is not coherent enough to cost, export or version.
 */
export type ValidationSeverity = "info" | "warning" | "error" | "blocking";

export type ValidationCode =
  | "TOTAL_NOT_100"
  | "QS_OVERFLOW"
  | "QS_ABOVE_100"
  | "MULTIPLE_QS_LINES"
  | "NEGATIVE_PERCENT"
  | "DUPLICATE_MATERIAL"
  | "DUPLICATE_LINE_ID"
  | "INVALID_DECIMAL"
  | "MISSING_MATERIAL"
  | "INVALID_PHASE"
  | "TECHNICAL_MAX_EXCEEDED"
  | "INVALID_BATCH_SIZE"
  | "INVALID_CURRENCY"
  | "NO_PRESERVATIVE"
  | "NO_PH_ADJUSTER"
  | "NO_WATER"
  | "MISSING_INCI"
  | "UNKNOWN_ACTIVE_MATTER"
  | "EMPTY_FORMULA";

export interface ValidationFinding {
  /** Stable within one validation pass, so the UI can key and link to it. */
  id: string;
  severity: ValidationSeverity;
  /** Machine-readable, so tests and the UI agree on what happened. */
  code: ValidationCode;
  message: string;
  /** Which line the finding is about, when it is line-scoped. */
  lineId?: string;
  /** Which field on that line, so the UI can focus the exact cell. */
  field?: string;
  lineIds?: string[];
  suggestedAction?: string;
}

export interface ValidationOptions {
  /**
   * Water-containing products need preservation. Anhydrous ones (a powder, a
   * pure-solvent cleaner) do not, so the caller states which case applies
   * rather than the engine guessing from ingredient names.
   */
  requiresPreservative?: boolean;
  requiresPhAdjuster?: boolean;
  /** Tolerance for the 100% check; formulas are authored to 4 dp. */
  totalTolerance?: string;
  /** Batch size the formula will be scaled to, when it should be checked. */
  batchKg?: string;
  /** Personal-care products carry an INCI declaration; household ones do not. */
  requiresInci?: boolean;
  /** Currency codes considered valid for line prices. */
  allowedCurrencies?: readonly string[];
}

let findingSeq = 0;
function finding(f: Omit<ValidationFinding, "id">): ValidationFinding {
  return { id: `vf-${++findingSeq}`, ...f };
}

/**
 * Deterministic formula validation. Returns findings; it never mutates and
 * never decides status — the caller does that.
 */
export function validateFormula(
  lines: FormulationLine[],
  opts: ValidationOptions = {},
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (lines.length === 0) {
    return [
      finding({
        severity: "error",
        code: "EMPTY_FORMULA",
        message: "The formula has no ingredients.",
        suggestedAction: "Add at least one ingredient line.",
      }),
    ];
  }

  const tolerance = dec(opts.totalTolerance ?? "0.0001");

  // Structural checks first: if the data itself is incoherent, every derived
  // number below it is meaningless, so these are blocking rather than errors.
  const idCounts = new Map<string, number>();
  for (const line of lines) idCounts.set(line.id, (idCounts.get(line.id) ?? 0) + 1);
  for (const [id, n] of idCounts) {
    if (n > 1) {
      findings.push(
        finding({
          severity: "blocking",
          code: "DUPLICATE_LINE_ID",
          message: `Line id "${id}" is used ${n} times; lines must be uniquely identifiable.`,
          lineId: id,
          suggestedAction: "Remove and re-add the duplicated line.",
        }),
      );
    }
  }

  for (const line of lines) {
    if (!/^-?\d+(\.\d+)?$/.test(String(line.percent).trim())) {
      findings.push(
        finding({
          severity: "blocking",
          code: "INVALID_DECIMAL",
          message: `"${line.displayName}" has a percentage that is not a number: ${JSON.stringify(line.percent)}.`,
          lineId: line.id,
          field: "percent",
        }),
      );
    }
    if (!line.displayName.trim()) {
      findings.push(
        finding({
          severity: "error",
          code: "MISSING_MATERIAL",
          message: `Line ${line.lineNumber} has no material.`,
          lineId: line.id,
          field: "displayName",
          suggestedAction: "Pick a material from the library or type a name.",
        }),
      );
    }
    if (!line.phase || !line.phase.trim()) {
      findings.push(
        finding({
          severity: "error",
          code: "INVALID_PHASE",
          message: `"${line.displayName}" is not assigned to a phase.`,
          lineId: line.id,
          field: "phase",
        }),
      );
    }
    if (
      opts.allowedCurrencies &&
      line.currency &&
      !opts.allowedCurrencies.includes(line.currency.toUpperCase())
    ) {
      findings.push(
        finding({
          severity: "error",
          code: "INVALID_CURRENCY",
          message: `"${line.displayName}" is priced in ${line.currency}, which is not a configured currency.`,
          lineId: line.id,
          field: "currency",
        }),
      );
    }
  }

  // Blocking data problems make the arithmetic below untrustworthy.
  if (findings.some((f) => f.severity === "blocking")) return findings;

  const totals = computeTotals(lines);
  const qsLines = lines.filter((l) => l.isQsToHundred);

  for (const line of lines) {
    if (dec(line.percent).isNegative()) {
      findings.push(
        finding({
          severity: "error",
          code: "NEGATIVE_PERCENT",
          message: `"${line.displayName}" has a negative percentage.`,
          lineId: line.id,
          field: "percent",
          lineIds: [line.id],
        }),
      );
    }
    if (line.technicalMaxPercent) {
      const pct = resolvedPercent(line, lines);
      const max = dec(line.technicalMaxPercent);
      if (pct.greaterThan(max)) {
        findings.push(
          finding({
            severity: "warning",
            code: "TECHNICAL_MAX_EXCEEDED",
            message:
              `"${line.displayName}" is at ${toDecimalString(pct, 4)}%, above its recorded ` +
              `technical maximum of ${toDecimalString(max, 4)}%.`,
            lineId: line.id,
            field: "percent",
            lineIds: [line.id],
            suggestedAction: "Reduce the level, or confirm the recorded maximum is out of date.",
          }),
        );
      }
    }
  }

  if (opts.batchKg !== undefined) {
    const batch = dec(opts.batchKg || "0");
    if (!batch.isFinite() || batch.lessThanOrEqualTo(0)) {
      findings.push(
        finding({
          severity: "error",
          code: "INVALID_BATCH_SIZE",
          message: `A batch size of ${opts.batchKg || "0"} kg cannot be weighed out.`,
          field: "basisBatchKg",
          suggestedAction: "Enter a batch size greater than zero.",
        }),
      );
    }
  }

  if (qsLines.length > 1) {
    findings.push(
      finding({
        severity: "warning",
        code: "MULTIPLE_QS_LINES",
        message: `${qsLines.length} ingredients are set to q.s. to 100; the remainder is split evenly between them.`,
        lineIds: qsLines.map((l) => l.id),
        suggestedAction: "Leave one line on q.s. and fix the others at a percentage.",
      }),
    );
  }

  if (qsLines.length > 0 && totals.qsRemainder.isNegative()) {
    findings.push(
      finding({
        severity: "error",
        code: "QS_OVERFLOW",
        message:
          `The other ingredients already total ${toDecimalString(totals.authoredPercent, 2)}%, ` +
          `leaving nothing for "${qsLines[0].displayName}".`,
        lineIds: qsLines.map((l) => l.id),
        lineId: qsLines[0].id,
        suggestedAction: "Reduce the other ingredients below 100% in total.",
      }),
    );
  } else if (qsLines.length > 0 && totals.qsRemainder.greaterThan(ONE_HUNDRED)) {
    // Only reachable if an authored percentage is negative; reported plainly
    // rather than left to surface as a nonsensical q.s. figure.
    findings.push(
      finding({
        severity: "error",
        code: "QS_ABOVE_100",
        message: `The q.s. line would resolve to ${toDecimalString(totals.qsRemainder, 4)}%, which is above 100%.`,
        lineIds: qsLines.map((l) => l.id),
      }),
    );
  } else if (!totals.totalPercent.minus(ONE_HUNDRED).abs().lessThanOrEqualTo(tolerance)) {
    findings.push(
      finding({
        severity: "error",
        code: "TOTAL_NOT_100",
        message: `The formula totals ${toDecimalString(totals.totalPercent, 4)}%, not 100%.`,
        suggestedAction:
          qsLines.length === 0
            ? "Set one ingredient (usually water) to q.s. to 100, or adjust the percentages."
            : "Adjust the authored percentages.",
      }),
    );
  }

  // Same material twice is nearly always an editing mistake, and it silently
  // doubles a dose.
  const seen = new Map<string, string[]>();
  for (const line of lines) {
    const key = (line.materialId ?? line.displayName).trim().toLowerCase();
    seen.set(key, [...(seen.get(key) ?? []), line.id]);
  }
  for (const [key, ids] of seen) {
    if (ids.length > 1) {
      findings.push(
        finding({
          severity: "warning",
          code: "DUPLICATE_MATERIAL",
          message: `"${key}" appears on ${ids.length} lines.`,
          lineIds: ids,
          lineId: ids[0],
          suggestedAction: "Merge the lines, unless the split is deliberate (e.g. two phases).",
        }),
      );
    }
  }

  const hasFn = (fn: MaterialFunction) => lines.some((l) => l.functions.includes(fn));

  if (opts.requiresPreservative && !hasFn("preservative")) {
    findings.push(
      finding({
        severity: "warning",
        code: "NO_PRESERVATIVE",
        message: "A water-containing product with no preservative will support microbial growth.",
      }),
    );
  }
  if (opts.requiresPhAdjuster && !hasFn("ph_adjuster")) {
    findings.push(
      finding({
        severity: "warning",
        code: "NO_PH_ADJUSTER",
        message: "No pH adjuster: the finished pH will not be controllable.",
      }),
    );
  }
  if (opts.requiresPreservative && !hasFn("water")) {
    findings.push(
      finding({
        severity: "info",
        code: "NO_WATER",
        message: "No ingredient is marked as water, though the product is treated as aqueous.",
      }),
    );
  }

  if (opts.requiresInci) {
    for (const line of lines) {
      if (!line.inciName?.trim()) {
        findings.push(
          finding({
            severity: "warning",
            code: "MISSING_INCI",
            message: `"${line.displayName}" has no INCI name, so it cannot appear on the declaration.`,
            lineId: line.id,
            field: "inciName",
            suggestedAction: "Enter the INCI name from the supplier's technical data sheet.",
          }),
        );
      }
    }
  }

  if (totals.unknownActivePercent.greaterThan(0)) {
    findings.push(
      finding({
        severity: "info",
        code: "UNKNOWN_ACTIVE_MATTER",
        message:
          `${toDecimalString(totals.unknownActivePercent, 2)}% of the formula has no declared ` +
          `active matter, so the active total is a lower bound.`,
      }),
    );
  }

  return findings;
}

/** True when nothing blocks the formula from progressing. */
export function isValid(findings: ValidationFinding[]): boolean {
  return !findings.some((f) => f.severity === "error" || f.severity === "blocking");
}

/** Counts for a version's validation snapshot. */
export function summarizeFindings(findings: ValidationFinding[]) {
  return {
    errorCount: findings.filter((f) => f.severity === "error").length,
    warningCount: findings.filter((f) => f.severity === "warning").length,
    blockingCount: findings.filter((f) => f.severity === "blocking").length,
    codes: [...new Set(findings.map((f) => f.code))],
  };
}

// -------------------------------------------------------------- comparison ---

export interface LineDiff {
  kind: "added" | "removed" | "changed" | "unchanged";
  displayName: string;
  before?: string;
  after?: string;
  /** Percentage-point delta, signed. */
  delta?: string;
}

export interface VersionDiff {
  lines: LineDiff[];
  activeMatterBefore: string;
  activeMatterAfter: string;
  activeMatterDelta: string;
}

/**
 * Compare two versions line by line. Deterministic and free of interpretation —
 * an impact narrative is a separate, clearly-labelled estimate.
 */
export function diffVersions(
  before: FormulationVersion,
  after: FormulationVersion,
): VersionDiff {
  const key = (l: FormulationLine) =>
    (l.materialId ?? l.displayName).trim().toLowerCase();

  const beforeMap = new Map(before.lines.map((l) => [key(l), l]));
  const afterMap = new Map(after.lines.map((l) => [key(l), l]));
  const diffs: LineDiff[] = [];

  for (const [k, b] of beforeMap) {
    const a = afterMap.get(k);
    if (!a) {
      diffs.push({
        kind: "removed",
        displayName: b.displayName,
        before: toDecimalString(resolvedPercent(b, before.lines)),
      });
      continue;
    }
    const bp = resolvedPercent(b, before.lines);
    const ap = resolvedPercent(a, after.lines);
    diffs.push(
      bp.equals(ap)
        ? { kind: "unchanged", displayName: a.displayName, before: toDecimalString(bp), after: toDecimalString(ap) }
        : {
            kind: "changed",
            displayName: a.displayName,
            before: toDecimalString(bp),
            after: toDecimalString(ap),
            delta: toDecimalString(ap.minus(bp)),
          },
    );
  }

  for (const [k, a] of afterMap) {
    if (beforeMap.has(k)) continue;
    diffs.push({
      kind: "added",
      displayName: a.displayName,
      after: toDecimalString(resolvedPercent(a, after.lines)),
    });
  }

  const beforeActive = computeTotals(before.lines).totalActiveMatterPercent;
  const afterActive = computeTotals(after.lines).totalActiveMatterPercent;

  return {
    lines: diffs,
    activeMatterBefore: toDecimalString(beforeActive),
    activeMatterAfter: toDecimalString(afterActive),
    activeMatterDelta: toDecimalString(afterActive.minus(beforeActive)),
  };
}
