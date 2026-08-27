# FormuLab Control Hub — Historical Coordination-File Migration Log

Governed by:
- `project-control/gpt/audits/CONTROL-HUB-GPT-AUDIT-000003.md` (corrected
  architecture, verdict `ARCHITECTURE CORRECTED / MIGRATION MAY CONTINUE
  UNDER PROMPT 000003`).
- `project-control/gpt/prompts/CONTROL-HUB-GPT-PROMPT-000003.md` (the
  authorized execution prompt for this migration).

`CONTROL-HUB-GPT-PROMPT-000001.md` and `CONTROL-HUB-GPT-PROMPT-000002.md`
are superseded and were not executed. Both GPT-owned governing files were
read completely and neither was edited.

## Branch / starting state

- Branch: `feature/laboratory-stability`.
- `git fetch --all --prune` + `git pull --ff-only` performed first;
  fast-forwarded `f59c553` → `2cfa318` (the Control Hub scaffolding commits
  — `.hiveai/PROJECT_DASHBOARD.md`, `project-control/PROTOCOL.md`,
  `project-control/README.md`, `project-control/dashboard/
  HIVEAI-INTEGRATION.md`, the three `CONTROL-HUB-GPT-*` audit/prompt pairs,
  `project-control/state/project-state.json`,
  `project-control/state/session-index.json`).
- Pre-existing unrelated dirty worktree state (generated User Guide
  docx/pdf, 12 deleted `formulas/*.md` + `formulas/index.json`) left
  untouched throughout, per this session's own standing instruction.

## Files moved (`git mv`, content byte-for-byte unchanged)

| Legacy directory | Destination | Files moved |
|---|---|---|
| `docs/audits/**` | `project-control/gpt/audits/**` | 12 |
| `docs/prompts/**` | `project-control/gpt/prompts/**` | 12 |
| `docs/external-logs/**` (tracked) | `project-control/claude/logs/**` | 12 |
| `docs/handoffs/**` | `project-control/claude/handoffs/**` | 9 |

45 tracked files moved via `git mv` (git recorded all 45 as renames, `R`,
confirmed by `git status --short`).

### Exception: 9 untracked files in `docs/external-logs/`

At session start, `docs/external-logs/` also contained 9 files that were
**untracked** (`??` in `git status`, pre-dating this session —
`FormuLab-Build-Shortcut-Log.md`, `FormuLab-Connector-Management-Frontend-
Log.md`, `FormuLab-FVL03-Integration-Log.md`, `FormuLab-FVL04-DataExchange-
Integration-Log.md`, `FormuLab-New-Request-Runtime-Regression-Log.md`,
`FormuLab-Phase11-Backup-Restore-Data-Safety-Log.md`, `FormuLab-Phase12-
Commercial-Distribution-Log.md`, `FormuLab-Phase13-Identity-Security-
Log.md`, `FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md`).
`git mv` cannot move an untracked path (`fatal: not under version
control`). Since the migration mapping (`docs/external-logs/**` →
`project-control/claude/logs/**`) applies to the directory's full physical
contents, not only its previously-tracked subset, and orphaning these 9
files in an otherwise-retired directory would be worse than relocating
them, they were moved with plain `mv` and newly `git add`ed at their
destination — content unchanged, no substantive edit, disclosed here
explicitly rather than silently absorbed into the 45-file rename count.
None of these 9 filenames collide with any of the 12 tracked
`external-logs` filenames or with each other.

**Total: 54 files relocated. Before: 45 files across the four legacy
directories (0 remaining after migration). After: 45 (`project-control/
gpt/audits` 12 + `gpt/prompts` 12 + `claude/logs` 12 + `claude/handoffs`
9) + 9 newly-tracked = 54 files now under `project-control/`.**

All four legacy directories (`docs/audits/`, `docs/prompts/`,
`docs/external-logs/`, `docs/handoffs/`) are now empty and have been
removed (`rmdir`) since git does not track empty directories.

