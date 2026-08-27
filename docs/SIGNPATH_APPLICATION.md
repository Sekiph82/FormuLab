# SignPath Foundation Application Dossier

**Status: `AWAITING_RESPONSE`.** Official Foundation application form
(`signpath.org/apply.html`) did not render. A real request was filed at
[github.com/SignPath/fdn-website#26](https://github.com/SignPath/fdn-website/issues/26).
The existing `app.signpath.io` "FormuLab" organization is a commercial
free-trial signup, not confirmed Foundation approval — **it must not be
used for production signing** (no certificate, no signing policy, no
API token, no GitHub Actions signing, no signing/republishing a
release, no paid-plan selection) until SignPath confirms its status or
converts/links it to the OSS/Foundation program.

Copy-paste-ready material for FormuLab's application to
[SignPath Foundation's free open-source code-signing program](https://signpath.org).
**This document does not claim SignPath has reviewed or approved
anything.** As of Phase 12 Session 4A: no application was submitted
through SignPath's own intended form (it does not render); instead, a
public request was filed at
[github.com/SignPath/fdn-website#26](https://github.com/SignPath/fdn-website/issues/26)
asking for Foundation review — **awaiting a response, not an
approval.** Separately, the user self-service-signed-up for a
commercial "Free trial subscription" organization on `app.signpath.io`
(unrelated to Foundation review) — see "Submission status" below for
the full, real distinction between these two things. This document is
preparation and status-tracking only, assembled from this repository's
own verified state, originally as of Phase 12 Session 1 (2026-08-06),
corrected in Session 2A (OpenCode sidecar removal), Session 3 (the
release blocker resolved), Session 4 (fresh eligibility re-audit,
provenance fields added, submission-readiness assessed), and Session 4A
(personal fields confirmed by the user, a trial organization discovered
and investigated without production use, a public Foundation-review
request filed) — see the correction notes below each affected row
rather than silently rewriting earlier sessions' own original findings.

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
`project-control/claude/handoffs/PHASE12_CURRENT.md`'s Session 3 summary, not hidden. This
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
anomaly; see `project-control/claude/handoffs/PHASE12_CURRENT.md`'s Session 4 summary) a
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
`project-control/claude/handoffs/PHASE12_CURRENT.md`'s Session 4 summary for the exact
blocker. Until merged, this dossier's policy-document URLs point to the
immutable `v0.4.0` tag (proven reachable) rather than `main` (proven
unreachable), per the same reasoning applied to the release notes in
Session 3.

## Submission status (Phase 12 Session 4A)

**Still not submitted — blocked by a different, external cause than
before.** The user completed and confirmed the previously-missing
personal fields via
`C:\Users\sekip\Desktop\FormuLab-SignPath-User-Input.md` (applicant
name, contact email, MFA confirmation, terms acceptance, and explicit
permission to submit on their behalf) and explicitly authorized
submission in chat. With browser access available this session,
`https://signpath.org/apply.html` was opened directly to attempt it.

**The page itself does not render an application form.** The heading
("Apply for a free SignPath.io subscription") and site navigation load
normally; the accessibility tree shows a `Form` element is structurally
present in the DOM, but it contains **zero fields, zero inputs, zero
content** — confirmed via the page's own accessibility tree (`read_page`),
a full-page screenshot, and scrolling (the visible content area is
entirely blank between the heading and the footer; there is nothing
further to scroll to). This was checked both before and after dismissing
the page's cookie-consent banner (chose "Refuse," the privacy-preserving
option) — no change. Console messages showed only generic browser-
extension noise, nothing form-specific; network requests showed no
traffic to `signpath.org` itself or any third-party form-hosting domain
during this check. This looks like the embedded form widget failing to
load for a reason not diagnosable from this side — possibly a temporary
issue on SignPath's own site/form-provider, or interference from a
security extension in this browser profile (a Kaspersky link-scanning
extension was observed active during the check). Re-checked via the
site's own in-page "Apply" nav link (not just direct URL navigation) —
identical empty result. Also checked `signpath.io` (a similarly-named
but different, commercial "Zero Trust Software Integrity Platform"
product — not the free Foundation program) at the user's own
suggestion: its "Open Source Community" page's "Join the community"
button links straight back to `signpath.org/`, no alternate
application route.

**Update, same session**: the user separately signed into
`app.signpath.io` directly (their own login — the "unavoidable
human-only step" this document already flagged) and found/created a
**"FormuLab" organization there via SignPath.io's own self-service
signup**, not through Foundation review. Investigated before touching
anything further (no certificate created, no CI signing activated, no
release signed or re-published):

- **Organization**: name "FormuLab", ID
  `b4b644ff-b883-4e06-9033-38873ce67e30`, created by the user via
  self-service signup (`Created by Sekip HAYIT at 2026-08-06 21:58:14
  UTC` — 3 minutes before the user mentioned it, no Foundation review
  event in its history).
- **Subscription type**: "Free trial subscription." Quotas: 2
  interactive users (1 used), 3 projects (0 used), 0 Hardware Security
  Module slots, 5 software key-store slots, 1.17 GB artifact volume/
  1,200 signatures for the usage period 2026-08-06 to 2027-08-05.
- **Billing/conversion**: the in-app "Change" subscription flow
  (`docs.signpath.io/change-subscription?...&currentProductId=FreeTrial`)
  shows **only paid plans** — STARTER ($950/yr), BASIC SINGLE
  ($1,500/yr), BASIC TEAM ($2,000/yr) — **no free/OSS option appears
  anywhere in this in-app flow.** EV certificates are issued by
  GlobalSign and require legal-entity verification. **No plan was
  selected, no payment page was reached, nothing was purchased.** This
  confirms the self-service trial and the Foundation's free program are
  genuinely different things — the trial does not automatically convert
  to or unlock Foundation status.
- **Support/contact channel used**: the in-app "More → Delete
  organization" option is destructive and was not touched. "Authorize
  support user" was seen but not used (grants SignPath staff access,
  not a communication channel). The `apply.html` page's own source
  (`docs/apply.md` in `github.com/SignPath/fdn-website`) revealed the
  broken embed is a HubSpot form (portal `145110231`, form
  `bf62807d-bb72-4e45-9bde-1f3a53ba2472`) — a direct HubSpot share-URL
  guess (`share-eu1.hsforms.com/<formId>`) returned an error page, a
  dead end, not pursued further. Instead, filed a public request on the
  Foundation's own project-listing repository — a precedented channel
  for exactly this: **[github.com/SignPath/fdn-website#26](https://github.com/SignPath/fdn-website/issues/26)**,
  opened 2026-08-06 22:11 UTC, requesting Foundation review of FormuLab
  and asking whether the existing trial organization can be converted
  or linked rather than creating a second one. Used only the evidenced
  dossier fields plus the user's own confirmed personal fields — nothing
  fabricated. **This is the current tracked request; no response yet.**

**Exact remaining action**: wait for a response on
[issue #26](https://github.com/SignPath/fdn-website/issues/26), or (as
before) try `https://signpath.org/apply.html` yourself from a different
browser/network in case it renders there. **Do not** create a
certificate, activate CI signing, or sign/publish anything against the
existing "FormuLab" trial organization until its status (trial vs.
Foundation-linked) is resolved — per the user's own explicit
instruction this session.

**Fields confirmed by the user** (from the completed input file,
2026-08-07 — not fabricated, supplied directly by the applicant):
applicant name, contact email, "GitHub MFA enabled: yes," "terms
accepted: yes," "permission to submit on my behalf: yes," role
description "Project owner." These are ready to use the moment the form
itself is reachable — see the input file directly for the literal
values (deliberately not duplicated here, so there is exactly one place
this personal information lives in written form).

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
  dossier fields above. **Still not done as of Phase 12 Session 4A** —
  the personal-field gap from Session 4 is resolved (user confirmed via
  the input file and authorized submission), but the form itself does
  not render any fields in this session's browser (structurally present
  in the DOM, visibly and structurally empty) — an external blocker on
  SignPath's own site, not a missing-information gap.
- [x] Alternate channel used, Phase 12 Session 4A: filed a public
  Foundation-review request at
  [github.com/SignPath/fdn-website#26](https://github.com/SignPath/fdn-website/issues/26)
  — **awaiting a response, this is not an approval.** See "Submission
  status (Phase 12 Session 4A)" above for the full detail, including a
  self-service "Free trial subscription" organization the user
  separately created on `app.signpath.io` (unrelated to Foundation
  review — do not treat it as approval, and do not use it for
  production signing until its status is resolved).
- [ ] On approval, record the real SignPath organization ID, project
  slug, signing-policy slug, and artifact-configuration slug in
  `docs/CODE_SIGNING_POLICY.md` and wire the real (not documentation-only)
  GitHub Actions signing step — see "Signing-integration readiness"
  above; this is Phase 12 Session 5's work at the earliest, gated on
  approval.
- [ ] Never commit the SignPath API token — it becomes a GitHub Actions
  **environment-protected** secret (`SIGNPATH_API_TOKEN`), per
  `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` §3.22.
