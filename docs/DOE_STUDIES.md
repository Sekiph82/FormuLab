# DOE studies (Phase 5)

`packages/shared/src/schemas/doe.ts` (`doeStudySchema`),
`packages/shared/src/engine/doeDesign.ts` (`createDoeStudy`/`reviseDoeStudy`/
`isDoeStudyImmutable`/`canTransitionDoeStudyStatus`/`deriveDoeStudyStatus`/
`resolveDoeRevisionChain`).

## The study record

```ts
DoeStudy {
  id, schemaVersion: "1.0", studyCode, title, description?,
  projectId, formulationId,
  baselineFormulaVersionId,   // a SAVED FormulationVersion.id — never a draft
  status,                     // 12-state lifecycle
  designType,                 // the DoeDesignType this study intends to use
  randomizationEnabled, blockingEnabled,
  replicatePolicy,            // "none" | "all_points" | "center_points_only" | "custom"
  centerPointPolicy,          // "none" | "fixed_count" | "auto_recommended"
  revision,                   // bumped by reviseDoeStudy
  createdBy, createdAt, updatedBy?, updatedAt,
  startedAt?, completedAt?,
  supersedesStudyId?,         // set on a revision, points at the study it replaces
}
```

`DOE_STUDY_STATUSES` (12): `draft`, `design_ready`, `runs_generated`,
`in_progress`, `data_complete`, `analysis_ready`, `analyzed`,
`candidate_selected`, `completed`, `cancelled`, `superseded`, `archived`.

## Bound to a real saved version, always

`createDoeStudy` throws if `baselineFormulaVersionStatus` is the working-
draft token — a study can never be created against a draft. This is
enforced in code, not just documented: a saved `FormulationVersion.status`
can never legitimately be `"draft"` (that token belongs only to
`FormulationDraft`), so a caller passing a draft's status through by
mistake is refused immediately.

## Every child record carries a `studyRevision`

`DoeFactor`/`DoeConstraint`/`DoeResponse`/`DoeDesign`/`DoeRun`/
`DoeObservation`/`DoeAnalysis`/`DoeCandidate` all store the exact
`studyRevision` they belong to. A later revision of the same study can
never silently reinterpret an older, already-generated design or completed
analysis — the two revisions' child records simply don't overlap.

## Immutability, via revision, not in-place edit

Once a study reaches `analyzed`, `candidate_selected`, `completed`,
`superseded`, or `archived` (`DOE_STUDY_IMMUTABLE_STATUSES`), its factors,
constraints, responses and design are frozen. A meaningful change — a
different factor range, a new response, a redesigned factorial — creates a
new revision via `reviseDoeStudy(original, changes, actor)`, which bumps
`revision`, resets to `draft`, and points `supersedesStudyId` at the
original. `resolveDoeRevisionChain(study, allStudies)` walks that chain
back to the very first revision, oldest first, so the workspace's History
tab can show the full lineage of a study that has been revised several
times.

## Status is derived, never hand-set mid-study

`deriveDoeStudyStatus` recomputes a study's status from what actually
exists — has a design been generated, how many runs are complete, how many
observation slots are filled, does an analysis exist, has a candidate been
selected — never from a dropdown a human flips independently of reality.
`canTransitionDoeStudyStatus(from, to)` defines the allowed status graph
(see [DESIGN_OF_EXPERIMENTS.md](DESIGN_OF_EXPERIMENTS.md) for the diagram);
once a study reaches an immutable status, `deriveDoeStudyStatus` always
returns that status regardless of any later count changes.

## Authorization

`createDoeStudy`/`reviseDoeStudy`/`generateDoeDesign`/`createDoeAnalysis`/
`createDoeCandidates` all call `requireHumanActor` — an AI, system, or
import actor can never create or advance a study. Every human
`ApprovalRole` (researcher/chemist/quality/regulatory/production/
administrator) may draft a study; see [DOE_CANDIDATES.md](DOE_CANDIDATES.md)
for the narrower set of roles that select a candidate or approve a study's
completion, which the workspace's audit log (`doe.*` events) records either
way. See [../packages/shared/src/schemas/status.ts](../packages/shared/src/schemas/status.ts)
for the `Actor`/`ApprovalRole` primitives every phase in this app reuses.

## Status

Implemented, tested (`doeDesign.test.ts`), live-verifiable through the
`/doe` workspace's Studies and History tabs.
