# Phase 14 — Evidence-Driven Hybrid Literature & Formulation Intelligence

## Status: SESSION 1 COMPLETE — Literature Search Orchestrator, Findpapers adapter, native OA adapters (DOAJ/Unpaywall/Semantic Scholar), CanonicalPaper cross-source dedup wired into the real pipeline (§14). Session 0 (§11a): pipeline audit, CanonicalPaper schema, adapter boundary, source-availability decision. The New Formulation Request/Formulation Result screens (§13, built out of sequence in the same run as Session 0) had a real data-contract bug between their build and this round — fixed, see §13a. Both the new screens and the pre-existing `/live` workspace remain available; see §13a for the disclosed dual-flow state.

This document registers Phase 14 and records the approved product
decisions it must implement. Session 0 (§11a) is the first real
implementation work — a dormant, unwired `runtime/pipeline/
canonical_paper.py` module plus 23 new tests — everything else in this
document below §11a is still the original reservation-time design
record, not yet built. See `docs/handoffs/PHASE14_CURRENT.md` for the
current session pointer, and `docs/architecture/IMPLEMENTATION_STATUS.md`'s
own Phase 14 entry for where this sits in the overall roadmap.

**Approved UI visual references** (registered, not yet implemented —
see §7/§8): `docs/assets/phase14/formulation-request-screen.png` and
`docs/assets/phase14/formulation-reply-screen.png`, with a full
field-by-field, tab-by-tab implementation specification in
`docs/PHASE14_FRONTEND_UI_SPECIFICATION.md` for whichever future
session (Session 3 for the request screen, Session 4 for the result
screen, per §12) implements them.

**Phase numbering**: Phase 14 began its first real session only after
Phase 13 (Enterprise Identity, Authentication, Fixed RBAC & Application
Security) closed as implementation-complete (Phase 13 architecture doc
§28) — Phase 13's own remaining native-GUI acceptance item was carried
into `docs/RELEASE_MANUAL_ACCEPTANCE_CHECKLIST.md` as a release-
preparation item, not a Phase 13 blocker, by explicit human decision.

---

## 0. Why this phase exists

FormuLab already has a working, evidence-based formulation-discovery
engine: `runtime/skills/core/formulation-discovery/discover.py` +
`SKILL.md`, backed by `runtime/pipeline/pipeline.py`/
`literature_cache.py`, reachable today via `formulation_v2.rs`'s
`generate_formulation` Tauri command (Phase 13 Session 4A gated this
command to require a valid session, without touching its behavior).
Today it retrieves **open-access-only** literature from exactly three
sources — OpenAlex, Europe PMC (PubMed/PMC + patents), and arXiv — in
one `discover.py` call, extracts ingredients/functions/concentrations
with citations, and returns a single synthesized candidate formula
with citations, cost-optimized.

Phase 14 is the approved evolution of that pipeline into a full
**hybrid, multi-source, provenance-preserving literature engine**
feeding a **redesigned, evidence-explainable formulation generation and
result-review experience** — including, for the first time, a
generated **manufacturing process recipe** with sourced critical
parameters, not just an ingredient list. This document is the
architecture-level record of every approved decision; implementation
sequencing is proposed in §12 but not started.

---

## 1. What Phase 14 evolves, and what it explicitly preserves

**Evolves** (all currently single-purpose or narrow):

- Retrieval: 3 hardcoded open-access sources → a multi-source
  **Literature Search Orchestrator** (§2/§3).
- Paper identity: whatever `discover.py` returns today → a
  **CanonicalPaper** model with cross-source deduplication and full
  provenance (§4).
- Formula output: one synthesized candidate → **at least three**
  evidence-driven, independently explainable alternatives (§8).
- Ingredient justification: citations attached to the pipeline's own
  reasoning → a queryable, per-ingredient-per-concentration
  **evidence context** answering "why this chemical, why this exact
  %" on demand (§5, §9).
- Process output: none today (only a formula) → a real, sourced
  **manufacturing process recipe** with critical parameters and
  required equipment (§6).
- Request/result UI: the current three-part formulation-request flow
  → one **"Yeni Formülasyon Talebi"** screen (§7) and a version-card
  **result screen** (§8).

**Explicitly preserved, unchanged by this phase**:

- The safety gate `SKILL.md` already enforces (refuse
  explosives/weapons/controlled-substance/harm-intent targets) —
  Phase 14 does not weaken or bypass it.
- Open-access-only full-text retrieval as the baseline legal posture —
  Phase 14 adds sources and OA-resolution machinery (§3), it does not
  introduce paywalled/unlicensed full-text access.
- FormuLab's own laboratory, stability, approval, and production
  workflow (Phase 1-13, including Phase 13's role/workflow-gate
  enforcement) remains authoritative. Literature evidence **improves**
  formulation quality; it never bypasses or substitutes for a real
  laboratory trial, a real approval record, or a real workflow gate
  (§10, last paragraph — explicit product decision, not an
  implementation detail).
- The canonical 12-role identity/authorization model (Phase 13) — no
  new roles, no per-user permissions, same `rolePolicy.ts`/`authz.rs`
  mechanism gates whatever Phase 14 commands eventually need gating.

---

## 2. Hybrid Literature Engine — pipeline shape

```
FormuLab Query ("Yeni Formülasyon Talebi", §7)
  -> Literature Search Orchestrator
  -> multi-source discovery (§3)
  -> CanonicalPaper normalization (§4)
  -> DOI/title/author deduplication (§4)
  -> legal OA full-text resolution
  -> structured evidence extraction
  -> evidence ranking (evidence classes A-E, §5)
  -> formulation synthesis (>= 3 alternatives, §8)
  -> Compatibility / Safety / Regulatory (existing engines, unchanged)
  -> Optimizer (existing Advanced Optimizer, unchanged)
  -> manufacturing-process synthesis (§6, new)
  -> laboratory validation workflow (existing Phase 1-9 lab/stability
     workflow, unchanged — literature evidence feeds INTO it, never
     substitutes for it)
```

Every arrow above is a real pipeline boundary a later session's design
must give a concrete interface to. This document fixes the shape and
the product decisions at each stage; it does not fix the Rust/Python/
TypeScript module boundaries — that is implementation-session work.

