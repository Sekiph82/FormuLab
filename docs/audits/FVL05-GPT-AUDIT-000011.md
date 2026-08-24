# FormuLab FVL-05 — GPT Audit 000011

## Scope
Independent re-audit of FVL-05.008 after implementation commit `b1c52ba692bb91d171c1640e5471c41294826561` on branch `feature/laboratory-stability`.

## Verdict
**CONTINUE / REOPEN FVL-05.008**

FVL-05.009 MUST NOT START.

## Blocking finding
### HIGH — ambiguous CorrectiveAction.sourceRecordId across trial/study namespaces silently resolves to trial

Current `buildActionResolutions()` resolves `CorrectiveAction.sourceRecordId` by checking `laboratoryTrials` first and immediately accepting that match, then checking `stabilityStudies` only if no trial match exists.

Both `LaboratoryTrial.id` and `StabilityStudy.id` are opaque global identifiers in separate top-level collections. The FVL-05 lineage/extractor contract does not establish a shared cross-collection uniqueness guarantee between these two entity types. Therefore a supplied dataset can legitimately contain a trial and a stability study with the same exact string id.

If an action's `sourceRecordId` equals that shared string, the current extractor silently chooses the trial branch. That is not an exact, unambiguous resolution. It is order-of-lookup precedence and violates the established fail-closed rule for ambiguous source identity.

The current source shape is effectively:

```ts
const trial = trialsById.get(action.sourceRecordId);
if (trial) {
  resolutions.set(action.id, { kind: "trial", record: trial });
  continue;
}
const study = studiesById.get(action.sourceRecordId);
if (study) {
  resolutions.set(action.id, { kind: "study", record: study });
  continue;
}
```

This must fail closed when BOTH lookups resolve.

## Required correction
1. Before accepting either branch, resolve both candidate namespaces for each corrective action.
2. If neither resolves, keep the existing `corrective_action_source_record_not_found` behavior.
3. If exactly one resolves, preserve current behavior.
4. If BOTH resolve, throw a dedicated structured ambiguity error, e.g. `corrective_action_source_record_ambiguous`, with truthful action/source id context.
5. Do not use `sourceType` to paper over the ambiguity unless current writer/domain source proves it is authoritative for selecting the target entity. The original FVL-05.008 source recovery explicitly concluded that `sourceRecordId` resolution is unconditional on `sourceType`, so preserve that recovered rule unless new direct source evidence disproves it.
6. Add adversarial tests covering:
   - same id exists in both trial and study pools and action points to it -> fail closed;
   - same collision exists elsewhere in supplied pools but action points to a unique id -> behavior remains correct;
   - non-mutation on the new failure path;
   - deterministic result independent of supplied pool order.
7. Re-run the complete FVL-05.008 focused/full validation and native build/shortcut gate from final pushed HEAD.
8. This is validation/relationship logic only. Do NOT bump `DATASET_SCHEMA_VERSION` unless emitted row shape changes.

## Independently sound portions
No blocker was found in this audit for the following portions and they should not be rewritten without direct evidence:
- direct `CostSnapshot.formulationId` + `versionId` linkage and code-based identity handling;
- frozen `StabilityStudy.packagingSnapshot` extraction;
- exclusion of current mutable packaging catalogs/reference data;
- dataset version bump to 1.6 for the original new row shape;
- row schema validation, deterministic ordering, lineage deduplication, and no-aliasing structure already present;
- FVL-05.009 remaining untouched.

## Closure rule
FVL-05.008 may be closed only after the cross-namespace sourceRecordId ambiguity is fixed, adversarially tested, all required validation passes, the corrective commit is pushed, and the final native build/shortcut gate passes.
