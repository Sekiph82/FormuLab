# Regulatory rule source and verification workflow

`packages/shared/src/schemas/regulatory.ts` (source fields,
`REGULATORY_VERIFICATION_STATUSES`),
`packages/shared/src/engine/regulatoryRules.ts`
(`verifyRule`/`rejectRuleVerification`/`supersedeRule`,
`requireRegulatoryReviewer`). See
[REGULATORY_RULES.md](REGULATORY_RULES.md) and
[REGULATORY_ENGINE.md](REGULATORY_ENGINE.md) for how a rule fits into
the wider engine.

## What this closes

Every seed rule ships `verificationStatus: "not_verified"` with a
`requirement` string that says so explicitly — a deliberate structural
placeholder, never presented as confirmed law. Before this phase, there
was no workflow for a qualified human to actually move a rule to
`verified` with an attributable, source-backed decision. This closes
that: a real source-verification record and a role-gated
verify/reject/supersede lifecycle, with a hard refusal to mark anything
"verified" without a stated source.

## Source fields

Every optional — a freshly created or seeded rule has none of them yet:

| Field | What it holds |
|---|---|
| `sourceTitle` | The source document's title. |
| `sourceAuthority` | Who issued it, e.g. "Kenya Bureau of Standards (KEBS)". |
| `sourceReference` | Free text — a gazette notice, a standard number. Never invented. |
| `sourcePublicationDate` | When the source was published. |
| `sourceEffectiveDate` | When the source itself took effect (distinct from the rule's own `effectiveDate`/`expiryDate`, which govern when `evaluateRegulatory` applies the rule). |
| `sourceExpiryDate` | When the source itself lapses, if known. |
| `sourceJurisdiction` | The jurisdiction the source document actually covers — may differ from the rule's own `jurisdiction` for an EAC-harmonized source. |
| `sourceDocuments` | The actual gazette notice / standard / legal text, via the same safe embedded-attachment mechanism as the rest of the codebase (see [ATTACHMENTS.md](ATTACHMENTS.md)) — never a renderer-supplied path. |

## Six verification statuses (plus `verified`)

`REGULATORY_VERIFICATION_STATUSES`: `verified`, `not_verified`,
`imported_unverified`, `human_review_required`, `under_review`,
`rejected`, `expired`, `superseded`. `CURRENT_VERIFIED_RULE_STATUSES`
is exactly `["verified"]` — a "current, verified rule" policy gate
accepts nothing else, including a merely `under_review` rule or one that
was verified once but is now `expired`/`superseded`.

A `RegulatoryFinding.verificationStatus` is copied straight from the
rule that produced it, so a finding honestly reflects whether its own
rule has ever actually been verified.

## Role-gated lifecycle

`requireRegulatoryReviewer(actor, action)` — human actor, and one of
`regulatory`/`quality`/`administrator`. Every one of the three functions
below throws for anything else, including an AI, system, or import
actor:

- **`verifyRule(current, actor, notes?)`** — sets `verificationStatus:
  "verified"`, `verifiedBy`/`verifiedByRole`/`verifiedAt`/
  `verificationNotes`. **Refuses unless `sourceAuthority` and
  `sourceReference` are both already non-empty on the rule** — a
  "verified" rule with no stated source is exactly the
  invented-legislation risk this engine exists to avoid. Bumps the
  rule's `version` and appends a `"verified"` `RegulatoryRuleRevision`.
- **`rejectRuleVerification(current, actor, reason)`** — sets
  `verificationStatus: "rejected"`. Requires a non-empty reason.
  Distinct from `not_verified`: a reviewer actually looked and declined,
  rather than nobody having looked yet.
- **`supersedeRule(current, actor, reason)`** — sets
  `verificationStatus: "superseded"` and `active: false`. Requires a
  non-empty reason. For a previously verified rule that no longer
  reflects current law or standard (replaced by a newer rule, or the
  underlying regulation changed) — distinct from `expired`, which is the
  rule's own `expiryDate` window lapsing (`ruleApplies` already handles
  that automatically; `superseded` is always a deliberate human
  decision).

An import always forces `verificationStatus: "imported_unverified"`
regardless of what the source file's `verificationStatus` column claims
— an import can never promote a rule to verified, imported or
otherwise; only `verifyRule` can, and only for a rule that already has a
real source recorded.

## Never invented

Nothing in this codebase writes a `sourceAuthority`, `sourceReference`,
a concentration limit, or a required-document list on its own. Every
seed rule's actual values are explicit structural placeholders (see
`catalog/regulatoryRules.ts`'s shared `def()` builder and its
placeholder `requirement`/`authority` text) — confirming a real limit
against real Kenyan/EAC legislation, filling in the source fields, and
calling `verifyRule` is a qualified human's job, always.

## Tests

`regulatoryRules.test.ts` (34 tests total) — the verify/reject/supersede
describe block covers: refusal to verify without `sourceAuthority`/
`sourceReference` set, successful verification once both are present,
role-gating (a `chemist` role, an AI actor, an import actor, and a
system actor are all refused for all three actions), rejection
requiring a reason, and supersession deactivating the rule
(`active: false`).

## Known limitations

- No UI shows an aggregate "how many rules in this jurisdiction are
  actually verified vs. placeholder" summary — verification status is
  visible per-rule in the Rules list, not as a jurisdiction-wide rollup.
- `sourceDocuments` attachments use the existing safe attachment
  mechanism, but there is no dedicated viewer for comparing a rule's
  stated `requirement` text against the attached source document side
  by side.
