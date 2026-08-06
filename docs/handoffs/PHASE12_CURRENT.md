# Phase 12 — Commercial Distribution

## Status: SESSION 2 (Complete Previous-Identity Eradication and Native FormuLab Skill Migration) COMPLETE. Every trace of the project's previous, pre-rename identity/dependency removed from the working tree, ahead of the still-pending first public release. Session 1's eligibility blocker (no release ever published) remains open — Session 3.

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

## Session 2 summary — Complete Previous-Identity Eradication and Native FormuLab Skill Migration (complete)

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
  Process exit code was 1 due to 6 unhandled-rejection background errors
  — identical to Phase 11 Session 10's own extensively-documented,
  confirmed-unfixable-from-application-code pattern (5×
  `HomePage`/`masterdata` "not-desktop" noise, 1× the known
  `TourOverlay`/`@remix-run/router` `AbortSignal` interaction) —
  unrelated to this session's changes, zero test assertions failed.
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

### Final scan for the previous project identity's token

Two rounds. **Round 1** — case-insensitive filename search
(`find . -iname "*ai4s*"`, excluding `.git`) across the entire working
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
by-byte in Python** (`re.finditer` against the raw file bytes, both
ASCII and UTF-16LE, since `grep -a`'s binary-mode heuristics on
multi-hundred-MB files proved unreliable): **107 were confirmed false
positives** — `formulab.exe`/`formulab.pdb`/`formulab_lib.lib`/
`libformulab_lib.rlib` (FormuLab's own build output) and every other
flagged third-party `.rlib`/`.rmeta`/`.pdb`/`.dll` contain **zero**
genuine occurrences of the pattern, in either encoding. `grep`'s own
`-c`/`-l` binary-mode reporting on these large files was simply wrong.

**The 17 text-file flags plus 1 additional genuine binary flag (the NSIS
installer itself) were individually confirmed as real byte-level matches
via the same direct verification** — and every one of these 18 is
coincidental noise, not a real identity reference:

- 16 occurrences across 8 unrelated third-party npm packages' `.js.map`
  source-map files (`@babel/parser`, `@dimforge/rapier3d-compat`,
  `@remix-run/router`, `docx-preview`, `exceljs`, `pdf-lib`, `xlsx`) —
  each one's exact surrounding context extracted and inspected directly
  (e.g. `...IAAI4S...` inside a VLQ/base64-encoded source-map mapping
  string) — a coincidental 4-character substring inside encoded data,
  not readable text, in packages with zero connection to this project's
  identity.
- 1 occurrence inside `bundle/nsis/FormuLab_0.4.0_x64-setup.exe` itself
  — exact byte offset extracted and inspected: surrounded by high-
  entropy, non-textual bytes consistent with the installer's LZMA-
  compressed payload (`...\x8c7ai4s\x01\xbb...`), not a string constant
  or embedded text of any kind.
- 1 local, disposable, gitignored diagnostic log
  (`scripts/windows/verification-logs/verify-20260730-145741.log`, from
  a manual native-verification run predating this session) — **deleted**
  this session (not a build/source artifact; regenerable by re-running
  the verification script; not part of any commit).

**Result: zero genuine matches remain in any first-party source file,
test, comment, script, CI workflow, package/crate identity, config key,
runtime-skill name, folder/file name, generated metadata, or FormuLab's
own build output** — including the freshly generated `node_modules`,
`target`, and signed... release artifacts. The only byte-level
occurrences of the literal pattern anywhere outside `.git` are the 17
coincidental encoding-noise matches above, individually verified and
explained, in content this project does not author, control, or ship as
readable text. Per this session's own instruction not to hide or
relabel a remaining match: these are disclosed explicitly, not silently
excluded — they are reported as real `grep` hits with real byte-level
verification proving they are not the previous project identity in any
meaningful sense.

## Inspection commands run this session

See the architecture doc's own §1 (Session 0) and §9 (Session 1) for
prior-session evidence. This session's own evidence: a case-insensitive
recursive search for the previous identity's token (whole tree,
excluding `.git`/`node_modules`/`target`), a filename search across the
pre-clean `target` directory (confirmed stale fingerprints), a search for
`deploy_bundled_skills`/`runtime.rs`/`goal_plugin` across all current
Rust and TS source (confirmed dead), `PROGRESS.md` history read directly
rather than assumed.

## Exact next session

**Phase 12 Session 3: First Public Release Publication.** Bounded
remediation for Session 1's eligibility blocker — publish FormuLab's
first real (still unsigned, still disclosed as unsigned) GitHub Release
via the existing, never-yet-run `build.yml` pipeline, now against the
tree this session cleared of the project's previous identity. Only then
does Session 4 (SignPath Application and Approval Gate) become
meaningful.
