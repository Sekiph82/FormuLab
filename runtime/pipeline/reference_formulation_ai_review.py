"""Claude's advisory review of imported supplier formulations (owner decision D-REF-01-1).

Dev-time tool, not part of the embedded generation pipeline. It reads the active
master-data folder and appends review rows to `reference_formulation_ai_reviews`,
attributed to Claude and never to a person. Each row cites exactly the same
evidence a human decision on that field would cite, so the prior adapter can
check it the same way; a human decision on the same target always wins.

A field is accepted only when Claude's checks pass:
- product family: the candidate resolves to a family of the shared taxonomy;
- ingredient lines: the cell holds a name rather than a number (owner decision
  2026-11-15: supplier field formulas are used without waiting for a person; the
  note records whether the formula total closed at 99-101 % w/w);
- canonical chemistry: the candidate is exactly the id of the printed INCI name;
- amounts: the cell is a plain number or range between 0 and 100.
Everything else gets no AI decision and stays for a human.

Usage: python reference_formulation_ai_review.py <master_dir>
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from typing import Any

from product_family_taxonomy import family_key
from reference_formulation_prior_adapter import _array, _current, _number_range, inci_chemistry_id

REVIEWER = {"userId": "ai:claude-opus-5-5", "displayName": "Claude (AI review, advisory)"}
COLLECTION = "reference_formulation_ai_reviews"
TAXONOMY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "packages", "shared", "src", "catalog", "productFamilies.json")


def _is_name(text: str) -> bool:
    return 3 <= len(text) <= 200 and bool(re.search(r"[A-Za-z]{3}", text)) and not re.fullmatch(r"[\d\s.,%\-–]+", text)


def _total_closes(source: dict[str, Any]) -> bool:
    total = (source.get("arithmetic") or {}).get("calculatedTotal") or {}
    try:
        low, high = float(total["lowerBound"]), float(total["upperBound"])
    except (KeyError, TypeError, ValueError):
        return False
    return low <= 101 and high >= 99


def _location(evidence: dict[str, Any]) -> dict[str, Any]:
    return {key: evidence[key] for key in ("pageNumber", "blockIndex", "rowIndex", "cellIndex") if key in evidence}


def _row(source: dict[str, Any], target_type: str, target_key: str, field_path: str, source_value: str,
         excerpt: str, evidence: dict[str, Any], note: str, reviewed_at: str) -> dict[str, Any]:
    row = {
        "schemaVersion": "1.0", "referenceFormulationRecordId": source["id"],
        "sourceDocumentHash": str(source["sourceDocumentHash"]).lower(),
        "targetType": target_type, "targetKey": target_key, "fieldPath": field_path,
        "sourceValue": source_value, "evidenceExcerpt": excerpt, **_location(evidence),
        "decision": "accepted", "note": note, "reviewer": dict(REVIEWER),
    }
    identity = json.dumps([row[key] for key in sorted(row) if key != "note"], sort_keys=True, ensure_ascii=False)
    row_id = "rfaireview-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return {**row, "id": row_id, "code": row_id, "reviewedAt": reviewed_at}


def build_ai_reviews(sources: list[dict[str, Any]], normalizations: list[dict[str, Any]],
                     family_labels: set[str], reviewed_at: str) -> list[dict[str, Any]]:
    latest_norm: dict[str, dict[str, Any]] = {}
    for normalization in normalizations:
        source_id = str(normalization.get("referenceFormulationRecordId") or "")
        if source_id and int(normalization.get("version", 0)) > int(latest_norm.get(source_id, {}).get("version", 0)):
            latest_norm[source_id] = normalization
    rows: list[dict[str, Any]] = []
    for source in _current(sources):
        for index, candidate in enumerate(source.get("identityCandidates", [])):
            if candidate.get("field") != "product_family" or (
                    candidate.get("rawValue") not in family_labels and not family_key(candidate.get("rawValue"))):
                continue
            evidence = (candidate.get("evidence") or [{}])[0]
            rows.append(_row(source, "identity", f"identity:product_family:{index}",
                             f"identityCandidates[{index}].product_family", candidate["rawValue"],
                             evidence.get("excerpt", ""), evidence,
                             f"Specific product family read by {candidate.get('extractionMethod')}.", reviewed_at))
        closes = "Formula total closes at 99-101 % w/w" if _total_closes(source) else "Formula total does not close at 99-101 % w/w"
        normalization = latest_norm.get(source["id"])
        chemistry_by_line = {line.get("sourceLineId"): line.get("canonicalChemistry", {}) for line in (normalization or {}).get("lines", [])}
        for line in source.get("ingredientLines", []):
            line_id = line["id"]
            excerpt = " | ".join(line.get("rawRow", []))
            for field in ("ingredientName", "inciOrChemicalName", "supplierProductCode"):
                cell = line.get(field)
                if cell and _is_name(cell["rawValue"]):
                    rows.append(_row(source, "ingredient", f"ingredient:{line_id}:{field}", f"ingredientLines[{line_id}].{field}",
                                     cell["rawValue"], excerpt, cell["evidence"],
                                     f"{closes}; cell holds an ingredient name.", reviewed_at))
                    break
            amount = line.get("amount")
            if amount and line.get("quantitySemantics") == "explicit_amount" and _number_range(amount["rawValue"]):
                rows.append(_row(source, "ingredient", f"ingredient:{line_id}:amount", f"ingredientLines[{line_id}].amount",
                                 amount["rawValue"], excerpt, amount["evidence"],
                                 f"{closes}; amount is a plain percentage.", reviewed_at))
            chemistry = chemistry_by_line.get(line_id) or {}
            inci = line.get("inciOrChemicalName")
            ids = chemistry.get("candidateIds") or []
            if normalization and inci and chemistry.get("status") == "proposed" and ids == [inci_chemistry_id(inci["rawValue"])]:
                rows.append(_row(source, "ingredient",
                                 f"normalization:{normalization['id']}:line:{line_id}:canonicalChemistry:{ids[0]}",
                                 f"normalizations[{normalization['id']}].lines[{line_id}].canonicalChemistry",
                                 ids[0], excerpt, inci["evidence"],
                                 "Candidate is exactly the id of the printed INCI name.", reviewed_at))
    return rows


def append_ai_reviews(master_dir: str) -> dict[str, int]:
    with open(TAXONOMY, encoding="utf-8") as handle:
        family_labels = {family["label"] for family in json.load(handle)["families"]}
    existing = _array(master_dir, COLLECTION)
    known = {row.get("id") for row in existing}
    reviewed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fresh = [row for row in build_ai_reviews(_array(master_dir, "reference_formulations"),
                                             _array(master_dir, "reference_formulation_normalizations"),
                                             family_labels, reviewed_at) if row["id"] not in known]
    if fresh:
        path = os.path.join(master_dir, f"{COLLECTION}.json")
        temporary = path + ".tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(existing + fresh, handle, ensure_ascii=False, indent=2)
        os.replace(temporary, path)
    return {"existing": len(existing), "added": len(fresh)}


if __name__ == "__main__":
    print(json.dumps(append_ai_reviews(sys.argv[1])))
