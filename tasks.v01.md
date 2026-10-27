# FormuLab V01 - Supplier Document Intelligence and Reference Formulation Intelligence

## Owner-scoped execution authority

This file is the execution plan for development on branch `V01` only.

- Repository: https://github.com/Sekiph82/FormuLab
- Development branch: `V01`
- Stable release branch: `main`
- V01 execution actor: CODEX
- V01 task file: `tasks.v01.md`
- Root `TASKS.md` on `main` remains the completed v1 release ledger and must not be changed by V01 work unless the owner explicitly requests a future merge/transition.
- When the owner explicitly instructs Codex to execute V01, this file is the ordered V01 implementation queue.

## Objective

Extend the completed FormuLab v1 architecture with supplier-specific document acquisition, universal SDS/document intelligence, supplier formulation PDF ingestion, commercial-product-to-canonical-chemistry resolution, a normalized reference formulation corpus, reference formulation intelligence, and integration into the existing deterministic generator.

The implementation must reuse the existing FVL-04 connector/data-exchange foundation rather than recreate it.

## Existing FormuLab foundation that MUST be reused

Already implemented in FormuLab and not to be rebuilt as parallel authorities:

- FVL-04.003 TDS metadata/document import path
- FVL-04.004 SDS metadata/document import path
- FVL-04.013 External Source Connector Contract
- FVL-04.014 Generic File Connector
- FVL-04.015 Source Schema Discovery
- FVL-04.016 Mapping Profile Model
- FVL-04.017 External ID Crosswalk Registry
- FVL-04.018 Transformation / Unit / Enum Mapping
- FVL-04.021 Generic Database Read Connector
- FVL-04.022 REST API Connector Contract
- FVL-04.023 Incremental Re-import / Conflict Handling
- FVL-04.024 Connector -> Existing Data Exchange Bridge

Production authorities to preserve include `SourceConnector`, existing FILE/REST/database connectors, schema discovery, mapping profiles, crosswalk resolution, deterministic transformation, Data Exchange preview/validation/commit/history, RawMaterial, Safety, Regulatory, Laboratory, Cost, Availability, formulation generation, prediction/ranking, approval and audit systems.

V01 extends these systems. It must not create a second generic connector framework, Data Exchange platform, Material Master, safety engine, regulatory engine, laboratory system, approval authority, or formulation engine.

## Scientific integrity rules

1. Supplier reference formulation is commercial/technical reference evidence, not measured validation.
2. SDS evidence is identity/safety/property evidence, not formulation-performance proof.
3. Section 3 composition concentration is not automatically active matter.
4. Product-level chemical description and component-level composition are separate evidence.
5. Unknown, undisclosed, proprietary, missing and ambiguous data remain explicitly unknown/partial/ambiguous.
6. A commercial blend must not be collapsed into a false single chemical.
7. Original supplier trade name and source PDF are immutable evidence and are never discarded after normalization.
8. Typical physical values are not specification limits unless the source explicitly says they are.
9. pH, viscosity, density and similar properties retain temperature, concentration, method and basis.
10. Imports, parsers, resolvers, system actors and AI cannot approve or verify regulated/master records.
11. RawMaterial changes require explicit authorized human field-level application through existing authority.
12. Safety/Regulatory/compatibility/manufacturing/availability hard gates always outrank reference-formula popularity.
13. Reference intelligence must remain deterministic and usable with zero LLM.
14. Historical records remain pinned to exact source document/revision/mapping identities.

## Supplied acceptance fixtures

V01 must use the supplied examples as real parser/resolver acceptance fixtures where repository rights allow:

- Croda Hand Dishwash Detergent Liquid HC/DW/22 formulation PDF
- Croda Incromine Oxide C SDS
- Croda ECO Brij L6L SDS
- Croda NatraSense AG-810 SDS
- Croda Crodateric CDA 38 SDS
- Evonik ABIL ME 45 SDS
- Evonik DERMOFEEL PA SDS
- Clariant Aristoflex TAC SDS
- Dow DOWANOL DPM / Dipropylene Glycol Methyl Ether SDS

These fixtures deliberately cover different identities: near-pure substance, solution, polymer, complex multicomponent blend, partially disclosed/trade-secret product, condition-bound physical properties, and supplier-specific layouts.

## Autonomous Codex execution contract

Codex must execute the tasks below in the exact order listed.

- Total V01 tasks: 156
- Initial current task: `V01-00.001`
- Initial next task: `V01-00.002`
- Every task starts as `[ ]`.
- When starting the current task, Codex changes only that task to `[~]`.
- After implementation and task-level acceptance pass, Codex changes it to `[x]`, immediately starts the next task by changing that next row to `[~]`, and continues without asking the owner for routine confirmation.
- Exactly one task may be `[~]` at a time.
- Task order is strict. Every task depends on the immediately preceding task.
- Do not skip ahead.
- Do not create `[!]` task states in this file.
- If a supplier surface cannot or should not be automated, finish that task by implementing the safe user-attended/manual-assisted fallback and truthful capability reporting, then continue.
- If a test exposes a defect, fix the defect, rerun the affected tests, close the task only after pass, and continue.
- Do not stop merely because a provider is unavailable, credentials are absent, a portal requires MFA/CAPTCHA, a particular document is missing, or a source does not disclose chemistry. Implement the defined fallback/unresolved behavior and continue.
- Never bypass human approval, supplier authorization, access controls, security boundaries, or scientific-integrity rules merely to keep the queue moving.
- Use focused tests per task and the full regression only at the explicit closure task.
- Commit and push validated V01 work to branch `V01`; never push V01 implementation to `main`.
- Do not merge V01 into `main` as part of this plan.
- Project files/code remain English.

## V01 progress

