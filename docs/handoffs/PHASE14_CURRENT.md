# Phase 14 — Evidence-Driven Hybrid Literature & Formulation Intelligence

## Status: SESSION 4 COMPLETE. Ingredient evidence intelligence, real generation provenance, honest 15-source research-corpus guarantee, formula-provenance audit, and rich evidence UI, all wired into the real pipeline and the result screen — `docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` §17. Session 3 (§16): evidence-grounded, request-aware multi-alternative formulation synthesis — strategy derivation, per-version evidence linking, cross-version diversity validation, per-version hard-constraint validation with partial-failure handling, explainable version score. Session 2 (§15): structured evidence extraction, A-E classification, explainable ranking. Session 1 (§14): Literature Search Orchestrator, Findpapers adapter, native OA adapters, CanonicalPaper cross-source dedup. Session 0 (§11a): pipeline audit, `CanonicalPaper` schema, adapter boundary, source-availability decision. The New Formulation Request/Formulation Result screens (§13, built out of sequence) had a real data-contract bug — fixed, §13a. Both formulation UIs (`/live` and the new request/result flow) remain available — temporary, disclosed dual-flow state, unchanged and re-verified this session. Phase 13 closed (implementation-complete) before Session 0 started — see `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §28 and `docs/handoffs/PHASE13_CURRENT.md`.

## Session 4 summary — ingredient evidence intelligence, literature corpus guarantee, formula provenance audit, rich evidence UI

**§1 formula-generation audit**: one real code path produces every
formula — `llm.py::call()`, invoked exactly once per session from
`pipeline.py::run()`. No mock/test-leakage path exists into
production. API keys are never logged at any layer — proven by
running a real generation with a deliberately fake key string
(`THE-SECRET-KEY`) and grepping every output file (`cards.json`,
`generation_provenance.json`, log output) for it: absent everywhere.
New `provenance.build_generation_provenance(provider, model)` persists
`{engine_type: "llm", source: "real_model_call", provider, model,
generated_at}` to `<session>/generation_provenance.json` — built ONLY
after a real successful `llm_call`, never speculatively. This
session's own environment has no real LLM provider configured or
reachable (confirmed by direct inspection, not guessed, per explicit
instruction) — documented as a real, current-environment fact, not a
pipeline limitation.

**§2 ingredient origin model**: new `IngredientOrigin` string
constants (multi-value; an ingredient can be both evidence-backed and
user-required) — `scientific_evidence`, `deterministic_rule`,
`user_required`, `ai_formulation_inference` are real and currently
emitted; `supplier_data`/`internal_formulab_data` are reserved for a
future masterdata connection that does not exist in the generation
path today and are never fabricated. `classify_ingredient_origin()`
checks user-preferred ingredients FIRST, excluding them from the
deterministic-rule check — found and fixed a real double-labeling bug
during manual smoke testing where an ingredient the user explicitly
typed into "Preferred Ingredients" was misleadingly labeled BOTH
`user_required` AND `deterministic_rule` (the rule engine folds
preferred ingredients into its own `prefer` list, so without the
fix it looked like an independent rule had fired when it was really
just an echo).

**§4/§6 the 15-source research-corpus bug**: real bug found in
`literature_cache.py::gather()` — `fetch_pdfs(candidates,
target=target)` stopped early once `target` full texts were obtained,
silently dropping relevant abstract-only candidates from the corpus
entirely (a 15-target request could end up persisting fewer than 15
documents even when 15+ relevant candidates existed). Fixed by fixing
the corpus (`selected = candidates[:target]`) BEFORE attempting any
download, then calling `fetch_pdfs(selected, target=0)` purely for its
side-effect of annotating `fulltext`/`pdf_file` in place — never again
as the corpus-defining filter. A genuine shortfall (fewer than 15
relevant documents actually available) is now reported honestly
(`"only N/15 target unique relevant document(s) were genuinely
available"`), never padded. New `ResearchCorpusSummary`
(`provenance.summarize_research_corpus()`) persists
raw_candidate/qualifying/target/full_text/abstract_only/metadata_only/
evidence_record/unique_evidence_study counts as explicitly separate
fields — corpus size is never conflated with evidence-record count
(one paper can produce several evidence records; several providers
finding the same paper never inflates the unique-study count).
Disclosed gap: `raw_candidate_count` currently equals
`qualifying_count` since `pipeline.py` doesn't yet pass the wider
pre-ranking candidate pool size through — a real, documented
limitation, not silently papered over.

