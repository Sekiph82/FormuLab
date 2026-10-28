# Supplier Catalog Acquisition and Document Intelligence — Task Plan v0.1

## Goal and scope

FormuLab should connect to supplier systems that a customer is authorized to use, discover the accessible product catalog, acquire available product data and documents, report coverage and gaps, and support repeatable synchronization. Each supplier and access surface has its own adapter and capability profile.

“All products” means all products exposed to the connected account for the configured supplier surface, market, language, product line, and authorization. The system must report the scope it actually covered and must not imply access to products or documents that were unavailable. Automated access is permitted only where the supplier's terms and the customer's authorization allow it. Otherwise, use user-attended or manual-assisted workflows.

Acquired documents and extracted values are evidence-backed source records. TDS/SDS values are proposals and must never silently overwrite `RawMaterial`. Applying a value to a master record requires field-level review and an explicit authorized user action.

## Milestone SDM-00 — Research and scope definition

- **SDM-00.001 — Define customer workflows:** Specify single-product lookup, bulk catalog discovery, first connection, recurring synchronization, and manual document import. Acceptance: user roles, tenant/customer boundary, and workflows are explicit.
- **SDM-00.002 — Define “full catalog” coverage:** Scope products, documents, and fields by provider account, surface, market, language, product line, and user entitlement. Acceptance: completeness claims are tied to a measurable scope; inaccessible or unknown scope is reported as a gap.
- **SDM-00.003 — Classify access methods:** Define official APIs, bulk feeds/downloads, public search, user-attended portal sessions, and manual import. Acceptance: a surface with unverified automation permission is not marked READY for automated acquisition.
- **SDM-00.004 — Build supplier/surface coverage matrix:** Research CHT, Nouryon, Clariant, Dow, DyStar, Archroma, BASF, and Evonik by surface, market, language, product line, document type, authentication, and research status. Acceptance: every entry has evidence and an observation date; unknowns remain explicitly unknown.
- **SDM-00.005 — Review terms and authorization:** Verify API terms, portal conditions, rate limits, download/reuse rights, and retention limits for each surface. Acceptance: unverified access paths are excluded from automated acquisition.
- **SDM-00.006 — Define product identity vocabulary:** Model supplier code, trade name, grade, product family, CAS/EC, INCI, customer SKU, market, and language variants. Acceptance: CAS alone cannot establish a product/grade match; conflicting aliases require review.
- **SDM-00.007 — Define product-data and document taxonomy:** Separate product-profile fields from SDS, TDS/PDS, COA, specification, regulatory declaration, and certificate records. Acceptance: source document type and source field name are retained alongside normalized classifications.
- **SDM-00.008 — Define Document Intelligence boundaries:** Specify extractable TDS/SDS fields and decisions requiring authorized review. Acceptance: every extracted field is a source-linked proposal and cannot automatically modify `RawMaterial`.
- **SDM-00.009 — Define representative fixtures and rights:** Select authorized, reusable SDS/TDS/COA/certificate examples by product, market, language, revision, and PDF type. Acceptance: fixture identity, source, and use/retention conditions are known.
- **SDM-00.010 — Define coverage and quality metrics:** Measure catalog pagination, product matching, document discovery, file acquisition, and extraction separately. Acceptance: completion reports include scanned scope and gaps, not merely a successful job status.

## Milestone SDM-01 — Shared domain, connections, and secure storage

