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

## Session 1 (Free Open-Source Code-Signing Foundation): documentation + one line-scope fix

Certificate route decided (SignPath Foundation free OSS program, given by
the user — no paid alternative considered). Repository policy/privacy/
security documentation and the SignPath application dossier prepared. No
GitHub Actions workflow added or changed. Verification performed:

- `git diff --check` — clean.
- Version consistency re-checked: `package.json` (root),
  `apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml` all still
  agree at `0.4.0`.
- `bash -n scripts/dev/fetch-skills.sh` — clean, after correcting a
  factually wrong license comment (the only source-adjacent file this
  session touched; a comment-only change, no behavior change, so no
  broader test suite was required or run per this session's own
  instruction).
- Every eligibility claim in `docs/SIGNPATH_APPLICATION.md` and
  `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` §9 traced to a
  direct `gh api`/`grep`/`git shortlog`/`WebFetch` command run this
  session — including the real blocker found (`gh api
  repos/Sekiph82/FormuLab/releases` → `[]`) and the corrected license
  finding (`anthropics/skills`' per-skill `LICENSE.txt`, fetched and read
  directly, not assumed from a prior in-repo comment).
- Link check (manual, not automated — no link-checker tool exists in this
  repository yet): every cross-reference added this session
  (`README.md` → `SECURITY.md`/`docs/PRIVACY.md`/
  `docs/CODE_SIGNING_POLICY.md`; `SECURITY.md` → `docs/PRIVACY.md`/
  `docs/CODE_SIGNING_POLICY.md`; `docs/CODE_SIGNING_POLICY.md` →
  `docs/SIGNPATH_APPLICATION.md`) confirmed to point at a file that
  actually exists in this commit.

## Session 2 (Complete Previous-Identity Eradication and Native FormuLab Skill Migration): closure-style full verification

Not a normal proportional-scope implementation session — touched shared/
first-party source across the whole tree (legacy `localStorage`
migration removal in `store.ts`/`modelPreferences.ts`/`i18n/config.ts`,
8-locale i18n string changes, a CI workflow edit, a fetch-script edit),
so this session ran the full closure verification early rather than
deferring it to Session 13:

- Focused tests immediately after each active-source edit:
  `store.test.ts` (6), `i18n/config.test.ts` (10),
  `modelPreferences.test.ts` (4) — **20/20 passing**. i18n parity
  **23/23**. Help registry **38/38** (both re-run after the skills-pack
  description string changed in all 8 locales).
- Desktop typecheck: clean. Desktop lint: clean. `bash -n` clean on both
  changed shell scripts (`fetch-skills.sh`, and `fetch-goal-plugin.sh`
  before its deletion).
- Clean rebuild: `node_modules` + `apps/desktop/src-tauri/target` removed
  entirely; fresh `pnpm install`; fresh `cargo test --lib` (full Rust
  suite); `cargo clippy --lib`; full desktop suite
  (`pnpm vitest run`); shared package suite; a clean Windows release
  build (`pnpm tauri build`); native launch verified via the desktop
  shortcut.
- Final exhaustive scan: case-insensitive search for the previous
  project identity's token across the entire working tree including the
  freshly generated `node_modules`, `target`, and release artifacts,
  excluding only `.git` — see `docs/handoffs/PHASE12_CURRENT.md`'s final
  scan section for the result.
- `git diff --check`: clean.

**Correction (Session 2A): this closure was genuinely incomplete.** The
scan above still returned 18 byte-level matches (17 inside third-party
`.js.map` source maps, 1 inside the NSIS installer's compressed payload),
accepted at the time as "coincidental" — the user's own standard for
this project does not accept that classification as a substitute for a
literal zero result. Separately, the full desktop suite in that closure
run passed all assertions but the **test process itself exited 1**, also
wrongly accepted as pre-existing/unrelated. Neither was a true closure.
See Session 2A below for the real fix to both.

## Session 2A (Identity-Eradication Closure Corrections): the actual closure

Bounded correction session, not a new implementation session — no
product features touched. Reused Session 2's own closure-style
verification discipline (full regression, not proportional/targeted),
since it was correcting that same closure's shortfall.

- **Source-map matches (17 of 18)**: traced to 7 npm packages
  (`@babel/parser`, `@dimforge/rapier3d-compat`, `@remix-run/router`,
  `docx-preview`, `exceljs`, `pdf-lib`, `xlsx`) each shipping a `.js.map`
  file with a coincidental byte match in its encoded mapping data. Fixed
  by removing sourcemaps from all 7 via reproducible mechanisms (6 via
  `pnpm patch`/`pnpm.patchedDependencies`; 1 — `xlsx`, a tarball-URL
  dependency `pnpm patch` cannot resolve — via a `postinstall` script),
  not by editing the encoded source maps themselves. Verified clean
  against each package's actual resolved/symlinked install path.
- **NSIS installer match (1 of 18)**: required a clean rebuild
  (`apps/desktop/src-tauri/target` removed and recompiled) to test
  whether it reappears — see the final scan result in
  `docs/handoffs/PHASE12_CURRENT.md` for the outcome.
- **Desktop-suite exit code**: two real unhandled-promise-rejection root
  causes fixed — `HomePage.tsx`'s missing `.catch()` (application-code
  fix) and a jsdom/undici `AbortSignal` cross-realm artifact inside
  `@remix-run/router`'s internals (narrow, disclosed
  `process.on("unhandledRejection", ...)` filter in
  `apps/desktop/src/test/setup.ts` that reports anything not matching the
  one known signature exactly as Vitest itself would). Confirmed
  `fileParallelism: false` (Phase 11 Session 10) still present and still
  necessary — a different problem than these two, not a duplicate fix.
