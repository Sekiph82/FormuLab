# CONTROL-HUB GPT PROMPT 000003

Task: Complete the FormuLab historical GPT↔Claude coordination-file migration while preserving H!veAI's existing `source-map` authority model.

Branch: `feature/laboratory-stability`
Local repo: `C:\Users\sekip\Desktop\FormuLab`

## Mandatory first reads

Read completely before editing:

- `.hiveai/PROJECT_DASHBOARD.md`
- `docs/FORMULAB_V1_TASK_TRACKER.md`
- `project-control/README.md`
- `project-control/PROTOCOL.md`
- `project-control/gpt/audits/CONTROL-HUB-GPT-AUDIT-000003.md`
- this prompt

`CONTROL-HUB-GPT-PROMPT-000001.md` and `CONTROL-HUB-GPT-PROMPT-000002.md` are SUPERSEDED. Do not execute them.

## Non-negotiable authority model

- `.hiveai/PROJECT_DASHBOARD.md` is H!veAI's pointer-only project manifest.
- `docs/FORMULAB_V1_TASK_TRACKER.md` is the canonical FormuLab task ledger.
- `project-control/**` is communication/evidence/history only.
- `project-control/state/**` and `project-control/sessions/**` MUST NOT be promoted into canonical H!veAI task authority.
- H!veAI must not be required to merge competing task truth between tracker and project-control metadata.

## GPT ownership

All GPT audit/prompt files are READ-ONLY in substance.

You may move historical GPT files with `git mv` when explicitly required below, but you MUST NOT edit, append, rewrite, reconcile, regenerate, or overwrite their substantive contents.

## Historical migration mapping

Move the complete historical coordination contents using `git mv` whenever possible:

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

Preserve filenames and substantive content. Do not compact, merge, split, or prettify historical evidence.

If a destination collision exists, stop for that file and report it. Do not invent a rename.

## Canonical source protection

Do NOT move or replace:

`docs/FORMULAB_V1_TASK_TRACKER.md`

It remains the canonical task ledger.

If `docs/handoffs/FORMULAB_V1_CURRENT.md` is moved successfully to:

`project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`

then update the ACTIVE-BRANCH `.hiveai/PROJECT_DASHBOARD.md` handoff source from the old path to the new path. Do not add generated state, session ids, commit hashes, task counts, or live status to the manifest. It must remain pointer-only.

Do not modify the main branch in this migration session. Report that the main-branch manifest requires the same handoff-pointer update after GPT audits the migration.

## H!veAI progress/history sources

After successful migration, the active-branch manifest may remove legacy history paths that no longer exist and point history/evidence to:

- `PROGRESS.md`
- `project-control/gpt/audits/`
- `project-control/claude/logs/`

Prompts remain communication input evidence and do not become task authority.

## Session/state metadata

You may backfill `project-control/sessions/*.json`, `project-control/state/session-index.json`, and `project-control/state/project-state.json` for GPT↔Claude coordination convenience only.

Requirements:

- never claim these files are H!veAI task authority;
- never use them to contradict the canonical tracker;
- preserve evidence-supported values only;
- unknown values stay null/unknown rather than invented;
- `project-state.json` must retain an explicit role equivalent to `gpt-claude-coordination-summary-only`.

## Current task truth

Before this migration:

- FVL-05.009 implementation commit is `31537998893ec9cddab3b6db3111d604568b2532`.
- Claude reports implementation complete.
- GPT has not independently accepted FVL-05.009 yet.
- FVL-05.010 remains NOT AUTHORIZED.

Do not change FVL task implementation scope during this migration.

## Repository-wide path audit

After moving files, search for active references to:

- `docs/audits/`
- `docs/prompts/`
- `docs/external-logs/`
- `docs/handoffs/`

Classify each remaining occurrence as:

1. immutable historical literal evidence, leave untouched; or
2. active/current navigation/configuration reference, update to the new canonical path.

No blind global replacement.

## Migration report

Write/update:

`project-control/claude/logs/FormuLab-Control-Hub-Migration-Log.md`

Include:

- exact files moved;
- before/after counts per legacy directory;
- collisions/exceptions;
- active references updated;
- whether active `.hiveai/PROJECT_DASHBOARD.md` handoff/history pointers changed;
- number of session manifests backfilled if any;
- JSON validation results if session/state files were touched;
- tracker validation;
- git diff check;
- commit SHA and local/remote parity;
- confirmation GPT files were moved only, not substantively edited;
- confirmation `docs/FORMULAB_V1_TASK_TRACKER.md` remained canonical and unchanged except only if a migration-status note is truly necessary;
- confirmation FVL-05.010 was not started.

## Validation

Run at least:

- `python scripts/validate_v1_tracker.py`
- JSON parse validation for any touched `project-control/state/*.json` or `sessions/*.json`
- repository search for stale active legacy paths
- `git diff --check`
- relevant typecheck/tests only if executable/test-facing source was changed; do not create unrelated source edits merely to run a larger gate

## Commit and push

Commit only migration/control-hub-owned changes and push to `feature/laboratory-stability`.

No amend. No force push. No history rewrite.

## Forbidden scope

- Do NOT start FVL-05.010.
- Do NOT audit FVL-05.009 on GPT's behalf.
- Do NOT modify substantive GPT audit/prompt content.
- Do NOT turn `.hiveai/PROJECT_DASHBOARD.md` into a generated status file.
- Do NOT promote `project-control/state/**` into canonical task authority.

When finished report:

`CONTROL HUB MIGRATION IMPLEMENTED — PENDING GPT AUDIT`
