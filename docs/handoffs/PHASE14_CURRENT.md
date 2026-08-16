# Phase 14 — Evidence-Driven Hybrid Literature & Formulation Intelligence

## Status: RESERVED, NOT STARTED — no session has begun. This phase was registered (documentation only) while Phase 13 (Enterprise Identity, Authentication, Fixed RBAC & Application Security) was the active phase, at its Session 4A. Full design and the approved product decisions this phase must implement: `docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md`. Phase 13 remains the active phase — see `docs/handoffs/PHASE13_CURRENT.md` for real, in-progress work.

## Why this exists as a document with no session yet

Registering the phase number and its approved scope now — ahead of any
implementation — avoids numbering/scoping ambiguity against whatever
Phase 13 session is active when Phase 14 actually starts. Nothing
below describes work that happened; it describes what a future Phase
14 Session 0 will need to pick up.

## What Phase 14 is

Evolves the existing OpenAlex/Europe PMC/arXiv formulation-discovery
pipeline (`runtime/skills/core/formulation-discovery/discover.py` +
`runtime/pipeline/pipeline.py`/`literature_cache.py`, reachable today
via `formulation_v2.rs`'s `generate_formulation` command) into a
multi-source, deduplicated, fully-explainable literature engine
feeding a redesigned query screen ("Yeni Formülasyon Talebi"), a
redesigned result screen (selectable V1/V2/V3+ version cards, a
9-tab layout), version-scoped per-ingredient evidence, and — new —
a sourced manufacturing-process recipe (İşlem Reçetesi/Kritik
Parametreler/Ekipman). Full decision-by-decision detail: the
architecture doc above.

## What was done to register this phase (documentation only)

- `docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` (new) — the
  full approved-decisions record and a proposed 7-session breakdown
  (not started).
- This handoff (new).
- `docs/architecture/IMPLEMENTATION_STATUS.md` — new Phase 14 entry
  recording the reservation.

**Zero implementation happened.** No Findpapers install, no provider
integration, no discovery-pipeline change, no new query/result screen,
no formula-generation change, no evidence-extraction change, no
manufacturing-process generation. See the architecture doc's §11 for
the explicit list.

## Exact next Phase 14 session

**Session 0**, whenever Phase 14 actually starts (not this run): audit
the existing discovery pipeline in detail, design the `CanonicalPaper`
schema and deduplication algorithm concretely, design the
Findpapers-adapter boundary, and confirm real access to IEEE Xplore/
Scopus/Web of Science/Google Scholar before committing to any of them
(architecture doc §12/Risks).

## Not this run

Phase 13 is the active phase. After this reservation, work returned to
Phase 13 Session 5 (`Administration → Users`) — see
`docs/handoffs/PHASE13_CURRENT.md`.
