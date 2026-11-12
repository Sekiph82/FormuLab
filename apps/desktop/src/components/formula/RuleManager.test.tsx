import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuleManager } from "./RuleManager";

const { upsertRecords, trustedActor } = vi.hoisted(() => ({
  upsertRecords: vi.fn(),
  trustedActor: { role: "raw_material", userId: "reviewer-1", displayName: "Reviewer" },
}));

vi.mock("@/lib/masterdata", () => ({ upsertRecords }));
vi.mock("@/lib/currentActor", () => ({
  useTrustedActor: () => trustedActor,
}));

describe("RuleManager import trust boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trustedActor.role = "raw_material";
    upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
  });

  it("imports rules as unverified even when the JSON claims human verification", async () => {
    const user = userEvent.setup();
    render(<RuleManager kind="safety" rules={[]} onBack={vi.fn()} onReload={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Import JSON" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Import JSON" }), { target: { value: JSON.stringify({
      id: "imported-rule",
      name: "Imported rule",
      conditions: [],
      status: "verified",
      verificationStatus: "verified",
    }) } });
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(upsertRecords).toHaveBeenCalledWith("safety_rules", [expect.objectContaining({
      id: "imported-rule",
      status: "draft",
      verificationStatus: "not_verified",
    })]);
  });

  it("lets a verifier review a rule without granting edit access to its contents", async () => {
    const user = userEvent.setup();
    trustedActor.role = "production_manager";
    const rule = {
      id: "draft-rule",
      name: "Draft rule",
      status: "draft" as const,
      severity: "warning" as const,
      verificationStatus: "not_verified",
      active: true,
      message: "Review required",
      updatedAt: "2026-01-01T00:00:00.000Z",
      conditions: [],
    };
    render(<RuleManager kind="safety" rules={[rule]} onBack={vi.fn()} onReload={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Draft rule" }));
    await user.selectOptions(screen.getByLabelText("Status"), "verified");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(upsertRecords).toHaveBeenCalledWith("safety_rules", [expect.objectContaining({ status: "verified", verificationStatus: "verified" })]);
  });

  it("does not let a rule editor verify without the verify capability", async () => {
    const user = userEvent.setup();
    const rule = {
      id: "draft-rule",
      name: "Draft rule",
      status: "draft" as const,
      severity: "warning" as const,
      verificationStatus: "not_verified",
      active: true,
      message: "Review required",
      updatedAt: "2026-01-01T00:00:00.000Z",
      conditions: [],
    };
    render(<RuleManager kind="safety" rules={[rule]} onBack={vi.fn()} onReload={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Draft rule" }));
    await user.selectOptions(screen.getByLabelText("Status"), "verified");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(upsertRecords).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Your role cannot verify safety or compatibility rules.");
  });
});
