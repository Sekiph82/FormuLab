# Kenya/EAC Regulatory Engine

Phase 2 of the Kenya R&D platform roadmap. Deterministic, versioned
regulatory rules for Kenya and six other East African Community
jurisdictions — never a model's guess dressed up as a compliance
decision, and never presented as verified legislation until a qualified
regulatory reviewer has actually confirmed it.

This document describes the **closed** Phase 2 state — every gap the
original Phase 2 pass left open (jurisdiction-only reviews, no persisted
confirmations, no rule source verification, JSON-only import, a single
primary-market approval gate) has been closed. See "Known limitations"
below for what genuinely remains, and
[IMPLEMENTATION_STATUS.md](architecture/IMPLEMENTATION_STATUS.md) for the
Implemented/Verified-by-tests/Requires-regulatory-content/
Deferred-to-Phase-3 breakdown.

## Seven jurisdictions

`REGULATORY_JURISDICTIONS` (`packages/shared/src/schemas/regulatory.ts`):
Kenya (`KE`), Uganda (`UG`), Tanzania (`TZ`), Rwanda (`RW`), Burundi
(`BI`), South Sudan (`SS`), plus `EAC` — a regional-bloc profile, not a
country. A rule scoped to `EAC` overlays a member state's own rules
rather than replacing them: `evaluateRegulatory` applies both a
jurisdiction's own rules and any active `EAC` rule to a formula being
evaluated for that jurisdiction (`EAC_MEMBER_STATES`). See
[EAC_MARKET_PROFILES.md](EAC_MARKET_PROFILES.md).

## Product classification

`classifyProductRegulatory` (`engine/regulatoryClassification.ts`) —
deterministic, rule-based, from the product family's own domain plus
claims and target users. Never a model call. Returns a category, a
confidence score, non-empty `reasoning`, and an `uncertain` flag for
anything that could not be confidently narrowed. See
[REGULATORY_CLASSIFICATION.md](REGULATORY_CLASSIFICATION.md). This
result is frozen into a `RegulatoryReview.classificationSnapshot` the
moment a human records a review, and into `ApprovalRecord.regulatorySnapshot`
the moment a version is approved — a later re-classification never
rewrites either historical record.

## Versioned rule model

`RegulatoryRule` is the mutable "current state" row; every edit appends
a `RegulatoryRuleRevision` rather than rewriting history — the exact
`ApprovalPolicy`/`ApprovalPolicyRevision` split this codebase already
uses. `engine/regulatoryRules.ts`'s `initialRuleRevision`/`editRule`/
`setRuleActive`/`deprecateRule` are all human-gated (throw for a
non-human actor) and require a change reason for an edit or a
deprecation. See [REGULATORY_RULES.md](REGULATORY_RULES.md).

A rule now also carries a **source/verification workflow**
(`sourceTitle`/`sourceAuthority`/`sourceReference`/
`sourcePublicationDate`/`sourceEffectiveDate`/`sourceExpiryDate`/
`sourceJurisdiction`/`sourceDocuments`, `verificationStatus`) —
`verifyRule`/`rejectRuleVerification`/`supersedeRule`
(`engine/regulatoryRules.ts`), gated to an authorized human
regulatory/quality/administrator role. See
[REGULATORY_RULE_VERIFICATION.md](REGULATORY_RULE_VERIFICATION.md).

## Rule evaluation

`evaluateRegulatory(lines, rules, ctx)` walks every rule applicable to a
jurisdiction + product category (plus any active `EAC` overlay,
effective-date/expiry windowing) and returns a `RegulatoryFinding` per
match. Fifteen rule types split into three evaluation shapes:

- **Ingredient-based** (`ingredient_restriction`, `ingredient_prohibition`,
  `concentration_limit`) — matched against formula lines via the same
  `ruleConditions` shape compatibility/safety rules already use.
- **Claim-based** (`claim_restriction`, `claim_evidence_requirement`) —
  matched against the formula's own claims via keyword matching.
