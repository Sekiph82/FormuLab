# Phase 14 — Evidence-Driven Hybrid Literature & Formulation Intelligence

## Status: ZERO-LLM DETERMINISTIC FORMULATION ENGINE COMPLETE, Phase 14 Session 5 (Manufacturing Procedure/Critical Parameters/Equipment intelligence, zero LLM) COMPLETE — §18/§19. FormuLab's formulation-generation path no longer calls any LLM, local or remote: every ingredient, concentration, formula, and manufacturing step is built from real evidence, real supplier data, and real deterministic engineering rules (`runtime/pipeline/engine.py`, `runtime/pipeline/manufacturing.py`). `llm.py` remains in the repository as legacy/unrelated compatibility code only — nothing in the normal generation path imports or reaches it (proven by a permanent regression test that patches `llm.call` to raise and runs a full real generation to completion). Session 4 (§17): ingredient evidence intelligence, real generation provenance, honest 15-source research-corpus guarantee, formula-provenance audit, rich evidence UI. Session 3 (§16): evidence-grounded, request-aware multi-alternative formulation synthesis. Session 2 (§15): structured evidence extraction, A-E classification, explainable ranking. Session 1 (§14): Literature Search Orchestrator, Findpapers adapter, native OA adapters, CanonicalPaper cross-source dedup. Session 0 (§11a): pipeline audit, CanonicalPaper schema, adapter boundary, source-availability decision. The New Formulation Request/Formulation Result screens (§13) had a real data-contract bug — fixed, §13a. Both the new screens and the pre-existing `/live` workspace remain available and now converge on the SAME deterministic backend; see §13a for the disclosed dual-flow state and §18 for the convergence.

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
3. ~~**Session 2** — structured evidence extraction + evidence-class
   (A-E) assignment + ranking, wired to the existing formula-synthesis
   step. Still produces one formula (current behavior), now with the
   new evidence model underneath it — a deliberate intermediate step
   before building the 3-alternative UI.~~ **DONE** — see §15. Concentration
   statistics (median/observed range) deliberately not computed, per this
   item's own conditional scope (comparability grouping not built yet).
4. ~~**Session 3** — multi-alternative (V1/V2/V3+) formulation synthesis
   + the new "Yeni Formülasyon Talebi" query screen. **The screen
   itself was built out of sequence, in Session 0, at the user's
   explicit direct instruction — see §13.** What remains genuinely
   Session 3's own work: true multi-alternative synthesis grounded in
   the (not-yet-built) evidence model, not the current pipeline's
   already-existing `n`-candidates-in-one-call generation.~~ **DONE** —
   see §16: request-aware strategy derivation, per-version evidence
   linking, cross-version diversity validation, per-version hard-
   constraint validation with partial-failure handling, and an
   explainable version score, all grounded in Session 2's evidence
   model.
5. **Session 4** — the new result screen: version cards, the 9-tab
   layout, version-scoped evidence context (§9). **The screen itself
   was built out of sequence, in Session 0, at the user's explicit
   direct instruction — see §13.** Partially addressed ahead of
   schedule: Session 3 (§16) wired real strategy titles/scores into the
   version cards and the MINIMUM real evidence-class/DOI/outcome wiring
   into the Formula tab and the Ingredient Evidence panel (real, not
   yet the full statistics build-out); Session 4 itself (§17) built the
   full rich-evidence statistics/origin/mass-balance/quality-gate wiring.
   What remained genuinely open: process intelligence and safety/
   regulatory tab wiring, which depended on Sessions 5/6 not yet built.
6. ~~**Session 5** — manufacturing process intelligence (İşlem Reçetesi/
   Kritik Parametreler/Ekipman, §6).~~ **DONE** — see §19, built zero-LLM
   on top of §18's deterministic engine (a cross-cutting architecture
   change the user directed ahead of this session, at the user's own
   explicit instruction — see §18).
7. **Session 6** — full traceability persistence (§10) across every
   stage above, plus a closure/regression pass, including the Safety/
   Regulatory tabs' own remaining "not yet evaluated" placeholders.

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

## 15. Session 2 — structured evidence extraction, A-E classification, ranking, formula-synthesis integration (DONE)

Per §12 item 3: "structured evidence extraction + evidence-class (A-E)
assignment + ranking, wired to the existing formula-synthesis step. Still
produces one formula per version (current behavior), now with the new
evidence model underneath it." Paper discovery alone is not evidence — a
paper only becomes evidence once real content was extracted from it that
supports a specific formulation decision.

### Deterministic, rule-based extraction — not a second LLM call

New module `runtime/pipeline/evidence.py`. "Build a deterministic/
traceable evidence layer" is this session's own brief, and a model-based
extractor would satisfy neither word — it would also carry its own
fabrication risk, the exact failure mode this whole phase exists to guard
against. Every field is either read verbatim from the source text (a regex
match with a real character position, a section title) or left
`None`/unknown; nothing is inferred.

**`KNOWN_INGREDIENTS`**: a real but intentionally not-exhaustive vocabulary
(60 entries), seeded from `rules.py`'s own `SULFATES`/`HARSH_PRESERVATIVES`/
`MILD_SURFACTANTS`/`CHELATORS`/`FRAGRANCE` groups plus a modest list of
common anti-dandruff actives and functional cosmetic ingredients. A mention
of an ingredient outside this list produces no evidence record for it —
silence, the honest outcome, never a wrong or invented one. Growing this
list is real, disclosed future work.

**`detect_ingredient_mentions`**: longest-surface-form-first, word-boundary
matched, so "sodium laureth sulfate" is never shadowed by a shorter partial
match. Two chemically distinct sulfates (SLS vs. SLES) normalize to two
different keys and are never merged (`normalize_ingredient_key` — a
conservative, deterministic key comparison, no fuzzy matching).

**Concentration attribution — a real bug found and fixed by testing this
session's own extractor against a realistic sentence.** The obvious
approach (nearest concentration number by raw character distance) gets a
paper that reads "X at 5.0%, Y at 8.0%, Z at 1.0%" systematically wrong:
once mid-name character counts are folded in, a symmetric-distance search
attaches each ingredient's own reported number to its NEIGHBOR instead.
Fixed with a directional, span-aware rule: prefer a number immediately
AFTER the mention (the dominant "ingredient at X%" phrasing), reject it if
another mention's start falls between this one's end and that number
(the number belongs to the closer, later ingredient); fall back to
BEFORE with the same no-intervening-mention guard, plus a second guard
against a trailing clause re-claiming a number that was already
immediately after a different mention. Verified directly: `Cocamidopropyl
Betaine at 5.0 wt%, Decyl Glucoside at 8.0%, ... Piroctone Olamine at
1.0%, along with Glycerin and Citric Acid ...` now attributes exactly the
right number to each of the three actives and correctly leaves Glycerin
and Citric Acid with `None` (no number is ever reported for either) —
this exact sentence is now a regression test
(`test_evidence.py::ConcentrationExtractionTests`).

**Full-text-first, honest fallback**: `gather_evidence` determines
`source_depth` per paper — `fulltext.excerpt_for` (already-downloaded PDF/
XML/Markdown) when available, else the paper's own `abstract` field
(`abstract_only`), else `metadata_only`. `classify_evidence` floors
`metadata_only` at Class E unconditionally and requires `full_text` (never
`abstract_only`) for Class A — an abstract cannot carry enough detail to
earn the strongest tier, matching this session's own §4 brief exactly.

### Evidence classes A-E — content-based, never provider-based

`classify_evidence` reads only `source_depth`/`is_full_formulation`/
`is_review`/`has_concentration`/`has_outcome`/`domain_match` — it never
reads which source(s) found the paper. A paper is never Class A merely for
containing an ingredient name (a dedicated regression test asserts this
directly): A requires real full text, a genuine complete-formulation
paper (>= 3 recognized ingredients + a formulation-shape term like "wt%"),
an actual extracted concentration, AND a reported outcome. Verified
end-to-end against a LIVE paper this session (see Verification below): a
real post-surgical-scab-removal shampoo study's own methods/results text
produced a real Class-A-eligible record with `salicylic acid, concentration
2.0%` and the paper's own verbatim outcome sentence.

