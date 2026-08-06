# Regulatory product classification

`classifyProductRegulatory` (`packages/shared/src/engine/regulatoryClassification.ts`)
— see [REGULATORY_ENGINE.md](REGULATORY_ENGINE.md) for how this fits into
the wider engine. This document covers the classifier's own logic.

## Why a separate classifier from `classifyProductSafety`

`schemas/safety.ts`'s `ProductSafetyClassification` and
`schemas/regulatory.ts`'s `RegulatoryClassificationResult` answer
different questions — hazard-handling category vs. which regulatory
product category a formula falls into — and are allowed to disagree. A
product can be safety-classified `human_review_required` while its
regulatory category is confidently `laundry_detergent`, or vice versa.

## Inputs

`RegulatoryClassificationInput`: the product family's `domain`/
`subtype`/`name`/`hazardClass`/`intendedUsers`/`intendedUse`, plus
optional `claims`, `activeFunctions`, `concentrationNotes`,
`targetUsers`, `applicationArea`, `packagingType`, and the target
`market` (jurisdiction). `concentrationNotes` is accepted for
completeness (the spec lists "Concentration" as an input) but is not yet
decisive on its own — no seed rule's classification logic currently
branches on a stated concentration value.

## Decision order

1. **Medical/therapeutic escalation** — a `hazardClass: "medical"` family,
   or any claim containing a medical/therapeutic keyword
   ("medical", "therapeutic", "treat", "medicated", "prescription"),
   always classifies as `medical_or_health_related_product` regardless of
   the family's base domain. Confidence 0.75, never `uncertain`.
2. **Domain base mapping** — `DOMAIN_BASE_CATEGORY` maps each of this
   platform's supported product domains to a base regulatory category
   (e.g. `laundry_powder`/`laundry_liquid` → `laundry_detergent`,
   `bleach`/`disinfectant` → `disinfectant`, `oral_care` →
   `oral_care_product`). A domain with no configured mapping returns
   `human_review_required` at confidence 0.2, `uncertain: true` — never a
   guessed category.
3. **Regulated-disinfectant hazard class** — escalates further: a
   biocidal-style claim keyword ("pesticide", "insecticide", "kills
   insects", "repellent") alongside `hazardClass: "regulated_disinfectant"`
   classifies as `biocidal_product` (confidence 0.7, `uncertain: true`);
   otherwise it confirms `disinfectant` (confidence 0.8).
4. **Institutional/commercial-use override** — a claim indicating
   institutional or commercial-only use overrides a household-cleaning or
   dishwashing base category to `institutional_cleaning_product`
   (confidence 0.65, `uncertain: true`) — the same chemistry sold for
   institutional use is a different regulatory category in most EAC
   jurisdictions.
5. **Oral care refinement** — `oral_care_product` narrows to `toothpaste`
   specifically when the family's subtype/name says so (confidence 0.85).
6. **Wet-wipe refinement** — `wet_wipe` narrows to `baby_wipe` when target
   users indicate infants/babies (confidence 0.8).
7. **Fallback** — the domain's base category at confidence 0.7,
   `uncertain: false`.

`reasoning` is always non-empty and can be shown verbatim as "why" — the
classifier never fabricates an explanation, and every branch above
appends at least one line describing the deciding factor.

## Snapshot freezing

Classification logic itself is unchanged by the Phase 2 closure work.
What did change: a `RegulatoryClassificationResult` returned here is now
frozen verbatim into `RegulatoryReview.classificationSnapshot` at the
moment a human records a review, and into
`ApprovalRecord.regulatorySnapshot.perJurisdiction[].classificationSnapshot`
at the moment a version is approved — see
[REGULATORY_REVIEWS.md](REGULATORY_REVIEWS.md) and
[APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md). Neither snapshot is ever
recomputed from a later call to `classifyProductRegulatory`.

## Tests

`regulatoryClassification.test.ts` (13 tests) covers: family-domain base
mapping for every configured domain, the medical-claim escalation (both
via `hazardClass` and via a claim keyword), the regulated-disinfectant
escalation (both toward `biocidal_product` and confirming
`disinfectant`), the institutional-use override, the oral-care and
wet-wipe refinements, and the unmapped-domain fallback to
`human_review_required`.
