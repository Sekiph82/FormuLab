# Navigation and context preservation

How the ten workspaces (see [WORKSPACES.md](WORKSPACES.md)) share which
project/version/tab/section a user is looking at, so moving between them
— or refreshing the app — doesn't lose their place. See
[INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md) for why this
replaced the old single-page Formula Builder's in-memory-only state.

## `?project=` / `?version=` — `useProjectParam`

`apps/desktop/src/hooks/useProjectParam.ts` reads/writes the `project`
and `version` query params on the current URL via React Router's
`useSearchParams`. Every project-bound workspace (Formulation,
Laboratory, Stability, Optimization, Regulatory, Approval) calls it.

```ts
const { projectId, versionId, setProject, setVersion } = useProjectParam();
```

`setProject(id)` sets `?project=<id>` and **clears** `?version=` (a new
project never keeps the old project's version selection). `setProject(null)`
removes `?project=` entirely, returning the workspace to its
"no project selected" state. `setVersion(id | null)` sets or clears
`?version=` independently.

Because this lives in the URL, not component state: a browser/app
refresh keeps the same project and version selected (the page remounts,
`useFormulationWorkspace` reloads from persisted storage, and the query
params tell it what to reload); a link from one workspace to another
carries the project (and often version) forward explicitly, rather than
requiring the destination to guess or defaulting to nothing.

## No project selected — `ProjectPicker`

`apps/desktop/src/components/workspace/ProjectContextBar.tsx` exports
`ProjectPicker`, shown by every project-bound workspace when `projectId`
is `null`. It lists every formulation project (`listFormulations()`) to
choose from, or — if there are none — an honest empty state
(`workspace.noProjectsYet`, not a spinner or a blank screen pretending to
load). A workspace **never guesses** which project the user means.

## Project selected — `ProjectContextBar`

The same file exports `ProjectContextBar`: a header showing the
project's name/code/markets, a version `<select>` (hidden via
`showVersionSelector={false}` for workspaces like Optimization that
always operate on the current working draft, never a specific saved
version), a "change project" back-link (clears `?project=`), and an
"Open in Formulation" link. Laboratory and Stability render this in
full; Regulatory and Approval render a one-line project header instead,
since `RegulatoryPanel.tsx`/`ApprovalPanel.tsx` already manage their own
version selection internally.

## `?tab=` (Formulation) and `?section=` (Laboratory)

Formulation and Laboratory each have their own internal tab/section
strip that isn't shared with other workspaces, so each reads its own
query param on mount:

- `FormulationPage.tsx` reads `?tab=` — one of `builder`/`versions`/
  `cost`/`compatibility`/`safety`/`packaging` — and opens that tab;
  defaults to `builder` if absent or unrecognized.
- `LaboratoryPage.tsx` reads `?section=` — one of `trials`/`tests`/
  `correctiveActions` — and opens that section; defaults to `trials`.

Both also read this on every navigation (not just first mount), via a
`useEffect` keyed on the search-param value, so clicking a second
cross-workspace link while already on the page still lands on the right
tab/section.

## `?focusLine=` (Formulation)

`FormulationPage.tsx` also reads `?focusLine=<lineId>`, forcing the
`builder` tab open and passing the line id to `FormulaBuilder.tsx` so it
scrolls to/selects that line. This is how an Approval blocker that names
a specific formula line (via `ApprovalPanel.tsx`'s `onFocusLine`
callback) lands exactly there instead of just opening the Formulation
workspace generically.

## Approval blocker navigation — `mapApprovalNavTargetToPath`

`ApprovalPage.tsx` exports a pure function,
`mapApprovalNavTargetToPath(target: NavTarget, projectId: string): string`,
mapping each blocker source to a real route — always carrying
`projectId` forward, never guessing one:

| `NavTarget` | Route |
|---|---|
| `builder` | `/formulation?project=<id>&tab=builder` |
| `compatibility` | `/formulation?project=<id>&tab=compatibility` |
| `safety` | `/formulation?project=<id>&tab=safety` |
| `cost` | `/formulation?project=<id>&tab=cost` |
| `optimizer` | `/optimization?project=<id>` |
| `trials` | `/laboratory?project=<id>&section=trials` |
| `tests` | `/laboratory?project=<id>&section=tests` |
| `correctiveActions` | `/laboratory?project=<id>&section=correctiveActions` |
| `stability` | `/stability?project=<id>` |
| `regulatory` | `/regulatory?project=<id>` |

Kept as a standalone exported function (rather than inlined in the
`onNavigate` callback) specifically so it can be unit-tested without
mounting the full `ApprovalPanel.tsx` — see `ApprovalPage.test.tsx`.

## What survives a refresh, and what doesn't

Survives: which project (`?project=`), which version (`?version=`),
which Formulation tab (`?tab=`), which Laboratory section (`?section=`),
which line is focused (`?focusLine=`) — all URL state, reloaded fresh
from persisted storage by `useFormulationWorkspace` on remount.

Does not survive: in-progress, unsaved edits to the working draft
(`useFormulationWorkspace`'s debounced autosave writes the draft to disk
independently of the URL — see `apps/desktop/src/lib/formulations.ts`'s
`saveDraft`/`readDraft` — so a refresh recovers the last *autosaved*
draft, not necessarily the very last keystroke); which sub-view is open
*inside* a reused panel that manages its own internal state
(`RegulatoryPanel.tsx`'s jurisdiction/reviewer-role selection,
`TrialsPanel.tsx`'s selected trial) — those panels were not changed by
this task and keep whatever state-persistence behavior they already had.

## Known bound: Home's cross-project aggregation

`HomePage.tsx` reads two kinds of data: collections that are genuinely
global (`listRecords("laboratory_trials"/"stability_studies"/
"stability_samples")` — one call each, covering every project) and
per-project data that requires one call per project
(`readAuditLog`/`readFormulation`, for recent activity and pending
approvals). The per-project reads are bounded to the 5 most-recently-
updated projects (`RECENT_PROJECT_LIMIT`) rather than looping over every
project in the workspace — a real, intentional bound to keep the
dashboard's load cost predictable, not a silent cap presented as a
complete global view. A workspace with more than 5 active projects will
not see every project's activity/pending-approval entries reflected on
Home; open **Projects** for the complete list.

Phase 3's dossier signals (in-preparation/ready-for-review/blocked
counts, evidence expiring soon, reviews pending) read the genuinely
global dossier collections but are then filtered down to the same 5
recent projects before `calculateDossierReadiness` runs on each one — the
identical bound, not a separate one, so a workspace with more than 5
active projects will likewise not see every project's dossier there
either; open the project's own **Dossiers** workspace for the complete
picture.

## Dossiers workspace query params — `DossiersPage`

`DossiersPage.tsx` reads `?project=` (via the same `useProjectParam` as
every other workspace) plus four dossier-specific params:
`?version=<formulaVersionId>`, `?jurisdiction=<RegulatoryJurisdiction>`,
`?sku=<packagingSkuCode>`, and `?dossier=<dossierId>`. The first three
prefill the creation flow (used by `RegulatoryPanel.tsx`'s "create
dossier" deep link, scoped to whatever version/jurisdiction/packaging SKU
was selected in Regulatory at the time); `?dossier=` opens straight to an
existing dossier's detail view (used by Home's and Projects' dossier
links). None of the four are required — omitting all of them shows the
plain dossier list for the current project.
