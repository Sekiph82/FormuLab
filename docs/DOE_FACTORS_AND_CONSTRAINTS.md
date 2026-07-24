# DOE factors and constraints (Phase 5)

`packages/shared/src/schemas/doe.ts` (`doeFactorSchema`/`doeConstraintSchema`),
`packages/shared/src/engine/doeDesign.ts` (`validateDoeFactors`/
`validateDoeConstraints`), `packages/shared/src/engine/doeExpression.ts`
(the safe constraint-expression parser).

## The factor record

```ts
DoeFactor {
  id, schemaVersion: "1.0", studyId, studyRevision,
  factorCode, name,
  factorType,          // continuous | integer | categorical | ordinal | mixture_component | process_parameter
  sourceType,          // formula_material | formula_total | process_parameter | temperature |
                        // mixing_speed | mixing_time | addition_order | pH_target | packaging | custom
  sourceEntityId?,     // material id, or a named process-parameter key; required unless sourceType is "custom"
  unit?,
  lowValue?, centerValue?, highValue?,   // decimalString — required for non-categorical factors
  categoricalLevels,   // required, >= 2 entries, for categorical/ordinal factors
  transformation,       // none | log | square_root | inverse | standardized | custom
  precision,            // decimal places a generated run's actual value is rounded to
  isMixtureComponent, isProcessFactor, isControlled,
  createdAt,
}
```

`validateDoeFactors` refuses (before generation ever runs): fewer than one
factor, duplicate factor codes, a continuous factor with `lowValue >=
highValue`, a categorical/ordinal factor with fewer than 2 levels, a factor
with no `sourceEntityId` and a `sourceType` other than `custom` (a factor
must say exactly what it changes — never "whatever's in the formula"), and
a mixture design with exactly one `isMixtureComponent` factor (mixtures
need at least two components to mean anything).

## Coded vs. actual values

Every continuous/integer/mixture/process factor is generated in coded
units first — `-1`/`0`/`+1` for a standard 2-level point, or a magnitude
beyond 1 for a central-composite axial point — then mapped to its real
engineering-unit `actualValue` by linear interpolation between `lowValue`/
`centerValue`/`highValue` (`continuousActualFromCoded`). A categorical or
ordinal factor's coded value *is* its level string — there is no numeric
coding for a level with no natural order or scale.

## Constraints and the safe expression parser

```ts
DoeConstraint {
  id, schemaVersion: "1.0", studyId, studyRevision,
  constraintType,   // 15 values: lower_bound/upper_bound/sum_equals/sum_min/sum_max/
                     // ratio_min/ratio_max/material_required/material_forbidden/
                     // conditional/process_limit/compatibility/safety/cost/custom
  expression,        // e.g. "SLES + Salt <= 25"
  description?,
  severity,          // hard | soft | warning
  appliesTo,         // informational factor-code list
  createdBy, createdAt,
}
```

`evaluateDoeExpression`/`validateDoeExpressionSyntax` (`engine/doeExpression.ts`)
are a from-scratch, hand-rolled recursive-descent tokenizer/parser/
evaluator: numeric literals, factor-code identifiers, `+ - * /`,
parentheses, unary minus, and at most one top-level comparison operator
(`<= >= < > == !=`). There is **no `eval`, no `new Function`, no subprocess,
no access to any host object, and no way to call anything** — a malformed
or hostile expression can only ever fail to parse or evaluate, it can never
execute. `doeExpression.test.ts` includes an explicit test feeding
`require('fs')`, `process.exit()`, `eval('1')`, and similar strings through
the evaluator and asserting every one returns `ok: false`, never runs.

`validateDoeConstraints` parses (without evaluating) every constraint
against the study's known factor codes at creation time, so a typo in a
factor name is caught immediately rather than at design-generation time.

## Hard vs. soft vs. warning

Only `severity: "hard"` constraints can block design generation —
`generateDoeDesign` refuses to persist a design if any generated run
violates a hard constraint (`validateGeneratedDesign`). Soft and warning
constraints are surfaced in the design's diagnostics
(`DoeDesignDiagnostics.warnings`, `constraintViolationCount`) but never
block generation — the human reviewing the design decides whether a soft
violation is acceptable.

## Status

Implemented, tested (`doeExpression.test.ts` 12 tests, `doeDesign.test.ts`'s
factor/constraint validation tests), live-editable in the study-creation
wizard's Factors and Constraints steps.
