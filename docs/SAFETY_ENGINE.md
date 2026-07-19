# Safety engine

`packages/shared/src/schemas/safety.ts`, `packages/shared/src/engine/safety.ts`,
`packages/shared/src/catalog/safetyRules.ts`, plus the pre-generation gate in
`runtime/pipeline/pipeline.py`. Open the **Safety** tab inside a formula
project.

## What this is

Deterministic hazard checking and product-safety classification, structured
the same way as the [compatibility engine](COMPATIBILITY_ENGINE.md) and for
the same reason: a prompt instruction is not a safety control, a rule with a
stated verification status is. A model may explain a safety finding in plain
language; it never generates the finding itself.

## Hazard data model

`MaterialHazardRecord` (`materialHazardRecordSchema`) records a hazard
classification against a **CAS number**, not an internal material code —
hazard data belongs to the substance, and the same substance can appear under
several internal codes. Fields: `hazardClass` (one of 16, e.g.
`skin_corrosion`, `serious_eye_damage`, `flammable_liquid`, `oxidizing`),
`category`, GHS `statementCode`/`statementText` (e.g. "H314" — never
invented), `thresholdPercent`, `pictograms` (the 9 `GHS01`–`GHS09` codes),
`signalWord` (`danger` / `warning` / `none`), `source`, and
`verificationStatus`.

`verificationStatus` on hazard data has four states, one more than the rule
engines' three: `verified`, `not_verified`, `imported_unverified`, and
`human_review_required`. `imported_unverified` exists specifically so a
reviewer working through a bulk import batch can filter to everything from
that batch — it is distinct from the general absence of a citation. **No
hazard record is invented.** A blank field is missing data, reported as
missing, never filled with a plausible-looking classification.

## Product safety classification

`classifyProductSafety(family, claims)` in `engine/safety.ts` is
deterministic — family `hazardClass` plus keyword matching on the family
name/code and the project's target claims, never a model's guess. It returns
one of 8 `PRODUCT_SAFETY_CLASSIFICATIONS`:

`ordinary_consumer_product`, `industrial_cleaning_product`,
`hazardous_lawful_product`, `regulated_disinfectant`,
`medical_or_health_related_product`, `restricted_request`,
`prohibited_request`, `human_review_required`.

