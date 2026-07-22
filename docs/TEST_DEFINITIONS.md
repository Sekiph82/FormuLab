# Test definitions

`packages/shared/src/schemas/testDefinitions.ts`,
`packages/shared/src/catalog/testDefinitions.ts` (`SEED_TEST_DEFINITIONS`),
`apps/desktop/src/components/formula/TestDefinitionsPanel.tsx`. Shared by
[Laboratory Trials](LABORATORY_TRIALS.md) and
[Stability Studies](STABILITY_STUDIES.md) — a pH or viscosity measurement
means the same thing whether it was taken on trial day one or a stability
pull at three months.

## What this is — and is not

A `TestDefinition` is an editable, reusable **structural template**: code,
name, category, an optional free-text `methodReference` ("in-house
SOP-014", "ISO 4316" — never invented), result type, unit, target/min/max,
pass/fail logic, replicates required, an optional time-point/storage-
condition binding, required equipment, whether an attachment is required,
which product families/SKUs it applies to, a critical-test flag, and
`verificationStatus`.

**It is not a claim of a recognized, validated method.** Every seeded
definition ships `verificationStatus: "not_verified"` — the seed catalog
exists so the app has *something* to test against on first run, not because
these 27 structural templates are presented as industry-standard methods a
regulator would accept. A chemist attaches the real method/limit their own
lab actually uses and marks it `verified` themselves; `imported_unverified`
and `human_review_required` exist for a bulk-imported batch that needs
review as a group.

## Result types and pass/fail logic

`resultType`: `numeric` / `text` / `boolean` / `pass_fail` / `categorical` /
`visual_rating`.

`passFailLogic.rule`: `within_range` / `at_least` / `at_most` / `equals` /
`in_set` / `manual_judgment`. `in_set`/`equals` use `allowedValues`.
`manual_judgment` always requires a human to set `passFail` on the result
directly — it is never inferred from a number.

## Seed catalog (27 templates)

`SEED_TEST_DEFINITIONS` covers, all `not_verified`: pH, viscosity, density,
appearance, color, odor, homogeneity, foam height, foam retention, wetting,
cleaning performance, soil removal, centrifuge stability, freeze-thaw
stability, available chlorine, peroxide active, QAC active, chlorhexidine
active, fluoride active, microbiology (total viable count), preservative
efficacy (challenge test), packaging compatibility, wipe lotion loading,
wipe moisture distribution, seal integrity, leak test, and flushability.

`listRecordsSeeded("test_definitions", SEED_TEST_DEFINITIONS)`
(`apps/desktop/src/lib/masterdata.ts`) seeds this catalog **only the first
time the collection is ever empty** — once a chemist edits a definition
(method reference, limits, verification status), re-seeding never
overwrites that edit.

## Editing

`TestDefinitionsPanel.tsx` lists every definition with an inline editor:
name, result type, unit, min/max, pass/fail rule, critical flag,
verification status, active flag. Changes save on demand (dirty-state
detected via a JSON diff against the loaded record), not on every
keystroke.

## Known limitations

- Applicability (`applicableProductFamilies`/`applicableProductSkus`) is
  stored on the definition but not yet enforced anywhere — the Trials/
  Stability panels currently show every active numeric definition
  regardless of the selected trial's/study's product family.
- No versioning of a definition's own history — editing a definition's
  limits changes it going forward; past results keep whatever pass/fail
  verdict was computed at the time (see
  [TEST_RESULTS.md](TEST_RESULTS.md#revision-history)), but the definition
  itself has no "as of" snapshot.
