"""stdin/stdout bridge for the desktop app (Tauri `generate_formulation`).

Reads ONE JSON request from stdin, runs the v2 pipeline (real literature +
one LLM call, no OpenCode), writes ONE JSON response to stdout. All diagnostic
logging goes to stderr so stdout stays pure JSON.

Request:
  {"brief": {...}, "provider": "gemini", "model": "...", "api_key": "...",
   "library_dir": "...", "out_dir": "...", "n": 3}

Response: whatever pipeline.run() returns, plus {"status": "error", "message"}
on any unexpected failure.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _err(msg: str) -> None:
    sys.stdout.write(json.dumps({"status": "error", "message": msg}))
    sys.stdout.flush()


def main() -> None:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except Exception as e:
        return _err(f"invalid request JSON: {e}")

    brief = req.get("brief") or {}
    provider = req.get("provider", "")
    model = req.get("model", "")
    api_key = req.get("api_key", "")
    library_dir = req.get("library_dir", "")
    formulas_dir = req.get("formulas_dir") or None
    out_dir = req.get("out_dir", "")
    n = int(req.get("n", 3) or 3)

    for name, val in (("provider", provider), ("model", model),
                      ("library_dir", library_dir), ("out_dir", out_dir)):
        if not val:
            return _err(f"missing required field: {name}")

    import pipeline

    def log(m: str) -> None:
        sys.stderr.write(f"[pipeline] {m}\n")
        sys.stderr.flush()

    try:
        res = pipeline.run(
            brief, provider=provider, model=model, api_key=api_key,
            library=library_dir, out_dir=out_dir, n=n,
            formulas_dir=formulas_dir, log=log,
        )
    except Exception as e:
        return _err(f"pipeline crashed: {e}")

    sys.stdout.write(json.dumps(res, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