- **SDM-01.001 — Architecture RFC:** Design provider registry, connections, surfaces, catalog discovery, acquisition jobs, immutable documents, extraction, and review. Acceptance: data flow, failure boundaries, tenant/authorization boundaries, and offline behavior are documented.
- **SDM-01.002 — Provider, surface, and account model:** Represent supplier, search/portal surface, and customer account connection as distinct entities. Acceptance: CHT public content and myCHT are separate capabilities and authorization profiles under one provider.
- **SDM-01.003 — Connection lifecycle:** Model setup, access validation, last successful check, lost authorization, and revocation. Acceptance: credentials are absent from connection state and job metadata.
- **SDM-01.004 — Adapter contract and capability registry:** Define typed interfaces for product search/listing, pagination, document discovery/fetch, authentication needs, coverage, and limitations. Acceptance: adapters explicitly return unsupported capabilities.
- **SDM-01.005 — Product catalog snapshot model:** Store source product identity, normalized match candidates, source fields, discovery time, and catalog snapshot. Acceptance: source supplier names/codes remain preserved beside normalized values.
- **SDM-01.006 — Product/document revision model:** Separate product-page revision, document revision, and acquisition time. Acceptance: new documents never replace old blobs; revision lineage can use a `supersedes` relation.
- **SDM-01.007 — Job state machine and checkpoints:** Track discovery, pagination, download, and extraction with resumable checkpoints. Acceptance: interrupted jobs resume and retries do not duplicate products/documents.
- **SDM-01.008 — Large-catalog job management:** Support cancellation, resumption, throttling, and partial results for long catalog scans. Acceptance: one provider failure does not discard another provider's results.
- **SDM-01.009 — Credential/session security:** Use OS credential-manager/keychain references and user-attended authentication. Acceptance: secrets never enter job payloads, logs, exports, or crash reports; users complete MFA/CAPTCHA themselves.
- **SDM-01.010 — Network and file security:** Enforce allowed hosts, HTTPS, redirect validation, SSRF/IP defenses, size/time limits, MIME/signature checks, and safe filenames. Acceptance: local-network redirects, path traversal, and content-type mismatches are safely rejected.
- **SDM-01.011 — Immutable document store:** Address document blobs by content hash and store original filename, URL, acquisition time, and provider metadata separately. Acceptance: repeated acquisition of identical content avoids redundant binary copies while preserving source provenance.
- **SDM-01.012 — Backward-compatible FormuLab linkage:** Add compatible links from existing `material_documents` and material relationships to blobs and extraction records. Acceptance: existing metadata remains readable; import creates no material, verification, or approval automatically.
- **SDM-01.013 — Audit and provenance model:** Record initiating user, provider/surface, scope, query/snapshot, URL, hash, adapter/parser version, and review decisions. Acceptance: the source of a product or extraction can be reconstructed end to end.
- **SDM-01.014 — Retention, deletion, and export model:** Define lifecycle and retention relationships for documents, extractions, connections, and audit records. Acceptance: document deletion behavior and audit preservation are explicit.

## Milestone SDM-02 — Adapter framework and supplier integrations