- Total tasks: 156
- Completed: 113
- Remaining: 43
- Completion: 72.4%
- Current task: V01-07.010 - Implement nearest-reference retrieval
- Current status: IN PROGRESS
- Next task: V01-07.011 - Implement leakage and near-duplicate controls
- Acceptance note: V01-07.009 adds versioned, supplier-neutral, source-bound formulation feature vectors using eligible product family and chemistry, explicitly reviewed canonical functions and dosage, reviewed SDS component contributions, process actions/sequences/conditions, and reviewed targets. Phase features require their own latest source-hash-bound human acceptance; features retain supporting evidence refs and deterministic ordering, omit supplier identity, and explicitly are not similarity scores or production updates. A fixture covers dosage and contribution quantities, process/target features, supplier-ID exclusion, deterministic ordering, and omission of unreviewed fields. Focused shared suite (14), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-07.008 advances ingredient-frequency prior output to schema v2 and explicitly distinguishes the existing formula-weighted corpus frequency from an equal-supplier pooled prevalence. Each family/chemical result includes every supplier, including suppliers with zero occurrences, their eligible formula counts, per-supplier frequency, equal weight, and source IDs. The pooled frequency is the arithmetic mean of supplier-specific formula prevalence, so a supplier with more documents does not receive extra weight. Schema checks bind supplier IDs, denominators and source IDs to family and ingredient summaries and reject duplicate, missing, overlapping, or cross-supplier source assignments. A fixture demonstrates formula-weighted 2/3 versus equal-supplier 1/2 and rejects tampered supplier/source evidence. Focused shared suite (13), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-07.007 computes source-backed property distributions for accepted pH, viscosity, density and appearance candidates after validating the normalized targets against each immutable source snapshot. It requires the latest accepted target review tied to the same source hash and exact raw value. Numeric results separate target/typical-result semantics, canonical unit and explicit measurement context; only safe conversions are applied (cP to mPa·s, kg/m³ to g/mL), with source formula IDs, citations, supplier counts and range quantiles retained. Appearance is a separate reviewed categorical distribution. Approximate/unparsed values, unsupported or composite units, comma/dot three-digit locale ambiguity, duplicate property/context candidates and unreviewed targets are excluded. No production target or RawMaterial is changed. Focused shared suite (13), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-07.006 computes reviewed supplier-reference process patterns for explicit actions, ordered action pairs, phase values, and source-supported pH, temperature, time, and other conditions. Procedure steps must exactly match the immutable source snapshot; instruction, explicit phase, and condition evidence require accepted source-hash-bound reviews. Generic “other” actions and negated action mentions are excluded. Conditions normalize only safe spacing/decimal variants while preserving original values and evidence references. Results include formula-level counts, family denominators, supplier mix, source IDs, sequence bounds, and citations, and are labeled supplier-reference process only. A focused fixture covers opposite action orders, explicit phase review, normalized temperature variants, negation suppression, no-review exclusion, and input-order determinism. Focused shared suite (12), shared/desktop typechecks, Rust immutable phase-evidence review test (1), V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-07.005 computes active-matter claims and SDS Section 3 component contributions as separate source-bounded distributions. Active claims require an exact accepted target review, explicit % w/w source range and formula-document citations; unsupported point values, unresolved multiple claims and unreviewed claims are excluded. Component contributions require accepted formula amount/unit/basis, immutable formula citations, a disclosed Section 3 source component/fact with explicit concentration range, exact supplier-product identity agreement, and an accepted contribution chemistry mapping. Component and active-matter quantities never merge; repeated contributions for the same chemistry sum with decimal bounds once per formula, while incomplete contributions suppress that formula/chemistry sample. Results retain source IDs, supplier mix and evidence refs. Focused shared suite (11), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-07.004 computes deterministic co-occurrence only from the latest, rights-eligible corpus snapshots with accepted source identity, family, chemistry, and (for functions/components) exact normalization-field reviews. Material and function pairs are counted once per formula; material/function pairs retain line-level assignments. Component pairs require an explicitly disclosed Section 3 component with the same commercial product, SDS acquisition, document hash and section; they never pair across product documents. Component denominator is eligible formulas with at least one reviewed component composition, counted once per source formula regardless of line count. Results retain source formula IDs and supplier mix, label empirical co-occurrence only, and explicitly state that they are not compatibility evidence. Focused shared suite (10), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-07.003 adds dosage distributions for eligible family/material samples and explicitly reviewed canonical functions. It requires accepted amount, unit and basis decisions, validates these fields and citations against the immutable source, and parses only explicit % w/w values. Exact and ranged samples retain separate lower/upper bounds with deterministic nearest-rank quantiles; q.s., unreviewed and non-mass-percent samples are counted as exclusions rather than zero. Samples retain formula/supplier counts and source IDs; repeated lines for the same material/function are summed once per formula using decimal arithmetic, while unresolved function mappings remain explicitly unassigned. Focused shared suite (8), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-07.003 adds dosage distributions for eligible family/material samples and explicitly reviewed canonical functions. It requires accepted amount, unit and basis decisions, validates these fields and citations against the immutable source, and parses only explicit % w/w values. Exact and ranged samples retain separate lower/upper bounds with deterministic nearest-rank quantiles; q.s., unreviewed and non-mass-percent samples are counted as exclusions rather than zero. Samples retain formula/supplier counts and source IDs; repeated lines for the same material/function are summed once per formula using decimal arithmetic, while unresolved function mappings remain explicitly unassigned. Focused shared suite (8), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-07.002 computes deterministic ingredient-presence priors from the V01-07.001 eligibility gate and matching immutable source records. It counts each canonical chemistry at most once per eligible formula, uses eligible formulas in the family as the denominator, reports per-family/per-ingredient supplier mix and source formula IDs, and excludes unresolved, ambiguous, unreviewed, stale-normalization, or rights-ineligible snapshots. A fixture verifies 2/3 and 1/3 frequencies, supplier shares, latest-version deduplication, excluded unresolved chemistry, and input-order independence. Focused shared suite (7), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-07.001 adds a deterministic eligibility filter that selects only the latest normalization snapshot per source, validates each query projection and its supplier/product/family/line evidence against the immutable source, and requires accepted human decisions for product family, each line identity and each candidate canonical-chemistry link. It fails closed for unresolved/ambiguous critical identity, stale or mismatched decisions, unknown/expired internal-research rights and retention, and malformed or altered source/query joins. Focused eligibility suite (6), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. The existing authenticated native review write path stamps reviewer identity; this filter consumes its append-only records. Full regression not run.
- Acceptance note: V01-06.014 ingests a synthetic three-supplier fixture corpus across distinct table layouts and verifies deterministic source-linked normalization/query projections, unresolved product and SDS evidence, explicit unknown/q.s. handling, stable index rebuilds, duplicate rejection, supplier isolation, and absence of production-formula fields. Desktop bulk-import acceptance verifies three source/acquisition records, deterministic query-index rebuild, repeated-byte deduplication, and no RawMaterial/formula collection writes. The desktop integration fixtures use blank PDFs and therefore validate persistence/deduplication rather than extracted ingredient rows; parser-to-normalization behavior is covered by the shared synthetic semantic-table harness. V01-06.013 supplies byte-identical backup/restore coverage. Focused tests (shared 1, desktop 9), shared/desktop typechecks, V01 tracker validation, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-06.013 confirms the existing project backup includes immutable source/acquisition/SDS/normalization/review/crosswalk JSON and hash-addressed PDF bytes, with byte-identical restoration coverage. It adds deterministic query-projection/index rebuilding from restored source and latest normalization snapshots, validates source/history/SDS identities, rejects orphan or duplicate evidence IDs, and performs no writes. Fixed two Rust compile defects that blocked the focused backup run. Focused desktop tests (7), shared/desktop typechecks, Rust backup round-trip test (1), `git diff --check`, tracker validation, and independent review passed. Rust test used a temporary Tauri config to omit the missing packaged uv executable; bundle/release validation not performed. Full regression not run.
- Acceptance note: V01-06.012 extends the existing review page with immutable normalization-version traces for every source formula line and component contribution. The data service joins each line to its exact source record/hash and each SDS contribution to its persisted evidence record, Section 3 component/fact, acquisition and matching document hash; it rejects duplicate IDs and mismatched formulation/SDS suppliers. The UI shows candidate-only chemistry/product/function links, formula amounts, contribution ranges, disclosure, citations, and explicit unknown/missing evidence without changing RawMaterial or production formulas. Focused desktop tests (10), shared/desktop typechecks, `git diff --check`, V01 tracker validation, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-06.011 adds backward-compatible, evidence-bearing per-use rights and retention metadata; missing permissions and retention fail closed, public availability alone grants no reuse, source export additionally requires redistribution permission, expiry and delete-after-use are enforced. Supplier concentration reports share, HHI and effective supplier count without inventing a cutoff; prior candidates are rights-filtered by same/cross-supplier use and weighted equally per eligible supplier with deterministic ordering. Focused shared tests (5), shared/desktop typechecks, `git diff --check`, V01 tracker validation, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-06.010 adds a deterministic quality report over the latest normalization snapshot per immutable source formula, with a 2,000-formula target, product-family coverage, supplier distribution, candidate-only resolved/unresolved/ambiguous line rates, source-line evidence coverage, parser-confidence mean and sample coverage, as-of revision age, and source-field review completion. Unknown confidence is excluded rather than treated as zero; future, missing and ambiguous/unparseable revision dates remain separate. Unique normalization candidate IDs, process steps/conditions, and targets that still require review are counted separately from source-field review completion. The report validates source/hash lineage, duplicate versions/reviews, denominators and metric consistency. Focused shared tests (7), shared and desktop typechecks, `git diff --check`, independent read-only review, and tracker validation passed. Full regression not run.
- Acceptance note: V01-06.009 adds a durable 5,000-file supplier-formula import job with 25 MiB per-PDF admission, safe basenames, content hashes, source-scoped idempotency, cross-job deduplication, bounded per-file errors, resumable processing, pause/reselection, partial-manifest recovery with ordered identity checks, and append-only review-required reference records. PDFs use the existing content-addressed project store and acquisition receipts; extracted identities and lines remain candidates/unresolved, and RawMaterial is never written. Hashless failed files stay terminal until a new job can establish identity. Focused desktop suites passed (37), shared schema/policy suites passed (16), shared and desktop typechecks, policy parity, tracker validation, `git diff --check`, and independent read-only review passed. `cargo check` could not complete because `apps/desktop/src-tauri/binaries/uv-x86_64-pc-windows-msvc.exe` is absent; full regression not run.
- Acceptance note: V01-06.008 adds a deterministic rebuildable local index over validated query projections, with exact normalized alias/family postings, supplier, commercial-product, canonical-chemical and function postings, plus explicit formula/component percentage ranges. Search uses OR within a filter dimension, AND across dimensions, interval overlap for numeric filters and stable query-ID ordering. Index construction never parses PDFs; malformed keys/ranges, duplicate query IDs, conflicting per-line formula ranges and dangling postings are rejected. Focused index tests (3), shared/desktop typechecks, tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-06.007 adds a source-linked query projection for supplier/product family/product identity, canonical chemistry and function candidates, original formula amounts, component contributions, process, targets, market/language and source revisions. Candidate and active-matter semantics remain review-required; active-matter claims are explicitly empty rather than inferred from SDS fractions. Query validation preserves source/SDS citations, disclosure, acquisition, revision and unknown-reason details; it rejects inconsistent ranges, contribution arithmetic, supplier-function states, and candidate statuses. Focused shared tests (6), shared/desktop typechecks, V01 tracker validation, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-06.006 adds stable query fields for pH, viscosity, density, appearance and other formula targets/results while preserving original labels and values, exact/range/approximation shape, target/typical/unspecified semantics, source excerpts, and page/row/cell citations. Values remain review-required source candidates and are not numerically converted or applied to RawMaterial. History validation compares snapshots to immutable source candidates, and old versions without target snapshots remain readable through source-derived compatibility. Focused shared tests (14), desktop normalization tests (5), shared/desktop typechecks, Rust syntax parsing, `git diff --check`, and independent read-only review passed. The focused Rust test could not start because `apps/desktop/src-tauri/binaries/uv-x86_64-pc-windows-msvc.exe` is absent; full regression not run.
- Acceptance note: V01-06.005 adds immutable normalized process snapshots for ordered steps, explicit phase candidates, process-action candidates, and temperature/time/speed/pH/appearance/homogeneity conditions. All candidates remain review-required and retain evidence references to source text or exact Phase-column cells; no missing step or phase is inferred. The procedure parser v2 stores explicit Phase-column values while historical v1 source records remain readable. Native append validation cross-checks ordered steps, action/condition values, phase evidence, warnings and source-document hashes against the immutable procedure snapshot. Focused shared suites (15 tests), desktop normalization tests (5), shared/desktop typechecks, Rust syntax parsing, `git diff --check`, and independent read-only review passed. The focused Rust test could not start because `apps/desktop/src-tauri/binaries/uv-x86_64-pc-windows-msvc.exe` is absent; full regression not run.
- Acceptance note: V01-06.004 adds a separately source-cited supplier-function snapshot and candidate-only canonical `MaterialFunction` classification to each new immutable normalization version. Source wording/citation must match the immutable formula line; absent supplier wording stays unresolved; every canonical candidate remains review-required and cannot represent an accepted classification. Historical normalization versions without the added snapshot remain readable through source-derived history compatibility. Shared normalization/record tests (10), desktop normalization tests (4), shared/desktop typechecks, Rust source parse, `git diff --check`, and independent read-only review passed. The focused Rust test could not start because `apps/desktop/src-tauri/binaries/uv-x86_64-pc-windows-msvc.exe` is absent; `cargo fmt --check` reports pre-existing repository formatting drift, so no broad formatting was applied. Full regression not run.
- Acceptance note: V01-06.003 persists supplier SDS Section 1/3 extraction snapshots in a dedicated append-only `supplier_sds_product_evidence` collection tied to immutable acquisition SHA-256 and an exact active FVL-04 supplier-product crosswalk. Native append stamps its timestamp, validates fact/component uniqueness and reconciliation semantics, and rejects generic writes. Normalized contributions now cross-check persisted SDS component/fact/value/disclosure/citations against immutable formula-line evidence; exact/ranged values retain bounded arithmetic, while missing component/fact remains unknown. Shared schema/policy/contribution tests (21), desktop normalization tests (7), shared/desktop typechecks, Rust syntax parsing, `git diff --check`, and independent read-only review passed. Native Rust unit tests could not start because this checkout lacks `apps/desktop/src-tauri/binaries/uv-x86_64-pc-windows-msvc.exe`; full regression not run.
- Acceptance note: V01-06.002 reuses the FVL-04 `external_id_crosswalks` collection for exact supplier product-code mapping: provider ID + `supplier_products` + source code -> `CommercialProduct` ID. The matcher reads existing crosswalks through the desktop persistence bridge, validates the complete stored tuple as well as the deterministic key, restricts results to same-supplier catalog products, and records crosswalk provenance as a review-only candidate; mismatched/forged tuples remain unresolved and no RawMaterial write or second registry is introduced. Shared crosswalk/matcher/record/unresolved/Croda tests (23), desktop persistence/normalization tests (16), shared and desktop typechecks, `git diff --check`, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-06.001 adds a separate append-only normalization-version record that references immutable source line IDs and carries independent commercial-product and canonical-chemistry candidate links; candidates remain proposed/ambiguous/unresolved and never replace original wording or write to RawMaterial. Version creation serializes allocation natively, validates source hash, exact line coverage, source-derived commercial-product candidates, predecessor chain and strict candidate/object shapes, and stamps creation time; generic and raw collection writes reject the normalization collection. Shared schema/parity tests (8), desktop normalization service tests (3), shared/desktop typechecks, and independent read-only review passed. Rust unit execution could not start because this checkout lacks `apps/desktop/src-tauri/binaries/uv-x86_64-pc-windows-msvc.exe`; full regression not run.
- Acceptance note: V01-05.014 adds side-by-side immutable source excerpts and extracted identity/ingredient/process/target candidates with field-level accept/edit/reject/needs-review events in a separate append-only collection. The native command enforces formulation write authorization, stamps trusted actor/time, derives evidence and location from the immutable source snapshot, and generic/raw collection writes reject this review collection; decisions never alter source snapshots or production formulas/RawMaterial. Shared schema/parity tests (7), desktop review/help/sidebar tests (67), locale/sidebar i18n tests (24), shared/desktop typechecks, and independent read-only review passed. Rust unit execution could not start because this checkout lacks `apps/desktop/src-tauri/binaries/uv-x86_64-pc-windows-msvc.exe`; full regression not run.
- Acceptance note: V01-05.013 adds two clearly synthetic parser-layout families: a single-row trade-name table and a multi-row raw-material composition table. The harness checks distinct column maps plus extracted ingredient, amount, function, product code/basis, cell evidence, source hash, and mandatory review; placeholder labels make no real supplier or chemistry claims. Focused parser/harness tests (3 files/9 tests), shared typecheck, and independent read-only review passed.
- Acceptance note: V01-05.012 accepts the owner-supplied Croda HC/DW/22 Hand Dishwash Detergent Liquid fixture: title/code, inline procedure and pH ~7, eight ingredient/function/%w/w lines, 100% arithmetic, and ~375 cP viscosity. Four supplied Croda SDS identities are review-only alias candidates; SLE(3)S and EBC Crothix remain unresolved/acquisition-ready. Safe product-name parentheses are admitted, and control-character PDF text is marked `unsupported_character_encoding`; supplied PDFs stayed out of git because redistribution rights are unknown. Focused shared tests (7 files/25 tests), desktop admission tests (16), real-PDF smoke checks (5 source files), shared/desktop typechecks, and independent read-only review passed. Full regression not run.
- Acceptance note: V01-05.011 adds a source-linked structured reference-formula snapshot containing identity comparisons, original ingredient rows, arithmetic, process and target evidence, product candidates and unresolved work. It persists to a dedicated append-only `reference_formulations` collection, with immutable retry handling; the schema rejects production approval/lifecycle fields and validates source, candidate, queue and revision-comparison lineage. Shared schema/parity tests (8), desktop persistence tests (2), shared/desktop typechecks and independent read-only review passed. Rust unit execution could not start because this checkout lacks `apps/desktop/src-tauri/binaries/uv-x86_64-pc-windows-msvc.exe`.
- Acceptance note: V01-05.010 builds acquisition/review-ready entries for every supplier-formulation line, retains the full raw line snapshot, identifies missing SDS support from same-supplier linked acquisition receipts, and proposes SDS/TDS acquisition or identity review without executing either or approving links. Source and field-evidence hashes are checked. Focused tests (4), shared typecheck and independent read-only review passed.
- Acceptance note: V01-05.009 matches source lines to same-supplier commercial products by exact product code/trade name, then controlled aliases; edit-distance candidates remain fuzzy proposals only. Conflicts are ambiguous, all results require review and none auto-link, and source PDF hashes for the line and matching field evidence are verified. Focused tests (4), shared typecheck and independent read-only review passed.
- Acceptance note: V01-05.008 extracts cited pH, viscosity, density, appearance and generic property results from semantic sections and property tables, preserves raw units/context and exact/range/approximate/approximate-range distinctions, and keeps candidates review-required. Procedure/ingredient tables are excluded; OCR/mixed-source evidence requires review. Focused tests (4), shared typecheck and independent read-only review passed.
- Acceptance note: V01-05.007 extracts ordered, source-cited process steps from semantic procedure sections and clearly labeled process tables, retains explicit condition values and cell/page evidence, flags OCR/mixed-source steps for review, and does not infer steps outside supported sections. Focused tests (4), shared typecheck and independent read-only review passed.
- Acceptance note: V01-03.014 passed the authored synthetic supplier-style conformance matrix; no vendor SDS PDFs are present in this checkout, so this acceptance does not claim vendor-PDF verification. Product-specific source acceptance remains explicit in V01-10.
- Acceptance note: V01-04.001 adds the independent commercial-product identity schema and passes focused tests, shared typecheck, task-state validation, and read-only review. No canonical chemistry is assigned in this identity record.
- Acceptance note: V01-04.002 adds a provenance-backed canonical chemical schema with stable opaque IDs and distinct chemical/functional families. Focused tests, shared typecheck, and read-only review passed; CAS/EC values remain unnormalized for V01-04.003.
- Acceptance note: V01-04.003 validates CAS and numeric EC formats/check digits, preserves source strings alongside deterministic normalized values, and refuses conflicting identifier sets. Focused tests, shared typecheck, task-state validation, and read-only review passed.
- Acceptance note: V01-04.004 adds versioned deterministic name keys and exact preferred-name/synonym matching with ambiguity reporting. Identity-bearing punctuation and stereochemical descriptors remain distinct; focused tests, shared typecheck, and read-only review passed.
- Acceptance note: V01-04.005 adds evidence-referenced product-type classification with conservative unknown/conflict outcomes; disclosure signals override product-type assertions, and purity requires explicit type evidence or cited composition completeness. Focused tests, shared typecheck, and read-only review passed.
- Acceptance note: V01-04.006 preserves Section 1 product facts and Section 3 composition as separate source-backed records; reconciliation is explicit, exact CAS/EC outcomes are revalidated, and unresolved/conflicting evidence remains visible. Focused tests, shared typecheck, and read-only review passed.
- Acceptance note: V01-04.007 proposes a canonical candidate only with a cited pure/near-pure classification, one disclosed component, explicit majority (>50%) concentration from the linked raw `% w/w` evidence, validated Section 1/3 identifiers, and one matching canonical record. It never mutates source/master data and always requires human review; focused tests, typecheck, and read-only review passed.
- Acceptance note: V01-04.008 resolves a solution's reviewed, source-linked solute and carrier separately, stores exact or ranged source `% w/w` concentration without converting it to active matter, and retains source record/reviewer/disclosure lineage. Focused tests, typecheck, and read-only review passed.
- Acceptance note: V01-04.009 adds a separate provenance-backed canonical polymer model and resolves only explicit polymer evidence through shared CAS/EC/material-number identifiers. Polymer properties and monomer references remain separate from small-molecule identities; conflicting identifiers stay unresolved and candidates require human review. Focused tests, typecheck, and read-only review passed.
- Acceptance note: V01-04.010 preserves each blend component, raw/exact/ranged concentration, independent identifier candidate state, and explicit undisclosed remainder without flattening or active-matter inference. Exported schemas verify source-derived ranges and remainder-state consistency. Focused tests, typecheck, and read-only review passed.
- Acceptance note: V01-04.011 preserves trade-secret/withheld and generic-family text with source references, distinguishes PARTIAL/AMBIGUOUS/UNKNOWN, and never invents components or canonical identities. Cross-section conflicts require an explicit validated reconciliation; unlinked refs are excluded. Focused tests, typecheck, and read-only review passed.
- Acceptance note: V01-04.012 adds a deterministic cited-evidence confidence engine with EXACT, HIGH_CONFIDENCE, PARTIAL, AMBIGUOUS and UNKNOWN states; result validation rejects unsupported or contradictory state/reason combinations, and no numeric confidence or inferred identity is created. Focused tests (8), shared typecheck, task-state validation, and independent read-only review passed.
- Acceptance note: V01-04.013 adds a source-linked component mass-fraction record, normalizes only explicit SDS `% w/w` values into exact/ranged 0-1 fractions, and leaves unparsed or missing values unasserted. Its quantity kind and basis separate it from product concentration, solids, assay, active matter and formula contribution; persisted lineage is checked against the immutable SDS source. Focused tests (3), shared typecheck and independent read-only review passed.
- Acceptance note: V01-04.014 adds cited, explicitly labeled active-matter/solids/assay claims as separate provisional evidence with exact/range/unparsed percent values and source/document/fact lineage. SDS Section 3 hazard composition is rejected, negative/unsupported labels fail, and no RawMaterial write occurs. Focused tests (3), shared typecheck and independent read-only review passed.
- Acceptance note: V01-04.015 calculates conservative supplier-product contribution intervals from a cited formula-line percentage and exact/ranged component fraction or explicitly as-supplied active-matter evidence. Results retain both source lineages, validate the interval arithmetic and same-product identity, and reject unparsed, mismatched, solids/assay, or non-as-supplied inputs. Focused tests (2), shared typecheck and independent read-only review passed.
- Acceptance note: V01-04.016 links Section 9 SDS property candidates to commercial product and immutable document identity, retaining original values, conditions, method/evidence context and page/line citations. Persisted records validate context/citation consistency and product/source/hash linkage; no RawMaterial write path exists. Focused tests (2), shared typecheck and independent read-only review passed.
- Acceptance note: V01-04.017 adds append-only, evidence-backed field decisions for product type, canonical identity, components, concentrations, active claims and aliases. Decisions require a named human with existing raw-material or supplier-document edit access; edits/rejections/needs-review capture notes and value snapshots, and supersession is limited to the same product/target/field. Focused tests (2), shared typecheck and independent read-only review passed; no RawMaterial write occurs.
- Acceptance note: V01-04.018 prepares only accepted supported identity/active-matter proposals as full target-preserving `raw_materials` rows for the existing Data Exchange preview, verifies the persisted accepted review and current target snapshot, and withholds a row for unsupported/lossy updates. Data Exchange authorization and a human commit remain required; no write or verification occurs here. The existing raw-material template currently requires administrator authorization for preview/commit. Focused tests (4), shared typecheck and independent read-only review passed.
- Acceptance note: V01-04.019 adds append-only resolver-evidence revisions and formula-line mapping revisions; changed, older, or unordered SDS evidence remains pending review, and historical mappings change only through a new revision backed by an accepted field review from the same currently authorized human, bound to that mapping and exact normalized snapshot. Focused tests (3), shared typecheck and independent read-only review passed.
- Acceptance note: V01-04.020 exercises all eight named supplier products in a conservative missing-SDS fallback: original supplier/trade identity is preserved while product type and chemical identity remain UNKNOWN with no canonical candidate. Focused tests (8), shared typecheck and independent read-only review passed. The supplier SDS PDFs are absent from this checkout, so this is not actual-PDF verification; product-specific document acceptance remains explicit in V01-10.
- Acceptance note: V01-05.001 adds a formulation source snapshot linked to the existing immutable supplier-document acquisition receipt, retaining supplier/provider/surface/product identity, exact PDF hash and URL or selected-file provenance, publication/revision metadata, parser version and evidence-backed rights metadata. Rights and license URLs cannot imply unsupported permissions or retain URL secrets. Focused tests (2), shared typecheck and independent read-only review passed.
- Acceptance note: V01-05.002 adds a page/block-preserving semantic layout analyzer that locates formulation headings and ingredient-table candidates by heading/header labels across differing pages and positions, with explicit missing/ambiguous warnings and review-required output. This is a contract over pre-extracted page blocks, not a PDF decoder or ingredient-value extractor. Focused tests (3), shared typecheck and independent read-only review passed.
- Acceptance note: V01-05.003 adapts formulation acquisitions to the existing bounded local conditional-PDF-OCR pipeline, requiring FORMULATION document type and matching acquisition, extracted-document and optional original-byte hashes. Sufficient digital-text pages skip OCR; OCR output keeps page, confidence, parser lineage and review status, with unavailable/low-confidence cases remaining manual-review outcomes. Focused tests (3), desktop/shared typechecks and independent read-only review passed; OCR yields text lines, while table reconstruction remains a later task.
- Acceptance note: V01-05.004 extracts supplier, application, product family, formulation title/code, revision/date, document version and source ID as cited candidates tied to the exact acquisition/hash and page/block. Conflicting values and acquisition metadata differences remain warnings for review; no candidate is accepted automatically. A semantic-title false-positive edge was fixed and retested. Focused tests (4), shared typecheck and independent read-only review passed.
- Acceptance note: V01-05.005 extracts semantic ingredient rows with original name/code/INCI/function/phase/amount/unit/basis, deterministic row order, explicit q.s. semantics and per-cell page/table/row evidence. Raw values are unchanged, missing-name rows remain visible, and OCR rows require review. Competing header rows or duplicate ingredient columns produce warnings and no extracted rows. Focused tests (7), shared typecheck and independent read-only review passed.
- Acceptance note: V01-05.006 calculates exact or interval totals only for explicit, compatible % w/w values, preserves the source-declared total and citations, and flags mismatches, overlaps, duplicate lines, q.s., missing values and unsupported units without deduplicating or repairing inputs. Line and total evidence must match the same PDF hash; OCR-derived totals require review. Focused tests (5), shared typecheck and independent read-only review passed.
- Required actor: CODEX
- Branch: V01

