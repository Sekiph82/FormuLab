# FormuLab v1 — Final Completion Scope

## FORMULAB V1 COMPLETION SCOPE FROZEN — 2026-08-17

This document is the authoritative, version-controlled statement of everything
still required to declare **FormuLab v1 complete**. It is created at the point
where Phase 14 (Evidence-Driven Hybrid Literature & Formulation Intelligence)
is implementation-complete — see
[`docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md`](PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md)
§20/§21 and `project-control/claude/handoffs/PHASE14_CURRENT.md` — and is the **last scope
change before v1 completion**.

Phase 14's own history is preserved exactly as recorded. This document does
not reopen it, redesign it, or reinterpret its closure. It only defines what
remains beyond it.

### Scope-change policy (binding on every future session)

1. New capabilities require an explicit human decision to reopen scope. No
   session may add a new top-level work package on its own initiative.
2. A routine implementation session may split an existing task
   (`FVL-XX.YYY`) into smaller subtasks, but may **not** create a new
   top-level work package (`FVL-12` or beyond).
3. A bug fix required to make a frozen task work correctly is part of that
   task, not scope expansion — document it under the task it was found in.
4. Tests, documentation, data migrations, integration work, and security
   fixes necessary to complete a frozen task are part of that task.
5. Optional enhancements — anything not required by a frozen task's own
   acceptance criteria — are **not** added to v1, however useful they sound.
6. The frozen task list in
   [`docs/FORMULAB_V1_TASK_TRACKER.md`](FORMULAB_V1_TASK_TRACKER.md) is the
   authoritative FormuLab v1 completion contract. This scope document and
   that tracker together define "done."

### Single-authority principle (binding on every future session)

Adopted 2026-08-18 as an architecture correction, hardening the intent
already stated in §2 below — not a new capability, not a new work package.

For every existing FormuLab business domain there SHALL be exactly one
authoritative engine and exactly one authoritative source of truth. An
existing authoritative implementation must be reused, called, or extended
in place. It must **not** be independently reimplemented anywhere else in
the platform, including inside `runtime/pipeline`.

A pipeline-local adapter MAY: serialize, deserialize, map field names, map
canonical IDs, reshape data for transport, or expose an existing
authoritative result to Python/Rust/TypeScript.

A pipeline-local adapter MUST NOT: recompute a business decision, choose an
authoritative price, calculate landed cost, calculate exchange-rate
conversion, duplicate a safety verdict, duplicate a regulatory verdict,
duplicate compatibility logic, duplicate substitution scoring, duplicate
optimizer logic, duplicate inventory-availability rules, duplicate supplier
qualification rules, or create a second material identity model.

An adapter is a transport/shape boundary only. It is not another engine.

This principle governs how every remaining FVL-03 (and later FVL-04
through FVL-11) task is implemented — see
[`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`](FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md)'s
authoritative domain map and legacy retirement matrix for the exact,
code-traced per-domain authority and any confirmed duplicate needing
retirement.

---

## 1. Final formula-count requirement (the last functional scope change)

Formulation generation is no longer conceptually fixed to exactly V1/V2/V3.

**MINIMUM formula alternatives: 3**
**MAXIMUM formula alternatives: 7**

- The target count may be request-driven/configurable within `[3, 7]`.
- The default remains **3** unless the existing UX/product spec gives a
  stronger reason for a different default.
- The engine must **never** fabricate alternatives merely to hit a requested
  count.
- If N is requested but only M < N scientifically/technically defensible
  distinct architectures can be produced, return M and explain why.
- Under normal successful generation there should be at least 3 genuinely
  distinct alternatives.
- If even 3 valid alternatives cannot be produced (evidence, materials,
  safety, regulatory, functional-completeness, or other hard constraints
  make it impossible), return the honest number available and mark the
  result incomplete/insufficient — never fabricate.
- Maximum is hard-capped at 7.
- Formula identifiers no longer assume only V1/V2/V3 exist.
- `V1..V7` are acceptable **display labels only**; underlying logic uses
  `formulaVersionId`/card/version collections, never hardcoded
  three-version branching.
- Every version-scoped subsystem works for 3–7 alternatives: Formula,
  Manufacturing Procedure, Critical Parameters, Equipment, Safety,
  Regulatory, Evidence & Sources, Alternatives, Summary, ingredient
  evidence, traceability, report generation, persistence, session
  reopening, backward compatibility.
- The UI renders the real returned number dynamically.
- No giant side-by-side 7-formula table — the existing one-formula-at-a-time
  result UX is preserved; only its version selector becomes dynamic.
- Existing historical V1/V2/V3 sessions remain readable.
- Diversity validation operates over N alternatives, not a fixed 3.
- Strategy derivation supports up to 7 distinct applicable strategies
  without duplicating a strategy merely to fill a slot (reuse the existing
  strategy library — do not invent new strategy categories to reach 7).
- Existing hard constraints always outrank the requested alternative count.

Implementation is tracked in detail under **FVL-02**.

---

## 2. NOT IN FORMULAB V1 COMPLETION SCOPE

The following are intentionally excluded. They must **not** reappear as new
proposed phases inside v1 scope. Reopening any of them requires an explicit
human scope-change decision, out of band from routine implementation
sessions.

