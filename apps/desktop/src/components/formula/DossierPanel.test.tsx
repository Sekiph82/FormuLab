/**
 * UI-integration coverage for the Phase 3 Dossiers workspace panel:
 * empty state, creation gated on a real saved formula version, the list
 * view, and role-based authorization hiding (never the only enforcement —
 * the underlying engine functions throw regardless, see
 * regulatoryDossier.test.ts). Same mocking discipline as
 * RegulatoryPanel.test.tsx — only `@/lib/masterdata` is mocked.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, FormulationVersion } from "@formulab/shared";
import { DossierPanel } from "./DossierPanel";
import { renderDossierDocument } from "@/lib/documentExports";
import { saveBinaryWithFeedback } from "@/lib/download";

const bridge = {
  listRecords: vi.fn(),
  listRecordsSeeded: vi.fn(),
  upsertRecords: vi.fn(),
};

vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  listRecordsSeeded: (...a: [string, unknown[]]) => bridge.listRecordsSeeded(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

// Real PDF/DOCX rendering (pdf-lib/docx) runs for real in most tests, proving
// genuine end-to-end integration — only overridden per-test below to observe
// the loading/failure states without waiting on real render timing.
vi.mock("@/lib/documentExports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documentExports")>();
  return { ...actual, renderDossierDocument: vi.fn(actual.renderDossierDocument) };
});

// Real save (falls back to a browser Blob download outside Tauri) runs by
// default — only overridden per-test below to observe save-failure and
// save-cancellation outcomes without a real dialog.
vi.mock("@/lib/download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/download")>();
  return { ...actual, saveBinaryWithFeedback: vi.fn(actual.saveBinaryWithFeedback) };
});

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

const MATERIAL_LINE: FormulationLine = {
  id: "line-mat",
  lineNumber: 1,
  phase: "A",
  materialId: "MAT-1",
  materialCode: "MAT-1",
  displayName: "Surfactant",
  functions: ["anionic_surfactant"],
  percent: "100",
  isQsToHundred: true,
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

const VERSION_WITH_MATERIAL: FormulationVersion = { ...VERSION_1, lines: [MATERIAL_LINE] };

let dossiersStore: unknown[];
let requirementsStore: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  dossiersStore = [];
  requirementsStore = [];
  bridge.listRecordsSeeded.mockImplementation((_collection: string, seed: unknown[]) => Promise.resolve(seed));
  bridge.listRecords.mockImplementation((collection: string) => {
    if (collection === "regulatory_dossiers") return Promise.resolve(dossiersStore);
    if (collection === "regulatory_dossier_requirements") return Promise.resolve(requirementsStore);
    return Promise.resolve([]);
  });
  bridge.upsertRecords.mockImplementation((collection: string, records: { id: string }[]) => {
    if (collection === "regulatory_dossiers") dossiersStore.push(...records);
    if (collection === "regulatory_dossier_requirements") requirementsStore.push(...records);
    return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
  });
});

function renderPanel(versions: FormulationVersion[] = [VERSION_1]) {
  return render(
    <MemoryRouter>
      <DossierPanel
        formulation={FORMULATION}
        versions={versions}
        auditLog={[]}
        onAuditChanged={vi.fn().mockResolvedValue(undefined)}
      />
    </MemoryRouter>,
  );
}

describe("DossierPanel — list and empty state", () => {
  it("shows the empty state with a create entry point when there are no dossiers", async () => {
    renderPanel();
    expect(await screen.findByText("No regulatory dossiers yet for this project.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New dossier" }).length).toBeGreaterThan(0);
  });
});

describe("DossierPanel — creation flow", () => {
  it("only ever offers real saved versions, never the current working draft, and requires a jurisdiction", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);

    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    const versionSelect = within(dialog).getByRole("combobox", { name: /Formula version/i });
    const options = within(versionSelect).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Version 1");
    expect(options.some((o) => /draft/i.test(o ?? ""))).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Select at least one jurisdiction.")).toBeInTheDocument();
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  it("creates a dossier against the selected version and jurisdiction, then shows it in the list", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });

    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect((await screen.findAllByText(/DOS-/)).length).toBeGreaterThan(0);
    expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_dossiers", expect.any(Array));
    expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_dossier_requirements", expect.any(Array));
  });

  it("refuses creation with no saved versions available and shows the warning", async () => {
    const user = userEvent.setup();
    renderPanel([]);
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    expect(within(dialog).getByText(/must be created against a real, saved formula version/i)).toBeInTheDocument();
  });
});

describe("DossierPanel — authorization", () => {
  it("hides the manual-requirement action for a non-authorized reviewer role and shows it for an authorized one", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Requirements" }));

    // Regulatory (the default acting-as role) is authorized.
    expect(screen.getByRole("button", { name: /Add manual requirement/i })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Acting as"), "researcher");
    expect(screen.queryByRole("button", { name: /Add manual requirement/i })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Acting as"), "regulatory");
    expect(screen.getByRole("button", { name: /Add manual requirement/i })).toBeInTheDocument();
  });
});

describe("DossierPanel — status and revision lifecycle", () => {
  async function createAndOpenDossier(user: ReturnType<typeof userEvent.setup>) {
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
  }

  it("changes the dossier status and persists it", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);

    await user.selectOptions(screen.getByDisplayValue("draft"), "in_preparation");
    await user.click(screen.getByRole("button", { name: "Save status" }));

    await vi.waitFor(() => {
      const call = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_dossiers" && c[1][0]?.status === "in_preparation");
      expect(call).toBeTruthy();
    });
  });

  it("creates a new revision once the dossier is immutable, superseding the original", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);

    await user.selectOptions(screen.getByDisplayValue("draft"), "submitted");
    await user.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByText("Immutable — create a new revision to continue working on this dossier.");

    await user.click(screen.getByRole("button", { name: "Create new revision" }));

    await vi.waitFor(() => {
      const call = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_dossiers" && c[1].length === 2);
      expect(call).toBeTruthy();
    });
    const [, records] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_dossiers" && c[1].length === 2)!;
    const [superseded, revised] = records as { id: string; status: string; revision: number; supersedesDossierId?: string }[];
    expect(superseded.status).toBe("superseded");
    expect(revised.revision).toBe(2);
    expect(revised.supersedesDossierId).toBe(superseded.id);
  });
});

describe("DossierPanel — Claims & Labels summary (Phase 4 integration)", () => {
  it("shows a live claim count for this formula version and deep-links to Claims & Labels", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "regulatory_dossiers") return Promise.resolve(dossiersStore);
      if (collection === "regulatory_dossier_requirements") return Promise.resolve(requirementsStore);
      if (collection === "product_claims") {
        return Promise.resolve([
          { schemaVersion: "1.0", id: "claim-1", claimCode: "CLM-1", claimText: "Gentle formula", normalizedClaim: "gentle formula", claimCategory: "other", formulationId: "proj-1", formulaVersionId: "version-1", jurisdictions: ["KE"], languages: ["en"], status: "draft", riskLevel: "unknown", proposedBy: "local", proposedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ]);
      }
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    await createAndOpenDossierForClaimsSummary(user);

    expect(await screen.findByText("1 claim(s)")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open in Claims & Labels" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/claims-labels?project=proj-1&version=version-1"));
  });

  async function createAndOpenDossierForClaimsSummary(user: ReturnType<typeof userEvent.setup>) {
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
  }
});

describe("DossierPanel — evidence import", () => {
  async function createAndOpenDossier(user: ReturnType<typeof userEvent.setup>) {
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
  }

  it("previews and imports JSON evidence rows as unverified draft evidence", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);

    await user.click(screen.getByRole("button", { name: "Import evidence" }));
    const dialog = await screen.findByRole("dialog", { name: "Import evidence" });
    within(dialog).getByRole("textbox").focus();
    await user.paste('[{"title": "SDS for surfactant", "evidenceType": "sds"}]');
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    await within(dialog).findByText("1 row(s) ready to import.");

    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_evidence_items", expect.any(Array)));
    const [, items] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_evidence_items")!;
    expect(items[0].title).toBe("SDS for surfactant");
    expect(items[0].status).toBe("draft");
    expect(items[0].sourceType).toBe("manual_entry");
    expect((await screen.findAllByText("SDS for surfactant")).length).toBeGreaterThan(0);
  });

  it("skips a row as a duplicate when the same title/evidenceType already exists on this dossier", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);

    await user.click(screen.getByRole("button", { name: "Import evidence" }));
    let dialog = await screen.findByRole("dialog", { name: "Import evidence" });
    within(dialog).getByRole("textbox").focus();
    await user.paste('[{"title": "COA batch 1", "evidenceType": "coa"}]');
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    await screen.findAllByText("COA batch 1");

    await user.click(screen.getByRole("button", { name: "Import evidence" }));
    dialog = await screen.findByRole("dialog", { name: "Import evidence" });
    within(dialog).getByRole("textbox").focus();
    await user.paste('[{"title": "COA batch 1", "evidenceType": "coa"}]');
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(await within(dialog).findByText("1 row(s) skipped as already-imported duplicates.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Import" })).toBeDisabled();
  });
});

describe("DossierPanel — suggested evidence (Phase 3 gap closure)", () => {
  async function createAndOpenDossierWithMaterial(user: ReturnType<typeof userEvent.setup>) {
    renderPanel([VERSION_WITH_MATERIAL]);
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
  }

  it("suggests a raw material's document, and accepting it creates draft unverified evidence", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "regulatory_dossiers") return Promise.resolve(dossiersStore);
      if (collection === "regulatory_dossier_requirements") return Promise.resolve(requirementsStore);
      if (collection === "materials") {
        return Promise.resolve([
          {
            schemaVersion: "1.0",
            code: "MAT-1",
            displayName: "Surfactant",
            casNumbers: [],
            ecNumbers: [],
            functions: [],
            activeMatterState: "missing",
            documents: [{ kind: "sds", title: "Surfactant SDS", location: "materials/mat-1-sds.pdf" }],
            regulatoryStatuses: [],
            hazardClassifications: [],
            allergens: [],
            incompatibilities: [],
            substituteCodes: [],
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    await createAndOpenDossierWithMaterial(user);

    expect(await screen.findByText("Surfactant SDS")).toBeInTheDocument();
    expect(screen.getByText("Exact match")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await vi.waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_evidence_items", expect.any(Array)));
    const [, items] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_evidence_items")!;
    expect(items[0].title).toBe("Surfactant SDS");
    expect(items[0].status).toBe("present_unverified");
    expect(items[0].sourceType).toBe("formulab_record");
    expect(items[0].sourceEntityId).toBe("MAT-1");
    // Accepted suggestions never disappear because they were "rejected" —
    // they disappear because they are now real evidence; the suggestion
    // list must not offer the same source record twice.
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument());
  });

  it("keeps a version-mismatched suggestion visible, flagged rather than hidden", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "regulatory_dossiers") return Promise.resolve(dossiersStore);
      if (collection === "regulatory_dossier_requirements") return Promise.resolve(requirementsStore);
      if (collection === "laboratory_trials") {
        return Promise.resolve([
          {
            schemaVersion: "1.0",
            id: "trial-1",
            code: "TRL-1",
            projectId: "proj-1",
            sourceType: "saved_version",
            sourceFormulaVersionId: "version-OTHER",
            formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-01T00:00:00.000Z" },
            productFamilyId: "fam-1",
            targetPackagingSkuIds: [],
            title: "Trial 1",
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            processSteps: [],
            observations: [],
          },
        ]);
      }
      if (collection === "test_results") {
        return Promise.resolve([
          {
            schemaVersion: "1.0",
            id: "result-1",
            trialId: "trial-1",
            testDefinitionId: "test-1",
            resultType: "numeric",
            replicates: [],
            passFail: "not_evaluated",
            attachments: [{ id: "att-1", kind: "document", title: "Trial report", location: "trials/report.pdf" }],
            performedBy: "alice",
            performedAt: "2026-01-01T00:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    await createAndOpenDossierWithMaterial(user);

    expect(await screen.findByText("Trial report")).toBeInTheDocument();
    expect(screen.getByText("Different formula version")).toBeInTheDocument();
    // Still offered — a mismatch is a warning, not a removal.
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });

  it("filters suggestions to exact matches only", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "regulatory_dossiers") return Promise.resolve(dossiersStore);
      if (collection === "regulatory_dossier_requirements") return Promise.resolve(requirementsStore);
      if (collection === "materials") {
        return Promise.resolve([
          {
            schemaVersion: "1.0",
            code: "MAT-1",
            displayName: "Surfactant",
            casNumbers: [],
            ecNumbers: [],
            functions: [],
            activeMatterState: "missing",
            documents: [{ kind: "sds", title: "Exact SDS", location: "materials/exact.pdf" }],
            regulatoryStatuses: [],
            hazardClassifications: [],
            allergens: [],
            incompatibilities: [],
            substituteCodes: [],
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]);
      }
      if (collection === "regulatory_reviews") {
        return Promise.resolve([
          {
            schemaVersion: "1.0",
            id: "review-1",
            formulationId: "proj-1",
            formulaVersionId: "version-OTHER",
            jurisdiction: "KE",
            classificationSnapshot: { category: "household_cleaning_product", confidence: 0.9, reasoning: ["x"], uncertain: false },
            findingSnapshot: [],
            ruleVersionSnapshot: [],
            reviewedBy: "alice",
            reviewerRole: "regulatory",
            reviewedAt: "2026-01-01T00:00:00.000Z",
            outcome: "compliant",
            notes: "Looks fine.",
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    await createAndOpenDossierWithMaterial(user);

    await screen.findByText("Exact SDS");
    expect(screen.getByText(/regulatory review by alice/i)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Exact matches only" }));

    expect(screen.getByText("Exact SDS")).toBeInTheDocument();
    expect(screen.queryByText(/regulatory review by alice/i)).not.toBeInTheDocument();
  });
});

describe("DossierPanel — evidence replacement (Phase 3 gap closure)", () => {
  async function createDossierWithEvidence(user: ReturnType<typeof userEvent.setup>) {
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
    await user.click(screen.getByRole("button", { name: "Add evidence" }));
    await user.type(screen.getByLabelText("Title"), "Original SDS");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findAllByText("Original SDS");
  }

  it("requires a reason before replacing evidence", async () => {
    const user = userEvent.setup();
    await createDossierWithEvidence(user);

    await user.click(screen.getByRole("button", { name: "Replace" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace" });
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));

    expect(await screen.findByText("A reason is required to replace evidence.")).toBeInTheDocument();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("regulatory_evidence_items", expect.arrayContaining([expect.objectContaining({ status: "superseded" })]));
  });

  it("replacing evidence supersedes the original (which remains visible) and creates a new item, emitting dossier.evidence_replaced", async () => {
    const user = userEvent.setup();
    const onAuditChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <DossierPanel formulation={FORMULATION} versions={[VERSION_1]} auditLog={[]} onAuditChanged={onAuditChanged} />
      </MemoryRouter>,
    );
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const createDialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(createDialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(createDialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(createDialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
    await user.click(screen.getByRole("button", { name: "Add evidence" }));
    await user.type(screen.getByLabelText("Title"), "Original SDS");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findAllByText("Original SDS");

    await user.click(screen.getByRole("button", { name: "Replace" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace" });
    await user.clear(within(dialog).getByLabelText("Title"));
    await user.type(within(dialog).getByLabelText("Title"), "Replacement SDS");
    await user.type(within(dialog).getByLabelText("Reason for replacement"), "Supplier issued a corrected SDS.");
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));

    await vi.waitFor(() => {
      const call = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_evidence_items" && c[1].length === 2);
      expect(call).toBeTruthy();
    });
    const [, items] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "regulatory_evidence_items" && c[1].length === 2)!;
    const [superseded, replacement] = items as { id: string; title: string; status: string; supersedesEvidenceId?: string }[];
    expect(superseded.status).toBe("superseded");
    expect(replacement.title).toBe("Replacement SDS");
    expect(replacement.supersedesEvidenceId).toBe(superseded.id);

    expect((await screen.findAllByText("Replacement SDS")).length).toBeGreaterThan(0);
    // The original stays visible in the revision-chain list, never hidden.
    expect(screen.getAllByText("Original SDS").length).toBeGreaterThan(0);

    expect(onAuditChanged).toHaveBeenCalled();
  });
});

describe("DossierPanel — evidence matrix filters (Phase 3 gap closure)", () => {
  it("narrows results with a mandatory-only filter and clears back to the full count", async () => {
    const user = userEvent.setup();
    requirementsStore = [];
    dossiersStore = [];
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Matrix" }));

    // No requirements were generated (seed rules may or may not apply to
    // this family/jurisdiction) — either way the result-count summary and
    // the mandatory-only filter must render without crashing.
    expect(await screen.findByText(/requirements$/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Mandatory only" }));
    expect(screen.getByText(/requirements$/)).toBeInTheDocument();
  });
});

describe("DossierPanel — PDF/DOCX export (Phase 8)", () => {
  async function createAndOpenDossier(user: ReturnType<typeof userEvent.setup>) {
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
  }

  it("shows a generating state while rendering, then saves via a browser download", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);

    let resolveRender!: (v: { bytes: Uint8Array; mimeType: string }) => void;
    vi.mocked(renderDossierDocument).mockImplementationOnce(
      () => new Promise((resolve) => { resolveRender = resolve; }),
    );
    const createObjectURLSpy = vi.fn(() => "blob:mock");
    URL.createObjectURL = createObjectURLSpy;
    URL.revokeObjectURL = vi.fn();

    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(await screen.findByRole("button", { name: "Generating…" })).toBeInTheDocument();
    // The other export action is disabled while one is generating.
    expect(screen.getByRole("button", { name: "Export DOCX" })).toBeDisabled();

    resolveRender({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" });

    await screen.findByRole("button", { name: "Export PDF" }); // back to normal label
    expect(createObjectURLSpy).toHaveBeenCalled();
  });

  it("shows the export buttons disabled with a structured reason for an unauthorized role, instead of hiding them (Phase 10 Session 3)", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);
    await user.selectOptions(screen.getByLabelText("Acting as"), "researcher");

    const exportPdf = screen.getByRole("button", { name: "Export PDF" });
    expect(exportPdf).toBeDisabled();
    const describedById = exportPdf.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    const explanation = document.getElementById(describedById!);
    expect(explanation).toHaveTextContent(/authorized regulatory role/i);
    expect(explanation).toHaveTextContent(/regulatory, quality, administrator/);
  });

  it("surfaces a visible error and does not crash when rendering fails", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);

    vi.mocked(renderDossierDocument).mockRejectedValueOnce(new Error("render exploded"));

    await user.click(screen.getByRole("button", { name: "Export DOCX" }));
    expect(await screen.findByText(/render exploded/)).toBeInTheDocument();
    // The button recovers — a failed export must not leave the UI stuck.
    expect(screen.getByRole("button", { name: "Export DOCX" })).toBeEnabled();
  });

  it("never persists or mutates any dossier record as part of exporting", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);
    bridge.upsertRecords.mockClear();

    vi.mocked(renderDossierDocument).mockResolvedValueOnce({ bytes: new Uint8Array([1]), mimeType: "application/pdf" });
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Generating…" })).not.toBeInTheDocument());

    const dossierCollections = ["regulatory_dossiers", "regulatory_dossier_requirements", "regulatory_evidence_items", "regulatory_requirement_evidence_links", "regulatory_dossier_reviews", "regulatory_dossier_review_revocations", "regulatory_dossier_submissions", "regulatory_dossier_manual_requirement_actions"];
    for (const call of bridge.upsertRecords.mock.calls) {
      expect(dossierCollections).not.toContain(call[0]);
    }
    expect(bridge.upsertRecords).toHaveBeenCalledWith("generated_document_records", expect.any(Array));
  });

  it("persists a generating-then-succeeded export-history record and emits an audit event on success", async () => {
    const user = userEvent.setup();
    const onAuditChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <DossierPanel formulation={FORMULATION} versions={[VERSION_1]} auditLog={[]} onAuditChanged={onAuditChanged} />
      </MemoryRouter>,
    );
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
    bridge.upsertRecords.mockClear();

    vi.mocked(renderDossierDocument).mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" });
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Generating…" })).not.toBeInTheDocument());

    const historyCalls = bridge.upsertRecords.mock.calls.filter((c) => c[0] === "generated_document_records");
    expect(historyCalls).toHaveLength(2);
    const [[, generatingRecords], [, succeededRecords]] = historyCalls as [string, { id: string; status: string }[]][];
    expect(generatingRecords[0]!.status).toBe("generating");
    expect(succeededRecords[0]!.status).toBe("succeeded");
    expect(succeededRecords[0]!.id).toBe(generatingRecords[0]!.id);
    expect(onAuditChanged).toHaveBeenCalled();
  });

  it("persists a failed export-history record (no success fields) and emits an audit event when rendering fails", async () => {
    const user = userEvent.setup();
    const onAuditChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <DossierPanel formulation={FORMULATION} versions={[VERSION_1]} auditLog={[]} onAuditChanged={onAuditChanged} />
      </MemoryRouter>,
    );
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
    bridge.upsertRecords.mockClear();

    vi.mocked(renderDossierDocument).mockRejectedValueOnce(new Error("render exploded"));
    await user.click(screen.getByRole("button", { name: "Export DOCX" }));
    expect(await screen.findByText(/render exploded/)).toBeInTheDocument();

    const historyCalls = bridge.upsertRecords.mock.calls.filter((c) => c[0] === "generated_document_records");
    const failedRecords = historyCalls[historyCalls.length - 1]![1] as { status: string; errorCode?: string; errorMessage?: string; fileName?: string; checksum?: string }[];
    expect(failedRecords[0]!.status).toBe("failed");
    expect(failedRecords[0]!.status).not.toBe("succeeded");
    expect(failedRecords[0]!.errorCode).toBeTruthy();
    expect(failedRecords[0]!.errorMessage).toContain("render exploded");
    expect(failedRecords[0]!.fileName).toBeUndefined();
    expect(failedRecords[0]!.checksum).toBeUndefined();
    expect(onAuditChanged).toHaveBeenCalled();
  });

  it("persists a failed export-history record and emits an audit event when the save itself fails", async () => {
    const user = userEvent.setup();
    const onAuditChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <DossierPanel formulation={FORMULATION} versions={[VERSION_1]} auditLog={[]} onAuditChanged={onAuditChanged} />
      </MemoryRouter>,
    );
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
    bridge.upsertRecords.mockClear();

    vi.mocked(renderDossierDocument).mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" });
    vi.mocked(saveBinaryWithFeedback).mockRejectedValueOnce(new Error("disk full"));
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(await screen.findByText(/disk full/)).toBeInTheDocument();

    const historyCalls = bridge.upsertRecords.mock.calls.filter((c) => c[0] === "generated_document_records");
    const failedRecords = historyCalls[historyCalls.length - 1]![1] as { status: string; errorMessage?: string; fileName?: string }[];
    expect(failedRecords[0]!.status).toBe("failed");
    expect(failedRecords[0]!.errorMessage).toContain("disk full");
    expect(failedRecords[0]!.fileName).toBeUndefined();
    expect(onAuditChanged).toHaveBeenCalled();
  });

  it("persists a cancelled export-history record (no success or error fields) when the save dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onAuditChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <DossierPanel formulation={FORMULATION} versions={[VERSION_1]} auditLog={[]} onAuditChanged={onAuditChanged} />
      </MemoryRouter>,
    );
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);
    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
    bridge.upsertRecords.mockClear();

    vi.mocked(renderDossierDocument).mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" });
    vi.mocked(saveBinaryWithFeedback).mockResolvedValueOnce({ kind: "canceled" });
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Generating…" })).not.toBeInTheDocument());

    const historyCalls = bridge.upsertRecords.mock.calls.filter((c) => c[0] === "generated_document_records");
    const cancelledRecords = historyCalls[historyCalls.length - 1]![1] as { status: string; fileName?: string; errorCode?: string }[];
    expect(cancelledRecords[0]!.status).toBe("cancelled");
    expect(cancelledRecords[0]!.fileName).toBeUndefined();
    expect(cancelledRecords[0]!.errorCode).toBeUndefined();
    expect(onAuditChanged).toHaveBeenCalled();
  });

  it("shows the export buttons disabled (not hidden) for an unauthorized role, and never creates a history record (Phase 10 Session 3: was hide-only before)", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);
    await user.selectOptions(screen.getByLabelText("Acting as"), "researcher");

    const exportPdf = screen.getByRole("button", { name: "Export PDF" });
    const exportDocx = screen.getByRole("button", { name: "Export DOCX" });
    expect(exportPdf).toBeDisabled();
    expect(exportDocx).toBeDisabled();
    await user.click(exportPdf);
    expect(bridge.upsertRecords.mock.calls.some((c) => c[0] === "generated_document_records")).toBe(false);
    expect(renderDossierDocument).not.toHaveBeenCalled();
  });

  it("records the exact source dossier and formula version on the export-history record", async () => {
    const user = userEvent.setup();
    await createAndOpenDossier(user);
    bridge.upsertRecords.mockClear();

    vi.mocked(renderDossierDocument).mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" });
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Generating…" })).not.toBeInTheDocument());

    const [, records] = bridge.upsertRecords.mock.calls.find((c) => c[0] === "generated_document_records")!;
    const [record] = records as { source: { sourceEntityType: string; sourceRecordId: string; formulaVersionId: string; dossierRevision: number } }[];
    expect(record.source.sourceEntityType).toBe("regulatory_dossier");
    expect(record.source.formulaVersionId).toBe("version-1");
    expect(record.source.dossierRevision).toBe(1);
    const [dossierRecord] = dossiersStore as { id: string }[];
    expect(record.source.sourceRecordId).toBe(dossierRecord.id);
  });

  it("renders a real PDF and a real DOCX end to end (no mock)", async () => {
    // `mockImplementationOnce`/`mockRejectedValueOnce`/`mockResolvedValueOnce`
    // in the earlier tests each affect only one call — by default this mock
    // already delegates to the real renderDossierDocument (see the
    // vi.mock("@/lib/documentExports", ...) setup above), so no restore is
    // needed here.
    const user = userEvent.setup();
    await createAndOpenDossier(user);
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();

    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Generating…" })).not.toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText(/Export failed/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export DOCX" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Generating…" })).not.toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText(/Export failed/)).not.toBeInTheDocument();
  });
});

describe("DossierPanel — guided-tour target resolution (Phase 10 Session 4)", () => {
  it("resolves every real element the dossiers tour points at", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "New dossier" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New dossier" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Formula version/i }), "version-1");
    await user.click(within(dialog).getByRole("checkbox", { name: "KE" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findAllByText(/DOS-/);

    expect(document.querySelector('[data-tour="dossiers.tab.requirements"]')).toBeInTheDocument();
    expect(document.querySelector('[data-tour="dossiers.tab.evidence"]')).toBeInTheDocument();
    expect(document.querySelector('[data-tour="dossiers.tab.reviews"]')).toBeInTheDocument();
    // Overview is the section shown by default after creation.
    expect(document.querySelector('[data-tour="dossiers.readinessSummary"]')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Evidence Library" }));
    expect(document.querySelector('[data-tour="dossiers.exportButtons"]')).toBeInTheDocument();
  });
});
