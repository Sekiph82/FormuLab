# Phase 14 — Frontend UI Specification (New Formulation Request + Formulation Result)

**Status: IMPLEMENTED**, at the user's explicit direction, during the
same run that registered this specification — ahead of §12's originally
proposed sequencing (request screen: Session 3; result screen: Session
4). Real files: `apps/desktop/src/app/routes/NewFormulationRequestPage.tsx`
(Screen 1) and `apps/desktop/src/app/routes/FormulationResultPage.tsx`
(Screen 2), routed at `/formulation-request` and `/formulation-
result/:sessionId`, reachable from the sidebar's "New Request" entry and
the saved-formulations history list. Both call the existing, unchanged
`generate_formulation`/`read_session` commands — no new backend command,
no change to `runtime/pipeline/`'s generation behavior. Every field
either shows real data returned by that pipeline (ingredients,
functions, weight %, references, purpose, warnings, the deterministic
`violations` list) or an explicit, visible "not yet available" notice —
never a fabricated score, evidence-class, process step, or regulatory
determination, per this document's own "Scientific data rules" below,
which the implementation follows to the letter. See the architecture
doc §11a/§13 for the full account of what is and isn't backed by real
data at this stage, and why.

## Approved visual references (source of truth for layout/visual design)

Two screenshots, provided and explicitly approved by the user, copied
into the repo as durable assets:

- `docs/assets/phase14/formulation-request-screen.png` (original
  filename `formulation request screen.png`)
- `docs/assets/phase14/formulation-reply-screen.png` (original filename
  `formulation reply screen.png`)

**These screenshots define the UI. The Phase 14 evidence/formulation
architecture (`docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md`)
defines the actual data.**

Treat the screenshots as **pixel-level design references**. Match as
closely as technically practical: page proportions, card positions and
dimensions, horizontal/vertical spacing, sidebar width, content
density, right evidence-panel width, tab position, formula-table
placement, typography hierarchy, border radii, subtle borders, dark
surfaces, selected-state treatments, score badges, version-card layout,
quick-action placement, summary-card placement, top request banner,
table row density. Do not introduce a new visual design system for
these pages — reuse FormuLab's existing components/design tokens where
they can reproduce the approved design.

**Do NOT redesign these screens. Do NOT simplify them. Do NOT
substitute a different dashboard layout. Do NOT move major sections
around unless a real technical constraint makes the exact structure
impossible** — and if that happens, the implementing session documents
the reason, it does not silently redesign.

**The only intentional differences from the screenshots**:

1. Build the production UI in **English** (the screenshots are Turkish
   mockups).
2. Replace every illustrative/mock scientific value with real Phase 14
   data — nothing in the screenshots' own field values, ingredient
   lists, study counts, concentrations, citations, or scores is real
   data, and none of it should be copied as such into the
   implementation (see "Scientific data rules" at the end of this
   document).
3. Correct the screenshots' own internal inconsistency (the reply
   screenshot's V2 formula lists a sulfate ingredient while its pinned
   original request explicitly asks for a sulfate-free product) rather
   than reproducing it — this is a mockup artifact, not a product
   requirement.

---

## Screen 1 — New Formulation Request

English screen title: **New Formulation Request**. Subtitle:
*"Describe what you need in natural language and FormuLab will develop
the most suitable formulation for you."*

### Left sidebar

