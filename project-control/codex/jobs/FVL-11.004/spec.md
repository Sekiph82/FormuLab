# FVL-11.004 acceptance specification

## Goal

Prove historical saved FormuLab sessions remain readable and usable with current application code.

## Acceptance criteria

- Select representative pre-current-schema session fixtures from the repository and load them through the current read path.
- Preserve historical values and missing/unknown fields without rewriting source fixtures or inventing provenance, measurements, approvals, or defaults presented as facts.
- Verify compatibility at the user-facing session parsing/rendering boundary and at relevant data/schema boundaries; malformed or unsupported history must fail explicitly rather than silently corrupt.
- Keep fixtures local and immutable; do not access user workspaces, `.FormuLab/runs.db`, external services, or actual owner records.
- Run targeted compatibility tests, desktop typecheck, `pnpm codex:tasks:check`, and `git diff --check`. Full-project regression remains reserved for FVL-11.009.

## Scope boundaries

Do not add a destructive migration or rewrite historical session files. Make only the smallest code/test change required by evidence from the selected task.
