import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskRound, Plus } from "lucide-react";
import {
  buildStabilityExportMeta,
  buildTestRequirementSnapshot,
  canTransitionStability,
  computeStabilityTrend,
  correctiveActionReportRows,
  createCorrectiveAction,
  isTestDefinitionApplicable,
  computeReplicateStats,
  erpLabResultDraftCsv,
  evaluateNumericResultPassFail,
  generateStabilitySamples,
  newId,
  refreshSampleDueStates,
  resolveStabilityFailure,
  samplePlanCsvRows,
  snapshotFormulaForTrial,
  stabilityProtocolJson,
  stabilitySummaryReportRows,
  testResultReportRows,
  timePointReportRows,
  toCsv,
  SEED_STABILITY_CONDITIONS,
  SEED_STABILITY_TIME_POINTS,
  SEED_TEST_DEFINITIONS,
  STABILITY_FAILURE_TYPES,
  STABILITY_STUDY_STATUSES,
  type Actor,
  type AttachmentReference,
  type CorrectiveAction,
  type Formulation,
  type FormulationLine,
  type FormulationVersion,
  type FormulaStatus,
  type PackagingBom,
  type StabilityFailure,
  type StabilityFailureType,
  type StabilityResult,
  type StabilitySample,
  type StabilityStudy,
  type StabilityStudyStatus,
  type TestDefinition,
} from "@ai4s/shared";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";
import { AttachmentField } from "./AttachmentField";
import { downloadBlob, downloadText } from "@/lib/download";
import { buildXlsxBlob } from "@/lib/xlsx";

const LOCAL_HUMAN: Actor = { kind: "human", role: "chemist", userId: "local" };

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

