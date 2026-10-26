# V01 Code-Level Reuse Map

Audit scope: branch `V01`, task `V01-00.001`, inspected 2026-10-26. This map records the existing production authorities V01 must extend. It is based on the implementation and tests named below; historical design prose is not treated as proof where current code differs.

## Existing connector and import path

```text
Customer source
  -> SourceConnector extraction contract
  -> FILE / REST_API / DATABASE adapter
  -> staged source records + lineage
  -> schema discovery
  -> versioned mapping profile + deterministic transformations
  -> external-ID crosswalk resolution
  -> canonical Data Exchange candidate rows
  -> Data Exchange preview / validation / human review
  -> explicit Data Exchange commit
  -> existing master-data collections and import history
```

| Capability | Existing implementation | Reuse boundary for V01 |
|---|---|---|
| Connector contract and lineage | `packages/shared/src/schemas/connector.ts` (`SourceConnector`, `ConnectorResult`, `StagedSourceRecord`, identity, extraction and lineage schemas) | Extend this connector capability model for provider surfaces and supplier documents. Keep extraction read-only; do not add canonical-write methods. |
| Generic files | `packages/shared/src/engine/fileConnector.ts`; desktop XLSX support in `apps/desktop/src/lib/xlsx.ts` | Reuse common staging and source metadata for user-selected catalog exports and manual-assisted document intake. Avoid a second file import path. |
| REST API | `packages/shared/src/engine/restApiConnector.ts` | Reuse the generic REST extraction and connection reference pattern where a supplier publishes an authorized API. Supplier-specific discovery/auth behavior belongs in declared adapter capabilities, not a parallel generic connector framework. |
| Database inspection | `packages/shared/src/engine/databaseConnector.ts`, `apps/desktop/src-tauri/src/connector_sqlite.rs` | Reuse for customer-authorized database sources. The SQLite implementation opens databases read-only and exposes schema inspection/select behavior; it is not a supplier portal crawler. |
| Connection persistence | `packages/shared/src/engine/connectorConnection.ts`, `apps/desktop/src/lib/connectorPersistence.ts`, `apps/desktop/src/lib/connectorConnections.ts`, and master-data `connector_connections` | Reuse lifecycle and opaque references. V01 must add supplier/surface capability metadata without persisting plaintext credentials or session tokens. |
| Source-schema discovery | `packages/shared/src/engine/schemaDiscovery.ts` | Reuse observed field types, identifiers, units, relationships, and schema fingerprints. Do not treat inferred names or unique labels as authoritative product identity. |
| Mapping profiles | `packages/shared/src/schemas/connector.ts` (`mappingProfileSchema`), `packages/shared/src/engine/mappingProfile.ts` | Reuse versioned profiles and preflight validation for external catalog data. Existing profile versions are append-only. |
| Transformations and units | `packages/shared/src/engine/transformation.ts`, `packages/shared/src/engine/unitConversion.ts` | Reuse the closed deterministic operation set and single generic unit-conversion authority. Do not introduce executable mapping scripts or use density to infer a mass/volume conversion in this layer. |
| External identity crosswalk | `packages/shared/src/engine/crosswalk.ts`; `external_id_crosswalks` persistence | Reuse explicit external-ID-to-canonical-ID binding and conflict behavior. Names, CAS alone, or fuzzy similarity cannot silently establish a product/grade match. |
| Incremental re-import | `packages/shared/src/engine/dataExchangeIncremental.ts` | Reuse re-import classification, prior-commit lineage, and missing-from-source findings. Missing catalog entries are review signals, not deletion instructions. |
| Connector-to-Data-Exchange orchestration | `packages/shared/src/engine/connectorImportBridge.ts` and `apps/desktop/src/lib/connectorImportBridge.ts` | Reuse preparation, preview, conflict checks, explicit confirmation, and post-commit crosswalk persistence. The desktop bridge is the production orchestration path; older prose in `docs/FVL04_EXTERNAL_SOURCE_CONNECTOR_ARCHITECTURE.md` contains historical pre-bridge text and should not be read as evidence that the bridge is absent. |
| Canonical import authority | `packages/shared/src/engine/dataExchangeValidation.ts`, `packages/shared/src/engine/dataExchangeRegistry.ts`, `apps/desktop/src/lib/dataExchangeCommit.ts`, `apps/desktop/src/lib/dataExchangeExisting.ts` | Keep Data Exchange preview, validation, human review, commit, and import history as the only ordinary path that changes canonical records. V01 acquisition must not write directly to `RawMaterial`. |

## Existing material, document, audit, and backup authorities

