# Security Policy

## Supported versions

FormuLab is pre-1.0 and ships a single rolling line — the latest tagged
release is the only one that receives fixes. There is no long-term-support
branch today.

## Reporting a vulnerability

**Preferred: GitHub's private vulnerability reporting.** Open the
repository's **Security** tab → **Report a vulnerability**. This creates a
private advisory only the maintainer can see — nothing is exposed publicly
until a fix is ready and the maintainer chooses to disclose it.

If private vulnerability reporting is not available on this repository at
the time you read this, open a regular GitHub issue with the minimum detail
needed to confirm a fix is needed, and ask for a private channel before
posting exploit details.

Do not open a public issue containing exploit details, proof-of-concept
code, or any unpatched vulnerability's technical specifics.

### What to include

- Affected version/commit.
- Platform (Windows/macOS/Linux) and, if relevant, whether it reproduces in
  a signed release build or only a local dev build.
- Steps to reproduce, or a minimal repro project.
- Impact assessment, if you have one — not required.

### Response

This is a single-maintainer open-source project. There is no formal SLA.
A best-effort acknowledgement and initial triage should be expected within
a reasonable time; a security fix's timeline depends on severity and
maintainer availability, disclosed honestly rather than promised on a fixed
schedule that can't be guaranteed.

## Scope

In scope: FormuLab's own source code
(`apps/desktop/`, `packages/`, `runtime/skills/core`, `runtime/harness`),
its build/release pipeline, and its Windows/macOS/Linux installers.

Out of scope: vulnerabilities in third-party dependencies not specific to
how FormuLab uses them (report those upstream — e.g. to the OpenCode
project, `astral-sh/uv`, or the relevant npm/crates.io package maintainer)
and vulnerabilities in an LLM provider's own API/service that FormuLab
merely calls with a user-supplied key.

## Code signing and release integrity

FormuLab's Windows release artifacts (once signed — see
[`docs/CODE_SIGNING_POLICY.md`](docs/CODE_SIGNING_POLICY.md)) are
Authenticode-signed via SignPath.io, with the certificate held by SignPath
Foundation on their own HSM — no private key material is ever stored in
this repository, in CI logs, or on any maintainer's machine. See the code
signing policy document for verification instructions once signed releases
exist.

## Privacy

See [`docs/PRIVACY.md`](docs/PRIVACY.md) for what FormuLab does and does
not send over the network, and what stays local by default.
