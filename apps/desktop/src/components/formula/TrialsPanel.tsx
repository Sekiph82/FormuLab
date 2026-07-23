import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Beaker, CheckCircle2, Plus, XCircle } from "lucide-react";
import {
  acceptDeviationWithJustification,
  buildTestRequirementSnapshot,
  buildTrialExportMeta,
  canTransitionTrial,
  compareTrials,
  computeActualFormulaPercent,
  computeBatchWeightVariance,
  computeMaterialUsageDeviation,
  computeProcessStepDeviation,
  correctiveActionReportRows,
  createCorrectiveAction,
  erpLabResultDraftCsv,
  evaluateNumericResultPassFail,
  computeReplicateStats,
  evaluateWeightTolerance,
  hasOpenCriticalDeviation,
  isTestDefinitionApplicable,
  newId,
  resolveTrialDeviation,
  snapshotFormulaForTrial,
  testResultReportRows,
  toCsv,
  trialBatchSheetRows,
  trialComparisonReportRows,
  trialProcessSheetRows,
  trialToJsonPackage,
  trialWeighingSheetRows,
  SEED_TEST_DEFINITIONS,
  TRIAL_DEVIATION_SEVERITIES,
  TRIAL_OBSERVATION_TYPES,
  TRIAL_STATUSES,
  type Actor,
  type AttachmentReference,
  type CorrectiveAction,
  type Formulation,
  type FormulationLine,
  type FormulationVersion,
  type FormulaStatus,
  type LaboratoryTrial,
  type TestDefinition,
  type TestResult,
  type TrialDeviation,
  type TrialDeviationSeverity,
  type TrialObservationType,
  type TrialProcessStep,
  type TestApplicabilityContext,
  type TrialStatus,
} from "@ai4s/shared";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { appendAudit, auditEvent } from "@/lib/formulations";
import { cn } from "@/lib/cn";
import { downloadBlob, downloadText } from "@/lib/download";
import { buildXlsxBlob } from "@/lib/xlsx";
import { AttachmentField } from "./AttachmentField";
import { ExclusionExplorer } from "./ExclusionExplorer";
import { ResultHistoryBrowser } from "./ResultHistoryBrowser";

const LOCAL_HUMAN: Actor = { kind: "human", role: "chemist", userId: "local" };

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

type DetailTab = "overview" | "weighing" | "process" | "observations" | "tests";

const TRIAL_TAB_LABEL_KEYS: Record<DetailTab, "trials.tabOverview" | "trials.tabWeighing" | "trials.tabProcess" | "trials.tabObservations" | "trials.tabTests"> = {
  overview: "trials.tabOverview",
  weighing: "trials.tabWeighing",
  process: "trials.tabProcess",
  observations: "trials.tabObservations",
  tests: "trials.tabTests",
};

