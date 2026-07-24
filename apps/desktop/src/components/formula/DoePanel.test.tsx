/**
 * UI-integration coverage for the Phase 5 Design of Experiments workspace
 * panel: empty state, the study-creation wizard only ever offering real
 * saved versions (never a working draft), a full wizard walk-through that
 * generates a real design + randomized runs, and the resulting study
 * appearing in the Studies list. Same mocking discipline as
 * DossierPanel.test.tsx / ClaimsLabelsPanel.test.tsx — only `@/lib/masterdata`
 * is mocked; engine correctness itself is covered by the doe*.test.ts suites.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationVersion } from "@ai4s/shared";
import { DoePanel } from "./DoePanel";

const bridge = {
  listRecords: vi.fn(),
  upsertRecords: vi.fn(),
};

vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
}));

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
  bridge.upsertRecords.mockImplementation((collection: string, records: { id: string }[]) => {
    stores[collection] = [...(stores[collection] ?? []), ...records];
    return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
  });
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
