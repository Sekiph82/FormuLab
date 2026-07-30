# Phase 8 — Reports, Dossiers, Document Exports, Final Data Exchange Expansion

## Current status
Session 2 complete: pure, deterministic dossier export-snapshot assembly
engine implemented, tested, typechecked. No rendering, UI, Rust
persistence, Data Exchange, audit, or authorization work done yet.

## Session 2 — assembly engine completed
`packages/shared/src/engine/dossierExportAssembly.ts`:
`assembleDossierExportSnapshot(input)` — pure function, no I/O, no
mutation, no `Date.now()`/`crypto.randomUUID()`. Reuses
`regulatoryDossier.ts`'s own `currentRequirementsForRevision`,
`buildEvidenceMatrix`, `calculateDossierReadiness`,
`compareDossierRequirementsToCurrentRules`, `deriveEvidenceStatus`,
`isDossierReviewActive`, `resolveEvidenceRevisionChain` — none of that
logic reimplemented. Composes `DocumentSourceReference`/
`DossierExportSnapshotMeta` from Session 1 rather than adding a new
schema (none was strictly required this session).

## Input/output decisions
Input: one `RegulatoryDossier` + its exact `dossierRevision` (validated
against `dossier.revision`) + every dossier-domain record array +
optional `approvalSnapshot`/`currentRules`/`formulaApprovalStatusAtGeneration`
+ explicit `generationTimestamp`/`generatedBy`. Output: requirements,
evidence matrix, evidence items (derived-status, supersession-chain
inclusive), links (every status, full transparency), reviews (frozen
snapshots preserved exactly), review revocations, submissions, manual
actions, computed readiness, optional drift, passthrough approval
snapshot, warnings, static assumptions.

## Deterministic ordering rules
Every array copied before sorting (`stableSortBy`, never in-place
`.sort()`); every comparator ends in an `id` tie-breaker. Requirements by
`requirementCode`; evidence by `evidenceType` then `title`; links by
`requirementId`/`evidenceItemId`/`linkedAt`; reviews/submissions/manual
actions/revocations by their own timestamp field.

## Integrity safeguards
Throws on: mismatched `dossierRevision`, any record referencing a
different `dossierId`, duplicate requirement ids, a review revocation
pointing at an unknown review, a missing `generationTimestamp`/
`generatedBy`, a missing `formulaVersionId`. Silently EXCLUDES (not an
error) records for a different revision of the *same* dossier — normal
historical data. Revoked/proposed links never count toward the evidence
matrix (reused, not reimplemented). Superseded evidence gets its
DERIVED status via `deriveEvidenceStatus`, never the possibly-stale
stored value. `approvalSnapshot`/`dossierStatus` are passthrough/readonly
only — nothing here can grant or infer approval.

## Files changed this session
`packages/shared/src/engine/dossierExportAssembly.ts` (new),
`packages/shared/src/engine/dossierExportAssembly.test.ts` (new, 19
tests), `packages/shared/src/index.ts` (one export line).
`documentExport.ts` untouched — no new schema was required.

## Focused tests passing
`vitest run src/engine/dossierExportAssembly.test.ts` — 19/19. Shared
typecheck — clean. `regulatoryDossier.ts` untouched (read-only reuse via
import), so its own test suite was not rerun.

## Known limitations
No render engine (Session 3), no Rust persistence, no Data Exchange
template, no UI wiring, no audit/authorization integration. This engine
never loads records itself — the caller (a future Session 4 UI action)
must load and pass in every array.

## Recommended sessions (unchanged plan, see external log for detail)
3. PDF + DOCX render engines (next)
4. Reports + Dossiers desktop workspace wiring
5. Data Exchange expansion
6. Export history, audit, authorization integration
7. Focused Phase 8 verification
8. Closure: full regression, release, installers, shortcut, native verify

## Exact next session
Phase 8 Session 3: PDF and DOCX Render Engines.
