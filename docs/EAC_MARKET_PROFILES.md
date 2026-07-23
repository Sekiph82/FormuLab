# EAC market profiles

How the East African Community regional bloc fits into the seven
supported jurisdictions — see [REGULATORY_ENGINE.md](REGULATORY_ENGINE.md)
for the wider engine.

## EAC is a bloc profile, not a country

`REGULATORY_JURISDICTIONS` includes six member states (`KE`, `UG`, `TZ`,
`RW`, `BI`, `SS`) plus `EAC` itself
(`packages/shared/src/schemas/regulatory.ts`). `EAC_MEMBER_STATES` is the
list of the six states an `EAC`-scoped rule overlays.

## Overlay, never replace

A rule with `jurisdiction: "EAC"` applies **alongside** a member state's
own national rules when evaluating a formula for that state —
`ruleApplies` (`engine/regulatoryRules.ts`) treats a match on `EAC` plus
`EAC_MEMBER_STATES.includes(ctx.jurisdiction)` as equivalent to a direct
jurisdiction match. Evaluating a formula for `KE` therefore returns
findings from both Kenya-specific rules and any active `EAC` rule; it
never suppresses one in favor of the other, and nothing in this codebase
resolves an overlap between a national rule and an EAC rule
automatically — if both apply to the same ingredient or claim, both
findings are shown, and a human reviewer reconciles them.

## Selecting EAC directly

The desktop Regulatory tab's jurisdiction picker also lets selecting
`EAC` directly as the evaluation context — useful for reviewing only the
regional-bloc requirements (an EAC conformity mark, a
harmonized-standard test) in isolation from any single member state's
national rules. In that mode, `ctx.jurisdiction === "EAC"` and only rules
whose own `jurisdiction` is exactly `"EAC"` apply (the overlay direction
only runs from `EAC` down to a member state, not the reverse).

## Seed EAC rules

`EAC-REG-001` (market-specific identifier — an EAC-wide conformity mark)
and `EAC-REG-002` (testing requirement — an EAC-harmonized efficacy test
for disinfectant/biocidal products), both `not_verified` structural
placeholders. See [REGULATORY_RULES.md](REGULATORY_RULES.md).

## Multi-jurisdiction approval readiness

`resolveRegulatoryJurisdictions` (`engine/regulatoryApproval.ts`) can
resolve to more than one of the seven jurisdictions above at once — an
explicit `requiredRegulatoryJurisdictions` list, or every one of a
formulation's `targetMarkets` when `requireAllTargetMarketsReviewed` is
set. `EAC` itself can appear in that resolved list like any other
jurisdiction (evaluating the regional-bloc requirements in isolation,
same as selecting it directly in the Regulatory tab), or a formulation
can require review in several member states plus `EAC` together. See
[REGULATORY_MULTI_MARKET_APPROVAL.md](REGULATORY_MULTI_MARKET_APPROVAL.md).

## Known limitation

No automatic conflict resolution exists between a national rule and an
overlapping `EAC` rule — see
[REGULATORY_ENGINE.md](REGULATORY_ENGINE.md#known-limitations). This is
deliberate: silently picking one over the other would hide a genuine
regulatory question a human needs to answer.