| Capability | Existing implementation | Reuse boundary for V01 |
|---|---|---|
| Material master | `packages/shared/src/schemas/materials.ts`, `apps/desktop/src-tauri/src/materials.rs`, Data Exchange `materials` template | Preserve the existing `RawMaterial` identity and governed update route. Supplier values remain source evidence/candidates until authorized field-level application. |
| Material-document metadata | `material_documents` master-data collection; `apps/desktop/src/components/formula/MaterialDocumentsPanel.tsx`; attachment/blob utilities | Extend existing material-document links for supplier, product, revision, and extraction provenance. Do not create a second document-library authority. |
| Collection persistence/policy | `apps/desktop/src-tauri/src/masterdata.rs`, `packages/shared/src/engine/masterdataPolicyAreas.ts`, `masterdataCollectionAreas.generated.json` | Add metadata collections only when necessary and register them consistently with schema, policy, generated registry, and backup behavior. Existing `mapping_profiles` are append-only; crosswalk/connection collections follow their documented mutation policy. |
| Backup and restore | `apps/desktop/src-tauri/src/backup.rs`, UI/API in `apps/desktop/src/lib/tauri.ts`, automatic backup in `apps/desktop/src-tauri/src/automatic_backup.rs` | The package walks formulations, master-data files, sessions, formulas, selected workspace provenance/log files. `.FormuLab/runs.db`, ad-hoc master backups, and network literature cache are excluded. Any new binary document store outside included paths needs explicit backup, restore, hash, and compatibility coverage. |
| Production connector UI | `apps/desktop/src/app/routes/DataExchangePage.tsx` mounts `ConnectorManagementShell`; screens under `apps/desktop/src/components/dataExchange/connectors/` | Extend the existing Connections, Source Explorer, Mapping Profiles, Crosswalks, Import Runs, and Prepare Review surfaces. Avoid a competing supplier settings/import console. |
| Acceptance coverage | Shared connector, mapping, crosswalk, schema, incremental, REST/file/DB tests; `apps/desktop/src/lib/connectorEndToEnd.test.ts`; Data Exchange route/component tests | Extend focused tests around reused authorities. V01-00.010 owns the baseline checkpoint; this audit task does not claim those suites were run here. |

## V01 additions that are not present in the audited foundation

The connector/data-exchange foundation does not itself provide supplier product catalogs, supplier portal sessions, document discovery/download, immutable acquired PDF binaries, SDS/TDS parsing, field-level extraction review, or a reference-formulation corpus. These are V01 additions. They should be implemented as supplier-specific capabilities and evidence-processing stages that feed existing document/material/Data Exchange authorities, not as replacements for them.

The acquisition and intelligence path must preserve original supplier identity, source URL, product/grade ambiguity, document revision, content hash, and per-field evidence. Extracted or normalized data is a proposal. SDS composition does not prove complete commercial composition; Section 3 concentration does not establish active matter; supplier formulation examples are not measured validation; and missing values remain unknown. Existing authorization, safety, regulatory, approval, laboratory, audit, and Data Exchange gates continue to govern their respective decisions.

## Existing material and evidence schema inventory

This is the V01-00.003 field-level inventory. Existing schemas are the reuse baseline; gaps below are additions V01 still needs to model.

