# CONTROL-HUB GPT AUDIT 000002

## Verdict

`CONTROL-HUB-GPT-PROMPT-000001.md` is **SUPERSEDED BEFORE EXECUTION** for architecture/routing purposes.

Reason: FormuLab already had an existing canonical H!veAI manifest at:

`main:.hiveai/PROJECT_DASHBOARD.md`

The first Control Hub design incorrectly described `project-control/` as if it were the primary H!veAI dashboard communication surface. That would create a parallel authority model.

## Corrected architecture

The single canonical H!veAI entrypoint is:

`main:.hiveai/PROJECT_DASHBOARD.md`

The `project-control/` tree remains useful, but only as the structured coordination/evidence backend referenced by that manifest.

H!veAI discovery must therefore be:

1. read `main:.hiveai/PROJECT_DASHBOARD.md`;
2. resolve `workingBranch` and declared control paths from that manifest;
3. read `project-control/state/project-state.json`, `session-index.json`, session manifests, audits, prompts, logs, and handoffs from the resolved working branch;
4. render current status in H!veAI's own Project Dashboard UI;
5. never rewrite `.hiveai/PROJECT_DASHBOARD.md` after every session as a generated status ledger.

## Existing Control Hub files corrected

The following active architecture files were updated to reflect this hierarchy:

- `main:.hiveai/PROJECT_DASHBOARD.md`
- `project-control/README.md`
- `project-control/PROTOCOL.md`
- `project-control/dashboard/HIVEAI-INTEGRATION.md`
- `project-control/state/project-state.json`

## Migration implication

The historical artifact migration is still valid:

- `docs/audits/**` -> `project-control/gpt/audits/**`
- `docs/prompts/**` -> `project-control/gpt/prompts/**`
- `docs/external-logs/**` -> `project-control/claude/logs/**`
- `docs/handoffs/**` -> `project-control/claude/handoffs/**`

But Claude must execute that migration under the corrected authority model above.

## Ownership

All GPT audit/prompt files remain GPT-owned and READ-ONLY to Claude in substance.

Do not edit `CONTROL-HUB-GPT-PROMPT-000001.md` to make history appear cleaner. Preserve it as superseded evidence.

## Current task boundary

This audit does not authorize FVL-05.010.

Current feature truth remains:

- FVL-05.009: `IMPLEMENTED_PENDING_AUDIT`
- FVL-05.010: `NOT AUTHORIZED / NOT STARTED`
