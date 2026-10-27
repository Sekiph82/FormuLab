/**
 * Integration coverage for the Advanced Optimizer panel's scenario workflow
 * and result rendering (spec §A8's interaction checklist).
 *
 * This environment could not drive the actual Tauri WebView (browser
 * automation controls Chrome tabs, not the packaged desktop window, and the
 * app's own `isTauri` gate makes every masterdata/solver call a no-op
 * outside that window anyway — see docs/OPTIMIZER_UI_VERIFICATION.md for the
 * full explanation of why and what was verified instead). Per the fallback
 * this module mounts the REAL component with REAL React state; only the
 * Tauri IPC boundary (`@/lib/masterdata`, `@/lib/tauri`) is mocked — no
 * formula calculation, scenario, or result-rendering logic is mocked here.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, FormulationVersion, OptimizationScenario, RawMaterial } from "@formulab/shared";
import { createAlternativeRankingRecord, rankAlternatives } from "@formulab/shared";
import { AdvancedOptimizerPanel } from "./AdvancedOptimizerPanel";
import { fingerprintFormulationVersion } from "@/lib/rankingPredictionSource";

const bridge = {
  listRecords: vi.fn(),
  listRecordsSeeded: vi.fn(),
  upsertRecords: vi.fn(),
};
const formulationsBridge = vi.hoisted(() => ({ listFormulations: vi.fn(), readFormulation: vi.fn() }));

vi.mock("@/lib/formulations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formulations")>();
  return {
    ...actual,
    listFormulations: () => formulationsBridge.listFormulations(),
    readFormulation: (id: string) => formulationsBridge.readFormulation(id),
  };
});

vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  listRecordsSeeded: (...a: [string, unknown[]]) => bridge.listRecordsSeeded(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
}));

const tauriBridge = {
  run: vi.fn(),
  cancel: vi.fn(),
};

vi.mock("@/lib/tauri", () => ({
  runAdvancedFormulationOptimize: (...a: [unknown]) => tauriBridge.run(...a),
  cancelAdvancedFormulationOptimize: () => tauriBridge.cancel(),
}));

const MATERIAL_A: RawMaterial = {
  schemaVersion: "1.0",
  code: "A",
  displayName: "Material A",
  casNumbers: [],
  ecNumbers: [],
  functions: ["anionic_surfactant"],
  activeMatterPercent: "70",
  activeMatterState: "known",
  documents: [],
  regulatoryStatuses: [],
  hazardClassifications: [],
  allergens: [],
  incompatibilities: [],
  substituteCodes: [],
  active: true,
} as unknown as RawMaterial;

const FORMULATION: Formulation = {
  schemaVersion: "1.0",
  id: "proj-1",
  code: "PRJ-1",
  name: "Test Project",
  productFamilyCode: "fam-1",
  targetSkuCodes: [],
  targetMarkets: ["KE"],
  targetClaims: [],
  targetBatchKg: "100",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
};

const CURRENT_LINES: FormulationLine[] = [];
const SOURCE_VERSION = { schemaVersion: "1.0", id: "version-1", formulationId: "proj-1", versionNumber: 1, status: "concept", author: "local", createdAt: "2026-01-01T00:00:00.000Z", lines: [], basisBatchKg: "100", sourceRunIds: [], regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [] } as FormulationVersion;

function renderPanel(sourceAlternative?: { sessionId: string; alternativeId: string; sourceFormulationVersionId?: string; rankingRecordCode?: string; formulaFingerprint?: { algorithm: "sha256"; canonicalization: "formulab-canonical-json-v1"; digest: string } }, formulation = FORMULATION) {
  return render(
    <AdvancedOptimizerPanel
      formulation={formulation}
      batchKg="100"
      currentLines={CURRENT_LINES}
      onApplyResult={vi.fn()}
      sourceAlternative={sourceAlternative}
    />,
  );
}

async function collectionResult(collection: string) {
  if (collection === "materials") return [MATERIAL_A];
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockImplementation(collectionResult);
  bridge.listRecordsSeeded.mockImplementation((collection: string) => collectionResult(collection));
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
  formulationsBridge.listFormulations.mockResolvedValue([FORMULATION]);
  formulationsBridge.readFormulation.mockResolvedValue({ formulation: FORMULATION, versions: [SOURCE_VERSION] });
});

describe("AdvancedOptimizerPanel — opens without exception", () => {
  it("renders the candidate list and the scenario section", async () => {
    renderPanel();
    expect(await screen.findByText(/Candidate materials/)).toBeInTheDocument();
    expect(screen.getByText("Scenarios")).toBeInTheDocument();
    expect(screen.getByText("Material A")).toBeInTheDocument();
  });
});

describe("AdvancedOptimizerPanel — scenario lifecycle", () => {
  it("New scenario persists a real OptimizationScenario record", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Material A");

    const nameInput = screen.getByPlaceholderText("Scenario name");
    await user.type(nameInput, "Lowest cost");
    const newButton = screen.getByRole("button", { name: "New" });
    await user.click(newButton);

    await waitFor(() => {
      expect(bridge.upsertRecords).toHaveBeenCalledWith(
        "optimization_scenarios",
        expect.arrayContaining([expect.objectContaining({ name: "Lowest cost", revision: 1, status: "active" })]),
      );
    });
  });

  it("loads a saved scenario's candidate selection when chosen from the selector", async () => {
    const scenario: OptimizationScenario = {
      schemaVersion: "1.0",
      code: "scenario-1",
      scenarioGroupId: "group-1",
      revision: 1,
      status: "active",
      projectId: "proj-1",
      name: "Saved scenario",
      includedMaterialIds: ["A"],
      excludedMaterialIds: [],
      problem: {
        schemaVersion: "1.0",
        id: "prob-1",
        projectId: "proj-1",
        productFamilyId: "fam-1",
        packagingSkuIds: [],
        marketProfileIds: [],
        batch: { sizeKg: "100" },
        materials: [
          {
            id: "A",
            materialCode: "A",
            name: "Material A",
            price: { state: "missing" },
            currency: "KES",
            activeMatterPercent: { value: "70", state: "known" },
            functions: ["anionic_surfactant"],
            casNumbers: [],
            excluded: false,
          },
        ],
        compositionConstraints: [],
        functionalConstraints: [],
        ratioConstraints: [],
        conditionalConstraints: [],
        propertyTargets: [],
        compatibilityPolicy: { mode: "exclude_blocking" },
        safetyPolicy: { mode: "exclude_blocking" },
        objectiveConfig: { type: "weighted", objectives: [{ metric: "raw_material_cost", direction: "minimize", weight: "1" }] },
        solverConfig: { solver: "cbc", timeoutSeconds: 30, cancellable: true, exportLpFile: false },
        precisionPolicyVersion: "1.0",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "materials") return Promise.resolve([MATERIAL_A]);
      if (collection === "optimization_scenarios") return Promise.resolve([scenario]);
      return Promise.resolve([]);
    });

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Material A");

    const selector = screen.getByLabelText("Scenario");
    await user.selectOptions(selector, "scenario-1");

    // The loaded scenario's material selection round-trips into the
    // candidate checklist — Material A's checkbox reflects the scenario.
    const checkbox = screen.getByRole("checkbox", { name: /Material A/ }) as HTMLInputElement;
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });
});

describe("AdvancedOptimizerPanel — run and result rendering", () => {
  async function eligibleRankingRecord(code: string) {
    const formulaFingerprint = await fingerprintFormulationVersion(SOURCE_VERSION);
    const candidate = {
      candidateId: "session-1:v2", sessionId: "session-1", alternativeId: "session-1:v2", versionLabel: "v2", formulaStatus: "VALID" as const,
      sourceFormulationVersionId: SOURCE_VERSION.id, formulaFingerprint,
      dimensions: {
        performance: { status: "UNAVAILABLE_MODEL" as const }, uncertainty: { status: "UNKNOWN" as const },
        cost: { status: "AVAILABLE" as const, costPerKg: 2, currency: "KES", batchKg: "100", sourceSnapshot: { authority: "FormuLab Cost Engine" as const } },
        availability: { status: "FEASIBLE" as const }, compatibility: { status: "PASS" as const }, safety: { status: "PASS" as const }, regulatory: { status: "PASS" as const },
        manufacturing: { status: "READY" as const }, evidence: { status: "NO_LINKED_EVIDENCE" as const, ingredientCount: 1, linkedIngredientCount: 0, uniqueSourceCount: 0 },
        referenceSupport: { status: "UNKNOWN" as const, formulaCount: 0, supplierCount: 0, sourceRecordIds: [] },
      },
    };
    return createAlternativeRankingRecord({ code, sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context: { batchKg: "100", currency: "KES" }, rankings: rankAlternatives([candidate]) });
  }

  it("persists the original ranking alternative link on the canonical optimizer run", async () => {
    tauriBridge.run.mockResolvedValue({ status: "optimal", formulaLines: [], totals: { totalPercent: "100.0000", totalActiveMatterPercent: "0.0000" }, objectiveResults: [], constraintResults: [], propertyResults: [], warnings: [], solverMetadata: { isMixedInteger: false, solveTimeMs: 12 }, runId: "run-source" });
    const sourceAlternative = { origin: "ranking" as const, sessionId: "session-1", alternativeId: "session-1:v2", sourceFormulationVersionId: "version-1", rankingRecordCode: "ranking-1" };
    const candidate = {
      candidateId: "session-1:v2", sessionId: "session-1", alternativeId: "session-1:v2", versionLabel: "v2", formulaStatus: "VALID" as const, sourceFormulationVersionId: "version-1",
      dimensions: {
        performance: { status: "UNAVAILABLE_MODEL" as const }, uncertainty: { status: "UNKNOWN" as const },
        cost: { status: "AVAILABLE" as const, costPerKg: 2, currency: "KES", batchKg: "100", sourceSnapshot: { authority: "FormuLab Cost Engine" as const } },
        availability: { status: "FEASIBLE" as const }, compatibility: { status: "PASS" as const }, safety: { status: "PASS" as const }, regulatory: { status: "PASS" as const },
        manufacturing: { status: "READY" as const }, evidence: { status: "NO_LINKED_EVIDENCE" as const, ingredientCount: 1, linkedIngredientCount: 0, uniqueSourceCount: 0 },
        referenceSupport: { status: "UNKNOWN" as const, formulaCount: 0, supplierCount: 0, sourceRecordIds: [] },
      },
    };
    const rankingRecord = await createAlternativeRankingRecord({ code: "ranking-1", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context: { batchKg: "100", currency: "KES" }, rankings: rankAlternatives([candidate]) });
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "alternative_rankings" ? [rankingRecord] : collectionResult(collection)));
    const user = userEvent.setup();
    renderPanel(sourceAlternative);
    await screen.findByText("Material A");
    expect(screen.getByRole("status")).toHaveTextContent("session-1:v2");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));
    await waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("optimization_runs", expect.any(Array)));
    const savedRuns = bridge.upsertRecords.mock.calls.find(([collection]) => collection === "optimization_runs")?.[1] as Array<{ sourceAlternative?: unknown }>;
    expect(savedRuns[0]?.sourceAlternative).toEqual(sourceAlternative);
  });

  it("refuses a persisted Safety BLOCKED ranking before invoking the solver", async () => {
    const candidate = {
      candidateId: "session-1:v2", sessionId: "session-1", alternativeId: "session-1:v2", versionLabel: "v2", formulaStatus: "VALID" as const, sourceFormulationVersionId: "version-1",
      dimensions: {
        performance: { status: "UNAVAILABLE_MODEL" as const }, uncertainty: { status: "UNKNOWN" as const },
        cost: { status: "AVAILABLE" as const, costPerKg: 2, currency: "KES", batchKg: "100", sourceSnapshot: { authority: "FormuLab Cost Engine" as const } },
        availability: { status: "FEASIBLE" as const }, compatibility: { status: "PASS" as const }, safety: { status: "FAIL" as const }, regulatory: { status: "PASS" as const },
        manufacturing: { status: "READY" as const }, evidence: { status: "NO_LINKED_EVIDENCE" as const, ingredientCount: 1, linkedIngredientCount: 0, uniqueSourceCount: 0 },
        referenceSupport: { status: "UNKNOWN" as const, formulaCount: 0, supplierCount: 0, sourceRecordIds: [] },
      },
    };
    const rankingRecord = await createAlternativeRankingRecord({ code: "ranking-blocked", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context: { batchKg: "100", currency: "KES" }, rankings: rankAlternatives([candidate]) });
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "alternative_rankings" ? [rankingRecord] : collectionResult(collection)));
    const sourceAlternative = { origin: "ranking" as const, sessionId: "session-1", alternativeId: "session-1:v2", sourceFormulationVersionId: "version-1", rankingRecordCode: rankingRecord.code };
    const user = userEvent.setup();
    renderPanel(sourceAlternative);
    await screen.findByText("Material A");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/blocked/i);
    expect(tauriBridge.run).not.toHaveBeenCalled();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("optimization_runs", expect.anything());
  });

  it("refuses a persisted Regulatory BLOCKED ranking before invoking the solver or writing a run", async () => {
    const candidate = {
      candidateId: "session-1:v2", sessionId: "session-1", alternativeId: "session-1:v2", versionLabel: "v2", formulaStatus: "VALID" as const, sourceFormulationVersionId: "version-1",
      dimensions: {
        performance: { status: "UNAVAILABLE_MODEL" as const }, uncertainty: { status: "UNKNOWN" as const },
        cost: { status: "AVAILABLE" as const, costPerKg: 2, currency: "KES", batchKg: "100", sourceSnapshot: { authority: "FormuLab Cost Engine" as const } },
        availability: { status: "FEASIBLE" as const }, compatibility: { status: "PASS" as const }, safety: { status: "PASS" as const }, regulatory: { status: "FAIL" as const },
        manufacturing: { status: "READY" as const }, evidence: { status: "NO_LINKED_EVIDENCE" as const, ingredientCount: 1, linkedIngredientCount: 0, uniqueSourceCount: 0 },
        referenceSupport: { status: "UNKNOWN" as const, formulaCount: 0, supplierCount: 0, sourceRecordIds: [] },
      },
    };
    const record = await createAlternativeRankingRecord({ code: "ranking-regulatory-blocked", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context: { batchKg: "100", currency: "KES" }, rankings: rankAlternatives([candidate]) });
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "alternative_rankings" ? [record] : collectionResult(collection)));
    const source = { origin: "ranking" as const, sessionId: "session-1", alternativeId: "session-1:v2", sourceFormulationVersionId: "version-1", rankingRecordCode: record.code };
    const user = userEvent.setup();
    renderPanel(source);
    await screen.findByText("Material A");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/blocked/i);
    expect(tauriBridge.run).not.toHaveBeenCalled();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("optimization_runs", expect.anything());
  });

  it("refuses a historical ranking link without an exact saved source version before invoking the solver", async () => {
    const source = { origin: "ranking" as const, sessionId: "session-1", alternativeId: "session-1:v2", rankingRecordCode: "ranking-legacy" };
    const user = userEvent.setup();
    renderPanel(source);
    await screen.findByText("Material A");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/exact saved source FormulationVersion/i);
    expect(tauriBridge.run).not.toHaveBeenCalled();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("optimization_runs", expect.anything());
  });

  it.each(["wrong-version", "tampered-checksum", "changed-saved-formula"] as const)("keeps the solver and run store untouched for %s lineage", async (failure) => {
    const record = await eligibleRankingRecord(`ranking-${failure}`);
    let storedRecord = record;
    const sourceVersionId = failure === "wrong-version" ? "version-substituted" : SOURCE_VERSION.id;
    const formulaFingerprint = await fingerprintFormulationVersion(SOURCE_VERSION);

    if (failure === "tampered-checksum") storedRecord = { ...record, artifactChecksum: { ...record.artifactChecksum, digest: "0".repeat(64) } };
    if (failure === "changed-saved-formula") {
      const changedVersion = { ...SOURCE_VERSION, lines: [{ id: "line-1", lineNumber: 0, displayName: "Changed source", percent: "100" }] as FormulationVersion["lines"] };
      formulationsBridge.readFormulation.mockResolvedValue({ formulation: FORMULATION, versions: [changedVersion] });
    }
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "alternative_rankings" ? [storedRecord] : collectionResult(collection)));

    const source = { origin: "ranking" as const, sessionId: "session-1", alternativeId: "session-1:v2", sourceFormulationVersionId: sourceVersionId, formulaFingerprint, rankingRecordCode: record.code };
    const user = userEvent.setup();
    renderPanel(source);
    await screen.findByText("Material A");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(tauriBridge.run).not.toHaveBeenCalled();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("optimization_runs", expect.anything());
  });

  it("refuses ranking A when the solver panel is bound to project B without calling the solver or writing a run", async () => {
    const candidate = {
      candidateId: "session-1:v2", sessionId: "session-1", alternativeId: "session-1:v2", versionLabel: "v2", formulaStatus: "VALID" as const, sourceFormulationVersionId: "version-1",
      dimensions: {
        performance: { status: "UNAVAILABLE_MODEL" as const }, uncertainty: { status: "UNKNOWN" as const },
        cost: { status: "MISSING" as const }, availability: { status: "UNKNOWN" as const }, compatibility: { status: "PASS" as const },
        safety: { status: "PASS" as const }, regulatory: { status: "PASS" as const }, manufacturing: { status: "READY" as const },
        evidence: { status: "NO_LINKED_EVIDENCE" as const, ingredientCount: 0, linkedIngredientCount: 0, uniqueSourceCount: 0 },
        referenceSupport: { status: "UNKNOWN" as const, formulaCount: 0, supplierCount: 0, sourceRecordIds: [] },
      },
    };
    const record = await createAlternativeRankingRecord({ code: "ranking-project-mismatch", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context: { batchKg: "100", currency: "KES" }, rankings: rankAlternatives([candidate]) });
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "alternative_rankings" ? [record] : collectionResult(collection)));
    const source = { origin: "ranking" as const, sessionId: "session-1", alternativeId: "session-1:v2", sourceFormulationVersionId: "version-1", rankingRecordCode: record.code };
    const wrongProject = { ...FORMULATION, id: "proj-B" };
    const user = userEvent.setup();
    renderPanel(source, wrongProject);
    await screen.findByText("Material A");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not own/i);
    expect(tauriBridge.run).not.toHaveBeenCalled();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("optimization_runs", expect.anything());
  });

  it("Run starts the solver and renders an optimal result", async () => {
    tauriBridge.run.mockResolvedValue({
      status: "optimal",
      formulaLines: [
        { materialId: "A", materialCode: "A", name: "Material A", percent: "100.0000", activeContributionPercent: "70.0000", quantityKg: "100.0000", rawMaterialCost: "100.00" },
      ],
      totals: { totalPercent: "100.0000", totalActiveMatterPercent: "70.0000", totalRawMaterialCost: "100.00" },
      objectiveResults: [],
      constraintResults: [],
      propertyResults: [],
      warnings: [],
      solverMetadata: { isMixedInteger: false, solveTimeMs: 12 },
      runId: "run-1",
    });

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Material A");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));

    await waitFor(() => expect(tauriBridge.run).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /Apply to draft/ })).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith("optimization_runs", expect.any(Array));
  });

  it("renders feasible_with_penalties with the soft-constraint list", async () => {
    tauriBridge.run.mockResolvedValue({
      status: "feasible_with_penalties",
      formulaLines: [
        { materialId: "A", materialCode: "A", name: "Material A", percent: "60.0000", activeContributionPercent: "42.0000", quantityKg: "60.0000" },
      ],
      totals: { totalPercent: "100.0000", totalActiveMatterPercent: "42.0000" },
      objectiveResults: [],
      constraintResults: [
        {
          constraintId: "exact_a",
          kind: "composition",
          strictness: "soft",
          satisfied: false,
          requestedTarget: "80.0000",
          achievedValue: "60.0000",
          deviation: "20.0000",
        },
      ],
      propertyResults: [
        { targetId: "pt1", property: "active_matter", value: "42.0000", dataCompleteness: "complete", classification: "calculated", constraintStatus: "reported_only", laboratoryConfirmationRequired: false },
      ],
      warnings: [],
      solverMetadata: { isMixedInteger: false, solveTimeMs: 12 },
      runId: "run-2",
    });

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Material A");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));

    expect(await screen.findByRole("status")).toHaveTextContent(/soft constraint/);
    expect(screen.getByText("exact_a", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/violated/)).toBeInTheDocument();
    expect(screen.getByText(/active_matter/)).toBeInTheDocument();
  });

  it("renders structured infeasibility causes", async () => {
    tauriBridge.run.mockResolvedValue({
      status: "infeasible",
      infeasibility: {
        causes: [{ code: "insufficient_stock_or_usage_cap", message: "Stock cannot fill the batch.", suggestedActions: ["Add more stock."] }],
      },
    });

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Material A");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));

    expect(await screen.findByText("Stock cannot fill the batch.")).toBeInTheDocument();
    expect(screen.getByText("Add more stock.")).toBeInTheDocument();
  });

  it("Cancel calls the real cancel bridge while a solve is in progress", async () => {
    let resolveRun: (v: unknown) => void = () => {};
    tauriBridge.run.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    );
    tauriBridge.cancel.mockResolvedValue(true);

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Material A");
    await user.click(screen.getByLabelText(/Material A/));
    await user.click(screen.getByRole("button", { name: /Run optimization/ }));

    const cancelButton = await screen.findByRole("button", { name: /Cancel/ });
    await user.click(cancelButton);
    expect(tauriBridge.cancel).toHaveBeenCalled();

    resolveRun({ status: "cancelled" });
  });
});

describe("AdvancedOptimizerPanel — profile application never silently overwrites", () => {
  it("apply_missing only adds constraints, never removes existing ones", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "materials") return Promise.resolve([MATERIAL_A]);
      return Promise.resolve([]);
    });
    bridge.listRecordsSeeded.mockImplementation((collection: string, seed: { code: string }[]) => {
      if (collection === "optimization_profiles") return Promise.resolve(seed);
      return Promise.resolve([]);
    });

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Material A");

    const profileSelect = screen.getByLabelText("Profile");
    const options = within(profileSelect).getAllByRole("option");
    expect(options.length).toBeGreaterThan(1); // "No profile" plus 31 seeded profiles.
    await user.selectOptions(profileSelect, options[1].getAttribute("value")!);
    await user.click(screen.getByRole("button", { name: "Apply missing" }));

    // No exception, and the functional-constraint editor is still present —
    // apply_missing did not clear the screen's own state.
    expect(screen.getByText("Functional-group constraints")).toBeInTheDocument();
  });

  it("Replace requires a second confirming click before it takes effect", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "materials") return Promise.resolve([MATERIAL_A]);
      return Promise.resolve([]);
    });
    bridge.listRecordsSeeded.mockImplementation((collection: string, seed: { code: string }[]) => {
      if (collection === "optimization_profiles") return Promise.resolve(seed);
      return Promise.resolve([]);
    });

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Material A");

    const profileSelect = screen.getByLabelText("Profile");
    const options = within(profileSelect).getAllByRole("option");
    await user.selectOptions(profileSelect, options[1].getAttribute("value")!);

    const replaceButton = screen.getByRole("button", { name: "Replace" });
    await user.click(replaceButton);
    expect(await screen.findByRole("button", { name: "Confirm replace" })).toBeInTheDocument();
  });
});

describe("AdvancedOptimizerPanel — FVL-04.007 hardening: stock unit contract", () => {
  // `advanced_optimizer.py` treats `materials[].stock` as a literal kg cap
  // (`cap_kg = min(cap_by_pct, stock)`) — no unit ever travels with it. A
  // non-kg InventoryRecord.unit must never be silently reported as `stock`.
  async function runAndCaptureProblem(inventory: { code: string; materialCode: string; quantity: string; reservedQuantity: string; unit: string; quarantined: boolean; released: boolean }[]) {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "materials") return Promise.resolve([MATERIAL_A]);
      if (collection === "inventory") return Promise.resolve(inventory);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Material A");
    await user.click(screen.getByRole("checkbox", { name: /Material A/ }));
    await user.click(screen.getByRole("button", { name: "Run optimization" }));
    await waitFor(() => expect(tauriBridge.run).toHaveBeenCalled());
    return tauriBridge.run.mock.calls[0][0] as { materials: { materialCode: string; stock?: { value: string; state: string } }[] };
  }

  it("a kg-denominated usable lot is reported as real stock", async () => {
    const problem = await runAndCaptureProblem([
      { code: "inv-1", materialCode: "A", quantity: "100", reservedQuantity: "10", unit: "kg", quarantined: false, released: true },
    ]);
    const a = problem.materials.find((m) => m.materialCode === "A");
    expect(a?.stock).toEqual({ value: "90", state: "known" });
  });

  it("a gram-denominated lot is NEVER relabeled as kg stock — reported unknown instead of a 1000x-wrong cap", async () => {
    const problem = await runAndCaptureProblem([
      { code: "inv-1", materialCode: "A", quantity: "100000", reservedQuantity: "0", unit: "g", quarantined: false, released: true },
    ]);
    const a = problem.materials.find((m) => m.materialCode === "A");
    expect(a?.stock).toBeUndefined();
  });
});
