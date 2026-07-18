"""FormuLab v2 orchestrator — direct pipeline, no OpenCode agent loop.

brief -> safety gate -> deterministic constraints -> cache-first retrieval ->
ONE LLM call (N candidate formulas as JSON) -> validate each against the hard
avoid-list -> optional cost-optimize -> render N formulation cards (v1..vN).

No sidecar, no SSE, no tool loop: a single request/response the desktop app
invokes and renders.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Callable, Dict, List

import llm
import literature_cache
from rules import derive_constraints, validate

# Hazardous / illicit classes the app must refuse (safety gate).
FORBIDDEN = [
    "explosive", "energetic material", "detonat", "tnt", "rdx", "nitroglycer",
    "chemical weapon", "nerve agent", "sarin", "vx", "mustard gas", "toxin",
    "bioweapon", "pathogen weapon", "methamphetamine", "cocaine", "heroin", "fentanyl",
    "mdma", "lsd", "controlled substance", "poison to harm", "nerve gas",
]


def safety_gate(target: str) -> str | None:
    t = (target or "").lower()
    for bad in FORBIDDEN:
        if bad in t:
            return (f"Refused: the target appears to involve a prohibited class "
                    f"('{bad}'). FormuLab only designs lawful consumer/industrial products.")
    return None


def build_queries(brief: Dict[str, Any]) -> List[str]:
    target = str(brief.get("target", "")).strip()
    cat = str(brief.get("category", "")).strip()
    base = target if target else cat
    q = f"{base} formulation ingredients"
    return [q]


def _system_prompt(constraints: Dict[str, Any], n: int) -> str:
    p = constraints["profile"]
    avoid = ", ".join(constraints["avoid"]) or "none"
    prefer = ", ".join(constraints["prefer"]) or "none"
    req = ", ".join(constraints["require_functions"]) or "none"
    ph = constraints["target_ph"] or "appropriate for the product class"
    rules_txt = " ".join(constraints["reasons"])
    return f"""You are a formulation chemist. From the provided open-access literature abstracts and
established cosmetic/detergent science, propose {n} DISTINCT, evidence-based candidate formulas
for the product. Return STRICT JSON only.

HARD RULES (must be obeyed in every formula):
- Region: {p['display']} — water hardness {p['water_hardness']}, climate {p['climate']}, {p['notes']}
- MUST NOT contain any of these (excluded ingredients): {avoid}
- Required functions present: {req}
- Prefer where suitable: {prefer}
- Target pH: {ph}
- {rules_txt}

Each formula MUST be complete for the product class (e.g. a shampoo: cleansing system, actives,
rheology, preservative, chelator, pH control, water q.s. to 100). Give a SINGLE EXACT weight-%
per ingredient (not a range); the column sums to 100 with Water (Aqua) as "q.s. 100".

