# CONTROL-HUB GPT AUDIT 000001

Date: 2026-08-27
Project: FormuLab
Branch: `feature/laboratory-stability`
Verdict: `MIGRATION_REQUIRED`

## Scope

Independent review of the current GPT ↔ Claude coordination artifacts and the latest FVL-05 external log before introducing a machine-readable coordination hub for H!veAI Project Dashboard.

## Current-state findings

### A. Historical evidence is fragmented across four legacy directories

Current coordination evidence is split across:

- `docs/audits/**`
- `docs/prompts/**`
- `docs/external-logs/**`
- `docs/handoffs/**`

The folders contain real historical authority, but there is no single control root for a dashboard or automation consumer.

### B. Ownership is documented socially, not structurally enough

Existing FVL-05 workflow already treats GPT audit/prompt files as read-only to Claude and Claude logs/handoffs as implementation evidence. This has worked, but the repository has no top-level machine-readable ownership contract that H!veAI can consume.

### C. There is no stable session identity/index

The external FVL-05 log records cycles sequentially and includes commit/build/test evidence, but dashboard ingestion would have to parse a large Markdown narrative to determine the current session. A structured per-session manifest and session index are needed.

### D. Claude implementation completion is not the same as GPT acceptance

The latest supplied log records FVL-05.009 as implementation/acceptance complete from Claude's perspective at commit `31537998893ec9cddab3b6db3111d604568b2532`, with FVL-05.010 not started. Under the established independent-audit workflow, that implementation must still be treated as `IMPLEMENTED_PENDING_AUDIT` until GPT audits the actual source and issues `CLOSE_ACCEPT`.

### E. H!veAI needs a small, stable ingestion contract

A dashboard should not infer current truth by scraping arbitrary tracker/log prose. It should read a current-state JSON, session index, and per-session manifests, then link to the immutable human evidence.

## Required architecture

Canonical root: `project-control/`

Required subtrees:

- GPT: `project-control/gpt/audits/**`, `project-control/gpt/prompts/**`
- Claude: `project-control/claude/logs/**`, `project-control/claude/handoffs/**`
- Session manifests: `project-control/sessions/**`
- Machine state: `project-control/state/project-state.json`, `project-control/state/session-index.json`
- Dashboard contract: `project-control/dashboard/HIVEAI-INTEGRATION.md`

## Migration requirements

1. Move every file under the four legacy coordination directories into its matching new subtree.
2. Use `git mv` where possible and preserve exact content during the move.
3. Preserve filenames unless an actual path collision exists. If a collision exists, stop and report it rather than silently rename.
4. Update repository references from old paths to new paths after the move.
5. Do not rewrite historical GPT audits/prompts to modernize wording.
6. Do not rewrite Claude historical logs/handoffs except for path references required to keep repository navigation valid.
7. Backfill session manifests/index using evidence already present in the historical files. Do not invent timestamps, commits, test counts, verdicts, or task states that are not supported.
8. Mark uncertain historical fields as `null` or `unknown`, not guessed.
9. Set `migrationPending=false` only after path migration, reference repair, state/index validation, and repository tests/checks pass.
10. Do not begin FVL-05.010 as part of the migration.

## Acceptance gates

Migration can be considered implementation-complete by Claude only when:

- all four legacy directory trees have been migrated;
- no coordination file was lost;
- old-path references have been audited/repaired;
- `project-control/state/project-state.json` is valid JSON and current;
- `project-control/state/session-index.json` is valid JSON and historical entries are backfilled as far as evidence permits;
- session manifests validate against the protocol's required fields;
- GPT-owned files remain content-immutable except their path move;
- Claude-owned historical evidence is preserved;
- `git diff --check` is clean;
- appropriate project tests/typechecks run successfully;
- final commit is pushed to `feature/laboratory-stability`;
- FVL-05.010 remains untouched.

## Verdict

`MIGRATION_REQUIRED`

Proceed only with the dedicated migration prompt. No FVL-05.010 implementation is authorized by this audit.
