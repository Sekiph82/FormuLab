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
in one call; only open endpoints, only OA full text is downloaded.

```bash
python discover.py "sulfate-free gentle shampoo formulation" \
    "mild surfactant baby shampoo" "shampoo preservative system" --max 40 --pdfs
```

Writes `literature/papers.csv` + `papers.json` (with a `source_db` column so
patents and journals are distinguishable). Use several queries — one per
function you expect (cleansing base, each active, thickener, preservative, …).

### 2. Read & extract

From the OA papers/patents, pull — **with a citation (DOI or patent id) per
fact** — each ingredient, its **function** (surfactant, emulsifier, active,
preservative, chelator, builder, abrasive, thickener, pH adjuster, fragrance,
…), and any reported **wt% / w/w**. Note the study type. Do not paste long
verbatim text; extract the data and cite.

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

### 5. Report — show it in full

Output the **complete formulation card in your reply** — do NOT shorten or
summarize it to a few lines. The reply and the saved file must match. Save it as
`<product-slug>/formulation-card.md` and include:

- the final **wt% per ingredient** and the total (water q.s. to 100%);
- the **rationale with citations**;
- **assumptions / estimated ranges** and a **confidence** note;
- a **regulatory + safety** section for the target market;
- the cost-optimization result;
- an explicit **"needs lab validation"** line.

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