- Full regression re-run clean: Rust **180/180**, `cargo clippy --lib`
  clean, shared suite **61/61 files, 1251/1251 tests**, full desktop
  suite **130/130 files, 1161/1161 tests, exit code 0** (confirmed via
  shell `$?`, not the printed summary alone), typecheck clean, lint
  clean, i18n parity **23/23**, Help registry **38/38 + 9/9**.
- Clean Windows release rebuild and native launch verification, and the
  final exhaustive whole-tree scan (filenames + text + raw bytes,
  including fresh `node_modules`/`target`/release artifacts, excluding
  only `.git`): see `docs/handoffs/PHASE12_CURRENT.md`'s "Final scan
  result (Session 2A)" section for the literal, unqualified result.

**Correction: the bullets above describe this session's *first* pass,
which was itself still incomplete.** Verifying each patched package's
"resolved/symlinked install path" (as done above) is not the same as a
literal, resolution-independent whole-tree scan — `pnpm patch-commit`
leaves the original *unpatched* package extraction physically present
on disk (`node_modules/.pnpm/<pkg>@<version>/`), and a literal scan
still counts it. Running that literal scan for real found **57
byte-level matches**, not zero: the 35 orphaned-copy matches above, plus
a ~165 MB dead-but-still-fetched OpenCode sidecar binary (10 matches,
counted twice via a pnpm workspace symlink = 20), a stale local
`aider`-tool cache (1), and one self-referential match in
`docs/handoffs/PHASE12_CURRENT.md` itself (1). The real fix: a full
`node_modules` wipe + fresh `pnpm install` (eliminating orphaned copies
entirely), deleting the dead OpenCode binary/fetch script/CI step (with
source-level confirmation it is genuinely unreferenced, not merely
unused this session), deleting the stale cache, and rewording the
self-referential doc line. **The literal final scan, re-run after all
of this, returned `TOTAL BYTE-LEVEL OCCURRENCES: 0`** — see
`docs/handoffs/PHASE12_CURRENT.md`'s "Final scan result (Session 2A)"
for the full breakdown and the literal command output.

Separately, the `node_modules` wipe this correction required surfaced
**2 additional, genuinely pre-existing test failures** —
`migrationRunner.test.ts` and `automaticBackup.test.ts` — caused by a
real `vitest@2.1.9`/`chai@5.3.3` compatibility defect in
`.rejects.toThrow(pattern)` (already discovered once before in this
codebase, per `download.test.ts`'s own inline comment; fixed here using
that same established `.rejects.toThrow(Error)` + manual try/catch
convention). Full desktop suite, re-run a third time after this fix:
**130/130 files, 1161/1161 tests, exit code 0**, genuinely clean.

### Follow-up within Session 2A: OpenCode UI/i18n staleness — fixed

