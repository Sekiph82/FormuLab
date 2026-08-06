/**
 * Focused coverage for the "unsupported template" path — a template that is
 * registered and previews correctly but has no real commit handler must
 * never show a false "completed" success. `DataExchangePage.test.tsx`
 * exercises this dialog end-to-end for real, supported templates; this file
 * covers the one path that can't be reached through a real registry
 * template anymore now that all 24 are wired — a synthetic template code
 * with no `COMMIT_HANDLERS` entry, standing in for whatever future
 * template ships registered before its handler does.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDataExchangeTemplate } from "@formulab/shared";
import { DataExchangeImportDialog } from "./DataExchangeImportDialog";

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

describe("DataExchangeImportDialog — genuinely unsupported template", () => {
  it("previews normally but blocks commit with an honest message, and records an unsupported job", async () => {
    const fakeTemplate = { ...getDataExchangeTemplate("raw_materials")!, templateCode: "not_a_real_template" };
    const user = userEvent.setup();
    render(
      <DataExchangeImportDialog
        template={fakeTemplate}
        actorRole="administrator"
        actorUserId="local"
        onCancel={() => {}}
        onCommitted={() => {}}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    const file = new File(["material_code,material_name\nTEST-MAT-001,TEST Water"], "materials.csv", { type: "text/csv" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    // Preview succeeded (this is a real, valid file for this template) —
    // the row itself is fine, only the commit path is blocked.
    expect(await within(dialog).findByText("1")).toBeInTheDocument(); // create-count pill

    expect(within(dialog).getByText(/not supported yet/i)).toBeInTheDocument();
    const commitBtn = within(dialog).getByRole("button", { name: "Not supported" });
    expect(commitBtn).toBeDisabled();

    // The draft job written at preview time must say "unsupported", never
    // "awaiting_confirmation" (which would imply a commit is possible).
    expect(bridge.upsertRecords).toHaveBeenCalledWith("data_exchange_import_jobs", [expect.objectContaining({ status: "unsupported" })]);
    // No target collection was ever touched.
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("materials", expect.anything());
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("data_exchange_import_row_results", expect.anything());
  });
});

describe("DataExchangeImportDialog — validation blocker (Phase 10 Session 3)", () => {
  it("shows a structured disabled-action explanation naming the error-row count when errors exist and partial import isn't enabled", async () => {
    const template = getDataExchangeTemplate("raw_materials")!;
    const user = userEvent.setup();
    render(
      <DataExchangeImportDialog
        template={template}
        actorRole="administrator"
        actorUserId="local"
        onCancel={() => {}}
        onCommitted={() => {}}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    // Two rows sharing the same material_code — the second previews as a
    // duplicate, a real `errorRows` state, not a synthetic/invented one.
    const file = new File(
      ["material_code,material_name\nTEST-MAT-001,TEST Water\nTEST-MAT-001,TEST Water Duplicate"],
      "materials.csv",
      { type: "text/csv" },
    );
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    const commitBtn = await within(dialog).findByRole("button", { name: "Commit import" });
    expect(commitBtn).toBeDisabled();
    const describedById = commitBtn.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    const explanation = document.getElementById(describedById!);
    expect(explanation).toHaveTextContent(/1 row\(s\) have errors/);
    expect(explanation).toHaveTextContent(/allow partial import/i);

    // Enabling partial import clears the block for the same preview.
    await user.click(within(dialog).getByRole("checkbox", { name: /valid row\(s\) now and skip/i }));
    expect(within(dialog).getByRole("button", { name: "Commit import" })).not.toBeDisabled();
  });
});
