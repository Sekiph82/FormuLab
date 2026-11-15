"""Python twin of packages/shared/src/catalog/productFamilyTaxonomy.ts.

Both read the same productFamilies.json: the desktop app embeds a copy next to
the pipeline files; a source checkout reads it from packages/shared.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from functools import lru_cache
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
_CANDIDATES = (
    os.path.join(_HERE, "product_families.json"),
    os.path.join(_HERE, "..", "..", "packages", "shared", "src", "catalog", "productFamilies.json"),
)


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").lower().replace("̇", "")
    return re.sub(r"\s+", " ", re.sub(r"[_-]+", " ", text)).strip()


def _pattern(alias: str) -> re.Pattern[str]:
    stem = alias.endswith("*")
    body = re.escape((alias[:-1] if stem else alias).replace("-", " "))
    body = re.sub(r"(?:\\ )+", r"\\s+", body)
    return re.compile(r"(?:^|[^a-z0-9])" + body + ("" if stem else r"(?![a-z0-9])"), re.I)


@lru_cache(maxsize=1)
def _taxonomy() -> dict[str, Any]:
    for path in _CANDIDATES:
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
            for entry in data["families"] + data["groups"]:
                entry["patterns"] = [_pattern(alias) for alias in entry["aliases"]]
            return data
    return {"families": [], "groups": []}


def family_key(text: str | None) -> str | None:
    """Family key ("shampoo") for a product-type text or a family label; None when nothing matches."""
    normalized = _normalize(text or "")
    if not normalized:
        return None
    families = _taxonomy()["families"]
    for family in families:
        if _normalize(family["label"]) == normalized:
            return family["key"]
    for family in families:
        if any(pattern.search(normalized) for pattern in family["patterns"]):
            return family["key"]
    return None


def family_label(key: str) -> str | None:
    return next((family["label"] for family in _taxonomy()["families"] if family["key"] == key), None)
