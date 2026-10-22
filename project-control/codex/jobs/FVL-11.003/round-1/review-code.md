VERDICT: PASS
REVIEWER: Codex (code lens; same execution context)

- The acceptance test calls the shared human-gated DOE run constructor, measured-space acquisition evaluator/ranker, and the existing completed-TestResult retraining entry point.
- It tests model registry outcomes and checks model version 2 carries prior-model checksum and exact triggering run, trial, and measurement lineage.
- The fixture keeps the formula mass balance at 100% and uses distinct formula/study/design/run/trial identities for independent groups.
- The companion DoePanel tests cover persisted trial creation and fail-closed retry/generic Runs paths.
- The change is limited to acceptance fixtures, task evidence, and a TypeScript fixture annotation correction; no application runtime behavior changes.
