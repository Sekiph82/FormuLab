/**
 * UI-integration coverage for the Laboratory Trials workspace (spec §21):
 * create a trial, record a material weight and see the computed deviation,
 * execute a process step, enter a test result, and compare two trials.
 * Same mocking discipline as SubstitutionPanel.test.tsx — only
 * `@/lib/masterdata` is mocked; trial lifecycle, deviation and comparison
 * math are the real engine code from `@ai4s/shared`.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, LaboratoryTrial, TestDefinition } from "@ai4s/shared";
import { TrialsPanel } from "./TrialsPanel";

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

const FORMULATION: Formulation = {
  schemaVersion: "1.0",
  id: "proj-1",
  code: "PRJ-1",
  name: "Test Project",
  productFamilyCode: "fam-1",
  targetSkuCodes: ["sku-1"],
  targetMarkets: ["KE"],
  targetClaims: [],
  targetBatchKg: "100",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
};

const LINE_A: FormulationLine = {
  id: "line-a",
  lineNumber: 1,
  phase: "A",
  materialId: "A",
  materialCode: "A",
  displayName: "Water",
  functions: ["water"],
  percent: "50",
  isQsToHundred: false,
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

const PH_TEST: TestDefinition = {
  schemaVersion: "1.0",
  code: "PH",
  name: "pH",
  category: "physical",
  resultType: "numeric",
  minimum: "6",
  maximum: "8",
  passFailLogic: { rule: "within_range" },
  replicatesRequired: 1,
  requiredEquipment: [],
  requiredAttachment: false,
  applicableProductFamilies: [],
  applicableProductSkus: [],
  criticalTestFlag: false,
  verificationStatus: "not_verified",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let trialsStore: LaboratoryTrial[];

beforeEach(() => {
  vi.clearAllMocks();
  trialsStore = [];
  bridge.listRecords.mockImplementation((collection: string) => {
    if (collection === "laboratory_trials") return Promise.resolve(trialsStore);
    return Promise.resolve([]);
  });
  bridge.listRecordsSeeded.mockImplementation((collection: string) => {
    if (collection === "test_definitions") return Promise.resolve([PH_TEST]);
    return Promise.resolve([]);
  });
  bridge.upsertRecords.mockImplementation((collection: string, records: LaboratoryTrial[]) => {
    if (collection === "laboratory_trials") {
      for (const r of records) {
        const i = trialsStore.findIndex((t) => t.id === r.id);
        if (i >= 0) trialsStore[i] = r;
        else trialsStore.push(r);
      }
    }
    return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
  });
});

function renderPanel() {
  return render(
    <TrialsPanel
      formulation={FORMULATION}
      currentLines={[LINE_A]}
      basisBatchKg="100"
      approvalStatus="chemist_review"
      onApplyDraft={vi.fn()}
    />,
  );
}

async function createTrial(user: ReturnType<typeof userEvent.setup>, title: string) {
  const titleInput = screen.getByPlaceholderText("New trial title");
  await user.clear(titleInput);
  await user.type(titleInput, title);
  await user.click(screen.getByRole("button", { name: "New trial title" }));
  await screen.findByRole("heading", { name: title });
}

describe("TrialsPanel — create and select a trial", () => {
  it("creates a trial from the current working draft and shows its overview", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("No trials yet.");

    await createTrial(user, "Batch 1 pilot");

    expect(bridge.upsertRecords).toHaveBeenCalledWith("laboratory_trials", expect.any(Array));
    expect(screen.getAllByText("planned").length).toBeGreaterThan(0);
  });
});

describe("TrialsPanel — material weighing", () => {
  it("computes a percentage deviation once an actual weight is entered", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("No trials yet.");
    await createTrial(user, "Weighing trial");

    await user.click(screen.getByRole("button", { name: "Material weighing" }));
    const actualInput = await screen.findByPlaceholderText("not entered");
    await user.type(actualInput, "51");
    actualInput.blur();

    expect(await screen.findByText("2.000000")).toBeInTheDocument();
  });
});

describe("TrialsPanel — process execution", () => {
  it("adds a process step and records an actual temperature", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("No trials yet.");
    await createTrial(user, "Process trial");

    await user.click(screen.getByRole("button", { name: "Process execution" }));
    expect(screen.getByText("No process steps yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add step" }));
    expect(await screen.findByText("Step 1")).toBeInTheDocument();

    const tempInput = screen.getByLabelText("Actual temp (°C)");
    await user.type(tempInput, "72");
    expect(tempInput).toHaveValue("72");
  });
});

describe("TrialsPanel — test results", () => {
  it("records a numeric test result and shows its pass/fail summary", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("No trials yet.");
    await createTrial(user, "Test-result trial");

    await user.click(screen.getByRole("button", { name: "Test results" }));
    const phInput = await screen.findByPlaceholderText("Rep 1");
    await user.type(phInput, "7.0");
    await user.click(screen.getByRole("button", { name: "Record result" }));

    expect(await screen.findByText(/pass/)).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith("test_results", expect.any(Array));
  });
});

describe("TrialsPanel — result history browser", () => {
  it("opens the dedicated history browser from a recorded result's View history action", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("No trials yet.");
    await createTrial(user, "History trial");

    await user.click(screen.getByRole("button", { name: "Test results" }));
    const phInput = await screen.findByPlaceholderText("Rep 1");
    await user.type(phInput, "7.0");
    await user.click(screen.getByRole("button", { name: "Record result" }));
    await screen.findByText(/pass/);

    await user.click(screen.getByRole("button", { name: "View history" }));

    const dialog = await screen.findByRole("dialog", { name: "Result history" });
    expect(within(dialog).getByText("Revision 1")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Current").length).toBeGreaterThan(0);
  });
});

describe("TrialsPanel — trial comparison", () => {
  it("compares two selected trials and renders one row per trial", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("No trials yet.");

    await createTrial(user, "Trial One");
    await createTrial(user, "Trial Two");

    const checkboxes = screen.getAllByLabelText("Select for comparison");
    expect(checkboxes).toHaveLength(2);
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole("button", { name: "Compare selected" }));

    const table = await screen.findByRole("table");
    const dataRows = within(table).getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(2);
  });
});