**§8 strict comparability grouping**: new
`evidence.strictly_comparable_group()`/`compute_comparable_stats()` —
groups evidence records by the SAME normalized ingredient key AND the
SAME `(unit, basis)` tuple, requires ≥2 unique studies, and returns
`None` ("insufficient comparable evidence") otherwise. Proven to
correctly exclude incompatible concentration bases (w/w vs.
active-matter), unrelated ingredient categories, and provider
duplication (multiple providers finding the same paper never inflates
`unique_study_count`).

**§10 the q.s./mass-balance bug** — the exact "129.5% w/w accounted
for" scenario named in the brief, found and fixed in TWO places. (1)
Frontend display bug: `generatedFormula.ts::parsePercent()`'s regex
matched the literal "100" inside "q.s. 100" and summed it as a real
percentage on top of the explicit ingredients; fixed with a new
`isQsIngredient()` check applied first. (2) No authoritative
deterministic calculation existed anywhere; added
`provenance.compute_mass_balance()` — explicit ingredients summed,
q.s. closes the formula to exactly 100%, multiple ambiguous q.s.
entries flagged (`ambiguous_multiple_qs`), a negative q.s. amount
rejected (`invalid_negative_qs`), malformed percentages flagged
(`malformed`), totals over 100.5% flagged (`invalid_over_100`), under
99.5% flagged (`incomplete`), otherwise `complete`. The frontend now
prefers the Python-side authoritative `mass_balance.final_total` over
its own client-side sum. Regression-tested with the exact reported
scenario (q.s. 100 + 20% + 9.5%): now correctly totals 29.5%, never
129.5%.

**§11/§12 UI + quality gate**: always-visible (never tooltip-only)
Origin badges per ingredient (`OriginBadge` component), an explicit
AI-only disclosure banner ("AI formulation inference — no direct
supporting evidence found. Laboratory validation required.") when an
ingredient's only origin is `ai_formulation_inference`. New
`provenance.assess_quality()` returns a documented, never-hard-reject
list of `QualityGateFinding`s (mass-balance-invalid,
critical-active-no-evidence, unusual-concentration-no-evidence,
insufficient-research-corpus, low-evidence-coverage,
hard-constraint-violation) — every factor named in
`provenance.QUALITY_GATE_FACTORS`, no hidden thresholds, never a
rejection merely for lacking journal evidence.

**Evidence & Sources tab rewritten**: now shows the FULL research
corpus (not just 2-3 formula-linked papers) via a new Rust command
`read_literature()` reading `<session>/literature/papers.json`
(backward-compatible: an empty array for pre-Session-4 sessions), 6
real `CorpusCounter`s (Research Sources N/target, Unique Studies, Full
Text, Abstract Only, Evidence Records, Formula-Linked Studies), and a
real table (title/authors/year/journal/DOI/A-E class/relevance/
full-text/providers/ingredients-supported/used-by-version).

**Ingredient Evidence panel**: "Why this concentration" now shows the
real `comparable_stats` grid (Observed Range/Median/unique Study
Count/Confidence) when strictly comparable evidence exists, falling
back to alignment-based text otherwise; "Decision Factors" lists real
origins instead of the old generic "not yet computed" placeholder.

**Preserved unchanged**: `CanonicalPaper` dedup/provenance, hybrid
providers, OA/full-text safety, deterministic evidence extraction, A-E
classification, evidence ranking, request-aware V1/V2/V3 strategies,
per-version hard validation, diversity validation, version-specific
evidence linking, explainable version scores, dual formulation-UI
state (`/live` and `/formulation-request`→`/formulation-result`).
Manufacturing Procedure/Critical Parameters/Equipment/full Safety/
Regulatory intelligence deliberately NOT built this session — remains
Session 5/6 scope; those tabs still show honest "not yet available"
notices.

Verified against LIVE data: a disposable real-network smoke test for a
multi-constraint sulfate-free/anti-dandruff/sensitive-scalp request
achieved the full 15/15 target unique relevant document corpus (14
abstract-only, 1 full text — correctly retained where the pre-fix code
would have silently dropped the abstract-only ones), producing 28
evidence records from 7 unique studies. No real LLM provider is
configured in this session's own environment (confirmed by direct
inspection); the disposable generation step therefore could not
exercise a real production LLM call this session — documented
honestly per explicit "do not guess" instruction rather than assumed.

