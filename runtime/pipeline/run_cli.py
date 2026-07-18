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
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _err(msg: str, session_dir: str = "") -> None:
    out = {"status": "error", "message": msg}
    if session_dir:
        out["session_dir"] = session_dir
    sys.stdout.write(json.dumps(out))
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
    sessions_dir = req.get("sessions_dir") or ""
    out_dir = req.get("out_dir", "")
    n = int(req.get("n", 3) or 3)

    for name, val in (("provider", provider), ("model", model),
                      ("library_dir", library_dir)):
        if not val:
            return _err(f"missing required field: {name}")

    import pipeline

    # Session folders are named for WHEN they ran, so the folder list reads
    # chronologically in a file manager: 2026-07-18-0931-laundry-detergent.
    if not out_dir:
        if not sessions_dir:
            return _err("missing required field: sessions_dir (or out_dir)")
        stamp = time.strftime("%Y-%m-%d-%H%M")
        out_dir = os.path.join(sessions_dir, f"{stamp}-{pipeline._slug(brief.get('target', ''))}")
        # Two runs of the same product inside one minute must not collide.
        if os.path.exists(out_dir):
            out_dir = f"{out_dir}-{time.strftime('%S')}"

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
        # Report the directory even on failure: the caller deletes it, so a
        # crashed run leaves no half-written session behind.
        return _err(f"pipeline crashed: {e}", session_dir=out_dir)

    res["session_dir"] = out_dir
    res["session_id"] = os.path.basename(out_dir)
    sys.stdout.write(json.dumps(res, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