- **SDM-02.001 — Adapter conformance harness:** Create mock-provider scenarios for search, pagination, auth, throttling, timeout, cancellation, and document fetch. Acceptance: every adapter passes shared conformance checks.
- **SDM-02.002 — Full-catalog discovery contract:** Require adapters to report coverage, scanned pages/products, continuation state, and inaccessible surfaces. Acceptance: a scan is complete only when the adapter reaches the end of its declared scope.
- **SDM-02.003 — Delta-synchronization contract:** Define provider-supported timestamps, cursors, revisions, or hashes for rechecking changed products/documents. Acceptance: unsupported delta behavior is reported honestly; full scans are not presented as incremental sync.
- **SDM-02.004 — Public/API adapter profile:** Support safe requests, pagination, rate limits, and source links for official APIs/feeds and public surfaces. Acceptance: adapters use only declared hosts and capabilities.
- **SDM-02.005 — Portal adapter profile:** Support user-attended authentication, secure session references, and explicit scope reporting for authorized customer portals. Acceptance: no login bypass, CAPTCHA bypass, or unauthorized endpoint access.
- **SDM-02.006 — Manual-assisted adapter:** Import user-selected catalog or document files. Acceptance: source is recorded and user-selected; import performs no automatic verification or master-data write.
- **SDM-02.007 — CHT public discovery:** Verify public CHT product/technical-content surfaces and their accessible coverage. Acceptance: content unavailable from public surfaces is not counted as acquired.
- **SDM-02.008 — myCHT catalog/document adapter:** Discover and acquire products/documents available to the authorized account. Acceptance: account-verified scope, pagination, and document types are reported; missing access prompts user sign-in.
- **SDM-02.009 — Nouryon public SDS adapter:** Implement public SDS search within product-family, market/language, and coverage limits. Acceptance: unsupported surface scope is distinguishable from “no document found.”
- **SDM-02.010 — My Nouryon adapter:** Research and acquire the available customer-account product/document scope. Acceptance: an access-request page is never represented as document access; public and portal results remain distinguishable.
- **SDM-02.011 — Clariant Document Finder adapter:** Acquire public-surface product/document results by type, market, and language. Acceptance: source product reference and downloaded-file hash are retained.
- **SDM-02.012 — ClariHub profile:** Research ClariHub as a separate connection and capability profile from Document Finder. Acceptance: business-unit/product-line and customer entitlements are not assumed.
- **SDM-02.013 — Dow SDS Finder adapter:** Search SDS by product name, grade/code, and market. Acceptance: publication/revision time and acquisition time are distinct; publication delays are visible when relevant.
- **SDM-02.014 — Dow Technical Library adapter:** Acquire TDS, SDS, regulatory, and other supported document types. Acceptance: document type, product reference, market, and language are preserved.
- **SDM-02.015 — DyStar access research:** Verify Eliot and other relevant surfaces, product coverage, registration requirements, and terms using authorized access. Acceptance: implementation waits for an evidence-backed coverage decision.
- **SDM-02.016 — DyStar adapter:** If research permits automation, acquire catalog and allowed document types; otherwise provide user-attended/manual-assisted workflows. Acceptance: product/grade and revision matching are auditable.
- **SDM-02.017 — Archroma discovery and Safe Edge profile:** Separate public discovery from authorized Safe Edge scope. Acceptance: market, product line, SDS, and compliance coverage are reported independently.
- **SDM-02.018 — BASF Download Center adapter:** Acquire public product/document results by type, language, and market. Acceptance: regional/language variants remain separate candidates.
- **SDM-02.019 — BASF product portal profiles:** Research myBASFWorld, MyIndustryWorld, and sector-specific surfaces independently. Acceptance: no single BASF endpoint/account is assumed to cover every product family.
- **SDM-02.020 — Evonik access research:** Investigate Evonik catalogs, document centers, public search, and customer portals by surface. Acceptance: automation, portal, or manual-assisted decisions have dated evidence.
- **SDM-02.021 — Evonik adapter:** Where verified scope permits, acquire catalog/documents; otherwise provide an authorized user-attended route. Acceptance: product-line and market constraints accompany results.
- **SDM-02.022 — Fixture capture and licensing:** Create anonymized, permitted fixtures from authorized access. Acceptance: tests make no live vendor requests and fixtures meet privacy/use conditions.
- **SDM-02.023 — Partial coverage and unsupported behavior:** Distinguish no search result, inaccessible surface, unsupported capability, and temporary failure. Acceptance: users can tell “not found” from “not scanned here.”

## Milestone SDM-03 — Document Intelligence and controlled extraction