export function StabilityPanel({
  formulation,
  currentLines,
  basisBatchKg,
  baseVersion,
  approvalStatus,
  packagingBoms,
  onApplyDraft,
}: {
  formulation: Formulation;
  currentLines: FormulationLine[];
  basisBatchKg: string;
  baseVersion?: FormulationVersion;
  approvalStatus: FormulaStatus;
  packagingBoms: PackagingBom[];
  onApplyDraft: (lines: FormulationLine[], basisBatchKg: string, note: string) => void;
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;
  const [studies, setStudies] = useState<StabilityStudy[]>([]);
  const [samples, setSamples] = useState<StabilitySample[]>([]);
  const [results, setResults] = useState<StabilityResult[]>([]);
  const [failures, setFailures] = useState<StabilityFailure[]>([]);
  const [testDefinitions, setTestDefinitions] = useState<TestDefinition[]>([]);
  const [correctiveActions, setCorrectiveActions] = useState<CorrectiveAction[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [selectedConditionIds, setSelectedConditionIds] = useState<Set<string>>(new Set());
  const [selectedTimePointIds, setSelectedTimePointIds] = useState<Set<string>>(new Set());
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [packagingSkuCode, setPackagingSkuCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [st, sm, rs, fl, td, ca] = await Promise.all([
      listRecords("stability_studies"),
      listRecords("stability_samples"),
      listRecords("stability_results"),
      listRecords("stability_failures"),
      listRecordsSeeded("test_definitions", SEED_TEST_DEFINITIONS),
      listRecords("corrective_actions"),
    ]);
    setStudies(st.filter((s) => s.projectId === formulation.id));
    setSamples(sm);
    setResults(rs);
    setFailures(fl);
    setTestDefinitions(td);
    setCorrectiveActions(ca);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulation.id]);

  const selectedStudy = studies.find((s) => s.id === selectedStudyId) ?? null;
  const allStudySamples = samples.filter((s) => s.studyId === selectedStudyId);
  const studyFailures = failures.filter((f) => f.studyId === selectedStudyId);
  const openCriticalFailures = studyFailures.filter((f) => f.severity === "critical" && f.investigationStatus !== "closed");

  // Refresh due/overdue status for this study's samples whenever the study
  // selection changes — a deterministic function of dueDate vs. today, never
  // a guess; only samples whose state actually changed are written back.
  useEffect(() => {
    if (!selectedStudyId) return;
    const mine = samples.filter((s) => s.studyId === selectedStudyId);
    const updates = refreshSampleDueStates(mine);
    if (updates.length === 0) return;
    void upsertRecords("stability_samples", updates).then(() => {
      setSamples((prev) => prev.map((s) => updates.find((u) => u.id === s.id) ?? s));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudyId]);

  const persistStudy = async (study: StabilityStudy) => {
    await upsertRecords("stability_studies", [study]);
    setStudies((prev) => (prev.some((x) => x.id === study.id) ? prev.map((x) => (x.id === study.id ? study : x)) : [...prev, study]));
  };

  const createStudy = async () => {
    if (!newTitle.trim() || !packagingSkuCode.trim()) {
      setError(t("stability.needTitleAndSku"));
      return;
    }
    setError(null);
    const now = new Date().toISOString();
    const bom = packagingBoms.find((b) => b.skuCode === packagingSkuCode);
    const applicabilityCtx = {
      productFamilyId: formulation.productFamilyCode,
      context: "stability" as const,
      packagingSkuCodes: [packagingSkuCode],
      conditionCodes: SEED_STABILITY_CONDITIONS.filter((c) => selectedConditionIds.has(c.id)).map((c) => c.code),
      timePointCodes: SEED_STABILITY_TIME_POINTS.filter((tp) => selectedTimePointIds.has(tp.id)).map((tp) => tp.code),
    };
    const manualTestAdditions = testDefinitions
      .filter((d) => selectedTestIds.has(d.code) && !isTestDefinitionApplicable(d, applicabilityCtx))
      .map((d) => ({ definition: d, addedBy: "local" }));
    const study: StabilityStudy = {
      schemaVersion: "1.0",
      id: newId("study"),
      code: newId("STUDY"),
      projectId: formulation.id,
      sourceType: baseVersion ? "saved_version" : "working_draft",
      sourceFormulaVersionId: baseVersion?.id,
      sourceDraftId: baseVersion ? undefined : formulation.id,
      formulaSnapshot: snapshotFormulaForTrial({ lines: currentLines, basisBatchKg }),
      productFamilyId: formulation.productFamilyCode,
      packagingSkuCode,
      packagingSnapshot: {
        skuCode: packagingSkuCode,
        bomCode: bom?.code,
        lines: (bom?.lines ?? []).map((l) => ({ componentCode: l.componentCode, quantityPerUnit: l.quantityPerUnit })),
        fillQuantity: bom?.fillQuantity,
        fillUnit: bom?.fillUnit,
        fillLossPercent: bom?.fillLossPercent,
        capturedAt: now,
      },
      title: newTitle.trim(),
      owner: "local",
      status: "planned",
      conditionIds: [...selectedConditionIds],
      timePointIds: [...selectedTimePointIds],
      requiredTestDefinitionIds: [...selectedTestIds],
      testRequirementSnapshot: buildTestRequirementSnapshot(testDefinitions, applicabilityCtx, manualTestAdditions),
      replicatesPerPullPoint: 1,
      hasOpenCriticalFailure: false,
      createdAt: now,
      createdBy: "local",
      updatedAt: now,
    };
    await persistStudy(study);
    setSelectedStudyId(study.id);
    setNewTitle("");
  };

  const transitionStudy = async (study: StabilityStudy, to: StabilityStudyStatus) => {
    setError(null);
    const result = canTransitionStability(study.status, to, LOCAL_HUMAN, { openCriticalFailures: studyFailures });
    if (!result.allowed) {
      setError(result.message ?? t("stability.transitionRejected"));
      return;
    }
    const now = new Date().toISOString();
    let updated: StabilityStudy = { ...study, status: to, updatedAt: now };
    if (to === "active" && !study.startDate) updated = { ...updated, startDate: now };
    if (to === "completed") updated = { ...updated, completedAt: now };
    await persistStudy(updated);
  };

  const generateSamples = async () => {
    if (!selectedStudy) return;
    setError(null);
    try {
      const conditions = SEED_STABILITY_CONDITIONS.filter((c) => selectedStudy.conditionIds.includes(c.id));
      const timePoints = SEED_STABILITY_TIME_POINTS.filter((tp) => selectedStudy.timePointIds.includes(tp.id));
      const generated = generateStabilitySamples(selectedStudy, conditions, timePoints);
      await upsertRecords("stability_samples", generated);
      setSamples((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        return [...prev, ...generated.filter((s) => !existingIds.has(s.id))];
      });
    } catch (e) {
      setError(String(e));
    }
  };

  const exportStudyProtocolJson = (study: StabilityStudy) => {
    const meta = buildStabilityExportMeta(study, approvalStatus);
    const conditions = SEED_STABILITY_CONDITIONS.filter((c) => study.conditionIds.includes(c.id)).map((c) => ({ id: c.id, code: c.code, label: c.label }));
    const timePoints = SEED_STABILITY_TIME_POINTS.filter((tp) => study.timePointIds.includes(tp.id)).map((tp) => ({ id: tp.id, code: tp.code, label: tp.label, daysFromStart: tp.daysFromStart }));
    const pkg = stabilityProtocolJson(study, meta, { conditions, timePoints });
    downloadText(`${study.code}-protocol.json`, JSON.stringify(pkg, null, 2), "application/json");
  };

  const exportSamplePlanCsv = (study: StabilityStudy) => {
    const mine = samples.filter((s) => s.studyId === study.id);
    const { headers, rows } = samplePlanCsvRows(mine);
    downloadText(`${study.code}-sample-plan.csv`, toCsv(headers, rows), "text/csv;charset=utf-8");
  };

  const exportTimePointReportXlsx = async (study: StabilityStudy) => {
    const mine = samples.filter((s) => s.studyId === study.id);
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.sampleId, (counts.get(r.sampleId) ?? 0) + 1);
    const { headers, rows } = timePointReportRows(mine, counts);
    downloadBlob(`${study.code}-time-points.xlsx`, await buildXlsxBlob(headers, rows, "Time Points"));
  };

  const exportSummaryReportXlsx = async (study: StabilityStudy) => {
    const mine = samples.filter((s) => s.studyId === study.id);
    const mineFailures = failures.filter((f) => f.studyId === study.id);
    const { headers, rows } = stabilitySummaryReportRows(study, mine, mineFailures);
    downloadBlob(`${study.code}-summary.xlsx`, await buildXlsxBlob(headers, rows, "Summary"));
  };

  const exportTestResultsXlsx = async (study: StabilityStudy) => {
    const mine = results.filter((r) => r.studyId === study.id);
    const { headers, rows } = testResultReportRows(mine, testDefinitions);
    downloadBlob(`${study.code}-test-results.xlsx`, await buildXlsxBlob(headers, rows, "Test Results"));
  };

  const exportCorrectiveActionsCsv = (study: StabilityStudy) => {
    const mine = correctiveActions.filter((a) => a.sourceRecordId === study.id);
    const { headers, rows } = correctiveActionReportRows(mine);
    downloadText(`${study.code}-corrective-actions.csv`, toCsv(headers, rows), "text/csv;charset=utf-8");
  };

  const exportErpDraftCsv = (study: StabilityStudy) => {
    const mine = results.filter((r) => r.studyId === study.id);
    downloadText(`${study.code}-erp-draft-lab-results.csv`, erpLabResultDraftCsv(mine, testDefinitions, { recordLabel: study.code, approvalStatus }), "text/csv;charset=utf-8");
  };

  const recordResult = async (sample: StabilitySample, definition: TestDefinition, values: string[], attachments: AttachmentReference[] = []) => {
    const numericValues = values.filter((v) => v.trim() !== "");
    if (numericValues.length === 0 || !selectedStudy) return;
    const replicates = numericValues.map((v, i) => ({ replicateNumber: i + 1, numericValue: v, isOutlier: false }));
    const stats = computeReplicateStats(replicates);
    const passFail = evaluateNumericResultPassFail(definition, stats);
    const now = new Date().toISOString();
    const result: StabilityResult = {
      schemaVersion: "1.0",
      id: newId("stabresult"),
      studyId: selectedStudy.id,
      sampleId: sample.id,
      conditionId: sample.conditionId,
      timePointId: sample.timePointId,
      testDefinitionId: definition.code,
      resultType: "numeric",
      replicates,
      attachments,
      stats,
      passFail,
      unit: definition.unit,
      performedBy: "local",
      performedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await upsertRecords("stability_results", [result]);
    setResults((prev) => (prev.some((r) => r.id === result.id) ? prev : [...prev, result]));
    const updatedSample: StabilitySample = { ...sample, status: "completed" };
    await upsertRecords("stability_samples", [updatedSample]);
    setSamples((prev) => prev.map((s) => (s.id === sample.id ? updatedSample : s)));

    if (passFail === "fail") {
      const failure: StabilityFailure = {
        schemaVersion: "1.0",
        id: newId("stabfail"),
        studyId: selectedStudy.id,
        sampleId: sample.id,
        conditionId: sample.conditionId,
        timePointId: sample.timePointId,
        testResultId: result.id,
        type: "out_of_specification",
        severity: definition.criticalTestFlag ? "critical" : "major",
        description: t("stability.autoFailureDescription", { test: definition.name }),
        investigationStatus: "open",
        correctiveActionIds: [],
        createdAt: now,
        updatedAt: now,
      };
      await upsertRecords("stability_failures", [failure]);
      setFailures((prev) => (prev.some((f) => f.id === failure.id) ? prev : [...prev, failure]));
      if (failure.severity === "critical") {
        await persistStudy({ ...selectedStudy, hasOpenCriticalFailure: true, updatedAt: now });
      }
    }
  };

  const updateFailureAttachments = async (failure: StabilityFailure, attachments: AttachmentReference[]) => {
    const updated = { ...failure, attachments, updatedAt: new Date().toISOString() };
    await upsertRecords("stability_failures", [updated]);
    setFailures((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  };

  const resolveFailure = async (failure: StabilityFailure, notes: string) => {
    if (!notes.trim()) return;
    const updated = resolveStabilityFailure(failure, LOCAL_HUMAN, notes.trim());
    await upsertRecords("stability_failures", [updated]);
    setFailures((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    if (selectedStudy) {
      const stillOpen = failures.map((f) => (f.id === updated.id ? updated : f)).some((f) => f.studyId === selectedStudy.id && f.severity === "critical" && f.investigationStatus !== "closed");
      await persistStudy({ ...selectedStudy, hasOpenCriticalFailure: stillOpen, updatedAt: new Date().toISOString() });
    }
  };

  const createFailureCorrectiveAction = async (failure: StabilityFailure, title: string, problemStatement: string) => {
    if (!title.trim() || !problemStatement.trim() || !selectedStudy) return;
    const action = createCorrectiveAction(
      { projectId: formulation.id, sourceType: "stability_failure", sourceRecordId: selectedStudy.id, deviationOrFailureId: failure.id, title: title.trim(), problemStatement: problemStatement.trim(), actionType: "other", owner: "local" },
      LOCAL_HUMAN,
    );
    await upsertRecords("corrective_actions", [action]);
    setCorrectiveActions((prev) => (prev.some((a) => a.id === action.id) ? prev : [...prev, action]));
    const updatedFailure = { ...failure, correctiveActionIds: [...failure.correctiveActionIds, action.id], updatedAt: new Date().toISOString() };
    await upsertRecords("stability_failures", [updatedFailure]);
    setFailures((prev) => prev.map((f) => (f.id === updatedFailure.id ? updatedFailure : f)));
  };

  const applyDraftFromFailure = (action: CorrectiveAction) => {
    if (!baseVersion) {
      setError(t("trials.correctiveActionNeedsVersion"));
      return;
    }
    onApplyDraft(baseVersion.lines.map((l) => ({ ...l })), baseVersion.basisBatchKg, t("stability.draftFromFailure", { code: action.code }));
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-64 shrink-0 overflow-auto border-r border-border">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-[12px] font-medium text-text">{t("stability.heading")}</h3>
        </div>
        <div className="space-y-1.5 border-b border-border-faint px-3 py-2">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t("stability.newTitlePlaceholder")} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
          <input value={packagingSkuCode} onChange={(e) => setPackagingSkuCode(e.target.value)} placeholder={t("stability.skuPlaceholder")} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
          <div>
            <span className="text-[10px] text-muted">{t("stability.conditions")}</span>
            <select multiple value={[...selectedConditionIds]} onChange={(e) => setSelectedConditionIds(new Set(Array.from(e.target.selectedOptions, (o) => o.value)))} className="h-16 w-full rounded-input border border-border bg-surface text-[11px]">
              {SEED_STABILITY_CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-[10px] text-muted">{t("stability.timePoints")}</span>
            <select multiple value={[...selectedTimePointIds]} onChange={(e) => setSelectedTimePointIds(new Set(Array.from(e.target.selectedOptions, (o) => o.value)))} className="h-16 w-full rounded-input border border-border bg-surface text-[11px]">
              {SEED_STABILITY_TIME_POINTS.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-[10px] text-muted">{t("stability.tests")}</span>
            <select multiple value={[...selectedTestIds]} onChange={(e) => setSelectedTestIds(new Set(Array.from(e.target.selectedOptions, (o) => o.value)))} className="h-16 w-full rounded-input border border-border bg-surface text-[11px]">
              {testDefinitions.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => void createStudy()} className="flex w-full items-center justify-center gap-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
            <Plus size={12} /> {t("stability.newStudy")}
          </button>
        </div>
        <ul>
          {studies.map((s) => (
            <li key={s.id} className="border-b border-border-faint">
              <button onClick={() => setSelectedStudyId(s.id)} className={cn("block w-full truncate px-2 py-1.5 text-left text-[11px]", s.id === selectedStudyId ? "font-medium text-accent" : "text-text")}>
                {s.title}
              </button>
              <div className="px-2 pb-1.5 text-[10px] text-muted">{s.status}</div>
            </li>
          ))}
          {studies.length === 0 && <li className="px-3 py-4 text-[11px] text-muted">{t("stability.noStudies")}</li>}
        </ul>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto px-4 py-3">
        {error && (
          <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}

        {!selectedStudy ? (
          <p className="flex h-full items-center justify-center text-[12px] text-muted">
            <FlaskRound size={14} className="mr-2" /> {t("stability.selectPrompt")}
          </p>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-medium text-text">{selectedStudy.title}</h2>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{selectedStudy.status}</span>
              {openCriticalFailures.length > 0 && <span className="rounded bg-error/10 px-1.5 py-0.5 text-[10px] text-error">{t("stability.criticalOpenBadge", { count: openCriticalFailures.length })}</span>}
              <div className="flex-1" />
              <StabilityExportMenu
                t={t}
                onProtocol={() => exportStudyProtocolJson(selectedStudy)}
                onSamplePlan={() => exportSamplePlanCsv(selectedStudy)}
                onTimePoints={() => void exportTimePointReportXlsx(selectedStudy)}
                onSummary={() => void exportSummaryReportXlsx(selectedStudy)}
                onTestResults={() => void exportTestResultsXlsx(selectedStudy)}
                onCorrectiveActions={() => exportCorrectiveActionsCsv(selectedStudy)}
                onErpDraft={() => exportErpDraftCsv(selectedStudy)}
              />
              {STABILITY_STUDY_STATUSES.filter((s) => canTransitionStability(selectedStudy.status, s, LOCAL_HUMAN, { openCriticalFailures: studyFailures }).allowed).map((s) => (
                <button key={s} onClick={() => void transitionStudy(selectedStudy, s)} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
                  {t("trials.moveTo", { status: s })}
                </button>
              ))}
            </div>

            {selectedStudy.testRequirementSnapshot && (
              <div className="mb-3">
                <p className="text-[11px] font-medium text-muted">{t("trials.testRequirements")}</p>
                <ul className="mt-1 space-y-0.5 text-[11px]">
                  {selectedStudy.testRequirementSnapshot.entries.map((e) => (
                    <li key={e.testDefinitionId} className="flex items-center gap-1.5 text-muted">
                      <span className={cn("rounded px-1 py-0.5 text-[10px]", e.required ? "bg-accent/10 text-accent" : "bg-surface-2")}>
                        {e.required ? t("trials.required") : t("trials.optional")}
                      </span>
                      <span className="text-text">{e.name}</span>
                      <span className="text-[10px]">{e.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {allStudySamples.length === 0 ? (
              <button onClick={() => void generateSamples()} disabled={!selectedStudy.startDate} className="rounded-input border border-accent px-3 py-1.5 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-40">
                {t("stability.generateSamples")}
              </button>
            ) : (
              <SampleDashboard formulationId={formulation.id} samples={allStudySamples} results={results.filter((r) => r.studyId === selectedStudy.id)} testDefinitions={testDefinitions.filter((d) => selectedStudy.requiredTestDefinitionIds.includes(d.code))} onRecord={recordResult} t={t} />
            )}

            <TrendCharts study={selectedStudy} results={results.filter((r) => r.studyId === selectedStudy.id)} testDefinitions={testDefinitions.filter((d) => selectedStudy.requiredTestDefinitionIds.includes(d.code))} t={t} />

            <FailuresSection
              formulationId={formulation.id}
              failures={studyFailures}
              correctiveActions={correctiveActions.filter((a) => a.sourceRecordId === selectedStudy.id)}
              onResolve={resolveFailure}
              onUpdateAttachments={updateFailureAttachments}
              onCreateCorrectiveAction={createFailureCorrectiveAction}
              onApplyDraft={applyDraftFromFailure}
              t={t}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SampleDashboard({
  formulationId,
  samples,
  results,
  testDefinitions,
  onRecord,
  t,
}: {
  formulationId: string;
  samples: StabilitySample[];
  results: StabilityResult[];
  testDefinitions: TestDefinition[];
  onRecord: (sample: StabilitySample, definition: TestDefinition, values: string[], attachments?: AttachmentReference[]) => void;
  t: SimpleT;
}) {
  const [openSampleId, setOpenSampleId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [pendingAttachments, setPendingAttachments] = useState<Record<string, AttachmentReference[]>>({});

  return (
    <section className="mb-4">
      <h4 className="mb-1.5 text-[12px] font-medium text-text">{t("stability.samples")}</h4>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 font-medium">{t("stability.sampleCode")}</th>
            <th className="py-1 font-medium">{t("stability.condition")}</th>
            <th className="py-1 font-medium">{t("stability.timePoint")}</th>
            <th className="py-1 font-medium">{t("optimizer.statusLabel")}</th>
            <th className="py-1 font-medium">{t("stability.dueDate")}</th>
            <th className="py-1 text-right font-medium">{t("stability.resultCount")}</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => {
            const sampleResultCount = results.filter((r) => r.sampleId === sample.id).length;
            return (
            <Fragment key={sample.id}>
              <tr className={cn("border-b border-border-faint", sample.status === "overdue" && "bg-error/5")}>
                <td className="py-1 text-text">{sample.sampleCode}</td>
                <td className="py-1 text-muted">{sample.conditionId}</td>
                <td className="py-1 text-muted">{sample.timePointId}</td>
                <td className={cn("py-1", sample.status === "overdue" ? "text-error" : "text-muted")}>{sample.status}</td>
                <td className="py-1 text-muted">{sample.dueDate ? new Date(sample.dueDate).toLocaleDateString() : "—"}</td>
                <td className="py-1 text-right tabular-nums text-muted">{sampleResultCount}</td>
                <td className="py-1 text-right">
                  {sample.status !== "completed" && sample.status !== "disposed" && (
                    <button onClick={() => setOpenSampleId(openSampleId === sample.id ? null : sample.id)} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-text hover:bg-surface-2">
                      {t("stability.recordResult")}
                    </button>
                  )}
                </td>
              </tr>
              {openSampleId === sample.id && (
                <tr>
                  <td colSpan={7} className="bg-surface-2 px-2 py-2">
                    <div className="space-y-1.5">
                      {testDefinitions
                        .filter((d) => d.resultType === "numeric")
                        .map((def) => {
                          const key = `${sample.id}:${def.code}`;
                          return (
                            <div key={def.code} className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <span className="w-32 truncate text-[11px] text-text">{def.name}</span>
                                <input
                                  value={inputs[key] ?? ""}
                                  onChange={(e) => setInputs((prev) => ({ ...prev, [key]: e.target.value }))}
                                  inputMode="decimal"
                                  className="w-20 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                                />
                                <button
                                  onClick={() => {
                                    onRecord(sample, def, [inputs[key] ?? ""], pendingAttachments[key] ?? []);
                                    setPendingAttachments((prev) => ({ ...prev, [key]: [] }));
                                  }}
                                  className="rounded-input border border-accent px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
                                >
                                  {t("trials.recordResult")}
                                </button>
                              </div>
                              <AttachmentField
                                formulationId={formulationId}
                                attachments={pendingAttachments[key] ?? []}
                                onChange={(attachments) => setPendingAttachments((prev) => ({ ...prev, [key]: attachments }))}
                                t={t}
                              />
                            </div>
                          );
                        })}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function TrendCharts({
  study,
  results,
  testDefinitions,
  t,
}: {
  study: StabilityStudy;
  results: StabilityResult[];
  testDefinitions: TestDefinition[];
  t: SimpleT;
}) {
  return (
    <section className="mb-4">
      <h4 className="mb-1.5 text-[12px] font-medium text-text">{t("stability.trends")}</h4>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {study.conditionIds.flatMap((conditionId) =>
          testDefinitions
            .filter((d) => d.resultType === "numeric")
            .map((def) => {
              const relevant = results.filter((r) => r.conditionId === conditionId && r.testDefinitionId === def.code);
              if (relevant.length === 0) return null;
              const resultsByTimePoint = relevant.map((r) => ({
                timePoint: SEED_STABILITY_TIME_POINTS.find((tp) => tp.id === r.timePointId) ?? { schemaVersion: "1.0" as const, id: r.timePointId, code: r.timePointId, label: r.timePointId, daysFromStart: 0, custom: true },
                result: r,
              }));
              const trend = computeStabilityTrend({ studyId: study.id, conditionId, testDefinitionId: def.code, definition: def, resultsByTimePoint });
              return (
                <div key={`${conditionId}-${def.code}`} className="rounded-card border border-border p-2">
                  <p className="mb-1 text-[11px] font-medium text-text">
                    {def.name} — {conditionId}
                  </p>
                  <TrendSparkline points={trend.points} t={t} />
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
                    {trend.absoluteChangeFromInitial && <span>{t("stability.changeFromInitial")}: {trend.absoluteChangeFromInitial}</span>}
                    {trend.ratePerDay && <span>{t("stability.ratePerDay")}: {trend.ratePerDay}</span>}
                    {trend.limitCrossing && <span className="text-error">{t("stability.limitCrossing", { direction: trend.limitCrossing.direction })}</span>}
                  </div>
                  {trend.projection && (
                    <p className="mt-1 rounded bg-warn/10 px-1.5 py-1 text-[10px] text-warn">
                      {trend.projection.label} — {t("stability.estimatedDays", { days: trend.projection.estimatedDaysToLimit ?? "—" })}
                    </p>
                  )}
                </div>
              );
            }),
        )}
      </div>
    </section>
  );
}

function TrendSparkline({ points, t }: { points: { daysFromStart: number; mean?: string }[]; t: SimpleT }) {
  const numeric = points.filter((p): p is { daysFromStart: number; mean: string } => p.mean !== undefined);
  if (numeric.length < 2) return <p className="text-[10px] text-muted">{t("stability.notEnoughDataPoints")}</p>;
  const width = 220;
  const height = 48;
  const values = numeric.map((p) => Number(p.mean));
  const days = numeric.map((p) => p.daysFromStart);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const minD = Math.min(...days);
  const maxD = Math.max(...days);
  const spanV = maxV - minV || 1;
  const spanD = maxD - minD || 1;
  const coords = numeric.map((p) => {
    const x = ((p.daysFromStart - minD) / spanD) * (width - 8) + 4;
    const y = height - 4 - ((Number(p.mean) - minV) / spanV) * (height - 8);
    return `${x},${y}`;
  });
  return (
    <svg width={width} height={height} role="img" aria-label="trend chart">
      <polyline points={coords.join(" ")} fill="none" stroke="currentColor" className="text-accent" strokeWidth={1.5} />
      {coords.map((c, i) => {
        const [x, y] = c.split(",");
        return <circle key={i} cx={x} cy={y} r={2} className="fill-accent" />;
      })}
    </svg>
  );
}

function FailuresSection({
  formulationId,
  failures,
  correctiveActions,
  onResolve,
  onUpdateAttachments,
  onCreateCorrectiveAction,
  onApplyDraft,
  t,
}: {
  formulationId: string;
  failures: StabilityFailure[];
  correctiveActions: CorrectiveAction[];
  onResolve: (failure: StabilityFailure, notes: string) => void;
  onUpdateAttachments: (failure: StabilityFailure, attachments: AttachmentReference[]) => void;
  onCreateCorrectiveAction: (failure: StabilityFailure, title: string, problemStatement: string) => void;
  onApplyDraft: (action: CorrectiveAction) => void;
  t: SimpleT;
}) {
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  if (failures.length === 0 && correctiveActions.length === 0) return null;
  return (
    <section>
      <h4 className="mb-1.5 text-[12px] font-medium text-text">{t("stability.failures")}</h4>
      <ul className="space-y-2">
        {failures.map((f) => (
          <li key={f.id} className={cn("rounded-card border px-3 py-2", f.severity === "critical" && f.investigationStatus !== "closed" ? "border-error/40 bg-error/5" : "border-border")}>
            <div className="flex items-center gap-2 text-[11px] text-text">
              <span className="font-medium">{f.type}</span>
              <span>{f.severity}</span>
              <span className="ml-auto text-muted">{f.investigationStatus}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">{f.description}</p>
            {f.investigationStatus !== "closed" && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <input
                  value={notesById[f.id] ?? ""}
                  onChange={(e) => setNotesById((prev) => ({ ...prev, [f.id]: e.target.value }))}
                  placeholder={t("stability.resolutionPlaceholder")}
                  className="min-w-0 flex-1 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
                <button onClick={() => onResolve(f, notesById[f.id] ?? "")} className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
                  {t("trials.resolve")}
                </button>
                <button onClick={() => onCreateCorrectiveAction(f, t("trials.correctiveActionDefaultTitle"), notesById[f.id] ?? f.description)} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
                  {t("trials.createCorrectiveAction")}
                </button>
              </div>
            )}
            <AttachmentField
              formulationId={formulationId}
              attachments={f.attachments}
              onChange={(attachments) => onUpdateAttachments(f, attachments)}
              t={t}
            />
          </li>
        ))}
      </ul>
      {correctiveActions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {correctiveActions.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-input border border-border-faint px-2 py-1 text-[11px] text-text">
              <span className="font-medium">{a.title}</span>
              <span className="text-muted">{a.status}</span>
              <button onClick={() => onApplyDraft(a)} className="ml-auto rounded-input border border-accent px-1.5 py-0.5 text-accent hover:bg-accent/10">
                {t("trials.createDraft")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const STABILITY_FAILURE_TYPE_OPTIONS: StabilityFailureType[] = [...STABILITY_FAILURE_TYPES];

function StabilityExportMenu({
  t,
  onProtocol,
  onSamplePlan,
  onTimePoints,
  onSummary,
  onTestResults,
  onCorrectiveActions,
  onErpDraft,
}: {
  t: SimpleT;
  onProtocol: () => void;
  onSamplePlan: () => void;
  onTimePoints: () => void;
  onSummary: () => void;
  onTestResults: () => void;
  onCorrectiveActions: () => void;
  onErpDraft: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = (onClick: () => void, label: string) => (
    <button
      onClick={() => {
        onClick();
        setOpen(false);
      }}
      className="block w-full px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-2"
    >
      {label}
    </button>
  );
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
        {t("builder.export.button")}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-card border border-border bg-surface py-1 shadow-lg">
          {item(onProtocol, `${t("stability.protocolExport")} (JSON)`)}
          {item(onSamplePlan, `${t("stability.samplePlanExport")} (CSV)`)}
          {item(onTimePoints, `${t("stability.timePointsExport")} (Excel)`)}
          {item(onSummary, `${t("stability.summaryExport")} (Excel)`)}
          {item(onTestResults, `${t("trials.testResultsReport")} (Excel)`)}
          {item(onCorrectiveActions, `${t("trials.correctiveActionsHeading")} (CSV)`)}
          {item(onErpDraft, t("trials.erpDraftExport"))}
        </div>
      )}
    </div>
  );
}
