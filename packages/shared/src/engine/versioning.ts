/**
 * Working drafts and immutable versions.
 *
 * The rule the module exists to enforce: a saved version is never edited. When
 * a chemist changes a saved formula, they are editing a DRAFT derived from it,
 * and saving produces a new version that records its parent. That is what makes
 * "which formula did batch 412 come from?" answerable a year later.
 *
 * Autosave writes the draft. Only an explicit save — with a change reason —
 * produces a version, so a morning of editing leaves one draft rather than four
 * hundred versions nobody can navigate.
 */
import Decimal from "decimal.js";
import {
  computeTotals,
  resolvedPercent,
  summarizeFindings,
  toDecimalString,
  validateFormula,
  type ValidationOptions,
} from "./formula";
import type {
  Formulation,
  FormulationDraft,
  FormulationLine,
  FormulationVersion,
} from "../schemas/formulation";

/** Ids are opaque and stable; time plus randomness is enough for a local app. */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Display label for a version.
 *
 * Pre-release versions count 0.1, 0.2, 0.3…; a version that reaches an approved
 * status is labelled 1.0, 2.0 and so on. The label is cosmetic — `versionNumber`
 * is the ordering key and the storage id is neither.
 */
export function versionLabel(versionNumber: number, approvedRelease = false): string {
  if (approvedRelease) return `${versionNumber}.0`;
  return `0.${versionNumber}`;
}

// ------------------------------------------------------------------ drafts ---

export function draftFromVersion(
  version: FormulationVersion,
): FormulationDraft {
  return {
    schemaVersion: "1.0",
    formulationId: version.formulationId,
    baseVersionId: version.id,
    // Cloned, not referenced: mutating the draft must not touch the version.
    lines: version.lines.map((l) => ({ ...l })),
    basisBatchKg: version.basisBatchKg,
    updatedAt: new Date().toISOString(),
    dirty: false,
  };
}

export function emptyDraft(formulationId: string, basisBatchKg = "100"): FormulationDraft {
  return {
    schemaVersion: "1.0",
    formulationId,
    lines: [],
    basisBatchKg,
    updatedAt: new Date().toISOString(),
    dirty: false,
  };
}

/**
 * True when the draft differs from the version it came from.
 *
 * Compared on content rather than by tracking edits, so an edit-and-undo back
 * to the original correctly reports "no changes" instead of leaving the save
 * button armed.
 */
export function draftDiffersFrom(
  draft: FormulationDraft,
  version: FormulationVersion | undefined,
): boolean {
  if (!version) return draft.lines.length > 0;
  if (draft.basisBatchKg !== version.basisBatchKg) return true;
  if (draft.lines.length !== version.lines.length) return true;
  return JSON.stringify(comparable(draft.lines)) !== JSON.stringify(comparable(version.lines));
}

/** Fields that constitute the formula. Ordering and ids are not content. */
function comparable(lines: FormulationLine[]) {
  return lines.map((l) => ({
    phase: l.phase,
    materialCode: l.materialCode ?? null,
    displayName: l.displayName.trim(),
    tradeName: l.tradeName ?? null,
    inciName: l.inciName ?? null,
    supplierCode: l.supplierCode ?? null,
    functions: [...l.functions].sort(),
    percent: new Decimal(l.percent || "0").toString(),
    isQsToHundred: l.isQsToHundred,
    activeMatterPercent: l.activeMatterPercent ?? null,
    unitPrice: l.unitPrice ?? null,
    currency: l.currency ?? null,
    notes: l.notes ?? null,
  }));
}

// ---------------------------------------------------------------- versions ---

export interface CreateVersionInput {
  formulation: Formulation;
  draft: FormulationDraft;
  /** Required. A version without a stated reason is an unauditable version. */
  changeReason: string;
  changeNotes?: string;
  author: string;
  parentVersion?: FormulationVersion;
  branchName?: string;
  nextVersionNumber: number;
  validation?: ValidationOptions;
  sourceRunIds?: string[];
  /** Set when this draft was produced by applying an Advanced Optimizer run
   *  or a substitution run's selected candidate — see
   *  `FormulationVersion.appliedOptimizationRunCode`/
   *  `appliedSubstitutionRunCode` and docs/APPROVAL_READINESS.md. */
  appliedOptimizationRunCode?: string;
  appliedSubstitutionRunCode?: string;
}

/**
 * Build the immutable version record.
 *
 * The status is always a non-approved one. Approval is a separate human act
 * that attaches an ApprovalRecord; nothing on this path can grant it, including
 * a clone of an already-approved parent.
 */
