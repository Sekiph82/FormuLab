"""Local formulation corpus: the primary source for the formulation-discovery skill.

Reads the project's imported formula PDFs (supplier field formulas, and owner-purchased
handbook formulas where no supplier covers the family) from `data/master` and returns,
for the requested product, the reviewed formulas of that product family as complete
printed recipes, plus how often each raw material appears and at what amount. Every
line cites its formula PDF (supplier, title, page, document SHA-256). Nothing is
invented: a value a PDF does not print stays empty.

Usage:
    python local_corpus.py "shampoo" [--data <project>/data/master] [--max 15] [--out literature]
Writes <out>/local_formulas.json and prints a short summary.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

PIPELINE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "pipeline"))
sys.path.insert(0, PIPELINE)

from master_materials_adapter import load_master_materials  # noqa: E402
from reference_formulation_prior_adapter import _array, _current, build_authoritative_guidance  # noqa: E402


def find_master_dir(start: str) -> str | None:
    """The nearest `data/master` holding a formula corpus, from `start` upward."""
    here = os.path.abspath(start)
    while True:
        candidate = os.path.join(here, "data", "master")
        if os.path.isfile(os.path.join(candidate, "reference_formulations.json")):
            return candidate
        parent = os.path.dirname(here)
        if parent == here:
            return None
        here = parent


def _raw(line: dict[str, Any], field: str) -> str:
    item = line.get(field)
    return str(item.get("rawValue") or "") if isinstance(item, dict) else ""


def local_formulas(master_dir: str, product: str, limit: int = 15) -> dict[str, Any]:
    """Reviewed formulas of the product's family and their ingredient statistics."""
    guidance = build_authoritative_guidance(master_dir, {"targetProductType": product}, load_master_materials(master_dir)) or {}
    priors = guidance.get("ingredientPriors", [])
    uses: dict[str, int] = {}
    for prior in priors:
        for source_id in prior.get("sourceRecordIds", []):
            uses[source_id] = uses.get(source_id, 0) + 1
    by_id = {row.get("id"): row for row in _current(_array(master_dir, "reference_formulations")) if row.get("id") in uses}
    # Formulas sharing the most reviewed ingredients with the family come first.
    chosen = sorted(by_id.values(), key=lambda row: (-uses[row["id"]], str(row["id"])))[:limit]
    formulas = [{
        "id": row["id"],
        "title": row.get("source", {}).get("title"),
        "supplierId": row.get("source", {}).get("supplierId"),
        "originalFilename": row.get("source", {}).get("originalFilename"),
        "sourceDocumentSha256": row.get("sourceDocumentHash"),
        "lines": [{
            "phase": _raw(line, "phase"), "ingredient": _raw(line, "ingredientName"),
            "inci": _raw(line, "inciOrChemicalName"), "function": _raw(line, "function"),
            "amount": _raw(line, "amount"),
            "amountHeader": ((line.get("amount") or {}).get("evidence") or {}).get("header"),
            "page": line.get("pageNumber"),
        } for line in row.get("ingredientLines", [])],
    } for row in chosen]
    ingredients = [{
        "material": prior.get("materialName"), "materialCode": prior.get("materialCode"),
        "formulaCount": prior.get("formulaCount"), "eligibleFormulaCount": prior.get("eligibleFormulaCount"),
        "supplierCount": prior.get("supplierCount"),
        "typicalPercent": (prior.get("dosageGuidance") or [{}])[0].get("typicalRangePercent"),
        "observedPercent": (prior.get("dosageGuidance") or [{}])[0].get("observedRangePercent"),
    } for prior in sorted(priors, key=lambda prior: -prior.get("formulaCount", 0))]
    return {"productFamilyKey": guidance.get("productFamilyKey"), "eligibleFormulaCount": guidance.get("eligibleFormulaCount", 0),
            "supplierCount": guidance.get("supplierCount", 0), "handbookOnly": bool(guidance.get("handbookOnly")),
            "formulas": formulas, "ingredients": ingredients,
            "interpretation": "reviewed supplier field formulas: precedent for ingredients and amounts, not measured validation"}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("product")
    parser.add_argument("--data", default=None, help="path to <project>/data/master (default: found upward from here)")
    parser.add_argument("--max", type=int, default=15)
    parser.add_argument("--out", default="literature")
    args = parser.parse_args(argv)
    master_dir = args.data or find_master_dir(os.getcwd()) or find_master_dir(os.path.dirname(__file__))
    if not master_dir:
        print("No local formula corpus found (data/master/reference_formulations.json).", file=sys.stderr)
        return 2
    result = local_formulas(master_dir, args.product, args.max)
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "local_formulas.json"), "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    print(f"{result['eligibleFormulaCount']} reviewed {result['productFamilyKey']} formulas from {result['supplierCount']} "
          f"supplier(s){' (handbook only)' if result['handbookOnly'] else ''}; {len(result['formulas'])} written, "
          f"{len(result['ingredients'])} mapped raw materials -> {os.path.join(args.out, 'local_formulas.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
