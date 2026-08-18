"""FormuLab v1 (FVL-03.002) — the canonical Material Master adapter.

Single-authority rule (`docs/FORMULAB_V1_FINAL_SCOPE.md`): the canonical
Material Master is owned entirely by `packages/shared/src/schemas/
materials.ts` / `apps/desktop/src-tauri/src/masterdata.rs`, persisted as
flat JSON arrays under `<project_root>/data/master/*.json`. This module is
a **shape-only** adapter — it reads those same files directly (no new
storage, no new database) and reshapes each active `RawMaterial` row into
the flat dict shape `engine.build_candidate_pool()` already expects,
adding `RawMaterial.code` as real, durable identity alongside the existing
INCI/name text-matching path.

**What this module explicitly does NOT do** (per FVL-03.001's own
"REQUIRED ADAPTER/SEAM" and the single-authority architecture correction):
it never selects "the" current price for a material — `material_price_refs`
below is every matching `MaterialPrice` row, completely unfiltered and
unranked, so no `price`/`currency` key is ever set on an emitted row. That
selection (`packages/shared/src/engine/cost.ts::priceFor()`'s job) stays
exclusively in TypeScript; wiring a real cost result into the generation
path is FVL-03.003's job, calling the real Cost Engine, never a Python
reimplementation. Likewise, supplier identity is preserved as the full,
unranked `material_supplier_refs` set — this module only resolves a single
`supplier` display string when the canonical `MaterialSupplier.preferred`
field already makes that unambiguous (exactly one `preferred: true` link),
never by inventing a new preference/ranking rule.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional


def _read_array(path: str) -> List[Dict[str, Any]]:
    """One canonical `data/master/*.json` collection — a bare JSON array,
    written by `masterdata.rs::write_array()` (write-then-atomic-rename).
    Missing/unreadable/malformed degrades to `[]`, independently per file,
    so one absent collection never blanks out the others — the same
    honest-empty-outcome convention `pipeline.py`'s own `materials_dir`
    handling already uses."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _first_cas(material: Dict[str, Any]) -> str:
    cas_numbers = material.get("casNumbers")
    if isinstance(cas_numbers, list):
        for c in cas_numbers:
            if c:
                return str(c)
    return ""


def _as_float(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _resolve_preferred_supplier_display(
    links: List[Dict[str, Any]], suppliers_by_code: Dict[str, Dict[str, Any]],
) -> Optional[str]:
    """A display string ONLY when the canonical `preferred` field already
    makes it unambiguous (exactly one `preferred: true` link) — never a
    new preference rule. Zero or multiple preferred links → `None`; the
    caller keeps the full `material_supplier_refs` set either way."""
    preferred = [link for link in links if link.get("preferred") is True]
    if len(preferred) != 1:
        return None
    link = preferred[0]
    trade_name = link.get("supplierTradeName")
    if trade_name:
        return str(trade_name)
    supplier = suppliers_by_code.get(link.get("supplierCode") or "")
    if supplier:
        return supplier.get("displayName") or supplier.get("legalName") or None
    return None


def load_master_materials(master_dir: str) -> List[Dict[str, Any]]:
    """Canonical `data/master/materials.json` (+ `material_suppliers.json`,
    `suppliers.json`, `material_prices.json` for linkage/history references)
    into the flat dict shape `engine.build_candidate_pool()`'s supplier-
    materials block already reads (`inci`/`name`/`function`, plus real
    `code`/`material_code` identity and `recommended_min_pct`/
    `recommended_max_pct`/`technical_max_pct` for concentration resolution).
    Inactive materials (`active is False`) are excluded here — the ONLY
    place that filter is applied, before any candidate is even built."""
    materials = _read_array(os.path.join(master_dir, "materials.json"))
    supplier_links = _read_array(os.path.join(master_dir, "material_suppliers.json"))
    suppliers = _read_array(os.path.join(master_dir, "suppliers.json"))
    prices = _read_array(os.path.join(master_dir, "material_prices.json"))

    suppliers_by_code = {s.get("code"): s for s in suppliers if s.get("code")}

    links_by_material: Dict[str, List[Dict[str, Any]]] = {}
    for link in supplier_links:
        material_code = link.get("materialCode")
        if material_code:
            links_by_material.setdefault(material_code, []).append(link)

    prices_by_material: Dict[str, List[Dict[str, Any]]] = {}
    for price in prices:
        material_code = price.get("materialCode")
        if material_code:
            prices_by_material.setdefault(material_code, []).append(price)
    for price_list in prices_by_material.values():
        price_list.sort(key=lambda p: p.get("effectiveFrom") or "")

    rows: List[Dict[str, Any]] = []
    for m in materials:
        if m.get("active") is False:
            continue
        code = m.get("code")
        if not code:
            continue
        links = links_by_material.get(code, [])
        row: Dict[str, Any] = {
            "code": code,
            "material_code": code,
            "external_ref": code,
            "name": m.get("displayName") or "",
            "inci": m.get("inciName") or "",
            "cas": _first_cas(m),
            "function": ", ".join(m.get("functions") or []),
            "active": m.get("active", True),
            "manufacturer": m.get("manufacturer") or "",
            "country_of_origin": m.get("countryOfOrigin") or "",
            "material_supplier_refs": links,
            "material_price_refs": prices_by_material.get(code, []),
        }
        recommended_min = _as_float(m.get("recommendedMinPercent"))
        if recommended_min is not None:
            row["recommended_min_pct"] = recommended_min
        recommended_max = _as_float(m.get("recommendedMaxPercent"))
        if recommended_max is not None:
            row["recommended_max_pct"] = recommended_max
        technical_max = _as_float(m.get("technicalMaxPercent"))
        if technical_max is not None:
            row["technical_max_pct"] = technical_max
        supplier_display = _resolve_preferred_supplier_display(links, suppliers_by_code)
        if supplier_display:
            row["supplier"] = supplier_display
        rows.append(row)
    return rows