## Milestone V01-00 - Baseline audit and reuse map

- [x] **V01-00.001 - Audit the existing FVL-04 connector/data-exchange foundation**: Verify SourceConnector, FILE, REST_API, schema discovery, mapping profiles, crosswalk, transformations, incremental re-import, Connector -> Data Exchange bridge, material_documents, backup/restore, and production UI paths. Produce a code-level reuse map before adding new authorities.
- [x] **V01-00.002 - Freeze no-duplication architecture boundaries**: Document in code comments/tests which existing FVL-04 authorities must be extended rather than duplicated. Add architectural regression tests where practical.
- [x] **V01-00.003 - Inventory current material and document schemas**: Identify reusable RawMaterial, Supplier, MaterialDocument, attachment/blob, audit, approval, verification, and provenance fields plus exact gaps for V01.
- [x] **V01-00.004 - Inventory current formulation generation inputs**: Trace the deterministic zero-LLM generator, material library, safety, regulatory, compatibility, cost, availability, process, ranking, and evidence paths that reference intelligence may later enrich.
- [x] **V01-00.005 - Inventory current persisted collections and backup coverage**: List every new or extended V01 collection that will require backup/restore and migration compatibility.
- [x] **V01-00.006 - Define V01 terminology and identity vocabulary**: Define supplier, provider, surface, commercial product, grade, trade name, supplier product code, canonical chemical, component, blend, source formula, reference formula, normalized formula, evidence claim, and review decision.
- [x] **V01-00.007 - Define scientific evidence classes**: Separate source document fact, supplier formulation evidence, SDS composition evidence, typical physical property, supplier recommendation, canonical identity proposal, measured laboratory result, prediction, and validation.
- [x] **V01-00.008 - Define no-fabrication invariants**: Codify that unknown stays unknown, missing SDS components stay missing, supplier reference formula is not measured validation, SDS is not performance proof, Section 3 concentration is not automatically active matter, and supplier function text is not canonical truth.
- [x] **V01-00.009 - Define branch-local V01 task transition helper/check**: Add a simple task-order validation script or test that verifies unique task IDs and sequential state transitions in tasks.v01.md without changing root TASKS.md.
- [x] **V01-00.010 - Baseline acceptance checkpoint**: Run focused existing FVL-04, material, data-exchange, generator, safety/regulatory, backup, and lineage tests. Record the exact starting green baseline for V01.

