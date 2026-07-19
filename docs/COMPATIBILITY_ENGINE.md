# Compatibility engine

`packages/shared/src/schemas/compatibility.ts`,
`packages/shared/src/engine/compatibility.ts`,
`packages/shared/src/catalog/compatibilityRules.ts`. Open the **Compatibility**
tab inside a formula project.

## What this is

A deterministic, rule-based checker: given a formula's lines and a rule set,
it always produces the same findings. An LLM may explain a finding in plain
language elsewhere in the app, but it is never the thing that decides whether
one exists — a finding exists because a versioned rule, with a stated
verification status, matched the formula.

## Rule model

A `CompatibilityRule` (`compatibilityRuleSchema`) carries:

- `id`, `version` (the rule's own content version — bumped when its
  conditions or message change, independent of `schemaVersion`)
- `status`: `draft` / `verified` / `deprecated`
- `severity`: `info` / `warning` / `error` / `blocking`
- Scope filters: `productDomains`, `materialIds`, `casNumbers`,
  `functionGroups`, `ionicCharacters` — all optional; an absent filter matches
  everything
- `ruleType`: `forbidden_combination`, `warning_combination`,
  `required_coingredient`, `ph_dependent`, `temperature_dependent`,
  `concentration_dependent`, `order_of_addition`, `packaging_incompatibility`,
  `storage_incompatibility`
- `conditions`: one or two `RuleCondition` entries depending on `ruleType` —
  two for a combination rule (A, B) or order-of-addition (do-first,
  do-second); one for a pH-, temperature- or concentration-dependent rule;
  two for `required_coingredient` (material present, co-ingredient that must
  also be present)
- `message`, `scientificReason` (plain-language mechanism, in the rule
  author's own words — not a citation), `recommendedAction`
- `sourceReferences` — empty is the honest default for a rule built from
  general formulation-chemistry knowledge rather than a specific paper or
  standard
- `verificationStatus`: `verified` / `not_verified` / `human_review_required`

Within one rule, a condition's own `*Any` lists (e.g. `functionsAny`,
`nameKeywordsAny`) are ORed; the rule's `conditions` array is ANDed — every
condition must be satisfied by *something* in the formula (or, for a
packaging condition, by the target packaging) before the rule fires. That is
enough to express "anionic surfactant present AND cationic surfactant
present" without a general boolean-expression language.

## Seed rules

`SEED_COMPATIBILITY_RULES` ships 20 rules, one per category named in the
platform's compatibility-engine specification:

anionic/cationic, QAC/anionic, chlorhexidine/anionic, acid/hypochlorite,
hypochlorite/ammonia, oxidizer/reducer, peroxide/metal, preservative/pH,
carbomer/electrolyte, carbomer neutralizer requirement, fragrance
solubility, active-material solubility, metal-ion sensitivity,
enzyme/oxidizer, high-temperature fragrance addition, heat-sensitive active
addition, bleach packaging, strong-acid packaging, QAC/wipe-substrate
adsorption, chlorhexidine/builder interaction.

Every seed rule ships `status: "draft"` — nothing has gone through this
project's own rule-review workflow yet — and an honest
`verificationStatus`: most are `not_verified` (general formulation-chemistry
knowledge), a few basic-inorganic-chemistry rules (e.g. acid + hypochlorite)
are `human_review_required`. `sourceReferences` is empty throughout; no
citation is invented. **This list is not exhaustive** — it covers the named
categories and nothing more.

## Evaluation engine

`evaluateCompatibility(lines, rules, context)`:

- Skips inactive or `deprecated` rules, and rules scoped to a
  `productDomains` list that excludes the current formula's domain.
- Deterministic and idempotent: the same formula and rule set always produce
  the same findings, in the same order. A finding's `id` is derived from the
  rule id, the sorted matched line ids and the triggered condition indices
  (`findingId`), so evaluating twice never duplicates a finding — a `Set` of
  seen ids guards this explicitly.
- Missing data (no `phTarget` on a `ph_dependent` rule, no `processTempC` on
  a `temperature_dependent` rule) produces a finding with `dataIncomplete:
  true` and a message saying the check could not be confirmed either way. A
  blocking rule with incomplete data downgrades to `warning` rather than
  either blocking silently or being dropped — unknown is reported as unknown,
  never as safe.
- `CompatibilitySnapshot` (`compatibilitySnapshotSchema`) is an immutable
  record of one evaluation run against one formula version, the same pattern
  as a cost snapshot: it pins `ruleVersionsUsed` (rule id + the rule's
  `version` at evaluation time), so a later rule edit cannot retroactively
  change what a past snapshot says it found. Editing the formula re-runs the
  engine and produces a new snapshot; a version's original snapshot never
  changes underneath it.

`summarizeCompatibilityFindings` returns counts by severity plus a
`dataIncomplete` count, for the tab's summary strip.

## UI

- **Compatibility tab** (`CompatibilityPanel.tsx`): pH target and process
  temperature inputs (both optional — omitting either surfaces the
  data-incomplete findings above rather than skipping the checks), a severity
  summary, a findings list filterable by severity, a link from each finding
  back to the affected formula line, and a "save snapshot" action that
  requires a saved formula version to attach to.
- **Rule manager** (`RuleManager.tsx`, shared with the safety engine): create,
  edit and deprecate rules; toggle `active`; view verification status per
  rule with unverified/pending statuses visibly distinguished from
  `verified`. Import a JSON array of rules (id-based upsert — see
  [SAFETY_RULE_IMPORT.md](SAFETY_RULE_IMPORT.md)); export the current rule
  set as JSON or `.xlsx`.

## What this is not

- **Not an authoritative chemical-safety database.** It is a hand-maintained
  seed rule set plus whatever a chemist adds or edits afterward, each rule
  carrying its own verification status rather than borrowing the platform's
  credibility.
- **Not exhaustive**, and does not claim to be. Absence of a finding means no
  loaded rule matched — not that the combination is safe.
- **The LLM is never a source of truth here.** It may narrate a finding in a
  formulation card or a chat response, but the finding itself is produced
  only by `evaluateCompatibility` against stored rules.
- Does not establish regulatory or legal compliance. See
  [SAFETY_ENGINE.md](SAFETY_ENGINE.md) and
  `docs/architecture/IMPLEMENTATION_STATUS.md` — the Regulatory Engine is
  separate and not yet built.

## Tests

`packages/shared/src/engine/compatibility.test.ts` (20 tests) covers each
rule type, duplicate-finding prevention, missing-data handling, deprecated
and inactive rules, and severity downgrade on incomplete data.
