# FVL06-GPT-PROMPT-000020 — Codex Master Execution Prompt

Repository: https://github.com/Sekiph82/FormuLab
Canonical branch: `main`
Canonical task authority: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
Governance: https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
Codex master prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL06-GPT-PROMPT-000020.md
Actor: CODEX

## Objective

Complete the entire FVL-06 milestone in strict task order and push validated results to `main`.

Canonical scope:

### Sprint FVL-06-S01 — Measured-response domain model
1. `FVL-06.001` — Define structured measured-response schema
2. `FVL-06.002` — Define spectrophotometric/detergent-performance metric schema
3. `FVL-06.003` — Raw measurement + normalized-performance field only when deterministic normalization exists
4. `FVL-06.004` — Raw-file attachment/provenance linkage
5. `FVL-06.005` — Measured-response linkage fields for formula version, trial, sample, test definition, timestamps

### Sprint FVL-06-S02 — Instrument ingestion & dataset integration
6. `FVL-06.006` — CSV/Excel instrument import through existing Data Exchange
7. `FVL-06.007` — Instrument-import validation rules for units and linkage
8. `FVL-06.008` — Reuse existing Data Exchange import-history/commit lifecycle
9. `FVL-06.009` — Feed instrument/performance data into FVL-05 dataset extractors
10. `FVL-06.010` — Real sample instrument-export acceptance test

Do not start FVL-07 implementation.

## Source of truth and startup

Before changing code:

1. checkout `main`
2. fetch and pull latest `main`
3. read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md completely
4. read https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md completely
5. treat https://github.com/Sekiph82/FormuLab/blob/main/CLAUDE.md as compatibility-only
6. inspect relevant FVL-05 dataset contracts before designing FVL-06
7. inspect the existing Data Exchange architecture before implementing imports
8. inspect existing laboratory, test, formulation, attachment/document, provenance, audit, and import-history models before introducing any new structure

https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md is the only authoritative task-state ledger.

Codex is the primary implementation/execution agent.

Do not create:
- alternate task trackers
- competing dashboards
- `.hiveai` task/state/handoff/event files
- duplicate milestone ledgers
- unnecessary new architecture when an existing canonical subsystem already exists

## Execution behavior

Work continuously from FVL-06.001 through FVL-06.010.

Do not stop after each task for approval.

Only stop for a genuine non-resolvable blocker.

At task start:
- mark the task `[~]`
- set Current Task appropriately
- set Current Task Status = IN_PROGRESS
- keep Next Task accurate
- commit/push the state transition with the implementation state it represents

At validated completion:
- mark the task `[x]`
- advance Current Task / Next Task atomically
- keep progress counts exact

Do not mark a task complete merely because code exists.

---

# FVL-06.001 — Structured measured-response schema

Define the canonical measured-response model for laboratory and performance data.

Before adding new entities, audit whether existing models already cover:
- LaboratoryTrial
- TestResult
- test definitions
- samples
- formula/formulation version
- units
- measured values
- timestamps
- operator/instrument metadata
- provenance
- attachments

Prefer extending canonical models over duplicating them.

The measured-response contract must explicitly distinguish, where applicable:
- raw observed value
- unit
- measurement name / metric identity
- measurement context
- sample identity
- test definition identity
- trial identity
- formula version identity
- acquisition timestamp
- recorded/imported timestamp
- source/provenance identity
- optional quality/status fields already supported by the domain

Missing values must remain missing.

Never coerce:
- missing to zero
- failed measurement to zero
- unavailable result to false success
- textual qualifier into a fabricated numeric value

Schema must be versioned if serialized/persisted contract changes.

Add focused validation and round-trip tests.

---

# FVL-06.002 — Spectrophotometric / detergent-performance metric schema

Define structured support for detergent and spectrophotometric performance measurements without fabricating scientific semantics.

Inspect current FormuLab domain and existing measured-response/test definitions first.

Support only fields justified by actual measurement semantics and source data.

Possible supported metric families may include, where source contracts justify them:
- absorbance
- reflectance
- transmittance
- colorimetric values
- wavelength-specific readings
- soil/stain removal performance
- whiteness/brightness indices
- comparative performance measures
- replicate measurements

Do not invent domain equations, reference standards, or normalization formulas.

Each metric must preserve:
- metric identity
- raw measured value
- unit or dimensionless status
- wavelength/reference context when applicable
- method/test definition linkage
- sample linkage
- provenance

Use explicit enums/identifiers only where the repository's existing conventions support them.

Add focused schema and validation tests.

---

# FVL-06.003 — Raw vs normalized performance

Implement a strict contract:

Raw measured value is always preserved.

A normalized-performance value may exist only when a deterministic normalization rule is explicitly known and reproducible.

