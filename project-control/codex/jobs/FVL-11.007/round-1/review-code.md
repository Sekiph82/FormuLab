VERDICT: PASS
REVIEWER: Codex (code lens; same execution context)

- The real deterministic path is guarded by a test that replaces `llm.call` with an exception and exercises generation, manufacturing, and validation-plan creation.
- Structural tests check both absent LLM module wiring and absent provider/API-key parameters.
- Native packaging closure explicitly excludes the unreachable legacy LLM module.
- No product code changes were required.
