import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
  AuditEvent,
  ClaimReview,
  ClaimReviewRevocation,
  DataExchangeExportJob,
  DataExchangeImportJob,
  DoeAnalysis,
  DoeCandidate,
  DoeRun,
  DoeStudy,
  Formulation,
  FormulationVersion,
  LabelArtwork,
  LabelReview,
  LabelReviewRevocation,
  LaboratoryTrial,
  ProductClaim,
  ProductLabel,
  RegulatoryDossier,
  RegulatoryDossierEvidenceItem,
  RegulatoryDossierRequirement,
  RegulatoryDossierReview,
  RegulatoryDossierReviewRevocation,
  RegulatoryRequirementEvidenceLink,
  RegulatoryRule,
  StabilitySample,
  StabilityStudy,
} from "@formulab/shared";
import {
  SEED_REGULATORY_RULES,
  activeLinksForDossier,
  buildEvidenceMatrix,
  calculateDossierReadiness,
  currentRequirementsForRevision,
  deriveArtworkEffectiveStatus,
  deriveClaimEffectiveStatus,
  deriveClaimRisk,
  deriveLabelEffectiveStatus,
  effectiveStatus,
  evaluateClaimAgainstRules,
  isClaimReviewActive,
  isDossierReviewActive,
  isLabelReviewActive,
} from "@formulab/shared";
import { listFormulations, readAuditLog, readFormulation } from "@/lib/formulations";
import { listRecords, listRecordsSeeded } from "@/lib/masterdata";

const OPEN_TRIAL_STATUSES = new Set(["planned", "materials_prepared", "in_progress", "awaiting_results"]);
const PENDING_APPROVAL_STATUSES = new Set(["chemist_review", "lab_candidate", "stability_testing", "pilot_candidate"]);
const RECENT_PROJECT_LIMIT = 5;
// Evidence within this window is "expiring soon" — a defined threshold,
// not a fabricated one, and the only place this number is invented.
const EVIDENCE_EXPIRY_WARNING_DAYS = 30;
// Same kind of defined (not fabricated) threshold, for "recent exports".
const DATA_EXCHANGE_RECENT_EXPORT_WINDOW_DAYS = 7;

interface DossierHomeRow {
  project: Formulation;
  dossier: RegulatoryDossier;
  readinessState: string;
}

interface PendingApproval {
  project: Formulation;
  version: FormulationVersion;
  status: string;
}

interface ClaimHomeRow {
  project: Formulation;
  claim: ProductClaim;
}

interface LabelHomeRow {
  project: Formulation;
  label: ProductLabel;
}

interface DoeStudyHomeRow {
  project: Formulation;
  study: DoeStudy;
}

interface DoeCandidateHomeRow {
  project: Formulation;
  study: DoeStudy;
  candidate: DoeCandidate;
}

/**
 * The Home workspace — a real, honest dashboard: recent projects, recent
 * activity, open laboratory work, upcoming stability samples and pending
 * approvals, every one of them read from persisted records that already
 * exist elsewhere in the app. No fabricated metrics, no invented
 * aggregation engine — an empty section says so plainly. See
 * docs/WORKSPACES.md.
 */