**Domain-match (Class D) uses an explicit signal list, not keyword overlap
against the request.** A first version compared the paper's own text
against the request's wording (e.g. "anti-dandruff shampoo") and wrongly
demoted a real antifungal-efficacy study (which discusses "Malassezia," the
organism actually implicated in dandruff, but never literally says
"shampoo") to Class D. Fixed: `_domain_matches` defaults to relevant
UNLESS the text carries an explicit OTHER-domain signal (paint, coating,
industrial, textile, agricultural, …) with no personal-care/cosmetic
counter-signal (skin, scalp, hair, dermal, cosmetic, …) — Class D is for a
real, positively-identified mismatch (verified with a genuine "industrial
paint coatings" example), never a fallback for "didn't use my exact
category word."

### Deduplication rule — one CanonicalPaper, one study, however many records

`study_count()` counts unique papers by DOI (or normalized title when no
DOI exists), never by provider or by record count. A paper found by 5
providers still counts as 1 study; a paper genuinely reporting 2 distinct
findings (2 different actives) produces 2 `EvidenceRecord`s that both
still count as 1 study. Both are direct regression tests. A related, real
display bug found while testing this against LIVE data: `literature_cache`
(Session 1)'s own `provenance_sources` can legitimately repeat one
provider's name (the same source found via multiple query angles) —
harmless for `unique_source_count` (a `set()`-based count, already
correct) but confusing to DISPLAY as `["europepmc", "europepmc",
"europepmc"]`. Fixed at the evidence layer (deduped, order-preserved, when
building each `EvidenceRecord`) rather than touching Session 1's already-
tested `literature_cache.py`.

### Ranking — every factor named, provider count structurally excluded

`EvidenceScore` (`class_weight`, `full_text_bonus`, `experimental_data_
bonus`, `domain_comparability`, `consistency_bonus`, `total`) — no single
opaque number; `score.total` is always exactly the sum of the other
fields (a direct regression test asserts this). `unique_source_count` is
not a field on `EvidenceScore` at all — structurally, not just by
convention, it cannot be read for scoring. A dedicated test builds two
otherwise-identical records differing ONLY in `unique_source_count` (1 vs.
5) and asserts their scores are exactly equal.

### Formula-synthesis integration — augmented, not rewritten

`pipeline.py::run()` calls `evidence.gather_evidence()` on the SAME
already-deduplicated `papers` list `literature_cache.gather()` returns —
never a second discovery pass — ranks the result, and builds a `FACT FROM
EVIDENCE` / `FORMULAB INFERENCE` / `MISSING` block
(`evidence.build_evidence_context_block`) inserted into the existing
`user` message ahead of the raw literature dump. `_system_prompt` gained
one new paragraph instructing the model to treat that block as
authoritative for anything it cites, and to mark an uncovered decision as
"Laboratory validation required" in the card's own warnings rather than
inventing a value — the exact three-way distinction §11 requires, made
explicit in both the system prompt and the block's own structure rather
than left for the model to infer. `render_card`/`archive_formulas`/the
`cards` list's own shape (`{version, markdown, formula, violations}`) are
completely untouched — Rust's `read_session`/`read_cards` (Session 1's own
fix) and both frontend UIs need no change and received none this session.

### Traceability and persistence