- **SDM-03.001 — File admission and quarantine:** Check MIME/signature, size, page count, encryption, malformed PDFs, and risky files. Acceptance: rejected files do not enter processing and have a recorded reason.
- **SDM-03.002 — Reproducible PDF text extraction:** Preserve page boundaries and text coordinates. Acceptance: text artifacts can be reproduced from document hash and parser version.
- **SDM-03.003 — OCR evaluation:** Compare offline OCR candidates on supported languages and representative supplier PDFs. Acceptance: accuracy, speed, package size, and offline requirements are decided by language.
- **SDM-03.004 — Conditional OCR pipeline:** Run OCR only on pages with insufficient text layers. Acceptance: OCR-derived text and uncertainty are explicitly labeled.
- **SDM-03.005 — SDS section parser:** Identify SDS sections across languages and layouts. Acceptance: sections 1–16 are measured; a missing section is not interpreted as a negative fact.
- **SDM-03.006 — SDS identity/composition extraction:** Extract CAS/EC, substance name, composition ranges, and Section 3 data. Acceptance: partial disclosure is preserved; an undisclosed component is not treated as absent.
- **SDM-03.007 — SDS hazard/GHS extraction:** Extract class/category, signal word, pictograms, and H/P statements. Acceptance: no classification is invented; market/regulatory context and evidence page are retained.
- **SDM-03.008 — SDS operational safety extraction:** Extract handling, storage, exposure controls, PPE, transport, and regulatory sections. Acceptance: extracted values do not create safety decisions or approvals.
- **SDM-03.009 — TDS/PDS field extraction:** Extract active matter, density, pH, viscosity, ionic character, appearance, recommended dosage, storage, shelf life, and application guidance. Acceptance: typical value, min/max, specification limit, and recommendation remain distinct.
- **SDM-03.010 — TDS measurement context:** Associate temperature, method, concentration, conditions, and units with each value. Acceptance: context-free pH/viscosity and similar fields are not presented as unconditional properties.
- **SDM-03.011 — Other document extraction:** Extract COA, specification, certificate, and regulatory declaration fields such as lot, limit, measurement, scope, issuer, and validity dates. Acceptance: COA lot values do not enter general master fields; certificate scope is linked to product/site.
- **SDM-03.012 — Field-level provenance:** Store source hash, revision, page/section, evidence text, parser/OCR version, confidence, and normalization steps per extraction. Acceptance: users can inspect the evidence for each value.
- **SDM-03.013 — Original and normalized value model:** Preserve source text/unit separately from normalized value/unit. Acceptance: conversions and rounding are traceable and the original expression remains available.
- **SDM-03.014 — Confidence and review thresholds:** Set field- and document-risk-specific thresholds. Acceptance: field-level review replaces a single aggregate score; critical safety fields cannot be auto-accepted at low confidence.
- **SDM-03.015 — Conflict and uncertainty handling:** Handle conflicting documents, unreadable fields, unknown units, and uncertain product matches. Acceptance: unknown remains unknown and the system does not fabricate values.
- **SDM-03.016 — Product/grade resolution:** Generate match candidates from supplier codes, grades, aliases, CAS, and regional variants. Acceptance: ambiguous or conflicting matches cannot automatically link to a material.
- **SDM-03.017 — Document revision comparison:** Detect revisions by hash, publication date, revision number, and content changes. Acceptance: prior extractions remain preserved and new values do not overwrite them.
- **SDM-03.018 — Evaluation set and quality measurement:** Measure SDS/TDS fields across languages, scanned/digital PDFs, and supplier layouts. Acceptance: field-level precision/recall and human-review rates are reported.

## Milestone SDM-04 — Catalog synchronization and user workflows

- **SDM-04.001 — Supplier Connections screen:** Show provider connections, access methods, last check, and status. Acceptance: authorization and coverage limits are visible.
- **SDM-04.002 — Pre-scan coverage disclosure:** Show provider, account, market, product line, and document scope before the initial scan. Acceptance: users see the scope they are starting.
- **SDM-04.003 — Authorized sign-in flow:** Let users start portal authentication and handle MFA/CAPTCHA or reauthentication. Acceptance: passwords are not collected in FormuLab and session tokens are not logged.
- **SDM-04.004 — Full-catalog scan workflow:** Show product discovery, pagination, document discovery, and partial failures. Acceptance: scanned, found, acquired, skipped, and failed counts are reported.
- **SDM-04.005 — Resynchronization and change summary:** Show new/changed/removed products and documents against the prior snapshot. Acceptance: when provider delta is unsupported, the need for a full scan is explicit.
- **SDM-04.006 — Product catalog browse/search:** Display source names, codes, grades, markets, and match status. Acceptance: source fields are distinguishable from normalized fields.
- **SDM-04.007 — Product/document candidate comparison:** Display grade, type, market/language, revision, date, surface, and source side by side. Acceptance: similar product names are not auto-linked; users can resolve candidates.
- **SDM-04.008 — Extraction review screen:** Show TDS/SDS fields with evidence page/text, original value, and normalized value. Acceptance: each field supports accept, edit, reject, or needs-review decisions.
- **SDM-04.009 — Raw-material application proposal:** Compare accepted extractions to existing material fields in a change preview. Acceptance: `RawMaterial` remains unchanged until an authorized user explicitly applies each field.
- **SDM-04.010 — Change and audit history:** Show previous/next values, source, user, date, and reason. Acceptance: applied changes can be reversed/audited without violating immutable formula-version rules.
- **SDM-04.011 — Document/product link panel:** Open source files, metadata, revision lineage, and extractions from material screens. Acceptance: documents cannot be silently linked to the wrong product.
- **SDM-04.012 — No-access support route:** Offer access request, supplier contact, or manual download/upload path. Acceptance: unavailable documents are never represented as acquired.
- **SDM-04.013 — Failure, retry, and cancellation flow:** Surface provider errors, throttling, interrupted connectivity, expired auth, and cancellation. Acceptance: retries preserve partial results.
- **SDM-04.014 — Localization and accessibility:** Support keyboard access, screen readers, localization, and error states. Acceptance: provider states are not conveyed by color alone.

