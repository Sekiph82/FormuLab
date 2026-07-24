/**
 * Phase 3 — Regulatory Dossier and Evidence Matrix workspace. A dossier is
 * always bound to a real, saved formula version (never a working draft),
 * an explicit jurisdiction scope, and optionally a packaging SKU. This
 * panel is the first-class `/dossiers` workspace (never a Formula Builder
 * tab) that turns the frozen requirement/evidence/link records
 * (`schemas/dossier.ts`) into the live evidence matrix a reviewer reads —
 * see `engine/regulatoryDossier.ts` and docs/REGULATORY_DOSSIERS.md.
 *
 * Compliance-assistance only: nothing here ever asserts legal compliance
 * from an uploaded document, an accepted link, or a completed checkbox —
 * only an authorized human's `verifyEvidence` / `recordDossierReview` ever
 * counts toward readiness, and "unknown" applicability/human-review-
 * required requirements never silently become "ready".
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileCheck2, History, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import {
  DOSSIER_EVIDENCE_TYPES,
  DOSSIER_REQUIREMENT_TYPES,
  DOSSIER_REVIEW_OUTCOMES,
  DOSSIER_STATUSES,
  DOSSIER_SUBMISSION_STATUSES,
  REGULATORY_JURISDICTIONS,
  SEED_REGULATORY_RULES,
  acceptEvidenceLink,
  activeLinksForDossier,
  addDraftEvidence,
  addManualRequirement,
  buildDossierRequirementSnapshot,
  buildEvidenceMatrix,
  calculateDossierReadiness,
  compareDossierRequirementsToCurrentRules,
  createDossier,
  currentRequirementsForRevision,
  deriveDossierStatus,
  deriveEvidenceStatus,
  excludeRequirement,
  isAuthorizedRegulatoryActor,
  isDossierImmutable,
  mapEvidenceToRequirements,
  newId,
  proposeEvidenceLink,
  recordDossierReview,
  recordDossierSubmission,
  rejectEvidence,
  rejectEvidenceLink,
  resolveDossierRevisionChain,
  resolveEvidenceRevisionChain,
  reviseDossier,
  revokeDossierReview,
  revokeEvidence,
  revokeEvidenceLink,
  updateDossierStatus,
  updateDossierSubmissionStatus,
  verifyEvidence,
  APPROVAL_ROLES,
  type Actor,
  type ApprovalRole,
  type AuditEvent,
  type DossierRequirementRow,
  type Formulation,
  type FormulationVersion,
  type RegulatoryDossier,
  type RegulatoryDossierEvidenceItem,
  type RegulatoryDossierManualRequirementAction,
  type RegulatoryDossierRequirement,
  type RegulatoryDossierReview,
  type RegulatoryDossierReviewRevocation,
  type RegulatoryDossierSubmission,
  type RegulatoryJurisdiction,
  type RegulatoryRequirementEvidenceLink,
  type RegulatoryRule,
} from "@ai4s/shared";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { appendAudit, auditEvent } from "@/lib/formulations";
import { cn } from "@/lib/cn";
import { AttachmentField } from "./AttachmentField";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

const DETAIL_SECTIONS = ["overview", "matrix", "requirements", "evidence", "reviews", "submissions", "history", "audit"] as const;
type DetailSection = (typeof DETAIL_SECTIONS)[number];

const READINESS_STYLE: Record<string, string> = {
  not_ready: "bg-error/10 text-error",
  partially_ready: "bg-warn/10 text-warn",
  ready_for_review: "bg-success/10 text-success",
  under_review: "bg-accent/10 text-accent",
  review_complete: "bg-success/10 text-success",
  blocked: "bg-error/10 text-error",
  unknown: "bg-error/10 text-error",
};

const SATISFACTION_STYLE: Record<string, string> = {
  satisfied_verified: "bg-success/10 text-success",
  satisfied_unverified: "bg-warn/10 text-warn",
  partially_satisfied: "bg-warn/10 text-warn",
  not_started: "bg-surface-2 text-muted",
  missing: "bg-error/10 text-error",
  rejected: "bg-error/10 text-error",
  expired: "bg-error/10 text-error",
  revoked: "bg-error/10 text-error",
  not_applicable: "bg-surface-2 text-muted",
  blocked: "bg-error/10 text-error",
  unknown: "bg-error/10 text-error",
};

export function DossierPanel({
  formulation,
  versions,
  auditLog,
  initialVersionId,
  initialJurisdiction,
  initialPackagingSkuCode,
  initialDossierId,
  onAuditChanged,
}: {
  formulation: Formulation;
  versions: FormulationVersion[];
  auditLog: AuditEvent[];
  initialVersionId?: string;
  initialJurisdiction?: RegulatoryJurisdiction;
  initialPackagingSkuCode?: string;
  initialDossierId?: string;
  onAuditChanged: () => Promise<void>;
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;

  const [rules, setRules] = useState<RegulatoryRule[]>(SEED_REGULATORY_RULES);
  const [dossiers, setDossiers] = useState<RegulatoryDossier[]>([]);
  const [requirements, setRequirements] = useState<RegulatoryDossierRequirement[]>([]);
  const [evidenceItems, setEvidenceItems] = useState<RegulatoryDossierEvidenceItem[]>([]);
  const [links, setLinks] = useState<RegulatoryRequirementEvidenceLink[]>([]);
  const [reviews, setReviews] = useState<RegulatoryDossierReview[]>([]);
  const [reviewRevocations, setReviewRevocations] = useState<RegulatoryDossierReviewRevocation[]>([]);
  const [submissions, setSubmissions] = useState<RegulatoryDossierSubmission[]>([]);
  const [manualActions, setManualActions] = useState<RegulatoryDossierManualRequirementAction[]>([]);

  const [reviewerRole, setReviewerRole] = useState<ApprovalRole>("regulatory");
  const [selectedDossierId, setSelectedDossierId] = useState<string | null>(initialDossierId ?? null);
  const [section, setSection] = useState<DetailSection>("overview");
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [jurisdictionFilter, setJurisdictionFilter] = useState<string>("");

  const actor: Actor = useMemo(() => ({ kind: "human", role: reviewerRole, userId: "local" }), [reviewerRole]);
  // The backend throws regardless — this only hides/disables buttons so an
  // unauthorized reviewer role doesn't see actions it can never perform.
  const canActRegulatory = isAuthorizedRegulatoryActor(actor);

  const load = async () => {
    const [ds, reqs, ev, lk, rv, rvrv, sub, ma, ru] = await Promise.all([
      listRecords("regulatory_dossiers"),
      listRecords("regulatory_dossier_requirements"),
      listRecords("regulatory_evidence_items"),
      listRecords("regulatory_requirement_evidence_links"),
      listRecords("regulatory_dossier_reviews"),
      listRecords("regulatory_dossier_review_revocations"),
      listRecords("regulatory_dossier_submissions"),
      listRecords("regulatory_dossier_manual_requirement_actions"),
      listRecordsSeeded("regulatory_rules", SEED_REGULATORY_RULES),
    ]);
    const ownDossiers = ds.filter((d) => d.formulationId === formulation.id);
    const ownIds = new Set(ownDossiers.map((d) => d.id));
    setDossiers(ownDossiers);
    setRequirements(reqs.filter((r) => ownIds.has(r.dossierId)));
    setEvidenceItems(ev.filter((e) => e.formulationId === formulation.id));
    setLinks(lk.filter((l) => ownIds.has(l.dossierId)));
    setReviews(rv.filter((r) => ownIds.has(r.dossierId)));
    setReviewRevocations(rvrv);
    setSubmissions(sub.filter((s) => ownIds.has(s.dossierId)));
    setManualActions(ma.filter((m) => ownIds.has(m.dossierId)));
    setRules(ru);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulation.id]);

  const selectedDossier = dossiers.find((d) => d.id === selectedDossierId);

  // ------------------------------------------------------------------ create
  const [creating, setCreating] = useState(false);
  const [draftCode, setDraftCode] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftVersionId, setDraftVersionId] = useState(initialVersionId ?? "");
  const [draftSku, setDraftSku] = useState(initialPackagingSkuCode ?? "");
  const [draftJurisdictions, setDraftJurisdictions] = useState<RegulatoryJurisdiction[]>(initialJurisdiction ? [initialJurisdiction] : []);
  const [createBusy, setCreateBusy] = useState(false);

  const openCreate = () => {
    setCreating(true);
    setDraftCode(`DOS-${Date.now().toString(36).toUpperCase()}`);
    setDraftTitle("");
    setDraftVersionId(initialVersionId ?? versions[0]?.id ?? "");
    setDraftSku(initialPackagingSkuCode ?? "");
    setDraftJurisdictions(initialJurisdiction ? [initialJurisdiction] : []);
    setError(null);
  };

  const submitCreate = async () => {
    if (!draftVersionId) {
      setError(t("dossier.needSavedVersion"));
      return;
    }
    if (draftJurisdictions.length === 0) {
      setError(t("dossier.needJurisdiction"));
      return;
    }
    setCreateBusy(true);
    setError(null);
    try {
      const dossier = createDossier(
        {
          dossierCode: draftCode.trim() || newId("dossier"),
          title: draftTitle.trim() || draftCode.trim(),
          formulationId: formulation.id,
          formulaVersionId: draftVersionId,
          packagingSkuCode: draftSku || undefined,
          jurisdictions: draftJurisdictions,
          productFamilyCode: formulation.productFamilyCode,
          targetMarkets: formulation.targetMarkets,
        },
        actor,
      );
      // Findings are not yet threaded through from a live regulatory
      // evaluation at creation time (Part 7 wires automatic discovery from
      // existing FormuLab records) — an empty findings array here means
      // every generated requirement starts "applicable" rather than a
      // fabricated finding-derived applicability. Documented in the Phase 3
      // execution log as a deliberate simplification, not a shortcut.
      const requirementRows = buildDossierRequirementSnapshot(dossier, {
        jurisdictions: draftJurisdictions,
        productFamilyCode: formulation.productFamilyCode,
        rules,
        findings: [],
      });
      await upsertRecords("regulatory_dossiers", [dossier]);
      await upsertRecords("regulatory_dossier_requirements", requirementRows);
      setDossiers((prev) => [...prev, dossier]);
      setRequirements((prev) => [...prev, ...requirementRows]);
      await appendAudit(
        auditEvent(formulation.id, "dossier.created", {
          versionId: dossier.formulaVersionId,
          detail: dossier.dossierCode,
          metadata: { dossierId: dossier.id, dossierRevision: String(dossier.revision), formulaVersionId: dossier.formulaVersionId },
        }),
      );
      await appendAudit(
        auditEvent(formulation.id, "dossier.requirements_generated", {
          versionId: dossier.formulaVersionId,
          detail: `${requirementRows.length} requirement(s)`,
          metadata: { dossierId: dossier.id, dossierRevision: String(dossier.revision) },
        }),
      );
      await onAuditChanged();
      setCreating(false);
      setSelectedDossierId(dossier.id);
      setSection("overview");
    } catch (e) {
      setError(String(e));
    } finally {
      setCreateBusy(false);
    }
  };

  // --------------------------------------------------------- status/revision
  const [statusDraft, setStatusDraft] = useState<RegulatoryDossier["status"]>("draft");
  useEffect(() => {
    if (selectedDossier) setStatusDraft(selectedDossier.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDossier?.id, selectedDossier?.status]);

  const doChangeStatus = async () => {
    if (!selectedDossier) return;
    try {
      const updated = updateDossierStatus(selectedDossier, statusDraft, actor);
      await upsertRecords("regulatory_dossiers", [updated]);
      setDossiers((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      await appendAudit(
        auditEvent(formulation.id, "dossier.status_changed", {
          versionId: updated.formulaVersionId,
          detail: statusDraft,
          metadata: { dossierId: updated.id, dossierRevision: String(updated.revision) },
        }),
      );
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const doRevise = async () => {
    if (!selectedDossier) return;
    try {
      const { superseded, revised } = reviseDossier(selectedDossier, actor);
      await upsertRecords("regulatory_dossiers", [superseded, revised]);
      setDossiers((prev) => [...prev.map((d) => (d.id === superseded.id ? superseded : d)), revised]);
      await appendAudit(
        auditEvent(formulation.id, "dossier.revised", {
          versionId: revised.formulaVersionId,
          detail: revised.dossierCode,
          metadata: { dossierId: revised.id, dossierRevision: String(revised.revision), supersedesDossierId: superseded.id },
        }),
      );
      await appendAudit(
        auditEvent(formulation.id, "dossier.superseded", {
          versionId: superseded.formulaVersionId,
          detail: superseded.dossierCode,
          metadata: { dossierId: superseded.id },
        }),
      );
      await onAuditChanged();
      setSelectedDossierId(revised.id);
    } catch (e) {
      setError(String(e));
    }
  };

  // -------------------------------------------------------------- computed
  const currentReqs = selectedDossier ? currentRequirementsForRevision(requirements, selectedDossier.id, selectedDossier.revision) : [];
  const activeLinks = selectedDossier ? activeLinksForDossier(links, selectedDossier.id) : [];
  const dossierEvidence = selectedDossier ? evidenceItems.filter((e) => e.dossierId === selectedDossier.id) : [];
  const matrix: DossierRequirementRow[] = selectedDossier
    ? buildEvidenceMatrix(currentReqs, activeLinks, dossierEvidence, selectedDossier.formulaVersionId, selectedDossier.packagingSkuCode)
    : [];
  const readiness = selectedDossier ? calculateDossierReadiness(selectedDossier, matrix) : undefined;
  const drift = selectedDossier
    ? compareDossierRequirementsToCurrentRules(currentReqs, {
        jurisdictions: selectedDossier.jurisdictions,
        productFamilyCode: selectedDossier.productFamilyCode,
        rules,
        findings: [],
      })
    : undefined;
  const hasDrift = !!drift && (drift.newRequirementCodes.length > 0 || drift.removedRequirementCodes.length > 0 || drift.changedRuleVersionCodes.length > 0 || drift.changedMandatoryStatusCodes.length > 0 || drift.changedAcceptedEvidenceTypesCodes.length > 0 || drift.changedJurisdictionApplicabilityCodes.length > 0);
  const revisionChain = selectedDossier ? resolveDossierRevisionChain(selectedDossier, dossiers) : [];
  const suggestions = selectedDossier ? mapEvidenceToRequirements(currentReqs, dossierEvidence, { formulaVersionId: selectedDossier.formulaVersionId, packagingSkuCode: selectedDossier.packagingSkuCode }) : new Map();

  const filteredDossiers = dossiers.filter((d) => {
    const effective = deriveDossierStatus(d, dossiers);
    if (statusFilter && effective !== statusFilter) return false;
    if (jurisdictionFilter && !d.jurisdictions.includes(jurisdictionFilter as RegulatoryJurisdiction)) return false;
    return true;
  });

  // -------------------------------------------------------------- evidence
  const [evidenceForm, setEvidenceForm] = useState(false);
  const [evType, setEvType] = useState<(typeof DOSSIER_EVIDENCE_TYPES)[number]>("sds");
  const [evTitle, setEvTitle] = useState("");
  const [evExpiresAt, setEvExpiresAt] = useState("");
  const [evAttachments, setEvAttachments] = useState<RegulatoryDossierEvidenceItem["attachmentIds"]>([]);

  const submitEvidence = async () => {
    if (!selectedDossier) return;
    try {
      const item = addDraftEvidence(
        {
          dossierId: selectedDossier.id,
          formulationId: formulation.id,
          formulaVersionId: selectedDossier.formulaVersionId,
          packagingSkuCode: selectedDossier.packagingSkuCode,
          jurisdictions: selectedDossier.jurisdictions,
          evidenceType: evType,
          title: evTitle.trim() || evType,
          expiresAt: evExpiresAt || undefined,
          attachmentIds: evAttachments,
        },
        actor,
      );
      await upsertRecords("regulatory_evidence_items", [item]);
      setEvidenceItems((prev) => [...prev, item]);
      await appendAudit(
        auditEvent(formulation.id, "dossier.evidence_added", {
          versionId: selectedDossier.formulaVersionId,
          detail: item.title,
          metadata: { dossierId: selectedDossier.id, evidenceItemId: item.id },
        }),
      );
      await onAuditChanged();
      setEvidenceForm(false);
      setEvTitle("");
      setEvExpiresAt("");
      setEvAttachments([]);
    } catch (e) {
      setError(String(e));
    }
  };

  const persistEvidence = (item: RegulatoryDossierEvidenceItem) => {
    setEvidenceItems((prev) => prev.map((e) => (e.id === item.id ? item : e)));
    return upsertRecords("regulatory_evidence_items", [item]);
  };

  const doVerify = async (item: RegulatoryDossierEvidenceItem) => {
    try {
      const updated = verifyEvidence(item, actor);
      await persistEvidence(updated);
      await appendAudit(auditEvent(formulation.id, "dossier.evidence_verified", { detail: item.title, metadata: { dossierId: item.dossierId, evidenceItemId: item.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };
  const doReject = async (item: RegulatoryDossierEvidenceItem) => {
    const reason = window.prompt(t("dossier.rejectReasonPrompt"));
    if (!reason) return;
    try {
      const updated = rejectEvidence(item, actor, reason);
      await persistEvidence(updated);
      await appendAudit(auditEvent(formulation.id, "dossier.evidence_rejected", { detail: reason, metadata: { dossierId: item.dossierId, evidenceItemId: item.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };
  const doRevoke = async (item: RegulatoryDossierEvidenceItem) => {
    const reason = window.prompt(t("dossier.revokeReasonPrompt"));
    if (!reason) return;
    try {
      const updated = revokeEvidence(item, actor, reason);
      await persistEvidence(updated);
      await appendAudit(auditEvent(formulation.id, "dossier.evidence_revoked", { detail: reason, metadata: { dossierId: item.dossierId, evidenceItemId: item.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  // ------------------------------------------------------------------ links
  const [linkReqId, setLinkReqId] = useState("");
  const [linkEvId, setLinkEvId] = useState("");

  const doPropose = async () => {
    if (!selectedDossier || !linkReqId || !linkEvId) return;
    try {
      const link = proposeEvidenceLink({ dossierId: selectedDossier.id, requirementId: linkReqId, evidenceItemId: linkEvId }, actor);
      await upsertRecords("regulatory_requirement_evidence_links", [link]);
      setLinks((prev) => [...prev, link]);
      await appendAudit(auditEvent(formulation.id, "dossier.evidence_link_proposed", { metadata: { dossierId: selectedDossier.id, requirementId: linkReqId, evidenceItemId: linkEvId } }));
      await onAuditChanged();
      setLinkReqId("");
      setLinkEvId("");
    } catch (e) {
      setError(String(e));
    }
  };
  const doAcceptLink = async (link: RegulatoryRequirementEvidenceLink) => {
    try {
      const updated = acceptEvidenceLink(link, actor);
      await upsertRecords("regulatory_requirement_evidence_links", [updated]);
      setLinks((prev) => [...prev, updated]);
      await appendAudit(auditEvent(formulation.id, "dossier.evidence_link_accepted", { metadata: { dossierId: link.dossierId, requirementId: link.requirementId, evidenceItemId: link.evidenceItemId } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };
  const doRejectLink = async (link: RegulatoryRequirementEvidenceLink) => {
    const reason = window.prompt(t("dossier.rejectReasonPrompt"));
    if (!reason) return;
    try {
      const updated = rejectEvidenceLink(link, actor, reason);
      await upsertRecords("regulatory_requirement_evidence_links", [updated]);
      setLinks((prev) => [...prev, updated]);
      await appendAudit(auditEvent(formulation.id, "dossier.evidence_link_rejected", { detail: reason, metadata: { dossierId: link.dossierId, requirementId: link.requirementId, evidenceItemId: link.evidenceItemId } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };
  const doRevokeLink = async (link: RegulatoryRequirementEvidenceLink) => {
    const reason = window.prompt(t("dossier.revokeReasonPrompt"));
    if (!reason) return;
    try {
      const updated = revokeEvidenceLink(link, actor, reason);
      await upsertRecords("regulatory_requirement_evidence_links", [updated]);
      setLinks((prev) => [...prev, updated]);
      await appendAudit(auditEvent(formulation.id, "dossier.evidence_link_revoked", { detail: reason, metadata: { dossierId: link.dossierId, requirementId: link.requirementId, evidenceItemId: link.evidenceItemId } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  // ------------------------------------------------------------ requirements
  const [manualForm, setManualForm] = useState(false);
  const [manCode, setManCode] = useState("");
  const [manTitle, setManTitle] = useState("");
  const [manType, setManType] = useState<(typeof DOSSIER_REQUIREMENT_TYPES)[number]>("document");
  const [manJurisdiction, setManJurisdiction] = useState<RegulatoryJurisdiction>("KE");
  const [manJustification, setManJustification] = useState("");

  const submitManual = async () => {
    if (!selectedDossier) return;
    try {
      const { requirement, action } = addManualRequirement(
        selectedDossier,
        {
          schemaVersion: "1.0",
          jurisdiction: manJurisdiction,
          requirementCode: manCode.trim() || newId("manreq"),
          requirementType: manType,
          title: manTitle.trim() || manCode.trim(),
          mandatory: true,
          critical: false,
          applicabilityStatus: "applicable",
          applicabilityReason: t("dossier.manuallyAddedReason"),
          evidenceRequirement: true,
          documentTypesAccepted: [],
          minimumEvidenceCount: 1,
        },
        actor,
        manJustification,
      );
      await upsertRecords("regulatory_dossier_requirements", [requirement]);
      await upsertRecords("regulatory_dossier_manual_requirement_actions", [action]);
      setRequirements((prev) => [...prev, requirement]);
      setManualActions((prev) => [...prev, action]);
      await appendAudit(auditEvent(formulation.id, "dossier.requirement_added", { detail: requirement.title, metadata: { dossierId: selectedDossier.id, requirementId: requirement.id } }));
      await onAuditChanged();
      setManualForm(false);
      setManCode("");
      setManTitle("");
      setManJustification("");
    } catch (e) {
      setError(String(e));
    }
  };

  const doExclude = async (requirement: RegulatoryDossierRequirement) => {
    const justification = window.prompt(t("dossier.excludeJustificationPrompt"));
    if (!justification) return;
    try {
      const { requirement: excluded, action } = excludeRequirement(requirement, actor, justification);
      await upsertRecords("regulatory_dossier_requirements", [excluded]);
      await upsertRecords("regulatory_dossier_manual_requirement_actions", [action]);
      setRequirements((prev) => [...prev, excluded]);
      setManualActions((prev) => [...prev, action]);
      await appendAudit(auditEvent(formulation.id, "dossier.requirement_excluded", { detail: justification, metadata: { dossierId: excluded.dossierId, requirementId: excluded.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  // ---------------------------------------------------------------- reviews
  const [reviewOutcome, setReviewOutcome] = useState<RegulatoryDossierReview["outcome"]>("approved");
  const [reviewNotes, setReviewNotes] = useState("");

  const submitReview = async () => {
    if (!selectedDossier) return;
    try {
      const review = recordDossierReview(
        {
          dossierId: selectedDossier.id,
          dossierRevision: selectedDossier.revision,
          outcome: reviewOutcome,
          notes: reviewNotes,
          requirementSnapshot: currentReqs,
          evidenceSnapshot: dossierEvidence,
        },
        actor,
      );
      await upsertRecords("regulatory_dossier_reviews", [review]);
      setReviews((prev) => [...prev, review]);
      await appendAudit(auditEvent(formulation.id, "dossier.review_recorded", { detail: `${reviewOutcome}`, metadata: { dossierId: selectedDossier.id, reviewId: review.id } }));
      await onAuditChanged();
      setReviewNotes("");
    } catch (e) {
      setError(String(e));
    }
  };
  const doRevokeReview = async (review: RegulatoryDossierReview) => {
    const reason = window.prompt(t("dossier.revokeReasonPrompt"));
    if (!reason) return;
    try {
      const revocation = revokeDossierReview(review.id, actor, reason);
      await upsertRecords("regulatory_dossier_review_revocations", [revocation]);
      setReviewRevocations((prev) => [...prev, revocation]);
      await appendAudit(auditEvent(formulation.id, "dossier.review_revoked", { detail: reason, metadata: { dossierId: review.dossierId, reviewId: review.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  // ------------------------------------------------------------ submissions
  const [subJurisdiction, setSubJurisdiction] = useState<RegulatoryJurisdiction>("KE");
  const [subReference, setSubReference] = useState("");
  const [subNotes, setSubNotes] = useState("");

  const submitSubmission = async () => {
    if (!selectedDossier) return;
    try {
      const submission = recordDossierSubmission(
        { dossierId: selectedDossier.id, dossierRevision: selectedDossier.revision, jurisdiction: subJurisdiction, submissionReference: subReference || undefined, notes: subNotes || undefined },
        actor,
      );
      await upsertRecords("regulatory_dossier_submissions", [submission]);
      setSubmissions((prev) => [...prev, submission]);
      await appendAudit(auditEvent(formulation.id, "dossier.submission_recorded", { detail: subJurisdiction, metadata: { dossierId: selectedDossier.id, submissionId: submission.id } }));
      await onAuditChanged();
      setSubReference("");
      setSubNotes("");
    } catch (e) {
      setError(String(e));
    }
  };
  const doUpdateSubmission = async (submission: RegulatoryDossierSubmission, status: RegulatoryDossierSubmission["status"]) => {
    try {
      const updated = updateDossierSubmissionStatus(submission, status, actor);
      await upsertRecords("regulatory_dossier_submissions", [updated]);
      setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      await appendAudit(auditEvent(formulation.id, "dossier.submission_status_changed", { detail: status, metadata: { dossierId: submission.dossierId, submissionId: submission.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const dossierAuditLog = selectedDossier ? auditLog.filter((e) => e.action.startsWith("dossier.") && e.metadata?.dossierId === selectedDossier.id) : [];

  // -------------------------------------------------------------- rendering
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FileCheck2 size={14} className="text-accent" />
        <h2 className="text-[14px] font-medium text-text">{t("dossier.heading")}</h2>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-[10px] text-muted">
          {t("dossier.actingAsRole")}
          <select value={reviewerRole} onChange={(e) => setReviewerRole(e.target.value as ApprovalRole)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
            {APPROVAL_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}

      {!selectedDossier && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
              <option value="">{t("dossier.allStatuses")}</option>
              {DOSSIER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select value={jurisdictionFilter} onChange={(e) => setJurisdictionFilter(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
              <option value="">{t("dossier.allJurisdictions")}</option>
              {REGULATORY_JURISDICTIONS.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
            <div className="flex-1" />
            <button onClick={openCreate} className="flex items-center gap-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
              <Plus size={12} /> {t("dossier.newDossier")}
            </button>
          </div>

          {filteredDossiers.length === 0 ? (
            <div className="rounded-card border border-dashed border-border-faint px-4 py-8 text-center">
              <p className="mb-2 text-[12px] text-muted">{t("dossier.emptyState")}</p>
              <button onClick={openCreate} className="rounded-input border border-accent px-3 py-1.5 text-[11px] text-accent hover:bg-accent/10">
                {t("dossier.newDossier")}
              </button>
            </div>
          ) : (
            <ul className="space-y-1">
              {filteredDossiers.map((d) => {
                const reqs = currentRequirementsForRevision(requirements, d.id, d.revision);
                const lks = activeLinksForDossier(links, d.id);
                const ev = evidenceItems.filter((e) => e.dossierId === d.id);
                const mtx = buildEvidenceMatrix(reqs, lks, ev, d.formulaVersionId, d.packagingSkuCode);
                const r = calculateDossierReadiness(d, mtx);
                const versionLabel = versions.find((v) => v.id === d.formulaVersionId);
                const effective = deriveDossierStatus(d, dossiers);
                return (
                  <li key={d.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                    <button onClick={() => { setSelectedDossierId(d.id); setSection("overview"); }} className="flex w-full flex-wrap items-center gap-1.5 text-left">
                      <span className="text-text">{d.dossierCode}</span>
                      <span className="text-[10px] text-muted">{d.title}</span>
                      <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{versionLabel ? t("dossier.versionOption", { n: versionLabel.versionNumber }) : d.formulaVersionId}</span>
                      {d.packagingSkuCode && <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{d.packagingSkuCode}</span>}
                      <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{d.jurisdictions.join(", ")}</span>
                      <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{effective}</span>
                      <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t("dossier.revisionLabel", { n: d.revision })}</span>
                      <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[9px]", READINESS_STYLE[r.overallReadiness])}>{t(`dossier.readiness.${r.overallReadiness}`)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {selectedDossier && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button onClick={() => setSelectedDossierId(null)} className="flex items-center gap-1 text-[11px] text-muted hover:text-text">
              <ArrowLeft size={12} /> {t("dossier.backToList")}
            </button>
            <span className="text-[12px] font-medium text-text">{selectedDossier.dossierCode}</span>
            <span className="text-[11px] text-muted">{selectedDossier.title}</span>
            {readiness && <span className={cn("rounded px-1.5 py-0.5 text-[9px]", READINESS_STYLE[readiness.overallReadiness])}>{t(`dossier.readiness.${readiness.overallReadiness}`)}</span>}
            <div className="flex-1" />
            <div className="flex flex-wrap gap-1">
              {DETAIL_SECTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSection(s)}
                  className={cn("rounded px-2 py-1 text-[11px]", section === s ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface-2")}
                >
                  {t(`dossier.section.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {hasDrift && section !== "history" && (
            <p className="mb-2 rounded-input bg-warn/10 px-2 py-1 text-[10px] text-warn">{t("dossier.driftBanner")}</p>
          )}

          {section === "overview" && (
            <div className="space-y-2">
              <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                <p className="mb-1 font-medium text-muted">{t("dossier.statusHeading")}</p>
                {isDossierImmutable(selectedDossier) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text">{selectedDossier.status}</span>
                    <span className="text-[10px] text-muted">{t("dossier.immutableNotice")}</span>
                    {/* Any human role may revise (requireHumanActor) — same authorization tier as creating a dossier. */}
                    <button onClick={() => void doRevise()} className="rounded-input border border-accent px-2 py-1 text-[10px] text-accent hover:bg-accent/10">
                      {t("dossier.createRevision")}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={statusDraft} onChange={(e) => setStatusDraft(e.target.value as RegulatoryDossier["status"])} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                      {DOSSIER_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button onClick={() => void doChangeStatus()} disabled={statusDraft === selectedDossier.status} className="rounded-input border border-accent px-2 py-1 text-[10px] text-accent hover:bg-accent/10 disabled:opacity-40">
                      {t("dossier.saveStatus")}
                    </button>
                  </div>
                )}
              </div>
              {readiness && (
                <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                  <p className="mb-1 font-medium text-muted">{t("dossier.readinessSummary")}</p>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5">{t("dossier.totalRequirements", { n: readiness.totalRequirements })}</span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5">{t("dossier.mandatorySatisfied", { n: readiness.satisfiedMandatoryRequirements, total: readiness.mandatoryRequirements })}</span>
                    <span className="rounded bg-error/10 px-1.5 py-0.5 text-error">{t("dossier.missingMandatory", { n: readiness.missingMandatoryRequirements })}</span>
                    <span className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{t("dossier.expiredEvidence", { n: readiness.expiredEvidenceCount })}</span>
                    <span className="rounded bg-error/10 px-1.5 py-0.5 text-error">{t("dossier.rejectedEvidence", { n: readiness.rejectedEvidenceCount })}</span>
                    <span className="rounded bg-error/10 px-1.5 py-0.5 text-error">{t("dossier.humanReviewRequired", { n: readiness.humanReviewRequiredCount })}</span>
                  </div>
                </div>
              )}
              <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                <p className="mb-1 font-medium text-muted">{t("dossier.multiJurisdictionSummary")}</p>
                <ul className="space-y-1">
                  {selectedDossier.jurisdictions.map((j) => {
                    const jReqs = currentReqs.filter((r) => r.jurisdiction === j);
                    const jMatrix = matrix.filter((row) => row.requirement.jurisdiction === j);
                    const jMandatory = jMatrix.filter((row) => row.requirement.mandatory);
                    const jSatisfied = jMandatory.filter((row) => row.satisfaction === "satisfied_verified");
                    return (
                      <li key={j} className="flex items-center gap-2 text-[10px] text-muted">
                        <span className="rounded bg-surface-2 px-1 py-0.5 text-text">{j}</span>
                        <span>{t("dossier.jurisdictionRequirementCount", { n: jReqs.length })}</span>
                        <span>{t("dossier.mandatorySatisfied", { n: jSatisfied.length, total: jMandatory.length })}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1 text-[9px] text-muted">{t("dossier.neverMergedNotice")}</p>
              </div>
            </div>
          )}

          {section === "matrix" && (
            <div className="overflow-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border-faint text-left text-muted">
                    <th className="py-1 pr-2">{t("dossier.col.requirement")}</th>
                    <th className="py-1 pr-2">{t("dossier.col.jurisdiction")}</th>
                    <th className="py-1 pr-2">{t("dossier.col.mandatory")}</th>
                    <th className="py-1 pr-2">{t("dossier.col.applicability")}</th>
                    <th className="py-1 pr-2">{t("dossier.col.linkedEvidence")}</th>
                    <th className="py-1 pr-2">{t("dossier.col.satisfaction")}</th>
                    <th className="py-1 pr-2">{t("dossier.col.blockingReason")}</th>
                    <th className="py-1 pr-2">{t("dossier.col.lastActivity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row) => (
                    <tr key={row.requirement.id} className="border-b border-border-faint/50">
                      <td className="py-1 pr-2 text-text">{row.requirement.title}{row.requirement.isManual && <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t("dossier.manualTag")}</span>}{row.requirement.status === "excluded" && <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t("dossier.excludedTag")}</span>}</td>
                      <td className="py-1 pr-2">{row.requirement.jurisdiction}</td>
                      <td className="py-1 pr-2">{row.requirement.mandatory ? (row.requirement.critical ? t("dossier.criticalYes") : t("dossier.mandatoryYes")) : t("dossier.mandatoryNo")}</td>
                      <td className="py-1 pr-2">{row.requirement.applicabilityStatus}</td>
                      <td className="py-1 pr-2">{row.linkedEvidence.map((e) => e.title).join(", ") || "—"}</td>
                      <td className="py-1 pr-2"><span className={cn("rounded px-1 py-0.5 text-[9px]", SATISFACTION_STYLE[row.satisfaction])}>{row.satisfaction}</span></td>
                      <td className="py-1 pr-2 text-muted">{row.blockingReason ?? "—"}</td>
                      <td className="py-1 pr-2 text-muted">{row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                  {matrix.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-3 text-center text-muted">{t("dossier.noRequirements")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {section === "requirements" && (
            <div>
              <div className="mb-2 flex justify-end">
                {canActRegulatory && (
                  <button onClick={() => setManualForm(true)} className="flex items-center gap-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
                    <Plus size={12} /> {t("dossier.addManualRequirement")}
                  </button>
                )}
              </div>
              {manualForm && (
                <div className="mb-3 rounded-card border border-border p-2.5">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted">{t("dossier.requirementCode")}</span>
                      <input value={manCode} onChange={(e) => setManCode(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted">{t("dossier.requirementTitle")}</span>
                      <input value={manTitle} onChange={(e) => setManTitle(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted">{t("dossier.col.jurisdiction")}</span>
                      <select value={manJurisdiction} onChange={(e) => setManJurisdiction(e.target.value as RegulatoryJurisdiction)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                        {selectedDossier.jurisdictions.map((j) => (
                          <option key={j} value={j}>{j}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted">{t("dossier.requirementType")}</span>
                      <select value={manType} onChange={(e) => setManType(e.target.value as (typeof DOSSIER_REQUIREMENT_TYPES)[number])} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                        {DOSSIER_REQUIREMENT_TYPES.map((rt) => (
                          <option key={rt} value={rt}>{rt}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[10px] text-muted">{t("dossier.justification")}</span>
                      <textarea value={manJustification} onChange={(e) => setManJustification(e.target.value)} rows={2} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                    </label>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void submitManual()} disabled={!manJustification.trim()} className="rounded-input bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
                      {t("common:actions.save")}
                    </button>
                    <button onClick={() => setManualForm(false)} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
                      {t("common:actions.cancel")}
                    </button>
                  </div>
                </div>
              )}
              <ul className="space-y-1">
                {currentReqs.map((r) => (
                  <li key={r.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-text">{r.title}</span>
                      <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{r.jurisdiction}</span>
                      <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{r.requirementType}</span>
                      {r.isManual && <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t("dossier.manualTag")}</span>}
                      {r.status === "excluded" && <span className="rounded bg-error/10 px-1 py-0.5 text-[9px] text-error">{t("dossier.excludedTag")}</span>}
                      {r.mandatory && <span className="rounded bg-warn/10 px-1 py-0.5 text-[9px] text-warn">{t("dossier.mandatoryYes")}</span>}
                      {r.critical && <span className="rounded bg-error/10 px-1 py-0.5 text-[9px] text-error">{t("dossier.criticalYes")}</span>}
                      {r.status !== "excluded" && canActRegulatory && (
                        <button onClick={() => void doExclude(r)} className="ml-auto text-[10px] text-error hover:underline">
                          {t("dossier.excludeAction")}
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted">{r.applicabilityReason}</p>
                  </li>
                ))}
                {currentReqs.length === 0 && <p className="text-[11px] text-muted">{t("dossier.noRequirements")}</p>}
              </ul>
            </div>
          )}

          {section === "evidence" && (
            <div>
              <div className="mb-2 flex justify-end">
                <button onClick={() => setEvidenceForm(true)} className="flex items-center gap-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
                  <Plus size={12} /> {t("dossier.addEvidence")}
                </button>
              </div>
              {evidenceForm && (
                <div className="mb-3 rounded-card border border-border p-2.5">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted">{t("dossier.evidenceType")}</span>
                      <select value={evType} onChange={(e) => setEvType(e.target.value as (typeof DOSSIER_EVIDENCE_TYPES)[number])} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                        {DOSSIER_EVIDENCE_TYPES.map((et) => (
                          <option key={et} value={et}>{et}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted">{t("dossier.evidenceTitle")}</span>
                      <input value={evTitle} onChange={(e) => setEvTitle(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted">{t("dossier.expiresAt")}</span>
                      <input type="date" value={evExpiresAt} onChange={(e) => setEvExpiresAt(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                    </label>
                  </div>
                  <div className="mt-2">
                    <span className="mb-1 block text-[10px] text-muted">{t("dossier.attachments")}</span>
                    <AttachmentField formulationId={formulation.id} attachments={evAttachments} onChange={setEvAttachments} t={t} />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void submitEvidence()} className="rounded-input bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90">
                      {t("common:actions.save")}
                    </button>
                    <button onClick={() => setEvidenceForm(false)} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
                      {t("common:actions.cancel")}
                    </button>
                  </div>
                </div>
              )}

              <ul className="space-y-1">
                {dossierEvidence.map((item) => {
                  const effective = deriveEvidenceStatus(item, dossierEvidence);
                  const chain = resolveEvidenceRevisionChain(item, dossierEvidence);
                  return (
                    <li key={item.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-text">{item.title}</span>
                        <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{item.evidenceType}</span>
                        <span className={cn("rounded px-1 py-0.5 text-[9px]", effective === "verified" ? "bg-success/10 text-success" : effective === "rejected" || effective === "revoked" ? "bg-error/10 text-error" : "bg-warn/10 text-warn")}>{effective}</span>
                        {item.expiresAt && <span className="text-[9px] text-muted">{t("dossier.expiresLabel", { date: new Date(item.expiresAt).toLocaleDateString() })}</span>}
                        {chain.length > 1 && <span className="flex items-center gap-0.5 text-[9px] text-muted"><History size={9} /> {t("dossier.revisionLabel", { n: chain.length })}</span>}
                        <div className="ml-auto flex gap-1.5">
                          {effective !== "verified" && canActRegulatory && (
                            <button onClick={() => void doVerify(item)} className="flex items-center gap-1 text-[10px] text-success hover:underline">
                              <ShieldCheck size={10} /> {t("dossier.verifyAction")}
                            </button>
                          )}
                          {effective !== "rejected" && canActRegulatory && (
                            <button onClick={() => void doReject(item)} className="text-[10px] text-error hover:underline">
                              {t("dossier.rejectAction")}
                            </button>
                          )}
                          {effective !== "revoked" && canActRegulatory && (
                            <button onClick={() => void doRevoke(item)} className="text-[10px] text-error hover:underline">
                              {t("dossier.revokeAction")}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
                {dossierEvidence.length === 0 && <p className="text-[11px] text-muted">{t("dossier.noEvidence")}</p>}
              </ul>

              <div className="mt-3 rounded-card border border-border p-2.5">
                <p className="mb-2 text-[11px] font-medium text-muted">{t("dossier.linkEvidenceHeading")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select value={linkReqId} onChange={(e) => setLinkReqId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                    <option value="">{t("dossier.selectRequirement")}</option>
                    {currentReqs.map((r) => (
                      <option key={r.id} value={r.id}>{r.title}</option>
                    ))}
                  </select>
                  <select value={linkEvId} onChange={(e) => setLinkEvId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                    <option value="">{t("dossier.selectEvidence")}</option>
                    {dossierEvidence.map((e) => (
                      <option key={e.id} value={e.id}>{e.title}</option>
                    ))}
                  </select>
                </div>
                {linkReqId && suggestions.get(linkReqId) && suggestions.get(linkReqId)!.length > 0 && (
                  <p className="mt-1 text-[9px] text-muted">{t("dossier.suggestedEvidence", { list: suggestions.get(linkReqId)!.map((e: RegulatoryDossierEvidenceItem) => e.title).join(", ") })}</p>
                )}
                <button onClick={() => void doPropose()} disabled={!linkReqId || !linkEvId} className="mt-2 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40">
                  {t("dossier.proposeLink")}
                </button>

                <ul className="mt-2 space-y-1">
                  {activeLinks.map((l) => {
                    const req = requirements.find((r) => r.id === l.requirementId);
                    const ev = evidenceItems.find((e) => e.id === l.evidenceItemId);
                    return (
                      <li key={l.id} className="flex flex-wrap items-center gap-1.5 rounded-input border border-border-faint px-2 py-1 text-[10px] text-muted">
                        <span>{req?.title ?? l.requirementId} ↔ {ev?.title ?? l.evidenceItemId}</span>
                        <span className={cn("rounded px-1 py-0.5 text-[9px]", l.linkStatus === "accepted" ? "bg-success/10 text-success" : "bg-warn/10 text-warn")}>{l.linkStatus}</span>
                        <div className="ml-auto flex gap-1.5">
                          {l.linkStatus === "proposed" && (
                            <>
                              <button onClick={() => void doAcceptLink(l)} className="text-success hover:underline">{t("dossier.acceptLink")}</button>
                              <button onClick={() => void doRejectLink(l)} className="text-error hover:underline">{t("dossier.rejectAction")}</button>
                            </>
                          )}
                          {l.linkStatus === "accepted" && (
                            <button onClick={() => void doRevokeLink(l)} className="text-error hover:underline">{t("dossier.revokeAction")}</button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {section === "reviews" && (
            <div>
              <div className="mb-3 rounded-card border border-border p-2.5">
                <p className="mb-2 text-[11px] font-medium text-muted">{t("dossier.recordReview")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-muted">{t("dossier.outcomeLabel")}</span>
                    <select value={reviewOutcome} onChange={(e) => setReviewOutcome(e.target.value as RegulatoryDossierReview["outcome"])} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                      {DOSSIER_REVIEW_OUTCOMES.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[10px] text-muted">{t("dossier.reviewNotes")}</span>
                    <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={3} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                  </label>
                </div>
                <button onClick={() => void submitReview()} disabled={!reviewNotes.trim() || !canActRegulatory} className="mt-2 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40">
                  {t("dossier.saveReview")}
                </button>
                {!canActRegulatory && <p className="mt-1 text-[10px] text-warn">{t("dossier.unauthorizedRoleHint")}</p>}
              </div>
              <ul className="space-y-1">
                {reviews.filter((r) => r.dossierId === selectedDossier.id).map((r) => {
                  const revoked = reviewRevocations.some((rv) => rv.revokesReviewId === r.id);
                  return (
                    <li key={r.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("rounded px-1 py-0.5 text-[9px]", r.outcome === "approved" ? "bg-success/10 text-success" : r.outcome === "rejected" ? "bg-error/10 text-error" : "bg-warn/10 text-warn")}>{r.outcome}</span>
                        <span className="text-text">{r.reviewedBy}</span>
                        <span className="text-[10px] text-muted">({r.reviewerRole})</span>
                        <span className="text-[10px] text-muted">{new Date(r.reviewedAt).toLocaleString()}</span>
                        {revoked && <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t("dossier.revokedTag")}</span>}
                        {!revoked && canActRegulatory && (
                          <button onClick={() => void doRevokeReview(r)} className="ml-auto text-[10px] text-error hover:underline">
                            {t("dossier.revokeAction")}
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted">{r.notes}</p>
                    </li>
                  );
                })}
                {reviews.filter((r) => r.dossierId === selectedDossier.id).length === 0 && <p className="text-[11px] text-muted">{t("dossier.noReviews")}</p>}
              </ul>
            </div>
          )}

          {section === "submissions" && (
            <div>
              <p className="mb-2 text-[10px] text-muted">{t("dossier.submissionTrackingNotice")}</p>
              <div className="mb-3 rounded-card border border-border p-2.5">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-muted">{t("dossier.col.jurisdiction")}</span>
                    <select value={subJurisdiction} onChange={(e) => setSubJurisdiction(e.target.value as RegulatoryJurisdiction)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                      {selectedDossier.jurisdictions.map((j) => (
                        <option key={j} value={j}>{j}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-muted">{t("dossier.submissionReference")}</span>
                    <input value={subReference} onChange={(e) => setSubReference(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[10px] text-muted">{t("dossier.reviewNotes")}</span>
                    <textarea value={subNotes} onChange={(e) => setSubNotes(e.target.value)} rows={2} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                  </label>
                </div>
                <button onClick={() => void submitSubmission()} disabled={!canActRegulatory} className="mt-2 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40">
                  {t("dossier.recordSubmission")}
                </button>
              </div>
              <ul className="space-y-1">
                {submissions.filter((s) => s.dossierId === selectedDossier.id).map((s) => (
                  <li key={s.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px]">{s.jurisdiction}</span>
                      <span className="text-text">{s.status}</span>
                      <span className="text-[10px] text-muted">{new Date(s.submittedAt).toLocaleString()}</span>
                      {canActRegulatory && (
                        <select value={s.status} onChange={(e) => void doUpdateSubmission(s, e.target.value as RegulatoryDossierSubmission["status"])} className="ml-auto rounded-input border border-border bg-surface px-1 py-0.5 text-[10px]">
                          {DOSSIER_SUBMISSION_STATUSES.map((st) => (
                            <option key={st} value={st}>{st}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </li>
                ))}
                {submissions.filter((s) => s.dossierId === selectedDossier.id).length === 0 && <p className="text-[11px] text-muted">{t("dossier.noSubmissions")}</p>}
              </ul>
            </div>
          )}

          {section === "history" && (
            <div className="space-y-2">
              <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                <p className="mb-1 font-medium text-muted">{t("dossier.revisionChain")}</p>
                <ul className="space-y-1 text-[10px] text-muted">
                  {revisionChain.map((d) => (
                    <li key={d.id}>{t("dossier.revisionLabel", { n: d.revision })} — {d.status} — {new Date(d.createdAt).toLocaleString()}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                <p className="mb-1 font-medium text-muted">{t("dossier.manualActionsHeading")}</p>
                <ul className="space-y-0.5 text-[10px] text-muted">
                  {/* eslint-disable i18next/no-literal-string -- "—"/"("/")" are punctuation glue between data fields, not prose */}
                  {manualActions
                    .filter((m) => m.dossierId === selectedDossier.id)
                    .map((m) => (
                      <li key={m.id}>
                        {m.action} — {m.performedBy} ({m.performedByRole}) — {new Date(m.performedAt).toLocaleString()} — {m.justification}
                      </li>
                    ))}
                  {/* eslint-enable i18next/no-literal-string */}
                  {manualActions.filter((m) => m.dossierId === selectedDossier.id).length === 0 && <li>{t("dossier.noManualActions")}</li>}
                </ul>
              </div>
              {drift && (
                <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                  <p className="mb-1 font-medium text-muted">{t("dossier.requirementDrift")}</p>
                  {!hasDrift ? (
                    <p className="text-[10px] text-muted">{t("dossier.noDrift")}</p>
                  ) : (
                    <ul className="space-y-0.5 text-[10px] text-muted">
                      {drift.newRequirementCodes.length > 0 && <li>{t("dossier.driftNew", { list: drift.newRequirementCodes.join(", ") })}</li>}
                      {drift.removedRequirementCodes.length > 0 && <li>{t("dossier.driftRemoved", { list: drift.removedRequirementCodes.join(", ") })}</li>}
                      {drift.changedRuleVersionCodes.length > 0 && <li>{t("dossier.driftVersion", { list: drift.changedRuleVersionCodes.join(", ") })}</li>}
                      {drift.changedMandatoryStatusCodes.length > 0 && <li>{t("dossier.driftMandatory", { list: drift.changedMandatoryStatusCodes.join(", ") })}</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {section === "audit" && (
            <ul className="space-y-1">
              {dossierAuditLog.map((e) => (
                <li key={e.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[10px] text-muted">
                  <span className="text-text">{e.action}</span> — {e.detail} — {new Date(e.at).toLocaleString()}
                </li>
              ))}
              {dossierAuditLog.length === 0 && <p className="text-[11px] text-muted">{t("dossier.noAuditEvents")}</p>}
            </ul>
          )}
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("dossier.newDossier")}>
          <div className="my-auto w-[36rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
            <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{t("dossier.newDossier")}</h2>
            <div className="space-y-2 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("dossier.dossierCode")}</span>
                <input value={draftCode} onChange={(e) => setDraftCode(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("dossier.dossierTitle")}</span>
                <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("dossier.formulaVersion")}</span>
                <select value={draftVersionId} onChange={(e) => setDraftVersionId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("dossier.selectVersion")}</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>{t("dossier.versionOption", { n: v.versionNumber })}</option>
                  ))}
                </select>
                {versions.length === 0 && <p className="mt-1 text-[10px] text-warn">{t("dossier.needSavedVersion")}</p>}
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("dossier.packagingSku")}</span>
                <select value={draftSku} onChange={(e) => setDraftSku(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("dossier.noPackagingSku")}</option>
                  {formulation.targetSkuCodes.map((sku) => (
                    <option key={sku} value={sku}>{sku}</option>
                  ))}
                </select>
              </label>
              <div>
                <span className="mb-1 block text-[10px] text-muted">{t("dossier.jurisdictions")}</span>
                <div className="flex flex-wrap gap-2">
                  {REGULATORY_JURISDICTIONS.map((j) => (
                    <label key={j} className="flex items-center gap-1 text-[10px]">
                      <input
                        type="checkbox"
                        checked={draftJurisdictions.includes(j)}
                        onChange={(e) => setDraftJurisdictions((prev) => (e.target.checked ? [...prev, j] : prev.filter((x) => x !== j)))}
                      />
                      {j}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setCreating(false)} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">
                {t("common:actions.cancel")}
              </button>
              <button onClick={() => void submitCreate()} disabled={createBusy} className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
                {t("common:actions.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-4 flex items-center gap-1 text-[9px] text-muted">
        <RotateCcw size={9} /> {t("dossier.notLegalAdvice")}
      </p>
    </div>
  );
}
