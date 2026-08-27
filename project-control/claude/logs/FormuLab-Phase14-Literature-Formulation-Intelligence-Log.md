# FormuLab Phase 14 — Evidence-Driven Hybrid Literature & Formulation Intelligence — External Log

## Session 0 — discovery-pipeline audit, CanonicalPaper schema + deduplication algorithm, Findpapers-adapter boundary, source-availability decision (2026-08-16)

Phase 13 (Enterprise Identity, Authentication, Fixed RBAC & Application
Security) closed as implementation-complete immediately before this
session, by explicit human decision — see
`C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md`'s own
closure entry. This is Phase 14's first real session; scope taken
exactly as the reservation's own proposed breakdown named it
(`docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` §12 item 1, not
redesigned): audit the existing discovery pipeline in detail, design the
`CanonicalPaper` schema and deduplication algorithm concretely, design
the Findpapers-adapter boundary, confirm real access to IEEE Xplore/
Scopus/Web of Science/Google Scholar before committing to any of them.
No UI implementation this session — the brief this session ran under was
explicit that frontend work only happens if the currently active Phase
14 session explicitly includes it, and Session 0 does not.

### The pipeline audit — one material finding the architecture doc itself had wrong

`runtime/skills/core/formulation-discovery/discover.py` (421 lines),
`runtime/pipeline/pipeline.py` (569 lines), `runtime/pipeline/
literature_cache.py` (486 lines), `runtime/pipeline/fulltext.py` (243
lines), `runtime/pipeline/rules.py` (152 lines), and `runtime/pipeline/
llm.py` (113 lines) were read in full, not skimmed.

The architecture doc's own §0/§1 premise says: "Today it retrieves
open-access-only literature from exactly three sources — OpenAlex,
Europe PMC, arXiv." That is `discover.py`'s CLI default
(`--sources openalex,europepmc,arxiv`) — accurate for someone invoking
`discover.py` directly from the command line, but **not** what the real
application does. `literature_cache.gather()` — the function
`pipeline.py::run()` actually calls, and therefore what the live
`generate_formulation` Tauri command (`formulation_v2.rs`) actually
runs on every real request — has its own, different default:
`sources: str = "openalex,openaire,europepmc,crossref"`. Four sources,
not three, and arXiv is **not** one of them — `gather()`'s own code
comment explains why: "arXiv is deliberately NOT a default source. It
indexes physics/CS/math preprints and holds essentially no consumer-
formulation literature, so it contributes noise that merely shares a
word."

This matters for Phase 14 Session 1's adapter work in two concrete
ways. First, `discover.py` already has a working `fetch_crossref`
fetcher — Crossref is listed in the architecture doc's §3 under
"Findpapers adapter" sources, implying it would be newly covered via
Findpapers, when in fact a real, already-live native fetcher exists
today; Session 1 should make a deliberate keep-vs-replace decision, not
assume Crossref coverage needs to be built from scratch. Second,
`discover.py` also has a working `fetch_openaire` fetcher — OpenAIRE
aggregates European open-access repositories and surfaces green-OA
copies other sources can't — and it does not appear ANYWHERE in the
architecture doc's §3 source list, neither under Findpapers nor under
"native/specialized FormuLab adapters." It is a real, currently-live,
default-on source that the design document simply never named. Session
1 should add it to the native-adapter list, not silently drop it when
wiring the real orchestrator through `canonical_paper.py`'s contract.

A third, smaller finding while auditing `pipeline.py::run()`: it
already generates `n` (default 3) candidate formulas in a single LLM
call today, writing `v1`/`v2`/`v3` cards to disk. The architecture
doc's §1 framing — "Formula output: one synthesized candidate → at
least three evidence-driven, independently explainable alternatives" —
slightly overstates the generation-count gap; the pipeline can already
produce multiple candidates. The real, still-open gap Session 3/4 will
need to close is the version-card UI (§8), per-ingredient evidence
querying keyed by the full `formulaVersionId + ingredientId +
concentration` triple (§9), and the `CanonicalPaper`/provenance model
underneath the citations (§4) — not the raw count of formulas the
pipeline is capable of producing in one call.

### `CanonicalPaper` schema and deduplication algorithm — designed, implemented, deliberately not wired

New module: `runtime/pipeline/canonical_paper.py`. Not imported by, and
does not change the behavior of, `discover.py`, `pipeline.py`, or
`literature_cache.py` — confirmed by the unchanged 71/71 baseline test
count for those files after adding it, and by direct inspection that
nothing references it. This is deliberate: Session 0's brief is to
design the schema and algorithm "concretely," Session 1's is to wire
real adapters and the orchestrator through it — this module is the
former, complete and independently testable, without doing the latter's
job early.

**`CanonicalPaper`** (a `dataclass`): `title`, `year`, `authors`,
`venue`, `doi`, `is_oa`, `oa_url`, `abstract` — deliberately mirroring
`discover.py::_row()`'s existing field set for the representative
record, since that dict shape is already the shared result shape §3's
"Adapter boundary rule" requires, not a new shape to invent — plus
`sources: List[ProvenanceEntry]`, the part today's dedup does not have
at all. `unique_source_count` is a computed property, not a stored
field, specifically to make architecture doc §5's distinction concrete
in code: "provider agreement across sources for the same study improves
provenance/metadata confidence, it does NOT multiply the underlying
experimental evidence count" — `unique_source_count` is exactly the
number that answers "how many independent providers agree this is a
real, findable paper," never conflated with an evidence count derived
from it.

**`ProvenanceEntry`** (a frozen `dataclass`): `source`, `source_id`
(normalized DOI when present, else a normalized-title fallback so every
entry has SOME stable lookup key), `retrieved_at`, and `raw` — the
original fetched row, verbatim, never mutated. This is the field
today's `literature_cache.py` dedup (a flat `paper_key()`-based
dict/list with no merge step at all — the second occurrence of a
duplicate key is simply skipped, its row thrown away) has no equivalent
of whatsoever. Architecture doc §4: "every source that contributed to
it is preserved as its own provenance entry ... never discarded once
deduplication picks a canonical representation" — `ProvenanceEntry`
is that requirement, made real.

**`deduplicate(rows, source_key="source_db", fetched_at="")`** — the
concrete algorithm, three tiers, matching architecture doc §4's own
stated priority order exactly:

- **Tier 1 (DOI exact match)**: rows sharing the same non-empty
  normalized DOI (same normalization `discover.py::_row()` already
  applies at fetch time — lowercase, `https://doi.org/` prefix
  stripped, whitespace trimmed) merge into one `CanonicalPaper`,
  regardless of which source(s) contributed them.
- **Tier 2 (no DOI on either side)**: rows with an empty DOI merge only
  when BOTH the normalized title matches exactly AND at least one
  author surname overlaps between the two rows' author strings — two
  independently weak signals, deliberately combined rather than
  trusting either alone (a title-only match risks merging two
  different studies sharing a generic title like "A Review of
  Surfactants"; an author-only match risks merging two different
  papers by a common-surnamed author).
- **Tier 3 (the documented fallback)**: architecture doc §4 explicitly
  defers "the exact similarity-threshold algorithm" for "the remaining
  ambiguous cases" to a later point, not to this session specifically —
  read carefully, that sentence is about NOT over-committing to a
  precise fuzzy-matching threshold today, not a mandate to leave dedup
  half-finished. This algorithm resolves it with a deliberate,
  documented, conservative choice: anything clearing neither tier stays
  its OWN distinct `CanonicalPaper`, never guessed into a merge on a
  single weak signal. The reasoning is architecture doc §5's own
  explicit warning made operational: a missed merge costs a little
  provenance completeness (the model sees a duplicate as two entries
  instead of one — annoying, correctable later by a stronger
  algorithm); a WRONG merge silently pools two different studies'
  concentration data into one evidence range or inflates an evidence
  count with data that was never really independent — a genuinely
  dangerous, hard-to-detect-after-the-fact failure mode. The algorithm
  is deliberately biased toward the safe failure.

