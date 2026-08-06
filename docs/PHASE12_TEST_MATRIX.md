# Phase 12 Test Matrix

Session 0 (assessment and architecture only — no tests were run or
written this session, per its explicit "no broad test suite ... unless
source code is changed accidentally" instruction). This matrix records
Session 0's actual verification steps and sets the proportional test
plan each future implementation session is expected to commit to,
against this repository's real, confirmed test conventions (see
`docs/PHASE11_TEST_MATRIX.md`'s own "Confirmed test conventions" section
— unchanged, re-confirmed by this session's own inspection, not
re-derived here).

## Session 0 (this session): documentation validation only

No source code was changed. Verification performed:

- `git diff --check` — clean, no whitespace-conflict markers introduced
  by any of this session's doc edits.
- Every evidenced claim in
  `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` traced to a
  direct `grep`/`find`/`cat`/`curl` command run this session — no
  inferred or assumed Tauri updater behavior (the session's own explicit
  requirement); see that document's §1 for the exact evidence per
  finding.
- No full desktop/shared/Rust suite, no typecheck, no lint, no
  release/installer build was run as new work this session — Phase 11
  Stage 2's own same-day closure build (`formulab.exe`/MSI/NSIS,
  `Get-AuthenticodeSignature` confirmed `NotSigned` on all three) was
  inspected as evidence, not rebuilt.

## Planned per-session test discipline (Sessions 1-8, proportional)

Each implementation session runs targeted tests for what it touched,
matching `AGENTS.md`'s "targeted tests during implementation sessions,
full regression only in closure sessions" convention — the same
discipline Phase 11 Sessions 1-9 followed. Concrete expectations, set
now so each session has a checkable bar without re-deriving it:

- **Session 1 (Code-Signing Foundation)**: no application test changes
  expected (CI-workflow-only); verification is `signtool verify`/
  provider-equivalent succeeding in CI on a real signed artifact, not a
  Vitest/Rust test.
- **Session 2 (Signed update manifest + updater plugin wiring)**: new
  Rust tests for the extended `ReleaseMetadata` fields (channel,
  `minSchemaSupported`, signature/SHA256 presence validation) mirroring
  Phase 11 Session 9's own `updates.rs` test style exactly (one fixture +
  one assertion per rejection reason); new `update.test.ts` tests for
  manifest parsing.
- **Session 3 (Secure download/verify/install)**: HTTPS redirect-target
  validation tests (mirroring `is_https_url`'s existing test style);
  restart-flag/first-run-marker tests.
- **Session 4 (Mandatory pre-update backup + update journal)**: new
  Rust tests for the `"preUpdate"` backup class and `update_journal.jsonl`
  read/write/interrupted-detection, mirroring `migration.rs`'s and
  `data_location_manager.rs`'s own existing journal test patterns
  directly (same fixture style: synthetic temp directories only, no real
  data).
- **Session 5 (Startup health check + rollback trigger/execution)**: a
  pure `resume_decision`-style function for rollback state, directly
  unit-tested without an `AppHandle`, matching
  `data_location_manager.rs::resume_decision`'s own precedent exactly.
- **Session 6 (Rollback retention + limits + recovery UI)**: retention
  tests mirroring `automatic_backup.rs::apply_retention`'s existing
  "never deletes the last valid one, even at a configured floor" test
  directly; new `*Card.test.tsx` tests for the recovery UI.
- **Session 7 (Channels + staged rollout + eligibility)**: pure-function
  tests for `shouldReceiveRollout`, schema-compatibility gating, and
  downgrade-prevention-via-manifest-freshness — mirroring
  `isNewerVersion`/`shouldAutoCheck`'s existing pure-function test style.
- **Session 8 (CI/CD release automation closure)**: a real dry-run tag
  push against a test/scratch release, not a Vitest/Rust suite.
- **Session 9 (Commercial Release Closure and Verification)**: full
  regression — full Rust suite, full desktop suite, full shared suite,
  typecheck, lint, i18n parity, help registry — matching Phase 11 Stage 1
  and Stage 2 Closure's own precedent exactly, plus this phase's own
  closure-specific verification: a real signed release
  (`Get-AuthenticodeSignature` = `Valid`), a verified in-app update
  install, a verified automatic rollback (deliberately induced failure),
  and a final clean-machine Windows installation test.

## What no session before Session 9 runs

Per this phase's own scope (mirroring Phase 11's identical discipline):
no session before the closure session runs the full desktop suite, full
shared suite, full Rust suite, typecheck, lint, release build, or
installer build as a matter of course — each runs targeted tests for
what it touched, with full regression and native/signed verification
reserved for Session 9.
