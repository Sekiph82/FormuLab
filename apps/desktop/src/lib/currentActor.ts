// Phase 13 Session 3 — the trusted current-user actor, sourced from Session
// 2's authenticated `AuthProvider`/`UserContext`, never from a frontend
// `useState<ApprovalRole>` the user can freely edit.
//
// `useTrustedActor()` returns `null` only when there is no `AuthProvider`
// ancestor at all. The real running application (`main.tsx`) always has one,
// so this only happens in this codebase's large existing test suite, which
// renders components directly via `renderAt`/`render`, bypassing it (the
// same reason `AuthProvider.tsx` itself exports the non-throwing
// `useOptionalAuth()` — see its doc comment). Every call site below falls
// back to its pre-Session-3 local reviewer/actor-role selector state in that
// case, so existing tests that exercise that selector keep passing
// unchanged; the production app, which always resolves a trusted user here,
// no longer offers a way to self-select an unearned role.
//
// Session 3 scope note (architecture doc §13/§26): this closes the
// *frontend selector* half of the "current user can claim any role" gap for
// the sites wired to it. It does not make the underlying write trusted
// end-to-end — the masterdata/Tauri commands these actors feed into still do
// not verify the role server-side (Session 4's job).
import { useOptionalAuth } from "@/app/providers/AuthProvider";
import type { ApprovalRole } from "@formulab/shared";

export interface TrustedActor {
  role: ApprovalRole;
  userId: string;
  displayName: string;
}

export function useTrustedActor(): TrustedActor | null {
  const auth = useOptionalAuth();
  if (!auth?.user) return null;
  // `SafeUser.role` is typed `string` on the wire, but it only ever
  // originates from Rust's `identity::Role::as_str()` — one of the exact 12
  // canonical strings `ApprovalRole` also names (parity enforced by
  // `rolePolicy.roleVocabularyParity.test.ts`), so this narrowing is safe.
  return { role: auth.user.role as ApprovalRole, userId: auth.user.userId, displayName: auth.user.displayName };
}
