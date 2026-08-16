# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: SESSION 4 COMPLETE — Application-wide server-side authorization is real for the Session 3 privileged-command inventory's priority set. Every privileged command in that set now resolves role from the authenticated session (never a caller-supplied claim) and calls the canonical `role_policy::can()` before acting. The `save_approval_record` bypass is closed. Generic masterdata CRUD, audit attribution, attachments, and every System Administration command are gated. A new `systemAdministration` policy area exists. Commands outside the priority set are classified (not silently unreviewed), not enforced — Phase 13 is **not** fully secure yet; §9.3.10/Risks track exactly what remains. Full design: `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §9.3; test report: `docs/PHASE13_SECURITY_TEST_MATRIX.md` §J. Runs in parallel with Phase 12's still-open SignPath thread — unrelated.

## Session 4 summary

**One cross-layer policy contract, not two hand-typed matrices.**
`role_policy.rs` (Rust, new) holds no permission matrix or workflow-
transition graph of its own. `packages/shared/scripts/
generate-role-policy-matrix.ts` serializes `rolePolicy.ts`'s fully-
resolved `MATRIX` and `status.ts`'s `ALLOWED_NEXT` to two checked-in
JSON fixtures (`rolePolicyMatrix.generated.json`,
`formulaStatusTransitions.json`), which `role_policy.rs` reads via
`include_str!` — the exact mechanism Session 3's `roleVocabulary.json`
already established. Two new TypeScript parity tests
(`rolePolicy.matrixParity.test.ts`, `status.transitionParity.test.ts`)
fail loudly if the checked-in fixture and a fresh computation disagree.
Neither language holds a matrix the other doesn't provably agree with.

**A new `systemAdministration` policy area** — administrator-only,
since §6's original table had none and nothing in the approved
architecture names any other role for backup/restore/migration/
data-location authority.

**One reusable trusted backend guard, `authz.rs`** — session token ->
`validate_session` -> active account -> stored role ->
`role_policy::can()` -> allow/deny, with no role/userId/displayName
parameter anywhere for a caller to supply. Denials are audited using
the *resolved* trusted actor's real identity, never a caller's claim.
Fails closed at every step, matching `validate_session`'s existing
Session 2 semantics exactly.

**`save_approval_record`'s Session 0 bypass is closed**: role and
identity now come from the authenticated session, capability is
derived from `requestedStatus`/`decision`, and — the requirement the
session brief was explicit about — an "approved" decision also
requires the transition itself to be a real edge in the shared
`ALLOWED_NEXT` graph, so a manager with real approve authority still
cannot approve `concept -> pilot_approved` directly.

**Generic masterdata CRUD is domain-authorized.** All 90 allow-listed
collections are mapped to a `PolicyArea` (built from this file's own
domain-grouping doc comments and `dataExchangeRegistry.ts`'s existing
`targetCollection` groupings, not invented fresh); an unmapped
collection is a hard deny, and a test asserts 100% coverage. One
structural finding surfaced along the way: no role has `delete` in any
domain content area at all — only `projects`/`administrator` — so
`delete_master_record`/`delete_formulation` both gate against that
instead, a deliberate choice, not a workaround.

**Audit-actor spoofing is closed** for human-attributed events;
non-human `actorKind` values are left alone since they were never
identity-authoritative in the first place.

**System Administration commands are gated**: `create_backup`,
`restore_backup`, `create_pre_migration_backup`, all four
data-location-change commands, `write_automatic_backup_config`,
`apply_pre_migration_retention`. `run_automatic_backup` is deliberately
**not** gated — per explicit instruction, a non-admin's own configured
automatic backups must keep running unattended.

**Frontend**: `currentSessionToken()` (new) is the one accessor every
command wrapper's `call()` helper uses to attach the caller's bearer
token — added once per wrapper file, not at 26 individual call sites.
`SettingsPage.tsx`'s four System Administration cards are now hidden
for a non-administrator (`useTrustedActor()` + `can()`, UX only — the
backend was already authoritative). The 10 Session-3 role-selector
sites were re-audited; no new hardcoded-role site was found.

