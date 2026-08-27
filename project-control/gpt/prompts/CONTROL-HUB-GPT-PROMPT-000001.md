# CONTROL-HUB GPT PROMPT 000001

Task: Migrate FormuLab's legacy GPT/Claude coordination artifacts into the new `project-control/` communication hub and backfill machine-readable session state for H!veAI Project Dashboard.

Branch: `feature/laboratory-stability`
Local repo: `C:\Users\sekip\Desktop\FormuLab`

## Mandatory first reads

Read completely before editing:

- `project-control/README.md`
- `project-control/PROTOCOL.md`
- `project-control/dashboard/HIVEAI-INTEGRATION.md`
- `project-control/gpt/audits/CONTROL-HUB-GPT-AUDIT-000001.md`
- this prompt
- current `project-control/state/project-state.json`
- current `project-control/state/session-index.json`

Also inspect all current files under:

- `docs/audits/`
- `docs/prompts/`
- `docs/external-logs/`
- `docs/handoffs/`

## Hard ownership rule

All GPT files are READ-ONLY in substance.

You MAY move them with `git mv` into their new canonical paths, but you MUST NOT edit, append, rewrite, reconcile, rename, regenerate, or overwrite their contents.

This includes every historical GPT audit/prompt and the new control-hub GPT audit/prompt files.

## Migration mapping

Move the COMPLETE contents of these legacy directories:

```text
docs/audits/**
  -> project-control/gpt/audits/**

docs/prompts/**
  -> project-control/gpt/prompts/**

docs/external-logs/**
  -> project-control/claude/logs/**

docs/handoffs/**
  -> project-control/claude/handoffs/**
```

Use `git mv` wherever possible.

Do not leave duplicate canonical copies behind. After successful migration, the four legacy directories should contain no coordination files. Remove empty directories naturally via Git.

If any destination filename collision exists, STOP the move for that colliding file and report the collision. Do not invent a rename.

## Preserve history exactly

During the move:

- preserve file contents byte-for-byte whenever possible;
- preserve filenames;
- preserve chronology;
- preserve GPT/Claude ownership;
- do not compact multiple files into one;
- do not split historical files merely to make the new structure prettier.

After the physical move, repository files OUTSIDE the historical evidence may be updated to reference the new paths.

Historical Claude logs/handoffs may have path references corrected only when required for repository navigation. Do not rewrite their substantive claims.

Historical GPT audits/prompts must not be edited even for path cleanup.

## Repository-wide path-reference audit

After moving files, search the repository for these legacy path prefixes:

- `docs/audits/`
- `docs/prompts/`
- `docs/external-logs/`
- `docs/handoffs/`

Classify every remaining match:

1. historical literal evidence that must remain untouched, or
2. active/current repository reference that must be updated to `project-control/...`.

Update category 2 only.

Do not perform blind global string replacement.

## Backfill session manifests

Create `project-control/sessions/*.json` for historical sessions when the existing artifacts provide enough evidence.

Use a deterministic session id format:

`FORMULAB-<TASK-ID>-<YYYYMMDD-HHMMSS-or-UNKNOWN>-<actor>`

If exact time is not supported, use a deterministic `UNKNOWN` token rather than inventing a time.

Each manifest should follow `project-control/PROTOCOL.md` and include only evidence-supported values.

At minimum capture when available:

- task id
- actor
- branch
- status
- GPT input audit/prompt paths
- Claude implementation commit
- Claude log/handoff paths
- concise dashboard-ready summary
- test/build evidence
- blockers/corrective finding
- next task

Never manufacture missing evidence. Use `null`, `[]`, or `"unknown"` as appropriate.

## Backfill session index

Update:

`project-control/state/session-index.json`

Requirements:

- preserve chronological order deterministically;
- include one index record per created manifest;
- reference the manifest path;
- include task id, actor, status, implementation commit when known, and audit verdict when known;
- no duplicate session ids;
- set `migrationPending=false` only when backfill/move validation is complete.

## Current project state

Update:

`project-control/state/project-state.json`

Current truth before migration:

- FVL-05.009 implementation commit: `31537998893ec9cddab3b6db3111d604568b2532`
- Claude reports FVL-05.009 implementation complete.
- GPT has NOT yet independently accepted FVL-05.009.
- Therefore current status MUST remain `IMPLEMENTED_PENDING_AUDIT`.
- FVL-05.010 is NOT authorized and MUST NOT be started.

After the move, update the state paths to their new canonical locations and set `migrationPending=false` only after all migration gates pass.

Do NOT set GPT audit verdict for FVL-05.009 yourself.

## H!veAI dashboard feed readiness

Ensure the control hub is sufficient for H!veAI to ingest without parsing the giant historical log as its primary truth source.

At migration completion verify:

- `project-control/state/project-state.json` parses as JSON;
- `project-control/state/session-index.json` parses as JSON;
- every indexed manifest exists and parses as JSON;
- referenced latest audit/prompt/log/handoff files exist;
- paths are repo-relative and canonical;
- latest state still says FVL-05.009 `IMPLEMENTED_PENDING_AUDIT`;
- FVL-05.010 `nextTaskAuthorized=false`.

## Migration report

Write the migration implementation report to:

`project-control/claude/logs/FormuLab-Control-Hub-Migration-Log.md`

The report must include:

- exact files/directories moved;
- count before/after per legacy directory;
- any collisions or exceptions;
- active references updated;
- number of session manifests backfilled;
- any historical gaps represented as unknown/null;
- JSON validation results;
- tests/typechecks/diff-check results;
- migration commit SHA;
- final local/remote HEAD parity;
- confirmation that GPT files were moved only, not substantively edited;
- confirmation that FVL-05.010 was not started.

Update the current Claude handoff under the NEW path with a concise migration status block.

## Validation

Run at least:

- repository search proving no active reference still depends on old coordination paths;
- JSON parse validation for state/index/all manifests;
- `git diff --check`;
- `python scripts/validate_v1_tracker.py` if applicable to current repo state;
- shared/desktop typechecks and relevant tests if migration/reference changes touch executable or test-facing source;

Do not make unrelated product/source-code changes merely to create work.

## Commit and push

Commit only migration/control-hub-owned changes and push to:

`feature/laboratory-stability`

No amend. No force push. No history rewrite.

## Forbidden scope

- Do NOT start FVL-05.010.
- Do NOT implement feature normalization/target-variable work.
- Do NOT audit FVL-05.009 on GPT's behalf.
- Do NOT modify substantive GPT audit/prompt content.
- Do NOT rewrite unrelated docs/source.

When finished, report `CONTROL HUB MIGRATION IMPLEMENTED — PENDING GPT AUDIT` rather than self-accepting the migration.