Every `EvidenceRecord` carries `paper_doi`/`paper_title`/`paper_year`/
`paper_authors`/`paper_venue`/`unique_source_count`/`provenance_sources`/
`evidence_class`/`evidence_text`/`source_location` — everything §12
requires for a future Ingredient Evidence panel to query, not built this
session (§12's own scope note: "Do not build that final rich UI wiring
unless Session 2 handoff explicitly includes it" — it does not).
`formula_version_id` exists on every record and is always `None` at
extraction time — the field is there so a later session can attach real
version-specific evidence without a schema migration (§13's own
requirement), not a decision engine built now.

Two persistence layers, mirroring `literature_cache.py`'s own established
convention: a shared LIBRARY-level cache (`evidence_cache.json`, keyed by
paper key) so a paper already extracted in a previous session is never
re-extracted; a session-local copy (`<session>/literature/evidence.json`)
alongside the existing `papers.json`/`papers.csv`.

### Concentration statistics — deliberately NOT computed this session

Individual `ConcentrationValue` records are preserved with their own
value/range/unit/basis; no median/observed-range/aggregate statistic is
computed across records. This session's own brief is explicit: only after
strict comparability grouping (same ingredient, same basis, same product
context) exists does aggregating become safe, and that grouping work is
not built here. A future session's job, not silently skipped — recorded
as a real gap below.

### Existing safety/regulatory rules — unchanged, still authoritative

Nothing in this session touches `rules.py::derive_constraints`/`validate`'s
deterministic hard-avoid-list or the `violations` list already shown on
the Safety tab. Literature evidence feeds the prompt's rationale/context
only; it cannot override a hard constraint — the deterministic engine runs
exactly as it did before this session, on the model's OUTPUT, independent
of anything in the evidence block.

### Verification

`python -m pytest runtime/pipeline -q`: **151/151 passing** (122 baseline
+ 27 new `test_evidence.py` tests covering every item in this session's own
brief — full-text/abstract-only/metadata-only extraction depth, concentration
attribution and the range/missing cases, all five evidence classes with a
dedicated example each, the "never Class A merely for a name" guard, one-
CanonicalPaper-one-study dedup (single paper via 5 providers, and 2
findings from 1 paper), the provenance-sources dedup fix, ranking preferring
real experimental evidence, provider count NOT multiplying score (both a
behavioral test and a structural test that the field doesn't exist on
`EvidenceScore`), ingredient-normalization non-merging, evidence-gap
messaging, and cache round-tripping — plus 2 new `test_pipeline.py`
integration tests proving the synthesis prompt actually receives the
`FACT FROM EVIDENCE`/`FORMULAB INFERENCE` block and that ordinary
generation still works with the evidence layer active). Zero regressions.

**Real, live verification, not just mocked unit tests**: a disposable local
generation (mocked LLM only; real network calls to OpenAlex/OpenAIRE/
Europe PMC/Crossref) for "anti-dandruff shampoo" produced 9 real evidence
records from 2 unique studies, including a genuine Class-A-eligible record
— `salicylic acid, concentration 2.0%` — extracted from a real 2026 paper
on post-surgical scab removal with a shampoo containing 2% salicylic acid,
with the paper's own verbatim outcome sentence attached and its real DOI.
Test data (session + library directories under this session's own scratch
temp directory) deleted immediately after inspection; no real
`.FormuLab/runs.db` or business data touched.

`apps/desktop/src-tauri/src/formulation_v2.rs` now also embeds
`evidence.py` — `pipeline.py` hard-imports it as of this session, so it
must be materialized alongside `canonical_paper.py` or the embedded
desktop app would fail with `ImportError` on every real run (the exact
class of bug Session 1 already hit once with `canonical_paper.py`, caught
here before it shipped by re-running the same embedded-layout-simulation
check). `cargo check --release`: clean. `pnpm tauri build`: succeeded;
`FormuLab.lnk` re-verified against the fresh binary. No frontend file
touched this session — both formulation UIs are unaffected structurally
(the `cards` list's own shape is unchanged) and were not re-tested beyond
confirming no frontend file appears in this session's diff.

### Known gaps, explicitly deferred

- Concentration/observed-range/median statistics across multiple records
  (deliberately deferred — see above).
- Per-ingredient evidence UI wiring (the right-side Ingredient Evidence
  panel querying this data) — not built, per §12's own scope note.
- Formula-version-specific evidence (`formulaVersionId` attachment) — the
  data model supports it (`formula_version_id` field, always `None`
  today); the decision engine that would populate it is not built.
- `KNOWN_INGREDIENTS` vocabulary coverage — real, disclosed, not
  exhaustive; growing it is future work.
- Manufacturing-process synthesis from the structured `ProcessObservation`
  data extracted this session — Session 5's own scope, not started.
- Safety/regulatory evidence-class integration into the Safety/Regulatory
  tabs — still shows only the deterministic `violations` list; evidence-
  backed rationale for those tabs is later work.

**Exact next Phase 14 session**: **Session 3** — multi-alternative
(V1/V2/V3+) formulation synthesis grounded in this evidence model, per
§12 item 4 (the request/result screens themselves were already built out
of sequence in an earlier round — what remains is true evidence-grounded
multi-alternative synthesis, not the current pipeline's existing
`n`-candidates-in-one-call generation). Not started automatically by this
session.

---

## 16. Session 3 — evidence-grounded multi-alternative formulation synthesis (DONE)

Per §12 item 4, with the explicit correction the session's own brief made
to it: the request/result screens (§13) were already built out of
sequence; what remained genuinely Session 3's own work is TRUE
multi-alternative synthesis — turning `n` candidate slots into distinct,
explainable, evidence-grounded strategies, not merely "ask the LLM for
three variants" (the exact failure mode this session exists to fix — the
prior single instruction line, "make them different," gave the model no
real structure to differ against).

### Architecture decision: one model call, strategy-explicit prompt — not `n` isolated calls

Documented in full in `strategy.py`'s own module docstring (the
authoritative record — not duplicated here in full). Summary: kept
`pipeline.py::run()`'s existing single-request/response call rather than
switching to one call per version. Reasons: (1) preserves this pipeline's
own stated design principle ("No sidecar, no SSE, no tool loop: a single
request/response") and its existing cost/latency profile — `n` isolated
calls would multiply LLM cost/latency by `n`; (2) preserves backward
compatibility with the existing `llm_call` single-call contract and every
test built on it (confirmed: all 151 pre-existing tests still pass
unmodified); (3) a post-generation diversity validator (§9 below) is
required regardless of call architecture — even isolated calls can
converge on similar chemistry when the evidence only supports one
defensible family — so the real safety net is identical either way,
making `n`x the cost not worth it. Strategy metadata is always Python's
own `derive_strategies()` output, matched to a generated formula BY
INDEX — never trusted from or invented by the model.

### Strategy model — request-aware, never a fixed V1/V2/V3 enum

New module `runtime/pipeline/strategy.py`. `derive_strategies(brief,
constraints, n)` — deterministic: the same brief always yields the same
strategy set, a DIFFERENT brief genuinely yields a different one.
"Balanced / Recommended" is always first; the library also has
Sensitive Skin/Mildness Focused, Cost Optimized, Premium Sensory,
Natural-Origin Focused, Regulatory Conservative, Simplified
Manufacturing, Low Raw-Material Count, and Maximum Performance — each
with its own `applies(brief, constraints) -> rationale | None` check
reading a REAL signal in the brief (e.g. `constraints["sensitive"]` for
Sensitive Skin, `targetCostLevel == "premium"` for Premium Sensory,
`availableEquipment` lacking high-shear terms for Simplified
Manufacturing). Cost Optimized and Maximum Performance are deliberately
near-universal fallbacks, placed LAST in priority order, so a genuine
request-specific signal always wins a slot first when one exists — this
is what keeps most requests at a real, distinct 3-strategy set without
ever inventing a strategy with no real triggering signal (§4's own
explicit instruction: say so, don't invent, when fewer than `n`
genuinely apply — proven directly: a request with no extra signal at all
still returns fewer than `n` when the library's near-universal fallbacks
would otherwise duplicate a type already chosen).

Every strategy's `tradeoffs_forbidden` always includes the same three
universal entries (any excluded ingredient, any deterministic safety/
regulatory rule, any required function) — no strategy may ever be
generated with permission to override a hard constraint (§19's
requirement, encoded directly into the data model, not just prose).

### Prompt structure (§8)

`strategy.build_strategy_prompt_section()` builds a numbered VERSION
STRATEGIES block — index-matched to `formulas[0..n-1]` — listing each
strategy's title, rationale, priorities, acceptable tradeoffs, and
forbidden tradeoffs, appended to the existing `_system_prompt()` (which
already carries the hard rules and, since Session 2, the FACT FROM
EVIDENCE framing). The existing `_paper_context()`/evidence-block
machinery is completely unchanged — this is a strict addition, not a
rewrite.

### Diversity validation (§9) — explainable, not embedding-based

`strategy.diversity_report()` compares every pair of successfully-
generated versions on three named, inspectable factors: ingredient-set
Jaccard overlap, concentration-vector similarity (only over ingredients
BOTH versions report a single parseable %, never a fabricated value for
the rest), and primary-surfactant match. A pair is flagged only when
BOTH ingredient overlap AND concentration similarity clear a high
threshold (0.85 / 0.9) — deliberately conjunctive, so two versions
sharing the same defensible surfactant system (evidence may genuinely
constrain that) but differing meaningfully in concentration/composition
are correctly NOT flagged (§4's own explicit exception, proven by a
dedicated test). When insufficiently diverse, every successfully-
generated card gets an explicit warning quoting the report's own
explanation — marked, not silently regenerated (no repair/retry
architecture exists in this pipeline to regenerate against; building one
is real, disclosed future work, not attempted this session).

### Per-version hard-constraint validation and partial-failure handling (§10/§16)

Unchanged mechanism (`validate(ingredients, constraints)`), now run
independently per strategy SLOT rather than per item in a trusted-
complete list: for each of the `n` derived strategies, if the model's
JSON response has no entry at that index, or the entry has no
`ingredients`, that card is marked `status: "generation_failed"` with a
real, specific reason (`"the model did not return a formula for this
strategy slot"` vs. `"the returned formula had no ingredients"`) and
carries NO `formula`/`markdown` — never a fabricated placeholder. Every
OTHER slot that DID generate successfully is still returned, still fully
validated, still fully scored — a valid V1 does not make V2/V3 valid,
and one failure does not invalidate its valid siblings, proven directly
by a dedicated test (2 of 3 slots failing for different reasons, the 3rd
still returns a complete, real card). `run()`'s overall `status` stays
`"ok"` for a partial success — only a total model-call failure (the
pre-existing `except Exception` path, unchanged) returns `"error"`.

### Version-specific evidence linking (§7) and concentration alignment (§6)

`strategy.link_evidence_to_version(version_id, formula, ranked_evidence)`
— filters Session 2's already-ranked evidence to exactly the ingredients
THIS version's own generated formula actually uses, stamping
`formula_version_id` on each linked copy. The SAME ingredient across two
different versions can carry DIFFERENT linked evidence (proven directly:
two versions choosing different concentrations of the same active pull
in different supporting records) — nothing assumes one evidence context
applies uniformly across versions. `strategy.concentration_alignment()`
labels each ingredient `"evidence_supported"` (a linked record reports a
concentration within 30% relative of the model's chosen value — a
deliberately loose ALIGNMENT check, not an exact-match verification),
`"evidence_context_only"` (evidence exists for the ingredient but not a
comparable concentration), or `"formulab_inference"` (no linked evidence
at all) — never a DOI attached to an inferred value (a dedicated test
asserts the return type is a plain status string, never a citation).
**No median/observed-range statistic is computed anywhere in this
session** — §6's own conditional scope note stands: only safe after
strict comparability grouping, not built.

### Explainable version score (§12)

`strategy.compute_version_score()` — `VersionScore` with four named
factors (`hard_constraint_compliance`, `evidence_strength`,
`formulation_completeness`, `evidence_gap_penalty`) and a `total` that is
always exactly their weighted sum (asserted directly). `unique_source_
count`/provider count is not a field anywhere this scorer reads — proven
both behaviorally (two records identical except for provider count score
identically) and structurally (the field doesn't exist on the dataclass
the scorer's own input shape expects). Returns `None` ("not yet
available") when a formula has no ingredients at all — never a forced
number merely because the UI has a slot for one. Kept entirely separate
from `violations`/deterministic safety-regulatory PASS-FAIL (§19) — a
dedicated test asserts `VersionScore` has no `safety_status`/
`regulatory_status` field to be confused with one.

### Result screen wiring (§14/§15) — minimum real wiring, not the full Session 4 build-out

`FormulationResultPage.tsx`: version cards now show the REAL strategy
title/rationale (`card.strategy.title`/`.rationale`, falling back to the
model's own `name`/`purpose` for a pre-Session-3 session, then the raw
version id — never a fabricated label) and the REAL score
(`Math.round(card.score.total * 100)}%`) when the session has one,
`scoreNotYetAvailable` otherwise. A `generation_failed` card renders a
dedicated failure notice (real `failure_reason`, no attempt to show an
empty ingredient table) and is disabled (not selectable) in the version-
card row; the page now defaults its initial selected version to the
FIRST successfully-generated one, so a session whose v1 failed doesn't
open on a dead tab. The Formula tab's Evidence/Evidence Class columns and
the right-side Ingredient Evidence panel now show REAL linked evidence
(class badge, DOI, outcome sentence) when `card.evidence_links`/
`concentration_alignment` are present, keyed by the exact same
`normalize_ingredient_key()` algorithm mirrored into TypeScript
(`generatedFormula.ts::normalizeIngredientKey()`, character-for-character
identical to the Python original) — falling back to the pre-existing
whole-formula-reference display and honest "insufficient evidence"
wording for a pre-Session-3 session. No observed-range/median/confidence-
count statistic is shown anywhere — not built (§15 above). Neither the
page's overall structure nor its "one selected version at a time,
evidence clears on switch" behavior was redesigned — both pre-existing,
passing tests for that behavior still pass unmodified.

### Backward compatibility and the dual-flow requirement

`cards.json` stays a flat JSON ARRAY at the top level (Rust's
`read_cards` requires this shape) — every new field (`status`,
`strategy`, `evidence_links`, `concentration_alignment`, `score`) is
purely additive on each card object. `formulation_v2.rs` needed ZERO
Rust logic changes for this — `read_cards`/`read_session` are a generic
`serde_json::Value` passthrough, never a fixed struct — proven directly
by a new Rust test loading a pre-Session-3-shaped card (no `strategy`/
`status` keys) through the unchanged `read_cards` function. The
pre-existing `/live` workspace (`FormulationWorkspaceV2.tsx`) needed one
real, small fix: `card.markdown` became optional (a failed slot has
none), so `<AgentMessage markdown={card.markdown} />` needed a `?? ""`
fallback — the one place this session's type change touched the old UI,
fixed, verified, both UIs' full test suites green.

### Verification

`python -m pytest runtime/pipeline -q`: **180/180 passing** — 151
Session-2 baseline + 25 new `test_strategy.py` tests (covering every item
in this session's own testing checklist: request-aware derivation,
different requests producing different strategy sets, near-identical
variants flagged, genuinely different variants passing, same-chemistry-
legitimate-difference NOT flagged, failed versions excluded from
diversity comparison, version-specific evidence linking including the
same ingredient carrying different evidence across two versions,
concentration alignment's three states, evidence-class A outscoring E,
provider count not affecting score both behaviorally and structurally,
score decomposition, score-vs-safety separation) + 4 new
`test_pipeline.py` integration tests (real strategy metadata matched by
index and request-aware type selection, partial generation failure
preserving valid siblings with real reasons, diversity flagging end to
end, version-specific evidence/score persisting to `cards.json`) — zero
regressions. Rust: `cargo check --release` clean; 5/5 unit tests
(1 new, proving pre-Session-3 backward compatibility). Frontend: `pnpm
tsc --noEmit` clean (after the one `/live` fix above), ESLint clean,
`pnpm vitest run` — **136 files / 1210 tests** (1205 baseline + 5 new
Session-3-specific `FormulationResultPage.test.tsx` cases), zero
regressions.

**Real, live verification, not just mocked unit tests**: a disposable
local generation for "a sulfate-free anti-dandruff shampoo for a
sensitive scalp" (excluded ingredients: sulfates; target pH 5.0-5.5;
medium cost) against the real literature/evidence pipeline (mocked LLM
only) correctly derived Balanced/Sensitive Skin/Cost Optimized as its
three strategies (matching the request's own real signals), retrieved
120 real candidates with 39 genuine cross-source duplicates correctly
merged, extracted 8 real evidence records, and produced three formulas
the diversity validator correctly judged genuinely different — with
three DIFFERENT computed scores (0.562/0.603/0.5) reflecting their real
evidence coverage and completeness differences, not an arbitrary number.
Test data deleted immediately after inspection.

`apps/desktop/src-tauri/src/formulation_v2.rs` now also embeds
`strategy.py` (`pipeline.py` hard-imports it) — caught and fixed before
building via the same embedded-layout-simulation check that caught
Sessions 1/2's equivalent gaps. `pnpm tauri build`: succeeded;
`FormuLab.lnk` re-verified against the fresh binary.

### Known gaps, explicitly deferred

- Concentration/observed-range/median statistics — still not computed
  anywhere (Session 2's own deferral, unchanged).
- No repair/retry architecture — a failed generation slot is marked and
  reported, never regenerated. Building a safe, loop-bounded retry
  mechanism is real future work.
- Manufacturing-process synthesis from Session 2's extracted
  `ProcessObservation` data — Session 5's own scope, not started.
- Safety/regulatory tabs still show only the deterministic `violations`
  list, not an evidence-informed rationale.
- The "Open Comparison" detailed multi-version comparison view remains
  not yet implemented (unchanged from before this session).
- Strategy applicability signals are real but not exhaustive (e.g. no
  signal yet for inventory-constrained/production-friendly beyond the
  equipment/batch-size heuristics already built) — growing the library is
  future work, matching Session 2's own "real vocabulary, not exhaustive"
  disclosure precedent.

**Exact next Phase 14 session**: **Session 4** — the right-side Ingredient
Evidence panel's remaining rich wiring (this session did the minimum
real wiring only — evidence class/DOI/outcome; observed-range/median/
confidence statistics remain explicitly deferred) plus the 9-tab result
screen's remaining not-yet-available tabs (Manufacturing Procedure,
Critical Parameters, Equipment, full Safety/Regulatory evidence
integration), per §12's own breakdown. Not started automatically by this
session.

---

## 17. Session 4 — ingredient evidence intelligence, literature corpus guarantee, formula provenance audit, rich evidence UI (DONE)

### §1 audit — who/what actually generates a formula

Traced the real desktop runtime path end to end (not guessed): `NewFormulationRequestPage.tsx`/`FormulationWorkspaceV2.tsx` -> `formulationV2.ts::generateFormulation()` -> Tauri `generate_formulation` (`formulation_v2.rs`) -> `run_cli.py` (stdin/stdout bridge) -> `pipeline.py::run()` -> `llm.py::call()`. **One real code path, no mock/test double anywhere in it** — `run_cli.py` never overrides `pipeline.run()`'s `llm_call` parameter (default: the real `llm.call`); every `mock_llm`/test double in this codebase lives only inside `test_*.py` files. No local model exists other than the optional Ollama provider (no key required, only used if selected AND a local server is actually running — confirmed NOT running in this session's own environment, see Verification below). No automatic fallback between providers exists — a failed call returns `{"status": "error"}`, never a silent substitution. The frontend itself blocks submission when no API key is set for a non-Ollama provider, so there is no "unconfigured provider" code path inside the pipeline to audit — the frontend already prevents reaching it.