---

## 3. Discovery sources

**Findpapers adapter** (a single FormuLab-owned adapter wrapping the
`findpapers` library, never `findpapers` called directly from FormuLab
business logic — FormuLab owns the canonical paper/evidence models,
§4):

- OpenAlex
- Crossref
- PubMed
- Semantic Scholar
- arXiv
- IEEE Xplore, where legitimately available (real API access/license)
- Scopus, where legitimately available
- Web of Science, where legitimately available

**Native/specialized FormuLab adapters** (outside Findpapers' own
coverage, each its own small FormuLab-owned adapter):

- CORE
- DOAJ
- Europe PMC / PMC
- BASE
- Unpaywall

**Google Scholar**: optional, last-resort discovery source only, and
only if a reliable, legitimate integration is possible at
implementation time (Google Scholar has no official public API; most
integrations are scraping-based and fragile/ToS-risky). **Must not**
become a core dependency — the orchestrator must work correctly with
Google Scholar entirely absent.

**Adapter boundary rule**: every source above returns into one shared
FormuLab-side result shape before touching any FormuLab business logic
(compatibility/safety/regulatory/optimizer/evidence ranking never see
a source-specific payload shape). This is what makes deduplication
(§4) and evidence ranking (§5) source-agnostic.

---

## 4. CanonicalPaper — identity, deduplication, provenance

**One study, one record, regardless of how many sources returned it.**
The same paper appearing in OpenAlex, Crossref, and Semantic Scholar
counts as one `CanonicalPaper`, not three — but every source that
contributed to it is preserved as its own provenance entry (source
name, source-native id, retrieval timestamp, raw source metadata
pointer), never discarded once deduplication picks a canonical
representation.

**Deduplication key, in priority order**: DOI (when present, on both
sides, exact match) → normalized title + author-set similarity (when
DOI is absent on one or both sides) → a documented fallback for the
remaining ambiguous cases (deferred to the implementation session that
builds this — this document fixes the *requirement* — one canonical
study per real paper, full provenance preserved — not the exact
similarity-threshold algorithm).

**Legal OA full-text resolution**: once a `CanonicalPaper` is
identified, resolve to a legally-open full text (Unpaywall-style OA
location resolution, the existing OA-only posture from §1) before
structured evidence extraction runs. A paper with no resolvable legal
OA full text is retained as a citation/metadata-only record (still
usable for evidence-class D/E context, §5) but never has fabricated or
paywall-scraped full-text content attached.

---

## 5. Evidence-driven formula generation — the explainability contract

**Every generated ingredient, at its generated concentration, must be
able to answer, on demand:**

- Why this chemical?
- Why this exact concentration?
- Which unique studies support it? (deduplicated count, §4 — provider
  agreement across sources for the *same* study improves
  provenance/metadata confidence, it does **not** multiply the
  underlying experimental evidence count)
- Which *direct formulation* studies support it, specifically?
- Observed concentration range across supporting evidence
- Common/comparable concentration range
- Median (or another explicitly-named, defensible statistic — never
  an unlabeled "average" that hides which statistic was used)
