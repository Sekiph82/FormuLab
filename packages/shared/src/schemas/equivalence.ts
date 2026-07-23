/**
 * Formula-version equivalence: an authorized human declaring that a
 * laboratory trial or stability study run against one formula version may
 * also satisfy approval-readiness evidence requirements for a *different*
 * version — spec closure for `engine/approvalDerivation.ts`'s
 * `equivalentVersionIds` parameter, which existed with no UI to populate it.
 *
 * Nothing here assumes equivalence automatically. Every declaration is a
 * deliberate, justified, human, auditable act — see `engine/equivalence.ts`.
 */
import { z } from "zod";

export const EVIDENCE_REUSE_SCOPES = ["laboratory_only", "stability_only", "laboratory_and_stability"] as const;
export type EvidenceReuseScope = (typeof EVIDENCE_REUSE_SCOPES)[number];

/**
 * Append-only by construction (spec: "store an immutable equivalence
 * record... allow revocation without deleting history"). A revocation is
 * itself a new record with `revokesEquivalenceId` set — the original
 * declaration is never edited or deleted. "Is this equivalence currently
 * active" is computed by checking whether any revocation record targets
 * it, the same overlay convention `engine/lifecycle.ts`'s
 * `effectiveStatus` already uses for audit events over `version.status`.
 */
export const formulaVersionEquivalenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  formulationId: z.string().min(1),
  /** The version being approved — evidence tied to `equivalentVersionId`
   *  may count toward its readiness. */
  sourceVersionId: z.string().min(1),
  /** The version whose laboratory/stability evidence may be reused. */
  equivalentVersionId: z.string().min(1),
  evidenceReuseScope: z.enum(EVIDENCE_REUSE_SCOPES),
  justification: z.string().min(1),
  declaredBy: z.string().min(1),
  declaredByRole: z.string().optional(),
  declaredAt: z.string(),
  /** Set only on a revocation record. */
  revokesEquivalenceId: z.string().optional(),
  revocationReason: z.string().optional(),
});
export type FormulaVersionEquivalence = z.infer<typeof formulaVersionEquivalenceSchema>;

/** Every declaration for `sourceVersionId` that no revocation record
 *  targets — the "currently active" view, computed live, never stored. */
export function activeEquivalencesFor(sourceVersionId: string, all: FormulaVersionEquivalence[]): FormulaVersionEquivalence[] {
  const revokedIds = new Set(all.filter((e) => e.revokesEquivalenceId).map((e) => e.revokesEquivalenceId));
  return all.filter((e) => e.sourceVersionId === sourceVersionId && !e.revokesEquivalenceId && !revokedIds.has(e.id));
}

export function isEquivalenceRevoked(equivalenceId: string, all: FormulaVersionEquivalence[]): boolean {
  return all.some((e) => e.revokesEquivalenceId === equivalenceId);
}

/** The equivalent version ids active for a given scope — what a caller
 *  passes as `deriveLabReadiness`/`deriveStabilityReadiness`'s
 *  `equivalentVersionIds`. */
export function equivalentVersionIdsFor(
  sourceVersionId: string,
  scope: "laboratory" | "stability",
  all: FormulaVersionEquivalence[],
): string[] {
  const matchesScope = (s: EvidenceReuseScope) =>
    s === "laboratory_and_stability" || (scope === "laboratory" ? s === "laboratory_only" : s === "stability_only");
  return activeEquivalencesFor(sourceVersionId, all)
    .filter((e) => matchesScope(e.evidenceReuseScope))
    .map((e) => e.equivalentVersionId);
}
