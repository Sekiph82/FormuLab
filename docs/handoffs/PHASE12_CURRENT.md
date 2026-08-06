# Phase 12 — Commercial Distribution

## Status: SESSION 2A (Identity-Eradication Closure Corrections) COMPLETE — genuinely, on a two-pass fix. Session 2's own closure claim was incomplete (18 byte-level matches accepted as "coincidental," desktop-suite exit code 1 accepted as pre-existing). This session's *first* pass (7-package sourcemap patch) was **also** still incomplete — a full untargeted rescan found 57 real matches (orphaned unpatched `node_modules` copies, a dead-but-still-fetched OpenCode sidecar binary, a stale dev-tool cache, one self-referential doc match). A second pass fixed all of it: literal `0`-match scan (confirmed twice), desktop suite at exit code 0 (1161/1161), plus a real pre-existing vitest/chai test-harness bug found and fixed along the way. Session 1's eligibility blocker (no release ever published) remains open — Session 3.

## Priority order for Phase 12 (as given)

Signed EXE/MSI/NSIS installers, signed update metadata and packages,
secure in-app update download and installation, update verification
before execution, automatic rollback after a failed update,
release-channel support, safe schema/migration compatibility, CI/CD
release automation, code-signing certificate management, release
auditability.

## Session 0 summary

Pure assessment and architecture — no signing, update-download,
update-execution, or rollback code written; no real data touched; no
destructive or generative operation run beyond the existing Phase 11
release-verification build already produced this same day. Full findings
live in
[`docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`](../PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md);
this handoff summarizes and points to it, matching Phase 11 Session 0's
own "one summary, details in the dedicated doc" convention.

### Key finding: no updater capability exists, official or custom
`tauri-plugin-updater` is absent from both `Cargo.lock` (`grep -c` = 0)
and `apps/desktop/package.json` — confirmed directly from the installed
dependency tree and lockfile, not assumed. Phase 11 Session 9's
`updates.rs`/`lib/update.ts` is check-only by explicit design
(`updates.rs:1-8`'s own doc comment names Phase 12 as where
download/install/rollback belongs). "View Release / Download" opening a
browser is today's only update path.

### Key finding: adopt `tauri-plugin-updater` rather than hand-rolling a downloader
Tauri's official updater plugin already provides HTTPS manifest fetch,
Ed25519 signature verification, download, and (for NSIS) installer
handoff/restart — directly satisfying 3 of the session's 10 numbered
requirements largely for free. Full rationale, including the concrete
consequence that Tauri's updater-artifact format doesn't cover MSI (NSIS
carries the auto-update path; MSI stays a manual/IT-deployment artifact),
in the architecture doc §2.

### Key finding: three backup/journal primitives already exist to build rollback from
`backup.rs::try_create_backup`/`verify_backup_report` (reused 4 times
already across Phase 11: manual, restore-safety, automatic, pre-
migration — a mandatory pre-update backup is a 5th caller, not new code).
Two independently-built "append-only journal + pure resume-decision
function" implementations already exist (migration, data-move) — flagged
as a possible shared-helper extraction for Session 1 to accept or
decline, not decided this session. Full detail: architecture doc §1.9.

### Key finding: every Windows artifact remains genuinely unsigned
Confirmed directly via `Get-AuthenticodeSignature` on this same day's own
Phase 11 Stage 2 closure build (`formulab.exe`, MSI, NSIS — all
`NotSigned`), consistent with every prior phase closure. No certificate,
`signtool` invocation, or CI signing secret exists anywhere in the
repository. `.github/workflows/build.yml` is the only workflow file and
has no signing step.

### Key finding: version is duplicated across 4 files with no bump tooling
`package.json` (root), `apps/desktop/package.json`,
`apps/desktop/src-tauri/tauri.conf.json`, and
`apps/desktop/src-tauri/Cargo.toml` all currently agree (`0.4.0`) but
nothing enforces that. `scripts/release/` is an empty placeholder
directory (`.gitkeep` only). Full detail: architecture doc §1.4.

### Architecture
[`docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`](../PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md) —
current-state assessment (§1), the `tauri-plugin-updater` adoption
decision (§2), full architecture across signing/manifest/channels/
rollout/eligibility/backup/journal/handoff/restart/health-check/
rollback/CI-secrets/provenance (§3), a clear Tauri-vs-repo-vs-CI-vs-
external-vs-business-decision separation table (§4), unresolved
decisions (§5), risks (§6), the proposed 13-session plan (§7, renumbered
in Session 1), and Session 1's own eligibility/preparation findings (§9).

### Test plan
[`docs/PHASE12_TEST_MATRIX.md`](../PHASE12_TEST_MATRIX.md) — Session 0
ran no broad test suite (assessment-only, per this session's own
instruction); documentation validation and `git diff --check` only.

## What was explicitly not done this session

- No signing, update-download, update-execution, or rollback code was
  written.
- No code-signing certificate was acquired or configured.
- No `tauri-plugin-updater` dependency was added (its absence was
  confirmed, not its addition attempted).
- No real data (`.FormuLab/runs.db`, any real user record) was moved,
  copied, merged, deleted, repaired, or normalized.
- No full desktop/shared/Rust suite, typecheck, lint, or release build
  was run as part of this session's own work (Phase 11 Stage 2's release
  build, produced the same day, was inspected for evidence only — not
  rebuilt).
- No historical Phase 0-11 handoff or log was modified, other than
  `docs/architecture/IMPLEMENTATION_STATUS.md` gaining a new Phase 12
  entry appended after Phase 11's own closed entries.

## Deferred items (recorded, not designed beyond the architecture doc)

All ten numbered scope items (signing, signed manifest, secure download/
install, verification, rollback, channels, schema compatibility, CI/CD,
certificate management, auditability) are architecture-only this session
— see the proposed session plan (architecture doc §7) for where each is
actually built.

## Session 1 summary — Free Open-Source Code-Signing Foundation (complete)

