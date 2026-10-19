# FVL05-GPT-PROMPT-000019 — Codex Master Execution Prompt

Repository: `Sekiph82/FormuLab`
Canonical branch: `main`
Canonical task authority: `/TASKS.md`
Actor: CODEX

## Scope

Complete the remaining FVL-05 milestone tasks in strict order:

1. `FVL-05.012` — Train/validation/test partition rules with leakage prevention
2. `FVL-05.013` — Immutable historical linkage; dataset build never mutates a source record
3. `FVL-05.014` — Regression tests: rebuild determinism, missing-value handling, leakage checks, lineage round-trip

Do not start FVL-06 implementation.

## Source-of-truth rules

Before changing code:

1. checkout `main`
2. fetch/pull latest `main`
3. read `TASKS.md` completely
4. read `AGENTS.md`
5. read `CLAUDE.md` if present
6. inspect relevant FVL-05 source, schemas, tests, and historical evidence

`TASKS.md` is the only authoritative task-state ledger.

Do not create or revive:
- alternate task trackers
- `.hiveai` task/state/handoff/event files
- competing dashboards
- duplicate milestone ledgers

Historical files under `project-control/**`, `docs/**`, logs, audits, handoffs, and migration archives are evidence only.

## Execution behavior

Work continuously through FVL-05.012, FVL-05.013, and FVL-05.014.

Do not stop after each task merely to ask for permission.

Only stop for a genuine non-resolvable blocker.

When a task starts:
- change its row in `TASKS.md` from `[ ]` to `[~]`
- update Project Status Current Task / Current Task Status
- keep Next Task accurate

When a task is implemented and validated:
- mark it `[x]`
- advance Project Status atomically
- keep summary counts accurate

Do not mark a task complete merely because code was written.

---

# FVL-05.012 — Partition rules with leakage prevention

Implement deterministic and scientifically defensible train/validation/test partitioning for historical FormuLab datasets.

Before implementation, inspect real source contracts for:
- formula/version identity
- product-family identity
- LaboratoryTrial identity
- TestResult identity
- StabilityStudy/sample/result identity
- DOE study/design/run/observation identity
- corrective-action lineage
- dataset bundle manifests
- source-record lineage
- target observations
- FVL-05.011 fingerprint/rebuild implementation

Do not guess grouping semantics.

Determine from source which records are statistically dependent and therefore must remain in the same partition.

At minimum investigate:
- Formula / FormulationVersion relationships
- revision/retest chains
- LaboratoryTrial
- TestResult replicates
- StabilityStudy and its samples/results
- DOE study/design/run relationships
- repeated observations from one experiment
- corrective-action-linked records
- derived feature/target rows from one source bundle
- product-family boundaries where relevant

Required rules:

### Determinism
Same dataset + same config + same seed must produce exactly the same assignment.

### Group safety
No correlated leakage group may cross train/validation/test.

### No target leakage
Measured target values must not influence partition assignment.

### No future-information leakage
If chronology is relevant or temporal partitioning is implemented, later observations must not leak into earlier training data.

### Exact lineage
Every assignment must be traceable to exact source/bundle/group identity.

### Input-order invariance
Semantically irrelevant input order changes must not alter assignment.

### Explicit reproducibility contract
Persist or expose:
- partition strategy
- split ratios
- seed
- grouping strategy/version
- relevant schema/version identifiers

### Fail closed
Malformed or ambiguous lineage must not silently produce a scientifically misleading split.

Do not implement ML model training here.

Required focused tests should include, where applicable:
- repeated deterministic split
- input-order invariance
- different-seed behavior where permitted
- realistic split-ratio behavior under group constraints
- one leakage group never crosses partitions
- replicate grouping
- retest/revision grouping
- stability-study grouping
- DOE relationship grouping
- target values do not influence assignment
- missing/ambiguous lineage fails closed
- duplicate/conflicting group identity handling
- zero/false/missing semantics preserved
- source objects not mutated
- schema round-trip validation
- FVL-05.011 fingerprint/rebuild regression remains green

Prefer a simple deterministic algorithm over an opaque library splitter if that better preserves reproducibility and domain grouping.

---

# FVL-05.013 — Immutable historical linkage

Prove and enforce that dataset construction is read-only with respect to historical source records.

Audit the complete FVL-05 pipeline:
- formula/composition/material/property extraction
- process extraction
- laboratory/TestResult extraction
- stability extraction
- DOE extraction
- corrective action / cost / packaging / context extraction
- feature normalization
- target extraction
- bundle manifest construction
- dataset manifest construction
- partition generation
- fingerprinting/rebuild logic

Required guarantees:

### Source immutability
No extractor or builder may modify source records or nested children.

### No alias-based mutation
Returned dataset structures must not expose mutable references that can modify source objects indirectly.

### Exact historical identity
Do not regenerate, normalize, rewrite, or substitute historical source IDs.

### Historical values stay historical
Do not repair old records from live/current master data during dataset build.

### No latest/live fallback
Missing historical context must stay missing or fail according to the existing contract.

### Frozen snapshots stay authoritative
Where historical frozen snapshots exist, use them according to their source contract.

### Rebuild is observational only
Dataset build may create dataset artifacts but must not write back into source-domain records.

Add focused regression tests using:
- deep-cloned source fixtures before build
- build/extract/partition/fingerprint operations
- deep equality after build
- nested mutation probes
- returned-object aliasing probes
- deep-frozen fixtures where useful

