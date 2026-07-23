# Test-definition applicability

`packages/shared/src/engine/testApplicability.ts`,
`schemas/testDefinitions.ts`'s applicability fields on `TestDefinition`.

## What this closes

[TEST_DEFINITIONS.md](TEST_DEFINITIONS.md) previously disclosed that
applicability fields were stored but not enforced — the Trials/Stability
panels showed every active definition regardless of product family. This
module is what actually reads them.

## Applicability fields (all "empty means unrestricted")

```ts
applicableProductFamilies: string[];   // pre-existing
applicableProductSkus: string[];       // pre-existing
applicablePackagingSkuCodes?: string[];   // new, additive
applicableContexts?: ("trial" | "stability")[];   // new, additive
applicableConditionCodes?: string[];      // new, additive — stability only
applicableTimePointCodes?: string[];      // new, additive — stability only
requiredByDefault?: boolean;              // new, additive
testCapability?: TestCapability;          // new, additive
```

The four new array fields and `testCapability` are `.optional()` rather
than `.default()` — a `TestDefinition` literal written before this phase
(with none of these keys) still satisfies the type and is treated as
unrestricted on every dimension it omits.

### `testCapability`

```
packaging_compatibility | seal_integrity | leak_test | general
```

A stable category a caller keys off of — never a display-name text match.
Most tests (pH, viscosity, an odor panel) are `general`. The three
packaging capabilities are what
[APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md#packaging-compatibility-for-real)'s
`derivePackagingCompatibilityReadiness` looks for.

## `isTestDefinitionApplicable`

```ts
isTestDefinitionApplicable(definition, {
  productFamilyId, context,           // required
  packagingSkuCodes?, conditionCodes?, timePointCodes?,
}): boolean
```

Checks, in order: `active`; `applicableContexts` includes the requested
context; `applicableProductFamilies` (if non-empty) includes the family;
`applicablePackagingSkuCodes` (if non-empty) intersects the given SKU
codes; for a `"stability"` context only, the same intersection check for
`applicableConditionCodes`/`applicableTimePointCodes`.

## Resolution and the immutable snapshot

`resolveApplicableTestDefinitions(definitions, ctx)` returns every
applicable definition, each labelled `required` (from `requiredByDefault`)
and a human-readable `reason`.

`buildTestRequirementSnapshot(definitions, ctx, manualAdditions)` is what a
trial/study actually stores, once, at creation:

```ts
interface TestRequirementSnapshot {
  capturedAt: string;
  entries: {
    testDefinitionId, testDefinitionCode, name,
    testCapability, criticalTestFlag, required,
    reason: string;              // always populated
    addedManuallyBy?: string;    // set only for a human addition
  }[];
}
```

`manualAdditions` — `{ definition, addedBy }[]` — is how "allow authorized
human additions" (spec §5) is represented: a test outside applicability
resolution that a named chemist chose to add anyway. A definition that is
both applicable and manually added is recorded once, from the applicable
side (`addedManuallyBy` stays unset for it) — the point is de-duplication,
not double-crediting who added what.

**This snapshot, once captured, is what "required" means for that
trial/study from then on.** A later edit to the underlying `TestDefinition`
— its applicability, its critical flag, even its deletion — cannot
retroactively change it; `deriveLabReadiness` reads a trial's own
`testRequirementSnapshot` when one exists and only falls back to a live
resolution for a trial/study created before this phase existed.

## Wired into creation (spec §5's "when creating a trial or stability
study")

- `TrialsPanel.tsx`'s `createTrial` builds the snapshot from the loaded
  `test_definitions` collection, the formulation's product family, and its
  `targetSkuCodes`, and shows it (with each entry's reason) in the trial's
  Overview tab.
- `StabilityPanel.tsx`'s `createStudy` builds it from the same inputs plus
  the study's own selected condition/time-point codes (resolved from the
  `id`s the multi-selects use back to their `code`s via
  `SEED_STABILITY_CONDITIONS`/`SEED_STABILITY_TIME_POINTS`), with any of
  the chemist's manually-checked `requiredTestDefinitionIds` that
  applicability alone would not have selected recorded as manual additions.

## Manual inclusion (spec §3.3)

`buildTestRequirementSnapshot`'s `manualAdditions` parameter accepts an
optional `reason` and `at` alongside the required `addedBy`. When a
reason is supplied, the entry's `reason` string records who added it, when,
and why (`"Added manually by <reviewer> on <timestamp>: <reason>"`) rather
than the generic default text — this is how the reviewer identity, reason,
and timestamp the spec requires end up in the immutable snapshot, without
adding new schema fields beyond the existing `addedManuallyBy` and the
already-required per-entry `reason`.

`StabilityPanel.tsx` requires both a reviewer and a reason before it will
create a study that manually includes an otherwise-excluded test: as soon
as any selected test would fail `isTestDefinitionApplicable`, reviewer and
reason inputs appear next to the tests picker, and creation is blocked
with an error until both are filled in. `TrialsPanel.tsx`'s trial creation
does not currently expose a symmetric manual-inclusion UI — see "Known
limitations" below.

Once captured, the snapshot is immutable: a later edit to any referenced
`TestDefinition` cannot alter what a trial/study's protocol already
required, and an excluded test can never satisfy a requirement unless it
was explicitly present in the snapshot at creation. See
[STABILITY_STUDIES.md](STABILITY_STUDIES.md#test-applicability-at-study-creation)
for the existing-study comparison-only drift view built on top of this.

## Tests

`testApplicability.test.ts` (22 tests): family-applicable test selected;
wrong-family test excluded; unrestricted-family test applies everywhere;
packaging-applicable test selected; wrong-packaging test excluded;
wrong-context test excluded; inactive test excluded regardless of
applicability; condition/time-point applicability for stability; a
definition predating these fields (all undefined) is treated as
unrestricted; `resolveApplicableTestDefinitions` filters and labels
correctly; `buildTestRequirementSnapshot` is immutable against a later
definition mutation, includes a manual addition, and does not duplicate a
test that is both applicable and manually added; a manual stability
inclusion records the reviewer's reason and timestamp; an excluded
stability test cannot satisfy the requirement unless manually included.

## Exclusion explorer

`evaluateApplicability(definitions, ctx)` returns both sides —
`included` (same as `resolveApplicableTestDefinitions`) and `excluded`,
each excluded definition paired with every deterministic reason it failed
(`explainExclusion`, plural — more than one dimension can disqualify a
test at once):

```
inactive_definition | wrong_product_family | wrong_packaging_sku |
wrong_context | wrong_storage_condition | wrong_time_point
```

`manually_excluded`/`superseded_definition` are not among them — this
codebase does not model an explicit human "exclude this test" action or a
definition-supersession link, so neither reason is ever computable; only
what the fields above actually encode is reported.

The desktop "Test applicability" explorer
(`apps/desktop/src/components/formula/ExclusionExplorer.tsx`) shows
Included/Excluded tabs, each excluded definition tagged with its reason
chips, search, and a reason filter. It is now wired into both entry
points: the Trials panel's Tests tab (`context: "trial"`) and the
Stability panel's study-creation form (`context: "stability"`, spec §3) —
the same component and the same `evaluateApplicability` call in both
places, not a second parallel explorer. An excluded definition never
appears in `included`, so nothing downstream (readiness derivation, the
requirement snapshot) can select it by accident — exclusion is enforced
by absence, not a flag to check.

## Known limitations

- `requiredByDefault` is a single global flag on the definition, not
  configurable per product family — a test cannot be "required for family
  A, optional for family B" without two separate definitions.
- `TrialsPanel.tsx`'s trial creation does not have a manual-inclusion
  reviewer/reason UI symmetric to `StabilityPanel.tsx`'s — a trial's
  `manualAdditions` (if any are ever wired up) would need the same
  reviewer/reason capture added there.
