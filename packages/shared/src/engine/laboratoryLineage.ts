/** Read-only, exact-ID lineage projection for the laboratory feedback chain.
 * It deliberately stores no second copy of domain state: callers provide the
 * canonical records and this module resolves only their explicit references.
 */
export type LineageEntityType =
  | "generation_session" | "formulation" | "formulation_version" | "formulation_draft" | "corrective_action"
  | "doe_study" | "doe_design" | "doe_analysis" | "doe_candidate" | "doe_run" | "laboratory_trial"
  | "test_result" | "stability_study" | "dataset" | "predictive_model" | "prediction"
  | "ranking" | "optimization_run";

export interface LineageNode {
  entityType: LineageEntityType;
  id: string;
  code?: string;
  version?: string | number;
  status?: string;
  timestamp?: string;
}

export interface LineageEdge {
  from: string;
  to: string;
  relationship: string;
  status: "resolved" | "missing" | "invalid";
}

export interface LaboratoryLineageRecordSet {
  generationSessions?: unknown[];
  formulations?: unknown[];
  formulationVersions?: unknown[];
  formulationDrafts?: unknown[];
  correctiveActions?: unknown[];
  doeStudies?: unknown[];
  doeDesigns?: unknown[];
  doeAnalyses?: unknown[];
  doeCandidates?: unknown[];
  doeRuns?: unknown[];
  laboratoryTrials?: unknown[];
  testResults?: unknown[];
  stabilityStudies?: unknown[];
  datasets?: unknown[];
  predictiveModels?: unknown[];
  predictions?: unknown[];
  rankings?: unknown[];
  optimizationRuns?: unknown[];
}

export interface LaboratoryLineage {
  nodes: LineageNode[];
  edges: LineageEdge[];
  brokenReferences: LineageEdge[];
}

type RecordValue = Record<string, unknown>;
const asRecord = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const idOf = (record: RecordValue): string | undefined => text(record.id) ?? text(record.code) ?? text(record.formulationId);

/** Resolve direct immutable references only. No lookup by recency, label,
 * formula contents, or display code is performed. Missing targets stay visible. */