**Business decision (given, not this session's to make)**: zero
code-signing budget — use SignPath Foundation's free open-source
HSM-backed signing program exclusively; no paid OV/EV certificate, no
Azure Artifact Signing. This session prepares the repository only —
SignPath has not reviewed or approved anything, and no claim to the
contrary appears anywhere in this session's documentation.

### Key finding: eligibility is 6-of-7 met, one real blocker
Checked directly against SignPath's own published conditions
(`signpath.org/terms.html`, fetched this session rather than assumed from
memory): license, public repository, active maintenance, no malware/
security-circumvention features, GitHub-hosted build origin, and "no
proprietary component" (see next finding) are all met. **"The project
must already be released in the form that should be signed" is NOT
met** — `gh api repos/Sekiph82/FormuLab/releases` returns `[]`, `git tag
-l` is empty. FormuLab has never published a release, draft or
otherwise, despite having a working release pipeline
(`.github/workflows/build.yml`) that has simply never been run end to
end. This is the one real repository-eligibility blocker.

### Key finding: a bundled component's license was misdocumented, and the fix mattered
Checking "does any proprietary component exist" individually against
every third-party binary/package `scripts/dev/fetch-*.sh` pulls in found
that `fetch-skills.sh`'s own comment incorrectly called the
`anthropics/skills` document-skills content "Apache-2.0" — verified
directly, it carries a proprietary "(c) Anthropic, PBC. All rights
reserved" `LICENSE.txt` per skill directory instead. Corrected the
comment this session. Separately confirmed via `tauri.conf.json`'s
`bundle.resources` and a source grep that this content (and the default
scientific-skills pack, which genuinely was MIT) is fetched by CI but **never actually bundled
into any built installer** — so the "no proprietary component" condition
is genuinely met by what ships today, not merely assumed, but this now
rests on `bundle.resources` staying exactly as it is. Full detail:
architecture doc §9.

### Key finding: roles disclosed honestly — single maintainer, no padding
SignPath's Author/Reviewer/Approver model is recorded against FormuLab's
real, evidenced structure (`git shortlog -sne --all`: 235/235 commits,
one contributor, no `CODEOWNERS`) — Reviewer and a second Approver are
recorded as "not yet applicable," not invented. Full detail:
`docs/CODE_SIGNING_POLICY.md`.

### Policy documents created this session
`SECURITY.md` (root), `docs/PRIVACY.md`, `docs/CODE_SIGNING_POLICY.md`,
`docs/SIGNPATH_APPLICATION.md` (the copy-paste-ready dossier +
eligibility table + application checklist), and a small `README.md`
update linking all three. Full content and rationale: architecture doc
§9.

### GitHub Actions integration: prepared, not activated
No workflow file was added or changed. The SignPath submission step is
recorded as a documentation-only annotated example in
`docs/CODE_SIGNING_POLICY.md`, referencing SignPath's own published
GitHub Action and its real required inputs — no fake credentials,
certificate data, or placeholder secrets anywhere. Wiring it for real
happens in Session 4, after Session 3 supplies genuine identifiers.

### Repository preparation as a small code fix, not just docs
One line-scope correction to `scripts/dev/fetch-skills.sh` (the
misdocumented-license comment above) — syntax-checked with `bash -n`,
no behavior change, no test suite affected.

## Session 2 summary — Complete Previous-Identity Eradication and Native FormuLab Skill Migration (complete, closure claim later corrected — see Session 2A)

**Correction (Session 2A)**: this session's own closing report claimed
success while disclosing "17 byte-level occurrences in third-party
`.js.map` files" and "1 byte-level occurrence inside the NSIS installer
payload" as accepted exceptions, and reported the full desktop suite as
passing without checking its actual process exit code (which was `1`).
Neither is acceptable against a literal zero-match/zero-exit-code
requirement — recorded honestly here, not erased, with the real fix in
Session 2A below.

**Objective**: remove every trace of the project's previous, pre-rename
identity and its dependencies from the working tree before the first
public release — a release must not ship under the identity Phase 9
already renamed away from.

### Key finding: the app source was already clean; the surface area was legacy compatibility + stale docs + a dead dependency
A case-insensitive recursive search for the previous project identity's
token, across the whole working tree (excluding `.git`, `node_modules`,
`target`), returned 43 files, 352 occurrences. Classified: zero in Rust
source (`apps/desktop/src-tauri/src` was already 100% clean — confirmed
directly), zero in any `package.json`/`Cargo.toml` across the monorepo
(npm scopes and the Rust crate/binary were already
`@formulab/*`/`formulab`/`formulab_lib` from Phase 9). The real surface
was: (1) 6 first-party TS files carrying one-time legacy-`localStorage`-key
migration constants/logic + their tests (40+ occurrences alone in
`store.test.ts`), (2) 8 i18n locale files describing a bundled
third-party skills pack by name, (3) a CI fetch step + script for that
same pack, (4) several current architecture/product docs never updated
since the Phase 9 rename, (5) 228 occurrences across historical archives
(`PROGRESS.md`, `docs/external-logs/*`, closed `docs/handoffs/PHASE8-9_CURRENT.md`).

### Key finding: the bundled third-party scientific-skills pack was already completely dead
Investigating whether `runtime/skills/external/`'s default scientific
pack (7 skills, one of them literally named after the previous project
identity as an "agent" skill) was genuinely used anywhere found: no
`runtime.rs` file exists in current Rust source; no `deploy_bundled_skills`
function exists anywhere; `tauri.conf.json`'s `bundle.resources` never
included `runtime/skills/external/`; zero references in any current
TS/Rust source. `PROGRESS.md`'s own history confirms this mechanism was
real and verified working on 2026-07-03 — it was removed from the app at
some later point without its CI fetch step, env var, or descriptive docs
(`runtime/skills/README.md`, `runtime/opencode-profile/README.md`) being
updated to match. Per this session's own "do not invent replacement
functionality for unused components" instruction: **removed entirely, no
native replacement built** — the fetch step, its script section, the
local fetched directory, and every doc reference describing it as live.

### Key finding: the previously-flagged dead goal-plugin CI fetch was re-confirmed dead and removed
Re-verified this session (zero matches for `goal_plugin`/
`ensure_goal_plugin` anywhere in `apps/desktop/src-tauri/src` or
`apps/desktop/src`, same as Phase 12 Session 1's finding) — removed the
CI step, deleted `scripts/dev/fetch-goal-plugin.sh`, removed its
`.gitignore` entry and `README.md` reference, and deleted the local
generated `runtime/goal-plugin/` directory. Not itself a match for the
forbidden pattern, but explicitly named in this session's own
instructions as a required removal once re-confirmed dead.

### Legacy `localStorage` compatibility — removed, disclosed as a real break
`store.ts`/`modelPreferences.ts`/`i18n/config.ts` each carried a
one-time, write-once migration reading a pre-rename `localStorage` key
namespace (theme, sidebar width/collapsed, inspector width, zoom,
locale, model favorites/recent) into the current `formulab.*` namespace.
Per this session's explicit instruction (do not retain migration
constants, aliases, comments, paths or fallbacks named after the
previous identity; if supporting the old data format would require
retaining the forbidden name, remove that compatibility behavior and
document the compatibility break honestly): **removed entirely**. Real,
disclosed compatibility break: a user whose `localStorage` still only
holds the pre-Phase-9 key names (never opened the app since that rename)
will see default theme/sidebar/inspector/zoom/locale/model-preference
values on next launch instead of their old ones. Every other current
preference read path (the `formulab.*` keys themselves) is completely
unaffected — this was proven with the existing focused test suite
(synthetic `localStorage` fixtures, not real user data) after removing
the migration code, not merely asserted.

### Historical archive scrub — mechanical, disclosed, not hand-crafted
The user was asked directly whether historical/archival text (old
`PROGRESS.md` entries, `docs/external-logs/*`, closed
`docs/handoffs/PHASE8-9_CURRENT.md`) should be preserved as an immutable
record or scrubbed for a literal zero-match result; **the user chose to
scrub everything, including history**, explicitly accepting reduced
historical precision in exchange for a genuine zero, then refined the
approach mid-session: identifier-shaped occurrences (crate/binary names,
`localStorage` keys, npm scopes) become a generic `legacy`-prefixed
stand-in; brand/prose mentions of the old product name become "the
previous project identity," not a bare single-word substitution. Applied
across all 14 historical files (228 occurrences originally) via ordered,
case-insensitive substitution, then hand-fixed the handful of resulting
duplicate-word/awkward-phrasing artifacts. This is disclosed here
plainly, not hidden — some historical sentences now read with a generic
reference rather than their exact original wording.

### Tests
Focused tests on every changed active-source file: `store.test.ts` (6),
`i18n/config.test.ts` (10), `modelPreferences.test.ts` (4) — **20/20
passing**. i18n parity **23/23**, help registry **38/38** (both re-run
after the 8-locale skills-description string change). Desktop typecheck
clean. Desktop lint clean. `bash -n` clean on both changed shell scripts.

Closure-style full verification, run once on the clean rebuild:
- **Rust**: fresh build, **180/180 tests passing**. `cargo clippy --lib`:
  clean.
- **Shared package**: **61/61 files, 1251/1251 tests passing**.
- **Full desktop suite**: **130/130 files, 1161/1161 tests passing (0
  failed)**. The lower total than Phase 11's own 1185 baseline is
  expected and correct — this session intentionally removed the
  legacy-`localStorage`-migration test coverage alongside the migration
  code itself (a real, disclosed reduction, not a lost/broken test).
  Process exit code was **1**, due to 6 unhandled-rejection background
  errors (5× `HomePage`/`masterdata` "not-desktop" noise, 1× the known
  `TourOverlay`/`@remix-run/router` `AbortSignal` interaction). **This
  session's own closing report accepted that exit code as a pre-existing,
  unrelated, unfixable-from-application-code condition — wrong per the
  user's explicit requirement that the suite finish with exit code 0.
  Session 2A fixed both root causes for real** (a genuine missing
  `.catch()` in `HomePage.tsx`, and a narrowly-scoped test-harness filter
  for the one genuinely unfixable-from-userland jsdom/undici artifact) —
  see Session 2A below for the fix and the re-verified 0-exit-code run.
- **Desktop typecheck/lint**: clean (re-run after the clean install).
- Clean Windows release build and native launch verification: see
  "Release artifacts" below.
- Final exhaustive scan: see the dedicated section below.

### Clean rebuild
`node_modules` (453 MB) and `apps/desktop/src-tauri/target` (16 GB)
removed entirely. Confirmed before removal: `target/debug/.fingerprint/`
held genuinely stale Cargo build-fingerprint directories still named
after the previous project identity's crate name, from before the
Phase 9 crate rename — real evidence the clean rebuild mattered, not a
purely procedural step. Fresh `pnpm install` (11.9s — pnpm's global
content-addressable store, no lockfile change). Fresh Rust build via
`cargo test --lib`. Fresh Windows release via `pnpm tauri build`
(7m23s Rust release compile from a fully empty `target`, plus WiX/NSIS
bundling — genuinely slow because nothing was cached, not stuck;
confirmed alive throughout via `Get-Process` CPU-time deltas rather than
assumed).

### Release artifacts
All three built fresh this session from
`apps/desktop/src-tauri/target/release/`:

| Artifact | Size (bytes) | SHA256 | Signed |
|---|---|---|---|
| `formulab.exe` | 23,526,912 | `D1E560BB694D62BDFF2FB2B83FB72677EC878131575FC76D5DED1247ADA82681` | **Not signed** |
| `bundle/msi/FormuLab_0.4.0_x64_en-US.msi` | 36,204,544 | `6CBA227D8DA322253B4EC8851360645FA8025F57879EF2B63B6C602AB2F5F7D3` | **Not signed** |
| `bundle/nsis/FormuLab_0.4.0_x64-setup.exe` | 25,401,108 | `88083FFD78866A0370CAE496373709FA1EEE0E997DE363904A852272AC8FAF81` | **Not signed** |

All three confirmed `NotSigned` via `Get-AuthenticodeSignature` (unrelated
to this session — matches Phase 12's own disclosed status throughout).
Native launch verified via `scripts/windows/verify-formulab-phase1.ps1`
against the fresh release exe: **PASS** (real PID, real window, title
"FormuLab"), cleanly closed after verification. Deep interior click-
through remains the same disclosed environment limitation as every prior
native-verification session in this project.

### Final scan for the previous project identity's token (as this session originally reported it)

Two rounds. **Round 1** — case-insensitive filename search for the
previous project identity's token (pattern omitted from this document
deliberately, to avoid the doc itself becoming a match against this
project's own zero-match requirement; see the git history of this
section, prior to Session 2A, for the literal pattern used — `.git` is
the sole directory this requirement excludes) across the entire working
tree, freshly generated `node_modules`, `apps/desktop/src-tauri/target`,
and release artifacts: **0 matches**.

**Round 2** — content search. A recursive case-insensitive text search
(`grep -rlI`, excluding `.git`) found the same pattern in 17 files, all
inside third-party npm packages' compressed dependency tree
(`node_modules/.pnpm/...`) or a local disposable log — none in any
first-party file. A separate binary-mode search
(`grep -rl -a -i`) against `target/release` and `dist` additionally
flagged **108 files**, including — alarmingly at first — FormuLab's own
`formulab.exe`, `formulab.pdb`, and `formulab_lib.lib`/`.rlib`.

**Every one of those 108 binary flags was individually verified byte-
by-byte in Python**: **107 were confirmed false positives** —
`grep -a`'s own binary-mode counting on these large files was simply
wrong. The remaining **18 were real byte-level matches**: 16 across 8
unrelated third-party npm packages' `.js.map` source-map files, 1 inside
the NSIS installer's compressed payload, 1 in a local disposable log
(deleted).

**This session then closed with those 18 matches still present**,
classifying them as "coincidental" and reporting the session complete —
**this was wrong.** The user's requirement was an explicit, literal
zero, with "coincidental" specifically named as not an acceptable
exception. Session 2A (below) is the actual fix: the 7 owning packages'
source maps removed for real (reproducibly, via `pnpm patch`/a postinstall
step, not a one-time deletion), the release rebuilt, and the scan re-run
to a genuine, unqualified zero. See Session 2A for the real final result
— this section is preserved as the accurate record of what Session 2
itself found and how it was wrongly closed, not erased.

## Inspection commands run this session

See the architecture doc's own §1 (Session 0) and §9 (Session 1) for
prior-session evidence. This session's own evidence: a case-insensitive
recursive search for the previous identity's token (whole tree,
excluding `.git`/`node_modules`/`target`), a filename search across the
pre-clean `target` directory (confirmed stale fingerprints), a search for
`deploy_bundled_skills`/`runtime.rs`/`goal_plugin` across all current
Rust and TS source (confirmed dead), `PROGRESS.md` history read directly
rather than assumed.

