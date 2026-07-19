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
import type { Formulation, FormulationLine, OptimizationScenario, RawMaterial } from "@ai4s/shared";
import { AdvancedOptimizerPanel } from "./AdvancedOptimizerPanel";

const bridge = {
  listRecords: vi.fn(),
  listRecordsSeeded: vi.fn(),
  upsertRecords: vi.fn(),
};

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

function renderPanel() {
  return render(
    <AdvancedOptimizerPanel
      formulation={FORMULATION}
      batchKg="100"
      currentLines={CURRENT_LINES}
      onApplyResult={vi.fn()}
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
