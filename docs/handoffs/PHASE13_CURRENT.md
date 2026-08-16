# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: SESSION 3 COMPLETE — `rolePolicy.ts` (canonical `can(role, area, capability)` covering all of §6's full matrix), a Rust/TypeScript role-vocabulary parity test, and frontend trusted-actor wiring for the 10 current-user role-selector sites are implemented, tested, and in place. Still no `Administration → Users` UI (Session 5) and no application-wide *server-side* enforcement (Session 4) — every Tauri command Session 3's privileged-command inventory reviewed still performs zero role checks, exactly as it did after Session 2. Full design in `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md`, test report in `docs/PHASE13_SECURITY_TEST_MATRIX.md`. Runs in parallel with Phase 12's still-open SignPath thread (`docs/handoffs/PHASE12_CURRENT.md`) — unrelated, does not block or get blocked by it.

## Session 3 summary

**`rolePolicy.ts` is the new canonical `can(role, area, capability)`
module**, transcribing architecture doc §6's full permission matrix —
not just the two approval gates `status.ts`'s `APPROVAL_AUTHORITY`
already covered. Default-deny: any role/area/capability triple with no
explicit matrix entry resolves to refused, not silently allowed. Two
discrepancies between §6's prose and its own table are resolved and
individually tested, not silently picked one way: `production_manager`
gets verify authority on `rawMaterials`/`supplierDocuments` (§15.4),
and `quality` + `administrator` get verify authority on `regulatory`
(matching the pre-existing, untouched `AUTHORIZED_REGULATORY_ROLES`,
§8). `approve`/`reject` on both approval gates are derived live from
`APPROVAL_AUTHORITY` rather than re-typed, so the two modules
structurally cannot drift apart. 32 tests, all passing.

**A shared JSON fixture now anchors both languages' role vocabularies
to each other, not to a third hand-copied list.**
`packages/shared/src/engine/roleVocabulary.json` is checked by
`rolePolicy.roleVocabularyParity.test.ts` (5 TypeScript tests) and by
`identity.rs`'s new `role_vocabulary_matches_the_shared_json_fixture`
(1 Rust test) — both sides read the same file and assert byte-identical
agreement with their own 12-role list. Neither language's list is
trusted as the source of truth for the other; the file is.

