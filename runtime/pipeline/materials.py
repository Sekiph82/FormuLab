"""The customer's raw materials, imported via the legacy Settings -> General
CSV/TSV screen (`MaterialsCard.tsx`) — a quick, ad-hoc material entry path
kept deliberately separate from the canonical Material Master
(`data/master/*.json`, read via `master_materials_adapter.py` for AI
generation as of FVL-03.002).

FVL-03.003 retired this module's own costing arithmetic
(`cost_formula()`/`render_costing_markdown()`): the single authoritative
Cost Engine is `packages/shared/src/engine/cost.ts`, called client-side.
This module now does exactly one job — import a raw-material list into one
canonical shape for `materials_cli.py`'s `"import"`/`"list"` actions.

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
