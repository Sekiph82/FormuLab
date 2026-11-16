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

import unicodedata

from reference_formulation_prior_adapter import _array, _current, clean_printed_name, inci_chemistry_id

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
    r"©|\ball rights reserved|\btrademark\b|\bsuppliers?\s*:|^\s*(?:\(and\)|and\b|/|[^\w(])"
    # A procedure step read into the ingredient column ("Adjust pH if necessary to 5.5-").
    r"|^\s*(?:adjust|add|mix|heat|cool|stir|dissolve|disperse|combine|homogeni[sz]e)\b",
    re.I,
)


def plain_marks(name: str) -> str:
    """OCR/MinerU writes marks as LaTeX ("ACULYN $^{TM}$"); the printed name has the plain sign."""
    name = re.sub(r"\$\s*\^\s*\{\s*(?:TM|tm)\s*\}\s*\$", "™", name)
    name = re.sub(r"\$\s*\^\s*\{\s*(?:\\textregistered|R|®)\s*\}\s*\$", "®", name)
    return re.sub(r"\$\s*\^\s*\{([^}]*)\}\s*\$", r"\1", name)


# A class name printed where a formula leaves the choice open ("Preservative q.s.", "Colorant"):
# not a raw material. Fragrance / Parfum stay: "Parfum" is itself an INCI name.
_PLACEHOLDER = re.compile(
    r"(preservatives?( system| blend)?|colou?r(ant)?s?|dyes?|thickeners?|surfactants?|buffer"
    r"|ph adjust(er|ment)|actives?|extracts?)",
    re.I,
)
_PLACEHOLDER_NOTE = "Inactive: the formulas print this class name, not a specific raw material."


def is_placeholder(name: str) -> bool:
    plain = re.sub(r"\b(q\.?\s*s\.?|optional)\b|[*().,:]", " ", name or "", flags=re.I)
    return bool(_PLACEHOLDER.fullmatch(re.sub(r"\s+", " ", plain).strip()))


def cas_numbers(text: str) -> list[str]:
    """CAS numbers in printed text, also when a PDF spaces the hyphens ("63148 - 62 - 9");
    only numbers whose check digit is right, so dates and codes are not taken for CAS."""
    found = []
    for head, middle, check in re.findall(r"(?<![\d-])(\d{2,7})\s*-\s*(\d{2})\s*-\s*(\d)(?![\d-])", text):
        digits = head + middle
        if sum(int(d) * i for i, d in enumerate(reversed(digits), 1)) % 10 == int(check):
            cas = f"{head}-{middle}-{check}"
            if cas not in found:
                found.append(cas)
    return found


def _sds_text(master_dir: str, sha256: str) -> str:
    """Text of a stored SDS's first three pages; empty when it cannot be read."""
    path = os.path.join(os.path.dirname(os.path.dirname(master_dir)), "data", "supplier-documents", "sha256", sha256[:2], f"{sha256}.pdf")
    if not os.path.exists(path):
        path = os.path.join(os.path.dirname(master_dir), "supplier-documents", "sha256", sha256[:2], f"{sha256}.pdf")
    try:
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            return "\n".join((page.extract_text() or "") for page in pdf.pages[:3])
    except Exception:  # noqa: BLE001 - an unreadable sheet adds no CAS, it never stops the run
        return ""


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
        for cas in cas_numbers(text):
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
            if document["kind"] == "sds":
                # The SDS reader does not capture every CAS label ("CASRN: 63148 - 62 - 9"); the
                # stored sheet's own first pages (identification and composition) do print it.
                for cas in cas_numbers(_sds_text(master_dir, str(acquisition["sha256"]))):
                    if cas not in entry["cas"]:
                        entry["cas"].append(cas)
        if acquisition.get("supplierId") and acquisition["supplierId"] not in entry["supplierIds"]:
            entry["supplierIds"].append(acquisition["supplierId"])
    return by_key


_GENERATED_NOTE = "From supplier field formulas:"
_TRADEMARK = re.compile("[®™�]")


