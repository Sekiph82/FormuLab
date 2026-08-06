# Phase 12 — Commercial Distribution Architecture

Assessment and design (Session 0), extended by Session 1's certificate-
route decision and repository preparation. No signing, update download,
update execution, or rollback has been implemented as of either session —
every claim below is either evidenced from the current repository or
explicitly marked as a decision/verification deferred to a numbered
implementation session.

**Certificate/provider decision (§1.8, §3.1, §4 below): RESOLVED in
Session 1.** The project has zero code-signing budget — the user
directed use of **SignPath Foundation's free open-source HSM-backed
signing program**, explicitly ruling out any paid OV/EV certificate or
Azure Artifact Signing. Full Session 1 findings, the eligibility
self-check, the one real blocker found, and the policy documents/
application dossier prepared: §9.

## 1. Current-state assessment (evidenced)

### 1.1 Tauri version and updater capability — verified, not assumed

- `apps/desktop/src-tauri/Cargo.lock`: `tauri = "2.11.5"`.
- `tauri-plugin-updater` — **absent**. `grep -c "tauri-plugin-updater"
  Cargo.lock` returns `0`. Confirmed again in
  `apps/desktop/src-tauri/Cargo.toml`'s dependency list (`tauri`,
  `tauri-build`, `tauri-plugin-shell`, `tauri-plugin-single-instance`,
  `tauri-plugin-dialog`, `tauri-plugin-clipboard-manager`,
  `tauri-plugin-notification` — no updater plugin).
- `apps/desktop/package.json` — `@tauri-apps/plugin-updater` — **absent**
  from `dependencies`. Only `@tauri-apps/api`,
  `@tauri-apps/plugin-clipboard-manager`,
  `@tauri-apps/plugin-notification`, and `@tauri-apps/cli` (dev) appear.
- `apps/desktop/src-tauri/tauri.conf.json` has no `plugins.updater` block,
  no `bundle.createUpdaterArtifacts`, no `pubkey`.
- **Conclusion**: FormuLab has never had update download or install
  capability of any kind, official or custom. Phase 11 Session 9's
  `updates.rs`/`lib/update.ts` is a hand-rolled, check-only system (fetch
  metadata, compare versions, show a badge) with an explicit code comment
  disclaiming download/install/rollback as Phase 12 scope
  (`updates.rs:1-8`).
- **npm registry check this session** (network reachable,
  `registry.npmjs.org` responded): `@tauri-apps/plugin-updater` latest is
  `2.10.1` at the time of this check. The matching Rust crate
  (`tauri-plugin-updater`) could not be independently queried this
  session (`crates.io`'s API rejected the request under its access
  policy) — both sides are versioned together in the `tauri-apps/
  plugins-workspace` monorepo and should be pinned together, and their
  compatibility with the installed `tauri = "2.11.5"` core must be
  confirmed at the start of Session 1, not assumed from this note.

### 1.2 Installer formats and configuration

- `tauri.conf.json`'s `bundle.targets` is `"all"` — on a Windows runner
  this produces both `.msi` (WiX) and `.exe` (NSIS), confirmed directly
  by this phase's own Stage 2 closure build (`pnpm tauri build` this
  session produced `formulab.exe`, `FormuLab_0.4.0_x64_en-US.msi`, and
  `FormuLab_0.4.0_x64-setup.exe`).
- No `bundle.windows` block exists at all — no
  `certificateThumbprint`/`digestAlgorithm`/`timestampUrl` (Tauri's
  built-in local-signtool-based signing config), no `nsis`/`wix`
  sub-config for upgrade codes, license text, or installer language
  beyond the default `en-US`.
- No `bundle.createUpdaterArtifacts` — the updater-specific bundle
  formats (a `.sig`-accompanied `.nsis.zip` for Windows) are not
  produced today, only the plain end-user installers.

### 1.3 Update-checker metadata contract (current, check-only)

`apps/desktop/src-tauri/src/updates.rs` (Rust — fetch + structural
validation) and `apps/desktop/src/lib/update.ts` (TypeScript — version
comparison, scheduling, ignored-version, notification):

- One configurable HTTPS endpoint, defaulting to GitHub's public
  Releases API (`DEFAULT_RELEASE_METADATA_URL =
  "https://api.github.com/repos/Sekiph82/FormuLab/releases/latest"`).
- `ReleaseMetadata`: `{ version, url, name?, publishedAt?, notes?,
  platformSupported, matchedAssetName? }`. **`url` is the GitHub release
  page (`html_url`), not a downloadable asset URL** —
  `matchedAssetName` is a filename only, never a fetchable link. No
  SHA256, no signature, no channel field, no minimum-supported-version
  field anywhere in this contract today.
