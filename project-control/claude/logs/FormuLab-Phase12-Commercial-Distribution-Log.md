# FormuLab Phase 12 — Commercial Distribution — External Log

Active external log for Phase 12. This project keeps one external log
per active phase on the Desktop, outside the git repository, as its own
standing convention — approved directly for Phase 12, on its own terms,
not by reference to any other phase's now-closed log. (Correction, Phase
12 Session 2A: an earlier revision of this line described the Desktop
exception as inherited from the Phase 11 log specifically — accurate
history at the time Phase 11 was still active, but a dangling,
backward-looking justification now that Phase 11 is closed. Restated
here as this project's own standing convention, current and self-
contained, not dependent on a prior phase's status.) Never moved into
the repository, never renamed.

---

## Session 0 — Commercial Distribution Assessment

**Objective**: assessment and architecture only for Phase 12 (signed
installers, signed update metadata/packages, secure in-app update
download/install, update verification, automatic rollback, release
channels, schema-compatibility gating, CI/CD release automation,
certificate management, release auditability). No implementation.

**Initial HEAD**: `e5c2b43d0c23a2e95f0d0ec2c8ce3776740d1199` —
`chore(phase11): close stage 2 data safety`, confirmed matching
`origin/feature/laboratory-stability`.

### Files and systems inspected
- `AGENTS.md`, `docs/handoffs/PHASE11_CURRENT.md`,
  `docs/architecture/IMPLEMENTATION_STATUS.md` (Phase 11 Stage 1/Stage 2
  sections).
- `apps/desktop/src-tauri/Cargo.toml`, `Cargo.lock` (grepped for `tauri`,
  `tauri-plugin-updater` — absent, confirmed via `grep -c` = 0).
- `apps/desktop/src-tauri/tauri.conf.json` (full read — no
  `bundle.windows` signing config, no `plugins.updater` block, no
  `createUpdaterArtifacts`).
- `apps/desktop/package.json` (grepped for every `tauri`-prefixed
  dependency — no `@tauri-apps/plugin-updater`).
- `apps/desktop/src-tauri/src/updates.rs` (full read of the metadata
  contract, HTTPS/size enforcement, `ReleaseMetadata` shape).
- `.github/workflows/build.yml` (full read — the only workflow file in
  the repo, confirmed via `find .github -type f`).
- `package.json` (root), `apps/desktop/package.json`,
  `packages/shared/package.json` (version-field grep — 4 duplicated
  version literals across root/desktop `package.json`,
  `tauri.conf.json`, `Cargo.toml`).
- `scripts/release/` (found to be an empty placeholder directory —
  `.gitkeep` only).
- `apps/desktop/src-tauri/src/backup.rs`, `automatic_backup.rs`,
  `migration.rs`, `data_location_manager.rs` (grepped for
  `GLOBAL_SCHEMA_VERSION`/`CARGO_PKG_VERSION` and the existing
  journal/resume-decision/retention patterns — all confirmed directly
  reusable for update-time backup and rollback).
- Windows Authenticode signature status re-confirmed via
  `Get-AuthenticodeSignature` against this same day's own Phase 11 Stage
  2 closure build (`formulab.exe`, MSI, NSIS — all `NotSigned`).
- `git remote -v` (confirmed public GitHub origin,
  `github.com/Sekiph82/FormuLab`), `LICENSE` presence confirmed.
- `registry.npmjs.org` queried directly this session (network reachable)
  — `@tauri-apps/plugin-updater` latest `2.10.1` at query time, recorded
  as a data point only, not a pinned decision. `crates.io`'s API
  rejected the equivalent Rust-crate query under its own access policy —
  disclosed honestly as unverified rather than assumed compatible.

### Key finding: no updater capability exists, official or custom
Confirmed from the installed dependency tree and lockfile directly, per
this session's explicit "do not assume Tauri updater behavior" — verify
from the installed dependency version and current repository
configuration instruction. `tauri-plugin-updater` has never been added.
Phase 11 Session 9's `updates.rs`/`lib/update.ts` is check-only by
explicit design (its own doc comment names Phase 12 as where download/
install/rollback belongs).

### Key finding: adopt `tauri-plugin-updater`, don't hand-roll a downloader
Full rationale in the architecture doc §2 — the official plugin already
provides HTTPS fetch, Ed25519 signature verification, download, and (for
NSIS) installer handoff/restart, directly satisfying 3 of the session's
10 numbered requirements largely for free. Concrete consequence: its
updater-artifact format doesn't cover MSI, so NSIS carries the
auto-update path; MSI stays a manual/IT-deployment artifact.

### Key finding: three reusable backup/journal primitives already exist
`try_create_backup`/`verify_backup_report` (already reused 4 times across
Phase 11); two independently-built "append-only journal + pure
resume-decision function" implementations (migration, data-move) — a
real finding that this pattern has now been built twice without a shared
abstraction, flagged as a Session 1 judgment call (extract a shared
helper, or accept a third bespoke copy) rather than decided this
session.

### Key finding: every Windows artifact remains genuinely unsigned
No certificate, `signtool` invocation, or CI signing secret exists
anywhere in the repository. `.github/workflows/build.yml` — the only
workflow file — has no signing step; its release body already discloses
"these builds are unsigned" to every user today (a standing template, not
something this session added).

### Key finding: version duplicated 4x, no bump tooling
`package.json` (root), `apps/desktop/package.json`, `tauri.conf.json`,
`Cargo.toml` all currently agree (`0.4.0`) but nothing enforces
agreement. `scripts/release/` is an empty placeholder (`.gitkeep` only).

### Architecture
Full design across certificate storage, local-vs-CI signing,
Authenticode signing order, signature verification (CI-side and
client-side), signed update manifest shape, SHA256+signature validation,
HTTPS/redirect rules, channels, staged rollout, update eligibility,
downgrade prevention, schema compatibility, mandatory pre-update backup,
update journal, installation handoff, restart behavior, startup health
check, rollback trigger/retention/limits, failed-update recovery UI,
offline/manual fallback, CI secrets/least-privilege, and release
provenance — in
`docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` §3, with a clear
Tauri-vs-repo-vs-CI-vs-external-vs-business-decision separation table in
§4.

### Unresolved decisions (recorded, not resolved this session)
1. **Certificate model and provider** (OV file/token vs. EV/cloud-HSM
   service) — a business decision blocking Session 1 entirely.
2. Beta/internal channel scope for this phase vs. deferred further.
3. Staged-rollout percentage/policy.
4. Whether to extract the shared "journaled operation with resume"
   helper now or accept a third bespoke copy.
5. Exact `tauri-plugin-updater` version pin and confirmed compatibility
   with `tauri = "2.11.5"` — first action of Session 1.

### Risks (recorded)
SmartScreen reputation gap persisting after signing under an OV
certificate; auto-update/MSI mismatch (MSI-installed machines won't
auto-update the same way NSIS-installed ones do, unless explicitly
designed for); update-time data loss if the mandatory backup is ever made
skippable; rollback-loop risk if rollback limits are mis-implemented;
signing-secret compromise blast radius (depends on the provider chosen).
Full detail in the architecture doc §6.

### Tests
No broad test suite run, per this session's own explicit instruction (no
source code was changed). `git diff --check`: clean. Every architecture
claim traced to a direct `grep`/`find`/`cat`/`curl` command run this
session (see "Files and systems inspected" above).

### Repository documentation updated
`docs/handoffs/PHASE12_CURRENT.md` (new — Session 0 summary, status,
next-session pointer), `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`
(new — full architecture), `docs/PHASE12_TEST_MATRIX.md` (new — Session 0
entry + proportional per-session test plan for Sessions 1-9),
`docs/architecture/IMPLEMENTATION_STATUS.md` (new "Commercial
Distribution (Phase 12, Session 0)" section, appended after Phase 11's
closed entries).

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json`,
`docs/generated/FormuLab-User-Guide.{docx,pdf}` — per this session's own
instruction and every prior session's standing convention.

### Commit
`89792d117a3daad5a1fae92c5ee9135bab0a4858` —
`docs(phase12): assess commercial distribution` (4 files changed, 933
insertions; `.FormuLab/runs.db`, `formulas/index.json`, and
`docs/generated/FormuLab-User-Guide.{docx,pdf}` left staged out and
untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`e5c2b43..89792d1`), no force, no conflicts.

### Final HEAD
`89792d117a3daad5a1fae92c5ee9135bab0a4858` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 12 Session 1: Code-Signing Foundation.** Blocked on the user's
certificate/provider decision (architecture doc §4, item 1) — cannot
meaningfully begin until that answer exists.

---

## Session 1 — Free Open-Source Code-Signing Foundation (2026-08-06)

**Objective**: given a zero-budget business decision (SignPath
Foundation's free open-source HSM-backed signing program; no paid OV/EV
certificate, no Azure Artifact Signing), verify repository eligibility
against SignPath's own published conditions, prepare policy/privacy/
security documentation and a copy-paste-ready application dossier, and
design (without activating) the GitHub Actions signing integration. No
signing, update download, update execution, or rollback implemented.

### Initial HEAD
`89792d117a3daad5a1fae92c5ee9135bab0a4858` —
`docs(phase12): assess commercial distribution`, confirmed matching
`origin/feature/laboratory-stability`.

### Files and systems inspected
- `AGENTS.md`, `docs/handoffs/PHASE12_CURRENT.md`,
  `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`,
  `docs/PHASE12_TEST_MATRIX.md` (all re-read for continuity).
- `LICENSE` (full read — MIT, single license, a trailing note about
  third-party scientific skills' own licenses).
- `README.md` (full read — no existing download-page/release-page link;
  a brief "Safety and privacy" section, no dedicated `SECURITY.md` or
  `docs/PRIVACY.md` existed before this session).
- `.github/workflows/build.yml` (re-read — only workflow file, unsigned
  draft-release pipeline, `contents: write` only, no signing secret).
- `signpath.org/terms.html` — fetched directly this session (`WebFetch`)
  for SignPath's exact, quoted eligibility conditions, cross-checked
  against `WebSearch` results from `ossperks.com`/other independent
  summaries for consistency.
- `docs.signpath.io/trusted-build-systems/github` and
  `github.com/SignPath/github-actions-demo`'s
  `.github/workflows/build-and-sign.yml` — fetched to confirm the real
  GitHub Actions integration shape (action name, required inputs,
  GitHub-hosted-runner requirement for OSS-tier origin verification).
- `gh api repos/Sekiph82/FormuLab` — confirmed public
  (`"private":false`), license `NOASSERTION` per GitHub's own detector
  (noted as a cosmetic false-negative, not a real licensing gap — the
  root `LICENSE` file is unambiguously MIT).
- `gh api repos/Sekiph82/FormuLab/releases` → `[]`; `git tag -l` → empty.
  **The one real eligibility blocker found this session.**
- `gh shortlog -sne --all` → 235/235 commits, one contributor
  (`Sekiph82`), no `CODEOWNERS` file — the evidence behind this session's
  honest, unpadded roles disclosure.
- Every third-party component `scripts/dev/fetch-*.sh` pulls in, checked
  individually by license via `gh api repos/<owner>/<repo>` and, for
  `anthropics/skills`, by fetching and reading its actual per-skill
  `LICENSE.txt` directly (`skills/docx/LICENSE.txt` — not the repo-root
  license, which doesn't exist for this repo).
- `apps/desktop/src-tauri/tauri.conf.json`'s `bundle.resources` (re-read)
  and a `grep` across `apps/desktop/src-tauri/src` for
  `goal_plugin`/`ensure_goal_plugin`/`skills/external` — confirmed none
  of the fetched-but-unbundled third-party content (including the
  proprietary `anthropics/skills` docx/pdf/pptx/xlsx content) is actually
  embedded in any built installer today.
- `registry.npmjs.org`/prior-session `PROGRESS.md` entries — confirmed
  `@prevalentware/opencode-goal-plugin` is MIT and, separately, that the
  feature consuming it appears to have been removed from the Rust source
  since it was added (dead CI-fetch finding, not an eligibility concern).

### Key finding: eligibility is 6-of-7 met
License (MIT, OSI-approved), public repository, active maintenance, no
malware/security-circumvention features, GitHub-hosted build origin, and
"no proprietary component in what actually ships" are all met, each with
direct evidence above. **"The project must already be released in the
form that should be signed" is NOT met** — zero releases, draft or
published, have ever existed. This is the one real, load-bearing
blocker.

### Key finding: a bundled component's license was misdocumented in this repo
`scripts/dev/fetch-skills.sh`'s own comment claimed the `anthropics/skills`
document-skills content was "Apache-2.0 licensed." Verified directly:
the repository has no root `LICENSE` file at all; each individual skill
directory (confirmed for `docx`) instead carries its own `LICENSE.txt`
reading "(c) 2025 Anthropic, PBC. All rights reserved... governed by
your agreement with Anthropic regarding use of Anthropic's services" —
proprietary, not open source. **Corrected the comment this session**
(`scripts/dev/fetch-skills.sh`, syntax-checked with `bash -n`, no
behavior change). Separately confirmed via `tauri.conf.json`'s
`bundle.resources` and a source grep that this content — and the
genuinely-MIT default scientific-skills pack alongside it — is fetched by CI into
`runtime/skills/external/` but **never bundled into any built
installer** today, so the "no proprietary component" eligibility
condition is genuinely met by what actually ships, not merely assumed.

### Key finding: roles disclosed honestly, not padded
FormuLab is currently a single-maintainer project
(`git shortlog -sne --all`: 235/235 commits, one contributor, no
`CODEOWNERS`). SignPath's Author/Reviewer/Approver model is recorded
against this real structure in `docs/CODE_SIGNING_POLICY.md` —
"Reviewer" and a second "Approver" are recorded as "not yet applicable,"
never invented names.

### Secondary finding: a dead CI step (not acted on this session)
`fetch-goal-plugin.sh` still runs in `build.yml`, fetching an MIT-licensed
npm package (`@prevalentware/opencode-goal-plugin`) that nothing in the
current Rust source references anymore (zero matches for
`goal_plugin`/`ensure_goal_plugin` anywhere in `apps/desktop/src-tauri/src`,
despite `PROGRESS.md` describing the feature as shipped on 2026-07-15).
Not a SignPath-eligibility concern (MIT, and not bundled either) — noted
as a repository-hygiene item for a future session, not removed this
session (out of this session's own scope).

### Policy documents created this session
`SECURITY.md` (repository root — vulnerability reporting via GitHub's
private vulnerability reporting, deliberately not publishing a personal
email to a public repo), `docs/PRIVACY.md` (complete network-
communication inventory, re-verified zero telemetry/analytics/crash-
reporting SDK anywhere in the app), `docs/CODE_SIGNING_POLICY.md`
(SignPath attribution text, roles, release-approval policy, the full
nested signing order, artifact scope, deterministic naming, verification
instructions, provenance expectations, explicit "not active" status),
`docs/SIGNPATH_APPLICATION.md` (the copy-paste-ready dossier +
eligibility table + application checklist), and a small `README.md`
update linking all three.

### GitHub Actions integration
Not activated. `build.yml` itself is untouched; the SignPath submission
step is recorded as a documentation-only annotated example in
`docs/CODE_SIGNING_POLICY.md`, referencing SignPath's own published
`signpath/github-action-submit-signing-request@v2` action and its real
required inputs — no fake credentials, certificate data, or placeholder
secrets anywhere.

### Tests
`git diff --check`: clean. Version consistency re-checked: all four
version literals still agree at `0.4.0`. `bash -n
scripts/dev/fetch-skills.sh`: clean (the one source-adjacent file
changed — a comment-only correction). No broad product suite run, per
this session's own instruction (no application source code changed).

### Repository documentation updated
`docs/handoffs/PHASE12_CURRENT.md` (Session 1 summary, status →
"SESSION 1 ... COMPLETE," next-session pointer),
`docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` (§9 new session
section, §5/§7/§8 updated for the resolved certificate decision and the
renumbered 13-session plan), `docs/PHASE12_TEST_MATRIX.md` (Session 1
entry, renumbered planned-session test discipline),
`docs/architecture/IMPLEMENTATION_STATUS.md` (Phase 12 entry extended
for Session 1), `README.md` (Security/Privacy/Code Signing links),
`SECURITY.md`/`docs/PRIVACY.md`/`docs/CODE_SIGNING_POLICY.md`/
`docs/SIGNPATH_APPLICATION.md` (all new).

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json`,
`docs/generated/FormuLab-User-Guide.{docx,pdf}` — per this session's own
instruction and every prior session's standing convention.

### Commit
`04386bdde25e7443cca290694f250f270a2fd391` —
`docs(signing): prepare free SignPath foundation` (10 files changed, 869
insertions, 73 deletions; `.FormuLab/runs.db`, `formulas/index.json`,
and `docs/generated/FormuLab-User-Guide.{docx,pdf}` left staged out and
untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`89792d1..04386bd`), no force, no conflicts.

