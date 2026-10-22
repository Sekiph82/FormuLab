# FVL-11.008 acceptance specification

## Goal

Re-verify backup inclusion, package integrity checks, and restore activation for master-data record collections used by optimizer, DOE, and laboratory workflows.

## Acceptance criteria

- The backup collector includes alternative rankings, predictive models, optimization runs, DOE studies/runs/analyses, laboratory trials, and test results.
- Each record file survives package verification and restore activation with the original bytes intact.
- The verifier validates archive size, SHA-256, and JSON structure for each record file.
- The tests use isolated temporary fixtures and do not touch owner data or `.FormuLab/runs.db`.
- Targeted Rust backup tests, `pnpm codex:tasks:check`, and `git diff --check` pass. Full-project regression remains reserved for FVL-11.009.

## Scope boundaries

Do not alter backup policy, owner data, or excluded paths. Keep all fixture content synthetic and clearly non-scientific.