- **Product-level requirements** (the other eleven types: label,
  warning, registration, notification, testing, document, packaging,
  language, responsible-party, market-identifier) — matched by product
  category alone; there is still no full dossier/evidence-tracking
  system (Phase 3's job), so these default to `missing_data` unless a
  named human explicitly confirms one — now via a **persisted**
  `RegulatoryEvidenceConfirmation`, not a session-local checkbox. See
  [REGULATORY_EVIDENCE_CONFIRMATIONS.md](REGULATORY_EVIDENCE_CONFIRMATIONS.md).

## Missing-data handling

Six finding statuses (`REGULATORY_FINDING_STATUSES`):
`compliant_with_rule`, `non_compliant`, `missing_data`,
`human_review_required`, `not_applicable`, `unknown`. Only
`compliant_with_rule` and `not_applicable` are non-blocking
(`NON_BLOCKING_FINDING_STATUSES`) — every other status, including
`unknown`, blocks by default when a policy's "no blocking regulatory
finding" gate is on. `evaluateRegulatory` never collapses "I don't know"
into "compliant" — an unconfirmed product-level requirement is
`missing_data`, not silently passed.

## Human-review workflow

`RegulatoryReview` (`schemas/regulatory.ts`) is an append-only sign-off
record bound to an **exact** saved `formulaVersionId`, `jurisdiction`,
and (where relevant) `packagingSkuCode` — never `"working_draft"`, never
matched by jurisdiction alone. It freezes a `classificationSnapshot`,
`findingSnapshot` and `ruleVersionSnapshot` at the moment of review, so a
later rule edit or re-classification cannot retroactively change what
the reviewer is recorded as having seen. `deriveRegulatoryReviewStatus`
resolves one of eight honest statuses (`current`,
`stale_formula_version`, `stale_rule_version`, `wrong_jurisdiction`,
`wrong_packaging_sku`, `revoked`, `superseded`, `unknown`) — never a
silent "current" for anything that doesn't fully match. A separate,
explicit `RegulatoryReviewEquivalence` record lets a human declare that
one version's review may be reused for another, scoped to jurisdiction
and packaging SKU, never assumed automatically. Full detail:
[REGULATORY_REVIEWS.md](REGULATORY_REVIEWS.md).

## Approval Readiness integration

Same one-layer-up pattern the cost-snapshot gate already uses
(`docs/APPROVAL_WORKFLOW.md#why-cost-is-a-layer-up`):
`assessRegulatoryReadiness`/`deriveRegulatoryReadiness`
(`engine/regulatoryApproval.ts`) are not part of
`assessApprovalReadiness`'s own fixed `ApprovalBlockerSource` union —
`ApprovalPanel.tsx` derives the six regulatory facts from real,
persisted rules/findings/reviews/confirmations and folds the result into
the same blocker list under a `"regulatory"` source. Six opt-in
`ApprovalPolicy` fields, every one `false` by default:
`requireRegulatoryClassificationCompleted`,
`requireNoBlockingRegulatoryFinding`,
`requireAllMandatoryDocumentsPresent`,
`requireAllMandatoryEvidencePresent`, `requireAllRequiredClaimsReviewed`,
`requireHumanRegulatoryReviewCompleted`.

**Multi-jurisdiction**, not primary-market-only: three additional opt-in
policy fields (`requiredRegulatoryJurisdictions`,
`requireAllTargetMarketsReviewed`, `allowPrimaryMarketOnly`) control
which jurisdiction(s) the six gates evaluate against, resolved by
`resolveRegulatoryJurisdictions` and aggregated by
`assessMultiJurisdictionRegulatoryReadiness`. A policy that never
touches these three fields still evaluates exactly one — the
formulation's primary target market — preserving the original
behavior. See
[REGULATORY_MULTI_MARKET_APPROVAL.md](REGULATORY_MULTI_MARKET_APPROVAL.md).

A recorded human review is matched by **exact formula version +
jurisdiction + packaging SKU**, never by jurisdiction alone — see
[REGULATORY_REVIEWS.md](REGULATORY_REVIEWS.md).

## Rule import/export

JSON round-trip (same shape-check-then-upsert convention
`RuleManager.tsx` already uses) plus **CSV and Excel** import/export
(`RegulatoryPanel.tsx`, using the existing `parseCsv`/`toCsv`
(`engine/importer.ts`) and `buildXlsxBlob`/ExcelJS utilities). Every
import format previews the parsed rows (valid rules plus row-level
errors) before the human commits the import — nothing is written until
the reviewer explicitly confirms. A flat CSV/Excel row cannot carry a
rule's array fields (`productCategories`, `conditions`, etc.);
`normalizeImportedRow` defaults every array/boolean field the row
doesn't supply, rather than leaving them `undefined` and crashing
evaluation later. Imported rules are always forced to
`verificationStatus: "imported_unverified"` regardless of what the
source file claims — an import can never silently promote a rule to
verified, and re-importing the same rows is idempotent (same rule ids
upsert in place rather than duplicating).

## Desktop workspace

`apps/desktop/src/components/formula/RegulatoryPanel.tsx` — the
"Regulatory" tab in the Formula Builder. Selectors for **saved formula
version**, **jurisdiction**, **packaging SKU**, and **reviewer role**
sit above every section, since a review, a confirmation, and the
readiness read all depend on this exact combination. Sections:
**Findings** (classification card, Evaluate button, per-finding
persisted-confirmation controls for `missing_data` product-level
requirements and claim-evidence requirements), **Rules** (list filtered
to the selected jurisdiction plus any `EAC` rule, create/edit via a JSON
editor, activate/deactivate, deprecate, verify/reject-verification/
supersede, revision history, JSON/CSV/Excel import with preview,
export), **Reviews** (record a human regulatory review bound to the
selected version/jurisdiction/SKU, revoke one with a reason, declare or
revoke a review-equivalence reuse against another version).

## Persistence

`apps/desktop/src-tauri/src/masterdata.rs` collections: `regulatory_rules`
(editable), `regulatory_rule_revisions` (append-only),
`regulatory_reviews` (append-only), `regulatory_review_revocations`
(append-only), `regulatory_evidence_confirmations` (append-only),
`regulatory_evidence_confirmation_revocations` (append-only),
`regulatory_review_equivalences` (append-only — a revocation is a new
row with `revokesEquivalenceId` set, never a delete). All seven start at
`schemaVersion: "1.0"` — the Phase 2 closure work reshaped several
schemas additively without ever having shipped a release on this data,
so no migration was registered; there is nothing yet to migrate from.
See [MIGRATIONS.md](MIGRATIONS.md).

Eight audit events (`appendAudit`/`auditEvent`, same mechanism as
everywhere else — see [APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md#audit-and-immutability)):
`regulatory.review_recorded`, `regulatory.review_revoked`,
`regulatory.confirmation_recorded`, `regulatory.confirmation_revoked`,
`regulatory.rule_verified`, `regulatory.rule_verification_rejected`,
`regulatory.rule_superseded`, `regulatory.review_reused` (plus
`regulatory.review_reuse_revoked` for symmetry).

## Seed rules

17 structural placeholders across all seven jurisdictions
(`packages/shared/src/catalog/regulatoryRules.ts`) — every one
`not_verified`, `status: "draft"`, with a `requirement` string that says
so explicitly. Verifying a seed rule for real requires setting
`sourceAuthority`/`sourceReference` from an actual legal source and
having an authorized human call `verifyRule` — nothing in this codebase
does that automatically, and no seed rule's concentration limit,
document list, or label-element list has been confirmed against real
Kenyan/EAC legislation. See [REGULATORY_RULES.md](REGULATORY_RULES.md).

## Tests

Shared package: `regulatoryClassification.test.ts` (13),
`regulatoryRules.test.ts` (34, including the verify/reject/supersede
lifecycle), `regulatoryApproval.test.ts` (35, including multi-jurisdiction
resolution and readiness), `regulatoryReviews.test.ts` (32 — new,
version/jurisdiction/SKU binding, all eight review statuses, evidence
confirmations, review equivalence). Desktop: `RegulatoryPanel.test.tsx`
(14) and `ApprovalPanel.test.tsx` (13, including its regulatory
readiness integration cases).

## Known limitations

- **No full dossier/evidence-matrix UI.** Phase 2 closure added a real,
  persisted requirement/evidence layer (`RegulatoryEvidenceConfirmation`)
  so document/evidence/claims gates read actual human-confirmed records
  instead of transient UI booleans — but this is deliberately **not**
  the full Phase 3 dossier: there is no document-upload-and-attachment
  matrix keyed to every `RegulatoryDocumentType`, no automatic expiry
  tracking beyond the `RegulatoryEvidenceState` enum's existence, and no
  cross-formulation evidence library. See
  [REGULATORY_EVIDENCE_CONFIRMATIONS.md](REGULATORY_EVIDENCE_CONFIRMATIONS.md).
- **Seed rules remain structural placeholders.** Every one requires a
  qualified regulatory reviewer to supply a real source and call
  `verifyRule` before it should be relied on for any actual compliance
  decision — nothing in this codebase invents a limit, a required
  document, or a legal citation on its own.
- **Multi-jurisdiction approval readiness is opt-in.** A policy that
  never sets `requiredRegulatoryJurisdictions`/
  `requireAllTargetMarketsReviewed` still checks only the primary target
  market, by design (backward compatibility) — an organization selling
  into multiple EAC markets must explicitly configure the policy to
  require them all.
- **No automatic EAC/national rule conflict resolution** — see
  [EAC_MARKET_PROFILES.md](EAC_MARKET_PROFILES.md#known-limitation).
