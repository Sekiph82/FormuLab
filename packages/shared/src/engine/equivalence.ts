/**
 * Declaring and revoking formula-version equivalence — both human-only,
 * both justified, both auditable. See docs/APPROVAL_WORKFLOW.md.
 */
import { newId } from "./versioning";
import type { Actor } from "../schemas/status";
import type { EvidenceReuseScope, FormulaVersionEquivalence } from "../schemas/equivalence";

export interface DeclareEquivalenceInput {
  formulationId: string;
  sourceVersionId: string;
  equivalentVersionId: string;
  evidenceReuseScope: EvidenceReuseScope;
  justification: string;
}

/** An authorized human, and only a human, may declare two formula versions
 *  equivalent for evidence-reuse purposes — never inferred, never granted
 *  by an agent/system/import actor. */
export function declareEquivalence(input: DeclareEquivalenceInput, actor: Actor): FormulaVersionEquivalence {
  if (actor.kind !== "human") {
    throw new Error("Only a human may declare two formula versions equivalent.");
  }
  if (input.sourceVersionId === input.equivalentVersionId) {
    throw new Error("A version cannot be declared equivalent to itself.");
  }
  const justification = input.justification.trim();
  if (!justification) {
    throw new Error("Declaring an equivalence requires a stated justification.");
  }
  return {
    schemaVersion: "1.0",
    id: newId("equivalence"),
    formulationId: input.formulationId,
    sourceVersionId: input.sourceVersionId,
    equivalentVersionId: input.equivalentVersionId,
    evidenceReuseScope: input.evidenceReuseScope,
    justification,
    declaredBy: actor.userId,
    declaredByRole: actor.role,
    declaredAt: new Date().toISOString(),
  };
}

/** Revocation is itself a new, immutable record — the original declaration
 *  is never edited or deleted, so "why was this evidence ever accepted"
 *  stays answerable after the fact. */
export function revokeEquivalence(equivalence: FormulaVersionEquivalence, actor: Actor, reason: string): FormulaVersionEquivalence {
  if (actor.kind !== "human") {
    throw new Error("Only a human may revoke a formula-version equivalence.");
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new Error("Revoking an equivalence requires a stated reason.");
  }
  if (equivalence.revokesEquivalenceId) {
    throw new Error("A revocation record cannot itself be revoked.");
  }
  return {
    schemaVersion: "1.0",
    id: newId("equivalence"),
    formulationId: equivalence.formulationId,
    sourceVersionId: equivalence.sourceVersionId,
    equivalentVersionId: equivalence.equivalentVersionId,
    evidenceReuseScope: equivalence.evidenceReuseScope,
    justification: equivalence.justification,
    declaredBy: actor.userId,
    declaredByRole: actor.role,
    declaredAt: new Date().toISOString(),
    revokesEquivalenceId: equivalence.id,
    revocationReason: trimmedReason,
  };
}