export function createVersion(input: CreateVersionInput): FormulationVersion {
  if (!input.changeReason.trim()) {
    throw new Error("a change reason is required to save a version");
  }

  const lines = input.draft.lines.map((l) => ({ ...l }));
  const totals = computeTotals(lines);
  const findings = validateFormula(lines, {
    ...input.validation,
    batchKg: input.draft.basisBatchKg,
  });
  const summary = summarizeFindings(findings);

  return {
    schemaVersion: "1.0",
    id: newId("version"),
    formulationId: input.formulation.id,
    versionNumber: input.nextVersionNumber,
    versionLabel: versionLabel(input.nextVersionNumber),
    parentVersionId: input.parentVersion?.id ?? input.draft.baseVersionId,
    branchName: input.branchName,
    // Always a draft status. Reaching an approved status is a separate, human,
    // audited step — a child of an approved version does NOT inherit approval.
    status: "concept",
    author: input.author,
    createdAt: new Date().toISOString(),
    changeReason: input.changeReason,
    changeNotes: input.changeNotes,
    lines,
    basisBatchKg: input.draft.basisBatchKg,
    totalsSnapshot: {
      authoredPercent: toDecimalString(totals.authoredPercent),
      qsRemainder: toDecimalString(totals.qsRemainder),
      totalPercent: toDecimalString(totals.totalPercent),
      totalActiveMatterPercent: toDecimalString(totals.totalActiveMatterPercent),
      unknownActivePercent: toDecimalString(totals.unknownActivePercent),
    },
    validationSnapshot: {
      checkedAt: new Date().toISOString(),
      ...summary,
    },
    targetMarketsSnapshot: [...input.formulation.targetMarkets],
    targetClaimsSnapshot: [...(input.formulation.targetClaims ?? [])],
    targetSkuCodesSnapshot: [...input.formulation.targetSkuCodes],
    sourceRunIds: input.sourceRunIds ?? [],
    appliedOptimizationRunCode: input.appliedOptimizationRunCode,
    appliedSubstitutionRunCode: input.appliedSubstitutionRunCode,
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
  };
}

/**
 * Copy a version's formula into a new draft.
 *
 * Used by both "restore an old version" and "start a variant". Neither carries
 * approval across: the returned draft has no approval state at all, and the
 * version it eventually produces starts at `concept`.
 */
export function cloneToDraft(version: FormulationVersion): FormulationDraft {
  return draftFromVersion(version);
}

export function nextVersionNumber(versions: FormulationVersion[]): number {
  return versions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
}

// -------------------------------------------------------------- comparison ---

export type FieldChangeKind =
  | "percent"
  | "quantity"
  | "supplier"
  | "unitPrice"
  | "currency"
  | "functions"
  | "phase"
  | "inciName"
  | "evidenceOrigin"
  | "activeMatter";

export interface FieldChange {
  kind: FieldChangeKind;
  before: string;
  after: string;
}

export interface DetailedLineDiff {
  kind: "added" | "removed" | "changed" | "unchanged";
  displayName: string;
  lineId: string;
  beforePercent?: string;
  afterPercent?: string;
  percentDelta?: string;
  beforeQuantity?: string;
  afterQuantity?: string;
  changes: FieldChange[];
}

export interface VersionComparison {
  beforeVersionId: string;
  afterVersionId: string;
  beforeLabel: string;
  afterLabel: string;
  lines: DetailedLineDiff[];
  added: number;
  removed: number;
  changed: number;
  activeMatterBefore: string;
  activeMatterAfter: string;
  activeMatterDelta: string;
  totalPercentBefore: string;
  totalPercentAfter: string;
  statusBefore: string;
  statusAfter: string;
  batchKgBefore: string;
  batchKgAfter: string;
  claimsAdded: string[];
  claimsRemoved: string[];
  skusAdded: string[];
  skusRemoved: string[];
  /** Unified-diff-style text, for copying into a report. */
  diffText: string;
}

const key = (l: FormulationLine) =>
  (l.materialCode ?? l.materialId ?? l.displayName).trim().toLowerCase();

/**
 * Full field-level comparison of two versions.
 *
 * Purely factual: it reports what changed, never what the change will do. Any
 * statement about performance impact is an estimate and is labelled as one at
 * the point it is produced, not smuggled in here.
 */
