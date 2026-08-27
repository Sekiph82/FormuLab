# FormuLab FVL-05 — GPT Prompt 000017

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.011 — Dataset hash/fingerprint + reproducible rebuild from source records

FVL-05.010 is independently GPT-audit CLOSED by:
project-control/gpt/audits/FVL05-GPT-AUDIT-000016.md

Do not reopen FVL-05.010 unless direct current-source evidence reveals a concrete regression or contract defect.
Do not start FVL-05.012 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:
1. fetch/pull current branch state safely;
2. record git status, branch, local HEAD, remote HEAD, recent commits, staged/unstaged diff;
3. read `.hiveai/PROJECT_DASHBOARD.md`, the current canonical tracker, current handoff, and the existing FVL-05 external log under `project-control/claude/logs/`;
4. read `project-control/gpt/audits/FVL05-GPT-AUDIT-000016.md` and this prompt completely;
5. read prior FVL-05.001-.010 audits/prompts where they define schema versioning, exact lineage, deterministic ordering, measured-vs-planned evidence, frozen snapshots, normalization, target definitions, non-mutation, and fail-closed identity rules;
6. inspect current repository source for any existing hashing/canonical serialization/reproducibility utilities before designing anything new.

IMPORTANT OWNERSHIP RULE:
All files under `project-control/gpt/audits/**` and `project-control/gpt/prompts/**` are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, rename, or overwrite them.
Record Claude implementation evidence only in the canonical tracker, current Claude handoff, and the existing FVL-05 Claude external log.

SOURCE RECOVERY IS THE MAIN WORK OF THIS TASK.

Do not infer FVL-05.011's exact contract merely from its concise tracker title:

`Dataset hash/fingerprint + reproducible rebuild from source records`

Recover the exact implementable meaning from current source and downstream expectations.

At minimum inspect and cross-reference:
- `docs/FORMULAB_V1_TASK_TRACKER.md` exact FVL-05.011 row/dependencies;
- `docs/FORMULAB_V1_FINAL_SCOPE.md` FVL-05/FVL-06/FVL-07 boundaries;
- `packages/shared/src/schemas/dataset.ts` all FVL-05.002-.010 row/feature/target schemas;
- every FVL-05.003-.010 extractor and focused tests;
- existing hashing/checksum/fingerprint/canonical-json/stable-serialization helpers anywhere in shared/desktop/Rust/Python;
- source-record lineage encoding and ordering rules;
- package public exports;
- any current dataset-build, cache, provenance, import/export, backup, audit, or deterministic serialization code that may establish precedent;
- tracker/handoff/external-log current truth.

MANDATORY SOURCE QUESTIONS — answer explicitly in the external log BEFORE coding:

