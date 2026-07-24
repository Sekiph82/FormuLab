/**
 * UI-integration coverage for the Kenya/EAC Regulatory Engine desktop
 * workspace (Phase 2 closure): classification, rule create/edit/
 * activate/deprecate/verify lifecycle, live rule evaluation, persisted
 * evidence confirmation, version-bound human review recording/
 * revocation, and JSON/CSV import. Same mocking discipline as
 * TrialsPanel.test.tsx — only `@/lib/masterdata` is mocked;
 * classification, evaluation and every lifecycle function are the real
 * `@ai4s/shared` engine code.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, FormulationVersion, RawMaterial, RegulatoryRule } from "@ai4s/shared";
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

const VERSION_1: FormulationVersion = {
  schemaVersion: "1.0",
  id: "version-1",
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

const MATERIALS: RawMaterial[] = [];

let rulesStore: RegulatoryRule[];
let revisionsStore: unknown[];
let reviewsStore: unknown[];
let reviewRevocationsStore: unknown[];
let reviewEquivalencesStore: unknown[];
let confirmationsStore: unknown[];
let confirmationRevocationsStore: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  rulesStore = [];
  revisionsStore = [];
  reviewsStore = [];
  reviewRevocationsStore = [];
  reviewEquivalencesStore = [];
  confirmationsStore = [];
  confirmationRevocationsStore = [];
  bridge.listRecordsSeeded.mockImplementation((collection: string, seed: unknown[]) => {
    if (collection === "regulatory_rules") return Promise.resolve(rulesStore.length ? rulesStore : seed);
    return Promise.resolve(seed);
  });
  bridge.listRecords.mockImplementation((collection: string) => {
    if (collection === "regulatory_rule_revisions") return Promise.resolve(revisionsStore);
    if (collection === "regulatory_reviews") return Promise.resolve(reviewsStore);
    if (collection === "regulatory_review_revocations") return Promise.resolve(reviewRevocationsStore);
    if (collection === "regulatory_review_equivalences") return Promise.resolve(reviewEquivalencesStore);
    if (collection === "regulatory_evidence_confirmations") return Promise.resolve(confirmationsStore);
    if (collection === "regulatory_evidence_confirmation_revocations") return Promise.resolve(confirmationRevocationsStore);
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
    if (collection === "regulatory_review_revocations") reviewRevocationsStore.push(...records);
    if (collection === "regulatory_review_equivalences") reviewEquivalencesStore.push(...records);
    if (collection === "regulatory_evidence_confirmations") confirmationsStore.push(...records);
    if (collection === "regulatory_evidence_confirmation_revocations") confirmationRevocationsStore.push(...records);
    return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
  });
});

function renderPanel(versions: FormulationVersion[] = [VERSION_1]) {
  return render(
    <MemoryRouter>
      <RegulatoryPanel formulation={FORMULATION} currentLines={[LINE_A]} materials={MATERIALS} versions={versions} />
    </MemoryRouter>,
  );
}

async function selectVersion(user: ReturnType<typeof userEvent.setup>) {
  const [versionSelect] = screen.getAllByRole("combobox");
  await user.selectOptions(versionSelect, "version-1");
}

describe("RegulatoryPanel — classification", () => {
  it("classifies a resolved product family and shows its reasoning", async () => {
    renderPanel();
    expect(await screen.findByText("Laundry detergent")).toBeInTheDocument();
    expect(screen.getByText(/Base category from domain mapping/)).toBeInTheDocument();
  });

  it("warns that no version is selected (working draft is not reviewable)", async () => {
    renderPanel();
    expect(await screen.findByText(/no formula version is selected/i)).toBeInTheDocument();
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

  it("persists a confirmation for a version once confirmed, and it survives being unaffected by other versions", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await selectVersion(user);
    await user.click(screen.getByRole("button", { name: "Evaluate" }));

    const confirmButtons = await screen.findAllByRole("button", { name: "Confirm this requirement is satisfied" });
    await user.click(confirmButtons[0]);

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_evidence_confirmations", expect.any(Array)));
    const [, saved] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_evidence_confirmations")!;
    expect(saved[0].formulaVersionId).toBe("version-1");
    expect(saved[0].jurisdiction).toBe("KE");
    expect(await screen.findByText("Confirmed for this version")).toBeInTheDocument();
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

  it("refuses to verify a rule with no source authority/reference set (the default reviewer role is regulatory)", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Rules" }));
    await screen.findAllByText("KE-REG-001");

    const row = screen.getAllByText("KE-REG-001")[0].closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/source authority and a source reference/i);
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("regulatory_rule_revisions", expect.any(Array));
  });
});

describe("RegulatoryPanel — import/export", () => {
  it("imports a JSON array of rules after preview, marking them imported and not verified", async () => {
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
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(await within(dialog).findByText(/1 row/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_rules", expect.any(Array)));
    const [, saved] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_rules")!;
    expect(saved[0].verificationStatus).toBe("imported_unverified");
  });

  it("imports rules from pasted CSV after preview", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Rules" }));
    await user.click(screen.getByRole("button", { name: "Import JSON" }));

    const dialog = screen.getByRole("dialog", { name: "Import JSON" });
    await user.click(within(dialog).getByRole("button", { name: "CSV" }));
    const textarea = within(dialog).getByRole("textbox");
    await user.click(textarea);
    await user.paste("id,code,name,jurisdiction,authority,ruleType,requirement,severity,status,verificationStatus,active\ncsv-1,CSV-1,CSV rule,KE,Test,registration_requirement,Some requirement,warning,draft,verified,yes");
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(await within(dialog).findByText(/1 row/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_rules", expect.any(Array)));
    const [, saved] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_rules")!;
    expect(saved[0].verificationStatus).toBe("imported_unverified");
  });
});

describe("RegulatoryPanel — human review", () => {
  it("refuses to save a review with no formula version selected", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await user.click(screen.getByRole("button", { name: "Reviews" }));
    expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
  });

  it("records a review bound to the selected version once notes are provided", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await selectVersion(user);
    await user.click(screen.getByRole("button", { name: "Reviews" }));

    await user.type(screen.getByLabelText("Notes"), "Reviewed the classification and findings; looks compliant.");
    await user.click(screen.getByRole("button", { name: "Save review" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_reviews", expect.any(Array)));
    const [, saved] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_reviews")!;
    expect(saved[0].formulaVersionId).toBe("version-1");
    expect(saved[0].jurisdiction).toBe("KE");
    expect(saved[0].reviewerRole).toBe("regulatory");
    expect((await screen.findAllByText("Current")).length).toBeGreaterThan(0);
  });

  it("revokes a recorded review, which then shows as revoked", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("Recorded in error.");
    renderPanel();
    await screen.findByText("Laundry detergent");
    await selectVersion(user);
    await user.click(screen.getByRole("button", { name: "Reviews" }));
    await user.type(screen.getByLabelText("Notes"), "Reviewed the classification and findings; looks compliant.");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_reviews", expect.any(Array)));

    await user.click(await screen.findByRole("button", { name: "Revoke" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_review_revocations", expect.any(Array)));
    await vi.waitFor(async () => expect((await screen.findAllByText("Revoked")).length).toBeGreaterThan(0));
  });
});

describe("RegulatoryPanel — authorization", () => {
  it("disables Save review and shows the unauthorized-role hint once the reviewer role is switched to chemist", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await selectVersion(user);
    await user.click(screen.getByRole("button", { name: "Reviews" }));
    expect(screen.getByRole("button", { name: "Save review" })).not.toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Reviewer role"), "chemist");

    expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
    expect(screen.getAllByText("Only a regulatory, quality or administrator role may perform this action.").length).toBeGreaterThan(0);
  });

  it("re-enables Save review once the reviewer role is switched back to an authorized one", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Laundry detergent");
    await selectVersion(user);
    await user.click(screen.getByRole("button", { name: "Reviews" }));
    await user.selectOptions(screen.getByLabelText("Reviewer role"), "chemist");
    expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Reviewer role"), "quality");
    expect(screen.getByRole("button", { name: "Save review" })).not.toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Reviewer role"), "administrator");
    expect(screen.getByRole("button", { name: "Save review" })).not.toBeDisabled();
  });

  it("the backend still refuses an unauthorized actor even if a caller ignored the disabled UI", async () => {
    const { recordRegulatoryReview } = await import("@ai4s/shared");
    expect(() =>
      recordRegulatoryReview(
        {
          formulationId: "proj-1",
          formulaVersionId: "version-1",
          jurisdiction: "KE",
          classificationSnapshot: { category: "laundry_detergent", confidence: 0.8, reasoning: ["x"], uncertain: false },
          findingSnapshot: [],
          ruleVersionSnapshot: [],
          outcome: "compliant",
          notes: "Notes.",
        },
        { kind: "human", role: "chemist", userId: "bob" },
      ),
    ).toThrow(/authorized regulatory, quality or administrator/);
  });
});
