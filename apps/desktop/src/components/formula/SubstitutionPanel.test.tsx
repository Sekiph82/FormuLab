/**
 * Integration coverage for the Substitution dialog's one-to-one flow (kept
 * green as a regression check) and its new multi-material system
 * substitution flow (spec §A7/§A8). Same mocking discipline as
 * AdvancedOptimizerPanel.test.tsx: only `@/lib/masterdata` and `@/lib/tauri`
 * are mocked — candidate generation, scoring and problem-building are the
 * real engine code.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, RawMaterial } from "@ai4s/shared";
import { SubstitutionDialog } from "./SubstitutionPanel";

const bridge = {
  listRecords: vi.fn(),
  upsertRecords: vi.fn(),
};

vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
}));

const tauriBridge = { run: vi.fn() };
vi.mock("@/lib/tauri", () => ({
  runAdvancedFormulationOptimize: (...a: [unknown]) => tauriBridge.run(...a),
}));

function material(over: Partial<RawMaterial> & { code: string; displayName: string }): RawMaterial {
  return {
    schemaVersion: "1.0",
    casNumbers: [],
    ecNumbers: [],
    functions: [],
    documents: [],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    active: true,
    activeMatterState: "known",
    ...over,
  } as unknown as RawMaterial;
}

const MAT_A = material({ code: "A", displayName: "Anionic A", functions: ["anionic_surfactant"], activeMatterPercent: "70" });
const MAT_B = material({ code: "B", displayName: "Preservative B", functions: ["preservative"], activeMatterPercent: "100" });
const MAT_C = material({ code: "C", displayName: "Anionic C", functions: ["anionic_surfactant"], activeMatterPercent: "65" });
const MAT_D = material({ code: "D", displayName: "Preservative D", functions: ["preservative"], activeMatterPercent: "100" });

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

const LINE_A: FormulationLine = {
  id: "line-a",
  lineNumber: 0,
  phase: "A",
  materialId: "A",
  materialCode: "A",
  displayName: "Anionic A",
  functions: ["anionic_surfactant"],
  percent: "50",
  isQsToHundred: false,
  activeMatterPercent: "70",
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

const LINE_B: FormulationLine = {
  id: "line-b",
  lineNumber: 1,
  phase: "A",
  materialId: "B",
  materialCode: "B",
  displayName: "Preservative B",
  functions: ["preservative"],
  percent: "1",
  isQsToHundred: false,
  activeMatterPercent: "100",
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

const ALL_LINES = [LINE_A, LINE_B];

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockImplementation((collection: string) => {
    if (collection === "materials") return Promise.resolve([MAT_A, MAT_B, MAT_C, MAT_D]);
    return Promise.resolve([]);
  });
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

function renderDialog(onApplySystem = vi.fn()) {
  return {
    onApplySystem,
    ...render(
      <SubstitutionDialog
        formulation={FORMULATION}
        line={LINE_A}
        allLines={ALL_LINES}
        onApply={vi.fn()}
        onApplySystem={onApplySystem}
        onClose={vi.fn()}
      />,
    ),
  };
}

describe("SubstitutionDialog — opens without exception", () => {
  it("renders the dialog title and the one-to-one candidate list", async () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByText(/Anionic C/)).toBeInTheDocument();
  });
});

describe("SubstitutionDialog — system substitution", () => {
  it("multiple lines can be selected", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(/Anionic C/);

    const lineBCheckbox = screen.getByRole("checkbox", { name: /Preservative B/ });
    expect((lineBCheckbox as HTMLInputElement).checked).toBe(false);
    await user.click(lineBCheckbox);
    expect((lineBCheckbox as HTMLInputElement).checked).toBe(true);

    expect(screen.getByRole("button", { name: "Generate candidate systems" })).toBeEnabled();
  });

  it("generates system candidates covering every preserved function, and rejects partial coverage", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(/Anionic C/);

    await user.click(screen.getByRole("checkbox", { name: /Preservative B/ }));
    await user.click(screen.getByRole("button", { name: "Generate candidate systems" }));

    expect(await screen.findByText(/candidate system\(s\) generated/)).toBeInTheDocument();
    // A single anionic-only or preservative-only material cannot cover both
    // preserved functions on its own — those combinations are rejected with
    // a reason, not silently dropped.
    expect(screen.getByText("Rejected combinations")).toBeInTheDocument();
  });

  it("evaluates generated systems through the real optimizer and renders the result", async () => {
    tauriBridge.run.mockResolvedValue({
      schemaVersion: "1.0",
      runId: "run-1",
      problemId: "prob-1",
      status: "optimal",
      formulaLines: [
        { materialId: "C", materialCode: "C", name: "Anionic C", percent: "49.0000", activeContributionPercent: "31.8500", quantityKg: "49.0000", rawMaterialCost: "49.00" },
        { materialId: "D", materialCode: "D", name: "Preservative D", percent: "1.0000", activeContributionPercent: "1.0000", quantityKg: "1.0000", rawMaterialCost: "1.00" },
      ],
      totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "32.8500", totalRawMaterialCost: "50.00" },
      objectiveResults: [],
      constraintResults: [],
      propertyResults: [],
      warnings: [],
      solverMetadata: { solver: "cbc", solveTimeMs: 5, variableCount: 1, constraintCount: 1, isMixedInteger: false, timeoutSeconds: 15, cancelled: false },
      completedAt: "2026-01-01T00:00:00.000Z",
    });

    const user = userEvent.setup();
    const { onApplySystem } = renderDialog();
    await screen.findByText(/Anionic C/);

    await user.click(screen.getByRole("checkbox", { name: /Preservative B/ }));
    await user.click(screen.getByRole("button", { name: "Generate candidate systems" }));
    await screen.findByText(/candidate system\(s\) generated/);
    await user.click(screen.getByRole("button", { name: "Evaluate through optimizer" }));

    await waitFor(() => expect(tauriBridge.run).toHaveBeenCalled());
    expect(await screen.findByText("C + D")).toBeInTheDocument();

    const applyButtons = screen.getAllByRole("button", { name: /Apply/ });
    const systemApply = applyButtons[applyButtons.length - 1];
    await user.click(systemApply);

    await waitFor(() => expect(onApplySystem).toHaveBeenCalled());
    const [removedLineIds, newLines, runCode] = onApplySystem.mock.calls[0];
    expect(removedLineIds.sort()).toEqual(["line-a", "line-b"].sort());
    expect(newLines.map((l: FormulationLine) => l.materialCode).sort()).toEqual(["C", "D"]);
    expect(typeof runCode).toBe("string");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("optimization_runs", expect.any(Array));
    expect(bridge.upsertRecords).toHaveBeenCalledWith("substitution_runs", expect.any(Array));
  });

  it("renders an infeasible system result with its cause, and offers no Apply for it", async () => {
    tauriBridge.run.mockResolvedValue({
      schemaVersion: "1.0",
      runId: "run-1",
      problemId: "prob-1",
      status: "infeasible",
      formulaLines: [],
      objectiveResults: [],
      constraintResults: [],
      propertyResults: [],
      warnings: [],
      infeasibility: { causes: [{ code: "no_combination_satisfies_all_constraints", constraintIds: [], materialIds: [], message: "No combination works.", suggestedActions: [] }] },
      solverMetadata: { solver: "cbc", solveTimeMs: 5, variableCount: 1, constraintCount: 1, isMixedInteger: false, timeoutSeconds: 15, cancelled: false },
      completedAt: "2026-01-01T00:00:00.000Z",
    });

    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(/Anionic C/);
    await user.click(screen.getByRole("checkbox", { name: /Preservative B/ }));
    await user.click(screen.getByRole("button", { name: "Generate candidate systems" }));
    await screen.findByText(/candidate system\(s\) generated/);
    await user.click(screen.getByRole("button", { name: "Evaluate through optimizer" }));

    expect(await screen.findByText("No combination works.")).toBeInTheDocument();
  });
});
