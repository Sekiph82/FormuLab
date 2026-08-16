# Phase 14 — Evidence-Driven Hybrid Literature & Formulation Intelligence

## Status: SESSION 0 COMPLETE — discovery-pipeline audit, `CanonicalPaper` schema + deduplication algorithm, Findpapers-adapter boundary, and the IEEE/Scopus/Web of Science/Google Scholar availability decision. Full design and every approved product decision: `docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` §11a for this session's write-up, everything else for the still-unbuilt overall design. Phase 13 closed (implementation-complete) immediately before this session started — see `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §28 and `docs/handoffs/PHASE13_CURRENT.md`.

## Session 0 summary

Scope taken exactly as the reservation's own proposed session breakdown
named it (§12 of the architecture doc), not redesigned: audit the
existing discovery pipeline in detail, design the `CanonicalPaper`
schema and deduplication algorithm concretely, design the Findpapers-
adapter boundary, confirm real access to IEEE Xplore/Scopus/Web of
Science/Google Scholar before committing to any of them. No UI work.

**Audit finding**: the architecture doc's own premise — "today it
retrieves literature from exactly three sources: OpenAlex, Europe PMC,
arXiv" — describes `discover.py`'s CLI default, not the real production
path. `literature_cache.gather()` (what the live `generate_formulation`
Tauri command actually calls via `pipeline.py::run()`) defaults to
**four** sources — OpenAlex, OpenAIRE, Europe PMC, Crossref — with
arXiv deliberately excluded. Two already-working native fetchers
(`fetch_crossref`, `fetch_openaire`) exist today; OpenAIRE isn't named
anywhere in the architecture doc's own source list at all. Also
confirmed: `pipeline.py` already generates `n` (default 3) candidate
formulas in one LLM call — the real remaining gap is the version-card
UI, per-ingredient evidence querying, and the CanonicalPaper/provenance
model, not the raw formula count.

**`CanonicalPaper` schema + deduplication, designed and implemented,
not yet wired**: new module `runtime/pipeline/canonical_paper.py` — a
`CanonicalPaper` dataclass with full per-source `ProvenanceEntry`
preservation (today's dedup silently discards the losing duplicate's
row entirely; this doesn't), and a concrete three-tier `deduplicate()`
implementing the architecture doc's DOI-first, then title+author-
overlap, then documented-conservative-fallback priority order. Not
imported by, and does not change the behavior of, any live pipeline
file — Session 1's job to wire real adapters and the orchestrator
through this contract.

**Findpapers-adapter boundary, designed**: a `runtime_checkable`
`LiteratureAdapter` `Protocol` naming `discover.py`'s existing
`_row()`-shaped return type as the one contract every future adapter
must satisfy — reusing the existing shape, not inventing a new one.

**Source availability, confirmed by direct inspection, not assumed**:
no IEEE Xplore/Scopus/Web of Science credential or Google Scholar
integration exists anywhere in this codebase. Recorded as a real,
code-level decision (`canonical_paper.SOURCE_AVAILABILITY`) all four
stay unavailable until real access exists — Session 1 must not build
adapters for them on assumption.

**Approved UI visual references registered, then expanded into a full
implementation specification** (documentation only, not implemented
this session — Session 0 is backend/design scope, no UI work): the user
provided two approved screenshots, `formulation request screen.png` and
`formulation reply screen.png`, copied into the repo as
`docs/assets/phase14/formulation-request-screen.png` and
`docs/assets/phase14/formulation-reply-screen.png`, and cited in the
architecture doc §7/§8. The user then supplied a complete, field-by-
field, tab-by-tab English specification of both screens (every result
tab's exact fields, the right-side evidence panel's structure, quick
actions, version-summary/comparison cards, sidebar contents, form
fields) — recorded in full in the new
`docs/PHASE14_FRONTEND_UI_SPECIFICATION.md`, cross-linked from the
architecture doc §7/§8. Both screenshots' own field values/ingredient
lists/scores are illustrative UX content, not real data — explicitly
not to be copied as such, including a real inconsistency in the reply
screenshot's own mockup content (a sulfate-free request paired with a
sulfate-containing V2 formula) that a real implementation must never
reproduce. No frontend file was created or modified — this is a
documentation-only registration for Session 3 (request screen) and
Session 4 (result screen) to implement from directly.

