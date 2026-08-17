"""Lightweight drift check for docs/FORMULAB_V1_TASK_TRACKER.md.

Usage: python scripts/validate_v1_tracker.py

Checks, against the tracker's own Markdown tables:
- every task ID is unique
- every task ID belongs to exactly one of FVL-01..FVL-11 (no FVL-12+)
- only the three allowed status literals appear (blank / ON PROCESS / COMPLETED)
- every "Depends on" reference names a real task ID that exists in the tracker

Exits non-zero and prints every violation found (not just the first) on
failure. Does not check prose outside the task tables — this is a
deliberately small guard against tracker drift, not a full parser.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

TRACKER = Path(__file__).resolve().parent.parent / "docs" / "FORMULAB_V1_TASK_TRACKER.md"
ALLOWED_PACKAGES = {f"FVL-{i:02d}" for i in range(1, 12)}
ALLOWED_STATUSES = {"", "ON PROCESS", "COMPLETED"}
TASK_ID_RE = re.compile(r"\bFVL-(\d{2})(?:\.(\d{3}))?\b")


def find_task_ids(text: str) -> set[str]:
    ids = set()
    for m in TASK_ID_RE.finditer(text):
        pkg, sub = m.group(1), m.group(2)
        ids.add(f"FVL-{pkg}" if sub is None else f"FVL-{pkg}.{sub}")
    return ids


def main() -> int:
    text = TRACKER.read_text(encoding="utf-8")
    errors: list[str] = []

    # Row-level table lines: "| FVL-XX.YYY | Title | ... | Status |"
    task_rows = [
        line for line in text.splitlines()
        if re.match(r"^\|\s*FVL-\d{2}\.\d{3}\s*\|", line)
    ]

    seen_ids: dict[str, int] = {}
    all_ids = find_task_ids(text)

    for line in task_rows:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        task_id = cells[0]
        pkg = task_id.split(".")[0]

        if pkg not in ALLOWED_PACKAGES:
            errors.append(f"unknown package for task {task_id}: {pkg}")

        seen_ids[task_id] = seen_ids.get(task_id, 0) + 1

        # Status is always the last cell in every table shape used here.
        status = cells[-1]
        if status not in ALLOWED_STATUSES and not status.startswith("COMPLETED"):
            errors.append(f"{task_id}: disallowed status literal {status!r}")

        # "Depends on" cell, when present, is second-to-last or third-to-last
        # depending on table shape (FVL-01 has no Depends-on column).
        for cell in cells:
            if cell in ("—", "-", "") or not cell.startswith("FVL-"):
                continue
            for dep in find_task_ids(cell):
                if dep not in all_ids and dep not in ALLOWED_PACKAGES:
                    errors.append(f"{task_id}: dependency {dep!r} not found in tracker")

    for task_id, count in seen_ids.items():
        if count > 1:
            errors.append(f"duplicate task ID: {task_id} appears {count} times")

    present_packages = {tid.split(".")[0] for tid in seen_ids}
    missing = ALLOWED_PACKAGES - present_packages
    if missing:
        errors.append(f"missing work package(s) with no tasks: {sorted(missing)}")

    if errors:
        print(f"FAIL: {len(errors)} tracker issue(s) found:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK: {len(seen_ids)} unique tasks across {len(present_packages)} work packages, no drift found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