| Record | Existing identity and useful fields | Exact V01 gap / safe extension |
|---|---|---|
| `RawMaterial` (`packages/shared/src/schemas/materials.ts`) | Stable `code`; display/trade/INCI/IUPAC names; arrays of CAS/EC numbers; manufacturer/origin; form, appearance/color/odor; active matter and state; solids/water; density, pH/viscosity ranges, HLB, ionic character, solubility; functions, recommended/technical use ranges; storage/shelf life; document references; market regulatory statuses; hazards/allergens/incompatibilities/substitutes; active and timestamps. | V01 must not use these fields as a document-extraction sink. Add source-linked proposal records that retain original and normalized values, units/conditions, evidence location, method/confidence, identity match, revision and reviewer decision. Only an authorized field-level application can update the master. |
| `Supplier` and `MaterialSupplier` (`materials.ts`) | Supplier identity/legal/display name, country/contact and commercial terms, approved/quality status; material-supplier relationship with supplier trade name and supplier material code, preferred/qualified flags. | These identify counterparties and supply relationships, not provider login, portal surface, catalog scope, or a supplier's full product/grade catalogue. Keep account/surface connections separate; do not infer material identity from supplier name or CAS alone. |
| `MaterialDocument` (`packages/shared/src/schemas/dataExchange.ts`) | Stable code and `materialCode`; optional `supplierCode`; type (SDS/TDS/COA/spec/certificates/declarations); number/title/revision/language/issuer; issue/expiry; optional `fileName`/expected SHA-256; unverified/verified/expired/superseded status and verifier identity/time; tags, notes, timestamps. It is metadata only: Data Exchange import does not attach file bytes. | Missing: provider/surface/account scope, original source URL and source product/grade IDs, acquisition time, actual content hash/blob reference, revision/supersession lineage, access/retention rights, parse status and document-to-catalog discovery lineage. Reuse this metadata record; define binary lifecycle explicitly before adding storage. |
| `RawMaterial.documents[]` (`documentRefSchema` in `materials.ts`) | Legacy inline reference: kind, title, project-relative path or URL, issue/expiry, supplier code, notes. | Less structured than `MaterialDocument`; it has no document revision, actual hash, verification, acquisition provenance, field extraction or immutable lineage. Preserve historical references and converge new catalog/document metadata through the existing `material_documents` collection rather than creating another registry. |
| Attachment reference (`packages/shared/src/schemas/testDefinitions.ts`) | ID, kind, title, project-relative location, capture metadata/notes; optional category, original filename, MIME, size, SHA-256, who/when added, description and replacement pointer. Rust copies allow-listed user-picked files to generated names under a formulation's `attachments/` directory. | Current managed attachment flow is formulation-context evidence (lab/stability/corrective-action), not a shared supplier/material document vault. V01 needs a deliberate material-document blob/link lifecycle, safe file admission, immutable identity and backup/restore coverage; do not assume an attachment reference alone stores or imports supplier PDFs. |
| Approval (`packages/shared/src/schemas/formulation.ts`) | Append-only `ApprovalRecord` bound to formulation/version, named human and role, decision/status, justification, and frozen readiness/lab/stability/regulatory/dossier/claims/validation/cost/run snapshots. Approval is a governed business decision. | Not a generic extraction review. Do not create approval records when a parser extracts or a user accepts a data proposal; preserve this authority for formula approval and the authorized actor requirements. |
| Verification and evidence review | Domain-specific statuses and named actors exist on `MaterialDocument`, regulatory rules/reviews, dossier evidence and links, safety/hazard records, test definitions/results, and product claims. Imports default to unverified/unreviewed states; their domain workflows own verification and review. Dossier evidence carries attachments, issuer/dates/language/confidentiality, verification/rejection/revocation, and supersession; claim evidence links refer to dossier evidence and keep review snapshots. | There is no shared supplier-extraction decision schema in the inspected domain schemas. Add a field-level proposal/review lifecycle, distinct from safety/regulatory verification and product-claim approval. Imported documents/extractions cannot set a domain's verified or approved status. |
| Audit and provenance | Formulation `AuditEvent` records formulation/version, timestamp, actor and actor kind, action/detail and optional structured string metadata. Formulation-line `Provenance` records evidence origin, optional 0–1 confidence, evidence claim IDs and notes. Security audit events separately record account/security actions. | These are not a complete per-document/per-field extraction lineage. V01 needs references to immutable document/revision identity, source page/section/quote or coordinates, original/normalized value and unit, parser/OCR/mapping version, and append-only reviewer decision; never put document contents or secrets in security audit text. |

### Schema-level V01 invariants

1. `material_documents` is the canonical metadata collection, but it currently neither stores PDF bytes nor represents extracted values.
2. Supplier products and grades are not identical to `RawMaterial`; commercial blends may resolve to multiple chemical components or remain partially disclosed/ambiguous.
3. A supplier document's identity, revision, market, language, and acquisition record must remain separate from the extraction proposals it supports.
4. Extraction status and approval status must remain separate: accepting a field proposal is not MaterialDocument verification, regulatory verification, claim support, or formula approval.
5. New metadata collections and blob paths require explicit policy/registry, backup/restore, migration and audit treatment. The existing formulation attachment path does not automatically cover supplier catalog documents.

## Implementation guardrails derived from this audit

1. Add provider/surface behavior through the existing connector contract and connection lifecycle; do not build a second generic connector or Data Exchange framework.
2. Route imported catalog rows through existing mappings, crosswalk review, Data Exchange preview, validation, and explicit commit.
3. Keep source documents and extracted field proposals linked to existing material-document and evidence authorities; never silently overwrite `RawMaterial`.
4. Before adding a document binary store or metadata collection, define its master-data/attachment ownership, backup/restore path, revision immutability, retention behavior, and compatibility tests.
5. Treat unavailable supplier access as an explicit scope gap and use authorized user-attended or manual-assisted workflows; do not bypass portal controls.
