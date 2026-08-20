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

// Session 12 hardening (Section 7) — a REAL stateful in-memory store
// (the same convention `connectorImportBridge.test.ts`/
// `customerMigrationFixture.test.ts` already use), not a static
// `mockResolvedValue([])` — needed so a SECOND dialog's own prepare can
// genuinely see the FIRST dialog's real committed Import History, the
// only way to prove SOURCE_MISSING detection through this real UI
// rather than a synthetic prop.
const store = new Map<string, Record<string, unknown>[]>();
const bridge = {
  listRecords: vi.fn((collection: string) => Promise.resolve(store.get(collection) ?? [])),
  upsertRecords: vi.fn((collection: string, records: Record<string, unknown>[]) => {
    const existing = store.get(collection) ?? [];
    let inserted = 0;
    let updated = 0;
    const next = [...existing];
    for (const record of records) {
      const key = (record.code ?? record.id) as string | undefined;
      const idx = key ? next.findIndex((r) => (r.code ?? r.id) === key) : -1;
      if (idx >= 0) {
        next[idx] = record;
        updated++;
      } else {
        next.push(record);
        inserted++;
      }
    }
    store.set(collection, next);
    return Promise.resolve({ inserted, updated, total: next.length });
  }),
};
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, Record<string, unknown>[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(store.get(collection) ?? []));
  bridge.upsertRecords.mockImplementation((collection: string, records: Record<string, unknown>[]) => {
    const existing = store.get(collection) ?? [];
    let inserted = 0;
    let updated = 0;
    const next = [...existing];
    for (const record of records) {
      const key = (record.code ?? record.id) as string | undefined;
      const idx = key ? next.findIndex((r) => (r.code ?? r.id) === key) : -1;
      if (idx >= 0) {
        next[idx] = record;
        updated++;
      } else {
        next.push(record);
        inserted++;
      }
    }
    store.set(collection, next);
    return Promise.resolve({ inserted, updated, total: next.length });
  });
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

  it("Section 7 (Session 12 hardening): SOURCE_MISSING findings from a real prior import are rendered, with real identity, and the FormuLab-never-auto-deletes disclosure text", async () => {
    const template = getDataExchangeTemplate("raw_materials")!;
    const user = userEvent.setup();

    // First import: two real materials, committed for real through this same dialog.
    const { unmount } = render(<ConnectorBridgeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog1 = await screen.findByRole("dialog");
    const input1 = dialog1.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input1, new File(["material_code,material_name\nSM-MAT-1,First Material\nSM-MAT-2,Second Material"], "materials.csv", { type: "text/csv" }));
    await user.click(within(dialog1).getByRole("button", { name: /commit/i }));
    await within(dialog1).findByText(/imported/i);
    unmount();

    // Second import of the SAME template: SM-MAT-2 no longer appears in the source file at all.
    render(<ConnectorBridgeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog2 = await screen.findByRole("dialog");
    const input2 = dialog2.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input2, new File(["material_code,material_name\nSM-MAT-1,First Material"], "materials.csv", { type: "text/csv" }));

    // Requirement 2 — enough identity to review: target template implied by context, real natural key, real target collection.
    expect(await within(dialog2).findByText(/SM-MAT-2/)).toBeInTheDocument();
    // Requirement 3 — explicit, never-auto-delete disclosure.
    expect(within(dialog2).getByText(/nothing has been deleted/i)).toBeInTheDocument();
    // A commit is still possible for the row that DID resolve — SOURCE_MISSING is informational, never destructive/blocking.
    expect(within(dialog2).getByRole("button", { name: /commit/i })).not.toBeDisabled();
  });

  it("Section 7 (Session 12 hardening): no SOURCE_MISSING finding means no warning block at all — requirement 10", async () => {
    const template = getDataExchangeTemplate("raw_materials")!;
    const user = userEvent.setup();
    render(<ConnectorBridgeImportDialog template={template} actorRole="administrator" actorUserId="local" onCancel={() => {}} onCommitted={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["material_code,material_name\nNM-MAT-1,No Missing Material"], "materials.csv", { type: "text/csv" }));
    await within(dialog).findByText(/raw_materials/);
    expect(within(dialog).queryByText(/nothing has been deleted/i)).not.toBeInTheDocument();
  });
});
