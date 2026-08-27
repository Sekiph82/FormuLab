# FormuLab FVL-05 — GPT Audit 000017

## Scope

Independent GPT audit of FVL-05.011 implementation commit:

`7a01c898af08f306be81e4f1227c15b8514b1f81`

Task:

`FVL-05.011 — Dataset hash/fingerprint + reproducible rebuild from source records`

Governing prompt:

`project-control/gpt/prompts/FVL05-GPT-PROMPT-000017.md`

## Verdict

**CONTINUE / REOPEN — CORRECTIVE REQUIRED**

FVL-05.011 is not accepted yet.

FVL-05.012 remains **BLOCKED / NOT AUTHORIZED**.

## What was independently verified as sound

The implementation correctly establishes:

- real SHA-256 through `crypto.subtle.digest("SHA-256", ...)`;
- deterministic canonicalization with ordinal object-key sorting and preserved array order;
- no wall-clock/random/machine-path/process-id participation in digests;
- exact string/Unicode/case preservation;
- explicit digest algorithm and canonicalization identifiers;
- per-row canonical-schema validation before row fingerprinting;
- fixed row-family ordering within one formula-version bundle;
- formula identity contradiction checks against the composition row;
- row-, formula-version-bundle-, and dataset-level digest structures;
- dataset membership sorting by exact `formulaVersionId` using locale-independent ordinal comparison;
- a separate `MANIFEST_SCHEMA_VERSION = "1.0"` architecture with DATASET/FEATURE versions left unchanged;
- package public exports and focused regression coverage;
- no FVL-05.012 partition logic started.

## Blocking finding A — HIGH

### Dataset-level builder accepts unvalidated bundle manifests

`buildFormulaVersionBundleManifest()` correctly re-validates each supplied FVL-05.003-.010 row against its canonical schema before hashing it.

However, `buildDatasetManifest(bundles)` does **not** validate each supplied bundle against `formulaVersionBundleManifestSchema` before trusting it.

Current flow:

1. Reads `bundle.formulaVersionId` directly for duplicate detection and sorting.
2. Reads `bundle.bundle` directly when constructing dataset entries.
3. Computes an authoritative dataset digest over those entries.
4. Only validates the newly constructed `datasetManifest` itself afterward.

This means a runtime caller can supply a malformed/stale/forged object cast as `FormulaVersionBundleManifest` and receive an authoritative dataset-level digest even when that bundle would fail its own canonical schema.

Examples include, but are not limited to:

- stale/wrong `manifestSchemaVersion`;
- malformed row fingerprint metadata;
- wrong digest algorithm/canonicalization identifiers;
- invalid/non-64-hex digest content;
- missing or contradictory bundle identity metadata that the dataset builder never re-checks;
- any bundle payload that violates `formulaVersionBundleManifestSchema` while still carrying readable `formulaVersionId` and `bundle` fields.

This violates Prompt 000017's fail-closed contract:

- invalid authoritative inputs must never receive an authoritative fingerprint;
- rebuild input identity must be validated;
- stale/superseded schema literals must fail closed;
- new manifest/fingerprint schemas must be used as canonical validation boundaries;
- returned canonical structures must be based only on validated authoritative inputs.

It is also inconsistent with the same module's own row-level discipline, where every input row is schema-validated before hashing.

## Required correction

Before duplicate detection, ordering, or digest computation, `buildDatasetManifest()` must validate every supplied bundle with the canonical `formulaVersionBundleManifestSchema`.

Requirements:

1. Use `safeParse`, not a raw parse whose `ZodError` escapes.
2. Wrap failures in `DatasetManifestBuilderError` using `code: "invalid_row"` unless direct architecture evidence justifies a more precise new code.
3. Use the parsed/rebuilt bundle object for all subsequent duplicate detection, sorting, entry construction, and digest computation.
4. Do not trust caller-owned mutable nested structures after validation.
5. Preserve current duplicate-formulaVersionId fail-closed behavior, but perform it over validated bundles.
6. Do not silently repair malformed bundle fields.
7. Do not introduce live source-pool resolution or re-run prior extractors.
8. Do not change hash/canonicalization semantics unless the correction itself proves another defect.

## Mandatory adversarial tests for the correction

Add tests proving at minimum:

- malformed `manifestSchemaVersion` bundle is rejected before dataset hashing;
- malformed `bundle.digest` is rejected;
- wrong digest algorithm/canonicalization identifier is rejected;
- malformed row-fingerprint metadata inside a bundle is rejected even though dataset-level code only needs `bundle.bundle`;
- no authoritative dataset digest is returned for any invalid bundle;
- thrown error is `DatasetManifestBuilderError` with the expected structured code/context;
- bundle input is not mutated on success or failure;
- parsed output does not alias caller-owned mutable bundle structures;
- duplicate `formulaVersionId` detection still works after validation;
- bundle permutation invariance remains unchanged for valid bundles;
- valid JSON-round-tripped bundle manifests still build the exact same dataset digest.

## Re-audit requirement

After fixing Finding A, independently re-audit the full FVL-05.011 path again, especially:

- canonicalization edge cases;
- schema validation boundaries at all three levels;
- row-to-bundle and bundle-to-dataset trust boundaries;
- version-literal handling;
- duplicate identity behavior;
- non-mutation / non-aliasing;
- deterministic ordering;
- no target/feature/dataset scope regression.

Do not stop at making the new tests green.

## Status

- FVL-05.011: **CORRECTIVE / REOPENED**
- FVL-05.012: **BLOCKED / NOT AUTHORIZED**

Only after a new independent GPT audit returns `CLOSE / ACCEPT` may FVL-05.012 begin.
