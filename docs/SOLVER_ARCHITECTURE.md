# Solver architecture

`runtime/formulation/advanced_optimizer.py`. Open the **Optimizer** tab
inside a formula project.

## What this is

A mixed-integer/linear program (MIP/LP), solved by [PuLP](https://github.com/coin-or/pulp)
against the bundled CBC solver — the same dependency the existing simple
optimizer (`runtime/formulation/formulation_core.py`) already uses. This is
a separate script and a separate Tauri command
(`run_advanced_formulation_optimize` / `formulation_advanced.rs`); the
simple optimizer's input shape, output shape and CLI are untouched.

## Why Python, not TypeScript

Constraint solving is a genuinely different problem from the rest of this
platform's TypeScript engine modules (`engine/compatibility.ts`,
`engine/safety.ts`, ...), which evaluate a fixed rule set against a formula.
An LP/MIP solver needs a real numerical solver — CBC — and PuLP is the
existing, already-bundled way this platform reaches one. Reimplementing a
solver in TypeScript would mean either shipping a second, weaker solver or a
WASM port of CBC; neither is worth it when the existing Python bridge
pattern (`kernel.rs`, `formulation.rs`) already solves "run bundled Python
from Rust, get JSON back."

What stays in TypeScript (`packages/shared/src/engine/optimization.ts`) is
everything that does **not** need a solver: turning UI state into a
`FormulationProblem`, recomputing the solver's own active-matter/functional-
group arithmetic for display, and the fixed
`PROPERTY_CAPABILITY` ceiling on what this platform can honestly compute per
property.

## The TS/Python contract

`packages/shared/src/schemas/optimization.ts`'s `formulationProblemSchema`
and `advancedOptimizationResultSchema` are the contract. The Python side does
not import Zod (nor Pydantic — no new dependency was added; validation is
hand-rolled dict access, the same style `formulation_core.py` already uses).
The two are kept in sync **by hand**, the same tradeoff already made
elsewhere in this platform (`HUMAN_ONLY_STATUSES`, the compatibility/safety
rule shapes duplicated across TS and this project's Rust/Python boundary).
There is no schema-generation step. A field renamed on one side and not the
other fails at the JSON boundary — `serde_json::Value` on the Rust side,
plain dict access on the Python side — not at compile time.

## Solve model

Decision variable `x_i` = kilograms of candidate material `i`,
`0 <= x_i <= cap_i`, where `cap_i` is the tightest of: available stock,
`batch_kg * max_use_pct_i / 100`, technical maximum, and regulatory maximum.
A **locked** material (`OptimizationMaterial.lockedPercent`) collapses its
own bounds to an equality constraint rather than a range.

A material referenced by a **conditional constraint** additionally gets a
binary indicator variable, linearized with a big-M sized to the batch
quantity (`M = batch_kg` — tight and safe, since no feasible combination of
materials can exceed the batch total; an arbitrary large M risks numerical
instability in CBC, which this avoids). See
[OPTIMIZATION_CONSTRAINTS.md](OPTIMIZATION_CONSTRAINTS.md#conditional-constraints)
for the three conditional-constraint patterns and their exact linearization.

When no conditional constraint fires, the solved model is pure LP — which is
also when **sensitivity** (shadow prices) is available. A model with any
binary variable is a genuine MIP, and CBC's duals are not meaningful for one;
`sensitivity.available` is `false` with a stated reason in that case, rather
than printing a number that looks precise but isn't.

## Components (spec §3.9)

| Stage | Function |
|---|---|
| Input validation | `_normalize_materials`, `Material.__init__` — every optional numeric field is read via `_opt_num`, which returns `None` (never 0) for an absent/blank value |
| Problem normalization | `Material.cap_kg` — the tightest of stock/max-usage/technical-max/regulatory-max, computed once |
| Constraint builder | `_add_composition_constraints`, `_add_functional_constraints`, `_add_ratio_constraints`, `_add_conditional_constraints` |
| Objective builder | `_build_objective_terms` — per-metric normalization, weighted or lexicographic (see [MULTI_OBJECTIVE_OPTIMIZATION.md](MULTI_OBJECTIVE_OPTIMIZATION.md)) |
| Solver adapter | `pulp.PULP_CBC_CMD` — the only solver wired in; `solverConfigSchema.solver` is a `z.literal("cbc")` today, a real (if currently single-valued) extension point for a future alternative solver behind the same `FormulationProblem`/`AdvancedOptimizationResult` contract |
| Result extraction | `_extract_lines`, `_extract_objective_results`, `_extract_constraint_results` |
| Infeasibility analysis | `_diagnose_infeasibility` — see [INFEASIBILITY_ANALYSIS.md](INFEASIBILITY_ANALYSIS.md) |
| Sensitivity analysis | `_sensitivity_report` |
| Serialization | plain `dict` → `json.dump`, matching `formulation_core.py`'s existing convention |

## Timeout, cancellation, and debug export

- **Timeout**: `solverConfig.timeoutSeconds` is passed to
  `PULP_CBC_CMD(timeLimit=...)`. CBC returns whatever incumbent it found
  within the limit; a genuinely unfinished search reports `"timeout"`.
- **Cancellation**: real, but enforced at the process layer, not inside a
  single CBC call — `formulation_advanced.rs`'s `AdvancedOptimizerState`
  keeps the spawned child process; `cancel_advanced_formulation_optimize`
  kills it. CBC itself is never asked to checkpoint a partial result.
- **LP-file export** (`solverConfig.exportLpFile`): written to the OS temp
  directory for diagnosis, never into a workspace folder, provenance record,
  or export — a formula's raw-material composition and pricing are
  business-sensitive, and an LP file is a plaintext dump of exactly that.

## Deterministic naming

Every PuLP variable and constraint is named from a stable input id
(`x_<material_id>`, `comp_<constraint_id>`, `func_<constraint_id>`,
`ratio_<constraint_id>`, `cond_<constraint_id>_trigger/target`,
`y_<constraint_id>`), with non-alphanumeric characters stripped
(`_safe_name`). Two runs of the same `FormulationProblem` produce the same
variable/constraint names and — CBC being deterministic for a fixed model —
the same optimal solution.

## What this is not

- Not a general-purpose optimization framework. It solves exactly the
  `FormulationProblem` shape; nothing here is reused outside the Advanced
  Optimizer and (via a seeded sub-problem) system material substitution.
- Not a replacement for the simple optimizer, which remains the fast path
  for a plain cost-minimize-to-an-active-target problem.
- Does not itself decide what "optimal" means for cost, quality, or
  regulatory acceptability beyond the constraints and objectives it is
  given — see [MULTI_OBJECTIVE_OPTIMIZATION.md](MULTI_OBJECTIVE_OPTIMIZATION.md)
  for which objective metrics are refused outright because no honest
  computation exists for them.

## Tests

`runtime/formulation/test_advanced_optimizer.py` — 36 tests covering every
constraint type, both objective strategies, four infeasibility causes,
decimal-precision formatting, and property-based invariants (formula total
= 100% within precision, no negative percentages, fixed ingredients
unchanged, excluded ingredients absent, reproducible objective values across
repeated solves of the same problem).
