# DOE responses (Phase 5)

`packages/shared/src/schemas/doe.ts` (`doeResponseSchema`),
`packages/shared/src/engine/doeDesign.ts` (`validateDoeResponses`).

## The response record

```ts
DoeResponse {
  id, schemaVersion: "1.0", studyId, studyRevision,
  responseCode, name,
  responseType,     // continuous | integer | binary | ordinal | categorical | pass_fail
  unit?,
  objective,        // maximize | minimize | target | within_range | observe_only
  targetValue?, lowerLimit?, upperLimit?,
  weight,           // relative weight in overall (multi-response) desirability, > 0
  desirabilityShape, // linear | concave | convex
  sourceTestDefinitionId?, sourceResultField?,   // links a Laboratory TestDefinition result
  createdAt,
}
```

`validateDoeResponses` refuses: zero responses, a duplicate response code,
`objective: "target"` with no `targetValue`, and `objective: "within_range"`
with a missing lower or upper limit — each objective's own required fields
are checked, never assumed.

## Which responses get regressed

`DOE_CONTINUOUS_ANALYSIS_RESPONSE_TYPES` = `["continuous", "integer"]` —
these are the *only* response types [DOE_STATISTICAL_ANALYSIS.md](DOE_STATISTICAL_ANALYSIS.md)'s
OLS engine will fit a model to. `binary`/`ordinal`/`categorical`/
`pass_fail` responses are refused by `createDoeAnalysis` with an explicit
error rather than forced through a linear-regression model that doesn't
fit their shape — spec §7/§20: "categorical response must not be forced
into OLS." A categorical/pass-fail response can still be recorded as a
`DoeObservation` and reviewed manually; it is simply not a candidate for
the regression/desirability pipeline in this phase.

## Objective shapes feed desirability directly

Each objective maps to a specific piecewise desirability transform in
[DOE_CANDIDATES.md](DOE_CANDIDATES.md)'s `calculateResponseDesirability` —
`maximize`/`minimize` ramp between `lowerLimit`/`upperLimit`, `target`
forms a triangle around `targetValue`, `within_range` is a hard 0/1 gate,
and `observe_only` is always fully desirable (it never drives the search,
it is just tracked). `desirabilityShape` (`linear`/`concave`/`convex`) bends
that ramp — a concave shape reaches high desirability faster near the
boundary, convex reaches it slower.

## Status

Implemented, tested (`doeDesign.test.ts`'s response-validation tests,
`doeCandidates.test.ts`'s desirability-transform tests for every objective
and shape), live-editable in the study-creation wizard's Responses step and
viewable in the workspace's Responses tab.
