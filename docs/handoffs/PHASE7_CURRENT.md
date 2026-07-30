# Phase 7 — Reverse Formulation — Current State

## Status
Shared-domain foundation, candidate-generation/scoring engines, and the Rust
master-data registration for Reverse Formulation are all repaired and
compiling. Data Exchange integration (Session 4) has not started.

## Completed (Session 3: Rust Persistence)
- Fixed a hard compile error: `COLLECTIONS: [(&str, bool); 76]` was declared
  with 76 slots but the array literal actually had 87 entries (76 pre-Phase-7
  plus the 11 Reverse Formulation rows added without updating the length) —
  Rust's fixed-size array type requires an exact match, so the crate did not
  build. Corrected the length to 87.
- Fixed a mutability misclassification: `candidate_score_explanations` was
  registered mutable (`false`), but it is a computed scoring snapshot tied to
  one scoring pass — the same shape as `doe_analyses`/
  `compatibility_snapshots`/`optimization_runs`, all append-only so a
  re-score can't silently overwrite the rationale behind an earlier decision.
  Changed to `true`.
- Verified the remaining 10 Reverse Formulation collections' names (snake_case,
  matching the file's established TS-camelCase → Rust-snake_case convention)
  and mutability against their TS schema lifecycles — all correct, no change.
- Added the 11 missing `data/master/*.json` paths to the file's header
  documentation (every other phase lists its paths there; Phase 7 didn't).

## Persistence decisions
- No collection here grants approval/verification/regulated-record authority
  — same deliberate omission as `approval_records`/`approval_audit_events`
  elsewhere in this file.
- `reverse_formula_candidates` stays mutable (status transitions in place,
  same as `doe_candidates`) — it is a proposal container, not a saved
  `FormulaVersion`, so this does not bypass the "saved formula versions are
  immutable" rule; promotion to a real formula version is a separate,
  untouched system.

## Files changed
- `apps/desktop/src-tauri/src/masterdata.rs`

## Tests passing
- `cargo test --lib masterdata::` in `apps/desktop/src-tauri` — 11/11 passing
  (includes 4 new: allow-list + mutability for all 11 Reverse Formulation
  collections, fixed-length regression guard, no-duplicate-name guard,
  extended unknown/wrong-case name rejection).
- Crate compiles (`cargo test` invocation itself is the compile check).

## Known limitations
- `CandidateScoreExplanation` (schemas/reverseFormulation.ts) has no `code`
  or `id` field, so the generic `upsert_master_records`/`row_key()` path
  cannot actually write rows into `candidate_score_explanations` yet — every
  upsert would fail with "record has no `code` or `id`". Out of this
  session's scope (schema change); flagging for whoever wires up Reverse
  Formulation persistence calls from the UI.

## Latest commit and sync status
See commit `fix(reverse-formulation): repair rust persistence registration`
on `feature/laboratory-stability`, pushed to its tracking branch.

## Next session
Phase 7 Session 4: Data Exchange Integration
