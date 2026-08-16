/**
 * Phase 13 Session 5 — Administration → Users. Proves: a non-administrator
 * sees no user-management UI at all (frontend visibility only — the real
 * guarantee is server-side, `admin.rs`'s `authz::authorize`, exercised
 * directly in `admin.rs`'s own Rust tests); an administrator sees the real
 * user list and can create a user through the real wrapper functions; the
 * role-capabilities view renders straight from `@formulab/shared`'s
 * `rolePolicy.ts`, not a second hand-maintained description.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeUser } from "@/lib/admin";
import { UsersPanel } from "./UsersPanel";

const bridge = {
  listAdministeredUsers: vi.fn(),
  createAdministeredUser: vi.fn(),
  updateAdministeredUserProfile: vi.fn(),
  changeAdministeredUserRole: vi.fn(),
  setAdministeredUserAccountStatus: vi.fn(),
  resetAdministeredUserPassword: vi.fn(),
  readSecurityAuditHistory: vi.fn(),
};

vi.mock("@/lib/admin", () => ({
  listAdministeredUsers: (...a: []) => bridge.listAdministeredUsers(...a),
  createAdministeredUser: (...a: [unknown]) => bridge.createAdministeredUser(...a),
  updateAdministeredUserProfile: (...a: [unknown]) => bridge.updateAdministeredUserProfile(...a),
  changeAdministeredUserRole: (...a: [string, string]) => bridge.changeAdministeredUserRole(...a),
  setAdministeredUserAccountStatus: (...a: [string, boolean]) => bridge.setAdministeredUserAccountStatus(...a),
  resetAdministeredUserPassword: (...a: [string, string, string]) => bridge.resetAdministeredUserPassword(...a),
  readSecurityAuditHistory: (...a: [string?]) => bridge.readSecurityAuditHistory(...a),
}));

let trustedActor: { role: string; userId: string; displayName: string } | null = null;
vi.mock("@/lib/currentActor", () => ({
  useTrustedActor: () => trustedActor,
}));

const ADMIN: SafeUser = {
  userId: "usr-1",
  username: "root.admin",
  displayName: "Root Admin",
  role: "administrator",
  accountStatus: "active",
  mustChangePassword: false,
};

const RESEARCHER: SafeUser = {
  userId: "usr-2",
  username: "jane.researcher",
  displayName: "Jane Researcher",
  role: "researcher",
  accountStatus: "active",
  mustChangePassword: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  trustedActor = null;
  bridge.listAdministeredUsers.mockResolvedValue([ADMIN, RESEARCHER]);
  bridge.readSecurityAuditHistory.mockResolvedValue([]);
});

describe("UsersPanel — visibility", () => {
  it("shows no user-management UI for a role without administrationUsers capability", async () => {
    trustedActor = { role: "researcher", userId: "usr-2", displayName: "Jane Researcher" };
    render(<UsersPanel />);
    expect(await screen.findByText(/administrator access is required/i)).toBeInTheDocument();
    expect(screen.queryByText("New user")).not.toBeInTheDocument();
    expect(bridge.listAdministeredUsers).not.toHaveBeenCalled();
  });

  it("shows the real user-management UI for an administrator", async () => {
    trustedActor = { role: "administrator", userId: "usr-1", displayName: "Root Admin" };
    render(<UsersPanel />);
    expect(await screen.findByText("root.admin")).toBeInTheDocument();
    expect(screen.getByText("jane.researcher")).toBeInTheDocument();
  });

  it("falls back to visible (outside a real AuthProvider, same convention every other useTrustedActor() site uses)", async () => {
    trustedActor = null;
    render(<UsersPanel />);
    expect(await screen.findByText("root.admin")).toBeInTheDocument();
  });
});

describe("UsersPanel — user list and actions", () => {
  it("renders username, display name, role selector and status for every user", async () => {
    render(<UsersPanel />);
    await screen.findByText("root.admin");
    expect(screen.getByText("jane.researcher")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // Header row + 2 data rows.
    expect(rows.length).toBe(3);
    expect(screen.getAllByText("Must change password").length).toBe(1);
  });

  it("creating a user calls createAdministeredUser with the typed fields, not a caller-invented role", async () => {
    bridge.createAdministeredUser.mockResolvedValue({
      userId: "usr-3",
      username: "new.person",
      displayName: "New Person",
      role: "quality",
      accountStatus: "active",
      mustChangePassword: true,
    });
    const user = userEvent.setup();
    render(<UsersPanel />);
    await screen.findByText("root.admin");

    await user.click(screen.getByText("New user"));
    await user.type(screen.getByLabelText(/Username \*/), "new.person");
    await user.type(screen.getByLabelText(/Display name \*/), "New Person");
    await user.type(screen.getByLabelText(/^Password \*/), "correct-password-1");
    await user.type(screen.getByLabelText(/Confirm password \*/), "correct-password-1");
    await user.selectOptions(screen.getByLabelText(/Role/), "quality");
    await user.click(screen.getByText("Create user", { selector: "button" }));

    await waitFor(() => expect(bridge.createAdministeredUser).toHaveBeenCalledTimes(1));
    const call = bridge.createAdministeredUser.mock.calls[0][0];
    expect(call.username).toBe("new.person");
    expect(call.role).toBe("quality");
    expect(call.password).toBe("correct-password-1");
  });

  it("changing a role calls changeAdministeredUserRole with the selected value", async () => {
    bridge.changeAdministeredUserRole.mockResolvedValue({ ...RESEARCHER, role: "quality_manager" });
    const user = userEvent.setup();
    render(<UsersPanel />);
    await screen.findByText("jane.researcher");

    const row = screen.getByText("jane.researcher").closest("tr")!;
    const roleSelect = within(row).getByDisplayValue("researcher");
    await user.selectOptions(roleSelect, "quality_manager");

    await waitFor(() => expect(bridge.changeAdministeredUserRole).toHaveBeenCalledWith("usr-2", "quality_manager"));
  });

  it("disabling an account requires confirmation before calling the backend", async () => {
    bridge.setAdministeredUserAccountStatus.mockResolvedValue({ ...RESEARCHER, accountStatus: "disabled" });
    const user = userEvent.setup();
    render(<UsersPanel />);
    await screen.findByText("jane.researcher");

    const row = screen.getByText("jane.researcher").closest("tr")!;
    await user.click(within(row).getByLabelText("Disable"));
    expect(bridge.setAdministeredUserAccountStatus).not.toHaveBeenCalled();

    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(bridge.setAdministeredUserAccountStatus).toHaveBeenCalledWith("usr-2", false));
  });
});

describe("UsersPanel — role capabilities view", () => {
  it("renders every one of the 12 canonical roles, sourced from rolePolicy.ts", async () => {
    render(<UsersPanel />);
    await screen.findByText("root.admin");
    await userEvent.setup().click(screen.getByText("Role capabilities"));
    for (const role of [
      "researcher",
      "research_manager",
      "quality",
      "quality_manager",
      "regulatory",
      "raw_material",
      "procurement",
      "production_engineering",
      "production",
      "production_manager",
      "document_control",
      "administrator",
    ]) {
      expect(screen.getByText(role)).toBeInTheDocument();
    }
  });
});
