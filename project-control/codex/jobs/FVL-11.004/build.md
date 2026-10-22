STATUS: READY

No product change was needed: the current Tauri read helpers keep historical card JSON as generic values, fall back to the markdown-only format when `cards.json` is absent, and return safe null/empty values for pre-existing absent session files. The existing FormulationResultPage test fixtures also exercise historical cards with optional Session 3+ fields missing.

Validation:
- `pnpm --filter @formulab/desktop exec vitest run src/app/routes/FormulationResultPage.test.tsx` — 1 file, 54 tests passed, including historical session rendering.
- `python -m unittest test_traceability` — 10 tests passed, including pre-Session-6 card compatibility.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib formulation_v2::tests::` — 13 tests passed for card fallback, pre-Session-3 cards, brief and optional literature/scientific-formulation files. `TAURI_CONFIG` only overrode bundle `externalBin` for the unit-test command because this checkout has no packaged `uv` binary; no repository config or binary was changed.
- `pnpm codex:tasks:check` and `git diff --check` — passed.

Historical values remain unchanged, absent evidence is not fabricated, and no test writes to owner session data.
