# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: SESSION 4A COMPLETE — the three residual gaps Session 4 explicitly disclosed are closed. Every command from the Session 3 privileged-command inventory now has a final disposition — none remain `DEFERRED_WITH_REASON` without a stated, concrete justification. All four Production Manager workflow gates (raw-material verification, supplier-document verification, production-engineering handoff, production release) are implemented as real, auditable workflow-state records with role- and state-machine-enforced worker/manager separation and downstream blocking — deliberately not forced into `FormulaStatus`. The masterdata collection->PolicyArea mapping now has TypeScript parity, closing Session 4's Rust-only gap. Phase 13 is **still not** claimed fully secure — architecture doc §9.4.6 tracks the live residual list (no frontend UI for the four gates, gate-subject existence unvalidated, `cancel_advanced_formulation_optimize` ungated by precedent, §6's matrix still first-draft). Full design: `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §9.4; test report: `docs/PHASE13_SECURITY_TEST_MATRIX.md` §K.

## Session 4A summary

**Deferred-command backlog closed** (architecture doc §9.4.1): every
Session-3-inventoried command now has a final category.
`resume_interrupted_data_move` is gated identically to its sibling
data-location commands (`systemAdministration`/`administer`).
`materials::import_materials` is gated `rawMaterials` create-or-edit
(a wholesale list replace, same category as `upsert_master_records`).
Seven compute/read commands across `materials.rs`/`formulation.rs`/
`formulation_advanced.rs`/`formulation_v2.rs` now require a valid
session (AUTHENTICATED_READ) — no persistence to a shared collection
happens in any of them; that already goes through the Session-4-gated
`formulations::` commands. `provenance::record_provenance`/
`runs::record_run` are reclassified as genuinely non-privileged — this
app's separate notebook/agent-runtime workspace-tracking subsystem, not
FormuLab lab/business records, no `rolePolicy` area applies.
`cancel_advanced_formulation_optimize` stays ungated, consistent with
the existing cancel-command precedent (`cancel_backup`/`cancel_restore`/
`cancel_data_move`, none gated since Session 4).

**Administrator gains the four gates' decide capability** (§9.4.2): a
third documented discrepancy-resolution in `rolePolicy.ts`, alongside
Session 3's first two — §15.4 is explicit that administrator exercises
all four gates on the same explicit-exception basis as every other
gate, which §6's literal view-only cells for administrator on those
four areas contradicted.

**The four Production Manager workflow gates are real** (§9.4.3/§9.4.4):
a new module, `workflow_gates.rs`, and a new mutable-record-per-subject
storage pattern (`data/workflow_gates/<gateType>/`), not embedded
fields on `RawMaterial`/`Supplier`/`FormulationVersion` — versions are
immutable once written, so an in-place-progressing gate cannot live
inside one. Each gate: `pending -> submitted -> approved|rejected`,
`rejected -> submitted` again for the worker to fix and resubmit. Two
commands cover all four (`submit_workflow_gate`, `decide_workflow_gate`)
plus a read command. Worker/manager separation is structural: a worker
role never holds the decide capability in `role_policy.rs`'s real
matrix, proven directly against it, not a mock. Downstream blocking is
real: `production_engineering_handoff` is blocked until the
formulation version's status is `production_approved`;
`production_release` is blocked until `production_engineering_handoff`
is `approved` for the same version — checked *before* a worker can even
submit, not just before a manager can approve.

**Masterdata collection->PolicyArea mapping now has TypeScript parity**
(§9.4.5): `masterdataPolicyAreas.ts` is the new canonical source (a
`Record<MasterdataCollection, PolicyArea>` that makes a missing entry a
compile error), generated to a JSON fixture Rust's `role_policy.rs`
reads — the same shared-fixture mechanism the role matrix and
transition graph already use. `masterdata.ts`'s `Collection` type now
derives from the shared list instead of declaring a second hand-typed
union. `masterdata.rs`'s `area_for_collection()` is now a one-line
delegator, not a hand-typed `match`.