export function compareVersions(
  before: FormulationVersion,
  after: FormulationVersion,
): VersionComparison {
  const beforeMap = new Map(before.lines.map((l) => [key(l), l]));
  const afterMap = new Map(after.lines.map((l) => [key(l), l]));
  const batchBefore = new Decimal(before.basisBatchKg || "100");
  const batchAfter = new Decimal(after.basisBatchKg || "100");

  const qty = (pct: Decimal, batch: Decimal) =>
    toDecimalString(batch.times(pct).dividedBy(100), 4);

  const lines: DetailedLineDiff[] = [];

  for (const [k, b] of beforeMap) {
    const a = afterMap.get(k);
    const bp = resolvedPercent(b, before.lines);
    if (!a) {
      lines.push({
        kind: "removed",
        displayName: b.displayName,
        lineId: b.id,
        beforePercent: toDecimalString(bp),
        beforeQuantity: qty(bp, batchBefore),
        changes: [],
      });
      continue;
    }
    const ap = resolvedPercent(a, after.lines);
    const changes: FieldChange[] = [];
    const push = (kind: FieldChangeKind, x?: string, y?: string) => {
      const bx = x ?? "—";
      const by = y ?? "—";
      if (bx !== by) changes.push({ kind, before: bx, after: by });
    };
    if (!bp.equals(ap)) {
      changes.push({
        kind: "percent",
        before: toDecimalString(bp),
        after: toDecimalString(ap),
      });
    }
    push("supplier", b.supplierCode, a.supplierCode);
    push("unitPrice", b.unitPrice, a.unitPrice);
    push("currency", b.currency, a.currency);
    push("phase", b.phase, a.phase);
    push("inciName", b.inciName, a.inciName);
    push("activeMatter", b.activeMatterPercent, a.activeMatterPercent);
    push("evidenceOrigin", b.provenance.origin, a.provenance.origin);
    push("functions", [...b.functions].sort().join(", "), [...a.functions].sort().join(", "));

    const beforeQ = qty(bp, batchBefore);
    const afterQ = qty(ap, batchAfter);
    if (beforeQ !== afterQ) {
      changes.push({ kind: "quantity", before: beforeQ, after: afterQ });
    }

    lines.push({
      kind: changes.length > 0 ? "changed" : "unchanged",
      displayName: a.displayName,
      lineId: a.id,
      beforePercent: toDecimalString(bp),
      afterPercent: toDecimalString(ap),
      percentDelta: bp.equals(ap) ? undefined : toDecimalString(ap.minus(bp)),
      beforeQuantity: beforeQ,
      afterQuantity: afterQ,
      changes,
    });
  }

  for (const [k, a] of afterMap) {
    if (beforeMap.has(k)) continue;
    const ap = resolvedPercent(a, after.lines);
    lines.push({
      kind: "added",
      displayName: a.displayName,
      lineId: a.id,
      afterPercent: toDecimalString(ap),
      afterQuantity: qty(ap, batchAfter),
      changes: [],
    });
  }

  const beforeTotals = computeTotals(before.lines);
  const afterTotals = computeTotals(after.lines);
  const setDiff = (x: string[] = [], y: string[] = []) => y.filter((v) => !x.includes(v));

  return {
    beforeVersionId: before.id,
    afterVersionId: after.id,
    beforeLabel: before.versionLabel ?? versionLabel(before.versionNumber),
    afterLabel: after.versionLabel ?? versionLabel(after.versionNumber),
    lines,
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
    changed: lines.filter((l) => l.kind === "changed").length,
    activeMatterBefore: toDecimalString(beforeTotals.totalActiveMatterPercent),
    activeMatterAfter: toDecimalString(afterTotals.totalActiveMatterPercent),
    activeMatterDelta: toDecimalString(
      afterTotals.totalActiveMatterPercent.minus(beforeTotals.totalActiveMatterPercent),
    ),
    totalPercentBefore: toDecimalString(beforeTotals.totalPercent),
    totalPercentAfter: toDecimalString(afterTotals.totalPercent),
    statusBefore: before.status,
    statusAfter: after.status,
    batchKgBefore: before.basisBatchKg,
    batchKgAfter: after.basisBatchKg,
    claimsAdded: setDiff(before.targetClaimsSnapshot, after.targetClaimsSnapshot),
    claimsRemoved: setDiff(after.targetClaimsSnapshot, before.targetClaimsSnapshot),
    skusAdded: setDiff(before.targetSkuCodesSnapshot, after.targetSkuCodesSnapshot),
    skusRemoved: setDiff(after.targetSkuCodesSnapshot, before.targetSkuCodesSnapshot),
    diffText: renderDiffText(lines),
  };
}

/** Diff-style text, for pasting into a change record or an email. */
export function renderDiffText(lines: DetailedLineDiff[]): string {
  const out: string[] = [];
  const pad = (s: string, n: number) => s.padEnd(n, " ");
  for (const l of lines) {
    if (l.kind === "unchanged") continue;
    if (l.kind === "removed") {
      out.push(`- ${pad(l.displayName, 28)} ${l.beforePercent}%`);
    } else if (l.kind === "added") {
      out.push(`+ ${pad(l.displayName, 28)} ${l.afterPercent}%`);
    } else {
      const pct = l.changes.find((c) => c.kind === "percent");
      if (pct) {
        out.push(`- ${pad(l.displayName, 28)} ${pct.before}%`);
        out.push(`+ ${pad(l.displayName, 28)} ${pct.after}%`);
      }
      for (const c of l.changes) {
        if (c.kind === "percent" || c.kind === "quantity") continue;
        out.push(`~ ${pad(l.displayName, 28)} ${c.kind}: ${c.before} → ${c.after}`);
      }
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