## Milestone V01-01 - Supplier document domain, secure acquisition, and storage

- [x] **V01-01.001 - Extend existing connector capability model for supplier documents**: Reuse SourceConnector and add only missing supplier capabilities: catalog search/listing, document discovery, document fetch, formulation discovery, pagination, authorization mode, coverage and limitations.
- [x] **V01-01.002 - Implement provider and surface registry**: Represent supplier and each public/API/portal/manual surface separately, including market, language, product line, supported document types, and access mode.
- [x] **V01-01.003 - Implement connection lifecycle**: Add configured, authenticated, expired, revoked, unavailable, and manual-assisted connection states without storing plaintext credentials.
- [x] **V01-01.004 - Implement secure credential/session references**: Use OS credential manager/keychain references and user-attended login sessions. Ensure secrets never enter logs, exports, crash reports, audit payloads, or project backups.
- [x] **V01-01.005 - Implement network admission policy**: Enforce HTTPS, declared hosts, redirect validation, SSRF/private-IP defenses, timeouts, size limits, safe filenames, content type/signature checks, and bounded downloads.
- [x] **V01-01.006 - Implement immutable acquired-document record**: Persist provider/surface, source URL, original filename, MIME type, source product identity, market/language, revision/publication dates, acquisition time, SHA-256, and parser status.
- [x] **V01-01.007 - Implement content-addressed binary document store**: Store PDF/document bytes by cryptographic hash, deduplicate identical content, preserve multiple source provenance records, and keep old revisions.
- [x] **V01-01.008 - Implement document revision and supersession lineage**: Detect same-document revisions by product identity plus revision/date/hash and link new records with supersedes without deleting historical evidence.
- [x] **V01-01.009 - Implement acquisition job state machine**: Support queued, discovery, downloading, parsing, review-ready, completed-with-gaps, failed-item, cancelled, and resumed states at item/job level without global task blocking.
- [x] **V01-01.010 - Implement resumable checkpoints and idempotency**: Resume catalog scans/downloads after interruption without duplicating products, documents, or audit records.
- [x] **V01-01.011 - Extend backup/restore for acquired binaries and metadata**: Preserve hashes, document lineage, provider identities, reviews, and storage references; verify restore does not retarget historical links.
- [x] **V01-01.012 - Supplier document foundation acceptance**: Run storage, secret-leak, SSRF, redirect, malformed-file, duplicate, retry, supersession, backup/restore, and backward-compatibility tests.