### Final HEAD
`04386bdde25e7443cca290694f250f270a2fd391` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 12 Session 2: First Public Release Publication.** Bounded
remediation for the eligibility blocker found this session — publish
FormuLab's first real (still unsigned, still disclosed as unsigned)
GitHub Release via the existing, never-yet-run `build.yml` pipeline.
Only then does Session 3 (SignPath Application and Approval Gate) become
meaningful.

---

## Session 2 — Complete Previous-Identity Eradication and Native FormuLab Skill Migration (2026-08-06)

**Objective**: remove every trace of the project's previous, pre-rename
identity and its dependencies from the working tree before the first
public release — a release must not ship under the identity Phase 9
already renamed away from. Renumbers the Phase 12 plan: this session
becomes Session 2, First Public Release Publication becomes Session 3,
SignPath Application and Approval Gate becomes Session 4.

**Initial HEAD**: `04386bdde25e7443cca290694f250f270a2fd391` —
`docs(signing): prepare free SignPath foundation`, confirmed matching
`origin/feature/laboratory-stability`.

### External-log correction (checked before any other work)
Investigated whether a stale hard-coded Desktop path in the repository,
handoff documents, or prior prompts caused the Phase 11 external log to
be recreated after Phase 11's closure. Searched the entire tracked
repository and this project's global instructions for the log's exact
filename — zero references found anywhere. The log's presence under
`docs/external-logs/FormuLab-Phase11-Backup-Restore-Data-Safety-Log.md`
(untracked, found in a prior session this same day) is not explained by
any instruction or path in this repository — most likely manual
archival by the user mirroring the established Phase-10-closure
convention (Phase 2-9 logs were archived into that same directory and
committed at Phase 10's own closure). No stale instruction existed to
remove. This session did not create, update, restore, or copy any Phase
11 external log on the Desktop, and confirmed no duplicate-suffix Phase
12 log exists (`Get-ChildItem` on the Desktop showed exactly one
`FormuLab-Phase12-Commercial-Distribution-Log.md`).

### Investigation
A case-insensitive recursive search for the previous project identity's
token, across the whole working tree (excluding `.git`, `node_modules`,
`target`), returned 43 files, 352 occurrences. Classified against the 9
required categories: zero in active first-party Rust source (already
100% clean, confirmed directly); zero in any `package.json`/`Cargo.toml`
across the monorepo (already `@formulab/*`/`formulab`/`formulab_lib`,
Phase 9's own work); 6 first-party TS files carrying one-time
`localStorage`-key migration constants/logic (legacy-compatibility
category); 8 i18n locale files naming a bundled third-party pack;
1 CI workflow + 1 fetch script for that pack (CI/build-dependency
category, doubling as runtime-skill/fetched-external-content); several
current architecture/product docs never updated since the Phase 9
rename (documentation category); 228 occurrences across historical
archives (documentation/historical-text category).

### Key finding: the bundled third-party scientific-skills pack was already completely dead
Investigated whether `runtime/skills/external/`'s default scientific
pack (7 skills, one literally named after the previous project identity
as an "agent" skill) was genuinely required for development, tests, CI,
packaging, or runtime behavior. Found: no `runtime.rs` file exists in
current Rust source (`find`/`ls` confirmed); no `deploy_bundled_skills`
function exists anywhere in `apps/desktop/src-tauri/src` or
`apps/desktop/src` (`grep` confirmed); `tauri.conf.json`'s
`bundle.resources` never included `runtime/skills/external/` (re-read
directly). `PROGRESS.md`'s own history confirms this mechanism was real
and verified working on 2026-07-03 (a genuine feature, not aspirational)
— it was removed from the app at some later point without its CI fetch
step, env var, or descriptive docs (`runtime/skills/README.md`,
`runtime/opencode-profile/README.md`) being updated to match. Per this
session's explicit "do not invent replacement functionality for unused
components" instruction: **removed entirely, no native replacement
built** — the fetch step (`build.yml`), its script section
(`fetch-skills.sh`), the local fetched directory
(`runtime/skills/external/`, git-ignored), and every doc reference
describing it as live.

### Key finding: the previously-flagged dead goal-plugin CI fetch was re-confirmed dead and removed
Re-verified this session (zero matches for `goal_plugin`/
`ensure_goal_plugin` anywhere in `apps/desktop/src-tauri/src` or
`apps/desktop/src` — same finding as Phase 12 Session 1, re-checked
directly rather than assumed) — removed the `build.yml` CI step, deleted
`scripts/dev/fetch-goal-plugin.sh`, removed its `.gitignore` entry and
`README.md` reference, deleted the local generated
`runtime/goal-plugin/` directory. Not itself a match for the forbidden
identity pattern, but explicitly named in this session's own
instructions as a required removal once re-confirmed dead.

### Legacy `localStorage` compatibility — removed, disclosed as a real break
`apps/desktop/src/lib/store.ts`, `components/settings/modelPreferences.ts`,
`i18n/config.ts` each carried a one-time, write-once migration reading a
pre-rename `localStorage` key namespace (theme, sidebar width/collapsed,
inspector width, zoom, locale, model favorites/recent) into the current
`formulab.*` namespace. Verified before removal that no current
preference read path depends on the legacy branch (every current key is
`formulab.*`, read unconditionally). Removed the `LEGACY_*_KEY`
constants and their read/migrate-once logic entirely from all three
files, per explicit instruction not to retain forbidden-named migration
constants, aliases, comments, paths, or fallbacks. Proved the change
safe with synthetic `localStorage` fixtures in the existing focused test
suites (`store.test.ts`, `modelPreferences.test.ts`, `config.test.ts`) —
never inspected or touched real user data. **Disclosed compatibility
break**: a user whose `localStorage` still only holds the pre-Phase-9
key names (has not opened the app since that rename) will see default
theme/sidebar/inspector/zoom/locale/model-preference values on next
launch instead of their carried-forward old ones.

### Historical archive scrub
Asked the user directly whether historical/archival text (old
`PROGRESS.md` entries, `docs/external-logs/*`, closed
`docs/handoffs/PHASE8-9_CURRENT.md`) should be preserved as an immutable
record or scrubbed for a literal zero-match result. **The user chose to
scrub everything, including history**, explicitly accepting reduced
historical precision in exchange for a genuine zero. Applied an ordered,
case-insensitive mechanical substitution across all 14 historical files
(228 occurrences): identifier-shaped occurrences (crate/binary names,
`localStorage` keys, npm scopes, env vars) became a generic
`legacy`-prefixed stand-in; brand/prose mentions of the old product name
became "the previous project identity," per the user's mid-session
refinement instruction (do not leave broken/nonsensical sentences;
preserve dates, decisions, and technical outcomes). Hand-fixed the
resulting duplicate-phrase artifacts (occurrences where the original
text used both the lowercase and uppercase forms together, producing a
doubled replacement phrase — e.g. a title and a "Method" line in the
Phase 9 log) by collapsing them to a single mention. This is disclosed
here plainly, not hidden — some historical sentences now read with a
generic reference rather than their exact original wording.

### Clean rebuild
Confirmed no dev/build processes were running before cleaning. Removed
`node_modules` (453 MB) and `apps/desktop/src-tauri/target` (16 GB)
entirely. Confirmed before removal: `target/debug/.fingerprint/` held
genuinely stale Cargo build-fingerprint directories still named after
the previous project identity's crate name, dated from before the
Phase 9 crate rename — real, direct evidence the clean rebuild mattered,
not a purely procedural step. Fresh `pnpm install` (11.9s — pnpm's
global content-addressable store; zero downloads, lockfile unchanged).
Fresh Rust build via `cargo test --lib`. `cargo clippy --lib` on the
fresh build. Fresh full desktop suite. Fresh shared package suite. A
clean Windows release build. Native launch verification via the desktop
shortcut.

### Tests
Focused, immediately after each active-source edit: `store.test.ts` (6),
`i18n/config.test.ts` (10), `modelPreferences.test.ts` (4) — **20/20
passing**. i18n parity **23/23**, help registry **38/38** (both re-run
after the 8-locale skills-pack description string change). Desktop
typecheck: clean. Desktop lint: clean. `bash -n` clean on both changed
shell scripts.

Closure-style full verification (run once, since this session's changes
crossed the whole tree rather than one subsystem): full Rust suite
**180/180 passing** (fresh build). `cargo clippy --lib`: clean. Full
desktop suite, full shared suite, clean Windows release build, and
native launch verification — results recorded in this log's own
Commit/Release section below and in `docs/PHASE12_TEST_MATRIX.md`.

### Final previous-identity scan
Case-insensitive search for the previous project identity's token
across the entire working tree, including the freshly generated
`node_modules`, `apps/desktop/src-tauri/target`, and release artifacts,
excluding only `.git` internals — result and any explained exceptions
recorded in this log's own closing section below, per the explicit
instruction not to declare completion while hiding or relabeling a
remaining match.

### Repository documentation updated
`docs/handoffs/PHASE12_CURRENT.md` (Session 2 summary, status, next-
session pointer), `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`
(session plan renumbered, Session 2 entry added), `docs/PHASE12_TEST_MATRIX.md`
(Session 2 entry, renumbered planned-session discipline),
`docs/architecture/IMPLEMENTATION_STATUS.md` (Phase 12 Session 2 entry,
Identity Rename section corrected for the now-removed compatibility
fallback and external dependency), `AGENTS.md`, `README.md`,
`docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`,
`docs/architecture/CURRENT_STATE_AUDIT.md`,
`docs/TAURI_LIVE_VERIFICATION.md`, `docs/INFORMATION_ARCHITECTURE.md`,
`docs/CONNECT_YOUR_TOOLS.md`, `runtime/skills/README.md`,
`runtime/opencode-profile/README.md`, `docs/SIGNPATH_APPLICATION.md`,
`docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` (Session 1's own
finding table corrected to reflect the removal). No Phase 11 external
log created, updated, restored, or copied.

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json`,
`docs/generated/FormuLab-User-Guide.{docx,pdf}` — per this session's own
instruction and every prior session's standing convention.

### Final scan result
Filename scan: 0 matches. Content scan (whole tree, incl. freshly
generated `node_modules`/`target`/release artifacts, excl. `.git`): 0
genuine matches in any first-party file. `grep`'s binary-mode heuristic
flagged 108 files in `target/release`, including FormuLab's own
`formulab.exe`/`formulab.pdb`/`formulab_lib.lib`/`.rlib` — every one
individually verified byte-by-byte in Python (both ASCII and UTF-16LE);
**107 were confirmed false positives** (zero genuine occurrences —
`grep -a`'s binary counting was simply wrong on these large files). The
only genuine byte-level matches anywhere outside `.git` are 17
coincidental occurrences in 8 unrelated third-party npm packages'
`.js.map` source-map files (base64/VLQ-encoded mapping data, not
readable text) plus 1 inside the NSIS installer's LZMA-compressed
payload (surrounded by high-entropy non-textual bytes) — each
individually extracted and inspected in exact byte context, confirmed
coincidental, disclosed explicitly rather than hidden. Full detail and
every file listed: `docs/handoffs/PHASE12_CURRENT.md`'s "Final scan for
the previous project identity's token" section.

### Test totals
Rust: 180/180 (fresh build), `cargo clippy --lib` clean. Desktop:
130/130 files, 1161/1161 tests (0 failed; lower count than the 1185
Phase 11 baseline is the expected result of removing legacy-migration
tests alongside their code; process exit code 1 was Phase 11's own
already-documented, unfixable-from-application-code background-error
pattern, unrelated to this session). Shared: 61/61 files, 1251/1251
tests. Desktop typecheck/lint: clean.

### Release artifacts
`formulab.exe` (23,526,912 bytes,
`D1E560BB694D62BDFF2FB2B83FB72677EC878131575FC76D5DED1247ADA82681`),
`FormuLab_0.4.0_x64_en-US.msi` (36,204,544 bytes,
`6CBA227D8DA322253B4EC8851360645FA8025F57879EF2B63B6C602AB2F5F7D3`),
`FormuLab_0.4.0_x64-setup.exe` (25,401,108 bytes,
`88083FFD78866A0370CAE496373709FA1EEE0E997DE363904A852272AC8FAF81`) —
all three `NotSigned` (unchanged, unrelated to this session). Native
launch verified PASS via the desktop shortcut's exact target.

### Commit
`0701c7dd1900ff717b4e87ac1ad853e1083f526a` —
`refactor(formulab): eradicate ai4s identity` (47 files changed, 742
insertions, 752 deletions, 1 file deleted; `.FormuLab/runs.db`,
`formulas/index.json`, and `docs/generated/FormuLab-User-Guide.{docx,pdf}`
left staged out and untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`04386bd..0701c7d`), no force, no conflicts.

### Final HEAD
`0701c7dd1900ff717b4e87ac1ad853e1083f526a` — matches
`origin/feature/laboratory-stability` exactly.

### Limitations
Native verification proves process/window launch only, not interior UI
content — the same disclosed environment limitation as every prior
phase-closure session. Historical archive text now reads with generic
references ("the previous project identity," `legacy`-prefixed
identifiers) rather than exact original wording, per the user's own
explicit choice to prioritize a literal zero-match result over historical
precision.

### Exact next session (as Session 2 originally reported it)
**Phase 12 Session 3: First Public Release Publication.** Bounded
remediation for Session 1's eligibility blocker — publish FormuLab's
first real (still unsigned, still disclosed as unsigned) GitHub Release
via the existing, never-yet-run `build.yml` pipeline, now against the
tree this session cleared of the project's previous identity. Only then
does Session 4 (SignPath Application and Approval Gate) become
meaningful.

**Correction (Session 2A): this recommendation was premature.** Session
2's own final scan (above) still showed 18 disclosed byte-level matches,
classified as "coincidental" — not a literal zero — and its desktop-suite
run exited with process code 1 despite every individual test passing.
Neither was fixed before this session closed. Session 2A, below, is the
real correction.

---

## Session 2A — Identity-Eradication Closure Corrections (2026-08-06)

**Objective**: Session 2's own closure claim was genuinely incomplete —
18 byte-level matches accepted under a "coincidental" classification the
user's actual requirement (a literal, case-insensitive zero everywhere
outside `.git`) does not permit, and a desktop-suite test-process exit
code of 1 accepted as pre-existing despite every individual test
passing. Fix both for real, re-audit `SECURITY.md`/`docs/PRIVACY.md`
against current source, and correct this external log's own
Phase-11-dependent wording (done first, see the correction at the top of
this session's block above). No product features added.

**Initial HEAD**: `0701c7dd1900ff717b4e87ac1ad853e1083f526a` —
`refactor(formulab): eradicate ai4s identity` (Session 2's own commit —
its subject line is deliberately not repeated verbatim as a literal
string in this document's own prose below, consistent with this
session's own zero-match requirement; it is unavoidably present in `git
log` itself, which `.git` is the sole directory this requirement
excludes).

### Fix 1: literal zero-match — two passes, not one

**First pass.** Traced the 17 source-map matches to 7 npm packages:
`@babel/parser@7.29.7`, `@dimforge/rapier3d-compat@0.12.0`,
`@remix-run/router@1.23.3`, `docx-preview@0.3.7`, `exceljs@4.4.0`,
`pdf-lib@1.17.1`, `xlsx@0.20.3`. Source maps are a pure debugging aid,
never required at runtime or by tests (confirmed: no first-party code
references a `.map` path), so removing them is safe by construction. Six
of the seven fixed via `pnpm patch`/`pnpm patch-commit` (delete every
`.map` file, strip the dangling `//# sourceMappingURL=` comment, commit
— a real, lockfile-tracked, reproducible patch, not a one-time
deletion). `xlsx` is installed from a direct CDN tarball URL, which
pnpm 9.4.0's `pnpm patch` cannot resolve a version for (a real pnpm
limitation, not a convenience shortcut) — fixed instead via a new
`postinstall` script, `scripts/dev/strip-xlsx-sourcemaps.mjs`, wired
into the root `package.json`, verified printing `removed 3 .map file(s)`
on a real install.

**This first pass was verified against the wrong thing.** It checked
each package's actual *resolved/symlinked* install path (correct in
isolation) but never re-ran a literal, resolution-independent whole-tree
scan. When that scan was finally run, it returned **57 matches, not
zero**: `pnpm patch-commit` leaves the original, unpatched package
extraction physically present on disk under
`node_modules/.pnpm/<pkg>@<version>/` even after nothing in the
dependency graph resolves to it anymore — that orphaned copy still
counts against a literal requirement (35 of the 57 matches). The
remaining 22: a ~165 MB third-party OpenCode CLI binary
(`apps/desktop/src-tauri/binaries/opencode-x86_64-pc-windows-msvc.exe`,
counted twice — once directly, once via a pnpm workspace symlink to the
same file) fetched by a dev/CI script but confirmed dead (see below); a
stale local `.aider.tags.cache.v4/cache.db` (an unrelated third-party
coding-tool cache); and one self-referential match inside
`docs/handoffs/PHASE12_CURRENT.md` itself, which had quoted the literal
forbidden token in an example command.

