"""stdin/stdout bridge for raw materials and costing (Tauri commands).

Request: {"action": "import"|"list"|"cost", ...}
Response: one JSON object on stdout; diagnostics to stderr.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import materials as mat


def _out(obj) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def main() -> None:
    try:
        req = json.loads(sys.stdin.read())
    except Exception as e:
        return _out({"status": "error", "message": f"invalid request JSON: {e}"})

    action = req.get("action", "")
    data_dir = req.get("data_dir", "")
    if not data_dir:
        return _out({"status": "error", "message": "missing data_dir"})

    try:
        if action == "import":
            path = req.get("path", "")
            if not os.path.isfile(path):
                return _out({"status": "error", "message": f"file not found: {path}"})
            # Supplier exports are frequently Windows-encoded; utf-8-sig also
            # strips the BOM Excel writes.
            raw = open(path, "rb").read()
            for enc in ("utf-8-sig", "utf-8", "cp1254", "cp1252", "latin-1"):
                try:
                    text = raw.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue
            else:
                return _out({"status": "error", "message": "could not decode the file"})

            rows, warnings = mat.parse_materials(text)
            if not rows:
                return _out({"status": "error",
                             "message": "no materials found in that file",
                             "warnings": warnings})
            doc = mat.save_materials(data_dir, rows)
            return _out({"status": "ok", "count": len(rows), "warnings": warnings,
                         "currency": doc.get("currency", ""),
                         "mixed_currencies": doc.get("mixed_currencies", []),
                         "priced": sum(1 for r in rows if r.get("price") is not None)})

        if action == "list":
            return _out({"status": "ok", **mat.load_materials(data_dir)})

        if action == "cost":
            doc = mat.load_materials(data_dir)
            mats = doc.get("materials", [])
            if not mats:
                return _out({"status": "error",
                             "message": "no raw materials imported yet"})
            formula = req.get("formula") or {}
            sheet = mat.cost_formula(
                formula, mats,
                batch_kg=float(req.get("batch_kg") or 100.0),
                currency=doc.get("currency", ""),
            )
            sheet["markdown"] = mat.render_costing_markdown(
                sheet, str(formula.get("name") or ""))
            return _out({"status": "ok", **sheet})

        return _out({"status": "error", "message": f"unknown action: {action!r}"})
    except Exception as e:
        return _out({"status": "error", "message": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
