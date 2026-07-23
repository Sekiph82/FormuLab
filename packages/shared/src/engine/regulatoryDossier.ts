/**
 * Phase 3 — Regulatory Dossier and Evidence Matrix engine. Turns the
 * frozen requirement/evidence/link records (`schemas/dossier.ts`) into
 * the live matrix a reviewer actually reads: which requirements apply,
 * what satisfies them, what's missing/expired/rejected/revoked/stale,
 * and whether the dossier is ready. Deterministic, no I/O — mirrors
 * `engine/regulatoryApproval.ts`'s own "facts in, blockers out" shape.
 *
 * This remains compliance-assistance: nothing here ever asserts legal
 * compliance from an uploaded document or an accepted link alone — only
 * `satisfied_verified` (an authorized human explicitly verified the
 * evidence) ever counts toward readiness for a mandatory requirement.
 */
import { newId } from "./versioning";
import { requireAuthorizedRegulatoryActor, requireHumanActor } from "./regulatoryAuthorization";
import type { Actor } from "../schemas/status";
import {
  DOSSIER_IMMUTABLE_STATUSES,
  type DossierApplicabilityStatus,
  type DossierEvidenceType,
  type DossierReadiness,
  type DossierReadinessState,
  type DossierRequirementDrift,
  type DossierRequirementRow,
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
import type { RegulatoryFinding, RegulatoryJurisdiction, RegulatoryRule } from "../schemas/regulatory";
import { EAC_MEMBER_STATES } from "../schemas/regulatory";

// ---------------------------------------------------------------------------
// Dossier lifecycle.
// ---------------------------------------------------------------------------

export function isDossierImmutable(dossier: Pick<RegulatoryDossier, "status">): boolean {
  return (DOSSIER_IMMUTABLE_STATUSES as readonly DossierStatus[]).includes(dossier.status);
}

/** The dossier's effective status — `"superseded"` whenever a later
 *  dossier's `supersedesDossierId` points back at it, regardless of what
 *  its own stored `status` says (the same "derive, don't trust a stale
 *  stored flag" pattern as `effectiveStatus` for formula versions). */
export function deriveDossierStatus(dossier: RegulatoryDossier, allDossiersInScope: RegulatoryDossier[]): DossierStatus {
  const supersededBy = allDossiersInScope.some((d) => d.supersedesDossierId === dossier.id);
  if (supersededBy) return "superseded";
  return dossier.status;
}

export interface CreateDossierInput {
  dossierCode: string;
  title: string;
  formulationId: string;
  formulaVersionId: string;
  packagingSkuCode?: string;
  jurisdictions: RegulatoryJurisdiction[];
  productFamilyCode: string;
  targetMarkets?: string[];
}

/** A dossier is always bound to a real, saved formula version — never a
 *  working draft, since there is nothing stable yet to freeze a
 *  requirement snapshot against. */
export function createDossier(input: CreateDossierInput, actor: Actor): RegulatoryDossier {
  requireHumanActor(actor, "create a regulatory dossier");
  if (!input.formulaVersionId.trim()) throw new Error("A dossier must be created against a real, saved formula version id.");
  if (input.jurisdictions.length === 0) throw new Error("A dossier must name at least one jurisdiction.");
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id: newId("dossier"),
    dossierCode: input.dossierCode,
    title: input.title,
    formulationId: input.formulationId,
    formulaVersionId: input.formulaVersionId,
    packagingSkuCode: input.packagingSkuCode,
    jurisdictions: input.jurisdictions,
    productFamilyCode: input.productFamilyCode,
    targetMarkets: input.targetMarkets ?? [],
    status: "draft",
    revision: 1,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Advances a dossier's own header status — refuses once the dossier is
 *  immutable (submitted/superseded/archived): from there, only a new
 *  revision (`reviseDossier`) or an append-only review/submission record
 *  may reference it. */
export function updateDossierStatus(dossier: RegulatoryDossier, to: DossierStatus, actor: Actor): RegulatoryDossier {
  requireHumanActor(actor, "change a dossier's status");
  if (isDossierImmutable(dossier)) {
    throw new Error(`Dossier ${dossier.dossierCode} is ${dossier.status} and immutable — create a new revision instead of changing its status.`);
  }
  const now = new Date().toISOString();
  return { ...dossier, status: to, updatedBy: actor.userId, updatedAt: now };
}

/** Creates a new dossier revision superseding the current one — required
 *  whenever the dossier is updated after a formal review (`review_complete`,
 *  `changes_requested`) or whenever requirements must be regenerated
 *  after the current one reached an immutable status. The old row's own
 *  `status` becomes `"superseded"`; it is never edited otherwise or
 *  deleted. */
export function reviseDossier(current: RegulatoryDossier, actor: Actor): { superseded: RegulatoryDossier; revised: RegulatoryDossier } {
  requireHumanActor(actor, "revise a dossier");
  const now = new Date().toISOString();
  const superseded: RegulatoryDossier = { ...current, status: "superseded", updatedBy: actor.userId, updatedAt: now };
  const revised: RegulatoryDossier = {
    ...current,
    id: newId("dossier"),
    status: "draft",
    revision: current.revision + 1,
    supersedesDossierId: current.id,
    submittedBy: undefined,
    submittedAt: undefined,
    reviewedBy: undefined,
    reviewedAt: undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    createdBy: actor.userId,
    createdAt: now,
    updatedBy: undefined,
    updatedAt: now,
  };
  return { superseded, revised };
}

// ---------------------------------------------------------------------------
// Requirement generation.
// ---------------------------------------------------------------------------

export interface DossierRequirementGenerationContext {
  jurisdictions: RegulatoryJurisdiction[];
  productFamilyCode: string;
  rules: RegulatoryRule[];
  findings: RegulatoryFinding[];
}

const RULE_TYPE_TO_REQUIREMENT_TYPE: Record<string, RegulatoryDossierRequirement["requirementType"]> = {
  ingredient_restriction: "ingredient_data",
  ingredient_prohibition: "ingredient_data",
  concentration_limit: "formula_data",
  claim_restriction: "claim_evidence",
  claim_evidence_requirement: "claim_evidence",
  label_requirement: "label_content",
  warning_requirement: "label_content",
  registration_requirement: "registration",
  notification_requirement: "registration",
  testing_requirement: "laboratory_evidence",
  document_requirement: "document",
  packaging_requirement: "packaging_evidence",
  language_requirement: "label_content",
  responsible_party_requirement: "market_specific",
  market_specific_identifier: "market_specific",
};

/**
 * Generates one `RegulatoryDossierRequirement` per applicable rule, for
 * every jurisdiction in scope, including any active `EAC` overlay rule —
 * never inventing a requirement unsupported by a configured rule. Every
 * row records the exact `sourceRuleId`/`sourceRuleVersion` it came from,
 * so a later rule edit can never silently rewrite what this dossier
 * revision already froze (see `compareDossierRequirementsToCurrentRules`).
 * Caller assigns `id`/`dossierId`/`dossierRevision`/`createdAt`.
 */
export function resolveDossierRequirements(
  ctx: DossierRequirementGenerationContext,
): Array<Omit<RegulatoryDossierRequirement, "id" | "dossierId" | "dossierRevision" | "createdAt">> {
  const rows: Array<Omit<RegulatoryDossierRequirement, "id" | "dossierId" | "dossierRevision" | "createdAt">> = [];
  for (const jurisdiction of ctx.jurisdictions) {
    const applicableRules = ctx.rules.filter((r) => {
      if (!r.active || r.status === "deprecated") return false;
      const sameJurisdiction = r.jurisdiction === jurisdiction;
      const eacOverlay = r.jurisdiction === "EAC" && EAC_MEMBER_STATES.includes(jurisdiction);
      if (!sameJurisdiction && !eacOverlay) return false;
      return r.productCategories.length === 0 || true; // category match already narrowed upstream by caller-supplied rule set
    });
    for (const rule of applicableRules) {
      const requirementType = RULE_TYPE_TO_REQUIREMENT_TYPE[rule.ruleType] ?? "other";
      const relatedFinding = ctx.findings.find((f) => f.ruleId === rule.id && f.jurisdiction === jurisdiction);
      const applicabilityStatus: DossierApplicabilityStatus = relatedFinding
        ? relatedFinding.status === "not_applicable"
          ? "not_applicable"
          : relatedFinding.status === "human_review_required"
            ? "human_review_required"
            : relatedFinding.status === "unknown"
              ? "unknown"
              : "applicable"
        : "applicable";
      rows.push({
        schemaVersion: "1.0",
        jurisdiction,
        requirementCode: `${rule.code}:${jurisdiction}`,
        requirementType,
        title: rule.name,
        description: rule.requirement,
        sourceRuleId: rule.id,
        sourceRuleVersion: rule.version,
        sourceAuthority: rule.authority,
        sourceReference: rule.sourceReference,
        isManual: false,
        mandatory: rule.severity === "blocking" || rule.severity === "warning",
        critical: rule.severity === "blocking",
        applicabilityStatus,
        applicabilityReason: relatedFinding
          ? relatedFinding.reason
          : `Rule ${rule.code} (v${rule.version}) applies to ${jurisdiction}; not yet evaluated against this formula's findings.`,
        evidenceRequirement: requirementType !== "formula_data",
        documentTypesAccepted: acceptedEvidenceTypesFor(requirementType),
        minimumEvidenceCount: 1,
        expiryPolicy: undefined,
        status: "active",
      });
    }
  }
  return rows;
}

function acceptedEvidenceTypesFor(requirementType: RegulatoryDossierRequirement["requirementType"]): DossierEvidenceType[] {
  switch (requirementType) {
    case "laboratory_evidence":
      return ["laboratory_report", "microbiological_report", "challenge_test_report"];
    case "stability_evidence":
      return ["stability_report"];
    case "packaging_evidence":
      return ["packaging_compatibility_report"];
    case "claim_evidence":
      return ["claim_substantiation"];
    case "ingredient_data":
      return ["ingredient_declaration", "supplier_declaration", "sds", "coa"];
    case "document":
      return ["sds", "coa", "regulatory_certificate", "registration_certificate"];
    case "registration":
      return ["registration_certificate", "regulatory_certificate"];
    case "certificate":
      return ["regulatory_certificate", "coa"];
    case "artwork":
      return ["artwork", "label_copy"];
    case "label_content":
      return ["label_copy", "artwork"];
    case "external_review":
      return ["external_legal_opinion"];
    default:
      return ["other"];
  }
}

/** Builds a full, ready-to-persist requirement snapshot for a dossier's
 *  current revision — thin wrapper over `resolveDossierRequirements` that
 *  fills in the ids/dossier binding the pure generator can't know. */
export function buildDossierRequirementSnapshot(
  dossier: Pick<RegulatoryDossier, "id" | "revision">,
  ctx: DossierRequirementGenerationContext,
): RegulatoryDossierRequirement[] {
  const now = new Date().toISOString();
  return resolveDossierRequirements(ctx).map((row) => ({
    ...row,
    id: newId("dossierreq"),
    dossierId: dossier.id,
    dossierRevision: dossier.revision,
    createdAt: now,
  }));
}

/** The "current" requirement set for a given (dossierId, dossierRevision):
 *  requirement rows are append-only, so a manual add/exclude appends a
 *  new row rather than mutating one — this groups by `requirementCode`
 *  and keeps only the latest row per code. */
export function currentRequirementsForRevision(all: RegulatoryDossierRequirement[], dossierId: string, dossierRevision: number): RegulatoryDossierRequirement[] {
  const scoped = all.filter((r) => r.dossierId === dossierId && r.dossierRevision === dossierRevision);
  const latestByCode = new Map<string, RegulatoryDossierRequirement>();
  for (const r of scoped) {
    const existing = latestByCode.get(r.requirementCode);
    if (!existing || r.createdAt >= existing.createdAt) latestByCode.set(r.requirementCode, r);
  }
  return [...latestByCode.values()];
}

// ---------------------------------------------------------------------------
// Manual requirement actions — human-authorized only, append-only.
// ---------------------------------------------------------------------------

export function addManualRequirement(
  dossier: Pick<RegulatoryDossier, "id" | "revision">,
  input: Omit<RegulatoryDossierRequirement, "id" | "dossierId" | "dossierRevision" | "createdAt" | "isManual" | "status">,
  actor: Actor,
  justification: string,
): { requirement: RegulatoryDossierRequirement; action: RegulatoryDossierManualRequirementAction } {
  requireAuthorizedRegulatoryActor(actor, "manually add a dossier requirement");
  const trimmed = justification.trim();
  if (!trimmed) throw new Error("A justification is required to manually add a dossier requirement.");
  const now = new Date().toISOString();
  const requirement: RegulatoryDossierRequirement = {
    ...input,
    id: newId("dossierreq"),
    dossierId: dossier.id,
    dossierRevision: dossier.revision,
    isManual: true,
    status: "active",
    createdAt: now,
  };
  const action: RegulatoryDossierManualRequirementAction = {
    schemaVersion: "1.0",
    id: newId("dossierreqaction"),
    dossierId: dossier.id,
    dossierRevision: dossier.revision,
    action: "add",
    requirementId: requirement.id,
    performedBy: actor.userId,
    performedByRole: actor.role,
    performedAt: now,
    justification: trimmed,
  };
  return { requirement, action };
}

/** Excludes an applicable requirement — critical requirements are not
 *  dismissible through a casual checkbox: this always requires an
 *  authorized reviewer and a written justification, and it appends a new
 *  requirement row (`status: "excluded"`) rather than mutating the
 *  original, plus a separate append-only action record. */
export function excludeRequirement(
  requirement: RegulatoryDossierRequirement,
  actor: Actor,
  justification: string,
): { requirement: RegulatoryDossierRequirement; action: RegulatoryDossierManualRequirementAction } {
  requireAuthorizedRegulatoryActor(actor, "exclude a dossier requirement");
  const trimmed = justification.trim();
  if (!trimmed) throw new Error("A justification is required to exclude a dossier requirement.");
  const now = new Date().toISOString();
  const excluded: RegulatoryDossierRequirement = { ...requirement, id: newId("dossierreq"), status: "excluded", createdAt: now };
  const action: RegulatoryDossierManualRequirementAction = {
    schemaVersion: "1.0",
    id: newId("dossierreqaction"),
    dossierId: requirement.dossierId,
    dossierRevision: requirement.dossierRevision,
    action: "exclude",
    requirementId: requirement.id,
    performedBy: actor.userId,
    performedByRole: actor.role,
    performedAt: now,
    justification: trimmed,
  };
  return { requirement: excluded, action };
}

// ---------------------------------------------------------------------------
// Requirement drift — frozen snapshot vs. what current active rules say.
// ---------------------------------------------------------------------------

export function compareDossierRequirementsToCurrentRules(frozen: RegulatoryDossierRequirement[], ctx: DossierRequirementGenerationContext): DossierRequirementDrift {
  const current = resolveDossierRequirements(ctx);
  const frozenByCode = new Map(frozen.filter((r) => !r.isManual).map((r) => [r.requirementCode, r]));
  const currentByCode = new Map(current.map((r) => [r.requirementCode, r]));

  const newRequirementCodes: string[] = [];
  const removedRequirementCodes: string[] = [];
  const changedRuleVersionCodes: string[] = [];
  const changedMandatoryStatusCodes: string[] = [];
  const changedAcceptedEvidenceTypesCodes: string[] = [];
  const changedJurisdictionApplicabilityCodes: string[] = [];

  for (const [code, cur] of currentByCode) {
    const old = frozenByCode.get(code);
    if (!old) {
      newRequirementCodes.push(code);
      continue;
    }
    if (old.sourceRuleVersion !== cur.sourceRuleVersion) changedRuleVersionCodes.push(code);
    if (old.mandatory !== cur.mandatory || old.critical !== cur.critical) changedMandatoryStatusCodes.push(code);
    if (JSON.stringify([...old.documentTypesAccepted].sort()) !== JSON.stringify([...cur.documentTypesAccepted].sort())) changedAcceptedEvidenceTypesCodes.push(code);
    if (old.applicabilityStatus !== cur.applicabilityStatus) changedJurisdictionApplicabilityCodes.push(code);
  }
  for (const code of frozenByCode.keys()) {
    if (!currentByCode.has(code)) removedRequirementCodes.push(code);
  }

  return { newRequirementCodes, removedRequirementCodes, changedRuleVersionCodes, changedMandatoryStatusCodes, changedAcceptedEvidenceTypesCodes, changedJurisdictionApplicabilityCodes };
}

// ---------------------------------------------------------------------------
// Evidence lifecycle.
// ---------------------------------------------------------------------------

export interface AddDraftEvidenceInput {
  dossierId: string;
  formulationId: string;
  formulaVersionId: string;
  packagingSkuCode?: string;
  jurisdictions: RegulatoryJurisdiction[];
  evidenceType: DossierEvidenceType;
  documentType?: string;
  title: string;
  description?: string;
  sourceType?: RegulatoryDossierEvidenceItem["sourceType"];
  sourceEntityId?: string;
  attachmentIds?: RegulatoryDossierEvidenceItem["attachmentIds"];
  documentNumber?: string;
  issuer?: string;
  issuedAt?: string;
  effectiveAt?: string;
  expiresAt?: string;
  language?: string;
}

/** Any human role may upload draft evidence — formal verification is a
 *  separate, authorized-role-only step (`verifyEvidence`). */
export function addDraftEvidence(input: AddDraftEvidenceInput, actor: Actor): RegulatoryDossierEvidenceItem {
  requireHumanActor(actor, "add draft regulatory evidence");
  if (!input.formulaVersionId.trim()) throw new Error("Evidence must be recorded against a real, saved formula version id.");
  if (input.jurisdictions.length === 0) throw new Error("Evidence must name at least one jurisdiction.");
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id: newId("dossierevidence"),
    dossierId: input.dossierId,
    formulationId: input.formulationId,
    formulaVersionId: input.formulaVersionId,
    packagingSkuCode: input.packagingSkuCode,
    jurisdictions: input.jurisdictions,
    evidenceType: input.evidenceType,
    documentType: input.documentType,
    title: input.title,
    description: input.description,
    status: (input.attachmentIds?.length ?? 0) > 0 ? "present_unverified" : "draft",
    sourceType: input.sourceType ?? "uploaded",
    sourceEntityId: input.sourceEntityId,
    attachmentIds: input.attachmentIds ?? [],
    documentNumber: input.documentNumber,
    issuer: input.issuer,
    issuedAt: input.issuedAt,
    effectiveAt: input.effectiveAt,
    expiresAt: input.expiresAt,
    confidentiality: "normal",
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };
}

export function verifyEvidence(current: RegulatoryDossierEvidenceItem, actor: Actor, notes?: string): RegulatoryDossierEvidenceItem {
  requireAuthorizedRegulatoryActor(actor, "verify regulatory evidence");
  if (current.attachmentIds.length === 0) throw new Error("Evidence must have at least one attachment before it can be verified.");
  const now = new Date().toISOString();
  return { ...current, status: "verified", verifiedBy: actor.userId, verifiedByRole: actor.role, verifiedAt: now, verificationNotes: notes, updatedAt: now };
}

export function rejectEvidence(current: RegulatoryDossierEvidenceItem, actor: Actor, reason: string): RegulatoryDossierEvidenceItem {
  requireAuthorizedRegulatoryActor(actor, "reject regulatory evidence");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to reject regulatory evidence.");
  const now = new Date().toISOString();
  return { ...current, status: "rejected", rejectedBy: actor.userId, rejectedAt: now, rejectionReason: trimmed, updatedAt: now };
}

export function revokeEvidence(current: RegulatoryDossierEvidenceItem, actor: Actor, reason: string): RegulatoryDossierEvidenceItem {
  requireAuthorizedRegulatoryActor(actor, "revoke regulatory evidence");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to revoke regulatory evidence.");
  const now = new Date().toISOString();
  return { ...current, status: "revoked", revokedBy: actor.userId, revokedAt: now, revocationReason: trimmed, updatedAt: now };
}

/** Uploading a replacement is preparation work (like the initial upload),
 *  not a formal decision — any human role may do it. The old item is
 *  marked superseded, never deleted, and stays fully openable/visible in
 *  `resolveEvidenceRevisionChain`. */
export function replaceEvidence(
  current: RegulatoryDossierEvidenceItem,
  input: Omit<AddDraftEvidenceInput, "dossierId" | "formulationId" | "formulaVersionId" | "packagingSkuCode" | "jurisdictions">,
  actor: Actor,
): { superseded: RegulatoryDossierEvidenceItem; replacement: RegulatoryDossierEvidenceItem } {
  requireHumanActor(actor, "replace regulatory evidence");
  const now = new Date().toISOString();
  const superseded: RegulatoryDossierEvidenceItem = { ...current, status: "superseded", updatedAt: now };
  const replacement = addDraftEvidence(
    {
      ...input,
      dossierId: current.dossierId,
      formulationId: current.formulationId,
      formulaVersionId: current.formulaVersionId,
      packagingSkuCode: current.packagingSkuCode,
      jurisdictions: current.jurisdictions,
    },
    actor,
  );
  return { superseded, replacement: { ...replacement, supersedesEvidenceId: current.id } };
}

/** The effective status of an evidence item — `"superseded"` whenever a
 *  later item's `supersedesEvidenceId` points back at it, regardless of
 *  its own stored `status`. */
export function deriveEvidenceStatus(evidence: RegulatoryDossierEvidenceItem, allEvidenceInScope: RegulatoryDossierEvidenceItem[]): RegulatoryDossierEvidenceItem["status"] {
  const supersededBy = allEvidenceInScope.some((e) => e.supersedesEvidenceId === evidence.id);
  if (supersededBy) return "superseded";
  return evidence.status;
}

/** Walks the `supersedesEvidenceId` chain from the given item back to its
 *  original upload — every item along the way remains openable; nothing
 *  in this chain is ever deleted. */
export function resolveEvidenceRevisionChain(evidence: RegulatoryDossierEvidenceItem, all: RegulatoryDossierEvidenceItem[]): RegulatoryDossierEvidenceItem[] {
  const chain: RegulatoryDossierEvidenceItem[] = [evidence];
  let cursor = evidence;
  const byId = new Map(all.map((e) => [e.id, e]));
  while (cursor.supersedesEvidenceId) {
    const prior = byId.get(cursor.supersedesEvidenceId);
    if (!prior) break;
    chain.push(prior);
    cursor = prior;
  }
  return chain;
}

export function resolveDossierRevisionChain(dossier: RegulatoryDossier, all: RegulatoryDossier[]): RegulatoryDossier[] {
  const chain: RegulatoryDossier[] = [dossier];
  let cursor = dossier;
  const byId = new Map(all.map((d) => [d.id, d]));
  while (cursor.supersedesDossierId) {
    const prior = byId.get(cursor.supersedesDossierId);
    if (!prior) break;
    chain.push(prior);
    cursor = prior;
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Requirement <-> evidence links.
// ---------------------------------------------------------------------------

export interface ProposeEvidenceLinkInput {
  dossierId: string;
  requirementId: string;
  evidenceItemId: string;
  notes?: string;
}

export function proposeEvidenceLink(input: ProposeEvidenceLinkInput, actor: Actor): RegulatoryRequirementEvidenceLink {
  requireHumanActor(actor, "propose a requirement-evidence link");
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id: newId("dossierlink"),
    dossierId: input.dossierId,
    requirementId: input.requirementId,
    evidenceItemId: input.evidenceItemId,
    linkStatus: "proposed",
    linkedBy: actor.userId,
    linkedAt: now,
    notes: input.notes,
  };
}

/** Accepting a link is the human judgment call spec §4.4 requires
 *  ("a human must accept the mapping") — deliberately not narrowed to
 *  regulatory/quality/administrator the way formal evidence verification
 *  is; any human role may accept, reject, or revoke a proposed mapping.
 *  Accepting a link never itself verifies the evidence it points at. */
export function acceptEvidenceLink(link: RegulatoryRequirementEvidenceLink, actor: Actor, notes?: string): RegulatoryRequirementEvidenceLink {
  requireHumanActor(actor, "accept a requirement-evidence link");
  const now = new Date().toISOString();
  return { ...link, id: newId("dossierlink"), linkStatus: "accepted", reviewedBy: actor.userId, reviewedAt: now, notes: notes ?? link.notes };
}

export function rejectEvidenceLink(link: RegulatoryRequirementEvidenceLink, actor: Actor, reason: string): RegulatoryRequirementEvidenceLink {
  requireHumanActor(actor, "reject a requirement-evidence link");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to reject a requirement-evidence link.");
  const now = new Date().toISOString();
  return { ...link, id: newId("dossierlink"), linkStatus: "rejected", reviewedBy: actor.userId, reviewedAt: now, notes: trimmed };
}

export function revokeEvidenceLink(link: RegulatoryRequirementEvidenceLink, actor: Actor, reason: string): RegulatoryRequirementEvidenceLink {
  requireHumanActor(actor, "revoke a requirement-evidence link");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to revoke a requirement-evidence link.");
  const now = new Date().toISOString();
  return { ...link, id: newId("dossierlink"), linkStatus: "revoked", revokesLinkId: link.id, reviewedBy: actor.userId, reviewedAt: now, notes: trimmed };
}

/** The active (non-revoked) link rows for a dossier — latest row per
 *  (requirementId, evidenceItemId) pair, since links are append-only. */
export function activeLinksForDossier(links: RegulatoryRequirementEvidenceLink[], dossierId: string): RegulatoryRequirementEvidenceLink[] {
  const scoped = links.filter((l) => l.dossierId === dossierId);
  const latestByPair = new Map<string, RegulatoryRequirementEvidenceLink>();
  for (const l of scoped) {
    const key = `${l.requirementId}:${l.evidenceItemId}`;
    const existing = latestByPair.get(key);
    if (!existing || l.linkedAt >= existing.linkedAt) latestByPair.set(key, l);
  }
  return [...latestByPair.values()].filter((l) => l.linkStatus !== "revoked");
}

/**
 * Suggests candidate evidence for each requirement by matching
 * `evidenceType` against `documentTypesAccepted` and the exact version/
 * packaging-SKU/jurisdiction scope — a suggestion only; nothing here
 * creates a link. A human must call `proposeEvidenceLink`/
 * `acceptEvidenceLink` to make a suggestion real.
 */
export function mapEvidenceToRequirements(
  requirements: RegulatoryDossierRequirement[],
  evidenceItems: RegulatoryDossierEvidenceItem[],
  ctx: { formulaVersionId: string; packagingSkuCode?: string },
): Map<string, RegulatoryDossierEvidenceItem[]> {
  const suggestions = new Map<string, RegulatoryDossierEvidenceItem[]>();
  for (const requirement of requirements) {
    const candidates = evidenceItems.filter((e) => {
      if (e.formulaVersionId !== ctx.formulaVersionId) return false;
      if (ctx.packagingSkuCode && e.packagingSkuCode && e.packagingSkuCode !== ctx.packagingSkuCode) return false;
      if (!e.jurisdictions.includes(requirement.jurisdiction)) return false;
      return requirement.documentTypesAccepted.length === 0 || requirement.documentTypesAccepted.includes(e.evidenceType);
    });
    if (candidates.length > 0) suggestions.set(requirement.id, candidates);
  }
  return suggestions;
}

// ---------------------------------------------------------------------------
// Evidence eligibility + requirement satisfaction — the matrix itself.
// ---------------------------------------------------------------------------

export interface EvidenceEligibilityContext {
  formulaVersionId: string;
  packagingSkuCode?: string;
  jurisdiction: RegulatoryJurisdiction;
  asOf?: string;
}

/** Whether one evidence item can EVER count toward a requirement in this
 *  exact scope — wrong version/packaging/jurisdiction, or a non-current
 *  lifecycle status (rejected/expired/revoked/superseded/not_applicable),
 *  disqualifies it outright, before verification is even considered. */
export function evaluateEvidenceEligibility(evidence: RegulatoryDossierEvidenceItem, ctx: EvidenceEligibilityContext): { eligible: boolean; reason?: string } {
  if (evidence.formulaVersionId !== ctx.formulaVersionId) return { eligible: false, reason: "wrong_formula_version" };
  if (ctx.packagingSkuCode && evidence.packagingSkuCode && evidence.packagingSkuCode !== ctx.packagingSkuCode) return { eligible: false, reason: "wrong_packaging_sku" };
  if (!evidence.jurisdictions.includes(ctx.jurisdiction)) return { eligible: false, reason: "wrong_jurisdiction" };
  if (["rejected", "revoked", "superseded"].includes(evidence.status)) return { eligible: false, reason: evidence.status };
  const asOf = ctx.asOf ?? new Date().toISOString();
  if (evidence.expiresAt && asOf > evidence.expiresAt) return { eligible: false, reason: "expired" };
  return { eligible: true };
}

/**
 * The full, honest satisfaction state for one requirement — never
 * collapses "I don't know" or "not yet reviewed" into satisfied. Only
 * `accepted` links pointing at eligible, `verified` evidence (meeting
 * `minimumEvidenceCount`) ever produce `"satisfied_verified"`.
 */
export function evaluateRequirementSatisfaction(
  requirement: RegulatoryDossierRequirement,
  links: RegulatoryRequirementEvidenceLink[],
  evidenceItems: RegulatoryDossierEvidenceItem[],
  ctx: EvidenceEligibilityContext,
): DossierRequirementRow {
  if (requirement.status === "excluded") {
    return { requirement, satisfaction: "not_applicable", linkedEvidence: [] };
  }
  if (requirement.applicabilityStatus === "not_applicable") {
    return { requirement, satisfaction: "not_applicable", linkedEvidence: [] };
  }
  if (requirement.applicabilityStatus === "unknown" || requirement.applicabilityStatus === "human_review_required") {
    return { requirement, satisfaction: "unknown", linkedEvidence: [], blockingReason: "applicability_unknown" };
  }

  const acceptedLinks = links.filter((l) => l.requirementId === requirement.id && l.linkStatus === "accepted");
  const byEvidenceId = new Map(evidenceItems.map((e) => [e.id, e]));
  const linkedEvidence = acceptedLinks.map((l) => byEvidenceId.get(l.evidenceItemId)).filter((e): e is RegulatoryDossierEvidenceItem => !!e);

  if (!requirement.evidenceRequirement) {
    return { requirement, satisfaction: "satisfied_verified", linkedEvidence: [] };
  }
  if (linkedEvidence.length === 0) {
    const satisfaction = requirement.mandatory ? "missing" : "not_started";
    return { requirement, satisfaction, linkedEvidence: [], blockingReason: requirement.mandatory && requirement.critical ? "missing_critical_evidence" : requirement.mandatory ? "missing_mandatory_evidence" : undefined };
  }

  const eligible = linkedEvidence.filter((e) => evaluateEvidenceEligibility(e, ctx).eligible);
  if (eligible.length === 0) {
    const rejected = linkedEvidence.some((e) => e.status === "rejected");
    const revoked = linkedEvidence.some((e) => e.status === "revoked");
    const expired = linkedEvidence.some((e) => e.expiresAt && (ctx.asOf ?? new Date().toISOString()) > e.expiresAt);
    const satisfaction = rejected ? "rejected" : revoked ? "revoked" : expired ? "expired" : "missing";
    return { requirement, satisfaction, linkedEvidence, blockingReason: requirement.mandatory ? `${satisfaction}_evidence` : undefined, lastActivityAt: latestActivity(linkedEvidence) };
  }

  const verified = eligible.filter((e) => e.status === "verified");
  if (verified.length >= requirement.minimumEvidenceCount) {
    return { requirement, satisfaction: "satisfied_verified", linkedEvidence: eligible, lastActivityAt: latestActivity(eligible) };
  }
  if (eligible.length >= requirement.minimumEvidenceCount) {
    return { requirement, satisfaction: "satisfied_unverified", linkedEvidence: eligible, lastActivityAt: latestActivity(eligible) };
  }
  return {
    requirement,
    satisfaction: "partially_satisfied",
    linkedEvidence: eligible,
    blockingReason: requirement.mandatory ? "insufficient_evidence_count" : undefined,
    lastActivityAt: latestActivity(eligible),
  };
}

function latestActivity(items: RegulatoryDossierEvidenceItem[]): string | undefined {
  const sorted = items.map((e) => e.verifiedAt ?? e.updatedAt).sort();
  return sorted[sorted.length - 1];
}

/** Runs `evaluateRequirementSatisfaction` for every current (non-superseded-
 *  by-manual-edit) requirement in a dossier revision, producing the full
 *  evidence matrix. */
export function buildEvidenceMatrix(
  requirements: RegulatoryDossierRequirement[],
  links: RegulatoryRequirementEvidenceLink[],
  evidenceItems: RegulatoryDossierEvidenceItem[],
  formulaVersionId: string,
  packagingSkuCode: string | undefined,
): DossierRequirementRow[] {
  return requirements.map((requirement) =>
    evaluateRequirementSatisfaction(requirement, links, evidenceItems, { formulaVersionId, packagingSkuCode, jurisdiction: requirement.jurisdiction }),
  );
}

/**
 * Aggregates a full evidence matrix into the dossier-level readiness
 * summary. `"unknown"` is contagious — it can never be silently folded
 * into `"ready_for_review"`.
 */
export function calculateDossierReadiness(dossier: Pick<RegulatoryDossier, "id" | "revision" | "status">, matrix: DossierRequirementRow[]): DossierReadiness {
  const applicable = matrix.filter((row) => row.satisfaction !== "not_applicable");
  const mandatory = applicable.filter((row) => row.requirement.mandatory);
  const satisfiedMandatory = mandatory.filter((row) => row.satisfaction === "satisfied_verified");
  const missingMandatory = mandatory.filter((row) => row.satisfaction === "missing" || row.satisfaction === "not_started");
  const expired = applicable.filter((row) => row.satisfaction === "expired").length;
  const rejected = applicable.filter((row) => row.satisfaction === "rejected").length;
  const unverified = applicable.filter((row) => row.satisfaction === "satisfied_unverified" || row.satisfaction === "partially_satisfied").length;
  const stale = 0; // populated by the caller from compareDossierRequirementsToCurrentRules when available
  const humanReviewRequired = matrix.filter((row) => row.satisfaction === "unknown").length;
  const blocking = mandatory.filter((row) => !!row.blockingReason).length;

  const warnings: string[] = [];
  if (unverified > 0) warnings.push("unverified_evidence_present");
  if (expired > 0) warnings.push("expired_evidence_present");

  let overallReadiness: DossierReadinessState;
  if (humanReviewRequired > 0) overallReadiness = "unknown";
  else if (dossier.status === "under_review") overallReadiness = "under_review";
  else if (dossier.status === "review_complete" || dossier.status === "approved_for_submission" || dossier.status === "submitted") overallReadiness = "review_complete";
  else if (blocking > 0 || missingMandatory.length > 0) overallReadiness = missingMandatory.length === mandatory.length && mandatory.length > 0 ? "not_ready" : "partially_ready";
  else if (mandatory.length > 0 && satisfiedMandatory.length === mandatory.length) overallReadiness = "ready_for_review";
  else overallReadiness = "not_ready";

  return {
    dossierId: dossier.id,
    dossierRevision: dossier.revision,
    totalRequirements: matrix.length,
    applicableRequirements: applicable.length,
    mandatoryRequirements: mandatory.length,
    satisfiedMandatoryRequirements: satisfiedMandatory.length,
    missingMandatoryRequirements: missingMandatory.length,
    expiredEvidenceCount: expired,
    rejectedEvidenceCount: rejected,
    unverifiedEvidenceCount: unverified,
    staleRequirementCount: stale,
    humanReviewRequiredCount: humanReviewRequired,
    blockingRequirementCount: blocking,
    warnings,
    overallReadiness,
  };
}

// ---------------------------------------------------------------------------
// Dossier reviews — append-only, bound to an exact revision.
// ---------------------------------------------------------------------------

export interface RecordDossierReviewInput {
  dossierId: string;
  dossierRevision: number;
  outcome: RegulatoryDossierReview["outcome"];
  notes: string;
  requirementSnapshot: RegulatoryDossierRequirement[];
  evidenceSnapshot: RegulatoryDossierEvidenceItem[];
  blockingIssues?: string[];
  warnings?: string[];
}

export function recordDossierReview(input: RecordDossierReviewInput, actor: Actor): RegulatoryDossierReview {
  requireAuthorizedRegulatoryActor(actor, "record a dossier review");
  if (!input.notes.trim()) throw new Error("Dossier review notes are required.");
  return {
    schemaVersion: "1.0",
    id: newId("dossierreview"),
    dossierId: input.dossierId,
    dossierRevision: input.dossierRevision,
    reviewedBy: actor.userId,
    reviewerRole: actor.role,
    reviewedAt: new Date().toISOString(),
    outcome: input.outcome,
    notes: input.notes.trim(),
    requirementSnapshot: input.requirementSnapshot,
    evidenceSnapshot: input.evidenceSnapshot,
    blockingIssues: input.blockingIssues ?? [],
    warnings: input.warnings ?? [],
  };
}

export function revokeDossierReview(reviewId: string, actor: Actor, reason: string): RegulatoryDossierReviewRevocation {
  requireAuthorizedRegulatoryActor(actor, "revoke a dossier review");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to revoke a dossier review.");
  return {
    schemaVersion: "1.0",
    id: newId("dossierreviewrevoke"),
    revokesReviewId: reviewId,
    revokedBy: actor.userId,
    revokedByRole: actor.role,
    revokedAt: new Date().toISOString(),
    reason: trimmed,
  };
}

/** A review is only ever "active" for its exact dossier revision, and
 *  only if it hasn't been revoked — mirrors
 *  `deriveRegulatoryReviewStatus`'s "revoked always wins" rule. */
export function isDossierReviewActive(review: RegulatoryDossierReview, revocations: RegulatoryDossierReviewRevocation[], dossierRevision: number): boolean {
  if (review.dossierRevision !== dossierRevision) return false;
  return !revocations.some((r) => r.revokesReviewId === review.id);
}

// ---------------------------------------------------------------------------
// Submissions — an internal tracking log only.
// ---------------------------------------------------------------------------

export interface RecordDossierSubmissionInput {
  dossierId: string;
  dossierRevision: number;
  jurisdiction: RegulatoryJurisdiction;
  submissionReference?: string;
  submissionChannel?: string;
  notes?: string;
  attachmentIds?: RegulatoryDossierSubmission["attachmentIds"];
}

export function recordDossierSubmission(input: RecordDossierSubmissionInput, actor: Actor): RegulatoryDossierSubmission {
  requireAuthorizedRegulatoryActor(actor, "record a dossier submission");
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id: newId("dossiersubmission"),
    dossierId: input.dossierId,
    dossierRevision: input.dossierRevision,
    jurisdiction: input.jurisdiction,
    submissionReference: input.submissionReference,
    submittedBy: actor.userId,
    submittedAt: now,
    submissionChannel: input.submissionChannel,
    status: "prepared",
    notes: input.notes,
    attachmentIds: input.attachmentIds ?? [],
    updatedAt: now,
  };
}

export function updateDossierSubmissionStatus(
  current: RegulatoryDossierSubmission,
  status: RegulatoryDossierSubmission["status"],
  actor: Actor,
  notes?: string,
): RegulatoryDossierSubmission {
  requireAuthorizedRegulatoryActor(actor, "update a dossier submission's status");
  const now = new Date().toISOString();
  return { ...current, status, notes: notes ?? current.notes, updatedBy: actor.userId, updatedAt: now };
}
