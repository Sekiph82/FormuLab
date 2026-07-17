---
name: formulation-discovery
description: Use when the user wants a formulation PROPOSED from the literature rather than optimizing a formula they already have — "find me a formula for X", "what should go in a Y", "design a Z product from published research". Retrieves open-access papers for a target product, extracts the ingredients/functions/concentrations reported there, synthesizes an evidence-based candidate formulation with citations, and hands it to the formulation-optimizer for cost/constraint tuning. For a formula the user already has, use formulation-optimizer directly.
---

# Formulation discovery (literature → candidate formula)

Turn a product goal ("an anti-dandruff, soothing shampoo") into an
**evidence-based candidate formulation** by mining open-access literature, then
cost-optimize it. This is an R&D assistant that surfaces what the published
science supports — **not** a validated recipe and not a substitute for a
qualified chemist or regulatory review.

## Safety gate — check FIRST, before any retrieval

Proceed only for ordinary, lawful consumer/industrial products: cosmetics,
personal care, cleaning, coatings, food, textiles, agrochemicals used lawfully,
and similar. **Refuse** — do not retrieve, extract, or propose anything — when
the target is or plausibly enables: explosives or energetic materials; chemical/
biological weapons, toxins, or their precursors; illicit drugs or controlled
substances; poisons intended to harm; or any synthesis whose primary use is to
injure. If a request is ambiguous, ask the user to clarify the lawful,
legitimate use before continuing.

## Honest limits — state these in the output

- The proposal is a **candidate grounded in open literature**, not "the one
  correct formula." Commercial formulas are often patented or trade secrets and
  their exact ratios are not published.
- Papers frequently report ingredients and roles but **not full weight-%
  breakdowns**; where a number is inferred, mark it as an estimate with a
  confidence level and a wide range.
- Every candidate needs **bench validation** (stability, efficacy, preservative
  challenge, patch testing) before it means anything.
- Report the evidence as-is and cite it; do not overstate efficacy or make
  therapeutic/medical claims (see regulatory note).

## Pipeline

### 1. Retrieve (open access only)

`discover.py` queries OpenAlex (open API, no key; only open-access full text is
downloaded — never paywalled or pirated sources):

```bash
python discover.py "antidandruff shampoo formulation" \
    "ketoconazole piroctone olamine shampoo formulation" \
    "shampoo soothing colloidal oatmeal skin barrier" --max 40 --pdfs
```

Writes `literature/papers.csv` + `papers.json` (metadata, abstracts, OA URLs)
and, with `--pdfs`, the open-access PDFs. Use several queries: one per active/
function you expect (cleansing base, each active, soothing agents, preservation).

### 2. Read & extract

Read the OA papers/abstracts and pull, **with a citation (DOI) per fact**:
ingredient name, its **function** (surfactant, active, emulsifier, thickener,
preservative, chelator, conditioning agent, soother, pH adjuster), and any
reported **concentration** (wt% / w/w). Record the study type (in-vitro,
clinical, formulation-only). Do not paste long verbatim text — extract the data
and cite.

### 3. Synthesize the candidate

Build a formulation table: `ingredient | function | wt%-range | evidence (DOI) |
confidence`. Group by function so the recipe is complete (a shampoo needs a
cleansing system, actives, thickener/rheology, preservative, chelator, pH
control, water q.s. to 100%). Flag gaps where evidence is thin.

### 4. Cost-optimize

Turn the ranges into a numeric instance and hand it to **formulation-optimizer**
(sibling skill) to get a cost-minimal mix that still meets the active-content
and per-ingredient limits:

```bash
python ../formulation-optimizer/optimize.py candidate.json
```

### 5. Report

Produce a formulation card: final wt% per ingredient, the total, the achieved
active content, the rationale with citations, the assumptions/estimates, a
regulatory + safety section, and an explicit "needs lab validation" line.

## Regulatory note (put in every cosmetic/OTC output)

Actives that treat a condition (anti-dandruff, anti-eczema) are frequently
regulated as **OTC drugs or restricted cosmetic ingredients**, and allowed
concentrations, permitted claims, and required warnings differ by region
(e.g. EU CosIng / Regulation 1223/2009, US FDA OTC monographs). Zinc pyrithione,
ketoconazole, selenium sulfide, coal tar, salicylic acid and similar are
examples with region-specific rules and caps. Present concentrations as
literature values to verify against the destination market's regulations — not
as compliant, safe, or approved. "Soothing/anti-eczema" wording may constitute a
drug claim; flag that therapeutic claims require the appropriate registration.
