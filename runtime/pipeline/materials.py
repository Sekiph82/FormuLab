"""The customer's raw materials, and what a formula costs to make from them.

Two jobs:

  1. Import a raw-material list (CSV/TSV, whatever column names the supplier
     used) into one canonical shape.
  2. Cost a formulation against it: match each ingredient to a material, apply
     the customer's own price, and produce a costing sheet.

Money is arithmetic, never model output. The LLM proposes a formula; the cost
of that formula is computed here from the customer's prices, so the number on
the sheet can be checked by hand.

ERP note: every material carries a stable `material_id` and an optional
`external_ref`. When this app is later fed by an ERP item master, the ERP's
item code goes in `external_ref` and nothing else about the schema changes.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import time
from typing import Any, Dict, List

SCHEMA_VERSION = 1

# Supplier sheets never agree on column names. Map the ones we've seen onto the
# canonical field; matching is case/space/punctuation-insensitive.
_ALIASES: Dict[str, tuple] = {
    "name": ("name", "material", "materialname", "rawmaterial", "tradename",
             "product", "description", "hammadde", "malzeme", "urun"),
    "inci": ("inci", "inciname", "chemicalname", "chemical", "ingredient"),
    "cas": ("cas", "casno", "casnumber", "casrn"),
    "price": ("price", "unitprice", "cost", "unitcost", "priceperkg", "kgprice",
              "fiyat", "birimfiyat", "kgfiyat"),
    "currency": ("currency", "cur", "ccy", "parabirimi", "kur"),
    "unit": ("unit", "uom", "unitofmeasure", "birim"),
    "supplier": ("supplier", "vendor", "manufacturer", "tedarikci", "uretici"),
    "stock": ("stock", "qty", "quantity", "onhand", "stok", "miktar"),
    "function": ("function", "role", "category", "type", "islev", "gorev"),
    "external_ref": ("externalref", "erpcode", "itemcode", "sku", "code",
                     "materialcode", "stokkodu", "urunkodu"),
}


def _norm(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (header or "").lower())


def _canonical(header: str) -> str | None:
    n = _norm(header)
    for field, aliases in _ALIASES.items():
        if n in aliases:
            return field
    return None


def _number(text: Any) -> float | None:
    """Parse a price the way a spreadsheet writes one.

    Handles "12,50" (comma decimal), "1.234,56" and "1,234.56" (either
    thousands convention) and stray currency symbols, because a misread price
    silently corrupts every cost that follows.
    """
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    s = re.sub(r"[^\d,.\-]", "", str(text)).strip()
    if not s:
        return None
    if "," in s and "." in s:
        # Whichever separator is last is the decimal point.
        s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def material_id(row: Dict[str, Any], i: int) -> str:
    base = (row.get("external_ref") or row.get("cas") or row.get("inci")
            or row.get("name") or f"material-{i}")
    return re.sub(r"[^a-z0-9]+", "-", str(base).lower()).strip("-")[:60] or f"material-{i}"


def parse_materials(text: str) -> tuple[List[Dict[str, Any]], List[str]]:
    """Parse a delimited raw-material file. Returns (materials, warnings)."""
    warnings: List[str] = []
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        return [], ["the file has no header row"]

    mapping = {h: _canonical(h) for h in reader.fieldnames}
    if "name" not in mapping.values() and "inci" not in mapping.values():
        warnings.append("no name/INCI column recognised — materials cannot be matched")
    if "price" not in mapping.values():
        warnings.append("no price column recognised — costing will be unavailable")

    out: List[Dict[str, Any]] = []
    for i, raw in enumerate(reader):
        row: Dict[str, Any] = {}
        for header, value in raw.items():
            field = mapping.get(header)
            if field and value not in (None, ""):
                row[field] = value.strip() if isinstance(value, str) else value
        if not row.get("name") and not row.get("inci"):
            continue
        price = _number(row.get("price"))
        if row.get("price") is not None and price is None:
            warnings.append(f"row {i + 2}: could not read the price {row.get('price')!r}")
        out.append({
            "material_id": material_id(row, i),
            "name": row.get("name") or row.get("inci"),
            "inci": row.get("inci") or row.get("name"),
            "cas": row.get("cas", ""),
            "price": price,
            "currency": (row.get("currency") or "").upper(),
            "unit": (row.get("unit") or "kg").lower(),
            "supplier": row.get("supplier", ""),
            "stock": _number(row.get("stock")),
            "function": row.get("function", ""),
            # Reserved for an ERP item code; empty until this app is fed by one.
            "external_ref": row.get("external_ref", ""),
        })
    return out, warnings


# ------------------------------------------------------------------ storage ---

def store_path(data_dir: str) -> str:
    return os.path.join(data_dir, "materials.json")


def load_materials(data_dir: str) -> Dict[str, Any]:
    try:
        with open(store_path(data_dir), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"schema_version": SCHEMA_VERSION, "updated": "", "currency": "",
                "materials": []}


def save_materials(data_dir: str, materials: List[Dict[str, Any]]) -> Dict[str, Any]:
    os.makedirs(data_dir, exist_ok=True)
    currencies = {m["currency"] for m in materials if m.get("currency")}
    doc = {
        "schema_version": SCHEMA_VERSION,
        "updated": time.strftime("%Y-%m-%d %H:%M:%S"),
        # One currency across the list keeps totals meaningful; a mixed list is
        # reported rather than silently summed.
        "currency": currencies.pop() if len(currencies) == 1 else "",
        "mixed_currencies": sorted(currencies) if len(currencies) > 1 else [],
        "materials": materials,
    }
    with open(store_path(data_dir), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
    return doc


# ----------------------------------------------------------------- matching ---

# Grade/quality words only. "water" and "aqua" are NOT noise — they are the
# ingredient, and stripping them left "Water (Aqua)" as an empty string that
# matched nothing, so every formula silently lost its largest line.
_NOISE = re.compile(r"\b(usp|bp|ep|grade|pure|extra|tech|technical|"
                    r"pharma|cosmetic|food)\b", re.I)

# Materials that every supplier names differently but everyone means the same
# thing by. Without this, "Demineralised Water" and "Water (Aqua)" share only
# the token "water" and fall below the two-token matching floor.
_SYNONYMS = {
    "water": {"water", "aqua", "demineralised water", "demineralized water",
              "deionised water", "deionized water", "purified water",
              "distilled water", "di water", "water aqua", "aqua water"},
}


def _key(text: str) -> str:
    t = _NOISE.sub(" ", (text or "").lower())
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def _synonym_group(key: str) -> str | None:
    for group, names in _SYNONYMS.items():
        if key in names:
            return group
    return None


def match_material(ingredient: str, materials: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    """Find the material a formula ingredient refers to.

    Exact INCI/name first, then a containment match, then best token overlap.
    Deliberately conservative: a wrong match produces a confidently wrong price,
    which is worse than reporting the ingredient as unmatched.
    """
    want = _key(ingredient)
    if not want:
        return None
    for m in materials:  # exact
        if _key(m.get("inci", "")) == want or _key(m.get("name", "")) == want:
            return m
    # Same substance under a different trade name (water, above all).
    group = _synonym_group(want)
    if group:
        for m in materials:
            if any(_synonym_group(_key(m.get(f, ""))) == group for f in ("inci", "name")):
                return m
    for m in materials:  # one contains the other
        for field in ("inci", "name"):
            k = _key(m.get(field, ""))
            if k and (k in want or want in k):
                return m
    best, best_score = None, 0
    want_tokens = set(want.split())
    for m in materials:
        tokens = set(_key(m.get("inci", "")).split()) | set(_key(m.get("name", "")).split())
        overlap = len(want_tokens & tokens)
        if overlap > best_score:
            best, best_score = m, overlap
    # Two shared words is the floor: one shared word ("sodium", "acid") pairs
    # unrelated chemicals.
    return best if best_score >= 2 else None


# ------------------------------------------------------------------ costing ---

def _weight_pct(value: Any) -> float | None:
    """A weight-% cell. 'q.s. 100' means 'make up the remainder', not 100%."""
    s = str(value or "").strip().lower()
    if "q.s" in s or "qs " in s or s == "qs":
        return None
    return _number(s)


def cost_formula(
    formula: Dict[str, Any],
    materials: List[Dict[str, Any]],
    batch_kg: float = 100.0,
    currency: str = "",
) -> Dict[str, Any]:
    """Cost one formula against the customer's own prices.

    Returns a costing sheet: a line per ingredient with its weight, matched
    material, unit price and line cost, plus totals. Ingredients with no matched
    material or no price are listed with a reason and excluded from the total —
    the total then states how much of the formula it actually covers, so a
    partial costing can never read as complete.
    """
    lines: List[Dict[str, Any]] = []
    covered_pct = 0.0
    total = 0.0

    ingredients = formula.get("ingredients") or []
    known_pct = sum(p for p in (_weight_pct(i.get("weight_pct")) for i in ingredients)
                    if p is not None)

    for ing in ingredients:
        name = str(ing.get("inci") or ing.get("name") or "").strip()
        pct = _weight_pct(ing.get("weight_pct"))
        # "q.s. 100" carries the balance of the formula.
        if pct is None:
            pct = max(0.0, 100.0 - known_pct)
            qs = True
        else:
            qs = False

        kg = batch_kg * pct / 100.0
        m = match_material(name, materials)
        price = (m or {}).get("price")

        line: Dict[str, Any] = {
            "ingredient": name,
            "function": ing.get("function", ""),
            "weight_pct": round(pct, 4),
            "qs": qs,
            "kg": round(kg, 4),
            "material_id": (m or {}).get("material_id", ""),
            "matched_name": (m or {}).get("name", ""),
            "supplier": (m or {}).get("supplier", ""),
            "unit_price": price,
            "currency": (m or {}).get("currency", "") or currency,
            "external_ref": (m or {}).get("external_ref", ""),
        }
        if m is None:
            line["cost"], line["note"] = None, "no matching material in your list"
        elif price is None:
            line["cost"], line["note"] = None, "material has no price"
        else:
            line["cost"] = round(kg * price, 4)
            total += line["cost"]
            covered_pct += pct
        lines.append(line)

    return {
        "batch_kg": batch_kg,
        "currency": currency or next((l["currency"] for l in lines if l["currency"]), ""),
        "lines": lines,
        "total_cost": round(total, 4),
        "cost_per_kg": round(total / batch_kg, 4) if batch_kg else 0.0,
        # What share of the formula's mass the total actually accounts for.
        "covered_pct": round(covered_pct, 2),
        "complete": round(covered_pct, 2) >= 99.5,
        "unmatched": [l["ingredient"] for l in lines if l["cost"] is None],
    }


def _money(value: float) -> str:
    """Money with thousands separators and two decimals.

    A general format renders a 14,472 TRY total as "1.447e+04", which is not a
    number anyone can act on.
    """
    return f"{value:,.2f}"


def _qty(value: float) -> str:
    """Quantities keep more precision — a 0.3% ingredient is grams, not units."""
    return f"{value:,.4f}".rstrip("0").rstrip(".") if value else "0"


def render_costing_markdown(sheet: Dict[str, Any], title: str = "") -> str:
    cur = sheet.get("currency") or ""
    md = [f"# Costing sheet{f': {title}' if title else ''}", ""]
    md.append(f"**Batch:** {sheet['batch_kg']:g} kg")
    md.append("")
    md.append(f"| # | Ingredient | Weight % | kg | Unit price ({cur}/kg) | Line cost ({cur}) | Supplier |")
    md.append("|---|---|---|---|---|---|---|")
    for i, l in enumerate(sheet["lines"], 1):
        price = _money(l["unit_price"]) if l["unit_price"] is not None else "—"
        cost = _money(l["cost"]) if l["cost"] is not None else f"— ({l.get('note','')})"
        pct = f"{l['weight_pct']:g}{' (q.s.)' if l['qs'] else ''}"
        md.append(f"| {i} | {l['ingredient']} | {pct} | {_qty(l['kg'])} | {price} | {cost} | {l['supplier']} |")
    md.append("")
    md.append(f"**Total batch cost:** {_money(sheet['total_cost'])} {cur}")
    md.append(f"**Cost per kg:** {_money(sheet['cost_per_kg'])} {cur}")
    if not sheet["complete"]:
        md.append("")
        md.append(f"> ⚠️ This total covers {sheet['covered_pct']:g}% of the formula by weight. "
                  f"Unpriced: {', '.join(sheet['unmatched'])}. Add these to your material "
                  f"list to get a complete cost.")
    return "\n".join(md)