Python: 213/213 passing (180 baseline + 33 new: `test_evidence.py`
comparable-stats tests, new `test_provenance.py`, `test_pipeline.py`/
`test_literature_cache.py` extensions), zero regressions. Rust: 7/7 (2
new `read_literature` tests). Frontend: `tsc`/ESLint clean, 137
files/1231 tests (1210 baseline + 21 new), zero regressions anywhere.
`git diff --check`: clean. Full write-up: architecture doc §17.

## Session 3 summary — evidence-grounded multi-alternative formulation synthesis

New module `runtime/pipeline/strategy.py`. Architecture decision
(documented in full in the module's own docstring): kept the existing
ONE-model-call architecture with a much more structured, strategy-
explicit prompt, rather than switching to `n` isolated calls per version
— preserves this pipeline's own "single request/response" design
principle, its cost/latency profile, and full backward compatibility
with the existing `llm_call` contract and every test built on it (all
151 pre-existing tests pass unmodified). A post-generation diversity
validator is required regardless of call architecture anyway, which is
what makes the extra cost of `n` calls not worth it.

`derive_strategies(brief, constraints, n)` — deterministic, request-
aware: a sensitive/sulfate-free request gets Sensitive Skin/Mildness
Focused, a premium request gets Premium Sensory, a request with a short
stated raw-materials list gets Low Raw-Material Count, etc. — never a
fixed V1/V2/V3 enum. Every strategy's `tradeoffs_forbidden` always
includes the same three universal entries (excluded ingredients,
deterministic safety/regulatory rules, required functions) — no strategy
may override a hard constraint.

`diversity_report()` — explainable (ingredient overlap, concentration
similarity, primary-surfactant match — never an opaque embedding
score), conjunctive (flags a pair only when BOTH ingredient AND
concentration profiles are near-identical, so legitimate same-chemistry-
different-concentration strategies are correctly NOT flagged). Marks
insufficiently-diverse results with an explicit warning rather than
silently regenerating (no repair/retry architecture exists in this
pipeline — real, disclosed future work).

Per-version hard-constraint validation now runs per STRATEGY SLOT, not
per trusted-complete list item: a missing or ingredient-less slot is
marked `status: "generation_failed"` with a real, specific reason,
carrying no fabricated formula — every other slot still generates,
validates, and scores independently (proven directly: 2 of 3 slots
failing for different reasons, the 3rd still a complete real card).

`link_evidence_to_version()`/`concentration_alignment()` — real, per-
version evidence association (the same ingredient across two versions
can carry different linked evidence) and honest concentration labeling
(`evidence_supported`/`evidence_context_only`/`formulab_inference` — no
DOI ever attached to an inferred value). No median/observed-range
statistic computed anywhere (Session 2's own deferral, unchanged).

`compute_version_score()` — `VersionScore` with four named factors,
`total` always exactly their weighted sum, `unique_source_count` not a
field the scorer can read (structurally, not just by convention) —
proven both behaviorally and structurally. Returns `None` ("not yet
available") when there's nothing credible to score. Kept entirely
separate from `violations`/deterministic safety-regulatory PASS-FAIL.

`FormulationResultPage.tsx`: real strategy title/rationale/score in the
version cards, a dedicated failure notice for a `generation_failed`
version (disabled in the card row; the page now opens on the first
successfully-generated version, never a dead tab), real evidence-class/
DOI/outcome data in the Formula tab and the Ingredient Evidence panel —
minimum real wiring, not the full statistics build-out. `cards.json`
stays a flat JSON array (Rust's own requirement); every new field is
purely additive; `formulation_v2.rs` needed ZERO Rust logic changes
(proven by a new test loading a pre-Session-3-shaped card through the
unchanged `read_cards`). One real fix to the pre-existing `/live`
workspace: `card.markdown` became optional, so
`<AgentMessage markdown={card.markdown} />` needed a `?? ""` fallback.

Verified against LIVE data: a disposable generation for a multi-
constraint sulfate-free/anti-dandruff/sensitive-scalp/pH/medium-cost
request correctly derived Balanced/Sensitive Skin/Cost Optimized as its
real strategies, retrieved 120 real candidates with 39 genuine cross-
source duplicates merged, extracted 8 real evidence records, and
produced three genuinely different formulas with three different real
computed scores (0.562/0.603/0.5).

Python: 180/180 passing (151 baseline + 29 new). Rust: 5/5 (1 new).
Frontend: `tsc`/ESLint clean, 136 files/1210 tests (1205 baseline + 5
new), zero regressions anywhere. `git diff --check`: clean. Full
write-up: architecture doc §16.

## Session 2 summary — structured evidence extraction, A-E classification, ranking, formula-synthesis integration

New module `runtime/pipeline/evidence.py`: deterministic, rule-based
extraction (never a second LLM call — "deterministic/traceable" was the
session's own explicit brief) of `EvidenceRecord`s from the SAME already-
deduplicated papers Session 1's orchestrator returns. Recognizes a real
but intentionally not-exhaustive 60-entry ingredient vocabulary seeded
from `rules.py`'s own groups; a mention outside it produces no record —
silence, not a guess. `source_depth` (`full_text`/`abstract_only`/
`metadata_only`) determined from `fulltext.excerpt_for`/the paper's own
abstract/neither. Evidence classes A-E assigned by content only (never by
which provider found the paper) — Class A requires real full text, a
genuine complete-formulation paper, an actual extracted concentration,
AND a reported outcome; `metadata_only` floors at E unconditionally.

Two real extraction bugs found and fixed by testing against a realistic
sentence during this session (not hypothetical): a naive nearest-number
search attached each ingredient's concentration to its NEIGHBOR instead
of itself in a list like "X at 5.0%, Y at 8.0%, Z at 1.0%" (fixed with a
directional, span-aware, no-intervening-mention rule); a naive keyword-
overlap domain check wrongly demoted a real antifungal-efficacy study to
Class D for never literally saying "shampoo" (fixed with an explicit
other-domain-signal list instead of overlap-against-the-request-wording).
A related Session-1 display bug (`provenance_sources` can legitimately
repeat one provider found via multiple query angles) was fixed at the
evidence layer (deduped on read) rather than touching Session 1's already
-tested `literature_cache.py`.

Ranking (`EvidenceScore`: class_weight/full_text_bonus/experimental_data_
bonus/domain_comparability/consistency_bonus/total) has no field for
provider count — structurally, not just by convention, it cannot multiply
scoring weight. `study_count()` counts unique papers by DOI/normalized
title, never by provider or record count — proven with a paper found by 5
providers (1 study) and a paper with 2 distinct findings (1 study, 2
records).

`pipeline.py::run()` wired: calls `evidence.gather_evidence()` on the
existing `papers` list (no second discovery pass), ranks, persists
(`<session>/literature/evidence.json` + a shared library-level cache), and
inserts a `FACT FROM EVIDENCE`/`FORMULAB INFERENCE`/`MISSING` block into
the existing prompt ahead of the raw literature dump — augmented, not
rewritten; `render_card`/the `cards` list's own shape is completely
unchanged, so Rust's `read_session` and both frontend UIs needed no
change and received none. `rules.py`'s deterministic safety engine is
untouched and remains authoritative over anything in the evidence block.

Verified against LIVE data, not just mocks: a disposable local generation
found 9 real evidence records from 2 unique studies, including a genuine
Class-A record (`salicylic acid, concentration 2.0%`, real outcome
sentence, real DOI) extracted from an actual 2026 paper. Test data deleted
immediately after inspection.

`apps/desktop/src-tauri/src/formulation_v2.rs` now also embeds
`evidence.py` (`pipeline.py` hard-imports it) — caught and fixed before
building, via the same embedded-layout-simulation check that would have
caught Session 1's equivalent `canonical_paper.py` gap.

Python: `python -m pytest runtime/pipeline -q` — **151/151 passing** (122
baseline + 27 new `test_evidence.py` + 2 new `test_pipeline.py`
integration tests), zero regressions. No frontend file touched.
`git diff --check`: clean.

Concentration/observed-range statistics deliberately NOT computed this
session (§15's own conditional scope: only safe after comparability
grouping, not built here). Full write-up: architecture doc §15.

## Session round: frontend data-contract repair + dual-flow state (this round, before Session 1)

Traced the real runtime chain (`NewFormulationRequestPage` ->
`generateFormulation()` -> Tauri -> Python pipeline -> persisted session ->
`readSession()` -> `generatedFormula.ts` -> `FormulationResultPage`) after a
report that the result screen showed an unavailable original request, V1/V2/
V3 cards with no summaries, and 0 ingredients despite the pipeline producing
real candidates. Two real bugs in `apps/desktop/src-tauri/src/
formulation_v2.rs`, not the frontend: `read_session`'s `brief` field returned
brief.json's whole wrapper object instead of the inner `brief` (fixed via a
shared `read_brief()` helper); `read_cards` only ever scanned rendered
markdown, since `pipeline.py::run()` had never persisted the structured
`formula`/`violations` object anywhere (fixed: `run()` now also writes
`cards.json`; `read_cards` prefers it, falls back to markdown-only for
sessions written before the fix). Both bugs affected the pre-existing `/live`
workspace identically (same `readSession()` bridge, same `card.formula`
reliance) — fixing `formulation_v2.rs` once repaired both flows. Also wired
the New Formulation Request screen's `excludedIngredients`/
`preferredIngredients`/`claims`/`targetProductType`/`targetPhMin`/
`targetPhMax` fields into `rules.py::derive_constraints`'s deterministic
engine (previously forwarded as opaque LLM context only). **Both flows —
`/live` and the new request/result screens — are explicitly kept available,
temporarily**: the old flow is a fallback because it works, the new flow is
the intended target; removal of the old flow is a future session's decision,
not this one's. Full write-up: architecture doc §13a.

## Frontend screens built out of sequence (this same run, at explicit user instruction)

After Session 0's own backend/design work (below) and after the two
approved screenshots + full UI specification were registered as
documentation, the user explicitly instructed building them immediately
rather than deferring to §12's Session 3/Session 4: "please do these
now, it is not a future reference." Built:

- `apps/desktop/src/app/routes/NewFormulationRequestPage.tsx` —
  Screen 1, routed `/formulation-request`.
- `apps/desktop/src/app/routes/FormulationResultPage.tsx` — Screen 2,
  routed `/formulation-result/:sessionId`.
- Both call the existing, unchanged `generate_formulation`/
  `read_session` commands — no backend/pipeline behavior change. Every
  field shows real pipeline data or an explicit "not yet available"
  notice (no fabricated scores, evidence classes, process steps, or
  safety/regulatory determinations — Sessions 1/2/5/6 build the data
  that would back those).
- Sidebar's "New" entry and the saved-formulations history list now
  point at these two screens; the pre-existing `/live` split-pane
  workspace is unchanged and still fully routed, just no longer the
  default entry point.
- 8 new frontend tests (`NewFormulationRequestPage.test.tsx`,
  `FormulationResultPage.test.tsx`); `src/lib/help/registry.ts`
  extended so both new routes have help coverage (a pre-existing test
  caught the gap, not a new test written to match).
- i18n: new `formulationRequest`/`formulationResult` keys in all 8
  shipped locales (English is the approved-screenshot language;
  the other 7 carry the same English text for these new keys, this
  codebase's existing disclosed-gap precedent).
- Full desktop app rebuilt (`pnpm tauri build`) and the Desktop
  `FormuLab.lnk` shortcut re-verified against the fresh binary.

Full write-up: architecture doc §13. See `docs/
PHASE14_FRONTEND_UI_SPECIFICATION.md` for the complete approved spec
these screens were built from.

## Session 1 summary — Literature Search Orchestrator, adapters, CanonicalPaper wiring

Per §12's proposed breakdown, not redesigned. `literature_cache.gather()`'s
inner collection loop previously discarded a same-run duplicate outright the
instant a second source returned it; it now records every duplicate under
its shared key and, after collection, runs each group through
`canonical_paper.deduplicate()` (Session 0's module, wired for real for the
first time) — one `CanonicalPaper` per study, full provenance preserved,
flattened back to the exact existing flat-row shape plus two additive
fields (`unique_source_count`, `provenance_sources`) so no downstream
consumer needed to change. Verified against the LIVE APIs, not just mocks:
a real disposable local generation found 120 raw candidates and merged 36
cross-source duplicates correctly.

Discovery sources, confirmed by direct live testing this session (same
evidentiary standard as Session 0): **DOAJ** and **Unpaywall** built and
confirmed working, keyless — DOAJ added to the default `sources` string,
Unpaywall wired as the OA-location resolver it actually is (never a search
source), capped at 20 lookups/run. **Semantic Scholar** built and reachable
but rate-limited on an unauthenticated first call — kept opt-in, not
default. **CORE** and **BASE** tested live and found genuinely unavailable
(CORE needs a key this installation lacks; BASE denied the request outright)
— not built as dead-code adapters, recorded `"unavailable"` with the
concrete finding, same treatment as IEEE/Scopus/Web of Science. OpenAlex/
OpenAIRE/Europe PMC/Crossref/arXiv unchanged — OpenAIRE not accidentally
dropped, Crossref kept native (not replaced by Findpapers) since a proven
zero-dependency fetcher already exists.

`runtime/pipeline/findpapers_adapter.py` (new): a real
`LiteratureAdapter`-conforming adapter, lazily importing `findpapers` so its
absence never breaks anything. **Not embedded into the desktop app** — a
real, disclosed architectural constraint: `formulation_v2.rs`'s
`materialize_pipeline()` embeds pure-stdlib `.py` files via `include_str!`,
and `findpapers` pulls in its own third-party dependency tree that packaging
model cannot accommodate without a much larger change. Confirmed `findpapers`
is not installed in this environment. Scoped to Semantic Scholar only (own
doc comment records why OpenAlex/Crossref/arXiv/IEEE/Scopus/WoS/PubMed are
each excluded from its scope).

OA/full-text safety unchanged: Unpaywall backfill only supplies a candidate
URL before the existing, untouched `fetch_pdfs`/`sniff_fulltext` machinery
does the actual (still landing-page-rejecting, still paywall-respecting)
download. Provider isolation preserved: every new fetcher sits behind the
same try/except every existing one does; a bad Unpaywall lookup is caught
per-candidate.

`apps/desktop/src-tauri/src/formulation_v2.rs` now also embeds
`canonical_paper.py` (`literature_cache.py` hard-imports it as of this
session — required, or the embedded desktop app would fail with
`ImportError` on every real run). Verified by materializing the exact
embedded file layout in isolation and importing `pipeline`/`literature_cache`
/`canonical_paper` successfully.

Python: `python -m pytest runtime/pipeline -q` — **122/122 passing** (94
Session-0 baseline + 28 new across this round: 7 `rules.py` constraint-
wiring, 9 `test_discover_fetchers.py`, 6 `test_literature_cache.py`
dedup/backfill, 6 `test_findpapers_adapter.py`), zero regressions. Rust:
`cargo test --release formulation_v2::` — 4/4 new (this file had no tests
before). Frontend: unaffected by Session 1 itself, full suite still
136 files/1205 tests passing. `git diff --check`: clean.

No later Phase 14 session (evidence extraction/ranking §5, manufacturing-
process intelligence §6, full traceability §10) started. Full write-up:
architecture doc §14.

## Deliverables (Session 4)

- `runtime/pipeline/provenance.py` (new) — `GenerationProvenance`,
  `IngredientOrigin`, `classify_ingredient_origin()`, `MassBalance`,
  `compute_mass_balance()`, `QualityGateFinding`, `assess_quality()`,
  `ResearchCorpusSummary`, `summarize_research_corpus()`.
- `runtime/pipeline/test_provenance.py` (new) — 22 tests.
- `runtime/pipeline/literature_cache.py` — the corpus-honesty fix in
  `gather()`.
- `runtime/pipeline/test_literature_cache.py` — rewritten/added tests
  for the corpus fix and shortfall honesty.
- `runtime/pipeline/evidence.py` — `ComparableConcentrationStats`,
  `strictly_comparable_group()`, `compute_comparable_stats()`.
- `runtime/pipeline/test_evidence.py` — 6 new comparable-stats tests.
- `runtime/pipeline/pipeline.py` — wires generation provenance, mass
  balance, ingredient origins, comparable stats, quality gate, and
  research-corpus persistence into every card.
- `runtime/pipeline/test_pipeline.py` — 4 new integration tests.
- `apps/desktop/src-tauri/src/formulation_v2.rs` — embeds
  `provenance.py`, new `read_literature()`, 2 new tests.
- `apps/desktop/src/lib/generatedFormula.ts` — `isQsIngredient()` fix
  for the q.s.-double-counting bug.
- `apps/desktop/src/lib/generatedFormula.test.ts` (new) — 14 tests
  including the exact 129.5%-regression case.
- `apps/desktop/src/lib/formulationV2.ts` — new Session 4 types,
  extended `FormulationCard`/`SessionDetail`.
- `apps/desktop/src/app/routes/FormulationResultPage.tsx` — Origin
  badges, mass-balance display, rich Ingredient Evidence panel, full
  research-corpus Evidence & Sources tab, real Quality Notes/score
  factors on the Summary tab.
- `apps/desktop/src/app/routes/FormulationResultPage.test.tsx` — new
  `SESSION_V4` fixture, 7 new tests.
- 8 locale `session.json` files — new Session 4 keys mirrored into all
  shipped locales.
- `docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` — new §17,
  top status line.
- This handoff.
- `docs/architecture/IMPLEMENTATION_STATUS.md` — Phase 14 entry
  updated.
- The external Phase 14 log — new Session 4 entry.

## Deliverables (Session 1 + the data-contract repair round before it)

- `apps/desktop/src-tauri/src/formulation_v2.rs` — `read_brief()` shared
  helper (brief-unwrap fix), `read_cards` prefers structured `cards.json`
  with markdown fallback, embeds `canonical_paper.py`, new `mod tests`
  (4 tests, this file had none before).
- `runtime/pipeline/pipeline.py` — `run()` also writes `cards.json`.
- `runtime/pipeline/rules.py` — `excludedIngredients`/`preferredIngredients`/
  `claims`/`targetProductType`/`targetPhMin`/`targetPhMax` wired into
  `derive_constraints`; 7 new tests.
- `runtime/pipeline/literature_cache.py` — canonical cross-source dedup
  wired into `gather()`'s collection loop, `backfill_oa_via_unpaywall()`,
  default `sources` gains `doaj`; 6 new tests.
- `runtime/skills/core/formulation-discovery/discover.py` —
  `fetch_doaj`/`fetch_semantic_scholar`/`resolve_unpaywall_oa`, both
  fetchers added to `FETCHERS`; 9 new tests
  (`runtime/pipeline/test_discover_fetchers.py`).
- `runtime/pipeline/findpapers_adapter.py` (new) — `FindpapersAdapter`;
  6 new tests (`test_findpapers_adapter.py`).
- `runtime/pipeline/canonical_paper.py` — `SOURCE_AVAILABILITY` updated
  with this session's live-tested findings (DOAJ/Unpaywall confirmed
  working, CORE/BASE confirmed unavailable, Semantic Scholar confirmed
  rate-limited, Findpapers confirmed not installed).
- `apps/desktop/src/lib/formulationV2.ts` — `FormulationBrief` doc comment
  updated to reflect which structured fields are now actually enforced.
- `docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` — new §13a
  (data-contract repair + dual-flow state) and §14 (Session 1); top
  status line, §12 item 2.
- `docs/PHASE14_FRONTEND_UI_SPECIFICATION.md` — status line updated.
- This handoff.
- The external Phase 14 log (new entries for both rounds).
- `docs/architecture/IMPLEMENTATION_STATUS.md` — Phase 14 entry updated.

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

**Session 5** (per the architecture doc §12's proposed breakdown):
manufacturing-process intelligence — the 9-tab result screen's
remaining not-yet-available tabs (Manufacturing Procedure, Critical
Parameters, Equipment), which Session 4 explicitly did not build
ahead of schedule (real data only, no fabricated process steps). Full
Safety/Regulatory evidence integration remains Session 6. Not started
automatically by this round.