Do not redesign unrelated domain models.

---

# FVL-05.014 — Milestone regression suite

Create a coherent milestone-closing regression layer for the whole FVL-05 dataset system.

Cover at least:

## Rebuild determinism
- same sources -> same canonical rows
- same sources -> same bundle digest
- same sources -> same dataset digest
- same partition config -> same partition result

## Input-order invariance
Order changes that are not semantically meaningful must not change canonical semantic output or authoritative fingerprints.

## Missing-value handling
- missing stays missing
- zero is not missing
- false is not missing
- no silent imputation

## Leakage prevention
- no leakage group crosses partitions
- target values do not drive assignment
- related study/retest/replicate records remain grouped according to FVL-05.012

## Lineage round-trip
Every produced row/target/partition entry must resolve back to its authoritative source identity.

## Historical immutability
Dataset build leaves source records semantically unchanged.

## Fingerprint integrity
- meaningful content changes affect the appropriate digest
- irrelevant ordering does not
- malformed data cannot receive an authoritative digest
- schema/version participation follows the FVL-05.011 contract

## Feature/target separation
Predictor features and measured-response targets remain semantically distinct.
Do not reintroduce computed replicate statistics as independent target labels.

## DOE anti-leakage
Preserve established frozen-snapshot and status semantics.

## Stability/TestResult regressions
Preserve contextual identity and revision/retest distinctions.

## Schema validation
All authoritative generated structures validate through canonical schemas.

## Public API/export regression
Required exports remain reachable through intended package entry points.

---

# Scope control

Allowed:
- code required for FVL-05.012-.014
- schemas/types required by those tasks
- focused refactors needed for correctness
- tests
- `TASKS.md` updates
- minimal public-contract documentation

Not allowed:
- FVL-06 implementation
- measured-response domain expansion belonging to FVL-06
- FVL-07 model training
- FVL-08 ranking
- FVL-09 active learning
- FVL-10 closed-loop work
- FVL-11 final acceptance work
- unrelated UI redesign
- unrelated dependency upgrades
- speculative architecture rewrites

Do not create new task IDs.

# Versioning

Inspect existing schema-version contracts before changing versions.

Do not bump versions automatically.

Only bump a serialized schema version when the serialized contract actually changes.

Preserve existing DATASET_SCHEMA_VERSION / FEATURE_SCHEMA_VERSION semantics.

If a persisted partition artifact requires its own schema version, define it explicitly and test it.

# Required validation

After each task:
- run focused tests for the changed subsystem

Before closing FVL-05, run the broadest relevant validation available, including where present:
- shared/package unit tests
- FVL-05 regression tests
- TypeScript typecheck
- Python tests if relevant paths use Python
- Rust tests/check if affected
- frontend tests if exported contracts affect frontend consumers
- lint
- build
- diff/format checks
- TASKS consistency validation if available

Do not claim a suite passed unless it actually ran.

If an environmental limitation blocks a suite:
- record the exact limitation
- run all safe substitutes
- do not fake PASS

Do not use Android emulator or unrelated device testing for this milestone unless repository contracts explicitly require it.

# Git rules

Work on `main`.

Before starting:
- fetch
- pull --ff-only where possible
- verify the working tree is clean or understood

Do not discard unrelated owner changes.

Commit meaningful checkpoints.

Suggested commit sequence:
1. FVL-05.012 implementation + tests
2. FVL-05.013 immutability enforcement + tests
3. FVL-05.014 regression suite + TASKS milestone closure

Push `main` after validated commits.

Do not create a long-lived branch unless repository protection makes direct-main work impossible.

Never force-push `main`.

# TASKS.md closure behavior

At start of FVL-05.012:
- FVL-05.012 -> `[~]`
- Current Task = FVL-05.012
- Current Task Status = IN_PROGRESS

After validation:
- FVL-05.012 -> `[x]`
- move FVL-05.013 to `[~]`
- update Current/Next

Repeat for FVL-05.013.

For FVL-05.014:
- set `[~]` while active

After all FVL-05 validation passes:
- FVL-05.014 -> `[x]`
- Current Milestone = FVL-06
- Current Sprint = FVL-06-S01
- Current Task = FVL-06.001 — Define structured measured-response schema
- Current Task Status = READY
- Next Task = FVL-06.002 — Define spectrophotometric/detergent-performance metric schema
- Required Actor = CODEX
- Blockers/Waits = None unless genuinely blocked
- recalculate completed/remaining/completion values exactly

Do not set FVL-06.001 to `[~]`.
FVL-06 must remain unstarted.

# Final report

Do not stop between the three tasks unless genuinely blocked.

At the end report:

`FORMULAB FVL-05 MILESTONE COMPLETE`

Include:
- final main HEAD SHA
- commits created
- FVL-05.012 implementation summary
- FVL-05.013 implementation summary
- FVL-05.014 regression summary
- exact tests/suites run and pass/fail counts
- schema/version changes, if any
- TASKS.md final counts
- confirmation that FVL-06.001 is READY but NOT STARTED
- remaining known limitations, if any
- working-tree status
- push status

Do not claim FVL-05 complete while any required task or regression remains unresolved.

Begin now and continue autonomously until FVL-05 is complete or a genuine non-resolvable blocker is reached.
