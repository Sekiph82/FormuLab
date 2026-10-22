VERDICT: PASS
REVIEWER: Codex (code lens; same execution context)

- `read_cards` preserves generic structured JSON and has a markdown-only fallback for sessions saved before `cards.json`.
- The current page already tolerates pre-Session-3 optional card fields; no compatibility shim or schema rewrite is required.
- The scoped Rust read-helper tests, UI tests, and Python traceability tests passed without product-code changes.