- HTTPS enforced twice (endpoint itself, and the parsed `html_url`), 1 MB
  response cap (two layers), 10s timeout, structural validation, a
  draft/prerelease entry is skipped entirely (so a GitHub prerelease is
  invisible to today's checker — relevant to channel design, §3.7).
- `check()` never claims a same-or-older version is an update
  (`isNewerVersion`); ignored-version suppression re-checks against the
  live `latest` every time so a newer release is never masked by an
  older ignored one; a notification fires at most once per version
  (`notifiedVersion`).
- "View Release / Download" only calls `openExternal(latest.url)` — opens
  the OS browser to the GitHub release page. No file is ever fetched
  beyond the one JSON metadata document. This is today's **only**
  update path, and per §3.13 must remain available as the offline/manual
  fallback even after an automatic path exists.

### 1.4 Version sources — 4 duplicated literals, no bump script

| File | Field | Value |
|---|---|---|
| `package.json` (root) | `version` | `0.4.0` |
| `apps/desktop/package.json` | `version` | `0.4.0` |
| `apps/desktop/src-tauri/tauri.conf.json` | `version` | `0.4.0` |
| `apps/desktop/src-tauri/Cargo.toml` | `version` | `0.4.0` (read at
  compile time via `env!("CARGO_PKG_VERSION")` by `backup.rs`,
  `diagnostics.rs`, and the app's own reported version) |

All four currently agree, but nothing enforces that — `scripts/release/`
exists as an empty directory (`.gitkeep` only, confirmed via `find`), so
there is no existing bump/sync tooling to build on. A commercial release
process needs exactly one authoritative version bump step that updates
all four (or a single-source mechanism), or a version mismatch between
`Cargo.toml` (what a signed binary actually reports) and `tauri.conf.json`
(what the bundler names the installer) becomes possible.

### 1.5 GitHub release workflow (current)

`.github/workflows/build.yml` — the **only** workflow file in the repo
(confirmed by `find .github -type f`; there is no separate CI/test
workflow, no lint workflow):

- Matrix: macOS (arm64+x64), Windows (x64), Linux (x64). Windows job
  build a NSIS `.exe` and an MSI via `tauri-apps/tauri-action@v0`.
- Trigger: `push` on `tags: ["v*"]`, or manual `workflow_dispatch`.
- On a tag push, `tauri-action` creates a **draft** GitHub Release and
  attaches every platform's installers — `releaseDraft: true`, so nothing
  is ever automatically public; a human must publish it.
- The release body is a hardcoded, standing "these builds are unsigned"
  disclaimer (SmartScreen "Run anyway" / Gatekeeper `xattr -cr`
  instructions) with a comment marking where a per-version changelog
  should be prepended before publishing — i.e. the unsigned status is
  already disclosed to every user today, not silently shipped.
- Permissions: `contents: write` only (needed for `tauri-action` to
  create the release/upload assets) — no other secret is referenced
  anywhere in this workflow besides the automatic `GITHUB_TOKEN`.
- **No code-signing step of any kind exists in CI today.**

### 1.6 Artifact naming (current, unchanged by this session)

`formulab.exe`, `FormuLab_<version>_x64_en-US.msi`,
`FormuLab_<version>_x64-setup.exe` — Tauri's own default naming
(`<ProductName>_<version>_<arch>[_locale].<ext>`), not a custom scheme.
A commercial release needs this to stay stable (an update manifest will
reference these names/patterns directly).

### 1.7 Signing status (current, unchanged by this session)

Every artifact built by every Phase 11 closure session, and again this
phase's own most recent Stage 2 closure build, inspected directly via
PowerShell's `Get-AuthenticodeSignature`: **`NotSigned`**, on all three
Windows artifact types, every time. No code-signing certificate,
`signtool` invocation, or CI signing secret exists anywhere in this
repository today.

### 1.8 Windows certificate requirements (research, not yet a decision)

Two Authenticode certificate models apply to a commercially-distributed
Windows app:

- **OV (Organization Validation) code-signing certificate** — issued to
  a verified legal entity, installable as a `.pfx`/PKCS#12 file or on a
  hardware token depending on issuer policy (some CAs now mandate
  HSM-backed storage for OV too, following CA/Browser Forum changes
  effective mid-2023). Builds SmartScreen reputation **gradually**, based
  on download/execution volume under that specific certificate — early
  releases still show a SmartScreen warning until enough reputation
  accrues.
- **EV (Extended Validation) code-signing certificate** — stricter
  identity vetting, historically required physical/USB HSM token
  possession (a CI runner can't hold a physical token directly); modern
  **cloud-HSM-backed signing services** (Azure Trusted Signing,
  DigiCert KeyLocker/Software Trust Manager, SSL.com eSigner, SignPath)
  now offer EV-equivalent or EV-class signing via a cloud API/CLI callable
  from GitHub Actions without physical hardware in the runner. EV
  historically granted **immediate** SmartScreen reputation (no
  gradual-trust ramp), though Microsoft's own guidance on this has
  evolved with cloud-HSM signing — the exact current SmartScreen behavior
  for a specific chosen provider should be confirmed directly with that
  provider before Session 1, not assumed from general Authenticode
  knowledge.
- Either model requires **timestamping** (`signtool sign /tr <RFC3161
  URL> /td sha256`) so the signature remains valid after the certificate
  itself expires.
- This is a **business decision** (§4), not something this session
  chooses — cost, identity-vetting turnaround time, and whether a cloud
  HSM signing service or a traditional CA-issued file/token certificate
  fits the user's setup all need a real answer before Session 1 can
  install a working CI signing step.

### 1.9 Backup/migration hooks reusable for update-time safety and rollback

Every piece of this already exists and is directly reusable, evidenced
from Phase 11:

- `backup.rs::try_create_backup`/`verify_backup_report` — the one real
  backup-creation/verification path in the codebase, already reused by
  manual backup, restore's own safety backup, automatic (daily/weekly/
  on-exit) backups, and pre-migration backups (Phase 11 Sessions 1, 3,
  7). A **pre-update** backup class is a fifth caller of the exact same
  function, not a new implementation.
- `automatic_backup.rs::apply_retention` — pure, unit-tested, per-class
  retention with an unconditional "never delete the last valid one"
  floor. Directly reusable for rollback-package retention (§3.16).
- `migration.rs` — append-only JSONL journal pattern
  (`run_started`/`collection_completed`/`run_failed`/`rolled_back`),
  `find_interrupted_run` detection, mandatory verified pre-migration
  backup before any write, rollback-on-`validate`-failure. This is the
  closest existing precedent to an "update journal" (§3.11).
- `data_location_manager.rs` — a second, independently-built instance of
  the same shape: an append-only journal
  (`data_move_journal.jsonl`), a pure `resume_decision(steps) ->
  ResumeAction` function deciding recovery purely from which journal
  steps were reached, and `restore_pointer` rolling a pointer file back
  to its exact previous content on failure.
- **Real finding**: this project has now independently built the same
  "journal steps reached → pure resume/rollback decision function"
  pattern **twice** (migration, data-move) without a shared abstraction.
  An update-rollback system would be a **third** copy if built the same
  bespoke way again. Phase 12 should evaluate extracting a small shared
  "journaled operation with resume" helper (journal-append + pure
  resume-decision-from-reached-steps) that migration, data-move, and the
  new update flow can all use — flagged as a design option for Session 1
  to accept or explicitly decline, not decided in this assessment.
- `schema_meta.json`/`GLOBAL_SCHEMA_VERSION` (`backup.rs:56`,
  `migration.rs`) — the existing schema-compatibility signal a new
  build's first launch can check against on-disk data (§3.10).

### 1.10 Gaps blocking a commercial release

1. No code-signing certificate or CI signing step — every artifact is
   `NotSigned` (§1.7).
2. No signed update manifest or signed update packages — the current
   metadata contract carries no SHA256, no signature, no direct
   asset-download URL (§1.3).
3. No in-app update download/install capability at all — `View Release /
   Download` only opens a browser (§1.3).
4. No update-time verification-before-execution mechanism (nothing to
   verify — nothing is downloaded today).
5. No rollback mechanism for a failed update (though the backup/journal
   primitives to build one already exist, §1.9).
6. No release channels — one GitHub Releases feed, `draft`/`prerelease`
   entries invisible to the checker.
7. No staged rollout.
8. No update-eligibility gate beyond version comparison — no OS-version
   floor, no schema-compatibility check before an update proceeds.
9. No CI signing secrets, hence no least-privilege secret scoping
   decision made yet.
10. No release-provenance/audit trail beyond the GitHub Release page
    itself and its draft-review step.
11. Four independently-editable version-literal locations, no bump
    script (§1.4).
12. `bundle.createUpdaterArtifacts` off — even after a certificate
    exists, the updater-specific artifact format Tauri's own updater
    plugin needs is not produced by the current build config.

## 2. Architecture decision: use `tauri-plugin-updater`, not a hand-rolled downloader

The ten numbered requirements in this session's brief map heavily onto
functionality Tauri's own official updater plugin already provides.
Recommendation, to be confirmed empirically at the start of Session 2 by
actually adding the dependency (not assumed further than this note):

- **Adopt `tauri-plugin-updater`** for requirement #3 (secure in-app
  update download/installation) and most of #2/#4 (signed update
  metadata/packages, verification before execution). It downloads over
  HTTPS, verifies an Ed25519 signature against a public key embedded in
  `tauri.conf.json` (`plugins.updater.pubkey`) before touching the
  filesystem, and on Windows handles the installer handoff/restart
  itself for NSIS-based updater artifacts.