## Milestone SDM-05 — Security, acceptance, and release readiness

- **SDM-05.001 — Provider contract suite:** Run success, empty, partial-scope, unauthorized, rate-limited, timeout, and malformed-file scenarios for all adapters. Acceptance: no adapter is complete without passing the suite.
- **SDM-05.002 — Authorized live coverage acceptance:** Validate search/download by provider using authorized accounts, market, product line, and document type. Acceptance: access evidence, time, counts, and hashes are recorded; unavailable authorization remains blocked.
- **SDM-05.003 — Catalog completeness acceptance:** Verify pagination completion and job result accounting within each adapter's declared scope. Acceptance: inaccessible/out-of-scope surfaces are excluded from complete-scan claims.
- **SDM-05.004 — Product-matching acceptance:** Measure same-name/different-grade, same-CAS/different-product, and regional-variant cases. Acceptance: incorrect automatic links are prevented and ambiguity goes to review.
- **SDM-05.005 — Document Intelligence acceptance:** Validate SDS/TDS/COA/certificate fields using separate quality measures. Acceptance: evidence and review behavior are tested per field; extraction review, verification, and approval remain separate.
- **SDM-05.006 — Master-data protection acceptance:** Verify extraction/import/resync cannot change `RawMaterial` without explicit field-level application. Acceptance: only an authorized user action applies a change.
- **SDM-05.007 — Secret/network/file security audit:** Test SSRF, redirects, path traversal, spoofed MIME, oversized files, secret leakage, and log exposure. Acceptance: unsafe inputs are rejected and audited safely.
- **SDM-05.008 — Local-first and outbound disclosure:** Explain which user action contacts which supplier. Acceptance: no supplier data is sent without a user-initiated action and acquired documents remain usable offline.
- **SDM-05.009 — Backward compatibility and data preservation:** Validate current `material_documents`, master data, and `.FormuLab/runs.db`. Acceptance: migration preserves existing records and work data.
- **SDM-05.010 — Failure/recovery acceptance:** Validate portal changes, revoked access, removed documents, throttling, and interrupted downloads. Acceptance: retry creates neither duplicate records nor data loss.
- **SDM-05.011 — Retention/export acceptance:** Validate deletion, retention, and export of documents, extractions, history, and connection references. Acceptance: lifecycle rules for product data, source documents, and audit history are explicit.
- **SDM-05.012 — Milestone closure:** Run full regression, review supported provider coverage, live acceptance evidence, and owner functional acceptance. Acceptance: only verified provider/surface/market/format combinations are labeled supported; remaining combinations are explicitly limited or pending.

## Completion criteria

For CHT, a customer can connect using an authorized account, scan the product catalog exposed to that account, acquire available product data and documents, and see scan coverage and gaps. FormuLab then extracts TDS/SDS fields as evidence-backed proposals for review. The same pattern extends to other suppliers through their independently verified access surfaces and capabilities.

“Connected” alone is not success. FormuLab must report which products and documents it saw, under what scope, which it acquired, which fields it extracted, and which decisions still require a human.

This file is a planning artifact. It is not the canonical project task tracker and does not activate implementation work.
