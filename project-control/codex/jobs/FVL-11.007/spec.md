# FVL-11.007 acceptance specification

## Goal

Re-confirm that new formulation generation stays deterministic and local with zero model-provider or API-key usage.

## Acceptance criteria

- The runtime generation entry point has no provider/model/API-key/LLM-call inputs or invocation path.
- The deterministic engine produces the expected generation provenance and repeatable output for the same fixture.
- Literature/cache and native-packaging boundaries do not introduce a model call or package an inactive LLM runtime.
- Targeted Python regression modules pass without external network or credentials; no owner session data is used.
- `pnpm codex:tasks:check` and `git diff --check` pass. Full-project regression remains reserved for FVL-11.009.

## Scope boundaries

Do not reintroduce model-provider configuration or credential use. Preserve the existing deterministic pipeline and truthful provenance.
