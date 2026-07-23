# Kenya/EAC Regulatory Engine

Phase 2 of the Kenya R&D platform roadmap. Deterministic, versioned
regulatory rules for Kenya and six other East African Community
jurisdictions — never a model's guess dressed up as a compliance
decision, and never presented as verified legislation until a qualified
regulatory reviewer has actually confirmed it.

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
[REGULATORY_CLASSIFICATION.md](REGULATORY_CLASSIFICATION.md).

## Versioned rule model

`RegulatoryRule` is the mutable "current state" row; every edit appends
a `RegulatoryRuleRevision` rather than rewriting history — the exact
`ApprovalPolicy`/`ApprovalPolicyRevision` split this codebase already
uses. `engine/regulatoryRules.ts`'s `initialRuleRevision`/`editRule`/
`setRuleActive`/`deprecateRule` are all human-gated (throw for a
non-human actor) and require a change reason for an edit or a
deprecation. See [REGULATORY_RULES.md](REGULATORY_RULES.md).

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
  category alone; there is no dossier/evidence-tracking system yet
  (Phase 3's job), so these default to `missing_data` unless a named
  human explicitly confirms one via `manuallyConfirmedRuleIds`.

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

`RegulatoryReview` (`schemas/regulatory.ts`) is a minimal, append-only
sign-off record: who reviewed, when, for which jurisdiction, and the
outcome (`compliant` / `non_compliant` / `conditionally_compliant`) with
required notes. Recorded from the desktop Regulatory tab's Reviews
section. This is deliberately not a full dossier/evidence-tracking
system — see "Known limitations" below.

## Approval Readiness integration

Same one-layer-up pattern the cost-snapshot gate already uses
(`docs/APPROVAL_WORKFLOW.md#why-cost-is-a-layer-up`):
`assessRegulatoryReadiness`/`deriveRegulatoryReadiness`
(`engine/regulatoryApproval.ts`) are not part of
`assessApprovalReadiness`'s own fixed `ApprovalBlockerSource` union —
`ApprovalPanel.tsx` derives the six regulatory facts from real,
persisted rules/findings/reviews and folds the result into the same
blocker list under a `"regulatory"` source. Six new opt-in
`ApprovalPolicy` fields, every one `false` by default:
`requireRegulatoryClassificationCompleted`,
`requireNoBlockingRegulatoryFinding`,
`requireAllMandatoryDocumentsPresent`,
`requireAllMandatoryEvidencePresent`, `requireAllRequiredClaimsReviewed`,
`requireHumanRegulatoryReviewCompleted`.

Scoped to the formulation's **primary jurisdiction** — the first entry
in `targetMarkets`, defaulting to Kenya. A multi-market product's other
jurisdictions are reviewed via the dedicated Regulatory tab, which lets
picking any of the seven; the Approval tab's automatic gate only ever
checks the one primary market. A recorded human review is matched by
jurisdiction alone, not by the specific saved formula version — the
Regulatory tab has no concept of "which version is up for approval,"
only "the current formulation, in this jurisdiction" (a known
simplification, see below).

## Rule import/export

Same JSON round-trip convention `RuleManager.tsx` (compatibility/safety
rules) already uses: export the current rule set as formatted JSON;
import a pasted JSON array, shape-checked (id/code/jurisdiction/ruleType
present) but not validated against the full `regulatoryRuleSchema`.
Imported rules are always forced to `verificationStatus:
"imported_unverified"` regardless of what the source file claims — an
import can never silently promote a rule to verified.

## Desktop workspace

`apps/desktop/src/components/formula/RegulatoryPanel.tsx` — a
"Regulatory" tab in the Formula Builder alongside Trials/Stability/
Approval. Three sections: **Findings** (jurisdiction picker,
classification card, Evaluate button, per-finding manual-confirmation
checkboxes for `missing_data` product-level requirements and
evidence-type checkboxes for claim-evidence requirements), **Rules**
(list filtered to the selected jurisdiction plus any `EAC` rule, create/
edit via a JSON editor, activate/deactivate, deprecate, revision history,
import/export), **Reviews** (record a human regulatory review, list past
ones).

## Persistence

Three new collections
(`apps/desktop/src-tauri/src/masterdata.rs`): `regulatory_rules`
(editable, like `test_definitions`/`safety_rules`), 
`regulatory_rule_revisions` (append-only, like
`approval_policy_revisions`), `regulatory_reviews` (append-only sign-off
events). No migration was registered for them — all three start at
`schemaVersion: "1.0"`, the first version, so there is nothing yet to
migrate from.

## Seed rules

17 structural placeholders across all seven jurisdictions
(`packages/shared/src/catalog/regulatoryRules.ts`) — every one
`not_verified`, `status: "draft"`, with a `requirement` string that says
so explicitly. See [REGULATORY_RULES.md](REGULATORY_RULES.md).

## Tests

53 shared-package tests: `regulatoryClassification.test.ts` (13),
`regulatoryRules.test.ts` (25), `regulatoryApproval.test.ts` (15). 11
desktop UI-integration tests: `RegulatoryPanel.test.tsx` (8) plus 3 new
`ApprovalPanel.test.tsx` cases covering the readiness-gate integration.

## Known limitations

- **No dossier/evidence-tracking system.** Product-level requirement
  types (label, warning, registration, document, testing, packaging,
  language, responsible-party, market-identifier) have no automatic way
  to confirm compliance — they stay `missing_data` until a human
  explicitly confirms them per-evaluation via
  `manuallyConfirmedRuleIds`/`providedEvidenceTypes`, and that
  confirmation is **not persisted** separately from a recorded
  `RegulatoryReview` — it resets on reload. A real evidence-tracking UI
  (uploaded documents, a durable per-rule confirmation record) is
  Phase 3's job.
- **Human regulatory review is matched by jurisdiction, not by formula
  version.** `RegulatoryPanel.tsx` always records a review against
  `"working_draft"`; the Approval tab's readiness gate checks jurisdiction
  only, treating any recorded review as covering whichever version is
  currently up for approval. A more precise per-version review record
  would need the Regulatory tab to know which saved version it is
  reviewing.
- **The Approval tab's automatic regulatory gate checks exactly one
  jurisdiction** — the formulation's primary target market. A product
  sold into multiple EAC markets needs a separate pass through the
  Regulatory tab (which does support switching jurisdictions) for each
  additional market; the Approval tab does not aggregate across all of
  them.
- **Seed rules are structural placeholders only** — no seed rule's
  concentration limit, required document list, or label-element list has
  been confirmed against real Kenyan/EAC legislation. Every one requires
  a qualified regulatory reviewer's sign-off before being relied on for a
  real compliance decision.
- **`TrialsPanel.tsx` has no manual-inclusion-style reviewer/reason UI**
  for regulatory purposes — this module's manual confirmation (of a
  missing-data finding) lives entirely inside `RegulatoryPanel.tsx`.