**API keys never logged**, checked at every layer: Rust pipes the key to Python over stdin only, never through a log macro; `pipeline.py`'s `log()` calls carry only counts/titles/strategy names; `llm.py::call()` uses the key only in the outbound `Authorization` header; `diagnostics.rs::redact_text()` independently masks any long token-like string before diagnostics export, as a second layer. Verified directly with a real disposable run using a deliberately fake key string — confirmed absent from `cards.json`, `generation_provenance.json`, and every log line.

New module `runtime/pipeline/provenance.py`. `GenerationProvenance` (`engine_type`/`source`/`provider`/`model`/`generated_at`) is built ONLY after `llm_call` returns successfully — `engine_type`/`source` are always `"llm"`/`"real_model_call"` today; `"deterministic_logic"`/`"imported_formula"` are named as reserved values for a generation path that does not exist yet, not invented as if real. Persisted once per session (`generation_provenance.json`) and embedded in every successful card for direct frontend access — never containing `api_key`.

### §2 — ingredient origin/provenance, every ingredient traceable

`provenance.IngredientOrigin` — `scientific_evidence` (linked to Session 2/3's own evidence-linking output), `deterministic_rule` (matches `rules.py::derive_constraints`'s own `prefer` list — the exact mechanism the system prompt's "Prefer where suitable" line already uses), `user_required` (the brief's own `preferredIngredients` field), `ai_formulation_inference` (none of the above — the model's own choice, never mislabeled). `supplier_data`/`internal_formulab_data` are real, named, reserved categories — **never emitted this session**: `pipeline.py::run()` has no live connection to the user's priced materials list (`materials.py`, a separate Tauri command/data directory never passed into `pipeline.run()`) or any supplier technical-data source; classifying an ingredient into either without a real live source behind it would be exactly the fabrication this model exists to prevent. A real precision fix made while testing: `rules.py` folds `preferredIngredients` directly into `constraints["prefer"]` alongside its own auto-derived groups — without excluding a user-preferred ingredient from the deterministic-rule check, it would be double- and misleadingly labeled `DETERMINISTIC_RULE` too, as if an independent rule (not just an echo of the user's own request) had separately selected it. Fixed: `USER_REQUIRED` checked first and excluded from the `DETERMINISTIC_RULE` check.

Persisted per card: `ingredient_origins` (keyed by normalized ingredient key, each value a list — an ingredient can carry more than one real origin).

### §3 — evidence-first context, not black-box synthesis

The existing evidence-aware prompt (Session 2's FACT FROM EVIDENCE / FORMULAB INFERENCE / MISSING block, Session 3's per-strategy briefs) already gives the model the candidate evidence context before synthesis — this session did not rewrite the synthesis engine (explicitly out of scope: "do not remove the LLM synthesis engine"). What changed is what happens to the model's OUTPUT afterward: real, deterministic origin classification, mass-balance validation, comparability-checked statistics, and a quality gate — all computed in Python, all traceable, none trusted from the model's own claims.

### §4/§6 — the 15-unique-source research-corpus fix (a real bug, found and fixed)

**Root cause found**: `literature_cache.gather()`'s corpus selection previously called `fetch_pdfs(candidates, target=target)`, which STOPS once `target` full texts are obtained — a real, relevant, PAYWALLED/BLOCKED candidate was dropped from the corpus entirely rather than kept as a weaker-but-real source, silently shrinking a genuinely-15-relevant-document corpus down to however many happened to be full-text-downloadable. This directly contradicted Session 2's own `source_depth` model (which has a real `abstract_only` tier) — abstract-only candidates that never got a downloadable file never even reached the evidence extractor, because `gather()` had already discarded them.

**Fix**: the research corpus is now `candidates[:target]` — the top `target` genuinely relevant, already-deduplicated candidates — full-text availability is a QUALITY DIMENSION of the corpus (`fulltext`/`pdf_file` annotated per entry via `fetch_pdfs(selected, target=0)`'s side effect, never a filter that shrinks it). Verified against LIVE data (see Verification below): a real run found 15/15 target documents where 14 of the 15 were abstract-only — under the OLD logic, at most 1 of those 15 would have survived into the corpus at all.

`provenance.ResearchCorpusSummary` — `raw_candidate_count`, `qualifying_count`, `target_count` (15), `full_text_count`, `abstract_only_count`, `metadata_only_count`, `evidence_record_count`, `unique_evidence_study_count` — every count named and SEPARATE (§5's own explicit requirement: a 15-document corpus and a 43-record evidence set are never the same number). Persisted session-wide (`literature/research_corpus.json`) and embedded per card. **Known, disclosed gap**: `raw_candidate_count` currently equals `qualifying_count` when the caller doesn't have the wider pre-ranking pool size on hand (`gather()`'s own return contract is `List[Dict]`, the final corpus only — it does not currently expose the size of the wider pool it ranked from); the real wider-pool number is visible in this session's own log line (`"fetched N new papers across M angles"`) but not yet surfaced as a separate persisted field. A real, disclosed limitation, not silently hidden.

### §7 — Evidence & Sources tab shows the REAL corpus

`formulation_v2.rs::read_session` now also returns `literature` — the session's real `literature/papers.json` (`literature_cache.gather()` already writes this for every session; `read_literature()` is a new, small, generic `serde_json::Value` passthrough, same pattern `read_cards`/`read_brief` already use — proven backward-compatible by a dedicated test loading a session with no `papers.json` at all: an empty array, never an error). The Evidence & Sources tab now shows real counters (Research Sources N/15, Unique Studies, Full Text, Abstract Only, Evidence Records, Formula-Linked Studies) and the FULL corpus in a real table (title/authors/year/DOI/full-text status/discovery providers/which version used it) — never presenting a 15-provider-hit count as "15 studies" (§7's own explicit warning).

### §8 — strict comparability grouping, rich statistics

`evidence.compute_comparable_stats()` (new): only ever built from a group sharing the SAME normalized ingredient AND the SAME reported unit+basis (never mixing w/w with active-matter, or pooling an unlabeled basis with a labeled one), with at least 2 records from at least 2 UNIQUE studies — `study_count()`, never provider count. Anything short of this returns `None` ("Insufficient comparable evidence"), never a fabricated range. Verified: a 3rd outlier record in a different unit is correctly excluded from the group; a single-study group correctly returns `None`; a paper found by 5 providers correctly still counts as 1 study toward the confidence tier. `confidence` is a documented, inspectable rule (`low` 2 studies, `medium` 3-4, `high` 5+), never an opaque number.

### §9 — real decision factors

The Ingredient Evidence panel's "FormuLab Decision Factors" section now lists the REAL origins that actually applied to this ingredient (from `ingredient_origins`) — never a generic "not yet computed" placeholder, and never a factor shown merely because it COULD have applied.

### §10 — the q.s./100% mass-balance fix (a real, demonstrable bug)

**Root cause found**: `generatedFormula.ts::parsePercent()`'s regex matched the literal "100" inside the string "q.s. 100" and returned it as a real, additional 100% contribution — summing it with every other explicit ingredient produced exactly the "129.5% w/w accounted for" bug this session's own brief names. Fixed at the source: `parsePercent()` now checks `isQsIngredient()` first and returns `undefined` for any q.s. entry, so `totalWeightPct()` (the client-side fallback) never double-counts it. The AUTHORITATIVE fix is `provenance.compute_mass_balance()` (new, Python, deterministic — never LLM arithmetic): explicit subtotal, q.s. amount (`100 - subtotal`), final total, and a named `status` (`complete`/`incomplete`/`invalid_over_100`/`ambiguous_multiple_qs`/`invalid_negative_qs`/`malformed`) — persisted per card (`mass_balance`) and preferred by the frontend over any client-side recomputation. Verified directly: the exact "20% + 9.5% + q.s. 100" scenario now correctly closes to 100%, never 129.5%; multiple q.s. ingredients are flagged ambiguous rather than guessed; a negative q.s. (explicit ingredients alone already over 100%) is rejected rather than silently accepted.

### §11 — unsupported-ingredient visibility

A new Origin column in the Formula table (`OriginBadge`) shows a compact, always-visible (never tooltip-only) badge per ingredient — Evidence/Supplier/Internal/Rule/User/AI Inference, an ingredient can show more than one. An AI-only ingredient's evidence panel shows the explicit, un-hidden banner: *"AI formulation inference — no direct supporting evidence found. Laboratory validation required."*

### §12 — transparent quality gate

`provenance.assess_quality()` — every factor named in `provenance.QUALITY_GATE_FACTORS` (`critical_active_no_evidence`, `unusual_concentration_no_evidence`, `mass_balance_invalid`, `hard_constraint_violation`, `insufficient_research_corpus`, `low_evidence_coverage`) — no hidden threshold anywhere. Never a hard reject: a formula is not automatically rejected merely because every ingredient lacks journal evidence (this session's own explicit instruction, proven by a dedicated test that `assess_quality` always returns a plain list, never raises/blocks). Findings shown in the Summary tab's new "Quality Notes" section.

### Existing Session 1-3 systems — preserved, verified, not regressed

CanonicalPaper dedup/provenance, hybrid providers, OA/full-text safety, deterministic evidence extraction, A-E classification, evidence ranking, request-aware strategy derivation, per-version hard validation, diversity validation, version-specific evidence linking, explainable version scores, and the dual formulation-UI state are all unchanged in behavior — proven by the full pre-existing test suite passing unmodified alongside every new Session 4 test.

### Verification

`python -m pytest runtime/pipeline -q`: **213/213 passing** (181 Session-3 baseline + 22 new `test_provenance.py` + 6 new `ComparableStatsTests` in `test_evidence.py` + 4 new `test_pipeline.py` integration tests) — zero regressions. Rust: `cargo check --release` clean; `cargo test --release formulation_v2::` — **7/7** (2 new: `read_literature` returns the real corpus / empty array when absent). Frontend: `pnpm tsc --noEmit` clean, ESLint clean, `pnpm vitest run` — **137 files / 1231 tests** (1224 baseline + 14 new `generatedFormula.test.ts` mass-balance-bug-fix tests + 7 new `FormulationResultPage.test.tsx` Session-4 tests), zero regressions.

**Real, live verification, not just mocked unit tests**: a disposable local generation for "a sulfate-free anti-dandruff shampoo for a sensitive scalp" (real network calls to OpenAlex/OpenAIRE/Europe PMC/Crossref/DOAJ, mocked LLM only) achieved **15/15 target research-corpus documents**, with 14 of the 15 genuinely abstract-only (proving the corpus fix — under the old logic, 14 of 15 would have been silently dropped), 28 real evidence records from 7 real unique studies (never inflated by provider count), and correct per-version evidence linking (4 links for V1, 5 for V2, from the SAME 1 unique study each — proving no cross-source/cross-version inflation). Real LLM-provider verification: **no real provider is configured or reachable in this session's own environment** — confirmed directly (no hosted-provider API key present in any environment variable; the optional local Ollama endpoint, `http://127.0.0.1:11434`, returns a connection failure, not a response) — so no actual production LLM call could be performed here. Based on the §1 code trace (not a guess): any formula ever produced by a real user's FormuLab desktop session was generated by the one real code path (`llm.py::call()`) using whichever provider/key that user configured in Settings — never a mock, deterministic stand-in, or fabricated placeholder, since no such path exists anywhere in production code. Test data (session + library directories under this session's own scratch temp directory) deleted immediately after inspection; a deliberately fake API-key string was used in one test to prove it never appears in any persisted output.

`apps/desktop/src-tauri/src/formulation_v2.rs` now also embeds `provenance.py` (`pipeline.py` hard-imports it) — caught before building via the same embedded-layout-simulation check that caught Sessions 1-3's equivalent gaps. `pnpm tauri build`: succeeded; `FormuLab.lnk` re-verified against the fresh binary.

### Known gaps, explicitly deferred (per §16 of this session's own brief)

- Manufacturing Procedure/Critical Parameters/Equipment engineering, final Safety/Regulatory intelligence — still Session 5/6 scope, not started.
- `raw_candidate_count` currently equals `qualifying_count` (see §4/§6 above) — the wider pre-ranking pool size is not yet a separate persisted field.
- `supplier_data`/`internal_formulab_data` ingredient origins remain real, modeled, reserved categories — never emitted until a live masterdata/supplier connection is wired into generation (not this session's scope).
- Comparable-statistics grouping is unit+basis strict but does not yet attempt cross-basis conversion (e.g. computing an equivalent active-matter % from a w/w value) — a real, harder normalization problem left for later work rather than guessed at.

**Exact next Phase 14 session (at the time)**: **Session 5** — manufacturing process intelligence (İşlem Reçetesi/Kritik Parametreler/Ekipman, architecture doc §6), per §12's own breakdown. Not started automatically by this session. **Completed below (§19)** — alongside a cross-cutting architecture change (§18) that replaced this whole pipeline's generation engine before Session 5 was built on top of it, at the user's own explicit instruction.

---

## 18. Phase 15 — Zero-LLM Deterministic Formulation Engine (DONE)

The user gave an explicit, non-negotiable architecture instruction: **FormuLab must contain no LLM in the formulation workflow** — not optional, not minimized, not a fallback. Every ingredient, concentration, and formula decision must come from real evidence, real data, or a real deterministic rule, with the outcome allowed to be an honestly incomplete formula rather than a fabricated complete one.

### §1 — LLM removed from the production formulation path

Audited the real path before changing anything: `pipeline.py::run()` made exactly one call to `llm.py::call()` per session (Session 3's own architecture decision, §16). That call is now gone. `pipeline.py` no longer imports `llm` at all — checked structurally (`hasattr(pipeline, "llm")` is `False`) and behaviorally (a permanent regression test, `test_pipeline.py::
test_llm_call_is_never_reached_by_the_deterministic_path`, patches `llm.call` to raise `AssertionError("LLM MUST NOT BE CALLED")`, runs a full real deterministic generation end to end, and asserts it still succeeds — proving the call is genuinely unreachable, not merely unused-by-convention). `apps/desktop/src-tauri/src/formulation_v2.rs`'s `materialize_pipeline()` no longer embeds `llm.py` into the shipped desktop app at all — the normal generation path this app ships carries no reachable model-call code, not merely an unused one. `llm.py` itself is untouched and remains in the repository — every session generated before this round was genuinely produced by it, and this codebase never rewrites history (see `provenance.py`'s own module docstring) — it is legacy/unrelated compatibility code only.

`pipeline.run()`'s signature dropped `provider`/`model`/`api_key`/`llm_call` entirely — a structural, not just behavioral, guarantee (`test_pipeline.py::test_run_signature_has_no_provider_model_api_key_or_llm_call`). `run_cli.py` no longer requires `provider`/`model` in its request payload (reads and ignores them if the frontend still sends them); `formulation_v2.rs`'s `generate_formulation` still accepts them from the request (the legacy `/live` settings surface still populates them) but never forwards them anywhere that matters. Generation succeeds with zero API keys, zero configured providers, and zero internet model endpoint of any kind — real network access is still used, but only for literature discovery (OpenAlex/OpenAIRE/Europe PMC/Crossref/DOAJ/Unpaywall), never for a model call.

### §2 — The target pipeline, as actually built

```
brief -> parse_requirements() (deterministic signal parsing)
      -> hybrid literature search (unchanged, Sessions 0-1)
      -> 15-unique-document research corpus (unchanged, Session 4, §4 below)
      -> CanonicalPaper dedup (unchanged, Session 1)
      -> structured evidence extraction (unchanged, Session 2)
      -> candidate pool (evidence + rule + user + supplier)
      -> functional-role requirements (category-specific, dynamic)
      -> concentration hierarchy (evidence -> supplier -> rule -> unresolved)
      -> per-strategy deterministic solver
      -> mass balance / q.s. closure (unchanged, Session 4)
      -> quality gate (extended, §12 below)
      -> final formulation versions, each with an explicit completeness state
```

New module `runtime/pipeline/engine.py` (~800 lines) is everything from candidate pool through the solver. Everything upstream of it (literature search, dedup, evidence extraction) and downstream of it (mass balance, quality gate persistence) is the SAME real code Sessions 1-4 already built and proved — this round replaced the middle of the pipeline, not the whole thing.

### §3 — Deterministic requirement parser

`engine.parse_requirements(brief)` — a controlled vocabulary of ~18 recognized signal phrases (sulfate-free, silicone-free, sensitive skin/scalp, anti-dandruff, moisturizing, antibacterial/antifungal, cost-level tiers, premium, natural-origin, color protection, easy combing, good foam, viscosity direction, fragrance-free), matched by substring against the request's own `target`/`claims`/`performance` text — deliberately NOT unrestricted language understanding. Whatever free text is left over after removing every recognized phrase and every structural/product-head word is persisted verbatim as `unresolved_fragments` — never guessed at, never silently dropped. A resolved signal can upgrade a functional role's requirement level (e.g. an anti-dandruff signal makes `active_treatment` REQUIRED rather than optional) — real, inspectable rules, not a black box.

### §4 — Functional-role engine (never shampoo-only)

`engine.FUNCTIONAL_ROLE_LIBRARY` — four category groups (`cleansing`, `oral`, `leave_on`, `generic`), each with its own REQUIRED/PREFERRED/OPTIONAL/NOT_APPLICABLE role map, derived from `category_group()`'s own keyword classification (the same head-term buckets `pipeline.py::build_queries` already used for retrieval angles, reused rather than reinvented). `resolve_role_requirements()` applies real, named upgrades on top of the static library: sensitive requests require a co-surfactant system; a "conditioner" request requires a conditioning agent; a chelator-requiring hard-water region (Session 0's own region-profile logic) requires a chelator; a recognized treatment-claim signal requires an active; an excluded/fragrance-free signal marks fragrance NOT_APPLICABLE. A formula cannot be judged complete while a REQUIRED role has no candidate.

### §5 — Ingredient candidate pool

`engine.build_candidate_pool()` builds one `IngredientCandidate` per recognized ingredient, from four real sources, in this order:

1. **Scientific evidence** — every ingredient the already-ranked evidence pool (Session 2) recognizes, real evidence class, real record count.
2. **Deterministic rule** — `rules.py`'s own `prefer`/`avoid` groups (disambiguated from the user's own preferred-ingredients text the same way `provenance.classify_ingredient_origin` already did, so a user-typed preference is never double-labeled as an independent rule) PLUS two new real, named universal defaults: water as the solvent for any aqueous product, and a small `DETERMINISTIC_ROLE_DEFAULTS` table (a real, standard preservative/chelator/pH-adjuster/thickener/humectant candidate) for mundane infrastructure roles literature retrieval often doesn't happen to cover for a given request — never for `primary_surfactant`/`active_treatment`, which stay evidence/user/supplier-only.
3. **User required** — the request's own `preferredIngredients` text.
4. **Supplier data** — real, live as of this round: `pipeline.run()` now accepts a `materials_dir`, and when the user has imported a priced raw-material list (`materials.py`), a formula ingredient matching a real supplier row (by INCI/name, or by keyword match against the material's own `function` column when the ingredient isn't in FormuLab's evidence vocabulary) gets a real `supplier_data` origin.

An ingredient matching a deterministically excluded name (the user's own exclusions, or a hard rule like the sulfate/harsh-preservative sensitive-trigger list) is marked `excluded` in the pool and structurally cannot fill any role — proven directly (`test_engine.py::
test_excluded_candidate_is_marked_excluded_and_never_fills_a_role`), not merely checked after the fact by `rules.validate()` (which still runs too, as a second layer). An ingredient this codebase's evidence vocabulary doesn't recognize and that isn't explicitly a user/rule/supplier candidate never enters the pool at all.

### §6 — Deterministic concentration hierarchy

`engine.resolve_concentration()` — a real, named tier order, never mixed:

1. Strictly comparable evidence statistics (Session 4's own `compute_comparable_stats` — same ingredient, same unit+basis, ≥2 unique studies).
2. A single real reported concentration (same ingredient/unit/basis, one study).
3. A supplier's own recommended range, when a material record carries one (checked, though today's `materials.py` schema has no such field — a real, disclosed, forward-compatible gap).
4. Validated internal FormuLab range/history — real, disclosed, NOT wired (no curated, lab-validated internal concentration-history database exists in this codebase; fabricating one would be exactly the failure mode this whole round exists to prevent).
5. The internal engineering-default table (`INTERNAL_RANGE_BY_ROLE`) — real, standard ranges for preservative/chelator/pH-adjuster/rheology-modifier/humectant/co-surfactant roles only, NEVER for `primary_surfactant`/`active_treatment` (see the module's own docstring for why those two are excluded on purpose).
6. Unresolved — never invented.

A strategy's own bias (§9) then picks a specific value within whatever range tier 1-5 established (low end for cost-optimized, high end for max-performance, a low quartile for sensitive-skin, midpoint for balanced) — never a fixed, request-independent number.

**Real bug found and fixed during this round's own live network acceptance testing**: `evidence.py`'s deterministic text extraction (Session 2) occasionally attaches an unrelated number from the same sentence/paragraph to an ingredient mention — a real run produced "Ketoconazole at 45%" (the midpoint of a real 1.0% record and an almost-certainly-mis-extracted 89.0%, likely an unrelated outcome statistic like "89% of patients improved"), scientifically absurd for an active in a rinse-off shampoo. Fixed with a new plausibility gate (`_PLAUSIBLE_RANGE_BY_ROLE`) — a real, well-established per-role bound (e.g. an active never legitimately exceeds ~20% in this product class) that REJECTS an implausible evidence-derived value and falls the hierarchy through to the next real tier, rather than trusting or "correcting" it. Re-running the exact same live scenario after the fix produced an honest `incomplete_missing_evidence` result instead (see §13 below) — the gate does not invent a replacement value, it refuses the bad one.

### §7 — Deterministic solver and V1/V2/V3 generation

`engine.build_formula_for_strategy()` — for each of `strategy.derive_strategies()`'s own real, request-aware strategies (Session 3, unchanged), independently: pick the best available candidate(s) per role (ranked by a real, inspectable score — explicit user requirement beats evidence beats rule beats supplier, with evidence class/record count and, for a supplier tie, price breaking ties within a tier), resolve each one's concentration through §6's hierarchy with that strategy's own bias, close the formula with water as the single q.s. ingredient, and compute a real `formula_state`. Strategies genuinely differ where the evidence/candidate pool allows it — proven directly (`test_engine.py::test_strategies_produce_meaningfully_different_concentrations`) and by the existing `strategy.diversity_report()` validator, unchanged and still run on every session. `low_raw_material_count`/`simplified_manufacturing` strategies skip OPTIONAL roles entirely — a real, named difference, not an arbitrary one. If fewer than `n` strategies genuinely apply to a request, fewer are generated (Session 3's own existing behavior, unchanged) — never a fabricated `n`th alternative.

### §8 — Explicit formula completeness states

Every card now carries a real `formula_state`: `complete`, `complete_with_validation_required` (a preferred role went unfilled, or a mundane role used the internal engineering default rather than evidence), `incomplete_missing_evidence` (a candidate exists for a required role but no tier resolved a defensible concentration), `incomplete_missing_functional_role` (no candidate at all fills a required role), `invalid_constraint_violation`, `invalid_mass_balance`. A generated candidate is never treated as automatically successful — `missing_roles`/`unresolved_requirements` are persisted alongside the state, naming the specific gap. There is no more `generation_failed` status for a NEW session — the deterministic engine has no stochastic failure mode the way a model call did; that status remains a real, historical value on old `"llm"`-engine sessions only.

### §9 — Research corpus, preserved and extended

Session 4's 15-unique-document target, corpus/evidence-record/unique-study separation, and honest-shortfall reporting are entirely unchanged. The one disclosed gap Session 4 left open — `raw_candidate_count` defaulting to `qualifying_count` because the wider pre-ranking pool size was never threaded through — is now closed: `literature_cache.gather()` writes the real pool size to `discovery_stats.json` next to `papers.json`, and `pipeline.py` reads it back into `provenance.summarize_research_corpus()`. Proven with a dedicated test seeding a pool of 120 real candidates for a 15-document target and confirming `raw_candidate_count > qualifying_count`.

### §10 — Ingredient provenance and mass balance, preserved and extended

`IngredientOrigin` now comes DIRECTLY from `engine.py`'s own candidate selection — evidence-first construction, not evidence attached to an already-built formula after the fact (§14 of the brief this round implements). Every ingredient in a new deterministic formula carries at least one of `scientific_evidence`/`supplier_data`/`deterministic_rule`/`user_required` — never `ai_formulation_inference`, which is now historical-only (an old `"llm"`-engine session can still show it; a new session structurally cannot, since the engine never invents an ingredient outside its own traceable candidate pool). `provenance.py::compute_mass_balance()` is completely unchanged and remains the single authoritative source the frontend reads — closes to exactly 100% for every deterministically-generated card, proven directly (`test_pipeline.py::test_mass_balance_closes_to_100_for_every_card`).

### §11 — Quality gate, extended

`provenance.assess_quality()` gained one new factor, `formulation_incomplete` — raised whenever a card's own `formula_state` is not `complete`/`complete_with_validation_required`, alongside every pre-existing factor (mass-balance-invalid, hard-constraint-violation, insufficient-research-corpus, critical-active-no-evidence, unusual-concentration-no-evidence, low-evidence-coverage). Still never a hard reject — always a transparent, documented list.

### §12 — Backward compatibility and the dual-UI convergence

Old `"llm"`-engine sessions are read exactly as before — `formulation_v2.rs::read_cards`/`read_session` are unchanged generic `serde_json::Value` passthroughs, so an old session's real `provider`/`model`/`ai_formulation_inference` origins/`generation_failed` cards all still render correctly; nothing on disk is rewritten. Both UIs — `/live` and `/formulation-request` → `/formulation-result` — call the exact same `generate_formulation` Tauri command, which now always runs the deterministic engine; they were already structurally converged on one backend (Session 4's own audit confirmed this), so no redesign was needed. Both screens' own credential-gating (`cfg.provider !== "ollama" && !cfg.apiKey.trim()` blocking submission) was removed — a real UX bug under this round's own requirement that the absence of a model credential must never be an error for formulation generation.

### §13 — Real zero-LLM acceptance run

Ran the exact mandated request end to end through `run_cli.py` (the real stdin/stdout bridge the desktop app invokes), with `library_dir`/`sessions_dir` only — no `provider`/`model`/`api_key` in the request at all: *"Develop an effective sulfate-free anti-dandruff shampoo for a sensitive scalp. Target pH 5.0–5.5. Medium cost."* Real network calls to OpenAlex/OpenAIRE/Europe PMC/Crossref/DOAJ.

- **Research**: 120 raw candidates, 15/15 target corpus achieved, 4 full text / 11 abstract-only, 10 evidence records from 2 unique studies.
- **Candidate pool**: 20 candidates, 0 excluded (no request-excluded ingredient happened to have real evidence/rule backing this run), origins `{scientific_evidence: 2, deterministic_rule: 18}`.
- **Formulas**: 3 real, genuinely different strategies (Balanced/Sensitive Skin/Cost Optimized). One version's real result: mass balance closed to exactly 100.0% (subtotal 16.55% + q.s. water 83.45%), `formula_state: incomplete_missing_evidence` — the top-ranked `active_treatment` candidate this run (salicylic acid) had its only real evidence-derived concentration REJECTED by the §6 plausibility gate, correctly reported as a real gap (`missing_roles`) rather than silently substituted with a plausible-looking number — acceptance criterion (B) from this round's own brief ("truthfully returns an incomplete formula because required scientific/material data is missing" is a valid, non-fabricated outcome). No mock formula generator was used anywhere in this run.

### Known limitations, disclosed

- The candidate-pool evidence vocabulary (`engine.ROLE_MAP`) covers cleansing/hair-care roles well; `oral`/`leave_on`/`generic` groups have several roles (abrasive, emulsifier, oil_phase, surfactant, active_system, builder) with no matching evidence-vocabulary ingredient yet — a real, disclosed scope boundary (never filled with a guessed ingredient), future work to extend.
- Supplier-sourced concentration ranges are checked for (`recommended_min_pct`/`recommended_max_pct`) but `materials.py`'s schema doesn't populate them today — real, forward-compatible, not fabricated.
- `internal_formulab_data` stays reserved, unemitted — no curated, lab-validated internal concentration-history database exists.
- The plausibility gate (§6) is a coarse per-role sanity bound, not a fix to `evidence.py`'s own extraction accuracy — a genuinely correct but unusual concentration outside the bound would also be rejected; tightening extraction itself is future work.

### Verification

`python -m pytest runtime/pipeline -q`: **269/269 passing** (243 baseline-after-rewrite + 26 new engine-specific tests across `test_engine.py`, plus rewritten `test_pipeline.py`). Every mock-LLM-based test from before this round was rewritten against the real deterministic engine — there is nothing left in this codebase to inject a mock LLM response into. Rust: `cargo check --release` clean; `cargo test --release formulation_v2::` — 7/7, unchanged (the Rust bridge needed zero structural changes — `read_cards`/`read_session` are generic passthroughs). Frontend: `pnpm tsc --noEmit` clean, ESLint clean, `pnpm vitest run` — full suite green (see §19's own combined verification numbers below, which cover this section's frontend changes too). `git diff --check`: clean.

## 19. Phase 14 Session 5 — Manufacturing Procedure, Critical Parameters, Equipment Intelligence, zero LLM (DONE)

Built directly on top of §18's deterministic engine — the user's own instruction was explicit that Session 5 must ALSO use zero LLM, and that it must not begin until Part A (§18) worked and was verified.

### §20 — Manufacturing evidence model

No new extraction was needed: Session 2's own `evidence.py::ProcessObservation` (temperature, pH, mixing method, time, a verbatim note) was already extracted per evidence record and simply never used downstream until now. New `manufacturing.py` is the first module that actually reads this field — every process step this session shows with a real temperature/mixing-method/duration traces directly back to one specific evidence record's own `ProcessObservation`, with that record's own DOI attached.

### §21/§22/§23 — Deterministic process planner and the Manufacturing Procedure tab

New module `runtime/pipeline/manufacturing.py`. `ROLE_PROCESS_ORDER` — a real, well-established formulation-engineering convention (charge the base, disperse chelator/thickener before surfactants, add surfactants, add actives, adjust pH against the actual batch, add preservative/fragrance last) — generic by functional ROLE, never a per-request or per-ingredient special case, so it applies to any category `engine.py`'s role registry covers, not shampoo alone. `plan_process_steps()` builds one step per role THIS formula version's own resolved ingredients actually use (a role with no ingredient present gets no step at all) — prefers a real `ProcessObservation` when one of that role's ingredients has one (basis `scientific_evidence`, real temperature/time/mixing-method, real DOI, `confidence: established`), otherwise a qualitative, role-appropriate instruction with every numeric field explicitly `null`/"Not established — laboratory validation required" (basis `deterministic_rule`, `confidence: not_established`) — never an invented RPM, temperature, or duration.

### §24/§25 — Critical Parameters tab and the target-vs-critical-limit distinction

`build_critical_parameters()` — mass balance is always a real `critical_limit` (the deterministic 100% calculation itself); pH is always a `target` (the user's own stated range, or `NOT_ESTABLISHED`), never automatically promoted to a hard boundary without real evidence/rule support (§25's own explicit requirement); a preservative-efficacy challenge test is listed as a `critical_limit` whenever any preservative role is present (a real, universal regulatory/engineering requirement, with no invented numeric microbial limit); a formula's own `violations` surface as a `critical_limit`; an evidence-backed active's own strictly-comparable observed range (§6/Session 4) surfaces as a real `target`. Every parameter with no established real range says so explicitly, never a placeholder number.

### §26/§27/§28 — Equipment engine, availability matching, batch-scale awareness

`derive_equipment()` — real, role-derived recommendations (a main mixing vessel and a balance always; a high-shear disperser only when a rheology modifier is actually present; a jacketed vessel only when an emulsifier/oil phase role is present; a calibrated pH meter only when a pH-adjuster role is present) — no motor power, RPM, or vessel geometry is ever invented; `suggested_capacity` is a qualitative scale bucket (`batch_scale()` parses the request's own `estimatedBatchSize` text into laboratory/pilot/production/not_specified — the same keyword-bucket convention `strategy.py`'s own `_applies_simplified_manufacturing` already used), never a linearly-scaled numeric value. `available_in_facility` compares each recommendation against the request's own `availableEquipment` free text via a real per-equipment match-term list (fixed a real matching bug during testing: comparing the full display name "Calibrated pH Meter" against a user's shorter "pH meter" text failed a substring check — fixed with a dedicated match-term list per recommendation).

### §29/§30 — Version scoping and process traceability

Manufacturing Procedure/Critical Parameters/Equipment are computed independently per card inside `pipeline.py`'s existing per-strategy loop (the same loop mass balance/origins/quality-gate already run in) — switching the selected version in the UI reads a different `card.manufacturing` object entirely, never stale cross-version content, proven directly (`FormulationResultPage.test.tsx`'s Session 5 "not-ready" test selects a second version and confirms different content renders). Every step/parameter/equipment basis is always one of `scientific_evidence`/`supplier_data`/`internal_formulab_data`/`deterministic_rule` — no AI origin, no unknown-origin value, structurally enforced by `manufacturing.py`'s own dataclasses never having an AI-origin value to assign.

### §31 — Safety/regulatory separation

`plan_manufacturing()` refuses to plan at all when a formula's own `formula_state` is `invalid_mass_balance` or `invalid_constraint_violation` — returns `ready: false` and a real `not_ready_reason`, never a process plan built around a formula that is itself invalid. An `incomplete_missing_evidence`/`incomplete_missing_functional_role`/`complete_with_validation_required` formula is still planned (the plan just carries the same real gaps forward) — only a genuinely invalid formula is blocked. Hard ingredient exclusions, deterministic safety rules, and mass balance are never re-decided here; Session 6 (full Safety/Regulatory evidence integration) remains out of scope.

### §32 — UI

The approved Phase 14 result-screen visual hierarchy and V1/V2/V3 behavior are unchanged. The three existing `NotYetAvailableTab` placeholders (Manufacturing Procedure/Critical Parameters/Equipment) are now conditionally replaced with real tables (`ManufacturingProcedureTab`/`CriticalParametersTab`/`EquipmentTab`) whenever a card carries `manufacturing` data — a pre-Session-5 session with no `manufacturing` field on its cards still falls back to the honest "not yet available" notice, never a crash or empty table. A `NotReadyNotice` component shows the real `not_ready_reason` for an invalid formula version's own tabs. A `BasisBadge` component (mirroring the established `OriginBadge` convention) shows each step/parameter's real basis, always visible, never tooltip-only.

### Verification

`python -m pytest runtime/pipeline -q`: **269/269 passing** — includes 22 new `test_manufacturing.py` tests (process ordering, real-evidence-vs-generic-instruction, no-invented-numerics, target-vs-critical-limit, preservative-efficacy-only-when-present, equipment-derived-from-real-process-needs, availability-matching, batch-scale recognition, the §31 not-ready gate for both invalid states) plus 2 new `test_pipeline.py` integration tests. Rust: `cargo check --release` clean; `cargo test --release formulation_v2::` — 7/7 (no Rust change needed — `manufacturing` is carried by the same generic `serde_json::Value` passthrough every other Session 4/5 field already is). Frontend: `pnpm tsc --noEmit` clean, ESLint clean on every touched file, `pnpm vitest run` — **137 files / 1235 tests** (1231 baseline + 4 new Session 5 cases: real role-ordered steps with real basis, target-vs-critical-limit distinction, real availability matching, the not-ready notice for an invalid formula version) — zero regressions anywhere. `git diff --check`: clean.

**Real, live verification, not just mocked unit tests**: the same real network run described in §18 §13 was inspected for its manufacturing output — `manufacturing.ready: true`, 8 real role-ordered steps (one with real evidence-sourced temperature/time from an actual paper, the rest honest "not established" qualitative instructions), 4 real critical parameters (mass balance, pH target, preservative-efficacy requirement, and — before the §6 plausibility-gate fix — a since-corrected evidence-backed active range), 5 real equipment recommendations correctly matched against the request's own stated `availableEquipment` text.

**Exact next Phase 14 session**: **Session 6**, per §12's own original breakdown — full traceability persistence across every stage above plus a closure/regression pass, including the Safety and Regulatory tabs' own remaining "not yet evaluated" placeholders. Zero LLM, building on §18's deterministic engine and this session's manufacturing intelligence the same way this session built on Sessions 1-4. Not started automatically by this round.

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
