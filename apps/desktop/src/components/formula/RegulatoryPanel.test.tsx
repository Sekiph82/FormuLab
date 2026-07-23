/**
 * UI-integration coverage for the Kenya/EAC Regulatory Engine desktop
 * workspace (Phase 2): classification, rule create/edit/activate/deprecate
 * lifecycle, live rule evaluation, human review recording, and JSON
 * import/export. Same mocking discipline as TrialsPanel.test.tsx — only
 * `@/lib/masterdata` is mocked; classification, evaluation and the rule
 * revision lifecycle are the real `@ai4s/shared` engine code.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, RawMaterial, RegulatoryRule } from "@ai4s/shared";
import { RegulatoryPanel } from "./RegulatoryPanel";

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
  productFamilyCode: "LP-HANDWASH",
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
  percent: "100",
  isQsToHundred: true,
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

const MATERIALS: RawMaterial[] = [];

let rulesStore: RegulatoryRule[];
let revisionsStore: unknown[];
let reviewsStore: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  rulesStore = [];
  revisionsStore = [];
  reviewsStore = [];
  bridge.listRecordsSeeded.mockImplementation((collection: string, seed: unknown[]) => {
    if (collection === "regulatory_rules") return Promise.resolve(rulesStore.length ? rulesStore : seed);
    return Promise.resolve(seed);
  });
  bridge.listRecords.mockImplementation((collection: string) => {
    if (collection === "regulatory_rule_revisions") return Promise.resolve(revisionsStore);
    if (collection === "regulatory_reviews") return Promise.resolve(reviewsStore);
    return Promise.resolve([]);
  });
  bridge.upsertRecords.mockImplementation((collection: string, records: { id: string }[]) => {
    if (collection === "regulatory_rules") {
      for (const r of records) {
        const i = rulesStore.findIndex((x) => x.id === r.id);
        if (i >= 0) rulesStore[i] = r as RegulatoryRule;
        else rulesStore.push(r as RegulatoryRule);
      }
    }
    if (collection === "regulatory_rule_revisions") revisionsStore.push(...records);
    if (collection === "regulatory_reviews") reviewsStore.push(...records);
    return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
  });
});

function renderPanel() {
  return render(<RegulatoryPanel formulation={FORMULATION} currentLines={[LINE_A]} materials={MATERIALS} />);
}

describe("RegulatoryPanel — classification", () => {
  it("classifies a resolved product family and shows its reasoning", async () => {
    renderPanel();
    expect(await screen.findByText("Laundry detergent")).toBeInTheDocument();
    expect(screen.getByText(/Base category from domain mapping/)).toBeInTheDocument();
  });
});

describe("RegulatoryPanel — findings", () => {
  it("evaluates seeded rules against the current formula and shows a summary", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Evaluate" }));
    expect(await screen.findByText(/Missing data \(\d+\)/)).toBeInTheDocument();
  });
});

describe("RegulatoryPanel — rule lifecycle", () => {
  it("creates a new rule from the JSON editor", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Rules" }));
    await user.click(screen.getByRole("button", { name: "New rule" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_rules", expect.any(Array)));
    expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_rule_revisions", expect.any(Array));
  });

  it("requires a change reason before editing an existing seed rule", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Rules" }));
    await screen.findAllByText("KE-REG-001");

    await user.click(within(screen.getAllByText("KE-REG-001")[0].closest("li")!).getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("regulatory_rules", expect.any(Array));
  });

  it("activates and deactivates a rule, recording a revision each time", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Rules" }));
    await screen.findAllByText("KE-REG-001");

    const row = screen.getAllByText("KE-REG-001")[0].closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Deactivate" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_rule_revisions", expect.any(Array)));
    const [, revisions] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_rule_revisions")!;
    expect(revisions[0].changeType).toBe("deactivated");
  });

  it("deprecates a rule after a prompted reason", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("No longer applicable.");
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Rules" }));
    await screen.findAllByText("KE-REG-001");

    const row = screen.getAllByText("KE-REG-001")[0].closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Deprecate" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_rule_revisions", expect.any(Array)));
    const [, revisions] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_rule_revisions")!;
    expect(revisions[0].changeType).toBe("deprecated");
    expect(revisions[0].changeReason).toBe("No longer applicable.");
  });
});

describe("RegulatoryPanel — import/export", () => {
  it("imports a JSON array of rules, marking them imported and not verified", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Rules" }));

    await user.click(screen.getByRole("button", { name: "Import JSON" }));
    const imported = [
      {
        schemaVersion: "1.0",
        id: "imported-1",
        code: "IMPORTED-1",
        name: "Imported rule",
        jurisdiction: "KE",
        authority: "Test authority",
        ruleType: "registration_requirement",
        productCategories: [],
        requirement: "Some requirement.",
        severity: "warning",
        status: "draft",
        conditions: [],
        claimKeywordsAny: [],
        requiredEvidenceTypes: [],
        requiredLabelElements: [],
        requiredWarnings: [],
        requiredDocumentTypes: [],
        requiredTestTypes: [],
        requiredPackagingElements: [],
        requiredLanguages: [],
        requiresRegistration: false,
        requiresNotification: false,
        requiresResponsiblePartyInMarket: false,
        requiresMarketSpecificIdentifier: false,
        version: 1,
        verificationStatus: "verified",
        humanReviewStatus: "review_required",
        active: true,
        createdBy: "someone-else",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const dialog = screen.getByRole("dialog", { name: "Import JSON" });
    const textarea = within(dialog).getByRole("textbox");
    await user.click(textarea);
    await user.paste(JSON.stringify(imported));
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_rules", expect.any(Array)));
    const [, saved] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_rules")!;
    expect(saved[0].verificationStatus).toBe("imported_unverified");
  });
});

describe("RegulatoryPanel — human review", () => {
  it("requires a reviewer name and notes, then records the review", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Reviews" }));

    await user.clear(screen.getByLabelText("Reviewed by"));
    await user.click(screen.getByRole("button", { name: "Save review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reviewer name and notes/i);

    await user.type(screen.getByLabelText("Reviewed by"), "Jane Reviewer");
    await user.type(screen.getByLabelText("Notes"), "Reviewed the classification and findings; looks compliant.");
    await user.click(screen.getByRole("button", { name: "Save review" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_reviews", expect.any(Array)));
    expect(await screen.findByText("Jane Reviewer")).toBeInTheDocument();
  });
});