Rust: 281/281 (Session 3's 252 + 29 new), clippy clean. Shared:
1296/1296 (1291 + 5 new), tsc clean. Desktop: 1188/1188 (1185 + 3 new),
tsc clean, eslint clean — every pre-existing test that exercises a
now-token-carrying wrapper continued passing unchanged.

## Deliverables (this session)

- `apps/desktop/src-tauri/src/role_policy.rs` (new) — cross-language
  policy contract, no hand-typed matrix. 10 tests.
- `apps/desktop/src-tauri/src/authz.rs` (new) — the trusted backend
  guard. 8 tests.
- `packages/shared/scripts/generate-role-policy-matrix.ts` (new) +
  `packages/shared/src/engine/rolePolicyMatrix.generated.json` (new) +
  `packages/shared/src/engine/formulaStatusTransitions.json` (new).
- `packages/shared/src/engine/rolePolicy.ts` — new `systemAdministration`
  area, `fullMatrixSnapshot()` export.
- `packages/shared/src/schemas/status.ts` — `ALLOWED_NEXT` exported.
- `packages/shared/src/engine/rolePolicy.matrixParity.test.ts` (new, 3
  tests) + `packages/shared/src/schemas/status.transitionParity.test.ts`
  (new, 2 tests).
- `apps/desktop/src-tauri/src/formulations.rs` — `save_approval_record`
  role+transition+identity enforcement; formulation writes, drafts,
  delete, audit-event attribution, and every read gated. 7 new tests.
- `apps/desktop/src-tauri/src/masterdata.rs` — collection->area mapping
  (`area_for_collection`), upsert/delete/raw-write/backup/list gated.
  4 new tests.
- `apps/desktop/src-tauri/src/attachments.rs` — both commands gated.
- `apps/desktop/src-tauri/src/backup.rs`,
  `apps/desktop/src-tauri/src/migration.rs`,
  `apps/desktop/src-tauri/src/data_location_manager.rs`,
  `apps/desktop/src-tauri/src/automatic_backup.rs` — System
  Administration commands gated (`run_automatic_backup` deliberately
  not).
- `apps/desktop/src-tauri/src/lib.rs` — registers `mod authz;`/
  `mod role_policy;`.
- `apps/desktop/src/lib/sessionToken.ts` (new) — `currentSessionToken()`.
  3 tests.
- `apps/desktop/src/app/providers/AuthProvider.tsx` —
  `SESSION_TOKEN_KEY` exported.
- `apps/desktop/src/lib/formulations.ts`, `masterdata.ts`, `tauri.ts`,
  `migrationRunner.ts` — every changed command's wrapper now attaches
  the session token.
- `apps/desktop/src/app/routes/SettingsPage.tsx` — System
  Administration cards hidden for non-administrators.
- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — new §9.3 (11
  subsections: cross-layer contract, `systemAdministration` area, the
  guard, each closed gap, the classification table, frontend); §15.4
  Session 4 status note; §2/§25/Risks updated.
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` — B1-B3/C1-C6 corrected to
  factual reports; new §J.
- This handoff.
- External log:
  `C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md`,
  Session 4 entry appended.

## What Session 4 deliberately did NOT do

- Did **not** enforce every one of the 110 Session-3-inventoried
  commands — only the priority set §5 of the session brief named.
  Everything else is classified (§9.3.10's 5-category taxonomy:
  AUTHENTICATED_READ / TRUSTED_INTERNAL_ONLY /
  READ_ONLY_NO_ROLE_GATE_NEEDED / DEFERRED_WITH_REASON), not silently
  skipped — but classified is not the same as secured.
- Did **not** implement any of the four §15.3 workflow gates (raw-
  material verification, supplier-document verification, production-
  engineering handoff, production release) — no `FormulaStatus`, no
  gate command exists for any of them, exactly as before. Secured the
  underlying masterdata mutation boundary those gates will eventually
  sit in front of (§15.4's Session 4 status note), nothing more.
- Did **not** touch `Administration → Users` (Session 5), brute-force/
  lockout policy, or full audit-event coverage beyond the denial-event
  logging `authz.rs` itself adds.
- Did **not** add a TypeScript-side consumer of the masterdata
  collection->area mapping — it exists only in Rust, un-parity-tested
  against an equivalent TypeScript source (Risks item 12).
- Did **not** gate `resume_interrupted_data_move`,
  `materials::{import_materials, cost_formulation}`, or the
  formulation compute/generation commands — real, disclosed gaps
  (§9.3.10's DEFERRED_WITH_REASON row).

## Open decisions requiring a human answer before Session 5

1. Is the full §6 role-permission matrix correct for a real lab/QA/
   regulatory/production workflow? Now more urgent: Session 4 found
   enforcing it literally means only `researcher` can write formulation
   content and only `administrator` can delete anything. Confirm or
   correct before this becomes any more load-bearing.
2. Should any domain content area grant `delete` to a working-tier
   role directly, or should `projects`/`administrator`-only stay the
   permanent answer for destructive record deletion?
3. Is the masterdata collection->area mapping (§9.3.6, 90 collections)
   correct? First-draft judgment, same caveat as §6 itself.
4. §15.4's four Production Manager gates — authority decided, still
   entirely unimplemented. Sequencing (Session 5 or a dedicated
   workflow session) unchanged.
5. Does any automatic-backup class ever need administrator gating even
   when system-triggered? Not a known issue — `run_automatic_backup`
   is deliberately unauthenticated today per explicit instruction.

## Exact next session

**Phase 13 Session 5: `Administration → Users` UI** — list, create,
edit, role change, reset password, activate/disable, security-history
view, read-only role-capabilities view (rendered from `rolePolicy.ts`,
never a second hand-maintained display). Per the original plan's
shape, unchanged by this session. Session 4's residual gaps
(§9.3.10's DEFERRED_WITH_REASON row, the four §15.3 gates, the
masterdata mapping's missing TypeScript parity) remain open follow-up
work, not blockers to Session 5 specifically.
