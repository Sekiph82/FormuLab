# Cost engine

`packages/shared/src/engine/cost.ts`. Open the **Cost** tab inside a formula
project.

## Layers stay separate

Raw-material cost is not manufacturing cost. Merging them produces one ambiguous
number that answers no actual question — "can we hit the shelf price?" and
"should we switch supplier?" read different layers of the same calculation.

```
base raw-material cost      price × quantity, converted to the report currency
landed raw-material cost    + freight, duty, insurance, port, inland, loss uplift
+ direct labour
+ utilities                 electricity, water, steam, compressed air
+ quality control
+ waste and process loss
+ factory overhead
= total manufacturing cost

cost per kg                 total ÷ yield  (not ÷ batch size — see below)
cost per litre              when a density is known
cost per SKU                bulk fill + packaging + conversion, per pack format
```

Cost per kg divides by the **yield**, not the batch size. The cost of what is
lost in process is carried by what survives.

## Missing data is never zero

Three distinct reported states, each with its own warning:

| `missingReason` | Meaning |
| --- | --- |
| `no_price` | No price record for this material on this date |
| `no_exchange_rate` | Price is in a currency with no rate to the report currency |
| `expired_price` | Only an out-of-date price exists; it was used, and flagged |

A line that cannot be costed is excluded and the total is reported as a lower
bound. It is never quietly counted as zero — that is the failure mode that makes
a costing tool dangerous, because the total looks complete and is wrong in the
cheap direction.

A per-litre price with no recorded density is also refused rather than converted
on a guess.

## Exchange rates

**Nothing is ever fetched.** Rates are records a person entered or imported,
each carrying its effective date and a required source, and every cost shows
which rate it used.

`findRate` picks the most recent rate not later than the date being costed —
never a future rate, and never today's rate for a March calculation. If only the
opposite pair exists it is inverted. If no rate exists it returns `undefined`;
two currencies are never assumed to be at parity.

There is deliberately no triangulation through a third currency: an implied rate
is not a rate anyone quoted, and it would appear in a snapshot as if it were.

## Landed cost

Each charge is allocated by a stated basis, and the basis is recorded on the
result. "Freight 400,000" means nothing without knowing whether that was per
kilo or for the whole container.

| Basis | Effect |
| --- | --- |
| `per_kg` | Added directly to the unit price |
| `per_shipment` | Divided by `shipmentQuantity`. **Dropped** if that is absent, rather than multiplying a container's freight onto every kilo |
| `percent_of_goods` | Percentage of the base price |
| `fixed` | Added directly |

Expected loss uplifts the cost of what survives: at 2% loss the usable kilo
costs `price ÷ 0.98`.

## Packaging and SKU costing

A packaging SKU has a bill of materials of components. Carton and case
components are allocated fractionally — one case over twelve units is `0.0833…`
of a case per unit — so `quantityPerUnit` is a decimal, not a count.

Each component carries a waste factor, because more components are bought than
ship.

The fill is converted to mass through density, so a volume-filled product is
costed on what the tank actually gives up, not on the nominal millilitres.
Overfill (`fillLossPercent`) is applied first.

The UI keeps these separate:

```
bulk cost per unit     formula cost of the product in the pack
packaging cost         components + waste
filled unit cost       bulk + conversion
packed unit cost       filled + packaging
case cost              packed × units per case
```

A 250 ml bottle and an 8 ml sachet of the same shampoo share a formula version
and produce very different SKU costs. That is the whole reason family and SKU
are separate entities.

## Factory cost profiles

Editable, dated profiles hold the plant's own conversion costs: electricity per
kWh, water per m³, steam, compressed air, labour rate and hours, QC basis,
process loss, overhead.

Every figure is optional. A factory that has not measured its steam cost gets a
cost without steam in it, plus a warning saying so — not a plausible invented
figure.

Each profile carries a `verification` field: `verified`, `not_verified`, or
`example_only`. An `example_only` profile produces a loud warning on every cost
it touches. No profile ships with numbers presented as this factory's costs; a
plausible-looking Kenyan electricity tariff that nobody checked would silently
become the basis of a pricing decision.

## Snapshots

A snapshot is an immutable costing of one formula version. It records every
input it used: the price record codes, the exchange rate codes, the packaging
component codes and the factory profile.

That is what lets someone open a six-month-old costing and see it used the March
freight quote and the rate from the day before, rather than wondering why the
number no longer reproduces.

Updating a current price does **not** rewrite a historical snapshot. The
`cost_snapshots` collection is append-only at the storage layer, and
`upsert_master_records` rejects an existing code with an explanatory error. To
get a current figure, create a new snapshot.

## Cost comparison

`compareCostSnapshots` reports the difference in each layer and attributes it by
comparing which **inputs** differ — formula lines, price record ids, rate ids,
packaging components, profile.

If both the formula and the prices moved, both causes are reported. The engine
does not invent a split between them, because any split would be arbitrary.

Causes: `formula_change`, `price_change`, `exchange_rate_change`,
`packaging_change`, `factory_cost_change`, `missing_data`.

When either snapshot has missing data, the comparison says so — part of the
difference is an artefact of what could not be costed, not a real cost movement.

## Known limitations

- Packaging components and BOMs have schemas, storage, costing and tests, but
  **no dedicated editing UI**; they are populated through the master-data store
  or by import.
- Factory cost profiles likewise have no editor screen yet; they are selected in
  the Cost tab but entered through the store.
- No margin, pricing or profitability modelling.
- Utilities are modelled per batch, not per process step.
