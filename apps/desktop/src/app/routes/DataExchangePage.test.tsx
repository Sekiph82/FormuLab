/**
 * UI-integration coverage for the Data Exchange Center workspace: the
 * Template Library shows all 35 cards, module filtering works, sections
 * switch, blank/example downloads don't throw, and the upload dialog
 * previews a file (never committing without an explicit confirm). Same
 * mocking discipline as DoePanel.test.tsx — only `@/lib/masterdata` and
 * `@/lib/formulations` are mocked; engine correctness is covered by the
 * dataExchange*.test.ts suites.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataExchangePage } from "./DataExchangePage";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));
vi.mock("@/lib/formulations", () => ({
  listFormulations: () => Promise.resolve([]),
  readFormulation: () => Promise.resolve({ formulation: undefined, versions: [] }),
  saveFormulation: (f: unknown) => Promise.resolve(f),
  saveFormulationVersion: (v: unknown) => Promise.resolve(v),
  newFormulation: (name: string, family: string, opts: { code?: string }) => ({
    schemaVersion: "1.0",
    id: "formulation-1",
    code: opts.code ?? "GEN-1",
    name,
    productFamilyCode: family,
    targetSkuCodes: [],
    targetMarkets: ["KE"],
    targetClaims: [],
    targetBatchKg: "100",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
  }),
  newVersion: (formulationId: string, lines: unknown[], opts: { versionNumber: number }) => ({
    schemaVersion: "1.0",
    id: "version-1",
    formulationId,
    versionNumber: opts.versionNumber,
    status: "concept",
    author: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    lines,
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
  // jsdom has no real object-URL support; the download helper only needs
  // these to exist so a click doesn't throw.
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DataExchangePage />
    </MemoryRouter>,
  );
}

describe("DataExchangePage — Template Library", () => {
  it("shows all 45 template cards by default", async () => {
    renderPage();
    expect(await screen.findByText("Raw Materials Master")).toBeInTheDocument();
    expect(screen.getByText("DOE Observations")).toBeInTheDocument();
    // 45 upload buttons, one per card — the most reliable proxy for card count.
    expect(screen.getAllByRole("button", { name: "Upload" })).toHaveLength(45);
  });

  it("filters cards by module", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Raw Materials Master");
    await user.click(screen.getByRole("button", { name: "doe" }));
    expect(screen.getByText("DOE Observations")).toBeInTheDocument();
    expect(screen.queryByText("Raw Materials Master")).not.toBeInTheDocument();
  });

  it("expands a card's field documentation", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = (await screen.findByText("Raw Materials Master")).closest(".rounded-card")! as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Fields" }));
    expect(within(card).getByText(/material_code/)).toBeInTheDocument();
  });

  it("does not throw downloading a blank or example CSV", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = (await screen.findByText("Raw Materials Master")).closest(".rounded-card")! as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Blank CSV" }));
    await user.click(within(card).getByRole("button", { name: "Example CSV" }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe("DataExchangePage — sections", () => {
  it("switches to Import History and shows an honest empty state", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Raw Materials Master");
    await user.click(screen.getByRole("button", { name: "Import History" }));
    expect(await screen.findByText("No imports yet.")).toBeInTheDocument();
  });

  it("switches to Schema Versions and lists every template's schema version", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Raw Materials Master");
    await user.click(screen.getByRole("button", { name: "Schema Versions" }));
    expect(await screen.findAllByText("1.0")).not.toHaveLength(0);
  });

  it("switches to Help and shows the security explanation", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Raw Materials Master");
    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(await screen.findByText(/neutralizes spreadsheet formulas/i)).toBeInTheDocument();
  });
});

describe("DataExchangePage — upload/preview pipeline", () => {
  it("opens the import dialog and previews an unauthorized role refusal before writing anything", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByRole("combobox"), "researcher");
    const card = (await screen.findByText("Raw Materials Master")).closest(".rounded-card")! as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Upload" }));

    const dialog = await screen.findByRole("dialog");
    const file = new File(["material_code,material_name\nTEST-MAT-001,TEST Water"], "materials.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await within(dialog).findByText(/not authorized/i)).toBeInTheDocument();
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  it("previews a valid file and commits only after explicit confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = (await screen.findByText("Raw Materials Master")).closest(".rounded-card")! as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Upload" }));

    const dialog = await screen.findByRole("dialog");
    const file = new File(["material_code,material_name\nTEST-MAT-001,TEST Water"], "materials.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await within(dialog).findByText("1")).toBeInTheDocument(); // create-count pill
    // A draft job row is recorded the moment the preview succeeds (so
    // Import History shows abandoned/failed attempts too), but the actual
    // target collection is never touched before an explicit commit.
    expect(bridge.upsertRecords).toHaveBeenCalledWith("data_exchange_import_jobs", expect.anything());
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("materials", expect.anything());

    await user.click(within(dialog).getByRole("button", { name: "Commit import" }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();
    expect(bridge.upsertRecords).toHaveBeenCalledWith("materials", expect.anything());
    expect(bridge.upsertRecords).toHaveBeenCalledWith("data_exchange_import_row_results", expect.anything());
  });

  it("records a cancelled job when the dialog is closed without committing", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = (await screen.findByText("Raw Materials Master")).closest(".rounded-card")! as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Upload" }));

    const dialog = await screen.findByRole("dialog");
    const file = new File(["material_code,material_name\nTEST-MAT-001,TEST Water"], "materials.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await within(dialog).findByText("1"); // create-count pill, preview is ready

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(bridge.upsertRecords).toHaveBeenCalledWith("data_exchange_import_jobs", [expect.objectContaining({ status: "cancelled" })]);
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("materials", expect.anything());
  });
});