- Literature Engine v2 / another literature-provider expansion programme
- Supplier web crawler / supplier scraping platform
- A new, standalone Cost Engine (the existing one is reused)
- A new, standalone Procurement Engine
- A new, standalone Regulatory Engine (the existing Kenya/EAC engine plus
  Phase 14's `regulatory.py` are reused/integrated, not replaced)
- A new Stability system (existing Stability Studies are reused)
- A new DOE system (the existing DOE engine is reused)
- A separate "Real Formulation Knowledge Base" (FVL-05's dataset builder is
  a *derived, versioned view* over existing source-of-truth records, never
  a second authoritative store)
- A replacement Reverse Formulation system
- LLM-based formulation generation, extraction, or fallback of any kind
- LLM-based concentration invention
- Automatic AI approval of any regulated record
- An independent duplicate material/supplier/cost/regulatory datastore
  where existing FormuLab masterdata can be reused

Existing implementations are reused and integrated, never duplicated.

---

## 3. Final FormuLab v1 work packages

Exactly the following eleven top-level work packages exist. No `FVL-12` or
beyond may be created without an explicit human scope-change decision. Each
package may contain as many detailed subtasks as its own architecture
requires — see the tracker.

| ID | Work package | Expected baseline status |
|---|---|---|
| FVL-01 | Phase 14 Closure Baseline | COMPLETED |
| FVL-02 | Dynamic 3–7 Formula Alternatives | blank |
| FVL-03 | Unified Formulation Pipeline ↔ Existing FormuLab Engines | blank |
| FVL-04 | Data Onboarding Through Existing Data Exchange | blank |
| FVL-05 | Historical Experiment Dataset Builder | blank |
| FVL-06 | Instrument & Performance Result Ingestion | blank |
| FVL-07 | Predictive Performance Engine (supervised ML, not an LLM) | blank |
| FVL-08 | Performance Ranking + Existing Optimizer Integration | blank |
| FVL-09 | Active Learning / Next Best Experiment | blank |
| FVL-10 | Closed Laboratory Feedback Loop | blank |
| FVL-11 | Final Integrated Acceptance & FormuLab v1 Closure | blank |

Dependency order (high-level; the tracker's own per-task `Depends on`
fields are authoritative where they differ in fine detail):

```
FVL-01 → FVL-02 → FVL-03 → FVL-04 → FVL-05 → FVL-06 → FVL-07 → FVL-08 → FVL-09 → FVL-10 → FVL-11
```

FVL-04/FVL-05/FVL-06 may legitimately overlap in dependency terms, but
multiple top-level packages are not started simultaneously merely because
parallelization is theoretically possible — v1 is finished in a controlled
sequence.

Full package descriptions, acceptance criteria, and every subtask live in
[`docs/FORMULAB_V1_TASK_TRACKER.md`](FORMULAB_V1_TASK_TRACKER.md).

### FVL-04 scope expansion — approved 2026-08-18

An explicit human decision (per the Scope-change policy above, item 1)
approved widening FVL-04 to also cover enterprise external-source
connector/mapping/crosswalk onboarding, alongside its original
canonical/template-based Data Exchange confirmation work. This is a scope
addition WITHIN the existing FVL-04 package — it does not create a new
top-level work package. The eleven-package structure above is unchanged:
still exactly FVL-01 through FVL-11, no `FVL-12`.

Approved additions (full task detail in the tracker, FVL-04.013–.026):

- FVL-04 now includes enterprise external-source connector/mapping/
  crosswalk onboarding — a read-only connector layer (file, database, or
  REST API extraction) that adapts a customer's existing system schema
  into FormuLab's canonical shape through a reusable, versioned mapping
  profile and a persistent external-ID crosswalk (never name-only
  matching).
- The existing Data Exchange Center remains the sole commit/validation
  authority. The connector/mapping layer is an onboarding adapter in
  front of it, not a second import platform — every connector-sourced
  record still passes through the EXISTING preview, validation, human
  review, and explicit-commit steps before becoming a canonical FormuLab
  record.
- Customer source systems may enter through file extraction (CSV, XLSX,
  JSON, XML), generic read-only relational database extraction, or a REST
  API connector contract — all sharing one common connector contract.
- Only a generic connector architecture is in v1 scope. Vendor-specific
  integrations (SAP, Dynamics, a named LIMS product, etc.) are explicitly
  NOT implicitly in scope and require a separate future approval.
- A human-readable, stable artifact naming convention for downloaded
  literature/source documents and saved/exported formulation artifacts is
  included (FVL-04.026) — a display title distinct from a deterministic
  physical filename, with the original source filename and every
  provenance identifier (DOI/source ID, URL, acquisition timestamp,
  content hash where available) always preserved, never destroyed by
  display renaming.

No production implementation of any FVL-04.013–.026 task occurred as part
of approving this scope — see `docs/FORMULAB_V1_TASK_TRACKER.md` for
current status (all blank) and `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md` for
the current execution pointer (unchanged: `FVL-03.009`, NOT STARTED).

---

## 4. Definition of "FormuLab v1 complete"

FormuLab v1 is complete only when:

- Every task under FVL-01 through FVL-11 in the tracker is `COMPLETED` or
  explicitly and honestly determined not applicable (recorded as such, not
  silently dropped).
- FVL-11's own integrated acceptance matrix passes for the product families
  it defines.
- The zero-LLM regression guard still passes.
- A fresh desktop build exists and the local shortcut points at it.
- The repository is pushed to `origin/feature/laboratory-stability` (or its
  eventual merge target) with no outstanding blocking task.
- An explicit v1 COMPLETE declaration is recorded in
  `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md` — never assumed from code existing.

## 5. Data safety (standing rules, restated)

- Never mutate real/local `.FormuLab/runs.db`.
- Never mutate real user/business data for tests.
- Never mutate `%APPDATA%\com.formulab.app` for synthetic acceptance.
- Never mutate OneDrive Documents FormuLab production data.
- Use disposable temporary fixtures for tests.
- Preserve historical sessions; never rewrite external logs retrospectively.
- Do not modify `formulas/index.json` unless root-cause analysis proves it
  is required.
- No force push. No history rewrite. No subagents used for implementation
  of frozen v1 tasks.
