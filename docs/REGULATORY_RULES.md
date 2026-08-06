# Regulatory rules: model, lifecycle, and seed data

See [REGULATORY_ENGINE.md](REGULATORY_ENGINE.md) for how rules fit into
the wider engine (classification, evaluation, findings, readiness). This
document covers the rule model itself, its edit lifecycle, and the seed
catalog.

## Fifteen rule types

`REGULATORY_RULE_TYPES` (`packages/shared/src/schemas/regulatory.ts`):
`ingredient_restriction`, `ingredient_prohibition`, `concentration_limit`
(ingredient-based — matched via `conditions`, the same
`ruleConditions` shape compatibility/safety rules use);
`claim_restriction`, `claim_evidence_requirement` (claim-based — matched
via `claimKeywordsAny`); and eleven product-level requirement types
(`label_requirement`, `warning_requirement`, `registration_requirement`,
`notification_requirement`, `testing_requirement`,
`document_requirement`, `packaging_requirement`, `language_requirement`,
`responsible_party_requirement`, `market_specific_identifier`) — matched
by `productCategories` alone (empty = every category, the same
unrestricted-when-empty convention `TestDefinition.applicableProductFamilies`
already uses).

## Versioned lifecycle

`RegulatoryRule` is the mutable "current state" row.
`RegulatoryRuleRevision` is its append-only history — the exact
`ApprovalPolicy`/`ApprovalPolicyRevision` split. `engine/regulatoryRules.ts`:

- **`initialRuleRevision(rule, actor)`** — the `"created"` revision.
  Human-only.
- **`editRule(current, updates, actor, changeReason)`** — bumps `version`,
  requires a non-empty `changeReason`, human-only. Returns both the
  updated rule and its `"edited"` revision.
- **`setRuleActive(current, active, actor)`** — `"activated"`/
  `"deactivated"`, human-only.
- **`deprecateRule(current, actor, reason)`** — sets `status: "deprecated"`
  and `active: false` together, requires a non-empty reason, human-only.

Every one of these throws for a non-human `Actor` — the same
human-gated discipline `engine/approvalPolicy.ts` already enforces for
policy changes.

## Source and verification workflow

A rule additionally carries `sourceTitle`, `sourceAuthority`,
`sourceReference`, `sourcePublicationDate`, `sourceEffectiveDate`,
`sourceExpiryDate`, `sourceJurisdiction`, and `sourceDocuments`
(attachments via the same embedded mechanism as
[ATTACHMENTS.md](ATTACHMENTS.md)) — where the requirement actually comes
from, never invented. `verificationStatus` is a six-state enum
(`not_verified`, `imported_unverified`, `human_review_required`,
`under_review`, `rejected`, `expired`, `superseded`) plus `verified`;
only `verified` satisfies a "current verified rule" policy gate
(`CURRENT_VERIFIED_RULE_STATUSES`).

`engine/regulatoryRules.ts`, gated by `requireRegulatoryReviewer` (human,
and one of `regulatory`/`quality`/`administrator` — an AI, system, or
import actor is always refused):

- **`verifyRule(current, actor, notes?)`** — sets `verificationStatus:
  "verified"` plus `verifiedBy`/`verifiedByRole`/`verifiedAt`. Refuses
  unless `sourceAuthority` and `sourceReference` are already set on the
  rule — a "verified" rule with no stated source is exactly the
  invented-legislation risk this engine exists to avoid.
- **`rejectRuleVerification(current, actor, reason)`** — sets
  `verificationStatus: "rejected"`, requires a reason. Distinct from
  `not_verified` (nobody has looked yet): a reviewer looked and declined.
- **`supersedeRule(current, actor, reason)`** — sets
  `verificationStatus: "superseded"` and `active: false`, requires a
  reason. For a previously verified rule that no longer reflects current
  law (replaced or the underlying regulation changed) — distinct from
  `expired` (the rule's own `expiryDate` window lapsed).

See [REGULATORY_RULE_VERIFICATION.md](REGULATORY_RULE_VERIFICATION.md).

## Applicability and evaluation windowing

`ruleApplies` (`engine/regulatoryRules.ts`, internal): a rule applies
when it is `active` and not `status: "deprecated"`, its jurisdiction
matches the evaluation context exactly OR the rule is an `EAC` rule and
the context's jurisdiction is an EAC member state
(`EAC_MEMBER_STATES`), its `productCategories` is empty or includes the
context's category, and — if set — the evaluation's `asOf` date (default
now) falls within `effectiveDate`/`expiryDate`.

## Seed catalog

17 structural placeholders across all seven jurisdictions
(`packages/shared/src/catalog/regulatoryRules.ts`, `SEED_REGULATORY_RULES`):

| Jurisdiction | Rules |
|---|---|
| Kenya (`KE`) | `KE-REG-001` registration (disinfectant/biocidal), `KE-REG-002` chlorine concentration limit, `KE-REG-003` label elements, `KE-REG-004` antimicrobial-claim evidence, `KE-REG-005` fluoride restriction + warning |
| Uganda (`UG`) | `UG-REG-001` registration, `UG-REG-002` language requirement, `UG-REG-003` ingredient prohibition (QAC in cosmetics) |
| Tanzania (`TZ`) | `TZ-REG-001` registration + conformity certificate, `TZ-REG-002` responsible-party requirement, `TZ-REG-003` wet-wipe disposal labelling |
| Rwanda (`RW`) | `RW-REG-001` notification requirement, `RW-REG-002` safety-data-sheet + dossier document requirement |
| Burundi (`BI`) | `BI-REG-001` registration, `BI-REG-002` language requirement |
| South Sudan (`SS`) | `SS-REG-001` registration |
| EAC (regional) | `EAC-REG-001` EAC conformity mark, `EAC-REG-002` harmonized-standard testing requirement |

Every seed rule ships via a shared `def()` builder that forces
`verificationStatus: "not_verified"`, `humanReviewStatus:
"review_required"`, `status: "draft"`, and a `requirement` string that
explicitly says "Placeholder — not verified... Confirm the exact
requirement, authority, and source with a qualified regulatory reviewer
before relying on this rule for any compliance decision." The
`authority` field is likewise suffixed "— placeholder authority name,
not verified". A seed rule's `name` currently equals its `code` — no
seed rule has a distinct human-readable name yet.

## Import/export

JSON, CSV, and Excel — see
[REGULATORY_ENGINE.md#rule-importexport](REGULATORY_ENGINE.md#rule-importexport).

## Tests

`regulatoryRules.test.ts` (34 tests) covers: applicability across
jurisdiction/category/active/effective-date-window/EAC-overlay
combinations, all three evaluation shapes
(ingredient/claim/product-level) including honest `missing_data`
defaults, `summarizeRegulatoryFindings`'s counts, the full
create/edit/activate/deactivate/deprecate lifecycle including the
non-human-actor and empty-reason rejections, and the
verify/reject-verification/supersede lifecycle (refusal without a
source, role-gating against chemist/AI/import/system actors,
supersession deactivating the rule).
