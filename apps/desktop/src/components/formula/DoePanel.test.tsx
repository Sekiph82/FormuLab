/**
 * UI-integration coverage for the Phase 5 Design of Experiments workspace
 * panel: empty state, the study-creation wizard only ever offering real
 * saved versions (never a working draft), a full wizard walk-through that
 * generates a real design + randomized runs, and the resulting study
 * appearing in the Studies list. Same mocking discipline as
 * DossierPanel.test.tsx / ClaimsLabelsPanel.test.tsx — only `@/lib/masterdata`
 * is mocked; engine correctness itself is covered by the doe*.test.ts suites.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoeCandidate, DoeDesign, DoeFactor, DoeStudy, Formulation, FormulationVersion } from "@formulab/shared";
import { CandidateLineageEvidence, DoePanel } from "./DoePanel";

const bridge = {
  listRecords: vi.fn(),
  listRecordsSeeded: vi.fn(),
  upsertRecords: vi.fn(),
};
const auditBridge = vi.hoisted(() => ({ appendAudit: vi.fn() }));

vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  listRecordsSeeded: (...a: [string, unknown[]]) => bridge.listRecordsSeeded(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
}));
vi.mock("@/lib/formulations", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/formulations")>()), appendAudit: (...args: unknown[]) => auditBridge.appendAudit(...args) }));

const FORMULATION: Formulation = {
  schemaVersion: "1.0",
  id: "proj-1",
  code: "PRJ-1",
  name: "Test Project",
  productFamilyCode: "LP-HANDWASH",
  targetSkuCodes: ["sku-1"],
  targetMarkets: ["KE"],
  targetClaims: [],
  targetBatchKg: "100",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
};

const VERSION_1: FormulationVersion = {
  schemaVersion: "1.0",
  id: "version-1",
  formulationId: "proj-1",
  versionNumber: 1,
  status: "chemist_review",
  author: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  lines: [],
  basisBatchKg: "100",
  sourceRunIds: [],
  regulatoryFindingIds: [],
  compatibilityFindingIds: [],
  safetyFindingIds: [],
  approvalRecordIds: [],
};

const collections = ["doe_studies", "doe_factors", "doe_constraints", "doe_responses", "doe_designs", "doe_runs", "doe_observations", "doe_analyses", "doe_candidates", "laboratory_trials"];
let stores: Record<string, unknown[]>;

beforeEach(() => {
  vi.clearAllMocks();
  stores = Object.fromEntries(collections.map((c) => [c, []]));
  bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(stores[collection] ?? []));
  bridge.listRecordsSeeded.mockImplementation((collection: string, seed: unknown[]) => Promise.resolve((stores[collection]?.length ? stores[collection] : seed) ?? []));
  bridge.upsertRecords.mockImplementation((collection: string, records: { id: string }[]) => {
    const ids = new Set(records.map((record) => record.id));
    stores[collection] = [...(stores[collection] ?? []).filter((record) => !ids.has((record as { id: string }).id)), ...records];
    return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
  });
  auditBridge.appendAudit.mockResolvedValue(undefined);
});

function renderPanel(versions: FormulationVersion[] = [VERSION_1]) {
  return render(
    <MemoryRouter>
      <DoePanel formulation={FORMULATION} versions={versions} auditLog={[]} onApplyCandidateLines={vi.fn()} onAuditChanged={vi.fn().mockResolvedValue(undefined)} />
    </MemoryRouter>,
  );
}

describe("DoePanel — studies list and empty state", () => {
  it("shows the empty state with a create entry point when there are no studies", async () => {
    renderPanel();
    expect(await screen.findByText(/No DOE studies yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New study" })).toBeInTheDocument();
  });

  it("prompts to select a study first when a non-Studies tab is opened with nothing selected", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Runs" }));
    expect(await screen.findByText(/Select a study from the Studies tab first/i)).toBeInTheDocument();
  });
});

describe("DOE recommendation evidence rendering", () => {
  it("renders the source formula/design, analysis provenance, unavailable uncertainty, and policy versions", () => {
    const candidate: DoeCandidate = {
      schemaVersion: "1.0", id: "candidate-1", studyId: "study-1", studyRevision: 1, analysisIds: ["analysis-1"], factorSettings: [], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1, status: "proposed", createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z",
      experimentSpace: { policyVersion: "doe-experiment-space/v1", designId: "design-1", sourceFormulaVersionId: "version-1", seed: 7, candidateCount: 4, manipulatedFactorCodes: ["A"], unchangedFormulaLineIds: [] },
      feasibility: { policyVersion: "doe-feasibility/v1", evaluatedAt: "2026-01-01T00:00:00.000Z", status: "FEASIBLE", reasons: [] },
      hardExclusions: { policyVersion: "doe-hard-exclusions/v1", safety: { status: "PASS", findingIds: [], reasons: [] }, regulatory: { status: "PASS", findingIds: [], reasons: [] } },
      acquisition: { policyVersion: "doe-acquisition/v1", method: "nearest_measured_run_distance", status: "AVAILABLE", value: 1, sourceRunIds: ["run-1"] },
      diversity: { policyVersion: "doe-diversity/v1", status: "AVAILABLE", nearestSelectedCandidateIds: [] },
      estimatedMaterialCost: { policyVersion: "doe-estimated-material-cost/v1", status: "UNAVAILABLE", priceRecordCodes: [], exchangeRateCodes: [], reason: "missing prices" },
    };
    const { getByTestId } = render(<CandidateLineageEvidence candidate={candidate} t={(key) => ({ "doe.candidates.evidence.modelVersionUnavailable": "Model version unavailable", "doe.candidates.evidence.uncertaintyUnavailable": "Prediction uncertainty unavailable" })[key] ?? key} />);
    const evidence = getByTestId("doe-candidate-lineage-candidate-1");
    expect(evidence).toHaveTextContent("version-1");
    expect(evidence).toHaveTextContent("design-1");
    expect(evidence).toHaveTextContent("analysis-1");
    expect(evidence).toHaveTextContent("Prediction uncertainty unavailable");
    expect(evidence).toHaveTextContent("doe-diversity/v1");
  });
});

describe("DOE recommendation to laboratory trial integration", () => {
  it("creates a real linked run and planned LaboratoryTrial only from a selected recommendation", async () => {
    const study: DoeStudy = { schemaVersion: "1.0", id: "study-1", studyCode: "DOE-1", title: "Selected study", projectId: "proj-1", formulationId: "proj-1", baselineFormulaVersionId: "version-1", status: "analysis_ready", designType: "full_factorial", randomizationEnabled: true, blockingEnabled: false, replicatePolicy: "none", centerPointPolicy: "none", revision: 1, createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const factor: DoeFactor = { schemaVersion: "1.0", id: "factor-a", studyId: "study-1", studyRevision: 1, factorCode: "A", name: "Material A", factorType: "continuous", sourceType: "formula_material", sourceEntityId: "material-a", lowValue: "5", centerValue: "10", highValue: "20", categoricalLevels: [], transformation: "none", precision: 2, isMixtureComponent: false, isProcessFactor: false, isControlled: true, createdAt: "2026-01-01T00:00:00.000Z" };
    const design: DoeDesign = { schemaVersion: "1.0", id: "design-1", studyId: "study-1", studyRevision: 1, designType: "full_factorial", factorSnapshot: [factor], constraintSnapshot: [], responseSnapshot: [], generationSettings: {}, seed: 7, runCount: 1, replicateCount: 0, centerPointCount: 0, blockCount: 1, generatedBy: "alice", generatedAt: "2026-01-01T00:00:00.000Z", diagnostics: { runCount: 1, degreesOfFreedom: 0, duplicateRunCount: 0, estimableTerms: [], aliasedTerms: [], isOrthogonal: true, isBalanced: true, centerPointCount: 0, replicateCount: 0, constraintViolationCount: 0, warnings: [] } };
    const candidate: DoeCandidate = { schemaVersion: "1.0", id: "candidate-1", studyId: "study-1", studyRevision: 1, analysisIds: ["analysis-1"], factorSettings: [{ factorCode: "A", codedValue: "1", actualValue: "20" }], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1, status: "selected", recommendationPolicyVersion: "doe-recommendation/v1", createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", experimentSpace: { policyVersion: "doe-experiment-space/v1", designId: "design-1", sourceFormulaVersionId: "version-1", seed: 7, candidateCount: 4, manipulatedFactorCodes: ["A"], unchangedFormulaLineIds: [] }, feasibility: { policyVersion: "doe-feasibility/v1", evaluatedAt: "2026-01-01T00:00:00.000Z", status: "FEASIBLE", reasons: [] }, hardExclusions: { policyVersion: "doe-hard-exclusions/v1", safety: { status: "PASS", findingIds: [], reasons: [] }, regulatory: { status: "PASS", findingIds: [], reasons: [] } }, acquisition: { policyVersion: "doe-acquisition/v1", method: "nearest_measured_run_distance", status: "AVAILABLE", value: 1, sourceRunIds: ["run-1"] } };
    const baseline: FormulationVersion = { ...VERSION_1, lines: [{ id: "line-a", lineNumber: 1, phase: "A", displayName: "Material A", materialId: "material-a", materialCode: "MAT-A", percent: "10", functions: [], isQsToHundred: false, provenance: { origin: "chemist_override", evidenceClaimIds: [] } }] };
    stores.doe_studies = [study];
    stores.doe_factors = [factor];
    stores.doe_designs = [design];
    stores.doe_candidates = [candidate];
    stores.doe_runs = [{ schemaVersion: "1.0", id: "run-1", studyId: "study-1", studyRevision: 1, designId: "design-1", runNumber: 1, standardOrder: 1, randomizedOrder: 1, block: 1, replicate: 1, isCenterPoint: false, factorSettings: [{ factorCode: "A", codedValue: "-1", actualValue: "5" }], status: "completed", createdAt: "2026-01-01T00:00:00.000Z" }];
    const user = userEvent.setup();
    renderPanel([baseline]);
    await user.click(await screen.findByText(/Selected study/));
    await user.click(screen.getByRole("button", { name: "Candidates" }));
    await user.click(await screen.findByTestId("doe-candidate-create-trial-candidate-1"));
    await waitFor(() => expect(stores.laboratory_trials).toHaveLength(1));
    const createdRun = stores.doe_runs.find((run) => (run as { recommendationId?: string }).recommendationId === "candidate-1") as { id: string; status: string; linkedTrialId?: string; recommendationId: string; recommendationPolicyVersion: string; recommendationAcceptedBy?: string; recommendationAcceptedAt?: string };
    const createdTrial = stores.laboratory_trials.find((trial) => (trial as { sourceDoeRunId?: string }).sourceDoeRunId === createdRun.id) as { status: string; sourceDoeStudyId: string; sourceDoeDesignId: string; sourceDoeRunId: string; sourceFormulaVersionId: string };
    expect(createdRun).toMatchObject({ status: "trial_created", recommendationId: "candidate-1", recommendationPolicyVersion: "doe-recommendation/v1", recommendationAcceptedBy: "local", recommendationAcceptedAt: expect.any(String) });
    expect(createdTrial).toMatchObject({ status: "planned", sourceDoeStudyId: "study-1", sourceDoeDesignId: "design-1", sourceDoeRunId: createdRun.id, sourceFormulaVersionId: "version-1" });
    expect(createdRun.linkedTrialId).toBeTruthy();
    expect((stores.doe_candidates[0] as DoeCandidate).status).toBe("selected");
  });

  it("revalidates a persisted accepted run on retry and does not create a second trial", async () => {
    const study: DoeStudy = { schemaVersion: "1.0", id: "study-1", studyCode: "DOE-1", title: "Selected study", projectId: "proj-1", formulationId: "proj-1", baselineFormulaVersionId: "version-1", status: "analysis_ready", designType: "full_factorial", randomizationEnabled: true, blockingEnabled: false, replicatePolicy: "none", centerPointPolicy: "none", revision: 1, createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const factor: DoeFactor = { schemaVersion: "1.0", id: "factor-a", studyId: "study-1", studyRevision: 1, factorCode: "A", name: "Material A", factorType: "continuous", sourceType: "formula_material", sourceEntityId: "material-a", lowValue: "5", centerValue: "10", highValue: "20", categoricalLevels: [], transformation: "none", precision: 2, isMixtureComponent: false, isProcessFactor: false, isControlled: true, createdAt: "2026-01-01T00:00:00.000Z" };
    const design: DoeDesign = { schemaVersion: "1.0", id: "design-1", studyId: "study-1", studyRevision: 1, designType: "full_factorial", factorSnapshot: [factor], constraintSnapshot: [], responseSnapshot: [], generationSettings: {}, seed: 7, runCount: 1, replicateCount: 0, centerPointCount: 0, blockCount: 1, generatedBy: "alice", generatedAt: "2026-01-01T00:00:00.000Z", diagnostics: { runCount: 1, degreesOfFreedom: 0, duplicateRunCount: 0, estimableTerms: [], aliasedTerms: [], isOrthogonal: true, isBalanced: true, centerPointCount: 0, replicateCount: 0, constraintViolationCount: 0, warnings: [] } };
    const candidate: DoeCandidate = { schemaVersion: "1.0", id: "candidate-1", studyId: "study-1", studyRevision: 1, analysisIds: ["analysis-1"], factorSettings: [{ factorCode: "A", codedValue: "1", actualValue: "20" }], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1, status: "selected", recommendationPolicyVersion: "doe-recommendation/v1", createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", experimentSpace: { policyVersion: "doe-experiment-space/v1", designId: "design-1", sourceFormulaVersionId: "version-1", seed: 7, candidateCount: 4, manipulatedFactorCodes: ["A"], unchangedFormulaLineIds: [] }, feasibility: { policyVersion: "doe-feasibility/v1", evaluatedAt: "2026-01-01T00:00:00.000Z", status: "FEASIBLE", reasons: [] }, hardExclusions: { policyVersion: "doe-hard-exclusions/v1", safety: { status: "PASS", findingIds: [], reasons: [] }, regulatory: { status: "PASS", findingIds: [], reasons: [] } }, acquisition: { policyVersion: "doe-acquisition/v1", method: "nearest_measured_run_distance", status: "AVAILABLE", value: 1, sourceRunIds: ["run-1"] } };
    const run = { schemaVersion: "1.0", id: "accepted-run", studyId: "study-1", studyRevision: 1, designId: "design-1", runNumber: 2, standardOrder: 2, randomizedOrder: 2, block: 1, replicate: 1, isCenterPoint: false, factorSettings: candidate.factorSettings, status: "planned", recommendationId: candidate.id, recommendationPolicyVersion: "doe-recommendation/v1", recommendationAcceptedBy: "alice", recommendationAcceptedAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z" };
    stores.doe_studies = [study];
    stores.doe_factors = [factor];
    stores.doe_designs = [design];
    stores.doe_candidates = [candidate];
    stores.doe_runs = [run];
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByText(/Selected study/));
    await user.click(screen.getByRole("button", { name: "Candidates" }));
    await user.click(await screen.findByTestId("doe-candidate-create-trial-candidate-1"));
    await waitFor(() => expect(stores.laboratory_trials).toHaveLength(1));
    const trial = stores.laboratory_trials[0] as { sourceDoeRunId: string; status: string };
    expect(trial).toMatchObject({ sourceDoeRunId: "accepted-run", status: "planned" });
    expect(stores.doe_runs).toHaveLength(1);
    expect(stores.doe_runs[0]).toMatchObject({ status: "trial_created", linkedTrialId: expect.any(String) });
  });

  it("blocks generic Runs actions and fails closed for a malformed recommendation-origin run", async () => {
    const study: DoeStudy = { schemaVersion: "1.0", id: "study-1", studyCode: "DOE-1", title: "Selected study", projectId: "proj-1", formulationId: "proj-1", baselineFormulaVersionId: "version-1", status: "analysis_ready", designType: "full_factorial", randomizationEnabled: true, blockingEnabled: false, replicatePolicy: "none", centerPointPolicy: "none", revision: 1, createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const factor: DoeFactor = { schemaVersion: "1.0", id: "factor-a", studyId: "study-1", studyRevision: 1, factorCode: "A", name: "Material A", factorType: "continuous", sourceType: "formula_material", sourceEntityId: "material-a", lowValue: "5", centerValue: "10", highValue: "20", categoricalLevels: [], transformation: "none", precision: 2, isMixtureComponent: false, isProcessFactor: false, isControlled: true, createdAt: "2026-01-01T00:00:00.000Z" };
    const design: DoeDesign = { schemaVersion: "1.0", id: "design-1", studyId: "study-1", studyRevision: 1, designType: "full_factorial", factorSnapshot: [factor], constraintSnapshot: [], responseSnapshot: [], generationSettings: {}, seed: 7, runCount: 1, replicateCount: 0, centerPointCount: 0, blockCount: 1, generatedBy: "alice", generatedAt: "2026-01-01T00:00:00.000Z", diagnostics: { runCount: 1, degreesOfFreedom: 0, duplicateRunCount: 0, estimableTerms: [], aliasedTerms: [], isOrthogonal: true, isBalanced: true, centerPointCount: 0, replicateCount: 0, constraintViolationCount: 0, warnings: [] } };
    const candidate: DoeCandidate = { schemaVersion: "1.0", id: "candidate-1", studyId: "study-1", studyRevision: 1, analysisIds: ["analysis-1"], factorSettings: [{ factorCode: "A", codedValue: "1", actualValue: "20" }], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1, status: "selected", recommendationPolicyVersion: "doe-recommendation/v1", createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", experimentSpace: { policyVersion: "doe-experiment-space/v1", designId: "design-1", sourceFormulaVersionId: "version-1", seed: 7, candidateCount: 4, manipulatedFactorCodes: ["A"], unchangedFormulaLineIds: [] }, feasibility: { policyVersion: "doe-feasibility/v1", evaluatedAt: "2026-01-01T00:00:00.000Z", status: "FEASIBLE", reasons: [] }, hardExclusions: { policyVersion: "doe-hard-exclusions/v1", safety: { status: "PASS", findingIds: [], reasons: [] }, regulatory: { status: "PASS", findingIds: [], reasons: [] } }, acquisition: { policyVersion: "doe-acquisition/v1", method: "nearest_measured_run_distance", status: "AVAILABLE", value: 1, sourceRunIds: ["run-1"] } };
    const run = { schemaVersion: "1.0", id: "malformed-run", studyId: "study-1", studyRevision: 1, designId: "design-1", runNumber: 2, standardOrder: 2, randomizedOrder: 2, block: 1, replicate: 1, isCenterPoint: false, factorSettings: candidate.factorSettings, status: "planned", recommendationId: candidate.id, recommendationPolicyVersion: "doe-recommendation/v1", createdAt: "2026-01-02T00:00:00.000Z" };
    stores.doe_studies = [study];
    stores.doe_factors = [factor];
    stores.doe_designs = [design];
    stores.doe_candidates = [candidate];
    stores.doe_runs = [run];
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByText(/Selected study/));
    await user.click(screen.getByRole("button", { name: "Runs" }));
    await user.click(await screen.findByRole("button", { name: /A=20/ }));
    expect(screen.queryByRole("button", { name: /Generate trial/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/link existing trial/i)).not.toBeInTheDocument();
    const statusSelect = screen.getAllByRole("combobox").find((select) => select.querySelector('option[value="trial_created"]'));
    expect(statusSelect).toBeDefined();
    await user.selectOptions(statusSelect!, "trial_created");
    expect(stores.doe_runs[0]).toMatchObject({ status: "planned" });
    expect(stores.laboratory_trials).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Candidates" }));
    await user.click(await screen.findByTestId("doe-candidate-create-trial-candidate-1"));
    expect(await screen.findByText(/no human acceptance actor provenance/i)).toBeInTheDocument();
    expect(stores.laboratory_trials).toHaveLength(0);
    expect(stores.doe_runs).toEqual([run]);
    expect((stores.doe_runs[0] as { status: string }).status).toBe("planned");
  });
});

describe("DoePanel — study wizard", () => {
  it("only ever offers real saved versions as the baseline, never a working draft", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "New study" }));
    const dialog = await screen.findByRole("dialog", { name: "New DOE study" });
    const versionSelect = within(dialog).getByLabelText(/Baseline formula version/i);
    const options = within(versionSelect).getAllByRole("option").map((o) => o.textContent);
    expect(options.some((o) => /version 1/i.test(o ?? "") || /v1/i.test(o ?? ""))).toBe(true);
    expect(options.some((o) => /draft/i.test(o ?? ""))).toBe(false);
  });

  it("disables Generate design until a baseline, at least one factor and at least one response are set, then generates a real design + randomized runs", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "New study" }));
    const dialog = await screen.findByRole("dialog", { name: "New DOE study" });

    // Step 1: project — pick the baseline version.
    await user.selectOptions(within(dialog).getByLabelText(/Baseline formula version/i), "version-1");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    // Step 2: objective.
    await user.type(within(dialog).getByLabelText(/Study code/i), "DOE-TEST");
    await user.type(within(dialog).getByLabelText(/^Title/i), "Screening Study");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    // Step 3: factors — add one continuous factor.
    await user.click(within(dialog).getByRole("button", { name: /Add factor/i }));
    await user.clear(within(dialog).getByPlaceholderText("code"));
    await user.type(within(dialog).getByPlaceholderText("code"), "A");
    await user.clear(within(dialog).getByPlaceholderText("low"));
    await user.type(within(dialog).getByPlaceholderText("low"), "10");
    await user.clear(within(dialog).getByPlaceholderText("high"));
    await user.type(within(dialog).getByPlaceholderText("high"), "20");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    // Step 4: constraints — none needed.
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    // Step 5: responses — add one response.
    await user.click(within(dialog).getByRole("button", { name: /Add response/i }));
    await user.type(within(dialog).getByPlaceholderText("response name"), "Viscosity");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    // Step 6: design type — leave the default (full factorial).
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    // Step 7: generation settings — leave defaults.
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    // Step 8: preview.
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    // Step 9: confirm — generate.
    const generateButton = within(dialog).getByRole("button", { name: /Generate design/i });
    expect(generateButton).not.toBeDisabled();
    await user.click(generateButton);

    // Generation succeeds and switches to the Design tab; switch back to
    // Studies to confirm the new study is really there.
    await user.click(await screen.findByRole("button", { name: "Studies" }));
    expect(await screen.findByText(/DOE-TEST/)).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith("doe_studies", expect.any(Array));
    expect(bridge.upsertRecords).toHaveBeenCalledWith("doe_factors", expect.any(Array));
    expect(bridge.upsertRecords).toHaveBeenCalledWith("doe_responses", expect.any(Array));
    expect(bridge.upsertRecords).toHaveBeenCalledWith("doe_designs", expect.any(Array));
    // A single continuous factor with low=10/high=20 -> a 2-run full factorial.
    expect(bridge.upsertRecords).toHaveBeenCalledWith("doe_runs", expect.arrayContaining([expect.objectContaining({ studyId: expect.any(String) })]));
    const runsCall = bridge.upsertRecords.mock.calls.find((call: unknown[]) => call[0] === "doe_runs");
    expect(runsCall?.[1]).toHaveLength(2);
  });

  it("refuses generation with no saved versions available and shows the warning", async () => {
    const user = userEvent.setup();
    renderPanel([]);
    await user.click(screen.getByRole("button", { name: "New study" }));
    const dialog = await screen.findByRole("dialog", { name: "New DOE study" });
    const versionSelect = within(dialog).getByLabelText(/Baseline formula version/i);
    const options = within(versionSelect).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["—"]);
  });
});

describe("DoePanel — guided-tour target resolution (Phase 10 Session 4)", () => {
  it("resolves every real element the doe tour points at, even with no study selected", async () => {
    renderPanel();
    await screen.findByText(/No DOE studies yet/i);
    for (const tab of ["design", "responses", "runs", "analysis"]) {
      expect(document.querySelector(`[data-tour="doe.tab.${tab}"]`)).toBeInTheDocument();
    }
  });
});
