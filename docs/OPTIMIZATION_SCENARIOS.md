# Optimization scenarios

`packages/shared/src/engine/scenarios.ts`, `packages/shared/src/schemas/optimization.ts`
(`optimizationScenarioSchema`, `SCENARIO_STATUSES`),
`apps/desktop/src/components/formula/AdvancedOptimizerPanel.tsx`'s Scenarios
section. Part of the [Advanced Optimizer](ADVANCED_OPTIMIZER.md).

## What a scenario is

A named, comparable "what if": a full `FormulationProblem` (candidates,
constraints, objectives, solver config, compatibility/safety policy) plus a
frozen price/inventory snapshot, under a name a chemist chose — "Lowest
landed cost", "No SLES", "Kenya-local stock first". Re-running a scenario
produces a new, immutable `OptimizationRun`; the scenario itself records
which run was most recent for convenience, but the real history is every
`OptimizationRun` whose `scenarioId` matches the scenario's group (see
below) — never overwritten, never lost.

## Immutability and revisions

`optimization_scenarios` is an **append-only** master-data collection, the
same guarantee `optimization_runs` already has — once written, a record's
`code` can never be reused (`upsert_master_records` on the Rust side rejects
it). So "rename", "retire", and "save an edit" cannot rewrite an existing
scenario record. Each instead creates a **new** record:

| Field | Meaning |
|---|---|
| `scenarioGroupId` | Stable across every revision of "the same" scenario. |
| `revision` | 1 for a group's first record; +1 per save-edit/rename/retire. |
| `previousCode` | The record (in the same group) this revision supersedes. |
| `clonedFromCode` | The record (in a DIFFERENT group) this was cloned/restored from. |
| `status` | `active` or `retired`. |

"The current state of a scenario" is always the highest-`revision` record in
its group — `currentScenariosByGroup()`. A rename is just a save-edit that
only changes `name`; there is no separate rename mechanism under the hood.

**Restoring a retired scenario creates a brand-new group** (`status:
"active"`, revision 1, `clonedFromCode` pointing at the retired record) —
the retired record itself is never un-retired. This mirrors the spec's own
wording ("restore retired scenario **as a new** scenario") and the
platform's established immutable-history pattern (formula versions work the
same way).

**Delete only applies to an unsaved draft.** A scenario that has been saved
at least once (i.e. has a `code` in `optimization_scenarios`) can never be
deleted — only retired. "Unsaved draft" means the in-progress candidate/
constraint/objective selection in the Optimizer screen's own React state,
before the first "New" or "Save" click ever writes a record; there is
nothing in the append-only collection to delete at that point, so "delete
the draft" is simply resetting that local state (closing the dialog,
navigating away, or picking a different scenario from the selector).

## What a scenario persists

Everything section-2.2-shaped in the platform specification is present —
most of it inside the embedded `FormulationProblem` rather than as a
parallel copy on the scenario record itself:

- Identity/lifecycle: `code`, `scenarioGroupId`, `revision`, `status`,
  `name`, `description`, `projectId`, `createdBy`, `createdAt`, `updatedAt`.
- Source: `baseFormulaVersionId` (from a saved version) or `sourceDraftId`
  (from the working draft) — whichever the scenario actually started from.
- `includedMaterialIds` / `excludedMaterialIds` — a convenience mirror of
  `problem.materials[].excluded`, kept for a quick "what's in this
  scenario" read without walking the whole materials array.
- `problem` — batch, materials (including any locked percentage),
  composition/functional/ratio/conditional constraints, property targets,
  soft-constraint penalties, objectives, solver settings, and the
  compatibility/safety policy. One embedded object, not several parallel
  arrays that could drift out of sync with each other.
- `priceSnapshotAt` / `inventorySnapshotAt` — prices and inventory are read
  live when a scenario is authored, then frozen; re-opening a scenario later
  never silently re-prices it.
- `runCode` — the most recent run, for a quick link; the full history is
  `OptimizationRun` records, not this one field.

## Product-family profile application

31 seeded Kenya product-family profiles
(`packages/shared/src/catalog/optimizationProfiles.ts`) — structural
defaults only, every one `not_verified` with `requiresChemistReview: true`,
never an approved recipe. `applyProfileToProblem()` supports three modes:

| Mode | Behavior |
|---|---|
| `apply_missing` | Add only the profile's constraints/property-targets whose `id` is not already present. Existing configuration is completely untouched. |
| `merge` | The same algorithm as `apply_missing` — the two names exist so the UI can frame the action differently ("fill in what's missing" vs. "merge this profile in"), not because the underlying behavior differs. |
| `replace` | Discard the current composition/functional/ratio/conditional constraints and property targets; use the profile's defaults instead. Requires a second, explicit confirming click in the UI (`Replace` → `Confirm replace`) before it runs. |

None of the three modes ever touch `materials`, `batch`, or the
compatibility/safety policy — a profile is a starting point for
constraints/objectives, never a claim about which materials to use or how
strict exclusion should be. `applyProfileToProblem()` also reports which of
the profile's `requiredFunctionGroups` the current candidate pool has no
material for at all, so a missing requirement is surfaced, never silently
ignored.

## Comparison

`compareOptimizationRuns()` takes two or more persisted `OptimizationRun`s
(from the same scenario's history, different scenarios, or ad-hoc runs with
no scenario at all) and reports, per run: formula lines, raw-material/
landed cost, soft-constraint violation count, property-result count, the
graded compatibility/safety/supply/carbon/stock-utilization/evidence-
confidence objective values (when that run included them), missing-data
warning count, solver status, and solve duration — every figure read
straight from the run's own stored result, nothing recomputed or re-solved.

**Highlights are per-rule, never "best overall."** Five deterministic rules
— lowest cost, lowest safety risk, lowest compatibility risk, fewest soft
violations, highest stock utilization — each name a winner only when there
is a single, unambiguous one; a tie names no one. There is no sixth,
combined "best" score, because any such combination would be an arbitrary
weighting this module has no basis for choosing on the user's behalf.

## Known limitations

- No UI exists for ratio constraints, conditional constraints, or
  composition constraints beyond the automatic `total_equals_100` and
  compatibility/safety exclusions — a loaded scenario or applied profile
  that carries any of these still sends them to the solver correctly (see
  `profileExtras` in `AdvancedOptimizerPanel.tsx`), but they are shown only
  as a small read-only count, not editable, in this screen.
- No per-material lock editor — "included"/"excluded" is the candidate
  checklist; there is no UI control for locking a material to a fixed
  percentage within a scenario yet (the schema and solver both support it).
- `revision` bookkeeping happens per explicit user action (New/Save/Rename/
  Retire) — running a scenario does not itself create a new scenario
  revision, only a new `OptimizationRun`.