## Milestone V01-02 - Supplier adapter framework and provider implementations

- [x] **V01-02.001 - Implement shared supplier adapter conformance harness**: Create deterministic fixtures for search, pagination, rate limit, timeout, authorization, partial scope, unavailable surface, document discovery, download, cancellation, and retry.
- [x] **V01-02.002 - Implement coverage reporting contract**: Every adapter must report scanned scope, markets/languages/product lines, pages/products checked, documents found/acquired, inaccessible surfaces, unsupported capabilities, and gaps.
- [x] **V01-02.003 - Implement public/API supplier profile over existing REST connector**: Reuse FVL-04 REST authority for declared hosts, pagination, rate limits, source links, and response normalization.
- [x] **V01-02.004 - Implement authenticated portal profile**: Support user-attended authentication and secure session references without bypassing MFA/CAPTCHA or supplier controls.
- [x] **V01-02.005 - Implement manual-assisted supplier profile over existing FILE/Data Exchange paths**: Allow user-selected catalog, formulation, SDS, TDS, or bundle import with complete provenance and no automatic master-data approval.
- [x] **V01-02.006 - Implement provider delta/recheck behavior**: Use revision/date/hash/cursor capabilities when available and honest full rescans when not available.
- [x] **V01-02.007 - Implement Dow provider profile and SDS/technical-library adapter**: Support verified Dow public/document surfaces and manual-assisted fallback for unsupported scope. Preserve product, market, language, revision, source and hash.
- [x] **V01-02.008 - Implement Clariant provider profile and Document Finder adapter**: Support public Document Finder and separate any authenticated ClariHub capability. Preserve business-unit/product-line scope.
- [x] **V01-02.009 - Implement Evonik provider profile**: Support verified public/document surfaces and user-attended/manual-assisted routes for portal-only content.
- [x] **V01-02.010 - Implement Croda provider profile**: Support Croda Home Care and other verified surfaces for product documents and formulation PDFs, with manual-assisted fallback.
- [x] **V01-02.011 - Implement Nouryon public SDS adapter**: Support public SDS discovery with honest product-family/market/language scope and distinguish no result from unscanned/inaccessible.
- [x] **V01-02.012 - Implement My Nouryon profile**: Support authorized account scope if technically and contractually available; otherwise complete the same task with a user-attended/manual-assisted route.
- [x] **V01-02.013 - Implement CHT public discovery profile**: Map public CHT technical/product surfaces and their limits.
- [x] **V01-02.014 - Implement myCHT authenticated profile**: Support authorized user-attended session based acquisition; if automation is not permitted, complete a guided manual-assisted workflow with equivalent provenance.
- [x] **V01-02.015 - Implement BASF document-center profile**: Support verified BASF public download/document surfaces by product family, market and language.
- [x] **V01-02.016 - Implement BASF portal profiles**: Model sector-specific/customer surfaces separately; if direct automation is unsuitable, complete user-attended/manual-assisted capability.
- [x] **V01-02.017 - Implement Archroma provider profile**: Separate public discovery from authenticated/specialized surfaces and preserve product-line/market scope.
- [x] **V01-02.018 - Implement DyStar provider profile**: Research the current authorized surfaces, then implement automated acquisition where permitted or a user-attended/manual-assisted path otherwise.
- [x] **V01-02.019 - Implement adapter runtime throttling and resilient retries**: Use bounded retries, backoff, rate-limit awareness, cancellation and per-provider isolation so one supplier failure does not stop the queue.
- [x] **V01-02.020 - All-provider conformance acceptance**: Run every implemented provider/profile through the same conformance suite and produce a supported-capability matrix based only on verified behavior.

