# Result history browser

Closes the first of the three items this phase's prior report disclosed
as incomplete: test-result history browsing was inline-only ("revises
`<id>`" text next to the latest revision) and partial. This document
covers the dedicated browser that replaces it — spec §2.

## Why a dedicated component

`TestResult` and `StabilityResult` already carried everything needed to
reconstruct history (`revisesResultId`, append-only, never mutated in
place — see [TEST_RESULTS.md](TEST_RESULTS.md#revision-history) and
[STABILITY_STUDIES.md](STABILITY_STUDIES.md)) — but nothing actually
walked the chain; a user could only see one prior/next link at a time,
inline, and had to inspect raw ids to go further. `ResultHistoryBrowser.tsx`
is a single component that works for both result types, since both
structurally satisfy the shared `HistoricalResult` shape in
`packages/shared/src/engine/resultHistory.ts`.

## Engine (`packages/shared/src/engine/resultHistory.ts`)

Every function here is defensive: a malformed chain (a missing parent, a
cycle, a duplicate id, an orphan retest, a dangling attachment reference)
returns an honest warning string instead of throwing or silently guessing
— the same pattern `testApplicability.ts` and `approvalPolicy.ts` already
use elsewhere in this codebase.

- **`buildResultRevisionChain(results, startId)`** — walks backward via
  `revisesResultId` to find the root (cycle-guarded), then forward to
  collect every later revision, oldest-first. A duplicate id keeps the
  first occurrence and warns about the rest; a missing parent stops the
  backward walk and warns, treating the current node as the root shown.
- **`resolveEffectiveResultRevision(chain)`** — the chain's last entry
  (`undefined` only for an empty chain).
- **`groupRetestLineage(results)`** — groups by `retestOf`, distinct from
  the revision chain: a retest is a fresh sample, not a correction of the
  same measurement. An orphan retest becomes its own lineage, with a
  warning.
- **`compareResultRevisions(a, b)`** — a deterministic, factual diff:
  mean/minimum/maximum/standardDeviation/coefficientOfVariationPercent,
  pass/fail, reviewer, override reason, attachments added/removed. Never
  infers *why* something changed — only that it did.
- **`resolveAttachmentReplacementChain(attachments)`** — groups a flat
  attachment pool into original -> replacement chains via
  `replacesAttachmentId`. A dangling reference still starts its own chain
  from that attachment (never dropped), with a warning. A pure cycle
  (every attachment replaces another, so no natural root exists) is
  detected and reported rather than silently producing zero chains: each
  component still gets a representative chain via a fallback root.

20 tests in `resultHistory.test.ts` cover: a single unrevised result; a
multi-revision chain from any starting id; a missing parent; a circular
revision reference; a duplicate revision id; retest lineage grouping; an
orphan retest; a human override diff; stats diffs; attachments
added/removed; a superseded attachment kept in its chain; a dangling
attachment reference; a circular attachment-replacement reference.

## UI (`apps/desktop/src/components/formula/ResultHistoryBrowser.tsx`)

A dialog, in the same style as `ExclusionExplorer.tsx`, opened via a
"View history" action next to any recorded result:

- `TrialsPanel.tsx`'s Tests tab — one action per result under a test
  definition.
- `StabilityPanel.tsx`'s sample dashboard — one action per time-point
  result.

Both entry points pass the correctly-scoped pool (every result sharing
that trial/sample + test definition) so the chain and retest-lineage
computations resolve against the right data, not the whole project.

The browser shows:

- **Filter tabs** — All history / Current / Retests / Overrides /
  Attachment events.
- **Per revision** — revision number, result id (copyable), created/
  performed/reviewed by and at, replicate values, stats, pass/fail,
  override status and reason, `revisesResultId`/`retestOf`, and its
  attachments (via `AttachmentField` in `disabled` + `showSuperseded`
  mode, so a historical attachment is always openable and a superseded
  one is always labelled, never hidden).
- **Comparison** — two dropdowns to pick any two revisions from the
  chain; a table highlights only the fields `compareResultRevisions`
  reports as changed.
- **Attachment history** — any attachment replacement chain longer than
  one entry is listed as `original -> replacement -> ...`.
- Warnings from any of the engine functions above render as an alert
  banner at the top of the dialog, never silently swallowed.

## Tests

`ResultHistoryBrowser.test.tsx` (8 tests): single-revision current state;
multi-revision chain marks only the last as current; missing-parent
warning renders instead of crashing; override reason and reviewer render;
retest lineage renders under the Retests filter, separate from the
revision chain; a changed mean between two selected revisions renders in
the comparison table; a superseded-attachment chain renders and its
original attachment opens via the real `openAttachment` resolver; the
dialog's close control calls `onClose`.

`TrialsPanel.test.tsx`/`StabilityPanel.test.tsx` each add one integration
test confirming the "View history" action actually opens the dialog from
a real recorded result in the real panel (not just the standalone
component).

## Known limitations

- The comparison view supports exactly two revisions at a time — no
  side-by-side view of three or more.
- Filtering by "Attachment events" shows revisions that carry at least
  one attachment; it does not further filter to only the revision where
  an attachment was specifically added or replaced.