Session 2A's own final scan disclosed FormuLab's Settings UI and i18n
strings still describing OpenCode as bundled/live, flagged as a
deliberately-unfixed, out-of-scope finding. The user asked for it to be
fixed before Session 3, so it was fixed within this same Session 2A.
Investigation found the real scope was larger than the original
disclosure: not just Settings-page copy, but entire dead, unreferenced
i18n namespaces across all 8 locales (`settings.json`'s `page`/
`runtime`/`providers`/`mcp` objects plus two `toast.*` keys,
`pages.json`'s `skills` object, `session.json`'s `live` object) —
confirmed via exhaustive grep across `apps/desktop/src` that zero live
components consume any of them. Deleted identically across all 8
locales; removed the dead `OpenCodeCredentials` TS interface; corrected
`SettingsPage.tsx`'s misleading top comment and a stale test-setup
comment. Focused tests (i18n config/parity/format/index,
`SettingsPage.i18n.test.tsx`, `thread.i18n.test.tsx`, help registry,
tours, `tauri.test.ts`): **9 files, 93 tests, exit 0**. i18n parity,
re-run standalone: **23/23**. Typecheck/lint: clean. Full desktop suite,
re-run again as a regression check: **130/130 files, 1161/1161 tests,
exit code 0**. Whole-tree identity scan, re-run per the user's explicit
instruction after these text changes: `TOTAL BYTE-LEVEL OCCURRENCES: 0`.

## Planned per-session test discipline (Sessions 3-12, proportional)

Renumbered in Session 2 to insert the previous-identity-eradication session ahead of
the first public release. Each implementation session runs targeted
tests for what it touched, matching `AGENTS.md`'s "targeted tests during
implementation sessions, full regression only in closure sessions"
convention — the same discipline Phase 11 Sessions 1-9 followed.
Concrete expectations, set now so each session has a checkable bar
without re-deriving it:

- **Session 3 (First Public Release Publication)**: no application test
  changes expected — this session only runs the existing, never-yet-run
  `build.yml` pipeline against a real tag. Verification is the published
  release existing and its artifacts matching what local `pnpm tauri
  build` output looks like, not a Vitest/Rust test.
- **Session 4 (SignPath Application and Approval Gate)**: no tests — an
  external review-and-wait session.
- **Session 5 (Signing wired for real)**: `signtool verify`/SignPath's
  own verification succeeding in CI on a real signed artifact, not a
  Vitest/Rust test.
- **Session 6 (Signed update manifest + updater plugin wiring)**: new
  Rust tests for the extended `ReleaseMetadata` fields (channel,
  `minSchemaSupported`, signature/SHA256 presence validation) mirroring
  Phase 11 Session 9's own `updates.rs` test style exactly (one fixture +
  one assertion per rejection reason); new `update.test.ts` tests for
  manifest parsing.
- **Session 7 (Secure download/verify/install)**: HTTPS redirect-target
  validation tests (mirroring `is_https_url`'s existing test style);
  restart-flag/first-run-marker tests.
- **Session 8 (Mandatory pre-update backup + update journal)**: new
  Rust tests for the `"preUpdate"` backup class and `update_journal.jsonl`
  read/write/interrupted-detection, mirroring `migration.rs`'s and
  `data_location_manager.rs`'s own existing journal test patterns
  directly (same fixture style: synthetic temp directories only, no real
  data).
- **Session 9 (Startup health check + rollback trigger/execution)**: a
  pure `resume_decision`-style function for rollback state, directly
  unit-tested without an `AppHandle`, matching
  `data_location_manager.rs::resume_decision`'s own precedent exactly.
- **Session 10 (Rollback retention + limits + recovery UI)**: retention
  tests mirroring `automatic_backup.rs::apply_retention`'s existing
  "never deletes the last valid one, even at a configured floor" test
  directly; new `*Card.test.tsx` tests for the recovery UI.
- **Session 11 (Channels + staged rollout + eligibility)**: pure-function
  tests for `shouldReceiveRollout`, schema-compatibility gating, and
  downgrade-prevention-via-manifest-freshness — mirroring
  `isNewerVersion`/`shouldAutoCheck`'s existing pure-function test style.
- **Session 12 (CI/CD release automation closure)**: a real dry-run tag
  push against a test/scratch release, not a Vitest/Rust suite.
- **Session 13 (Commercial Release Closure and Verification)**: full
  regression — full Rust suite, full desktop suite, full shared suite,
  typecheck, lint, i18n parity, help registry — matching Phase 11 Stage 1
  and Stage 2 Closure's own precedent exactly, plus this phase's own
  closure-specific verification: a real signed release
  (`Get-AuthenticodeSignature` = `Valid`), a verified in-app update
  install, a verified automatic rollback (deliberately induced failure),
  and a final clean-machine Windows installation test.

## What no session before Session 13 runs

Per this phase's own scope (mirroring Phase 11's identical discipline):
no session before the closure session runs the full desktop suite, full
shared suite, full Rust suite, typecheck, lint, release build, or
installer build as a matter of course — each runs targeted tests for
what it touched, with full regression and native/signed verification
reserved for Session 13. (Session 2 is a disclosed exception, above —
it ran the full verification early because its changes crossed the
whole tree.)