**A new hook closes the frontend half of the "current user can claim
any role" gap for 10 sites.** `apps/desktop/src/lib/currentActor.ts`'s
`useTrustedActor()` sources `{role, userId, displayName}` from
`AuthProvider`'s authenticated `UserContext` when one exists, falling
back to each site's pre-existing local `useState` selector only when
there's no `AuthProvider` ancestor — which in the real running app
never happens, only in this codebase's large existing test suite
(`renderAt()` bypasses `main.tsx`'s real provider, same as
`useOptionalAuth()`'s existing rationale, Session 2). Wired into all 10
sites Session 0/2/3 flagged as spoofable current-user role selectors:
`ApprovalPanel`, `ClaimsLabelsPanel`, `DossierPanel`, `RegulatoryPanel`,
`DoePanel`, `TestMethodDrawer`, `DataExchangePage` (checkpoint commit,
same session), plus `TrialsPanel`, `StabilityPanel`,
`CorrectiveActionsPanel` (this closure). `StabilityPanel`'s
`manualInclusionReviewer` free-text field was deliberately left
untouched — it names who authorized a manual test-applicability
override, not "which role am I," so it isn't in scope.

**This does not make any write trusted end-to-end.** Every Tauri
command these actors' data eventually reaches still performs zero
server-side role verification — closing the frontend selector is not
the same thing as closing the bypass a raw `invoke()` call still has.
That gap is real, unchanged since Session 2, and now precisely sized:

**A privileged-command inventory reviewed all 110 registered Tauri
commands** (architecture doc §9.2) and categorized which are
role-gated business actions with no current server-side check:
approval gates (`save_approval_record`, the known Session 0 finding),
formulation content writes, generic masterdata CRUD (the widest gap
found — `upsert_master_records`/`delete_master_record`/
`write_master_collection_raw` carry no actor field of any kind, not
even an unchecked name string), the audit-event write path, attachments,
and system administration (backup/restore/migration/data-location
moves). The last category surfaced a finding beyond "commands aren't
checked": **§6's matrix has no System-Administration area at all** —
Session 4 cannot enforce a matrix cell that doesn't exist yet, so
drafting that area during the domain review (Risks item 1) is
prerequisite work for Session 4, not a Session 4 afterthought. This
inventory is audit-only; no command's behavior changed.

Rust: 252/252 pass (Session 2's 251 + 1 new — the vocabulary parity
test), clippy clean. Shared: 1291/1291 pass (Session 2's 1254 + 37
new — `rolePolicy.test.ts` + its parity test), tsc clean. Desktop:
tsc clean; full suite 1185/1185 — unchanged from Session 2, since this
session's frontend work is wiring/fallback with existing coverage, not
new behavior needing new tests (architecture doc §9.2, test matrix §I.3).

## Deliverables (this session)

- `packages/shared/src/engine/rolePolicy.ts` (new) — canonical `can()`,
  default-deny, full §6 matrix, approval derivation from
  `APPROVAL_AUTHORITY`. 32 tests (`rolePolicy.test.ts`).
- `packages/shared/src/engine/roleVocabulary.json` (new) — the shared
  fixture both languages check themselves against.
- `packages/shared/src/engine/rolePolicy.roleVocabularyParity.test.ts`
  (new, 5 tests) + `identity.rs`'s
  `role_vocabulary_matches_the_shared_json_fixture` (new, 1 test).
- `apps/desktop/src/lib/currentActor.ts` (new) — `useTrustedActor()`.
- `apps/desktop/src/components/formula/ApprovalPanel.tsx`,
  `ClaimsLabelsPanel.tsx`, `DossierPanel.tsx`, `RegulatoryPanel.tsx`,
  `DoePanel.tsx`, `apps/desktop/src/components/laboratory/TestMethodDrawer.tsx`,
  `apps/desktop/src/app/routes/DataExchangePage.tsx` — wired to
  `useTrustedActor()` (checkpoint commit).
- `apps/desktop/src/components/formula/TrialsPanel.tsx`,
  `StabilityPanel.tsx`, `CorrectiveActionsPanel.tsx` — wired to
  `useTrustedActor()` (this closure): every `LOCAL_HUMAN`-actor call
  site and every plain `"local"` performer/owner/reviewer string that
  represented "who is doing this right now" now prefers the trusted
  session's `{role, userId}` when one exists.
- `auth.actingAsTrusted` i18n key, all 8 shipped locales.
- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — §7 (canonical
  authorization source) rewritten from "Session 3 task" to
  as-implemented; new §9.2 (frontend wiring + privileged-command
  inventory); §2's "Role enforcement (backend/Rust)" and "UI role
  selection" rows updated; §25 session plan and Risks section updated,
  including a new System-Administration-area finding.
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` — B1/B2 annotated with the
  policy-layer-done/application-layer-still-Session-4 split; new §I
  reporting Session 3's 38 new tests and the frontend-wiring test
  rationale.
- This handoff.
- External log:
  `C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md`,
  Session 3 entry appended (not a new log).

## What Session 3 deliberately did NOT do

- No server-side enforcement anywhere — `rolePolicy.ts`'s `can()` is
  callable but nothing calls it from a Tauri command yet (Session 4).
- No fix to `save_approval_record`'s missing role check, or to any
  other command the privileged-command inventory (§9.2) found
  unchecked — inventoried, not fixed.
- No System-Administration area drafted in §6's matrix — only the gap
  itself was identified this session.
- No `Administration → Users` UI, no arbitrary (non-bootstrap) user
  creation, no role-change UI (Session 5).
- No full department-workflow-engine implementation; the §15.3 gates
  remain undecided-in-code (authority was decided Session 1 closure,
  §15.4 — implementation is still open).
- No periodic session re-validation while the app is open —
  unchanged from Session 2, still Session 4's job.

## Open decisions requiring a human answer before Session 4

1. Is the full §6 role-permission matrix correct for a real lab/QA/
   regulatory/production workflow? Still Session 1's first draft, not
   domain-expert-reviewed. Session 3 adds one concrete sub-question:
   what should the System-Administration area actually contain (who
   may back up, restore, migrate, or relocate the data root)?
2. Final confirmation that Administrator should keep approval authority
   on both gates (currently yes, explicit and user-approved, unchanged
   this session, still worth reconfirming before Session 4 makes it
   load-bearing in real enforcement).
3. ~~§15.3's 4 workflow gaps~~ **RESOLVED in Session 1's closure**:
   approval authority for all four is `production_manager` (§15.4).
   They still have no `FormulaStatus` today — real future implementation
   work, sequencing TBD (Session 4 or a dedicated workflow session).
4. Is the final lockout/session policy (5 attempts / 15-minute lock /
   12h session / 60min idle, §17.1) right for real usage? Unchanged
   this session.

## Exact next session

**Phase 13 Session 4: application-wide server-side enforcement.** Every
Tauri command the privileged-command inventory (§9.2) flagged resolves
role from the authenticated session (never a caller-supplied value) and
calls `rolePolicy.ts`'s `can()` before acting; every nav/button uses the
same `can()`. Fixes the confirmed `save_approval_record` bypass and the
wider masterdata-CRUD gap. Drafts a System-Administration area in §6
before enforcing backup/restore/migration/data-location commands
against it. Begins real workflow-gate enforcement per §15 for gates
that already have a `FormulaStatus`; the §15.3 gaps stay their own
follow-up. Still no `Administration → Users` UI (Session 5).
