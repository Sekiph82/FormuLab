/**
 * Phase 5 — Design of Experiments workspace. First-class `/doe` route
 * (never a Formula Builder tab). A study is always bound to one exact
 * SAVED formula version — never a working draft, see
 * `engine/doeDesign.ts`'s `createDoeStudy`. Every coefficient, ANOVA row,
 * fit metric and candidate ranking shown here comes from
 * `engine/doeAnalysis.ts` / `engine/doeCandidates.ts` run against this
 * study's own recorded observations — nothing here is an AI-sourced or
 * fabricated number. See docs/DESIGN_OF_EXPERIMENTS.md.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChevronRight, FlaskConical, Grid3x3, History, Plus, Sparkles, Target } from "lucide-react";
import {
  APPROVAL_ROLES,
  DOE_CONSTRAINT_SEVERITIES,
  DOE_FACTOR_TYPES,
  DOE_IMPLEMENTED_DESIGN_TYPES,
  DOE_OBSERVATION_STATUSES,
  DOE_RESPONSE_OBJECTIVES,
  DOE_RESPONSE_TYPES,
  DOE_RUN_LOCKED_STATUSES,
  DOE_RUN_STATUSES,
  TRIAL_PRIORITIES,
  applyDoeCandidateToDraft,
  applyDoeFactorsToLines,
  calculateDesignDiagnostics,
  createDoeAnalysis,
  createDoeCandidates,
  createDoeStudy,
  deriveObservedCodedRanges,
  generateDoeDesign,
  isDoeStudyImmutable,
  newDoeId,
  predictDoeResponse,
  rankDoeCandidates,
  resolveDoeRevisionChain,
  reviseDoeStudy,
  buildDoeStudyExportMeta,
  doeAnalysisJsonPackage,
  doeAnovaCsvRows,
  doeCandidateListCsvRows,
  doeCoefficientsCsvRows,
  doeDesignMatrixCsvRows,
  doeObservationsCsvRows,
  doeRunSheetCsvRows,
  doeStudyJsonPackage,
  searchDoeCandidateSpace,
  snapshotFormulaForTrial,
  suggestOutliers,
  toCsv,
  validateDoeCandidate,
  validateDoeConstraints,
  validateDoeFactors,
  validateDoeResponses,
  type Actor,
  type AnalysisForPrediction,
  type ApprovalRole,
  type AuditEvent,
  type DoeAnalysis,
  type DoeCandidate,
  type DoeConstraint,
  type DoeConstraintSeverity,
  type DoeDesign,
  type DoeDesignType,
  type DoeFactor,
  type DoeFactorType,
  type DoeObservation,
  type DoeObservationStatus,
  type DoeResponse,
  type DoeResponseObjective,
  type DoeResponseType,
  type DoeRun,
  type DoeRunStatus,
  type DoeStudy,
  type DoeStudyStatus,
  type Formulation,
  type FormulationVersion,
  type LaboratoryTrial,
} from "@formulab/shared";
import { listRecords, upsertRecords } from "@/lib/masterdata";
import { appendAudit, auditEvent } from "@/lib/formulations";
import { cn } from "@/lib/cn";
import { InfoTooltip } from "@/components/help/InfoTooltip";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

const TOP_SECTIONS = ["studies", "design", "runs", "responses", "analysis", "candidates", "history", "audit"] as const;
type TopSection = (typeof TOP_SECTIONS)[number];

// eslint-disable-next-line i18next/no-literal-string -- enum values (DoeAnalysisType), not display text
const ANALYSIS_TYPE_OPTIONS = ["main_effects", "factorial", "quadratic_response_surface", "mixture_model"] as const;

const STUDY_STATUS_STYLE: Record<DoeStudyStatus, string> = {
  draft: "bg-surface-2 text-muted",
  design_ready: "bg-surface-2 text-muted",
  runs_generated: "bg-accent/10 text-accent",
  in_progress: "bg-accent/10 text-accent",
  data_complete: "bg-accent/10 text-accent",
  analysis_ready: "bg-warn/10 text-warn",
  analyzed: "bg-success/10 text-success",
  candidate_selected: "bg-success/10 text-success",
  completed: "bg-success/10 text-success",
  cancelled: "bg-error/10 text-error",
  superseded: "bg-surface-2 text-muted",
  archived: "bg-surface-2 text-muted",
};

const RUN_STATUS_STYLE: Record<DoeRunStatus, string> = {
  planned: "bg-surface-2 text-muted",
  prepared: "bg-surface-2 text-muted",
  trial_created: "bg-accent/10 text-accent",
  in_progress: "bg-accent/10 text-accent",
  completed: "bg-success/10 text-success",
  failed: "bg-error/10 text-error",
  excluded: "bg-error/10 text-error",
  cancelled: "bg-error/10 text-error",
};

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJson(filename: string, data: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
}

function downloadCsv(filename: string, table: { headers: string[]; rows: Record<string, unknown>[] }) {
  downloadBlob(filename, new Blob([toCsv(table.headers, table.rows)], { type: "text/csv;charset=utf-8" }));
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", className)}>{children}</span>;
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-text">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// --------------------------------------------------------------- charts ---
// Plain inline SVG, following the same minimal convention as
// StabilityPanel.tsx's trend sparkline — no charting library.

function BarChart({ bars, height = 140, negativeAllowed = false }: { bars: { label: string; value: number }[]; height?: number; negativeAllowed?: boolean }) {
  if (bars.length === 0) return null;
  const width = Math.max(220, bars.length * 46);
  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.value)), 1e-9);
  const zeroY = negativeAllowed ? height / 2 : height - 14;
  const barW = Math.min(32, (width / bars.length) * 0.6);
  return (
    <svg width={width} height={height + 16} role="img" aria-label="bar chart">
      <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="currentColor" className="text-border" strokeWidth={1} />
      {bars.map((b, i) => {
        const x = i * (width / bars.length) + (width / bars.length - barW) / 2;
        const usable = negativeAllowed ? height / 2 - 8 : height - 22;
        const h = (Math.abs(b.value) / maxAbs) * usable;
        const y = b.value >= 0 ? zeroY - h : zeroY;
        const isNeg = b.value < 0;
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={barW} height={Math.max(h, 1)} className={isNeg ? "fill-error/60" : "fill-accent/70"} rx={2} />
            <text x={x + barW / 2} y={height + 12} textAnchor="middle" className="fill-muted text-[9px]">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ScatterChart({ points, diagonal, width = 240, height = 180 }: { points: { x: number; y: number; label?: string }[]; diagonal?: boolean; width?: number; height?: number }) {
  if (points.length === 0) return <p className="text-[11px] text-muted">—</p>;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs, diagonal ? Math.min(...ys) : Infinity);
  const maxX = Math.max(...xs, diagonal ? Math.max(...ys) : -Infinity);
  const minY = diagonal ? minX : Math.min(...ys);
  const maxY = diagonal ? maxX : Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const pad = 20;
  const sx = (v: number) => pad + ((v - minX) / spanX) * (width - pad * 2);
  const sy = (v: number) => height - pad - ((v - minY) / spanY) * (height - pad * 2);
  return (
    <svg width={width} height={height} role="img" aria-label="scatter chart">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" className="text-border" />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="currentColor" className="text-border" />
      {diagonal && <line x1={sx(minX)} y1={sy(minX)} x2={sx(maxX)} y2={sy(maxX)} className="stroke-muted" strokeDasharray="3,3" />}
      {!diagonal && <line x1={pad} y1={sy(0)} x2={width - pad} y2={sy(0)} className="stroke-muted" strokeDasharray="3,3" />}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3} className="fill-accent" />
      ))}
    </svg>
  );
}

/** Rational approximation of the inverse standard-normal CDF (Acklam's
 *  algorithm) — used only to place points on the x-axis of the normal
 *  probability plot; not used anywhere in the statistical engine itself. */
function inverseNormalCdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - plow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function NormalProbabilityChart({ residuals }: { residuals: number[] }) {
  if (residuals.length < 3) return <p className="text-[11px] text-muted">—</p>;
  const sorted = [...residuals].sort((a, b) => a - b);
  const n = sorted.length;
  const points = sorted.map((r, i) => ({ x: inverseNormalCdf((i + 0.5) / n), y: r }));
  return <ScatterChart points={points} width={240} height={160} />;
}

/** A filled coded-space grid over exactly 2 numeric factors — an honest
 *  heatmap of `predictDoeResponse`'s own predictions, not a claim of
 *  smoothed isoline contours. */
function ResponseSurfaceHeatmap({ grid, size = 12 }: { grid: number[][]; size?: number }) {
  const flat = grid.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const span = max - min || 1;
  const cell = 14;
  return (
    <svg width={size * cell} height={size * cell} role="img" aria-label="response surface heatmap">
      {grid.map((row, yi) =>
        row.map((v, xi) => {
          const t = (v - min) / span;
          const hue = 220 - t * 220; // blue (low) -> red (high)
          return <rect key={`${xi}-${yi}`} x={xi * cell} y={(size - 1 - yi) * cell} width={cell} height={cell} fill={`hsl(${hue} 70% 50%)`} />;
        }),
      )}
    </svg>
  );
}

// --------------------------------------------------------- study wizard ---

interface WizardState {
  studyCode: string;
  title: string;
  description: string;
  baselineVersionId: string;
  factors: DoeFactor[];
  constraints: DoeConstraint[];
  responses: DoeResponse[];
  designType: DoeDesignType;
  replicatePolicy: DoeStudy["replicatePolicy"];
  centerPointPolicy: DoeStudy["centerPointPolicy"];
  centerPointCount: number;
  randomizationEnabled: boolean;
  blockingEnabled: boolean;
  seed: number;
}

function emptyWizard(): WizardState {
  return {
    studyCode: "",
    title: "",
    description: "",
    baselineVersionId: "",
    factors: [],
    constraints: [],
    responses: [],
    designType: "full_factorial",
    replicatePolicy: "none",
    centerPointPolicy: "none",
    centerPointCount: 3,
    randomizationEnabled: true,
    blockingEnabled: false,
    seed: 1,
  };
}

// eslint-disable-next-line i18next/no-literal-string -- internal step-id tokens, not display text (labels come from doe.wizard.* via `t`)
const WIZARD_STEPS = ["project", "objective", "factors", "constraints", "responses", "designType", "generationSettings", "preview", "confirm"] as const;
const WIZARD_FIRST_STEP = WIZARD_STEPS[0];

