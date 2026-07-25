# Data Exchange validation

`packages/shared/src/engine/dataExchangeValidation.ts`. Deterministic,
local, pure — never an LLM as validation authority. An AI may explain a
validation error to a user elsewhere in the product; it never produces
the error itself, the same rule the Compatibility/Safety/DOE engines
follow. The whole engine is one function,
`previewDataExchangeImport(template, rawRows, opts)`, and it never
writes anything — that is the entire point of a preview.

## Job-level fatal checks (in order)

Checked before a single row is parsed:

1. Template disabled (`template.enabled === false`).
2. Acting role not in `template.authorization` — sets
   `authorizationDenied: true`, and per
   [DATA_EXCHANGE_IMPORTS.md](DATA_EXCHANGE_IMPORTS.md#authorization),
   nothing is ever persisted for this case.
3. File larger than `DATA_EXCHANGE_MAX_FILE_BYTES` (25 MB).
4. Empty file.
5. More than `DATA_EXCHANGE_MAX_ROWS` (20,000) data rows.
6. A duplicate header (case/whitespace/punctuation-insensitive
   comparison).
7. A required column's header missing.

Any of these sets `fatalError` and returns immediately — every row would
otherwise be reported `unsupported`, but in practice no rows are even
looked at.

## Cell-level validation, per data type

`validateCell(column, raw)` — one branch per
`DataExchangeColumnDataType`:

- `string`/`file_name` — accepted as-is.
- `url` — must match `^https?://\S+$`.
- `sha256` — must be 64 hex characters, lowercased on store.
- `json` — must `JSON.parse` successfully.
- `integer` — `^-?\d+$`, then min/max range check.
- `decimal`/`currency`/`percentage` — parsed with the shared
  `parseHumanDecimal` (locale-independent, handles both decimal
  conventions), then min/max, and `percentage` additionally requires
  0-100.
- `boolean` — a small set of yes/no tokens including Turkish
  (`evet`/`hayır`) and German/French tokens, not just `true`/`false`.
- `date` — strict `YYYY-MM-DD`, parseable.
- `datetime` — ISO 8601 with optional seconds/fraction/timezone.
- `enum` — case-insensitive match against `column.enumValues`; the
  matched canonical value (not the raw text) is stored.
- `multi_value` — split on `;`, `,` or `|`, trimmed, rejoined with `;`.
- `code_reference` — stored as-is; resolved separately (below).

## Reference resolution

A `code_reference` column with `referenceTemplate` set and a
`resolveReference` callback provided:

- If it points at another template and doesn't resolve: **required** →
  `reference_missing` (blocks commit); **optional** → `warning` (row
  still committable, message notes it can be filled in later).
- If it points at its own template (`referenceTemplate === template.templateCode`),
  it's treated as always resolved — the row it points at may be later in
  the same file.
- Without a `resolveReference` callback at all, a reference column is
  only checked for non-emptiness (used by the pure validation-engine
  tests, which don't have live collection access).

The desktop upload dialog always supplies a real `resolveReference`
backed by `apps/desktop/src/lib/dataExchangeExisting.ts`'s live lookups
— references are checked against real data, never assumed.

## Row classification, in priority order

1. **`invalid`** — a required column empty, a cell that failed
   `validateCell`, an empty natural key, or (further down) an update to
   an immutable field under the template's `updatePolicy`.
2. **`reference_missing`** — an unresolved *required* reference (checked
   after per-cell validation, since a malformed reference value is
   reported as `invalid` first).
3. **`duplicate`** — the row's natural key already appeared earlier in
   this same file.
4. **`unchanged`** — the natural key exists in the target collection and
   an optional `isUnchanged` deep-comparator reports no real change.
   Without that comparator, any match against `existingNaturalKeys` is
   reported `valid_update` instead — `unchanged` is an optimization, not
   a requirement.
5. **`warning`** — an unresolved *optional* reference, or any other
   non-blocking message accumulated for the row.
6. **`valid_create`** / **`valid_update`** — everything else, split by
   whether the natural key already exists.

## Natural keys

`naturalKeyOf(template, record)` joins `template.naturalKey`'s column
values with `::`. A row whose natural key is entirely empty is always
`invalid` — matching can't be done safely without one.

## Limits

`DATA_EXCHANGE_MAX_ROWS = 20_000`, `DATA_EXCHANGE_MAX_FILE_BYTES = 25 MB`
— both real, enforced job-level fatal checks, not aspirational numbers.

## Also accepts raw CSV text

`previewDataExchangeImportCsv(template, text, opts)` wraps
`previewDataExchangeImport` with `parseCsv(text)`, for any caller that
hasn't already split rows (e.g. a future scripted/headless import path).
