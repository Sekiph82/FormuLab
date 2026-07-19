# Raw materials, suppliers, prices and inventory

Open **Materials** in the sidebar.

## Identity

A material is the **chemistry**, and its stable `code` is its identity. Display
names change; codes must not, because saved formulas, cost snapshots and ERP
exports reference them.

A trade name is a supplier's marketing asset. The same chemistry ships as
"Texapon N70", "Empicol ESB70" and a dozen others, and one trade name can come
from several suppliers. So supply is a separate relationship
(`MaterialSupplier`), not a field on the material.

## "We do not know" is a real answer

Every uncertain field can say which kind of not-knowing applies:

```
known | missing | unknown | not_applicable | not_verified
```

A missing active-matter figure is not zero. An unrecorded CAS number is not
"none". An unverified regulatory position is not "compliant".

The list shows a material with no recorded active matter as **not recorded**, in
warning colour, everywhere it appears. A blank that reads as a fact is how a
wrong number reaches production.

Regulatory status records default to `not_verified` and stay there until a
person records a source. FormuLab has no verified Kenyan or EAC ruleset, so
unverified is the honest default rather than an oversight.

## Material fields

Identity: code, display name, trade name, INCI, IUPAC, CAS numbers (several —
a material can be a mixture), EC numbers, manufacturer, country of origin.

Physical: form, appearance, colour, odour, active matter %, solids %, water %,
density, pH range, viscosity range, HLB, ionic character, solubility.

Use: functions (several — a betaine is a surfactant *and* a thickener),
recommended min/max %, technical max %, storage conditions, shelf life.

Compliance and supply: SDS/TDS/COA document references, regulatory status
records per market, hazard classifications, allergens, incompatibilities with
reasons, substitute codes, notes, active flag.

Only `code` and `displayName` are required. A chemist adding a material at 4pm
has the code and the name, not the HLB; the form's job is to let them record
what they know and come back.

Hazard classifications are recorded verbatim from the SDS. They are never
inferred from the chemistry.

## Deactivate, do not delete

Existing formulas and cost snapshots still reference a material after you stop
buying it. Clear the **Active record** checkbox instead; the list hides inactive
materials unless you ask for them.

## Suppliers

Code, legal name, display name, country, contact, email, phone, quoting
currency, incoterm, payment terms, lead time, MOQ notes, approved-supplier flag,
quality status.

A new supplier starts **unapproved** with quality status `not_assessed`.
Approval is a quality decision, so it is not a default.

## Price history

Prices are **append-only**. A new quotation is a new record; the old one stays,
because a cost snapshot taken in March must keep meaning what it meant in March.

Each record holds price, currency, price unit, MOQ, effective from/to,
quotation reference, incoterm, and the landed-cost components (freight,
insurance, duty, tax, port charges, inland transport, bank charges, other),
their allocation basis, shipment quantity and expected loss.

`verification` records whether the figure is `quoted`, `invoiced`, `estimated`
or `not_verified`. An imported price is `not_verified` until someone checks it
against the invoice.

The list shows the computed landed unit cost beside the base price. See
[COST_ENGINE.md](COST_ENGINE.md) for how the allocation works.

## Inventory

Material, warehouse, lot, supplier lot, quantity, unit, reserved and available
quantity, manufacturing and expiry dates, COA status, quarantine and release
flags, unit cost.

Quarantined and released are separate facts, not one flag — a lot can be neither
while its COA is pending.

This is enough for R&D decisions and future ERP integration. It is **not** a
full ERP inventory module: no goods receipt, issue, transfer or stock movement
history.

## Exchange rates

Also append-only. Base currency, quote currency, rate, effective date, a
**required** source, entry method and verification status.

FormuLab never fetches a rate. See [COST_ENGINE.md](COST_ENGINE.md).

## Storage

One JSON array per collection under `data/master/` in the project folder:

```
materials.json            suppliers.json
material_prices.json      inventory.json
packaging_components.json packaging_boms.json
exchange_rates.json       factory_profiles.json
cost_snapshots.json       backups/<collection>-<timestamp>.json
```

Plain JSON rather than a database, deliberately: the point of keeping FormuLab's
data in the project folder is that a chemist can open it, read it, send it to a
colleague and back it up with the rest of the project. A binary database would
take that away for no benefit at this data volume.

Writes are write-then-rename, so an interrupted write cannot truncate the file
holding the factory's entire material library. Destructive operations snapshot
the collection into `backups/` first.

The collection name is an allow-list on the Rust side; joining untrusted text
onto a path is how a renderer bug becomes an arbitrary file write.

## Known limitations

- Supplier editing is create-and-import only; there is no supplier detail form.
- Material–supplier links, substitutes and material-function rows have import
  schemas but no dedicated UI.
- SDS/TDS/COA documents are modelled as references; there is no upload or
  viewer.
- Inventory has no movement history.
- No list virtualisation. Fine for a few thousand rows; revisit beyond that.