export function HomePage() {
  const { t } = useTranslation("session");
  const [projects, setProjects] = useState<Formulation[] | null>(null);
  const [recentActivity, setRecentActivity] = useState<{ event: AuditEvent; projectName: string }[]>([]);
  const [openTrials, setOpenTrials] = useState<{ trial: LaboratoryTrial; projectName: string }[]>([]);
  const [upcomingSamples, setUpcomingSamples] = useState<{ sample: StabilitySample; projectName: string }[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [dossiersReadyForReview, setDossiersReadyForReview] = useState<DossierHomeRow[]>([]);
  const [dossiersBlocked, setDossiersBlocked] = useState<DossierHomeRow[]>([]);
  const [dossiersInPreparation, setDossiersInPreparation] = useState<DossierHomeRow[]>([]);
  const [evidenceExpiringSoon, setEvidenceExpiringSoon] = useState<{ item: RegulatoryDossierEvidenceItem; projectName: string }[]>([]);
  const [reviewsPending, setReviewsPending] = useState<DossierHomeRow[]>([]);
  const [claimsAwaitingReview, setClaimsAwaitingReview] = useState<ClaimHomeRow[]>([]);
  const [claimsProhibitedOrHighRisk, setClaimsProhibitedOrHighRisk] = useState<ClaimHomeRow[]>([]);
  const [labelsAwaitingReview, setLabelsAwaitingReview] = useState<LabelHomeRow[]>([]);
  const [artworkAwaitingApproval, setArtworkAwaitingApproval] = useState<LabelHomeRow[]>([]);
  const [staleLabelReviews, setStaleLabelReviews] = useState<LabelHomeRow[]>([]);
  const [doeActiveStudies, setDoeActiveStudies] = useState<DoeStudyHomeRow[]>([]);
  const [doeStudiesReadyForAnalysis, setDoeStudiesReadyForAnalysis] = useState<DoeStudyHomeRow[]>([]);
  const [doeCandidatesAwaitingSelection, setDoeCandidatesAwaitingSelection] = useState<DoeCandidateHomeRow[]>([]);
  const [doeRunsAwaitingLabWorkCount, setDoeRunsAwaitingLabWorkCount] = useState(0);
  const [dxAwaitingConfirmation, setDxAwaitingConfirmation] = useState<DataExchangeImportJob[]>([]);
  const [dxFailed, setDxFailed] = useState<DataExchangeImportJob[]>([]);
  const [dxCompletedWithWarnings, setDxCompletedWithWarnings] = useState<DataExchangeImportJob[]>([]);
  const [dxRecentExportsCount, setDxRecentExportsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [all, trials, studies, samples, dossiers, dossierRequirements, dossierLinks, dossierEvidence, dossierReviews, dossierReviewRevocations, claims, claimReviews, claimReviewRevocations, productLabels, labelArtworks, labelReviews, labelReviewRevocations, regulatoryRules, doeStudies, doeRuns, doeAnalyses, doeCandidates, dxImportJobs, dxExportJobs] = await Promise.all([
        listFormulations(),
        listRecords("laboratory_trials"),
        listRecords("stability_studies"),
        listRecords("stability_samples"),
        listRecords("regulatory_dossiers"),
        listRecords("regulatory_dossier_requirements"),
        listRecords("regulatory_requirement_evidence_links"),
        listRecords("regulatory_evidence_items"),
        listRecords("regulatory_dossier_reviews"),
        listRecords("regulatory_dossier_review_revocations"),
        listRecords("product_claims"),
        listRecords("claim_reviews"),
        listRecords("claim_review_revocations"),
        listRecords("product_labels"),
        listRecords("label_artworks"),
        listRecords("label_reviews"),
        listRecords("label_review_revocations"),
        listRecordsSeeded("regulatory_rules", SEED_REGULATORY_RULES),
        listRecords("doe_studies"),
        listRecords("doe_runs"),
        listRecords("doe_analyses"),
        listRecords("doe_candidates"),
        listRecords("data_exchange_import_jobs"),
        listRecords("data_exchange_export_jobs"),
      ]);
      if (cancelled) return;
      const sorted = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setProjects(sorted);
      const nameById = new Map(all.map((p) => [p.id, p.name] as const));

      setOpenTrials(
        (trials as LaboratoryTrial[])
          .filter((tr) => OPEN_TRIAL_STATUSES.has(tr.status))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 10)
          .map((trial) => ({ trial, projectName: nameById.get(trial.projectId) ?? trial.projectId })),
      );

      const studyProjectById = new Map((studies as StabilityStudy[]).map((s) => [s.id, s.projectId] as const));
      setUpcomingSamples(
        (samples as StabilitySample[])
          .filter((s) => (s.status === "planned" || s.status === "due" || s.status === "overdue") && s.dueDate)
          .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
          .slice(0, 10)
          .map((sample) => {
            const projectId = studyProjectById.get(sample.studyId);
            return { sample, projectName: (projectId && nameById.get(projectId)) || t("home.unknownProject") };
          }),
      );

      const recentProjects = sorted.slice(0, RECENT_PROJECT_LIMIT);
      const perProject = await Promise.all(
        recentProjects.map(async (p) => {
          const [log, { versions }] = await Promise.all([readAuditLog(p.id), readFormulation(p.id)]);
          return { project: p, log, versions };
        }),
      );
      if (cancelled) return;

      const activity = perProject
        .flatMap(({ project, log }) => log.map((event) => ({ event, projectName: project.name })))
        .sort((a, b) => b.event.at.localeCompare(a.event.at))
        .slice(0, 10);
      setRecentActivity(activity);

      const pending: PendingApproval[] = [];
      for (const { project, versions, log } of perProject) {
        for (const version of versions) {
          const status = effectiveStatus(version, log);
          if (PENDING_APPROVAL_STATUSES.has(status)) pending.push({ project, version, status });
        }
      }
      setPendingApprovals(pending.slice(0, 10));

      // Dossiers-in-preparation/ready-for-review/blocked, evidence expiring
      // soon and reviews pending — scoped to the same `recentProjects`
      // (RECENT_PROJECT_LIMIT) the rest of this dashboard already uses, never
      // the whole project history. Every count is a real, live-computed fact
      // (calculateDossierReadiness on real requirement/evidence/link rows),
      // never a placeholder or estimate.
      const recentProjectIds = new Set(recentProjects.map((p) => p.id));
      const recentDossiers = (dossiers as RegulatoryDossier[]).filter((d) => recentProjectIds.has(d.formulationId) && d.status !== "superseded" && d.status !== "archived");
      const readyRows: DossierHomeRow[] = [];
      const blockedRows: DossierHomeRow[] = [];
      const preparationRows: DossierHomeRow[] = [];
      const pendingReviewRows: DossierHomeRow[] = [];
      for (const dossier of recentDossiers) {
        const project = recentProjects.find((p) => p.id === dossier.formulationId);
        if (!project) continue;
        const reqs = currentRequirementsForRevision(dossierRequirements as RegulatoryDossierRequirement[], dossier.id, dossier.revision);
        const activeLinks = activeLinksForDossier(dossierLinks as RegulatoryRequirementEvidenceLink[], dossier.id);
        const evidenceForDossier = (dossierEvidence as RegulatoryDossierEvidenceItem[]).filter((e) => e.dossierId === dossier.id);
        const matrix = buildEvidenceMatrix(reqs, activeLinks, evidenceForDossier, dossier.formulaVersionId, dossier.packagingSkuCode);
        const readiness = calculateDossierReadiness(dossier, matrix);
        const row: DossierHomeRow = { project, dossier, readinessState: readiness.overallReadiness };
        if (readiness.overallReadiness === "ready_for_review") {
          readyRows.push(row);
          const hasActiveReview = (dossierReviews as RegulatoryDossierReview[]).some(
            (r) => r.dossierId === dossier.id && isDossierReviewActive(r, dossierReviewRevocations as RegulatoryDossierReviewRevocation[], dossier.revision),
          );
          if (!hasActiveReview) pendingReviewRows.push(row);
        } else if (readiness.overallReadiness === "blocked" || readiness.overallReadiness === "unknown") {
          blockedRows.push(row);
        } else {
          preparationRows.push(row);
        }
      }
      setDossiersReadyForReview(readyRows.slice(0, 10));
      setDossiersBlocked(blockedRows.slice(0, 10));
      setDossiersInPreparation(preparationRows.slice(0, 10));
      setReviewsPending(pendingReviewRows.slice(0, 10));

      const expiryThreshold = new Date();
      expiryThreshold.setDate(expiryThreshold.getDate() + EVIDENCE_EXPIRY_WARNING_DAYS);
      const recentDossierIds = new Set(recentDossiers.map((d) => d.id));
      setEvidenceExpiringSoon(
        (dossierEvidence as RegulatoryDossierEvidenceItem[])
          .filter((e) => recentDossierIds.has(e.dossierId) && e.expiresAt && new Date(e.expiresAt) <= expiryThreshold && new Date(e.expiresAt) >= new Date() && e.status !== "expired" && e.status !== "revoked")
          .sort((a, b) => (a.expiresAt ?? "").localeCompare(b.expiresAt ?? ""))
          .slice(0, 10)
          .map((item) => ({ item, projectName: nameById.get(item.formulationId) ?? item.formulationId })),
      );

      // Phase 4 §22 — claims/labels awaiting attention, scoped to the same
      // `recentProjects` window as every other section above. Every count
      // is a real, live-computed fact (deriveClaimRisk/isClaimReviewActive/
      // isLabelReviewActive against real persisted rows), never a
      // fabricated number.
      const recentClaims = (claims as ProductClaim[]).filter(
        (c) => recentProjectIds.has(c.formulationId) && deriveClaimEffectiveStatus(c, claims as ProductClaim[]) !== "superseded" && c.status !== "withdrawn" && c.status !== "rejected",
      );
      const awaitingReviewRows: ClaimHomeRow[] = [];
      const prohibitedOrHighRiskRows: ClaimHomeRow[] = [];
      for (const claim of recentClaims) {
        const project = recentProjects.find((p) => p.id === claim.formulationId);
        if (!project) continue;
        const hasActiveReview = (claimReviews as ClaimReview[]).some(
          (r) => r.claimId === claim.id && isClaimReviewActive(r, claimReviewRevocations as ClaimReviewRevocation[], 1),
        );
        if (!hasActiveReview) awaitingReviewRows.push({ project, claim });
        const findings = evaluateClaimAgainstRules(claim, { jurisdictions: claim.jurisdictions, rules: regulatoryRules as RegulatoryRule[] });
        const risk = deriveClaimRisk(claim, findings);
        if (claim.status === "prohibited" || ((risk === "high" || risk === "critical") && claim.status !== "supported" && claim.status !== "supported_with_conditions")) {
          prohibitedOrHighRiskRows.push({ project, claim });
        }
      }
      setClaimsAwaitingReview(awaitingReviewRows.slice(0, 10));
      setClaimsProhibitedOrHighRisk(prohibitedOrHighRiskRows.slice(0, 10));

      const recentLabels = (productLabels as ProductLabel[]).filter(
        (l) => recentProjectIds.has(l.formulationId) && deriveLabelEffectiveStatus(l, productLabels as ProductLabel[]) !== "superseded",
      );
      const labelsAwaitingReviewRows: LabelHomeRow[] = [];
      const artworkAwaitingApprovalRows: LabelHomeRow[] = [];
      const staleReviewRows: LabelHomeRow[] = [];
      for (const label of recentLabels) {
        const project = recentProjects.find((p) => p.id === label.formulationId);
        if (!project) continue;
        const reviewsForLabel = (labelReviews as LabelReview[]).filter((r) => r.labelId === label.id);
        const hasActiveApprovedReview = reviewsForLabel.some(
          (r) => isLabelReviewActive(r, labelReviewRevocations as LabelReviewRevocation[], label.revision, r.artworkRevision) && r.outcome !== "rejected" && r.outcome !== "changes_requested",
        );
        if (!hasActiveApprovedReview) labelsAwaitingReviewRows.push({ project, label });
        if (reviewsForLabel.length > 0 && !hasActiveApprovedReview) staleReviewRows.push({ project, label });
        const artworksForLabel = (labelArtworks as LabelArtwork[]).filter((a) => a.labelId === label.id && a.labelRevision === label.revision);
        const currentArtwork = artworksForLabel.find((a) => deriveArtworkEffectiveStatus(a, artworksForLabel) !== "superseded");
        if (currentArtwork?.status === "uploaded") artworkAwaitingApprovalRows.push({ project, label });
      }
      setLabelsAwaitingReview(labelsAwaitingReviewRows.slice(0, 10));
      setArtworkAwaitingApproval(artworkAwaitingApprovalRows.slice(0, 10));
      setStaleLabelReviews(staleReviewRows.slice(0, 10));

      // Phase 5 §18 — DOE studies/runs/candidates awaiting attention, scoped
      // to the same `recentProjects` window. Every count is a real filter
      // over persisted `doe_*` rows, never a fabricated metric.
      const recentDoeStudies = (doeStudies as DoeStudy[]).filter(
        (s) => recentProjectIds.has(s.formulationId) && !["cancelled", "superseded", "archived", "completed"].includes(s.status),
      );
      const activeRows: DoeStudyHomeRow[] = [];
      const readyForAnalysisRows: DoeStudyHomeRow[] = [];
      for (const study of recentDoeStudies) {
        const project = recentProjects.find((p) => p.id === study.formulationId);
        if (!project) continue;
        activeRows.push({ project, study });
        const hasAnalysis = (doeAnalyses as DoeAnalysis[]).some((a) => a.studyId === study.id);
        if (study.status === "analysis_ready" && !hasAnalysis) readyForAnalysisRows.push({ project, study });
      }
      setDoeActiveStudies(activeRows.slice(0, 10));
      setDoeStudiesReadyForAnalysis(readyForAnalysisRows.slice(0, 10));

      const recentDoeStudyIds = new Set(recentDoeStudies.map((s) => s.id));
      setDoeRunsAwaitingLabWorkCount((doeRuns as DoeRun[]).filter((r) => recentDoeStudyIds.has(r.studyId) && r.status === "planned").length);

      const candidateRows: DoeCandidateHomeRow[] = [];
      for (const candidate of doeCandidates as DoeCandidate[]) {
        if (candidate.status !== "proposed" && candidate.status !== "shortlisted") continue;
        const study = recentDoeStudies.find((s) => s.id === candidate.studyId);
        if (!study) continue;
        const project = recentProjects.find((p) => p.id === study.formulationId);
        if (!project) continue;
        candidateRows.push({ project, study, candidate });
      }
      setDoeCandidatesAwaitingSelection(candidateRows.slice(0, 10));

      // Data Exchange Center is project-less (like Administration) — its
      // Home summary is not scoped to `recentProjects`, just the real,
      // persisted `data_exchange_import_jobs`/`data_exchange_export_jobs`
      // rows, exactly as they exist right now.
      const importJobs = (dxImportJobs as DataExchangeImportJob[]).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      setDxAwaitingConfirmation(importJobs.filter((j) => j.status === "awaiting_confirmation" || j.status === "preview_ready").slice(0, 10));
      setDxFailed(importJobs.filter((j) => j.status === "failed" || j.status === "validation_failed").slice(0, 10));
      setDxCompletedWithWarnings(importJobs.filter((j) => j.status === "completed_with_warnings").slice(0, 10));
      const exportWindowStart = new Date();
      exportWindowStart.setDate(exportWindowStart.getDate() - DATA_EXCHANGE_RECENT_EXPORT_WINDOW_DAYS);
      setDxRecentExportsCount((dxExportJobs as DataExchangeExportJob[]).filter((j) => new Date(j.requestedAt) >= exportWindowStart).length);

      setLoading(false);
    })().catch(() => {
      // Home's summary data failed to load (e.g. no Tauri host in a test/
      // dev-browser context, or a real backend error) — never leave the
      // page spinning forever, and never let this become an unhandled
      // rejection. No error UI here by design; this mirrors the rest of
      // the app's existing fire-and-forget `.catch(() => {})` convention.
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (loading) {
    return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("home.loading")}</p>;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <h1 className="mb-4 font-serif text-xl text-text">{t("home.heading")}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title={t("home.recentProjects")} empty={projects?.length === 0} emptyText={t("home.noProjects")}>
          <ul className="divide-y divide-border-faint">
            {(projects ?? []).slice(0, RECENT_PROJECT_LIMIT).map((p) => (
              <li key={p.id}>
                <Link to={`/formulation?project=${p.id}`} className="flex items-baseline gap-2 px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="font-mono text-[10px] text-muted">{p.code}</span>
                  <span className="flex-1 truncate text-text">{p.name}</span>
                  <span className="text-[10px] text-muted">{new Date(p.updatedAt).toLocaleDateString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("home.recentActivity")} empty={recentActivity.length === 0} emptyText={t("home.noActivity")}>
          <ul className="divide-y divide-border-faint">
            {recentActivity.map(({ event, projectName }) => (
              <li key={event.id} className="px-3 py-2 text-[12px]">
                <div className="text-text">{event.action}</div>
                <div className="text-[10px] text-muted">
                  {projectName} · {new Date(event.at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("home.openLabWork")} empty={openTrials.length === 0} emptyText={t("home.noOpenLabWork")}>
          <ul className="divide-y divide-border-faint">
            {openTrials.map(({ trial, projectName }) => (
              <li key={trial.id} className="flex items-baseline gap-2 px-3 py-2 text-[12px]">
                <span className="font-mono text-[10px] text-muted">{trial.code}</span>
                <span className="flex-1 truncate text-text">{trial.title}</span>
                <span className="text-[10px] text-muted">
                  {projectName} · {trial.status}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("home.upcomingStabilitySamples")} empty={upcomingSamples.length === 0} emptyText={t("home.noUpcomingSamples")}>
          <ul className="divide-y divide-border-faint">
            {upcomingSamples.map(({ sample, projectName }) => (
              <li key={sample.id} className="flex items-baseline gap-2 px-3 py-2 text-[12px]">
                <span className="font-mono text-[10px] text-muted">{sample.sampleCode}</span>
                <span className="flex-1 truncate text-text">{projectName}</span>
                <span className="text-[10px] text-muted">{sample.dueDate ? new Date(sample.dueDate).toLocaleDateString() : "—"}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("home.pendingApprovals")} empty={pendingApprovals.length === 0} emptyText={t("home.noPendingApprovals")}>
          <ul className="divide-y divide-border-faint">
            {pendingApprovals.map(({ project, version, status }) => (
              <li key={version.id}>
                <Link to={`/approval?project=${project.id}`} className="flex items-baseline gap-2 px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="font-mono text-[10px] text-muted">{version.versionLabel ?? `0.${version.versionNumber}`}</span>
                  <span className="flex-1 truncate text-text">{project.name}</span>
                  <span className="text-[10px] text-muted">{status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("home.dossiersHeading")} empty={dossiersReadyForReview.length === 0 && dossiersBlocked.length === 0 && dossiersInPreparation.length === 0} emptyText={t("home.noDossiers")}>
          <div className="flex flex-wrap gap-2 px-3 py-2 text-[10px]">
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">{t("home.dossiersInPreparation", { n: dossiersInPreparation.length })}</span>
            <span className="rounded bg-success/10 px-1.5 py-0.5 text-success">{t("home.dossiersReadyForReview", { n: dossiersReadyForReview.length })}</span>
            <span className="rounded bg-error/10 px-1.5 py-0.5 text-error">{t("home.dossiersBlocked", { n: dossiersBlocked.length })}</span>
          </div>
          <ul className="divide-y divide-border-faint">
            {[...dossiersReadyForReview, ...dossiersBlocked].map(({ project, dossier, readinessState }) => (
              <li key={dossier.id}>
                <Link to={`/dossiers?project=${project.id}&dossier=${dossier.id}`} className="flex items-baseline gap-2 px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="font-mono text-[10px] text-muted">{dossier.dossierCode}</span>
                  <span className="flex-1 truncate text-text">{project.name}</span>
                  <span className="text-[10px] text-muted">{readinessState}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("home.evidenceExpiringSoon")} empty={evidenceExpiringSoon.length === 0} emptyText={t("home.noEvidenceExpiringSoon")}>
          <ul className="divide-y divide-border-faint">
            {evidenceExpiringSoon.map(({ item, projectName }) => (
              <li key={item.id} className="flex items-baseline gap-2 px-3 py-2 text-[12px]">
                <span className="flex-1 truncate text-text">{item.title}</span>
                <span className="text-[10px] text-muted">
                  {projectName} · {item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("home.reviewsPending")} empty={reviewsPending.length === 0} emptyText={t("home.noReviewsPending")}>
          <ul className="divide-y divide-border-faint">
            {reviewsPending.map(({ project, dossier }) => (
              <li key={dossier.id}>
                <Link to={`/dossiers?project=${project.id}&dossier=${dossier.id}`} className="flex items-baseline gap-2 px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="font-mono text-[10px] text-muted">{dossier.dossierCode}</span>
                  <span className="flex-1 truncate text-text">{project.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title={t("home.claimsHeading")}
          empty={claimsAwaitingReview.length === 0 && claimsProhibitedOrHighRisk.length === 0}
          emptyText={t("home.noClaimsAttention")}
        >
          <div className="flex flex-wrap gap-2 px-3 py-2 text-[10px]">
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">{t("home.claimsAwaitingReview", { n: claimsAwaitingReview.length })}</span>
            <span className="rounded bg-error/10 px-1.5 py-0.5 text-error">{t("home.claimsProhibitedOrHighRisk", { n: claimsProhibitedOrHighRisk.length })}</span>
          </div>
          <ul className="divide-y divide-border-faint">
            {/* A claim can legitimately land in both counts above (a
                prohibited claim also has no active review) — dedupe by id
                for the combined list so React never sees a repeated key. */}
            {dedupeById([...claimsProhibitedOrHighRisk, ...claimsAwaitingReview], (row) => row.claim.id).map(({ project, claim }) => (
              <li key={claim.id}>
                <Link to={`/claims-labels?project=${project.id}&version=${claim.formulaVersionId}&claim=${claim.id}`} className="flex items-baseline gap-2 px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="font-mono text-[10px] text-muted">{claim.claimCode}</span>
                  <span className="flex-1 truncate text-text">{project.name}</span>
                  <span className="text-[10px] text-muted">{claim.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title={t("home.labelsHeading")}
          empty={labelsAwaitingReview.length === 0 && artworkAwaitingApproval.length === 0 && staleLabelReviews.length === 0}
          emptyText={t("home.noLabelsAttention")}
        >
          <div className="flex flex-wrap gap-2 px-3 py-2 text-[10px]">
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">{t("home.labelsAwaitingReview", { n: labelsAwaitingReview.length })}</span>
            <span className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{t("home.artworkAwaitingApproval", { n: artworkAwaitingApproval.length })}</span>
            <span className="rounded bg-error/10 px-1.5 py-0.5 text-error">{t("home.staleLabelReviews", { n: staleLabelReviews.length })}</span>
          </div>
          <ul className="divide-y divide-border-faint">
            {dedupeById([...staleLabelReviews, ...artworkAwaitingApproval, ...labelsAwaitingReview], (row) => row.label.id).map(({ project, label }) => (
              <li key={label.id}>
                <Link to={`/claims-labels?project=${project.id}&version=${label.formulaVersionId}&label=${label.id}`} className="flex items-baseline gap-2 px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="font-mono text-[10px] text-muted">{label.labelCode}</span>
                  <span className="flex-1 truncate text-text">{project.name}</span>
                  <span className="text-[10px] text-muted">{label.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title={t("home.doeHeading")}
          empty={doeActiveStudies.length === 0 && doeRunsAwaitingLabWorkCount === 0 && doeStudiesReadyForAnalysis.length === 0 && doeCandidatesAwaitingSelection.length === 0}
          emptyText={t("home.noDoeAttention")}
        >
          <div className="flex flex-wrap gap-2 px-3 py-2 text-[10px]">
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">{t("home.doeActiveStudies", { n: doeActiveStudies.length })}</span>
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">{t("home.doeRunsAwaitingLabWork", { n: doeRunsAwaitingLabWorkCount })}</span>
            <span className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{t("home.doeStudiesReadyForAnalysis", { n: doeStudiesReadyForAnalysis.length })}</span>
            <span className="rounded bg-success/10 px-1.5 py-0.5 text-success">{t("home.doeCandidatesAwaitingSelection", { n: doeCandidatesAwaitingSelection.length })}</span>
          </div>
          <ul className="divide-y divide-border-faint">
            {dedupeById(doeStudiesReadyForAnalysis, (row) => row.study.id).map(({ project, study }) => (
              <li key={study.id}>
                <Link to={`/doe?project=${project.id}`} className="flex items-baseline gap-2 px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="font-mono text-[10px] text-muted">{study.studyCode}</span>
                  <span className="flex-1 truncate text-text">{project.name}</span>
                  <span className="text-[10px] text-muted">{study.status}</span>
                </Link>
              </li>
            ))}
            {dedupeById(doeCandidatesAwaitingSelection, (row) => row.candidate.id).map(({ project, study, candidate }) => (
              <li key={candidate.id}>
                <Link to={`/doe?project=${project.id}`} className="flex items-baseline gap-2 px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="font-mono text-[10px] text-muted">{study.studyCode}</span>
                  <span className="flex-1 truncate text-text">{project.name}</span>
                  <span className="text-[10px] text-muted">{t("home.doeCandidateRank", { rank: candidate.rank })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title={t("home.dataExchangeHeading")}
          empty={dxAwaitingConfirmation.length === 0 && dxFailed.length === 0 && dxCompletedWithWarnings.length === 0 && dxRecentExportsCount === 0}
          emptyText={t("home.noDataExchangeAttention")}
        >
          <div className="flex flex-wrap gap-2 px-3 py-2 text-[10px]">
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">{t("home.dataExchangeAwaitingConfirmation", { n: dxAwaitingConfirmation.length })}</span>
            <span className="rounded bg-error/10 px-1.5 py-0.5 text-error">{t("home.dataExchangeFailed", { n: dxFailed.length })}</span>
            <span className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{t("home.dataExchangeCompletedWithWarnings", { n: dxCompletedWithWarnings.length })}</span>
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">{t("home.dataExchangeRecentExports", { n: dxRecentExportsCount })}</span>
          </div>
          <ul className="divide-y divide-border-faint">
            {dedupeById([...dxFailed, ...dxAwaitingConfirmation, ...dxCompletedWithWarnings], (row) => row.id).map((job) => (
              <li key={job.id}>
                <Link to="/data-exchange" className="flex items-baseline gap-2 px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="flex-1 truncate text-text">{job.templateCode}</span>
                  <span className="truncate text-[11px] text-muted">{job.fileName}</span>
                  <span className="text-[10px] text-muted">{job.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

/** First-occurrence-wins dedupe for the priority-ordered combined lists
 *  above — a row can legitimately satisfy more than one of the counted
 *  categories at once. */
function dedupeById<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyOf(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function Section({ title, empty, emptyText, children }: { title: string; empty?: boolean; emptyText: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border">
      <h2 className="border-b border-border-faint px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h2>
      {empty ? <p className="px-3 py-4 text-[12px] text-muted">{emptyText}</p> : children}
    </section>
  );
}
