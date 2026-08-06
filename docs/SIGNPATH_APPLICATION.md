# SignPath Foundation Application Dossier

Copy-paste-ready material for FormuLab's application to
[SignPath Foundation's free open-source code-signing program](https://signpath.org).
**This document does not claim SignPath has reviewed or approved
anything** — it is preparation only, assembled from this repository's own
verified state, originally as of Phase 12 Session 1 (2026-08-06),
corrected in Session 2A (OpenCode sidecar removal) and Session 3 (the
release blocker resolved — see the correction notes below each affected
row rather than silently rewriting Session 1's own original findings).

## Eligibility self-check (evidenced this session)

| SignPath condition (quoted from `signpath.org/terms.html`) | FormuLab status | Evidence |
|---|---|---|
| "OSI-approved Open Source license without commercial dual-licensing for all components" | **Met** | MIT (`LICENSE`) — OSI-approved. Single license, no dual-licensing text anywhere in the repository. |
| "may not contain any proprietary, non open-source component" | **Met, verified directly, with one finding corrected this session** | See "Bundled third-party components" below. |
| "must be actively maintained" | **Met** | Commits on essentially every recent working day; most recent commit this same day. |
| "must already be released in the form that should be signed" | **MET as of Phase 12 Session 3** | Real, published, non-draft GitHub Release exists: [`v0.4.0`](https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0). (Originally: **NOT MET** — `gh api repos/Sekiph82/FormuLab/releases` returned `[]`, zero tags existed. See "Blocker — resolved" below.) |
| "functionality... described on its download page" | **Met as of Phase 12 Session 3** | The published release's notes describe FormuLab's implemented product areas, limitations, privacy summary, and security reporting path directly on the download page. |
| "must not contain malware or potentially unwanted programs" | **Met** | No obfuscated code, no bundled unwanted software. The sole third-party binary sidecar shipped today (`uv`) is fetched from its own public, named upstream release. (Corrected Phase 12 Session 2A: OpenCode was previously also listed as a shipped sidecar — it has since been removed from the app entirely; see "Bundled third-party components" below.) |
| No "features designed to identify or exploit security vulnerabilities or circumvent security measures" | **Met** | FormuLab is a chemical-formulation research desktop app; no such functionality exists. |

### Bundled third-party components — checked individually

| Component | Source | License | Actually shipped in the built app? |
|---|---|---|---|
| OpenCode sidecar | `anomalyco/opencode` releases | MIT (confirmed via GitHub API) | **No — removed entirely in Phase 12 Session 2A.** Originally listed here as shipped (`Yes — externalBin`); investigation during Session 2A's identity-eradication scan found the app's own Rust source contains no `.sidecar("opencode")` call anywhere and `tauri.conf.json`'s `externalBin` never listed it — `workspace.rs`'s own comment states outright "this is what survived the OpenCode removal." The fetch script and its CI step were removed along with the (already-unused) local binary. |
| `uv` sidecar | `astral-sh/uv` releases | Apache-2.0 (confirmed via GitHub API) | Yes — `externalBin` (the only sidecar this app ships today) |
| *(default scientific-skills pack)* | — | MIT (confirmed via GitHub API) | **Removed entirely in Phase 12 Session 2** — was not embedded in any built installer (fetched into `runtime/skills/external/`, never in `tauri.conf.json`'s `bundle.resources`), and no current source path consumed it; removed rather than kept as dead weight |
| `anthropic-skills` (docx/pdf/pptx/xlsx) | `anthropics/skills` | **Proprietary** — each skill's own `LICENSE.txt` reads "(c) Anthropic, PBC. All rights reserved... governed by your agreement with Anthropic regarding use of Anthropic's services" (verified directly Phase 12 Session 1 — a prior in-repo comment incorrectly called this Apache-2.0, corrected in `scripts/dev/fetch-skills.sh`) | **No** — not in `bundle.resources`, not embedded today |
| `@prevalentware/opencode-goal-plugin` | npm | MIT (per this project's own prior research, `PROGRESS.md` 2026-07-15) | **No** — the feature that consumed it appears to have been removed from the Rust source since (zero matches for `goal_plugin`/`ensure_goal_plugin` anywhere in `apps/desktop/src-tauri/src` today); `fetch-goal-plugin.sh` still runs in CI fetching an npm package nothing currently reads |

**Conclusion**: as currently configured (`tauri.conf.json`'s
`bundle.resources`), the built/signed artifact contains only first-party
FormuLab code (`runtime/skills/core`, `runtime/harness`, two example
project directories) plus one arm's-length, genuinely open-source sidecar
binary (`uv`: Apache-2.0 — OpenCode was removed in Phase 12 Session 2A,
see above). The one proprietary component found (`anthropics/skills`'
docx/pdf/pptx/xlsx content) is fetched by CI but never bundled into the
shipped installer — confirmed by absence from `bundle.resources`, not
merely assumed. This must stay true; anyone changing `bundle.resources`
to include `runtime/skills/external/` in the future must re-check this
license first.

## Blocker — resolved in Phase 12 Session 3

**Originally**: no release had ever been published or drafted. SignPath
explicitly requires the project already be released in the form to be
signed, and FormuLab's release pipeline (`.github/workflows/build.yml`,
triggered on a `v*` tag) had simply never been run — zero tags existed.

**Resolution**: Phase 12 Session 3 published
[`v0.4.0`](https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0) —
real, public, non-draft, Windows x64, unsigned and disclosed as such, with
both installers hash-verified against a published `SHA256SUMS.txt` via an
independent re-download. One real CI issue surfaced and was fixed along
the way: the standard tag-push trigger did not fire on this repository
(confirmed via the GitHub Actions API; `workflow_dispatch` worked fine),
worked around with a `workflow_dispatch` `tag` input — disclosed in
`docs/handoffs/PHASE12_CURRENT.md`'s Session 3 summary, not hidden. This
blocker is now resolved; this document's "Blocker requiring a decision
before applying" status is stale as of Session 3 and superseded by this
section.

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
— populated as of Phase 12 Session 3:
[`v0.4.0`](https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0) is
live, public, and non-draft.

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

- [x] **Blocker**: publish a real, non-draft GitHub Release (tag a
  version, let CI build it, publish the resulting draft). **Done, Phase
  12 Session 3**: [`v0.4.0`](https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0).
- [ ] Confirm `SECURITY.md`, `docs/PRIVACY.md`, and
  `docs/CODE_SIGNING_POLICY.md` are all live on `main`. **Found false,
  Phase 12 Session 3**: none of the three exist on `main` — `main` is
  224 commits behind `feature/laboratory-stability`, where every Phase
  11/12 document actually lives. Either merge `feature/laboratory-
  stability` into `main` before applying, or confirm with SignPath that
  linking the release tag / feature branch directly satisfies this
  condition instead of assuming `main` is authoritative.
- [x] Re-run the eligibility self-check above against the *published*
  release. **Done, Phase 12 Session 3** — see the updated table above;
  the release page's own notes describe FormuLab's implemented product
  areas, limitations, privacy, and security-reporting path directly.
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