## Milestone V01-03 - PDF admission, parsing, and universal SDS extraction

- [x] **V01-03.001 - Implement document admission and quarantine**: Validate MIME/signature, encryption, malformed structure, maximum pages/size, safe filename, and parser suitability before processing.
- [x] **V01-03.002 - Implement reproducible page-aware PDF text extraction**: Preserve page boundaries, line/region coordinates where available, document hash, parser version, and extraction warnings.
- [x] **V01-03.003 - Implement bounded conditional OCR fallback**: Use OCR only when page text is insufficient; preserve OCR confidence/source and never OCR digital text unnecessarily.
- [x] **V01-03.004 - Implement multilingual/layout-tolerant SDS section detection**: Recognize section semantics across Croda, Evonik, Clariant, Dow and future layouts rather than hard-coding one supplier template.
- [x] **V01-03.005 - Implement SDS document identity extraction**: Extract supplier/manufacturer, product/trade name, product/material code, SDS version, revision/issue/print dates, market/regulatory regime, language, and source identifiers.
- [x] **V01-03.006 - Implement Section 1 commercial identity extraction**: Extract declared chemical name, chemical nature, CAS/EC when stated, recommended use, restrictions, industry sector and product-level description as separate evidence.
- [x] **V01-03.007 - Implement Section 2 hazard extraction**: Extract classification scheme, hazard classes/categories, signal word, H/P statements, pictograms where available, PBT/vPvB/endocrine statements and market context without making approval decisions.
- [x] **V01-03.008 - Implement Section 3 substance/mixture and composition extraction**: Extract substance-vs-mixture declaration, component original name, CAS, EC, exact/range concentration, unit/basis, trade-secret flags, M-factors/SCL/ATE when present, and undisclosed remainder state.
- [x] **V01-03.009 - Implement Section 7 storage and handling extraction**: Extract storage temperature, container/material compatibility, shelf/storage stability, incompatibilities, and explicit handling constraints as evidence.
- [x] **V01-03.010 - Implement Section 8 exposure-control extraction**: Extract OEL/TWA/STEL, regulation/source, units, PPE, glove material/breakthrough/thickness, respiratory requirements, and engineering controls as safety evidence.
- [x] **V01-03.011 - Implement Section 9 physical-property extraction**: Extract physical state, color, odor, pH, freezing/boiling/flash points, density/relative density, solubility, vapor pressure, logP, viscosity, molecular weight and related values with units and context.
- [x] **V01-03.012 - Implement measurement-context model**: For every physical value preserve temperature, sample concentration, delivered-form basis, method/standard, typical/specification wording, measured/literature/estimated status, page/section, original text and normalized value.
- [x] **V01-03.013 - Implement Sections 10-15 evidence extraction**: Extract stability/reactivity, incompatible materials, transport, ecological/regulatory and other structured evidence needed by existing safety/regulatory systems without automatically changing their verdicts.
- [x] **V01-03.014 - Universal SDS extraction acceptance matrix**: Verify Croda, Evonik, Clariant and Dow fixtures, including layout differences, pure substance, solution, polymer, complex blend, partial disclosure, trade secret, condition-bound pH/viscosity/density, and typical-value warnings.

## Milestone V01-04 - Commercial product identity and canonical chemical resolver

- [x] **V01-04.001 - Implement commercial-product identity schema**: Preserve supplier, trade name, product code/grade, regional/language aliases, source documents, source formulation references, lifecycle and review status separately from canonical chemistry.
- [x] **V01-04.002 - Implement canonical chemical library schema**: Support stable canonical IDs, preferred name, CAS/EC, INCI where appropriate, abbreviations/synonyms, chemical family, functional families, and provenance for library entries.
- [x] **V01-04.003 - Implement deterministic CAS and EC normalization**: Validate formats/check digits where applicable, preserve original strings, and refuse conflicting identities.
- [x] **V01-04.004 - Implement chemical-name and synonym normalization**: Normalize controlled aliases without collapsing distinct materials solely because names are similar.
- [x] **V01-04.005 - Implement commercial product type classifier**: Classify evidence-backed product type as PURE_OR_NEAR_PURE, SOLUTION, POLYMER, MULTICOMPONENT_BLEND, PROPRIETARY_BLEND, PARTIALLY_DISCLOSED, or UNKNOWN.
- [x] **V01-04.006 - Implement Section 1 vs Section 3 evidence separation**: Store product-level chemical description separately from component-level composition and reconcile only through explicit resolver logic.
- [x] **V01-04.007 - Implement single/near-pure component resolver**: Resolve products to canonical chemistry when Section 1/3 identifiers and concentration evidence support one dominant identity.
- [x] **V01-04.008 - Implement solution resolver**: Represent a known solute in solvent/carrier without pretending the concentration range is exact or automatically active matter.
- [x] **V01-04.009 - Implement polymer resolver**: Support polymers/crosspolymers/macromolecular materials, canonical polymer identity, material number/CAS, and polymer-specific properties without forcing small-molecule assumptions.
- [x] **V01-04.010 - Implement multicomponent blend resolver**: Represent each disclosed component, concentration/range, known remainder and unknown remainder; never flatten blends into one false chemical.
- [x] **V01-04.011 - Implement proprietary/partial disclosure resolver**: Preserve trade-secret/withheld/generic-family evidence and classify PARTIAL, AMBIGUOUS or UNKNOWN rather than fabricating composition.
- [x] **V01-04.012 - Implement confidence-state engine**: Use EXACT, HIGH_CONFIDENCE, PARTIAL, AMBIGUOUS and UNKNOWN with machine-readable reasons, supporting evidence and deterministic rules.
- [x] **V01-04.013 - Implement composition-fraction model**: Store exact/range component fraction separately from product concentration, solids, assay, active matter and formulation contribution.
- [x] **V01-04.014 - Implement active-matter evidence model**: Accept active matter/solids/assay only when explicitly supported by SDS/TDS/other authorized evidence; never infer it solely from a hazard-disclosure range.
- [x] **V01-04.015 - Implement bounded formula contribution calculator**: When evidence supports component fraction/active content, calculate supplier-product-percent x component-fraction as exact or bounded range with full lineage.
- [x] **V01-04.016 - Implement physical-property evidence linkage**: Link condition-bound Section 9 values to the commercial product without silently copying them into RawMaterial master fields.
- [x] **V01-04.017 - Implement human identity review workflow**: Allow authorized user accept/edit/reject/needs-review for commercial-product type, canonical identity, components, concentration/active claims and aliases.
- [x] **V01-04.018 - Implement RawMaterial application proposal**: Route explicitly accepted field proposals through existing Data Exchange/material authorities; no silent RawMaterial overwrite or auto-verification.
- [x] **V01-04.019 - Implement resolver conflict and revision behavior**: Newer SDS evidence creates new/revised resolution evidence without rewriting historical reference-formula mappings unless an authorized review updates the normalized mapping version.
- [x] **V01-04.020 - Resolver acceptance using all supplied fixtures**: Prove correct handling of Croda Incromine, ECO Brij, NatraSense, Crodateric; Evonik ABIL ME 45 and DERMOFEEL PA; Clariant Aristoflex TAC; Dow DPM. Verify original trade identity is preserved and unsupported chemistry stays unresolved.

## Milestone V01-05 - Supplier formulation PDF ingestion

