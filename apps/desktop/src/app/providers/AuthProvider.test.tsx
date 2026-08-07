import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";
import type { AuthSession, SafeUser } from "@/lib/auth";

const authMock = {
  bootstrapStatus: vi.fn(),
  currentSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  bootstrapCreateAdministrator: vi.fn(),
};
vi.mock("@/lib/auth", () => ({
  bootstrapStatus: () => authMock.bootstrapStatus(),
  currentSession: (token: string) => authMock.currentSession(token),
  login: (u: string, p: string) => authMock.login(u, p),
  logout: (token: string) => authMock.logout(token),
  bootstrapCreateAdministrator: (input: unknown) => authMock.bootstrapCreateAdministrator(input),
}));

const ADMIN_USER: SafeUser = {
  userId: "usr_1",
  username: "test.admin",
  displayName: "Test Admin",
  role: "administrator",
  accountStatus: "active",
  mustChangePassword: false,
};

function authedSession(): AuthSession {
  return { user: ADMIN_USER, token: "tok_abc123", expiresAt: "9999999999" };
}

function ProtectedProbe() {
  const { user } = useAuth();
  return <div data-testid="protected-content">authenticated as {user?.username}</div>;
}

beforeEach(() => {
  window.localStorage.clear();
  authMock.bootstrapStatus.mockReset();
  authMock.currentSession.mockReset();
  authMock.login.mockReset();
  authMock.logout.mockReset();
  authMock.bootstrapCreateAdministrator.mockReset();
});

describe("AuthProvider — startup routing", () => {
  it("fresh install (bootstrap required) shows Administrator Setup, not Login or the app", async () => {
    authMock.bootstrapStatus.mockResolvedValue({ bootstrapRequired: true });
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    expect(await screen.findByText(/Set up FormuLab/i)).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign in/i)).not.toBeInTheDocument();
  });

  it("configured install with no persisted session shows Login, not the app", async () => {
    authMock.bootstrapStatus.mockResolvedValue({ bootstrapRequired: false });
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("a valid persisted session enters the app directly, without showing Login", async () => {
    window.localStorage.setItem("formulab.auth.token", "tok_persisted");
    authMock.bootstrapStatus.mockResolvedValue({ bootstrapRequired: false });
    authMock.currentSession.mockResolvedValue(ADMIN_USER);
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    expect(await screen.findByTestId("protected-content")).toHaveTextContent("test.admin");
    expect(authMock.currentSession).toHaveBeenCalledWith("tok_persisted");
  });

  it("an invalid/expired persisted session falls through to Login and clears the stale token", async () => {
    window.localStorage.setItem("formulab.auth.token", "tok_stale");
    authMock.bootstrapStatus.mockResolvedValue({ bootstrapRequired: false });
    authMock.currentSession.mockResolvedValue(null);
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: /Sign in/i })).toBeInTheDocument();
    expect(window.localStorage.getItem("formulab.auth.token")).toBeNull();
  });

  it("renders no protected content while bootstrap status is still resolving", () => {
    authMock.bootstrapStatus.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Set up FormuLab/i)).not.toBeInTheDocument();
  });
});

describe("AuthProvider — login flow", () => {
  beforeEach(() => {
    authMock.bootstrapStatus.mockResolvedValue({ bootstrapRequired: false });
  });

  it("a successful login enters the app and persists only the token", async () => {
    authMock.login.mockResolvedValue(authedSession());
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    await screen.findByRole("heading", { name: /Sign in/i });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Username/i), "test.admin");
    await user.type(screen.getByLabelText(/^Password$/i), "correct-password");
    await user.click(screen.getByRole("button", { name: /^Sign in$/i }));

    expect(await screen.findByTestId("protected-content")).toHaveTextContent("test.admin");
    expect(window.localStorage.getItem("formulab.auth.token")).toBe("tok_abc123");
    // Never persists username/role/displayName — only the opaque token.
    expect(window.localStorage.getItem("formulab.auth.token")).not.toContain("test.admin");
  });

  it("an invalid login shows the generic error and stays on Login", async () => {
    authMock.login.mockRejectedValue(new Error("Invalid username or password."));
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    await screen.findByRole("heading", { name: /Sign in/i });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Username/i), "someone");
    await user.type(screen.getByLabelText(/^Password$/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^Sign in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password.");
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Sign in/i })).toBeInTheDocument();
  });

  it("the Login screen has no signup, social, email, or SMS affordances", async () => {
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    await screen.findByRole("heading", { name: /Sign in/i });
    expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/microsoft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/forgot password\?/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(document.querySelector('input[type="tel"]')).toBeNull();
  });
});

