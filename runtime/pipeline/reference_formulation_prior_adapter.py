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


INTERPRETATION = "reviewed_field_formula_appearance_is_advisory_not_suitability_safety_compatibility_or_efficacy"


def _array(directory: str, name: str) -> list[dict[str, Any]]:
    try:
        with open(os.path.join(directory, f"{name}.json"), encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, list) and all(isinstance(row, dict) for row in value) else []
    except (OSError, ValueError):
        return []


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


def build_authoritative_guidance(master_dir: str | None, brief: dict[str, Any], materials: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return validated, recomputed priors. The caller-supplied payload is ignored."""
    family = _key(brief.get("targetProductType"))
    if not family or not master_dir:
        return None
    sources = _array(master_dir, "reference_formulations")
    normalizations = _array(master_dir, "reference_formulation_normalizations")
    reviews = _array(master_dir, "reference_formulation_reviews")
    identity_reviews = _array(master_dir, "identity_field_reviews")
    latest_reviews = _latest(reviews, "referenceFormulationRecordId", "targetKey")
    latest_identity = _latest(identity_reviews, "targetRecordId", "field")

    # Ambiguous append-only history is not a valid evidence basis.
    if (len({str(row.get("id") or "") for row in sources}) != len(sources)
            or len({str(row.get("id") or "") for row in reviews}) != len(reviews)
            or len({str(row.get("id") or "") for row in identity_reviews}) != len(identity_reviews)):
        return {"schemaVersion": "formulab-new-request-reference-priors-v1", "productFamilyKey": family,
                "eligibleFormulaCount": 0, "supplierCount": 0, "ingredientPriors": [], "interpretation": INTERPRETATION}

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
        if len(family_candidates) != 1 or _key(family_candidates[0].get("rawValue")) != family:
            continue
        raw_family = str(family_candidates[0].get("rawValue") or "")
        family_reviewed = any(
            review.get("targetType") == "identity" and review.get("decision") == "accepted"
            and review.get("sourceDocumentHash", "").lower() == digest
            and review.get("reviewer", {}).get("userId") and review.get("reviewer", {}).get("displayName")
            and review.get("sourceValue") == raw_family
            and review.get("fieldPath") == f"identityCandidates[{i}].product_family"
            for (review_source, target), review in latest_reviews.items()
            for i, candidate in enumerate(source.get("identityCandidates", []))
            if review_source == source_id and target == f"identity:product_family:{i}"
            and candidate is family_candidates[0]
        )
        if not family_reviewed:
            continue
        normalization = norm_by_source.get(source_id)
        if (not normalization or source_id in ambiguous_normalizations
                or normalization.get("sourceDocumentHash", "").lower() != digest):
            continue
        lines = source.get("ingredientLines", [])
        normalized_lines = normalization.get("lines", [])
        by_line = {str(row.get("sourceLineId") or ""): row for row in normalized_lines if isinstance(row, dict)}
        if not lines or len(by_line) != len(lines):
            continue
        validated_lines = []
        valid = True
        for line in lines:
            line_id = str(line.get("id") or "")
            normalized = by_line.get(line_id)
            if not line_id or not normalized:
                valid = False
                break
            identity_reviewed = False
            for field in ("ingredientName", "inciOrChemicalName", "supplierProductCode"):
                item = line.get(field)
                value = str(item.get("rawValue") or "") if isinstance(item, dict) else ""
                evidence = item.get("evidence", {}) if isinstance(item, dict) else {}
                if not isinstance(evidence, dict) or evidence.get("sourceDocumentHash", "").lower() != digest:
                    continue
                key = f"ingredient:{line_id}:{field}"
                review = latest_reviews.get((source_id, key))
                if value and review and review.get("sourceDocumentHash", "").lower() == digest and _accepted(
                    review, field_path=f"ingredientLines[{line_id}].{field}", source_value=value, target_type="ingredient"):
                    identity_reviewed = True
                    break
            chemistry = normalized.get("canonicalChemistry", {})
            ids = chemistry.get("candidateIds", []) if isinstance(chemistry, dict) else []
            if not identity_reviewed or chemistry.get("status") != "proposed" or len(ids) != 1:
                valid = False
                break
            chemistry_id = str(ids[0])
            target_key = f"normalization:{normalization.get('id')}:line:{line_id}:canonicalChemistry:{chemistry_id}"
            review = latest_reviews.get((source_id, target_key))
            if not review or review.get("sourceDocumentHash", "").lower() != digest or not _accepted(
                review, field_path=f"normalizations[{normalization.get('id')}].lines[{line_id}].canonicalChemistry",
                source_value=chemistry_id, target_type="ingredient"):
                valid = False
                break
            validated_lines.append((line, chemistry_id))
        if valid:
            eligible.append({"id": source_id, "supplier": str(source.get("source", {}).get("supplierId") or ""),
                             "lines": validated_lines, "source": source})

    eligible = [row for row in eligible if row["supplier"]]
    if not eligible:
        return {"schemaVersion": "formulab-new-request-reference-priors-v1", "productFamilyKey": family,
                "eligibleFormulaCount": 0, "supplierCount": 0, "ingredientPriors": [], "interpretation": INTERPRETATION}

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

    priors = []
    for chemistry_id, rows in sorted(by_chemistry.items()):
        mapped = materials_by_chemistry.get(chemistry_id, [])
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
                for field in ("amount", "unit", "basis"):
                    item = line.get(field)
                    value = str(item.get("rawValue") or "") if isinstance(item, dict) else ""
                    review = latest_reviews.get((row["id"], f"ingredient:{line_id}:{field}"))
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
            "materialCode": str(material.get("code") or material.get("material_code")),
            "materialName": str(material.get("name") or material.get("inci") or ""),
            "canonicalChemistryId": chemistry_id,
            "formulaCount": len(source_ids), "eligibleFormulaCount": len(family_ids),
            "supplierCount": len(supplier_counts), "formulaWeightedFrequency": len(source_ids) / len(family_ids),
            "supplierNeutralFrequency": supplier_neutral, "sourceRecordIds": source_ids,
            "dosageGuidance": dosage_guidance,
        })
    return {"schemaVersion": "formulab-new-request-reference-priors-v1", "productFamilyKey": family,
            "eligibleFormulaCount": len(family_ids), "supplierCount": len(all_suppliers),
            "ingredientPriors": priors, "interpretation": INTERPRETATION}
