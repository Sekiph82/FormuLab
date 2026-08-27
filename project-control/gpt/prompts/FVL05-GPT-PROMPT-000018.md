# FormuLab FVL-05 — GPT Prompt 000018

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.011 corrective cycle

Governing audit:
project-control/gpt/audits/FVL05-GPT-AUDIT-000017.md

Do not start FVL-05.012 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:
1. fetch/pull current branch state safely;
2. record git status, branch, local HEAD, remote HEAD, recent commits, staged/unstaged diff;
3. read `.hiveai/PROJECT_DASHBOARD.md`, the canonical tracker, current Claude handoff, and the existing FVL-05 external log;
4. read `project-control/gpt/audits/FVL05-GPT-AUDIT-000017.md` and this prompt completely;
5. re-read `packages/shared/src/schemas/datasetManifest.ts`, `packages/shared/src/engine/datasetManifestBuilder.ts`, and the full focused test file before editing;
6. preserve every independently sound FVL-05.011 behavior unless direct source evidence proves another concrete defect.

IMPORTANT OWNERSHIP RULE:
All files under `project-control/gpt/audits/**` and `project-control/gpt/prompts/**` are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, rename, overwrite, or reconcile them.

BLOCKING DEFECT TO FIX:

`buildDatasetManifest(bundles)` currently trusts caller-supplied `FormulaVersionBundleManifest` objects without validating each one against `formulaVersionBundleManifestSchema` before duplicate detection, sorting, entry construction, and dataset hashing.

That allows a malformed/stale/forged bundle object to participate in an authoritative dataset digest if it merely carries readable `formulaVersionId` and `bundle` fields.

REQUIRED CORRECTION:

- Validate every supplied bundle with the canonical `formulaVersionBundleManifestSchema` before any authoritative use.
- Use `safeParse` and wrap validation failures in `DatasetManifestBuilderError` rather than leaking a raw `ZodError`.
- Prefer existing `invalid_row` unless direct architecture evidence proves a better structured error code is required.
- Use the parsed/rebuilt bundle objects for duplicate detection, ordinal sorting, entry construction, and hashing.
- Never silently repair malformed bundle data.
- Preserve exact duplicate-formulaVersionId fail-closed behavior over validated bundles.
- Preserve current SHA-256, canonicalization, bundle ordering, row ordering, MANIFEST_SCHEMA_VERSION, DATASET_SCHEMA_VERSION, and FEATURE_SCHEMA_VERSION semantics unless direct re-audit finds another concrete defect.
- Do not re-run FVL-05.003-.010 extractors and do not introduce raw source-pool resolution.
- Do not implement FVL-05.012 partitioning.

MANDATORY TESTS:

Add adversarial coverage proving at minimum:
1. stale/wrong `manifestSchemaVersion` bundle fails closed;
2. malformed/non-64-hex bundle digest fails closed;
3. wrong digest `algorithm` fails closed;
4. wrong `canonicalization` identifier fails closed;
5. malformed row-fingerprint metadata inside a bundle fails closed even though dataset-level output only embeds the bundle digest;
6. no invalid bundle receives an authoritative dataset digest;
7. errors are wrapped as `DatasetManifestBuilderError` with truthful code/context;
8. valid bundles still preserve permutation-invariant dataset membership ordering;
9. duplicate `formulaVersionId` still fails closed after validation;
10. valid JSON-round-tripped bundle manifests reproduce the exact same dataset digest;
11. no input mutation on success or failure;
12. returned manifest shares no caller-owned mutable aliasing.

Then independently re-audit the complete FVL-05.011 implementation from source. Do not stop at making tests green.

FINAL VALIDATION FROM FINAL STATE:
- focused `datasetManifestBuilder.test.ts`;
- relevant manifest schema tests if present;
- relevant dataset/feature/target version tests;
- full `@formulab/shared` suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- `python scripts/validate_v1_tracker.py`;
- `git diff --check`.

DOCUMENTATION / CONTROL PLANE:
- update only FVL-05.011 corrective truth and unavoidable rollup text if needed;
- update `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`;
- append to the EXISTING `project-control/claude/logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`;
- do not create a duplicate FVL-05 log;
- do not modify GPT-owned audit/prompt files;
- keep `.hiveai/PROJECT_DASHBOARD.md` pointer-only and unchanged unless a declared source path genuinely changes.

COMMIT / PUSH / NATIVE GATE:
- commit and push only task-owned changes;
- no amend, force push, or history rewrite;
- verify final local HEAD equals `origin/feature/laboratory-stability`;
- from final pushed HEAD satisfy the existing Tauri release-build / Desktop\FormuLab.lnk / launch-smoke gate;
- do not claim manual UI acceptance unless the user actually performs it.

Only when implementation, re-audit, tests, docs, push, and native gate are complete may you state:

`FVL-05.011 CORRECTIVE IMPLEMENTATION COMPLETE — PENDING GPT AUDIT`

Then state:

`NEXT TASK — FVL-05.012 NOT STARTED`

Do not self-accept FVL-05.011.
```
