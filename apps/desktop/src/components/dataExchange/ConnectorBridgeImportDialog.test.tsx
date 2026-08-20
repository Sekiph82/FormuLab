/**
 * FVL-04.024 hardening (Part F8) — proves the production bridge is
 * genuinely reachable from real desktop UI, not merely called from
 * tests that manually chain the pipeline.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDataExchangeTemplate } from "@formulab/shared";
import { ConnectorBridgeImportDialog } from "./ConnectorBridgeImportDialog";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

describe("ConnectorBridgeImportDialog — the real production entry point into prepareConnectorImport()/confirmConnectorImport()", () => {
  it("a CSV whose headers exactly match raw_materials' own column keys is auto-mapped, prepared, and genuinely committed through the real bridge", async () => {
    const template = getDataExchangeTemplate("raw_materials")!;
    const user = userEvent.setup();
    render(<ConnectorBridgeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const file = new File(["material_code,material_name\nBRIDGE-MAT-1,Bridge Test Material"], "materials.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    // A real prepared result rendered, with a real (trivial, single-template) commit order.
    expect(await within(dialog).findByText(/raw_materials/)).toBeInTheDocument();

    const commitBtn = within(dialog).getByRole("button", { name: /commit/i });
    expect(commitBtn).not.toBeDisabled();
    await user.click(commitBtn);

    await within(dialog).findByText(/imported/i);
    expect(bridge.upsertRecords).toHaveBeenCalledWith("materials", expect.arrayContaining([expect.objectContaining({ code: "BRIDGE-MAT-1" })]));
    // Real Import History provenance, not merely a commit.
    expect(bridge.upsertRecords).toHaveBeenCalledWith("data_exchange_import_jobs", expect.arrayContaining([expect.objectContaining({ connectorType: "FILE", sourceSystemId: "LOCAL_FILE" })]));
  });

  it("a required column with no matching source header blocks confirm, never a silent partial import", async () => {
    const template = getDataExchangeTemplate("raw_materials")!;
    const user = userEvent.setup();
    render(<ConnectorBridgeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    // material_name (REQUIRED) has no matching column here.
    const file = new File(["material_code\nBRIDGE-MAT-2"], "materials.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    const commitBtn = await within(dialog).findByRole("button", { name: /commit/i });
    expect(commitBtn).toBeDisabled();
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("materials", expect.anything());
  });
});