1. What exact object is being fingerprinted: one row, one formula-version bundle, a full dataset build, or more than one level? Recover this from current schemas/downstream tasks; do not guess.
2. Which source records must be included in the reproducibility contract? Does the fingerprint cover only emitted row payloads, exact `sourceRecords` lineage, or both source identity and extracted values?
3. What is the canonical serialization boundary? Define how object-key order, array order, undefined/absent fields, numeric strings, booleans, Unicode, line endings, and optional fields are handled so logically identical builds hash identically and semantically different builds do not collide.
4. Is there an existing canonical serializer/hash algorithm in the repo? Reuse it if authoritative. If none exists, choose the smallest deterministic standard-library-compatible approach and document the exact algorithm/version. Do not use locale-dependent serialization.
5. Which cryptographic hash is appropriate and already available in the current stack? Prefer a standard strong digest such as SHA-256 if source/runtime support proves it practical. Do not invent a custom hash.
6. What exactly does “reproducible rebuild from source records” mean operationally? Must the API accept exact FVL-05.003-.010 rows and rebuild a canonical bundle, or must it accept raw source pools and invoke prior extractors? Follow current architecture and avoid duplicating prior extraction logic.
7. How is rebuild input identity validated? Fail closed on missing/duplicate/ambiguous formulaVersion rows, schema-version mismatch, contradictory formula identity, or lineage mismatch where relevant.
8. Must a rebuild prove that the same canonical inputs reproduce the same exact bytes/fingerprint under caller array reordering? Identify which arrays are semantically ordered vs. set-like. Never sort arrays that prior extractors intentionally preserve as domain order.
9. Should dataset and feature schema versions be part of the fingerprint payload? Recover from the purpose of reproducibility/version isolation and document the decision.
10. Should software/algorithm version metadata be included separately from source-data fingerprint? Do not silently mix code-build identity with data identity unless source architecture proves that is the intended contract.
11. How are source lineage records represented in the canonical fingerprint? Preserve exact opaque ids/casing and `parentRecordId`; no fuzzy normalization.
12. What happens if a source row contains malformed canonical timestamps or invalid schema literals? Reuse prior schema validation and fail closed; never hash an invalid pseudo-row as if authoritative.
13. Is fingerprinting per row enough to support FVL-05.012 partition leakage prevention and FVL-05.014 rebuild determinism tests, or is a dataset-level manifest/fingerprint also required now? Implement only what FVL-05.011 needs, but make the contract usable by those downstream tasks.
14. Does FVL-05.011 change any existing dataset/feature row shape? If it adds a new manifest/fingerprint schema, apply standing version rules deliberately rather than mechanically.
15. How will rebuild remain pure, deterministic, non-mutating, and free of generated timestamps/random ids?

CORE INVARIANTS:

- A fingerprint must be a deterministic function of exact canonical input evidence, never current wall-clock time, random ids, machine paths, process ids, locale, filesystem ordering, or JSON object insertion accidents.
- Same authoritative input must produce byte-for-byte identical canonical serialization and identical fingerprint across repeated calls.
- A semantically meaningful change in included source evidence must change the fingerprint.
- Exact opaque ids remain case-sensitive and unnormalized.
- Preserve explicit zero, false, empty-valid text, and missing/absent distinctions exactly as current schemas define them.
- Do not silently drop lineage, revision, replicate, time-point, condition, DOE run/design/study, packaging, cost, or corrective evidence that is part of the input contract.
- Do not include planned/spec/objective/predicted values in a rebuild unless they are already legitimately present in the prior FVL-05 row family being fingerprinted. Do not reopen prior scope to fetch live catalogs.
- Do not re-resolve mutable live masterdata when exact historical rows/snapshots are already the prior extractor output.
- Fail closed on ambiguous/duplicate/contradictory exact identities.
- Never use display names or fuzzy matching in rebuild identity.
- Do not mutate inputs on success or failure.
- Returned manifests/canonical structures must not alias caller-owned mutable structures.
- Do not implement partitioning/splitting (FVL-05.012), model training, prediction, analytics, or UI in this session.

CANONICALIZATION / HASHING REQUIREMENTS:

Recover the exact design from source first, but the implementation must ultimately make these properties testable:
- deterministic canonical representation;
- explicit algorithm identifier;
- stable digest string format;
- schema/version fields included or excluded by a documented source-backed rule;
- no locale-sensitive sorting/comparison;
- no nondeterministic Map/Set iteration dependence unless converted under an explicit deterministic rule;
- no dependence on caller object-key insertion order;
- no hidden normalization of source string values;
- no hash of non-authoritative transient fields.

REBUILD REQUIREMENTS:

Prefer composition over reimplementation:
- reuse current FVL-05 row schemas/extractors/utilities;
- do not copy their field lists into a parallel “rebuild” model;
- if a rebuild bundle combines multiple existing row families, validate each source row with its canonical schema before canonicalization;
- preserve the exact one-formula-version boundary where current FVL-05 rows use one row per `FormulationVersion`;
- if a dataset-level manifest is needed, make formula-version membership/order rules explicit and deterministic.

ADVERSARIAL TESTS:

Cover every applicable recovered rule, including at minimum:
- identical input twice => identical canonical serialization and hash;
- cloned/deep-copied input => identical hash;
- object key insertion-order differences => identical hash;
- caller pool reordering where order is non-semantic => identical rebuild/hash;
- domain-significant array order differences => different hash where current contract says order is meaningful;
- exact source id casing change => different hash;
- Unicode/delimiter-rich ids and strings remain stable/collision-safe;
- explicit zero vs missing => different canonical payload/hash;
- false vs missing => different canonical payload/hash;
- empty-valid string vs missing where schema permits => different canonical payload/hash;
- source lineage `parentRecordId` difference => different hash;
- one measured target change => different hash;
- one normalized feature value/raw-unit change => different hash where included;
- one revision/replicate/timePoint/condition/DOE observation change => different hash where included;
- one schema-version literal change or invalid literal fails closed according to the recovered contract;
- duplicate/ambiguous row identity fails closed;
- contradictory formulaId/formulaVersion identity fails closed;
- invalid row never receives an authoritative fingerprint;
- no mutation on success and each failure path;
- output/source deep non-aliasing;
- JSON round-trip of any new manifest/fingerprint schema;
- public shared export availability;
- repeated rebuild from exact same source rows produces byte-identical canonical result;
- if dataset-level membership exists, permutation invariance only where the contract explicitly defines membership as unordered;
- prove no wall-clock timestamp/random value/machine path enters the digest.

VERSIONING:

Entering versions after accepted FVL-05.010:
- `DATASET_SCHEMA_VERSION = "1.6"`
- `FEATURE_SCHEMA_VERSION = "1.2"`

Apply the standing rule based on actual serialized-contract changes:
- do not bump existing row-family versions merely because a new pure hashing utility exists;
- if a new versioned manifest/fingerprint row/schema is introduced, determine from current family conventions whether it belongs under an existing version or requires an additive shape bump;
- do not invent a third independent version family unless direct architecture evidence proves it is necessary;
- if any version changes, update all affected tests/literals consistently and reject superseded literals per current convention.

FINAL SOURCE AUDIT:

After focused tests pass, independently re-read the whole FVL-05.011 implementation against prior FVL-05.002-.010 invariants. Do not treat a matching hash test as proof of a correct canonicalization contract.

FINAL VALIDATION FROM FINAL STATE:
- focused FVL-05.011 tests;
- relevant dataset schema/version tests;
- relevant FVL-05.009 feature tests;
- relevant FVL-05.010 target tests;
- any earlier extractor tests directly reused by the rebuild path;
- full `@formulab/shared` suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- `python scripts/validate_v1_tracker.py`;
- `git diff --check`.
Run Rust/Python checks only if those source areas are actually touched or source recovery proves they are required.

DOCUMENTATION / CONTROL PLANE:
- update only the FVL-05.011 tracker truth and unavoidable rollup counts;
- update `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`;
- append to the EXISTING `project-control/claude/logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`;
- do not create a duplicate FVL-05 log;
- do not modify GPT audit/prompt files;
- keep `.hiveai/PROJECT_DASHBOARD.md` pointer-only and unchanged unless a declared source path genuinely changes.

COMMIT / PUSH / NATIVE GATE:
- commit and push only task-owned changes;
- no amend, force push, or history rewrite;
- verify final local HEAD equals `origin/feature/laboratory-stability`;
- from final pushed HEAD, satisfy the existing Tauri release-build / Desktop\FormuLab.lnk / launch-smoke gate;
- check stale `formulab.exe` before build;
- verify real build exit code and fresh executable hash/mtime;
- verify shortcut TargetPath/WorkingDirectory/Arguments;
- launch through the actual shortcut and stop the smoke-test process afterward;
- do not claim manual UI acceptance unless the user actually performs it.

Only when implementation, source audit, tests, docs, push, and native gate are complete may you state:

`FVL-05.011 — IMPLEMENTATION COMPLETE — PENDING GPT AUDIT`

Then state:

`NEXT TASK — FVL-05.012 NOT STARTED`

Do not self-accept FVL-05.011. GPT performs the independent acceptance audit.
Do not start FVL-05.012 in this session.
```