Python: `python -m pytest runtime/pipeline -q` — 94/94 passing (71
baseline + 23 new), zero regressions in the untouched, already-live
pipeline. No Rust, shared-package, or desktop-frontend file was
touched this session.

## Deliverables (this session)

- `runtime/pipeline/canonical_paper.py` (new) — `CanonicalPaper`,
  `ProvenanceEntry`, `deduplicate()`, `LiteratureAdapter` Protocol,
  `SOURCE_AVAILABILITY` registry. Dormant — not imported anywhere yet.
- `runtime/pipeline/test_canonical_paper.py` (new) — 23 tests.
- `docs/assets/phase14/formulation-request-screen.png` (new) — approved
  UI reference, copied from the user's Desktop.
- `docs/assets/phase14/formulation-reply-screen.png` (new) — approved
  UI reference, copied from the user's Desktop.
- `docs/PHASE14_FRONTEND_UI_SPECIFICATION.md` (new) — the full,
  field-by-field, tab-by-tab English implementation spec for both
  screens, for Session 3/4 to build from.
- `docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` — new §11a
  (this session's full write-up); §7/§8 updated with the approved
  visual references; §12 item 1 marked done; top status line updated.
- This handoff.
- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — new §28 (Phase 13
  closure, a separate action from this session, done immediately
  before it — see that doc for the full record).
- `docs/RELEASE_MANUAL_ACCEPTANCE_CHECKLIST.md` (new) — carries Phase
  13's disclosed native-GUI acceptance item forward as a release-
  preparation item.

## What this session deliberately did NOT do

- Did not install Findpapers or add any real provider integration
  (Crossref/PubMed/Semantic Scholar/CORE/DOAJ/Europe PMC/BASE/
  Unpaywall/IEEE/Scopus/Web of Science/Google Scholar) — that's Session
  1.
- Did not change `discover.py`/`pipeline.py`/`literature_cache.py`'s
  behavior at all — confirmed by the unchanged 71/71 baseline test
  count for those files, plus the fact that nothing imports the new
  module yet.
- Did not build the new query screen or result screen — no frontend
  file was touched. The two approved visual references were
  *registered* as documentation, a separate action from implementing
  them.
- Did not implement evidence extraction, evidence-class ranking,
  manufacturing-process generation, or traceability persistence —
  Sessions 2, 2, 5, and 6 respectively, per the proposed breakdown.
- Did not jump ahead into Session 1's adapter/orchestrator work.
- Did not touch real user/business data, `.FormuLab/runs.db`,
  `%APPDATA%\com.formulab.app` business data, OneDrive FormuLab data,
  unrelated generated docs, unrelated `formulas/*` changes, or
  release/signing work.

## Open decisions requiring a human answer before Session 1

1. `fetch_crossref`/`fetch_openaire` (existing, working native
   fetchers) vs. Findpapers' own coverage of Crossref — keep the
   native fetchers, or replace them with Findpapers-routed calls once
   Findpapers is installed?
2. Any change to the deliberate arXiv-excluded-by-default policy in
   `literature_cache.gather()` once real deduplication exists to make
   arXiv noise less costly than it is today?

## Exact next Phase 14 session

**Session 1** (per the architecture doc §12's proposed breakdown, not
redesigned): Literature Search Orchestrator + Findpapers adapter + the
native CORE/DOAJ/Europe PMC/BASE/Unpaywall adapters, producing real
deduplicated `CanonicalPaper`s with full provenance by wiring
`canonical_paper.py`'s contract into the actual pipeline. No UI
changes. Not started automatically by this session.