## Collisions

None. Every destination path was verified empty before each move (the
`CONTROL-HUB-GPT-AUDIT-000001/002/003.md` / `CONTROL-HUB-GPT-PROMPT-
000001/002/003.md` files already present in `project-control/gpt/**` use
the `CONTROL-HUB-*` filename prefix, never `FVL05-*`, so no collision was
possible with the FVL-05 files being moved in).

## No GPT-owned file substantively edited

`project-control/gpt/audits/**` and `project-control/gpt/prompts/**`
(all 12+12 moved files, plus the 3 pre-existing `CONTROL-HUB-GPT-*`
files) were moved or read only — never edited, appended, reconstructed,
reconciled, or overwritten. Verified: `git diff --stat` for every path
under `project-control/gpt/` shows rename-only entries (no content diff)
for the 24 moved files, and zero diff at all for the 3 pre-existing
`CONTROL-HUB-GPT-*` files.

## Active references audited and updated

A repository-wide search (excluding `node_modules/`, `**/target/`, and
the four legacy directories themselves) for literal occurrences of
`docs/audits/`, `docs/prompts/`, `docs/external-logs/`, `docs/handoffs/`
found 23 files outside the migrated trees with a live reference. Each was
classified individually — not a blind global replacement — before
editing:

- **Historical literal evidence (left untouched):** every occurrence
  *inside* the 45 moved files themselves (a GPT audit citing an earlier
  GPT audit's old path, a Claude log or handoff citing its own or a
  sibling file's old path at the time it was written). These are frozen
  narrative of what was true when written; GPT-owned instances are also
  substantively read-only regardless. Not counted or touched here.
- **Active navigation/configuration references (updated, prefix-only,
  content otherwise unchanged):** 22 files where the four literal path
  prefixes were mechanically substituted for their new
  `project-control/**` equivalents (`docs/audits/` →
  `project-control/gpt/audits/`, `docs/prompts/` →
  `project-control/gpt/prompts/`, `docs/external-logs/` →
  `project-control/claude/logs/`, `docs/handoffs/` →
  `project-control/claude/handoffs/`), 84 total occurrences:
  `.hiveai/PROJECT_DASHBOARD.md` (4), `AGENTS.md` (1), `PROGRESS.md` (1),
  `apps/desktop/src-tauri/src/data_root.rs` (1, comment only),
  `apps/desktop/src/lib/docsFixture/build.ts` (1, comment only),
  `apps/desktop/src/lib/docsFixture/screenshotManifest.ts` (1, comment
  only), `apps/desktop/src/lib/help/types.ts` (2, comment only),
  `apps/desktop/src/lib/userGuideExport/guideContent.ts` (1, comment
  only), `docs/FORMULAB_FILE_CONSOLIDATION_REPORT.md` (5),
  `docs/FORMULAB_V1_FINAL_SCOPE.md` (3),
  `docs/FVL04_EXTERNAL_SOURCE_CONNECTOR_ARCHITECTURE.md` (1),
  `docs/PHASE10_COVERAGE_MATRIX.md` (1),
  `docs/PHASE11_DATA_INVENTORY.md` (3), `docs/PHASE11_TEST_MATRIX.md` (2),
  `docs/PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md` (3),
  `docs/PHASE12_TEST_MATRIX.md` (5),
  `docs/PHASE14_FRONTEND_UI_SPECIFICATION.md` (1),
  `docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` (2),
  `docs/SIGNPATH_APPLICATION.md` (3),
  `docs/architecture/IMPLEMENTATION_STATUS.md` (22),
  `packages/shared/src/schemas/dataset.ts` (1, doc-comment only),
  `packages/shared/src/schemas/laboratoryStandards.ts` (1, doc-comment
  only), `docs/FORMULAB_V1_TASK_TRACKER.md` (19).
- **Relative markdown links (found separately, not matched by the literal
  `docs/…/` prefix scan, fixed individually):**
  `docs/FORMULAB_V1_TASK_TRACKER.md`'s own current-execution-pointer link
  target `(handoffs/FORMULAB_V1_CURRENT.md)` → `(../project-control/
  claude/handoffs/FORMULAB_V1_CURRENT.md)`; `docs/PHASE11_TEST_MATRIX.md`'s
  link target `(handoffs/PHASE11_CURRENT.md#…)` → `(../project-control/
  claude/handoffs/PHASE11_CURRENT.md#…)`.
- **`.hiveai/PROJECT_DASHBOARD.md` line 25** originally already listed
  BOTH the old and new `project-control/` paths side by side (anticipating
  this migration) — the mechanical substitution produced a literal
  duplicate (`project-control/gpt/audits/`, `project-control/claude/
  logs/` appearing twice); deduplicated by hand immediately after the
  scripted pass, verified via a repository-wide `project-control/[a-z/]*
  project-control` re-scan (zero matches — no other nested/duplicated
  path artifact anywhere).
- **`.hiveai/PROJECT_DASHBOARD.md` "Authority notes" migration paragraph**
  needed a genuine rewrite, not a mechanical substitution — it described
  the migration as still-pending ("may be moved... until that migration
  is completed"). Rewritten to state the migration is COMPLETE
  (2026-08-27), the four legacy paths no longer exist, and the manifest
  has been intentionally updated — per the governing prompt's own
  instruction ("if the handoff is moved, update the manifest
  intentionally"). No generated state, session id, commit hash, task
  count, or live status was added — the manifest remains pointer-only.
- A full repository-wide re-scan after all edits (excluding
  `node_modules/`, `**/target/`, and the four now-migrated destination
  trees) confirms **zero** remaining occurrences of any of the four
  legacy trailing-slash path prefixes anywhere in the repository, except
  inside `project-control/README.md`/`project-control/PROTOCOL.md`, which
  correctly and accurately describe the migration MAPPING RULE itself
  (`docs/audits/** → project-control/gpt/audits/**`, etc.) — still true
  and not a broken link, left as-is.

`docs/FORMULAB_V1_TASK_TRACKER.md` itself was **not moved or replaced** —
it remains the canonical task ledger at its original path, per the
governing prompt's explicit canonical-source-protection instruction. Its
19 internal path-prefix corrections plus 1 relative-link fix are pure
link-integrity fixes required by the migration itself — no task status,
completion narrative, dependency, or historical fact in the tracker was
altered.

## `.hiveai/PROJECT_DASHBOARD.md` handoff/history pointer

Updated (active branch only, per the governing prompt): `Handoff source`
now reads `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`;
`Progress/history sources` now reads `PROGRESS.md`, `project-control/gpt/
audits/`, `project-control/claude/logs/` (the stale `docs/audits/`/
`docs/external-logs/` entries removed, not merely duplicated). Canonical
task source (`docs/FORMULAB_V1_TASK_TRACKER.md`) and roadmap source
(`docs/FORMULAB_V1_FINAL_SCOPE.md`) are unchanged — neither moved.
`dashboardMode: source-map` and pointer-only structure preserved; no
generated status/session/commit/task-count content was added.

**`main` branch was NOT touched in this session**, per the governing
prompt's explicit instruction. `main`'s own `.hiveai/PROJECT_DASHBOARD.md`
(restored there by the prior GPT correction, per `CONTROL-HUB-GPT-
AUDIT-000003.md`) still points at the pre-migration `docs/handoffs/`/
`docs/audits/`/`docs/external-logs/` paths and will need the identical
handoff/history pointer update this log just made on
`feature/laboratory-stability`, once GPT audits this migration and
authorizes carrying it to `main`.

## Session/state metadata

`project-control/state/project-state.json`: `migrationPending` flipped
`true` → `false`, `migrationCompletedAt: "2026-08-27"` and
`migrationLog` (pointing at this file) added. `currentCoordination`/
`gpt`/`claude` sections (FVL-05.009 task status, `auditVerdict:
"NOT_AUDITED"`, `auditedCommit: null`) left completely unchanged — this
migration did not audit FVL-05.009 and does not claim to. `role` remains
`"gpt-claude-coordination-summary-only"`.

`project-control/state/session-index.json`: `migrationPending` flipped
`true` → `false`, `migrationCompletedAt` added. `sessions: []` was
**deliberately left empty** — the file's own note asked for historical
per-cycle session-manifest backfill, but reconstructing 12 historical
GPT↔Claude cycles' session identity/timestamps/verdicts retroactively
from prose logs risks inventing values no source directly confirms,
which the governing prompt's own "unknown values stay null/unknown
rather than invented" rule forbids. This is disclosed as a deliberate,
evidence-driven scope decision, not an oversight — the note field was
rewritten to record exactly this reasoning. `latestKnownImplementation`
(FVL-05.009, commit `31537998893ec9cddab3b6db3111d604568b2532`,
`IMPLEMENTED_PENDING_AUDIT`) left unchanged — still accurate.

`project-control/sessions/*.json` — none created, for the same reason.

## Current task truth (unchanged by this migration)

- FVL-05.009 implementation commit:
  `31537998893ec9cddab3b6db3111d604568b2532`.
- Claude reports implementation complete (unchanged claim from the
  FVL-05.009 cycle itself).
- GPT has NOT independently accepted FVL-05.009 — this migration session
  did not audit it, per the governing prompt's explicit forbidden-scope
  list.
- **FVL-05.010 was NOT started.** No FVL task implementation scope was
  touched by this migration session.

## Validation

- `python scripts/validate_v1_tracker.py`: **OK, 171 unique tasks across
  11 work packages, no drift found** (run after the tracker's internal
  path-reference corrections).
- JSON parse validation: `project-control/state/project-state.json` and
  `project-control/state/session-index.json` both parse successfully
  (`python -m json.load`, no error).
- Repository-wide search for stale active legacy paths: zero remaining
  (see "Active references audited and updated" above for the full
  before/after accounting).
- `git diff --check`: clean (pre-existing CRLF warnings only, same as
  every prior session in this repository).
- `pnpm --filter @formulab/shared exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit`: clean.
- Full shared/desktop test suites and desktop lint were **not** re-run:
  the only `.ts`/`.rs` files touched (`dataset.ts`,
  `laboratoryStandards.ts`, `data_root.rs`, `build.ts`,
  `screenshotManifest.ts`, `types.ts`, `guideContent.ts`) had a
  doc-comment-only path-string change each — no executable logic, type,
  or behavior changed — matching the governing prompt's own instruction
  to run tests "only if executable/test-facing source was changed; do
  not create unrelated source edits merely to run a larger gate." Both
  packages' clean typechecks are the correct, proportionate signal for a
  comment-only edit; a full test run would not exercise anything this
  change could have broken.

## Commit and push

Task-owned changes only (54 file moves/relocations + the active-reference
corrections + the two state-metadata files + this log). Pre-existing
unrelated dirty worktree state (generated docs, deleted `formulas/*`)
left untouched. No amend, no force push, no history rewrite.

Commit SHA and local/remote HEAD parity: recorded in a follow-up append
to this same log, after the commit is made and pushed — the same
two-step pattern (implementation commit, then a small evidence-recording
commit) every prior FVL-05 cycle in this repository already used, since
this file cannot truthfully cite its own future commit hash before that
commit exists.

### Commit

- `cc585ac` — this migration's single implementation commit (80 files:
  45 renames, 9 newly-tracked relocations, 22 active-reference edits,
  2 state JSON edits, this log; no amend, no force push, no history
  rewrite).

Final HEAD: `cc585ac7da491717b271b54cfd8ac9dd1867aaf6`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`cc585ac7da491717b271b54cfd8ac9dd1867aaf6`.

`CONTROL HUB MIGRATION IMPLEMENTED — PENDING GPT AUDIT`
