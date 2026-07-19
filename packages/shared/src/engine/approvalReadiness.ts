/**
 * Approval readiness: the single place that decides whether a formula
 * version may progress toward `pilot_approved` / `production_approved`,
 * combining formula validation, compatibility findings and safety findings.
 *
 * `canTransitionTo` (schemas/status.ts) is the actor/role gate — who is
 * allowed to grant approval. This module is the content gate — whether the
 * formula itself is in a state approval can even be considered for. Both are
 * required; neither substitutes for the other. And nothing here is
 * overridable by AI-generated text: a blocker clears only when a listed
 * source condition (a resolution record, a fixed line, a lower validation
 * severity) actually changes, never because a message says to ignore it.
 */
import type { ValidationFinding } from "./formula";
import type { CompatibilityFinding } from "../schemas/compatibility";
import type { ProductSafetyClassification, SafetyFinding } from "../schemas/safety";
import { HUMAN_REVIEW_CLASSIFICATIONS } from "./safety";
import { canTransitionTo, type Actor, type TransitionResult } from "../schemas/status";
import { HUMAN_ONLY_STATUSES, type FormulaStatus } from "../schemas/formulation";
import type { OptimizationRunStatus } from "../schemas/optimization";
import type { SubstitutionResultStatus } from "../schemas/substitution";

/** Statuses that count as a genuine, usable optimizer result. Anything else
 *  (`infeasible`, `unbounded`, `timeout`, `cancelled`, `error`) means the
 *  solver did not actually produce a formula the draft could honestly have
 *  been built from — a version claiming to have applied such a run is either
 *  stale or forged, and readiness blocks on it either way. */
const VALID_OPTIMIZATION_STATUSES: readonly OptimizationRunStatus[] = ["optimal", "feasible"];

/** Statuses that count as a genuine substitution outcome a candidate could
 *  actually have been applied from. */
const VALID_SUBSTITUTION_STATUSES: readonly SubstitutionResultStatus[] = ["candidates_found"];

export type ApprovalBlockerSource =
  | "validation"
  | "compatibility"
  | "safety"
  | "human_review"
  | "optimization"
  | "substitution";

export interface ApprovalBlocker {
  id: string;
  source: ApprovalBlockerSource;
  message: string;
  lineId?: string;
  code?: string;
}

export interface ApprovalWarning {
  id: string;
  source: ApprovalBlockerSource;
  message: string;
  lineId?: string;
}

export interface ApprovalReadiness {
  ready: boolean;
  blockers: ApprovalBlocker[];
  warnings: ApprovalWarning[];
}

export interface ApprovalReadinessInput {
  validationFindings: ValidationFinding[];
  compatibilityFindings: CompatibilityFinding[];
  safetyFindings: SafetyFinding[];
  productClassification?: ProductSafetyClassification;
  /** Ids of compatibility/safety findings a named human has formally resolved
   *  (a `SafetyResolution` record, or the equivalent for compatibility). A
   *  resolved finding still shows in history but no longer blocks. */
  resolvedFindingIds?: string[];
  /** Set once a named human has acknowledged the mandatory-review
   *  classification itself (distinct from resolving any one finding). */
  humanReviewAcknowledged?: boolean;
  /** Set when `FormulationVersion.appliedOptimizationRunCode` is present —
   *  the caller must look up the ACTUAL persisted `OptimizationRun` by that
   *  code and report its real, stored `result.status` here. This is a
   *  defensive re-check, not a duplicate of the solver: a version cannot
   *  claim to have applied an optimization result whose stored record
   *  disagrees (or does not exist — pass `status: undefined` in that case). */
  appliedOptimizationRun?: { code: string; status: OptimizationRunStatus | undefined };
  /** Same defensive re-check for `FormulationVersion.appliedSubstitutionRunCode`.
   *  `selectedCandidateId`/`selectedCandidateBlocked` are read from the same
   *  persisted `SubstitutionRun` — `undefined` status means no such run
   *  exists; a `status` present but no `selectedCandidateId` means the run
   *  produced candidates but nothing was ever actually chosen (a browsed,
   *  not applied, result); `selectedCandidateBlocked: true` means the
   *  candidate that WAS selected itself carries a blocking compatibility or
   *  safety finding — none of these three are a usable "applied" outcome. */
  appliedSubstitutionRun?: {
    code: string;
    status: SubstitutionResultStatus | undefined;
    selectedCandidateId?: string;
    selectedCandidateBlocked?: boolean;
  };
}

/**
 * Assess whether a formula version is ready for the approval workflow to
 * even begin. Deterministic: the same inputs always produce the same
 * blockers, in the same order, so this can be re-run at any time (on save,
 * before showing an approval dialog, in a test) without surprises.
 */
