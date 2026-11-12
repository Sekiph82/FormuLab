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
import re
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


def attach_reviewed_supplier_product_evidence(master_dir: str, materials: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Attach only latest human-accepted claims to one exact active RawMaterial.

    This is a read-only evidence join: SDS Section 3 is never used as product
    identity, and these claims never create ingredients or set a concentration.
    Ambiguous product-to-material matches are omitted rather than guessed.
    """
    def normalize_identity(value: Any) -> str:
        return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()

    records = _read_array(os.path.join(master_dir, "supplier_product_evidence.json"))
    documents = {row.get("id"): row for row in records if row.get("recordType") == "document"}
    acquisitions = {row.get("code"): row for row in _read_array(os.path.join(master_dir, "supplier_document_acquisitions.json"))}
    suppliers = _read_array(os.path.join(master_dir, "suppliers.json"))
    suppliers_by_code = {normalize_identity(row.get("code")): row for row in suppliers if row.get("code")}
    card_versions: Dict[str, Dict[str, Any]] = {}
    for row in records:
        if row.get("recordType") != "card_version":
            continue
        card_id = row.get("productCardId")
        prior = card_versions.get(card_id)
        if card_id and (prior is None or int(row.get("version") or 0) > int(prior.get("version") or 0)):
            card_versions[card_id] = row

    latest_reviews: Dict[tuple, Dict[str, Any]] = {}
    for row in records:
        if row.get("recordType") == "claim_review":
            key = (row.get("productCardId"), row.get("sourceEvidenceId"), row.get("claimId"))
            if all(key):
                latest_reviews[key] = row

    def comparison(field_code: str, snapshot: Dict[str, Any]) -> Dict[str, Any] | None:
        fields = {
            "product_cas": ("casNumbers", "CAS numbers"),
            "product_ec": ("ecNumbers", "EC numbers"),
            "active_matter": ("activeMatterPercent", "as-supplied active matter"),
            "total_solids": ("solidsPercent", "solids"),
            "density": ("density", "density"),
            "ph": ("pH", "pH range"),
            "viscosity": ("viscosity", "viscosity range"),
            "ionic_character": ("ionicCharacter", "ionic character"),
            "appearance": ("appearance", "appearance"),
            "color": ("color", "color"),
            "solubility": ("solubility", "solubility"),
            "recommended_dosage": ("recommendedDosage", "recommended dosage"),
            "storage_conditions": ("storageConditions", "storage conditions"),
            "shelf_life": ("shelfLifeMonths", "shelf life in months"),
        }
        selected = fields.get(field_code)
        if not selected:
            return None
        value = snapshot.get(selected[0])
        return {"field": selected[1], "currentValue": value if value is not None else None}

    enriched = 0
    for card_id, card in card_versions.items():
        identity_claims: List[Dict[str, Any]] = []
        accepted_claims: List[Dict[str, Any]] = []
        for evidence_id in card.get("evidenceRecordIds", []):
            document = documents.get(evidence_id)
            if not document or document.get("productCardId") != card_id:
                continue
            for claim in document.get("claims", []):
                if claim.get("id") not in card.get("claimIds", []):
                    continue
                review = latest_reviews.get((card_id, evidence_id, claim.get("id")))
                if not review or review.get("decision") != "accepted" or review.get("claimSnapshot") != claim:
                    continue
                citation_refs = [
                    f"{cite.get('documentHash')}:p{cite.get('pageNumber')}" +
                    (f":l{cite['lineNumber']}" if cite.get("lineNumber") else "")
                    for cite in claim.get("evidence", [])
                ]
                review_refs = review.get("evidenceRefs", [])
                if not citation_refs or review_refs != citation_refs:
                    continue
                accepted_claims.append({
                    "claimId": claim.get("id"),
                    "fieldCode": claim.get("fieldCode"),
                    "rawValue": claim.get("rawValue"),
                    "normalizedValue": claim.get("normalizedValue"),
                    "originalUnit": claim.get("originalUnit"),
                    "normalizedUnit": claim.get("normalizedUnit"),
                    "qualifier": claim.get("qualifier", "unknown"),
                    "basis": claim.get("basis", "unknown"),
                    "context": claim.get("context", {}),
                    "documentType": document.get("documentType"),
                    "documentHash": document.get("documentHash"),
                    "sourceEvidenceId": evidence_id,
                    "acquisitionCode": document.get("acquisitionCode"),
                    "originalFilename": acquisitions.get(document.get("acquisitionCode"), {}).get("originalFilename"),
                    "sourceRevision": (
                        acquisitions.get(document.get("acquisitionCode"), {}).get("sourceRevision")
                        or acquisitions.get(document.get("acquisitionCode"), {}).get("revisionDate")
                        or acquisitions.get(document.get("acquisitionCode"), {}).get("publicationDate")
                    ),
                    "reviewId": review.get("id"),
                    "reviewedBy": review.get("reviewedBy"),
                    "reviewedAt": review.get("reviewedAt"),
                    "citations": claim.get("evidence", []),
                })
                if claim.get("subject") == "product" and claim.get("fieldCode") in {
                    "product_identifier", "product_cas", "product_ec", "supplier_material_number",
                }:
                    identity_claims.append(claim)

        card_supplier_id = normalize_identity(card.get("supplierId"))
        card_supplier_name = normalize_identity(card.get("supplierName"))
        card_cas = {normalize_identity(claim.get("normalizedValue") or claim.get("rawValue")) for claim in identity_claims if claim.get("fieldCode") == "product_cas"}
        card_ec = {normalize_identity(claim.get("normalizedValue") or claim.get("rawValue")) for claim in identity_claims if claim.get("fieldCode") == "product_ec"}
        card_codes = {normalize_identity(claim.get("normalizedValue") or claim.get("rawValue")) for claim in identity_claims if claim.get("fieldCode") == "supplier_material_number"}
        card_names = {normalize_identity(claim.get("normalizedValue") or claim.get("rawValue")) for claim in identity_claims if claim.get("fieldCode") == "product_identifier"}
        matches: List[Dict[str, Any]] = []
        for material in materials:
            matching_supplier_codes = set()
            for link in material.get("material_supplier_refs", []):
                supplier_code = normalize_identity(link.get("supplierCode"))
                if not supplier_code:
                    continue
                supplier = suppliers_by_code.get(supplier_code, {})
                supplier_id_matches = bool(card_supplier_id and card_supplier_id in {
                    supplier_code, normalize_identity(supplier.get("code")),
                    normalize_identity(supplier.get("displayName")), normalize_identity(supplier.get("legalName")),
                })
                supplier_name_matches = bool(card_supplier_name and card_supplier_name in {
                    normalize_identity(supplier.get("displayName")), normalize_identity(supplier.get("legalName")),
                })
                if supplier_id_matches or supplier_name_matches:
                    matching_supplier_codes.add(supplier_code)
            if not matching_supplier_codes:
                continue
            names = {normalize_identity(material.get(field)) for field in ("name", "inci", "trade_name") if material.get(field)}
            same_supplier_links = [link for link in material.get("material_supplier_refs", [])
                                  if normalize_identity(link.get("supplierCode")) in matching_supplier_codes]
            names.update(normalize_identity(link.get("supplierTradeName")) for link in same_supplier_links if link.get("supplierTradeName"))
            codes = {normalize_identity(material.get("code")), normalize_identity(material.get("external_ref"))}
            codes.update(normalize_identity(link.get("supplierItemCode")) for link in same_supplier_links if link.get("supplierItemCode"))
            cas = {normalize_identity(value) for value in material.get("cas_numbers", []) if value}
            ec = {normalize_identity(value) for value in material.get("ec_numbers", []) if value}
            exact = bool(card_names & names) or bool(card_codes & codes)
            exact = exact or bool(card_cas & cas) or bool(card_ec & ec)
            if exact:
                matches.append(material)
        if len(matches) != 1 or not accepted_claims or not identity_claims:
            continue
        product_evidence = {
            "productCardId": card_id,
            "cardVersion": card.get("version"),
            "supplierName": card.get("supplierName"),
            "supplierItemCode": card.get("supplierItemCode"),
            "tradeName": card.get("tradeName"),
            "grade": card.get("grade"),
            "market": card.get("market"),
            "language": card.get("language"),
            "identityStatus": card.get("identityStatus"),
            "conflicts": card.get("conflicts", []),
            "claims": accepted_claims,
            "rawMaterialSnapshot": matches[0].get("raw_material_snapshot", {}),
            "claimComparisons": [
                {
                    "claimId": claim["claimId"],
                    **comparison(claim["fieldCode"], matches[0].get("raw_material_snapshot", {})),
                }
                for claim in accepted_claims
                if comparison(claim["fieldCode"], matches[0].get("raw_material_snapshot", {})) is not None
            ],
            "interpretation": "human_accepted_source_claims_for_exact_product_match_only_not_formulation_performance_or_safety_validation",
        }
        matches[0].setdefault("supplier_product_card_evidence", []).append(product_evidence)
        enriched += 1
    return {"matchedProductCardCount": enriched, "matchedMaterials": enriched}


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
            "trade_name": m.get("tradeName") or "",
            "cas_numbers": m.get("casNumbers") if isinstance(m.get("casNumbers"), list) else [],
            "ec_numbers": m.get("ecNumbers") if isinstance(m.get("ecNumbers"), list) else [],
            "raw_material_snapshot": {
                key: m.get(key)
                for key in (
                    "code", "displayName", "tradeName", "inciName", "casNumbers", "ecNumbers",
                    "manufacturer", "physicalForm", "appearance", "color", "activeMatterPercent",
                    "activeMatterState", "solidsPercent", "waterPercent", "density", "phMin",
                    "phMax", "viscosityMin", "viscosityMax", "ionicCharacter", "solubility",
                    "functions", "recommendedMinPercent", "recommendedMaxPercent",
                    "technicalMaxPercent", "storageConditions", "shelfLifeMonths",
                )
                if key in m
            },
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
    attach_reviewed_supplier_product_evidence(master_dir, rows)
    return rows
