/**
 * Phase 8 — pure, deterministic assembly of a frozen dossier export
 * snapshot from already-loaded dossier-domain records. Turns the exact
 * inputs a Session 3 PDF/DOCX renderer needs into one self-contained
 * object — the renderer never queries live/mutable records itself.
 *
 * This module never persists anything, never calls `Date.now()`/
 * `new Date()`/`crypto.randomUUID()`, and never mutates a caller-supplied
 * array or record. It reuses `regulatoryDossier.ts`'s own pure
 * satisfaction/readiness/supersession functions rather than
 * reimplementing any of that logic — see the imports below.
 *
 * Integrity boundaries this module holds structurally, not by
 * convention: it cannot recompute or infer a human approval, cannot
 * promote a draft dossier, cannot treat a discovered evidence suggestion
 * (`dossierRecordDiscovery.ts`) as an accepted link, cannot convert a
 * submission tracking log into an authority approval, and cannot create
 * new evidence/reviews/requirements/links — every array in the output is
 * a filtered, reordered VIEW of exactly what the caller supplied.
 */
import {
  DOSSIER_STATUSES,
  type DossierReadiness,
  type DossierRequirementDrift,
  type DossierRequirementRow,
  type DossierApprovalSnapshot,
  type DossierStatus,
  type RegulatoryDossier,
  type RegulatoryDossierEvidenceItem,
  type RegulatoryDossierManualRequirementAction,
  type RegulatoryDossierRequirement,
  type RegulatoryDossierReview,
  type RegulatoryDossierReviewRevocation,
  type RegulatoryDossierSubmission,
  type RegulatoryRequirementEvidenceLink,
} from "../schemas/dossier";
import type { RegulatoryRule } from "../schemas/regulatory";
import type { FormulaStatus } from "../schemas/formulation";
import {
  buildEvidenceMatrix,
  calculateDossierReadiness,
  compareDossierRequirementsToCurrentRules,
  currentRequirementsForRevision,
  deriveEvidenceStatus,
  isDossierReviewActive,
  resolveEvidenceRevisionChain,
} from "./regulatoryDossier";
import {
  documentSourceReferenceSchema,
  dossierExportSnapshotMetaSchema,
  type DocumentSourceReference,
  type DossierExportSnapshotMeta,
} from "../schemas/documentExport";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface DossierExportSnapshotInput {
  dossier: RegulatoryDossier;
  /** Must equal `dossier.revision` — an explicit guard against assembling
   *  against a stale reference, not just trusting the object passed in. */
  dossierRevision: number;
  requirements: RegulatoryDossierRequirement[];
  evidenceItems: RegulatoryDossierEvidenceItem[];
  links: RegulatoryRequirementEvidenceLink[];
  reviews: RegulatoryDossierReview[];
  reviewRevocations: RegulatoryDossierReviewRevocation[];
  submissions: RegulatoryDossierSubmission[];
  manualRequirementActions: RegulatoryDossierManualRequirementAction[];
  /** The underlying formula's approval status at generation time. This
   *  engine never loads Formulation/FormulationVersion records itself
   *  (out of this session's scope) — the caller supplies this read-only
   *  value verbatim; it is never derived, inferred, or defaulted here. */
  formulaApprovalStatusAtGeneration?: FormulaStatus;
  /** Already computed elsewhere (e.g. `deriveDossierApprovalReadiness`) —
   *  passed through unchanged. This engine must never recompute or infer
   *  an approval snapshot itself. */
  approvalSnapshot?: DossierApprovalSnapshot;
  /** The currently active rule set, when available, to compute requirement
   *  drift against (`compareDossierRequirementsToCurrentRules`). Omit to
   *  skip drift entirely — never fabricated when the caller has none. */
  currentRules?: RegulatoryRule[];
  /** Explicit, caller-supplied — never generated inside this function. */
  generationTimestamp: string;
  generatedBy: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DossierExportSnapshot {
  meta: DossierExportSnapshotMeta;
  source: DocumentSourceReference;
  dossierCode: string;
  dossierTitle: string;
  /** The dossier row's own recorded status — never derived against a
   *  wider "all dossiers" set (this snapshot's input is scoped to one
   *  dossier only, so supersession-by-a-later-dossier cannot be checked
   *  here; that is `deriveDossierStatus`'s job at the caller's layer). */
  dossierStatus: DossierStatus;
  requirements: RegulatoryDossierRequirement[];
  evidenceMatrix: DossierRequirementRow[];
  /** Every evidence item relevant to an included requirement link, plus
   *  its full supersession ancestry (so the chain stays visible even
   *  when an ancestor itself is no longer directly linked). Each item's
   *  `status` is the DERIVED effective status
   *  (`deriveEvidenceStatus`) — never the possibly-stale stored value —
   *  so a superseded item is never silently presented as current. */
  evidenceItems: RegulatoryDossierEvidenceItem[];
  /** Every link scoped to an included requirement, every status
   *  (proposed/accepted/rejected/revoked) — full transparency. Only
   *  `accepted` links count toward `evidenceMatrix`/`readiness`, reusing
   *  the exact same rule `buildEvidenceMatrix` already applies. */
  links: RegulatoryRequirementEvidenceLink[];
  /** Reviews for this exact revision only — each one's own frozen
   *  `requirementSnapshot`/`evidenceSnapshot` preserved exactly as
   *  recorded, never recomputed. */
  reviews: RegulatoryDossierReview[];
  reviewRevocations: RegulatoryDossierReviewRevocation[];
  /** Internal tracking log only — never treated as an authority approval. */
  submissions: RegulatoryDossierSubmission[];
  manualRequirementActions: RegulatoryDossierManualRequirementAction[];
  readiness: DossierReadiness;
  /** Present only when `currentRules` was supplied. */
  drift?: DossierRequirementDrift;
  /** Passed through unchanged from input — never computed here. */
  approvalSnapshot?: DossierApprovalSnapshot;
  warnings: string[];
  assumptions: string[];
  generationTimestamp: string;
  generatedBy: string;
}

// ---------------------------------------------------------------------------
// Deterministic ordering — always copies before sorting; every comparator
// ends in an `id` tie-breaker so ordering never depends on input order.
// ---------------------------------------------------------------------------

function stableSortBy<T>(items: readonly T[], ...keyFns: Array<(item: T) => string | number>): T[] {
  return [...items].sort((a, b) => {
    for (const keyFn of keyFns) {
      const ka = keyFn(a);
      const kb = keyFn(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Validation — plain thrown Error, matching this codebase's existing
// dossier-engine convention (regulatoryDossier.ts has no separate
// Result<T,E> type; every invalid-input case throws a descriptive Error).
// ---------------------------------------------------------------------------

function assertSameDossier<T extends { dossierId: string }>(records: readonly T[], dossierId: string, label: string): void {
  for (const r of records) {
    if (r.dossierId !== dossierId) {
      throw new Error(`assembleDossierExportSnapshot: a ${label} record references dossier "${r.dossierId}", not the requested dossier "${dossierId}".`);
    }
  }
}

function assertNoDuplicateIds<T extends { id: string }>(records: readonly T[], label: string): void {
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.id)) throw new Error(`assembleDossierExportSnapshot: duplicate ${label} id "${r.id}".`);
    seen.add(r.id);
  }
}

function assertValidTimestamp(value: string, label: string): void {
  if (!value || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw new Error(`assembleDossierExportSnapshot: ${label} must be a non-empty, parseable timestamp.`);
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Assembles one frozen, self-contained dossier export snapshot. Pure: no
 * I/O, no persistence, no mutation of any input. Given identical input,
 * the result is deeply identical.
 */
export function assembleDossierExportSnapshot(input: DossierExportSnapshotInput): DossierExportSnapshot {
  const { dossier } = input;

  assertValidTimestamp(input.generationTimestamp, "generationTimestamp");
  if (!input.generatedBy?.trim()) throw new Error("assembleDossierExportSnapshot: generatedBy is required.");
  if (input.dossierRevision !== dossier.revision) {
    throw new Error(`assembleDossierExportSnapshot: requested revision ${input.dossierRevision} does not match dossier "${dossier.dossierCode}"'s actual revision ${dossier.revision}.`);
  }
  if (!(DOSSIER_STATUSES as readonly string[]).includes(dossier.status)) {
    throw new Error(`assembleDossierExportSnapshot: dossier "${dossier.dossierCode}" has an unrecognized status "${dossier.status}".`);
  }
  if (!dossier.formulaVersionId?.trim()) {
    throw new Error(`assembleDossierExportSnapshot: dossier "${dossier.dossierCode}" has no formulaVersionId — missing required source-version traceability.`);
  }
  const dossierRevision = input.dossierRevision;

  assertSameDossier(input.requirements, dossier.id, "requirement");
  assertSameDossier(input.evidenceItems, dossier.id, "evidence item");
  assertSameDossier(input.links, dossier.id, "requirement-evidence link");
  assertSameDossier(input.reviews, dossier.id, "review");
  assertSameDossier(input.submissions, dossier.id, "submission");
  assertSameDossier(input.manualRequirementActions, dossier.id, "manual requirement action");

  // --- Requirements for this exact revision, deterministically ordered. ---
  const requirementsForRevisionRaw = currentRequirementsForRevision(input.requirements, dossier.id, dossierRevision);
  assertNoDuplicateIds(requirementsForRevisionRaw, "requirement");
  const requirements = stableSortBy(requirementsForRevisionRaw, (r) => r.requirementCode, (r) => r.id);
  const requirementIds = new Set(requirements.map((r) => r.id));

  // --- Links scoped to those requirements, deterministically ordered. ---
  const linksForRequirements = input.links.filter((l) => requirementIds.has(l.requirementId));
  const links = stableSortBy(linksForRequirements, (l) => l.requirementId, (l) => l.evidenceItemId, (l) => l.linkedAt, (l) => l.id);

  // --- Evidence matrix + readiness, reusing the existing pure engine. ---
  const evidenceMatrix = buildEvidenceMatrix(requirements, links, input.evidenceItems, dossier.formulaVersionId, dossier.packagingSkuCode);
  const readiness = calculateDossierReadiness(dossier, evidenceMatrix);

  // --- Evidence items relevant to the included links, plus their full
  //     supersession ancestry, with DERIVED (never stale) status. ---
  const byId = new Map(input.evidenceItems.map((e) => [e.id, e]));
  const relevantIds = new Set<string>();
  for (const link of links) {
    const item = byId.get(link.evidenceItemId);
    if (!item) continue; // a dangling reference stays missing, never synthesized
    for (const chainItem of resolveEvidenceRevisionChain(item, input.evidenceItems)) {
      relevantIds.add(chainItem.id);
    }
  }
  const relevantEvidenceItemsRaw = input.evidenceItems
    .filter((e) => relevantIds.has(e.id))
    .map((e) => ({ ...e, status: deriveEvidenceStatus(e, input.evidenceItems) }));
  const evidenceItems = stableSortBy(relevantEvidenceItemsRaw, (e) => e.evidenceType, (e) => e.title, (e) => e.id);

  // --- Reviews for this exact revision only (a review for a different
  //     revision of the SAME dossier is normal historical data, silently
  //     excluded here, not an error). ---
  const allReviewIds = new Set(input.reviews.map((r) => r.id));
  for (const revocation of input.reviewRevocations) {
    if (!allReviewIds.has(revocation.revokesReviewId)) {
      throw new Error(`assembleDossierExportSnapshot: review revocation "${revocation.id}" references unknown review "${revocation.revokesReviewId}".`);
    }
  }
  const reviewsForRevisionRaw = input.reviews.filter((r) => r.dossierRevision === dossierRevision);
  const reviews = stableSortBy(reviewsForRevisionRaw, (r) => r.reviewedAt, (r) => r.id);
  const reviewIdsInScope = new Set(reviews.map((r) => r.id));
  const reviewRevocations = stableSortBy(
    input.reviewRevocations.filter((rv) => reviewIdsInScope.has(rv.revokesReviewId)),
    (rv) => rv.revokedAt,
    (rv) => rv.id,
  );

  const submissions = stableSortBy(
    input.submissions.filter((s) => s.dossierRevision === dossierRevision),
    (s) => s.submittedAt,
    (s) => s.id,
  );
  const manualRequirementActions = stableSortBy(
    input.manualRequirementActions.filter((a) => a.dossierRevision === dossierRevision),
    (a) => a.performedAt,
    (a) => a.id,
  );

  // --- Requirement drift (optional — only when a current rule set was
  //     supplied). ---
  let drift: DossierRequirementDrift | undefined;
  if (input.currentRules) {
    drift = compareDossierRequirementsToCurrentRules(requirements, {
      jurisdictions: dossier.jurisdictions,
      productFamilyCode: dossier.productFamilyCode,
      rules: input.currentRules,
      findings: [],
    });
  }

  // --- The most recent active (non-revoked) review for this revision,
  //     reusing `isDossierReviewActive` rather than reimplementing it. ---
  const activeReviews = stableSortBy(
    reviews.filter((r) => isDossierReviewActive(r, reviewRevocations, dossierRevision)),
    (r) => r.reviewedAt,
    (r) => r.id,
  );
  const sourceReviewId = activeReviews.length > 0 ? activeReviews[activeReviews.length - 1]!.id : undefined;

  const meta: DossierExportSnapshotMeta = dossierExportSnapshotMetaSchema.parse({
    schemaVersion: "1.0",
    dossierId: dossier.id,
    dossierRevision,
    jurisdictions: dossier.jurisdictions,
    packagingSkuCode: dossier.packagingSkuCode,
    readinessState: readiness.overallReadiness,
    sourceReviewId,
  });

  // `jurisdiction` (singular) is left unset — a dossier is genuinely
  // multi-jurisdiction; `meta.jurisdictions` (plural) is the authoritative
  // list, and fabricating a single "primary" one here would be a guess.
  const source: DocumentSourceReference = documentSourceReferenceSchema.parse({
    sourceEntityType: "regulatory_dossier",
    sourceRecordId: dossier.id,
    sourceCode: dossier.dossierCode,
    formulaVersionId: dossier.formulaVersionId,
    dossierRevision,
    packagingSkuCode: dossier.packagingSkuCode,
    approvalStatusAtGeneration: input.formulaApprovalStatusAtGeneration,
  });

  const warnings: string[] = [...readiness.warnings];
  for (const row of evidenceMatrix) {
    if (row.blockingReason) warnings.push(`${row.requirement.requirementCode}: ${row.blockingReason}`);
  }
  if (drift) {
    if (drift.newRequirementCodes.length > 0) warnings.push(`requirement_drift_new: ${drift.newRequirementCodes.join(", ")}`);
    if (drift.removedRequirementCodes.length > 0) warnings.push(`requirement_drift_removed: ${drift.removedRequirementCodes.join(", ")}`);
    if (drift.changedRuleVersionCodes.length > 0) warnings.push(`requirement_drift_rule_version_changed: ${drift.changedRuleVersionCodes.join(", ")}`);
    if (drift.changedMandatoryStatusCodes.length > 0) warnings.push(`requirement_drift_mandatory_status_changed: ${drift.changedMandatoryStatusCodes.join(", ")}`);
  }
  warnings.sort();

  const assumptions: string[] = [
    "This snapshot reflects only accepted, non-revoked evidence links and their evidence — a discovered-but-not-accepted suggestion is never presented as linked evidence.",
    "This snapshot is descriptive only: it does not grant, imply, or record approval, verification, or regulatory submission of any kind.",
    "Superseded evidence items are included for traceability but are never treated as current; each item's status reflects its derived effective state, not necessarily its stored value.",
  ];
  if (!input.currentRules) {
    assumptions.push("Requirement drift against the currently active rule set was not computed — no current rule set was supplied to assembly.");
  }
  if (!input.approvalSnapshot) {
    assumptions.push("No approval snapshot was supplied — approval-readiness context is limited to this snapshot's own computed dossier readiness.");
  }

  return {
    meta,
    source,
    dossierCode: dossier.dossierCode,
    dossierTitle: dossier.title,
    dossierStatus: dossier.status,
    requirements,
    evidenceMatrix,
    evidenceItems,
    links,
    reviews,
    reviewRevocations,
    submissions,
    manualRequirementActions,
    readiness,
    drift,
    approvalSnapshot: input.approvalSnapshot,
    warnings,
    assumptions,
    generationTimestamp: input.generationTimestamp,
    generatedBy: input.generatedBy,
  };
}
