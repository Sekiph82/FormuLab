# SignPath Foundation Application Dossier

Copy-paste-ready material for FormuLab's application to
[SignPath Foundation's free open-source code-signing program](https://signpath.org).
**This document does not claim SignPath has reviewed or approved
anything** — it is preparation only, assembled from this repository's own
verified state as of Phase 12 Session 1 (2026-08-06).

## Eligibility self-check (evidenced this session)

| SignPath condition (quoted from `signpath.org/terms.html`) | FormuLab status | Evidence |
|---|---|---|
| "OSI-approved Open Source license without commercial dual-licensing for all components" | **Met** | MIT (`LICENSE`) — OSI-approved. Single license, no dual-licensing text anywhere in the repository. |
| "may not contain any proprietary, non open-source component" | **Met, verified directly, with one finding corrected this session** | See "Bundled third-party components" below. |
| "must be actively maintained" | **Met** | Commits on essentially every recent working day; most recent commit this same day. |
| "must already be released in the form that should be signed" | **NOT MET — real gap** | `gh api repos/Sekiph82/FormuLab/releases` returns `[]`. Zero tags exist (`git tag -l` empty). No release, draft or published, has ever been created. See "Blocker" below. |
| "functionality... described on its download page" | **Cannot be assessed until a release exists** — depends on the gap above. | — |
| "must not contain malware or potentially unwanted programs" | **Met** | No obfuscated code, no bundled unwanted software; every third-party binary sidecar (OpenCode, `uv`) is fetched from its own public, named upstream release. |
| No "features designed to identify or exploit security vulnerabilities or circumvent security measures" | **Met** | FormuLab is a chemical-formulation research desktop app; no such functionality exists. |

### Bundled third-party components — checked individually

| Component | Source | License | Actually shipped in the built app? |
|---|---|---|---|
| OpenCode sidecar | `anomalyco/opencode` releases | MIT (confirmed via GitHub API) | Yes — `externalBin` |
| `uv` sidecar | `astral-sh/uv` releases | Apache-2.0 (confirmed via GitHub API) | Yes — `externalBin` |
| *(default scientific-skills pack)* | — | MIT (confirmed via GitHub API) | **Removed entirely in Phase 12 Session 2** — was not embedded in any built installer (fetched into `runtime/skills/external/`, never in `tauri.conf.json`'s `bundle.resources`), and no current source path consumed it; removed rather than kept as dead weight |
| `anthropic-skills` (docx/pdf/pptx/xlsx) | `anthropics/skills` | **Proprietary** — each skill's own `LICENSE.txt` reads "(c) Anthropic, PBC. All rights reserved... governed by your agreement with Anthropic regarding use of Anthropic's services" (verified directly Phase 12 Session 1 — a prior in-repo comment incorrectly called this Apache-2.0, corrected in `scripts/dev/fetch-skills.sh`) | **No** — not in `bundle.resources`, not embedded today |
| `@prevalentware/opencode-goal-plugin` | npm | MIT (per this project's own prior research, `PROGRESS.md` 2026-07-15) | **No** — the feature that consumed it appears to have been removed from the Rust source since (zero matches for `goal_plugin`/`ensure_goal_plugin` anywhere in `apps/desktop/src-tauri/src` today); `fetch-goal-plugin.sh` still runs in CI fetching an npm package nothing currently reads |

**Conclusion**: as currently configured (`tauri.conf.json`'s
`bundle.resources`), the built/signed artifact contains only first-party
FormuLab code (`runtime/skills/core`, `runtime/harness`, two example
project directories) plus two arm's-length, genuinely open-source sidecar
binaries (OpenCode: MIT, `uv`: Apache-2.0). The one proprietary component
found (`anthropics/skills`' docx/pdf/pptx/xlsx content) is fetched by CI
but never bundled into the shipped installer — confirmed by absence from
`bundle.resources`, not merely assumed. This must stay true; anyone
changing `bundle.resources` to include `runtime/skills/external/` in the
future must re-check this license first.

## Blocker requiring a decision before applying

**No release has ever been published or drafted.** SignPath explicitly
requires the project already be released in the form to be signed. FormuLab
has a working release pipeline (`.github/workflows/build.yml`, triggered
on a `v*` tag) that has simply never been run — zero tags exist in this
repository. Applying to SignPath today would fail this specific,
published condition.

**Required remediation** (a bounded, separate session — see "Exact next
session" in the handoff): push a real `v0.4.0` (or current version) tag,
let the existing unsigned build pipeline produce a real draft release,
and **publish** it (even unsigned, exactly as every artifact has been
disclosed as unsigned throughout Phase 11). This gives SignPath something
real to point at, and gives FormuLab an actual download page — which also
resolves the "functionality described on its download page" condition,
since a published GitHub Release with the existing release-notes template
already describes what's being installed.

## Application dossier (copy-paste-ready once the release blocker above is resolved)

**Project name**: FormuLab

**Project description**: Local-first, model-agnostic AI research
workbench for chemical formulation discovery, optimization, cost
management, laboratory trials, stability studies, and regulatory
documentation — for macOS, Windows, and Linux. Built on Tauri 2, React,
and Rust. Free and open source (MIT).

**Repository URL**: https://github.com/Sekiph82/FormuLab

**License**: MIT (see `LICENSE`). OSI-approved, no commercial
dual-licensing.

**Release/download URL**: `https://github.com/Sekiph82/FormuLab/releases`
— **not yet populated; blocked on the remediation above.**

**Maintainers**: Sekiph82 (sole maintainer and repository owner; 235/235
commits to date, confirmed via `git shortlog -sne`).

**Reviewers**: None yet — no external contributors to date. This role
activates for real once an external PR is accepted.

**Signing approvers**: Sekiph82, until a second maintainer exists. See
`docs/CODE_SIGNING_POLICY.md`'s roles section for the full, honest
disclosure of this single-maintainer structure.

**Security policy URL**:
`https://github.com/Sekiph82/FormuLab/blob/main/SECURITY.md`

**Privacy policy URL**:
`https://github.com/Sekiph82/FormuLab/blob/main/docs/PRIVACY.md`

**Code-signing policy URL**:
`https://github.com/Sekiph82/FormuLab/blob/main/docs/CODE_SIGNING_POLICY.md`

**Build workflow**: GitHub Actions, `.github/workflows/build.yml` —
GitHub-hosted runners only (`windows-latest` for the Windows job — meets
SignPath's OSS-tier requirement that every job in the chain run on a
GitHub-hosted agent, not a self-hosted one), triggered on a `v*` tag push,
using `tauri-apps/tauri-action@v0`.

**Artifacts to be signed**: `formulab.exe`, the NSIS installer
(`FormuLab_<version>_x64-setup.exe`), the MSI installer
(`FormuLab_<version>_x64_en-US.msi`). Full nested signing order in
`docs/CODE_SIGNING_POLICY.md`.

**Justification for free OSS signing**: FormuLab is a genuinely free,
MIT-licensed, local-first research tool with no commercial tier, no
proprietary fork, and no revenue model — it has zero budget for a paid
Authenticode certificate. Its only currently-shipped users must clear a
Windows SmartScreen warning on every install, which SignPath's free
program directly solves for exactly the kind of small, single-maintainer
OSS project this program exists to support.

## Application checklist

- [ ] **Blocker**: publish a real, non-draft GitHub Release (tag a
  version, let CI build it, publish the resulting draft).
- [ ] Confirm `SECURITY.md`, `docs/PRIVACY.md`, and
  `docs/CODE_SIGNING_POLICY.md` are all live on `main` (this session
  adds them; verify they're merged/pushed before applying).
- [ ] Re-run the eligibility self-check above against the *published*
  release (does its release page describe FormuLab's functionality
  clearly enough to satisfy the "download page" condition?).
- [ ] Submit the application at `signpath.org/apply` using the dossier
  fields above.
- [ ] On approval, record the real SignPath organization ID, project
  slug, signing-policy slug, and artifact-configuration slug in
  `docs/CODE_SIGNING_POLICY.md` and wire the real (not documentation-only)
  GitHub Actions signing step — Phase 12 Session 2's work, not this
  session's.
- [ ] Never commit the SignPath API token — it becomes a GitHub Actions
  **environment-protected** secret (`SIGNPATH_API_TOKEN`), per
  `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` §3.22.
