# Precision policy

Every number a factory or an invoice depends on passes through
`packages/shared/src/engine/decimal.ts`. Nothing else parses, rounds or formats
a decimal.

## Why

Binary floating point cannot represent 0.1 exactly. In JavaScript:

```js
0.1 + 0.2 === 0.30000000000000004
```

Two consequences matter here.

A formula assembled from decimal percentages can total 99.99999999999999% and
fail a naive equality check against 100 — so the builder would refuse a formula
that is arithmetically correct, or accept one that is not, depending on which
way the error fell.

At batch scale the same drift is physical. A 0.0000001% error on a 2000 kg batch
is 2 mg, which is nothing; but errors compound across thirty lines and two unit
conversions, and the point at which they stop being nothing is not something
anyone should have to reason about at 6am on a production floor.

So all arithmetic uses `decimal.js`, and percentages, quantities and money are
stored as **decimal strings**, never as JS numbers.

## Settings

```
internal arithmetic     28 significant digits, ROUND_HALF_UP
formula percentage       4 decimal places
batch quantity           4 decimal places
unit price               6 decimal places
currency total           2 dp by default, per-currency override
density                  4 decimal places
ratio                    6 decimal places
```

`ROUND_HALF_UP` rather than banker's rounding, because that is what a chemist
doing the same sum by hand produces. A mismatch between the screen and the bench
sheet is a support call, even when the screen is "more correct".

### Why these numbers

- **Percentage, 4 dp.** Finer than any dosing pump or weighing scale in the
  plant. 0.0001% of a 1000 kg batch is 1 mg.
- **Batch quantity, 4 dp of a kg.** 0.1 g, below any factory scale.
- **Unit price, 6 dp.** Bulk salts and fillers are quoted per gram in fractions
  of a shilling; 2 dp would round several of them to zero.
- **Currency, per-currency.** KES, USD, EUR, GBP and TRY are all 2 dp. The map
  in `CURRENCY_DP` exists so that adding a 0 dp or 3 dp currency is a data
  change, not a code change.

## Rounding happens once

Intermediate results are never rounded. Rounding is applied at exactly one
boundary: display, or storage into a schema field.

This matters because rounding twice makes a total stop matching the sum of the
lines shown above it — the single most common way a costing screen loses a
user's trust.

```ts
// Right: exact all the way through, rounded once at the end.
const total = lines.reduce((acc, l) => acc.plus(dec(l.percent)), ZERO);
return fmt(total, "percent");

// Wrong: each line rounded, then summed. The total will not match.
const total = lines.reduce((acc, l) => acc.plus(new Decimal(fmt(dec(l.percent)))), ZERO);
```

## Human input

`parseHumanDecimal` reads both decimal conventions, because a supplier in
Nairobi, one in Istanbul and one in Hamburg will send three files that disagree
about which separator means what.

```
"1.234,56"  → 1234.56   (last separator is the decimal point)
"1,234.56"  → 1234.56
"12,5"      → 12.5
"1,234"     → 1234      (a lone three-digit group is grouping, not a decimal)
"1,23"      → 1.23
"n/a"       → undefined (never a guess)
```

The rule is positional — whichever separator appears last is the decimal
point — with the ambiguous single-separator case resolved by digit grouping.
Anything that is not a number returns `undefined` rather than a plausible wrong
answer.

## Missing is not zero

A blank active-matter figure, a material with no price, a currency pair with no
rate: none of these are zero. They are reported as what they are, and any total
computed over them is labelled a lower bound.

- `computeTotals` returns `unknownActivePercent` alongside the active total.
- `functionalSummary` marks a group `incomplete` and names the unknown share.
- `costFormula` sets `missingReason` per line and adds a warning.

A silently-zero line is the failure mode that makes a costing tool dangerous:
the total looks complete and is wrong in the cheap direction.

## Where to look

| Concern | File |
| --- | --- |
| Parsing, rounding, formatting | `packages/shared/src/engine/decimal.ts` |
| Formula totals, q.s., scaling | `packages/shared/src/engine/formula.ts` |
| Cost arithmetic | `packages/shared/src/engine/cost.ts` |
| Tests | `packages/shared/src/engine/decimal.test.ts` |
