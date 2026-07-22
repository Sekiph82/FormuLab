/**
 * UI-integration coverage for the Stability Studies workspace (spec §21):
 * create a study, generate pull-point samples, enter a time-point result,
 * trigger an automatic out-of-spec failure, resolve it, and create a
 * corrective action / draft from it. Same mocking discipline as
 * TrialsPanel.test.tsx — only `@/lib/masterdata` is mocked; sample
 * generation, due-date math and failure creation are the real engine code.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CorrectiveAction,
  Formulation,
  FormulationLine,
  FormulationVersion,
  StabilityFailure,
  StabilityResult,
  StabilitySample,
  StabilityStudy,
  TestDefinition,
} from "@ai4s/shared";
import { StabilityPanel } from "./StabilityPanel";

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

const BASE_VERSION: FormulationVersion = {
  schemaVersion: "1.0",
  id: "ver-1",
  formulationId: "proj-1",
  versionNumber: 1,
  status: "chemist_review",
  author: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  lines: [LINE_A],
  basisBatchKg: "100",
  sourceRunIds: [],
  regulatoryFindingIds: [],
  compatibilityFindingIds: [],
  safetyFindingIds: [],
  approvalRecordIds: [],
};

const VISCOSITY_TEST: TestDefinition = {
  schemaVersion: "1.0",
  code: "VISC",
  name: "Viscosity",
  category: "physical",
  resultType: "numeric",
  unit: "cP",
  minimum: "100",
  maximum: "200",
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

let studiesStore: StabilityStudy[];
let samplesStore: StabilitySample[];
let resultsStore: StabilityResult[];
let failuresStore: StabilityFailure[];
let correctiveActionsStore: CorrectiveAction[];

function upsertInto<T extends { id: string }>(store: T[], records: T[]): T[] {
  for (const r of records) {
    const i = store.findIndex((x) => x.id === r.id);
    if (i >= 0) store[i] = r;
    else store.push(r);
  }
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  studiesStore = [];
  samplesStore = [];
  resultsStore = [];
  failuresStore = [];
  correctiveActionsStore = [];

  bridge.listRecords.mockImplementation((collection: string) => {
    switch (collection) {
      case "stability_studies":
        return Promise.resolve(studiesStore);
      case "stability_samples":
        return Promise.resolve(samplesStore);
      case "stability_results":
        return Promise.resolve(resultsStore);
      case "stability_failures":
        return Promise.resolve(failuresStore);
      case "corrective_actions":
        return Promise.resolve(correctiveActionsStore);
      default:
        return Promise.resolve([]);
    }
  });
  bridge.listRecordsSeeded.mockImplementation((collection: string) => {
    if (collection === "test_definitions") return Promise.resolve([VISCOSITY_TEST]);
    return Promise.resolve([]);
  });
  bridge.upsertRecords.mockImplementation((collection: string, records: { id: string }[]) => {
    switch (collection) {
      case "stability_studies":
        upsertInto(studiesStore, records as StabilityStudy[]);
        break;
      case "stability_samples":
        upsertInto(samplesStore, records as StabilitySample[]);
        break;
      case "stability_results":
        upsertInto(resultsStore, records as StabilityResult[]);
        break;
      case "stability_failures":
        upsertInto(failuresStore, records as StabilityFailure[]);
        break;
      case "corrective_actions":
        upsertInto(correctiveActionsStore, records as CorrectiveAction[]);
        break;
    }
    return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
  });
});

function renderPanel(onApplyDraft = vi.fn()) {
  return {
    onApplyDraft,
    ...render(
      <StabilityPanel
        formulation={FORMULATION}
        currentLines={[LINE_A]}
        basisBatchKg="100"
        baseVersion={BASE_VERSION}
        approvalStatus="chemist_review"
        packagingBoms={[]}
        onApplyDraft={onApplyDraft}
      />,
    ),
  };
}

async function createAndActivateStudy(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("No stability studies yet.");
  await user.type(screen.getByPlaceholderText("New study title"), "Shampoo stability");
  await user.type(screen.getByPlaceholderText("Packaging SKU code"), "sku-1");
  await user.selectOptions(screen.getByText("Conditions").nextElementSibling as HTMLSelectElement, ["cond-25c"]);
  await user.selectOptions(screen.getByText("Time points").nextElementSibling as HTMLSelectElement, ["tp-initial"]);
  await user.selectOptions(screen.getByText("Required tests").nextElementSibling as HTMLSelectElement, ["VISC"]);
  await user.click(screen.getByRole("button", { name: "New study" }));

  await screen.findByRole("heading", { name: "Shampoo stability" });
  await user.click(screen.getByRole("button", { name: "Move to active" }));
  await screen.findByRole("button", { name: "Generate samples" });
}

/** Generates the study's one sample and waits for it to actually land in the
 *  store before returning — avoids racing a DOM query against a transient
 *  render while the async upsert is still in flight. */
