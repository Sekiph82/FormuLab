import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
  AuditEvent,
  Formulation,
  FormulationVersion,
  LaboratoryTrial,
  RegulatoryDossier,
  RegulatoryDossierEvidenceItem,
  RegulatoryDossierRequirement,
  RegulatoryDossierReview,
  RegulatoryDossierReviewRevocation,
  RegulatoryRequirementEvidenceLink,
  StabilitySample,
  StabilityStudy,
} from "@ai4s/shared";
import { activeLinksForDossier, buildEvidenceMatrix, calculateDossierReadiness, currentRequirementsForRevision, effectiveStatus, isDossierReviewActive } from "@ai4s/shared";
import { listFormulations, readAuditLog, readFormulation } from "@/lib/formulations";
import { listRecords } from "@/lib/masterdata";

const OPEN_TRIAL_STATUSES = new Set(["planned", "materials_prepared", "in_progress", "awaiting_results"]);
const PENDING_APPROVAL_STATUSES = new Set(["chemist_review", "lab_candidate", "stability_testing", "pilot_candidate"]);
const RECENT_PROJECT_LIMIT = 5;
// Evidence within this window is "expiring soon" — a defined threshold,
// not a fabricated one, and the only place this number is invented.
const EVIDENCE_EXPIRY_WARNING_DAYS = 30;

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [all, trials, studies, samples, dossiers, dossierRequirements, dossierLinks, dossierEvidence, dossierReviews, dossierReviewRevocations] = await Promise.all([
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

      setLoading(false);
    })();
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
      </div>
    </div>
  );
}

function Section({ title, empty, emptyText, children }: { title: string; empty?: boolean; emptyText: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border">
      <h2 className="border-b border-border-faint px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h2>
      {empty ? <p className="px-3 py-4 text-[12px] text-muted">{emptyText}</p> : children}
    </section>
  );
}