JSON schema:
{{"formulas": [{{
  "name": "...", "purpose": "one sentence with key claims",
  "references": [{{"author":"...","year":"...","doi":"..."}}],
  "ingredients": [{{"inci":"Water (Aqua)","function":"Solvent","weight_pct":"q.s. 100"}}, ...],
  "how_it_works": [{{"title":"...","text":"... with citations ..."}}],
  "avoid": [{{"item":"...","reason":"..."}}],
  "usage": ["step 1", "step 2"],
  "warnings": ["...", "..."]
}}]}}
Make the {n} formulas genuinely different (e.g. different active systems), each obeying every hard rule."""


def _paper_context(papers: List[Dict[str, Any]], limit: int = 15) -> str:
    lines = []
    for p in papers[:limit]:
        ab = (p.get("abstract") or "")[:600]
        lines.append(f"- [{p.get('source_db','')}] {p.get('title','')} "
                     f"(DOI:{p.get('doi','')}, {p.get('year','')}). {ab}")
    return "\n".join(lines)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "product").lower()).strip("-")[:48] or "product"


def render_card(formula: Dict[str, Any], violations: List[str]) -> str:
    md = [f"# Formulation Card: {formula.get('name','Candidate')}", ""]
    md.append(f"**Purpose:** {formula.get('purpose','')}")
    md.append("")
    refs = "; ".join(
        f"{r.get('author','')} {r.get('year','')} (DOI:{r.get('doi','')})".strip()
        for r in formula.get("references", [])
    )
    if refs:
        md.append(f"**References:** {refs}")
        md.append("")
    md.append("## Formulation Table")
    md.append("")
    md.append("| # | Ingredient (INCI) | Function | Weight % |")
    md.append("|---|---|---|---|")
    for i, ing in enumerate(formula.get("ingredients", []), 1):
        md.append(f"| {i} | {ing.get('inci','')} | {ing.get('function','')} | {ing.get('weight_pct','')} |")
    md.append("")
    if formula.get("how_it_works"):
        md.append("## How It Works")
        md.append("")
        for sec in formula["how_it_works"]:
            md.append(f"### {sec.get('title','')}")
            md.append(sec.get("text", ""))
            md.append("")
    if formula.get("avoid"):
        md.append("## What to Avoid")
        for a in formula["avoid"]:
            md.append(f"- ❌ {a.get('item','')} — {a.get('reason','')}")
        md.append("")
    if formula.get("usage"):
        md.append("## Usage")
        for i, s in enumerate(formula["usage"], 1):
            md.append(f"{i}. {s}")
        md.append("")
    md.append("## ⚠️ Warnings")
    for w in formula.get("warnings", []):
        md.append(f"- {w}")
    md.append("- Evidence-based candidate, not a validated commercial product; lab validation required.")
    if violations:
        md.append("")
        md.append("> ⚠️ Rule check found issues that were auto-corrected or need review: "
                  + "; ".join(violations))
    return "\n".join(md)


def run(
    brief: Dict[str, Any],
    provider: str,
    model: str,
    api_key: str,
    library: str,
    out_dir: str,
    n: int = 3,
    llm_call: Callable[..., str] = llm.call,
    log: Callable[[str], None] = lambda m: None,
) -> Dict[str, Any]:
    """Run the full pipeline. Returns {status, cards:[{version, markdown, formula}], ...}."""
    target = str(brief.get("target", "")).strip()
    if not target:
        return {"status": "error", "message": "no target product given"}

    refusal = safety_gate(target)
    if refusal:
        return {"status": "refused", "message": refusal}

    constraints = derive_constraints(brief)
    os.makedirs(out_dir, exist_ok=True)
    lit_dir = os.path.join(out_dir, "literature")
    papers = literature_cache.gather(build_queries(brief), lit_dir, library, target=15, log=log)
    log(f"literature ready: {len(papers)} papers")

    system = _system_prompt(constraints, n)
    user = (f"PRODUCT BRIEF: {json.dumps(brief, ensure_ascii=False)}\n\n"
            f"OPEN-ACCESS LITERATURE (titles + abstracts):\n{_paper_context(papers)}")

    try:
        raw = llm_call(provider=provider, model=model, api_key=api_key, system=system, user=user)
        data = llm.parse_json(raw)
    except Exception as e:
        return {"status": "error", "message": f"model call failed: {e}"}

    formulas = data.get("formulas") or ([data] if data.get("ingredients") else [])
    if not formulas:
        return {"status": "error", "message": "model returned no formulas"}

    cards = []
    for idx, f in enumerate(formulas[:n], 1):
        ingredients = [str(i.get("inci", "")) for i in f.get("ingredients", [])]
        violations = validate(ingredients, constraints)
        md = render_card(f, violations)
        version = f"v{idx}"
        with open(os.path.join(out_dir, f"formulation-card-{version}.md"), "w", encoding="utf-8") as fh:
            fh.write(md)
        cards.append({"version": version, "markdown": md, "formula": f, "violations": violations})

    with open(os.path.join(out_dir, "brief.json"), "w", encoding="utf-8") as fh:
        json.dump({"brief": brief, "constraints_reasons": constraints["reasons"]}, fh, ensure_ascii=False, indent=2)

    return {"status": "ok", "cards": cards, "slug": _slug(target), "papers": len(papers)}