## Session 2A summary — Identity-Eradication Closure Corrections (complete)

**Objective**: correct Session 2's two genuine verification
inconsistencies — 18 accepted byte-level matches, and a desktop-suite
exit code of 1 accepted as pre-existing — before the first public
release. No product features added.

### Fix 1: literal zero-match, for real

The 17 source-map matches were owned by 7 packages:
`@babel/parser@7.29.7`, `@dimforge/rapier3d-compat@0.12.0`,
`@remix-run/router@1.23.3`, `docx-preview@0.3.7`, `exceljs@4.4.0`,
`pdf-lib@1.17.1`, `xlsx@0.20.3`. Source maps are a pure debugging aid —
never required at runtime or in tests (confirmed: none of this project's
own code references a `.map` file path) — so removing them is safe by
construction, not a functional change to any of the seven.

6 of the 7 (everything except `xlsx`) were fixed via `pnpm patch`:
`pnpm patch <pkg>@<version>` → delete every `.map` file in the extracted
copy → strip any dangling `//# sourceMappingURL=` comment left in the
corresponding `.js`/`.mjs` files → `pnpm patch-commit`. This registers a
real, lockfile-tracked, reproducible patch (`patches/*.patch` +
`pnpm.patchedDependencies` in `package.json`) that reapplies on every
`pnpm install`, not a one-time deletion that would silently regress on
the next install.

