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
import type { Formulation, FormulationVersion } from "@ai4s/shared";
import { DossierPanel } from "./DossierPanel";

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

    await user.selectOptions(screen.getByLabelText("Acting as"), "chemist");
    expect(screen.queryByRole("button", { name: /Add manual requirement/i })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Acting as"), "regulatory");
    expect(screen.getByRole("button", { name: /Add manual requirement/i })).toBeInTheDocument();
  });
});
