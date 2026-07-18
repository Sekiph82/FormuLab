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
import time
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


# Product classes whose "base system" is a cleansing/surfactant problem vs. a
# different core technology — the retrieval angle differs accordingly.
_CLEANSING = ("shampoo", "body wash", "bar soap", "dishwashing", "detergent",
              "surface cleaner", "glass cleaner", "hand wash", "cleanser")
_ORAL = ("toothpaste", "mouthwash")
_LEAVE_ON = ("cream", "lotion", "conditioner", "serum", "balm", "softener")


# Qualifiers that narrow a product name past what a literature index can match
# ("shampoo for eczema-prone scalp" -> "shampoo"). The angle terms re-add focus.
_FILLER = {"for", "with", "without", "free", "prone", "and", "or", "the", "a", "an",
           "my", "our", "type", "kind", "use", "used", "very", "extra", "super"}


def _head(name: str, max_words: int = 3) -> str:
    """The searchable core of a product name: first few content words."""
    words = [w for w in re.findall(r"[A-Za-z0-9-]+", name or "") if w.lower() not in _FILLER]
    return " ".join(words[:max_words]) or "product"


def build_queries(brief: Dict[str, Any], constraints: Dict[str, Any] | None = None) -> List[str]:
    """Plan several retrieval angles instead of one catch-all query.

    A single query ("<target> formulation ingredients") returns one narrow slice
    and lets the first source fill the whole quota. Real formulation evidence is
    spread across distinct questions — the active's efficacy, the base system,
    preservation, the regional water/climate constraint, safety — so we ask each
    separately and let the cache layer spread the budget across them.

    Deterministic on purpose: no extra LLM call, no added latency, and the same
    brief always plans the same angles.
    """
    target = str(brief.get("target", "")).strip()
    cat = str(brief.get("category", "")).strip()
    catl = f"{cat} {target}".lower()

    # Keep queries SHORT. These APIs match conjunctively: a five-concept query
    # like "limescale remover for kettles formulation ingredients" returns zero
    # hits, while "limescale removal" returns solid ones. So each angle is the
    # product head plus ONE distinguishing term.
    head = _head(cat if cat and cat != "auto-detect" else target)

    queries: List[str] = [head]

    # 1. Does the active/claim work?
    queries.append(f"{head} efficacy")

    # 2. The base system — what the product is mostly made of.
    if any(k in catl for k in _CLEANSING):
        queries.append(f"{head} surfactant")
    elif any(k in catl for k in _ORAL):
        queries.append(f"{head} abrasive fluoride")
    elif any(k in catl for k in _LEAVE_ON):
        queries.append(f"{head} emulsion stability")
    else:
        queries.append(f"{head} raw materials")

    # 3. Preservation + shelf life.
    queries.append(f"{head} preservative")

    if constraints:
        p = constraints.get("profile") or {}
        # 4. The regional constraint that actually changes the formula.
        if p.get("water_hardness") in ("hard", "very_hard"):
            queries.append(f"{head} hard water")
        if p.get("climate") in ("hot_humid", "hot_dry", "tropical"):
            queries.append(f"{head} thermal stability")
        # 5. Safety angle for sensitive/child/medicated targets.
        if constraints.get("sensitive"):
            queries.append(f"{head} skin irritation")

    # Dedup, preserve order, keep the budget sane.
    seen: set = set()
    out: List[str] = []
    for q in queries:
        k = " ".join(q.lower().split())
        if k and k not in seen:
            seen.add(k)
            out.append(" ".join(q.split()))
    return out[:6]


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


def archive_formulas(
    formulas_dir: str,
    cards: List[Dict[str, Any]],
    brief: Dict[str, Any],
    slug: str,
    session_id: str,
) -> List[str]:
    """Copy every produced card into the flat formula library and index it.

    The library is the one place that holds EVERY formula ever generated, across
    sessions: `<date>-<slug>-<version>.md` plus an `index.json` describing each
    entry so the set stays browsable without opening the files.
    """
    os.makedirs(formulas_dir, exist_ok=True)
    index_path = os.path.join(formulas_dir, "index.json")
    try:
        with open(index_path, encoding="utf-8") as fh:
            index = json.load(fh)
    except Exception:
        index = []

    date = time.strftime("%Y-%m-%d")
    created = time.strftime("%Y-%m-%d %H:%M:%S")
    written: List[str] = []
    for card in cards:
        version = card["version"]
        name = f"{date}-{slug}-{version}.md"
        path = os.path.join(formulas_dir, name)
        # Same product formulated twice in a day: keep both, newest suffixed.
        if os.path.exists(path):
            name = f"{date}-{slug}-{version}-{int(time.time())}.md"
            path = os.path.join(formulas_dir, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(card["markdown"])
        written.append(name)

        formula = card.get("formula", {}) or {}
        index.append({
            "file": name,
            "name": formula.get("name", ""),
            "target": brief.get("target", ""),
            "category": brief.get("category", ""),
            "market": brief.get("market", ""),
            "version": version,
            "created": created,
            "session": session_id,
            "ingredients": len(formula.get("ingredients", []) or []),
            "violations": card.get("violations", []),
        })

    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)
    return written


def run(
    brief: Dict[str, Any],
    provider: str,
    model: str,
    api_key: str,
    library: str,
    out_dir: str,
    n: int = 3,
    formulas_dir: str | None = None,
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
    queries = build_queries(brief, constraints)
    log(f"planned {len(queries)} retrieval angles")
    # Anchor every retrieved paper to the product itself, so an angle query can
    # sharpen the search without drifting off-domain.
    anchor = f"{brief.get('target', '')} {brief.get('category', '')}"
    papers = literature_cache.gather(
        queries, lit_dir, library, target=15, anchor=anchor, log=log,
    )
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

    # A card is only "evidence-based" if evidence was actually retrieved. When
    # retrieval comes back empty the formula rests on the model's general
    # knowledge alone — say so on the card instead of implying citations exist.
    unevidenced = not papers
    if unevidenced:
        log("[warn] no literature retrieved — cards will be marked as not literature-grounded")

    cards = []
    for idx, f in enumerate(formulas[:n], 1):
        ingredients = [str(i.get("inci", "")) for i in f.get("ingredients", [])]
        violations = validate(ingredients, constraints)
        if unevidenced:
            f = dict(f)
            f["warnings"] = list(f.get("warnings") or []) + [
                "No open-access literature was found for this product, so this "
                "formulation reflects general formulation science only — it is "
                "NOT grounded in retrieved sources, and any references shown "
                "should be verified independently.",
            ]
        md = render_card(f, violations)
        version = f"v{idx}"
        with open(os.path.join(out_dir, f"formulation-card-{version}.md"), "w", encoding="utf-8") as fh:
            fh.write(md)
        cards.append({"version": version, "markdown": md, "formula": f, "violations": violations})

    with open(os.path.join(out_dir, "brief.json"), "w", encoding="utf-8") as fh:
        json.dump({"brief": brief, "constraints_reasons": constraints["reasons"]}, fh, ensure_ascii=False, indent=2)

    slug = _slug(target)
    archived: List[str] = []
    if formulas_dir:
        try:
            archived = archive_formulas(
                formulas_dir, cards, brief, slug, os.path.basename(out_dir.rstrip("/\\")),
            )
            log(f"archived {len(archived)} formula(s) to the library")
        except Exception as e:
            # The library is a convenience copy — never fail a good run over it.
            log(f"[warn] could not archive to the formula library: {e}")

    return {"status": "ok", "cards": cards, "slug": slug,
            "papers": len(papers), "archived": archived}