export function TrialsPanel({
  formulation,
  currentLines,
  basisBatchKg,
  baseVersion,
  approvalStatus,
  onApplyDraft,
}: {
  formulation: Formulation;
  currentLines: FormulationLine[];
  basisBatchKg: string;
  baseVersion?: FormulationVersion;
  approvalStatus: FormulaStatus;
  onApplyDraft: (lines: FormulationLine[], basisBatchKg: string, note: string) => void;
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;
  const [trials, setTrials] = useState<LaboratoryTrial[]>([]);
  const [deviations, setDeviations] = useState<TrialDeviation[]>([]);
  const [testDefinitions, setTestDefinitions] = useState<TestDefinition[]>([]);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [correctiveActions, setCorrectiveActions] = useState<CorrectiveAction[]>([]);
  const [selectedTrialId, setSelectedTrialId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<ReturnType<typeof compareTrials> | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [tr, dv, td, tr2, ca] = await Promise.all([
      listRecords("laboratory_trials"),
      listRecords("trial_deviations"),
      listRecordsSeeded("test_definitions", SEED_TEST_DEFINITIONS),
      listRecords("test_results"),
      listRecords("corrective_actions"),
    ]);
    setTrials(tr.filter((x) => x.projectId === formulation.id));
    setDeviations(dv);
    setTestDefinitions(td);
    setTestResults(tr2);
    setCorrectiveActions(ca);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulation.id]);

  const selectedTrial = trials.find((tr) => tr.id === selectedTrialId) ?? null;
  const trialDeviations = useMemo(() => deviations.filter((d) => d.trialId === selectedTrialId), [deviations, selectedTrialId]);
  const trialResults = useMemo(() => testResults.filter((r) => r.trialId === selectedTrialId), [testResults, selectedTrialId]);
  const activeCriticalDeviations = trialDeviations.filter((d) => d.severity === "critical" && (d.status === "open" || d.status === "under_review"));

  const persistTrial = async (trial: LaboratoryTrial) => {
    await upsertRecords("laboratory_trials", [trial]);
    setTrials((prev) => (prev.some((x) => x.id === trial.id) ? prev.map((x) => (x.id === trial.id ? trial : x)) : [...prev, trial]));
  };

  const createTrial = async () => {
    if (!newTitle.trim()) return;
    setError(null);
    try {
      const now = new Date().toISOString();
      const trial: LaboratoryTrial = {
        schemaVersion: "1.0",
        id: newId("trial"),
        code: newId("TRIAL"),
        projectId: formulation.id,
        sourceType: baseVersion ? "saved_version" : "working_draft",
        sourceFormulaVersionId: baseVersion?.id,
        sourceDraftId: baseVersion ? undefined : formulation.id,
        formulaSnapshot: snapshotFormulaForTrial({ lines: currentLines, basisBatchKg }),
        productFamilyId: formulation.productFamilyCode,
        targetPackagingSkuIds: formulation.targetSkuCodes,
        title: newTitle.trim(),
        batchSize: basisBatchKg,
        batchUnit: "kg",
        status: "planned",
        priority: "normal",
        equipmentIds: [],
        materialUsage: currentLines
          .filter((l) => l.materialCode)
          .map((l) => ({
            id: newId("usage"),
            formulaLineId: l.id,
            materialCode: l.materialCode!,
            materialName: l.displayName,
            targetPercent: l.percent,
            targetWeight: String((Number(l.percent) / 100) * Number(basisBatchKg)),
            weightUnit: "kg",
            coaStatus: "pending",
            quarantined: false,
            released: false,
          })),
        processSteps: [],
        observations: [],
        testRequirementSnapshot: buildTestRequirementSnapshot(testDefinitions, {
          productFamilyId: formulation.productFamilyCode,
          context: "trial",
          packagingSkuCodes: formulation.targetSkuCodes,
        }),
        hasOpenCriticalDeviation: false,
        createdAt: now,
        createdBy: "local",
        updatedAt: now,
      };
      await persistTrial(trial);
      setSelectedTrialId(trial.id);
      setNewTitle("");
    } catch (e) {
      setError(String(e));
    }
  };

  const transitionTrial = async (trial: LaboratoryTrial, to: TrialStatus) => {
    setError(null);
    const result = canTransitionTrial(trial.status, to, LOCAL_HUMAN, { openCriticalDeviations: trialDeviations });
    if (!result.allowed) {
      setError(result.message ?? t("trials.transitionRejected"));
      return;
    }
    const now = new Date().toISOString();
    const updated: LaboratoryTrial = {
      ...trial,
      status: to,
      actualStart: to === "in_progress" && !trial.actualStart ? now : trial.actualStart,
      actualCompletion: to === "completed" ? now : trial.actualCompletion,
      failureReason: to === "failed" ? trial.failureReason ?? t("trials.unspecifiedFailure") : trial.failureReason,
      updatedAt: now,
    };
    await persistTrial(updated);
  };

  const updateMaterialUsage = async (usageId: string, actualWeight: string) => {
    if (!selectedTrial) return;
    const updated: LaboratoryTrial = {
      ...selectedTrial,
      materialUsage: selectedTrial.materialUsage.map((u) => (u.id === usageId ? { ...u, actualWeight, weighedBy: "local", timestamp: new Date().toISOString() } : u)),
      updatedAt: new Date().toISOString(),
    };
    await persistTrial(updated);
  };

  const addProcessStep = async () => {
    if (!selectedTrial) return;
    const now = new Date().toISOString();
    const step: TrialProcessStep = {
      id: newId("step"),
      stepNumber: selectedTrial.processSteps.length + 1,
      phase: "A",
      plannedInstruction: t("trials.newStepPlaceholder"),
      requiredEquipment: [],
      status: "planned",
      unplanned: false,
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };
    await persistTrial({ ...selectedTrial, processSteps: [...selectedTrial.processSteps, step], updatedAt: now });
  };

  const updateProcessStep = async (stepId: string, updates: Partial<TrialProcessStep>) => {
    if (!selectedTrial) return;
    const now = new Date().toISOString();
    await persistTrial({
      ...selectedTrial,
      processSteps: selectedTrial.processSteps.map((s) => (s.id === stepId ? { ...s, ...updates, updatedAt: now } : s)),
      updatedAt: now,
    });
  };

  const addObservation = async (type: TrialObservationType, description: string) => {
    if (!selectedTrial || !description.trim()) return;
    await persistTrial({
      ...selectedTrial,
      observations: [
        ...selectedTrial.observations,
        { id: newId("obs"), type, description: description.trim(), observedBy: "local", observedAt: new Date().toISOString(), attachments: [] },
      ],
      updatedAt: new Date().toISOString(),
    });
  };

  const updateObservationAttachments = async (observationId: string, attachments: AttachmentReference[]) => {
    if (!selectedTrial) return;
    await persistTrial({
      ...selectedTrial,
      observations: selectedTrial.observations.map((o) => (o.id === observationId ? { ...o, attachments } : o)),
      updatedAt: new Date().toISOString(),
    });
  };

  const updateDeviationAttachments = async (deviation: TrialDeviation, attachments: AttachmentReference[]) => {
    const updated = { ...deviation, attachments, updatedAt: new Date().toISOString() };
    await upsertRecords("trial_deviations", [updated]);
    setDeviations((prev) => prev.map((d) => (d.id === deviation.id ? updated : d)));
  };

  const addDeviation = async (severity: TrialDeviationSeverity, description: string) => {
    if (!selectedTrial || !description.trim()) return;
    const now = new Date().toISOString();
    const deviation: TrialDeviation = {
      schemaVersion: "1.0",
      id: newId("dev"),
      trialId: selectedTrial.id,
      severity,
      status: "open",
      description: description.trim(),
      detectedBy: "local",
      detectedAt: now,
      correctiveActionIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await upsertRecords("trial_deviations", [deviation]);
    setDeviations((prev) => (prev.some((d) => d.id === deviation.id) ? prev : [...prev, deviation]));
    if (severity === "critical") {
      await persistTrial({ ...selectedTrial, hasOpenCriticalDeviation: true, updatedAt: now });
    }
  };

  const resolveDeviation = async (deviation: TrialDeviation, resolution: string) => {
    if (!resolution.trim()) return;
    const updated = resolveTrialDeviation(deviation, LOCAL_HUMAN, resolution.trim());
    await upsertRecords("trial_deviations", [updated]);
    setDeviations((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    if (selectedTrial) {
      const stillOpen = hasOpenCriticalDeviation(deviations.map((d) => (d.id === updated.id ? updated : d)).filter((d) => d.trialId === selectedTrial.id));
      await persistTrial({ ...selectedTrial, hasOpenCriticalDeviation: stillOpen, updatedAt: new Date().toISOString() });
    }
  };

  const acceptDeviation = async (deviation: TrialDeviation, justification: string) => {
    if (!justification.trim()) return;
    const updated = acceptDeviationWithJustification(deviation, LOCAL_HUMAN, justification.trim());
    await upsertRecords("trial_deviations", [updated]);
    setDeviations((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  };

  const createCorrectiveActionForDeviation = async (deviation: TrialDeviation, title: string, problemStatement: string) => {
    if (!title.trim() || !problemStatement.trim() || !selectedTrial) return;
    const action = createCorrectiveAction(
      { projectId: formulation.id, sourceType: "trial_deviation", sourceRecordId: selectedTrial.id, deviationOrFailureId: deviation.id, title: title.trim(), problemStatement: problemStatement.trim(), actionType: "other", owner: "local" },
      LOCAL_HUMAN,
    );
    await upsertRecords("corrective_actions", [action]);
    setCorrectiveActions((prev) => (prev.some((a) => a.id === action.id) ? prev : [...prev, action]));
    const updatedDeviation = { ...deviation, correctiveActionIds: [...deviation.correctiveActionIds, action.id], updatedAt: new Date().toISOString() };
    await upsertRecords("trial_deviations", [updatedDeviation]);
    setDeviations((prev) => prev.map((d) => (d.id === updatedDeviation.id ? updatedDeviation : d)));
  };

  const recordTestResult = async (definition: TestDefinition, values: string[], attachments: AttachmentReference[] = []) => {
    if (!selectedTrial) return;
    const numericValues = values.filter((v) => v.trim() !== "");
    if (numericValues.length === 0) return;
    const replicates = numericValues.map((v, i) => ({ replicateNumber: i + 1, numericValue: v, isOutlier: false }));
    const stats = computeReplicateStats(replicates);
    const passFail = evaluateNumericResultPassFail(definition, stats);
    const now = new Date().toISOString();
    const result: TestResult = {
      schemaVersion: "1.0",
      id: newId("testresult"),
      trialId: selectedTrial.id,
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
    await upsertRecords("test_results", [result]);
    setTestResults((prev) => (prev.some((r) => r.id === result.id) ? prev : [...prev, result]));
  };

  /** `test_results` is append-only, so replacing a finalized attachment
   *  creates a new revision (spec §1.4: "Replacement creates a new record
   *  revision where the parent collection is append-only") — same
   *  `revisesResultId` mechanism `reviseTestResult` already uses for a
   *  corrected value, applied here to a corrected attachment instead. */
  const replaceTestResultAttachment = async (result: TestResult, oldAttachment: AttachmentReference, newAttachment: AttachmentReference) => {
    const now = new Date().toISOString();
    const revised: TestResult = { ...result, id: newId("testresult"), attachments: [...result.attachments, newAttachment], revisesResultId: result.id, createdAt: now, updatedAt: now };
    await upsertRecords("test_results", [revised]);
    setTestResults((prev) => [...prev, revised]);
    await appendAudit(
      auditEvent(formulation.id, "attachment.replaced", {
        detail: `Test result attachment replaced on ${result.testDefinitionId}`,
        metadata: {
          oldAttachmentId: oldAttachment.id,
          newAttachmentId: newAttachment.id,
          parentRecordType: "test_result",
          parentRecordId: result.id,
          reason: t("attachments.replaceReason"),
          replacedBy: "local",
          replacedAt: now,
          oldChecksum: oldAttachment.checksumSha256 ?? "",
          newChecksum: newAttachment.checksumSha256 ?? "",
        },
      }),
    );
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runComparison = () => {
    const chosen = trials.filter((tr) => compareIds.has(tr.id));
    if (chosen.length < 2) return;
    const testDefsById = Object.fromEntries(testDefinitions.map((d) => [d.code, d]));
    const resultsByTrial = Object.fromEntries(chosen.map((tr) => [tr.id, testResults.filter((r) => r.trialId === tr.id)]));
    const deviationsByTrial = Object.fromEntries(chosen.map((tr) => [tr.id, deviations.filter((d) => d.trialId === tr.id)]));
    setComparison(compareTrials({ projectId: formulation.id, trials: chosen, deviationsByTrial, testResultsByTrial: resultsByTrial, testDefinitionsById: testDefsById }));
  };

  const exportTrialJson = (trial: LaboratoryTrial) => {
    const meta = buildTrialExportMeta(trial, approvalStatus);
    const ownDeviations = deviations.filter((d) => d.trialId === trial.id);
    const ownResults = testResults.filter((r) => r.trialId === trial.id);
    const ownActions = correctiveActions.filter((a) => a.sourceRecordId === trial.id);
    const pkg = trialToJsonPackage(trial, meta, { deviations: ownDeviations, results: ownResults, correctiveActions: ownActions });
    downloadText(`${trial.code}.json`, JSON.stringify(pkg, null, 2), "application/json");
  };

  const exportTrialBatchSheetCsv = (trial: LaboratoryTrial) => {
    const { headers, rows } = trialBatchSheetRows(trial);
    downloadText(`${trial.code}-batch-sheet.csv`, toCsv(headers, rows), "text/csv;charset=utf-8");
  };

  const exportTrialWeighingSheetCsv = (trial: LaboratoryTrial) => {
    const { headers, rows } = trialWeighingSheetRows(trial);
    downloadText(`${trial.code}-weighing-sheet.csv`, toCsv(headers, rows), "text/csv;charset=utf-8");
  };

  const exportTrialProcessSheetXlsx = async (trial: LaboratoryTrial) => {
    const { headers, rows } = trialProcessSheetRows(trial);
    downloadBlob(`${trial.code}-process-sheet.xlsx`, await buildXlsxBlob(headers, rows, "Process"));
  };

  const exportTrialTestResultsXlsx = async (trial: LaboratoryTrial) => {
    const ownResults = testResults.filter((r) => r.trialId === trial.id);
    const { headers, rows } = testResultReportRows(ownResults, testDefinitions);
    downloadBlob(`${trial.code}-test-results.xlsx`, await buildXlsxBlob(headers, rows, "Test Results"));
  };

  const exportTrialComparisonXlsx = async (cmp: NonNullable<typeof comparison>) => {
    const { trials: trialsTable, tests: testsTable } = trialComparisonReportRows(cmp);
    downloadBlob("trial-comparison-trials.xlsx", await buildXlsxBlob(trialsTable.headers, trialsTable.rows, "Trials"));
    downloadBlob("trial-comparison-tests.xlsx", await buildXlsxBlob(testsTable.headers, testsTable.rows, "Test Differences"));
  };

  const exportTrialCorrectiveActionsCsv = (trial: LaboratoryTrial) => {
    const ownActions = correctiveActions.filter((a) => a.sourceRecordId === trial.id);
    const { headers, rows } = correctiveActionReportRows(ownActions);
    downloadText(`${trial.code}-corrective-actions.csv`, toCsv(headers, rows), "text/csv;charset=utf-8");
  };

  const exportTrialErpDraftCsv = (trial: LaboratoryTrial) => {
    const ownResults = testResults.filter((r) => r.trialId === trial.id);
    downloadText(`${trial.code}-erp-draft-lab-results.csv`, erpLabResultDraftCsv(ownResults, testDefinitions, { recordLabel: trial.code, approvalStatus }), "text/csv;charset=utf-8");
  };

  const applyDraftFromCorrectiveAction = (action: CorrectiveAction) => {
    if (!baseVersion) {
      setError(t("trials.correctiveActionNeedsVersion"));
      return;
    }
    onApplyDraft(baseVersion.lines.map((l) => ({ ...l })), baseVersion.basisBatchKg, t("trials.draftFromCorrectiveAction", { code: action.code }));
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-64 shrink-0 overflow-auto border-r border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h3 className="text-[12px] font-medium text-text">{t("trials.heading")}</h3>
        </div>
        <div className="flex items-center gap-1.5 border-b border-border-faint px-3 py-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t("trials.newTitlePlaceholder")}
            className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
          />
          <button onClick={() => void createTrial()} disabled={!newTitle.trim()} aria-label={t("trials.newTitlePlaceholder")} className="shrink-0 rounded-input border border-accent p-1 text-accent hover:bg-accent/10 disabled:opacity-40">
            <Plus size={13} />
          </button>
        </div>
        <ul>
          {trials.map((tr) => (
            <li key={tr.id} className="border-b border-border-faint">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <input type="checkbox" checked={compareIds.has(tr.id)} onChange={() => toggleCompare(tr.id)} aria-label={t("trials.selectForCompare")} />
                <button onClick={() => setSelectedTrialId(tr.id)} className={cn("min-w-0 flex-1 truncate text-left text-[11px]", tr.id === selectedTrialId ? "font-medium text-accent" : "text-text")}>
                  {tr.title}
                </button>
              </div>
              <div className="px-2 pb-1.5 text-[10px] text-muted">{tr.status}</div>
            </li>
          ))}
          {trials.length === 0 && <li className="px-3 py-4 text-[11px] text-muted">{t("trials.noTrials")}</li>}
        </ul>
        {compareIds.size >= 2 && (
          <div className="border-t border-border px-3 py-2">
            <button onClick={runComparison} className="w-full rounded-input border border-border px-2 py-1.5 text-[11px] text-text hover:bg-surface-2">
              {t("trials.compareSelected")}
            </button>
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 overflow-auto px-4 py-3">
        {error && (
          <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}

        {comparison && (
          <section className="mb-4 overflow-auto rounded-card border border-border">
            <div className="flex justify-end px-2 pt-2">
              <button
                onClick={() => void exportTrialComparisonXlsx(comparison)}
                className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
              >
                {t("builder.export.xlsx")}
              </button>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-2 py-1.5 font-medium">{t("trials.compareTrial")}</th>
                  <th className="px-2 py-1.5 font-medium">{t("optimizer.statusLabel")}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t("trials.compareMaterialUsage")}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t("trials.compareDeviations")}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t("trials.compareCriticalDeviations")}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t("trials.comparePass")}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t("trials.compareFail")}</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.trialId} className="border-b border-border-faint">
                    <td className="px-2 py-1 text-text">{row.trialCode}</td>
                    <td className="px-2 py-1 text-muted">{row.status}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted">{row.materialUsageCount}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted">{row.processDeviationCount}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted">{row.criticalDeviationCount}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted">{row.passCount}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted">{row.failCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {!selectedTrial ? (
          <p className="flex h-full items-center justify-center text-[12px] text-muted">
            <Beaker size={14} className="mr-2" /> {t("trials.selectPrompt")}
          </p>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-medium text-text">{selectedTrial.title}</h2>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{selectedTrial.status}</span>
              {activeCriticalDeviations.length > 0 && (
                <span className="rounded bg-error/10 px-1.5 py-0.5 text-[10px] text-error">{t("trials.criticalOpenBadge", { count: activeCriticalDeviations.length })}</span>
              )}
              <div className="flex-1" />
              <TrialExportMenu
                t={t}
                onJson={() => exportTrialJson(selectedTrial)}
                onBatchSheet={() => exportTrialBatchSheetCsv(selectedTrial)}
                onWeighingSheet={() => exportTrialWeighingSheetCsv(selectedTrial)}
                onProcessSheet={() => void exportTrialProcessSheetXlsx(selectedTrial)}
                onTestResults={() => void exportTrialTestResultsXlsx(selectedTrial)}
                onCorrectiveActions={() => exportTrialCorrectiveActionsCsv(selectedTrial)}
                onErpDraft={() => exportTrialErpDraftCsv(selectedTrial)}
              />
              {TRIAL_STATUSES.filter((s) => canTransitionTrial(selectedTrial.status, s, LOCAL_HUMAN, { openCriticalDeviations: trialDeviations }).allowed).map((s) => (
                <button key={s} onClick={() => void transitionTrial(selectedTrial, s)} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
                  {t("trials.moveTo", { status: s })}
                </button>
              ))}
            </div>

            <nav className="mb-3 flex gap-1 border-b border-border">
              {/* eslint-disable-next-line i18next/no-literal-string -- internal tab ids, not display text (the visible label is t(TRIAL_TAB_LABEL_KEYS[tab])) */}
              {(["overview", "weighing", "process", "observations", "tests"] as DetailTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={cn("px-2.5 py-1.5 text-[11px]", detailTab === tab ? "border-b-2 border-accent font-medium text-accent" : "text-muted hover:text-text")}
                >
                  {TRIAL_TAB_LABEL_KEYS[tab] ? t(TRIAL_TAB_LABEL_KEYS[tab]) : tab}
                </button>
              ))}
            </nav>

            {detailTab === "overview" && (
              <div className="space-y-2 text-[12px] text-text">
                <p>
                  {t("trials.batchSize")}: {selectedTrial.batchSize} {selectedTrial.batchUnit}
                </p>
                <p>
                  {t("trials.source")}: {selectedTrial.sourceType}
                </p>
                <p>
                  {t("trials.formulaLines")}: {selectedTrial.formulaSnapshot.lines.length}
                </p>
                {selectedTrial.sourceOptimizationRunCode && <p>{t("trials.sourceOptimizationRun")}: {selectedTrial.sourceOptimizationRunCode}</p>}
                {selectedTrial.sourceSubstitutionRunCode && <p>{t("trials.sourceSubstitutionRun")}: {selectedTrial.sourceSubstitutionRunCode}</p>}
                {selectedTrial.testRequirementSnapshot && (
                  <div>
                    <p className="font-medium text-muted">{t("trials.testRequirements")}</p>
                    <ul className="mt-1 space-y-0.5 text-[11px]">
                      {selectedTrial.testRequirementSnapshot.entries.map((e) => (
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
              </div>
            )}

            {detailTab === "weighing" && <WeighingSection trial={selectedTrial} onWeigh={updateMaterialUsage} t={t} />}
            {detailTab === "process" && (
              <ProcessSection
                formulationId={formulation.id}
                trial={selectedTrial}
                onAddStep={addProcessStep}
                onUpdateStep={updateProcessStep}
                t={t}
              />
            )}
            {detailTab === "observations" && (
              <ObservationsSection
                formulationId={formulation.id}
                trial={selectedTrial}
                deviations={trialDeviations}
                correctiveActions={correctiveActions.filter((a) => a.sourceRecordId === selectedTrial.id)}
                onAddObservation={addObservation}
                onUpdateObservationAttachments={updateObservationAttachments}
                onAddDeviation={addDeviation}
                onResolveDeviation={resolveDeviation}
                onAcceptDeviation={acceptDeviation}
                onUpdateDeviationAttachments={updateDeviationAttachments}
                onCreateCorrectiveAction={createCorrectiveActionForDeviation}
                onApplyDraft={applyDraftFromCorrectiveAction}
                t={t}
              />
            )}
            {detailTab === "tests" && (
              <TestsSection
                formulationId={formulation.id}
                trial={selectedTrial}
                testDefinitions={testDefinitions}
                results={trialResults}
                onRecord={recordTestResult}
                onReplaceAttachment={replaceTestResultAttachment}
                t={t}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WeighingSection({ trial, onWeigh, t }: { trial: LaboratoryTrial; onWeigh: (id: string, w: string) => void; t: SimpleT }) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const variance = computeBatchWeightVariance(trial.materialUsage);
  return (
    <div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 font-medium">{t("optimizer.material")}</th>
            <th className="py-1 text-right font-medium">{t("trials.target")}</th>
            <th className="py-1 text-right font-medium">{t("trials.actual")}</th>
            <th className="py-1 text-right font-medium">{t("trials.deviation")}</th>
            <th className="py-1 text-right font-medium">{t("trials.actualPercent")}</th>
          </tr>
        </thead>
        <tbody>
          {trial.materialUsage.map((usage) => {
            const dev = computeMaterialUsageDeviation(usage);
            const tolerance = evaluateWeightTolerance(dev.percentageDeviation, { warningPercent: "0.5", failurePercent: "2" });
            const actualPercent = computeActualFormulaPercent(usage, variance);
            return (
              <tr key={usage.id} className="border-b border-border-faint">
                <td className="py-1 text-text">{usage.materialName}</td>
                <td className="py-1 text-right tabular-nums text-muted">{usage.targetWeight}</td>
                <td className="py-1 text-right">
                  <input
                    value={inputs[usage.id] ?? usage.actualWeight ?? ""}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [usage.id]: e.target.value }))}
                    onBlur={() => inputs[usage.id] !== undefined && onWeigh(usage.id, inputs[usage.id])}
                    placeholder={t("trials.notEntered")}
                    inputMode="decimal"
                    className="w-20 rounded-input border border-border bg-surface px-1.5 py-1 text-right text-[11px]"
                  />
                </td>
                <td className={cn("py-1 text-right tabular-nums", tolerance === "failure" ? "text-error" : tolerance === "warning" ? "text-warn" : "text-muted")}>
                  {dev.percentageDeviation ?? "—"}
                </td>
                <td className="py-1 text-right tabular-nums text-muted">{actualPercent ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        {t("trials.batchVariance")}:{" "}
        {variance.allWeighed && <span>{variance.varianceAbsolute}</span>}
        {!variance.allWeighed && <span>{t("trials.batchVariancePartial", { count: variance.missingCount })}</span>}
      </p>
    </div>
  );
}

function ProcessSection({
  formulationId,
  trial,
  onAddStep,
  onUpdateStep,
  t,
}: {
  formulationId: string;
  trial: LaboratoryTrial;
  onAddStep: () => void;
  onUpdateStep: (id: string, updates: Partial<TrialProcessStep>) => void;
  t: SimpleT;
}) {
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button onClick={onAddStep} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
          {t("trials.addStep")}
        </button>
      </div>
      <ul className="space-y-2">
        {trial.processSteps.map((step) => {
          const deviation = computeProcessStepDeviation(step);
          return (
            <li key={step.id} className="rounded-card border border-border px-3 py-2">
              <div className="flex items-center gap-2 text-[12px] text-text">
                <span className="font-medium">
                  {t("trials.step")} {step.stepNumber}
                </span>
                <input
                  value={step.plannedInstruction}
                  onChange={(e) => onUpdateStep(step.id, { plannedInstruction: e.target.value })}
                  className="min-w-0 flex-1 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
                <select value={step.status} onChange={(e) => onUpdateStep(step.id, { status: e.target.value as TrialProcessStep["status"] })} className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]">
                  {/* eslint-disable-next-line i18next/no-literal-string -- internal status ids, consistent with raw status codes shown elsewhere in this panel (e.g. trials.moveTo) */}
                  {["planned", "in_progress", "paused", "completed", "skipped"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                <label className="flex items-center gap-1 text-muted">
                  {t("trials.actualTemp")}
                  <input
                    value={step.actualTemperatureC ?? ""}
                    onChange={(e) => onUpdateStep(step.id, { actualTemperatureC: e.target.value || undefined })}
                    inputMode="decimal"
                    className="w-16 rounded-input border border-border bg-surface px-1.5 py-0.5"
                  />
                </label>
                <label className="flex items-center gap-1 text-muted">
                  {t("trials.actualPh")}
                  <input
                    value={step.actualPh ?? ""}
                    onChange={(e) => onUpdateStep(step.id, { actualPh: e.target.value || undefined })}
                    inputMode="decimal"
                    className="w-16 rounded-input border border-border bg-surface px-1.5 py-0.5"
                  />
                </label>
                {deviation.temperatureDeviationC && <span className="text-warn">{t("trials.tempDeviation", { value: deviation.temperatureDeviationC })}</span>}
              </div>
              <AttachmentField
                formulationId={formulationId}
                attachments={step.attachments}
                onChange={(attachments) => onUpdateStep(step.id, { attachments })}
                t={t}
              />
            </li>
          );
        })}
        {trial.processSteps.length === 0 && <p className="text-[11px] text-muted">{t("trials.noSteps")}</p>}
      </ul>
    </div>
  );
}

function ObservationsSection({
  formulationId,
  trial,
  deviations,
  correctiveActions,
  onAddObservation,
  onUpdateObservationAttachments,
  onAddDeviation,
  onResolveDeviation,
  onAcceptDeviation,
  onUpdateDeviationAttachments,
  onCreateCorrectiveAction,
  onApplyDraft,
  t,
}: {
  formulationId: string;
  trial: LaboratoryTrial;
  deviations: TrialDeviation[];
  correctiveActions: CorrectiveAction[];
  onAddObservation: (type: TrialObservationType, description: string) => void;
  onUpdateObservationAttachments: (observationId: string, attachments: AttachmentReference[]) => void;
  onAddDeviation: (severity: TrialDeviationSeverity, description: string) => void;
  onResolveDeviation: (deviation: TrialDeviation, resolution: string) => void;
  onAcceptDeviation: (deviation: TrialDeviation, justification: string) => void;
  onUpdateDeviationAttachments: (deviation: TrialDeviation, attachments: AttachmentReference[]) => void;
  onCreateCorrectiveAction: (deviation: TrialDeviation, title: string, problemStatement: string) => void;
  onApplyDraft: (action: CorrectiveAction) => void;
  t: SimpleT;
}) {
  const [obsType, setObsType] = useState<TrialObservationType>("other");
  const [obsText, setObsText] = useState("");
  const [devSeverity, setDevSeverity] = useState<TrialDeviationSeverity>("minor");
  const [devText, setDevText] = useState("");
  const [resolutionInputs, setResolutionInputs] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4">
      <section>
        <h4 className="mb-1.5 text-[12px] font-medium text-text">{t("trials.observations")}</h4>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <select value={obsType} onChange={(e) => setObsType(e.target.value as TrialObservationType)} className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]">
            {TRIAL_OBSERVATION_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {ty}
              </option>
            ))}
          </select>
          <input value={obsText} onChange={(e) => setObsText(e.target.value)} placeholder={t("trials.observationPlaceholder")} className="min-w-0 flex-1 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
          <button
            onClick={() => {
              onAddObservation(obsType, obsText);
              setObsText("");
            }}
            className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2"
          >
            {t("common:actions.add")}
          </button>
        </div>
        <ul className="space-y-1">
          {trial.observations.map((o) => (
            <li key={o.id} className="rounded-input border border-border-faint px-2 py-1 text-[11px] text-text">
              <span className="font-medium">{o.type}</span>: {o.description}
              <AttachmentField
                formulationId={formulationId}
                attachments={o.attachments}
                onChange={(attachments) => onUpdateObservationAttachments(o.id, attachments)}
                t={t}
              />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4 className="mb-1.5 text-[12px] font-medium text-text">{t("trials.deviations")}</h4>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <select value={devSeverity} onChange={(e) => setDevSeverity(e.target.value as TrialDeviationSeverity)} className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]">
            {TRIAL_DEVIATION_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input value={devText} onChange={(e) => setDevText(e.target.value)} placeholder={t("trials.deviationPlaceholder")} className="min-w-0 flex-1 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
          <button
            onClick={() => {
              onAddDeviation(devSeverity, devText);
              setDevText("");
            }}
            className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2"
          >
            {t("common:actions.add")}
          </button>
        </div>
        <ul className="space-y-2">
          {deviations.map((d) => (
            <li key={d.id} className={cn("rounded-card border px-3 py-2", d.severity === "critical" && d.status !== "resolved" ? "border-error/40 bg-error/5" : "border-border")}>
              <div className="flex items-center gap-2 text-[11px] text-text">
                {d.status === "resolved" || d.status === "accepted_with_justification" ? <CheckCircle2 size={12} className="text-accent" /> : <XCircle size={12} className="text-error" />}
                <span className="font-medium">{d.severity}</span>
                <span>{d.description}</span>
                <span className="ml-auto text-muted">{d.status}</span>
              </div>
              {d.status === "open" || d.status === "under_review" ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <input
                    value={resolutionInputs[d.id] ?? ""}
                    onChange={(e) => setResolutionInputs((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    placeholder={t("trials.resolutionPlaceholder")}
                    className="min-w-0 flex-1 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                  />
                  <button onClick={() => onResolveDeviation(d, resolutionInputs[d.id] ?? "")} className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
                    {t("trials.resolve")}
                  </button>
                  <button onClick={() => onAcceptDeviation(d, resolutionInputs[d.id] ?? "")} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
                    {t("trials.acceptWithJustification")}
                  </button>
                  <button
                    onClick={() => onCreateCorrectiveAction(d, t("trials.correctiveActionDefaultTitle"), resolutionInputs[d.id] ?? d.description)}
                    className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2"
                  >
                    {t("trials.createCorrectiveAction")}
                  </button>
                </div>
              ) : null}
              <AttachmentField
                formulationId={formulationId}
                attachments={d.attachments}
                onChange={(attachments) => onUpdateDeviationAttachments(d, attachments)}
                t={t}
              />
            </li>
          ))}
        </ul>
      </section>

      {correctiveActions.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[12px] font-medium text-text">{t("trials.correctiveActionsHeading")}</h4>
          <ul className="space-y-1">
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
        </section>
      )}
    </div>
  );
}

function TestsSection({
  formulationId,
  trial,
  testDefinitions,
  results,
  onRecord,
  onReplaceAttachment,
  t,
}: {
  formulationId: string;
  trial: LaboratoryTrial;
  testDefinitions: TestDefinition[];
  results: TestResult[];
  onRecord: (definition: TestDefinition, values: string[], attachments?: AttachmentReference[]) => void;
  onReplaceAttachment: (result: TestResult, oldAttachment: AttachmentReference, newAttachment: AttachmentReference) => void | Promise<void>;
  t: SimpleT;
}) {
  const [inputsByTest, setInputsByTest] = useState<Record<string, string[]>>({});
  const [pendingAttachmentsByTest, setPendingAttachmentsByTest] = useState<Record<string, AttachmentReference[]>>({});
  const [exploringApplicability, setExploringApplicability] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{ pool: TestResult[]; startId: string } | null>(null);
  const applicabilityCtx: TestApplicabilityContext = { productFamilyId: trial.productFamilyId, context: "trial", packagingSkuCodes: trial.targetPackagingSkuIds };

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button onClick={() => setExploringApplicability(true)} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
          {t("applicability.heading")}
        </button>
      </div>
      {exploringApplicability && (
        <ExclusionExplorer definitions={testDefinitions} ctx={applicabilityCtx} onClose={() => setExploringApplicability(false)} t={t} />
      )}
      {historyTarget && (
        <ResultHistoryBrowser formulationId={formulationId} pool={historyTarget.pool} startResultId={historyTarget.startId} onClose={() => setHistoryTarget(null)} t={t} />
      )}
      <ul className="space-y-2">
        {testDefinitions
          .filter((d) => d.active && d.resultType === "numeric" && isTestDefinitionApplicable(d, applicabilityCtx))
          .map((def) => {
            const existing = results.filter((r) => r.testDefinitionId === def.code);
            const inputs = inputsByTest[def.code] ?? Array.from({ length: def.replicatesRequired }, () => "");
            return (
              <li key={def.code} className="rounded-card border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-text">
                  <span className="font-medium">{def.name}</span>
                  <span className="text-[10px] text-muted">{def.unit}</span>
                  {def.criticalTestFlag && <span className="rounded bg-error/10 px-1 py-0.5 text-[10px] text-error">{t("trials.critical")}</span>}
                  <div className="flex-1" />
                  {inputs.map((v, i) => (
                    <input
                      key={i}
                      value={v}
                      onChange={(e) => {
                        const next = [...inputs];
                        next[i] = e.target.value;
                        setInputsByTest((prev) => ({ ...prev, [def.code]: next }));
                      }}
                      inputMode="decimal"
                      className="w-16 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                      placeholder={t("trials.replicate", { n: i + 1 })}
                    />
                  ))}
                  <button
                    onClick={() => {
                      onRecord(def, inputs, pendingAttachmentsByTest[def.code] ?? []);
                      setPendingAttachmentsByTest((prev) => ({ ...prev, [def.code]: [] }));
                    }}
                    className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10"
                  >
                    {t("trials.recordResult")}
                  </button>
                </div>
                <AttachmentField
                  formulationId={formulationId}
                  attachments={pendingAttachmentsByTest[def.code] ?? []}
                  onChange={(attachments) => setPendingAttachmentsByTest((prev) => ({ ...prev, [def.code]: attachments }))}
                  t={t}
                />
                {existing.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted">
                    {existing.map((r) => {
                      const supersededByAnotherResult = existing.some((other) => other.revisesResultId === r.id);
                      return (
                        <li key={r.id}>
                          {t("trials.resultSummary", { mean: r.stats?.mean ?? "—", count: r.stats?.count ?? 0, passFail: r.passFail })}
                          {r.revisesResultId && <span className="ml-1 text-[10px]">{t("trials.revisionOf", { id: r.revisesResultId })}</span>}
                          <button
                            onClick={() => setHistoryTarget({ pool: existing, startId: r.id })}
                            className="ml-1.5 text-[10px] text-accent hover:underline"
                          >
                            {t("resultHistory.viewHistory")}
                          </button>
                          <AttachmentField
                            formulationId={formulationId}
                            attachments={r.attachments}
                            onChange={() => {}}
                            disabled
                            onReplace={supersededByAnotherResult ? undefined : (old, next) => onReplaceAttachment(r, old, next)}
                            t={t}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}

function TrialExportMenu({
  t,
  onJson,
  onBatchSheet,
  onWeighingSheet,
  onProcessSheet,
  onTestResults,
  onCorrectiveActions,
  onErpDraft,
}: {
  t: SimpleT;
  onJson: () => void;
  onBatchSheet: () => void;
  onWeighingSheet: () => void;
  onProcessSheet: () => void;
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
          {item(onJson, t("builder.export.json"))}
          {item(onBatchSheet, `${t("trials.batchSheet")} (CSV)`)}
          {item(onWeighingSheet, `${t("trials.weighingSheet")} (CSV)`)}
          {item(onProcessSheet, `${t("trials.processSheet")} (Excel)`)}
          {item(onTestResults, `${t("trials.testResultsReport")} (Excel)`)}
          {item(onCorrectiveActions, `${t("trials.correctiveActionsHeading")} (CSV)`)}
          {item(onErpDraft, t("trials.erpDraftExport"))}
        </div>
      )}
    </div>
  );
}