def _generated(material: dict[str, Any]) -> bool:
    """A row this tool wrote or last repaired, and nobody has edited since.

    This tool stamps whole seconds ("…:17.000Z"); the app stamps every edit with its milliseconds.
    Requiring updatedAt == createdAt treated the tool's own earlier repairs as human edits, so names
    it later learned to clean were never rebuilt.
    ponytail: an app edit that lands on exactly .000 s (1 in 1000) would be rebuilt; record the editor
    on materials if that ever matters."""
    stamp = str(material.get("updatedAt") or "")
    return (str(material.get("code") or "").startswith("REF-") and str(material.get("notes") or "").startswith(_GENERATED_NOTE)
            and (stamp == material.get("createdAt") or stamp.endswith(".000Z")))


def _same_name(display: str) -> str:
    """One spelling of a printed name: case, marks and punctuation do not make another material."""
    return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKC", display).lower().replace("tm", ""))


def build_materials(master_dir: str, now: str, merged: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Rows for every printed raw material Material Master lacks; this tool's own unedited rows are rebuilt.
    `merged` receives, for each key folded into another row of the same printed name, that row's code."""
    existing = [material for material in _array(master_dir, "materials") if not _generated(material)]
    known = {key for material in existing
             for key in (inci_chemistry_id(material.get(field)) for field in ("inciName", "tradeName", "displayName")) if key}
    used_codes = {material.get("code") for material in existing}
    # Rows this tool wrote and later updated keep their code (REF-<printed key>): their key is known.
    kept_codes = {material.get("code") for material in existing if str(material.get("notes") or "").startswith(_GENERATED_NOTE)}
    titles: dict[str, str] = {}
    names: dict[str, Counter[str]] = defaultdict(Counter)
    functions: dict[str, list[str]] = defaultdict(list)
    suppliers: dict[str, set[str]] = defaultdict(set)
    formulas: dict[str, set[str]] = defaultdict(set)
    for source in _current(_array(master_dir, "reference_formulations")):
        for line in source.get("ingredientLines", []):
            printed = _cell(line, "ingredientName") or _cell(line, "inciOrChemicalName")
            key = inci_chemistry_id(_cell(line, "inciOrChemicalName")) or inci_chemistry_id(printed)
            # Two trademark signs mean the PDF merged two rows ("Dongbaek Oil ® Hostapon SCI 85 ®");
            # the line's own INCI cell then names it.
            if len(_TRADEMARK.findall(printed)) >= 2 and _cell(line, "inciOrChemicalName"):
                printed = _cell(line, "inciOrChemicalName")
            # U+FFFD is a trademark sign the PDF font did not map; the printed name reads without it.
            # Checked after cleaning: "A Surfactant" and "1. Add ingredient 13" are a class name and a step.
            name = clean_printed_name(re.sub(r"\s+", " ", plain_marks(printed).replace("�", "")))
            if (not key or key in known or not re.search(r"[A-Za-z]{3}", name) or len(name) > 80
                    or _NOT_A_MATERIAL.search(name) or is_placeholder(name)):
                continue
            titles[str(source.get("id"))] = str(source.get("source", {}).get("title") or source.get("id"))
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
    # One printed product read under several keys ("Aristoflex BLV" with its INCI cell cut at a
    # different place in each PDF) is one material: fold the keys into the one most formulas use.
    by_name: dict[str, list[str]] = defaultdict(list)
    for key, counter in names.items():
        by_name[_same_name(counter.most_common(1)[0][0])].append(key)
    for keys in by_name.values():
        if len(keys) < 2:
            continue
        primary, *others = sorted(keys, key=lambda k: (-len(formulas.get(k, ())), k))
        for other in others:
            names[primary].update(names.pop(other))
            functions[primary].extend(functions.pop(other, []))
            suppliers[primary] |= suppliers.pop(other, set())
            formulas[primary] |= formulas.pop(other, set())
            if merged is not None:
                merged[other] = f"REF-{_slug(primary)}"
    rows = []
    for key, counter in sorted(names.items()):
        display = counter.most_common(1)[0][0]
        code = f"REF-{_slug(key)}"
        if code in kept_codes:
            continue
        while code in used_codes:
            code += "-X"
        used_codes.add(code)
        found = evidence.get(key, {})
        trademark = bool(re.search(r"[®™]", display)) or bool(found)
        row: dict[str, Any] = {
            "schemaVersion": "1.0", "code": code, "displayName": display,
            "casNumbers": found.get("cas", [])[:20], "ecNumbers": [],
            "activeMatterState": "missing", "functions": material_functions(functions.get(key, [])),
            # The formula PDFs that print it, so a material links back to its sources.
            "documents": (found.get("documents", []) + [
                {"kind": "other", "title": f"Supplier field formula: {titles.get(formula_id, formula_id)}",
                 "location": f"reference-formulations/{formula_id}"}
                for formula_id in sorted(formulas.get(key, ()))])[:20], "regulatoryStatuses": [], "hazardClassifications": [],
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
    merged: dict[str, str] = {}
    built = {row["code"]: row for row in build_materials(master_dir, now, merged)}
    # Which row now owns a printed name: an unedited row of this tool whose name keys elsewhere
    # (written before list numbers and supplier suffixes were read off) repeats that row.
    owner: dict[str, str] = dict(merged)
    for material in list(built.values()) + [m for m in existing if m.get("active", True) and not _generated(m)]:
        for field in ("inciName", "tradeName", "displayName"):
            key = inci_chemistry_id(material.get(field))
            if key:
                owner.setdefault(key, str(material.get("code")))
    rows, repaired = [], 0
    generated_codes = {str(material.get("code")) for material in existing if str(material.get("notes") or "").startswith(_GENERATED_NOTE)}
    by_code = {str(material.get("code")): material for material in existing}
    seen: set[str] = set()
    for material in existing:
        code = str(material.get("code") or "")
        # Material Master holds one row per code; an earlier run could leave a second one behind.
        if code in seen:
            repaired += 1
            continue
        seen.add(code)
        mine = str(material.get("notes") or "").startswith(_GENERATED_NOTE) and material.get("active", True)
        # A placeholder or non-material row this tool wrote earlier is kept as history but switched off.
        display = str(material.get("displayName") or "")
        reason = _PLACEHOLDER_NOTE if is_placeholder(display) else (
            "Inactive: the printed row is not a raw material (page text or a procedure step)." if _NOT_A_MATERIAL.search(display) else None)
        if mine and reason:
            built.pop(code, None)
            rows.append({**material, "active": False, "updatedAt": now, "notes": f"{material.get('notes')} {reason}"})
            repaired += 1
            continue
        # "REF-X-X" repeats a row this tool already wrote for the same printed name; two active
        # rows for one material also stop formula lines from mapping to either. Two long names whose
        # codes share the first 60 characters are two materials and both stay.
        base = re.sub(r"(-X)+$", "", str(material.get("code") or ""))
        if (mine and base != material.get("code") and base in generated_codes
                and _same_name(str(by_code.get(base, {}).get("displayName") or "")) == _same_name(display)):
            built.pop(code, None)
            rows.append({**material, "active": False, "updatedAt": now,
                         "notes": f"{material.get('notes')} Inactive: duplicate of {base}."})
            repaired += 1
            continue
        if _generated(material) and material.get("active", True) and code not in built:
            target = owner.get(inci_chemistry_id(material.get("displayName")) or "")
            if target and target != code:
                rows.append({**material, "active": False, "updatedAt": now,
                             "notes": f"{material.get('notes')} Inactive: same material as {target}."})
                repaired += 1
                continue
        row = built.pop(material.get("code"), None) if _generated(material) else None
        if row is None:
            rows.append(material)
            continue
        # Keep the row's identity and creation time; take the rebuilt name and sources.
        row = {**row, "createdAt": material.get("createdAt"), "updatedAt": material.get("updatedAt")}
        if row != material:
            repaired += 1
            row["updatedAt"] = now
        rows.append(row)
    rows.extend(built.values())
    if built or repaired:
        path = os.path.join(master_dir, "materials.json")
        with open(path + ".tmp", "w", encoding="utf-8") as handle:
            json.dump(rows, handle, ensure_ascii=False, indent=2)
        os.replace(path + ".tmp", path)
    return {"existing": len(existing), "added": len(built), "repaired": repaired}


if __name__ == "__main__":
    print(json.dumps(append_materials(sys.argv[1])))
