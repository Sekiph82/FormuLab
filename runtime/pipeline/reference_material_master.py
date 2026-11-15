"""Material Master rows for the raw materials printed in supplier field formulas.

Owner decision 2026-11-15: supplier formulas and their SDS/TDS documents are used
without waiting for a person. This tool reads the active master-data folder and
adds one `materials` row per raw material that formulas print and Material Master
does not have yet, keyed by its printed name exactly as the prior adapter keys
formula lines (`inci_chemistry_id`). SDS/TDS evidence stored for the same trade
name adds CAS numbers, INCI and document references. Nothing is invented: a value
no source states stays absent, and existing materials are never changed.

Usage: python reference_material_master.py <master_dir>
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from reference_formulation_prior_adapter import _array, _current, inci_chemistry_id

# Printed "Function" cells -> Material Master function codes. Unlisted wording stays unmapped.
_FUNCTIONS = [
    (r"\banionic", "anionic_surfactant"), (r"\bnon-?ionic", "nonionic_surfactant"),
    (r"amphoteric|zwitterion", "amphoteric_surfactant"), (r"\bcationic", "cationic_surfactant"),
    (r"emollient", "emollient"), (r"humectant|moistur", "humectant"), (r"preserv", "preservative"),
    (r"fragrance|perfume|parfum", "fragrance"), (r"colou?r|dye|pigment", "colorant"),
    (r"chelat|sequest", "chelating_agent"), (r"thicken|viscosity|rheolog|structur|gelling|suspend", "rheology_modifier"),
    (r"\bph\b|neutrali[sz]|buffer|acidifier|alkali", "ph_adjuster"), (r"solvent|diluent|carrier|coupling", "solvent"),
    (r"condition", "conditioning_agent"), (r"opacif|pearl", "opacifier"), (r"antioxid", "antioxidant"),
    (r"defoam|antifoam|foam control", "foam_controller"), (r"enzyme", "enzyme"), (r"bleach", "bleaching_agent"),
    (r"builder", "builder"), (r"abrasive", "abrasive"), (r"filler", "filler"),
    (r"biocid|disinfect|antimicrob|antibacter", "disinfectant_active"),
]


def material_functions(printed: list[str]) -> list[str]:
    found: list[str] = []
    for text in printed:
        for pattern, code in _FUNCTIONS:
            if re.search(pattern, text, re.I) and code not in found:
                found.append(code)
    return found


# Printed rows that are page furniture, not raw materials: copyright and trademark
# notes, supplier lists, continuation fragments ("(and) Xanthan Gum", "/ Dow").
_NOT_A_MATERIAL = re.compile(
    r"©|\ball rights reserved|\btrademark\b|\bsuppliers?\s*:|^\s*(?:\(and\)|and\b|/|[^\w(])",
    re.I,
)


def _cell(line: dict[str, Any], field: str) -> str:
    item = line.get(field)
    return str(item.get("rawValue") or "").strip() if isinstance(item, dict) else ""


def _slug(key: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", key.split(":", 1)[-1].upper()).strip("-")[:60]


def _product_evidence(master_dir: str) -> dict[str, dict[str, Any]]:
    """Trade-name key -> CAS numbers, INCI names and document references from stored SDS/TDS evidence."""
    acquisitions = {row.get("code"): row for row in _array(master_dir, "supplier_document_acquisitions")}
    by_key: dict[str, dict[str, Any]] = defaultdict(lambda: {"cas": [], "inci": [], "documents": [], "supplierIds": []})
    for row in _array(master_dir, "supplier_product_evidence"):
        acquisition = acquisitions.get(row.get("acquisitionCode")) or {}
        trade_name = (acquisition.get("sourceProduct") or {}).get("tradeName") or row.get("tradeName")
        key = inci_chemistry_id(trade_name)
        if not key:
            continue
        entry = by_key[key]
        text = json.dumps(row, ensure_ascii=False)
        for cas in re.findall(r"\b\d{2,7}-\d{2}-\d\b", text):
            if cas not in entry["cas"]:
                entry["cas"].append(cas)
        for claim in row.get("claims", []) if isinstance(row.get("claims"), list) else []:
            if isinstance(claim, dict) and claim.get("fieldCode") in ("inci_name", "product_inci") and claim.get("rawValue"):
                if claim["rawValue"] not in entry["inci"]:
                    entry["inci"].append(str(claim["rawValue"]))
        kind = str(acquisition.get("documentType") or "other").lower()
        document = {"kind": kind if kind in ("sds", "tds", "coa", "spec", "certificate") else "other",
                    "title": str(acquisition.get("originalFilename") or trade_name),
                    "location": f"supplier-documents/sha256/{acquisition.get('sha256')}.pdf"}
        if acquisition.get("sha256") and document not in entry["documents"]:
            entry["documents"].append(document)
        if acquisition.get("supplierId") and acquisition["supplierId"] not in entry["supplierIds"]:
            entry["supplierIds"].append(acquisition["supplierId"])
    return by_key


def build_materials(master_dir: str, now: str) -> list[dict[str, Any]]:
    existing = _array(master_dir, "materials")
    known = {key for material in existing
             for key in (inci_chemistry_id(material.get(field)) for field in ("inciName", "tradeName", "displayName")) if key}
    used_codes = {material.get("code") for material in existing}
    names: dict[str, Counter[str]] = defaultdict(Counter)
    functions: dict[str, list[str]] = defaultdict(list)
    suppliers: dict[str, set[str]] = defaultdict(set)
    formulas: dict[str, set[str]] = defaultdict(set)
    for source in _current(_array(master_dir, "reference_formulations")):
        for line in source.get("ingredientLines", []):
            name = _cell(line, "ingredientName") or _cell(line, "inciOrChemicalName")
            key = inci_chemistry_id(_cell(line, "inciOrChemicalName")) or inci_chemistry_id(name)
            if (not key or key in known or not re.search(r"[A-Za-z]{3}", name) or len(name) > 80
                    or _NOT_A_MATERIAL.search(name)):
                continue
            # U+FFFD is a trademark sign the PDF font did not map; the printed name reads without it.
            name = re.sub(r"\s+", " ", name.replace("\ufffd", "")).strip()
            names[key][name] += 1
            if _cell(line, "function"):
                functions[key].append(_cell(line, "function"))
            suppliers[key].add(str(source.get("source", {}).get("supplierId") or ""))
            formulas[key].add(str(source.get("id")))
    evidence = _product_evidence(master_dir)
    # Products that have SDS/TDS documents but appear in no formula are raw materials too.
    for key in evidence:
        if key not in known and key not in names:
            names[key][key.split(":", 1)[1].replace("-", " ").title()] += 1
    rows = []
    for key, counter in sorted(names.items()):
        display = counter.most_common(1)[0][0]
        code = f"REF-{_slug(key)}"
        while code in used_codes:
            code += "-X"
        used_codes.add(code)
        found = evidence.get(key, {})
        trademark = bool(re.search(r"[®™]", display)) or bool(found)
        row: dict[str, Any] = {
            "schemaVersion": "1.0", "code": code, "displayName": display,
            "casNumbers": found.get("cas", [])[:20], "ecNumbers": [],
            "activeMatterState": "missing", "functions": material_functions(functions.get(key, [])),
            "documents": found.get("documents", [])[:20], "regulatoryStatuses": [], "hazardClassifications": [],
            "allergens": [], "incompatibilities": [], "substituteCodes": [], "active": True,
            "notes": (f"From supplier field formulas: {len(formulas.get(key, ()))} formula(s), suppliers "
                      f"{', '.join(sorted(s for s in suppliers.get(key, set()) | set(found.get('supplierIds', [])) if s))}. "
                      f"Printed functions: {', '.join(sorted(set(functions.get(key, []))))[:300] or 'none'}. "
                      "Values not printed in a source stay empty."),
            "createdAt": now, "updatedAt": now,
        }
        if trademark:
            row["tradeName"] = display
        printed_inci = re.fullmatch(r".+?\(([A-Za-z][^()]{2,80})\)\s*", display)
        if found.get("inci"):
            row["inciName"] = found["inci"][0]
        elif printed_inci:
            # "10,000/200 Fluid (Dimethicone)": the supplier prints the INCI name in brackets.
            row["inciName"] = printed_inci.group(1).strip()
        if len(found.get("supplierIds", [])) == 1:
            row["manufacturer"] = found["supplierIds"][0]
        rows.append(row)
    return rows


def append_materials(master_dir: str) -> dict[str, int]:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    existing = _array(master_dir, "materials")
    fresh = build_materials(master_dir, now)
    if fresh:
        path = os.path.join(master_dir, "materials.json")
        with open(path + ".tmp", "w", encoding="utf-8") as handle:
            json.dump(existing + fresh, handle, ensure_ascii=False, indent=2)
        os.replace(path + ".tmp", path)
    return {"existing": len(existing), "added": len(fresh)}


if __name__ == "__main__":
    print(json.dumps(append_materials(sys.argv[1])))
