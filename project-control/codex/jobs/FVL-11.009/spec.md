# FVL-11.009 acceptance specification

## Goal

Run the full milestone regression across Python, Rust, shared and desktop Vitest, TypeScript, ESLint, and repository diff checks.

## Acceptance criteria

- All Python pipeline and formulation test modules pass.
- The complete Tauri Rust test suite passes.
- Every shared and desktop Vitest test passes.
- TypeScript typecheck and ESLint pass.
- `git diff --check` and `pnpm codex:tasks:check` pass.
- Generated guide artifacts created by the test suite are restored to their tracked baseline; unrelated user changes remain untouched.

## Scope boundaries

Do not change product code or unrelated dashboard/user files in this regression-only task. Record resource-related runner adjustments and any initial failures honestly.