- **This does not replace `updates.rs`/`lib/update.ts`** — Session 9's
  check-only contract (version comparison, ignored-version, scheduling,
  notification, the Settings UI) stays as the **decision layer**; the
  updater plugin becomes the **download/verify/install** mechanism it
  calls into once a user (or an eligibility rule, §3.8) says "install
  this." Matches this codebase's existing "Rust validates/fetches,
  TypeScript decides what to show" split (`updates.rs:11-14`) rather than
  replacing it.
- **Windows artifact-type consequence**: Tauri's updater artifact format
  (`createUpdaterArtifacts`) produces a `.sig`-accompanied `.nsis.zip`
  for Windows, **not** an updater-capable `.msi`. Concrete decision for
  Session 2: **NSIS carries the auto-update path; the MSI remains a
  manual/first-install/IT-deployment artifact** (silent `msiexec`
  install, Group Policy-friendly) but is not part of the automatic
  in-app update flow. Both are still built, signed, and published every
  release — only the *update* path is NSIS-specific.
- Everything the plugin does **not** cover — mandatory pre-update backup,
  schema-compatibility gating, health-check-triggered rollback, rollback
  package retention, staged rollout, channels — remains real repository
  code, built on Phase 11's existing backup/journal primitives (§1.9).

## 3. Architecture

### 3.1 Certificate type and storage
Decision deferred to the user (§4) — OV file/token vs. EV vs. a
cloud-HSM signing service (Azure Trusted Signing / DigiCert KeyLocker /
SSL.com eSigner / SignPath). Whichever is chosen, the **private key
material never lives in the repository or in a CI log** — it is either a
CI-only secret (`.pfx` + password, base64-encoded, as GitHub Actions
encrypted secrets) or, preferably for an EV-class cloud service, an
API credential scoped only to the signing operation, with the actual key
never leaving the provider's HSM.

### 3.2 Local development signing vs. CI signing
Local `pnpm tauri build` during development stays **unsigned** — matching
every Phase 11 closure session's own build (dev/test builds have never
needed signing, and putting a real signing secret on a developer's local
machine widens the leak surface for no benefit). Only the CI release
workflow (`build.yml`, tag-triggered) signs, using a secret scoped to
that workflow's `environment:` (GitHub Actions environment protection —
§3.19).

### 3.3 Authenticode signing order
1. Build the app (`tsc && vite build`, then `cargo build --release`) —
   unsigned `formulab.exe`.
