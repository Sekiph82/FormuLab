# CONTROL-HUB GPT PROMPT 000002

Task: Complete the FormuLab coordination-artifact migration under the corrected architecture where `main:.hiveai/PROJECT_DASHBOARD.md` is the single canonical H!veAI entrypoint and `project-control/` is only its structured backend.

Branch: `feature/laboratory-stability`
Local repo: `C:\Users\sekip\Desktop\FormuLab`

## Supersession

This prompt supersedes `project-control/gpt/prompts/CONTROL-HUB-GPT-PROMPT-000001.md`.

Do not execute 000001 as the governing migration prompt.
Do not edit 000001; preserve it as historical GPT-owned evidence.

## Mandatory first reads

Read completely before editing:

- `main:.hiveai/PROJECT_DASHBOARD.md`
- `project-control/gpt/audits/CONTROL-HUB-GPT-AUDIT-000002.md`
- `project-control/README.md`
- `project-control/PROTOCOL.md`
- `project-control/dashboard/HIVEAI-INTEGRATION.md`
- this prompt
- current `project-control/state/project-state.json`
- current `project-control/state/session-index.json`

Also inspect all current files under:

- `docs/audits/`
- `docs/prompts/`
- `docs/external-logs/`
- `docs/handoffs/`

## Canonical authority model

The single H!veAI dashboard/source-map authority is:

`main:.hiveai/PROJECT_DASHBOARD.md`

`project-control/` is NOT a second dashboard. It is the coordination/evidence backend referenced by that manifest.

Do not create another dashboard manifest.
Do not turn `project-control/README.md`, `HIVEAI-INTEGRATION.md`, `project-state.json`, or any session file into a competing dashboard authority.

H!veAI must be able to start from `.hiveai/PROJECT_DASHBOARD.md`, resolve `workingBranch` and declared paths, and then read the Control Hub backend.

## Hard ownership rule

All GPT files are READ-ONLY in substance.

You MAY move historical GPT files with `git mv` into their new canonical paths, but you MUST NOT edit, append, rewrite, reconcile, regenerate, or overwrite their contents.

This includes every historical GPT audit/prompt and all Control Hub GPT audits/prompts.

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

Do not leave duplicate canonical copies behind. If any destination filename collision exists, STOP that file's move and report the collision. Do not invent a rename.

## Preserve history exactly

During the move:

- preserve contents byte-for-byte whenever possible;
- preserve filenames;
- preserve chronology;
- preserve GPT/Claude ownership;
- do not compact files;
- do not split historical files merely for aesthetics.

After the physical move, active repository references outside historical evidence may be updated to point at `project-control/...`.

Historical GPT audits/prompts must not be edited even for path cleanup.

## Repository-wide reference audit

Search for active references to:

- `docs/audits/`
- `docs/prompts/`
- `docs/external-logs/`
- `docs/handoffs/`

Classify every match as:

1. historical literal evidence that remains untouched; or
2. active/current navigation/configuration reference that must be updated.

Update category 2 only. Never blind-replace history.

Also verify no active file claims `project-control/` itself is the canonical H!veAI dashboard. The correct wording is that it is the backend referenced by `main:.hiveai/PROJECT_DASHBOARD.md`.

## Backfill session manifests

Create `project-control/sessions/*.json` for historical sessions when evidence is sufficient.

Use deterministic ids:

`FORMULAB-<TASK-ID>-<YYYYMMDD-HHMMSS-or-UNKNOWN>-<actor>`

Never invent unsupported dates/times or commits. Use null/unknown when needed.

Each manifest should capture when supported:

- task id
- actor
- branch
- status
- GPT audit/prompt paths
- Claude implementation commit
- Claude log/handoff paths
- concise dashboard-ready summary
- tests/build evidence
- blockers/corrective finding
- next task

## Session index and state

Update:

- `project-control/state/session-index.json`
- `project-control/state/project-state.json`

Preserve the canonical dashboard anchor in project state:

```json
"canonicalDashboard": {
  "branch": "main",
  "path": ".hiveai/PROJECT_DASHBOARD.md",
  "role": "single-canonical-entrypoint"
}
```

Do not remove or weaken it.

Current feature truth before migration:

- FVL-05.009 implementation commit: `31537998893ec9cddab3b6db3111d604568b2532`
- Claude reports implementation complete.
- GPT has NOT independently accepted FVL-05.009 yet.
- therefore status remains `IMPLEMENTED_PENDING_AUDIT`.
- FVL-05.010 remains NOT authorized and MUST NOT be started.

Set `migrationPending=false` only after every migration/backfill validation gate passes.

## H!veAI readiness validation

Verify the complete read path works conceptually and by repository existence checks:

1. `main:.hiveai/PROJECT_DASHBOARD.md` exists and declares the working branch/control paths.
2. Every declared control path exists on the resolved working branch.
3. `project-state.json` parses as JSON.
4. `session-index.json` parses as JSON.
5. Every indexed session manifest exists and parses as JSON.
6. Referenced latest audit/prompt/log/handoff files exist.
7. H!veAI can obtain current task status without parsing the giant historical log as primary truth.
8. `.hiveai/PROJECT_DASHBOARD.md` remains pointer-only and is not modified by this migration unless an actual routing defect is discovered.

## Migration implementation report

Write Claude's migration report to:

`project-control/claude/logs/FormuLab-Control-Hub-Migration-Log.md`

Include:

- exact files/directories moved;
- before/after counts;
- collisions/exceptions;
- active references updated;
- number of session manifests backfilled;
- unknown/null historical gaps;
- JSON validation results;
- canonical `.hiveai/PROJECT_DASHBOARD.md` routing verification;
- tests/typechecks/diff-check results;
- migration commit SHA;
- final local/remote HEAD parity;
- confirmation GPT files were moved only and not substantively edited;
- confirmation FVL-05.010 was not started.

Update the current Claude handoff under the NEW path with a concise migration status block.

## Validation

Run at least:

- repo-wide legacy-path reference audit;
- canonical-dashboard/control-path existence verification;
- JSON parse validation for state/index/all session manifests;
- `git diff --check`;
- `python scripts/validate_v1_tracker.py` if applicable;
- relevant typechecks/tests only if active executable/test-facing references changed.

Do not create unrelated product-code changes.

## Commit and push

Commit only migration/control-hub-owned changes and push to:

`feature/laboratory-stability`

No amend. No force push. No history rewrite.

## Forbidden scope

- Do NOT start FVL-05.010.
- Do NOT audit FVL-05.009 on GPT's behalf.
- Do NOT modify substantive GPT audit/prompt content.
- Do NOT create a second H!veAI dashboard manifest.
- Do NOT make `project-control/` a competing dashboard authority.
- Do NOT rewrite unrelated docs/source.

When finished, report:

`CONTROL HUB MIGRATION IMPLEMENTED — PENDING GPT AUDIT`
