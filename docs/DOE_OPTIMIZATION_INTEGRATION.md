# DOE and Optimization: staying two separate engines (Phase 5)

`packages/shared/src/engine/doeCandidates.ts` (DOE's own candidate search),
`packages/shared/src/engine/optimization.ts` (the existing deterministic
LP-based optimizer, unmodified by this phase),
`apps/desktop/src/components/formula/DoePanel.tsx` (the cross-navigation
links).

## Two engines, never merged

DOE's candidate search
([DOE_CANDIDATES.md](DOE_CANDIDATES.md)) and the existing Optimization
workspace's LP-based optimizer are **deliberately kept separate**:

| | DOE candidates | Optimization |
|---|---|---|
| Model source | A `DoeAnalysis` fitted to this study's own recorded observations | A cost/property model over the material library |
| Search method | Seeded random search over a *design's* coded factor space | Deterministic linear-programming solve |
| Output | A ranked, desirability-scored point in the design space | A feasible, cost/constraint-optimal formula |
| Lineage on every result | `analysisId` on every predicted response | Its own `OptimizationRun`/scenario record |

Neither engine's prediction is ever presented as if it came from the
other. A `DoePredictedResponse` always names its own `analysisId`; an
Optimization result is always its own, separately-lineaged record. This is
enforced by construction — the two engines share no prediction data
structure — not by a label a UI could get wrong.

## Cross-navigation, not data merging

The Candidates tab's "Open Optimization" / "Open Stability" buttons
navigate to `/optimization?project=<id>` / `/stability?project=<id>`,
preserving the current project's context the same way every other
cross-workspace link in this app does
([NAVIGATION_AND_CONTEXT.md](NAVIGATION_AND_CONTEXT.md)). This is
**navigation-context preservation only** — it does not open the specific
candidate pre-loaded inside the Optimization workspace, compare a DOE
candidate against an optimizer result side-by-side, or let a candidate be
"applied" through the Optimization workspace's own apply-to-draft path.

## What is deferred

Deeper integration — displaying a specific DOE candidate's lineage inside
the Optimization workspace, a side-by-side DOE-vs-optimizer candidate
comparison view, applying either engine's result through a single shared
UI — is not implemented in this phase. Both engines' underlying data
(`DoeCandidate.analysisIds`, `DoePredictedResponse.analysisId`,
`OptimizationRun`'s own scenario id) already carries the lineage such a
view would need; building it is future work.

## Status

Implemented: engine separation (by construction, no shared prediction
type), lineage-on-every-result, and lightweight cross-navigation.
Not implemented: cross-engine comparison UI, opening a specific candidate
inside Optimization.