async function generateAndAwaitSample(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Generate samples" }));
  await waitFor(() => expect(samplesStore).toHaveLength(1));
  await screen.findByRole("button", { name: "Record result" });
}

async function openRecordResultAndSubmit(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(screen.getByRole("button", { name: "Record result" }));
  const textboxes = await screen.findAllByRole("textbox");
  const viscosityInput = textboxes[textboxes.length - 1];
  await user.type(viscosityInput, value);
  const submitButtons = screen.getAllByRole("button", { name: "Record result" });
  await user.click(submitButtons[submitButtons.length - 1]);
}

describe("StabilityPanel — create and activate a study", () => {
  it("creates a study with the selected condition/time-point/test scope", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createAndActivateStudy(user);

    expect(studiesStore).toHaveLength(1);
    expect(studiesStore[0].conditionIds).toEqual(["cond-25c"]);
    expect(studiesStore[0].timePointIds).toEqual(["tp-initial"]);
    expect(studiesStore[0].requiredTestDefinitionIds).toEqual(["VISC"]);
  });
});

describe("StabilityPanel — sample generation", () => {
  it("generates one sample per condition x time point x replicate", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createAndActivateStudy(user);

    await generateAndAwaitSample(user);

    expect(samplesStore[0].conditionId).toBe("cond-25c");
    expect(samplesStore[0].timePointId).toBe("tp-initial");
  });
});

describe("StabilityPanel — result entry and automatic failure", () => {
  it("records an in-spec result with no failure created", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createAndActivateStudy(user);
    await generateAndAwaitSample(user);

    await openRecordResultAndSubmit(user, "150");

    await waitFor(() => expect(resultsStore).toHaveLength(1));
    expect(failuresStore).toHaveLength(0);
    expect(resultsStore[0].passFail).toBe("pass");
  });

  it("creates an out-of-specification failure when the result is out of range", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createAndActivateStudy(user);
    await generateAndAwaitSample(user);

    await openRecordResultAndSubmit(user, "500"); // above the 200 maximum

    await waitFor(() => expect(failuresStore).toHaveLength(1));
    expect(await screen.findByText("out_of_specification")).toBeInTheDocument();
    expect(failuresStore[0].investigationStatus).toBe("open");
  });

  it("resolves an open failure", async () => {
    const user = userEvent.setup();
    renderPanel();
    await createAndActivateStudy(user);
    await generateAndAwaitSample(user);
    await openRecordResultAndSubmit(user, "500");
    await waitFor(() => expect(failuresStore).toHaveLength(1));
    await screen.findByText("out_of_specification");

    await user.type(screen.getByPlaceholderText("Root-cause / resolution notes"), "Reformulated thickener.");
    await user.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(failuresStore[0].investigationStatus).toBe("closed"));
    expect(await screen.findByText("closed")).toBeInTheDocument();
  });

  it("creates a corrective action from an open failure and applies its draft", async () => {
    const user = userEvent.setup();
    const { onApplyDraft } = renderPanel();
    await createAndActivateStudy(user);
    await generateAndAwaitSample(user);
    await openRecordResultAndSubmit(user, "500");
    await waitFor(() => expect(failuresStore).toHaveLength(1));
    await screen.findByText("out_of_specification");

    await user.click(screen.getByRole("button", { name: "Create corrective action" }));
    await waitFor(() => expect(correctiveActionsStore).toHaveLength(1));
    expect(correctiveActionsStore[0].sourceType).toBe("stability_failure");

    await user.click(await screen.findByRole("button", { name: "Create draft" }));
    expect(onApplyDraft).toHaveBeenCalledWith([LINE_A], "100", expect.stringContaining(correctiveActionsStore[0].code));
  });
});
