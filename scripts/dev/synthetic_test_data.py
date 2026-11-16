"""Snapshot the workspace before module testing, then remove only the synthetic test data.

Synthetic records carry the marker SYN-TEST in a name, code or note. `delete`
removes a record or file only when it is NEW since the snapshot AND either
carries the marker or references a removed synthetic record (child rows such as
test results of a synthetic trial). Anything that existed at snapshot time, and
anything new without the marker, is kept.

Usage (from the repository root):
  python scripts/dev/synthetic_test_data.py snapshot
  python scripts/dev/synthetic_test_data.py delete            # dry run: lists what would go
  python scripts/dev/synthetic_test_data.py delete --apply    # removes it (close FormuLab first)
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MASTER = os.path.join(ROOT, "data", "master")
FILE_DIRS = [os.path.join(ROOT, "formulas"), os.path.join(ROOT, "data", "sessions"), os.path.join(ROOT, "data", "formulations")]
SNAPSHOT = os.path.join(ROOT, "data", "synthetic-test", "snapshot.json")
MARKER = "SYN-TEST"


def _key(row: object) -> str:
    if isinstance(row, dict):
        for field in ("id", "code"):
            if isinstance(row.get(field), str):
                return f"{field}:{row[field]}"
    return "sha:" + hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()


def _collections() -> dict[str, list]:
    out = {}
    for name in sorted(os.listdir(MASTER)):
        if name.endswith(".json"):
            with open(os.path.join(MASTER, name), encoding="utf-8") as handle:
                rows = json.load(handle)
            if isinstance(rows, list):
                out[name] = rows
    return out


def _entries() -> list[str]:
    return sorted(os.path.join(d, n) for d in FILE_DIRS if os.path.isdir(d) for n in os.listdir(d))


def snapshot() -> None:
    os.makedirs(os.path.dirname(SNAPSHOT), exist_ok=True)
    data = {"records": {name: sorted({_key(row) for row in rows}) for name, rows in _collections().items()},
            "entries": _entries()}
    with open(SNAPSHOT, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    print(f"snapshot: {sum(len(v) for v in data['records'].values())} records, {len(data['entries'])} files")


def _text(path: str) -> str:
    parts = []
    for base, _, names in os.walk(path) if os.path.isdir(path) else [(os.path.dirname(path), [], [os.path.basename(path)])]:
        for name in names:
            try:
                with open(os.path.join(base, name), encoding="utf-8", errors="ignore") as handle:
                    parts.append(handle.read(2_000_000))
            except OSError:
                pass
    return "\n".join(parts)


def delete(apply: bool) -> None:
    with open(SNAPSHOT, encoding="utf-8") as handle:
        snap = json.load(handle)
    collections = _collections()
    fresh = {name: [row for row in rows if _key(row) not in set(snap["records"].get(name, []))]
             for name, rows in collections.items()}
    doomed: dict[str, set[str]] = {name: set() for name in collections}
    ids: set[str] = set()
    changed = True
    while changed:  # follow references from synthetic rows to their children
        changed = False
        for name, rows in fresh.items():
            for row in rows:
                key = _key(row)
                if key in doomed[name]:
                    continue
                text = json.dumps(row, ensure_ascii=False)
                if MARKER in text or any(identifier in text for identifier in ids):
                    doomed[name].add(key)
                    identifier = key.split(":", 1)[1]
                    if len(identifier) >= 8:  # short ids would match unrelated text
                        ids.add(identifier)
                    changed = True
    entries = [path for path in _entries() if path not in set(snap["entries"]) and MARKER in _text(path)]
    for name, keys in doomed.items():
        if keys:
            print(f"{name}: {len(keys)} synthetic record(s)")
    for path in entries:
        print(f"file: {os.path.relpath(path, ROOT)}")
    if not apply:
        print("dry run; pass --apply to remove")
        return
    for name, keys in doomed.items():
        if keys:
            kept = [row for row in collections[name] if _key(row) not in keys]
            target = os.path.join(MASTER, name)
            with open(target + ".tmp", "w", encoding="utf-8") as handle:
                json.dump(kept, handle, ensure_ascii=False, indent=2)
            os.replace(target + ".tmp", target)
    for path in entries:
        shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
    # Stored PDF bytes of synthetic document receipts, unless a kept receipt still points at them.
    acquisitions = collections.get("supplier_document_acquisitions.json", [])
    gone = doomed.get("supplier_document_acquisitions.json", set())
    kept_hashes = {row.get("sha256") for row in acquisitions if _key(row) not in gone}
    for row in acquisitions:
        digest = str(row.get("sha256") or "").lower()
        if _key(row) in gone and digest and digest not in kept_hashes:
            blob = os.path.join(ROOT, "data", "supplier-documents", "sha256", digest[:2], f"{digest}.pdf")
            if os.path.exists(blob):
                os.remove(blob)
    print("removed")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "snapshot":
        snapshot()
    elif command == "delete":
        delete("--apply" in sys.argv)
    else:
        print(__doc__)
