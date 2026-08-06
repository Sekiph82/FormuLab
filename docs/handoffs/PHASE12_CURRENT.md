# Phase 12 — Commercial Distribution

## Status: SESSION 1 (Free Open-Source Code-Signing Foundation) COMPLETE. Certificate route decided (SignPath Foundation free OSS program). Repository preparation complete. One real eligibility blocker found — no release has ever been published — requiring a bounded remediation session before the SignPath application itself. No implementation started.

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
`bundle.resources` and a source grep that this content (and `ai4s-skills`,
which genuinely is MIT) is fetched by CI but **never actually bundled
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

## Inspection commands run this session

See the architecture doc's own §1 (Session 0) and §9 (Session 1) for the
exact `grep`/`find`/`curl`/`gh api`/`WebFetch` evidence backing each
finding — recorded once per finding rather than duplicated here.

## Exact next session

**Phase 12 Session 2: First Public Release Publication.** Bounded
remediation for the eligibility blocker found this session — publish
FormuLab's first real (still unsigned, still disclosed as unsigned)
GitHub Release via the existing, never-yet-run `build.yml` pipeline.
Only then does Session 3 (SignPath Application and Approval Gate) become
meaningful.
