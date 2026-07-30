# Phase 7 — Reverse Formulation — CLOSED

## Status
Closed. All subsystems complete: shared domain (declaration parsing,
ingredient mapping, analytical inference, candidate generation, scoring/
evidence confidence), Rust persistence (11 collections), Data Exchange
integration (11 templates, 24→35 total), the `/reverse-formulation`
workspace, and candidate-to-formula conversion.

## Final capabilities
Given a benchmark product's declared ingredients (+ optional analytical
results), generates evidence-scored candidates against a target/constraints.
Score and evidence-confidence show as two distinct numbers — unevaluated
dimensions read "not evaluated", never defaulted to passing. Candidates
convert into a new formulation draft or a new version on an existing one via
the real formulation engine (no second persistence path); no approval/
verification is ever inherited; missing catalog materials block conversion
visibly. Full detail: IMPLEMENTATION_STATUS.md's "Reverse Formulation
(Phase 7)" section.

## Tests passing (closure regression, 2026-07-30)
Shared 1154/1154, desktop 614/614, Rust 79/79; shared/desktop typecheck,
desktop lint, Rust clippy clean. Closure fixed 2 pre-existing regressions
surfaced by full regression (not new Phase 7 defects): a stale
`DataExchangePage.test.tsx` template-count assertion (24→35, never updated
for the Phase 7 additions), and an i18next-lint literal-string violation on
`CandidateComparisonPanel` (`aria-hidden="true"` → bare `aria-hidden`,
matching this codebase's icon-component convention).

## Release artifacts
`apps/desktop/src-tauri/target/release/bundle/`:
- `msi/FormuLab_0.4.0_x64_en-US.msi` (35,356,672 B) —
  sha256 `A21908257565EE982FAB72E35621A94974726A8A7B6CC1DA6FACDE67B86385AC`
- `nsis/FormuLab_0.4.0_x64-setup.exe` (24,693,477 B) —
  sha256 `AF936CEFF3338714D772BA5D7D03DDF47E375DC26D842E03A3AE02C75EC0BAAB`
  (no prior repo hashing convention existed; used `Get-FileHash -Algorithm SHA256`)

## Native verification result
PARTIALLY LIVE VERIFIED — same honest label `TAURI_LIVE_VERIFICATION.md`
already uses. Real launch/window/Sidebar presence confirmed against the
packaged release exe. Deep interior click-through hit the same wheel-scroll/
DPI-coordinate environment limitation already disclosed there (reproduced,
not new). Interior behavior verified instead via
`ReverseFormulationPage.test.tsx`'s 23 real-component-tree integration
tests (real render + `userEvent`, only the Tauri IPC boundary mocked).

## Known non-blocking limitations
- Conversion forms are intentionally minimal; no cost/regulatory/lab
  pre-check before conversion (decision support, not a gate, by design).
- Full native interior click-through stays environment-blocked pending
  `tauri-driver`/WebDriver (same recommendation as Phase 1).

## Final commit and sync status
`chore(reverse-formulation): close phase 7` on `feature/laboratory-stability`,
pushed to its tracking branch.

## Next recommended project phase
Evidence origin classification, manufacturing methods + batch records, or
PDF/DOCX dossier export — see IMPLEMENTATION_STATUS.md's "Not yet started".