- [x] **V01-05.001 - Implement immutable reference-formulation source schema**: Store supplier, source PDF hash, URL/file identity, publication/revision/date, formulation code, title, market/language, parser version, rights metadata and acquisition provenance.
- [x] **V01-05.002 - Implement layout-agnostic formulation parser contract**: Parse supplier formulation PDFs by semantic tables/headings and page structure rather than fixed Croda coordinates.
- [x] **V01-05.003 - Implement conditional formulation OCR**: Reuse the bounded PDF/OCR pipeline for scanned formulations only.
- [x] **V01-05.004 - Implement formulation identity extraction**: Extract supplier, application/product family, formulation title, formulation code, revision/date, document version, page and source identity.
- [x] **V01-05.005 - Implement ingredient-line extraction**: Extract original ingredient/trade name, supplier product code when present, INCI/chemical wording, functionality, phase/order, amount, unit/basis, q.s. semantics and page evidence.
- [x] **V01-05.006 - Implement formula arithmetic validation**: Compute totals, preserve source total, detect inconsistencies/duplicates/unknown units, and never silently repair source values.
- [x] **V01-05.007 - Implement procedure/process extraction**: Extract ordered additions, dissolve/mix/hold instructions, temperatures, speeds, times, pH adjustment, thickening, clarity/homogeneity and other explicit process facts.
- [x] **V01-05.008 - Implement finished-product target/result extraction**: Extract source-stated pH, viscosity, density, appearance and other targets/typical results with approximate/range/context semantics.
- [x] **V01-05.009 - Implement source-line to commercial-product candidate matching**: Match exact supplier + trade name/product code first, then controlled aliases. Fuzzy similarity alone may propose but never auto-link.
- [x] **V01-05.010 - Implement unresolved ingredient queue**: Keep formula lines without supporting supplier/SDS evidence as unresolved and acquisition/review-ready while preserving the full reference formula.
- [x] **V01-05.011 - Implement structured reference-formula record**: Persist queryable reference formulas separately from production Formulation/FormulationVersion and never create a validated or approved production formula on import.
- [x] **V01-05.012 - Croda HC/DW/22 formulation acceptance**: Parse the supplied Hand Dishwash Detergent Liquid fixture: source identity, procedure, all ingredient/function/%w/w lines, pH ~7 instruction and ~375 cP value. Match supplied Croda SDS products and keep unsupported SLE(3)S/Crothix unresolved.
- [x] **V01-05.013 - Cross-supplier formulation layout harness**: Add parser fixtures for at least two additional supplier layout families before claiming generic support. If external fixtures are not yet available, create structurally different authorized test fixtures without fabricating chemical claims.
- [x] **V01-05.014 - Formulation extraction review workflow**: Provide side-by-side source evidence and extracted formula identity/lines/process/targets with accept/edit/reject/needs-review decisions.

## Milestone V01-06 - Reference formulation normalization, indexing, and corpus ingestion

- [x] **V01-06.001 - Implement original-versus-normalized dual representation**: Never rewrite original source text/amount/function; attach separately versioned commercial-product and canonical-chemistry normalization.
- [x] **V01-06.002 - Reuse existing FVL-04 crosswalk authority for supplier product mapping**: Extend semantics only where necessary and avoid a second generic crosswalk registry.
- [x] **V01-06.003 - Implement normalized ingredient contribution records**: Store exact/ranged/unknown canonical component contributions with source SDS/formula lineage.
- [x] **V01-06.004 - Implement supplier-function versus canonical-function separation**: Preserve supplier-stated functionality as evidence and keep canonical functional classification independently reviewed.
- [x] **V01-06.005 - Implement normalized process representation**: Index explicit addition order, phase, pH adjustment, temperature, mixing, hold, finish and other process facts without filling missing steps.
- [x] **V01-06.006 - Implement normalized target/property representation**: Index formula-level pH/viscosity/density/appearance and other targets/typical results with context and source semantics.
- [x] **V01-06.007 - Implement reference-formula query schema**: Create query-optimized fields for supplier, product family, commercial product, canonical chemical, functions, amount/range, active/component contribution, process, targets, market, language and source revision.
- [x] **V01-06.008 - Implement deterministic local indexes**: Build rebuildable indexes for aliases, canonical IDs, commercial-product IDs, suppliers, families, functions and numeric ranges so runtime retrieval never parses PDFs.
- [x] **V01-06.009 - Implement bulk supplier-formula import job**: Support hundreds/thousands of PDFs with resumable ingestion, source-hash deduplication, per-file errors, review queues and idempotent re-import.
- [x] **V01-06.010 - Implement 2,000-formula corpus quality metrics**: Report product-family coverage, supplier distribution, resolved-line rate, unresolved-line rate, evidence coverage, parser confidence, revision age and review completion.
- [x] **V01-06.011 - Implement supplier-bias and rights metadata**: Track supplier dominance and source-use/retention/reuse constraints so priors and exports can respect both bias and rights.
- [x] **V01-06.012 - Implement corpus review UI/data service**: Allow tracing every normalized line and contribution back to source formulation and SDS evidence.
- [x] **V01-06.013 - Implement corpus backup/restore and index rebuild**: Preserve immutable source identities, mappings, reviews and evidence; rebuild derived indexes deterministically after restore.
- [x] **V01-06.014 - Corpus ingestion acceptance**: Ingest a multi-supplier fixture corpus, verify deterministic normalization/indexing, unresolved handling, deduplication, restore and no production-formula side effects.

## Milestone V01-07 - Reference formulation intelligence

- [x] **V01-07.001 - Implement reviewed-corpus eligibility filter**: Only reviewed/eligible normalized records contribute to intelligence; unresolved critical identity does not silently enter statistics.
- [x] **V01-07.002 - Implement product-family ingredient frequency priors**: Compute counts/frequencies with sample size, supplier mix and evidence eligibility.
- [x] **V01-07.003 - Implement dosage distributions**: Compute min/max, quantiles and robust summaries per product family/material/function while preserving supplier/sample counts.
- [x] **V01-07.004 - Implement co-occurrence intelligence**: Compute material/function/component co-occurrence as advisory empirical evidence, never chemical compatibility proof.
- [x] **V01-07.005 - Implement active/component contribution distributions**: Use only formulas with defensible composition/active evidence; preserve bounded ranges and exclude unsupported point estimates.
- [x] **V01-07.006 - Implement process-pattern intelligence**: Compute explicit addition-order, phase, pH-adjustment, thickening, temperature, mixing and finish patterns without inventing missing process details.
- [x] **V01-07.007 - Implement target/property distributions**: Compute reviewed reference distributions for pH, viscosity, density and other source-supported formula properties with measurement context.
- [x] **V01-07.008 - Implement supplier-neutral pooled priors**: Expose per-supplier and pooled statistics and prevent a dominant supplier from silently defining universal priors.
- [x] **V01-07.009 - Implement formulation similarity feature model**: Use product family, canonical chemistry, functions, dosage/contribution, process and target context with supplier-neutral features.
- [~] **V01-07.010 - Implement nearest-reference retrieval**: Return nearest reviewed reference formulas with source IDs, distances, contributing features and evidence links.
- [ ] **V01-07.011 - Implement leakage and near-duplicate controls**: Prevent exact formula/revision or near-duplicate variants from acting as retrieval evidence for themselves in evaluation.
- [ ] **V01-07.012 - Reference-intelligence acceptance**: Verify deterministic priors, supplier-bias reporting, similarity retrieval, holdout controls and no conversion of reference evidence into validation.

## Milestone V01-08 - Generator, ranking, and explainability integration

- [ ] **V01-08.001 - Implement reference-context adapter for existing deterministic generator**: Feed eligible priors and nearest references into the current generator without creating a second generation engine.
- [ ] **V01-08.002 - Preserve zero-LLM operation**: Prove reference intelligence works with the deterministic generator when all LLM features are unavailable.
- [ ] **V01-08.003 - Implement empirical dosage guidance**: Use reviewed family priors as soft empirical guidance, never hard chemistry truth unless an existing hard rule separately requires it.
- [ ] **V01-08.004 - Implement empirical ingredient/function guidance**: Use frequency/co-occurrence as advisory candidate context while preserving compatibility, safety, regulatory, manufacturing and availability authorities.
- [ ] **V01-08.005 - Implement active/component-aware guidance**: When defensible, compare candidate active/component contributions with reviewed corpus ranges; otherwise show unavailable rather than guess.
- [ ] **V01-08.006 - Implement process-pattern guidance**: Offer evidence-backed process-pattern context without manufacturing unprovided temperature/time/speed requirements.
- [ ] **V01-08.007 - Implement hard-gate precedence regression**: Safety, Regulatory, compatibility/manufacturing feasibility, availability and explicit formulation constraints always outrank reference popularity.
- [ ] **V01-08.008 - Integrate reference evidence into ranking**: Keep reference support as a separate ranking/explainability dimension from measured performance, predictive model output, uncertainty, cost and hard gates.
- [ ] **V01-08.009 - Implement generator explainability**: Show relevant priors, sample counts, supplier mix, similar references, dosage ranges and source links for generated candidates.
- [ ] **V01-08.010 - Implement reference-support confidence**: Report corpus support quality based on reviewed sample counts/resolution/evidence, not an opaque AI confidence score.
- [ ] **V01-08.011 - Implement reference intelligence on/off comparison harness**: Generate with identical deterministic inputs with feature enabled/disabled and prove hard-rule equivalence plus explainable candidate differences.
- [ ] **V01-08.012 - Generator integration acceptance**: Run multi-family acceptance and confirm no source/reference record mutation, no auto-validation, deterministic zero-LLM behavior, hard-gate precedence and traceable reference influence.