export function buildLaboratoryLineage(records: LaboratoryLineageRecordSet): LaboratoryLineage {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const ids = new Map<LineageEntityType, Set<string>>();
  const recordsById = new Map<LineageEntityType, Map<string, RecordValue>>();
  const addNodes = (entityType: LineageEntityType, rows: unknown[] = []) => {
    const known = ids.get(entityType) ?? new Set<string>();
    ids.set(entityType, known);
    const byId = recordsById.get(entityType) ?? new Map<string, RecordValue>();
    recordsById.set(entityType, byId);
    for (const value of rows) {
      const row = asRecord(value);
      const id = row && (idOf(row) ?? (entityType === "dataset" ? text(asRecord(row.dataset)?.digest) : undefined));
      if (!row || !id) continue;
      known.add(id);
      byId.set(id, row);
      nodes.push({
        entityType, id, ...(text(row.code) ? { code: text(row.code) } : {}),
        ...(typeof row.version === "string" || typeof row.version === "number" ? { version: row.version } :
          typeof row.versionNumber === "number" ? { version: row.versionNumber } : {}),
        ...(text(row.status) ? { status: text(row.status) } : {}),
        ...(text(row.createdAt) ? { timestamp: text(row.createdAt) } :
          text(row.capturedAt) ? { timestamp: text(row.capturedAt) } :
          text(row.trainingTimestamp) ? { timestamp: text(row.trainingTimestamp) } : {}),
      });
    }
  };
  const pools: Array<[LineageEntityType, unknown[] | undefined]> = [
    ["generation_session", records.generationSessions], ["formulation", records.formulations],
    ["formulation_version", records.formulationVersions], ["formulation_draft", records.formulationDrafts], ["corrective_action", records.correctiveActions],
    ["doe_study", records.doeStudies], ["doe_design", records.doeDesigns], ["doe_analysis", records.doeAnalyses],
    ["doe_candidate", records.doeCandidates], ["doe_run", records.doeRuns],
    ["laboratory_trial", records.laboratoryTrials], ["test_result", records.testResults], ["stability_study", records.stabilityStudies],
    ["dataset", records.datasets], ["predictive_model", records.predictiveModels],
    ["prediction", records.predictions], ["ranking", records.rankings],
    ["optimization_run", records.optimizationRuns],
  ];
  for (const [type, rows] of pools) addNodes(type, rows);

  const link = (fromType: LineageEntityType, from: RecordValue, relation: string, toType: LineageEntityType, target: unknown, matches?: (targetRecord: RecordValue) => boolean) => {
    const sourceId = idOf(from);
    const targetId = text(target);
    if (!sourceId || !targetId) return;
    const targetRecord = recordsById.get(toType)?.get(targetId);
    edges.push({ from: `${fromType}:${sourceId}`, to: `${toType}:${targetId}`, relationship: relation,
      status: !targetRecord ? "missing" : matches && !matches(targetRecord) ? "invalid" : "resolved" });
  };
  const each = (_type: LineageEntityType, rows: unknown[] | undefined, fn: (row: RecordValue) => void) => {
    for (const value of rows ?? []) { const row = asRecord(value); if (row) fn(row); }
  };
  each("formulation_version", records.formulationVersions, row => {
    link("formulation_version", row, "version_of", "formulation", row.formulationId);
    link("formulation_version", row, "generated_from_session", "generation_session", asRecord(row.generatedSource)?.sessionId);
  });
  each("corrective_action", records.correctiveActions, row => {
    const sourceType = text(row.sourceType);
    if (sourceType?.startsWith("trial_")) link("corrective_action", row, "source_record", "laboratory_trial", row.sourceRecordId);
    else if (sourceType === "stability_failure") link("corrective_action", row, "source_record", "stability_study", row.sourceRecordId);
    link("corrective_action", row, "created_draft", "formulation", row.createdDraftId);
  });
  each("formulation_draft", records.formulationDrafts, row => {
    const origin = asRecord(row.origin);
    if (!origin) return;
    if (origin.kind === "corrective_action") {
      link("formulation_draft", row, "derived_from_corrective_action", "corrective_action", origin.correctiveActionId);
      if (text(origin.sourceType)?.startsWith("trial_")) link("formulation_draft", row, "source_record", "laboratory_trial", origin.sourceRecordId);
      else if (origin.sourceType === "stability_failure") link("formulation_draft", row, "source_record", "stability_study", origin.sourceRecordId);
      link("formulation_draft", row, "source_test_result", "test_result", origin.sourceTestResultId);
      link("formulation_draft", row, "source_formula_version", "formulation_version", origin.sourceFormulaVersionId);
    } else if (origin.kind === "doe_candidate") {
      link("formulation_draft", row, "derived_from_doe_candidate", "doe_candidate", origin.candidateId);
      link("formulation_draft", row, "source_formula_version", "formulation_version", origin.sourceFormulaVersionId);
      link("formulation_draft", row, "study_revision", "doe_study", origin.studyId);
      link("formulation_draft", row, "design", "doe_design", origin.designId);
    } else if (origin.kind === "generation_alternative") {
      link("formulation_draft", row, "generated_from_session", "generation_session", origin.generationSessionId);
    }
  });
  each("doe_study", records.doeStudies, row => {
    link("doe_study", row, "baseline_formula_version", "formulation_version", row.baselineFormulaVersionId);
    link("doe_study", row, "supersedes", "doe_study", row.supersedesStudyId);
  });
  each("doe_design", records.doeDesigns, row => link("doe_design", row, "study_revision", "doe_study", row.studyId));
  each("doe_candidate", records.doeCandidates, row => {
    link("doe_candidate", row, "study_revision", "doe_study", row.studyId);
    link("doe_candidate", row, "design", "doe_design", asRecord(row.experimentSpace)?.designId);
    link("doe_candidate", row, "source_formula_version", "formulation_version", asRecord(row.experimentSpace)?.sourceFormulaVersionId);
    for (const analysisId of Array.isArray(row.analysisIds) ? row.analysisIds : []) link("doe_candidate", row, "analysis", "doe_analysis", analysisId);
  });
  each("doe_run", records.doeRuns, row => {
    link("doe_run", row, "study_revision", "doe_study", row.studyId);
    link("doe_run", row, "design", "doe_design", row.designId);
    link("doe_run", row, "laboratory_trial", "laboratory_trial", row.linkedTrialId);
    link("doe_run", row, "formula_version", "formulation_version", row.linkedFormulaVersionId);
    link("doe_run", row, "recommendation", "doe_candidate", row.recommendationId);
  });
  each("laboratory_trial", records.laboratoryTrials, row => {
    link("laboratory_trial", row, "formula_version", "formulation_version", row.sourceFormulaVersionId);
    link("laboratory_trial", row, "source_doe_study", "doe_study", row.sourceDoeStudyId);
    link("laboratory_trial", row, "source_doe_design", "doe_design", row.sourceDoeDesignId);
    link("laboratory_trial", row, "source_doe_run", "doe_run", row.sourceDoeRunId);
  });
  each("test_result", records.testResults, row => {
    link("test_result", row, "laboratory_trial", "laboratory_trial", row.trialId);
    link("test_result", row, "formula_version", "formulation_version", row.formulaVersionId, version => {
      const trial = recordsById.get("laboratory_trial")?.get(text(row.trialId) ?? "");
      return !trial || !text(trial.sourceFormulaVersionId) || text(trial.sourceFormulaVersionId) === idOf(version);
    });
  });
  each("dataset", records.datasets, row => {
    for (const entry of Array.isArray(row.entries) ? row.entries : []) link("dataset", row, "formula_version_member", "formulation_version", asRecord(entry)?.formulaVersionId);
  });
  each("predictive_model", records.predictiveModels, row => {
    const fingerprint = asRecord(row.datasetFingerprint)?.digest;
    const matching = (records.datasets ?? []).map(asRecord).find(dataset => dataset && asRecord(dataset.dataset)?.digest === fingerprint);
    link("predictive_model", row, "training_dataset", "dataset", (matching && (idOf(matching) ?? asRecord(matching.dataset)?.digest)) ?? fingerprint);
  });
  each("prediction", records.predictions, row => {
    link("prediction", row, "exact_model", "predictive_model", row.modelId, model =>
      model.version === row.modelVersion &&
      asRecord(model.datasetFingerprint)?.digest === asRecord(row.datasetFingerprint)?.digest &&
      model.artifactChecksum === row.modelChecksum && model.schemaVersion === row.modelArtifactSchemaVersion &&
      model.datasetSchemaVersion === row.datasetSchemaVersion && model.featureSchemaVersion === row.featureSchemaVersion &&
      model.modelFeatureSchemaVersion === row.modelFeatureSchemaVersion && model.featureContractVersion === row.featureContractVersion &&
      model.trainingContractVersion === row.trainingContractVersion && model.acceptancePolicyVersion === row.acceptancePolicyVersion &&
      model.productFamilyCode === row.productFamilyCode && JSON.stringify(model.applicabilityDomain) === JSON.stringify(row.applicabilityDomainSnapshot));
    link("prediction", row, "formula_version", "formulation_version", row.formulaVersionId, version =>
      version.versionNumber === row.formulaVersionNumber && version.formulationId === row.formulaId);
  });
  each("ranking", records.rankings, row => {
    link("ranking", row, "generation_session", "generation_session", row.sessionId);
    for (const ranked of Array.isArray(row.rankings) ? row.rankings : []) {
      const candidate = asRecord(asRecord(ranked)?.candidate);
      if (candidate) {
        link("ranking", row, "source_formula_version", "formulation_version", candidate.sourceFormulationVersionId);
        const dimensions = asRecord(candidate.dimensions);
        const performance = asRecord(dimensions?.performance);
        const source = asRecord(performance?.sourceSnapshot);
        link("ranking", row, "prediction_model", "predictive_model", source?.modelId);
      }
    }
  });
  each("optimization_run", records.optimizationRuns, row => {
    link("optimization_run", row, "formula_version", "formulation_version", row.formulaVersionId);
    const alternative = asRecord(row.sourceAlternative);
    if (alternative) link("optimization_run", row, "ranking_snapshot", "ranking", alternative.rankingRecordCode);
  });

  return { nodes, edges, brokenReferences: edges.filter(edge => edge.status !== "resolved") };
}