2. Sign `formulab.exe` directly (`signtool sign /fd sha256 /tr <RFC3161>
   /td sha256 ...` or the cloud-HSM provider's equivalent CLI/API).
3. Bundle: WiX produces the MSI, NSIS produces the setup EXE — both now
   embedding the already-signed `formulab.exe`.
4. Sign the MSI and the NSIS setup EXE **as their own separate
   Authenticode-signed containers** (an MSI/installer EXE needs its own
   signature independent of the payload exe's signature — Windows
   Installer and SmartScreen both check the outer package).
5. Timestamp every signature (step 2 and step 4) so validity survives
   certificate expiry.

Tauri's bundler can drive step 2 automatically via
`bundle.windows.signCommand` (a custom command Tauri invokes in place of
`signtool` directly, which is exactly the hook a cloud-HSM provider's CLI
plugs into) or the built-in `certificateThumbprint`/local-signtool path
for a file/token certificate — the exact config shape depends on which
certificate model is chosen (§3.1) and is a Session 1 implementation
detail, not decided here.

### 3.4 Installer and executable signature verification
Two distinct verification points:
- **CI-side, immediately after signing** (Session 1): a `signtool verify
  /pa /all` (or provider-equivalent) step in the release workflow that
  fails the build if a signature didn't actually apply — catching a
  silent signing-tool failure before a release is ever drafted.
- **Client-side, before executing a downloaded update** (Session 2/3):
  this is what `tauri-plugin-updater`'s own Ed25519 signature check
  already provides for the updater-artifact payload (§2) — a second,
  independent check from the Authenticode signature Windows itself
  verifies on the installer/exe at launch. The two are complementary,
  not redundant: Authenticode proves "signed by FormuLab's certificate,"
  the updater's Ed25519 signature proves "this exact bytes came from a
  release this app's embedded public key trusts," and Windows'
  own AppLocker/SmartScreen check is a third, OS-level gate outside the
  app's control entirely.

### 3.5 Signed update manifest
Extend `ReleaseMetadata` (Rust) / the TypeScript store's fetched shape —
concrete new fields, to replace or sit alongside the current
check-only contract:

```jsonc
{
  "version": "0.5.0",
  "notes": "...",
  "pub_date": "2026-09-01T00:00:00Z",
  "channel": "stable",           // new — §3.7
  "minSchemaSupported": "1.0",   // new — §3.10
  "platforms": {
    "windows-x86_64": {
      "signature": "<Ed25519 sig, base64>",
      "url": "https://github.com/.../FormuLab_0.5.0_x64-setup.nsis.zip",
      "sha256": "<hex digest>"    // belt-and-suspenders alongside the
                                   // updater plugin's own signature check
    }
  }
}
```

This is `tauri-plugin-updater`'s own expected manifest shape
(`latest.json`-style) plus this project's two additions (`channel`,
`minSchemaSupported`) — not a second, parallel format. Published as a
release asset by CI (§3.19), generated by `tauri signer sign` (or the
bundler's automatic `.sig` output) against a keypair generated once via
`tauri signer generate` and stored as a CI secret (private half) /
`tauri.conf.json` (public half, safe to commit — it's a public key).

### 3.6 SHA256 and signature validation
Belt-and-suspenders, evidenced from this project's own existing
discipline (`backup.rs`'s manifest already carries a SHA256 per file —
this is not a new pattern for this codebase): the updater plugin's
Ed25519 check is the actual security boundary (a SHA256 alone is not
tamper-proof, only corruption-proof); the manifest's `sha256` field is a
fast, cheap pre-check / integrity log entry for the update journal
(§3.11), not a substitute for the signature check.

### 3.7 HTTPS and redirect rules
GitHub Release asset URLs redirect once (`github.com` →
`objects.githubusercontent.com` or `release-assets.githubusercontent.com`)
before serving the actual bytes — this must be an explicit allow-list
decision at implementation time (does the HTTP client used for the
download follow redirects automatically, and if so, is the redirect
target still validated as HTTPS?), mirroring `updates.rs`'s own existing
"HTTPS enforced, including after any redirect" discipline for the
metadata fetch (`is_https_url` checked on the parsed `html_url`, not just
the configured endpoint). The manifest/update-asset fetch must apply the
same rule, not silently trust wherever a redirect points.

### 3.8 Stable, beta, and internal channels
Today's checker skips every `draft`/`prerelease` GitHub release entirely
(§1.3) — a real gap for channel support, not a feature to preserve as-is.
Proposed model: a `channel` field in the manifest (§3.5), populated by
which tag pattern produced the release (`v1.2.3` → `stable`,
`v1.2.3-beta.1` → `beta`, an internal/unlisted tag or a separate manifest
endpoint entirely → `internal`). The update checker's configured endpoint
(already a runtime-configurable field in `lib/update.ts`, unused by any
UI today — §1.3) becomes the channel switch: a beta opt-in points the
store at the beta manifest URL instead of stable's.

### 3.9 Staged rollout support
A deterministic, stable per-machine bucket (e.g. a stored random UUID
already needed for other purposes, or a new one generated once and
persisted the same way `ignoredVersion`/`notifiedVersion` already persist
in `localStorage`) hashed against a rollout percentage published in the
manifest (`"rolloutPercent": 25`). Client-side only — GitHub Releases
itself has no server-side staged-rollout primitive, so this is real
repository code (`shouldReceiveRollout(machineBucket, rolloutPercent)`,
a pure function in the same style as `isNewerVersion`/`shouldAutoCheck`),
not a hosting-platform feature.

### 3.10 Update eligibility rules
Layered gate, checked in this order before an update is offered/allowed
to proceed automatically: platform/arch match (already exists,
`find_platform_asset`) → channel match (§3.8) → rollout bucket (§3.9) →
**schema compatibility** — the new build's own `minSchemaSupported`
manifest field must be `<=` the current on-disk `GLOBAL_SCHEMA_VERSION`
read from `schema_meta.json`, otherwise the update is blocked with an
honest reason ("this build doesn't understand your current data version
yet") rather than installed and left to fail at runtime. This reuses
Phase 11's existing `schema_version_status`-style comparator
(`migration.rs`), not a new version-comparison implementation.

### 3.11 Downgrade prevention
Client-side comparison already exists and is correct
(`isNewerVersion`/`"upToDate"` for same-or-older, §1.3) — but that only
protects against a *legitimate* server response. The manifest signature
(§3.5/§3.6) is what prevents a malicious or compromised endpoint from
serving a **replayed, validly-signed-but-old** manifest to force a
downgrade — the manifest should carry `pub_date` and the client should
refuse to act on a manifest older than the last one it successfully
acted on (a simple monotonic check, persisted the same way
`notifiedVersion` already is), independent of the version string itself.

### 3.12 Mandatory pre-update backup
A new backup class, `"preUpdate"`, added the same way `"preMigration"`
already exists (§1.9) — `try_create_backup` + `verify_backup_report`,
mandatory, verified before the download/install proceeds, never skipped
by a setting. If the safety backup itself fails or fails verification,
the update is aborted before anything is downloaded — mirroring
`try_move_data`'s exact existing precedent (`data_location_manager.rs`:
"safety backup failed verification — move aborted before touching
anything").

### 3.13 Update journal
`update_journal.jsonl`, app-private (same location convention as
`data_move_journal.jsonl` — deliberately outside the data root, §1.9):
`update_started` (records target version + manifest hash) →
`backup_created` → `download_started` → `download_verified` (SHA256 +
signature both passed) → `installer_launched` → **[process boundary —
new binary takes over]** → `first_launch_healthy` or
`first_launch_failed` → `update_completed` or `rollback_started` →
`rollback_completed`/`rollback_failed`. A pure `resume_decision`-style
function (§1.9's flagged shared-helper opportunity) decides recovery
purely from which steps were reached, exactly like migration's and
data-move's own journals already do.

### 3.14 Installation handoff
Windows cannot overwrite its own running executable — the updater
plugin's own installer-launch mechanism handles this (spawns the
installer as a detached process, then the current app process exits to
release its file lock, matching NSIS's own standard "close app, install,
optionally relaunch" flow). The `installer_launched` journal entry
(§3.13) is written **before** this handoff, specifically so that if the
new process never reaches `first_launch_healthy` (crash, or the machine
loses power mid-install), the next launch of *either* binary can read the
journal and know a handoff was in flight.

### 3.15 Restart behavior
Auto-relaunch after a successful silent install, carrying a "first run
after update" flag (a CLI arg or an app-private marker file, checked once
at startup) so the health check (§3.16) knows this specific launch is the
one that must prove itself, not an ordinary subsequent launch.

### 3.16 Startup health check
The "first run after update" launch (§3.15) must reach a defined
"healthy" milestone — main window shown (reusing the exact
`verify-formulab-phase1.ps1` "window verified" signal Phase 1/10/11 native
verification already relies on, conceptually, just checked from inside
the app instead of externally) **and** a basic masterdata read succeeding
(reusing `diagnostics.rs`'s existing storage-health scan, §1.9) — within
a bounded timeout. Success writes `first_launch_healthy` to the update
journal and the "first run after update" flag is cleared. Failure (crash,
timeout, or a caught top-level error before that milestone) is what
triggers rollback (§3.17).

### 3.17 Rollback trigger
Two trigger paths: (a) the *next* launch after an update finds no
`first_launch_healthy` journal entry following the most recent
`installer_launched` — the previous launch crashed or hung before
proving itself; (b) a bounded **crash-loop** counter (N consecutive
crashes within a short window right after an update) rather than a
single crash, so one transient failure doesn't trigger a rollback the
user didn't need. Either path invokes the same rollback mechanism.

### 3.18 Rollback package retention
The mandatory pre-update backup (§3.12) is the data-rollback half; the
**binary** rollback half needs the previous version's installer retained
locally (not re-downloaded, since the network or the release itself may
be the problem) — reusing `apply_retention`'s exact existing
pattern (§1.9): keep the last N pre-update backups/installers per the
same "never delete the last valid one" floor discipline, pruned only
after a *later* update is confirmed healthy, never eagerly.

### 3.19 Rollback limits
A maximum automatic-rollback-attempt count (e.g. 1 automatic attempt per
failed update) — if the rolled-back version *also* fails its own health
check (extremely unlikely, since it was healthy before, but not
impossible if the failure is environmental), automatic recovery stops and
hands off to the failed-update recovery UI (§3.20) rather than looping.

### 3.20 Failed-update recovery UI
A Settings/startup banner (matching Phase 11's own interrupted-migration-
banner and interrupted-move-banner precedent — one recovery path per
journaled state, not an "inspect and choose" UI, per that established
pattern) surfacing: what happened, whether rollback succeeded, and manual
actions (open the pre-update backup folder, open the retained previous
installer, retry the update, contact-support link). Never silent.

### 3.21 Offline/manual installer fallback
Today's **only** update path (open the GitHub release page, download and
run the installer by hand, §1.3) remains after Session 2-3 add the
automatic path — required for firewalled/offline machines, and as the
honest fallback if the automatic path itself fails for a reason outside
the app's control (e.g. no write access to the install directory). "View
Release / Download" stays exactly as it is today.

### 3.22 CI secrets and least-privilege access
- Signing secret(s) scoped to a GitHub Actions **environment**
  (`environment: release`) with required reviewers, not a bare repository
  secret available to every workflow run — a compromised or accidentally-
  modified `build.yml` on a branch cannot exfiltrate the signing key
  without also passing an environment-protection gate.
- The existing `contents: write` permission (already scoped correctly,
  §1.5) stays as-is for the release-creation step; the signing step gets
  its own minimal permission (e.g. an Azure federated-identity /
  OIDC-based credential for a cloud-HSM provider, avoiding a long-lived
  secret entirely, if the chosen provider supports it — confirmed at
  Session 1 against whichever provider is actually chosen, §4).
- The updater's Ed25519 **private** signing key (§3.5) is a second,
  separate secret from the Authenticode certificate — different
  blast radius (one signs Windows executables and satisfies Windows
  itself; the other signs the update manifest and is checked only by
  FormuLab's own client code) — both scoped to the same protected
  `release` environment, never to a general-purpose workflow secret.

### 3.23 Release provenance and audit log
- The signed update manifest (§3.5) itself, published as a release asset
  alongside the installers, **is** the primary machine-checkable audit
  record — its own signature proves what CI actually published.
- The CI run URL/commit SHA that produced a given release recorded in the
  release notes (a small addition to `build.yml`'s existing `releaseBody`
  template, §1.5) — ties a published binary back to an exact, inspectable
  build.
- The update journal (§3.13), per-installation, is the client-side half
  of the audit trail — what version this specific machine moved through,
  when, and whether it succeeded — reusable later by Diagnostics'
  existing support-bundle export (`diagnostics.rs`, Phase 11 Session 5)
  with the same redaction discipline already applied to every other log
  it bundles.

## 4. Clear separation

| Layer | What it covers |
|---|---|
| **Available from Tauri directly** | HTTPS manifest fetch + Ed25519 signature verification + download + (NSIS) installer handoff + restart (`tauri-plugin-updater`); `bundle.windows.signCommand`/`certificateThumbprint` hook for driving a signing tool during `tauri build`; `bundle.createUpdaterArtifacts` for producing the `.sig`-accompanied update payload. |
| **Repository code required** | Channel/rollout/eligibility/schema-compatibility gating (§3.8-3.10); mandatory pre-update backup + update journal + resume-decision (§3.12-3.13, reusing Phase 11 primitives); startup health check + rollback trigger/limits (§3.16-3.19); failed-update recovery UI (§3.20); version-bump single-source tooling (§1.4); manifest generation script wiring the signing key into CI output. |
| **GitHub Actions work required** | Signing step(s) added to `build.yml` (or a new dedicated `release.yml`) for exe/MSI/NSIS + the update manifest; `signtool verify`/equivalent CI gate (§3.4); environment-protected secrets (§3.22); CI-run provenance line in release notes (§3.23); a beta/internal tag pattern → channel mapping if channels are built. |
| **External/certificate-provider requirements** | The Authenticode certificate itself (OV file/token or EV/cloud-HSM service) — acquisition, identity vetting, ongoing cost, and provider-specific CI integration (§1.8, §3.1); RFC3161 timestamp authority (usually included with the certificate/provider, but confirm). |
| **Manual business decisions required from the user** | Certificate model + provider + budget (§1.8); whether to pursue EV-class/cloud-HSM signing for immediate SmartScreen reputation vs. accept OV's gradual-trust ramp; channel strategy (does FormuLab ship a public beta channel at all, §3.8); staged-rollout percentage policy (§3.9); rollback retention count (§3.18); whether the `scripts/release/` placeholder becomes a real bump script this phase or stays deferred further. |

## 5. Unresolved decisions

1. ~~Certificate model and provider (§1.8, §3.1)~~ — **RESOLVED in
   Session 1**: SignPath Foundation's free OSS program, per explicit user
   direction (zero budget; no paid OV/EV/Azure Artifact Signing route).
   See §9.
2. Beta/internal channel: build it now (§3.8) or defer to a later phase —
   affects whether Session 6 (channels) is in-scope for this phase's
   closure or pushed out.
3. Staged-rollout percentage/policy (§3.9) — a product decision, not an
   engineering one; default proposal (start at 100% for early releases,
   introduce staging once there's a real user base large enough for it
   to matter) needs explicit sign-off, not silent assumption.
4. Whether the shared "journaled operation with resume" helper (§1.9) is
   worth extracting now (three call sites: migration, data-move, update)
   or left as three independent, already-proven implementations —
   Session 1's own judgment call, flagged here rather than decided.
5. Exact `tauri-plugin-updater` version pin and its confirmed
   compatibility with `tauri = "2.11.5"` — not verified this session
   (crates.io API blocked the query; npm gave `2.10.1` as a data point
   only), first action of Session 1.

## 6. Risks

- **SmartScreen reputation gap persists even after signing** under an OV
  certificate until enough install volume accrues — users may still see
  a warning for a period after Session 1 ships, and this must be
  disclosed the same honest way the current unsigned-build disclaimer
  already is (§1.5), not silently promised away.
- **Auto-update + MSI mismatch**: since the updater plugin's artifact
  format doesn't cover MSI (§2), a user who installed via MSI (e.g. an
  IT-deployed machine) will not receive automatic updates the same way a
  NSIS-installed user does unless this is explicitly designed for in
  Session 2 (e.g. detecting install method and falling back to the manual
  path, or documenting MSI as "IT-managed, updates via re-deployment"
  rather than in-app).
- **Update-time data loss if the mandatory backup itself is skipped
  under a future setting** — must remain genuinely mandatory, matching
  `try_move_data`'s existing "abort before touching anything" precedent
  (§3.12), not a togglable convenience.
- **Rollback loop** if rollback limits (§3.19) are mis-implemented —
  bounded explicitly to avoid this class of failure.
- **Signing secret compromise** — mitigated by environment protection and
  preferring OIDC/federated credentials over long-lived secrets where the
  chosen provider supports it (§3.22), but the actual blast radius
  depends entirely on which provider is chosen (§4) — cannot be fully
  assessed until that decision is made.

## 7. Proposed Phase 12 session plan

Continuous numbering, beginning at Session 0. Renumbered in Session 1 to
insert a real, evidenced blocker-remediation session ahead of the
SignPath application itself (publishing FormuLab's first-ever GitHub
Release turned out to be a genuine prerequisite, not an assumption), and
renumbered again in Session 2 to insert the previous-identity-eradication
session before that same release is published — a public release must
not ship under the wrong identity.

- **Session 0** — Commercial Distribution Assessment. Assessment and
  architecture only. Complete.
- **Session 1** — Free Open-Source Code-Signing Foundation. Certificate
  route decided (SignPath Foundation, free OSS program — zero budget, no
  paid alternative). Eligibility self-checked against SignPath's
  published conditions; repository policy/privacy/signing documents and
  a copy-paste-ready application dossier prepared; one real blocker
  found (no release has ever been published). Complete — full detail §9.
- **Session 2** — Complete Previous-Identity Eradication and Native
  FormuLab Skill Migration. Removed every trace of the project's
  previous, pre-rename identity and its dependencies from the working
  tree (source, tests, docs, CI, the fetched third-party
  scientific-skills pack and its dead deploy mechanism, the also-dead
  goal-plugin CI fetch) ahead of the first public release — a release
  must not ship under an identity the project already renamed away from
  in Phase 9. Complete — full detail in
  `docs/handoffs/PHASE12_CURRENT.md`'s Session 2 summary.
- **Session 3** — First Public Release Publication. **Complete.**
  Published FormuLab's first-ever real GitHub Release,
  [`v0.4.0`](https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0)
  (Windows x64 only for this release), unsigned and disclosed as such.
  One real CI change was needed beyond what Session 2/2A already made:
  the standard `push: tags: ["v*"]` trigger did not fire (confirmed via
  the GitHub Actions API), isolated to be a tag-push-specific issue
  (`workflow_dispatch` fired instantly), and disclosed honestly rather
  than hidden — worked around with a `workflow_dispatch` `tag` input so
  a manual dispatch produces the same tagged-release behavior. Full
  detail: `docs/handoffs/PHASE12_CURRENT.md`'s Session 3 summary.
- **Session 4** — SignPath Application and Approval Gate. Submit the
  dossier (`docs/SIGNPATH_APPLICATION.md`) now that a real release exists;
  this is largely an external-review wait, bounded to: submit, track,
  and record the outcome (approved with real
  organization/project/policy/connector identifiers, or specific
  feedback to address and reapply).
- **Session 5** — Signing wired for real. Replace the documentation-only
  GitHub Actions example (§9) with a live workflow step using the real
  SignPath identifiers from Session 4; add the `signtool verify`
  CI gate; add the environment-protected secret
  (`SIGNPATH_API_TOKEN`)/variable (`SIGNPATH_ORGANIZATION_ID`); confirm
  exact `tauri-plugin-updater` version and add the dependency (Rust + JS)
  without wiring the updater itself up yet.
- **Session 6** — Signed update manifest + updater plugin wiring. Add
  `bundle.createUpdaterArtifacts`; generate the Ed25519 updater keypair;
  extend `updates.rs`/`lib/update.ts`'s contract with the new manifest
  fields (§3.5); wire `tauri-plugin-updater`'s `check()`/`downloadAndInstall()`
  behind the existing check-only UI's "install" action (previously just
  "View Release / Download").
- **Session 7** — Secure download/verify/install, end to end. HTTPS
  redirect-target validation (§3.7); SHA256 pre-check alongside the
  plugin's own signature check (§3.6); restart behavior (§3.15).
- **Session 8** — Mandatory pre-update backup + update journal. New
  `"preUpdate"` backup class; `update_journal.jsonl`; abort-before-
  touching-anything on backup failure, matching §3.12.
- **Session 9** — Startup health check + rollback trigger + rollback
  execution. §3.16-3.17; the actual rollback mechanism (restore the
  pre-update backup, reinstall the retained previous version).
- **Session 10** — Rollback retention + limits + failed-update recovery
  UI. §3.18-3.20.
- **Session 11** — Channels + staged rollout + update eligibility rules
  (schema compatibility, downgrade prevention hardening). §3.8-3.11 —
  contingent on the unresolved-decision answers in §5.
- **Session 12** — CI/CD release automation closure. Version-bump
  single-source tooling (§1.4); release-provenance line in release notes
  (§3.23); offline/manual fallback re-confirmed still works end to end
  (§3.21); full release workflow dry run on a real test tag.
- **Session 13** — Commercial Release Closure and Verification. Full
  regression (mirroring every prior phase's closure discipline); a real
  signed release built and inspected (`Get-AuthenticodeSignature` =
  `Valid`, not `NotSigned`); a verified in-app update install on a real
  test machine; a verified automatic rollback (deliberately induced
  failure); a **final clean-machine Windows installation test** (a
  machine with no prior FormuLab install or dev tooling, using only the
  published signed installer). Documentation closure across all Phase 12
  docs, matching Phase 11 Stage 1/Stage 2 Closure's own precedent.

Each session stays bounded to one related subsystem and one logical
commit, per `AGENTS.md`'s existing phase-handoff convention. Sessions 2-12
are implementation/process sessions (targeted tests only, per
`AGENTS.md`, except Session 2's own closure-style full verification —
justified because it touches shared/first-party source across the whole
tree, not one subsystem); full regression, release builds, and native
verification are otherwise reserved for Session 13, matching every prior
phase's closure discipline.

## 8. Exact next session

**Phase 12 Session 4: SignPath Application and Approval Gate.** Session
3's real, published, non-draft
[`v0.4.0`](https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0)
release satisfies the eligibility blocker found in Session 1 (§9) —
SignPath requires the project already be released in the form to be
signed, and it now is. Submit the dossier
(`docs/SIGNPATH_APPLICATION.md`, updated for the real release) to
`signpath.org/apply`. Largely an external-review wait: submit, track,
and record the outcome. Session 3 also flagged a real, unresolved
discrepancy Session 4 should address before or during submission: the
application checklist assumes `SECURITY.md`/`docs/PRIVACY.md`/
`docs/CODE_SIGNING_POLICY.md` are "live on `main`," but `main` is 224
commits behind `feature/laboratory-stability` and does not contain any
of Phase 11/12's work — either merge to `main` first, or adjust the
application's claims to reference the branch/tag the documents actually
live on.

## 9. Session 1 — Free Open-Source Code-Signing Foundation (complete)

**Scope**: business decision from the user (zero code-signing budget —
use SignPath Foundation's free open-source program; no paid OV/EV
certificate, no Azure Artifact Signing). Verify repository eligibility
against SignPath's own published conditions; prepare policy/privacy/
security documentation and a copy-paste-ready application dossier;
design (but do not activate) the GitHub Actions signing integration and
the nested signing order. No signing, update download, update execution,
or rollback implemented.

### Eligibility conditions — sourced directly, not from memory

Fetched directly from `signpath.org/terms.html` this session (quoted
verbatim in the eligibility table below) rather than relied on from
general knowledge, matching this project's own "evidenced not assumed"
discipline. Cross-checked against `ossperks.com`'s and other independent
summaries via web search for consistency.

### Eligibility result: 6 of 7 conditions met; 1 real blocker found

See `docs/SIGNPATH_APPLICATION.md`'s own eligibility table for the full
condition-by-condition evidence. Summary:

- **License** — MIT, OSI-approved, no dual-licensing. Met.
- **Public repository** — confirmed via `gh api repos/Sekiph82/FormuLab`
  (`"private":false,"visibility":"public"`). Met.
- **Actively maintained** — commits on essentially every recent working
  day, most recent the same day as this session. Met.
- **No malware/PUP/security-circumvention features** — met by inspection;
  nothing in this codebase does either.
- **GitHub-hosted build origin** — `build.yml`'s Windows job already runs
  on `windows-latest` (GitHub-hosted), which is what SignPath's GitHub
  connector requires for OSS-tier origin verification (confirmed via
  SignPath's own published GitHub integration documentation, fetched this
  session). Met.
- **No proprietary component** — met, **but only as currently
  configured**, and only after this session found and corrected a real
  problem: see "Real finding" below.
- **"Must already be released in the form that should be signed"** —
  **NOT met.** `gh api repos/Sekiph82/FormuLab/releases` returns `[]`;
  `git tag -l` is empty. Zero releases, draft or published, have ever
  existed. This is the one genuine repository-eligibility blocker this
  session found — see §8 above for the remediation session it requires.

### Real finding: a bundled component's license was misdocumented

Investigating "does any proprietary first-party component exist" led to
checking every third-party component `scripts/dev/fetch-*.sh` pulls in at
build time, individually, by license:

- OpenCode sidecar (`anomalyco/opencode`) — MIT, confirmed via
  `gh api repos/anomalyco/opencode`.
- `uv` sidecar (`astral-sh/uv`) — Apache-2.0, confirmed the same way.
- The (since-removed, see §10) default scientific-skills pack — MIT,
  confirmed the same way at the time.
- `anthropic-skills` (`anthropics/skills`, the docx/pdf/pptx/xlsx document
  skills) — **`scripts/dev/fetch-skills.sh`'s own comment claimed this
  was "the Apache-2.0 licensed anthropics/skills repo."** Checked
  directly: the repository has **no root `LICENSE` file** (GitHub's own
  API reports `license: null`), and each individual skill directory
  (`skills/docx/LICENSE.txt`, fetched and read directly) instead reads:
  *"(c) 2025 Anthropic, PBC. All rights reserved... governed by your
  agreement with Anthropic regarding use of Anthropic's services."* This
  is a proprietary license, not Apache-2.0 — the in-repo comment was
  factually wrong. **Corrected this session** in
  `scripts/dev/fetch-skills.sh` (a one-line-scope comment fix, syntax-
  checked with `bash -n`, no behavior change).
- Whether this actually threatens eligibility depends entirely on whether
  this content ends up **inside the signed artifact** — checked directly:
  `tauri.conf.json`'s `bundle.resources` only lists
  `runtime/skills/core` (FormuLab's own first-party skills),
  `runtime/harness`, and two example project directories.
  `runtime/skills/external/` (where both the former default scientific
  pack and `anthropic-skills` were fetched by CI) is **not** in that list, and nothing
  in `apps/desktop/src-tauri/src` references either directory (checked via
  `grep`). **Conclusion: the proprietary content is fetched by CI but
  never bundled into any built installer today** — the "no proprietary
  component" condition is genuinely met by what actually ships, not
  merely assumed. This must stay true; the correction above and
  `docs/SIGNPATH_APPLICATION.md`'s own note both flag that
  `bundle.resources` must be re-checked before ever adding
  `runtime/skills/external/` to it.

### Secondary finding: dead CI step fetching an unused component

The same investigation found `fetch-goal-plugin.sh` still runs in
`build.yml`, fetching `@prevalentware/opencode-goal-plugin` from npm
(MIT-licensed, no eligibility concern) — but zero references to
`goal_plugin`/`ensure_goal_plugin`/`goal.rs` exist anywhere in
`apps/desktop/src-tauri/src` today, despite `PROGRESS.md` (2026-07-15)
describing this feature as shipped and wired in. The feature appears to
have been removed from the application since; the fetch step was not
removed alongside it. Not a SignPath-eligibility concern (the package is
MIT and, like the skills above, not in `bundle.resources` either) — noted
here as a repository-hygiene finding for a future session to decide
whether to remove, not acted on in this session (out of this session's
scope, and removing a CI step is a build-pipeline change this session
was explicitly told to leave prepared-but-inactive, not to start editing
for unrelated cleanup).

### Roles — disclosed honestly, not padded

SignPath's Author/Reviewer/Approver model is recorded against FormuLab's
real structure: a single maintainer (`Sekiph82`, confirmed 235/235
commits via `git shortlog -sne --all`, no `CODEOWNERS` file, no external
contributors to date). Reviewers and a second Approver are recorded as
"not yet applicable" rather than invented — full detail and the honest-
disclosure rationale in `docs/CODE_SIGNING_POLICY.md`.

### Policy documents created this session

- `SECURITY.md` (repository root) — vulnerability reporting (GitHub
  private vulnerability reporting as the preferred channel, deliberately
  avoiding publishing a personal email to a public repository), scope,
  response-time honesty (single-maintainer, no formal SLA), a pointer to
  the code-signing verification instructions.
- `docs/PRIVACY.md` — a complete network-communication inventory
  (LLM provider calls using the user's own key, the update-metadata
  check, OpenAlex literature search, explicit "open externally" clicks —
  and nothing else, re-verified this session: zero telemetry/analytics/
  crash-reporting SDK anywhere in `apps/desktop/src` or
  `apps/desktop/src-tauri/src`).
- `docs/CODE_SIGNING_POLICY.md` — SignPath attribution text (required by
  its OSS conditions), roles, release-approval policy, the full nested
  signing order (sign exe → package installers → sign installers →
  verify → publish SHA256), artifact scope (`formulab.exe`, NSIS, MSI —
  explicitly not macOS/Linux), deterministic naming, verification
  instructions (`Get-AuthenticodeSignature`/`Get-FileHash`), release-
  provenance expectations, and explicit "not active" status for the
  GitHub Actions integration.
- `docs/SIGNPATH_APPLICATION.md` — the copy-paste-ready dossier (project
  description, repository URL, license, release/download URL,
  maintainers, reviewers, signing approvers, security/privacy/code-
  signing policy URLs, build workflow, artifacts to be signed,
  justification) plus the eligibility self-check table and an
  application checklist whose first item is the blocker remediation
  (§8).
- `README.md` — linked the above from Safety and Privacy, and added a
  short Code Signing section stating signing is prepared but not active.

### GitHub Actions integration — prepared, documentation-only, not activated

No `.github/workflows/*.yml` file was added or modified this session
(`build.yml` itself is untouched). Per this session's explicit
instruction, the SignPath submission step is recorded as an annotated
example only, in `docs/CODE_SIGNING_POLICY.md`, referencing SignPath's
own published `signpath/github-action-submit-signing-request@v2` action
and its real required inputs (`api-token` from a `SIGNPATH_API_TOKEN`
secret, `organization-id` from a `SIGNPATH_ORGANIZATION_ID` variable,
`project-slug`, `signing-policy-slug`, `github-artifact-id`) — every
identifier a genuine placeholder-free description of what's needed, never
a fabricated value that could be mistaken for real configuration. Wiring
this for real is Session 4's work, after Session 3's approval supplies
the actual identifiers.

### Nested signing order and artifact scope — designed, not yet executed

Recorded in full in `docs/CODE_SIGNING_POLICY.md`: sign `formulab.exe` →
package MSI/NSIS around the now-signed exe → sign each installer as its
own outer package → CI-side `signtool verify` gate → publish SHA256 for
all three. Scope is exactly `formulab.exe`, the NSIS installer, and the
MSI installer — macOS/Linux signing explicitly out of scope for this
free-OSS-Windows-only program.

### Tests

`git diff --check`: clean. Version-consistency check re-run: all four
version literals (`package.json` root, `apps/desktop/package.json`,
`tauri.conf.json`, `Cargo.toml`) still agree at `0.4.0`. `bash -n` on the
one shell-script comment fix (`scripts/dev/fetch-skills.sh`): clean. No
broad product suite run — no application source code changed, per this
session's own instruction.

### Limitations and unresolved items carried forward

- The release-publication blocker itself (§8) — the load-bearing item.
- SignPath's actual review outcome is unknown and unclaimed — this
  session prepares the application, it does not submit or claim
  approval, per explicit instruction.
- Reviewer/second-Approver roles remain "not yet applicable" — a real
  structural limitation of a single-maintainer project, not hidden but
  not solved by this session either.
- The dead `fetch-goal-plugin.sh` CI step (secondary finding above) is
  noted, not removed — a future session's call, not this one's.
- GitHub's own license detector reports `NOASSERTION` for this repository
  despite a clearly valid root `LICENSE` file (MIT) — likely because the
  file's trailing third-party-skills note breaks GitHub's automatic SPDX
  match; harmless for a human SignPath reviewer reading the actual file,
  but noted since it could look like a licensing red flag from GitHub's
  UI alone.