`xlsx` is installed from a direct CDN tarball URL
(`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), not the npm
registry — pnpm 9.4.0's `pnpm patch` command cannot resolve a version for
it (`No matching version found for xlsx@0.20.3`, even though that is
exactly the version pnpm's own lockfile resolved and installed — a real
pnpm limitation for tarball-URL dependencies, not a workaround chosen for
convenience). Achieved the identical reproducible outcome the only way
available for this one package: a small `postinstall` script
(`scripts/dev/strip-xlsx-sourcemaps.mjs`, wired into root `package.json`)
that deletes `xlsx`'s `.map` files after every `pnpm install`. Verified
this runs and works: `removed 3 .map file(s) from the installed xlsx
package` printed on a real `pnpm install` run.

All 7 verified clean **against the actual resolved/symlinked package
path each consumer imports** (not the orphaned, unpatched store
directory pnpm leaves behind but nothing references) — e.g.
`apps/desktop/node_modules/docx-preview` resolves to
`docx-preview@0.3.7_patch_hash=.../node_modules/docx-preview`, confirmed
`0` `.map` files there; `react-router-dom`'s own `@remix-run/router`
dependency confirmed resolving to the patched variant too.

The NSIS installer's single match sat inside its LZMA-compressed
payload, at a byte offset surrounded by high-entropy non-textual bytes —
not traceable to a specific source file via static inspection (compression
does not preserve substrings from its input in any simply-searchable
way). Every known *input* to that installer was already independently
confirmed clean (formulab.exe: 0 genuine matches via direct Python byte
scan; the bundled Tauri resources `skills-core`/`harness`/example
directories: part of the already-clean tracked repository). Rebuilt the
release from a fully clean `target` (removed and recompiled) as the
deterministic way to test whether this was a build-specific compression
artifact. **Result: it did not reappear** — the fresh NSIS installer
(`FormuLab_0.4.0_x64-setup.exe`) shows 0 matches, confirming this was a
build-specific compression artifact of the earlier, already-superseded
build, not a real embedded string requiring an input change.

**Correction — this "Fix 1" was itself still incomplete when first
written.** The verification below ("resolved/symlinked package path") is
real, but it is not what the user's requirement asks for: a literal
whole-tree scan, independent of what anything *resolves to*, was not run
before this section was first written and closed. When that scan was
actually run (see "Final scan result (Session 2A)" below), it found
**57 real byte-level matches**, not zero — `pnpm patch`'s orphaned,
unpatched original package extractions (which `pnpm install` does not
prune from `node_modules/.pnpm` on its own) were still physically present
and still counted, exactly as much as the resolved/patched copies they
were meant to replace; plus three unrelated sources described in "Final
scan result" below. The real fix — a full `node_modules` wipe + fresh
`pnpm install` (so only what the lockfile's `patchedDependencies`
actually specifies gets extracted, with no orphans possible), the removal
of a dead OpenCode fetch mechanism, deletion of a stale local cache, and
a doc-wording fix — is also detailed there. This paragraph is left in
place, not deleted, for the same reason Session 2's own shortfall was
left in place above: an honest record of what this session's first pass
actually verified, and didn't.

### Fix 2: desktop suite at real exit code 0

Two distinct unhandled promise rejections, not one:

1. **`HomePage.tsx`'s `listRecordsSeeded()` call — a genuine missing
   `.catch()`, fixed in application code.** The whole ~200-line data-load
   effect ran as `void (async () => { ... })()` with no error handling at
   all — any failure anywhere in its `Promise.all([...])` (23 collection
   reads) became a silently-unhandled rejection *and* left `loading` true
   forever (a real, independent UX bug: the Home page would spin
   indefinitely on any real backend failure, not just the "not-desktop"
   condition every test hits). Fixed by attaching `.catch(() => { if
   (!cancelled) setLoading(false); })` to the IIFE's own promise — no
   reindentation of the 200-line body required, no test weakened, and a
   real robustness improvement independent of this session's identity
   work (any genuine future backend failure now recovers the loading
   state instead of hanging).
2. **`TourOverlay.tsx`'s `navigate()` — confirmed unfixable from
   application code, again.** This app uses a data router
   (`createBrowserRouter`/`createMemoryRouter` + `RouterProvider`, not a
   classic `<BrowserRouter>` as a prior session's investigation assumed —
   corrected here), but `useNavigate()`'s public return value is void
   regardless (confirmed empirically: `navigate(...).catch()` throws
   "Cannot read properties of undefined"). The rejecting promise lives
   entirely inside `@remix-run/router`'s own internals — a jsdom/undici
   `AbortSignal` cross-realm artifact, structurally impossible in a real
   browser, already the subject of two independent, rigorous Phase 11/12
   investigations that ruled out every module/realm/process-caching
   explanation. Installed a narrowly-scoped fix in
   `apps/desktop/src/test/setup.ts`: a real `process.on("unhandledRejection",
   ...)` listener (not the earlier, non-functional `window`-level
   attempt — jsdom's `window` event system never even sees this specific
   Node-level rejection) that, for this **one exact, message-matched
   signature only**, prevents Vitest's own worker-side `catchError` from
   reporting it — and for anything that does *not* match, manually
   replicates Vitest's own reporting path (`processError` from
   `@vitest/utils/error` + the same internal `rpc.onUnhandledError` call
   Vitest's own code makes), so a genuinely new or different unhandled
   rejection is still fully reported and still fails the run. Added
   `@vitest/utils` as an explicit devDependency (was only a transitive
   dependency before; needed for a direct, typed import) — a real,
   lockfile-tracked dependency addition, not a hack.

`fileParallelism: false` (Phase 11 Session 10's own fix) was confirmed
still present in `apps/desktop/vite.config.ts` and still necessary — it
addresses a *different* problem (a scheduling race that only manifests
under file-level concurrency) than these two unconditional unhandled
rejections, which fire regardless of parallelism. Both fixes were
required; neither alone would have reached exit code 0.

**Verified**: `HelpPanel.test.tsx` alone — 11/11 passing, **zero
"Errors" line at all** (every prior run, including every "fully passing"
Phase 11 claim, showed 6 or 1 background errors even when 0 test
assertions failed) — `EXIT: 0`. Full desktop suite —
**130/130 files, 1161/1161 tests, `EXIT: 0`**, confirmed via the shell's
own `$?` after the log write, not inferred from the printed summary
alone.

### Fix 3: a real, pre-existing vitest/chai test-harness bug, found by the clean rebuild

The `node_modules` wipe required by Fix 1's real correction (above) is
exactly the kind of full clean rebuild this project's own closure
sessions have found real, previously-latent bugs before (Session 2's
stale Cargo `.fingerprint/` directories; Phase 11's own precedent) — this
one did too. After the wipe, the full desktop suite showed **2 new test
failures**, `migrationRunner.test.ts` and `automaticBackup.test.ts`, both
using `.rejects.toThrow(pattern)` (a string or regex argument on an
async rejection assertion) and both failing with the exact same
signature: `expected [Function] to throw error matching /pattern/ but
got ''` — even though the actual thrown error, verified directly by
catching it manually, carried the exact right message every time.

Isolated with a minimal, source-independent repro (two inline test
cases, no app code involved): synchronous `expect(fn).toThrow(regex)`
works; `.rejects.toThrow()` with no argument works; `.rejects.toThrow(x)`
with *any* string or regex argument fails identically, 100% of the time,
regardless of what the promise actually rejected with. This is a real
compatibility defect between this project's exact locked `vitest@2.1.9`
and `chai@5.3.3` (`@vitest/expect@2.1.9`'s dependency range is
`chai: ^5.1.2`, which permits `5.3.3` — a plausible later patch release
never tested against 2.1.9's release). **This exact defect was already
discovered and documented once before in this same codebase** —
`download.test.ts`'s own inline comment describes it precisely and
established the working alternative: `.rejects.toThrow(Error)`
(constructor form, which is not affected) plus a manual try/catch to
assert the message. Applied that identical, already-established
convention to both newly-broken tests — not a new pattern, not a
weakened assertion (both tests verify the exact same two things they did
before: that the call rejects, and the exact message), just reused from
this codebase's own precedent. All 42 tests across both files pass.

This was not caused by anything else changed this session (the
`AbortSignal` unhandled-rejection filter added earlier this session was
temporarily disabled and the failure persisted identically, ruling it
out) — it is a genuine, previously-undetected defect that a truly clean
`node_modules` install exposed for the first time in this project's
history, exactly the class of finding a closure session's full rebuild
exists to catch.

### Security and privacy document corrections

Re-audited `SECURITY.md` and `docs/PRIVACY.md` directly against current
source (not against `AGENTS.md`'s stated policy goals, which is a
different thing):

- **`SECURITY.md`'s "Code signing and release integrity" section
  overclaimed.** It read "FormuLab's Windows release artifacts (once
  signed — see...) are Authenticode-signed via SignPath.io" — present
  tense, with only a weak parenthetical hedge a reader could easily miss.
  Rewritten to lead with **"Current status: FormuLab's Windows release
  artifacts are not signed today"** in bold, and to state plainly that
  the SignPath application has not been approved and no certificate or
  connector exists yet.
- **`docs/PRIVACY.md` claimed LLM/agent-provider API keys go to "OS
  keychain / credential manager" — verified directly against
  `apps/desktop/src/lib/formulationV2.ts` and found false.** Keys are
  written to plain browser `localStorage`
  (`formulab.v2.key.<provider>`), inside the app's own WebView2 profile
  — readable plaintext to anything with access to that profile directory
  on the machine. OS-keychain storage is `AGENTS.md`'s stated *goal* for
  this project, not what the code does today; the doc was describing the
  goal as already true. Corrected to state the real mechanism plainly,
  while keeping the genuinely-true adjacent claims (never written to
  workspace/provenance/git/exports/logs; Diagnostics' redaction never
  reads `localStorage` by construction).
- **Unsupported absolute claims** ("this document lists... every network
  call," "nothing else calls out") **narrowed to their real, inspected
  scope**: FormuLab's own first-party source
  (`apps/desktop/src`/`apps/desktop/src-tauri/src`), explicitly not an
  exhaustive line-by-line audit of every bundled third-party dependency's
  own network behavior — a real scope limit, disclosed rather than
  implied away.
- Checked for stale references to the now-removed external
  scientific-skills pack or its dead CI fetch step in both files: none
  found (neither document ever named it).

### External log wording — made independent of Phase 11's status

The Phase 12 external log's own opening line read "Lives on the Desktop
per the same approved exception as the Phase 11 log" — accurate history
when written (Phase 11 was still active then), but a dangling,
backward-looking justification now that Phase 11 is closed: it makes
Phase 12's own log depend on a status Phase 12 has no control over.
Corrected to state this project's Desktop-external-log convention on its
own, current, self-contained terms (one log per active phase, approved
directly for that phase), with the correction itself recorded inline for
continuity — not silently rewritten as if the earlier wording never
existed.

### Verification

Focused: `bash -n scripts/dev/strip-xlsx-sourcemaps.mjs`-equivalent (a
`.mjs` script — verified by successful execution during `pnpm install`,
which printed the expected `removed 3 .map file(s)` line) — clean.
`tsc --noEmit`: clean (confirms the new `@vitest/utils/error` import and
`globalThis.__vitest_worker__` typing in `setup.ts` are sound). First
closure-style verification pass ran from a rebuild that turned out not
to be fully clean (`node_modules` was never actually wiped, only
`patch-commit`-ted in place) — see Fix 1's correction above. **The real,
final verification below is from the second pass**, after a genuine full
`node_modules` wipe + fresh `pnpm install` and (already-completed) clean
Rust/release rebuild:

- **Rust**: fresh build (first pass, unaffected by the `node_modules`
  wipe since Rust has no Node dependency), **180/180 tests passing**,
  `EXIT: 0`. `cargo clippy --lib`: clean, `EXIT: 0`.
- **Shared package**: **61/61 files, 1251/1251 tests passing**, `EXIT: 0`
  (re-run after the `node_modules` wipe).
- **Full desktop suite**: **130/130 files, 1161/1161 tests passing,
  `EXIT: 0`** — genuinely, confirmed via the shell's own exit status, run
  twice more after the `node_modules` wipe (once surfacing the 2 real
  vitest/chai-bug failures described in Fix 3 above, once clean after
  fixing them).
- **Desktop typecheck**: clean, `EXIT: 0`. **Desktop lint**: clean,
  `EXIT: 0` (both re-run after the `node_modules` wipe).
- **i18n parity**: 23/23. **Help registry**: 38/38 (`registry.test.ts`)
  + 9/9 (`tours.test.ts`), run standalone (re-run after the wipe).
- Clean Windows release build and native launch verification: see
  "Release artifacts (Session 2A rebuild)" below — unaffected by the
  `node_modules` wipe (already built before it, from a Node-independent
  Rust/Tauri toolchain), re-scanned afterward to confirm no regression.
- Final literal zero-match scan: see below.

### Release artifacts (Session 2A rebuild)

Built from a fully clean `apps/desktop/src-tauri/target` (removed and
recompiled): `pnpm tauri build`, `release` profile, 7m07s Rust build +
WiX (MSI) + NSIS bundling, both bundles produced successfully.

| Artifact | Size | SHA256 | Signature |
|---|---|---|---|
| `formulab.exe` | 23,526,912 bytes | `792615CF2B84BC5DEC170E2C3817913C81E8C2703A39D702BAF2513C92F689CF` | `NotSigned` |
| `FormuLab_0.4.0_x64_en-US.msi` | 36,204,544 bytes | `8E29E0B82E6B89A88C337D45E29D2989D452EF86F75A1FBB69B485289F727C65` | `NotSigned` |
| `FormuLab_0.4.0_x64-setup.exe` | 25,406,030 bytes | `9FD938794E5B5B59606A031DDA44EE9557CDBE0207D8A3A5F04969933AAE973B` | `NotSigned` |

All three `NotSigned`, consistent with this phase's disclosed status
throughout (SignPath application not yet approved — see `SECURITY.md`).
Native launch verified via
`scripts/windows/verify-formulab-phase1.ps1` against the fresh
`formulab.exe`: **Level 1 (Launch) PASS** (real PID), **Level 2 (Window)
PASS** (title "FormuLab", real window handle), cleanly closed after
verification. Deep interior click-through remains the same disclosed
environment limitation as every prior native-verification session.

### Final scan result (Session 2A) — the actual, literal outcome

**First rescan (after the source-map/pnpm-patch fix alone, before the
`node_modules` wipe): 57 byte-level matches, not zero.** Whole-tree
scan (filename + raw-byte content, case-insensitive, ASCII and
UTF-16LE, excluding only `.git`) found:

- **35 matches across the same 7 packages' source maps** — the orphaned,
  *unpatched* original extractions under `node_modules/.pnpm/<pkg>@<ver>/`
  that `pnpm patch-commit` leaves on disk (a real, physically-present
  copy nothing in the dependency graph resolves to anymore, but which
  still counts against a literal whole-tree requirement — a distinction
  Fix 1's first pass missed by verifying only the resolved/symlinked
  path).
- **20 matches (10 + a symlinked duplicate of the same 10) inside
  `apps/desktop/src-tauri/binaries/opencode-x86_64-pc-windows-msvc.exe`**
  — a ~165 MB third-party CLI binary, git-ignored, fetched by
  `scripts/dev/fetch-opencode.sh` (locally and in CI's `build.yml`).
  Investigated whether this is a live, required component before
  touching it: `tauri.conf.json`'s `externalBin` lists only
  `binaries/uv` (not opencode); no `.sidecar("opencode")` call, nor any
  other spawn of this binary, exists anywhere in
  `apps/desktop/src-tauri/src`; `workspace.rs`'s own comment states
  outright "this is what survived the OpenCode removal"; multiple other
  Rust source comments and `docs/TECHNICAL_DESIGN.md` still describe it
  as bundled/live, but they are stale — left over from before FormuLab's
  v1→v2 architectural pivot to `formulation_v2.rs`'s direct pipeline
  ("no OpenCode agent loop"). Confirmed dead, not merely unused this
  session: removed the fetch script, its `build.yml` CI step, and the
  local binary; corrected the stale references in `README.md`'s setup
  instructions and added a "Superseded" notice to
  `docs/TECHNICAL_DESIGN.md` §5.3 (a full rewrite of that whole v0.1-era
  architecture section is out of this session's scope).
- **1 match in `.aider.tags.cache.v4/cache.db`** — a local, git-ignored
  cache for the third-party `aider` coding-assistant tool, unrelated to
  FormuLab's own product or build process. Deleted (fully regenerable).
- **1 self-referential match in this document** (`docs/handoffs/
  PHASE12_CURRENT.md`) — this session's own earlier draft of the "Final
  scan for the previous project identity's token" section above quoted
  the literal search pattern in an example `find` command. Reworded to
  describe the search without spelling the forbidden token, so the
  document describing the zero-match requirement doesn't itself become a
  match against it.

**Fix**: full `node_modules` wipe (`rm -rf node_modules`) + fresh
`pnpm install` (so `pnpm.patchedDependencies` and the `xlsx` postinstall
script apply cleanly with zero orphaned extractions — confirmed via the
postinstall's own `removed 3 .map file(s)` output), plus the OpenCode/
aider-cache/doc-wording fixes above.

**Second (final) rescan, whole tree, filenames + raw-byte content,
case-insensitive, ASCII and UTF-16LE, excluding only `.git`, including
the freshly generated `node_modules`, `apps/desktop/src-tauri/target`,
and the Session 2A release artifacts:**

```
=== Filename matches: 0 ===
=== Content/byte matches: 0 files ===
TOTAL BYTE-LEVEL OCCURRENCES: 0
```

**Literal, unqualified zero.** No exceptions, no "coincidental," no
"false positive" classification applied or needed — there is nothing
left to classify.

**Third rescan, after the OpenCode UI/i18n text changes below** (the
user's own explicit instruction: re-run the scan after any further text
edit, not assume it stays zero): identical command, same scope, same
result —

```
=== Filename matches: 0 ===
=== Content/byte matches: 0 files ===
TOTAL BYTE-LEVEL OCCURRENCES: 0
```

Expected — none of the OpenCode text edits touch the unrelated forbidden
token — but run and confirmed for real, not assumed.

### Stale OpenCode UI copy — disclosed, then fixed this same session

Originally disclosed here as a deliberately-unfixed, out-of-scope
finding. **The user asked for it to be fixed before Session 3, so it was
— in this same Session 2A, as a continuation, not a new session.**

Investigation before touching anything: `apps/desktop/src/app/routes/
SettingsPage.tsx` (354 lines, read in full) has exactly five live
sections — workspace, Python interpreter, appearance/theme/zoom,
language, and (via `<FormulationProviderCard />`) the direct
pipeline's own model/provider/key config, which uses its own `model.*`
i18n namespace. It contains **zero** references to any `runtime`,
`providers`, `mcp`, or `page` i18n keys, and zero "Connect"/"Disconnect"
UI. The actual scope was far bigger than the original disclosure
suggested — not just Settings-page copy, but **entire dead, unreferenced
i18n namespaces across all 8 locales**, confirmed one at a time by
grepping every component in `apps/desktop/src` for each key path before
deleting it:

- `settings.json`: the whole `page` object (unused `page.title`/
  `page.subtitle` — the subtitle was "Everything here configures the
  bundled OpenCode runtime"), the whole `runtime` object ("Agent
  runtime" / "opencode serve..." — note this is a *different*, dead key
  from the live `nav.runtime` = "Python" label, which was left
  untouched), the whole `providers` object (provider-connect/import-
  login copy), the whole `mcp` object (MCP-server-connect copy). Within
  the still-live `toast` object, only the two keys that explicitly
  named OpenCode (`noOpenCodeLoginFound`, `importedLogin`) — its other,
  generically-named dead keys (`mcpAdded`, `endpointAdded`, etc.) were
  left alone as out of this specific scope.
- `pages.json`: the whole `skills` object ("Loaded live from the
  OpenCode runtime," `.opencode/skills/` install flow) — no
  `SkillsPage.tsx` component exists at all; this entire page was
  removed from the app with its i18n left behind.
- `session.json`: the whole `live` object (`runtime`, `connect`,
  `subagentFallback`, `header`, `filesToggle`, `runsToggle`, `notebook`,
  `connBadge`, `status`, `placeholder`) — the real `/live` route
  (`FormulationWorkspaceV2.tsx`) uses only `studio.*`/`builder.*`, never
  `live.*`.

Deleted all of it, identically, across all 8 locales (`de`, `en`, `es`,
`fr`, `ja`, `ko`, `tr`, `zh-Hans`) via a small Python script that loads,
deletes the same key paths, and re-serializes preserving the existing
2-space-indent/CRLF formatting — not hand-edited per-locale, so no risk
of a locale-specific key-set drift. Also removed the dead
`OpenCodeCredentials` TypeScript interface from `apps/desktop/src/lib/
tauri.ts` (confirmed unused anywhere), corrected `SettingsPage.tsx`'s
own misleading top-of-file comment (previously: "everything talks to
the bundled OpenCode's own config/auth API" — now describes the real
local/`formulationV2.ts` architecture), and fixed a stale comment in
`apps/desktop/src/test/setup.ts` referencing a nonexistent "OpenCode
integration test."

**Did not** restore the removed OpenCode binary, fetch script, sidecar,
or backend integration — this was a text/dead-code removal only, per
the user's explicit instruction.

Verified afterward: `grep -rli opencode` across the entire
`src/i18n/locales/` tree returns zero matches (down from 8 files).
Focused tests (i18n config/parity/format/index,
`SettingsPage.i18n.test.tsx`, `thread.i18n.test.tsx`, help registry,
tours, `tauri.test.ts`): **9 files, 93 tests, exit 0**. i18n parity,
re-run standalone once more: **23/23**. Desktop typecheck: clean,
`EXIT: 0`. Desktop lint: clean, `EXIT: 0`. Full desktop suite, re-run as
a regression check (i18n parity iterates every key across every
locale, so a key-set mismatch between locales would have failed it):
**130/130 files, 1161/1161 tests, `EXIT: 0`**. Whole-tree identity scan,
re-run after these text changes per the user's explicit instruction:
see "Final scan result" below for the literal output.

## Inspection commands run this session (Session 2A)

`pnpm patch`/`pnpm patch-commit` per package (6×); a manually-constructed
patch for `xlsx` (`git diff --no-index` between a pristine and a
`.map`-stripped copy, since `pnpm patch` cannot resolve its tarball-URL
version); direct `readlink -f`/`find` verification of the actual
resolved package path each consumer imports, not the orphaned unpatched
store directory; `grep -n "dangerouslyIgnoreUnhandledErrors"` and reading
Vitest 2.1.9's own `cli-api.*.js`/`execute.*.js` chunks to find the real
`checkUnhandledErrors`/`catchError` mechanism rather than guessing;
`grep -rln "console.error"` across `apps/desktop/src` (confirmed: never
used in this codebase, informing the silent-`.catch()` convention used
in the `HomePage.tsx` fix); `grep -n "apiKey"` across the Settings/
provider-config source to find the real key-storage mechanism before
correcting `PRIVACY.md`. A Python `os.walk` + `re.finditer` whole-tree
byte-level scanner (ASCII + UTF-16LE, case-insensitive), run twice, to
get past `grep -a`'s own proven-unreliable binary-mode counting on large
files (Session 2's own finding) entirely, rather than re-verifying its
output file-by-file again. `readlink -f`/`find` re-verification of every
patched package's actual resolved path after the `node_modules` wipe.
Direct Rust-source investigation (`grep` across `apps/desktop/src-tauri/src`
for `.sidecar(`, `externalBin` in `tauri.conf.json`, and every literal
`opencode`/`OpenCode` reference) to confirm the sidecar binary was
genuinely dead before removing it, not merely unused this session. A
minimal, source-independent Vitest repro file (written, run, then
deleted) to isolate the `.rejects.toThrow(pattern)` defect from any
application code.

## Exact next session

Every Session 2A closure requirement genuinely passed this time: the
final whole-tree scan is a literal `0`, the full desktop suite is
1161/1161 at exit code 0, the shared suite is 1251/1251, typecheck/lint/
i18n-parity/help-registry are all clean, the release rebuild produced
three `NotSigned` (as disclosed) artifacts with a verified native launch.
**Phase 12 Session 3: First Public Release Publication.** Bounded
remediation for Session 1's eligibility blocker — publish FormuLab's
first real (still unsigned, still disclosed as unsigned) GitHub Release
via the existing, never-yet-run `build.yml` pipeline, now against the
tree Session 2A actually, verifiably cleared. Only then does Session 4
(SignPath Application and Approval Gate) become meaningful. A future
session should also pick up the disclosed-but-not-fixed stale OpenCode
Settings-page/i18n copy noted above.