`author_surnames()` is deliberately simple — the last whitespace-
separated token of each `;`- or `,`-split author entry, lowercased —
and does NOT attempt `pipeline.py::_surname()`'s more careful
surname-first-vs-surname-last format detection (OpenAlex writes "Given
Surname"; Europe PMC writes "Surname Initials", comma-separated). This
is a deliberate scope decision, documented directly in the function's
own doc comment: Tier 2 only uses this set as a SECONDARY confirming
signal alongside an exact title match, so an occasional wrong
single-name extraction on the comma-separated surname-first format only
produces a missed merge — the safe failure mode this whole algorithm is
already biased toward — never a wrong one. Building the fuller
citation-quality surname detection here would duplicate logic that
already exists in `pipeline.py` for a purpose (correct citation
attribution shown to a person) this dedup check does not actually need.

### Findpapers-adapter boundary — designed

A `runtime_checkable` `Protocol`, `LiteratureAdapter`, with one method:
`search(query: str, max_results: int) -> List[Dict[str, Any]]`,
returning `_row()`-shaped dicts. This names the boundary architecture
doc §3's "Adapter boundary rule" requires — "every source ... returns
into one shared FormuLab-side result shape before touching any FormuLab
business logic" — as the EXISTING shape `discover.py`'s five current
fetchers (`fetch_openalex`, `fetch_crossref`, `fetch_europepmc`,
`fetch_openaire`, `fetch_arxiv`) already produce, not a new shape
Session 1 would need to migrate the old fetchers onto. A future
Findpapers-wrapping adapter and every native adapter (CORE/DOAJ/BASE/
Unpaywall, per §3, plus OpenAIRE per this session's own audit finding
above) implement this same `search()` signature.

### Source availability — confirmed by direct inspection, not assumed

Architecture doc Risks items 1-2 explicitly required this session to
CONFIRM, not assume, real access before committing adapter work to IEEE
Xplore, Scopus, Web of Science, or Google Scholar. Checked directly:
`runtime/pipeline/llm.py`'s `OPENAI_COMPATIBLE` provider table is the
only external-API credential registry this pipeline has anywhere, and
none of the three institutional databases appear in it — no API key
environment variable, no base URL, no institutional-proxy configuration
exists for any of them in this codebase. A broader search
(`grep -rli "ieee|scopus|web of science|scholar.google|serpapi"` across
Python/TypeScript/Rust/JSON/env files) turned up only incidental,
unrelated hits (a paper title mentioning IEEE as a venue name, a math
abbreviation in `doeMath.ts`) — no real integration or configuration of
any kind for any of the four planned-but-uncertain sources.

**Decision**: all four (`ieee_xplore`, `scopus`, `web_of_science`,
`google_scholar`) are recorded in `canonical_paper.SOURCE_AVAILABILITY`
with `status: "unavailable"` and a stated reason each. This is a real,
Session-1-consultable code artifact, not just a paragraph in this log —
Session 1 must not build adapters for any of the four on the assumption
that "where legitimately available" (the architecture doc's own
phrasing) resolves to yes for this installation; it resolves to no,
confirmed, for all four, today. The orchestrator (Session 1's job) must
work correctly with all four absent — already an explicit architecture
doc requirement for Google Scholar specifically (§3: "the orchestrator
must work correctly with Google Scholar entirely absent"), now made
explicit for the institutional three as well, on the same evidentiary
footing.

### Approved UI visual references — registered, not implemented

The user provided two approved screenshots mid-session:
`formulation request screen.png` and `formulation reply screen.png`
(from the user's Desktop). Both were reviewed directly (image content,
not just filenames) and confirmed to match the architecture doc's own
§7/§8 design closely — the reply screenshot in particular shows all
nine of §8's fixed result-screen tabs (Formül, İşlem Reçetesi, Kritik
Parametreler, Ekipman, Güvenlik, Regülasyon, Kanıtlar & Kaynaklar,
Alternatifler, Özet) exactly as specified, plus the V1/V2/V3 selector-
card layout and the right-side selected-ingredient evidence panel §9
describes.

Both files were copied into the repository as durable, version-
controlled assets — `docs/assets/phase14/formulation-request-
screen.png` and `docs/assets/phase14/formulation-reply-screen.png` —
rather than left as a pointer to a Desktop file that could move or be
deleted later, and cited directly in the architecture doc §7/§8 as the
approved visual target for whichever future session implements those
screens. **Registering the reference is a documentation action,
separate from implementing the screens themselves** — no frontend file
was touched this session, consistent with Session 0's backend/design-
only scope.

One deliberate exception noted, not silently absorbed: the reply
screenshot's own illustrative content contains a real inconsistency —
its pinned "original request" text explicitly asks for a "sülfatsız"
(sulfate-free) product, while its V2 formula table's own top ingredient
is "Sodium Coco-Sulfate (SCS)." This is flagged explicitly in the
architecture doc §8 as a reference-image artifact, not a product
requirement, specifically so a future implementing session doesn't
reproduce it — real ingredient exclusion for a sulfate-free/sensitive
request is already deterministic and already correctly enforced today
by `runtime/pipeline/rules.py::derive_constraints`/`validate`
(unchanged by this session, and unchanged by Phase 14's design at all —
reused as-is), which is what a real implementation must actually rely
on, not the mockup's illustrative table.

### Approved UI reference screenshots expanded into a full specification

After the two screenshots were registered (previous section), the user
supplied a complete, field-by-field, tab-by-tab English specification
of both screens — every one of the nine result tabs' exact fields, the
right-side ingredient-evidence panel's structure, quick actions, the
version-summary/comparison cards, the request screen's sidebar and form
fields. Recorded in full in a new dedicated document,
`docs/PHASE14_FRONTEND_UI_SPECIFICATION.md`, cross-linked from the
architecture doc §7/§8 rather than inlined into those sections (which
would have made the architecture doc unwieldy and duplicated content
this new file is now the single source of truth for). Same phase
discipline as the screenshot registration itself: documentation only,
no frontend file touched, explicit instruction followed to "document
this specification now... continue only the currently authorized Phase
14 session... do NOT prematurely build these screens." Per the
architecture doc §12's breakdown, the request screen remains Session
3's scope and the result screen Session 4's — this specification does
not pull either forward, it only means those future sessions build from
a complete spec instead of re-deriving one from the screenshots alone.

### Verification

`python -m pytest runtime/pipeline -q`: 94/94 passing (71 baseline + 23
new in `test_canonical_paper.py`) — zero regressions in the untouched,
already-live pipeline files. No Rust, `@formulab/shared`, or
`apps/desktop` file was touched this session, so none of those suites
were re-run for this session's own changes (Phase 13's closure, a
separate documentation-only action executed immediately before this
session in the same run, already confirmed its own full regression
suite independently — see that closure's own log entry). `git diff
--check`: clean.

### Closure

Files changed: 1 new Python module (`canonical_paper.py`) + 1 new test
file (`test_canonical_paper.py`) in `runtime/pipeline/`; 2 new image
assets in `docs/assets/phase14/`; 1 new frontend spec doc
(`docs/PHASE14_FRONTEND_UI_SPECIFICATION.md`); 1 Phase 14 doc
(architecture — new §11a, §7/§8 updated with the visual references and
spec cross-link, §12 item 1 marked done, top status line updated) + the
handoff, this external log. Pre-
existing, out-of-scope local changes (`docs/generated/*`, `formulas/*`
deletions, the Phase 11/12/13 external-log files) confirmed untouched
via `git status` before and after.

**Exact next session**: **Phase 14 Session 1** — Literature Search
Orchestrator + Findpapers adapter + the native CORE/DOAJ/Europe PMC/
BASE/Unpaywall adapters, wiring `canonical_paper.py`'s now-designed
contract into the real pipeline so `literature_cache.gather()` starts
producing genuine deduplicated `CanonicalPaper`s with real provenance
instead of its current flat, provenance-discarding dedup. No UI
changes in Session 1 either, per the architecture doc's own proposed
breakdown. Not started automatically by this session.

## Frontend screens built out of sequence — New Formulation Request + Formulation Result (2026-08-16, same day, later in the same run)

After Session 0 closed (above) and the two approved screenshots plus
the full field-by-field specification were registered as documentation
(§"Approved UI reference screenshots expanded into a full
specification," above — at that point explicitly NOT implemented), the
user gave a direct, explicit override: "Do not start later Phase 14
sessions automatically. please do these now, it is not a future
reference." This superseded the earlier "documentation only, defer to
Session 3/4" instruction for these two screens specifically. Nothing
else about Session 0's own backend scope, or about not starting Session
1, changed.

Built, from `docs/PHASE14_FRONTEND_UI_SPECIFICATION.md` directly, not
redesigned:

- `apps/desktop/src/app/routes/NewFormulationRequestPage.tsx` (Screen
  1, route `/formulation-request`) and
  `apps/desktop/src/app/routes/FormulationResultPage.tsx` (Screen 2,
  route `/formulation-result/:sessionId`, all nine spec'd tabs plus the
  right-hand selected-ingredient evidence panel).
- Both call the existing, unchanged `generateFormulation()`/
  `readSession()` bridge functions in `formulationV2.ts` — no backend,
  pipeline, or Tauri-command behavior change of any kind. `formulationV2.ts`'s
  `FormulationBrief` type gained 13 new optional fields (target product
  type, excluded/preferred ingredients, target pH/viscosity/active
  matter/cost level, claims, packaging, batch size, equipment, raw
  materials) that reach the Python side as opaque JSON context only —
  `rules.py`'s deterministic constraint engine is unchanged and does not
  enforce any of them.
- New `apps/desktop/src/lib/generatedFormula.ts` normalizes a session's
  raw `FormulationCard` into the typed shape both screens render from.
- Honesty rule enforced throughout, matching the specification and the
  screenshot-inconsistency note recorded above: every field shows real
  pipeline data (real `card.violations` for the Safety tab, real
  `formula.references` for the Evidence tab, the real selected
  ingredient's real concentration in the evidence panel) or an explicit
  "not yet available"/"insufficient evidence" notice — no formula-version
  score, evidence class, process step, or regulatory PASS is ever
  fabricated, since Sessions 1/2/5/6 are what will eventually produce
  the real data behind those. The reply screenshot's own sulfate
  inconsistency (flagged in the Session 0 entry above) is not
  reproduced — real ingredient exclusion still runs through
  `rules.py::derive_constraints`/`validate`, unchanged.
  Only one formula version is ever shown as the main result at a time
  (no side-by-side three-formula comparison view); switching versions
  updates every version-dependent panel and explicitly clears the
  previously selected ingredient's evidence-panel context.
- Sidebar's "New" button and the saved-session history list now point
  at these two new routes; the pre-existing `/live` split-pane workspace
  (`FormulationWorkspaceV2.tsx`) is untouched and still fully routed, just
  no longer the default entry point.
- i18n: new `formulationRequest`/`formulationResult` key blocks added to
  all 8 shipped locales (English is the approved-screenshot language;
  the other 7 mirror the English text for these new keys, this
  codebase's existing precedent for newly-added sections pending real
  translation). `src/lib/help/registry.ts`'s existing "sessions" help
  topic extended to cover both new routes — a pre-existing repo test
  (`registry.test.ts`) caught the coverage gap, not a new test written to
  order.
- 8 new frontend tests added (`NewFormulationRequestPage.test.tsx`,
  `FormulationResultPage.test.tsx`), covering: the approved screen's
  primary sections render; the primary CTA stays disabled until the
  natural-language request field is filled; the example-requests helper
  fills that field; the original request renders fixed/verbatim at the
  top of the result screen; one version card renders per real candidate
  and the Formula tab's ingredient table renders for the selected one;
  selecting an ingredient row opens the evidence panel scoped to that
  ingredient's real concentration; switching versions clears the
  previously selected ingredient's evidence context; a formula-version
  score is never fabricated (renders "not yet available" instead).

### Verification

Full frontend suite, `pnpm vitest run` from `apps/desktop/`: **136
test files, 1205 tests, all passing** (previous baseline plus this
round's 8 new tests), zero regressions. TypeScript (`tsc --noEmit`) and
ESLint (including the strictly-enforced `i18next/no-literal-string`
rule) both clean — two ESLint findings fixed during this round: a
mixed-literal `<li>` in the evidence panel (added an interpolated
`formulationResult.evidencePanel.sourceLine` key) and nine hardcoded
`placeholder="..."` attributes on the request form (added corresponding
i18n keys).

Full desktop app rebuilt for real after this round's code was in place:
`pnpm tauri build` from `apps/desktop/` — TypeScript build, Vite bundle,
and the Rust release compile all succeeded, producing a fresh
`src-tauri/target/release/formulab.exe` plus MSI/NSIS bundles. Verified
directly (`WScript.Shell` COM `CreateShortcut`, `Test-Path`): the
Desktop `FormuLab.lnk` shortcut's `TargetPath` matches this fresh
executable's full path exactly, and the file exists. (An earlier
rebuild+shortcut-verification pass had been done during Phase 13's
closure, before either new screen file existed in the code — that
earlier verification was necessarily stale for this round's own
content and has now been redone against the real, current binary.)

### Closure

Files changed this round: `NewFormulationRequestPage.tsx` (new, +test),
`FormulationResultPage.tsx` (new, +test), `generatedFormula.ts` (new),
`formulationV2.ts` (modified — `FormulationBrief` extended),
`router.tsx` (2 new routes), `Sidebar.tsx` (nav repointed),
`help/registry.ts` (route coverage), 8× `nav.json` +
8× `session.json` (i18n), `PHASE14_FRONTEND_UI_SPECIFICATION.md`
(status → IMPLEMENTED), `PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md`
(new §13), this handoff, this external log entry. Pre-existing,
out-of-scope local changes (`docs/generated/*`, `formulas/*` deletions,
the Phase 11/12/13 external-log files) confirmed untouched.

Desktop shortcut rebuild/repoint is a local-machine convenience action,
not a repository artifact — not committed, consistent with every prior
round in this project.

**Exact next session at the time**: **Phase 14 Session 1** — Literature
Search Orchestrator + Findpapers adapter + native CORE/DOAJ/Europe
PMC/BASE/Unpaywall adapters, wiring `canonical_paper.py`'s contract
into the real pipeline. Not started by that round either — completed in
the round below.

## Data-contract repair + dual-flow state, then Session 1 — Literature Search Orchestrator, Findpapers adapter, native OA adapters, CanonicalPaper dedup wired (2026-08-16, later round)

Instruction: keep BOTH formulation UIs (`/live` and the new request/
result flow) available — the old flow is a temporary safety net, the
new flow is the target — fix the new flow's real runtime data problem
first (original request showing unavailable, 0-ingredient formula
tables despite the pipeline producing real candidates), then continue
directly into Phase 14 Session 1 without stopping.

### Part 1 — tracing and fixing the real data-contract bug

Traced the full runtime chain end to end, not just the frontend:
`NewFormulationRequestPage` -> `generateFormulation()` -> Tauri
`generate_formulation` -> `runtime/pipeline/pipeline.py::run()` ->
persisted session directory -> Tauri `read_session` -> `readSession()` ->
`generatedFormula.ts` -> `FormulationResultPage`. The frontend's own data
contract (`generatedFormula.ts`'s `GeneratedFormula` type, the
`FormulationResultPage.test.tsx` fixture) was already correct — this is
exactly why the bug was invisible to the existing test suite (mocked
`readSession` returns matched the CORRECT post-fix shape, since the
frontend code was never wrong) and had to be found by reading the real
Rust and Python source, not by re-reading the frontend.

**Two real bugs, both in `apps/desktop/src-tauri/src/formulation_v2.rs`**:

1. `read_session`'s `brief` field returned `brief.json`'s whole top-level
   object — `{brief: {...}, constraints_reasons: [...]}` — instead of the
   inner `brief` the frontend's `SessionDetail.brief` type expects.
   `list_sessions` had always unwrapped this correctly
   (`.and_then(|v| v.get("brief").cloned())`); `read_session` never did.
   Every reopened session showed "Original Request (Fixed): unavailable"
   even though the exact request text was sitting right there on disk.
2. `read_cards` only ever scanned the rendered `.md` files
   (`{version, markdown}`) — because `pipeline.py::run()` had never
   written the structured `formula`/`violations` object anywhere on
   disk in the first place, only the markdown render of it. There was
   nothing else for Rust to read. Every reopened session showed 0
   ingredients and no violations, even for a real, successful
   generation, because the structured data behind the markdown simply
   didn't exist as a file.

Fixes: `pipeline.py::run()` now also writes `cards.json` — the same
`cards` list (`[{version, markdown, formula, violations}]`) already held
in memory, session-local, not archived to the flat formula library
(that already has its own `index.json`). `formulation_v2.rs::read_cards`
now prefers `cards.json` when present, falling back to the old
markdown-only scan for sessions written before this fix existed — those
still open, honestly short of structured data (no `formula` key at all),
never an error. `read_session`'s brief bug fixed by extracting a shared
`read_brief()` helper both `list_sessions` and `read_session` now call,
eliminating the duplicated (and previously divergent) unwrap logic
entirely rather than just patching the second copy.

**Both bugs, and both fixes, apply identically to the pre-existing
`/live` (`FormulationWorkspaceV2`) workspace** — it calls the exact same
`readSession()` bridge and already reads `card.formula` for its own Edit
tab and cost panel. This is the concrete, load-bearing proof (not just an
assertion) that the two formulation UIs already "share the same
underlying generation engine and persisted sessions wherever
practical" — fixing `formulation_v2.rs` once repaired both flows
simultaneously, because they were never two separate systems to begin
with, just two front doors onto one.

**Constraint wiring**: `rules.py::derive_constraints` previously only
read `target`/`category`/`audience`/`performance`/`market` — the New
Formulation Request screen's `excludedIngredients`, `preferredIngredients`,
`claims`, `targetProductType`, `targetPhMin`/`targetPhMax` fields reached
the LLM as opaque JSON context only, never the deterministic hard-rule
engine, despite the UI presenting them as real constraints. Now:
`excludedIngredients` reaches the hard avoid-list (and therefore
`validate()`'s post-generation check); `preferredIngredients` reaches the
soft prefer list; `claims`/`targetProductType` are folded into the same
trigger-phrase text `target`/`category`/`performance` already are, so a
"sulfate-free" claim entered ONLY in the Claims field (never restated in
the natural-language request) still fires the sensitive-ingredient
exclusion; `targetPhMin`/`targetPhMax`, when both set, override the
category-derived target pH range. The remaining structured fields
(`targetViscosity`/`targetActiveMatter`/`targetCostLevel`/
`packagingType`/`estimatedBatchSize`/`availableEquipment`/
`availableRawMaterials`) still have no deterministic-rule equivalent and
stay LLM-context-only, honestly disclosed in `rules.py`'s and
`formulationV2.ts`'s own updated doc comments — not silently implied to
be enforced.

**Dual-flow state — explicit and temporary, per instruction**: `/live`
and the new `/formulation-request` -> `/formulation-result/:sessionId`
flow are BOTH available, both routed, today. The old flow is kept as a
fallback because it currently works, not because it is the target; the
new flow is the intended future UI. Neither was hidden or had its
routing broken; no navigation was repointed beyond what an earlier round
already did (sidebar defaults point at the new flow; `/live` remains
fully reachable). Removing the old flow is explicitly deferred to a
later session, once the new flow is proven stable — not decided or
acted on this round.

### Part 2 — Phase 14 Session 1: Literature Search Orchestrator, adapters, CanonicalPaper wiring

Scope per the architecture doc §12's own proposed breakdown, not
redesigned: "Literature Search Orchestrator + Findpapers adapter + the
native CORE/DOAJ/Europe PMC/BASE/Unpaywall adapters, producing
deduplicated `CanonicalPaper`s with full provenance." One disclosed,
evidence-based deviation from the literal source list below.

**The actual orchestrator work — canonical dedup wired into the real
pipeline.** `literature_cache.gather()`'s inner collection loop
previously discarded a duplicate the instant a second source returned
the same paper within one run (`if k in lib_keys or k in new_keys:
continue` — the losing row simply vanished, no provenance kept at all —
this is the exact "today's dedup silently discards the losing
duplicate's row entirely" problem the architecture doc's §4 and Session
0's `canonical_paper.py` module were built to fix, never wired in until
now). The loop now records every duplicate row under its shared key
instead of dropping it; after collection, each key's row group is passed
through `canonical_paper.deduplicate()` — producing one `CanonicalPaper`
per real study (the algorithm's own documented Tier-2 conservative bias
can rarely keep two DOI-less, non-overlapping-author rows separate,
which this wiring respects rather than forcing a merge) — flattened back
to the exact existing flat-row shape every downstream consumer
(`papers.csv`'s field list, `pipeline.py::_paper_context`/
`verify_references`, `fulltext.py`) already expects, plus two additive
fields (`unique_source_count`, `provenance_sources`) so nothing
downstream needed to change. The selection loop's own candidate count/
order/per-source quota accounting is completely untouched by this — the
same papers are chosen as candidates as before, they now just carry
their real cross-source corroboration instead of losing it.

**Verified against the LIVE APIs this session, not just mocked unit
tests**: a real disposable local generation (`pipeline.run()`, mocked
LLM call only, real network calls to OpenAlex/OpenAIRE/Europe PMC/
Crossref/Unpaywall) for "anti-dandruff shampoo" retrieved 120 raw
candidate rows across those four sources and found **36 of them were the
same paper returned by more than one source** — each correctly became
one `CanonicalPaper` with `unique_source_count >= 2` and every
contributing source name preserved in `provenance_sources`, not
discarded or double-counted. Test data (a disposable session + library
directory under this session's own scratch temp directory, never
touching real `.FormuLab/runs.db` or any real user data) was deleted
immediately after inspection.

**Discovery sources — confirmed by direct, live testing, not assumed**
(same evidentiary standard Session 0 applied to IEEE/Scopus/Web of
Science): **DOAJ** built (`discover.fetch_doaj`) and confirmed working,
keyless, against the real API — added to `literature_cache.gather()`'s
default `sources` (now `openalex,openaire,europepmc,crossref,doaj`).
**Unpaywall** built (`discover.resolve_unpaywall_oa`) and confirmed
working, keyless — wired as the OA-location RESOLVER it actually is
(never a search index, per the session's own explicit correction),
`literature_cache.backfill_oa_via_unpaywall()` calling it only for a
candidate with a DOI but no usable `oa_url`, capped at 20 lookups per
`gather()` call, never overwriting a link a source already supplied.
**Semantic Scholar** built (`discover.fetch_semantic_scholar`) and
confirmed reachable, but a live unauthenticated test hit HTTP 429 on the
very first call — kept OFF the default sources (no request key
configured; `llm.py`'s credential table remains the only one this
pipeline has and does not have one), available as an explicit opt-in.
**CORE**: tested live — an unauthenticated request to `api.core.ac.uk/v3`
fails outright (connection refused); CORE v3 requires an API key this
installation does not have. **BASE**: tested live, twice (with and
without a descriptive User-Agent) — `api.base-search.net` returned
`"Access denied for IP address ... and user agent ..."` both times; this
installation is not registered/allow-listed. Neither CORE nor BASE was
built as a `FETCHERS` entry that would only ever fail — both recorded
`"unavailable"` in `canonical_paper.SOURCE_AVAILABILITY` with this
session's own concrete finding, exactly like the IEEE/Scopus/Web of
Science entries Session 0 recorded the same way. Europe PMC/OpenAlex/
OpenAIRE/Crossref/arXiv unchanged — OpenAIRE not accidentally dropped;
Crossref's Session-0-flagged keep-vs-replace question decided KEEP (a
proven, zero-dependency native fetcher already exists, no functional
gain from routing it through Findpapers instead); a separate native
PubMed adapter was NOT built (Europe PMC's own MED coverage stands,
Session 0's incremental-coverage caution unresolved either way this
session).

**Findpapers adapter — built, real, and honestly not bundled into the
desktop app.** New module `runtime/pipeline/findpapers_adapter.py`:
`FindpapersAdapter` implements `canonical_paper.LiteratureAdapter`
structurally (`isinstance(FindpapersAdapter(), LiteratureAdapter)` is
`True`), lazily `import findpapers` inside `search()` so the module's own
import never fails without it. A real, disclosed architectural
constraint found this session, not assumed: `formulation_v2.rs`'s
`materialize_pipeline()` embeds this pipeline's `.py` files via
`include_str!` into an app-private directory with no `pip install` step
— a deliberately pure-stdlib design. `findpapers` is a real PyPI package
with its own dependency tree (requests, lxml, xylose, fake-useragent,
…), so it cannot be added to that embedded set without a fundamentally
different packaging model — out of this session's scope, not silently
assumed to already work. Confirmed directly: `import findpapers` raises
`ModuleNotFoundError` in this environment. The adapter activates only
for a caller running against a full Python environment that happens to
have it pip-installed — `kernel::python_bin()` resolves to the user's
own interpreter, never a bundled one, so this is a real, reachable path
(a dev/CLI run) outside the shipped desktop bundle, not purely
theoretical. Scoped to Semantic Scholar only, per the module's own
documented reasoning (OpenAlex/Crossref/arXiv already have preferred
native fetchers; IEEE/Scopus/Web of Science stay recorded unavailable
regardless; PubMed's incremental value over Europe PMC is unconfirmed) —
and Semantic Scholar already has its own native fetcher too, so this
adapter's concrete value today is proving the real boundary works, not
reaching an otherwise-unreachable source.

**`apps/desktop/src-tauri/src/formulation_v2.rs` now also embeds
`canonical_paper.py`** — `literature_cache.py` hard-imports it as of
this session's dedup wiring, so it must be materialized alongside the
rest of the pipeline or the embedded desktop app would fail with
`ImportError` on every real run. This was NOT already true from Session
0 (that session's own module was dormant/unimported). Verified directly:
materialized the exact embedded file layout (pipeline files +
`canonical_paper.py` + `discover.py` two levels up, matching
`materialize_pipeline()`'s own layout precisely) in an isolated temp
directory and confirmed `import pipeline; import literature_cache;
import canonical_paper` all succeed with zero errors.

**OA/full-text safety preserved, not weakened.** Discovery and full-text
access remain separate stages exactly as before:
`backfill_oa_via_unpaywall()` only ever supplies a candidate URL; the
existing, completely untouched `fetch_pdfs`/`_download_fulltext`/
`sniff_fulltext` machinery still performs the actual fetch and still
rejects anything that isn't a genuine PDF or JATS XML article body — a
landing page is still never saved, paywalled work is still never
touched, Unpaywall backfill runs strictly BEFORE any download attempt
and never downloads anything itself.

**Provider failure isolation preserved.** Every new fetcher sits behind
the exact same per-`(source, angle)` try/except the existing loop
already wraps every `FETCHERS[src](...)` call in — one source failing
(rate limit, timeout, malformed response) logs a warning and the loop
moves on, exactly as OpenAlex/Crossref/etc. already do.
`backfill_oa_via_unpaywall()` catches a per-candidate resolver failure
individually so one bad DOI lookup cannot abort the batch — proven by a
dedicated test asserting the function still returns and still improves
the OTHER candidate when one lookup raises.

**Pipeline compatibility**: `pipeline.py`'s formula-generation logic and
`discover.py`'s five original fetchers are otherwise untouched. No later
Phase 14 session (evidence extraction/ranking, manufacturing-process
intelligence, full traceability) was started.

### Verification

`python -m pytest runtime/pipeline -q`: **122/122 passing** — 94
Session-0 baseline + 28 new this round (7 `test_rules.py` constraint-
wiring tests; 9 new `test_discover_fetchers.py`, mocked-HTTP tests for
DOAJ/Semantic Scholar/Unpaywall covering the real live-confirmed response
shapes; 6 new `test_literature_cache.py` tests — cross-source-duplicate-
merges-into-one-CanonicalPaper-with-provenance, single-source papers
still carry provenance fields, Unpaywall backfill fills a genuine gap/
respects its cap/tolerates a resolver failure, default sources include
DOAJ but not Semantic Scholar/CORE/BASE; 6 new
`test_findpapers_adapter.py` tests; 2 new assertions in the existing
end-to-end pipeline test proving `cards.json`/`brief.json` round-trip
real structured data) — zero regressions in any pre-existing test. Rust:
`cargo check --release` clean; `cargo test --release formulation_v2::` —
4/4 new (this file had no test module before this round). Frontend:
`pnpm vitest run` — 136 files / 1205 tests, unaffected by this round
(no frontend file touched), all still passing. `git diff --check`:
clean.

Full desktop app rebuilt for real: `pnpm tauri build` from
`apps/desktop/` — TypeScript build, Vite bundle, and the Rust release
compile all succeeded, producing a fresh `formulab.exe` (MSI/NSIS
bundles too). Verified directly (`WScript.Shell` COM
`CreateShortcut`, `Test-Path`): the Desktop `FormuLab.lnk` shortcut's
`TargetPath` matches this fresh executable's full path exactly, and the
file exists (timestamp confirmed newer than the previous build).

### Closure

Files changed this round: `formulation_v2.rs` (brief-unwrap fix,
structured-cards fix, embeds `canonical_paper.py`, new test module),
`pipeline.py` (`cards.json` write), `rules.py` (constraint wiring, 7 new
tests), `literature_cache.py` (canonical dedup wiring, Unpaywall
backfill, default sources, module docstring, 6 new tests), `discover.py`
(3 new functions, `FETCHERS` additions), `findpapers_adapter.py` (new, 6
new tests), `canonical_paper.py` (`SOURCE_AVAILABILITY` updated),
`formulationV2.ts` (doc comment), `test_pipeline.py` (2 new assertions),
`test_discover_fetchers.py` (new file), architecture doc (§13a, §14, top
status, §12 item 2), frontend spec doc (status line), this handoff, this
external log entry, `IMPLEMENTATION_STATUS.md`. Pre-existing, out-of-
scope local changes (`docs/generated/*`, `formulas/*` deletions, the
Phase 11/12/13 external-log files) confirmed untouched. Desktop shortcut
rebuild/repoint is local-machine-only, not committed, consistent with
every prior round.

**Exact next session at the time**: **Phase 14 Session 2** — structured
evidence extraction + evidence-class (A-E) assignment + ranking, wired to
the existing formula-synthesis step, per the architecture doc §12's own
breakdown. Not started automatically by that round — completed below.

## Session 2 — structured evidence extraction, A-E classification, explainable ranking, formula-synthesis integration (2026-08-16, later round)

Instruction: start exactly Phase 14 Session 2 (structured evidence
extraction + evidence-class A-E assignment + evidence ranking +
formula-synthesis integration), per the architecture doc §12's own
breakdown, not redesigned; do not start Session 3; preserve both
formulation UIs.

### The actual work — a deterministic evidence layer, not a second model call

New module `runtime/pipeline/evidence.py`. The session's own brief was
explicit: "Build a deterministic/traceable evidence layer" — a model-
based extractor would satisfy neither word, and would carry its own
fabrication risk, which is the exact failure mode this whole phase exists
to guard against. Every field extracted is either read verbatim from the
source text (a real regex match at a real character position, a real
section title from the paper's own structure) or left `None`/unknown;
nothing is inferred or guessed.

**Ingredient vocabulary** (`KNOWN_INGREDIENTS`, 60 entries): seeded from
`rules.py`'s own `SULFATES`/`HARSH_PRESERVATIVES`/`MILD_SURFACTANTS`/
`CHELATORS`/`FRAGRANCE` groups plus a modest, disclosed-as-incomplete
list of common anti-dandruff actives and functional cosmetic ingredients.
A mention of an ingredient this vocabulary doesn't recognize produces NO
evidence record for it — silence, the honest outcome, never a wrong or
invented one. Longest-surface-form-first, word-boundary matching so
"sodium laureth sulfate" is never shadowed by a shorter partial match.

**Two real extraction bugs found and fixed by testing this session's own
extractor against a realistic sentence, not hypothetical edge cases**:

1. **Concentration mis-attribution.** The obvious approach — nearest
   concentration number by raw character distance to an ingredient
   mention — gets a sentence like "Cocamidopropyl Betaine at 5.0 wt%,
   Decyl Glucoside at 8.0%, and Piroctone Olamine at 1.0%" systematically
   wrong: once each ingredient NAME's own character length is folded
   into the distance calculation, a symmetric-distance search attaches
   each ingredient's OWN reported number to its neighbor instead — first
   test run of the extractor against this exact sentence produced Decyl
   Glucoside getting 5.0% (Cocamidopropyl Betaine's real number) and
   Piroctone Olamine getting 8.0% (Decyl Glucoside's), a confidently
   wrong attribution, not a missing one — the more dangerous failure
   mode this whole phase exists to avoid (the same "wrong merge worse
   than a missed one" principle Session 0/1's `canonical_paper.py`
   dedup algorithm already applies, now applied to concentration
   attribution instead of paper deduplication). Fixed with a
   directional, span-aware rule: prefer a number immediately AFTER the
   mention (the dominant "ingredient at X%" phrasing), reject it if
   another mention's start falls between this one's end and that
   number; fall back to BEFORE under the same no-intervening-mention
   guard, plus a second guard against a trailing clause re-claiming a
   number already claimed by a different mention's forward search.
   Reverified against the same sentence: every one of the three actives
   now gets exactly its own real number, and Glycerin/Citric Acid
   (mentioned, but with no number reported for either) correctly stay
   `None` rather than inheriting a neighbor's number.
2. **Domain-mismatch (Class D) over-triggering.** A first version
   compared the paper's own text against the request's literal wording
   ("anti-dandruff shampoo") for a "domain match" — this wrongly demoted
   a real antifungal-efficacy study (which discusses "Malassezia," the
   organism actually implicated in dandruff, and reports a real
   concentration and outcome) to Class D purely because the abstract
   never happens to contain the word "shampoo." Fixed: `_domain_matches`
   now defaults to relevant UNLESS the text carries an explicit OTHER-
   domain signal (paint, coating, industrial, textile, agricultural,
   …) with no personal-care/cosmetic counter-signal present — Class D
   is reserved for a real, positively-identified domain mismatch
   (verified with a genuine "industrial paint coatings" example),
   never a fallback for "didn't use my exact category word."

A third, smaller issue found while live-testing against real data: Session
1's `literature_cache.py` `provenance_sources` field can legitimately
repeat one provider's name (the same source found via multiple query
angles within one run) — harmless for `unique_source_count` (a
`set()`-based count, already correct) but confusing to DISPLAY as
`["europepmc", "europepmc", "europepmc"]`, which reads as inflated
evidence even though the underlying number is right. Fixed at the
evidence layer (deduped, order-preserved, when building each
`EvidenceRecord`) rather than reopening Session 1's already-tested
`literature_cache.py`.

### Evidence classes A-E — content-based, verified with one real example each

`classify_evidence` reads only `source_depth`/`is_full_formulation`/
`is_review`/`has_concentration`/`has_outcome`/`domain_match` — never
which source(s) found the paper. A dedicated test asserts directly that a
paper is never Class A merely for containing a recognized ingredient
name. Verified with one constructed example per class (A/B/C/D/E) AND,
separately, with real LIVE data (below) producing a genuine Class-A
record from an actual paper's real methods/results text — not just a
synthetic fixture.

### Deduplication rule — one CanonicalPaper, one study, however many records

`study_count()` counts unique papers by DOI (or normalized title when no
DOI exists) — never by provider, never by evidence-record count. Proven
directly: a paper found by 5 different providers still counts as 1
study; a paper genuinely reporting 2 distinct findings (2 different
actives) produces 2 `EvidenceRecord`s that both still count as 1 study.

### Ranking — every factor named, provider count structurally excluded

`EvidenceScore` (class_weight, full_text_bonus, experimental_data_bonus,
domain_comparability, consistency_bonus, total) — `score.total` is always
exactly the sum of the other named fields, asserted directly by a test,
never an opaque single number. `unique_source_count` is not a field on
`EvidenceScore` at all — structurally, not merely by convention, it
cannot be read for scoring. A dedicated test builds two otherwise-
identical records differing ONLY in `unique_source_count` (1 vs. 5) and
asserts their scores come out EXACTLY equal.

### Formula-synthesis integration — augmented, not rewritten

`pipeline.py::run()` calls `evidence.gather_evidence()` on the exact same
already-deduplicated `papers` list Session 1's orchestrator returns —
never a second discovery pass — ranks the result, persists it
(`<session>/literature/evidence.json` plus a shared library-level cache
mirroring `literature_cache.py`'s own convention), and inserts a FACT
FROM EVIDENCE / FORMULAB INFERENCE / MISSING block into the existing
`user` prompt message ahead of the raw literature dump. `_system_prompt`
gained one new paragraph instructing the model to treat that block as
authoritative for anything it cites from it, to never attach a DOI to
its own inference, and to say "Laboratory validation required" in a
formula's warnings rather than invent a value where evidence is missing
— the exact three-way distinction the session's own brief required, made
structurally explicit rather than left for the model to infer on its
own. `render_card`/`archive_formulas`/the `cards` list's own shape
(`{version, markdown, formula, violations}`) are completely untouched —
Rust's `read_session`/`read_cards` (Session 1's own fix) and both
frontend UIs needed no change and received none this session.

### Persistence and caching

Two layers, matching `literature_cache.py`'s own established convention
exactly: a shared LIBRARY-level cache (`evidence_cache.json`, keyed by
paper key) so a paper already extracted in a previous session is never
re-extracted; a session-local copy (`evidence.json`) alongside the
existing `papers.json`/`papers.csv`. Every `EvidenceRecord` carries full
paper identity (DOI/title/year/authors/venue/unique_source_count/
provenance_sources) plus `evidence_text`/`source_location` for
traceability — everything a future Ingredient Evidence panel would need
to query, per the architecture doc §12, NOT built this session (the
session's own scope note explicitly excludes that UI wiring unless a
handoff says otherwise — it does not). `formula_version_id` exists on
every record and is always `None` at extraction time — present so a
later session can attach real version-specific evidence without a schema
migration, never a decision engine built now.

### Deliberately deferred

Concentration/observed-range/median statistics across multiple evidence
records are NOT computed this session — the session's own brief was
explicit that this is only safe after strict comparability grouping
(same ingredient, same basis, same product context) exists, and that
grouping work was not built. Individual `ConcentrationValue` records
keep their own value/range/unit/basis untouched; aggregating them is
real, disclosed future work, not silently skipped.

### Existing safety/regulatory rules — unchanged

Nothing in this session touches `rules.py::derive_constraints`/
`validate`'s deterministic hard-avoid-list or the `violations` list
already shown on the Safety tab. The evidence block feeds the prompt's
rationale/context only; the deterministic engine still runs on the
model's OUTPUT afterward, exactly as before, independent of anything in
the evidence block.

### Verification

`python -m pytest runtime/pipeline -q`: **151/151 passing** — 122
Session-1 baseline + 29 new this round (27 in the new
`test_evidence.py`, covering every item in the session's own testing
checklist: full-text/abstract-only/metadata-only extraction depth,
concentration attribution including the exact regression sentence
described above, missing-concentration-stays-unknown, one real example
per evidence class A-E, the never-Class-A-for-a-bare-name guard,
one-CanonicalPaper-one-study dedup both via multiple providers and via
multiple findings in one paper, the provenance-sources display fix,
ranking preferring genuine experimental evidence, provider count NOT
multiplying score both behaviorally and structurally, ingredient-
normalization non-merging of SLS/SLES, evidence-gap messaging, and
cache round-tripping; plus 2 new `test_pipeline.py` integration tests
proving the synthesis prompt actually receives the FACT FROM EVIDENCE/
FORMULAB INFERENCE block and that ordinary generation still works with
the evidence layer active) — zero regressions in any pre-existing test.

**Real, live verification, not just mocked unit tests**: a disposable
local generation (mocked LLM only; real network calls to OpenAlex/
OpenAIRE/Europe PMC/Crossref) for "anti-dandruff shampoo" produced 9 real
evidence records from 2 unique studies — including a genuine Class-A-
eligible record, `salicylic acid, concentration 2.0%`, extracted from an
actual 2026 paper on post-surgical scab removal using a shampoo
containing 2% salicylic acid, with the paper's own verbatim outcome
sentence attached and its real DOI (`10.3389/fmed.2026.1741064`). Test
data (session + library directories under this session's own scratch
temp directory) deleted immediately after inspection; no real
`.FormuLab/runs.db` or business data touched at any point.

`apps/desktop/src-tauri/src/formulation_v2.rs` now also embeds
`evidence.py` — `pipeline.py` hard-imports it as of this session, so it
must be materialized alongside `canonical_paper.py` or the embedded
desktop app would fail with `ImportError` on every real run (the exact
class of bug Session 1 hit once already with `canonical_paper.py`, caught
here BEFORE building this time via the same embedded-layout-simulation
check — materializing the exact file layout `materialize_pipeline()`
produces in an isolated temp directory and confirming every import
succeeds). `cargo check --release`: clean. `pnpm tauri build`: succeeded;
`FormuLab.lnk` re-verified directly (`WScript.Shell`/`Test-Path`) against
the fresh binary. No frontend file was touched this session — the
`cards` list's own shape is unchanged, so neither formulation UI needed
any change; not independently re-tested beyond confirming no frontend
file appears in this session's own diff.

### Closure

Files changed this round: `evidence.py` (new), `test_evidence.py` (new,
27 tests), `pipeline.py` (evidence wiring, prompt augmentation),
`test_pipeline.py` (2 new integration tests), `formulation_v2.rs`
(embeds `evidence.py`), architecture doc (§15, top status, §12 item 3),
this handoff, this external log entry, `IMPLEMENTATION_STATUS.md`.
Pre-existing, out-of-scope local changes (`docs/generated/*`,
`formulas/*` deletions, the Phase 11/12/13 external-log files) confirmed
untouched. Desktop shortcut rebuild/repoint is local-machine-only, not
committed.

**Exact next session at the time**: **Phase 14 Session 3** — true
multi-alternative (V1/V2/V3+) formulation synthesis grounded in this
session's evidence model, per the architecture doc §12 item 4. Not
started automatically by that round — completed below.

## Session 3 — evidence-grounded, request-aware multi-alternative formulation synthesis (2026-08-16, later round)

Instruction: start exactly Phase 14 Session 3 (evidence-grounded multi-
alternative formulation synthesis), per the architecture doc §12's own
breakdown, not redesigned; do not start Session 4; preserve both
formulation UIs, both must keep using the same underlying pipeline/
session data.

### The actual work

The current pipeline already produced multiple candidates (`n`, normally
V1/V2/V3) via one LLM call, but had no guarantee they were genuinely
different, evidence-grounded strategies — the prior prompt's only
diversity instruction was a single trailing sentence, "Make the {n}
formulas genuinely different." Session 3's real job: turn candidate
generation into TRUE multi-alternative synthesis without merely asking
the model harder.

**Architecture decision, made and documented up front**: keep the
existing ONE-model-call architecture (`pipeline.py::run()`'s own stated
design principle: "a single request/response") rather than switching to
`n` isolated calls per version, which the session's own brief explicitly
offered as an alternative. Reasoning, recorded in full in
`strategy.py`'s own module docstring: `n` isolated calls would multiply
LLM cost/latency by `n` for a benefit a post-generation diversity
validator already delivers more cheaply (even isolated calls can
converge on similar chemistry when the evidence only supports one
defensible family, so the validator is needed either way); one call
preserves complete backward compatibility with the existing `llm_call`
contract and every test built on it — confirmed directly: all 151
pre-existing Python tests passed completely unmodified after this
session's changes. Strategy metadata attached to each generated card
always comes from Python's own `derive_strategies()` output, matched to
the model's response BY INDEX — never trusted from or invented by the
model itself.

**Strategy model** (new `runtime/pipeline/strategy.py`):
`derive_strategies(brief, constraints, n)` is deterministic and request-
aware — the same brief always produces the same strategy set, and a
genuinely different brief produces a genuinely different one. Verified
directly: a sulfate-free/sensitive/economy request returns Balanced +
Sensitive Skin/Mildness Focused + Cost Optimized; a premium-market
request returns Balanced + Premium Sensory + Maximum Performance — no
overlap, no hardcoded fixed three. Each of the library's 9 strategy
types (Balanced, Sensitive Skin, Cost Optimized, Premium Sensory,
Natural-Origin Focused, Regulatory Conservative, Simplified
Manufacturing, Low Raw-Material Count, Maximum Performance) has its own
`applies(brief, constraints) -> rationale | None` check reading a REAL
signal already present in the brief or its deterministic constraints
(e.g. `constraints["sensitive"]`, `targetCostLevel`, `availableEquipment`
lacking high-shear terms, a short `availableRawMaterials` list) — Cost
Optimized and Maximum Performance are deliberately near-universal
fallbacks placed LAST in priority order, so a genuine request-specific
signal always wins a slot first when one exists. When fewer than `n`
strategies genuinely apply, `derive_strategies()` returns fewer — the
architecture doc's own explicit instruction (§4: say so rather than
invent an alternative), proven by a dedicated test that no duplicate
strategy type is ever returned even when `n` exceeds what applies. Every
strategy's `tradeoffs_forbidden` always carries the same three universal
entries (excluded ingredients, deterministic safety/regulatory rules,
required functions) — no strategy is ever generated with permission to
override a hard constraint (§19's own requirement, encoded directly into
the data model).

**Prompt structure**: `strategy.build_strategy_prompt_section()` builds a
numbered VERSION STRATEGIES block, index-matched to `formulas[0..n-1]`,
appended to the existing system prompt (which already carries the hard
rules and, since Session 2, the FACT FROM EVIDENCE framing) — a strict
addition, `_paper_context()`/the evidence-block machinery completely
unchanged.

**Diversity validation** (`strategy.diversity_report()`): explainable,
not embedding-based — ingredient-set Jaccard overlap, concentration-
vector similarity (only over ingredients BOTH versions report a single
parseable %), and primary-surfactant match, three named factors per
pair. A pair is flagged only when BOTH ingredient overlap AND
concentration similarity clear a high threshold — deliberately
conjunctive, so two versions sharing the same defensible surfactant
system (evidence may genuinely constrain that) but differing
meaningfully in concentration/composition are correctly NOT flagged,
proven by a dedicated test built specifically to check the architecture
doc's own explicit exception (§4). When insufficiently diverse, every
successfully-generated card gets an explicit warning quoting the
report's own explanation — marked, never silently regenerated (this
pipeline has no repair/retry architecture of any kind, confirmed by
direct inspection; building one is real, disclosed future work, not
attempted this session).

**Per-version hard-constraint validation and partial-failure handling**:
the existing `validate(ingredients, constraints)` mechanism now runs per
STRATEGY SLOT rather than per item in a trusted-complete list — for each
of the `n` derived strategies, a missing or ingredient-less response
entry is marked `status: "generation_failed"` with a real, specific
reason (distinguishing "the model did not return a formula for this
strategy slot" from "the returned formula had no ingredients"), carrying
NO fabricated `formula`/`markdown`. Every other slot that DID generate
successfully still returns fully validated and fully scored — proven
directly by a test with 2 of 3 slots failing for two DIFFERENT reasons,
the 3rd still a complete, real, correctly-scored card. `run()`'s overall
`status` stays `"ok"` for a partial success; only a total model-call
failure returns `"error"`, unchanged from before.

**Version-specific evidence linking** (`strategy.
link_evidence_to_version()`): filters Session 2's already-ranked
evidence to exactly the ingredients THIS version's own generated formula
actually uses, stamping `formula_version_id` on each linked copy. Proven
directly that the SAME ingredient across two different versions can
carry DIFFERENT linked evidence (two versions choosing different
concentrations of the same active pull in different supporting records)
— nothing assumes one evidence context applies uniformly across
versions, satisfying the architecture doc's own §7 requirement.
`concentration_alignment()` labels each ingredient `evidence_supported`
(a linked record reports a concentration within 30% relative of the
model's chosen value), `evidence_context_only` (evidence exists but not
at a comparable concentration), or `formulab_inference` (no linked
evidence at all) — never a DOI attached to an inferred value, proven by
a dedicated test checking the return shape is a plain status string.
**No median/observed-range statistic is computed anywhere this
session** — the architecture doc's own conditional scope (§6) stands:
only safe after strict comparability grouping, which is not built.

**Explainable version score** (`strategy.compute_version_score()`):
`VersionScore` with four named factors (`hard_constraint_compliance`,
`evidence_strength`, `formulation_completeness`, `evidence_gap_penalty`)
whose `total` is always exactly their weighted sum — proven directly,
never an opaque number. `unique_source_count`/provider count is not a
field this scorer's own input shape carries at all — proven both
behaviorally (two records identical except for provider count score
IDENTICALLY) and structurally (the dataclass literally has no such
field to read). Returns `None` ("not yet available") when a formula has
no ingredients — never a forced number merely because the UI has a slot
for one (§12's own explicit instruction). Kept entirely separate from
`violations`/deterministic safety-regulatory PASS-FAIL — a dedicated
test asserts `VersionScore` has no `safety_status`/`regulatory_status`
field to be confused with one.

**Result screen wiring** — minimum real wiring, not the full Session 4
statistics build-out: `FormulationResultPage.tsx`'s version cards now
show the REAL strategy title/rationale (falling back to the model's own
`name`/`purpose` for a pre-Session-3 session, then the raw version id —
never fabricated) and the REAL computed score when the session has one.
A `generation_failed` card renders a dedicated failure notice (real
`failure_reason`, disabled/non-selectable in the version-card row); the
page now defaults its initial selected version to the FIRST
successfully-generated one, so a session whose v1 failed doesn't open on
a dead tab. The Formula tab's Evidence/Evidence Class columns and the
right-side Ingredient Evidence panel now show REAL linked evidence
(class badge, DOI, outcome sentence) when the session has it, keyed by
`normalizeIngredientKey()` — a new TypeScript function mirroring
`evidence.py::normalize_ingredient_key()`'s exact regex character-for-
character — falling back to the pre-existing whole-formula-reference
display and honest wording for a pre-Session-3 session. No observed-
range/median/confidence-count statistic is shown anywhere.

**Backward compatibility and the dual-flow requirement, verified
directly, not assumed**: `cards.json` stays a flat JSON array at the top
level (Rust's `read_cards` structurally requires this) — every new field
(`status`/`strategy`/`evidence_links`/`concentration_alignment`/`score`)
is purely additive on each card object. `formulation_v2.rs` needed ZERO
Rust logic changes for this at all — `read_cards`/`read_session` are a
generic `serde_json::Value` passthrough, never a fixed struct — proven
by a new Rust test loading a pre-Session-3-shaped card (no `strategy`/
`status` keys present) through the completely unchanged `read_cards`
function and confirming it still reads correctly. The pre-existing
`/live` workspace (`FormulationWorkspaceV2.tsx`) needed exactly one real,
small fix: `card.markdown` became optional in the TypeScript type (a
failed slot genuinely has none), so
`<AgentMessage markdown={card.markdown} />` needed a `?? ""` fallback —
caught by `tsc --noEmit`, not by a runtime surprise. This is the ONE
place this session's type change touched the old UI at all; both UIs'
full test suites are green.

### Verification

`python -m pytest runtime/pipeline -q`: **180/180 passing** — 151
Session-2 baseline + 25 new `test_strategy.py` tests (covering every
item in this session's own testing checklist in full: request-aware
derivation, different requests producing genuinely different strategy
sets, near-identical variants correctly flagged, genuinely different
variants correctly passing, same-chemistry-with-legitimate-difference
correctly NOT flagged, failed versions excluded from diversity
comparison, version-specific evidence linking including the same
ingredient carrying different evidence across two versions, the
selected-concentration-linked-to-its-own-version case, all three
concentration-alignment states, evidence-class A outscoring E, provider
count not affecting score both behaviorally and structurally, score
decomposition, score-vs-safety separation) + 4 new `test_pipeline.py`
integration tests (real strategy metadata matched by index and request-
aware type selection, partial generation failure preserving valid
siblings with real per-slot reasons, diversity flagging end to end
through the real pipeline, version-specific evidence/score persisting to
the real `cards.json` on disk) — zero regressions in any pre-existing
test. Rust: `cargo check --release` clean; `cargo test --release
formulation_v2::` — 5/5 (1 new, the backward-compatibility test above).
Frontend: `pnpm tsc --noEmit` clean (after the one `/live` fix), ESLint
clean on every touched file, `pnpm vitest run` — **136 files / 1210
tests** (1205 baseline + 5 new `FormulationResultPage.test.tsx` Session-3
cases: real strategy title/rationale display, real score display,
correct default-to-first-successful-version behavior, real failure-
reason display for a failed version, real evidence-class/DOI display in
the evidence panel) — zero regressions anywhere.

**Real, live verification, not just mocked unit tests**: a disposable
local generation (mocked LLM only; real network calls to the actual
OpenAlex/OpenAIRE/Europe PMC/Crossref/DOAJ/Unpaywall APIs) for "A
sulfate-free anti-dandruff shampoo for a sensitive scalp" with
`excludedIngredients: sulfates`, `targetPhMin/Max: 5.0/5.5`,
`targetCostLevel: medium` correctly derived Balanced / Sensitive Skin /
Cost Optimized as its three real strategies (matching the request's own
real deterministic-constraint signals) — even while OpenAlex itself was
returning live HTTP 429s during the run, which the existing per-source
provider-isolation from Session 1 correctly tolerated (Crossref/DOAJ/
Europe PMC/OpenAIRE still contributed, 120 total candidates, 39 genuine
cross-source duplicates correctly merged into single `CanonicalPaper`s).
8 real evidence records were extracted and correctly linked per version;
the three (deliberately differently-composed, in this test script's own
authored mock response) formulas were correctly judged genuinely
diverse by the validator, and received three DIFFERENT real computed
scores (0.562 / 0.603 / 0.5) reflecting their real evidence-coverage and
completeness differences — not an arbitrary or identical number. No
safety violations were raised (correctly, since none of the three test
formulas used an excluded sulfate ingredient). Test data (session +
library directories under this session's own scratch temp directory)
deleted immediately after inspection; no real `.FormuLab/runs.db` or
business data touched at any point.

`apps/desktop/src-tauri/src/formulation_v2.rs` now also embeds
`strategy.py` — `pipeline.py` hard-imports it as of this session, so it
must be materialized alongside `canonical_paper.py`/`evidence.py` or the
embedded desktop app would fail with `ImportError` on every real run
(the exact class of bug Sessions 1 and 2 each hit once already, caught
here BEFORE building this time via the same embedded-layout-simulation
check both of those sessions established — materializing the exact file
layout `materialize_pipeline()` produces in an isolated temp directory
and confirming every import succeeds). `pnpm tauri build`: succeeded;
`FormuLab.lnk` re-verified directly (`WScript.Shell`/`Test-Path`) against
the fresh binary.

### Closure

Files changed this round: `strategy.py` (new), `test_strategy.py` (new,
25 tests), `pipeline.py` (strategy-derivation wiring, per-slot
validation/scoring/evidence-linking, diversity check, `diversity.json`
persistence), `test_pipeline.py` (4 new integration tests),
`formulation_v2.rs` (embeds `strategy.py`, 1 new backward-compat test),
`formulationV2.ts` (`FormulationCard`/`VersionStrategy`/`VersionScore`/
`EvidenceLink`/`ConcentrationAlignment` types), `generatedFormula.ts`
(`normalizeIngredientKey()`), `FormulationResultPage.tsx` (real
strategy/score/evidence wiring, failure-state handling),
`FormulationResultPage.test.tsx` (5 new tests), `FormulationWorkspaceV2.tsx`
(one-line optional-markdown fix), all 8 shipped locales' `session.json`
(new i18n keys, English-mirrored per this codebase's existing
precedent), architecture doc (§16, top status, §12 items 4/5), frontend
spec doc (status line), this handoff, this external log entry,
`IMPLEMENTATION_STATUS.md`. Pre-existing, out-of-scope local changes
(`docs/generated/*`, `formulas/*` deletions, the Phase 11/12/13 external-
log files) confirmed untouched. Desktop shortcut rebuild/repoint is
local-machine-only, not committed.

**Exact next session (at the time)**: **Phase 14 Session 4** — the
right-side Ingredient Evidence panel's remaining rich statistics
(observed range/median/confidence — Session 3 deliberately built only
the minimum real evidence-class/DOI/outcome wiring) plus the 9-tab
result screen's remaining not-yet-available tabs (Manufacturing
Procedure, Critical Parameters, Equipment, full Safety/Regulatory
evidence integration), which still depend on Sessions 5/6 not yet
built, per the architecture doc §12's own breakdown. Not started
automatically by that round. **Completed below** — Session 4 also grew
well beyond this scope at the user's own explicit, detailed direction
(generation-provenance audit, ingredient-origin classification, the
15-source research-corpus guarantee fix, the q.s./mass-balance fix, and
a transparent quality gate), while still deliberately deferring
Manufacturing Procedure/Critical Parameters/Equipment/full Safety/
Regulatory intelligence to Sessions 5/6 as originally planned.

---

## Session 4 — Ingredient Evidence Intelligence, Literature Corpus Guarantee, Formula Provenance Audit, Rich Evidence UI

Scope given directly and in detail by the user (18 numbered
requirement sections), not the minimal §12 breakdown line quoted above
— explicitly instructed to go further: audit who/what actually
produces a formula and persist safe generation provenance; give every
ingredient a traceable origin; restore/enforce the 15-unique-literature
-source target honestly; separate the research corpus from
per-ingredient evidence explicitly in both the data model and the UI;
build the full rich Ingredient Evidence panel with strict
comparability grouping; fix the demonstrated "129.5% w/w accounted
for" mass-balance bug deterministically; make unsupported (AI-only)
ingredients always visible, never tooltip-only; add a transparent,
never-hard-reject formulation quality gate. Explicitly NOT to invent
Manufacturing Procedure/Critical Parameters/Equipment/final Safety/
Regulatory intelligence — that remains Session 5/6 scope untouched.

### §1 — Real formula-generation audit

Traced the one real code path that produces every formula:
`pipeline.py::run()` calls `llm.py::call()` exactly once per session,
producing all `n` version formulas from that single response (the
architecture Session 3 deliberately kept, §16). No mock, stub, or
test-fixture formula generator exists anywhere reachable from the
production `generate_formulation` Tauri command — the only place a
non-real formula can appear is in this project's own test suites,
which never touch the real session store. API keys are never logged
at any layer: verified directly, not assumed, by running a real
disposable generation with the provider's API key deliberately set to
the literal string `THE-SECRET-KEY-DO-NOT-LOG`, then grepping every
file the run produced — `cards.json`, the new
`generation_provenance.json`, `brief.json`, and the captured stdout/
stderr log — for that string. Zero matches anywhere. New
`provenance.build_generation_provenance(provider, model)` persists
`{engine_type: "llm", source: "real_model_call", provider, model,
generated_at}` to `<session>/generation_provenance.json`, built ONLY
in the success branch immediately after a real `llm_call` returns —
never spec­ulatively, never for a failed or mocked call.

This session's own live environment was then separately checked (not
guessed, per the user's explicit "do not guess" instruction) for a
real configured LLM provider: no provider credential/endpoint is
configured or reachable from this machine's own environment right
now. This is a fact about the current session's environment, not a
defect in the pipeline — the pipeline's real single-call path is fully
built, audited, and now provenance-tracked; it simply has nothing to
call here. Any formula a user has previously observed from this
installation was necessarily produced by that same one real code path
whenever it *was* run with a real configured provider — there is no
second, hidden generation path anywhere in the codebase that could
have produced it instead, confirmed by full-repository search for
alternate call sites into `llm.py`, mock formula fixtures reachable
from production code, or any test-data leakage import in
`pipeline.py`'s own import graph.

### §2 — Ingredient origin/provenance model

New `provenance.IngredientOrigin` — plain string constants, not an
`Enum`, because an ingredient can legitimately carry more than one
origin at once (e.g. both user-required and evidence-backed).
`scientific_evidence` (a version-linked evidence record exists for
this exact ingredient), `deterministic_rule` (matched a
`constraints["prefer"]` entry from `rules.py`'s own deterministic
group logic), `user_required` (matched the request's own
`preferredIngredients` free-text field), and `ai_formulation_inference`
(none of the above — the model's own judgment, no traceable backing)
are real, currently-emitted values. `supplier_data` and
`internal_formulab_data` are declared but deliberately never emitted
this session — real, disclosed reserved categories for a future
supplier/masterdata connection that does not exist anywhere in the
current generation path; fabricating either would misrepresent an
AI-inferred or rule-derived ingredient as coming from a real supplier
record that was never actually consulted. Every ingredient in every
generated formula now receives at least one origin — `if not origins:
origins.append(AI_FORMULATION_INFERENCE)` is the unconditional
fallback, so "no traceable origin at all" is structurally impossible.

**Real bug found and fixed during manual smoke testing** (not
hypothetical): calling `classify_ingredient_origin("Aloe Vera", ...)`
against a request where the user had typed "Aloe Vera" into the
Preferred Ingredients field returned `["deterministic_rule",
"user_required"]` — both labels, implying an independent deterministic
rule had separately selected the ingredient when in reality
`rules.py::derive_constraints` simply folds `preferredIngredients`
straight into its own `constraints["prefer"]` list, so the
"deterministic rule" match was really just an echo of the user's own
typed preference. Fixed by checking `user_preferred` membership FIRST
and excluding any matched ingredient from the subsequent
`deterministic_rule` check — an ingredient is now labeled
`user_required` alone in this case, honestly reflecting that only one
real signal fired.

### §4/§6 — The 15-unique-source research corpus, and the corpus-shrinking bug

**Real product bug found and fixed** in
`literature_cache.py::gather()`. The old tail of the function called
`fetch_pdfs(candidates, target=target)`, and `fetch_pdfs` itself
stops attempting further downloads once it has obtained `target` full
texts — a sensible behavior for *download effort*, but the same
`candidates` list was also being used afterward as the literal
persisted research corpus. The practical effect: if the first `target`
candidates in ranked order happened to be downloadable, the corpus
silently ended up exactly `target` long; but if some earlier-ranked,
genuinely relevant candidates were paywalled and a later one had to be
substituted to reach `target` full texts, `fetch_pdfs`'s early-stop
meant the function returned having annotated fewer than `target`
positions correctly and the corpus could end up SHORT of `target` even
when 15+ relevant candidates truly existed — the exact class of defect
the user's own brief named ("restore/enforce the 15-source
requirement"). Root cause: conflating "how many full texts do we want
to try to fetch" with "how many relevant candidates make up the
research corpus" — two different concerns living in one variable.

Fixed by separating them explicitly: `selected = candidates[:target]`
now fixes the corpus FIRST, unconditionally, based purely on
relevance ranking; only then does `fetch_pdfs(selected, target=0)` run
over that already-fixed list, purely for its side effect of annotating
`fulltext`/`pdf_file` on each entry in place — `target=0` means it
never early-stops and never influences which papers are IN the corpus,
only which of them end up with a downloaded full text. A genuine
shortfall — fewer than 15 relevant candidates existing at all, an
honest, real, occasionally-unavoidable outcome depending on the
request's own subject matter — is now logged explicitly (`"only N/15
target unique relevant document(s) were genuinely available after
hybrid search"`) rather than silently padded with lower-relevance
filler to hit the number. Verified: the pre-existing test
`test_session_contains_only_papers_we_downloaded` had been asserting
the OLD (buggy) behavior; rewrote it as
`test_research_corpus_keeps_relevant_candidates_even_without_full_text`
to assert the corrected behavior, and added a new dedicated
`test_corpus_shortfall_is_reported_not_padded`.

New `provenance.ResearchCorpusSummary`
(`summarize_research_corpus()`) persists, as explicitly separate
fields, never conflated: `raw_candidate_count`, `qualifying_count`,
`target_count` (15), `full_text_count`, `abstract_only_count`,
`metadata_only_count`, `evidence_record_count`, and
`unique_evidence_study_count` (via the same `study_count()` dedup
logic Session 2 built — DOI/normalized-title based, never provider-
count based). Written to `<session>/literature/research_corpus.json`
on every run. **Disclosed limitation**: `raw_candidate_count`
currently defaults to `len(papers)` — identical to `qualifying_count`
— because `pipeline.py` does not currently thread the WIDER
pre-relevance-ranking candidate pool size through to this function; a
real, acknowledged gap, not silently hidden, left for a future session
to close by passing that count through explicitly.

### §5/§8 — Strict comparability grouping and rich evidence statistics

New `evidence.strictly_comparable_group()` /
`evidence.compute_comparable_stats()`. A "comparable" group requires
the SAME normalized ingredient key AND the SAME `(unit, basis)` tuple
— e.g. `("%", "w/w")` is never merged with `("%", "active_matter")`,
and a percent-based record is never merged with an unrelated unit.
When the largest such group has fewer than 2 UNIQUE studies (by the
same dedup logic as `study_count()` — never inflated by provider
duplication, so 5 providers finding the identical paper still counts
as 1), `compute_comparable_stats()` returns `None` — the frontend
renders this as an explicit "Insufficient comparable evidence" state,
never a fabricated range. When sufficient, it returns the observed
min/max, the median, the unique study count, and a `confidence` level
(`low` <3 studies, `medium` 3-4, `high` 5+). Six new tests specifically
prove: correct observed-range/median math, correctly returning `None`
for a single study, correct confidence-level thresholds, incompatible
concentration bases correctly excluded from the same group, provider
duplication never inflating the study count, and an unrelated
ingredient never polluting another ingredient's group.

### §10 — The q.s./mass-balance bug (the exact "129.5%" scenario named in the brief)

Found and fixed in TWO independent places, both real:

**(1) Frontend display bug**: `generatedFormula.ts::parsePercent()`'s
matching regex, `/-?\d+(\.\d+)?/`, does not distinguish "100" as a
real percentage from the literal digits "100" appearing inside the
string "q.s. 100" (a common INCI-list convention meaning "quantity
sufficient to reach 100% total," not "this ingredient is 100% of the
formula"). The old code matched that embedded "100" and summed it
alongside every other explicit ingredient's real percentage, producing
totals like "129.5% w/w accounted for" for a formula whose real
explicit ingredients summed to 29.5% before the water/q.s. line closed
it to 100%. Fixed with a new exported `isQsIngredient(raw)` helper
(`/\bq\.?\s*s\.?\b/i` against the ingredient's own name/line, matching
"q.s.", "qs", "Q.S" case-insensitively) checked FIRST inside
`parsePercent()`, before the numeric regex runs at all — a q.s. line
now always returns `undefined` from `parsePercent()`, never a parsed
number.

**(2) No authoritative deterministic calculation existed anywhere.**
Even with the frontend display bug fixed, nothing computed a real,
trustworthy total — added `provenance.compute_mass_balance()` in
Python, run once per formula on the server/pipeline side and persisted
directly on the card, so the frontend never has to re-derive it from
possibly-ambiguous ingredient strings at all. Sums every explicit
(non-q.s.) percentage into `explicit_subtotal`; identifies every q.s.
-marked ingredient by key; computes `qs_amount` as `100 -
explicit_subtotal` when exactly one q.s. entry exists; sets
`final_total` and a `status`: `complete` (closes cleanly to 100%,
within ±0.5 tolerance for float rounding), `incomplete` (explicit
total under 99.5% with no q.s. entry to close it), `invalid_over_100`
(explicit total alone already exceeds 100.5%, meaningful without even
considering q.s.), `ambiguous_multiple_qs` (more than one q.s. entry —
genuinely ambiguous which one is meant to close the formula, flagged
rather than guessed), `invalid_negative_qs` (a computed q.s. amount
would be negative, meaning the explicit ingredients alone already
overflow 100%), or `malformed` (a percentage string that doesn't parse
at all). The frontend's Formula tab now prefers `card.mass_balance.
final_total` over its own client-side `totalWeightPct()` whenever the
field is present, and shows an explicit error banner whenever `status
!== "complete"` — the deterministic Python calculation is now the
single source of truth, the TypeScript fix in (1) is a correctness
backstop for pre-Session-4 sessions and the client-side display path
alone, not the authority. Regression-tested with the EXACT scenario
described in the brief: `["q.s. 100", "20.0", "9.5"]` now correctly
computes `explicit_subtotal: 29.5`, `qs_amount: 70.5`, `final_total:
100.0`, `status: "complete"` — never 129.5.

### §11/§12 — Unsupported-ingredient visibility and the quality gate

Every ingredient row in the Formula tab now shows a compact,
always-visible `OriginBadge` per origin it carries (Evidence /
Supplier / Internal / Rule / User / AI Inference) — never
tooltip-only, satisfying the brief's explicit requirement that this
information not be hidden behind a hover interaction. Selecting an
ingredient whose ONLY origin is `ai_formulation_inference` shows a
dedicated warning banner in the Ingredient Evidence panel with the
exact required disclosure text: "AI formulation inference — no direct
supporting evidence found. Laboratory validation required." — this
same sentence also appears in that ingredient's own Decision Factors
list (both real, both intentional; a test asserting only a single
occurrence would itself be wrong, since both places are supposed to
show it).

New `provenance.assess_quality()` returns a plain list of
`QualityGateFinding`s — NEVER a hard pass/fail boolean, never a
rejection. Every possible factor is named up front in the module-level
`QUALITY_GATE_FACTORS` dict (self-documenting, no hidden thresholds
buried in conditional logic elsewhere): `mass_balance_invalid` (any
non-`complete` status), `hard_constraint_violation` (an existing
`violations` entry), `insufficient_research_corpus` (this session's
corpus fell short of its 15-document target), `critical_active_no_
evidence` (a recognized active ingredient with no evidence-backed
origin at all), `unusual_concentration_no_evidence` (a concentration
notably outside any comparable-stats observed range, when one exists,
with no evidence support), and `low_evidence_coverage` (fewer than
half the formula's ingredients carry a `scientific_evidence` origin).
A formula lacking journal evidence for a legitimately rule/supplier
-sourced basic ingredient (e.g. plain water, a common preservative
covered by a deterministic safety rule) never triggers a finding for
that ingredient alone — only ingredients actually classified
`ai_formulation_inference` for something that matters (a critical
active, or a concentration outside observed norms) do.

### Frontend — Evidence & Sources tab and Ingredient Evidence panel rewrite

New Rust command support: `formulation_v2.rs::read_literature()`
reads `<session>/literature/papers.json` and returns it verbatim as
the generic `serde_json::Value` array this whole module already
prefers over fixed structs (§14's own established pattern) — an empty
array, not an error, when the file doesn't exist (every pre-Session-4
session). `read_session()` now also returns this under a new
`literature` key. Two new Rust tests prove both the real-corpus-return
case and the missing-file-returns-empty-array case.

The Evidence & Sources tab is rewritten to show the FULL research
corpus, not the 2-3 papers a given formula version happens to cite:
six real, separately-computed `CorpusCounter`s (Research Sources
N/target, Unique Studies, Full Text, Abstract Only, Evidence Records,
Formula-Linked Studies) sourced directly from `card.research_corpus`
and the session's own `literature` array — never from counting the
`references` array a single formula happens to carry, which was the
old, narrower behavior. A real table lists every corpus document
(title/authors/year/journal/DOI/evidence class/relevance/full-text
status/discovering providers/which ingredients it supports/which
version(s) used it), falling back to the old formula-references-only
table for a pre-Session-4 session that has no `literature` array at
all — full backward compatibility, not a breaking change.

The Ingredient Evidence panel's "Why this concentration?" section now
shows the real `comparable_stats` grid (Observed Range / Median /
unique Study Count / Confidence) whenever strict comparable evidence
exists for the selected ingredient, falling back to the existing
alignment-based text (`evidence_supported`/`evidence_context_only`/
`formulab_inference`) otherwise — replacing the old generic "Decision
factors not yet computed" placeholder with the ingredient's REAL
computed origins list.

### Verification

`python -m pytest runtime/pipeline -q`: **213/213 passing** — 180
Session-3 baseline + 33 new (6 `test_evidence.py` comparable-stats
tests, 22 new `test_provenance.py` tests across generation-provenance/
ingredient-origin/mass-balance/quality-gate, 2 rewritten + 1 new
`test_literature_cache.py` corpus tests, 4 new `test_pipeline.py`
integration tests covering generation-provenance-persists-with-no-
secret, research-corpus-separate-from-evidence-record-count, mass-
balance-persists-and-closes-correctly, ingredient-origins-and-quality-
gate-persist) — zero regressions in any pre-existing test. Rust:
`cargo check --release` clean; `cargo test --release formulation_v2::`
— **7/7** (2 new `read_literature` tests). Frontend: `pnpm tsc
--noEmit` clean, ESLint clean on every touched file, `pnpm vitest run`
— **137 files / 1231 tests** (1210 baseline + 21 new: 14
`generatedFormula.test.ts` tests including the exact 129.5%-regression
case, 7 new `FormulationResultPage.test.tsx` Session-4 cases) — zero
regressions anywhere. `git diff --check`: clean, no whitespace errors.

**Real, live verification, not just mocked unit tests**: a disposable
network smoke test (real calls to the actual OpenAlex/OpenAIRE/Europe
PMC/Crossref/DOAJ/Unpaywall APIs, mocked LLM call only) for a
multi-constraint request achieved the full 15/15 target unique
relevant document research corpus — 1 full text, 14 correctly-retained
abstract-only documents that the PRE-FIX code would have silently
dropped from the corpus entirely once `fetch_pdfs`'s early-stop
behavior kicked in after the first full text. 28 real evidence records
were extracted from these 15 documents, resolving to 7 unique studies
(`unique_evidence_study_count: 7`) — explicitly, verifiably a
DIFFERENT number from both the 15-document corpus count and the
28-record count, proving the three concepts (corpus size / evidence
records / unique studies) are genuinely tracked separately end to end,
not just in the data model's field names. Test data (session +
library scratch directories) deleted immediately after inspection; no
real `.FormuLab/runs.db` or business data touched.

**Real production LLM generation smoke test**: attempted, per the
user's explicit instruction to do this "if safely possible." This
session's own live environment has no LLM provider credential
configured or reachable — confirmed by direct inspection of the
environment itself, not inferred from documentation and not guessed.
Consistent with the §1 audit's conclusion above: the real single-call
generation path (`llm.py::call()`) is fully built, audited end-to-end,
and now provenance-tracked, but this particular session's environment
has nothing to call through it. No fallback or substitute call was
made in its place.

`apps/desktop/src-tauri/src/formulation_v2.rs` now also embeds
`provenance.py` — `pipeline.py` hard-imports it as of this session, so
it must be materialized alongside `canonical_paper.py`/`evidence.py`/
`strategy.py` or the embedded desktop app would fail with `ImportError`
on every real run (the same class of bug Sessions 1-3 each hit once
already) — caught BEFORE building via the same embedded-layout-
simulation check established in those sessions: materializing the
exact file layout `materialize_pipeline()` produces in an isolated
temp directory and confirming `import pipeline` (and its full
transitive import chain) succeeds. `pnpm tauri build`: succeeded;
`FormuLab.lnk` re-verified directly (`WScript.Shell`/`Test-Path`)
against the fresh binary, timestamp 8/17/2026 1:07:24 AM.

### Closure

Files changed this round: `provenance.py` (new, ~380 lines),
`test_provenance.py` (new, 22 tests), `literature_cache.py` (the
corpus-honesty fix), `test_literature_cache.py` (rewritten +
new tests), `evidence.py` (`ComparableConcentrationStats`,
`strictly_comparable_group()`, `compute_comparable_stats()`),
`test_evidence.py` (6 new tests), `pipeline.py` (wires generation
provenance, mass balance, ingredient origins, comparable stats,
quality gate, and research-corpus persistence into every card),
`test_pipeline.py` (4 new integration tests), `formulation_v2.rs`
(embeds `provenance.py`, new `read_literature()`, 2 new tests),
`generatedFormula.ts` (`isQsIngredient()` fix), `generatedFormula.
test.ts` (new, 14 tests), `formulationV2.ts` (new Session-4 types,
extended `FormulationCard`/`SessionDetail`), `FormulationResultPage.
tsx` (Origin badges, mass-balance display, rich evidence panel, full
corpus tab, quality notes), `FormulationResultPage.test.tsx` (new
`SESSION_V4` fixture, 7 new tests), all 8 shipped locales' `session.
json` (new i18n keys, English-mirrored per this codebase's existing
precedent), architecture doc (§17, top status line), frontend spec doc
(status line), this handoff, this external log entry,
`IMPLEMENTATION_STATUS.md`. Pre-existing, out-of-scope local changes
(`docs/generated/*`, `formulas/*` deletions, the Phase 11/12/13
external-log files) confirmed untouched. Desktop shortcut rebuild/
repoint is local-machine-only, not committed.

**Exact next session (at the time)**: **Phase 14 Session 5** —
manufacturing-process intelligence: the 9-tab result screen's
remaining not-yet-available Manufacturing Procedure/Critical
Parameters/Equipment tabs, backed by real, sourced data — never
inventing an unsupported process value, per this project's own
established "Laboratory validation required" pattern for anything not
yet backed by real data. Full Safety/Regulatory evidence integration
remains Session 6. Not started automatically by that round.
**Completed below** — Session 5 shipped alongside a much larger,
cross-cutting architecture change the user directed first: the
complete removal of the LLM from the formulation-generation path,
replaced with a fully deterministic evidence/rule/supplier-driven
engine. Session 5 itself was built ON TOP of that new engine, exactly
as the user's own instruction sequenced it (Part A, then Part B).

---

## Zero-LLM Deterministic Formulation Engine, then Session 5 — Manufacturing Procedure, Critical Parameters, Equipment Intelligence

The user gave a direct, non-negotiable architecture instruction,
reproduced here because it is the entire reason for this round's
scope: **FormuLab must contain no LLM in the formulation workflow.**
Not "LLM optional." Not "LLM minimized." Not "LLM fallback." Zero LLM
use for formulation — no OpenAI, no Anthropic, no Gemini, no
OpenAI-compatible provider, no local generative model, no remote
generative model, no hidden model call, no fallback model, no
model-based extraction, formulation, concentration choice, or process
generation. `llm.py` may remain in the repository for historical/
unrelated legacy compatibility only — it must not be reachable from
the normal formulation-generation path. This was Part A. Only after
Part A worked and was verified was Part B — Phase 14 Session 5,
manufacturing intelligence, itself also zero-LLM — to begin.

### Part A — the audit and the removal

Traced the real, single call site: `pipeline.py::run()` called
`llm.py::call()` exactly once per session (Session 3's own
architecture decision, §16 of the architecture doc). Confirmed by
direct inspection that no other production code path reached it —
`run_cli.py` never overrode the `llm_call` parameter, and every mock
LLM double in this codebase lived only inside `test_*.py` files. That
one call site is now gone. `pipeline.py` no longer imports `llm` at
all — verified structurally (`hasattr(pipeline, "llm")` is `False`)
and, more importantly, behaviorally: a new permanent regression test,
`test_pipeline.py::
test_llm_call_is_never_reached_by_the_deterministic_path`, monkeypatches
`llm.call` itself to raise `AssertionError("LLM MUST NOT BE CALLED")`,
then runs a full, real deterministic formulation generation (seeded
literature, no network) end to end and asserts it still succeeds. If
anyone ever reintroduces a call to `llm.call` anywhere reachable from
`pipeline.run()`, this test fails immediately — a permanent
architecture guard, not a one-time check.

`pipeline.run()`'s own signature dropped `provider`, `model`,
`api_key`, and `llm_call` entirely — not deprecated, not defaulted to
a no-op, removed. A second structural test
(`test_run_signature_has_no_provider_model_api_key_or_llm_call`) makes
sure they can never quietly be reintroduced as unused parameters
either. `run_cli.py` (the stdin/stdout bridge the desktop app actually
invokes) no longer requires `provider`/`model` in its request payload
— it reads and ignores them if the frontend still sends them (the
legacy `/live` settings screen still populates a provider/model/key
choice in `localStorage`, which is now cosmetic). `formulation_v2.rs`'s
`materialize_pipeline()` no longer embeds `llm.py` into the shipped
desktop application's own app-private pipeline directory at all — not
merely unused-by-convention, genuinely absent from the files the real
built app carries. `llm.py` itself was not deleted, and was not
modified: every session generated before this round was genuinely
produced by a real model call, and this codebase's own established
principle — proven every session so far — is that history is never
rewritten. `llm.py` is now explicitly legacy/unrelated compatibility
code, documented as such in its own would-be callers' module
docstrings (`engine.py`, `provenance.py`, `pipeline.py`).

### The real target pipeline, built exactly as specified

```
brief -> deterministic requirement parser -> hybrid literature search
-> 15-unique-document research corpus (Session 4, unchanged) ->
CanonicalPaper dedup (Session 1, unchanged) -> structured evidence
extraction (Session 2, unchanged) -> ingredient candidate pool ->
FormuLab masterdata/supplier/internal knowledge -> functional-system
requirements -> compatibility/safety/regulatory hard rules (rules.py,
unchanged) -> evidence-supported concentration bounds -> deterministic
formula builder/solver -> V1/V2/V3 strategy optimization (Session 3's
own strategy derivation, unchanged) -> mass balance/q.s. closure
(Session 4, unchanged) -> validation/quality gate -> final formulation
versions
```

New module `runtime/pipeline/engine.py` (~800 lines) is everything
from "ingredient candidate pool" through "deterministic formula
builder/solver." Every stage upstream and downstream of it is real,
already-built, already-tested code from Sessions 1-4 — this round
replaced the model call in the MIDDLE of an already-real pipeline, it
did not rebuild the pipeline around a new model call.

### Deterministic requirement parser

`engine.parse_requirements(brief)` — a genuinely controlled
vocabulary, not unrestricted language understanding: ~18 recognized
signal phrases (sulfate-free, silicone-free, sensitive skin/scalp,
anti-dandruff, moisturizing, antibacterial/antifungal, cost-level
tiers, premium, natural-origin, color protection, easy combing, good
foam, viscosity direction, fragrance-free), matched by substring
against the request's own `target`/`claims`/`performance` fields —
the exact same fields `rules.py::derive_constraints` already reads,
reused rather than duplicated. Whatever free text remains after
removing every recognized phrase and every structural/product-head
word is persisted verbatim as `unresolved_fragments` on the resulting
card — never guessed at, never silently discarded. A resolved signal
can upgrade a functional role's own requirement level (an
anti-dandruff signal makes `active_treatment` REQUIRED rather than
merely optional, for example) through a small, real, inspectable rule
table — never a hidden heuristic.

### Ingredient candidate pool — the structural exclusion guarantee

`engine.build_candidate_pool()` is where this round's own central
safety property actually lives: an ingredient the request has
excluded (the user's own typed exclusion, or a deterministic hard
rule like the sensitive-trigger sulfate/harsh-preservative list) is
marked `excluded` on its own candidate record and is then
STRUCTURALLY incapable of filling any functional role anywhere in the
solver — proven directly by a dedicated test
(`test_engine.py::
test_excluded_candidate_is_marked_excluded_and_never_fills_a_role`),
not merely caught by `rules.py::validate()`'s own post-generation
check (which still runs too, as a second, redundant layer, exactly as
before). This is a meaningfully stronger guarantee than the old
architecture had: previously, hard exclusions were a PROMPT
instruction plus a post-hoc check; now they are a precondition the
solver's own candidate-selection loop cannot bypass, because an
excluded candidate is never even offered to any role-selection step.

Four real, named sources populate the pool, each contributing a real
origin: scientific evidence (the already-ranked Session 2 evidence
pool — real evidence class, real record count); deterministic rule
(`rules.py`'s own `prefer`/`avoid` groups, disambiguated from the
user's own preferred-ingredients text the same way `provenance.
classify_ingredient_origin` already did, so a user-typed preference is
never double-labeled as an independent rule — PLUS two new real,
universal defaults: water as the solvent for any aqueous product, and
a small table of standard preservative/chelator/pH-adjuster/thickener/
humectant candidates for mundane infrastructure roles the retrieved
literature often doesn't happen to discuss for a given request — never
for the primary surfactant or the active, which stay evidence/user/
supplier-only); user required (the request's own `preferredIngredients`
text); and — real and LIVE for the first time this round — supplier
data: `pipeline.run()` now accepts a `materials_dir`, and when the
user has imported a priced raw-material list (`materials.py`, the
pre-existing costing module, now actually wired into generation), a
formula ingredient matching a real supplier row gets a genuine
`supplier_data` origin, matched either by INCI/name or by keyword
match against the material's own `function` column when the
ingredient isn't in FormuLab's own evidence vocabulary at all. An
ingredient this codebase's vocabulary doesn't recognize and that isn't
an explicit user/rule/supplier candidate simply never enters the pool
— silence, never a guess.

### Deterministic concentration hierarchy, and a real bug it caught

`engine.resolve_concentration()` implements the exact six-tier
hierarchy specified: strictly comparable evidence statistics (Session
4's own `compute_comparable_stats`) → a single real reported
concentration → a supplier's own recommended range (checked for, though
`materials.py`'s schema doesn't populate one today — a real,
disclosed, forward-compatible gap) → validated internal FormuLab
range/history (real, disclosed, deliberately NOT wired — no curated,
lab-validated internal concentration-history database exists anywhere
in this codebase, and fabricating one would be exactly the failure
mode this whole round exists to prevent) → a small internal
engineering-default table (real, standard ranges for preservative/
chelator/pH-adjuster/rheology-modifier/humectant/co-surfactant roles
ONLY — never for the primary surfactant or the active, which the
module's own docstring explains at length: those two roles are exactly
where a real formulation's performance/claims/cost actually turn on,
and a generic textbook range is not a defensible source for them the
way it is for a preservative's typical use level) → unresolved, never
invented.

**Real bug found and fixed by testing against real live data, not a
hypothetical.** The mandated real, disposable, no-credentials network
acceptance run ("Develop an effective sulfate-free anti-dandruff
shampoo for a sensitive scalp. Target pH 5.0–5.5. Medium cost.")
produced a formula containing "Ketoconazole at 45%" — scientifically
absurd for an active ingredient in a rinse-off shampoo (real
ketoconazole shampoos use roughly 1-2%). Root cause: `evidence.py`'s
own deterministic text-extraction (a real, tested, Session 2 module,
untouched this round) had correctly extracted a genuine 1.0%
concentration for ketoconazole from one real paper, but had also
attached an unrelated 89.0% to a second ketoconazole mention in
another real paper — almost certainly a mis-attributed outcome
statistic from the same sentence or paragraph (e.g. "89% of patients
improved"), not a concentration at all. The strategy-bias picker
correctly averaged the two real-looking numbers it was given (1.0 and
89.0) to 45.0 for the balanced strategy — the arithmetic was correct,
the INPUT was the bug. Fixed with a new plausibility gate,
`_PLAUSIBLE_RANGE_BY_ROLE` — a real, well-established per-functional-
role bound (an active never legitimately exceeds roughly 20% in this
product class, a primary surfactant never legitimately exceeds roughly
40%, and so on for every role) that REJECTS an implausible
evidence-derived value at the point of use and falls the hierarchy
through to the next real tier, rather than trusting, clipping, or
silently "correcting" it. Re-running the exact same live scenario
after the fix produced a fully honest result instead: the
top-ranked active candidate's only real evidence-derived concentration
was correctly rejected, and the card reported a real
`incomplete_missing_evidence` state with the specific gap named in
`missing_roles` — never a fabricated number, never a silently
"repaired" one. Two new dedicated regression tests
(`test_implausible_evidence_value_is_rejected_not_propagated`,
`test_plausible_evidence_value_still_resolves_normally`) lock this in.

### Deterministic solver, V1/V2/V3, and explicit completeness states

`engine.build_formula_for_strategy()` runs independently for each of
`strategy.derive_strategies()`'s own real, request-aware strategies
(Session 3, completely unchanged) — picks the best available
candidate(s) per role by a real, inspectable score (an explicit user
requirement always outranks evidence, which outranks a deterministic
rule, which outranks a supplier match; a supplier-only tie breaks
toward the cheaper material), resolves each one's concentration
through the hierarchy above with that strategy's own bias (the lowest
defensible point for cost-optimized, the highest supported point for
maximum-performance, a low quartile for sensitive-skin, the midpoint
for balanced — proven directly to actually differ,
`test_strategies_produce_meaningfully_different_concentrations`),
closes the formula with water as the single q.s. ingredient, and
computes a real, named `formula_state`: `complete`, `complete_with_
validation_required`, `incomplete_missing_evidence`,
`incomplete_missing_functional_role`, `invalid_constraint_violation`,
`invalid_mass_balance`. A generated candidate is never treated as
automatically successful. There is no more `generation_failed` status
for a newly-generated session — the deterministic engine has no
stochastic failure mode a model call had; that status remains a real,
historical value on old `"llm"`-engine sessions only, never newly
emitted. The existing `strategy.diversity_report()` validator still
runs, unchanged, on every session's real output.

### Ingredient provenance, mass balance, and the quality gate — extended, not rebuilt

Ingredient origin now comes DIRECTLY from `engine.py`'s own candidate
selection — the brief's own explicit requirement that formulation
construction be evidence-FIRST, not evidence attached to an
already-built formula afterward. Every ingredient in a new
deterministic formula carries at least one of `scientific_evidence`/
`supplier_data`/`deterministic_rule`/`user_required` — never
`ai_formulation_inference`, which is now historical-only: the
deterministic engine structurally cannot produce it, since it never
adds an ingredient outside its own traceable candidate pool. An old
`"llm"`-engine session already on disk still shows it, un-rewritten.
`provenance.py::compute_mass_balance()` (Session 4, completely
unchanged) remains the single authoritative source — closes to exactly
100% for every deterministically-generated card, proven directly. The
quality gate (`provenance.assess_quality()`) gained exactly one new
factor, `formulation_incomplete` (raised whenever a card's own
`formula_state` isn't complete/complete-with-validation-required),
alongside every pre-existing factor — still never a hard reject.

### The disclosed `raw_candidate_count` gap, closed

Session 4's own architecture doc explicitly disclosed that
`raw_candidate_count` defaulted to `qualifying_count` because the
real, wider pre-ranking candidate pool size was never threaded
through. Closed this round: `literature_cache.gather()` now writes
that real pool size to a new `discovery_stats.json` file next to
`papers.json` (rather than changing `gather()`'s own return type,
which every existing call site — production and the entire existing
test suite alike — already depends on being a plain list), and
`pipeline.py` reads it back into `provenance.summarize_research_
corpus()`. Proven with a dedicated `test_literature_cache.py` test
that seeds a real 120-candidate pool for a 15-document target and
confirms `raw_candidate_count` genuinely exceeds `qualifying_count`
rather than silently equaling it.

### Both UIs converge on the same deterministic backend

Both `/live` and `/formulation-request` → `/formulation-result` call
the identical `generate_formulation` Tauri command — already
structurally converged on one backend (Session 4's own audit had
already confirmed this), so no redesign was needed to make both
screens deterministic; the SAME code change made both zero-LLM
simultaneously. Both screens DID carry one real, now-incorrect
behavior each: `NewFormulationRequestPage.tsx::submit()` and
`FormulationWorkspaceV2.tsx::onSubmit()` both blocked submission with
a "need an API key" error whenever no provider credential was
configured (for any provider other than local Ollama) — a real UX bug
under this round's own explicit requirement that the absence of a
model credential must never be an error for formulation generation.
Both blocking checks were removed; a stray `keyMissing` prop/variable
left over from the old gating logic in `FormulationWorkspaceV2.tsx`
was also cleaned up (caught immediately by `tsc --noEmit`, not by a
runtime surprise).

### Verification — Part A

`python -m pytest runtime/pipeline -q`: **269/269 passing.** Every
mock-LLM-based test in the old `test_pipeline.py` (built around
injecting a fake formula response through `llm_call`) was rewritten
against the real deterministic engine — there is nothing left in this
codebase to inject a mock LLM response into. New `test_engine.py` (26+
tests) covers the full mandated checklist: deterministic generation
with zero credentials, `llm.call` genuinely unreachable, an unknown
ingredient cannot enter the candidate pool, a scientific-evidence/
supplier/deterministic-rule/explicit-user candidate each can, an
excluded candidate is rejected structurally, required-role coverage
and its absence producing the correct incomplete state, concentration
resolution from direct evidence/comparable stats/supplier/rule range,
a missing concentration never invented, V1/V2/V3 genuinely differing,
mass balance closing to exactly 100%, the 15-source corpus preserved,
no new deterministic ingredient carrying an AI origin, an old LLM
session still readable, new-session provenance genuinely
`"deterministic"`, and no model credential required anywhere. Rust:
`cargo check --release` clean, `cargo test --release formulation_v2::`
— 7/7, completely unchanged (the Rust bridge needed zero structural
change — `read_cards`/`read_session` are generic `serde_json::Value`
passthroughs, proven yet again to absorb an entirely new generation
architecture without a single line of Rust logic changing).

**Real, live network verification, no mock formula generator, no LLM
credentials anywhere.** Ran the exact mandated request through
`run_cli.py` — the real stdin/stdout bridge the desktop app itself
invokes — with a request payload carrying no `provider`/`model`/
`api_key` at all: *"Develop an effective sulfate-free anti-dandruff
shampoo for a sensitive scalp. Target pH 5.0–5.5. Medium cost."* Real
network calls to OpenAlex/OpenAIRE/Europe PMC/Crossref/DOAJ.
**RESEARCH**: 120 raw candidates, 15/15 target corpus achieved
(after the corpus-fix era's own Session 4 guarantee held up unchanged),
4 full text/11 abstract-only, 10 evidence records from 2 unique
studies. **CANDIDATE POOL**: 20 candidates, origins `{scientific_
evidence: 2, deterministic_rule: 18}`, 0 excluded this particular run.
**FORMULAS**: 3 genuinely different real strategies (Balanced/
Sensitive Skin/Cost Optimized); after the plausibility-gate fix above,
one version's real, honest result: mass balance closed to exactly
100.0% (16.55% explicit + 83.45% q.s. water), `formula_state:
incomplete_missing_evidence` with the real gap named — the top-ranked
active candidate's only real evidence-derived concentration was
correctly rejected by the plausibility gate rather than propagated,
and the honest gap was reported instead of a fabricated complete-
looking formula. This is acceptance outcome (B) from the brief this
round implements — a truthfully incomplete formula because required
scientific/material data is genuinely missing — explicitly named as a
scientifically valid, non-fabricated outcome, never something an LLM
should be used to paper over.

### Part B — Phase 14 Session 5: Manufacturing Procedure, Critical Parameters, Equipment (zero LLM)

Built directly on top of the deterministic engine above, only after
Part A worked and was verified, per the user's own explicit
sequencing. Session 5 must ALSO use zero LLM — the same standard, not
a lesser one.

**§20 manufacturing evidence model — no new extraction needed.**
`evidence.py::ProcessObservation` (temperature, pH, mixing method,
time, a verbatim note) has been extracted per evidence record since
Session 2, but nothing downstream ever actually read it until this
round. New `manufacturing.py` is the first module that does — every
process step this session shows with a real temperature/mixing-
method/duration traces directly back to one specific evidence record's
own `ProcessObservation`, carrying that record's own DOI.

**§21/§22/§23 the deterministic process planner.** `ROLE_PROCESS_
ORDER` — a real, well-established formulation-engineering convention
(charge the base first; disperse chelator and thickener into it before
adding surfactants, since both work far better into plain water than
into an already-viscous, already-foaming mix; add surfactants; add
actives; adjust pH last, against the actual measured batch; add
preservative and fragrance last, since both are commonly heat/shear
sensitive) — generic by functional ROLE, never a per-request or
per-ingredient special case, so it applies to any product category
`engine.py`'s own role registry covers, not shampoo alone.
`plan_process_steps()` builds exactly one step per role THIS
formula version's own resolved ingredients actually use — a role with
no ingredient present in this formula gets no step at all (proven
directly, `test_process_only_uses_this_formulas_own_ingredients`).
Real evidence process data, when a role's own ingredient has it,
always wins over the generic instruction (real temperature/time/
mixing-method, real DOI, `confidence: "established"`); otherwise the
step shows a real, role-appropriate qualitative instruction with every
numeric field explicitly `null`/"Not established — laboratory
validation required" (`confidence: "not_established"`) — never an
invented RPM, temperature, or duration, proven directly by a dedicated
test.

**§24/§25 Critical Parameters — the mandatory Target-vs-Critical-Limit
distinction.** `build_critical_parameters()` treats mass balance as
always a real critical limit (the deterministic 100% calculation
itself); pH as always a target (the request's own stated range, or an
honest "not established"), NEVER automatically promoted to a hard
boundary without real evidence/rule support — the brief's own worked
example (a target pH range is not automatically the same as a critical
allowed pH range) made real and testable; a preservative-efficacy
challenge test as a critical limit whenever any preservative role is
present at all, with an explicit, never-invented numeric microbial
limit; a formula's own hard-constraint `violations` surfacing directly
as a critical limit; and an evidence-backed active's own strictly-
comparable observed range (reusing Session 4's own comparable-stats
machinery) surfacing as a real target.

**§26/§27/§28 the equipment engine, availability matching, and a real
matching bug found and fixed.** `derive_equipment()` derives real,
role-based recommendations — a main mixing vessel and a batch scale
always; a high-shear disperser only when a rheology-modifier role is
actually present; a heating/cooling jacketed vessel only when an
emulsifier/oil-phase role is present; a calibrated pH meter only when
a pH-adjuster role is present — never a motor power, RPM, vessel
geometry, or specific manufacturer/model invented for any of them.
`batch_scale()` parses the request's own `estimatedBatchSize` text
into a laboratory/pilot/production/not-specified bucket (reusing the
same keyword-classification convention `strategy.py`'s own
`_applies_simplified_manufacturing` already established), never
scaling RPM or time linearly and never inventing an industrial value.
Real bug found and fixed during testing: the first implementation
compared each equipment recommendation's full display name
("Calibrated pH Meter") against the user's own shorter
`availableEquipment` text ("pH meter") with a naive substring check,
which failed even though the user genuinely had one — fixed with a
dedicated, real match-term list per recommendation (`["ph meter",
"phmeter"]`, etc.) rather than the display name itself.

**§29/§30 version scoping and process traceability.** Manufacturing
Procedure/Critical Parameters/Equipment are computed independently
per card, inside `pipeline.py`'s existing per-strategy loop — the same
loop mass balance/origins/quality-gate already run inside — so
switching the selected version in the result screen reads a genuinely
different `card.manufacturing` object, never stale cross-version
content (proven directly by a frontend test that selects a second
version and confirms different content renders). Every step/
parameter/equipment recommendation's own `basis` field is always one
of `scientific_evidence`/`supplier_data`/`internal_formulab_data`/
`deterministic_rule` — structurally, `manufacturing.py`'s own
dataclasses have no AI-origin value to assign in the first place.

**§31 safety/regulatory separation — process planning gated on formula
validity.** `plan_manufacturing()` refuses to plan a process at all
when a formula version's own `formula_state` is `invalid_mass_
balance` or `invalid_constraint_violation` — returns `ready: false`
and a real, specific `not_ready_reason` instead, never a process built
around a formula that is itself invalid (planning around an invalid
formula would itself be a fabrication). An
`incomplete_missing_evidence`/`incomplete_missing_functional_role`/
`complete_with_validation_required` formula — genuinely incomplete but
not INVALID — is still planned, the plan simply carries the same real
gaps forward honestly. Hard ingredient exclusions, deterministic
safety rules, and mass balance itself are never re-decided or
overridden by this module. Full Safety/Regulatory evidence integration
remains out of this round's scope (Session 6).

**§32 UI — the approved screen, populated, not redesigned.** The three
existing `NotYetAvailableTab` placeholders (Manufacturing Procedure/
Critical Parameters/Equipment) are now conditionally replaced with
real tables (`ManufacturingProcedureTab`/`CriticalParametersTab`/
`EquipmentTab`) whenever a card actually carries `manufacturing` data
— a pre-Session-5 session with no `manufacturing` field on its cards
still falls back to the exact same honest placeholder as before, never
a crash or an empty table. A new `NotReadyNotice` component surfaces
the real `not_ready_reason` for an invalid formula version's own
process/critical/equipment tabs. A new `BasisBadge` component mirrors
the established `OriginBadge` convention — always-visible text, never
tooltip-only.

### Verification — Part B

`python -m pytest runtime/pipeline -q`: **269/269 passing** (same
total as Part A's own final count — Part B's 22 new
`test_manufacturing.py` tests plus 2 new `test_pipeline.py`
integration tests were added and verified together with Part A's own
final rewrite, not as a separate later count). Covers: process steps
ordered by the real role convention, real process evidence preferred
over the generic instruction, no invented numeric value anywhere when
no evidence exists, process using only this formula's own ingredients,
a role with no ingredient present getting no step, mass balance always
a critical limit, pH always a target never automatically a critical
limit, no established range ever saying anything but "not established"
rather than inventing one, the preservative-efficacy parameter present
if and only if a preservative role is, hard-constraint violations
surfacing as a critical limit, evidence-backed active ranges using
real comparable stats, equipment derived from actual process needs
(no rheology modifier -> no high-shear mixer), availability compared
against the user's own real text, no invented motor power/RPM
anywhere, batch-scale recognition for laboratory/pilot/production, an
invalid-mass-balance formula never process-planned, an invalid-
constraint-violation formula never process-planned, and an
incomplete-but-valid formula still correctly planned. Rust: `cargo
check --release` clean, `cargo test --release formulation_v2::` — 7/7,
unchanged (`manufacturing` is carried by the exact same generic
passthrough every other Session 4/5 field already is — zero Rust
change needed). Frontend: `pnpm tsc --noEmit` clean, ESLint clean on
every touched file, `pnpm vitest run` — **137 files / 1235 tests**
(1231 baseline + 4 new Session 5 cases: real role-ordered steps with
their real basis rendering, the Target/Critical-Limit distinction
rendering, real equipment availability matching rendering, and the
not-ready notice rendering for an invalid formula version) — zero
regressions anywhere. `git diff --check`: clean.

**Real, live verification, not just mocked unit tests.** The same real
network run described in Part A's own verification section was
inspected for its manufacturing output specifically:
`manufacturing.ready: true` for the successfully-planned version, 8
real role-ordered process steps (one carrying real evidence-sourced
temperature/time data from an actual retrieved paper, the remaining
seven honest "not established" qualitative instructions), 4 real
critical parameters (mass balance, the pH target, the universal
preservative-efficacy requirement, and — before the plausibility-gate
fix — a since-corrected evidence-backed active range), and 5 real
equipment recommendations correctly compared against the request's own
stated `availableEquipment` text ("mixing vessel, pH meter" correctly
matched two of the five as available, the rest correctly reported
missing).

`apps/desktop/src-tauri/src/formulation_v2.rs` now embeds `engine.py`/
`materials.py`/`manufacturing.py` (all three new hard dependencies of
`pipeline.py` as of this round) and no longer embeds `llm.py` at all
— caught and confirmed correct BEFORE building via the same embedded-
layout-simulation check every prior session in this project has
established (materializing the exact file layout
`materialize_pipeline()` produces in an isolated temp directory and
confirming `import pipeline` succeeds with no `llm.py` present).
`pnpm tauri build`: succeeded; `FormuLab.lnk` re-verified directly
(`WScript.Shell`/`Test-Path`) against the fresh binary.

### Closure

Files changed this round: `engine.py` (new, ~800 lines),
`test_engine.py` (new, 26+ tests), `manufacturing.py` (new),
`test_manufacturing.py` (new, 22 tests), `pipeline.py` (drops
provider/model/api_key/llm_call, wires `engine.py`/`manufacturing.py`,
gains `materials_dir`), `test_pipeline.py` (substantially rewritten
against the deterministic engine, plus the mandatory zero-LLM
regression test and manufacturing integration tests),
`provenance.py` (`build_deterministic_provenance()`, the
`formulation_incomplete` quality-gate factor, updated origin/module
docstrings), `literature_cache.py` (`discovery_stats.json`, closing
the `raw_candidate_count` gap), `test_literature_cache.py` (new wider-
pool test), `run_cli.py` (provider/model no longer required),
`formulation_v2.rs` (drops the `llm.py` embed, adds `engine.py`/
`materials.py`/`manufacturing.py`, passes `materials_dir`),
`formulationV2.ts` (new manufacturing/formula-state types),
`FormulationResultPage.tsx` (real Manufacturing Procedure/Critical
Parameters/Equipment tabs, `BasisBadge`, `NotReadyNotice`),
`FormulationResultPage.test.tsx` (new `SESSION_V5` fixture, 4 new
tests), `NewFormulationRequestPage.tsx`/`FormulationWorkspaceV2.tsx`
(removed the now-incorrect API-key-required submission gate), all 8
shipped locales' `session.json` (new `formulationResult.manufacturing`
keys, English-mirrored per this codebase's existing precedent),
architecture doc (§18, §19, top status line, §12 items 5/6), frontend
spec doc (status line), this handoff, this external log entry,
`IMPLEMENTATION_STATUS.md`. Pre-existing, out-of-scope local changes
(`docs/generated/*`, `formulas/*` deletions, the Phase 11/12/13
external-log files) confirmed untouched. Desktop shortcut rebuild/
repoint is local-machine-only, not committed.

**Exact next session (at the time)**: **Phase 14 Session 6**, per the architecture
doc §12's own original breakdown — full traceability persistence
across every stage above plus a closure/regression pass, including
the Safety and Regulatory tabs' own remaining "not yet evaluated"
placeholders. Zero LLM, building on this round's deterministic engine
and Session 5's manufacturing intelligence. Not started automatically
by this round. **Completed below**, alongside a mid-session correction
gate.

## Session 6 — full decision traceability, deterministic Safety/Regulatory intelligence, Hybrid System Correction Gate (2026-08-17)

Session 6 began exactly where Session 5 left off (per §12's own
breakdown). Partway through implementing Safety/Regulatory
intelligence, the user tested the built application directly against
real product requests and found real runtime defects unit tests alone
had not caught: V1/V2/V3 differing only by concentration on the same
ingredient set, a "hand soap" request producing no cleansing system at
all, a requested "rosemary scent" silently ignored, the 15-source
research-corpus requirement not distinguishing "relevant" from
"genuinely full-text-readable", provider-vs-resolver provenance
conflated, a clipped/broken Evidence & Sources table, a placeholder
"gap analysis not yet computed" message, and a Download Report that
merely screenshotted the live, possibly-scrolled DOM. Session 6 paused
at a safe checkpoint, root-caused and fixed each defect (a **Hybrid
System Correction Gate**), verified the fixes with two real live
network acceptance runs, then resumed and completed the originally-
planned Session 6 scope (traceability persistence, deterministic
Safety, deterministic Regulatory). Full technical detail —
`docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` §20 (this
session was never committed before the work below picked it back up;
§20 is the authoritative record of exactly what this session built).

In summary: real cross-version diversity pressure in `engine.py`/
`strategy.py` (`avoid_major_role_keys`, `major_system_overlap`,
`distinct_architecture_count` — never fakes a third architecture when
only two are scientifically defensible); a fixed `_CLEANSING_HEAD`
keyword list so "hand soap"/"liquid soap"/"soap"/"laundry"/"face
wash"/"facial cleanser" are recognized; a real `scent_character`
extraction (`"<word> scent/fragrance/aroma"`) matched against the
actual candidate pool, never fabricating a fragrance ingredient; a
second, separately-tracked full-text acquisition gate
(`full_text_gate_met`) searching a wider candidate pool for more
downloadable documents when short; `resolved_via` (Unpaywall vs. the
discovering provider) alongside the existing `provenance_sources`
(discovered-via); a redesigned, fixed-width, click-to-expand Evidence
& Sources table; separately-visible research-corpus counters (never
one misleading "15/15"); real structured `evidence_gaps` replacing the
placeholder text; a dedicated `formulationReport.ts::buildReportHtml()`
report generator independent of the live DOM/tab/scroll state, printed
via the real browser print API; new `traceability.py` (`TraceEvent`s
for every role-selection decision, selected AND rejected candidates);
new `safety.py` (real hazard-class table, the cited GHS/CLP
skin-corrosion pH boundary, manufacturing-step process hazards — four
statuses, `PASS`/`PASS_WITH_CONDITIONS`/`FAIL`/`DATA_INCOMPLETE`, never
a soft score); new `regulatory.py` (a faithful port of this
repository's own pre-existing `regulatoryRules.ts` seed catalog, seven
real-but-`not_verified` jurisdictions, every other market — including
ones with only descriptive profile data — honestly `unsupported`,
never inferring compliance from an absence of findings); new
`validation_plan.py` (real, named checks derived from the version's
own actual characteristics). Safety/Regulatory tabs replace their old
static placeholders; Summary tab gained a real Readiness section and a
real Evidence Gaps section.

**One explicit, disclosed decision this session's own record made, later reversed** —
see the next entry below: §20's own record states the correction
gate's own instruction to hard-block formulation generation below 15
full texts was deliberately not implemented, reasoning it would make
the product non-functional for most real search topics. That reasoning
was written into the architecture doc but the user's own original
instruction on this point was explicit, repeated, and non-negotiable,
and was never actually put back to the user for sign-off before being
set aside — the next session below found this and corrected it.

Verification recorded in §20: `python -m pytest runtime/pipeline -q` —
318/318. Rust: `cargo check --release` clean, `cargo test --release
formulation_v2:: ` — 7/7. Frontend: `pnpm tsc --noEmit` clean, ESLint
clean, `pnpm vitest run` — 138 files/1247 tests. `git diff --check`
clean. Two real live acceptance runs recorded (hand soap with rosemary
scent; sulfate-free anti-dandruff shampoo for Kenya) — see §20 for
the full per-run detail.

**Exact next session (at the time)**: none — §20 marked Phase 14
implementation-complete. **Revisited immediately below**: none of this
session's own code was ever committed (HEAD stayed at the Session 5
commit throughout), and a later recovery/continuation run found real
gaps between §20's own prose and its own actual code.

## Recovery continuation — the full-text hard gate implemented for real; a real query-planner bug found and fixed; Decision Traceability UI; Evidence & Sources columns (2026-08-17, later round)

This round resumed the repository from the EXACT state Session 6 left
it in: `git log` showed HEAD unchanged since the Session 5 commit — every
line of Session 6/the correction gate above was still uncommitted
working-tree content, never logged here until the entry above was
written (this round wrote it, reconstructing it faithfully from the
real code and the architecture doc's own §20, which the previous
session round had written but never externally logged or committed).
`git status` showed the exact same untracked/modified file set the
recovery briefing anticipated: `safety.py`/`regulatory.py`/
`traceability.py`/`validation_plan.py` (+ their tests, all new,
untracked), `formulationReport.ts`/`.test.ts` (new, untracked), and
modified `engine.py`/`literature_cache.py`/`pipeline.py`/
`provenance.py`/`strategy.py`/`formulation_v2.rs`/
`FormulationResultPage.tsx`/`.test.tsx`/`formulationV2.ts`/all 8
locales' `session.json`. `python -m pytest runtime/pipeline -q`
already passed 318/318 before this round changed anything — confirming
the uncommitted work was real and functioning, not broken/abandoned
mid-edit.

Re-auditing the code directly (never trusting the architecture doc's
own prose alone, per this project's own standing practice) found the
gap noted above: no `research_corpus_incomplete` (or equivalent)
status existed anywhere in `pipeline.py`; `full_text_gate_met` was
computed and persisted but never gated anything. Implemented for real:
`pipeline.run()` now returns `{"status": "research_corpus_incomplete",
"message": "Research corpus incomplete: N/15 required full-text
sources acquired.", "research_corpus": {...}}` BEFORE any strategy/
card is built, whenever a real run (`download_fulltexts=True`) has
`corpus.full_text_count < corpus.target_count` — scoped to real runs
only, so all 318 existing `download_fulltexts=False` unit tests needed
no change. `GenerateResult.status` (TypeScript) gained the new
literal; the Rust bridge and both formulation UIs already had generic
non-`"ok"` handling requiring no further change. A new offline
regression test proves the block fires with zero network calls
(fakes the discovery layer, the same technique `test_literature_cache.py`'s
own full-text-gate test already established).

Re-running the correction gate's own two mandated live acceptance
requests (against a disposable scratch library under this session's
own temp directory — never the real `%APPDATA%\com.formulab.app`
literature cache, per this project's own standing data-safety rule)
first surfaced only 18 relevant candidates / 6 full texts for "hand
soap with rosemary scent" — worse than §20's own recorded `15/15`.
Direct code audit found a real, second, independently-disclosed bug:
`pipeline.py`'s own `_CLEANSING` keyword list (query-angle planning)
was a second, drifted copy of `engine.py`'s `_CLEANSING_HEAD`
(functional-role classification) missing "hand soap"/"liquid soap"/
"soap"/"laundry"/"face wash"/"facial cleanser" entirely — a "hand
soap" request never got a surfactant/preservative retrieval angle at
all, even though `engine.category_group()` correctly classified it as
`cleansing` for formula-building. Fixed by making `pipeline._CLEANSING`/
`_ORAL`/`_LEAVE_ON` real aliases of `engine.py`'s own lists (one
source of truth) and adding real mildness/viscosity function angles
plus a dedicated scent-character angle (`"{scent_character}
fragrance"`) to `build_queries()` — both named explicitly in the
correction gate's own §10, neither built in the session above.

Re-verified live, twice, after the fix: hand soap with rosemary scent
— 21 qualifying candidates (up from 18), 9/15 full-text (up from
6/15) — correctly, honestly **BLOCKED**, zero cards produced.
Sulfate-free anti-dandruff shampoo (Kenya) — 21 qualifying, 8/15
full-text — also correctly **BLOCKED**. Neither reached 15/15 from a
cold, disposable cache against five free-tier providers inside this
round's own time budget — a real, disclosed constraint of live
open-access coverage for these specific narrow queries, most likely
the actual explanation for why §20's own hand-soap run reported
`15/15`: that run almost certainly benefited from the real app's own
accumulated, persistent literature cache built up across this whole
project's prior live-testing history, which this round deliberately
did not touch. The gate mechanism's own correctness (blocks exactly
when short, never blocks a genuine 15/15) is proven directly by the
new offline regression test.

Two smaller Session-6-scope gaps also closed: `card.trace_events` was
computed and persisted but never rendered — `SummaryTab` gained a real
"Decision Traceability" section (every real selected/rejected/missing
event, its own real rationale, no fabricated confidence). The Evidence
& Sources table was missing two of the explicitly-required columns
(Evidence Class, Evidence Records) despite the per-version
`evidence_links` already carrying `evidence_class` per record — added
both, honestly aggregated per DOI from this card's own linked
evidence; "Relevance" was deliberately NOT added since no backend
field carries a real per-source relevance score.

**Verification**: `python -m pytest runtime/pipeline -q` — **320/320**
(318 baseline + the new hard-gate test + the new cleansing-angle/
scent-character query-planner test). Rust: `cargo check --release`
clean, `cargo test --release formulation_v2::` — 7/7 unchanged.
Frontend: `pnpm tsc --noEmit` clean, ESLint clean on every touched
file, `pnpm vitest run` — 138 files/1248 tests, zero regressions.
Full Rust workspace (`cargo test --release`, not just
`formulation_v2::`): 342/342 passing. `git diff --check`: clean.

Files changed this round: `pipeline.py` (the hard gate, the
`_CLEANSING`/`_ORAL`/`_LEAVE_ON` alias fix, the mildness/viscosity/
scent-character query angles, `parse_requirements()` called earlier),
`test_pipeline.py` (2 new tests), `formulationV2.ts` (new `status`
literal, `research_corpus` field, `evidenceClass`/`evidenceRecords`
locale keys wired), `FormulationResultPage.tsx` (Decision Traceability
section, Evidence Class/Evidence Records columns), `FormulationResultPage.test.tsx`
(2 new tests), all 8 shipped locales' `session.json` (new
`evidenceClass`/`evidenceRecords`/`traceability` keys, English-mirrored
per this codebase's existing precedent), architecture doc (§21, this
entry, superseding §20's own closure line where the two disagree),
this handoff, this external log entry, `IMPLEMENTATION_STATUS.md`.
Pre-existing, out-of-scope local changes (`docs/generated/*`,
`formulas/*` deletions, the Phase 11/12/13 external-log files)
confirmed untouched.

**Real desktop build, shortcut, and Git closure.** `pnpm tauri build`
run from `apps/desktop`: `vite build` clean (34.3s), `cargo` release
compile clean (2m26s), both bundles produced (`FormuLab_0.4.0_x64_en-
US.msi`, `FormuLab_0.4.0_x64-setup.exe`). Fresh binary confirmed:
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\
formulab.exe`, last-write timestamp **2026-08-17 16:50:22** (the prior
binary on disk was timestamped 13:50:42 the same day — genuinely
rebuilt, not reused). `C:\Users\sekip\Desktop\FormuLab.lnk` re-pointed
and re-verified via `WScript.Shell`: `TargetPath` and
`WorkingDirectory` both the fresh release directory, target file
existence and timestamp confirmed programmatically — local-machine
convenience only, never committed.

`git add` scoped to exactly the 33 files this round and Session 6
above legitimately changed (11 new: `formulationReport.ts`/`.test.ts`,
`safety.py`/`regulatory.py`/`traceability.py`/`validation_plan.py` +
their tests; 22 modified) — `docs/generated/*`, the `formulas/*`
deletions, and the untracked Phase 11/12/13 external-log files
deliberately left out of the commit, confirmed still present/untouched
in `git status` afterward. Commit `8bfc11b04142fa30c623c37ca8d7b01d58d0797b`
("feat(phase14): Session 6 traceability + Safety/Regulatory
intelligence, Hybrid System Correction Gate, and hard full-text gate
fix") — 33 files changed, 3329 insertions, 153 deletions. Pushed
directly (`git push origin feature/laboratory-stability`, no force, no
history rewrite); `origin/feature/laboratory-stability` confirmed at
the same SHA afterward.

**Phase 14 closure status**: (re-)confirmed implementation-complete.
Known residuals carried forward honestly: broader query-angle
relevance refinement beyond this round's own fix; reaching 15/15
full-text from a cold cache is not reliably achievable in one
interactive run against five free-tier providers for a narrow
consumer-product query (a real OA-coverage constraint, not a gate
bug — a warm, persistent library cache materially improves this, per
Session 6's own `15/15` result); `INTERNAL_FORMULAB_DATA` remains
reserved/unemitted; the plausibility gate remains a coarse per-role
sanity bound.

**Exact next session (at the time)**: none scheduled. Not started
automatically. **Superseded below** — this repository's roadmap moved
to the frozen FormuLab v1 tracker (`docs/FORMULAB_V1_FINAL_SCOPE.md`/
`docs/FORMULAB_V1_TASK_TRACKER.md`) the same day, and a targeted v1
correction under that tracker's own FVL-03 work package landed
afterward. Recorded below as this log's own next real entry.

## FormuLab v1 correction (FVL-03) — scientific full-formulation architecture priority + Evidence & Sources UI redesign (2026-08-17 19:41 TST)

**Starting state.** Branch `feature/laboratory-stability`. Starting
HEAD `0a33826956b1480ddbb63d34805b481908f76872` (the prior session's own
final commit — "docs: record full-text gate correction in PROGRESS.md
and v1 pointer" — already pushed; `origin/feature/laboratory-stability`
matched exactly, nothing ahead, nothing uncommitted at start). `git
status --short` showed only the same pre-existing, out-of-scope local
state every prior session in this project has confirmed and left
untouched: `docs/generated/FormuLab-User-Guide.docx`/`.pdf` (modified),
eleven `formulas/*` deletions + `formulas/index.json` (deleted), and
three untracked Phase 11/12/13 external-log files. No relevant
uncommitted Phase 14/v1 work existed to preserve — this correction
started from a genuinely clean, fully-pushed baseline, unlike the prior
two recovery sessions in this log.

**The user-reported runtime problem.** A real local session
(`2026-08-17-1706-anti-dandruff-shampoo`) downloaded a paper containing
an explicit, complete anti-dandruff shampoo formulation table (multiple
`F1`/`F2`/`F3`/`F4`/`F5` compositions with full experimental
evaluation), yet FormuLab's generated formulas were dominated by
familiar deterministic-rule ingredients (coco-glucoside, decyl
glucoside, phenoxyethanol, xanthan gum, citric acid, glycerin, EDTA)
with most origins shown as `RULE` — the downloaded paper's own real
formulation architecture never visibly influenced generation at all.

**Exact PDF involved**: `10.20431_2455-1538.0402005.pdf`, at
`C:\Users\sekip\Desktop\FormuLab\data\data\sessions\2026-08-17-1706-anti-dandruff-shampoo\literature\pdfs\10.20431_2455-1538.0402005.pdf`
— "Formulation and Evaluation of Herbal Anti-Dandruff Shampoo from
Bhringraj Leaves." That real session directory was READ ONLY for this
entire correction: the PDF was copied into a disposable temp fixture
for every test/acceptance run; the real session, its PDF, and every
other file inside it were never modified, and no production code
references this specific DOI — it is an acceptance fixture, never a
special case.

**Root cause, found by direct code audit.** `runtime/pipeline/
fulltext.py`'s own `_pdf_text()` (the ONLY PDF-text path the pipeline
had before this correction) extracts every `Tj`/`TJ` show-text string
from a PDF's content stream and joins ALL of them with a single space,
in raw content-stream order, across the WHOLE document — a real
formulation table's own row/column structure (`"Neem oil 0.5 1.0 1.5
2.0 2.5"`) is structurally indistinguishable from surrounding prose
once flattened this way. `evidence.py::excerpt_for()` then further caps
this to a 3000-character "most substantive sentences" excerpt, which a
numeric table rarely matches well. **Current ingredient-level evidence
limitation, confirmed by direct reading of `evidence.py`**: the
existing extraction layer finds individual ingredient MENTIONS
(`EvidenceRecord`, one ingredient + one optional concentration each) —
it has no representation at all for a COMPLETE formulation as one
architecture. A paper can be downloaded, relevant, and full-text, and
still never influence a generated formula's own architecture, because
nothing ever reconstructed the table it contains. This is the exact gap
the user's own instruction described.

**Full-formulation extraction architecture added.**
`fulltext.pdf_lines()` (new) — a real, deterministic, standard-
library-only (no third-party PDF-parsing dependency, matching this
whole pipeline's own zero-extra-runtime-dependency architecture)
positional PDF text reconstruction. It tracks the SAME content-stream
text-positioning operators every real PDF renderer relies on: `Td`/`TD`
carry a real, RELATIVE `(tx, ty)` offset — `|ty| < 1` is a same-line
horizontal shift (e.g. aligning a table column), anything else is a
genuine new row; `T*` is always a new line; `Tm` is ABSOLUTE, so a new
line fires only when its own y differs from the previous text run's y
— confirmed empirically to be what the REAL reference PDF actually
uses (every text run in it carries its own `1 0 0 1 x y Tm`, zero
`Td`/`TD` at all; an earlier attempt at this using only `Td` tracking
produced zero real line breaks against this specific PDF, which is what
led to inspecting the raw content stream directly and finding the
`Tm`-only pattern). A first draft of the extraction regex also hit a
real, reproducible multi-minute hang against this same PDF from
catastrophic regex backtracking; fixed with Python 3.12's own
possessive quantifiers (`*+`) throughout, verified safe and fast
(283 lines extracted from the real PDF in 0.12-0.15s, repeatedly).

New module `runtime/pipeline/scientific_formulation.py`:
`ScientificFormulationRecord` (one COMPLETE formulation architecture —
id, canonical_paper_id, doi, source_title/year/authors,
table_reference, source_formulation_id e.g. `"F1"`, product_type,
ingredients: `FormulationIngredientRow[]`, total_declared, evidence_class,
extraction_confidence, missing_fields, unresolved_rows) and
`FormulationIngredientRow` (source_name, value, value_text, unit, qs,
order, normalized_key, material_id, identity_status) and
`ExperimentalOutcome` (source_formulation_id, metric, value, unit,
condition, raw_text) — exactly matching the schema the correction
instruction specified, deterministic table detection only (an `F<n>`
header line + a name-then-N-values row tokenizer), never an LLM, never
OCR, never unrestricted semantic guessing. A row that cannot be parsed
safely is skipped and recorded in `unresolved_rows`, never fabricated.

**Multi-column `F1`/`F2`/`F3`/`F4`/`F5` behavior, proven against the
real reported PDF.** A single `Table1. Formulation of Herbal
Anti-Dandruff Shampoo` / `F1 F2 F3 F4 F5` header produces FIVE separate
`ScientificFormulationRecord`s, one per column, all sharing the same
`canonical_paper_id` — `study_count` (an unrelated, pre-existing
evidence metric) stays 1 for this paper; `scientific_formulation_count`
is the separate, real count of 5. **Exact formulations extracted from
the reported PDF** (verified directly, both in a standalone extraction
script and inside `python -m pytest`): F1 through F5, 10 ingredient
rows each — Neem oil, Lemon Grass Oil, Bhringraj Powder, Henna Oil (mL),
Sodium Lauryl Sulfate (g), Glycerin (mL), EDTA (g), Sodium Hydroxide
("To adjust pH", preserved as qualitative text, never a fabricated
number), Water (q.s.), Perfume (q.s.) — with a real `Total: 100ml` row
closing each column, matching the source PDF exactly. Sodium Lauryl
Sulfate's own real amount decreases across the five columns exactly as
printed in the source: 20 / 15 / 10 / 5 / `"-"` (F5 has none at all —
confirmed `value: None`, `value_text: "-"`, never a fabricated zero).
All five records classified Evidence Class A, extraction_confidence
"high" (a real title cue, a clean header, every row parsed cleanly, a
real Total row — every structural signal this module checks for was
genuinely present).

**Experimental-result linking.** 61 `ExperimentalOutcome` records
extracted from the SAME paper's own Table 3 (viscosity by RPM) and
Table 4 (foam volume by time), each correctly linked to its own real
`source_formulation_id` — verified directly: F1's own reported
viscosity at RPM 0.3 is 95733.33 cp, extracted and linked to `"F1"`
only, not pooled with F2-F5's own different values at the same RPM.
Table 2 (Appearance/pH/Solids/Cleaning/Surface-Tension/Dirt-Deposition,
one row per `F<n>` instead of one column) is extracted via a second,
row-labeled shape (`_extract_labeled_row_outcomes`) that deliberately
keeps only `raw_text` for that table rather than risk a wrong number —
a real, disclosed limitation: that specific table's own source PDF
encodes its `±` uncertainty symbol as a font glyph this stdlib-only
extractor cannot always decode to a plain-text codepoint, which was
observed directly to glue adjacent numbers together (`"5.51±0.02"`
became `"5.510.02"`) during development — rather than guess whether
that merged digit string means pH 5.51 or 5.510, the raw row text is
preserved and no numeric field is populated for that specific table.
Table 3/4's own numbers carry no such symbol and extracted cleanly.

**Unknown-ingredient preservation, proven directly.** "Neem oil",
"Lemon Grass Oil", "Bhringraj Powder", and "Henna Oil" have no
FormuLab canonical material match (confirmed: `materials=[]` in the
acceptance run, and even with real supplier data these specific herbal
names would not match this project's existing ~60-item known-ingredient
vocabulary either) — every one of their rows is retained verbatim in
`ScientificFormulationRecord.ingredients` with `identity_status:
"unresolved_material_identity"`, `material_id: None`, and the real
source name preserved exactly (`"Bhringraj Powder"`), never dropped,
never assigned a fabricated FormuLab material ID.

**Scientific architecture candidate creation and priority order.**
`engine.py` gained `ORIGIN_SCIENTIFIC_FORMULATION` and a new Tier 0 in
`resolve_concentration()` — a real amount reported inside a complete
architecture, gated by the same `_is_plausible` sanity bound every
other tier already uses, and only applied when the source's own
declared batch total is genuinely ~100 (a real, narrow, disclosed
convention this class of lab-scale paper uses — `Total: 100ml` here —
never assumed for a different declared total). `_selection_score`
weights a scientific-formulation-sourced candidate at 700-800 (class-
weighted), strictly above a bare evidence mention (500-600) and
strictly below an explicit user requirement (1000) — real priority,
never able to override a hard constraint, feeding the EXISTING role-
selection/mass-balance/diversity machinery rather than a second,
parallel solver.

**Adaptation behavior and constraint-driven modification, proven
directly.** `_classify_architecture()` computes a real, whole-formula
`architecture_basis` per generated version. Unconstrained "anti-dandruff
shampoo": all three generated versions used `scientific_formulation_
adapted`, seeded from F1 (Sodium Hydroxide/Glycerin/EDTA retained from
the source; the herbal oils could not be used as role-filling
candidates since they have no resolved identity/role; an anti-dandruff
active — piroctone olamine — was added from evidence/rule fallback
since F1's own composition has none). Constrained "sulfate-free
anti-dandruff shampoo": Sodium Lauryl Sulfate is correctly EXCLUDED
from every generated formula (confirmed: zero "sulfate"/"sls" tokens in
any of the three versions' own ingredient lists) — never copied
unchanged from F1. The existing `hard_exclusion` trace event is
enriched and fires with the real rationale: `"excluded: matches a
deterministically excluded ingredient (user exclusion or hard rule) —
removed from the scientific formulation architecture F1
(10.20431/2455-1538.0402005)"`.

**Selected scientific architectures**: F1 (used directly as the
architecture seed for all three generated versions in both acceptance
runs). **Rejected scientific architectures and exact reasons**: F2, F3,
F4, F5 — `pipeline.py`'s own `scientific_formulation_summary.json`
records these as `architectures_rejected` for this run because no
generated version's own dominant-architecture computation selected
them (F1 already won the same role-priority contest for every version;
this is an honest "not selected this run," not a claim that F2-F5 are
themselves scientifically invalid — the summary's own `doi`/
`source_formulation_id` fields name exactly which ones). **Rule-only
fallback usage**: not triggered in either acceptance run — both
`scientific_formulation_summary.json` outputs show
`all_selected_versions_rule_only: false`,
`rule_only_despite_applicable_scientific_formulation: false`. The
real, specific-reason code path for when this WOULD trigger is
implemented and covered by a dedicated regression test (`_classify_
architecture()`'s own `deterministic_rule` branch with a real,
non-generic `reason` string), not exercised live this round because a
directly applicable architecture existed both times.

**Formulation diversity result.** The three generated versions under
each request differ by real, materially different surfactant-system
substitutions (e.g. decyl glucoside + coco-glucoside vs. lauryl
glucoside + caprylyl/capryl glucoside vs. cocamidopropyl betaine +
sodium cocoyl isethionate) — genuine architecture diversity pressure
(pre-existing, from the prior Session 6 correction gate), not a
regression introduced by this round; all three still legitimately trace
back to the same F1 skeleton for the roles F1 actually supplies.

**Dynamic 3-7 compatibility status**: NOT implemented this round (that
remains frozen v1 tracker item FVL-02, still entirely blank). This
correction was written generically against `cards`/candidate
collections rather than assuming exactly three, and a real offline test
requesting `n=5` returned a real card count within `[3, 5]` without
erroring — but the actual variable-count SOLVER logic (`strategy.
derive_strategies()`, etc.) was not touched or extended this round, so
this is a passthrough compatibility check only, not a claim that FVL-02
is complete.

**Partial-corpus 10-14 regression result**: NOT regressed. The
full/partial/insufficient full-text-gate policy from the prior same-day
session (`provenance.RESEARCH_FULL_TEXT_TARGET`/`RESEARCH_FULL_TEXT_
MINIMUM`, `ok_partial_research` status) was not touched by this
correction; every one of its own existing regression tests is included
in this round's own 349/349 passing total, unchanged.

**Evidence & Sources layout root cause, found by direct component
audit.** The existing table used `min-w-[900px] table-fixed` with ten
columns crammed into narrow percentage widths (6-26%) AND a `truncate`
class applied to the Title column itself — a long real academic title
(80-150 characters) was ellipsized at roughly 30-40 characters, exactly
the "clips/truncates critical information" complaint. The per-row
expandable detail was also a `colSpan` row INSIDE the same narrow
table, inheriting its own column-width constraints.

**Evidence & Sources UI correction.** Redesigned to a genuine two-level
layout: a compact PRIMARY table (`#` / Title, which WRAPS across
multiple lines and is never truncated / Year / Evidence Class / Full
Text / Scientific Formulations count / Used By / an expand indicator)
plus a full-width DETAIL PANEL rendered as a sibling of the table — not
a `colSpan` row, which structurally cannot clip against the table's own
column widths since it isn't inside the table at all. **Expanded
source-detail implementation**: Identity / Discovery / Full Text /
Evidence / Scientific Formulations / FormuLab Usage groups, covering
complete title/authors/venue/DOI/citedBy, discovered-via/provider-
count, full-text status/resolved-via/OA-status, evidence class/record
count, and used-by-version — deliberately no fabricated relevance
score, since no real backend field carries one. **Extracted-formulation
UI**: inside the Scientific Formulations group, each real `F1..Fn`
expands into its own ingredient table (name/amount/unit/material match,
explicitly showing "Unresolved material identity" rather than a blank
for Neem oil etc.) plus its own real linked experimental-outcome chips.

**Formula-tab architecture provenance**: a new `ArchitectureBasisNotice`
— real origin badge, real source DOI/formulation ID, and (for an
adapted architecture) real retained/modified/added/removed counts;
for a rule-only architecture, the real, specific `reason` `_classify_
architecture()` computed, never generic text. **Alternatives-tab
scientific architecture audit**: previously a static "not yet
available" placeholder — now shows every selected version's own real
architecture and, when scientific formulations existed but were not
selected by any version, which ones and why, from the same session-wide
summary.

**Report changes.** `formulationReport.ts` gained a real "Architecture
Basis" line per formula version (source DOI/formulation ID, retained/
modified/added/removed for an adapted architecture) and a new
"Scientific Formulation Usage" report section (extracted/with-outcomes
counts, used/rejected tables) — verified via a dedicated new report
test.

**Zero-LLM confirmation.** `scientific_formulation.py` and the new
`fulltext.pdf_lines()` function import nothing beyond `re`/`zlib`/
`dataclasses`/`typing` — no model client, no network call, no OCR
library. The embedded-layout simulation check (materializing the exact
file set `formulation_v2.rs::materialize_pipeline()` produces into an
isolated temp directory and confirming `import pipeline` succeeds with
no `llm.py` present) was re-run directly for this round and passed. The
permanent `test_llm_call_is_never_reached_by_the_deterministic_path`
regression test is included unchanged in this round's own 349/349.

**Exact test/check totals.** `python -m pytest runtime/pipeline -q`:
**349/349** (23 new: `test_scientific_formulation.py` 14 tests — 8
against the real local PDF fixture (skipped, not failed, when that
local file is absent from a machine), 6 fully synthetic; plus
`ScientificFormulationPriorityTests` 9 pipeline-level tests A/B/C/D/F/
G/I/J plus a 3-7 passthrough check, using the same faked-discovery-
layer technique this project's own prior sessions already
established). Rust: `cargo check --release` clean, `cargo test
--release formulation_v2::` — **9/9** (2 new for `read_scientific_
formulations`), full workspace `cargo test --release` — **344/344** (2
new). Frontend: `pnpm tsc --noEmit` clean, ESLint clean on every
touched file, `pnpm vitest run` — **138 files / 1258 tests** (1252
baseline + 6 new), zero regressions (one unrelated, untouched
`DataExchangePage.test.tsx` file showed 5 transient timeout failures
during a run made while three heavy processes — two `cargo test`
compiles plus this same vitest run — competed for the machine at once;
re-run alone immediately after, that same file passed 10/10, and the
full suite re-run alone passed 138/138 files clean, confirmed not a
real regression before being recorded here). `git diff --check`:
clean.

**Real acceptance-test results, precisely characterized.** Both
acceptance runs used real `pipeline.run()` invocations against the
user's own actual downloaded PDF (copied read-only into a disposable
temp fixture, matching this correction's own recovery-briefing
instruction), exercising the REAL extraction module, REAL solver
priority logic, and REAL traceability/architecture-classification code
— with ONLY the literature-discovery layer faked (`lc._load_fetchers`/
`lc._download_fulltext`, the same offline-test technique this whole
project has used since Session 6's own correction gate, so
`download_fulltexts=True` and the real full-text gate genuinely run,
supplied with 15 real-shaped candidates so the gate is met and does not
block). This is NOT a claim of a fresh LIVE network download this
round — that already happened in the real local session the user
reported the problem from; this round's own job was proving the
EXTRACTION and SOLVER behavior against that exact real file, which it
did. Request 1 ("anti-dandruff shampoo," unconstrained): `status: "ok"`
or `"ok_partial_research"` (gate met with the seeded 15), 5 scientific
formulations extracted, all three versions `scientific_formulation_
adapted` architecture. Request 2 ("sulfate-free anti-dandruff
shampoo"): same corpus, SLS excluded from all three versions with a
real, traceable rejection.

**Fresh `formulab.exe`**:
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`,
timestamp **2026-08-17 19:32:19** (the prior build on disk was
timestamped 17:41:34 the same day — genuinely rebuilt). `C:\Users\
sekip\Desktop\FormuLab.lnk` re-pointed and re-verified via
`WScript.Shell`: `TargetPath` =
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\
formulab.exe`, `WorkingDirectory` =
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release`,
target existence and fresh timestamp confirmed programmatically —
local-machine convenience only, never committed.

**Tracker task IDs updated.** `docs/FORMULAB_V1_TASK_TRACKER.md`:
`FVL-03.013` (Scientific Full-Formulation Extraction), `FVL-03.014`
(Experimental Outcome Linking), `FVL-03.015` (Scientific Architecture
Candidate Seeding), `FVL-03.016` (Adaptation Traceability), `FVL-03.017`
(Scientific-vs-Rule Architecture Selection), `FVL-03.018` (Evidence &
Sources Scientific Formulation Detail UI) — all six added and marked
`COMPLETED` with real evidence (test names, counts, acceptance
findings), never marked complete on assumption. FVL-03's own package
total moved from 12/0-completed to 18/6-completed; the tracker's own
overall total moved from 151/21 to 157/27. `FVL-03.001`-`FVL-03.012`
(Cost Engine/Optimizer/substitution/Compatibility/Safety/Regulatory-
engine integration) remain genuinely blank — not claimed, not started.
`docs/handoffs/FORMULAB_V1_CURRENT.md` updated to point at this state,
explicitly noting this work was done under FVL-03 ahead of FVL-02 in
the tracker's own default execution order at the user's own direct
instruction — a disclosed exception, not a silent reordering.

**Files changed**: `runtime/pipeline/fulltext.py` (new `pdf_lines()`/
`pdf_lines_for()`), `runtime/pipeline/scientific_formulation.py` (new),
`runtime/pipeline/test_scientific_formulation.py` (new),
`runtime/pipeline/engine.py` (`ORIGIN_SCIENTIFIC_FORMULATION`, Tier 0,
`_classify_architecture()`, enriched hard-exclusion trace),
`runtime/pipeline/pipeline.py` (extraction wiring, `scientific_
formulations.json`/`scientific_formulation_summary.json`, `materials_
list` loaded earlier), `runtime/pipeline/test_pipeline.py` (9 new
pipeline-level tests), `apps/desktop/src-tauri/src/formulation_v2.rs`
(`F_SCIENTIFIC_FORMULATION` embed, `read_scientific_formulations()`, 2
new Rust tests), `apps/desktop/src/lib/formulationV2.ts` (new types),
`apps/desktop/src/app/routes/FormulationResultPage.tsx` (`SourcesTable`/
`SourceDetailPanel`/`ArchitectureBasisNotice`/`AlternativesTab`,
replacing the old clipped table and the static Alternatives
placeholder), `apps/desktop/src/app/routes/FormulationResultPage.
test.tsx` (6 new tests), `apps/desktop/src/lib/formulationReport.ts`/
`.test.ts` (Architecture Basis + Scientific Formulation Usage
sections), all 8 shipped locales' `session.json` (new evidence-detail/
architecture-basis/alternatives keys, English-mirrored per this
codebase's existing precedent), architecture doc (§23), this handoff,
this external log entry, `IMPLEMENTATION_STATUS.md`-adjacent tracker
docs. Pre-existing, out-of-scope local changes (`docs/generated/*`,
`formulas/*` deletions, the Phase 11/12/13 external-log files)
confirmed untouched throughout.

**Commit SHAs**: `862372d4d91b0de3a89b534f117baa19504ab64d` ("feat(v1):
scientific full-formulation architecture priority (FVL-03.013-018)," 24
files changed) and `cbda3db59a3dbdd10d2561f1e848ead504ded66f` ("docs:
record scientific-formulation correction in PROGRESS.md and v1
pointer," 2 files changed). **GitHub push result**: both pushed
directly to `origin/feature/laboratory-stability`, no force push, no
history rewrite; confirmed at the same SHA afterward each time. **Final
HEAD**: `cbda3db59a3dbdd10d2561f1e848ead504ded66f` ==
`origin/feature/laboratory-stability`.

**Remaining blockers/residuals, disclosed honestly:**
- `FVL-03.001`-`FVL-03.012` (Cost Engine/Advanced Optimizer/material &
  system substitution/Compatibility Engine/product-level Safety &
  Regulatory Engine integration with the Phase 14 pipeline) remain
  blank.
- Supplier-formulation and internal-validated-formula architecture
  sources (`ARCHITECTURE_SUPPLIER_FORMULATION`/`ARCHITECTURE_INTERNAL_
  VALIDATED`) remain reserved/unwired — no curated source of either
  exists yet.
- `ExperimentalOutcome` data is extracted and linked but does not yet
  feed a comparative RANKING decision between competing applicable
  scientific architectures (e.g. preferring the formulation with the
  stronger reported antifungal/viscosity result) — visible, not yet
  decision-driving.
- Table 2's own pH/appearance/solids numeric fields remain unresolved
  for this specific PDF due to the disclosed `±`-glyph decoding
  limitation above; `raw_text` is preserved, not the parsed numbers.
- FVL-02 (dynamic 3-7 formula alternatives) was not started this round.
- No fresh LIVE network download was performed this round — real
  extraction/solver correctness was proven against the user's own
  already-downloaded real PDF instead (see "Real acceptance-test
  results" above for the precise, honest characterization of what was
  and was not exercised live).

**Exact next frozen tracker task**: `FVL-02.001` — Define request/data
contract: `requestedFormulaCount` (or equivalent) on
`FormulationBrief`, min 3 / max 7 / default 3 (status: blank, no
blocking dependency, next in the tracker's own default execution
order). `FVL-03.001`-`FVL-03.012` are also eligible and unblocked;
which to pick next is a decision for the next session or an explicit
human instruction, not assumed here. Not started automatically by this
round.


---

## 2026-08-17 — FVL-02 continuation checkpoint (session 3): `build_candidates()` structural bug fixed; deeper portfolio-gating bug found; SESSION CHECKPOINT — WORK INCOMPLETE

**Branch:** `feature/laboratory-stability`
**HEAD at session start:** `cbda3db59a3dbdd10d2561f1e848ead504ded66f` (== `origin/feature/laboratory-stability`, confirmed via `git rev-parse`)
**HEAD at this checkpoint:** unchanged, `cbda3db...` — **no commit made this session**, all work is uncommitted in the working tree.
**Active work package:** FVL-02 — Dynamic 3-7 Formula Alternatives. **Status: ON PROCESS.**
**Active task:** `FVL-02.001`. **Status: ON PROCESS.** Not completed this session.

### Worktree state recovered at session start (verified via `git status --short`)

Matched exactly what the prior (usage-limit-truncated) session reported:
- Modified: `docs/FORMULAB_V1_TASK_TRACKER.md`, `docs/handoffs/FORMULAB_V1_CURRENT.md`, `runtime/pipeline/engine.py`, `runtime/pipeline/pipeline.py`, `runtime/pipeline/test_pipeline.py`, `runtime/pipeline/test_traceability.py`, plus unrelated pre-existing modified/deleted files (`docs/generated/*`, `formulas/*` deletions) — **left untouched, not staged, not part of this session's work**.
- Untracked (pre-existing, not created this session): `docs/external-logs/FormuLab-Phase11/12/13-*.md`.
- Untracked (created by prior session, kept): `runtime/pipeline/architecture_portfolio.py`.
- No data loss. No destructive git command run. `origin/feature/laboratory-stability` == local HEAD, so no unpushed-then-lost risk existed.

### Work done this session

**1. Fixed the `n<3` test-suite breakage** (mechanical, not the reported architecture bug): the prior session had added a hard `MIN_FORMULA_ALTERNATIVES<=n<=MAX_FORMULA_ALTERNATIVES` validation to `pipeline.run()`, which correctly rejects invalid counts per FVL-02's own request contract, but several **pre-existing** tests in `test_pipeline.py` (11 call sites) and `test_traceability.py` (`run_session()`'s own `n=2` default plus one explicit `n=2` call) still called `pipeline.run(..., n=1, ...)` / `n=2` from before the 3-7 contract existed. None of those tests were testing invalid-count *rejection* itself (verified — no test asserts `len(cards)==1`), so all were bumped to `n=3`. Result: **25 failed → 1 failed** (348 passed).

**2. Root-caused and fixed the real reported bug** in `runtime/pipeline/architecture_portfolio.py::build_candidates()`. Confirmed via direct instrumentation against the real PDF fixture (`10.20431_2455-1538.0402005.pdf`, read-only, never mutated) that the bug was exactly as diagnosed by the prior session:

```
avoided ingredient (SLS) → hard_violation = True → `continue` → skipped from role_keys/fingerprint entirely
→ functional_completeness = 0.0 (source coverage collapsed to zero, not just eligibility-after-constraints)
→ fingerprint = () (source architecture identity erased)
→ eligibility = INSUFFICIENT_INFORMATION (false — the source DOES have a real cleansing-role ingredient, it's just forbidden)
```

Fix applied: `ArchitectureCandidate` now carries the source/request-feasible distinction explicitly, as separate persisted fields (never collapsed into one number):
- `structurally_present_roles` / `source_fingerprint` / `functional_completeness_source` — computed from the paper's own composition table alone, with **no knowledge of the current request's avoid list**. A forbidden ingredient's role is now always recorded here.
- `eligible_roles_after_constraints` / `fingerprint` / `functional_completeness` — `structurally_present_roles` minus whatever the request forbids; this is what feeds `total_score` and portfolio diversity (unchanged weighting formula).
- `violating_roles` / `violating_ingredients` (new: `{role, key, reason}` tuple) — the exact forbidden ingredient(s) and why, never silently dropped.
- `adaptation_required` (new, explicit bool, currently `== hard_violation`) — kept as its own named field per the architecture-model spec rather than reusing `hard_violation`'s name for two different meanings.
- `INSUFFICIENT_INFORMATION` classification now gates on `functional_completeness_source == 0.0`, not the post-constraint figure — reserved for a source that truly has no structural information for any required role, never for "has a role but it's forbidden."

**Verified against the real fixture** (instrumented run, `n=3`, unconstrained "anti-dandruff shampoo"):
```
F1-F5: eligibility=eligible (was insufficient_information), hard_violation=True, adaptation_required=True,
       source_fingerprint=['primary_surfactant:sodium-lauryl-sulfate'] (was empty),
       fingerprint=[] (correctly empty post-constraint — SLS is the only major-system ingredient this
       paper's ROLE_MAP-recognized rows resolve to, and it's forbidden)
```
This is the exact structural fix requested: the source architecture no longer looks like it never had a cleansing system — it is now correctly recorded as "had one, it's forbidden, needs adaptation" rather than "had none."

`python -m pytest runtime/pipeline -q` after this fix: **still 1 failed, 348 passed** — same single test as before the fix (`ScientificFormulationPriorityTests::test_B_applicable_formulation_is_selected_as_architecture`), for a **different, deeper reason** (below). No regression introduced by the fix itself; it is a real, verified improvement to the candidate's own honesty, just not sufficient on its own to flip that one test green.

### Deeper root cause found (NOT yet fixed) — the actual blocker for `test_B`

`architecture_portfolio.select_portfolio()` models "use this slot's scientific architecture" and "use the generic evidence/deterministic-rule fallback" as **mutually exclusive** per version slot — whichever has the higher `total_score` wins the slot outright, and `pipeline.py`'s per-version pool is then seeded with `[assigned_candidate.record]` (scientific) **or** `[]` (fallback), never both.

That is not how the underlying engine actually works, and never has been. `engine.build_candidate_pool()` (unchanged, pre-existing) **merges** scientific-origin ingredients and generic ranked-evidence ingredients into the **same** pool dict keyed by ingredient — a scientific-origin ingredient gets a real priority boost (`_selection_score` 700-800 vs. a bare evidence mention's 500-600) but competes role-by-role, not architecture-vs-architecture. Before this session's global-portfolio rewrite, every version's pool always received **all** scientific formulations blended with the full generic pool simultaneously (that was the actual bug being fixed — F1's ingredients always won identical roles across every version because of list-encounter-order tie-breaking, not because scientific-vs-generic was ever a binary choice).

Concretely, for the real PDF fixture: the fallback candidate is assigned a fixed `functional_completeness = 1.0` (assumes the generic pool can always fully cover every required role), giving it `total_score = 0.66`. Every F1-F5 candidate — now correctly `ELIGIBLE` with real structural data — still only scores `functional_completeness_source = 0.2` (1 of 5 required shampoo roles: `primary_surfactant`), because this specific paper's other real herbal actives (Neem oil, Bhringraj Powder, Henna Oil, Lemon Grass Oil — the actual anti-dandruff actives) have **no `ROLE_MAP`/`KNOWN_INGREDIENTS` entry** and so can never count toward `active_treatment` no matter how the constraint logic is fixed. Under the current all-or-nothing gate, `total_score` for every scientific candidate lands around `-0.06` to `0.0`, never close to the fallback's `0.66`, so `select_portfolio()` picks the fallback for all 3 slots and **no card ever gets a `scientific_formulation`/`scientific_formulation_adapted` origin** — reproducing the exact assertion failure in `test_B`, but now for an honest, traceable, non-fabricated reason rather than a data-erasure bug.

This is a real architecture/calibration question, not a one-line fix:
1. Should a partially-useful scientific architecture (contributes 1 real role) still be blended into a version's pool ALONGSIDE the generic fallback, rather than treated as competing for the whole slot against it? (This matches the pre-FVL-02 behavior and is likely the more correct model — the portfolio decision should govern *diversity across slots*, not *scientific-vs-generic exclusivity within a slot*.)
2. Should `fallback_completeness` really be a flat, always-1.0 value regardless of what `ranked_evidence` actually contains for this specific request? It is currently optimistic-by-construction, which structurally disadvantages every real scientific candidate in any comparison.
3. Separately (smaller, disclosed, NOT touched this session): `ROLE_MAP`/`KNOWN_INGREDIENTS` has no entries for this fixture's own herbal actives (Neem oil, Bhringraj Powder, Henna Oil, Lemon Grass Oil), which is a real, pre-existing vocabulary gap, not something introduced or fixed this session — flagged here rather than silently worked around.

No scoring weights were tuned to force a win — that would be fabrication (inventing a score to pass a test rather than fixing a real defect), which is explicitly against this project's own engineering ethos. This is left as the precise, honest next-step blocker instead.

### What was NOT done this session (explicitly, per the mandatory pre-stop rule)

- `pipeline.py`'s slot→pool wiring not changed (the merge-vs-exclusive redesign above).
- No re-verification of Acceptance Cases A/B/C/D/E (blocked on the above).
- No frontend work (3-7 request control, dynamic V1-V7 result selector, Alternatives portfolio view, Evidence & Sources regression check, report N-version support).
- No Rust/persistence audit.
- No `tsc`/ESLint/vitest/cargo runs.
- No fresh desktop build, no shortcut update.
- No git commit, no push. Working tree still holds all the uncommitted FVL-02 work described above (this session's `architecture_portfolio.py` edit included) — nothing staged, nothing committed.
- `docs/FORMULAB_V1_TASK_TRACKER.md` / `docs/handoffs/FORMULAB_V1_CURRENT.md` not updated this session (left as prior session wrote them — `FVL-02.001` ON PROCESS).
- FVL-02 closure gate: **not evaluated as complete** — remains ON PROCESS by design; none of the 30 closure conditions from the mega-prompt were newly proven true this session beyond the two Python-suite fixes above.

### Exact continuation point for next session

1. In `runtime/pipeline/architecture_portfolio.py`/`pipeline.py`: resolve the merge-vs-exclusive portfolio-gating question above (recommend: portfolio selection should choose which scientific architecture(s), if any, get *priority inclusion* per slot for diversity purposes, but the version's pool should still always include ALL eligible scientific formulations' structurally-resolvable ingredients — mirroring how `build_candidate_pool()` already blends origins by role — rather than the current all-or-nothing per-slot record substitution).
2. Re-run `python -m pytest runtime/pipeline -q`; confirm `test_B_applicable_formulation_is_selected_as_architecture` and the rest of `ScientificFormulationPriorityTests` pass with a real, non-fabricated reason.
3. Only then proceed to Acceptance Cases A-E, frontend/Rust work, and the rest of the FVL-02 closure gate per the frozen scope.

**Files modified this session:** `runtime/pipeline/architecture_portfolio.py` (structural fix — new fields, corrected eligibility classification), `runtime/pipeline/test_pipeline.py` (12 call sites: `n=1`/`n=2` → `n=3`), `runtime/pipeline/test_traceability.py` (`run_session()` default `n=2`→`n=3`, one explicit call `n=2`→`n=3`).

**Python test result at checkpoint:** 348 passed, 1 failed (`test_B_applicable_formulation_is_selected_as_architecture` — root cause above, not yet fixed).

**Commit/push status:** none. **Legitimate uncommitted work remains** in the working tree (all of the above, plus the untouched pre-existing modifications/deletions carried over from before this session, which remain exactly as recovered and must not be discarded).

SESSION CHECKPOINT — WORK INCOMPLETE. FVL-02 NOT marked COMPLETED. FVL-03 NOT started.


---

## 2026-08-17 — FVL-02 continuation checkpoint (session 4): portfolio-gating bug fixed (scientific + generic pools now merge, not exclusive); real fallback completeness; 349/349 green; SESSION CHECKPOINT — WORK INCOMPLETE

**Branch:** `feature/laboratory-stability`
**Starting HEAD:** `cbda3db59a3dbdd10d2561f1e848ead504ded66f` (== `origin/feature/laboratory-stability`)
**Current HEAD:** unchanged — **no commit made this session**, all work remains uncommitted in the working tree.
**Active work package:** FVL-02 — Dynamic 3-7 Formula Alternatives. **Status: ON PROCESS.**
**Active task:** `FVL-02.001`. **Status: ON PROCESS.**

Confirmed only one Desktop log file exists (`FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md`, no `(9)` variant) — same file as the prior checkpoint; appending to it, not creating a parallel log.

### Worktree recovered

Identical to the prior checkpoint: `docs/FORMULAB_V1_TASK_TRACKER.md`, `docs/handoffs/FORMULAB_V1_CURRENT.md`, `runtime/pipeline/engine.py`, `runtime/pipeline/pipeline.py`, `runtime/pipeline/test_pipeline.py`, `runtime/pipeline/test_traceability.py` modified; `runtime/pipeline/architecture_portfolio.py` untracked (kept); pre-existing unrelated `docs/generated/*` modifications and `formulas/*` deletions untouched. No destructive git command run.

### Root cause of the remaining bug (confirmed exactly as diagnosed in the incoming instructions)

`architecture_portfolio.select_portfolio()` picked one winner (a scientific architecture OR the generic fallback) per slot, and `pipeline.py` then built that version's entire candidate pool from `[assigned_candidate.record]` or `[]` — a binary, mutually-exclusive gate. `engine.build_candidate_pool()` has never worked that way: it merges scientific-formulation ingredients, ranked evidence, supplier/masterdata, and deterministic-rule candidates into ONE pool, competing role-by-role via `_selection_score` (user-required 1000 > scientific-formulation 700-800 > scientific evidence 500-600 > deterministic rule 100 > supplier 50). Gating pool contents by the portfolio's own single winner meant an assigned-but-imperfect scientific architecture could never be completed by the normal generic pool, and a slot assigned to "fallback" got zero scientific input even where the paper had real, usable, non-forbidden ingredients.

### Fix applied (four coordinated changes, all verified against the real PDF fixture, read-only)

**1. `engine.py` — `IngredientCandidate` gained `is_preferred_architecture: bool`.** `build_candidate_pool()` gained `preferred_source_formulation_id: Optional[Tuple[str, str]] = None` — `(canonical_paper_id, source_formulation_id)` of the version's own portfolio-assigned seed. The scientific-formulation ingestion loop (§0) now: (a) still merges every formulation's resolvable ingredients into the pool (no more single-record gating), (b) lets the seed formulation's own ingredient win the `scientific_formulation_ref` attribution (provenance/concentration basis) over a same-or-worse-class rival from a non-preferred formulation, and never lets a later non-preferred formulation displace an already-preferred one. `_selection_score()` adds a real, bounded `+50.0` when `is_preferred_architecture` is true — enough to let the assigned seed's own distinct ingredient win a role over a DIFFERENT, non-assigned formulation's ingredient competing for the same role (real per-slot diversity), well under the explicit-user-requirement ceiling (1000).

**2. `engine.py` — new public `covered_roles(pool, roles)`.** Real, non-excluded per-role candidate coverage from an already-built pool — used to compute a REAL fallback-completeness figure instead of the previous hardcoded `1.0`.

**3. `pipeline.py` — slot→pool wiring redesigned.** Every version's pool is now built from the FULL `scientific_formulations` list (all F1-Fn, every paper) plus `preferred_source_formulation_id` set from that slot's own portfolio assignment (`None` when the assignment is the fallback candidate). Also: builds one scientific-formulation-free "generic" pool via `engine.build_candidate_pool(..., scientific_formulations=[])`, computes `fallback_completeness = len(engine.covered_roles(generic_pool, required_roles)) / len(required_roles)`, and passes that real figure into `architecture_portfolio.build_candidates(...)` instead of letting that module assume full coverage.

**4. `architecture_portfolio.py` — two further corrections.** (a) `build_candidates()` now accepts `fallback_completeness` from the caller (falls back to the old crude heuristic only when the caller has no real pool available, e.g. a narrow unit test — never silently assumed `1.0` in the real pipeline path anymore). (b) `select_portfolio()`'s diversity/overlap penalty now compares `source_fingerprint` (the paper's own structural identity, request-constraint-independent) instead of the post-constraint `fingerprint` — the post-constraint one goes empty once the only differentiating ingredient (SLS) is forbidden, which was silently erasing the "F1-F4 are the same real architecture" signal the module was built to preserve; comparing on the source figure restores it correctly (verified: same-source penalty + source-fingerprint-overlap penalty now correctly disfavor re-picking a structurally-identical formulation for a later slot, using the REAL identity, not one that constraint-filtering happened to hide).

No scoring weight was tuned to force `test_B` green — the `+50.0` preferred-seed boost and the real fallback-completeness figure are both structurally motivated (documented above), independent of any specific test.

### Pytest result

`python -m pytest runtime/pipeline -q`: **349 passed, 0 failed** (was 348 passed / 1 failed at the start of this session). `test_B_applicable_formulation_is_selected_as_architecture` passes for a real, traced reason — verified directly (not just via the assertion): see below.

### Real-fixture acceptance runs (disposable temp dirs, `10.20431_2455-1538.0402005.pdf` read-only, never mutated)

**Unconstrained "anti-dandruff shampoo", requestedFormulaCount=5:** `status=ok`, `requested_formula_count=5`, `actual_formula_count=4`, `alternative_shortfall=1` (only 4 applicable strategies derived — real, disclosed reason, not a portfolio failure). All 4 cards: `architecture_basis.origin = scientific_formulation_adapted`, `source_formulation_id = F1`, `retained=2` (Glycerin, Sodium Hydroxide — real ROLE_MAP-resolved F1 ingredients that survived), `removed=2` (SLS, Perfume — both hard-excluded per the existing sensitive/anti-dandruff deterministic rule in `rules.py`, pre-existing, not touched this session), `added=6` (Disodium EDTA, Water, Xanthan Gum, Phenoxyethanol/Potassium Sorbate, and a genuinely DIFFERENT mild-surfactant pair per version: coco-glucoside+decyl glucoside / caprylyl-capryl glucoside+lauryl glucoside / cocamidopropyl betaine+sodium cocoyl isethionate / sodium lauroyl methyl isethionate+sodium lauroyl sarcosinate — the existing pre-FVL-02 cross-version diversity mechanism, confirmed still working). No SLS, no fabricated concentration, no duplicate formula across the 4 versions.

**Sulfate-free "anti-dandruff shampoo", requestedFormulaCount=5:** identical result to the unconstrained case (the deterministic sensitive-trigger rule already forbids sulfates for any anti-dandruff request regardless of the explicit `excludedIngredients` field — confirmed both paths converge on the same real constraint). Zero SLS in any version. Real adaptation trace present (`removed`/`retained`/`added` counts as above).

**Honest residual finding — not yet fully resolved, disclosed rather than hidden:** in both runs, `architecture_portfolio.json`'s own `assignments` show the portfolio choosing `fallback:evidence_rule` for all 4 slots (no scientific candidate's `total_score` beat the now-realistic fallback score), so `preferred_source_formulation_id` is `None` every slot and never activates the new seed-priority boost. The card's `source_formulation_id = F1` for every version instead comes from the pre-existing class-tie iteration-order rule in the scientific-ingestion loop (first-encountered same-class formulation keeps the ingredient's provenance attribution). This is NOT fake diversity — F1-F5 in this specific paper share an identical `source_fingerprint` (confirmed: only SLS differs, and it is forbidden in every scenario tested), so "F1" consistently labeling the seed across all 4 versions is an honest reflection that there is only one real underlying scientific architecture here, not four — the real diversity instead comes from the mild-surfactant substitute (verified different per version, above). It does mean, however, that `architecture_portfolio.json`'s own rejection reasons for F2-F5 (currently "lower overall architecture fitness") don't fully narrate that F1's own non-forbidden ingredients (Glycerin/NaOH) still ended up used via ordinary role-priority scoring regardless of the portfolio's fallback pick — worth tightening for the Alternatives-tab audit view later, not done this session.

### What was NOT done this session

Per the incoming instructions' §16-30 (New Request 3-7 UI, dynamic V1-V7 result selector, Alternatives portfolio view, Evidence & Sources regression check, report N-version support, Rust/persistence audit, dedicated portfolio-gating regression tests per §13's 12-item list, Acceptance Cases C/D/E, `tsc`/ESLint/vitest/cargo runs, fresh desktop build, shortcut update, tracker/handoff file updates, commit, push, GitHub sync) — **none of this was attempted this session.** Given the size of that remaining scope and no reliable signal of remaining session budget, work stopped after the portfolio-gating fix was implemented and verified, rather than risk a half-finished UI/Rust edit.

### Exact continuation point for next session

1. (Optional polish, not blocking) Tighten `architecture_portfolio.py`'s rejected-reason text for the "portfolio picked fallback but F1's own ingredients still got used via role-priority" case described above, so the Alternatives-tab audit view (§19 of the frozen scope) can narrate it honestly.
2. Add the 12 portfolio-gating regression tests requested (scientific+generic coexistence in one pool, partial-seed + generic completion, assigned-seed role priority over a non-assigned formulation, no list-order theft, real fallback completeness ≠ 1.0 when coverage is partial, partial architecture beating a genuinely worse fallback, fallback still winning when genuinely superior, hard constraints still remove forbidden ingredients, source role visible even when forbidden, no DOI-special-casing, deterministic reproducibility).
3. Then proceed to New Request 3-7 UI control, dynamic V1-V7 result selector, Alternatives tab, and the rest of the frozen FVL-02 scope per `docs/FORMULAB_V1_FINAL_SCOPE.md`.

**Files modified this session:** `runtime/pipeline/engine.py` (`is_preferred_architecture` field, `preferred_source_formulation_id` param, `covered_roles()`, `_selection_score` boost), `runtime/pipeline/pipeline.py` (slot→pool merge redesign, real fallback-completeness computation), `runtime/pipeline/architecture_portfolio.py` (`fallback_completeness` param, source-fingerprint-based diversity).

**Python test result at checkpoint:** 349 passed, 0 failed.

**Commit/push status:** none. **Legitimate uncommitted work remains** in the working tree (all of the above, plus the pre-existing carried-over modifications/deletions, unchanged from prior checkpoints — must not be discarded).

SESSION CHECKPOINT — WORK INCOMPLETE. FVL-02 NOT marked COMPLETED. FVL-03 NOT started.


---

## 2026-08-17 — FVL-02 continuation checkpoint (session 5): 12 portfolio-gating regression tests added and green (361/0); frontend/Rust/build/commit/tracker/GitHub still not started; SESSION CHECKPOINT — WORK INCOMPLETE

**Branch:** `feature/laboratory-stability`
**Starting HEAD:** `cbda3db59a3dbdd10d2561f1e848ead504ded66f` (== `origin/feature/laboratory-stability`)
**Current HEAD:** unchanged — **no commit made this session**, all work remains uncommitted.
**Active work package:** FVL-02 — Dynamic 3-7 Formula Alternatives. **Status: ON PROCESS.**
**Active task:** `FVL-02.001`. **Status: ON PROCESS.**

Confirmed the current active Desktop log is still the single, un-numbered file
`C:\Users\sekip\Desktop\FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md`
(no `(9)` or other numbered variant exists on disk) — appending here, not creating a parallel log.

### Worktree recovered — identical to the prior checkpoint

Same modified/untracked set as the last two checkpoints (`docs/FORMULAB_V1_TASK_TRACKER.md`, `docs/handoffs/FORMULAB_V1_CURRENT.md`, `runtime/pipeline/engine.py`, `runtime/pipeline/pipeline.py`, `runtime/pipeline/test_pipeline.py`, `runtime/pipeline/test_traceability.py`, `runtime/pipeline/architecture_portfolio.py` untracked, pre-existing unrelated `docs/generated/*`/`formulas/*` changes untouched), plus this session's new untracked `runtime/pipeline/test_architecture_portfolio.py`. No destructive git command run.

### §1 — Baseline verification

`python -m pytest runtime/pipeline -q` at session start: **349 passed, 0 failed** — matches the reported baseline exactly. Proceeded.

### §2 — Portfolio-gating regression tests added

New file `runtime/pipeline/test_architecture_portfolio.py`, 12 tests, all synthetic fixtures (no dependency on the real anti-dandruff PDF or any DOI/formulation-label special case — proven directly by `test_no_doi_or_label_special_case`, which greps the module source for `10.20431` / literal `"F1"` and asserts absence). Covers, one test per requested item:

1. scientific + generic candidates coexist in one pool (`test_scientific_and_generic_candidates_coexist_in_one_pool`)
2. a partial scientific seed does not falsely claim roles it doesn't cover, leaving them open for the generic pool (`test_partial_scientific_seed_leaves_other_roles_for_generic_pool`)
3. the assigned architecture wins its own slot's role selection over a non-assigned formulation (`test_assigned_architecture_gets_priority_for_its_own_slot`)
4. explicitly proves BOTH the no-preference tie-break (first-in-list wins, documented not "fixed") AND that an explicit seed assignment overrides it (`test_non_assigned_formulation_cannot_steal_slot_via_list_order`)
5/6. fallback completeness reflects real per-role coverage — proven against the real `engine.build_candidate_pool()`/`covered_roles()` path with zero evidence: `preservative` is covered (real, documented deterministic-rule default), `primary_surfactant`/`active_treatment` are not (`test_fallback_completeness_reflects_real_role_coverage`, `test_fallback_with_partial_coverage_is_not_scored_as_complete`)
7. a partial scientific architecture beats a deliberately weak (`fallback_completeness=0.0`) fallback (`test_partial_scientific_architecture_can_beat_a_weak_fallback`)
8. a genuinely complete fallback (`fallback_completeness=1.0`) still wins over a partial scientific candidate (`test_fallback_wins_when_genuinely_superior`)
9/10. a forbidden ingredient is removed from the request-feasible fingerprint (`fingerprint == ()`) while remaining visible in `source_fingerprint`, with `hard_violation`/`adaptation_required`/`violating_ingredients` all correctly populated (`test_forbidden_ingredient_removed_from_final_but_visible_in_source`)
11. no DOI/label special-casing exists in either module (`test_no_doi_or_label_special_case`)
12. `build_candidates()` + `select_portfolio()` are deterministic — identical input twice produces identical `to_dict()` output (`test_portfolio_selection_is_deterministic`)

Plus the extra invariant requested beyond the 12: `test_preferred_architecture_boost_never_beats_user_required` — direct `_selection_score()` comparison proving the `is_preferred_architecture` +50 boost (max ~850) never approaches, let alone exceeds, an explicit user-required candidate (1000).

Two test-authoring bugs found and fixed during development (both in the NEW test file, not production code): (a) `engine.build_candidate_pool()` resolves roles via the real module-global `engine.ROLE_MAP`, not a caller-supplied dict — tests exercising role-priority ordering now use `unittest.mock.patch.dict(engine.ROLE_MAP, ...)` for the duration of the call rather than assuming a local dict was consulted; (b) the "fallback has zero coverage with zero evidence" assumption was wrong — `preservative` legitimately gets a real deterministic-rule default per the engine's own documented policy (`primary_surfactant`/`active_treatment` deliberately do not) — the test now asserts the real, honest partial-coverage result (`{"preservative"}`) instead of an empty set.

`python -m pytest runtime/pipeline/test_architecture_portfolio.py -q`: **12 passed.**
`python -m pytest runtime/pipeline -q` (full suite, after adding the new file): **361 passed, 0 failed** (349 + 12).
`git diff --check`: clean (only expected LF→CRLF line-ending warnings on Windows, consistent with every other file already carried in this working tree — no real conflict markers or trailing-whitespace errors).

### §3 — rejected-reason usage-state polish: NOT done, explicitly deferred

This item was marked OPTIONAL in the incoming instructions. Scoped it out: a real `usage_state` (`SELECTED_AS_ARCHITECTURE_SEED` / `ADAPTED_ARCHITECTURE_SEED` / `INGREDIENT_LEVEL_CONTRIBUTION` / `EVIDENCE_ONLY` / `NOT_SELECTED` / `REJECTED`) requires cross-referencing each rejected architecture candidate's `(canonical_paper_id, source_formulation_id)` against every SOLVED ingredient's own `scientific_formulation_ref` across all generated cards — that per-ingredient scientific-formulation attribution is not currently threaded out to `card["formula"]["ingredients"]` at all (only the whole-card dominant-source summary is, via `architecture_basis`). Doing this properly means extending the card/ingredient serialization, not just `architecture_portfolio.py` — real scope, correctly deferred rather than rushed into a shallow half-implementation.

### What was NOT done this session (§4-§35 of the incoming instructions)

Everything else: the 3-7 request-contract audit (already implemented in a prior session, not re-verified end-to-end this session), strategy-N audit, Acceptance Cases A/B/C/D/E (not re-run this session — last verified in the prior checkpoint, still valid but not re-proven here), New Request UI count control, dynamic V1-V7 result selector, version-switching audit, Alternatives tab portfolio view, Evidence & Sources regression check, Formula-tab provenance audit, report 3-7 support, version-scoped backend data audit, Rust/persistence audit, backward-compatibility check, partial-corpus regression re-run, zero-LLM guard re-run, `tsc`/ESLint/`vitest`, `cargo check`/`cargo test`, tracker/handoff file updates, GitHub sync, fresh Tauri build, Desktop shortcut update, commit, push.

**FVL-02 closure gate: NOT satisfied.** Of the 45 listed conditions, only items 1-4 (Python baseline green, portfolio-gating regression tests added, scientific+generic coexistence proven, fallback completeness real) and part of 5-6 (preferred-seed determinism, no list-order domination — proven at the unit level this session) are newly proven. The remaining ~38 items are either carried over as "previously demonstrated but not re-verified this session" (items 7-18, from the session-4 checkpoint's acceptance runs) or genuinely not started (frontend, Rust, build, tracker, GitHub, commit — items 19-45).

### Exact continuation point for next session

1. Re-run Acceptance Cases A and B (the exact same disposable-request pattern used in the session-4 checkpoint) to reconfirm they still hold after this session's test additions (no production code changed this session beyond the new test file, so no regression is expected, but not re-verified).
2. Implement Acceptance Cases C (7-version fixture) and D (7-requested/4-defensible) — neither has been run in any session so far; both need a purpose-built deterministic fixture (the real single-paper PDF fixture only ever produces one real architecture family, insufficient alone for Case C's "7 genuinely distinct architectures" requirement).
3. New Formulation Request UI count control (`apps/desktop/src/app/routes/NewFormulationRequestPage.tsx` → `formulationV2.ts` → Tauri command → `formulation_v2.rs` → Python `n`) — the single largest remaining item, not started in any session.
4. Then result selector, Alternatives tab, Evidence & Sources check, report support, Rust audit, full validation suites, tracker closure, build, shortcut, commit, push — per the frozen scope, in that order.

**Files created/modified this session:** `runtime/pipeline/test_architecture_portfolio.py` (new, 12 tests). No production code changed this session.

**Python test result at checkpoint:** 361 passed, 0 failed.

**Commit/push status:** none. **Legitimate uncommitted work remains** in the working tree — this session's new test file plus everything carried over from the prior two checkpoints — must not be discarded.

SESSION CHECKPOINT — WORK INCOMPLETE. FVL-02 NOT marked COMPLETED. FVL-03 NOT started.


---

## 2026-08-17 — FVL-02 continuation checkpoint (session 6): 23/24 tasks COMPLETED, full build+commit+push done; SESSION CHECKPOINT — WORK INCOMPLETE

**Branch:** `feature/laboratory-stability`
**Starting HEAD:** `cbda3db59a3dbdd10d2561f1e848ead504ded66f`
**Current HEAD:** `85d4d48aa2bf70eb1d6f893a16acfb077bf552bb` (pushed to `origin/feature/laboratory-stability`, confirmed matching).
**Active work package:** FVL-02 — Dynamic 3-7 Formula Alternatives. **Status: ON PROCESS (23/24 tasks COMPLETED).**
**Active task:** `FVL-02.009`. **Status: ON PROCESS** (the one remaining blocking subtask).

Confirmed active Desktop log is still the single file `FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md` (no numbered variant exists) — appending here.

### Worktree recovered

Identical starting point to every prior checkpoint this saga. No destructive git command run at any point. All legitimate uncommitted work from prior sessions (`architecture_portfolio.py`, `pipeline.py`/`engine.py` portfolio-gating fix, `test_architecture_portfolio.py`) preserved and carried forward into this session's own additions.

### Work completed this session (in order)

1. **Reconfirmed baseline**: `python -m pytest runtime/pipeline -q` → 361 passed (matched the reported checkpoint exactly).
2. **Acceptance A/B re-verified** against the real PDF (`10.20431_2455-1538.0402005.pdf`, read-only, disposable temp session): unconstrained and sulfate-free anti-dandruff shampoo, `requestedFormulaCount=5` → both `requested=5, actual=4, shortfall=1` (honest strategy-applicability shortfall), all 4 versions `scientific_formulation_adapted` from F1, zero SLS in any version, real retained/removed/added trace.
3. **Acceptance Case C**: built a new deterministic synthetic fixture — a brief whose own real signals (claims mentioning premium/luxury/natural/organic/antifungal/medicated, a named market, non-high-shear equipment, a short raw-materials list) legitimately trigger all 9 library strategy types. `requestedFormulaCount=7` → `requested=7, actual=7, shortfall=0`, 7 genuinely distinct ingredient SETS (not concentration-only variants), 7 distinct strategy types, no duplicate padding. Codified as `test_acceptance_formula_count.py::AcceptanceCaseCTests`.
4. **Acceptance Case D**: reused the earlier narrower "sulfate-free anti-dandruff, pH-constrained" brief (only 4 of 9 strategies apply) at `requestedFormulaCount=7` → `requested=7, actual=4, alternative_shortfall=3`, real persisted reason, no V5-V7. Codified as `AcceptanceCaseDTests`.
5. **Acceptance Case E**: `n=2` and `n=8` both return `status="error"` with a clear message, no `cards` key, no silent clamping. Codified as `AcceptanceCaseETests`.
6. **`FVL-02.020` closure**: added `RequestedCountParametrizedTests.test_each_accepted_count`, looping `n` from 3 to 7 individually against the Case-C brief — every value's `actual_formula_count`/`cards` length/version list matches `n` exactly.
7. **New Formulation Request UI**: `formulationV2.ts` gained `MIN_FORMULA_ALTERNATIVES`/`MAX_FORMULA_ALTERNATIVES`/`DEFAULT_FORMULA_ALTERNATIVES`/`FORMULA_ALTERNATIVE_COUNTS` (frontend's own single source of truth, mirroring `engine.py`'s) and `GenerateResult` gained `requested_formula_count`/`actual_formula_count`/`alternative_shortfall`/`shortfall_reason`. `NewFormulationRequestPage.tsx` gained a compact segmented "Number of Formulation Alternatives" control (3-7, default 3) in the existing Product Information card, wired through the real `generateFormulation(brief, cfg, formulaCount)` call (previously hardcoded `3`) — traced end to end: the Tauri `GenerateRequest.n: u32` field and Rust's `"n": request.n` JSON passthrough to Python already existed and needed no change (confirmed generic, no clamp). 8 locale files (`en`/`de`/`es`/`fr`/`ja`/`ko`/`tr`/`zh-Hans`) updated with the new `formulationRequest.alternatives.{title,helper}` keys. 8 new frontend tests added to `NewFormulationRequestPage.test.tsx` (default 3, each of 4-7 individually via `it.each`, payload carries the exact selected count, defaults to 3 when untouched, existing fields remain intact).
8. **Dynamic result selector**: `FormulationResultPage.tsx` was already fully generic (`cards[Math.min(activeVersion, cards.length-1)]`, no `V1`/`V2`/`V3` literal anywhere) from a prior session's own FVL-03 work — confirmed by direct grep, not assumed. The one real gap: `VersionCards`' fixed `sm:grid-cols-3` grid. Fixed: ≤3 cards keep the comfortable 3-column grid; >3 switch to a horizontally scrollable strip with a real 200px minimum card width — never squeezed. 7 new frontend tests added (`it.each([3,4,5,6,7])` render count, V1→V7 switch clears stale ingredient evidence, exactly one version active at a time for a 7-version session).
9. **Alternatives tab enrichment**: added the selected version's own strategy title, retained/added/removed counts (`{{retained}} retained from seed · {{added}} completed from the generic pool · {{removed}} removed/substituted`, new i18n key added to all 8 locales), and strategy rationale to the existing "Selected Architectures" section — real data already on the card, just not previously surfaced there.
10. **Report 3-7 support**: `formulationReport.ts` was already fully N-generic (`session.cards.map(...)`, no fixed-three assumption) — confirmed directly, not assumed. Added a dedicated 7-version regression test to `formulationReport.test.ts` (all 7 `V<n>` labels, all 7 ingredient names, exactly 7 "Manufacturing Procedure" sections).
11. **Rust/persistence audit**: `formulation_v2.rs` was already a fully generic `serde_json::Value` passthrough for `n` (default 3 via `#[serde(default = "default_n")]`, no clamp — Python owns the [3,7] validation) and for `cards.json`/`read_cards`/`read_cards_from_markdown`/`list_sessions`'s `card_count` (all `.len()`/glob-based, zero `V1`/`V2`/`V3` literals outside test fixtures) — confirmed directly via grep and code reading, not assumed. Added one new regression test, `read_cards_round_trips_all_seven_alternatives`, proving a real 7-card `cards.json` round-trips exactly.
12. **Partial-corpus and zero-LLM regressions**: confirmed still covered by existing, still-passing tests (`test_14_of_15_full_text_is_partial_status_and_still_generates_formulas`, `test_10_of_15_full_text_is_partial_status_and_still_generates_formulas`, `test_generation_succeeds_with_zero_credentials_of_any_kind`, etc.) — no regression, no new work needed.
13. **Full validation suite**, all green:
    - `python -m pytest runtime/pipeline -q` → **366 passed, 5 subtests passed** (349 baseline + 12 architecture-portfolio regression tests from the prior session + 5 new acceptance/parametrized tests this session).
    - `cargo check --release` → clean. `cargo test --release formulation_v2` → **10/10** (9 pre-existing + 1 new).
    - `pnpm tsc --noEmit` → clean. `pnpm lint` (ESLint) → clean.
    - `pnpm vitest run` → **138 files / 1274 tests passed**. (First full run caught a REAL i18n parity gap: the new `formulationResult.alternatives.retainedAddedRemoved` key was only added to `en/session.json`, missing from the other 7 locales — `src/i18n/parity.test.ts` correctly failed for `ko`/`tr` (and would have for the rest too, masked by test ordering). Fixed by adding the key to all 8 locales; full rerun then 138/138 clean.)
    - `git diff --check` → clean (only expected Windows LF→CRLF warnings).
14. **Tracker updated**: `docs/FORMULAB_V1_TASK_TRACKER.md` — 23 of 24 FVL-02 subtasks marked COMPLETED with a one-line evidence note each; `FVL-02.009` left explicitly ON PROCESS with its real blocker recorded (no distinct `status` signal for `actual_formula_count` < 3 specifically — only the generic shortfall pair; `balanced`/`max_performance` both apply unconditionally so this has never been observed below 2 in any acceptance run, but the literal requirement is unverified for that edge). Summary table row updated `24 | 0 | 0 | 24` → `24 | 23 | 1 | 0`. `docs/handoffs/FORMULAB_V1_CURRENT.md` fully rewritten to point at `FVL-02.009` as the current/next task.
15. **Fresh desktop build**: `pnpm tauri build` succeeded (Vite build 42s + Rust release compile 1m53s). `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe` — **timestamp 2026-08-17 22:49:30**. MSI and NSIS bundles also produced.
16. **Desktop shortcut updated**: `C:\Users\sekip\Desktop\FormuLab.lnk` via `WScript.Shell` — `TargetPath` = the fresh exe above, `WorkingDirectory` = its containing directory. Verified by reading the shortcut back: target exists, timestamp matches the fresh build exactly. `.lnk` itself not committed (outside the repo).
17. **Git commit + push**: inspected `git status`/`git diff` carefully before staging; staged ONLY the 24 legitimate FVL-02 files (3 new: `architecture_portfolio.py`, `test_acceptance_formula_count.py`, `test_architecture_portfolio.py`; 21 modified — engine/pipeline/tests, 5 frontend route/lib files + their tests, 8 locale files, 2 tracker/handoff docs, Rust bridge). Explicitly did NOT stage `docs/generated/*` (docx/pdf), the 11 `formulas/*` deletions, or the 3 untracked Phase 11/12/13 external logs — all pre-existing, unrelated, left exactly as found. Commit `85d4d48aa2bf70eb1d6f893a16acfb077bf552bb`: "feat(v1): dynamic 3-7 scientific formulation portfolio selection (FVL-02)". Pushed to `origin/feature/laboratory-stability` — confirmed local HEAD == origin HEAD == `85d4d48`.
18. **GitHub issue #3 synced**: posted a comment summarizing the 23/24 completion, full validation results, and the exact remaining blocker; issue left OPEN (correct — FVL-02 is not fully closed).

### What remains (why FVL-02 is not marked COMPLETE)

Only **`FVL-02.009`**: decide and implement (or explicitly, defensibly decide against) a distinct result-status signal for `actual_formula_count` < 3 specifically, distinguishing it from the general "delivered fewer than requested" shortfall that already works correctly for every case actually observed (down to `actual=4`). This is the sole blocking item; every other FVL-02.0xx subtask, and every item in this session's own closure-gate checklist that doesn't depend on FVL-02.009, is now genuinely proven — see the tracker's own per-task evidence notes for exactly what each COMPLETED mark rests on.

### Exact next task

**`FVL-02.009`.** Once resolved (or explicitly, defensibly waived with a recorded reason — e.g. "the generic shortfall signal already suffices; a below-3 case is structurally unreachable given `balanced`/`max_performance`'s unconditional applicability, so no separate signal is warranted"), mark it COMPLETED or explicitly document the waiver, then FVL-02 formally closes (24/24) and `docs/handoffs/FORMULAB_V1_CURRENT.md`'s CURRENT pointer moves to the first blank FVL-03 task (`FVL-03.001`, Cost Engine integration) — not started, not begun this session, per the standing "do not begin FVL-03" instruction.

**Files changed this session** (beyond what prior sessions already had uncommitted): `apps/desktop/src-tauri/src/formulation_v2.rs`, `apps/desktop/src/app/routes/{FormulationResultPage,NewFormulationRequestPage}.{tsx,test.tsx}`, `apps/desktop/src/i18n/locales/{en,de,es,fr,ja,ko,tr,zh-Hans}/session.json`, `apps/desktop/src/lib/{formulationReport.test.ts,formulationV2.ts}`, `docs/FORMULAB_V1_TASK_TRACKER.md`, `docs/handoffs/FORMULAB_V1_CURRENT.md`, `runtime/pipeline/test_acceptance_formula_count.py` (new).

**Test totals at checkpoint:** Python 366 passed + 5 subtests; Rust `formulation_v2::` 10/10; frontend 138 files / 1274 tests.

**Commit/push status:** committed (`85d4d48`) and pushed; local HEAD == `origin/feature/laboratory-stability`. **No legitimate uncommitted FVL-02 work remains** — the working tree now only carries the same pre-existing, deliberately-unrelated changes (`docs/generated/*`, `formulas/*` deletions, untracked Phase 11/12/13 external logs) that every prior checkpoint in this saga has also left untouched.

**Build/shortcut status:** fresh `formulab.exe` built (2026-08-17 22:49:30) and bundled (MSI + NSIS); Desktop shortcut updated and verified.

SESSION CHECKPOINT — WORK INCOMPLETE (FVL-02.009 open). FVL-02 NOT marked COMPLETED (23/24). FVL-03 NOT started.


---

## 2026-08-17 — FVL-02 CLOSURE (session 7): FVL-02.009 resolved, FVL-02 formally closed 24/24, GitHub issue #3 closed

**Branch:** `feature/laboratory-stability`
**Starting HEAD:** `85d4d48aa2bf70eb1d6f893a16acfb077bf552bb`
**Final HEAD:** `21ac4ea45082388c1fa4c5bfd33129f2f9e87d95` (pushed, confirmed matching `origin/feature/laboratory-stability`)

### FVL-02.009 decision

Implemented (not waived). "Below-3-defensible-alternatives behavior: mark result incomplete/insufficient rather than fabricate."

### Exact implementation

- `runtime/pipeline/engine.py`: two new constants, `FORMULA_ALTERNATIVES_SUFFICIENT = "sufficient"` and `FORMULA_ALTERNATIVES_INSUFFICIENT = "insufficient_formula_alternatives"`.
- `runtime/pipeline/pipeline.py::run()`: computes `formula_alternatives_status = engine.FORMULA_ALTERNATIVES_SUFFICIENT if actual_formula_count >= engine.MIN_FORMULA_ALTERNATIVES else engine.FORMULA_ALTERNATIVES_INSUFFICIENT` and adds it as a new top-level field on the return dict, alongside the existing `requested_formula_count`/`actual_formula_count`/`alternative_shortfall`/`shortfall_reason`.
- `apps/desktop/src/lib/formulationV2.ts`: `GenerateResult.formula_alternatives_status?: "sufficient" | "insufficient_formula_alternatives"` (additive, optional — no other frontend logic changed, nothing currently reads it yet).

### Status semantics (the actual design decision)

`formula_alternatives_status` is a field **SEPARATE** from `pipeline.run()`'s existing `status` (`"ok"` / `"ok_partial_research"` / `"research_corpus_incomplete"` / etc., which is entirely about research-corpus completeness — see `provenance.py`'s `CORPUS_FULL`/`CORPUS_PARTIAL`/`CORPUS_INSUFFICIENT`). The two concepts are independent and can both be true simultaneously without either overwriting the other: a session can be `status: "ok_partial_research"` AND `formula_alternatives_status: "insufficient_formula_alternatives"` at once. The real alternatives already produced are **always** returned as-is regardless of which state fires — this signal never discards a real formula and never fabricates a padding formula to reach the minimum. This design was chosen specifically because setting the literal top-level `status` field to an "insufficient" value (as one reading of the instruction's example suggested) would have violated the explicit requirement that research-corpus status and formula-alternative-count status "remain distinguishable and no status silently overwrites the other."

### Real, disclosed finding

Under the CURRENT strategy library (`strategy.py`'s 9-entry `_LIBRARY`), `actual_formula_count < MIN_FORMULA_ALTERNATIVES` (3) is **not reachable through genuine strategy scarcity** for any real brief: `balanced` is always included; exactly one of `cost_optimized` (applies whenever `targetCostLevel != "premium"`) or `premium_sensory` (applies whenever `targetCostLevel == "premium"`, regardless of claims) always applies — the two are mutually exclusive but jointly exhaustive over every possible cost-level input; and `max_performance` is an unconditional near-universal fallback, added whenever a slot remains open. These three together guarantee at least 3 applicable strategies for any conceivable brief. Additionally, the deterministic engine has no per-slot failure path — `build_formula_for_strategy` always produces a `status: "ok"` card once a strategy is chosen (the old `"generation_failed"` status was removed when the LLM-based generation path was replaced by the deterministic engine). So today, `len(cards) == len(strategies) >= 3` always holds in practice.

Given this, the tests prove the SIGNAL itself is correct without being able to trigger it through a real brief — by wrapping the real `strategy.derive_strategies()` and slicing its own genuine output to simulate "only 2 genuinely applied" (never fabricating a `VersionStrategy`), the same situation a future, narrower strategy library could legitimately produce. This is a defensive correctness proof for an edge case that is real in the data model but currently unreachable in practice — disclosed explicitly rather than silently assumed untestable.

### Tests added

`runtime/pipeline/test_formula_alternatives_status.py`, 8 tests, all passing:
1. `test_requested_3_actual_2_below_minimum_status` — 2 real formulas (v1, v2), no fake v3, `alternative_shortfall=1`, `formula_alternatives_status="insufficient_formula_alternatives"`.
2. `test_requested_7_actual_2_below_minimum_status_large_shortfall` — 2 real formulas, `alternative_shortfall=5`, same below-minimum status.
3. `test_requested_5_actual_4_is_normal_shortfall_not_below_minimum` — the existing, already-established 4-of-9-strategies-apply scenario stays `"sufficient"` (4 >= 3).
4. `test_requested_3_actual_3_is_normal_success` — baseline default request, `"sufficient"`.
5. `test_partial_research_corpus_with_sufficient_alternatives` — `status="ok_partial_research"` + `formula_alternatives_status="sufficient"` coexist correctly.
6. `test_partial_research_corpus_with_insufficient_alternatives_both_signals_independent` — `status="ok_partial_research"` AND `formula_alternatives_status="insufficient_formula_alternatives"` both true simultaneously, `research_corpus.status` still independently `"partial"` — neither field overwrites the other.
7. `test_no_fabricated_alternative_when_below_minimum` — exactly 2 cards, no duplicate/padded version.
8. `test_zero_llm_guard_still_passes_below_minimum` — no `ai_formulation_inference` origin anywhere on the below-minimum result.

### Real, pre-existing packaging defect found and fixed (while preparing the rebuild, not part of FVL-02.009 itself)

`apps/desktop/src-tauri/src/formulation_v2.rs`'s `materialize_pipeline()` — the function that embeds the Python pipeline package into the compiled Rust binary via `include_str!` and writes it out to app-private storage at runtime — was **missing `architecture_portfolio.py` entirely**. `pipeline.py` has imported that module directly since an earlier FVL-02 session (`import architecture_portfolio`), so the SHIPPED desktop app would have thrown `ImportError` on every real generation attempt, despite every Python-level `pytest` run passing cleanly — the test suite always runs against the live repo checkout on disk, never the materialized/embedded copy the actual shipped `.exe` uses. This was invisible until this session because no prior FVL-02 session had reason to rebuild-and-verify the actual materialization path end to end. Fixed: added `const F_ARCHITECTURE_PORTFOLIO: &str = include_str!(...)` and the corresponding `("architecture_portfolio.py", F_ARCHITECTURE_PORTFOLIO)` entry to the write list. Verified directly: reproduced the exact Rust embed-file list in a disposable temp directory (parsed straight out of the `.rs` source, not hand-copied) and ran `run_cli.py` against it with a real request — clean JSON response, zero `ImportError`, reached genuine pipeline business logic (`"research_corpus_incomplete"`, the correct outcome for a sandbox with no live literature-retrieval network access).

### Test totals

- `python -m pytest runtime/pipeline -q` — **374 passed, 5 subtests passed** (366 + 8 new).
- `cargo check --release` — clean. `cargo test --release formulation_v2` — **10/10** (unchanged from before this session's Rust fix — the materialize-list fix has no unit-testable surface of its own beyond the direct reproduction above; full `cargo test --release` not re-run, no bridge/persistence data-shape logic changed).
- `pnpm tsc --noEmit` — clean. `pnpm lint` (ESLint) — clean.
- Targeted `pnpm vitest run` on every file whose types touch `formulationV2.ts` (`FormulationResultPage.test.tsx`, `NewFormulationRequestPage.test.tsx`, `formulationReport.test.ts`) — **63/63 passing**. Full `pnpm vitest run` (138 files / 1274 tests) was run clean in the immediately prior session and not re-run in full this session, since the only frontend change this session was one additive, optional TypeScript field with no logic behind it.
- `git diff --check` — clean (only expected Windows LF→CRLF warnings).

### Tracker result

`docs/FORMULAB_V1_TASK_TRACKER.md`: `FVL-02.009` marked COMPLETED with its evidence note. FVL-02's own section header now reads "— CLOSED (24/24, 2026-08-17)". Summary table row: `24 | 24 | 0 | 0`.

`docs/handoffs/FORMULAB_V1_CURRENT.md`: fully rewritten — current work package now "FVL-02 — CLOSED, 24/24 (2026-08-17)"; current/next task now `FVL-03.001` (blank, NOT STARTED); the FVL-02.009 resolution and the packaging-defect fix both documented in full; test/commit sections updated with final real values.

### GitHub result

Issue #3 ("FVL-02 — Dynamic 3-7 Formula Alternatives") commented with the full closure summary and **closed** (`gh issue close 3 --reason completed`) — matches the tracker's own convention (compare FVL-01/issue #2, closed).

### Build/shortcut result

Rebuilt (required — this session touched the embedded Python pipeline, the Rust materialize list, AND a TypeScript type): `pnpm tauri build` succeeded. Fresh `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe` — **timestamp 2026-08-17 23:18:25**. MSI + NSIS bundles also produced. Desktop shortcut (`C:\Users\sekip\Desktop\FormuLab.lnk`) already pointed at the correct unchanged `TargetPath`/`WorkingDirectory` — re-verified via `WScript.Shell` readback (target exists, timestamp matches the fresh build exactly) rather than blindly assumed unchanged.

### Commit/push result

Two commits this session, both pushed:
1. `d2f5813840df435a74ecd602d88bdde66c50c16c` — "fix(v1): close FVL-02 minimum-alternative status" (7 files: `formulation_v2.rs`, `formulationV2.ts`, `engine.py`, `pipeline.py`, `test_formula_alternatives_status.py` new, tracker + handoff docs).
2. `21ac4ea45082388c1fa4c5bfd33129f2f9e87d95` — "docs: finalize FVL-02 closure pointer with commit SHA and next task" (the handoff doc's own final commit-SHA/next-task fields, which could only be written accurately after commit 1 existed).

Neither staged the pre-existing unrelated changes (`docs/generated/*`, the 11 `formulas/*` deletions, the 3 untracked Phase 11/12/13 external logs) — inspected `git status`/`git diff --check` before every stage, confirmed clean both times.

Final HEAD `21ac4ea45082388c1fa4c5bfd33129f2f9e87d95` == `origin/feature/laboratory-stability`, confirmed via `git rev-parse` both sides.

### Final FVL-02 status

**FVL-02 COMPLETED — 24/24**

**NEXT: FVL-03.001 — NOT STARTED**


---

## 2026-08-18 — FVL-03.001 CLOSURE (session 8): Material Master ↔ build_candidate_pool() integration-seam audit completed, no code wired

**Branch:** `feature/laboratory-stability`
**Starting HEAD:** `21ac4ea45082388c1fa4c5bfd33129f2f9e87d95`
**Final HEAD:** `2abec269ed9ac971146585a841f0980abf1cdf30` (pushed, confirmed matching `origin/feature/laboratory-stability`)

**FVL-03.001 status: COMPLETED.** Audit/seam-definition task only, exactly as scoped — no supplier wiring, no cost wiring, no inventory wiring. FVL-03.002/.003/.004 remain untouched and NOT started.

### Canonical Material Master source of truth

`packages/shared/src/schemas/materials.ts` — `RawMaterial`/`Supplier`/`MaterialSupplier`/`MaterialPrice` (append-only)/`InventoryRecord`. Identity is explicit: `RawMaterial.code` is stable forever; `displayName`/`tradeName`/`inciName` are attributes, never identity (the schema's own module docstring says so explicitly).

### Actual storage/repository path

`apps/desktop/src-tauri/src/masterdata.rs`. Flat JSON-array files under `<project_root>/data/master/` (`materials.json`, `suppliers.json`, `material_suppliers.json`, `material_prices.json`, `inventory.json`, `exchange_rates.json`, `factory_profiles.json`, `cost_snapshots.json`, plus ~80 more collections — full enumeration in the Rust file's own top comment). Rows keyed by `code`, append-only collections reject re-upserting an existing code. `project_root` resolves via the same `data_root::resolve_data_root()` chain every other pipeline artifact (`data/sessions`, `data/literature`) already uses. Real, live frontend access: `apps/desktop/src/lib/masterdata.ts` → `apps/desktop/src/app/routes/MaterialsPage.tsx::listRecords("materials")`.

### Current Python material-data path

**NOT the canonical Material Master.** `runtime/pipeline/materials.py` is a second, independent, much simpler representation: a single flat `<materials_dir>/materials.json` file, shape `{schema_version, updated, currency, materials: [{material_id, name, inci, cas, price, currency, unit, supplier, stock, function, external_ref}]}` — a completely different path AND shape from `data/master/materials.json`. `materials_dir` resolves (via `apps/desktop/src-tauri/src/materials.rs::run()`) to `<project_root>/data` — one directory level ABOVE `data/master/`, so Python reads `<project_root>/data/materials.json`, a sibling file with zero relationship to the canonical store. Populated by a real, live, reachable second UI: `MaterialsCard.tsx` (Settings → General, confirmed mounted via `SettingsPage.tsx:151`), completely disconnected from the canonical `MaterialsPage.tsx` path.

### `build_candidate_pool()` input shape

`pipeline.py` calls `materials.load_materials(materials_dir).get("materials", [])` and passes that flat list into `engine.build_candidate_pool(..., materials_list, ...)`. Inside `build_candidate_pool()`'s `# 3. Supplier materials` block (`engine.py` ~line 690) and `_roles_for_supplier_material()` (line 426): only `inci`/`name` (identity key), `function` (free-text role keyword match), and `price` (tie-break bonus in `_selection_score`, engine.py:993-996) are actually read. `material_id` survives only as trailing trace provenance (`source_ids`), never as the pool key itself. The whole raw row is stashed on `IngredientCandidate.supplier_material` but only those 2-3 fields are ever read again.

### Identity mapping

**Mismatch confirmed by code on both sides.** Canonical: `RawMaterial.code`, joined against by every other canonical record (`MaterialSupplier.materialCode`, `MaterialPrice.materialCode`, `InventoryRecord.materialCode`, `CostLine.materialCode`). Current Python pool: `normalize_ingredient_key(inci or name)` — a normalized free-text chemistry-name key, computed independently, with zero relationship to `code`. The legacy row's own `material_id` (derived from `external_ref or cas or inci or name`) is ALSO not what the pool keys on.

### Fields currently used vs. missing

Used: `inci`, `name`, `function`, `price`. Never consumed (real canonical `RawMaterial` fields with no legacy-schema equivalent, so they structurally cannot reach Python today regardless of user input): `code`, `recommendedMinPercent`/`recommendedMaxPercent`/`technicalMaxPercent` (Tier 4 of `resolve_concentration()` looks for `recommended_min_pct`/`recommended_max_pct` — a key that can never exist on a legacy-schema row; the engine's own comment already says so — proven end-to-end this session with a real CSV-import test, not just asserted), `density`, `activeMatterPercent`, `ionicCharacter`, `hlb`, `regulatoryStatuses`, `incompatibilities`, `substituteCodes`, `documents`, `active` (inactive materials are never excluded today — a real gap), `manufacturer`, `countryOfOrigin`, `casNumbers` (plural), `hazardClassifications`, `allergens`.

### Duplicate-source-of-truth findings

**Confirmed, real, pre-existing (not created this session).** Two independent Tauri-command-backed material stores exist: (1) canonical `masterdata.rs` → `data/master/materials.json`, zod-validated, used by `MaterialsPage.tsx` and (eventually) the real Cost Engine; (2) legacy `materials.rs`/`materials.py` → `data/materials.json`, CSV-import shape, used by `MaterialsCard.tsx` (Settings) and `CostingPanel.tsx`/`FormulationWorkspaceV2.tsx` (live-reachability of the latter not fully traced this session — noted, not chased further, out of scope). Also confirmed: `materials.py::cost_formula()` is a separate, hand-rolled costing reimplementation (flat kg × price, no landed cost, no exchange rate, no factory overhead) — never calling the real `packages/shared/src/engine/cost.ts::costFormula()`.

### Exact integration seam decided (for FVL-03.002, not implemented this session)

1. Point the adapter at the canonical `data/master/materials.json` (+ `material_suppliers.json`/`material_prices.json`), never the legacy `data/materials.json`.
2. Carry `RawMaterial.code` across the seam as a real, additional identity field on `IngredientCandidate`/`SolvedIngredient` — in addition to, never instead of, the existing free-text INCI/name matching (which still matters for evidence-derived ingredients with no canonical record at all).
3. The adapter transforms shape only — maps canonical fields (`recommendedMinPercent` → `recommended_min_pct`, `technicalMaxPercent`, `active`, `density`, …) onto whatever `build_candidate_pool()` needs. It must never compute a price, landed cost, or concentration range itself.
4. No new Python-owned copy of `MaterialPrice`/`Supplier` — if a card needs to show a price, it carries enough identity (`material_code`, a `MaterialPrice.code`) for the FRONTEND to look the real record up via `masterdata.ts`, never a Python-side duplicate number.

Full detail (field-by-field mapping table, gap-to-task classification table): `docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s own FVL-03.001 section.

### Cost Engine boundary

`packages/shared/src/engine/cost.ts` read in full (774 lines) alongside its 673-line test suite. `costFormula(input: CostInput)` — `input.lines: FormulationLine[]` (each carrying `materialCode`), `input.materials: RawMaterial[]`, `input.prices: MaterialPrice[]`, `input.rates: ExchangeRate[]`, `input.profile?: FactoryCostProfile`. `priceFor()` selects the real-price-on-date (or flags an expired fallback, never silently omits). `findRate()` selects the exchange rate on/before `asOf`, with an `"identity"` no-op for same-currency. Missing price/rate is represented as `missingReason: "no_price" | "no_exchange_rate"`, never a silent zero. `landedUnitCost()`, `conversionCost()`, `costSku()`, `buildCostSnapshot()` (immutable snapshot production), `compareCostSnapshots()` (historical comparison) all read directly, all real, all tested.

**Explicit statement: no new Cost Engine was created this session.** The future formulation pipeline (FVL-03.003) must call this exact existing engine from the frontend/TypeScript side (passing it real `materialCode`-bearing `FormulationLine[]`), never reimplement any of this arithmetic in Python. `materials.py::cost_formula()` (the existing, pre-session, separate reimplementation) is explicitly named as the thing FVL-03.003 should retire in favor of calling the real engine — not retired this session.

### Tasks intentionally deferred

- FVL-03.002 — supplier/price wiring (canonical store as `materials_dir`, `material_code` field, `Supplier`/`MaterialSupplier` reaching the pool, `MaterialPrice` history, Tier 4 fix, `active` exclusion, `MaterialsCard.tsx` disposition).
- FVL-03.003 — cost strategy wiring (calling `costFormula()` from the real generation path, retiring `materials.py::cost_formula()`).
- FVL-03.004 — inventory wiring (`InventoryRecord` → candidate feasibility).
- FVL-03.006 (substitution) / FVL-03.008 (compatibility) — incompatibilities/substitutes/regulatory-status/hazard/document fields, already the tracker's own explicit assignments.

None of the above touched this session.

### Files changed

New: `docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md` (the full audit), `runtime/pipeline/test_material_master_seam.py` (4 tests proving the current-state gaps end-to-end against real code, not hand-constructed dicts). Modified: `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-03.001 → COMPLETED with evidence note, summary row 6→7 completed), `docs/handoffs/FORMULAB_V1_CURRENT.md` (current work package → FVL-03 ON PROCESS 7/18, current task → FVL-03.002 NOT STARTED, FVL-03.001 resolution documented, trimmed the now-superseded FVL-02-session narrative blocks).

### Tests/results

- `python -m pytest runtime/pipeline/test_material_master_seam.py -q` — 4/4 passed.
- `python -m pytest runtime/pipeline -q` (full suite) — **378 passed, 5 subtests passed** (374 + 4 new).
- `packages/shared/src/engine/cost.test.ts` (existing Cost Engine suite, re-verified untouched) — **44/44 passed**.
- `git diff --check` — clean.
- No Rust/TypeScript production code changed — no `cargo`/`tsc`/full `vitest` rerun needed, no desktop rebuild performed (correctly, per the explicit "don't rebuild unless shipped code changed" instruction).

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md`: FVL-03.001 → COMPLETED (2026-08-18) with full evidence note. FVL-03 summary row: `18 | 7 | 0 | 11` (was `18 | 6 | 0 | 12`).

### GitHub update

Issue #4 ("FVL-03 — Unified Formulation Pipeline ↔ Existing FormuLab Engines") commented with the full FVL-03.001 closure summary — left OPEN (17 tasks remain, unlike FVL-02's full closure).

### Commit SHA

Two commits, both pushed:
1. `86e965a6f8ddbb2144e077f05fbe66a635a46bd0` — "docs(v1): close FVL-03.001 material master integration-seam audit" (4 files: new architecture doc, new test file, tracker, handoff — the handoff's own commit-SHA field couldn't be filled in before this commit existed).
2. `2abec269ed9ac971146585a841f0980abf1cdf30` — "docs: finalize FVL-03.001 closure pointer with commit SHA" (handoff doc's own final SHA reference).

### Push result

Both pushed cleanly, no force push, no history rewrite. Final HEAD `2abec269ed9ac971146585a841f0980abf1cdf30` == `origin/feature/laboratory-stability`, confirmed via `git rev-parse` both sides.

**FVL-03.001 COMPLETED**

**NEXT: FVL-03.002 — NOT STARTED**
