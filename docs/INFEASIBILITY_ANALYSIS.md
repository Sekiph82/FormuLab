# Infeasibility analysis

`runtime/formulation/advanced_optimizer.py`'s `_diagnose_infeasibility`.

## What this is

When a solve does not return `"optimal"`/`"feasible"`, the result carries an
`infeasibility.causes` array instead of an empty formula and a bare status
code. Each `InfeasibilityCause` is produced by a **deterministic,
independent pre-check** run against the problem's materials and constraints
— not derived from CBC's own infeasibility certificate (CBC does not expose
an interpretable one for a MIP the way an LP relaxation's Farkas certificate
would, and even that would need translating back into formulation language
a chemist can act on).

## The checks

| Code | Detects | Suggested actions |
|---|---|---|
| `insufficient_stock_or_usage_cap` | `sum(cap_kg)` over every candidate is below `batch_kg` | increase stock, relax a usage/technical/regulatory maximum, add a candidate |
| `fixed_ingredients_exceed_batch` | `exact_percentage`/`fixed_ingredient` constraints alone sum above 100% | reduce a fixed percentage |
| `functional_minimum_unreachable` | a `min_total` functional constraint's member materials, even at full caps, cannot reach the required total (or has zero members) | add a candidate in that function group, relax the minimum, raise a cap |
| `required_coingredient_unavailable` | an `if_present_then_required` conditional constraint's target side matches no candidate material | add a matching candidate, or remove/relax the constraint |

When none of these four fire but the solve is still infeasible, one generic
`no_combination_satisfies_all_constraints` cause is returned rather than
nothing — an honest "the pre-checks did not isolate it" rather than a false
claim of having found the specific conflict. Ratio-constraint conflicts and
regulatory-maximum-vs-performance-minimum conflicts (both named in the
platform specification) do **not** have a dedicated check yet — an
infeasible ratio constraint currently falls through to the generic cause;
see "Known gaps" below.

## Suggested actions are deterministic where possible

Every cause's `suggestedActions` is a fixed list of plain-language next
steps tied to that cause's own code — not an LLM-generated suggestion, and
not personalized to the specific numbers beyond what the cause's `message`
already states (which does interpolate the actual calculated/requested
limits). Two solves of the same infeasible problem produce byte-identical
`suggestedActions`.

## Multiple causes

All four checks run independently and every one that fires is included —
`_diagnose_infeasibility` does not stop at the first match. A problem that
is infeasible for two independent reasons (say, insufficient stock **and**
an unreachable functional minimum) reports both, so a chemist does not fix
one and re-run only to hit the second.

## Known gaps

Named in the platform specification but not implemented as a dedicated
check:

- **Ratio constraints conflicting** with each other or with composition
  constraints — falls through to the generic cause.
- **Regulatory maximum conflicting with a performance minimum** — there is
  no performance-minimum constraint type in this platform yet (see
  [MULTI_OBJECTIVE_OPTIMIZATION.md](MULTI_OBJECTIVE_OPTIMIZATION.md)'s note
  on `performance_score`), so this specific conflict cannot occur as
  described; a regulatory-maximum-vs-functional-minimum conflict (a real,
  reachable case) is partially covered by `functional_minimum_unreachable`,
  since `Material.cap_kg` already folds the regulatory maximum into the
  per-material cap that check reads.
- **Cost ceiling unreachable** — there is no hard cost-ceiling constraint
  type in this platform (cost is an *objective*, not a constraint); not
  applicable until one exists.

## What this is not

- Not a full Irreducible Infeasible Subsystem (IIS) analysis. An IIS would
  name the minimal set of constraints that together cause infeasibility;
  these checks name plausible, common, cheaply-detectable causes instead.
- Not exhaustive — the generic fallback cause exists specifically so this
  module never claims a diagnosis it did not actually make.