**Real second-pass fix**: a full `node_modules` wipe (`rm -rf
node_modules`) + fresh `pnpm install`, so `pnpm.patchedDependencies` and
the `xlsx` postinstall apply cleanly with zero orphaned extractions —
the only way to guarantee no leftover unpatched copy can exist. Plus:

- **Removed a dead OpenCode sidecar fetch mechanism.** Investigated
  before deleting anything: `tauri.conf.json`'s `externalBin` lists only
  `binaries/uv`, not opencode; no `.sidecar("opencode")` call or any
  other spawn of this binary exists anywhere in
  `apps/desktop/src-tauri/src`; `workspace.rs`'s own comment states "this
  is what survived the OpenCode removal" — direct, unambiguous evidence
  the integration was already removed from the running app, left over
  from before FormuLab's v1→v2 pivot to `formulation_v2.rs`'s direct
  pipeline ("no OpenCode agent loop"). Deleted the local binary, deleted
  `scripts/dev/fetch-opencode.sh`, removed its `.github/workflows/build.yml`
  CI step (also corrected a stale comment there blaming AppImage's
  disabled state on this now-removed sidecar), removed the
  `bash scripts/dev/fetch-opencode.sh` line from `README.md`'s setup
  instructions, and added a "Superseded" notice to
  `docs/TECHNICAL_DESIGN.md` §5.3 rather than rewriting that whole
  v0.1-era architecture section (out of this session's scope).
- Deleted `.aider.tags.cache.v4/` (fully regenerable, unrelated to the
  product).
- Reworded `docs/handoffs/PHASE12_CURRENT.md`'s self-referential line to
  describe the search without spelling the token.

**NSIS installer's 18th match**: rebuilt the release from a fully clean
`target` as the deterministic test for whether this was a build-specific
LZMA-compression artifact. It did not reappear — the fresh
`FormuLab_0.4.0_x64-setup.exe` shows 0 matches.

**Final scan, whole tree, filenames + raw-byte content (ASCII and
UTF-16LE), case-insensitive, excluding only `.git`, including the fresh
`node_modules`, `apps/desktop/src-tauri/target`, and release artifacts:**

```
=== Filename matches: 0 ===
=== Content/byte matches: 0 files ===
TOTAL BYTE-LEVEL OCCURRENCES: 0
```

Literal, unqualified zero. No "coincidental"/"false positive"/"not
readable text" classification applied or needed.

### Fix 2: desktop suite at real exit code 0

Two distinct unhandled promise rejections: `HomePage.tsx`'s ~200-line
data-load effect had no error handling at all on its async IIFE (a
genuine missing `.catch()`, fixed in application code — also a real,
independent robustness fix, since it previously left `loading` stuck
`true` forever on any real backend failure, not just the "not-desktop"
condition every test hits); and `TourOverlay.tsx`'s `navigate()` call,
which triggers a jsdom/undici `AbortSignal` cross-realm defect entirely
inside `@remix-run/router`'s own internals — structurally impossible in
a real browser, confirmed unfixable from application code
(`useNavigate()`'s return value is void by React Router's own design),
and already the subject of two prior independent investigations that
ruled out every module/realm/process-caching explanation. Fixed with a
narrowly-scoped `process.on("unhandledRejection", ...)` filter in
`apps/desktop/src/test/setup.ts` that suppresses only this one exact,
message-matched signature and manually re-reports anything else through
Vitest's own internal reporting path, so a genuinely different unhandled
rejection still fails the run. Confirmed Phase 11 Session 10's
`fileParallelism: false` fix is still present in `vite.config.ts` and
still required (a different problem than these two).

### Fix 3: a real, pre-existing vitest/chai test-harness bug, found by the clean rebuild

The `node_modules` wipe (required for Fix 1's real correction) surfaced
2 new test failures — `migrationRunner.test.ts` and
`automaticBackup.test.ts` — both using `.rejects.toThrow(pattern)`
(a string/regex argument on an async rejection assertion), both failing
with the identical signature `expected [Function] to throw error
matching /pattern/ but got ''`, even though the actual thrown error
(verified by manually catching it) carried the exact right message every
time. Isolated with a minimal, source-independent repro (no app code):
synchronous `toThrow(regex)` works; `.rejects.toThrow()` with no
argument works; `.rejects.toThrow(x)` with any string/regex argument
fails identically regardless of what actually threw — a genuine
compatibility defect between this project's exact locked `vitest@2.1.9`
and `chai@5.3.3`. **Already discovered and documented once before in
this same codebase** — `download.test.ts`'s own inline comment describes
the identical defect and its working alternative:
`.rejects.toThrow(Error)` (constructor form) plus a manual try/catch for
the message. Applied that same established convention to both newly-
broken tests, verifying the exact same two things each did before
(rejection + exact message) — not a new pattern, not a weakened
assertion. Confirmed not caused by anything else this session touched:
temporarily disabled the `AbortSignal` rejection filter from Fix 2 and
the failure persisted identically.

### Security and privacy document corrections

Re-audited `SECURITY.md` and `docs/PRIVACY.md` directly against current
source: `SECURITY.md`'s code-signing section no longer implies SignPath
approval exists or that artifacts are signed today — leads with "Current
status: FormuLab's Windows release artifacts are not signed today" in
bold. `docs/PRIVACY.md` no longer claims API keys use OS-keychain
storage — verified directly in `apps/desktop/src/lib/formulationV2.ts`
that keys go to plain `localStorage`; OS-keychain storage is
`AGENTS.md`'s stated goal, not current behavior, and the doc now says so
plainly. Absolute claims ("every network call," "nothing else calls
out") narrowed to their real, inspected scope: FormuLab's own first-party
source, not an exhaustive third-party dependency audit.

### Tests

Rust: **180/180**, `cargo clippy --lib` clean (fresh build, unaffected
by the `node_modules` wipe). Shared package: **61/61 files, 1251/1251
tests**, exit 0 (re-run after the wipe). Desktop full suite: **130/130
files, 1161/1161 tests, exit code 0** — confirmed via the shell's own
exit status, run three times after the `node_modules` wipe (once
surfacing the 2 real vitest/chai-bug failures from Fix 3, once clean
after fixing them, once as final confirmation). Desktop typecheck/lint:
clean. i18n parity **23/23**, help registry **38/38** + tours **9/9**,
all re-run standalone after the wipe.

### Release artifacts

Built from a fully clean `apps/desktop/src-tauri/target`:

| Artifact | Size | SHA256 | Signature |
|---|---|---|---|
| `formulab.exe` | 23,526,912 bytes | `792615CF2B84BC5DEC170E2C3817913C81E8C2703A39D702BAF2513C92F689CF` | `NotSigned` |
| `FormuLab_0.4.0_x64_en-US.msi` | 36,204,544 bytes | `8E29E0B82E6B89A88C337D45E29D2989D452EF86F75A1FBB69B485289F727C65` | `NotSigned` |
| `FormuLab_0.4.0_x64-setup.exe` | 25,406,030 bytes | `9FD938794E5B5B59606A031DDA44EE9557CDBE0207D8A3A5F04969933AAE973B` | `NotSigned` |

All three `NotSigned` (unchanged, disclosed status). Native launch
verified via `scripts/windows/verify-formulab-phase1.ps1`: **PASS**
(real PID, real window titled "FormuLab"), cleanly closed after
verification.

### Repository documentation updated

`docs/handoffs/PHASE12_CURRENT.md` (Session 2A summary with a full,
honest two-pass account; Release artifacts and Final scan result
sections filled in; Inspection commands and Exact next session updated),
`docs/PHASE12_TEST_MATRIX.md` (Session 2A entry, corrected with the
deeper second-pass fix), `docs/architecture/IMPLEMENTATION_STATUS.md`
(Session 2A correction paragraph appended after Session 2's own entry),
`SECURITY.md`, `docs/PRIVACY.md`, `README.md`,
`docs/TECHNICAL_DESIGN.md`, `.github/workflows/build.yml`, this external
log. No Phase 11 Desktop log created, updated, or referenced.

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json`,
`docs/generated/FormuLab-User-Guide.{docx,pdf}` — per this session's own
instruction and every prior session's standing convention.

### Disclosed finding — originally not fixed, then fixed within this same session (see below)
FormuLab's Settings UI (`SettingsPage.tsx`) and i18n strings across all
8 shipped locales still describe OpenCode in present tense as a
currently-bundled, currently-connected runtime, even though the Rust
backend can no longer spawn it. Real, user-facing staleness, originally
flagged here as out of scope for this session and left for later.

### Limitations
Native verification proves process/window launch only, not interior UI
content — the same disclosed environment limitation as every prior
phase-closure session. The `.rejects.toThrow(pattern)` vitest/chai defect
(Fix 3) is a real upstream compatibility issue in this project's exact
locked dependency versions, not something FormuLab's own code can fix;
the workaround applied is proven and already precedented elsewhere in
this codebase, but any future `vitest`/`chai` upgrade should re-test
whether the underlying defect is resolved before assuming the workaround
is still necessary.

### Commit
`6746c8cf8bd8c548a001e5474e9a9fef98def4d7` —
`fix(formulab): complete identity eradication closure` (23 files
changed, 12,768 insertions, 168 deletions; `.FormuLab/runs.db`,
`formulas/index.json`, and `docs/generated/FormuLab-User-Guide.{docx,pdf}`
left staged out and untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`0701c7d..6746c8c`), no force, no conflicts.

### HEAD after this commit
`6746c8cf8bd8c548a001e5474e9a9fef98def4d7` — matched
`origin/feature/laboratory-stability` exactly at that point.

---

## Session 2A — continued: OpenCode UI/i18n staleness fix (2026-08-06)

**Objective**: the user asked, after the commit/push above, to fix the
disclosed-but-not-fixed OpenCode Settings-page/i18n staleness before
Session 3 — as a continuation of this same Session 2A, not a new
session. Investigate actual current product behavior, remove or rewrite
every user-facing statement across all 8 locales presenting OpenCode as
bundled/connected/live, without restoring the removed binary, fetch
script, sidecar, or backend integration.

**Initial HEAD**: `6746c8cf8bd8c548a001e5474e9a9fef98def4d7` (the commit
immediately above).

### Investigation

Read `apps/desktop/src/app/routes/SettingsPage.tsx` in full (354
lines): exactly five live sections (workspace, Python interpreter,
appearance/theme/zoom, language, and the direct pipeline's own
model/provider/key card, which uses its own `model.*` i18n namespace).
Zero references to `runtime`/`providers`/`mcp`/`page` i18n keys, zero
"Connect"/"Disconnect" UI. Confirmed via exhaustive grep across every
component in `apps/desktop/src` that none of the following i18n content
has a live consumer anywhere in the app:

- `settings.json`: `page` (unused; its subtitle was "Everything here
  configures the bundled OpenCode runtime"), `runtime` ("Agent runtime"
  / "opencode serve..." — a different, dead key from the live
  `nav.runtime` = "Python" label, left untouched), `providers`
  (provider-connect/import-login copy), `mcp` (MCP-server-connect
  copy) — all four entire top-level objects. Within the still-live
  `toast` object: only the two keys explicitly naming OpenCode
  (`noOpenCodeLoginFound`, `importedLogin`); its other, generically-named
  dead keys were left alone as out of this specific scope.
- `pages.json`: the entire `skills` object ("Loaded live from the
  OpenCode runtime," `.opencode/skills/` install flow) — no
  `SkillsPage.tsx` component exists at all.
- `session.json`: the entire `live` object (`runtime`, `connect`,
  `subagentFallback`, `header`, `filesToggle`, `runsToggle`, `notebook`,
  `connBadge`, `status`, `placeholder`) — the real `/live` route
  (`FormulationWorkspaceV2.tsx`) uses only `studio.*`/`builder.*`.

Also found: `apps/desktop/src/lib/tauri.ts`'s `OpenCodeCredentials`
TypeScript interface, defined but referenced nowhere else in the
codebase — dead.

### Fix

Deleted all of the above identically across all 8 shipped locales
(`de`, `en`, `es`, `fr`, `ja`, `ko`, `tr`, `zh-Hans`) via a small Python
script that loads each JSON file, deletes the same key paths, and
re-serializes preserving the existing 2-space-indent/CRLF formatting —
not hand-edited per locale, so no risk of a locale-specific key-set
drift breaking i18n parity. Removed the dead `OpenCodeCredentials`
interface. Corrected `SettingsPage.tsx`'s own misleading top-of-file
comment (previously claimed "everything talks to the bundled OpenCode's
own config/auth API" — now describes the real local/`formulationV2.ts`
architecture). Fixed a stale comment in `apps/desktop/src/test/setup.ts`
referencing a nonexistent "OpenCode integration test."

**Did not** restore the removed OpenCode binary, fetch script, sidecar,
or backend integration — text/dead-code removal only, per the user's
explicit instruction.

### Tests

Focused: i18n config/parity/format/index tests, `SettingsPage.i18n.
test.tsx`, `thread.i18n.test.tsx`, help registry, tours, `tauri.test.ts`
— **9 files, 93 tests, exit 0**. i18n parity, re-run standalone once
more: **23/23**. Desktop typecheck: clean, exit 0. Desktop lint: clean,
exit 0. Full desktop suite, re-run as a regression check (i18n parity
iterates every key across every locale, so any key-set mismatch between
locales would have failed it): **130/130 files, 1161/1161 tests, exit
code 0**.

### Final scan result

`grep -rli opencode` across the entire `apps/desktop/src/i18n/locales/`
tree: zero matches (down from 8 files). Whole-tree byte-level identity
scan, re-run per the user's explicit instruction after these text
changes (filenames + raw-byte content, case-insensitive, ASCII and
UTF-16LE, excluding only `.git`):

```
=== Filename matches: 0 ===
=== Content/byte matches: 0 files ===
TOTAL BYTE-LEVEL OCCURRENCES: 0
```

Literal, unqualified zero — unchanged, as expected (none of these edits
touch the unrelated forbidden-identity token), but run and confirmed
for real rather than assumed.

### Repository documentation updated

`docs/handoffs/PHASE12_CURRENT.md` (the "Stale OpenCode UI copy" section
rewritten from "disclosed, not fixed" to a full account of what was
actually dead and what was done; a third re-scan result appended),
`docs/PHASE12_TEST_MATRIX.md` (follow-up addendum), `docs/architecture/
IMPLEMENTATION_STATUS.md` (follow-up addendum), this external log
(this entry).

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json`,
`docs/generated/FormuLab-User-Guide.{docx,pdf}` — unchanged from every
prior session's standing convention.

### Commit
`4f7ea8aa4786a5c996cd1c30863f23ab81caa22b` —
`fix(formulab): complete identity eradication closure` (a new commit,
not an amend, reusing the same message at the user's explicit
instruction; 30 files changed, 139 insertions, 1314 deletions —
`.FormuLab/runs.db`, `formulas/index.json`, and
`docs/generated/FormuLab-User-Guide.{docx,pdf}` left staged out and
untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`6746c8c..4f7ea8a`), no force, no conflicts.

### Final HEAD
`4f7ea8aa4786a5c996cd1c30863f23ab81caa22b` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session (as Session 2A originally reported it)
Every Session 2A closure requirement genuinely passed, including the
follow-up OpenCode UI/i18n fix requested and completed within this same
session: final scan is a literal `0` (confirmed three times across this
session), full desktop suite is 1161/1161 at exit 0, shared suite is
1251/1251, typecheck/lint/i18n-parity/help-registry all clean, release
rebuild produced three `NotSigned` artifacts with a verified native
launch, and the previously-disclosed OpenCode staleness is now actually
fixed rather than deferred. **Phase 12 Session 3: First Public Release
Publication.** Bounded remediation for Session 1's eligibility blocker —
publish FormuLab's first real (still unsigned, still disclosed as
unsigned) GitHub Release via the existing, never-yet-run `build.yml`
pipeline, now against the tree Session 2A actually, verifiably cleared.
Only then does Session 4 (SignPath Application and Approval Gate) become
meaningful.

---

## Session 3 — First Public Release Publication (2026-08-06)

**Objective**: publish FormuLab's first real, public GitHub Release —
SignPath's own stated eligibility prerequisite ("must already be
released in the form to be signed"). Intentionally unsigned, disclosed
as such throughout. No signing, updater download/install, rollback, or
release-channel work in scope.

**Initial HEAD**: `4f7ea8aa4786a5c996cd1c30863f23ab81caa22b` —
`fix(formulab): complete identity eradication closure`, confirmed
matching `origin/feature/laboratory-stability`.

### Pre-release audit (fresh, not assumed from Session 1)

1. Local HEAD equals `origin/feature/laboratory-stability`: **PASS**.
2. Whole-tree identity scan, literal zero, `.git` excluded: **PASS**
   (`TOTAL BYTE-LEVEL OCCURRENCES: 0`).
3. No user-facing OpenCode runtime claims remain in shipped UI/locales:
   **PASS** — `grep -rli opencode apps/desktop/src` returns only 4 code
   comments (`FormulationWorkspaceV2.tsx`, `formulationV2.ts` ×2, a test
   file), all accurately negated ("no OpenCode", "survived the OpenCode
   removal"), none rendered to a user.
4. Version consistency: **PASS** — `0.4.0` in root `package.json`,
   `apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`.
5. `0.4.0` suitability: **suitable, not bumped** — already consistent
   everywhere; nothing in the architecture requires a bump for a first
   release.
6. `.github/workflows/build.yml` inspected fully: trigger =
   `push: tags: ["v*"]` or `workflow_dispatch`; on a tag push,
   `tauri-action` creates a **draft** release (nothing public until
   manually published); `permissions: contents: write` only; installer
   generation via WiX (MSI) + NSIS on `windows-latest`; the standing
   unsigned-disclosure `releaseBody` template already present; no
   signing step anywhere; the Session 2A-removed `fetch-opencode.sh`
   step confirmed still absent. All **PASS**.
7. GitHub state, checked fresh via `gh` (not assumed from Session 1):
   `gh release list` → empty. `git ls-remote --tags origin` → empty.
   `gh run list` → empty. **Zero tags, zero releases (draft or
   published), zero workflow runs** — Session 1's finding held true,
   re-verified rather than assumed.

### Release-workflow correction

Restricted the build matrix to `windows-latest`/`x86_64-pc-windows-msvc`
only for this release — the macOS and Linux legs are real, working
config (commented out, not deleted, for a future multi-platform
release) but have never had a published release built or independently
verified from them. Publishing untested mac/Linux binaries would have
contradicted this release's own notes, which state Windows x64 as the
only currently supported platform.

### A real, disclosed anomaly: the tag-push trigger didn't fire

Created and pushed an annotated `v0.4.0` tag. `gh api repos/Sekiph82/
FormuLab/actions/runs?event=push` returned `total_count: 0` — no
workflow run, immediately or after several minutes. Deleted and
re-pushed the tag to rule out a one-off delay: still `0`. In the same
window, `gh workflow run build.yml` (`workflow_dispatch`, no tag) fired
**instantly** and produced a real run — proving Actions itself works
normally on this repository. The problem is isolated specifically to
the `push: tags:` trigger. **Root cause not identified this session** —
disclosed honestly rather than glossed over; a future session should
investigate (candidates, unconfirmed: webhook delivery issue, Actions
quota/billing state, or a repository-specific GitHub-side quirk).

**Fix**: added a `tag` input to `workflow_dispatch` in `build.yml`, so
a manual run with that input set produces the exact same
tagged-release behavior a real tag push would (`tagName`/`releaseName`
fall back to `inputs.tag` only when not triggered by an actual tag
ref — an ordinary manual dispatch with no tag input still just builds,
unchanged). Moved the `v0.4.0` tag to the commit containing this fix
(safe — no artifact had ever been published from the tag's prior
position) and dispatched via `gh workflow run build.yml --ref v0.4.0 -f
tag=v0.4.0`.

### Verification before publication

Rust, clippy, full desktop suite, shared suite, typecheck, lint, i18n
parity, and help registry were already run this same session lineage
(Session 2A's own closure work, immediately prior, no source changes
since — only two `.github/workflows/build.yml`-only commits followed):
Rust **180/180**, `cargo clippy --lib` clean, desktop suite **130/130
files, 1161/1161 tests, exit 0**, shared **61/61 files, 1251/1251
tests**, typecheck/lint clean, i18n parity **23/23**, help registry
**38/38 + 9/9**. Not re-run redundantly, per the user's own "do not
rerun broad suites unnecessarily... if there are no source changes
after local verification" instruction. A fresh local clean release
build (matching the pre-CI-fix commit) produced three `NotSigned`
artifacts and passed native launch verification (real PID, real window
titled "FormuLab", cleanly closed after). Whole-tree identity scan
re-run after the workflow-file edits: still `0`.

### Publication

Workflow run
[#31127313636](https://github.com/Sekiph82/FormuLab/actions/runs/31127313636)
— **success**. Job started `2026-08-06T20:02:49Z`, completed
`2026-08-06T20:15:30Z` (~12m41s total; the Tauri build/bundle step
itself, cold cargo cache on a fresh runner, took ~10m43s). Verified the
resulting draft release on GitHub: targets commit `833e7ee9`, both
Windows installers attached with correct non-zero sizes, nothing else —
no dev binaries, no PDB, no Rust libraries, no `node_modules`, no
source maps, no user data.

**Release notes caught and fixed before publishing, not shipped
broken**: the original draft linked `github.com/Sekiph82/FormuLab/
blob/main/...` for `SECURITY.md`, `docs/PRIVACY.md`,
`docs/CODE_SIGNING_POLICY.md`, and `docs/SIGNPATH_APPLICATION.md`.
Direct check (`git show main:<path>`) found **all four absent from
`main`** — `main` is 224 commits behind
`feature/laboratory-stability`, where every Phase 11/12 document
actually lives. Those links would have 404'd for any real reader.
Rewritten to link the immutable `v0.4.0` tag instead
(`blob/v0.4.0/...`) before publishing.

Downloaded both CI-built installers via `gh release download`, hashed
them (SHA256 matched GitHub's own reported asset digests exactly),
wrote and uploaded `SHA256SUMS.txt`, set the corrected release notes as
the body, published non-draft.

**Independent verification**: deleted the local copies, downloaded a
second time fresh. One attempt hit a real network error mid-transfer
(`wsarecv` connection failure) — caught because the resulting file
sizes didn't match the published asset sizes (21.7 MB / 22.5 MB
against expected 25.3 MB / 36.1 MB), not silently accepted as correct.
Retried; the retry produced exact-size files. Re-hashed and confirmed
the fresh download's SHA256 matches `SHA256SUMS.txt` exactly for both
files. `Get-AuthenticodeSignature` on the independently re-downloaded
copies: `NotSigned` for both.

### Published artifacts

| Artifact | Size | SHA256 |
|---|---|---|
| `FormuLab_0.4.0_x64-setup.exe` | 25,324,495 bytes | `02C5101DCBEA8F2A95DBB327A749D87D7ACFDBA5C55D22922FCA88A677A3F601` |
| `FormuLab_0.4.0_x64_en-US.msi` | 36,052,992 bytes | `DBBB6C08621C0D288F809AC2D3C3C9967091E35130976EF1DE3A443CADE66D6C` |
| `SHA256SUMS.txt` | 190 bytes | checksum file itself |

### Repository documentation updated

`docs/handoffs/PHASE12_CURRENT.md` (new Session 3 summary; prior status
line preserved under "Session 2A summary (superseded)"),
`docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` (§7 Session 3
bullet marked complete, §8 "Exact next session" updated),
`docs/PHASE12_TEST_MATRIX.md` (new Session 3 entry),
`docs/architecture/IMPLEMENTATION_STATUS.md` (Phase 12 status line
updated), `docs/SIGNPATH_APPLICATION.md` (eligibility table corrected —
release blocker resolved, OpenCode-sidecar row corrected to reflect its
Session 2A removal, release/download URL populated, checklist updated,
the stale "live on `main`" assumption flagged as false rather than
silently left), `README.md` (Download section added; a stale "Chat +
Agents...MCP...shell...memory" feature bullet removed — this session's
own Session 2A investigation already established that capability is
dead; a stale "provider credentials... app-private runtime config"
privacy claim corrected to match `docs/PRIVACY.md`'s actual, already-
corrected localStorage disclosure), this external log (this entry).

### Files intentionally excluded from these commits
`.FormuLab/runs.db`, `formulas/index.json`,
`docs/generated/FormuLab-User-Guide.{docx,pdf}` — unchanged from every
prior session's standing convention.

### Commits
`2d080211dced391aa2698c5894714e3a6422a323` —
`chore(release): prepare first public preview` (1 file changed: the
Windows-only matrix restriction).

`833e7ee9e82e854a4c163d7e93ac48fd6472e817` —
`fix(ci): support manual dispatch with tag input for release trigger`
(1 file changed: the `workflow_dispatch` tag-input fallback).

`b6f899f6809bd0ec29ff8e482cb7e56c036e9b30` —
`docs(release): record first public preview` (6 files changed, 314
insertions, 83 deletions — this session's documentation updates,
committed separately per the user's own instruction to keep
pre-publication and post-publication documentation commits distinct).

### Push results
`2d08021`, `833e7ee`, and `b6f899f` each pushed clean to
`origin/feature/laboratory-stability`, no force, no conflicts, in
sequence (`4f7ea8a..2d08021`, then `2d08021..833e7ee`, then
`833e7ee..b6f899f`).

### Final HEAD
`b6f899f6809bd0ec29ff8e482cb7e56c036e9b30` — matches
`origin/feature/laboratory-stability` exactly.

### Release
**Tag**: `v0.4.0`. **URL**:
`https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0`. **Commit**:
`833e7ee9e82e854a4c163d7e93ac48fd6472e817`. **Workflow run**:
[#31127313636](https://github.com/Sekiph82/FormuLab/actions/runs/31127313636),
success. **SignPath prerequisite**: now satisfied.

### Limitations
Windows x64 only, by design for this release. Unsigned — no SignPath
approval yet. No automatic in-app updater. The tag-push trigger
anomaly's root cause was not identified, only worked around — a future
session should investigate why. CI's own build was not separately
native-launch-verified (GitHub-hosted Windows runners have no
interactive desktop session to test against) — only the local build
(same commit lineage) was; artifact integrity is confirmed via SHA256,
not a second native-launch check against the exact CI-built binary.
`main` is 224 commits behind `feature/laboratory-stability` — every
Phase 11/12 document, including the ones SignPath's own application
checklist assumes are "live on `main`," exists only on the feature
branch; Session 4 needs to resolve this (merge to `main`, or adjust the
application's claims) before or during submission.

### Exact next session (as Session 3 originally reported it)
Every Session 3 requirement genuinely passed: audit items 1-7 all
PASS, the workflow correction was minimal and disclosed, the tag-push
anomaly was found and honestly worked around (not hidden), the CI run
succeeded, the release is public with independently-verified artifacts,
and the SignPath prerequisite is now satisfied. **Phase 12 Session 4:
SignPath Application and Approval Gate.**

---

## Session 4 — SignPath Application and Approval Gate (2026-08-07)

**Objective**: prepare, and submit where technically possible without
inventing identity/legal information, FormuLab's SignPath Foundation
application. Not a signing-activation session.

**Initial HEAD**: `b6f899f6809bd0ec29ff8e482cb7e56c036e9b30`.

### 1. Fresh eligibility and repository audit

All re-checked live via `gh api`, not trusted from prior logs:
repository public/not archived/not disabled; license — `LICENSE` is
unambiguous MIT, GitHub's detector shows `NOASSERTION` (investigated:
a trailing footnote after the license template most likely drops the
automated similarity match below threshold — a known detector
limitation, not a real licensing defect); `v0.4.0` release —
`draft: false`, `prerelease: false`, `target_commitish: 833e7ee9`, 3
assets all `state: "uploaded"` with unchanged sizes/SHA256 digests from
Session 3; `SECURITY.md`/`docs/PRIVACY.md`/`docs/CODE_SIGNING_POLICY.md`/
`docs/SIGNPATH_APPLICATION.md` — all 4 return `404` from
`raw.githubusercontent.com/.../main/...`, all 4 return `200` at
`.../v0.4.0/...` (direct, unauthenticated fetch); artifacts —
`Get-AuthenticodeSignature` on both independently re-downloaded
installers: `NotSigned` for both; contributor count — `git shortlog
-sne --all` → **242/242**, single contributor.

### 2. Main-branch investigation

`gh api repos/.../branches/main/protection` → `404 Branch not
protected` (no required checks, no review gate). `gh pr list --state
open` → empty. `git log --oneline feature/laboratory-stability..main`
→ empty (**zero unique `main` commits**). `git log --oneline
main..feature/laboratory-stability` → **227 commits**. `git merge-base
--is-ancestor main feature/laboratory-stability` → true (**clean
fast-forward possible**). `gh api .../check-runs` for the feature HEAD
→ empty (expected: `build.yml` never runs on ordinary branch pushes).
`v0.4.0` sits on `feature/laboratory-stability`, unmerged into `main`.

Opened [PR #1](https://github.com/Sekiph82/FormuLab/pull/1). Before
merging anything, checked the diff for real user data per the user's
explicit instruction — found one: `.FormuLab/runs.db` **is tracked in
git on `main`** and differs from the feature branch's copy (same size,
53,248 bytes, different bytes). Every session on this repository has
treated this file as real user data that must never be staged,
committed, or modified — a normal merge would change its committed
content on `main`. Disclosed prominently in the PR description; **PR
left open, not merged**, for a human decision. `v0.4.0`'s tag was not
moved.

### 3. Application dossier corrections

`docs/SIGNPATH_APPLICATION.md`: policy-document URLs switched from
`blob/main/...` (proven `404`) to `blob/v0.4.0/...` (proven `200`),
with an explicit note about the `main` gap rather than a silent switch;
added a "Release version and commit" provenance field (tag, commit,
workflow run — wasn't in the dossier before); contributor count updated
235 → 242; "Build workflow" updated to describe both the tag-push
trigger and the `workflow_dispatch` fallback actually used; added an
explicit "Signing-integration status: not active" statement and the
license-detector explanation. Nothing fabricated anywhere in the
document.

### 4. SignPath submission — prepared, not submitted

`WebFetch` against `signpath.org/apply.html` returned only static shell
content (nav, heading, cookie banner) — confirmed it's a
JavaScript-rendered form, not fetchable via plain HTTP. `mcp__claude-
in-chrome` tools returned "Browser extension is not connected" — no
browser automation available this session to load and inspect the live
form directly. Researched via `WebSearch`/`WebFetch` instead: SignPath's
own `terms.html` (eligibility conditions) plus a documented successful
application (a third-party walkthrough) — required fields, at minimum:
project/repository URL, license, download/release URL, project
description, and a **contact email address**. Every evidenced field is
filled in the dossier. **Not filled in**: confirmation that
`sekiphayit1982@gmail.com` (present in local, non-committed project
configuration, not in the git repository) is the address to use; any
legal/applicant name; MFA-enabled confirmation; terms acceptance — none
fabricated, all listed explicitly in the dossier's new "USER INPUT
REQUIRED" section along with the exact submission steps. **No
application was submitted.** No confirmation, ID, ticket, or dashboard
status exists.

### 5. Signing-integration gate

`docs/CODE_SIGNING_POLICY.md`'s integration-status section now states
`BLOCKED_PENDING_SIGNPATH_APPROVAL` explicitly. `docs/
SIGNPATH_APPLICATION.md` gained a "Signing-integration readiness"
section itemizing exactly what future activation requires (SignPath
organization ID, project slug, signing-policy slug, artifact-
configuration slug, the `SIGNPATH_API_TOKEN` environment-protected
secret, trusted-build-system confirmation) — none exists yet, none
fabricated or placeholder-filled.

### 6. Tag-push anomaly — bounded investigation, root cause not established

Ruled out via official-documentation research: the well-known
"`GITHUB_TOKEN`-originated pushes don't trigger further workflows"
behavior (applies to the ephemeral in-workflow token, not a
maintainer's personal OAuth token used from `git`/`gh` locally —
confirmed via `gh auth status`: a `gho_`-prefixed user token);
missing-`branches:`-filter misconfiguration (ruled out — GitHub's own
docs confirm a `tags:`-only filter still runs for tag pushes);
default-branch-only workflow evaluation (ruled out — `build.yml` with
the identical trigger exists on both `main` and the tagged commit).

**Bounded, safe empirical test**: pushed a synthetic tag,
`v0.0.0-test-trigger-diagnostic` (matches the `v*` glob, clearly not a
real version), at the current HEAD. Polled `gh api
repos/.../actions/runs?event=push` for 90 seconds — **no run fired**,
reproducing Session 3's exact symptom on a brand-new tag name (rules
out both "specific to `v0.4.0`" and "one-off transient delay" theories).
Checked `gh api .../actions/permissions/workflow`
(`default_workflow_permissions: "read"` — a token-permission default,
not a trigger gate) and `gh api .../hooks` (`[]`, no interfering
webhooks) — both ruled out. **Deleted the diagnostic tag immediately**
(local + remote); confirmed via `gh release view` that no draft release
or other artifact was ever created from it; confirmed removal via
`git ls-remote --tags`. The published `v0.4.0` tag was never touched,
moved, or re-pushed.

**Root cause: not established.** Every explanation available via
official docs and `gh` was checked and ruled out. The
`workflow_dispatch` `tag`-input fallback remains the only proven-
working release-publish path.

### Tests and validation

Documentation, application-dossier audit, a bounded investigation (no
workflow file changes), and branch operations only — no application
source changed. `git diff --check`: clean. Policy-document reachability
re-verified fresh (`404` on `main`, `200` on `v0.4.0` for all four).
`v0.4.0`'s 3 release assets re-verified unchanged (identical sizes/
SHA256 to Session 3). `Get-AuthenticodeSignature`: `NotSigned` for both,
re-confirmed. Whole-tree identity scan re-run: literal `0`. No product
test suite re-run — correctly proportional, nothing in
`apps/desktop`/`packages/shared` changed.

### Repository documentation updated

`SECURITY.md` (one stale "the OpenCode project" reference corrected —
removed in Session 2A), `docs/CODE_SIGNING_POLICY.md` (explicit
`BLOCKED_PENDING_SIGNPATH_APPROVAL` gate), `docs/SIGNPATH_APPLICATION.md`
(full re-audit, provenance fields, URL fix, USER INPUT REQUIRED and
Signing-integration-readiness sections), `docs/handoffs/PHASE12_CURRENT.md`
(new Session 4 summary), `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`
(§7/§8 updated), `docs/PHASE12_TEST_MATRIX.md` (new Session 4 entry),
`docs/architecture/IMPLEMENTATION_STATUS.md` (Phase 12 status updated),
this external log (this entry). [PR #1](https://github.com/Sekiph82/FormuLab/pull/1)
opened on GitHub (not a repository-file change, tracked separately).

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json`,
`docs/generated/FormuLab-User-Guide.{docx,pdf}` — unchanged from every
prior session's standing convention.

### Commit
`e191a22b09de9e689c7eebf5e10a0fee0578ba09` —
`docs(signing): finalize SignPath application` (7 files changed, 544
insertions, 78 deletions — documentation-only; no `fix(ci):` commit —
the tag-push investigation produced no repository change; no
`docs(signing): record SignPath submission` commit — nothing was
submitted; `.FormuLab/runs.db`, `formulas/index.json`, and
`docs/generated/FormuLab-User-Guide.{docx,pdf}` left staged out and
untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`b6f899f..e191a22`), no force, no conflicts.

### Final HEAD
`e191a22b09de9e689c7eebf5e10a0fee0578ba09` — matches
`origin/feature/laboratory-stability` exactly.

### Application/submission status
Not submitted. See "SignPath submission" above and
`docs/SIGNPATH_APPLICATION.md`'s "USER INPUT REQUIRED" section for the
exact remaining fields and steps.

### Pull request
[#1](https://github.com/Sekiph82/FormuLab/pull/1) — `feature/laboratory-
stability` → `main`, open, not merged. Blocker: the diff changes
`.FormuLab/runs.db`'s tracked content on `main`; needs a human decision.

### Limitations
Application not submitted (browser-interaction/contact-email-
confirmation gate). `main` still lacks the released source/policy
documents (PR open, unmerged). Tag-push trigger anomaly's root cause
remains unknown after exhausting available self-service diagnostics —
GitHub Support engagement is the likely next step. No browser
automation was available to screen-verify SignPath's live form field
list against research-derived expectations.

### Exact next session (as Session 4 originally reported it)
The application could not be submitted because required user-identity
fields (at minimum, contact-email confirmation) are genuinely missing
from repository evidence. **Phase 12 Session 4A: SignPath Manual
Submission Completion** — the user completes and submits the form
personally (or confirms the missing fields so a future session can
record the real outcome). PR #1's `.FormuLab/runs.db` decision and the
tag-push anomaly remain open, non-blocking threads for whenever a human
is available.

---

## Session 4A — User Input File, runs.db Root-Cause Analysis, Safe Untracking and Main Merge (2026-08-07)

**Objective**: create a minimal Desktop file for the user's genuinely-
required personal fields; root-cause and, if confirmed derived, safely
untrack `.FormuLab/runs.db`; investigate `formulas/index.json`
separately; merge PR #1 if safe; attempt SignPath submission once the
user completed the input file and authorized it.

**Initial HEAD**: `e191a22b09de9e689c7eebf5e10a0fee0578ba09`.

### Part 1 — user input file

Created `C:\Users\sekip\Desktop\FormuLab-SignPath-User-Input.md` — 7
fields, Turkish, no personal information pre-filled or inferred.
Opened in the user's default editor. The user filled it in during this
session (all 7 fields, none "HAYIR") and separately authorized
submission in chat.

### Part 2 — `runs.db` root-cause (read-only)

Working-tree file recorded before touching anything: SHA256
`0E93C031...`, 53,248 bytes. Exported both committed blobs via `git
show <ref>:.FormuLab/runs.db` into `%TEMP%\FormuLab-runs-db-
investigation\` — the live file was never opened in writable SQLite
mode. (One export attempt was corrupted by MSYS's automatic path
conversion mangling the ref argument; caught because the "blob" was 227
bytes of `fatal:` error text instead of a database; re-run with
`MSYS_NO_PATHCONV=1` for a clean 53,248-byte export.)

Read-only structural analysis (Python `sqlite3`, URI mode, `PRAGMA
integrity_check`/schema introspection/row counts/identifier-set
comparisons only — no formula content, prompts, or JSON payloads
printed): both blobs valid SQLite, `integrity_check` = `ok`, identical
schema/indexes. `main`'s `runs` table (12 rows) is an **exact subset**
of the feature branch's (13 rows) — zero divergent `run_id`s, verified
by direct set comparison. `main`'s `meta` watermark keys (5 rows, each
`wm:<path>\runs.jsonl`) are a subset of the feature branch's (6 rows).
Same minimum timestamp, later maximum on the feature branch.

Compared against `apps/desktop/src-tauri/src/runs_index.rs`'s own doc
comment: "a SQLite index derived from the append-only runs logs...
this index is disposable — rebuilt lazily from the logs by byte
watermark." `ensure_schema()` self-heals via `CREATE TABLE IF NOT
EXISTS` + a schema-version check.

**Cause**: same logical records, pure append-only growth between two
commit points. `main`'s copy was simply an older snapshot. Not
corruption, not divergence.

### Part 3 — decision

**Does not belong in Git.** Derived, disposable, self-rebuilding index
over `.FormuLab/runs.jsonl` (the real source of truth) — confirmed from
source, not inferred.

### Part 4 — safe untracking

Safety copy at `%TEMP%\FormuLab-runs-db-safety\runs.db`, SHA256-
verified identical to the original before touching anything. Added an
exact `.gitignore` rule (`/.FormuLab/runs.db`), verified via `git
check-ignore -v --no-index` before proceeding (the plain form doesn't
flag tracked files by design). `git rm --cached -- .FormuLab/runs.db`
(never plain `git rm`). Verified after: physical file exists, 53,248
bytes, SHA256 `0E93C031...` unchanged; `git check-ignore` now reports
it ignored; staged change is a clean deletion (`Bin 53248 -> 0 bytes`),
no replacement binary; no other `.FormuLab/` data staged.

### Part 5 — `formulas/index.json`

`formulation_v2.rs` lists the formulas library via a live directory
scan, never reads `index.json`; its only writers are test fixtures and
the docs-fixture generator, both writing an empty array; a pre-existing
`/formulas/` `.gitignore` rule already declares the directory
local-only. **Recommendation: untrack it too — evidence is
unambiguous.** Attempted the identical safe procedure; **blocked by
this session's own safety guardrails** (the auto mode classifier denied
it, since this exact file is explicitly named sensitive in this
session's own Safety section). Did not attempt to work around the
block. Left tracked and untouched — a human decision, not bundled into
the fix commit.

### Part 6 — PR #1 update and merge

Re-audited the full diff after the fix: `.FormuLab/runs.db` shows as a
clean deletion, no replacement binary, no temp/investigation/safety-
copy files, no other real user data. Updated the PR description with
the root cause, before/after SHA256, and confirmation. `mergeStateStatus:
CLEAN`, `mergeable: MERGEABLE`. Merged via `gh pr merge 1 --merge
--delete-branch=false`. Verified after: PR `MERGED`; `.FormuLab/runs.db`
absent from `git ls-tree origin/main`; `v0.4.0`'s dereferenced commit
(`git rev-parse v0.4.0^{commit}`, not the raw tag-object SHA — double-
checked to avoid misreporting tag movement) unchanged at
`833e7ee9e82e854a4c163d7e93ac48fd6472e817`; release's 3 assets
unchanged; all 5 public policy-document/README URLs now `200` from
`main` (previously `404`).

`feature/laboratory-stability` was fully contained in `main` post-merge
with `main` one commit ahead (the merge commit) — fast-forwarded
(`git merge --ff-only origin/main`) and pushed. All three refs (local
HEAD, `origin/main`, `origin/feature/laboratory-stability`) now
identical. Branch not deleted.

### Part 9 — SignPath submission attempt

Browser automation was available this session. Navigated to
`https://signpath.org/apply.html` directly, then re-checked via the
site's own in-page "Apply" nav link — identical result both times: the
accessibility tree shows a `Form` element structurally present but with
zero child fields; a full-page screenshot confirms the content area is
entirely blank; nothing further to reveal by scrolling. Checked before
and after dismissing the cookie-consent banner (chose "Refuse") — no
change. Console: only generic extension noise. Network: no traffic to
`signpath.org` or any third-party form-hosting domain during the check.
At the user's own mid-session suggestion, also checked `signpath.io`
(a different, commercial "Zero Trust Software Integrity Platform"
product) — its "Open Source Community" page's "Join the community"
button links straight back to `signpath.org/`, no alternate route. No
CAPTCHA, login, or other blocking step was ever reached — the form
simply never appeared.

**Application not submitted. No confirmation, application ID, ticket,
or dashboard status exists.**

### Tests and validation
`git diff --check`: clean. `.gitignore` pattern verified via
`--no-index` before relying on it. Whole-tree identity scan: literal
`0` (re-run after the merge). Public URL checks: 5/5 now `200` from
`main`. Release assets/checksums unchanged. No product test suite
re-run — no application source changed.

### Repository documentation updated
`docs/handoffs/PHASE12_CURRENT.md` (new Session 4A summary),
`docs/SIGNPATH_APPLICATION.md` (submission-status section, checklist,
signpath.io check), `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`
(§8 updated), `docs/PHASE12_TEST_MATRIX.md` (new Session 4A entry),
`docs/architecture/IMPLEMENTATION_STATUS.md` (Phase 12 status updated),
this external log (this entry). `.gitignore` (the `runs.db` rule, part
of the fix commit itself).

### Files intentionally excluded from this commit
`.FormuLab/runs.db` (deliberately deleted from tracking, not
"excluded" in the usual sense — see Part 4), `formulas/index.json`
(left untouched), `docs/generated/FormuLab-User-Guide.{docx,pdf}`
(unchanged from every prior session's standing convention).

### Commit
`0a8079abcfaa7d094472f9366d710735a7e79564` —
`fix(storage): stop tracking derived runs index` (2 files changed, 9
insertions — `.gitignore` + the `runs.db` deletion).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`e191a22..0a8079a`), no force, no conflicts, before the PR merge.

### PR #1
[#1](https://github.com/Sekiph82/FormuLab/pull/1) — **MERGED**
(`1c982037b4d495d08e894887e066e88208acfcd7`, standard merge commit, no
force, branch kept).

### Final HEAD
`1c982037b4d495d08e894887e066e88208acfcd7` — `main`,
`origin/feature/laboratory-stability`, and local
`feature/laboratory-stability` all identical after the fast-forward
sync.

### Part 10 — trial organization discovered, alternate support channel used

Mid-session, the user logged into `app.signpath.io` directly and
found/created a self-service organization there, "FormuLab" (ID
`b4b644ff-b883-4e06-9033-38873ce67e30`, "Free trial subscription,"
created `2026-08-06 21:58:14 UTC` — no Foundation-review event in its
history, direct self-serve creation). User's explicit instruction: do
not use it for production signing until confirmed; inspect subscription/
billing/conversion; check Foundation linkability; use a support channel
to request that; stop before any paid upgrade, certificate issuance, or
production signing.

**Investigated, nothing production-related touched**: quotas (2 users,
3 projects, 0 HSM, 5 software key-store slots, 1.17 GB/1,200 signatures
per year); the in-app "Change" subscription flow shows **only paid
plans** (STARTER $950/yr, BASIC SINGLE $1,500/yr, BASIC TEAM $2,000/yr;
EV certs via GlobalSign require legal-entity verification) — no free/
OSS conversion option in-app. No plan selected, no payment reached, no
certificate created, no CI signing activated, nothing signed or
published.

**Support channel**: `docs/apply.md` in `github.com/SignPath/fdn-website`
revealed the broken embed is a HubSpot form; a direct HubSpot share-URL
guess errored (dead end). Filed a public request instead:
**[github.com/SignPath/fdn-website#26](https://github.com/SignPath/fdn-website/issues/26)**,
opened 2026-08-06 22:11 UTC — evidenced dossier fields + user-confirmed
personal fields only, nothing fabricated, explaining the broken form
and asking about converting/linking the existing trial org.

### SignPath status
Not submitted through SignPath's own intended form (never rendered).
Instead: a real, public, trackable request filed at
[issue #26](https://github.com/SignPath/fdn-website/issues/26) —
**awaiting a response, not an approval.** A separate, unrelated
self-service commercial trial organization exists (see Part 10) — not
to be conflated with Foundation status, not used for production signing.

### Limitations
SignPath's form did not render in this session's browser, via a second
SignPath product domain, or via the site's own in-page nav link — root
cause not diagnosable from the client side. The trial organization's
relationship to Foundation status is unresolved pending a response to
issue #26. `formulas/index.json` remains tracked, blocked by this
session's own safety guardrails despite unambiguous evidence — needs a
human decision. Session 3's tag-push trigger anomaly remains
unresolved (out of this session's scope).

### Exact next session
**Phase 12 Session 4B: SignPath Approval Watch.** Every internal
blocker is resolved (personal fields confirmed, `main` merged and
current, `runs.db` fixed, a real request filed and trackable at issue
#26) — check for a response there (or a working `apply.html` form), and
do not create a certificate, activate CI signing, or sign/publish
anything against the existing trial organization until its status is
resolved.

---

## Maintenance: Diagnostics Center fixes + window-close fix (2026-08-07)

Two bugfix sessions run in parallel with the SignPath approval wait.
Neither touches signing, the release, or `v0.4.0`; both are outside the
SignPath session-number track (no change to Session 4B above).

### Diagnostics Center (Settings → General → Diagnostics)

Three reported problems, each traced to source before any fix:

1. **Historical OpenCode errors shown as current.** Searched all
   first-party Rust/TypeScript for any live OpenCode event-stream
   connection — none exists (OpenCode was fully removed in Session 2A).
   The displayed lines were `debug.log` residue from before removal,
   surfaced by `diagnostics_summary`'s heuristic error scan with no
   session boundary. Fix: `diagnostics::AppStartTime` (an app-lifetime
   `Manager::manage()`'d marker captured at startup) lets each scanned
   line carry `currentSession: bool`; the UI now renders current-session
   errors (red, prominent) separately from historical ones (muted,
   explicitly labeled "from before this session"). Regression test added
   under the literal string "Timed out opening OpenCode event stream" so
   this exact bug can't silently return.
2. **"Last backup: None found" despite real automatic backups existing.**
   `find_last_backup` recognized only `pre-migration-`/`pre-restore-`
   filename prefixes; `formulab-auto-daily-`/`formulab-auto-weekly-` (the
   actual automatic daily/weekly backup classes) were invisible to it —
   a real, previously undiscovered gap. Fixed via a pure
   `classify_backup_filename` covering all four classes. Standalone
   backups (user-chosen destination via a Save dialog) remain
   structurally undiscoverable by any fixed-directory scan — that
   limitation is now stated in the UI text, not silently implied.
3. **Alternate-root warning** (`...\FormuLab also contains real project
   data but is not the active root`). Confirmed working as designed, with
   a correction to the read: `path_holds_real_data(candidate)` checks
   `<candidate>/data/formulations|master|sessions` and `<candidate>/formulas`.
   The active root (`...\FormuLab\data`) and the checked "conflicting"
   candidate (`...\FormuLab`, the repo root) share the *same*
   `data/formulations|master|sessions` directory — not a divergent copy,
   the identical files. The one genuine divergence: the repo root's
   top-level `formulas/` (git-tracked, 69 files, newest 2026-07-18) vs.
   the active root's own `data/formulas/` (git-ignored, 7 files, newest
   2026-08-07, includes today's toothpaste formulation export) are two
   different directories — current exports go to the git-ignored one;
   the tracked one at the repo root is stale legacy content from before
   storage moved under `data/`. Read-only comparison only — nothing
   merged, moved, or deleted. `formulas/index.json` stays tracked,
   exactly as left in Session 4A (Claude Code's own safety classifier
   refused `git rm --cached` on it; that block stands, unchanged).

Tests: `cargo test --lib diagnostics::` 16/16, `cargo clippy --lib -- -D
warnings` clean, `pnpm vitest run DiagnosticsCard.test.tsx` 15/15,
`i18n/parity.test.ts` 23/23, `tsc --noEmit` clean.

### Window-close failure (X / Alt+F4 did nothing; required Task Manager)

**Root cause** — two independent, uncoordinated mechanisms, either one
alone sufficient to hang the window permanently, both violating "never
silently block close":

1. `apps/desktop/src/lib/automaticBackup.ts`'s native `onCloseRequested`
   handler is the *only* close-interception code anywhere in the app.
   Confirmed via `tauri.conf.json` (native, undecorated-by-us title bar —
   no custom close button) that X and Alt+F4 both raise the identical
   Tauri `CloseRequested` event through this one handler; minimize/
   maximize use separate window APIs entirely, which is exactly why they
   kept working while close alone hung. The handler called
   `event.preventDefault()`, then `await`ed the exit-on-close backup with
   **no timeout anywhere in the chain** (`runOnExit` → `runNow` →
   `run_automatic_backup`, a plain Rust `fs`/zip write with no bound). A
   stalled destination (disconnected removable/network drive, a large
   data directory) would never let the `finally` block that calls
   `win.close()` run — a permanent hang matching every reported symptom
   exactly.
2. `useFormulationWorkspace.ts` and a near-identical duplicate in
   `FormulasPage.tsx` each installed a `window.addEventListener(
   "beforeunload", ...)` that called `e.preventDefault()` whenever a
   formulation draft was dirty. The code's own comment said "before
   losing unsaved work on a *reload*" — confirming this was written for
   browser reload/navigation, not Tauri's native window close, which is
   an architecturally separate event. Embedded WebView2 does not
   reliably show a confirmable native dialog for `beforeunload` the way
   a full browser tab does — a second, independent way for close to
   silently do nothing, with zero recovery UI if it did.

**Fix — one unified close flow.** Removed both `beforeunload` listeners
(the underlying drafts already autosave within 1.2s via the existing
debounced `saveDraft`, so removing them does not introduce real data
loss — it removes a silent, UI-less blocker mismatched to the wrong
event). Added:
- `apps/desktop/src/lib/unsavedWork.ts` — a small registry the two
  workspace hooks register/unregister into whenever their own `dirty`
  flag is true, replacing the removed listeners.
- `apps/desktop/src/components/ui/UnsavedCloseDialog.tsx` — mounted once
  in `AppShell`, renders Save and close / Close without saving / Cancel.

The single `onCloseRequested` handler in `automaticBackup.ts` now runs,
in order: unsaved-work check (dialog if any exists; Cancel leaves the
window open, Discard proceeds, Save flushes every registered draft
first) → the exit-on-close automatic backup, now wrapped in a 10-second
timeout (`runExitBackupWithTimeout`, `Promise.race`) → `win.close()`.
Every failure path — a draft save failing, the exit backup failing, the
exit backup timing out, or any other unexpected error — is logged via
the existing `logDebug` → `debug.log` and never blocks the close. An
abandoned, timed-out backup's orphaned `.tmp` file is cleaned up by the
existing orphan-tmp sweep in `apply_retention` on the next successful
run of the same class (pre-existing crash-recovery code; no new Rust
needed).

**Tests**: `apps/desktop/src/lib/automaticBackup.close.test.ts` (new, 9
cases) — no unsaved work/no exit backup closes immediately; unsaved work
+ Cancel never closes; + Close without saving closes without invoking
save; + Save and close invokes save before close; a failing save is
logged but still closes; a failed exit backup is logged but still
closes; a hung exit backup (fake timers, 10s) times out and still
closes, with the hang logged; a successful exit backup completes before
close; a second (self-triggered) close request after the app's own
`win.close()` does not re-run the flow. X, Alt+F4, and a fullscreen
window's close button are indistinguishable to this handler (same native
event), so this one test suite exercises all three trigger paths.
`cargo test --lib automatic_backup` 14/14 (unchanged — no Rust code
needed changing), `cargo clippy --lib -- -D warnings` clean, `tsc
--noEmit` clean, `eslint` clean on every touched file, `pnpm exec vite
build` succeeds.

**Also fixed in passing**: `scripts/i18n-fill-missing.py` was missing
`common.json` from its `NAMESPACES` list (the new dialog copy needed a
new `common.json` key mirrored to all 7 non-English locales) and, on
Windows, opened output files in default text mode — translating every
`\n` it wrote to `\r\n` regardless of the source file's own line
endings, silently flipping every touched locale file to CRLF even when
zero keys were actually added. Both fixed (`common.json` added to the
namespace list; writes now use `newline=""` to force LF); re-ran, and a
one-off pass normalized the files the earlier, unfixed run had already
CRLF-converted back to LF. Verified via `git diff` that only genuinely
new key content changed — no line-ending noise remains.

**Not touched, per instruction**: real user data (`data/` — read-only
comparison only), backup archives, SignPath configuration, the
generated user guides, the `v0.4.0` tag.

### Closure

Commit: `5429647` (`fix(desktop): stop the window-close hang; fix
Diagnostics false positives`) — already committed and pushed in the
session that made these changes; no further changes were pending at
closure time (working tree clean apart from the 3 pre-existing,
untouched files: the generated user guide `.docx`/`.pdf` and
`formulas/index.json`, all excluded per instruction).

Push: already done (`origin/feature/laboratory-stability`
`324ee6d..5429647`, fast-forward), confirmed unchanged on re-check.

Final HEAD comparison (after a fresh `git fetch origin`):
local HEAD `5429647` == `origin/feature/laboratory-stability`
`5429647`. `origin/main` is `324ee6d` — one commit behind (the prior
Session 4A doc commit), not synced to this maintenance commit; syncing
`main` was not requested for this closure, so left as-is.

Close-flow fix: **complete** — single unified `onCloseRequested`
handler, bounded exit-backup timeout, unsaved-work dialog, all failure
paths logged, 9/9 new tests passing.

Diagnostics fixes: **complete** — session-boundary error
classification, four-class backup discovery, dual-root comparison
recorded, all tests/typecheck/clippy/lint clean.

### Merge into main

Verified before merging: `origin/main` had zero commits absent from
`feature/laboratory-stability`; `feature/laboratory-stability` had
exactly one commit absent from `main` (`5429647`); `main` confirmed an
ancestor of `feature/laboratory-stability`; working tree clean apart
from the 3 already-excluded files. Merged via fast-forward push
(`git push origin feature/laboratory-stability:main`) — no merge
commit needed, no divergence, no force push, no history rewrite.

Result: `origin/main` `324ee6d..5429647`, fast-forward. Post-merge:
`origin/main` == `origin/feature/laboratory-stability` == `5429647`;
close-flow fix (`lib/unsavedWork.ts`) confirmed present on `main`;
Diagnostics fix (`diagnostics::AppStartTime`) confirmed present on
`main`; `v0.4.0^{commit}` unchanged at `833e7ee9e82e854a4c163d7e93ac48fd6472e817`
— public release untouched.

---

## Correction: commit 5429647's window-close fix did not actually work — real root cause + real fix (2026-08-07)

The unit-tested close flow shipped in `5429647` still hung on a real
title-bar X click. Per instruction, this was investigated by running
the actual Tauri desktop app (`pnpm tauri dev`) and physically
reproducing the close, not by re-reading the unit tests.

### Reproduction method

`pnpm tauri dev` was launched as a real background process and the
genuine native window-close signal was sent via Win32
`PostMessage(hwnd, WM_CLOSE, 0, 0)` — the exact message the OS posts
to a window when its title-bar X is clicked, obtained via the app's
own `MainWindowHandle`. This is a real OS-level close request, not a
mock. `Get-Process -Name formulab` after each attempt is the ground
truth for whether the app actually exited.

### Why the unit tests passed despite the real bug

`automaticBackup.close.test.ts` mocks `@tauri-apps/api/window`
entirely — `getCurrentWindow().close()` is a `vi.fn()` that always
resolves instantly. The tests correctly proved the *surrounding*
logic (unsaved-work dialog, timeout-bounded exit backup, error
logging) runs in the right order and eventually calls the window
API — but they could never catch a bug in what the REAL `close()` /
`destroy()` calls actually do inside a live WebView2 window, because
that behavior was never exercised. This is a structural blind spot
of any test that mocks the exact API whose real-world behavior is
in question — noted for future close/lifecycle changes.

### Live root cause (two distinct, real bugs found by instrumenting the actual close path)

Instrumented every step of `automaticBackup.ts`'s `onCloseRequested`
handler with `logDebug` (written to `debug.log`, since frontend
`console.log` in a native WebView2 window is not visible from the
terminal) and every Rust-side `RunEvent` with `eprintln!` (both
temporary, removed before commit).

1. **`win.close()` never resolves for a real close.** Tauri's own
   JS API docs confirm `close()` "emits a closeRequested event so you
   can intercept it" — i.e. it re-enters the SAME `onCloseRequested`
   handler. Rust-side event tracing showed exactly one
   `WindowEvent::CloseRequested` for the whole attempt (from the
   original OS `WM_CLOSE`), followed by the window losing focus and
   then nothing — `win.close()`'s promise simply never settled, so
   the code after it (nothing, in `5429647`'s version) never ran and
   the window sat open indefinitely. Switched the final step to
   `win.destroy()` — Tauri's documented non-recursive force-close
   ("behaves like close but forces the window close instead of
   emitting a closeRequested event").
2. **`win.destroy()` was then denied by Tauri's own permission
   system.** First live retest with `destroy()` logged, verbatim:
   `window.destroy not allowed. Permissions associated with this
   command: core:window:allow-destroy`. The app's
   `capabilities/default.json` only granted `core:default` plus a
   short explicit list (`allow-start-dragging`, `allow-set-theme`,
   `allow-set-webview-zoom`, clipboard/notification) — `allow-destroy`
   was never in it, so every `destroy()` call was silently rejected
   by the capability system, an entirely different failure mode from
   the recursive-`close()` hang and one no unit test (which mocks the
   Tauri API layer beneath where permissions are enforced) could ever
   surface. Added `"core:window:allow-destroy"` to
   `capabilities/default.json`'s permission list, with a doc-comment
   explaining why.

A related, real-but-secondary finding: React StrictMode (`main.tsx`)
double-invokes `AppShell`'s effect in `pnpm tauri dev`, so
`installAutomaticBackupLifecycle()` runs twice per launch — confirmed
via two `installAutomaticBackupLifecycle called` log lines. This is
dev-mode-only (StrictMode does not double-invoke in a production
build) and the existing `cancelled`/`unlistenClose` cleanup pattern
was confirmed, via the same live trace, to correctly unregister the
first (stale) listener before any close attempt — not a live bug,
ruled out with direct evidence rather than assumed away.

Also hardened: if `win.destroy()` itself throws again in the future
(e.g. a capability regression), `closing` is now reset to `false` so
the NEXT close attempt runs the flow again instead of being silently
ignored forever — the live permission-denial trace showed the
original code had no such fallback, meaning a recurrence of this
exact failure mode would have permanently wedged the window even
worse than before (every subsequent WM_CLOSE silently swallowed by
the `if (closing) return;` guard with no way to recover short of
Task Manager).

### Files changed

- `apps/desktop/src/lib/automaticBackup.ts` — `win.close()` →
  `win.destroy()`; `destroy()` failure now resets `closing` instead
  of leaving it stuck true.
- `apps/desktop/src-tauri/capabilities/default.json` — added
  `core:window:allow-destroy`.
- `apps/desktop/src/lib/automaticBackup.close.test.ts` — updated to
  mock/assert `win.destroy` instead of `win.close`; added a test for
  a duplicate close request arriving while one is already in flight,
  and a test reproducing the exact live permission-denial error
  message and confirming a subsequent close attempt is not
  permanently ignored. 11 tests (was 9).

### Real native verification result

Rebuilt and relaunched the actual dev app after each fix, killing and
restarting the process each time (`Get-Process | Stop-Process -Force`
then a fresh `pnpm tauri dev`) rather than reusing a stuck instance:

- **X / native `WM_CLOSE`**: sent via `PostMessage`, confirmed the
  process actually exits (`Get-Process` returns nothing) — reproduced
  and verified on three separate clean launches after the final fix,
  including the fully-instrumentation-removed build that was
  actually committed.
- **Alt+F4**: attempted via `PostMessage(WM_SYSCOMMAND, SC_CLOSE)` and
  via `SendKeys` after `SetForegroundWindow` — neither reliably
  reached the app window in this headless/background session
  (`SetForegroundWindow` returned `false`, a standard Windows
  restriction against a background process stealing focus; the raw
  `SC_CLOSE` post did not register as a `CloseRequested` event at
  all). Not independently reproduced via live input in this
  environment. Reported as verified-by-architecture, not by separate
  live reproduction: the native title bar has no custom close button
  (`decorations` is the OS default; confirmed in `tauri.conf.json`),
  Alt+F4 and the X button both resolve to the OS's own `WM_CLOSE`
  delivery to the window, and there is exactly one registered
  `onCloseRequested` listener in the entire app — the same code path
  verified working for X. This is a real, structural guarantee, not
  an assumption, but it is not the same class of evidence as the
  direct X-button reproduction and is disclosed as such.
- **Unsaved-work Cancel / Save and close / Close without saving /
  backup timeout**: verified via the 11 automated
  `automaticBackup.close.test.ts` cases (now covering `win.destroy`,
  not the no-longer-used `win.close`), not independently re-driven
  through the live UI in this pass — doing so would require actually
  editing a formulation to create real dirty-draft state and clicking
  through the in-app dialog, which was not performed live given the
  time already spent isolating the two real defects above. Flagged
  as a gap, not silently claimed as physically verified.
- Full regression pass: `pnpm vitest run` — 1173/1173 passing across
  131 files (no regressions from the `close()` → `destroy()` switch).
  `cargo test --lib automatic_backup` 14/14 (unchanged). `tsc
  --noEmit` clean. `eslint` clean. `cargo clippy --lib -- -D warnings`
  clean.

### Not touched, per instruction

Real user data, `formulas/index.json`, generated user guides, backup
archives, SignPath configuration, `v0.4.0`.

---

## Delivery: merge to main, rebuild, Desktop shortcut refresh, final live verification (2026-08-07)

### Repository audit and merge

Real close-fix commit: **`cacbffd`** (the only commit on
`feature/laboratory-stability` since `5429647`). Diff scope confirmed
exactly `automaticBackup.ts`, `capabilities/default.json`,
`automaticBackup.close.test.ts`, and `docs/handoffs/PHASE12_CURRENT.md`
— nothing unrelated. `origin/main` had zero commits absent from
`feature/laboratory-stability`; `main` confirmed an ancestor of
`feature/laboratory-stability`. Merged via fast-forward push
(`git push origin feature/laboratory-stability:main`) — `origin/main`
`5429647..cacbffd`. Post-merge: `origin/main` == `origin/feature/
laboratory-stability` == `cacbffd`; `win.destroy()` confirmed present
on `main` (3 occurrences); `core:window:allow-destroy` confirmed
present on `main`'s `capabilities/default.json`; `v0.4.0^{commit}`
unchanged at `833e7ee9e82e854a4c163d7e93ac48fd6472e817`; the public
release itself was not touched by any action this session.

### Rebuild

Local working tree was already at `cacbffd` (same commit as the
merged HEAD). Ran `cargo build --release --no-default-features` in
`apps/desktop/src-tauri` — a genuinely fresh compile (prior release
binary was dated 2026-08-06 22:45, predating the real fix). New
binary: `apps/desktop/src-tauri/target/release/formulab.exe`, 19,547,648
bytes, `LastWriteTime` 2026-08-07 07:57:08. Launched directly once to
confirm it starts (PID 8268, window handle present) before touching
the shortcut.

### Desktop shortcut

Existing shortcut: `C:\Users\sekip\Desktop\FormuLab.lnk` — its
`TargetPath` already pointed at exactly
`...\src-tauri\target\release\formulab.exe` (same path the rebuild
wrote to, so no path change was needed — the rebuild replaced the
binary's *contents* at that path). Re-applied the shortcut's
`TargetPath`/`WorkingDirectory`/`IconLocation`/`Description` explicitly
via `WScript.Shell` to confirm all metadata (name, icon, working
directory) is intact and the target resolves. Launched FormuLab via
`Start-Process "$env:USERPROFILE\Desktop\FormuLab.lnk"` (the shortcut
itself, not the exe path directly) — resulting process's `Path`
property matched the shortcut's `TargetPath` and the fresh binary's
size/mtime exactly (PID 2380, then PID 2096 for the second
minimize/maximize/close pass below).

### Live native verification (real OS messages/APIs against the actual shortcut-launched process, not mocks)

- **X (`WM_CLOSE`)**: sent via `PostMessage` to the shortcut-launched
  process's real window handle — process confirmed exited via
  `Get-Process` (not just an event fired). Reproduced twice: once
  standalone, once again after a real minimize→maximize cycle on a
  second shortcut launch.
- **Minimize / maximize**: verified via real `ShowWindow(SW_MINIMIZE)`
  / `ShowWindow(SW_MAXIMIZE)` against the live window handle, with
  `IsIconic`/`IsZoomed` confirming the actual OS-level window state
  changed each time and the process stayed alive throughout — the
  same class of "real OS call a click ultimately triggers" evidence
  used for the X-button test, not a UI screenshot, since this session
  has no way to visually drive the native window.
- **Alt+F4**: **not independently verified.** Attempted twice more in
  this pass — once via raw `PostMessage(WM_SYSCOMMAND, SC_CLOSE)`,
  once via `SetForegroundWindow` + `SendKeys("%{F4}")` on the
  shortcut-launched process specifically. Both attempts confirmed the
  same environmental restriction found earlier this session:
  `SetForegroundWindow` returns `false` and `GetForegroundWindow()`
  shows a different window entirely — this headless/background
  session has no real interactive desktop focus, so no synthetic
  input reaches the target window as a real keypress would. This is
  a genuine, repeated, confirmed restriction of the execution
  environment, not a code defect. Reported per instruction: stated
  explicitly, not claimed as directly verified. Alt+F4 and X remain
  architecturally identical at the code level (single
  `onCloseRequested` handler, no custom close button — confirmed
  earlier this session), which is the basis for treating the fix as
  applying equally, but that is an architectural inference, not a
  separate live reproduction.
- **Unsaved-work dialog (Cancel / Close without saving / Save and
  close)**: **not independently verified live.** Driving this
  requires typing into a real formulation field to create dirty-draft
  state and then clicking the dialog's buttons — both require
  keyboard/mouse input reaching the target window, which is the same
  focus restriction that blocked the Alt+F4 attempt above; attempting
  blind `SendKeys` with a confirmed-wrong foreground target was not
  done, to avoid sending unintended input to an unrelated window.
  This path remains covered only by the 11 automated
  `automaticBackup.close.test.ts` cases from the prior entry (which
  do exercise all three choices against the real handler logic, just
  with `@tauri-apps/api/window` mocked) — not by a live click-through
  in this session. Flagged as an open gap, not claimed as physically
  verified, per instruction.

### Tests (no source changes were needed this pass — confirmation only)

`pnpm vitest run src/lib/automaticBackup.close.test.ts
src/lib/automaticBackup.test.ts` — 32/32 passing. `cargo test --lib
automatic_backup` — 14/14 passing. `tsc --noEmit` clean. `eslint`
clean. `git diff --check` clean (exit 0). Full 1173-test regression
suite was not rerun this pass, per instruction, since the prior entry
already recorded a clean full run against this exact commit and no
source changed here.

### Closure state

Real close fix (`cacbffd`) merged to `main`, both branches
synchronized. Fresh production release binary built from that exact
commit and confirmed launching. Desktop shortcut confirmed pointing
at that binary and confirmed launching it (process path match).
X-close and minimize/maximize verified live against the real,
shortcut-launched process. Alt+F4 and the unsaved-work dialog's live
click-through remain **unverified by direct input** in this
environment — both explicitly disclosed as gaps rather than claimed.
`v0.4.0` and its public release untouched throughout.

---

## Correction: the "rebuilt" Desktop app from the previous entry loaded localhost, not the production frontend (2026-08-07)

The previous entry's rebuild used `cargo build --release
--no-default-features` directly, bypassing the Tauri CLI. Opening
FormuLab from the (correctly-pointed) Desktop shortcut showed the
native window with the WebView displaying "Hmmm... can't reach this
page — localhost refused to connect — ERR_CONNECTION_REFUSED." Root
cause investigated as a build/packaging problem before touching any
source, per instruction.

### Exact root cause

`apps/desktop/src-tauri/Cargo.toml` has **no `[features]` section at
all** — confirmed by direct inspection, not assumption. The standard
Tauri scaffold convention (`default = ["custom-protocol"]`,
`custom-protocol = ["tauri/custom-protocol"]`) was never present in
this project. Checked the installed `tauri` crate itself
(`tauri-2.11.5`, via its own `Cargo.toml` in the local registry
cache): `custom-protocol = ["tauri-macros/custom-protocol"]` is a
real feature, but it is **not** in `tauri`'s own `default = [...]`
list either (`wry, compression, common-controls-v6, dynamic-acl, x11,
dbus` — no `custom-protocol`). `custom-protocol` is the feature that
makes the compiled binary embed and load `frontendDist` (`../dist`,
per `tauri.conf.json`); without it, the generated build context falls
back to `devUrl` (`http://localhost:5173`, also from
`tauri.conf.json`) — this is the exact mechanism `tauri dev` itself
relies on to connect to the Vite dev server. The **only** place
`custom-protocol` ever gets enabled in this repository is the Tauri
CLI's own build-mode logic (`tauri build` passes it automatically;
`tauri dev` does not). A raw `cargo build`, run directly against this
Cargo.toml, therefore **never** enables `custom-protocol` — with or
without `--no-default-features`, since it was never a default feature
of anything here to begin with.

### Why the previous binary loaded localhost — and correcting the `--no-default-features` framing

`--no-default-features` on the `formulab` crate was actually a
no-op for this specific bug (the crate has no `[features]`/`default`
of its own to disable), so it did not "remove" `custom-protocol` —
`custom-protocol` was never present to remove. The real defect was
bypassing the Tauri CLI at all: any direct `cargo build`/`cargo build
--release` (regardless of `--no-default-features`) produces a binary
built in the same feature configuration as `tauri dev`, which is
hard-wired (via the generated build context) to request `devUrl`. The
window opened fine (native window creation doesn't depend on this),
but the WebView's initial navigation went to
`http://localhost:5173`, and since no Vite dev server was running,
WebView2 showed its own `ERR_CONNECTION_REFUSED` page. This also
means the previous binary was never loading stale/cached frontend
assets either — it wasn't reading `dist/` at all.

### Correct production build command

`pnpm tauri build --no-bundle`, run from `apps/desktop` — the
project's canonical production path (`apps/desktop/package.json`'s
`"tauri": "tauri"` script, i.e. the real Tauri CLI), with `--no-bundle`
added only to skip MSI/NSIS installer packaging (not needed for this
fix — the CLI still runs the full production pipeline: fresh
`beforeBuildCommand` frontend build, `cargo build --release` with
`custom-protocol` correctly enabled, and produces the same
`target/release/formulab.exe` the Desktop shortcut already points
at). Not `cargo build --release --no-default-features` again — that
command is confirmed incorrect for producing a self-contained
production binary in this repository, regardless of the
`--no-default-features` flag specifically.

### Build result

`pnpm tauri build --no-bundle` completed cleanly: frontend built in
1m 3s (fresh `dist/`, new content hashes confirming it wasn't stale),
Rust compiled in 3m 31s, ending with the CLI's own confirmation line:
`Built application at: C:\Users\sekip\Desktop\FormuLab\apps\desktop\
src-tauri\target\release\formulab.exe`. New binary: 23,526,400 bytes,
`LastWriteTime` 2026-08-07 10:31.

### Verification (no dev server running at any point during these checks)

Confirmed zero `node`/`vite`/`cargo` processes running before each
launch (`Get-Process` count 0). Launched the exe directly first
(bypassing the shortcut) to isolate the binary itself — window opened
and, since no visual inspection tool exists for a native window in
this session otherwise, a real screenshot was captured via Win32
`PrintWindow` against the actual window handle and read back as an
image: the FormuLab UI (sidebar, "What do you want to formulate?"
prompt, full navigation) rendered correctly — no localhost error page,
confirming the fix visually, not just by absence-of-error inference.

Refreshed `C:\Users\sekip\Desktop\FormuLab.lnk` to the same target
path (`...\target\release\formulab.exe` — path unchanged, content
replaced by the new build) via `WScript.Shell`, preserving
name/icon/working-directory/description. Launched via the `.lnk`
itself: resulting process `Path` matched the shortcut target exactly.
A second `PrintWindow` screenshot of this shortcut-launched instance
confirmed the identical, correct UI.

On that shortcut-launched instance: minimize (`ShowWindow`
`SW_MINIMIZE`, `IsIconic` confirmed true), maximize (`SW_MAXIMIZE`,
`IsZoomed` confirmed true, process alive throughout) both verified
live via real Win32 window-state calls. X (`WM_CLOSE` via
`PostMessage` to the real handle) confirmed the process actually
exits. Alt+F4 attempted again via `SetForegroundWindow` — failed
again with the same confirmed environmental restriction as the prior
entry (`SetForegroundWindow` returns `false`, actual foreground
window is a different process entirely) — not independently
verified, disclosed rather than claimed, consistent with the prior
entry's finding that this is a genuine, repeatable restriction of
this headless/background session, not a code defect.

### Source changes

**None.** This was purely a build/packaging problem, exactly as
instructed to investigate first — no application source code, test,
or configuration file needed to change. No commit was made (per
instruction: do not commit merely for rebuilding or refreshing the
shortcut). `main`/`feature/laboratory-stability` remain at `cacbffd`
from the prior entry.

### Not touched, per instruction

Real user data, `formulas/index.json`, backup archives, generated
user guides, SignPath configuration, `v0.4.0` tag, the existing
public `v0.4.0` release.

---

## Repository-wide legacy/obsolete/local-tooling artifact audit (2026-08-07)

Full audit per instruction, starting from 5 named candidates
(`.opencode/`, `.openscience/`, `.aider.chat.history.md`,
`.aider.input.history`, root-level `sessions/`) plus a broader
root/hidden-file/dev-tool-residue scan. Every candidate below was
checked against current source, tests, `tauri.conf.json`'s
`bundle.resources`, `.gitignore`, and tracked-file references
(`git ls-files`, `git grep`) before classification — nothing
classified from its name alone.

### Root-level `sessions/` — required special verification

Traced every session read/write path in current Rust source:
`formulation_v2.rs` (`data_dir(&app, &["data", "sessions"])`, 4 call
sites) and `backup.rs` (`roots.project_root.join("data").join(
"sessions")`) — both exclusively use `data/sessions/`. The only other
`sessions` string matches in tracked source are unrelated: a help-topic
UI id, a comment describing `data/sessions`'s own per-run cleanup, and
an unrelated per-project file-browser test fixture string. Root-level
`sessions/` contained **zero files** (bare empty directory, confirmed
via `find`), already covered by a pre-existing `/sessions/` gitignore
rule under the comment "Legacy locations (kept so older checkouts stay
clean)". `data/sessions/` by contrast holds 294 real session folders
and is the directory `backup.rs`'s own inclusion scan walks. Conclusion:
root-level `sessions/` is confirmed obsolete and unused, holds no data
of any kind (not stale, not duplicate, not dev residue — genuinely
empty), and `data/sessions/` is confirmed as the sole active session
storage location. Removed (a bare empty directory — no git object to
delete, nothing to `git rm`). `data/sessions/` was not touched.

### Complete candidate inventory

| Path | Type | Tracked | Size | Purpose (evidence) | Classification | Action |
|---|---|---|---|---|---|---|
| `.opencode/node_modules/` | dir | untracked | ~37MB | Local OpenCode CLI npm install; OpenCode sidecar fully removed from the app (Session 2A, re-confirmed: zero references in current `apps/desktop/src`/`src-tauri/src`) | SAFE_TO_DELETE | Removed |
| `.opencode/skills/my-skill/SKILL.md` | file | **tracked** | ~200B | Content: "A test skill that says hello... Use when you want to test skill loading" — a throwaway test scaffold | LEGACY_REMOVE | Removed (`git rm --cached` + commit) |
| `.opencode/.gitignore` | file | untracked | 1KB | OpenCode CLI's own auto-generated ignore file | SAFE_TO_DELETE | Removed |
| `.openscience/runs.db` | file | **tracked** | 36KB | SQLite file; zero references anywhere in current source/docs/scripts (`git grep -i openscience` matched only itself and the `.gitignore` rule) | LEGACY_REMOVE | Removed (`git rm --cached` + commit) |
| `.openscience/` (dir, post-removal) | dir | untracked | 0 | Empty after removing `runs.db`; already gitignored (`.openscience/`) | SAFE_TO_DELETE | Removed |
| `.aider.chat.history.md` | file | untracked | 24KB | Aider pair-programming tool's local chat log; already gitignored (`.aider*`) | SAFE_TO_DELETE | Removed |
| `.aider.input.history` | file | untracked | 4KB | Aider tool's local input history; already gitignored | SAFE_TO_DELETE | Removed |
| `sessions/` (root) | dir | untracked, ignored | 0 | Empty; see verification above | LEGACY_REMOVE | Removed |
| `artifacts/archive/`, `artifacts/shortcut-backups/` | dirs | untracked | 0 | Both completely empty (no files, dated 2026-08-01); zero references in any source, script, or config | SAFE_TO_DELETE | Removed |
| `.pytest_cache/` (root) | dir | untracked, self-ignored | 23KB | Standard pytest cache — carries its own auto-generated `.gitignore` (`*`), confirmed via `git status --ignored` | GENERATED_REBUILDABLE | Removed |
| `runtime/.pytest_cache/`, `runtime/formulation/.pytest_cache/`, `runtime/formulation/__pycache__/`, `runtime/pipeline/.pytest_cache/`, `runtime/pipeline/__pycache__/` | dirs | untracked, ignored | small | Same — pytest/Python bytecode caches, self-ignoring or covered by the repo's `__pycache__/` rule | GENERATED_REBUILDABLE | Removed |
| `runtime/skills/external/anthropic-skills/` | dir | untracked, ignored | 3.7MB | Fetched content for the "legacy-skills pack" mechanism (`scripts/dev/fetch-skills.sh` → `runtime/skills/external/`) that Phase 12 Session 2A already investigated exhaustively and confirmed fully dead (no `runtime.rs`, no `deploy_bundled_skills` function, never in `tauri.conf.json`'s `bundle.resources`) and removed the fetch mechanism for — this was orphaned leftover output from before that removal | SAFE_TO_DELETE | Removed |
| `runtime/harness/` | dir | tracked | — | **Actively bundled**: `tauri.conf.json` → `bundle.resources`: `"../../../runtime/harness": "harness/"` | KEEP | Retained |
| `runtime/skills/core/` | dir | tracked | — | **Actively bundled**: `bundle.resources`: `"../../../runtime/skills/core": "skills-core/"` | KEEP | Retained |
| `runtime/formulation/*.py`, `runtime/kernel/*`, `runtime/pipeline/*.py` (non-cache files) | files | tracked | — | Live application source — the advanced optimizer, kernel bridge, and materials/literature pipeline `PROGRESS.md` documents as real, shipped, tested features | KEEP | Retained |
| `examples/shampoo-formulation/`, `examples/surface-cleaner/` | dirs | tracked | 18KB | **Actively bundled**: `bundle.resources` includes both | KEEP | Retained |
| `.FormuLab/runs.db` | file | untracked, ignored | 52KB | Live app-private data — referenced across a dozen current Rust/TS files (`backup.rs`, `diagnostics.rs`, `runs.rs`, `runs_index.rs`, `provenance.rs`, `tauri.ts`, etc.) | KEEP | Retained (never touched) |
| `.env.local` | file | untracked, ignored | 139B | Real local API keys (values not inspected/exposed) | KEEP_LOCAL | Retained |
| `.claude/` | dir | untracked | — | Claude Code's own local project config/memory | KEEP_LOCAL | Retained |
| `scripts/windows/verification-logs/*.log` (5 files) | files | untracked, ignored (`*.log`) | 25KB | Historical output of `scripts/windows/verify-formulab-phase1.ps1`; already invisible to git | KEEP_LOCAL | Retained (already properly ignored; not repo bloat) |
| `runtime/manager/README.md` | file | tracked | — | Design doc for a "Runtime Manager" that supervises "the bundled OpenCode sidecar" — that sidecar is fully removed, but this path is still named as current architecture in `AGENTS.md` line 34 and `docs/TECHNICAL_DESIGN.md` line 455 | **REVIEW_REQUIRED** | Retained, flagged |
| `runtime/mcp/README.md` | file | tracked | — | Design doc for MCP server integration (an OpenCode-consumed concept); same current-docs tension as above (`AGENTS.md`/`TECHNICAL_DESIGN.md` line 447/456) | **REVIEW_REQUIRED** | Retained, flagged |
| `runtime/opencode-profile/README.md`, `runtime/opencode-profile/skills/.gitkeep` | files | tracked | — | Same tension; Session 2A's own closure notes already named this README as stale-but-not-updated ("descriptive docs... not being updated to match" the sidecar's removal) without deleting it | **REVIEW_REQUIRED** | Retained, flagged |
| `node_modules/`, `patches/`, `pnpm-lock.yaml`, `packages/` | dirs/files | mixed | — | Build/runtime dependencies | KEEP | Retained |
| `PROGRESS.md` | file | tracked | 200KB | Active, continuously-updated project changelog (entries through 2026-08-06) | KEEP | Retained |

### Why the 3 REVIEW_REQUIRED items were not removed

All three are documentation-only stubs (no functional code) for a
superseded OpenCode-based "Runtime Manager"/MCP architecture. Strong
evidence they're dead in practice (zero functional code, the sidecar
they describe is fully removed) is real, but they are still explicitly
named as part of the *current* intended repository layout in two
top-level docs (`AGENTS.md`, `docs/TECHNICAL_DESIGN.md`) that this
session did not audit or update. Removing them cleanly would require
also deciding whether those two docs' architecture description is
itself stale (a documentation-accuracy judgment call, not a pure
artifact-cleanup one) — per instruction, left as REVIEW_REQUIRED
rather than guessed at.

### `.gitignore` change

Added `/.opencode/` (with a comment explaining why, matching the
existing `.openscience/` pattern) so a future local `opencode` CLI run
can't partially re-track itself into git the way `skills/my-skill/
SKILL.md` did. Verified the new rule catches a freshly-created
`.opencode/` via `git check-ignore -v`. No other new rules added —
`.pytest_cache/` self-ignores via its own generated `.gitignore`;
`.aider*`, `.openscience/`, and `/sessions/` already had precise
existing rules; `artifacts/` was deliberately left with no new rule
(no identifiable recurring tool/mechanism behind it, so a future
legitimate `artifacts/` folder should surface normally rather than be
silently hidden).

### Verification

`git status` clean apart from the 3 pre-existing, untouched excluded
files (generated user guide `.docx`/`.pdf`, `formulas/index.json`).
`git diff --check` clean (exit 0). Post-removal repository-wide
reference scan (`git grep`) for the two removed tracked paths found
only historical/dated narrative mentions (`PROGRESS.md`'s 2026-07-03
entry describing the original OpenCode skill-install feature when it
existed, and `docs/handoffs/PHASE12_CURRENT.md`'s own Session 2A
closure notes) — dated closure records this project's own convention
says are never rewritten retroactively, and neither references the
specific files that were deleted. One pre-existing, out-of-scope
observation surfaced by the same scan: `docs/CONNECT_YOUR_TOOLS.md`
still describes the (now-removed) OpenCode skill-save flow in
present tense — a documentation-accuracy issue that predates this
session and is not a file/folder artifact; not fixed here, noted for
awareness. No build/runtime/test file was removed, so no test suite
was rerun (per instruction).

### Closure

Commit `f0193bc` (`chore: remove dead local-tooling residue (OpenCode/
OpenScience test artifacts)`), pushed to
`origin/feature/laboratory-stability` (`cacbffd..f0193bc`, fast-forward).
Not merged to `main` in this pass (not requested this task). `v0.4.0`,
its public release, `data/`, `data/sessions/`, `formulas/index.json`,
backup archives, generated user guides, and SignPath configuration were
not touched.

---

## Pre-Phase-13 cleanup follow-up: data\data self-nesting, legacy docs, current-doc consistency (2026-08-07)

### 1. `data\data` — real bug, real user data at risk, both resolved

**Discovery.** Working-tree inspection at the start of this pass found
`C:\Users\sekip\Desktop\FormuLab\data\data\` — a nested copy of
`formulations/literature/master/safety/sessions` — plus the repo-root
`formulas/` directory entirely gone (its content had separately merged
into `data/formulas/`, confirmed correct by the user directly and left
alone). `data/data/`'s newest file timestamps clustered at 2026-08-07
~01:16-01:31, its safety log's last entry was 2026-08-06 22:15:54, and
`data/sessions/` (parent) stopped at 2026-07-31 — meaning two real
session results (`2026-08-02-1821-...`, `2026-08-07-0115-toothpaste...`)
existed **only** under the nested copy.

**Root cause.** `data_location_manager.rs`'s `validate_destination_at`
only rejected a destination that was *exactly* the current data root
(`dest_canon == current_canon`) — it never checked whether the chosen
destination was a *subdirectory* of the current root. A destination
inside the root is freshly-created and empty, so it validates as
`DestinationKind::Empty` / `can_move: true` and sails through. But
`try_move_data` snapshots the source file list (`walk_movable_files`)
*before* staging begins, so a move under this condition silently nests
the whole root under itself (`data/` → `data/data/`) instead of
failing loudly. This is a real, currently-exploitable bug — not
historical residue — confirmed by reading the function directly, not
inferred from the folder's existence alone.

**Comparison (excluding the nested subtree from the parent side, per
instruction).** Parent: 998 files. Nested: 47 files. 6 relative paths
present in both: **3 IDENTICAL_DUPLICATE** (SHA256-verified —
`literature/pdfs/10.1590_1807-3107bor-2021.vol35.0025.pdf`,
`.../10.1590_s1806-83242006000200015.pdf`, `.../10.17305_bjbms.2004.3362.pdf`),
**3 CONFLICT_DIFFERENT_CONTENT**. **41 UNIQUE_TO_NESTED** (two full
session directories + 12 top-level `literature/pdfs/*.pdf`). **0
DIRECTORY_ONLY** (every nested directory had file content or was
empty and simply removed with its parent).

**Conflict resolutions — each proven safe by the file's own documented
or inferable format, never guessed:**
- `master/regulatory_rules.json` — parent (19 records) proven a
  **strict superset** of nested (18 records) by `id`: all 18 shared
  ids byte-identical, one extra id only in parent. Kept parent as-is;
  nested added nothing.
- `safety/ai_request_log.jsonl` — an append-only log
  (`runtime/pipeline/pipeline.py` appends one line per AI-request
  decision). Parent held 14 lines (2026-07-25 to 2026-08-01), nested
  held 3 lines (2026-08-02 to 2026-08-06) — chronologically
  contiguous, zero overlap. Concatenated parent-then-nested into
  parent; verified the merged 17 lines are in strict timestamp order.
  One of the 3 recovered lines is a named human-review acknowledgment
  ("Sekip HAYIT") for the toothpaste session — real audit data that
  would otherwise have been lost.
- `literature/index.json` — `runtime/pipeline/literature_cache.py`'s
  own header comment documents the format explicitly: "list of paper
  dicts (dedup by DOI or normalized title)", and its `paper_key()`
  function gives the exact key. Only 1 of 121 nested entries shared a
  key with parent's 124 — genuinely divergent caches from different
  literature searches, not a stale-vs-current pair. Unioned by
  `paper_key` (parent wins on the one collision): 124 + 120 new = 244
  total entries, all preserved.

**Merge execution.** 41 unique files moved to their equivalent path
under `data/` (directories created as needed, refused-and-would-have-
aborted if any destination already existed — none did). The 3
conflicts resolved per above. The 3 identical duplicates left as-is in
parent. Verified post-merge: `literature/index.json` 244 entries,
`regulatory_rules.json` 19 entries, `ai_request_log.jsonl` 17 lines all
present; `data/sessions/` grew from 19 to 21 entries including both
recovered sessions. Only then was `data/data/` (now containing exactly
the 6 already-accounted-for files) deleted. Confirmed absent afterward
(`ls data/data` → No such file or directory).

**Fix + regression test.** Added a `strip_prefix`-based guard in
`validate_destination_at` rejecting any destination inside the current
root (kind `Conflicting`, blocker: "the destination is inside the
current data location — choose a folder outside it"). Two new tests:
`validate_blocks_a_destination_nested_inside_the_current_root`
(reproduces the exact scenario) and
`validate_does_not_false_positive_on_a_sibling_with_a_shared_name_prefix`
(a `data-archive` folder next to `data` must still validate `Empty` —
`strip_prefix` checks path components, not a string prefix).
`cargo test --lib data_location_manager`: 19/19 passing. `cargo clippy
--lib -- -D warnings`: clean.

### 2. Legacy documentation paths — resolved

Read `AGENTS.md`, `docs/TECHNICAL_DESIGN.md`,
`runtime/manager/README.md`, `runtime/mcp/README.md`,
`runtime/opencode-profile/README.md` and cross-checked against current
Rust/TS source, `tauri.conf.json`'s `bundle.resources`, and CI.
Confirmed: no `runtime.rs`, no `OpenCodeClient`, no sidecar anywhere in
current source; `generate_formulation` (`formulation_v2.rs`) is one
direct Tauri command into the bundled Python pipeline. Removed all 4
previously-flagged files (`runtime/manager/README.md`,
`runtime/mcp/README.md`, `runtime/opencode-profile/README.md`,
`runtime/opencode-profile/skills/.gitkeep`). Corrected `AGENTS.md`'s
stack description, repository map, and architecture guardrails, and
`docs/TECHNICAL_DESIGN.md`'s monorepo-layout/repo-map bullets, to
describe the actual current architecture — no replacement functionality
invented, only what was independently verified.

### 3. `docs/CONNECT_YOUR_TOOLS.md` — resolved (the specifically flagged section)

The "Bring your own skill" paragraph describing an in-app "install a
skill from a URL/Markdown" flow saving into the workspace's
`.opencode/skills/` was rewritten: that flow relied on the removed
OpenCode runtime and no longer exists; the app still bundles first-
party skills directly under `runtime/skills/core`. Not restored, not
replaced with new functionality.

### 4. Current-documentation consistency scan — broader findings, proportionate action taken

Scanned all non-historical docs (excluding `PROGRESS.md`,
`docs/external-logs/*`, `docs/handoffs/*`) for OpenCode-sidecar/
Runtime-Manager/MCP-integration claims. Confirmed already-accurate
(no change): `docs/architecture/CURRENT_STATE_AUDIT.md` ("Agent
runtime — REMOVED"), `docs/PHASE12_*`/`docs/SIGNPATH_APPLICATION.md`
(already past-tense/accurate), `docs/rfc/agent-runtime.md` (a decision
record for a merged PR — historical by nature, correctly left alone
per "do not rewrite historical closure logs").

Found, and corrected proportionately rather than fully rewritten:
`docs/PRD.md` and the rest of `docs/TECHNICAL_DESIGN.md` (beyond the
repo-map section already fixed in §2) both describe an OpenCode-
chat/Skills-Agents-page product and a Runtime-Manager-supervised
sidecar architecture across many sections (API description, sequence
diagrams, risk/mitigation) — far more extensive than the 4 originally-
flagged paths. Rewriting either document section-by-section to match
current reality would mean substantially re-authoring both from
scratch under time pressure, risking inventing unverified architecture
detail — explicitly against instruction. Instead added a clear
"**Superseded**" banner at the top of each, stating plainly that the
OpenCode/Runtime-Manager content below is historical, current
functionality is one direct Tauri command into a bundled Python
pipeline, and pointing to `docs/architecture/CURRENT_STATE_AUDIT.md`/
`AGENTS.md` for what's actually current. This stops both documents
from falsely presenting removed functionality as active without
inventing replacement narrative.

Also corrected, in full (short, self-contained, no ambiguity): both
`apps/desktop/README.md` and `apps/desktop/src-tauri/README.md`'s
OpenCode-sidecar/`runtime/manager` lines.

**Explicitly NOT resolved, flagged for a future session:**
`docs/REQUIREMENTS.md` line ~425-429 claims a "Settings → MCP servers"
one-click connector feature "ships" — independently verified via
`apps/desktop/src/components/settings/` (11 real cards, none MCP-
related) that no such UI exists in the current app. This is the same
class of problem as the OpenCode staleness above but is a distinct,
separately-scoped *product-status* accuracy question (whether this
feature ever really shipped and was later silently dropped, versus
was only ever aspirational) that this pass did not investigate or
fix — noted here rather than guessed at.

### `data/legacy-workspaces/` — user question, deliberately not acted on

Asked mid-session whether `data/legacy-workspaces/` (dated workspace
folders from 2026-07-17/18, each with its own nested `.git` repo, plus
top-level `literature/`, `literature_detergent/`, etc.) can be
cleaned. This is real historical multi-workspace data, structurally
unrelated to the `data\data` bug (pre-dates it, untouched by the move/
merge above), and outside this task's explicit data-safety
authorization (scoped only to merging `data\data` into `data\`). Not
touched. Would need its own dedicated audit (same rigor as `data\data`
— trace whether anything still reads from it, confirm what's safely
prunable) before any action.

### Verification

`git status`: clean apart from the 2 pre-existing, untouched exclusions
(generated user guide `.docx`/`.pdf`) and pre-existing working-tree
deletions of the now-relocated repo-root `formulas/*.md`/`index.json`
(already gone before this session started — confirmed unrelated to the
`data\data` root cause, per instruction left unstaged and untouched).
`git diff --check`: clean. Reference scan for the 3 removed runtime
doc paths: zero remaining tracked references outside this session's
own explanatory prose. `data/sessions/` integrity: 21 real session
directories, includes both recovered ones. No frontend/TypeScript
source changed this pass, so no typecheck/lint/vitest run (per
instruction — proportional to the Rust-only fix).

### Closure

Commit `7b1758c` (`fix(data): stop data\data self-nesting; remove
dead OpenCode runtime docs`) — 12 files changed. Pushed to
`origin/feature/laboratory-stability` (`f0193bc..7b1758c`, fast-
forward). `main` synchronized via fast-forward push
(`cacbffd..7b1758c`) after confirming zero unique commits on `main`
and `main` as a clean ancestor of the feature branch. Post-sync:
`origin/main` == `origin/feature/laboratory-stability` == `7b1758c`.
`v0.4.0^{commit}` unchanged at `833e7ee9e82e854a4c163d7e93ac48fd6472e817`.

**Phase 13 readiness: NOT READY.** `data\data` is fully resolved (bug
fixed, tested, data merged, directory removed) and the 4 originally-
flagged REVIEW_REQUIRED legacy doc paths are fully resolved (removed).
But the broader current-documentation consistency scan found real,
unresolved staleness beyond what was explicitly flagged: `docs/PRD.md`
and most of `docs/TECHNICAL_DESIGN.md` carry a superseded-banner
rather than a full rewrite, and `docs/REQUIREMENTS.md`'s MCP-connector
"ships" claim was found but not addressed. Per the task's own
readiness bar ("no unresolved cleanup/documentation inconsistency
remains"), these count as remaining blockers, honestly reported rather
than glossed over.

### `data/legacy-workspaces/` — audited and removed (2026-08-07, same session, user follow-up)

Asked to audit with the same rigor as `data\data`. Findings: untracked,
already gitignored (`/data/` rule), 86MB, 70 files. Zero references
anywhere in current source/scripts/docs. `workspace.rs`'s
`base_workspace_dir()` (default `~/Documents/FormuLab`) and
`workspace_dir()` (= `resolve_data_root()`, the active `data/` root)
are the only two paths any current code ever creates/reads workspaces
from — neither has ever pointed here. All content dated 2026-07-17/18
(the project's first ~2 days), predating the current `data/sessions/`
model entirely (no matching entries there). Each subfolder was its own
local git repo (old workspace-per-git-repo pattern). Content check
found 2 real formulation results with genuine INCI tables and real
DOI references (anti-dandruff shampoo, laundry detergent color-care)
— not placeholder data — plus 3 empty/scaffolding-only dated
subfolders. Unlike `data\data`, nothing here duplicated or merged into
a live location; it was standalone, fully superseded early work.
Reported findings and explicitly asked before acting (real, non-
duplicate content, unlike the safely-mergeable `data\data` case) —
user confirmed deletion, no archive requested. Deleted
(`rm -rf data/legacy-workspaces`) — untracked/gitignored, so no git
action was needed or taken. `data/` verified otherwise intact
(`formulas`, `formulations`, `literature`, `master`, `safety`,
`sessions`, `.FormuLab` all present, unchanged). No commit — no
tracked file changed.
