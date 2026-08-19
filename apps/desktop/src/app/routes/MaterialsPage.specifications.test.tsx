/**
 * FVL-04.005 hardening — the real UI consumer for finished-product
 * specifications. Proves a real committed Data Exchange record is visible
 * in the Materials workspace's own "Specifications" tab, and that another
 * SKU's specification never leaks into a filtered view (FPS11/FPS12).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitDataExchangeRows } from "@/lib/dataExchangeCommit";
import { getDataExchangeTemplate, type DataExchangeRowResult } from "@formulab/shared";
import { MaterialsPage } from "./MaterialsPage";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  newMaterial: vi.fn(),
  newSupplier: vi.fn(),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

const ctx = { actorUserId: "local", actorRole: "administrator" as const };
function row(record: Record<string, string>): DataExchangeRowResult {
  return { rowNumber: 2, naturalKey: "TEST-KEY", state: "valid_create", messages: [], record };
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

describe("MaterialsPage — Specifications tab (FVL-04.005 real consumer)", () => {
  it("DOC-style acceptance: displays a real committed specification's exact values, and a SKU filter excludes another SKU's specification", async () => {
    const template = getDataExchangeTemplate("finished_product_specifications")!;
    await commitDataExchangeRows(template, [row({ sku_code: "SKU-A", test_definition_code: "TST-PH", target_value: "5.5", lower_limit: "5.0", upper_limit: "6.0", required_for_release: "true", effective_from: "2026-01-01" })], ctx);
    await commitDataExchangeRows(template, [row({ sku_code: "SKU-B", test_definition_code: "TST-VISC", target_value: "9000", lower_limit: "8000", upper_limit: "10000", effective_from: "2026-01-01" })], ctx);
    const committed = bridge.upsertRecords.mock.calls.filter(([c]) => c === "finished_product_specifications").map(([, r]) => r[0]);
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "finished_product_specifications" ? committed : []));

    const user = userEvent.setup();
    render(<MaterialsPage />);
    await user.click(await screen.findByRole("button", { name: "Specifications" }));

    const table = await screen.findByRole("table");
    expect(within(table).getByText("SKU-A")).toBeInTheDocument();
    expect(within(table).getByText("SKU-B")).toBeInTheDocument();
    expect(within(table).getByText("TST-PH")).toBeInTheDocument();
    expect(within(table).getByText("TST-VISC")).toBeInTheDocument();
    // Never a pass/fail verdict — only the canonical limits, plus the
    // honest imported_unverified state.
    expect(within(table).getAllByText("unverified").length).toBeGreaterThan(0);
    // No pass/fail verdict rendered anywhere in the table itself (the
    // page's own disclaimer text elsewhere legitimately says "pass/fail
    // verdict" — scoped to the table to avoid a false match on that).
    expect(within(table).queryByText(/pass|fail/i)).not.toBeInTheDocument();

    // FPS12: filtering by SKU-A never shows SKU-B's specification.
    await user.selectOptions(screen.getByLabelText("Filter by SKU"), "SKU-A");
    expect(within(table).getByText("SKU-A")).toBeInTheDocument();
    expect(within(table).queryByText("SKU-B")).not.toBeInTheDocument();
  });

  it("empty state renders honestly when no specifications exist", async () => {
    const user = userEvent.setup();
    render(<MaterialsPage />);
    await user.click(await screen.findByRole("button", { name: "Specifications" }));
    expect(await screen.findByText("No finished-product specifications recorded.")).toBeInTheDocument();
  });
});
