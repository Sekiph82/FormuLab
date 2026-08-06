# SignPath Foundation Application Dossier

Copy-paste-ready material for FormuLab's application to
[SignPath Foundation's free open-source code-signing program](https://signpath.org).
**This document does not claim SignPath has reviewed or approved
anything, and no application has been submitted as of Phase 12 Session
4** — it is preparation only, assembled from this repository's own
verified state, originally as of Phase 12 Session 1 (2026-08-06),
corrected in Session 2A (OpenCode sidecar removal), Session 3 (the
release blocker resolved), and Session 4 (fresh eligibility re-audit,
provenance fields added, submission-readiness assessed — see the
correction notes below each affected row rather than silently rewriting
earlier sessions' own original findings).

**Signing-integration status: `BLOCKED_PENDING_SIGNPATH_APPROVAL`.** No
SignPath organization, project, signing policy, or artifact
configuration exists yet. No GitHub Actions signing step has been
added. This gate does not lift until a real approval with real
identifiers exists — see "Signing-integration readiness" near the end
of this document for exactly what that activation will require.

## Eligibility self-check (fresh, re-verified Phase 12 Session 4)

| SignPath condition (quoted from `signpath.org/terms.html`) | FormuLab status | Evidence |
|---|---|---|
| "OSI-approved Open Source license without commercial dual-licensing for all components" | **Met** | MIT (`LICENSE`) — OSI-approved. Single license, no dual-licensing text anywhere in the repository. **GitHub's own license detector reports `NOASSERTION`, checked fresh this session** (`gh api repos/Sekiph82/FormuLab --jq .license` → `{"key":"other","spdx_id":"NOASSERTION"}`) — investigated directly: `LICENSE`'s body (lines 1-19) is a verbatim, unmodified MIT template; a trailing footnote (lines 21-26, disclosing that an optional, never-bundled-by-default third-party skill collection carries its own licenses) is *appended after* the template, which most likely drops GitHub's `licensee` similarity match below its detection threshold. This is a known limitation of automated license detection on files with any appended text, not a real licensing defect — a human reviewer opening `LICENSE` sees unambiguous MIT. Disclosed here rather than left unexplained. |
| "may not contain any proprietary, non open-source component" | **Met, verified directly** | See "Bundled third-party components" below. |
| "must be actively maintained" | **Met** | `git shortlog -sne --all`, re-run fresh this session: **242/242 commits**, single contributor (Sekiph82), most recent commit this same day. |
| "must already be released in the form that should be signed" | **MET, re-verified fresh via `gh api repos/Sekiph82/FormuLab/releases/tags/v0.4.0`** | `draft: false`, `prerelease: false`, `target_commitish: 833e7ee9e82e854a4c163d7e93ac48fd6472e817`, 3 assets present (`FormuLab_0.4.0_x64-setup.exe` 25,324,495 bytes, `FormuLab_0.4.0_x64_en-US.msi` 36,052,992 bytes, `SHA256SUMS.txt` 190 bytes), all `state: "uploaded"`. |
| "functionality... described on its download page" | **Met** | The published release's notes describe FormuLab's implemented product areas, limitations, privacy summary, and security reporting path directly on the download page. |
| "must not contain malware or potentially unwanted programs" | **Met** | No obfuscated code, no bundled unwanted software. The sole third-party binary sidecar shipped today (`uv`) is fetched from its own public, named upstream release. |
| No "features designed to identify or exploit security vulnerabilities or circumvent security measures" | **Met** | FormuLab is a chemical-formulation research desktop app; no such functionality exists. |
| Artifacts remain unsigned, disclosed as such (not a SignPath condition per se, but load-bearing for the application's own honesty) | **Confirmed** | `Get-AuthenticodeSignature` on both independently re-downloaded `v0.4.0` installers, checked fresh this session: `NotSigned` for both. |

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

## Application dossier (copy-paste-ready — fields below are evidenced; see "USER INPUT REQUIRED" for what is not)

**Project name**: FormuLab

**Project description**: Local-first, model-agnostic AI research
workbench for chemical formulation discovery, optimization, cost
management, laboratory trials, stability studies, and regulatory
documentation — for macOS, Windows, and Linux. Built on Tauri 2, React,
and Rust. Free and open source (MIT).

**Repository URL**: https://github.com/Sekiph82/FormuLab

**License**: MIT (see `LICENSE`). OSI-approved, no commercial
dual-licensing. (GitHub's automated detector shows `NOASSERTION` — see
the eligibility table above for why; the `LICENSE` file itself is
unambiguous MIT.)

**Release/download URL**:
[`https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0`](https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0)
— live, public, non-draft.

**Release version and commit** *(added Session 4 — not previously in
this dossier)*: tag `v0.4.0`, commit
`833e7ee9e82e854a4c163d7e93ac48fd6472e817`, built by GitHub Actions
workflow run
[#31127313636](https://github.com/Sekiph82/FormuLab/actions/runs/31127313636)
(success). This is the exact, inspectable provenance of the artifacts
that would be submitted for signing.

**Maintainers**: Sekiph82 (sole maintainer and repository owner;
242/242 commits to date, confirmed fresh this session via
`git shortlog -sne --all`).

**Reviewers**: None yet — no external contributors to date. This role
activates for real once an external PR is accepted.

**Signing approvers**: Sekiph82, until a second maintainer exists. See
`docs/CODE_SIGNING_POLICY.md`'s roles section for the full, honest
disclosure of this single-maintainer structure.

**Security policy URL**:
[`https://github.com/Sekiph82/FormuLab/blob/v0.4.0/SECURITY.md`](https://github.com/Sekiph82/FormuLab/blob/v0.4.0/SECURITY.md)
— **not `blob/main/...`**: confirmed fresh this session (direct
unauthenticated fetch, `raw.githubusercontent.com`) that `main` returns
`404` for this file while the `v0.4.0` tag returns `200`. `main` is 227
commits behind `feature/laboratory-stability`, where every Phase 11/12
document actually lives — Session 4 opened
[PR #1](https://github.com/Sekiph82/FormuLab/pull/1) to fix this, not
yet merged (see "Main-branch status" below). Once merged, this URL
should be updated to `blob/main/...` for a link that stays current
across future releases rather than pinned to `v0.4.0` forever.

**Privacy policy URL**:
[`https://github.com/Sekiph82/FormuLab/blob/v0.4.0/docs/PRIVACY.md`](https://github.com/Sekiph82/FormuLab/blob/v0.4.0/docs/PRIVACY.md)
(same `main`-vs-tag caveat as above)

**Code-signing policy URL**:
[`https://github.com/Sekiph82/FormuLab/blob/v0.4.0/docs/CODE_SIGNING_POLICY.md`](https://github.com/Sekiph82/FormuLab/blob/v0.4.0/docs/CODE_SIGNING_POLICY.md)
(same `main`-vs-tag caveat as above)

**Build workflow**: GitHub Actions, `.github/workflows/build.yml` —
GitHub-hosted runners only (`windows-latest` for the Windows job — meets
SignPath's OSS-tier requirement that every job in the chain run on a
GitHub-hosted agent, not a self-hosted one). Triggered on a `v*` tag
push, **or** (added Session 3, since the tag-push trigger does not
currently fire on this repository — a real, disclosed, unresolved
anomaly; see `docs/handoffs/PHASE12_CURRENT.md`'s Session 4 summary) a
manual `workflow_dispatch` run with its `tag` input set, producing
identical release output either way. Uses `tauri-apps/tauri-action@v0`.
`v0.4.0` was published via the `workflow_dispatch` path.

**Artifacts to be signed**: `formulab.exe`, the NSIS installer
(`FormuLab_<version>_x64-setup.exe`), the MSI installer
(`FormuLab_<version>_x64_en-US.msi`). Full nested signing order in
`docs/CODE_SIGNING_POLICY.md`.

**Signing-integration status**: not active. No SignPath organization,
project, signing policy, or artifact-configuration identifiers exist.
No GitHub Actions signing step has been added to `build.yml`. See
"Signing-integration readiness" below.

**Justification for free OSS signing**: FormuLab is a genuinely free,
MIT-licensed, local-first research tool with no commercial tier, no
proprietary fork, and no revenue model — it has zero budget for a paid
Authenticode certificate. Its only currently-shipped users must clear a
Windows SmartScreen warning on every install, which SignPath's free
program directly solves for exactly the kind of small, single-maintainer
OSS project this program exists to support.

## Main-branch status (Session 4)

Session 3 found `main` 224 commits behind `feature/laboratory-stability`
and missing every Phase 11/12 policy document. Session 4 re-confirmed
this is still true (227 commits behind as of this session — 3 more
commits landed on the feature branch since Session 3) and opened
[PR #1](https://github.com/Sekiph82/FormuLab/pull/1), a clean
fast-forward with zero unique `main`-only commits and zero conflicts.
**Not merged this session** — the PR's own diff would change
`.FormuLab/runs.db`'s tracked content on `main` (same size, different
bytes), which conflicts with this project's own standing "never touch
real user data" rule carried through every session on this repository.
Left open for a human decision; see the PR description and
`docs/handoffs/PHASE12_CURRENT.md`'s Session 4 summary for the exact
blocker. Until merged, this dossier's policy-document URLs point to the
immutable `v0.4.0` tag (proven reachable) rather than `main` (proven
unreachable), per the same reasoning applied to the release notes in
Session 3.

## USER INPUT REQUIRED before this application can actually be submitted

This session did **not** submit the application. SignPath's application
form (`https://signpath.org/apply.html`) is a JavaScript-rendered web
form — no CLI/API submission path exists (confirmed: `WebFetch` against
that URL returns only static shell content, no form fields; no browser
automation tool was available/connected this session to load and
inspect it directly). Research (SignPath's own `terms.html`, a
third-party walkthrough of a real successful application, `OSSRequestForm-v4`)
indicates the form asks at minimum for: project/repository URL, license,
download/release URL, a project description, and a **contact email
address**. It may ask for more (organization/legal name, applicant name)
that this repository's own evidence cannot supply.

Every field above this section is evidenced and ready to paste in as-is.
The following are **not** filled in, and must come from the user
directly — nothing below was fabricated:

- **Contact email address.** Not committed anywhere in this repository.
  `sekiphayit1982@gmail.com` is on file as this project's owner email in
  local, non-committed project configuration (`CLAUDE.md`, not part of
  the git repository) — confirm this is the address to use before
  pasting it into any external form.
- **Applicant/legal name**, if the form distinguishes a person from a
  GitHub handle — not evidenced anywhere in this repository.
- **Postal address or phone number**, if requested — never gather or
  fabricate these; supply only if you choose to and the form requires
  them.
- **MFA confirmation** for both SignPath and GitHub account access —
  SignPath's eligibility conditions require this for all team members
  with signing access; confirm your own GitHub account
  (`Sekiph82`) has MFA enabled (`gh api user --jq .two_factor_authentication`
  can check this, but the API only reports MFA status for the
  authenticated user, and only in some auth contexts — verify directly
  in GitHub's own Settings → Password and authentication if unsure).
- **Acceptance of SignPath's own terms/legal conditions** — a decision
  only the user can make, reviewing the actual current terms at
  submission time (this document's own eligibility table is this
  session's best-effort match against `terms.html` as fetched this
  session, not a legal opinion).

**Exact steps to submit**:
1. Open `https://signpath.org/apply.html` in a browser.
2. Fill in the evidenced fields exactly as listed under "Application
   dossier" above.
3. Supply the fields listed in this section personally.
4. Review and accept SignPath's terms if presented.
5. Submit.
6. Record the result (confirmation, application/ticket ID, or rejection
   reason) in this document's "Application checklist" below and in the
   Phase 12 external log — a future session can do this recording step
   directly if the user pastes the confirmation details back.

## Signing-integration readiness (for a future session, once approved)

`BLOCKED_PENDING_SIGNPATH_APPROVAL` — none of the following exist yet;
none may be fabricated or placeholder-filled:

- SignPath **organization ID**
- SignPath **project slug/ID**
- SignPath **signing-policy slug/ID**
- SignPath **artifact-configuration slug/ID**
- A GitHub Actions **environment-protected secret**
  (`SIGNPATH_API_TOKEN`) — never committed in plaintext, never a
  repository-level (non-environment) secret
- Confirmation of SignPath's **trusted-build-system association** for
  this specific repository (GitHub Actions, `windows-latest` runners)
- The **nested signing order** is already fully specified and does not
  need rework once approved: sign `formulab.exe` → package MSI/NSIS →
  sign each installer separately → `signtool verify /pa /all` (or
  SignPath's own verification) before any release is drafted — see
  `docs/CODE_SIGNING_POLICY.md`.
- The **approval workflow** (who reviews/approves each signing request)
  is already specified in `docs/CODE_SIGNING_POLICY.md`'s roles table
  and does not need rework.

Once real identifiers exist, the work is: replace
`docs/CODE_SIGNING_POLICY.md`'s "Not active" language with the real
identifiers, add the real (not documentation-only) GitHub Actions
signing step using `signpath/github-action-submit-signing-request`,
and add the `signtool verify` CI gate — Session 5's work (see "Exact
next session"), not this session's.

## Application checklist

- [x] **Blocker**: publish a real, non-draft GitHub Release (tag a
  version, let CI build it, publish the resulting draft). **Done, Phase
  12 Session 3**: [`v0.4.0`](https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0).
- [ ] Confirm `SECURITY.md`, `docs/PRIVACY.md`, and
  `docs/CODE_SIGNING_POLICY.md` are all live on `main`. **Still not
  done as of Phase 12 Session 4**: [PR #1](https://github.com/Sekiph82/FormuLab/pull/1)
  is open (clean fast-forward, zero conflicts) but not merged — merging
  would change `.FormuLab/runs.db`'s tracked content on `main`, which
  needs a human decision first (see "Main-branch status" above). Until
  merged, this dossier links the immutable `v0.4.0` tag instead, which
  is genuinely reachable today.
- [x] Re-run the eligibility self-check above against the *published*
  release. **Done, Phase 12 Sessions 3 and 4** — see the updated table
  above; re-verified fresh via `gh api` this session, not assumed
  carried over.
- [ ] Submit the application at `signpath.org/apply.html` using the
  dossier fields above. **Not done as of Phase 12 Session 4** — the
  form requires browser interaction and at least one field (contact
  email) this session could not authoritatively confirm belongs to the
  applicant without the user's own confirmation. See "USER INPUT
  REQUIRED" above for the exact remaining steps.
- [ ] On approval, record the real SignPath organization ID, project
  slug, signing-policy slug, and artifact-configuration slug in
  `docs/CODE_SIGNING_POLICY.md` and wire the real (not documentation-only)
  GitHub Actions signing step — see "Signing-integration readiness"
  above; this is Phase 12 Session 5's work at the earliest, gated on
  approval.
- [ ] Never commit the SignPath API token — it becomes a GitHub Actions
  **environment-protected** secret (`SIGNPATH_API_TOKEN`), per
  `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` §3.22.
