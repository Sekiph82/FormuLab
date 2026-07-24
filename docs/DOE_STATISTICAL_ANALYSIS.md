# DOE statistical analysis (Phase 5)

`packages/shared/src/schemas/doe.ts` (`doeAnalysisSchema`),
`packages/shared/src/engine/doeMath.ts` (matrix/OLS primitives),
`packages/shared/src/engine/doeAnalysis.ts` (model fitting, ANOVA, fit
metrics, residual diagnostics, distributions, `createDoeAnalysis`).

## AI may explain, never compute

Every coefficient, ANOVA row, fit metric, and residual diagnostic stored in
a `DoeAnalysis` comes from fitting a real linear model to the study's own
recorded observations via ordinary least squares. **Nothing in this
pipeline is AI-sourced.** An AI assistant may narrate or summarize a
finished analysis's results, but it is never the source of the numbers
themselves — spec §7.

## Matrix math and OLS

`doeMath.ts` implements normal-equations OLS (`beta = (X'X)^-1 X'y`) via a
hand-rolled Gauss-Jordan elimination with partial pivoting — adequate for
DOE's realistically small (typically <=32-run, <=12-term) design matrices,
and small enough to test exhaustively against hand-computed and
closed-form examples (`doeMath.test.ts`, 20 tests). `invert()` returns
`null` — never a fabricated inverse — for a singular or numerically
indistinguishable-from-singular matrix; `fitOrdinaryLeastSquares` turns
that into an explicit `OlsFailure` with a human-readable reason, and
separately refuses when there are insufficient runs to estimate the
requested model (`n <= p`).

## Model types

`deriveModelTerms(factors, modelType)` builds the exact term list for one
of 5 model shapes:

| Model type | Terms |
|---|---|
| `main` | intercept + one term per numeric factor + k-1 dummy indicators per categorical/ordinal factor |
| `factorial` | `main` + every two-way interaction among numeric factors |
| `quadratic` | `factorial` + a squared term per numeric factor (response-surface model) |
| `mixture_linear` | no intercept — one term per mixture-component factor only (Scheffé linear) |
| `mixture_quadratic` | `mixture_linear` + every two-way mixture-component interaction |

`evaluateModelTerms` is the single place that knows how to read a term
name (`"intercept"`, a plain factor code, `"code:level"` for a categorical
dummy, `"a*b"` for an interaction, `"code^2"` for a quadratic term) back
into a number — the same function backs `buildDesignMatrix` (fitting) and
`predictDoeResponse` (predicting a new point), so a prediction always uses
precisely the terms the fit was estimated with.

## ANOVA, fit metrics, residual diagnostics

`calculateAnova` computes Model/Residual/Total sum-of-squares rows, plus
Lack-of-Fit/Pure-Error rows *only* when replicated runs leave a genuine
lack-of-fit degree of freedom (not just any replication — see the
worked example in `doeAnalysis.test.ts`). `calculateFitMetrics` computes
R², adjusted R², RMSE, MAE, and residual degrees of freedom. F-test and
t-test p-values use a standard Numerical-Recipes-style Lanczos log-gamma +
regularized-incomplete-beta implementation, verified against known
reference critical values (F(1,10)@0.05≈4.965, t(10)@0.05≈2.228).
Coefficient standard errors/t-statistics/p-values/95% confidence intervals
come from `(X'X)^-1`, the fit's MSE, and — for the CI — a bisection-based
inverse of the two-sided t-CDF.

`calculateResidualDiagnostics` computes leverage (`diag(X(X'X)^-1X')`),
Cook's distance, and standardized residuals per included run.
`suggestOutliers` flags a run whose `|standardizedResidual| > 2.5` or
`cooksDistance > 1` — standard influence thresholds — but **never excludes
it**; a human reviews and confirms/dismisses the suggestion.

## Missing and excluded observations

`createDoeAnalysis` drops a run from the fit — and lists it explicitly in
`excludedRunIds` with a warning — whenever its observation is missing,
excluded, invalid, or has no numeric value. An outlier-flagged observation
is *kept* in the fit (with a warning), since a flag is a suggestion, not a
verdict. **A missing observation is never treated as zero** — this is
checked directly in `createDoeAnalysis`'s exclusion logic, and matters
most for a stability response whose future time point simply hasn't
happened yet (spec §11).

## What is not modeled

Response types other than `continuous`/`integer` are refused outright
(spec §7/§20: "categorical response must not be forced into OLS") —
[DOE_RESPONSES.md](DOE_RESPONSES.md) has the full list. A response-surface
model with 3+ categorical dummy interactions, non-linear (non-polynomial)
response functions, and generalized linear models (logistic, Poisson,
etc.) are all out of scope for this phase — a `binary`/`pass_fail`
response can still be recorded and reviewed, just not regressed.

## Status

Implemented, tested (`doeMath.test.ts` 20 tests, `doeAnalysis.test.ts` 29
tests covering known-coefficient recovery for linear/interaction/
quadratic/mixture models, singular-model and insufficient-DoF honest
failures, ANOVA/lack-of-fit, outlier suggestion without exclusion, missing/
excluded-observation handling, categorical-response refusal), live-usable
through the workspace's Analysis tab with real charts (Pareto effects,
predicted-vs-observed, residual-vs-predicted, normal-probability,
2-factor response-surface heatmap).