export function DoePanel({
  formulation,
  versions,
  auditLog,
  onApplyCandidateLines,
  onAuditChanged,
}: {
  formulation: Formulation;
  versions: FormulationVersion[];
  auditLog: AuditEvent[];
  onApplyCandidateLines: (materialQuantities: { materialId: string; quantity: string }[], note: string) => void;
  onAuditChanged: () => Promise<void>;
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;
  const navigate = useNavigate();

  const [studies, setStudies] = useState<DoeStudy[]>([]);
  const [factors, setFactors] = useState<DoeFactor[]>([]);
  const [constraints, setConstraints] = useState<DoeConstraint[]>([]);
  const [responses, setResponses] = useState<DoeResponse[]>([]);
  const [designs, setDesigns] = useState<DoeDesign[]>([]);
  const [runs, setRuns] = useState<DoeRun[]>([]);
  const [observations, setObservations] = useState<DoeObservation[]>([]);
  const [analyses, setAnalyses] = useState<DoeAnalysis[]>([]);
  const [candidates, setCandidates] = useState<DoeCandidate[]>([]);
  const [trials, setTrials] = useState<LaboratoryTrial[]>([]);

  const [topSection, setTopSection] = useState<TopSection>("studies");
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [actorRole, setActorRole] = useState<ApprovalRole>("researcher");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<(typeof WIZARD_STEPS)[number]>(WIZARD_FIRST_STEP);
  const [wizard, setWizard] = useState<WizardState>(emptyWizard());
  const [selectedResponseId, setSelectedResponseId] = useState<string | null>(null);
  const [selectedAnalysisType, setSelectedAnalysisType] = useState<"main_effects" | "factorial" | "quadratic_response_surface" | "mixture_model">("factorial");

  const actor: Actor = useMemo(() => ({ kind: "human", role: actorRole, userId: "local" }), [actorRole]);

  const load = async () => {
    const [st, fa, co, re, de, ru, ob, an, ca, tr] = await Promise.all([
      listRecords("doe_studies"),
      listRecords("doe_factors"),
      listRecords("doe_constraints"),
      listRecords("doe_responses"),
      listRecords("doe_designs"),
      listRecords("doe_runs"),
      listRecords("doe_observations"),
      listRecords("doe_analyses"),
      listRecords("doe_candidates"),
      listRecords("laboratory_trials"),
    ]);
    setStudies(st.filter((s) => s.formulationId === formulation.id));
    const studyIds = new Set(st.filter((s) => s.formulationId === formulation.id).map((s) => s.id));
    setFactors(fa.filter((f) => studyIds.has(f.studyId)));
    setConstraints(co.filter((c) => studyIds.has(c.studyId)));
    setResponses(re.filter((r) => studyIds.has(r.studyId)));
    setDesigns(de.filter((d) => studyIds.has(d.studyId)));
    setRuns(ru.filter((r) => studyIds.has(r.studyId)));
    setObservations(ob.filter((o) => studyIds.has(o.studyId)));
    setAnalyses(an.filter((a) => studyIds.has(a.studyId)));
    setCandidates(ca.filter((c) => studyIds.has(c.studyId)));
    setTrials(tr.filter((x) => x.projectId === formulation.id));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulation.id]);

  const selectedStudy = studies.find((s) => s.id === selectedStudyId) ?? null;
  const studyFactors = factors.filter((f) => selectedStudy && f.studyId === selectedStudy.id && f.studyRevision === selectedStudy.revision);
  const studyConstraints = constraints.filter((c) => selectedStudy && c.studyId === selectedStudy.id && c.studyRevision === selectedStudy.revision);
  const studyResponses = responses.filter((r) => selectedStudy && r.studyId === selectedStudy.id && r.studyRevision === selectedStudy.revision);
  const studyDesign = designs.filter((d) => selectedStudy && d.studyId === selectedStudy.id && d.studyRevision === selectedStudy.revision).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  const studyRuns = runs.filter((r) => studyDesign && r.designId === studyDesign.id).sort((a, b) => a.randomizedOrder - b.randomizedOrder);
  const studyAnalyses = analyses.filter((a) => selectedStudy && a.studyId === selectedStudy.id);
  const studyCandidates = candidates.filter((c) => selectedStudy && c.studyId === selectedStudy.id).sort((a, b) => a.rank - b.rank);

  async function record(action: string, opts: { versionId?: string; detail?: string; metadata?: Record<string, string> } = {}) {
    await appendAudit(auditEvent(formulation.id, action, { actor: "local", actorKind: "human", ...opts }));
  }

  // ------------------------------------------------------------ wizard ---
  function updateWizard<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setWizard((w) => ({ ...w, [key]: value }));
  }

  function wizardBaselineStatus(): string {
    const version = versions.find((v) => v.id === wizard.baselineVersionId);
    if (!version) return "";
    // A saved FormulationVersion's status is never the "draft" token — that
    // is reserved for a working draft, which is never a valid DOE baseline.
    return version.status;
  }

  async function commitWizard() {
    setError(null);
    try {
      const study = createDoeStudy(
        {
          studyCode: wizard.studyCode || `DOE-${Date.now().toString(36).toUpperCase()}`,
          title: wizard.title,
          description: wizard.description || undefined,
          projectId: formulation.id,
          formulationId: formulation.id,
          baselineFormulaVersionId: wizard.baselineVersionId,
          baselineFormulaVersionStatus: wizardBaselineStatus(),
          designType: wizard.designType,
          randomizationEnabled: wizard.randomizationEnabled,
          blockingEnabled: wizard.blockingEnabled,
          replicatePolicy: wizard.replicatePolicy,
          centerPointPolicy: wizard.centerPointPolicy,
        },
        actor,
      );
      const factorRows = wizard.factors.map((f) => ({ ...f, studyId: study.id, studyRevision: study.revision }));
      const constraintRows = wizard.constraints.map((c) => ({ ...c, studyId: study.id, studyRevision: study.revision }));
      const responseRows = wizard.responses.map((r) => ({ ...r, studyId: study.id, studyRevision: study.revision }));

      const generated = generateDoeDesign(
        {
          study,
          factors: factorRows,
          constraints: constraintRows,
          responses: responseRows,
          designType: wizard.designType,
          seed: wizard.seed,
          centerPointCount: wizard.centerPointCount,
        },
        actor,
      );

      const readyStudy: DoeStudy = { ...study, status: "runs_generated" };

      await upsertRecords("doe_studies", [readyStudy]);
      if (factorRows.length > 0) await upsertRecords("doe_factors", factorRows);
      if (constraintRows.length > 0) await upsertRecords("doe_constraints", constraintRows);
      if (responseRows.length > 0) await upsertRecords("doe_responses", responseRows);
      await upsertRecords("doe_designs", [generated.design]);
      await upsertRecords("doe_runs", generated.runs);

      await record("doe.study_created", { detail: study.title, metadata: { studyId: study.id } });
      for (const f of factorRows) await record("doe.factor_added", { metadata: { studyId: study.id, factorCode: f.factorCode } });
      for (const c of constraintRows) await record("doe.constraint_added", { metadata: { studyId: study.id, constraintType: c.constraintType } });
      for (const r of responseRows) await record("doe.response_added", { metadata: { studyId: study.id, responseCode: r.responseCode } });
      await record("doe.design_generated", { detail: wizard.designType, metadata: { studyId: study.id, designId: generated.design.id, runCount: String(generated.design.runCount) } });
      await record("doe.runs_randomized", { metadata: { studyId: study.id, designId: generated.design.id } });

      await onAuditChanged();
      await load();
      setSelectedStudyId(study.id);
      setTopSection("design");
      setWizardOpen(false);
      setWizard(emptyWizard());
      setWizardStep(WIZARD_FIRST_STEP);
    } catch (e) {
      setError(String(e));
    }
  }

  // ------------------------------------------------------------- runs ---
  async function setRunStatus(run: DoeRun, status: DoeRunStatus) {
    const updated: DoeRun = { ...run, status, startedAt: status === "in_progress" ? new Date().toISOString() : run.startedAt, completedAt: status === "completed" ? new Date().toISOString() : run.completedAt };
    await upsertRecords("doe_runs", [updated]);
    await record("doe.run_status_changed", { metadata: { studyId: run.studyId, runId: run.id, status } });
    await onAuditChanged();
    await load();
  }

  async function excludeRun(run: DoeRun, reason: string) {
    const updated: DoeRun = { ...run, status: "excluded", excludedAt: new Date().toISOString(), exclusionReason: reason };
    await upsertRecords("doe_runs", [updated]);
    await record("doe.run_excluded", { detail: reason, metadata: { studyId: run.studyId, runId: run.id } });
    await onAuditChanged();
    await load();
  }

  /** Builds a real `LaboratoryTrial` from the run's factor settings applied
   *  deterministically to the study's exact baseline saved version — never
   *  a different version, never a guessed composition. Fixed ingredients
   *  are preserved untouched; spec §9/§10. */
  async function generateTrialForRun(run: DoeRun) {
    if (!selectedStudy) return;
    setError(null);
    const baseline = versions.find((v) => v.id === selectedStudy.baselineFormulaVersionId);
    if (!baseline) {
      setError(t("doe.runs.baselineVersionMissing"));
      return;
    }
    const composition = applyDoeFactorsToLines(baseline.lines, run.factorSettings, studyFactors);
    const now = new Date().toISOString();
    const trial: LaboratoryTrial = {
      schemaVersion: "1.0",
      id: newDoeId("trial"),
      code: `${selectedStudy.studyCode}-R${run.runNumber}`,
      projectId: formulation.id,
      sourceType: "saved_version",
      sourceFormulaVersionId: baseline.id,
      formulaSnapshot: snapshotFormulaForTrial({ lines: composition.lines, basisBatchKg: baseline.basisBatchKg }),
      productFamilyId: formulation.productFamilyCode,
      targetPackagingSkuIds: [],
      title: `${selectedStudy.title} — run ${run.runNumber}`,
      objective: t("doe.runs.trialObjective", { study: selectedStudy.title }),
      batchSize: baseline.basisBatchKg,
      batchUnit: "kg",
      status: "planned",
      priority: TRIAL_PRIORITIES[1],
      equipmentIds: [],
      materialUsage: [],
      processSteps: [],
      observations: [],
      hasOpenCriticalDeviation: false,
      createdAt: now,
      createdBy: actor.kind === "human" ? actor.userId : "local",
      updatedAt: now,
      sourceDoeStudyId: selectedStudy.id,
      sourceDoeDesignId: run.designId,
      sourceDoeRunId: run.id,
    };
    await upsertRecords("laboratory_trials", [trial]);
    const updatedRun: DoeRun = { ...run, linkedTrialId: trial.id, linkedFormulaVersionId: baseline.id, status: "trial_created" };
    await upsertRecords("doe_runs", [updatedRun]);
    await record("doe.trials_generated", { metadata: { studyId: selectedStudy.id, runId: run.id, trialId: trial.id } });
    for (const w of composition.warnings) await record("doe.trials_generated", { detail: w, metadata: { studyId: selectedStudy.id, runId: run.id } });
    await onAuditChanged();
    await load();
  }

  async function linkExistingTrial(run: DoeRun, trialId: string) {
    const updatedRun: DoeRun = { ...run, linkedTrialId: trialId || undefined };
    await upsertRecords("doe_runs", [updatedRun]);
    if (trialId) await record("doe.trial_linked", { metadata: { studyId: run.studyId, runId: run.id, trialId } });
    await load();
  }

  // ------------------------------------------------------ observations ---
  async function recordObservation(run: DoeRun, response: DoeResponse, value: string, status: DoeObservationStatus, exclusionReason?: string) {
    const existing = observations.find((o) => o.runId === run.id && o.responseId === response.id);
    const now = new Date().toISOString();
    const row: DoeObservation = {
      schemaVersion: "1.0",
      id: existing?.id ?? newDoeId("doeobs"),
      studyId: run.studyId,
      studyRevision: run.studyRevision,
      runId: run.id,
      responseId: response.id,
      value: status === "missing" ? undefined : value,
      status,
      recordedBy: actor.kind === "human" ? actor.userId : "local",
      recordedAt: now,
      excludedAt: status === "excluded" ? now : undefined,
      exclusionReason: status === "excluded" ? exclusionReason : undefined,
    };
    await upsertRecords("doe_observations", [row]);
    const action = status === "excluded" ? "doe.observation_excluded" : existing ? "doe.observation_recorded" : "doe.observation_recorded";
    await record(action, { metadata: { studyId: run.studyId, runId: run.id, responseId: response.id, status } });
    await load();
  }

  // -------------------------------------------------------- analysis ---
  async function runAnalysis(response: DoeResponse) {
    if (!selectedStudy || !studyDesign) return;
    setError(null);
    try {
      const priorAnalysis = studyAnalyses.filter((a) => a.responseId === response.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const analysis = createDoeAnalysis(
        {
          studyId: selectedStudy.id,
          studyRevision: selectedStudy.revision,
          design: studyDesign,
          runs: studyRuns,
          observations,
          response,
          analysisType: selectedAnalysisType,
          supersedesAnalysisId: priorAnalysis?.id,
        },
        actor,
      );
      await upsertRecords("doe_analyses", [analysis]);
      await record(priorAnalysis ? "doe.analysis_superseded" : "doe.analysis_created", { metadata: { studyId: selectedStudy.id, analysisId: analysis.id, responseId: response.id } });
      const outliers = suggestOutliers(analysis.diagnostics);
      for (const o of outliers) await record("doe.outlier_flagged", { detail: o.reason, metadata: { studyId: selectedStudy.id, analysisId: analysis.id, runId: o.runId } });
      await onAuditChanged();
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  // ------------------------------------------------------- candidates ---
  async function generateCandidates() {
    if (!selectedStudy || !studyDesign) return;
    setError(null);
    try {
      const latestByResponse = new Map<string, DoeAnalysis>();
      for (const a of studyAnalyses) {
        const current = latestByResponse.get(a.responseId);
        if (!current || a.createdAt > current.createdAt) latestByResponse.set(a.responseId, a);
      }
      const analysesForPrediction: AnalysisForPrediction[] = [...latestByResponse.values()].map((a) => ({
        responseId: a.responseId,
        analysisId: a.id,
        terms: a.modelTerms,
        coefficients: a.coefficients.map((c) => c.estimate),
        observedCodedRanges: deriveObservedCodedRanges(studyRuns.filter((r) => a.includedRunIds.includes(r.id))),
      }));
      if (analysesForPrediction.length === 0) {
        setError(t("doe.candidates.noAnalysesYet"));
        return;
      }
      const raw = searchDoeCandidateSpace({
        factors: studyFactors,
        constraints: studyConstraints,
        responses: studyResponses,
        analyses: analysesForPrediction,
        seed: studyDesign.seed,
      });
      const ranked = rankDoeCandidates(raw).slice(0, 10);
      const created = createDoeCandidates({ studyId: selectedStudy.id, studyRevision: selectedStudy.revision, analysisIds: [...latestByResponse.values()].map((a) => a.id), ranked }, actor);
      await upsertRecords("doe_candidates", created);
      await record("doe.candidate_generated", { metadata: { studyId: selectedStudy.id, count: String(created.length) } });
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function shortlistCandidate(candidate: DoeCandidate) {
    const updated: DoeCandidate = { ...candidate, status: "shortlisted" };
    await upsertRecords("doe_candidates", [updated]);
    await record("doe.candidate_shortlisted", { metadata: { studyId: candidate.studyId, candidateId: candidate.id } });
    await load();
  }

  async function selectCandidate(candidate: DoeCandidate) {
    const updated: DoeCandidate = { ...candidate, status: "selected" };
    await upsertRecords("doe_candidates", [updated]);
    await record("doe.candidate_selected", { metadata: { studyId: candidate.studyId, candidateId: candidate.id } });
    await load();
  }

  function applyCandidate(candidate: DoeCandidate) {
    if (!studyDesign) return;
    const validation = validateDoeCandidate(candidate);
    if (!validation.valid) {
      setError(validation.issues.join(" "));
      return;
    }
    setError(null);
    setInfo(null);
    const application = applyDoeCandidateToDraft(candidate, studyFactors, studyDesign);
    if (application.materialQuantities.length === 0) {
      // Process-parameter-only candidates have nothing to write to a formula
      // line — applying them anyway would silently mark the candidate
      // "applied" while the draft never changed. Tell the user instead.
      const settings = application.processSettings.map((s) => `${s.key}=${s.value}${s.unit ?? ""}`).join(", ");
      setInfo(t("doe.candidates.noMaterialFactors", { settings: settings || "—" }));
      return;
    }
    onApplyCandidateLines(application.materialQuantities, `DOE candidate #${candidate.rank} (${selectedStudy?.title ?? ""})`);
    void (async () => {
      const updated: DoeCandidate = { ...candidate, status: "applied_to_draft", appliedDraftId: formulation.id, appliedAt: new Date().toISOString() };
      await upsertRecords("doe_candidates", [updated]);
      await record("doe.candidate_applied_to_draft", { metadata: { studyId: candidate.studyId, candidateId: candidate.id } });
      await load();
    })();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      {error && (
        <div className="rounded-card border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-card border border-border bg-surface-2 px-3 py-2 text-[12px] text-text">
          {info}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-input bg-surface-2 p-1">
          {TOP_SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setTopSection(s)}
              className={cn("rounded px-2.5 py-1 text-[12px] font-medium", topSection === s ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text")}
            >
              {t(`doe.sections.${s}`)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          {t("doe.actorRole")}
          <select value={actorRole} onChange={(e) => setActorRole(e.target.value as ApprovalRole)} className="rounded-input border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text">
            {APPROVAL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {topSection === "studies" && (
        <Section title={t("doe.studies.heading")} action={<button onClick={() => setWizardOpen(true)} className="flex items-center gap-1 rounded-input bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-foreground"><Plus size={13} /> {t("doe.studies.new")}</button>}>
          {studies.length === 0 ? (
            <p className="text-[12px] text-muted">{t("doe.studies.empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {studies.map((s) => (
                <li key={s.id} className={cn("flex cursor-pointer items-center justify-between py-2 px-1", selectedStudyId === s.id && "bg-surface-2")} onClick={() => setSelectedStudyId(s.id)}>
                  <div>
                    <div className="flex items-center gap-2 text-[12.5px] font-medium text-text">
                      <Grid3x3 size={13} className="text-muted" /> {s.title}
                      <span className="text-[10px] font-normal text-muted">{t("doe.studies.codeAndRevision", { code: s.studyCode, revision: s.revision })}</span>
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-muted">{s.designType}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={STUDY_STATUS_STYLE[s.status]}>{s.status}</Badge>
                    <ChevronRight size={14} className="text-muted" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {topSection === "design" && selectedStudy && (
        <DesignSection
          t={t}
          study={selectedStudy}
          design={studyDesign}
          factors={studyFactors}
          constraints={studyConstraints}
          responses={studyResponses}
          onRevise={async () => {
            if (!selectedStudy) return;
            const revised = reviseDoeStudy(selectedStudy, {}, actor);
            // eslint-disable-next-line i18next/no-literal-string -- persistence collection name and audit action code, not display text
            await upsertRecords("doe_studies", [revised]);
            // eslint-disable-next-line i18next/no-literal-string -- audit action code, not display text
            await record("doe.study_revised", { metadata: { studyId: revised.id, supersedes: selectedStudy.id } });
            await load();
            setSelectedStudyId(revised.id);
          }}
          onExportJson={() => {
            const meta = buildDoeStudyExportMeta(selectedStudy);
            const pkg = doeStudyJsonPackage(selectedStudy, meta, studyFactors, studyConstraints, studyResponses, studyDesign, studyRuns);
            downloadJson(`${selectedStudy.studyCode}.json`, pkg);
          }}
        />
      )}

      {topSection === "runs" && selectedStudy && (
        <Section
          title={t("doe.runs.heading")}
          action={
            studyDesign && (
              <div className="flex gap-2">
                <button onClick={() => downloadCsv(`${selectedStudy.studyCode}-design-matrix.csv`, doeDesignMatrixCsvRows(studyDesign, studyRuns))} className="rounded-input border border-border px-2 py-0.5 text-[10.5px] text-text hover:bg-surface-2">
                  {t("doe.runs.exportDesignMatrix")}
                </button>
                <button onClick={() => downloadCsv(`${selectedStudy.studyCode}-run-sheet.csv`, doeRunSheetCsvRows(studyDesign, studyRuns))} className="rounded-input border border-border px-2 py-0.5 text-[10.5px] text-text hover:bg-surface-2">
                  {t("doe.runs.exportRunSheet")}
                </button>
                <button onClick={() => downloadCsv(`${selectedStudy.studyCode}-observations.csv`, doeObservationsCsvRows(studyRuns, studyResponses, observations))} className="rounded-input border border-border px-2 py-0.5 text-[10.5px] text-text hover:bg-surface-2">
                  {t("doe.runs.exportObservations")}
                </button>
              </div>
            )
          }
        >
          {studyRuns.length === 0 ? (
            <p className="text-[12px] text-muted">{t("doe.runs.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1 pr-2">{t("doe.runs.order")}</th>
                    <th className="py-1 pr-2">{t("doe.runs.settings")}</th>
                    <th className="py-1 pr-2">{t("doe.runs.block")}</th>
                    <th className="py-1 pr-2">{t("doe.runs.status")}</th>
                    <th className="py-1 pr-2">{t("doe.runs.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {studyRuns.map((r) => (
                    <RunRow
                      key={r.id}
                      run={r}
                      responses={studyResponses}
                      observations={observations.filter((o) => o.runId === r.id)}
                      trials={trials}
                      onStatus={setRunStatus}
                      onExclude={excludeRun}
                      onObserve={recordObservation}
                      onGenerateTrial={() => void generateTrialForRun(r)}
                      onLinkTrial={(trialId) => void linkExistingTrial(r, trialId)}
                      t={t}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {topSection === "responses" && selectedStudy && (
        <Section
          title={t("doe.responses.heading")}
          action={<InfoTooltip title={t("doe.responses.infoTitle")} body={t("doe.responses.infoBody")} learnMoreTopicId="doe" />}
        >
          <ul className="divide-y divide-border">
            {studyResponses.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-[12px]">
                <div>
                  <span className="font-medium text-text">{r.name}</span>{" "}
                  <span className="text-muted">({r.responseType}, {r.objective})</span>
                </div>
                {r.lowerLimit && r.upperLimit && <span className="text-muted">{r.lowerLimit}–{r.upperLimit}</span>}
              </li>
            ))}
            {studyResponses.length === 0 && <p className="py-2 text-[12px] text-muted">{t("doe.responses.empty")}</p>}
          </ul>
        </Section>
      )}

      {topSection === "analysis" && selectedStudy && (
        <Section
          title={t("doe.analysis.heading")}
          action={
            <div className="flex items-center gap-2">
              <select value={selectedResponseId ?? ""} onChange={(e) => setSelectedResponseId(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text">
                <option value="">{t("doe.analysis.selectResponse")}</option>
                {studyResponses.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <select value={selectedAnalysisType} onChange={(e) => setSelectedAnalysisType(e.target.value as typeof selectedAnalysisType)} className="rounded-input border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text">
                {ANALYSIS_TYPE_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <button
                disabled={!selectedResponseId}
                onClick={() => {
                  const r = studyResponses.find((x) => x.id === selectedResponseId);
                  if (r) void runAnalysis(r);
                }}
                className="rounded-input bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-foreground disabled:opacity-40"
              >
                {t("doe.analysis.run")}
              </button>
            </div>
          }
        >
          <AnalysisResults t={t} analyses={studyAnalyses.filter((a) => !selectedResponseId || a.responseId === selectedResponseId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))} responses={studyResponses} factors={studyFactors} />
        </Section>
      )}

      {topSection === "candidates" && selectedStudy && (
        <Section
          title={t("doe.candidates.heading")}
          action={
            <div className="flex gap-2">
              <button onClick={() => downloadCsv(`${selectedStudy.studyCode}-candidates.csv`, doeCandidateListCsvRows(studyCandidates, studyResponses))} className="rounded-input border border-border px-2 py-0.5 text-[11px] text-text hover:bg-surface-2">
                {t("doe.candidates.exportCsv")}
              </button>
              <button onClick={() => void generateCandidates()} className="flex items-center gap-1 rounded-input bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-foreground">
                <Sparkles size={13} /> {t("doe.candidates.generate")}
              </button>
            </div>
          }
        >
          {studyCandidates.length === 0 ? (
            <p className="text-[12px] text-muted">{t("doe.candidates.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {studyCandidates.map((c) => (
                <li key={c.id} className="rounded-card border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[12px] font-medium text-text">
                      <Target size={13} className="text-muted" /> #{c.rank} · {t("doe.candidates.desirability")} {(c.desirability * 100).toFixed(0)}%
                    </div>
                    <Badge className={c.status === "applied_to_draft" ? "bg-success/10 text-success" : "bg-surface-2 text-muted"}>{c.status}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-muted">
                    {c.factorSettings.map((s) => (
                      <span key={s.factorCode}>
                        {s.factorCode}={s.actualValue}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-text">
                    {c.predictedResponses.map((p) => (
                      <span key={p.responseId} className={p.isExtrapolated ? "text-warn" : undefined}>
                        {studyResponses.find((r) => r.id === p.responseId)?.name ?? p.responseId}: {p.predictedValue.toFixed(2)}
                        {p.isExtrapolated ? ` (${t("doe.candidates.extrapolated")})` : ""}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void shortlistCandidate(c)} className="rounded-input border border-border px-2 py-0.5 text-[10.5px] text-text hover:bg-surface-2">
                      {t("doe.candidates.shortlist")}
                    </button>
                    <button onClick={() => void selectCandidate(c)} className="rounded-input border border-border px-2 py-0.5 text-[10.5px] text-text hover:bg-surface-2">
                      {t("doe.candidates.select")}
                    </button>
                    <button onClick={() => applyCandidate(c)} className="rounded-input bg-accent px-2 py-0.5 text-[10.5px] font-medium text-accent-foreground">
                      {t("doe.candidates.applyToDraft")}
                    </button>
                    <button onClick={() => navigate(`/optimization?project=${formulation.id}`)} className="ml-auto rounded-input border border-border px-2 py-0.5 text-[10.5px] text-muted hover:bg-surface-2">
                      {t("doe.candidates.openInOptimization")}
                    </button>
                    <button onClick={() => navigate(`/stability?project=${formulation.id}`)} className="rounded-input border border-border px-2 py-0.5 text-[10.5px] text-muted hover:bg-surface-2">
                      {t("doe.candidates.openInStability")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {topSection === "history" && selectedStudy && (
        <Section title={t("doe.history.heading")}>
          <ol className="space-y-1.5">
            {resolveDoeRevisionChain(selectedStudy, studies).map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[12px]">
                <History size={13} className="text-muted" />
                <span className={s.id === selectedStudy.id ? "font-semibold text-text" : "text-muted"}>
                  {t("doe.history.revisionRow", { revision: s.revision, title: s.title, status: s.status })}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {topSection === "audit" && (
        <Section title={t("doe.audit.heading")}>
          <ul className="space-y-1">
            {auditLog.filter((e) => e.action.startsWith("doe.")).slice(0, 200).map((e) => (
              <li key={e.id} className="flex items-center justify-between text-[11px] text-muted">
                <span className="text-text">{e.action}</span>
                <span>{new Date(e.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(topSection === "design" || topSection === "runs" || topSection === "responses" || topSection === "analysis" || topSection === "candidates" || topSection === "history") && !selectedStudy && (
        <p className="text-[12px] text-muted">{t("doe.selectStudyFirst")}</p>
      )}

      {wizardOpen && (
        <StudyWizard
          t={t}
          versions={versions}
          wizard={wizard}
          step={wizardStep}
          setStep={setWizardStep}
          update={updateWizard}
          onCancel={() => {
            setWizardOpen(false);
            setWizard(emptyWizard());
            setWizardStep(WIZARD_FIRST_STEP);
          }}
          onCommit={() => void commitWizard()}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------ subparts ---

function DesignSection({
  t,
  study,
  design,
  factors,
  constraints,
  responses,
  onRevise,
  onExportJson,
}: {
  t: SimpleT;
  study: DoeStudy;
  design: DoeDesign | undefined;
  factors: DoeFactor[];
  constraints: DoeConstraint[];
  responses: DoeResponse[];
  onRevise: () => void;
  onExportJson: () => void;
}) {
  return (
    <Section
      title={t("doe.design.heading")}
      action={
        <div className="flex gap-2">
          <button onClick={onExportJson} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
            {t("doe.design.exportJson")}
          </button>
          {!isDoeStudyImmutable(study.status) && (
            <button onClick={onRevise} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
              {t("doe.design.revise")}
            </button>
          )}
        </div>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-3 text-[11.5px]">
        <div>
          <p className="text-muted">{t("doe.design.factors")}</p>
          <ul>
            {factors.map((f) => (
              <li key={f.id} className="text-text">
                {f.factorCode} — {f.name} [{f.lowValue ?? f.categoricalLevels.join("/")}
                {f.highValue ? `, ${f.highValue}` : ""}]
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-muted">{t("doe.design.constraints")}</p>
          <ul>
            {constraints.map((c) => (
              <li key={c.id} className="text-text">
                {c.expression} ({c.severity})
              </li>
            ))}
            {constraints.length === 0 && <li className="text-muted">{t("doe.design.noConstraints")}</li>}
          </ul>
        </div>
      </div>
      <p className="mb-2 text-[11.5px] text-muted">
        {t("doe.design.responses")}: {responses.map((r) => r.name).join(", ") || "—"}
      </p>
      {design ? (
        <div className="rounded-card border border-border bg-surface-2 p-3 text-[11.5px]">
          <p className="font-medium text-text">
            {design.designType} — {design.runCount} {t("doe.design.runs")}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted sm:grid-cols-3">
            <span>{t("doe.design.centerPoints")}: {design.centerPointCount}</span>
            <span>{t("doe.design.replicates")}: {design.replicateCount}</span>
            <span>{t("doe.design.blocks")}: {design.blockCount}</span>
            <span>{t("doe.design.orthogonal")}: {String(design.diagnostics.isOrthogonal)}</span>
            <span>{t("doe.design.balanced")}: {String(design.diagnostics.isBalanced)}</span>
            {design.diagnostics.conditionNumber !== undefined && <span>{t("doe.design.conditionNumber")}: {design.diagnostics.conditionNumber.toFixed(2)}</span>}
          </div>
          {design.diagnostics.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-warn">
              {design.diagnostics.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-[11.5px] text-muted">{t("doe.design.noDesignYet")}</p>
      )}
    </Section>
  );
}

function RunRow({
  run,
  responses,
  observations,
  trials,
  onStatus,
  onExclude,
  onObserve,
  onGenerateTrial,
  onLinkTrial,
  t,
}: {
  run: DoeRun;
  responses: DoeResponse[];
  observations: DoeObservation[];
  trials: LaboratoryTrial[];
  onStatus: (run: DoeRun, status: DoeRunStatus) => void;
  onExclude: (run: DoeRun, reason: string) => void;
  onObserve: (run: DoeRun, response: DoeResponse, value: string, status: DoeObservationStatus, reason?: string) => void;
  onGenerateTrial: () => void;
  onLinkTrial: (trialId: string) => void;
  t: SimpleT;
}) {
  const [expanded, setExpanded] = useState(false);
  const locked = DOE_RUN_LOCKED_STATUSES.includes(run.status);
  return (
    <>
      <tr className="border-t border-border">
        <td className="py-1 pr-2 tabular-nums">
          {run.randomizedOrder} <span className="text-muted">({run.standardOrder})</span>
          {run.isCenterPoint && <Badge className="ml-1 bg-accent/10 text-accent">C</Badge>}
        </td>
        <td className="py-1 pr-2">
          <button onClick={() => setExpanded((e) => !e)} className="text-accent underline-offset-2 hover:underline">
            {run.factorSettings.map((s) => `${s.factorCode}=${s.actualValue}`).join(", ")}
          </button>
        </td>
        <td className="py-1 pr-2 tabular-nums">{run.block}</td>
        <td className="py-1 pr-2">
          <Badge className={RUN_STATUS_STYLE[run.status]}>{run.status}</Badge>
        </td>
        <td className="py-1 pr-2">
          <select value={run.status} onChange={(e) => onStatus(run, e.target.value as DoeRunStatus)} disabled={locked && run.status !== "in_progress"} className="rounded-input border border-border bg-surface px-1 py-0.5 text-[10.5px] text-text">
            {DOE_RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface-2">
          <td colSpan={5} className="p-2">
            <div className="space-y-1.5">
              {responses.map((r) => {
                const obs = observations.find((o) => o.responseId === r.id);
                return (
                  <ObservationRow key={r.id} response={r} observation={obs} onObserve={(value, status, reason) => onObserve(run, r, value, status, reason)} t={t} />
                );
              })}
              <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-2">
                {run.linkedTrialId ? (
                  <span className="text-[10.5px] text-muted">{t("doe.runs.linkedTrial")}: {trials.find((tr) => tr.id === run.linkedTrialId)?.code ?? run.linkedTrialId}</span>
                ) : (
                  <>
                    <button onClick={onGenerateTrial} className="rounded-input border border-border px-2 py-0.5 text-[10.5px] text-text hover:bg-surface">
                      {t("doe.runs.generateTrial")}
                    </button>
                    <label className="flex items-center gap-1.5 text-[10.5px] text-muted">
                      {t("doe.runs.linkExistingTrial")}
                      <select defaultValue="" onChange={(e) => onLinkTrial(e.target.value)} className="rounded-input border border-border bg-surface px-1 py-0.5 text-text">
                        <option value="">—</option>
                        {trials.map((tr) => (
                          <option key={tr.id} value={tr.id}>
                            {tr.code}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <button onClick={() => onExclude(run, t("doe.runs.excludedByUser"))} className="text-[10.5px] text-error hover:underline">
                  {t("doe.runs.excludeRun")}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ObservationRow({ response, observation, onObserve, t }: { response: DoeResponse; observation?: DoeObservation; onObserve: (value: string, status: DoeObservationStatus, reason?: string) => void; t: SimpleT }) {
  const [value, setValue] = useState(observation?.value ?? "");
  const [status, setStatus] = useState<DoeObservationStatus>(observation?.status ?? "recorded");
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-28 shrink-0 text-muted">{response.name}</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("doe.runs.value")} className="w-24 rounded-input border border-border bg-surface px-1.5 py-0.5 text-text" />
      <select value={status} onChange={(e) => setStatus(e.target.value as DoeObservationStatus)} className="rounded-input border border-border bg-surface px-1 py-0.5 text-text">
        {DOE_OBSERVATION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button onClick={() => onObserve(value, status)} className="rounded-input border border-border px-1.5 py-0.5 text-text hover:bg-surface">
        {t("doe.runs.save")}
      </button>
      {observation && <span className="text-muted">({observation.status})</span>}
    </div>
  );
}

/** Builds a size x size coded-space grid of `predictDoeResponse` predictions
 *  over exactly the first 2 non-mixture numeric factors in the model — an
 *  honest heatmap of the fitted response surface, only rendered when a
 *  quadratic response-surface model over exactly 2 such factors exists. */
function buildResponseSurfaceGrid(analysis: DoeAnalysis, factors: DoeFactor[], size = 12): { grid: number[][]; factorCodes: [string, string] } | null {
  const numeric = factors.filter((f) => f.factorType !== "categorical" && f.factorType !== "ordinal" && !f.isMixtureComponent);
  if (numeric.length !== 2) return null;
  const [fx, fy] = numeric;
  if (!analysis.modelTerms.includes(fx.factorCode) || !analysis.modelTerms.includes(fy.factorCode)) return null;
  const coefficients = analysis.coefficients.map((c) => c.estimate);
  const grid: number[][] = [];
  for (let yi = 0; yi < size; yi++) {
    const row: number[] = [];
    for (let xi = 0; xi < size; xi++) {
      const cx = -1 + (2 * xi) / (size - 1);
      const cy = -1 + (2 * yi) / (size - 1);
      const settings = [
        { factorCode: fx.factorCode, codedValue: cx.toString(), actualValue: cx.toString() },
        { factorCode: fy.factorCode, codedValue: cy.toString(), actualValue: cy.toString() },
      ];
      row.push(predictDoeResponse(analysis.modelTerms, coefficients, settings, {}).value);
    }
    grid.push(row);
  }
  return { grid, factorCodes: [fx.factorCode, fy.factorCode] };
}

function AnalysisResults({ analyses, responses, factors, t }: { analyses: DoeAnalysis[]; responses: DoeResponse[]; factors: DoeFactor[]; t: SimpleT }) {
  if (analyses.length === 0) return <p className="text-[12px] text-muted">{t("doe.analysis.empty")}</p>;
  return (
    <div className="space-y-4">
      {analyses.map((a) => {
        const response = responses.find((r) => r.id === a.responseId);
        const effectBars = a.effectEstimates.map((e) => ({ label: e.term, value: e.effect }));
        const scatterPoints = a.predictions.map((p) => ({ x: p.observed, y: p.predicted }));
        const residualPoints = a.diagnostics.map((d) => ({ x: d.predicted, y: d.residual }));
        const surface = a.analysisType === "quadratic_response_surface" ? buildResponseSurfaceGrid(a, factors) : null;
        return (
          <div key={a.id} className="rounded-card border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[12.5px] font-semibold text-text">
                {response?.name ?? a.responseId} — {a.analysisType}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-muted">{new Date(a.createdAt).toLocaleString()}</span>
                {response && (
                  <>
                    <button onClick={() => downloadJson(`${a.id}-analysis.json`, doeAnalysisJsonPackage(a, response))} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                      {t("doe.analysis.exportJson")}
                    </button>
                    <button onClick={() => downloadCsv(`${a.id}-coefficients.csv`, doeCoefficientsCsvRows(a))} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                      {t("doe.analysis.exportCoefficients")}
                    </button>
                    <button onClick={() => downloadCsv(`${a.id}-anova.csv`, doeAnovaCsvRows(a))} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2">
                      {t("doe.analysis.exportAnova")}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted sm:grid-cols-4">
              {a.fitMetrics.rSquared !== undefined && <span>{t("doe.analysis.rSquared")}: {a.fitMetrics.rSquared.toFixed(3)}</span>}
              {a.fitMetrics.adjustedRSquared !== undefined && <span>{t("doe.analysis.adjR2")}: {a.fitMetrics.adjustedRSquared.toFixed(3)}</span>}
              {a.fitMetrics.rmse !== undefined && <span>{t("doe.analysis.rmse")}: {a.fitMetrics.rmse.toFixed(3)}</span>}
              {a.fitMetrics.mae !== undefined && <span>{t("doe.analysis.mae")}: {a.fitMetrics.mae.toFixed(3)}</span>}
            </div>
            <div className="mb-2 overflow-x-auto">
              <table className="w-full text-[10.5px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="pr-2">{t("doe.analysis.term")}</th>
                    <th className="pr-2">{t("doe.analysis.estimate")}</th>
                    <th className="pr-2">SE</th>
                    <th className="pr-2">{t("doe.analysis.tStatistic")}</th>
                    <th className="pr-2">{t("doe.analysis.pValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {a.coefficients.map((c) => (
                    <tr key={c.term} className="border-t border-border">
                      <td className="py-0.5 pr-2 text-text">{c.term}</td>
                      <td className="py-0.5 pr-2 tabular-nums text-text">{c.estimate.toFixed(4)}</td>
                      <td className="py-0.5 pr-2 tabular-nums text-muted">{c.standardError?.toFixed(4) ?? "—"}</td>
                      <td className="py-0.5 pr-2 tabular-nums text-muted">{c.tStatistic?.toFixed(2) ?? "—"}</td>
                      <td className={cn("py-0.5 pr-2 tabular-nums", c.pValue !== undefined && c.pValue < 0.05 ? "text-success" : "text-muted")}>{c.pValue !== undefined ? c.pValue.toFixed(4) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="mb-1 text-[10.5px] text-muted">{t("doe.analysis.paretoChart")}</p>
                <BarChart bars={effectBars} negativeAllowed />
              </div>
              <div>
                <p className="mb-1 text-[10.5px] text-muted">{t("doe.analysis.predictedVsObserved")}</p>
                <ScatterChart points={scatterPoints} diagonal />
              </div>
              <div>
                <p className="mb-1 text-[10.5px] text-muted">{t("doe.analysis.residualVsPredicted")}</p>
                <ScatterChart points={residualPoints} />
              </div>
              <div>
                <p className="mb-1 text-[10.5px] text-muted">{t("doe.analysis.normalProbability")}</p>
                <NormalProbabilityChart residuals={a.diagnostics.map((d) => d.residual)} />
              </div>
              {surface && (
                <div>
                  <p className="mb-1 text-[10.5px] text-muted">
                    {t("doe.analysis.responseSurface")} ({surface.factorCodes[0]} × {surface.factorCodes[1]})
                  </p>
                  <ResponseSurfaceHeatmap grid={surface.grid} />
                </div>
              )}
            </div>
            {a.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[10.5px] text-warn">
                {a.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StudyWizard({
  t,
  versions,
  wizard,
  step,
  setStep,
  update,
  onCancel,
  onCommit,
}: {
  t: SimpleT;
  versions: FormulationVersion[];
  wizard: WizardState;
  step: (typeof WIZARD_STEPS)[number];
  setStep: (s: (typeof WIZARD_STEPS)[number]) => void;
  update: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const stepIndex = WIZARD_STEPS.indexOf(step);
  const factorIssues = validateDoeFactors(wizard.factors);
  const constraintIssues = validateDoeConstraints(wizard.constraints, wizard.factors);
  const responseIssues = validateDoeResponses(wizard.responses);

  let preview: { runCount: number; warnings: string[] } | null = null;
  if (step === "preview" && wizard.factors.length > 0 && factorIssues.length === 0) {
    try {
      const diagnostics = calculateDesignDiagnostics([], wizard.factors, wizard.constraints);
      preview = { runCount: diagnostics.runCount, warnings: diagnostics.warnings };
    } catch {
      preview = null;
    }
  }

  function addFactor() {
    update("factors", [
      ...wizard.factors,
      {
        schemaVersion: "1.0",
        id: newDoeId("doefactor"),
        studyId: "",
        studyRevision: 1,
        factorCode: `F${wizard.factors.length + 1}`,
        name: `Factor ${wizard.factors.length + 1}`,
        factorType: "continuous",
        sourceType: "process_parameter",
        sourceEntityId: `factor_${wizard.factors.length + 1}`,
        lowValue: "0",
        centerValue: "5",
        highValue: "10",
        categoricalLevels: [],
        transformation: "none",
        precision: 2,
        isMixtureComponent: false,
        isProcessFactor: true,
        isControlled: true,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  function addConstraint() {
    update("constraints", [
      ...wizard.constraints,
      {
        schemaVersion: "1.0",
        id: newDoeId("doeconstraint"),
        studyId: "",
        studyRevision: 1,
        constraintType: "custom",
        expression: wizard.factors[0] ? `${wizard.factors[0].factorCode} <= ${wizard.factors[0].highValue ?? "10"}` : "1 <= 2",
        severity: "hard",
        appliesTo: [],
        createdBy: "local",
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  function addResponse() {
    update("responses", [
      ...wizard.responses,
      {
        schemaVersion: "1.0",
        id: newDoeId("doeresponse"),
        studyId: "",
        studyRevision: 1,
        responseCode: `R${wizard.responses.length + 1}`,
        name: `Response ${wizard.responses.length + 1}`,
        responseType: "continuous",
        objective: "maximize",
        weight: "1",
        desirabilityShape: "linear",
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={t("doe.wizard.title")} className="max-h-[85vh] w-[min(760px,92vw)] overflow-y-auto rounded-card border border-border bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-text">{t("doe.wizard.title")}</h2>
          <span className="text-[11px] text-muted">
            {t("doe.wizard.step")} {stepIndex + 1}/{WIZARD_STEPS.length}
          </span>
        </div>

        {step === "project" && (
          <div className="space-y-2">
            <label className="block text-[11px] text-muted">
              {t("doe.wizard.baselineVersion")}
              <select value={wizard.baselineVersionId} onChange={(e) => update("baselineVersionId", e.target.value)} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text">
                <option value="">—</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {t("doe.wizard.versionOption", { version: v.versionNumber, status: v.status })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {step === "objective" && (
          <div className="space-y-2">
            <label className="block text-[11px] text-muted">
              {t("doe.wizard.studyCode")}
              <input value={wizard.studyCode} onChange={(e) => update("studyCode", e.target.value)} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text" />
            </label>
            <label className="block text-[11px] text-muted">
              {t("doe.wizard.title2")}
              <input value={wizard.title} onChange={(e) => update("title", e.target.value)} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text" />
            </label>
            <label className="block text-[11px] text-muted">
              {t("doe.wizard.description")}
              <textarea value={wizard.description} onChange={(e) => update("description", e.target.value)} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text" rows={2} />
            </label>
          </div>
        )}

        {step === "factors" && (
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-medium text-muted">{t("doe.wizard.factorsAndLevelsHeading")}</span>
              <InfoTooltip title={t("doe.wizard.factorsAndLevelsInfoTitle")} body={t("doe.wizard.factorsAndLevelsInfoBody")} learnMoreTopicId="doe" />
            </div>
            {wizard.factors.map((f, i) => (
              <div key={f.id} className="grid grid-cols-6 gap-1.5 rounded-input border border-border p-2 text-[11px]">
                <input value={f.factorCode} onChange={(e) => update("factors", wizard.factors.map((x, xi) => (xi === i ? { ...x, factorCode: e.target.value } : x)))} placeholder={t("doe.wizard.factorCode")} className="rounded-input border border-border bg-surface px-1.5 py-0.5" />
                <input value={f.name} onChange={(e) => update("factors", wizard.factors.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))} placeholder={t("doe.wizard.factorName")} className="col-span-2 rounded-input border border-border bg-surface px-1.5 py-0.5" />
                <select value={f.factorType} onChange={(e) => update("factors", wizard.factors.map((x, xi) => (xi === i ? { ...x, factorType: e.target.value as DoeFactorType } : x)))} className="rounded-input border border-border bg-surface px-1.5 py-0.5">
                  {DOE_FACTOR_TYPES.map((ft) => (
                    <option key={ft} value={ft}>
                      {ft}
                    </option>
                  ))}
                </select>
                <input value={f.lowValue ?? ""} onChange={(e) => update("factors", wizard.factors.map((x, xi) => (xi === i ? { ...x, lowValue: e.target.value } : x)))} placeholder={t("doe.wizard.lowValue")} className="rounded-input border border-border bg-surface px-1.5 py-0.5" />
                <input value={f.highValue ?? ""} onChange={(e) => update("factors", wizard.factors.map((x, xi) => (xi === i ? { ...x, highValue: e.target.value } : x)))} placeholder={t("doe.wizard.highValue")} className="rounded-input border border-border bg-surface px-1.5 py-0.5" />
              </div>
            ))}
            <button onClick={addFactor} className="text-[11px] text-accent hover:underline">
              + {t("doe.wizard.addFactor")}
            </button>
            {factorIssues.length > 0 && (
              <ul className="text-[10.5px] text-error">
                {factorIssues.map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === "constraints" && (
          <div className="space-y-2">
            {wizard.constraints.map((c, i) => (
              <div key={c.id} className="grid grid-cols-3 gap-1.5 rounded-input border border-border p-2 text-[11px]">
                <input value={c.expression} onChange={(e) => update("constraints", wizard.constraints.map((x, xi) => (xi === i ? { ...x, expression: e.target.value } : x)))} className="col-span-2 rounded-input border border-border bg-surface px-1.5 py-0.5" />
                <select value={c.severity} onChange={(e) => update("constraints", wizard.constraints.map((x, xi) => (xi === i ? { ...x, severity: e.target.value as DoeConstraintSeverity } : x)))} className="rounded-input border border-border bg-surface px-1.5 py-0.5">
                  {DOE_CONSTRAINT_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <button onClick={addConstraint} className="text-[11px] text-accent hover:underline">
              + {t("doe.wizard.addConstraint")}
            </button>
            {constraintIssues.length > 0 && (
              <ul className="text-[10.5px] text-error">
                {constraintIssues.map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === "responses" && (
          <div className="space-y-2">
            {wizard.responses.map((r, i) => (
              <div key={r.id} className="grid grid-cols-4 gap-1.5 rounded-input border border-border p-2 text-[11px]">
                <input value={r.name} onChange={(e) => update("responses", wizard.responses.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))} placeholder={t("doe.wizard.responseName")} className="rounded-input border border-border bg-surface px-1.5 py-0.5" />
                <select value={r.responseType} onChange={(e) => update("responses", wizard.responses.map((x, xi) => (xi === i ? { ...x, responseType: e.target.value as DoeResponseType } : x)))} className="rounded-input border border-border bg-surface px-1.5 py-0.5">
                  {DOE_RESPONSE_TYPES.map((rt) => (
                    <option key={rt} value={rt}>
                      {rt}
                    </option>
                  ))}
                </select>
                <select value={r.objective} onChange={(e) => update("responses", wizard.responses.map((x, xi) => (xi === i ? { ...x, objective: e.target.value as DoeResponseObjective } : x)))} className="rounded-input border border-border bg-surface px-1.5 py-0.5">
                  {DOE_RESPONSE_OBJECTIVES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input value={r.upperLimit ?? ""} onChange={(e) => update("responses", wizard.responses.map((x, xi) => (xi === i ? { ...x, upperLimit: e.target.value, lowerLimit: x.lowerLimit ?? "0" } : x)))} placeholder={t("doe.wizard.upperLimit")} className="rounded-input border border-border bg-surface px-1.5 py-0.5" />
              </div>
            ))}
            <button onClick={addResponse} className="text-[11px] text-accent hover:underline">
              + {t("doe.wizard.addResponse")}
            </button>
            {responseIssues.length > 0 && (
              <ul className="text-[10.5px] text-error">
                {responseIssues.map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === "designType" && (
          <label className="block text-[11px] text-muted">
            {t("doe.wizard.designType")}
            <select value={wizard.designType} onChange={(e) => update("designType", e.target.value as DoeDesignType)} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text">
              {DOE_IMPLEMENTED_DESIGN_TYPES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}

        {step === "generationSettings" && (
          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted">
            <label>
              {t("doe.wizard.centerPointCount")}
              <input type="number" value={wizard.centerPointCount} onChange={(e) => update("centerPointCount", Number(e.target.value))} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1 text-text" />
            </label>
            <label>
              {t("doe.wizard.seed")}
              <input type="number" value={wizard.seed} onChange={(e) => update("seed", Number(e.target.value))} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1 text-text" />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={wizard.randomizationEnabled} onChange={(e) => update("randomizationEnabled", e.target.checked)} />
              {t("doe.wizard.randomize")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={wizard.blockingEnabled} onChange={(e) => update("blockingEnabled", e.target.checked)} />
              {t("doe.wizard.blocking")}
            </label>
          </div>
        )}

        {step === "preview" && (
          <div className="text-[12px] text-text">
            {preview ? (
              <>
                <p>
                  {t("doe.wizard.estimatedRuns")}: {preview.runCount || "—"}
                </p>
                {preview.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[10.5px] text-warn">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>⚠ {w}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-muted">{t("doe.wizard.previewUnavailable")}</p>
            )}
          </div>
        )}

        {step === "confirm" && (
          <div className="text-[12px] text-text">
            <p className="font-medium">{wizard.title || wizard.studyCode}</p>
            <p className="mt-1 text-muted">
              {wizard.factors.length} {t("doe.wizard.factors")}, {wizard.constraints.length} {t("doe.wizard.constraints")}, {wizard.responses.length} {t("doe.wizard.responses")}, {wizard.designType}
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button onClick={onCancel} className="rounded-input border border-border px-3 py-1 text-[12px] text-text hover:bg-surface-2">
            {t("doe.wizard.cancel")}
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button onClick={() => setStep(WIZARD_STEPS[stepIndex - 1])} className="rounded-input border border-border px-3 py-1 text-[12px] text-text hover:bg-surface-2">
                {t("doe.wizard.back")}
              </button>
            )}
            {stepIndex < WIZARD_STEPS.length - 1 ? (
              <button onClick={() => setStep(WIZARD_STEPS[stepIndex + 1])} className="rounded-input bg-accent px-3 py-1 text-[12px] font-medium text-accent-foreground">
                {t("doe.wizard.next")}
              </button>
            ) : (
              <button onClick={onCommit} disabled={!wizard.baselineVersionId || wizard.factors.length === 0 || wizard.responses.length === 0} className="flex items-center gap-1 rounded-input bg-accent px-3 py-1 text-[12px] font-medium text-accent-foreground disabled:opacity-40">
                <FlaskConical size={13} /> {t("doe.wizard.generate")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