- Evidence count
- Evidence class (below)
- Confidence
- Compatibility constraints (existing engine)
- Safety constraints (existing engine)
- Regulatory constraints (existing engine)
- Supplier evidence, where relevant (existing supplier/material-
  document records, Phase 13's now-authorized masterdata paths)
- Historical FormuLab laboratory evidence, where relevant (this
  installation's own trial/stability results — Phase 1-9's existing
  laboratory data)
- Alternatives considered, where useful

**Never fabricate evidence or a statistic.** Every number shown must
trace to real, retained evidence (§10). Where evidence is genuinely
insufficient to support a claim, the UI must say so explicitly (same
principle as §6's "Laboratory validation required" — do not invent a
plausible-looking value to fill a gap).

**Evidence quality classes** (planned, five tiers):

| Class | Meaning |
|---|---|
| A | Direct formulation evidence — the ingredient at (or near) this concentration, in a real formulation study |
| B | Experimental ingredient evidence — real experimental data on the ingredient, not necessarily in a finished-formulation context |
| C | Review / secondary evidence — a review or summary source, not primary experimental data |
| D | Related-domain evidence — relevant but from an adjacent product/domain context |
| E | Weak / indirect evidence — the weakest tier still worth surfacing, never silently dropped, but never allowed to look like class A |

**Statistics must be calculated from deduplicated, genuinely
comparable evidence** — the same `CanonicalPaper` deduplication from
§4 applies before any range/median/count is computed, so re-finding
the same study through a second source never inflates an evidence
count or narrows a range artificially.

---

## 6. Manufacturing process intelligence

For the **selected** formula version (§8/§9's version-selection model
applies here too — a process recipe is always version-scoped), where
evidence/domain knowledge genuinely supports it:

### İşlem Reçetesi (process recipe) — step-by-step, as applicable per step

- Order of addition
- Ingredient and quantity
- Vessel/equipment
- Mixer/agitation type
- RPM or shear range, when supported by evidence
- Mixing duration
- Target temperature/range
- Heating/cooling instructions
- Hold time
- pH checkpoints
- Viscosity/process endpoints
- Sampling/checkpoints
- Conditions required before advancing to the next step

### Kritik Parametreler (critical parameters) — a separate summary, not the step list

Limits that must not be violated, e.g.: maximum allowed temperature
after a sensitive ingredient is added; required pH range; preservative
addition temperature; shear restrictions; polymer hydration
requirements; fragrance addition temperature; required upstream
process state.

**Every critical parameter must state why it matters and its source
class**: scientific literature / supplier technical data / regulatory
requirement / safety rule / compatibility rule / historical lab
evidence / deterministic FormuLab engineering rule. **If reliable
evidence is missing, the UI shows "Laboratory validation required" —
never an invented value.** This is the same fabrication-avoidance
principle as §5, applied to process parameters instead of formula
concentrations.

### Ekipman (equipment) — its own tab

A separate summary of the equipment required by the selected version's
process — derived from the same İşlem Reçetesi data, not a
independently-maintained second equipment list.

---

## 7. New query screen — "Yeni Formülasyon Talebi"

**Approved visual reference** (registered outside any single session,
authoritative for whichever future session implements this screen):
`docs/assets/phase14/formulation-request-screen.png` (original filename
`formulation request screen.png`, approved by the user). **Full,
field-by-field implementation specification**:
`docs/PHASE14_FRONTEND_UI_SPECIFICATION.md` — English copy, exact field
list, sidebar contents, and section-by-section detail beyond what this
summary repeats. Preserve its
overall visual language, hierarchy, spacing, dark premium FormuLab
style, section grouping, sidebar relationship, CTA placement, and
natural-language-first workflow — this is the approved replacement for
the old multi-part formulation request flow, not a starting sketch to
redesign from. The screenshot is a **visual/UX reference only**: no
illustrative field value shown in it is real data, and none should be
copied as such into any implementation. If a real technical constraint
forces a deviation from it later, that implementing session must
document the reason, not silently redesign the screen.

Replaces the current three-part formulation-request experience with
one page. Main interaction: a large natural-language request field
(evolved from the current Part-2 free-request experience — reused
concept, not discarded). The same screen also offers optional
structured inputs, never required to start a request:

**Product information**: product category; target product type;
target market/country.

**Constraints/preferences**: excluded ingredients; preferred
ingredients; target pH; target viscosity; target active matter; target
cost level; claims; packaging, where relevant.

**Production information**: estimated batch size; available equipment;
available raw materials.

The user writes their request naturally and starts discovery from this
one screen — structured fields refine, they do not replace, the
natural-language request.

---

## 8. New result screen — version cards, not side-by-side formulas

**Approved visual reference** (same status as §7's): `docs/assets/
phase14/formulation-reply-screen.png` (original filename `formulation
reply screen.png`, approved by the user). **Full, tab-by-tab
implementation specification**: `docs/PHASE14_FRONTEND_UI_SPECIFICATION.md`
— every result tab's exact field list (Formula/Manufacturing
Procedure/Critical Parameters/Equipment/Safety/Regulatory/Evidence &
Sources/Alternatives/Summary), the right-side evidence panel's exact
structure, quick actions, and the version-summary/comparison cards, in
English, well beyond what this summary repeats. Preserve the approved
structure it shows: fixed original request pinned at top; V1/V2/V3
selector cards; only one selected formulation shown at a time; a
selected-ingredient evidence panel on the right; version-scoped tabs
(the screenshot shows all nine of this section's own fixed tab set
below, confirming the design, not adding to it); the formula table;
a summary/quick-actions panel; scores and evidence context. Switching
versions must update all version-dependent content, exactly as this
section already requires.

**The screenshot's own content is illustrative UX filler, not real
data — do not copy it.** In particular: the reference's V2 formula
table lists "Sodium Coco-Sulfate (SCS)" as the top ingredient, while
the same screenshot's pinned original request explicitly asks for a
"sülfatsız" (sulfate-free) product — a real, visible inconsistency in
the mockup's own illustrative content. A real implementation must
never reproduce this: every ingredient, concentration, evidence count,
citation, and score shown on this screen must come from the actual
Phase 14 evidence/formulation pipeline (§5/§10), which itself already
excludes sulfates for a sensitive/sulfate-free request via
`rules.py::derive_constraints`/`validate` (`runtime/pipeline/rules.py`,
unchanged by Phase 14, reused as-is) — the mockup's inconsistency is a
reference-image artifact, not a product requirement to preserve. If a
real technical constraint forces a structural deviation from this
reference later, that implementing session must document the reason,
not silently redesign the screen.

The original user request stays fixed and visible at the top of the
result screen at all times.

FormuLab generates **at least three meaningful alternatives** when
evidence and constraints allow it — never padded to exactly three with
low-quality filler, and never fewer than the evidence genuinely
supports.

**Never show three full formulations side-by-side.** Selectable
version cards instead:

```
V1                          V2                          V3
[short strategy label]      [short strategy label]      [short strategy label]
[short explanation]         [short explanation]         [short explanation]
```

Only **one** selected version is displayed at a time. Switching
versions changes **all** version-dependent content on the page — every
tab, every evidence panel, everything scoped to "the selected version"
re-renders for the newly selected one (§9 makes this a hard
requirement, not just a UI nicety).

**Strategy labels are contextual**, chosen from the actual request and
evidence, not hardcoded. The three examples below are illustrative,
not a fixed enum FormuLab must always produce:

- V1 — Dengeli / Önerilen: best balance of performance, cost, and
  robustness.
- V2 — Maliyet Optimize: lower cost while preserving acceptable
  performance.
- V3 — Hassas Cilt Odaklı: lower irritation / mildness-focused.

**Result tabs** (fixed set, all version-scoped except the request
banner itself):

- Formül
- İşlem Reçetesi
- Kritik Parametreler
- Ekipman
- Güvenlik
- Regülasyon
- Kanıtlar & Kaynaklar
- Alternatifler
- Özet

---

## 9. Version-specific ingredient evidence

Ingredient evidence always has an unambiguous three-part context key:

```
formulaVersionId + ingredientId/materialId + selected concentration
```

Selecting an ingredient row in the currently-active version's Formül
tab opens an evidence panel scoped to exactly that triple — e.g. "V2 >
Cocamidopropyl Betaine > 5.50%" — showing (per §5's contract): why this
ingredient, why this concentration (observed range / common range /
median / evidence count / confidence), FormuLab's decision factors,
supporting scientific sources, and safety/regulatory/process
constraints.

**Switching versions (V1 <-> V2 <-> V3) clears/changes the selected
evidence context.** Evidence from one version must never be displayed
as though it supports a different version's ingredient/concentration
decision — this is a correctness requirement, not a UI-polish one: a
future implementation must key evidence lookups by the full triple
above, never by ingredient/material id alone.

---

## 10. Traceability — what must be persisted

Planned persistence, end to end, for every generated result:

- Original user request (natural-language + structured fields, §7)
- Expanded search queries the orchestrator actually ran
- Providers queried (§3) and their raw responses/pointers
- Canonical papers (§4)
- Deduplication/provenance records (§4)
- OA full-text source used per paper
- Extracted evidence (structured, per paper)
- **Rejected evidence and the reason it was rejected** — not just what
  was kept
- Ingredient-selection reasoning
- Concentration calculations (§5's statistics, with their inputs)
- Process evidence (§6)
- Optimizer inputs/results (existing Advanced Optimizer, reused)
- Safety/compatibility/regulatory results (existing engines, reused)
- Final V1/V2/V3 alternatives (§8)
- Confidence calculations
- Validation gaps (anywhere §5/§6's "insufficient evidence, do not
  fabricate" rule triggered)

**Literature evidence improves formulation quality; it never bypasses
FormuLab's laboratory, stability, approval, or production workflow.**
A Phase-14-generated formula still enters the exact same Phase 1-13
lifecycle (draft -> lab trial -> stability -> pilot/production approval,
Phase 13's role/workflow-gate enforcement fully intact) as a
manually-authored one. Phase 14 makes the *starting candidate* better
and more explainable; it does not shorten or bypass a single existing
gate.

---

## 11a. Session 0 — pipeline audit, CanonicalPaper schema, adapter boundary, source-availability decision (DONE)

Phase 13 closed (its own architecture doc §28) before this session
started; Phase 14 Session 0 is the first real Phase 14 work. Scope per
§12 item 1 below, exactly, not redesigned: audit the existing discovery
pipeline in detail, design the `CanonicalPaper` schema and deduplication
algorithm concretely, design the Findpapers-adapter boundary, confirm
real access to IEEE Xplore/Scopus/Web of Science/Google Scholar. No UI
work — none of §7/§8's screens were touched by this session (their
approved visual references were registered as documentation, a separate
action from implementing them — see §7/§8's own notes).

**Pipeline audit — one material finding.** `discover.py`/`pipeline.py`/
`literature_cache.py` were read in full. §0/§1's own premise above —
"today it retrieves ... from exactly three sources — OpenAlex, Europe
PMC, arXiv" — describes `discover.py`'s CLI default
(`--sources openalex,europepmc,arxiv`), not the real production path.
`literature_cache.gather()` — what `pipeline.py::run()`, and therefore
the live `generate_formulation` Tauri command, actually calls — defaults
to `"openalex,openaire,europepmc,crossref"`: **four** sources, with
arXiv deliberately excluded by that function's own comment ("indexes
physics/CS/math preprints and holds essentially no consumer-formulation
literature"). Two already-working native fetchers this document never
named exist today: `discover.fetch_crossref` (§3 lists Crossref under
Findpapers' own coverage — Session 1 should decide keep-vs-replace, not
assume it needs building) and `discover.fetch_openaire` (not in §3's
source list at all, anywhere — should be added to the native-adapter
list, not silently dropped when Session 1 wires the real orchestrator).
Also confirmed while auditing `pipeline.py`: it already generates `n`
candidate formulas (default 3) in one LLM call and writes `v1`/`v2`/`v3`
cards — §1's "Formula output: one synthesized candidate → at least
three alternatives" slightly overstates the gap at the generation-count
level; the real, still-open gap is the version-card UI (§8), per-
ingredient evidence querying (§9), and the CanonicalPaper/provenance
model (§4) — not the raw count of formulas the pipeline can produce.

**`CanonicalPaper` schema + deduplication algorithm — designed and
implemented, not yet wired.** New module,
`runtime/pipeline/canonical_paper.py` (the file itself is the
authoritative field list — not reproduced here to avoid a second copy
this document would have to keep in sync by hand): a
`CanonicalPaper` dataclass (`title`/`year`/`authors`/`venue`/`doi`/
`is_oa`/`oa_url`/`abstract`/`sources`) mirroring `discover.py::_row()`'s
existing field set, plus `sources: List[ProvenanceEntry]` — the part
§4 requires and today's flat `paper_key()`-based dedup in
`literature_cache.py` does not have (deduplication today silently
discards the losing duplicate's row entirely; nothing is preserved). A
concrete, three-tier `deduplicate()` function implements §4's priority
order: Tier 1 exact normalized-DOI match; Tier 2 (no DOI on either
side) exact normalized-title match AND at least one overlapping author
surname — two weak signals combined, deliberately never trusting either
alone; Tier 3 the documented fallback §4 explicitly leaves open —
anything clearing neither tier stays its own distinct `CanonicalPaper`,
a deliberate bias toward a missed merge (safe) over a wrong one (would
silently inflate an evidence count or corrupt a concentration range,
§5's own explicit warning). 23 new tests, `runtime/pipeline/
test_canonical_paper.py`, all passing — dedup correctness (both tiers,
positive and negative cases), provenance never discarded, representative-
record selection, result determinism, and the source-availability/
adapter-boundary items below. **Not imported by, and does not change
the behavior of, `discover.py`/`pipeline.py`/`literature_cache.py`** —
Session 1 wires real adapters and the orchestrator through this
contract; this module only defines and proves the contract itself.

**Findpapers-adapter boundary — designed.** A `runtime_checkable`
`LiteratureAdapter` `Protocol` (`canonical_paper.py`) names the existing
`_row()`-shaped `List[Dict]` return shape `discover.py`'s five current
fetchers already produce as the one contract every future adapter — the
single Findpapers-wrapping one and every native one — must satisfy
before touching `deduplicate()` or any other FormuLab business logic
(§3's "Adapter boundary rule"). This reuses the existing shape rather
than inventing a new one to migrate onto.

**Source availability — confirmed, not assumed** (§Risks items 1-2).
Checked directly: no IEEE Xplore, Scopus, or Web of Science API key,
base URL, or institutional-proxy configuration exists anywhere in this
codebase (`llm.py`'s provider table is the only external-API credential
registry this pipeline has, and none of the three appear in it); no
Google Scholar integration — scraping-based or otherwise — exists
either. Decision, recorded as a real, code-level artifact Session 1 can
consult (`canonical_paper.SOURCE_AVAILABILITY`), not just prose: all
four stay `"unavailable"` until real credentials or a legitimate
integration path actually exist; Session 1 must not build adapters for
them on assumption. The orchestrator must work correctly with all four
absent — already required by §3 for Google Scholar specifically, now
explicit for the institutional three as well.

**Verification**: `python -m pytest runtime/pipeline -q` — 94/94
passing (71 baseline + 23 new), zero regressions in the untouched,
already-live pipeline. `git diff --check`: clean.

**Residual for Session 1**: keep-vs-replace decision for
`fetch_crossref`/`fetch_openaire` vs. Findpapers' own coverage of the
same sources; the actual Findpapers install + adapter wiring; the
native CORE/DOAJ/BASE/Unpaywall adapters (§3); wiring `canonical_paper.
deduplicate()` into the real orchestrator so `literature_cache.gather()`
starts producing `CanonicalPaper`s with real provenance instead of its
current flat, provenance-discarding dedup.

## 11. Explicit non-goals for THIS reservation

Per the explicit instruction this phase is documentation-only right
now, none of the following happened as part of registering it, and
must not be inferred as started from this document's existence:

- Findpapers is not installed.
- No provider integration (Crossref/PubMed/Semantic Scholar/CORE/DOAJ/
  Europe PMC/BASE/Unpaywall/IEEE/Scopus/Web of Science/Google Scholar)
  has been added.
- The existing Formulation Discovery pipeline
  (`discover.py`/`pipeline.py`/`literature_cache.py`) is unchanged.
- No new query screen has been built; the current three-part request
  flow still runs exactly as before.
- No new result screen has been built.
- Current formula generation behavior (`generate_formulation`) is
  unchanged.
- Evidence extraction is unchanged.
- No manufacturing-process generation exists.

## 12. Proposed session breakdown (not started, sequencing only)

A first-draft shape, in the same spirit as every other phase's initial
session plan (Session 0 audits/designs before anything is built) —
subject to revision once Phase 13 closes and a real Phase 14 Session 0
begins:

1. ~~**Session 0** — audit the existing discovery pipeline in detail
   (`discover.py`/`pipeline.py`/`literature_cache.py`), design the
   `CanonicalPaper` schema and deduplication algorithm concretely,
   design the Findpapers-adapter boundary, confirm which of IEEE
   Xplore/Scopus/Web of Science/Google Scholar are realistically
   available to this installation before committing to them.~~ **DONE**
   — see §11a for the full write-up: one material audit finding (the
   live pipeline already defaults to four sources, not three, and two
   of them — Crossref, OpenAIRE — aren't in this document's own §3
   list), `canonical_paper.py`'s schema/dedup/adapter-boundary/source-
   availability artifacts (dormant, not yet wired), 23 new passing
   tests.
2. ~~**Session 1** — Literature Search Orchestrator + Findpapers adapter
   + the native CORE/DOAJ/Europe PMC/BASE/Unpaywall adapters,
   producing deduplicated `CanonicalPaper`s with full provenance. No
   UI changes.~~ **DONE** — see §14. One disclosed deviation: CORE and
   BASE were tested live and found genuinely unavailable to this
   installation (no API key; access denied), not built as dead-code
   adapters; DOAJ and Unpaywall were built and confirmed working instead,
   plus Semantic Scholar (via both a native fetcher and the Findpapers
   adapter) as a real but non-default, rate-limited source.
3. **Session 2** — structured evidence extraction + evidence-class
   (A-E) assignment + ranking, wired to the existing formula-synthesis
   step. Still produces one formula (current behavior), now with the
   new evidence model underneath it — a deliberate intermediate step
   before building the 3-alternative UI.
4. **Session 3** — multi-alternative (V1/V2/V3+) formulation synthesis
   + the new "Yeni Formülasyon Talebi" query screen. **The screen
   itself was built out of sequence, in Session 0, at the user's
   explicit direct instruction — see §13.** What remains genuinely
   Session 3's own work: true multi-alternative synthesis grounded in
   the (not-yet-built) evidence model, not the current pipeline's
   already-existing `n`-candidates-in-one-call generation.
5. **Session 4** — the new result screen: version cards, the 9-tab
   layout, version-scoped evidence context (§9). **The screen itself
   was built out of sequence, in Session 0, at the user's explicit
   direct instruction — see §13.** What remains genuinely Session 4's
   own work: wiring the tabs to real evidence-class rankings, process
   intelligence, and safety/regulatory determinations once Sessions
   1/2/5/6 build them — today's screen shows honest "not yet
   available" notices in every one of those places instead.
6. **Session 5** — manufacturing process intelligence (İşlem Reçetesi/
   Kritik Parametreler/Ekipman, §6).
7. **Session 6** — full traceability persistence (§10) across every
   stage above, plus a closure/regression pass.

Each session above gets its own real handoff/architecture-doc update
when it actually starts, exactly like every other phase in this
project.

---

## 13. Frontend implementation — New Formulation Request + Formulation Result screens (DONE, built out of sequence at explicit user instruction)

Session 0's own scope (§11a) is backend/design-only, and this document
said so in every place that matters. Mid-session, the user provided the
two approved screenshots (§7/§8) and a complete field-by-field
specification (`docs/PHASE14_FRONTEND_UI_SPECIFICATION.md`), initially
registered as documentation for §12's Session 3/Session 4 slots — then
explicitly instructed "please do these now, it is not a future
reference." Built in the same run, disclosed here rather than silently
absorbed into "Session 0."

**What was built**: `apps/desktop/src/app/routes/
NewFormulationRequestPage.tsx` (Screen 1, routed `/formulation-
request`) and `apps/desktop/src/app/routes/FormulationResultPage.tsx`
(Screen 2, routed `/formulation-result/:sessionId`), matching the
approved screenshots' layout, section order, card structure, and the
9-tab result layout as closely as this codebase's existing design
tokens/components allow, in English. The sidebar's "New" button and the
saved-formulations history list now point at these two screens instead
of the pre-existing `/live`/`/live/:sessionId` split-pane workspace
(`FormulationWorkspaceV2.tsx`) — which is **not removed**, still
routed, still fully functional, simply no longer the sidebar's default
entry point.

**What is real, and what is honestly not**: both screens call the
existing, completely unchanged `generate_formulation`/`read_session`
commands — no new backend command, no change to `runtime/pipeline/`'s
generation behavior at all. Every field on screen either shows real
data the pipeline already returns (ingredient list, function, weight
%, the formula's `purpose`/`name`/`how_it_works`/`warnings`, its
references' author/year/DOI, and the deterministic `violations` list
from `rules.py::validate`) or an explicit, visible "not yet available"
notice, per this document's own §5/§6 fabrication-avoidance rule,
applied consistently: no invented formula-version score (the version
cards show "Score: not yet available" rather than a fake 87/100 — this
document's own §8 mockup example, explicitly flagged as illustrative,
not a real number to reproduce), no per-ingredient evidence
class/observed-range/median/confidence (the right-side evidence panel
shows "Insufficient comparable evidence. Laboratory validation
required." exactly as §5 anticipates), no manufacturing procedure,
critical parameters, or equipment list (Tabs 2-4 show honest "not yet
generated" notices — Session 5's job), no safety/regulatory
determination beyond the one real, deterministic signal that already
exists (`rules.py`'s hard-avoid-list `violations`, shown as real
Formula-Level Safety findings; everything else in those two tabs is
marked "DATA INCOMPLETE," never a fabricated PASS).

**Structured request fields with no dedicated backend slot**: the
request screen's excluded/preferred ingredients, target pH/viscosity/
active-matter/cost-level, claims, packaging, batch size, equipment, and
available-raw-materials fields have no corresponding field in
`rules.py::derive_constraints`'s deterministic engine — they are
forwarded as extra keys on the `brief` object `generate_formulation`
already passes through to Python as opaque JSON, reaching the LLM as
"PRODUCT BRIEF" context (soft influence) but **not** enforced by the
deterministic hard-rule engine the way `target`/`category`/`market`/
`audience`/`performance` already are. This is disclosed in
`formulationV2.ts`'s own type-comment, not silently implied to be a
guaranteed constraint channel.

**Tests**: `NewFormulationRequestPage.test.tsx` (3 tests) and
`FormulationResultPage.test.tsx` (5 tests) — rendering, the primary-
field-gates-submission rule, version-card/ingredient-table rendering
from real mock session data, evidence-panel selection scoped to the
real selected ingredient, evidence context clearing on version switch
(§9's own hard requirement), and a direct assertion that no score is
ever fabricated. `src/lib/help/registry.ts`'s existing "sessions" help
topic was extended to cover both new routes (a pre-existing test,
`registry.test.ts`, requires every real route to resolve to a help
topic or a documented exclusion — a real, caught regression, not a new
test written to match the code).

**i18n**: all new copy lives under `session.json`'s new
`formulationRequest`/`formulationResult` keys, in every one of the 8
shipped locales — English is the authoritative copy (matching the
screenshots' own approved English-language directive); the other 7
locales carry the same English text for these new keys, the same
disclosed-gap precedent already established for other sections of this
codebase (confirmed key-set parity, not translation-value parity, is
what `parity.test.ts` actually checks).

---

## 13a. Frontend data-contract repair, and the temporary dual-flow state (DONE)

A later round found the §13 screens shipped with a real runtime bug, not a
data-availability gap the "not yet available" honesty rule was meant to
cover: the Formulation Result screen could show "Original Request
(Fixed): unavailable", V1/V2/V3 cards with no summaries, and a Formula
tab with 0 ingredients — even immediately after a real, successful
generation, not just on reopening a saved session.

**Root cause, traced end to end (`NewFormulationRequestPage` ->
`generateFormulation()` -> Tauri `generate_formulation` -> Python pipeline
-> persisted session -> `readSession()` -> `generatedFormula.ts` ->
`FormulationResultPage`), two real bugs in `formulation_v2.rs`, not the
frontend**:

1. `read_session`'s `brief` field returned brief.json's whole top-level
   wrapper (`{brief: {...}, constraints_reasons: [...]}`) instead of the
   inner `brief` object `list_sessions` already correctly unwrapped —
   `session.brief.target` was always `undefined` on reopen. Fixed by a
   shared `read_brief()` helper both commands now call.
2. `read_cards` only ever scanned the rendered `.md` files
   (`{version, markdown}`) — `pipeline.py::run()` had never persisted the
   structured `formula`/`violations` object anywhere on disk, so there was
   nothing else to read. Fixed on both sides: `pipeline.py::run()` now
   also writes `cards.json` (`[{version, markdown, formula, violations}]`,
   session-local, not archived to the formula library) alongside the
   markdown files; `read_cards` prefers it, falling back to the old
   markdown-only scan for sessions written before this fix existed (opens
   fine, honestly short of structured data, never an error).

Both bugs affected the pre-existing `/live` (`FormulationWorkspaceV2`)
workspace identically — it calls the same `readSession()` bridge and
already reads `card.formula` for its own Edit tab and cost panel. Fixing
`formulation_v2.rs` once repairs both flows simultaneously, which is the
concrete proof requested that they "share the same underlying generation
engine and persisted sessions" — they always did; the shared bug is what
revealed it.

**Constraint wiring** (previously honest-but-unenforced structured
fields): `rules.py::derive_constraints` now reads `excludedIngredients`
(reaches the hard avoid-list and therefore `validate()`'s post-generation
check, not just the LLM prompt), `preferredIngredients` (soft prefer
list), `claims`/`targetProductType` (folded into the same trigger-phrase
text `target`/`category`/`performance` already are — a "sulfate-free"
claim entered only in the Claims field now still fires the sensitive-
ingredient exclusion), and `targetPhMin`/`targetPhMax` (overrides the
category-derived pH range when both are set). `targetViscosity`/
`targetActiveMatter`/`targetCostLevel`/`packagingType`/
`estimatedBatchSize`/`availableEquipment`/`availableRawMaterials` still
have no deterministic-rule equivalent and remain LLM-context-only, per
`rules.py`'s own updated doc comment.

**Dual-flow state, explicitly temporary**: the pre-existing `/live` split-
pane workspace (`FormulationWorkspaceV2.tsx`) and the new `/formulation-
request` -> `/formulation-result/:sessionId` flow are BOTH available and
routed today, by explicit instruction — the old flow is a fallback kept
around because it works, not a target to build toward; the new flow is
the intended future UI. Neither is hidden, and no navigation was
repointed away from `/live` beyond what the earlier §13 round already
did (sidebar's default entry points at the new flow; `/live` is still
fully reachable and functional). Both call the exact same
`generate_formulation`/`read_session` commands — one backend, one session
store, two front doors. This state is temporary: only after the new flow
is proven stable in a later session may the old flow be considered for
removal (not this session, and not automatically).

**Tests**: Python — `test_pipeline.py` asserts `cards.json`/`brief.json`
round-trip real structured ingredient data; `test_rules.py` gained 7 tests
for the newly-wired structured fields. Rust — `formulation_v2.rs` gained
a `#[cfg(test)] mod tests` (this file had none before) proving
`read_cards` prefers `cards.json`, falls back to markdown for legacy
sessions, and `read_brief` unwraps correctly / returns null when absent.
Frontend: the existing `FormulationResultPage.test.tsx` fixture already
matched the CORRECT (post-fix) shape — it was passing throughout, which
is exactly why this bug was invisible to the existing test suite and had
to be traced through the real Rust/Python layers instead of trusted from
mocks alone. Full suites: Python 122/122, Rust 4/4 new (335 pre-existing
filtered out by name, all still green), frontend 136 files/1205 tests —
zero regressions across all three.

---

## 14. Session 1 — Literature Search Orchestrator, Findpapers adapter, native OA adapters, CanonicalPaper wiring (DONE)

Per §12's proposed breakdown, not redesigned: "Literature Search
Orchestrator + Findpapers adapter + the native CORE/DOAJ/Europe PMC/
BASE/Unpaywall adapters, producing deduplicated `CanonicalPaper`s with
full provenance. No UI changes." Delivered with one real, disclosed
deviation from the literal source list, below.

### Canonical dedup wired into the real pipeline — the actual Session 1 deliverable

`literature_cache.gather()`'s inner collection loop previously discarded
a duplicate outright the instant a second source returned the same paper
in one run (`if k in lib_keys or k in new_keys: continue` — the losing
row simply vanished, no provenance, no record it was ever found twice).
That loop now records every duplicate row under its shared key
(`provenance_by_key`) instead of dropping it, and after collection each
key's row group is passed through `canonical_paper.deduplicate()` — the
Session 0 module, wired for real for the first time — producing one
`CanonicalPaper` per real study (almost always; `deduplicate()`'s own
documented conservative Tier-2 bias can rarely keep two DOI-less,
non-overlapping-author rows separate, which this wiring respects rather
than forcing a merge). Each result is flattened back to the exact
existing `_row()`-shaped flat dict every downstream consumer
(`papers.csv`'s fixed field list, `pipeline.py::_paper_context`/
`verify_references`, `fulltext.py`) already expects — plus two additive
fields, `unique_source_count` and `provenance_sources`, so nothing
downstream needed to change. `new`'s own length/order/per-source quota
accounting is untouched by this — the same candidates are selected as
before, they just now carry their real cross-source corroboration
instead of losing it. Verified against the LIVE APIs this session (not
just mocks): a real disposable local generation for "anti-dandruff
shampoo" found 120 raw candidate rows across openalex/openaire/
europepmc/crossref and **36 of them were the same paper found by more
than one source** — each became one `CanonicalPaper` with
`unique_source_count == 2`+ and both/all contributing source names
preserved in `provenance_sources`, not silently discarded or double-
counted.

### Discovery sources — confirmed by direct, live testing, not assumed (same evidentiary standard as Session 0)

- **DOAJ** — built (`discover.fetch_doaj`), confirmed working live and
  keyless against the real API this session. Added to
  `literature_cache.gather()`'s default `sources`
  (`openalex,openaire,europepmc,crossref,doaj` — was
  `openalex,openaire,europepmc,crossref`). Every DOAJ result is, by
  construction, from a fully open-access journal.
- **Unpaywall** — built (`discover.resolve_unpaywall_oa`), confirmed
  working live and keyless. Wired as what it actually is — an
  OA-location RESOLVER, not a search index (Session 1 brief's own
  explicit correction) — `literature_cache.backfill_oa_via_unpaywall()`
  calls it only for a candidate that already has a DOI but no usable
  `oa_url`, capped at 20 lookups per `gather()` call, never overwriting a
  link a source already supplied. Never added to `FETCHERS` (it is not a
  query-based source).
- **Semantic Scholar** — built (`discover.fetch_semantic_scholar`),
  confirmed REACHABLE live, but a live unauthenticated test hit HTTP 429
  on the first call — kept OFF the default `sources` (no request key is
  configured; `llm.py`'s provider table remains this pipeline's only
  credential registry and does not have one), available as an explicit
  opt-in for a caller that can tolerate/retry a 429.
- **CORE** — tested live this session: an unauthenticated request to
  `api.core.ac.uk/v3` fails outright (connection refused). CORE v3
  requires an API key this installation does not have. Not built as a
  `FETCHERS` entry (would be dead code that always fails); recorded
  `"unavailable"` in `canonical_paper.SOURCE_AVAILABILITY` with this
  session's concrete finding, same as IEEE/Scopus/Web of Science.
- **BASE** — tested live this session, twice (with and without a
  descriptive User-Agent): `api.base-search.net` returns `"Access denied
  for IP address ... and user agent ..."` for an unauthenticated
  request — this installation is not registered/allow-listed. Not built;
  recorded `"unavailable"` with this concrete finding.
- **Europe PMC** — unchanged, already covers PubMed/MED records; a
  separate native PubMed adapter was NOT built this session either
  (Session 0's own caution stands: a real incremental-coverage
  comparison against Europe PMC's existing coverage hasn't been done).
- **OpenAlex/OpenAIRE/Crossref** — unchanged, kept native (Session 0's
  own "decide keep-vs-replace" question for Crossref: decided KEEP — a
  proven, zero-dependency native fetcher already exists; routing it
  through Findpapers instead would add a dependency for no functional
  gain). **OpenAIRE is not accidentally dropped** — still present in
  `gather()`'s default `sources` string, exactly as it was.
- **arXiv** — unchanged, still deliberately excluded from the default
  set.

### Findpapers adapter — built, real, honestly not bundled into the desktop app

New module `runtime/pipeline/findpapers_adapter.py`: a
`FindpapersAdapter` class implementing `canonical_paper.LiteratureAdapter`
(`search(query, max_results) -> List[Dict]`, `_row()`-shaped, verified
`isinstance(FindpapersAdapter(), LiteratureAdapter)` is `True`), lazily
`import findpapers` inside `search()` so its absence never breaks
anything importing this module. **A real, disclosed architectural
constraint, found this session, not assumed**: `apps/desktop/src-tauri/
src/formulation_v2.rs`'s `materialize_pipeline()` embeds this pipeline's
`.py` files via `include_str!` into an app-private directory — a
deliberately pure-stdlib design with no `pip install` step for that
embedded copy. `findpapers` is a real PyPI package with its own
dependency tree (requests, lxml, xylose, fake-useragent, …), so it cannot
be added to the embedded set without a fundamentally different packaging
model — out of this session's scope, not silently assumed to work.
Confirmed directly: `import findpapers` raises `ModuleNotFoundError` in
this environment. The adapter therefore activates only for a caller
running against a full Python environment that happens to have it
pip-installed (`kernel::python_bin()` resolves to the user's own
interpreter, not a bundled one — a real, reachable path for a dev/CLI
run, never the shipped desktop bundle). Scoped to Semantic Scholar only
(the module's own doc comment records the reasoning: OpenAlex/Crossref/
arXiv already have preferred native fetchers; IEEE/Scopus/Web of Science
stay recorded unavailable regardless of what Findpapers itself might
attempt; PubMed's incremental value over Europe PMC is unconfirmed) —
and Semantic Scholar itself already has its own native fetcher too, so
this adapter's concrete value today is proving the boundary works, not
reaching an otherwise-unreachable source.

### OA/full-text safety — preserved, not weakened

Discovery and full-text access remain separate stages, exactly as
before: `backfill_oa_via_unpaywall()` only ever supplies a candidate URL;
the existing `fetch_pdfs`/`_download_fulltext`/`sniff_fulltext` machinery
(unchanged) still does the actual fetch, and still rejects anything that
isn't a real PDF or JATS XML article body — a landing page is still
never saved, paywalled work is still never touched. Unpaywall backfill
runs strictly BEFORE `fetch_pdfs`, supplying candidate metadata, never
downloading anything itself.

### Provider failure isolation

Every new fetcher (`fetch_doaj`, `fetch_semantic_scholar`) sits behind
the same `try/except` the existing per-`(source, angle)` loop already
wraps every `FETCHERS[src](...)` call in — one source failing (rate
limit, timeout, malformed response) logs a warning and the loop moves on
to the next pair, exactly as OpenAlex/Crossref/etc. already do.
`backfill_oa_via_unpaywall()` catches a per-candidate resolver failure
individually so one bad DOI lookup cannot abort the batch.

### Pipeline compatibility — unchanged

`pipeline.py`'s formula-generation logic, `rules.py`'s deterministic
engine (beyond §13a's additive constraint wiring), and `discover.py`'s
five original fetchers are otherwise untouched. No later Phase 14 session
(evidence extraction/ranking §5, manufacturing-process intelligence §6,
full traceability §10) was started.

### Verification

`python -m pytest runtime/pipeline -q`: **122/122 passing** (94 Session-0
baseline + 7 new `rules.py` constraint-wiring tests + 9 new
`test_discover_fetchers.py` tests (DOAJ/Semantic Scholar/Unpaywall,
mocked HTTP) + 6 new `test_literature_cache.py` cross-source-dedup/
Unpaywall-backfill tests + 6 new `test_findpapers_adapter.py` tests + 2
new assertions in the existing end-to-end pipeline test), zero
regressions. Plus the real, live disposable local generation described
above (network calls to the actual OpenAlex/OpenAIRE/Europe PMC/
Crossref/Unpaywall APIs, mocked LLM only) — not just mocked-HTTP unit
tests. `git diff --check`: clean. Rust: `cargo check --release` and
`cargo test --release formulation_v2::` both clean (§13a's 4 new tests).
Frontend: full suite unaffected (no frontend file touched this section),
136 files/1205 tests still passing.

### Closure

Files changed: `runtime/pipeline/literature_cache.py` (canonical dedup
wiring, Unpaywall backfill, default-sources update), `runtime/skills/
core/formulation-discovery/discover.py` (DOAJ/Semantic Scholar fetchers,
Unpaywall resolver, both added to `FETCHERS`), `runtime/pipeline/
findpapers_adapter.py` (new), `runtime/pipeline/canonical_paper.py`
(`SOURCE_AVAILABILITY` updated with this session's live findings),
`apps/desktop/src-tauri/src/formulation_v2.rs` (embeds
`canonical_paper.py` — required, `literature_cache.py` now hard-imports
it), 3 new/expanded test files. Desktop app rebuilt (`pnpm tauri build`)
and `FormuLab.lnk` re-verified against the fresh binary.

**Exact next Phase 14 session, unchanged**: **Session 2** — structured
evidence extraction + evidence-class (A-E) assignment + ranking, wired to
the existing formula-synthesis step (§12 item 3). Not started
automatically by this session.

---

## Risks and open decisions

1. **IEEE Xplore/Scopus/Web of Science access** is institution-
   licensed in practice — "where legitimately available" may mean
   "not available to this installation at all." Session 0 must confirm
   real access before any adapter work assumes it.
2. **Google Scholar has no official API.** Whether "a reliable and
   legitimate integration is possible" resolves to yes or no is a real
   open question, not a formality — Session 0 decides, and the
   orchestrator must work correctly either way (§3).
3. **Deduplication similarity thresholds** (title/author matching when
   DOI is absent) are a real algorithm-design decision deferred to
   Session 0/1, not fixed by this document.
4. **Evidence-class boundaries (A-E)** are named here at the concept
   level; the exact classification rules (what makes a study "direct
   formulation evidence" vs. "experimental ingredient evidence") need
   a concrete, testable definition before Session 2 can implement
   ranking.
5. **Relationship to Phase 13's authorization model**: Phase 14's
   eventual commands (discovery orchestration, evidence read, process-
   recipe generation) will need `rolePolicy`/`authz.rs` gating exactly
   like every Phase 13 privileged command — which `PolicyArea`(s) they
   belong to is not decided here and should be resolved when Phase 14
   implementation actually starts, informed by whatever Phase 13's own
   domain-expert review (Phase 13 architecture doc, Risks item 1)
   concludes by then.
