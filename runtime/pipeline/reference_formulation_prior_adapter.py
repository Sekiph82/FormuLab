"""Rebuild New Request field-formulation priors from canonical local records.

The renderer may request a product family, but it is never an authority for
source IDs, review state, frequency, identity, or dosage. This adapter reads
the canonical master-data collections alongside the Material Master and
fails closed when the required human reviews or rights evidence are absent.
"""
from __future__ import annotations

import json
import math
import os
import re
import unicodedata
from typing import Any

from product_family_taxonomy import family_key, family_label


INTERPRETATION = "reviewed_field_formula_appearance_is_advisory_not_suitability_safety_compatibility_or_efficacy"


def _array(directory: str, name: str) -> list[dict[str, Any]]:
    try:
        with open(os.path.join(directory, f"{name}.json"), encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, list) and all(isinstance(row, dict) for row in value) else []
    except (OSError, ValueError):
        return []


_WATER = re.compile(r"^(?:aqua|water|eau)(?:\s*(?:/|\()\s*(?:aqua|water|eau)\s*\)?)?$")
_BLEND = re.compile(r"\s*\(and\)\s*|\s*;\s*|,\s+|\s+&\s+")


def inci_chemistry_id(raw: str | None) -> str | None:
    """Python twin of the shared canonicalChemistryIdFromInci; both must agree. Also keys a printed
    ingredient name, so a formula line and a Material Master row with the same name meet."""
    text = unicodedata.normalize("NFKC", raw or "").lower()
    text = re.sub(r"[®™©*†‡¹²³⁴⁵⁶⁷⁸⁹⁰]", "", text)
    text = re.sub(r"\s*\(\d{1,2}\)\s*$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text or len(text) > 120 or "%" in text or not re.search(r"[a-z]{3}", text):
        return None
    if _WATER.match(text):
        return "inci:water"
    if len([part for part in _BLEND.split(text) if part]) > 1:
        return None
    slug = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return f"inci:{slug}" if slug else None


def _parser_generation(record: dict[str, Any]) -> int:
    match = re.search(r"layout-v(\d+)", str(record.get("source", {}).get("parserVersion") or ""))
    return int(match.group(1)) if match else 0


def _current(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Newest parse of each source document; immutable older parses stay as history."""
    newest: dict[str, int] = {}
    for record in records:
        key = str(record.get("sourceDocumentHash") or "").lower()
        newest[key] = max(newest.get(key, 0), _parser_generation(record))
    return [r for r in records if _parser_generation(r) == newest.get(str(r.get("sourceDocumentHash") or "").lower())]


def _key(value: Any) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", str(value or "")).strip()).lower()


def _latest(rows: list[dict[str, Any]], record_field: str, target_field: str) -> dict[tuple[str, str], dict[str, Any]]:
    result: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (str(row.get(record_field) or ""), str(row.get(target_field) or ""))
        previous = result.get(key)
        stamp = (str(row.get("reviewedAt") or ""), str(row.get("id") or ""))
        old_stamp = (str(previous.get("reviewedAt") or ""), str(previous.get("id") or "")) if previous else ("", "")
        if key[0] and key[1] and stamp > old_stamp:
            result[key] = row
    return result


def _accepted(review: dict[str, Any] | None, *, field_path: str, source_value: str, target_type: str) -> bool:
    return bool(review and review.get("targetType") == target_type and review.get("decision") == "accepted"
                and review.get("fieldPath") == field_path and review.get("sourceValue") == source_value
                and review.get("reviewer", {}).get("userId") and review.get("reviewer", {}).get("displayName"))


def _rights_allow_internal(source: dict[str, Any]) -> bool:
    rights = source.get("source", {}).get("rights", {})
    if not isinstance(rights, dict) or rights.get("status") == "restricted":
        return False
    permission = rights.get("usePermissions", {}).get("internalResearch", {})
    cross_supplier = rights.get("usePermissions", {}).get("crossSupplierPrior", {})
    retention = rights.get("retentionPolicy", {})
    if (not isinstance(permission, dict) or permission.get("status") != "allowed"
            or not permission.get("evidenceRefs") or not isinstance(cross_supplier, dict)
            or cross_supplier.get("status") != "allowed" or not cross_supplier.get("evidenceRefs")
            or not rights.get("evidenceRefs")):
        return False
    if not isinstance(retention, dict) or retention.get("status") not in ("retain_until_revoked", "retain_until_date"):
        return False
    if retention.get("status") == "retain_until_date":
        # Expired or malformed expiry is fail-closed. ISO timestamps sort lexically.
        expires = str(retention.get("expiresAt") or "")
        from datetime import datetime, timezone
        if not expires:
            return False
        try:
            if datetime.fromisoformat(expires.replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                return False
        except ValueError:
            return False
    return True


def _number_range(value: Any) -> tuple[float, float] | None:
    text = str(value or "").strip().replace(",", ".").replace("%", "")
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*", text, re.I)
    if match:
        low, high = float(match.group(1)), float(match.group(2))
    else:
        match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*", text)
        if not match:
            return None
        low = high = float(match.group(1))
    if not (math.isfinite(low) and math.isfinite(high) and 0 <= low <= high <= 100):
        return None
    return low, high


def _quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(probability * len(ordered)) - 1)]


# Folder-imported handbook formulas carry this source id ("Handbook <title>" folder).
HANDBOOK_SUPPLIER_PREFIX = "supplier-handbook-"


def _source_formula(row: dict[str, Any], chemistry_id: str) -> dict[str, Any]:
    """Title, supplier, file and the printed line of one formula that contains `chemistry_id`."""
    source = row["source"].get("source", {})
    line = next((line for line, line_chemistry in row["lines"] if line_chemistry == chemistry_id), {})

    def raw(field: str) -> str:
        item = line.get(field)
        return str(item.get("rawValue") or "") if isinstance(item, dict) else ""
    return {"id": row["id"], "title": str(source.get("title") or ""), "supplierId": row["supplier"],
            "originalFilename": str(source.get("originalFilename") or ""),
            "printedName": raw("ingredientName") or raw("inciOrChemicalName"),
            "printedAmount": raw("amount"), "pageNumber": line.get("pageNumber")}


def build_authoritative_guidance(master_dir: str | None, brief: dict[str, Any], materials: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return validated, recomputed priors. The caller-supplied payload is ignored."""
    requested = _key(brief.get("targetProductType"))
    if not requested or not master_dir:
        return None
    # "Şampuan", "anti-dandruff shampoo" and a supplier's "Shampoo" are one family. Text that
    # names no taxonomy family still matches only the identical family text.
    requested_family = family_key(requested)
    family = _key(family_label(requested_family)) if requested_family else requested

    def same_family(raw: Any) -> bool:
        candidate = _key(raw)
        return bool(candidate) and (candidate == requested or (requested_family is not None and family_key(candidate) == requested_family))
    sources = _current(_array(master_dir, "reference_formulations"))
    normalizations = _array(master_dir, "reference_formulation_normalizations")
    reviews = _array(master_dir, "reference_formulation_reviews")
    # Claude's advisory decisions (D-REF-01-1) count only where no human decided the same target.
    ai_reviews = [row for row in _array(master_dir, "reference_formulation_ai_reviews")
                  if str(row.get("reviewer", {}).get("userId") or "").startswith("ai:")]
    identity_reviews = _array(master_dir, "identity_field_reviews")
    human_reviews = _latest([row for row in reviews if not str(row.get("reviewer", {}).get("userId") or "").startswith("ai:")],
                            "referenceFormulationRecordId", "targetKey")
    latest_ai = _latest(ai_reviews, "referenceFormulationRecordId", "targetKey")
    ai_used: set[str] = set()

    def review_for(source_id: str, target_key: str) -> dict[str, Any] | None:
        review = human_reviews.get((source_id, target_key))
        if review is None:
            review = latest_ai.get((source_id, target_key))
            if review is not None and review.get("decision") == "accepted":
                ai_used.add(source_id)
        return review

    latest_identity = _latest(identity_reviews, "targetRecordId", "field")

    # Ambiguous append-only history is not a valid evidence basis.
    if (len({str(row.get("id") or "") for row in sources}) != len(sources)
            or len({str(row.get("id") or "") for row in reviews}) != len(reviews)
            or len({str(row.get("id") or "") for row in ai_reviews}) != len(ai_reviews)
            or len({str(row.get("id") or "") for row in identity_reviews}) != len(identity_reviews)):
        return {"schemaVersion": "formulab-new-request-reference-priors-v1", "productFamilyKey": family,
                "eligibleFormulaCount": 0, "supplierCount": 0, "aiAdvisoryFormulaCount": 0, "ingredientPriors": [], "interpretation": INTERPRETATION}

    norm_by_source: dict[str, dict[str, Any]] = {}
    ambiguous_normalizations: set[str] = set()
    for normalization in normalizations:
        source_id = str(normalization.get("referenceFormulationRecordId") or "")
        old = norm_by_source.get(source_id)
        if not source_id:
            continue
        if old and int(normalization.get("version", 0)) == int(old.get("version", 0)) and normalization.get("id") != old.get("id"):
            ambiguous_normalizations.add(source_id)
        elif old is None or int(normalization.get("version", 0)) > int(old.get("version", 0)):
            norm_by_source[source_id] = normalization

    eligible: list[dict[str, Any]] = []
    for source in sources:
        source_id = str(source.get("id") or "")
        digest = str(source.get("sourceDocumentHash") or "").lower()
        if not source_id or not digest or not _rights_allow_internal(source):
            continue
        family_candidates = [item for item in source.get("identityCandidates", [])
                             if isinstance(item, dict) and item.get("field") == "product_family"]
        if len(family_candidates) != 1 or not same_family(family_candidates[0].get("rawValue")):
            continue
        raw_family = str(family_candidates[0].get("rawValue") or "")
        family_index = next(i for i, candidate in enumerate(source.get("identityCandidates", []))
                            if candidate is family_candidates[0])
        review = review_for(source_id, f"identity:product_family:{family_index}")
        if not (review and review.get("sourceDocumentHash", "").lower() == digest and _accepted(
                review, field_path=f"identityCandidates[{family_index}].product_family",
                source_value=raw_family, target_type="identity")):
            ai_used.discard(source_id)
            continue
        normalization = norm_by_source.get(source_id)
        if normalization and (source_id in ambiguous_normalizations
                              or normalization.get("sourceDocumentHash", "").lower() != digest):
            continue
        lines = source.get("ingredientLines", [])
        by_line = {str(row.get("sourceLineId") or ""): row for row in (normalization or {}).get("lines", []) if isinstance(row, dict)}
        validated_lines = []
        for line in lines:
            line_id = str(line.get("id") or "")
            if not line_id:
                continue
            identity_value = ""
            for field in ("ingredientName", "inciOrChemicalName", "supplierProductCode"):
                item = line.get(field)
                value = str(item.get("rawValue") or "") if isinstance(item, dict) else ""
                evidence = item.get("evidence", {}) if isinstance(item, dict) else {}
                if not value or not isinstance(evidence, dict) or evidence.get("sourceDocumentHash", "").lower() != digest:
                    continue
                review = review_for(source_id, f"ingredient:{line_id}:{field}")
                if review and review.get("sourceDocumentHash", "").lower() == digest and _accepted(
                        review, field_path=f"ingredientLines[{line_id}].{field}", source_value=value, target_type="ingredient"):
                    identity_value = value
                    break
            if not identity_value:
                continue
            # A reviewed canonical chemistry wins; otherwise the line is keyed by its printed INCI or
            # ingredient name, which meets the Material Master row of the same name.
            chemistry_id = None
            normalized = by_line.get(line_id) or {}
            chemistry = normalized.get("canonicalChemistry", {}) if isinstance(normalized, dict) else {}
            ids = chemistry.get("candidateIds", []) if isinstance(chemistry, dict) else []
            if chemistry.get("status") == "proposed" and len(ids) == 1 and normalization:
                target_key = f"normalization:{normalization.get('id')}:line:{line_id}:canonicalChemistry:{ids[0]}"
                review = review_for(source_id, target_key)
                if review and review.get("sourceDocumentHash", "").lower() == digest and _accepted(
                        review, field_path=f"normalizations[{normalization.get('id')}].lines[{line_id}].canonicalChemistry",
                        source_value=str(ids[0]), target_type="ingredient"):
                    chemistry_id = str(ids[0])
            if chemistry_id is None:
                inci = line.get("inciOrChemicalName")
                chemistry_id = inci_chemistry_id(inci.get("rawValue") if isinstance(inci, dict) else None) or inci_chemistry_id(identity_value)
            if chemistry_id:
                validated_lines.append((line, chemistry_id))
        # Lines no review or name can key are left out; they no longer hide the rest of the formula.
        valid = bool(validated_lines)
        if valid:
            eligible.append({"id": source_id, "supplier": str(source.get("source", {}).get("supplierId") or ""),
                             "lines": validated_lines, "source": source})
        else:
            ai_used.discard(source_id)

    eligible = [row for row in eligible if row["supplier"]]
    # Owner decision 2026-11-16: formulas from owner-purchased handbooks support the supplier
    # field formulas; they shape guidance only for a family no supplier formula covers.
    field_formulas = [row for row in eligible if not row["supplier"].startswith(HANDBOOK_SUPPLIER_PREFIX)]
    handbook_only = bool(eligible) and not field_formulas
    eligible = field_formulas or eligible
    if not eligible:
        return {"schemaVersion": "formulab-new-request-reference-priors-v1", "productFamilyKey": family,
                "eligibleFormulaCount": 0, "supplierCount": 0, "aiAdvisoryFormulaCount": 0, "ingredientPriors": [], "interpretation": INTERPRETATION}

    family_ids = {row["id"] for row in eligible}
    all_suppliers = {row["supplier"] for row in eligible}
    by_chemistry: dict[str, list[dict[str, Any]]] = {}
    for row in eligible:
        for _, chemistry_id in row["lines"]:
            by_chemistry.setdefault(chemistry_id, []).append(row)

    materials_by_chemistry: dict[str, list[dict[str, Any]]] = {}
    for material in materials:
        code = str(material.get("code") or material.get("material_code") or "")
        review = latest_identity.get((code, "canonical_identity"))
        if (not code or not material.get("active", True) or not review
                or review.get("decision") not in ("accepted", "edited")
                or not review.get("reviewedBy") or not review.get("evidenceRefs")):
            continue
        try:
            snapshot = json.loads(review.get("reviewedValueSnapshot") if review.get("decision") == "edited"
                                  else review.get("proposedValueSnapshot") or "{}")
        except (TypeError, ValueError):
            continue
        chemistry_id = snapshot.get("canonicalChemistryId") if isinstance(snapshot, dict) else None
        if chemistry_id:
            materials_by_chemistry.setdefault(str(chemistry_id), []).append(material)
    # Without a reviewed identity, a material meets formula lines through its INCI, trade or display name.
    materials_by_name: dict[str, list[dict[str, Any]]] = {}
    for material in materials:
        if not (material.get("code") or material.get("material_code")) or not material.get("active", True):
            continue
        for name_key in {inci_chemistry_id(material.get(field)) for field in ("inci", "trade_name", "name")} - {None}:
            materials_by_name.setdefault(str(name_key), []).append(material)

    priors = []
    for chemistry_id, rows in sorted(by_chemistry.items()):
        mapped = materials_by_chemistry.get(chemistry_id) or materials_by_name.get(chemistry_id, [])
        if len(mapped) != 1:
            continue
        source_ids = sorted({row["id"] for row in rows})
        supplier_counts: dict[str, int] = {}
        for row in rows:
            supplier_counts[row["supplier"]] = supplier_counts.get(row["supplier"], 0) + 1
        supplier_neutral = sum(supplier_counts.get(supplier, 0) / sum(1 for row in eligible if row["supplier"] == supplier)
                               for supplier in all_suppliers) / len(all_suppliers)
        dosage_rows: dict[str, tuple[float, float]] = {}
        for row in rows:
            amounts = []
            amount_reviews_ok = True
            for line, line_chemistry in row["lines"]:
                if line_chemistry != chemistry_id:
                    continue
                if line.get("quantitySemantics") != "explicit_amount":
                    amount_reviews_ok = False
                    break
                line_id = str(line.get("id") or "")
                values = {}
                header = str(((line.get("amount") or {}).get("evidence") or {}).get("header") or "")
                header_unit = header_basis = None
                if "%" in header and re.search(r"w\s*/\s*w|wt|weight|mass", header, re.I):
                    header_unit, header_basis = "%", "w/w"
                for field in ("amount", "unit", "basis"):
                    item = line.get(field)
                    value = str(item.get("rawValue") or "") if isinstance(item, dict) else ""
                    if not value and field != "amount" and header_unit:
                        # The amount column's printed header ("% w/w") states the unit and basis.
                        values[field] = header_unit if field == "unit" else header_basis
                        continue
                    review = review_for(row["id"], f"ingredient:{line_id}:{field}")
                    if (not value or not review or review.get("sourceDocumentHash", "").lower() != row["source"].get("sourceDocumentHash", "").lower()
                            or not _accepted(review, field_path=f"ingredientLines[{line_id}].{field}",
                                             source_value=value, target_type="ingredient")):
                        amount_reviews_ok = False
                        break
                    values[field] = value
                if not amount_reviews_ok:
                    break
                if values["unit"].strip().lower() not in ("%", "percent", "percentage", "wt%", "wt.%") or values["basis"].strip().lower() not in ("w/w", "weight/weight", "mass/mass", "by weight"):
                    amount_reviews_ok = False
                    break
                amount_range = _number_range(values["amount"])
                if not amount_range:
                    amount_reviews_ok = False
                    break
                amounts.append(amount_range)
            if amount_reviews_ok and amounts:
                dosage_rows[row["id"]] = (sum(x[0] for x in amounts), sum(x[1] for x in amounts))
        dosage_guidance = []
        if dosage_rows:
            lower_values = [value[0] for value in dosage_rows.values()]
            upper_values = [value[1] for value in dosage_rows.values()]
            dosage_ids = sorted(dosage_rows)
            dosage_guidance.append({
                "formulaCount": len(dosage_ids), "supplierCount": len({row["supplier"] for row in rows if row["id"] in dosage_rows}),
                "observedRangePercent": {"lower": min(lower_values), "upper": max(upper_values)},
                "typicalRangePercent": {"lower": _quantile(lower_values, .25), "upper": _quantile(upper_values, .75)},
                "sourceRecordIds": dosage_ids,
            })
        material = mapped[0]
        priors.append({
            # Which formula PDFs printed this ingredient, so a result can name them.
            "sourceFormulas": [_source_formula(row, chemistry_id) for row in sorted(rows, key=lambda row: row["id"])
                               if row["id"] in source_ids][:50],
            "materialCode": str(material.get("code") or material.get("material_code")),
            "materialName": str(material.get("name") or material.get("inci") or ""),
            "canonicalChemistryId": chemistry_id,
            "formulaCount": len(source_ids), "eligibleFormulaCount": len(family_ids),
            "supplierCount": len(supplier_counts), "formulaWeightedFrequency": len(source_ids) / len(family_ids),
            "supplierNeutralFrequency": supplier_neutral, "sourceRecordIds": source_ids,
            "aiAdvisoryFormulaCount": sum(1 for source_id in source_ids if source_id in ai_used),
            "dosageGuidance": dosage_guidance,
        })
    return {"schemaVersion": "formulab-new-request-reference-priors-v1", "productFamilyKey": family,
            "eligibleFormulaCount": len(family_ids), "supplierCount": len(all_suppliers),
            "aiAdvisoryFormulaCount": len(family_ids & ai_used), "handbookOnly": handbook_only,
            "ingredientPriors": priors, "interpretation": INTERPRETATION}