The Kenya catalog's `hazardClass` field (seeded in an earlier phase
specifically to drive this) maps directly: `medical` →
`medical_or_health_related_product`, `regulated_disinfectant` → same name,
`industrial` → `hazardous_lawful_product` if the family name/code contains a
keyword like "bleach", "hypochlorite", "acid", "limescale", "descal",
"degreaser" or "caustic", else `industrial_cleaning_product`. An otherwise
ordinary family escalates to `human_review_required` if its claims contain an
escalating keyword ("antibacterial", "antimicrobial", "disinfect", "kills
germs", "medical", "therapeutic", "medicated") — a claim carries its own
regulatory weight regardless of which family it was seeded under.

`HUMAN_REVIEW_CLASSIFICATIONS` — `hazardous_lawful_product`,
`regulated_disinfectant`, `medical_or_health_related_product`,
`restricted_request`, `human_review_required` — always require a named human
to review and acknowledge before the formula may progress toward approval,
independent of whatever findings it does or does not have.

Kenya-portfolio examples that land in an enhanced-review tier: bleach,
industrial bleach, limescale remover, toilet bowl cleaner, oxygen whitening
powder, QAC surface sanitizer, industrial disinfectant, chlorhexidine wipes,
alcohol-free hand rub, laundry sanitizer, antibacterial-claim products,
toothpaste with regulated actives.

## Safety rules

`SEED_SAFETY_RULES` ships 16 rules, covering 16 of the 17 categories named in
the specification: acid + hypochlorite, hypochlorite + ammonia/amines, strong
oxidizer + reducer, high corrosivity risk, high/low pH risk, flammable
solvent threshold, restricted active threshold, sensitizer threshold,
eye-damage risk, skin-corrosion risk, acute-toxicity warning, environmental
hazard, dangerous process temperature, unsafe packaging, missing required
PPE, missing ventilation requirement. The seventeenth category — "medical or
therapeutic claim escalation" — is deliberately **not** a per-line rule: a
claim is a property of the project, not a formula line, so it is handled by
`classifyProductSafety` reading the project's target claims directly, rather
than duplicated as a rule.

A `SafetyRule` (`safetyRuleSchema`) extends the same rule shape as
compatibility (`id`, `version`, `status`, `severity`, `ruleType`,
`conditions`, `message`, `scientificReason`, `sourceReferences`,
`verificationStatus`) with safety-specific fields: `category` (free text, so
new categories don't need a schema migration), `requiredAction`,
`requiredPpe`, `requiredEngineeringControls`, and
`alwaysRequiresHumanReview` — set on rules like acid+hypochlorite where even
if severity logic alone wouldn't force review, the finding always routes to
a human regardless.

Same honesty convention as the compatibility seed set: `sourceReferences` is
empty (general formulation/handling knowledge, not a transcription of a
specific regulation or SDS), and anything whose exact wording or threshold
needs a chemist's confirmation is `human_review_required`, not `verified`.
**Not exhaustive.**

## Evaluation and findings

`evaluateSafety(lines, rules, context)` mirrors
`evaluateCompatibility` structurally: same rule types, same
missing-data-produces-`dataIncomplete` behaviour, same duplicate-finding
guard via a stable finding id.

A `SafetyFinding` additionally carries `humanReviewRequired`, computed as
true when the rule has `alwaysRequiresHumanReview`, or
`verificationStatus === "human_review_required"`, or `severity` is
`blocking` or `error`. `summarizeSafetyFindings` reports counts by severity
plus `humanReviewRequired` and `dataIncomplete` counts.

## Resolution workflow

A blocking safety finding cannot be dismissed by clicking it away.
`SafetyResolution` (`safetyResolutionSchema`) requires, together, in one
record: `reviewerName` (non-empty), optionally `reviewerRole`, `resolvedAt`,
a non-empty `resolutionReason`, and a `resolutionKind` — `accepted_risk`
(cleared without changing the formula), `formula_changed` (the offending
line was removed/altered instead), or `rule_disputed` (routes to a rule
review rather than accepting the finding). There is no code path that clears
a blocking finding without all of these — the same rule the approval-record
schema already enforces for production approval itself
(`docs/FORMULA_VERSIONING.md`).

`assessApprovalReadiness` (see [APPROVAL_READINESS.md](APPROVAL_READINESS.md))
treats a finding as resolved only if its id appears in
`resolvedFindingIds` — i.e. only after a `SafetyResolution` record exists for
it.

## Pre-generation AI-request safety gate

Before literature discovery or AI formulation generation runs at all,
`runtime/pipeline/pipeline.py` classifies the requested target with
`classify_target(target)` — keyword matching against restricted (pesticide,
veterinary drug, controlled precursor…), medical, disinfectant,
hazardous-lawful and industrial keyword lists, falling back to
`safety_gate()` for outright prohibited content and to
`ordinary_consumer_product` otherwise. `safety_decision(target)` maps the
classification to one of three outcomes:

- `prohibited_request` → `"refused"` — the pipeline returns
  `{"status": "refused", ...}` immediately, no literature discovery, no model
  call.
- A classification in `_HUMAN_REVIEW_TIERS` (`regulated_disinfectant`,
  `medical_or_health_related_product`, `restricted_request`) without a named,
  acknowledging reviewer → `"human_review_required"` — the desktop UI shows
  the classification and a reviewer-name field
  (`FormulationWorkspaceV2.tsx`'s `HumanReviewNotice`); resubmitting with
  `human_review_acknowledged: true` and a non-empty `human_review_by` lets
  the same request proceed.
- Otherwise → `"proceed"` — ordinary Kenya FMCG requests continue normally,
  unaffected.

Every decision — refused, pending human review, or proceeded (with the
reviewer name if applicable) — is appended to
`data/safety/ai_request_log.jsonl` via `_log_safety_decision`, best-effort
(a logging failure never blocks the pipeline itself).

Imported literature and documents are treated as untrusted content
throughout this pipeline: nothing a retrieved paper says can override this
gate or downgrade a classification.

## UI

- **Safety tab** (`SafetyPanel.tsx`): product safety classification with its
  8-value label set, hazard summary, GHS pictograms when verified hazard data
  exists (never rendered for unverified data as though it were verified),
  findings by severity, required PPE and engineering controls per finding,
  human-review status, the resolution dialog (reviewer name, reason,
  resolution kind), and audit history of past resolutions.
- **Rule manager** — shared with compatibility; see
  [COMPATIBILITY_ENGINE.md](COMPATIBILITY_ENGINE.md#ui) and
  [SAFETY_RULE_IMPORT.md](SAFETY_RULE_IMPORT.md).

## What this is not

- **Not a regulatory engine.** `docs/architecture/IMPLEMENTATION_STATUS.md`
  lists the Regulatory Engine as not yet built; this module does not
  substitute for it, and nothing here establishes legal or regulatory
  compliance in any jurisdiction.
- **Not verified GHS data** unless a specific record's `verificationStatus`
  says `verified`. Most seeded hazard fields, where present at all, are
  `not_verified` or `imported_unverified` and are shown that way in the UI.
- Does not perform exposure assessment, dose-response analysis, or anything
  resembling a formal risk assessment — it is threshold and combination
  checking against a hand-maintained rule set.

## Tests

`packages/shared/src/engine/safety.test.ts` (19 tests) and
`runtime/pipeline/test_pipeline.py`'s safety-gate tests cover classification,
rule evaluation, human-review routing, and the resolution/audit shape.