## Milestone V01-09 - User workflows and review surfaces

- [ ] **V01-09.001 - Implement Supplier Connections UI**: Show provider/surface, access mode, authentication state, last check, scope and coverage limitations.
- [ ] **V01-09.002 - Implement catalog/document acquisition UI**: Show search/scan progress, pages/products scanned, documents found/acquired/skipped/failed and per-item retry.
- [ ] **V01-09.003 - Implement acquired document browser**: Open stored source PDFs, metadata, hash, provider, source URL, revision lineage and extraction state.
- [ ] **V01-09.004 - Implement SDS extraction review UI**: Show Section 1/3/7/8/9 and other evidence, original text, normalized value, context, confidence and page link.
- [ ] **V01-09.005 - Implement commercial-product resolver UI**: Show original supplier product, product type, disclosed components, canonical candidates, confidence reasons and unresolved remainder.
- [ ] **V01-09.006 - Implement formulation extraction review UI**: Show source PDF alongside extracted formula lines, functions, amounts, procedure, targets and commercial-product links.
- [ ] **V01-09.007 - Implement RawMaterial proposal UI**: Show accepted evidence versus existing master values and require explicit authorized field-level application.
- [ ] **V01-09.008 - Implement reference corpus browser**: Search supplier/product family/commercial product/canonical chemical/function/dosage/process/target and inspect source lineage.
- [ ] **V01-09.009 - Implement reference intelligence explainability UI**: Display priors, supplier composition, nearest references, support quality and distinction from measured validation/prediction.
- [ ] **V01-09.010 - UI accessibility/localization/error-state acceptance**: Verify keyboard/screen-reader behavior, non-color-only states, localization hooks, empty/partial/error/retry states and no misleading completeness claims.

## Milestone V01-10 - Scientific integrity, security, and end-to-end acceptance

- [ ] **V01-10.001 - Implement no-validation invariant tests**: Prove supplier formula != measured validation, SDS != performance proof, supplier recommendation != validation, and only authoritative LaboratoryTrial/TestResult can satisfy measured semantics.
- [ ] **V01-10.002 - Implement no-auto-approval tests**: Prove import/parser/resolver/generator/system/AI actors cannot approve or verify RawMaterial, Safety, Regulatory, Laboratory or supplier identity decisions reserved for authorized humans.
- [ ] **V01-10.003 - Implement unknown/missing-data regressions**: Verify missing CAS, undisclosed remainder, unknown active matter, missing SDS/TDS, absent process values and unsupported properties remain unknown/unresolved.
- [ ] **V01-10.004 - Implement revision immutability regressions**: Historical formulas, mappings, SDS extractions and generator evidence remain pinned to exact source versions after newer documents/mappings exist.
- [ ] **V01-10.005 - Implement security acceptance**: Test SSRF, redirect abuse, path traversal, spoofed MIME, oversized/encrypted/malformed PDFs, parser failures, secret leakage and hostile filenames.
- [ ] **V01-10.006 - Implement retry/idempotency acceptance**: Verify interrupted scans/downloads/parsing/bulk imports resume without duplicate blobs/products/reference formulas/reviews or split-brain lineage.
- [ ] **V01-10.007 - Implement backup/restore acceptance**: Verify all V01 persisted records, binaries, mappings, reviews and lineage restore exactly and derived indexes rebuild deterministically.
- [ ] **V01-10.008 - Implement Croda end-to-end fixture acceptance**: HC/DW/22 PDF + four Croda SDS: acquisition/import -> formula extraction -> product matching -> SDS evidence -> commercial-product resolution -> normalized/indexed reference formula -> retrieval-ready record, with unsupported identities unresolved.
- [ ] **V01-10.009 - Implement Evonik resolver acceptance**: ABIL ME 45 as complex silicone-quat blend and DERMOFEEL PA as phytic-acid solution, preserving component disclosure, trade-secret limits and context-bound properties.
- [ ] **V01-10.010 - Implement Clariant resolver acceptance**: Aristoflex TAC as polymer/near-pure product with material number, chemical nature, CAS, 90-100% crosspolymer evidence, storage and condition-bound physical properties.
- [ ] **V01-10.011 - Implement Dow resolver acceptance**: DOWANOL DPM as near-pure dipropylene glycol monomethyl ether with exact CAS/EC, >99-<100% composition and typical Section 9 properties explicitly not treated as specification limits.
- [ ] **V01-10.012 - Implement multi-supplier resolver matrix**: Pass pure/near-pure, solution, polymer, multicomponent blend, partially disclosed and proprietary cases through one supplier-agnostic resolver contract.
- [ ] **V01-10.013 - Implement 2,000-formula scale simulation/benchmark**: Exercise bulk ingestion, normalization, index rebuild and retrieval at target corpus scale using authorized or synthetic structural fixtures, without fabricating scientific claims.
- [ ] **V01-10.014 - Implement multi-supplier realism evaluation**: Evaluate held-out reviewed formulas from at least three suppliers/product families using structural/dosage/process plausibility and chemist-review-ready reports; do not claim lab performance from similarity.
- [ ] **V01-10.015 - Run full regression suite**: Run full shared/desktop Vitest, TypeScript typecheck, ESLint, i18n parity, production build, relevant Rust/Python suites, diff check, backup tests, and task-ID/order validation.
- [ ] **V01-10.016 - V01 closure audit**: Independently inspect all V01 production paths, negative paths, persistence, security, human gates, scientific integrity, lineage and generator integration before closure.
- [ ] **V01-10.017 - V01 branch state and publication check**: Verify V01 worktree clean, local HEAD = origin/V01 = GitHub V01, no required V01 work stranded on another branch, and main remains untouched unless the owner explicitly requests merge.
- [ ] **V01-10.018 - V01 completion handoff**: Produce a concise evidence-backed V01 completion record with supported provider capability matrix, fixture results, test counts, known non-blocking limitations and exact final SHA. Do not merge to main.

## Sequential transition rule

After each task:

1. Run the focused acceptance for that task.
2. Fix any discovered defect before closure.
3. Mark the current task `[x]`.
4. Update the V01 progress summary.
5. Mark the immediately following task `[~]`.
6. Commit the implementation and task-state transition together when practical.
7. Push to `origin/V01`.
8. Continue immediately.

After the final task `V01-10.018` passes:

- all 156 V01 task rows are `[x]`
- Completed = 156
- Remaining = 0
- Completion = 100%
- Current task = V01 COMPLETE
- Current status = COMPLETE
- Next task = None
- branch remains `V01`
- do not merge to `main`

## Final completion criteria

V01 is complete only when all of the following are true:

- supplier acquisition reuses the existing FVL-04 connector/data-exchange foundation
- supported provider capability and coverage are truthfully reported
- source PDFs are stored immutably with cryptographic identity and revision lineage
- SDS extraction works across the supplied Croda, Evonik, Clariant and Dow layouts
- commercial products resolve to canonical chemistry only to the extent supported by evidence
- complex/proprietary/partial products preserve blends and unknown remainder
- Section 3 concentration and active matter remain distinct
- physical properties retain measurement context and typical/specification semantics
- supplier formulation PDFs become immutable structured reference formulas
- generator/retrieval runtime uses normalized/indexed records rather than reparsing PDFs
- 2,000-formula-scale corpus ingestion is supported
- reference priors, co-occurrence, process patterns and nearest-reference retrieval are deterministic and supplier-bias aware
- existing deterministic generator uses reference intelligence without weakening hard gates
- zero-LLM generation still works
- reference evidence never becomes measured validation
- no AI/system/import path can auto-approve regulated/master records
- backup/restore, revision immutability, retries, security and negative paths pass
- full project regression passes at closure
- V01 is pushed and clean
- `main` remains unchanged by this development plan