Required rules:
- normalization must never overwrite raw measurement
- normalization method/version must be traceable
- normalization inputs must be traceable
- normalization must be reproducible
- absence of normalization rule => normalized value remains missing
- failed or unavailable normalization must not become zero
- no heuristic/LLM normalization
- no hidden fallback to a current/latest standard

If normalization is derived, preserve enough metadata to reproduce it exactly.

Add tests for:
- raw-only measurement
- normalized measurement with explicit rule
- missing normalization context
- invalid normalization inputs
- zero raw value
- negative/edge values where scientifically valid
- round-trip preservation

---

# FVL-06.004 — Raw-file attachment and provenance linkage

Measured responses imported or recorded from an instrument must support exact source-file provenance.

Audit and reuse existing attachment/document/file abstractions.

Do not create a parallel attachment subsystem.

Preserve, where available:
- source file identity
- original filename
- MIME/type
- checksum/hash
- import batch/import-history identity
- source connector identity
- source row/sheet/cell or equivalent locator when available
- acquisition/export timestamp
- attachment linkage to measured response

Do not store secrets or machine-specific transient paths as authoritative provenance when a stable canonical reference exists.

If raw instrument files are copied into managed storage, use existing managed-file lifecycle and integrity rules.

Add tests proving provenance survives round-trip and import.

---

# FVL-06.005 — Measured-response linkage fields

Every measured response must link cleanly, where the source data supports it, to:

- formulation/formula version
- laboratory trial
- sample/specimen
- test definition / method
- timestamps
- instrument/source provenance

Do not invent missing links.

Ambiguous linkage must:
- remain unresolved, or
- fail validation/import according to existing Data Exchange rules

Never silently link to “latest” formula/trial/sample/test definition.

Historical data must preserve historical identity.

Add tests for:
- complete linkage
- partial but valid linkage
- ambiguous linkage
- missing required linkage
- historical/versioned identity
- repeated measurements on same sample/test

---

# FVL-06.006 — CSV/Excel instrument import through Data Exchange

Implement CSV and Excel measured-response import by reusing the existing Data Exchange architecture.

Do not build a separate instrument-import framework.

Audit and reuse:
- template registry
- mapping profiles
- schema discovery
- transformation/unit/enum mapping
- crosswalk registry
- import staging
- validation
- commit lifecycle
- import history
- conflict handling
- file parsing infrastructure

Instrument import must support source-specific mappings without hardcoding one vendor format into the canonical domain model.

Support realistic import concerns:
- header discovery
- sheet selection where applicable
- decimal and numeric parsing consistent with existing import rules
- unit mapping
- date/time mapping
- ID/crosswalk mapping
- metric mapping
- provenance capture
- row-level validation

Do not silently discard malformed rows.

Add focused CSV and Excel tests.

---

# FVL-06.007 — Instrument import validation

Add explicit validation rules for instrument/performance imports.

At minimum validate:
- numeric field validity
- unit compatibility
- metric identity
- required linkage fields
- timestamp format
- duplicate identity where applicable
- source/provenance presence where required
- formula/trial/sample/test-definition crosswalk resolution
- normalized value only when deterministic normalization context exists

Validation errors must be human-readable and must identify source row/location where the Data Exchange framework supports it.

Do not turn invalid input into guessed valid data.

Add positive and negative validation tests.

---

# FVL-06.008 — Reuse Data Exchange import-history / commit lifecycle

Instrument imports must flow through the same canonical lifecycle as other Data Exchange imports.

Do not bypass:
- staging
- validation
- review/commit semantics
- import history
- conflict handling
- rollback/retry rules already present

Measured-response import must not write directly into canonical records before the existing commit gate allows it.

Reuse current audit/history structures.

Add regression tests proving instrument imports participate in existing import history and commit semantics.

---

# FVL-06.009 — Feed instrument/performance data into FVL-05 dataset extractors

Extend FVL-05 dataset extraction so canonical measured-response/instrument data can become dataset targets/context according to existing FVL-05 contracts.

Do not break:
- FVL-05 lineage
- immutability
- leakage-safe partitioning
- fingerprint determinism
- missing-value semantics
- target definitions

Required guarantees:
- exact source lineage
- raw value preservation
- normalized value used only when explicitly valid
- source provenance retained
- no live/latest fallback
- dataset rebuild does not mutate measured-response records
- new data participates deterministically in fingerprints where semantically relevant

Add regression tests spanning:
instrument import -> canonical measured response -> FVL-05 extractor -> target/feature output -> lineage/fingerprint/partition compatibility.

Do not implement FVL-07 model training.

---

# FVL-06.010 — Real sample instrument-export acceptance

Create a real sample acceptance fixture representing a plausible instrument export.

Use a bounded, repository-owned test fixture.

