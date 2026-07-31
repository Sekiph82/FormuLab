/**
 * Confirms the per-test "Method" entry point (Phase 10 Session 1A) opens
 * the `TestMethodDrawer` scoped to the clicked row's own definition. The
 * drawer's own behavior is covered by `TestMethodDrawer.test.tsx`.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDefinition } from "@formulab/shared";
import { TestDefinitionsPanel } from "./TestDefinitionsPanel";

const bridge = {
  listRecordsSeeded: vi.fn(),
  upsertRecords: vi.fn(),
};

vi.mock("@/lib/masterdata", () => ({
  listRecordsSeeded: (...a: [string, unknown[]]) => bridge.listRecordsSeeded(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
}));

const PH: TestDefinition = {
  schemaVersion: "1.0",
  code: "TEST-PH",
  name: "pH",
  category: "physical_chemical",
  resultType: "numeric",
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

const VISCOSITY: TestDefinition = { ...PH, code: "TEST-VISCOSITY", name: "Viscosity" };

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecordsSeeded.mockImplementation((collection: string) => {
    if (collection === "test_definitions") return Promise.resolve([PH, VISCOSITY]);
    return Promise.resolve([]);
  });
});

describe("TestDefinitionsPanel — per-test method entry point", () => {
  it("opens the Test Method drawer for only the clicked row's own test", async () => {
    render(<TestDefinitionsPanel />);
    const phRow = (await screen.findByDisplayValue("pH")).closest("div")!.parentElement!;
    const methodButtons = await screen.findAllByRole("button", { name: /Method/ });
    expect(methodButtons).toHaveLength(2);
    await userEvent.click(methodButtons[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", expect.stringContaining("pH"));
    expect(dialog).not.toHaveAttribute("aria-label", expect.stringContaining("Viscosity"));
    void phRow;
  });

  it("closing the drawer returns to the definitions list with no drawer open", async () => {
    render(<TestDefinitionsPanel />);
    const methodButtons = await screen.findAllByRole("button", { name: /Method/ });
    await userEvent.click(methodButtons[0]);
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