FormuLab logo, then: Dashboard, **New Request** (active state, visually
equivalent to the screenshot's highlighted item), Formulations, Raw
Materials, Literature, Test & Analysis, Production, Inventory, Reports,
Administration.

### A. Describe Your Need

The primary, large natural-language input panel — the user's
authoritative primary requirement; every structured field below/beside
it complements this, never replaces it.

- Title: **Describe Your Need**
- Helper text: *"Describe the product, desired properties, targets and
  constraints in your own words."*
- Large textarea, character counter (matches the screenshot's `0 /
  4000`-style counter).
- Example placeholder text may demonstrate a realistic request, e.g.:
  *"Develop an effective sulfate-free anti-dandruff shampoo for a
  sensitive scalp. Target pH 5.0–5.5, silicone-free, with good foam
  and easy combing. Keep the target cost at a medium level."*
- **Example Requests** button.
- **Clear** button.

### B. Product Information

- **Product Category** — dropdown. Examples: Hair Care, Skin Care, Home
  Care, Laundry, Oral Care, Industrial, Other.
- **Target Product Type** — free text or controlled input, whichever
  fits the existing masterdata architecture at implementation time.
  Examples: Shampoo, Conditioner, Serum, Cream, Emulsion, Gel.
- **Target Market / Country** — country/market selection; feeds the
  later regulatory evaluation (§Tab 6 below), so this field's value
  must be structured/selectable, not free text the regulatory engine
  can't key off of.

### C. Constraints & Preferences

- **Excluded Ingredients** — e.g. sulfates, parabens, silicones,
  specific allergens, specific preservatives.
- **Preferred Ingredients** — preferred materials, chemistry families,
  natural ingredients, supplier materials.
- **Target pH Range** — min/max.
- **Target Viscosity** — value or range, with unit.
- **Target Active Matter** — value or range.
- **Target Cost Level** — Economy / Medium / Premium / Custom cost
  target.
- **Claims** — e.g. anti-dandruff, moisturizing, sensitive skin, color
  protection, antibacterial, sulfate-free, silicone-free.
- **Packaging Type (Optional)** — relevant when packaging compatibility
  affects formulation/process decisions.

### D. Production Information

- **Estimated Batch Size**.
- **Available Equipment** — should eventually connect to FormuLab
  equipment/masterdata where available. Examples: anchor mixer,
  high-shear mixer, homogenizer, vacuum mixer, rotor-stator mixer,
  heating/cooling vessel.
- **Available Raw Materials (Optional)** — allow FormuLab to use actual
  inventory/masterdata when appropriate.

### E. Evidence-Based Process banner

Preserve the bottom banner from the approved screenshot.

- Heading: **Evidence-Based & Transparent Process**
- Brief explanation that FormuLab combines scientific evidence,
  compatibility, safety, regulatory, and production intelligence.
- Capability badges (English): Scientific Literature, Evidence Base,
  Safety Check, Regulatory Compliance, Production-Aware.

### F. Actions

- **Save Draft**
- Primary: **Start Formulation Request** — starting the request must
  persist the ORIGINAL user request exactly, so the result screen can
  display it unchanged (see "Original Request — Fixed" below).

---

## Screen 2 — Formulation Result

Reproduce the reply screenshot's structure closely, in English. **Do
not create a side-by-side three-formula comparison as the main result
view** — there are V1/V2/V3 strategy cards, but only ONE selected
formulation is displayed below them at any time.

### Top bar

Preserve the compact top bar and FormuLab branding. Actions may
include **Download Report**, **Share**, plus existing
user/notification/help controls if the real application already
supports them elsewhere.

### Original Request — Fixed

At the top of the content area, always visible while reviewing the
generated formulation:

- Heading: **Original Request (Fixed)**
- The user's original natural-language formulation request, displayed
  verbatim.
- **Edit Request** — editing must create/re-run the appropriate
  formulation workflow rather than silently mutating the evidence
  context of an already-generated result.

### Formulation versions (V1 / V2 / V3)

Exactly the three-card structure from the screenshot. Each card: a
version identifier, a short strategy name, a concise strategy
explanation, and an overall score. Only one card is selected at a time.

Example labels are contextual, generated from the actual request and
optimization goals — never a fixed enum FormuLab must always produce.
Illustrative examples: V1 "Balanced / Recommended", V2 "Cost
Optimized", V3 "Sensitive Skin Focused". For a different request,
FormuLab may generate different meaningful strategies, e.g. Maximum
Performance, Natural-Origin Focused, High Stability, Regulatory
Conservative, Low Cost, Premium Sensory, Simplified Manufacturing.

**Selecting a version changes the ENTIRE version-specific result
context** — every tab, the formula table, and the right-side evidence
panel all re-render for the newly selected version. Evidence from one
version must never remain displayed after switching to another — the
same `formulaVersionId + ingredientId/materialId + selectedConcentration`
context-key requirement the architecture doc's §9 already states.

### Result tabs (fixed set, all version-scoped)

Preserve the horizontal tab bar's position exactly. English tab names,
in this order:

1. Formula
2. Manufacturing Procedure
3. Critical Parameters
4. Equipment
5. Safety
6. Regulatory
7. Evidence & Sources
8. Alternatives
9. Summary

(These correspond one-to-one to the architecture doc §8's originally-
named Turkish tabs: Formül, İşlem Reçetesi, Kritik Parametreler,
Ekipman, Güvenlik, Regülasyon, Kanıtlar & Kaynaklar, Alternatifler,
Özet — same fixed set, English names for the production UI.)

#### Tab 1 — Formula

The main table from the approved screenshot.

- Header example: **FORMULA V2 — COST OPTIMIZED** (shows the selected
  version).
- Summary line, as applicable: total active matter, target/final pH,
  target/final viscosity, density where relevant, estimated cost,
  batch size, overall score.
- Table columns:
  - `#`
  - **Ingredient / INCI** — commercial/raw-material name where
    relevant, INCI name, optional role/subtitle.
  - **Function** — e.g. Primary Surfactant, Secondary Surfactant,
    Humectant, Rheology Modifier, Preservative, Chelating Agent, Active
    Ingredient, Fragrance, Solvent.
  - **% (w/w)**
  - **Active Matter** — active content contribution where applicable.
  - **Evidence** — compact evidence count/status.
  - **Evidence Class** — the approved five-tier hierarchy: A = Direct
    Formulation Evidence, B = Experimental Ingredient Evidence, C =
    Review / Secondary Evidence, D = Related-Domain Evidence, E = Weak
    / Indirect Evidence (architecture doc §5's own table, unchanged).
  - Total must equal 100%; support `q.s.` where chemically appropriate.

**Ingredient selection**: clicking a row selects that ingredient. The
right-side evidence panel immediately updates to `selectedVersion +
selectedIngredient + selectedConcentration`.

#### Right panel — Ingredient Evidence

Preserve the exact role and general visual structure of the
screenshot's right panel.

- Title: **Ingredient Evidence**
- Context line, e.g. `V2 > Cocamidopropyl Betaine (CAPB)`.
- **Selected Concentration**: e.g. `5.50%`.
- **Why This Ingredient?** — why this ingredient was selected
  specifically for THIS formulation version; may consider functional
  role, synergy with other ingredients, target performance, mildness,
  foam, rheology, stability, cost, availability, supplier data,
  safety/regulatory constraints, FormuLab historical evidence.
- **Why 5.50%?** — defensible statistics from deduplicated comparable
  evidence: Observed Range, Comparable/Common Range, Median, Evidence
  Count, Confidence. **Never fabricate these values** — if insufficient
  evidence exists, say so explicitly, e.g. *"Insufficient comparable
  evidence. Laboratory validation required."* (architecture doc §5's
  own fabrication-avoidance rule.)
- **FormuLab Decision Factors** — the actual decision factors used,
  e.g. performance contribution, cost optimization, active-matter
  target, viscosity compatibility, surfactant ratio, pH compatibility,
  available supplier grade, regulatory limit, inventory availability.
- **Supporting Scientific Sources** — top supporting UNIQUE studies (a
  paper found via OpenAlex, PubMed, CORE, and Semantic Scholar still
  counts as ONE study — the `CanonicalPaper`/`unique_source_count`
  distinction Session 0 built, `runtime/pipeline/canonical_paper.py`).
  Provenance may be shown separately. Each source may show: title,
  authors, year, journal/source, DOI/PMID/PMCID where available,
  evidence class, relevance to the ingredient, whether full text was
  actually available, discovery providers.
- **Related Constraints & Notes** — e.g. temperature sensitivity, pH
  restrictions, shear sensitivity, incompatibilities, regulatory
  limits, solubility constraints, preservation implications.

#### Tab 2 — Manufacturing Procedure

The detailed production recipe for the SELECTED version — a real,
ordered manufacturing process specific to the actual formulation, never
generic textbook instructions. Structured step-by-step layout/table.
Per step, as applicable: Step, Phase (e.g. Phase A, Phase B, Premix,
Main Vessel, Cool-down, Final Adjustment), Ingredient(s), Amount/%,
Addition Order, Equipment/Vessel, Mixing Method (e.g. anchor agitation,
propeller, rotor-stator, high shear, homogenization, low-shear sweep),
Mixing Speed (RPM or another meaningful shear description **only when
supported or justifiable — never invent an arbitrary RPM value**),
Temperature (start/heating target/hold range/cool-down target where
appropriate), Time (mixing/hydration/hold time where supported),
Process Instruction (a clear manufacturing instruction), **Endpoint /
Continue When** (essential — e.g. completely dissolved, no visible
agglomerates, uniform dispersion, temperature below 40°C, pH within
5.2–5.4, viscosity stabilized, foam entrainment minimized), and
**Evidence / Rationale** (critical manufacturing decisions state their
basis: scientific literature, supplier technical documentation,
FormuLab engineering rule, historical lab data, material specification
— or, if evidence is insufficient, explicitly *"Laboratory validation
required"*). This is architecture doc §6's İşlem Reçetesi, in English,
with the exact same fabrication-avoidance discipline.

#### Tab 3 — Critical Parameters

**Not a duplicate of the manufacturing procedure** — the compact
control envelope for parameters that must not be violated (architecture
doc §6's Kritik Parametreler). Table/cards with: Parameter (e.g. pH,
maximum temperature, minimum hydration time, high-shear duration,
fragrance addition temperature, preservative addition temperature,
viscosity range, cooling endpoint, surfactant ratio, order-of-addition
dependency), Required Range/Limit, Why It Matters, Consequence If
Violated, Evidence/Source, Confidence. Never fabricate a limit — if
unavailable: *"Not established — laboratory validation required."*

#### Tab 4 — Equipment

Equipment required for the SELECTED formulation/process — its own tab,
derived from the same İşlem Reçetesi data (architecture doc §6), never
generic. Derive from batch size, viscosity, rheology, solids,
emulsification/dispersion requirements, shear sensitivity,
heating/cooling requirement, deaeration requirement, the user's
entered available equipment, and FormuLab equipment masterdata. Per
item: Equipment, Purpose, Required/Preferred/Optional, Recommended
Capacity, Key Specifications (agitation type, approximate power/shear
requirement, heating/cooling jacket, vacuum capability, material of
construction, minimum working volume), Used In Process Steps,
Available in Facility (Yes/No/Unknown). If the user's available
equipment is insufficient, identify the limitation and suggest a
practical process adaptation where defensible.

#### Tab 5 — Safety

Deterministic where rules/data permit — **keep the deterministic PASS/
FAIL status separate from soft formulation confidence** (architecture
doc §10's own separation requirement).

- **Overall Safety Status**: PASS / PASS WITH CONDITIONS / FAIL / DATA
  INCOMPLETE.
- **Ingredient Safety** — per relevant ingredient: concentration, known
  limit/constraint, hazard flags, sensitization/irritation
  considerations, handling considerations, evidence/source.
- **Formula-Level Safety** — e.g. combined irritancy concern,
  incompatible chemical combination, pH hazard, oxidizer/reducer
  conflict, flammability concern, worker handling requirements.
- **Manufacturing Safety** — e.g. PPE, dust control, ventilation,
  temperature hazards, exothermic addition warning, order-of-addition
  safety.

Never replace an actual regulatory/safety limit with AI estimation.

#### Tab 6 — Regulatory

Scoped to the user's selected market/country (Screen 1's "Target Market
/ Country" field feeds this directly).

- **Target Market**.
- **Overall Regulatory Status**: COMPLIANT / COMPLIANT WITH CONDITIONS
  / NON-COMPLIANT / DATA INCOMPLETE.
- **Ingredient Restrictions** — per relevant ingredient: jurisdiction,
  allowed/prohibited/restricted, maximum concentration where
  applicable, product-category condition, source/regulation reference.
- **Claim Review** — evaluate requested claims (e.g. anti-dandruff,
  antibacterial, hypoallergenic, natural, dermatologically tested),
  distinguishing formulation plausibility, regulatory acceptability,
  and claim-substantiation requirement as three separate judgments, not
  one blended one.
- **Label / INCI Considerations**.
- **Market-Specific Warnings**.

Never invent regulatory limits — unknown data stays visibly unknown.

#### Tab 7 — Evidence & Sources

The WHOLE-FORMULA evidence view — different from the right-side
selected-ingredient panel.

- **Evidence Summary** — unique scientific studies, direct formulation
  studies, experimental ingredient studies, reviews, related evidence,
  supplier technical sources, internal FormuLab evidence.
- **Evidence Quality Distribution** — A/B/C/D/E.
- **Unique Study Count** — deduplicated by DOI/PMID/PMCID/OpenAlex
  ID/title fingerprint as appropriate (`canonical_paper.deduplicate()`,
  Session 0). Never count one paper five times because five providers
  found it.
- **Scientific Sources** — sortable/filterable table: title, authors,
  year, source/journal, DOI/identifier, evidence class, formulation
  relevance, ingredients supported, full-text availability, OA/license
  status, discovery providers.
- **Evidence Gaps** — explicitly identify unsupported or
  weakly-supported formulation decisions.

#### Tab 8 — Alternatives

Alternatives for the SELECTED formulation version — **not V1/V2/V3
themselves**. Ingredient/process substitutions inside the selected
strategy: Replace Ingredient, With, Reason, Expected Effect
(performance/cost/safety/regulatory/sensory/process impact), Evidence
Strength, Compatibility Risk. Examples: alternative surfactant,
alternative preservative, alternative thickener, alternative chelator,
alternative active ingredient, supplier-equivalent grade. Lets the user
understand what can be changed without blindly regenerating the whole
formulation.

#### Tab 9 — Summary

An executive formulation summary for the selected version.

- **Version Strategy** — why this version exists.
- **Key Formula Characteristics** — active matter, pH, viscosity, major
  functional system, major actives, preservation system.
- **Performance Expectations** — evidence-backed expected benefits
  only.
- **Cost** — estimated cost and main cost drivers.
- **Evidence Confidence** — transparent soft confidence. **Do not mix
  this score with deterministic safety/regulatory PASS/FAIL.**
- **Key Risks**.
- **Validation Required** — an explicit plan: laboratory batch,
  appearance, pH, viscosity, centrifuge where relevant, freeze/thaw
  where relevant, stability, compatibility, microbiological/challenge
  testing where relevant, performance testing, packaging compatibility,
  pilot batch.
- **Recommended Next Action** — e.g. Create Laboratory Trial, Schedule
  Stability Study, Review Regulatory Gap, Resolve Missing Supplier
  Data.

### Center-right quick actions

Preserve the screenshot's quick-action column, English labels: Add
Formula Note, Create Laboratory Trial, Plan Stability Test, Cost
Analysis, Save Formula, Query Supplier. These actions operate on the
selected formula version.

### Version summary card

Preserve the compact selected-version summary card: Total Ingredients,
Estimated Cost, Active Matter, pH Range, Viscosity, Estimated Batch,
Overall Score. Again — overall score is a soft formulation/decision
score; Safety and Regulatory PASS/FAIL remain separate.

### Version comparison

Preserve the upper-right **Version Comparison** card, with an **Open
Comparison** button that may open a dedicated comparison view where
V1/V2/V3 can be compared in detail. The main result screen itself still
displays only ONE selected full formulation at a time.

---

## Scientific data rules (applies to both screens)

The screenshots contain illustrative scientific content. Do **not**
copy their fake/demo ingredient choices, concentrations, study counts,
study titles, DOI values, ranges, medians, confidence scores, process
limits, or claims. In particular, the reply screenshot's sulfate-
related example is chemically inconsistent with its own sulfate-free
original request — the production implementation must never reproduce
this simply because it appears in the approved UI mock.

**The screenshots define layout and UX only.** Actual content must come
from: the real formulation request's constraints, material masterdata,
supplier data, literature evidence, canonical deduplicated papers
(`canonical_paper.py`, Session 0), OA/full-text evidence, the safety
engine, the regulatory engine, the compatibility engine, the optimizer,
inventory/cost data, and historical laboratory/stability data when
available.

---

## Phase discipline

This specification was registered during **Session 0** (backend/design
scope only — see `docs/handoffs/PHASE14_CURRENT.md`), then implemented
in the same run at the user's explicit, direct instruction ("please do
these now, it is not a future reference") — an intentional, disclosed
departure from §12's proposed sequencing (request screen: Session 3;
result screen: Session 4), not a silent scope change. The implementation
follows this specification directly; see the architecture doc §13 for
the full closure record, including what remains honestly unavailable
(evidence-class ranking, manufacturing-process generation, safety/
regulatory engine wiring, real formula-version scoring) because the
backend work that would compute it (Sessions 1/2/5/6) has not happened
yet. No later Phase 14 session (the orchestrator/adapter work) was
started automatically by building these two screens.