Rust: 304/304 (Session 4's 281 + 23 new), clippy clean. Shared:
1301/1301 (1296 + 5 new), tsc clean. Desktop: 1188/1188 (unchanged —
no new frontend behavior, only wiring with existing coverage), tsc
clean, eslint clean.

## Deliverables (this session)

- `apps/desktop/src-tauri/src/workflow_gates.rs` (new) — the four
  Production Manager gates. 19 tests.
- `apps/desktop/src-tauri/src/role_policy.rs` — `masterdata_area_for()`
  reading the new shared fixture, replacing `masterdata.rs`'s hand-typed
  match. 4 new tests.
- `packages/shared/src/engine/masterdataPolicyAreas.ts` (new) — the
  canonical collection->area contract.
- `packages/shared/src/engine/masterdataPolicyAreas.parity.test.ts`
  (new, 5 tests) + `masterdataCollectionAreas.generated.json` (new).
- `packages/shared/scripts/generate-role-policy-matrix.ts` — extended
  to also emit the masterdata-areas fixture.
- `packages/shared/src/engine/rolePolicy.ts` — third discrepancy-
  resolution (administrator on the four gates' areas).
- `apps/desktop/src-tauri/src/masterdata.rs` — `area_for_collection()`
  now a one-line delegator.
- `apps/desktop/src-tauri/src/data_location_manager.rs`,
  `materials.rs`, `formulation.rs`, `formulation_advanced.rs`,
  `formulation_v2.rs` — the 9 previously-deferred commands gated.
- `apps/desktop/src-tauri/src/formulations.rs` — `formulation_dir`
  widened to `pub(crate)` for `workflow_gates.rs`'s read access.
- `apps/desktop/src-tauri/src/lib.rs` — registers `mod workflow_gates;`
  + its 3 commands.
- `apps/desktop/src/lib/masterdata.ts` — `Collection` type now derives
  from `@formulab/shared`.
- `apps/desktop/src/lib/formulationV2.ts`, `tauri.ts` — token wiring
  for the 9 newly-gated commands.
- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — new §9.4 (6
  subsections); §15.4 Session 4A status note; §25/Risks updated.
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` — new §K.
- This handoff.
- External log:
  `C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md`,
  Session 4A entry appended.

## What Session 4A deliberately did NOT do

- No frontend UI or wrapper for the three workflow-gate commands —
  backend-then-UI sequencing, same as this phase's established pattern.
- No gate-subject existence validation (a `materials`/`suppliers` code
  or `formulationId`/`versionId` that doesn't exist can still get a
  gate record created against it) — a data-integrity gap, not an
  authorization one.
- Did not gate `cancel_advanced_formulation_optimize` — consistent
  with, not independently re-justified beyond, the existing
  cancel-command precedent.
- Did not re-review §6's matrix itself — Session 4A's administrator
  addition is a third discrepancy-resolution layered on top of it, not
  the domain-expert review Risks item 1 still calls for.
- Did not touch `Administration → Users` (still Session 5), brute-force/
  lockout policy, or full audit-event coverage beyond what `authz.rs`
  and `workflow_gates.rs` already log.

## Open decisions requiring a human answer before Session 5

1. §6's full role-permission matrix — now three discrepancy-resolutions
   deep (production_manager's original two, administrator's new one for
   the four gates). Needs the domain-expert review every session since
   Session 1 has flagged.
2. Are the four gates' storage locations (masterdata codes for two,
   formulation-version-scoped records for the other two) the right
   long-term model, or should a future session promote them to
   first-class collections with their own masterdata entries?
3. Should gate-subject existence be validated before allowing a submit?
4. Does `run_automatic_backup` (still unauthenticated) or
   `cancel_advanced_formulation_optimize` (still ungated) need
   revisiting once real usage patterns are observed?

## Exact next session

**Phase 13 Session 5: `Administration → Users` UI** — list, create,
edit, role change, reset password, activate/disable, security-history
view, read-only role-capabilities view (rendered from `rolePolicy.ts`).
Per the original plan's shape, unchanged by this session. A UI for the
four workflow gates is real, disclosed follow-up work but not named as
Session 5 itself — whichever session builds it should reuse
`submit_workflow_gate`/`decide_workflow_gate`/`read_workflow_gate`
as-is, no backend changes anticipated.