describe("AuthProvider — bootstrap flow", () => {
  beforeEach(() => {
    authMock.bootstrapStatus.mockResolvedValue({ bootstrapRequired: true });
  });

  it("the bootstrap screen has no role selector anywhere", async () => {
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    await screen.findByText(/Set up FormuLab/i);
    expect(document.querySelector("select")).toBeNull();
    expect(screen.queryByText(/role/i, { selector: "label" })).not.toBeInTheDocument();
  });

  it("a successful bootstrap enters the app as administrator", async () => {
    authMock.bootstrapCreateAdministrator.mockResolvedValue(authedSession());
    render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    await screen.findByText(/Set up FormuLab/i);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Username$/i), "test.admin");
    await user.type(screen.getByLabelText(/Display name/i), "Test Admin");
    await user.type(screen.getByLabelText(/^Password$/i), "correct-password-1");
    await user.type(screen.getByLabelText(/Confirm password/i), "correct-password-1");
    await user.click(screen.getByRole("button", { name: /Create Administrator/i }));

    expect(await screen.findByTestId("protected-content")).toHaveTextContent("test.admin");
    expect(authMock.bootstrapCreateAdministrator).toHaveBeenCalledWith({
      username: "test.admin",
      displayName: "Test Admin",
      password: "correct-password-1",
      confirmPassword: "correct-password-1",
    });
  });
});

describe("AuthProvider — logout", () => {
  it("logout clears local state, revokes the token, and returns to Login", async () => {
    window.localStorage.setItem("formulab.auth.token", "tok_persisted");
    authMock.bootstrapStatus.mockResolvedValue({ bootstrapRequired: false });
    authMock.currentSession.mockResolvedValue(ADMIN_USER);
    authMock.logout.mockResolvedValue(undefined);

    function LogoutProbe() {
      const { logout, user } = useAuth();
      return (
        <div>
          <span data-testid="protected-content">{user?.username}</span>
          <button onClick={() => void logout()}>do-logout</button>
        </div>
      );
    }

    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>,
    );
    await screen.findByTestId("protected-content");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "do-logout" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: /Sign in/i })).toBeInTheDocument());
    expect(window.localStorage.getItem("formulab.auth.token")).toBeNull();
    expect(authMock.logout).toHaveBeenCalledWith("tok_persisted");
  });

  it("logout still returns to Login even if the backend revoke call fails (offline edge case)", async () => {
    window.localStorage.setItem("formulab.auth.token", "tok_persisted");
    authMock.bootstrapStatus.mockResolvedValue({ bootstrapRequired: false });
    authMock.currentSession.mockResolvedValue(ADMIN_USER);
    authMock.logout.mockRejectedValue(new Error("offline"));

    function LogoutProbe() {
      const { logout, user } = useAuth();
      return (
        <div>
          <span data-testid="protected-content">{user?.username}</span>
          <button onClick={() => void logout()}>do-logout</button>
        </div>
      );
    }

    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>,
    );
    await screen.findByTestId("protected-content");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "do-logout" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: /Sign in/i })).toBeInTheDocument());
    expect(window.localStorage.getItem("formulab.auth.token")).toBeNull();
  });
});
