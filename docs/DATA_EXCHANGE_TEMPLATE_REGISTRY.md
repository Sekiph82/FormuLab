# Data Exchange template registry

`packages/shared/src/engine/dataExchangeRegistry.ts`. One data structure
drives every template's CSV generation, Excel generation, validation and
(via the desktop commit layer) persistence — adding or fixing a template
means editing its entry here, not writing a new importer.

## `DataExchangeColumnDefinition`

```ts
interface DataExchangeColumnDefinition {
  key: string;                 // machine key, matches the target field
  header: string;               // CSV/Excel column header
  description: string;          // shown in "Fields" docs and Excel's
                                 // Field Documentation sheet
  dataType: DataExchangeColumnDataType;
  required: boolean;
  nullable: boolean;
  defaultValue?: string;
  enumValues?: readonly string[];       // for dataType: "enum"
  referenceTemplate?: string;           // for dataType: "code_reference"
  referenceField?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  precision?: number;
  example: string;                      // used to build the example row
  sensitive?: boolean;                  // never included in an export
  importable?: boolean;                 // default true
  exportable?: boolean;                 // default true
}
```

### `DataExchangeColumnDataType` — 15 values

`string`, `integer`, `decimal`, `boolean`, `date`, `datetime`,
`currency`, `percentage`, `enum`, `multi_value`, `code_reference`,
`file_name`, `sha256`, `url`, `json`. Each has its own validator in
[DATA_EXCHANGE_VALIDATION.md](DATA_EXCHANGE_VALIDATION.md).

## `DataExchangeTemplateDefinition`

```ts
interface DataExchangeTemplateDefinition {
  templateId: string;
  templateCode: string;          // stable, used everywhere (dispatch,
                                  // job records, file names)
  title: string;
  description: string;
  module: string;                // groups the Template Library filter
  schemaVersion: string;         // "1.0" for every template today
  supportedFormats: readonly ("csv" | "xlsx")[];
  columns: readonly DataExchangeColumnDefinition[];
  primaryKey?: string;
  naturalKey: readonly string[]; // column key(s) forming the match key
  duplicatePolicy: DataExchangeDuplicatePolicy;
  updatePolicy: string;          // free-text summary of which fields
                                  // may change on update
  authorization: readonly ApprovalRole[];
  exampleRows: readonly Record<string, string>[];
  targetCollection: string;      // the real persisted collection
  enabled: boolean;
  disabledReason?: string;
}
```

### `DataExchangeDuplicatePolicy` — 5 values

- `create_only` — a natural key that already exists is refused.
- `create_or_update` — an existing natural key's mutable fields update in
  place. Only used for target collections whose Rust `append_only` flag
  is `false`.
- `append_history` — a repeat natural key with a different validity
  period (e.g. a price) is appended, never overwritten.
- `new_revision` — an existing natural key requires a genuinely new
  revision/version identifier; overwriting in place is refused. Used for
  every `append_only: true` target collection.
- `reject_conflict` — an update to an immutable field is refused outright
  (e.g. a saved formula version).

Every template's `duplicatePolicy` was cross-checked against the real
Rust `append_only` flag for its `targetCollection`
(`apps/desktop/src-tauri/src/masterdata.rs`) — this was corrected
mid-development for `packaging_bom`, `lab_results`, `regulatory_rules`,
`dossier_requirements`, `dossier_evidence` and `label_content` after
verifying the actual flag rather than assuming one.

## Role groups

`authorization` is built from named role-group constants so the
authorization story is auditable at a glance:
`MASTER_DATA_ROLES` (administrator only), `QUALITY_MASTER_DATA_ROLES`,
`FORMULATION_ROLES`, `COST_ROLES`, `LAB_ROLES`, `REGULATORY_ROLES`,
`DRAFT_CONTENT_ROLES`, `DOE_ROLES` — matching the spec's guidance
(researcher/chemist for ordinary formulation/lab/DOE draft data, quality
for quality-related structural data, regulatory/quality/administrator
for regulatory structural data, administrator for global master data).
See [DATA_EXCHANGE_IMPORTS.md](DATA_EXCHANGE_IMPORTS.md#authorization).

## Helpers

`getDataExchangeTemplate(templateCode)`, `listDataExchangeTemplates()`,
`isDataExchangeRoleAuthorized(templateCode, role)`. `DATA_EXCHANGE_TEMPLATES`
is the array of all 44 `template({...})` calls — the single source of
truth `dataExchangeRegistry.test.ts` checks for: exactly 44 templates,
unique codes/ids, unique column keys per template, a non-empty natural
key pointing at real columns, `schemaVersion: "1.0"`, CSV+Excel support,
at least one authorized role, at least one example row using only real
column keys with every required column filled in, `TEST-` prefix
convention for example codes, and — the guard that matters most — that
no example row or default value ever pre-sets a verification/approval
field (`verification_status`, `verified_by`, `verified_at`,
`approved_supplier`, `approved`, `status`) to a verified/approved value.
