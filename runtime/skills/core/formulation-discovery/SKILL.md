---
name: formulation-discovery
description: Use when the user wants a chemical formulation PROPOSED from the literature rather than optimizing a formula they already have — "find me a formula for X", "design a Z product", "what should go in a Y". Works for household and personal-care products (shampoo, laundry detergent, fabric softener, toothpaste, limescale remover, surface cleaner, dish soap, hand cream, …). Retrieves open-access papers and patents, extracts ingredients/functions/concentrations with citations, synthesizes an evidence-based candidate formula, cost-optimizes it, and returns the full report. For a formula the user already has, use formulation-optimizer directly.
---

# Formulation discovery (literature → candidate formula)

Turn a product brief ("a sulfate-free gentle shampoo for children") into an
**evidence-based candidate formulation**, cost-optimized, with citations. This
is an R&D assistant that surfaces what the published science supports — **not**
a validated recipe and not a substitute for a qualified chemist or regulatory
review.

## Safety gate — check FIRST

Proceed only for ordinary, lawful consumer/industrial products: cosmetics,
personal care, cleaning, coatings, food, textiles, lawful agrochemicals, and
similar. **Refuse** — do not retrieve, extract, or propose — when the target is
or plausibly enables explosives or energetic materials; chemical/biological
weapons, toxins, or precursors; illicit drugs or controlled substances; poisons
meant to harm; or any synthesis whose primary use is to injure. If ambiguous,
ask the user to confirm the lawful use first.

## Input (the brief)

The app sends a structured brief: **target product**, optional **category**,
**intended audience** (child / woman / man / unisex / unspecified), **target
market / regulations**, **max cost**, **performance requirements**, and any
**on-hand raw materials**. Honor whatever is set; where a field is unspecified,
do not invent a constraint. Adapt to the audience when given (e.g. *child* →
milder surfactants, fragrance-free / low-fragrance, tear-free where relevant,
tighter safety limits).

## Pipeline — run every step

### 1. Retrieve (open access only)

`discover.py` queries **OpenAlex + Europe PMC (PubMed/PMC + patents) + arXiv**
in one call; only open endpoints.

**Fast mode is always on. Do NOT download PDFs; work from titles + abstracts.**
Retrieve **at least 15 papers** so the evidence base is solid, using ONE
combined query (add a second query only for a multi-active product):

```bash
python discover.py "sulfate-free gentle shampoo formulation surfactant preservative" --max 15
```

Do NOT re-paste whole abstracts into the reply — extract only the
ingredient/function/wt% facts you need and cite the DOI.

Writes `literature/papers.csv` + `papers.json` (with a `source_db` column so
patents and journals are distinguishable). Raise `--max` further only if the
first pass returns too few relevant hits.

### 2. Read & extract

Work from the **abstracts already in `papers.json`** — that is enough; do not
open or read full PDFs, and do not loop over papers one by one. In a single
pass, pull — **with a citation (DOI or patent id) per fact** — each ingredient,
its **function** (surfactant, emulsifier, active, preservative, chelator,
builder, abrasive, thickener, pH adjuster, fragrance, …), and any reported
**wt% / w/w**. Combine with established cosmetic/detergent formulation knowledge
for the product class; move straight to the card. Do not paste long verbatim
text; extract the data and cite. Be efficient — favor finishing the card over
extra tool calls.

### 3. Synthesize the candidate

Build a table: `ingredient | function | wt%-range | evidence (DOI/patent) |
confidence`. Group by function so the recipe is COMPLETE for the product class
(a shampoo needs cleansing + actives + rheology + preservative + chelator + pH +
water q.s.; a detergent needs surfactants + builders + enzymes + anti-redeposition
+ …). Mark estimated numbers and thin evidence explicitly.

### 4. Cost-optimize

Turn the numeric parts into an instance and call **formulation-optimizer**:

```bash
python ../formulation-optimizer/optimize.py candidate.json
```

Use the user's on-hand materials and max cost when provided.

### 5. Report — the formulation card

Output the **complete card in your reply** (in English) — do NOT shorten or
summarize it. The reply and the saved file must be identical; save it as
`<product-slug>/formulation-card.md`.

**Give a single EXACT weight-% for every ingredient — never a range.** Choose
the value within the literature range, and make the column sum to 100% with
Water (Aqua) as `q.s. 100`. Follow this exact structure and headings:

```markdown
# Formulation Card: <Product Name>

**Purpose:** <one sentence: what it does and its key claims (e.g. SLS-free, fragrance-free)>

**References:** <Author Year (DOI:...)>, <Author Year (DOI:...)>, ...

## Formulation Table

| # | Ingredient (INCI) | Function | Weight % |
|---|---|---|---|
| 1 | Water (Aqua) | Solvent | q.s. 100 |
| 2 | <INCI> | <function> | 14.0 |
| … | … | … | … |

## How It Works

### <Mechanism group, e.g. Dandruff control>
<why these ingredients, at these exact levels, with citations>

### <Soothing / Mild cleansing / …>
<…>

## What to Avoid
- ❌ <ingredient/class> — <reason>
- ❌ …

## Usage
1. <step>
2. <step>

## ⚠️ Warnings
- Evidence-based candidate, not a commercial product.
- Lab validation (stability, preservative-efficacy, patch testing) is required.
- Therapeutic claims are subject to regional regulation (EU Regulation 1223/2009, FDA OTC monographs).
- <active-specific regulatory note for the target market, incl. Kenya/Africa where relevant>
```

Also print the cost-optimization result (total cost + achieved active) below the
table when materials/prices allow it.

## Honest limits — state these every time

- The proposal is a **candidate grounded in open literature**, not "the one
  correct formula". Commercial formulas are often patented or trade secrets with
  undisclosed exact ratios.
- Papers/patents often give ingredients and roles but **not full wt%
  breakdowns**; estimated numbers are marked with a confidence and a range.
- Every candidate needs **bench validation** (stability, efficacy, preservative
  challenge, patch testing) before it means anything.
- Report the evidence as-is; make no therapeutic/medical claims. A claim to
  *treat* a condition (dandruff, eczema, caries) is usually a **drug/biocidal
  claim** requiring registration — flag it and keep cosmetic wording otherwise.

## Regulatory note (put in every output)

Actives and biocides are frequently **regulated with concentration caps,
permitted-claim limits, and required warnings that differ by region** (EU
Regulation 1223/2009 / CosIng and the Detergents/BPR rules; US FDA OTC
monographs / EPA). Present concentrations as literature values to verify against
the destination market — not as compliant, safe, or approved.