The fixture should exercise:
- CSV or Excel import path, preferably both if existing infrastructure supports both without artificial complexity
- realistic headers
- multiple measurements
- units
- timestamps
- formula/trial/sample/test linkage
- provenance
- validation
- Data Exchange staging/commit lifecycle
- resulting canonical measured-response records
- FVL-05 dataset extraction

Acceptance must verify:
- imported values are exact
- missing remains missing
- invalid data is rejected clearly
- provenance is retained
- lineage resolves correctly
- no source mutation
- deterministic rebuild/fingerprint behavior remains valid

Do not call synthetic happy-path-only coverage “real acceptance” if it bypasses actual Data Exchange parsing/commit flow.

---

# Scope control

Allowed:
- domain schema/types needed for FVL-06
- extensions to existing canonical laboratory/test models
- Data Exchange mapping/template/validation work
- import parsing integrations
- provenance/attachment linkage
- FVL-05 extractor integration
- focused UI changes only if required to expose existing Data Exchange workflow correctly
- tests
- TASKS.md updates
- minimal public-contract docs

Not allowed:
- FVL-07 ML eligibility/training
- FVL-08 ranking
- FVL-09 active learning
- FVL-10 closed-loop/retraining lineage beyond what FVL-06 strictly requires
- FVL-11 final release closure
- unrelated UI redesign
- new parallel import framework
- speculative instrument SDK integrations
- vendor-specific architecture unless justified by an existing required fixture

Do not create new task IDs.

# Data integrity rules

Non-negotiable:
- historical records are immutable
- missing stays missing
- raw measurement is preserved
- normalized value never replaces raw value
- no fabricated scientific values
- no latest/live fallback for historical linkage
- no AI auto-approval of regulated records
- imports do not bypass human/commit gates already required by Data Exchange

# Versioning

Inspect existing schema/version contracts before any bump.

Do not bump versions automatically.

Only change serialized schema versions when the serialized contract actually changes.

If measured-response or instrument-import persisted artifacts introduce a new versioned contract, define/version/test it explicitly.

Preserve backward compatibility where existing persisted records require it.

# Required validation

After each task, run focused tests.

Before closing FVL-06, run the broadest relevant validation available, including where present:

- shared package tests
- desktop tests
- Data Exchange tests
- dataset/FVL-05 regression tests
- TypeScript typecheck
- Rust tests/check if affected
- Python tests if relevant
- lint
- production build
- git diff --check
- canonical TASKS.md count/ID validation

Do not claim tests passed unless actually run.

If an environment limitation prevents a suite:
- record the exact limitation
- run safe substitutes
- do not fake PASS

# Git rules

Work on `main`.

Before starting:
- fetch
- pull --ff-only where possible
- inspect working tree
- preserve unrelated owner changes

Commit meaningful checkpoints.

Suggested commit grouping:
1. FVL-06.001-.005 measured-response domain model
2. FVL-06.006-.008 Data Exchange instrument ingestion
3. FVL-06.009 dataset integration
4. FVL-06.010 acceptance + milestone closure

Smaller commits are acceptable when they improve auditability.

Push validated commits to `main`.

Never force-push `main`.

Do not create a long-lived branch unless repository protection makes direct-main work impossible.

# TASKS.md state transitions

Start:
- FVL-06.001 -> `[~]`
- Current Task = FVL-06.001
- Current Task Status = IN_PROGRESS
- Next Task = FVL-06.002

Advance sequentially through all ten tasks.

When S01 completes:
- Current Sprint becomes FVL-06-S02
- Current Task advances to FVL-06.006

After FVL-06.010 is fully validated:
- mark FVL-06.010 `[x]`
- Current Milestone = FVL-07
- Current Sprint = FVL-07-S01
- Current Task = FVL-07.001 — Eligibility: minimum dataset size and target-observation thresholds
- Current Task Status = READY
- Next Task = FVL-07.002 — Eligibility: missing-data rules and applicability-domain requirements
- Required Actor = CODEX
- Blockers/Waits = None unless genuinely blocked
- recalculate completed/remaining/completion exactly

Do not set FVL-07.001 to `[~]`.
FVL-07 must remain unstarted.

# Final report

At the end report:

`FORMULAB FVL-06 MILESTONE COMPLETE`

Include:
- final main HEAD SHA
- commits created
- implementation summary for FVL-06.001-.010
- exact test suites and pass/fail counts
- schema/version changes
- Data Exchange changes
- sample acceptance fixture details
- FVL-05 integration/regression status
- TASKS.md final counts
- confirmation FVL-07.001 is READY but NOT STARTED
- known limitations
- working-tree status
- push status

Do not claim milestone completion while any required task or validation remains unresolved.

Begin now and continue autonomously until FVL-06 is complete or a genuine non-resolvable blocker is reached.
