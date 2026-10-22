STATUS: READY

The deterministic formulation path remains zero-LLM: its regression guard patches `llm.call` to fail if invoked, runs generation through manufacturing and validation-plan creation, and verifies the call is never reached. Structural checks confirm the pipeline module has no `llm` import and `pipeline.run` has no provider/model/API-key/LLM-call parameters. Provenance reports the deterministic engine with blank provider/model. Native packaging excludes the deliberately unreachable `llm.py` module.

Validation:
- `python -m unittest test_pipeline test_engine test_formula_alternatives_status test_native_packaging_closure` — 113 tests passed.
- Tests use local temporary fixtures; no credentials or external API calls were used.
- `pnpm codex:tasks:check` and `git diff --check` — passed.

No runtime source changes were necessary.