export function assessApprovalReadiness(input: ApprovalReadinessInput): ApprovalReadiness {
  const resolved = new Set(input.resolvedFindingIds ?? []);
  const blockers: ApprovalBlocker[] = [];
  const warnings: ApprovalWarning[] = [];

  for (const f of input.validationFindings) {
    if (f.severity === "blocking") {
      blockers.push({ id: f.id, source: "validation", message: f.message, lineId: f.lineId, code: f.code });
    } else if (f.severity === "error") {
      // A formula-validation "error" is not the four literally-blocking codes
      // (total ≠ 100, a q.s. gone negative, a production approval attempt by
      // a non-human), but it is still a data-integrity problem an approver
      // should not be able to wave through silently — it blocks readiness
      // too, distinctly labelled so the UI can explain why.
      blockers.push({ id: f.id, source: "validation", message: f.message, lineId: f.lineId, code: f.code });
    } else if (f.severity === "warning") {
      warnings.push({ id: f.id, source: "validation", message: f.message, lineId: f.lineId });
    }
  }

  for (const f of input.compatibilityFindings) {
    if (resolved.has(f.id)) continue;
    if (f.severity === "blocking") {
      blockers.push({ id: f.id, source: "compatibility", message: f.message, lineId: f.lineIds[0] });
    } else if (f.severity === "warning" || f.severity === "error") {
      warnings.push({ id: f.id, source: "compatibility", message: f.message, lineId: f.lineIds[0] });
    }
  }

  for (const f of input.safetyFindings) {
    if (resolved.has(f.id)) continue;
    if (f.severity === "blocking") {
      blockers.push({ id: f.id, source: "safety", message: f.message, lineId: f.affectedLineIds[0] });
    } else if (f.severity === "warning" || f.severity === "error") {
      warnings.push({ id: f.id, source: "safety", message: f.message, lineId: f.affectedLineIds[0] });
    }
  }

  if (
    input.productClassification &&
    HUMAN_REVIEW_CLASSIFICATIONS.includes(input.productClassification) &&
    !input.humanReviewAcknowledged
  ) {
    blockers.push({
      id: `human-review:${input.productClassification}`,
      source: "human_review",
      message: `This product is classified "${input.productClassification.replace(/_/g, " ")}" and requires a named human to review and acknowledge before approval can proceed.`,
    });
  }

  if (input.appliedOptimizationRun) {
    const { code, status } = input.appliedOptimizationRun;
    if (!status || !VALID_OPTIMIZATION_STATUSES.includes(status)) {
      blockers.push({
        id: `optimization-run:${code}`,
        source: "optimization",
        message: status
          ? `This version applied optimization run "${code}", but that run's stored result is "${status}", not a usable optimal/feasible result.`
          : `This version applied optimization run "${code}", but no such run record exists.`,
      });
    }
  }

  if (input.appliedSubstitutionRun) {
    const { code, status, selectedCandidateId, selectedCandidateBlocked } = input.appliedSubstitutionRun;
    if (!status || !VALID_SUBSTITUTION_STATUSES.includes(status)) {
      blockers.push({
        id: `substitution-run:${code}`,
        source: "substitution",
        message: status
          ? `This version applied substitution run "${code}", but that run's stored result is "${status}", not a valid selected candidate.`
          : `This version applied substitution run "${code}", but no such run record exists.`,
      });
    } else if (!selectedCandidateId) {
      blockers.push({
        id: `substitution-run:${code}:no-selection`,
        source: "substitution",
        message: `This version applied substitution run "${code}", but that run has no selected candidate recorded — candidates were browsed, not applied.`,
      });
    } else if (selectedCandidateBlocked) {
      blockers.push({
        id: `substitution-run:${code}:blocked-selection`,
        source: "substitution",
        message: `This version applied substitution run "${code}", but its selected candidate carries a blocking compatibility or safety finding.`,
      });
    }
  }

  return { ready: blockers.length === 0, blockers, warnings };
}

/**
 * The single call site everything else should go through to attempt an
 * approval transition: actor/role authority (`canTransitionTo`) AND content
 * readiness, together. Reaching this function through the UI, a domain
 * service call, an import, a restore, a clone or an agent event makes no
 * difference — every one of those paths is expected to call this, and a
 * caller that skips it and calls `canTransitionTo` directly still cannot
 * grant `pilot_approved`/`production_approved` without a human actor and an
 * approval record, but WOULD miss the content check, so this wrapper is the
 * one to use whenever readiness has been computed.
 */
export function canTransitionWithReadiness(
  from: FormulaStatus,
  to: FormulaStatus,
  actor: Actor,
  readiness: ApprovalReadiness,
  opts: { hasApprovalRecord?: boolean } = {},
): TransitionResult {
  const base = canTransitionTo(from, to, actor, opts);
  if (!base.allowed) return base;
  if (HUMAN_ONLY_STATUSES.includes(to) && !readiness.ready) {
    return {
      allowed: false,
      code: "NOT_READY_FOR_APPROVAL",
      message: `"${to}" cannot be granted: ${readiness.blockers.length} blocking finding(s) must be resolved first — ${readiness.blockers
        .slice(0, 3)
        .map((b) => b.message)
        .join(" ")}`,
    };
  }
  return base;
}
