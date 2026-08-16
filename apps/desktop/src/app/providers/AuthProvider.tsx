import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  bootstrapCreateAdministrator,
  bootstrapStatus,
  currentSession,
  login as loginRequest,
  logout as logoutRequest,
  type AuthSession,
  type SafeUser,
} from "@/lib/auth";
import { BootstrapScreen } from "@/components/auth/BootstrapScreen";
import { LoginScreen } from "@/components/auth/LoginScreen";

/** localStorage holds ONLY the opaque bearer token — never username, role,
 *  displayName, or any other user detail. Every restart re-resolves the
 *  full user record from Rust via `currentSession`, so persisted frontend
 *  state is never trusted as authentication or role authority (architecture
 *  doc §14/§20; phase brief §22).
 *
 *  Exported (Phase 13 Session 4) so `@/lib/sessionToken`'s
 *  `currentSessionToken()` — the one accessor every privileged command
 *  wrapper uses to attach the caller's bearer token — reads the exact same
 *  key this provider persists to, rather than a second hardcoded string
 *  that could silently drift from it. */
export const SESSION_TOKEN_KEY = "formulab.auth.token";

type AuthPhase = "resolving" | "bootstrapRequired" | "loginRequired" | "authenticated";

export interface AuthContextValue {
  phase: AuthPhase;
  /** Safe, non-secret user projection — identity/session context, not a
   *  permissions array. Role-to-capability derivation is a later session's
   *  `rolePolicy.ts` (architecture doc §20/§7). Present only when
   *  `phase === "authenticated"`. */
  user: SafeUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeBootstrap: (input: {
    username: string;
    displayName: string;
    password: string;
    confirmPassword: string;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Application-wide authenticated-user context. `useAuth()` throws outside
 *  `AuthProvider` on purpose — every consumer must be inside the gate this
 *  provider owns, never guess at a default. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>");
  return ctx;
}

/** Same context, but `null` instead of throwing when there's no
 *  `AuthProvider` ancestor. For components (like the sidebar's account row)
 *  that render fine either way and are also exercised by this codebase's
 *  large existing test suite via `renderAt`, which mounts routes/AppShell
 *  directly without going through `main.tsx`'s real `AuthProvider` — using
 *  the throwing `useAuth()` there would break every one of those tests. */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

function readPersistedToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_TOKEN_KEY);
}

function persistToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(SESSION_TOKEN_KEY, token);
  else window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

/** The startup authentication gate: fresh install -> Administrator Setup,
 *  configured install with no valid session -> Login, valid persisted
 *  session -> straight into the app. Children (the whole routed
 *  application, via `main.tsx`) are only ever rendered once `phase ===
 *  "authenticated"` — the router itself doesn't exist yet while resolving,
 *  bootstrapping, or logging in, so there is no protected-content flash and
 *  no route a direct navigation could use to bypass this gate. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>("resolving");
  const [user, setUser] = useState<SafeUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await bootstrapStatus();
      if (cancelled) return;
      if (status.bootstrapRequired) {
        setPhase("bootstrapRequired");
        return;
      }
      const persisted = readPersistedToken();
      if (!persisted) {
        setPhase("loginRequired");
        return;
      }
      const resolved = await currentSession(persisted);
      if (cancelled) return;
      if (!resolved) {
        // Expired/revoked/disabled/unknown — never distinguish which to the UI.
        persistToken(null);
        setPhase("loginRequired");
        return;
      }
      setUser(resolved);
      setToken(persisted);
      setPhase("authenticated");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enterSession = useCallback((session: AuthSession) => {
    persistToken(session.token);
    setToken(session.token);
    setUser(session.user);
    setPhase("authenticated");
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const session = await loginRequest(username, password);
      enterSession(session);
    },
    [enterSession],
  );

  const completeBootstrap = useCallback(
    async (input: { username: string; displayName: string; password: string; confirmPassword: string }) => {
      const session = await bootstrapCreateAdministrator(input);
      enterSession(session);
    },
    [enterSession],
  );

  const logout = useCallback(async () => {
    const current = token;
    // Clear local state first: the UI must return to Login even if the
    // revoke call itself fails (offline edge case) — a stale local token
    // must never keep rendering the authenticated app.
    persistToken(null);
    setToken(null);
    setUser(null);
    setPhase("loginRequired");
    if (current) {
      try {
        await logoutRequest(current);
      } catch {
        /* best-effort revoke — local session is already cleared */
      }
    }
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({ phase, user, login, logout, completeBootstrap }),
    [phase, user, login, logout, completeBootstrap],
  );

  if (phase === "resolving") {
    // No app chrome, no flash of protected content — a blank shell matching
    // the app background until bootstrap/session resolution finishes.
    return <div className="h-screen w-screen bg-bg" />;
  }
  if (phase === "bootstrapRequired") {
    return <BootstrapScreen onComplete={completeBootstrap} />;
  }
  if (phase === "loginRequired") {
    return <LoginScreen onLogin={login} />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
