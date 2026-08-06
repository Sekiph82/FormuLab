# Code Signing Policy

Status: **prepared, not yet active.** FormuLab does not sign releases yet.
This document describes the policy that will govern signing once
SignPath Foundation approves FormuLab's application (see
[`SIGNPATH_APPLICATION.md`](SIGNPATH_APPLICATION.md)) and supplies real
organization/project/policy/connector identifiers. Until then, every
release remains unsigned and is disclosed as such in its own release
notes, exactly as it is today.

## Why SignPath, not a purchased certificate

FormuLab has no code-signing budget. [SignPath Foundation](https://signpath.org)
provides free, HSM-backed Authenticode code signing to qualifying
open-source projects — the private signing key never leaves SignPath's own
hardware security module; FormuLab's build pipeline only ever submits a
signing *request*, never handles key material. See
`docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` for the full
assessment of why this route was chosen over a paid OV/EV certificate.

## Attribution (required by SignPath's OSS conditions)

> Free code signing provided by SignPath.io, certificate by SignPath
> Foundation.

This exact attribution appears on FormuLab's release page once signing is
active, and in this document.

## Signing roles and responsibilities

SignPath's own role model (Authors / Reviewers / Approvers) governs who
can do what in the signing pipeline. Recorded honestly against this
project's real, current structure — not padded with names that don't
exist:

| Role | SignPath definition | FormuLab today |
|---|---|---|
| **Author** | Trusted to modify source code without additional review | Sekiph82 (sole maintainer — 235/235 commits, confirmed via `git shortlog`) |
| **Reviewer** | Reviews each change proposed by a non-committer before it merges | Not yet applicable — FormuLab has had no external contributors to date. If/when external PRs are accepted, this role activates for real. |
| **Approver** | Approves each individual signing request before SignPath executes it | Sekiph82, until a second maintainer exists |

**Disclosed limitation, not hidden**: FormuLab is currently a
single-maintainer project. SignPath's role model permits the same person
to hold multiple roles for a small project — this is normal for early-stage
OSS, not a workaround — but it is recorded here exactly as it is, so
anyone reviewing this policy (including SignPath's own application
reviewer) sees the real structure rather than an inflated one. Adding
independent reviewers/approvers as the project grows a second maintainer
is a real, tracked future improvement, not assumed to already exist.

## Release approval policy

1. A release is only ever built from a tag matching `v*`, pushed
   deliberately by a maintainer (not automatically triggered by every
   commit).
2. `tauri-action` (`.github/workflows/build.yml`) builds every platform's
   installers and creates a **draft** GitHub Release — nothing is public
   yet at this point.
3. (Once signing is active) each Windows artifact is submitted to
   SignPath as a signing request, approved by an Approver (§ above)
   before SignPath executes it.
4. A maintainer reviews the draft release (changelog prepended, artifacts
   present, signatures valid — see verification instructions below)
   before manually publishing it. This human-in-the-loop publish step
   already exists today (`releaseDraft: true`) and does not change.

## Nested signing order

For every Windows release, in this exact order:

1. **Sign the application executable** (`formulab.exe`) and any embedded
   binaries that need their own signature, immediately after the
   unsigned build completes.
2. **Package the installer** — WiX (MSI) and NSIS (setup EXE) bundle the
   now-signed `formulab.exe`.
3. **Sign the final installer** — the MSI and the NSIS setup EXE each get
   their own, separate Authenticode signature as outer packages (a
   package's signature is independent of its payload's signature; both
   are checked separately by Windows/SmartScreen).
4. **Verify Authenticode signatures** — a CI-side `signtool verify /pa
   /all` (or SignPath's equivalent verification step) confirms every
   signature actually applied before a release is ever drafted; a
   signing or verification failure blocks the release, it does not
   downgrade to "ship unsigned."
5. **Calculate and publish SHA256 hashes** for every artifact, alongside
   the release, so a user (or an automated updater) can verify integrity
   independently of the Authenticode signature itself.

## Artifact scope

Exactly three Windows artifacts are in scope for signing:

- `formulab.exe` — the application executable itself.
- The NSIS installer (`FormuLab_<version>_x64-setup.exe`).
- The MSI installer (`FormuLab_<version>_x64_en-US.msi`).

(macOS and Linux signing/notarization are explicitly out of scope for this
policy — SignPath Foundation's free program covers Windows Authenticode
signing; macOS notarization is a separate Apple-specific process not
addressed here.)

## Deterministic artifact naming

Unchanged from today's Tauri-default naming
(`<ProductName>_<version>_<arch>[_locale].<ext>` /
`<productname>.exe`) — stable and predictable so a signed-update manifest
can reference exact filenames, and so a user comparing a locally-downloaded
file against a published SHA256 knows exactly which file to hash.

## Verifying a signed release yourself

Once signing is active, verify any downloaded FormuLab installer before
running it:

```powershell
# Authenticode signature — should report "Valid" and name SignPath
# Foundation as the signer.
Get-AuthenticodeSignature .\FormuLab_<version>_x64-setup.exe | Format-List

# SHA256 — compare against the hash published on the release page.
Get-FileHash .\FormuLab_<version>_x64-setup.exe -Algorithm SHA256
```

A result of `NotSigned` or `HashMismatch`, or a SHA256 that doesn't match
the one published on the GitHub Release page, means: do not run it —
open an issue or use the process in `../SECURITY.md`.

## Release provenance expectations

- Every published release's notes name the exact CI run (workflow run
  URL) and commit SHA that produced it — ties a published binary back to
  an inspectable build, not just a version number.
- The SHA256 hashes above are published in the release notes/assets
  themselves, not in a separate, easily-missed location.
- (Once a signed update manifest exists, per the architecture doc) that
  manifest's own signature becomes the primary machine-checkable
  provenance record — see `PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`
  §3.5, §3.23.

## Status of GitHub Actions integration

**Not active.** No workflow file in this repository currently submits a
signing request to SignPath, and none will until SignPath supplies real
`organization-id`/`project-slug`/`signing-policy-slug`/
`artifact-configuration-slug` values after approving FormuLab's
application. A documentation-only, annotated example of what that
integration step will look like — using SignPath's own published
`signpath/github-action-submit-signing-request` action — is recorded in
`docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`'s Session 1
section for Session 2 to implement for real, with genuine identifiers, not
before.
