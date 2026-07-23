# Approval workflow — manual smoke test

## Why this document exists

Spec §1.7 asked for a real, interactive click-through of the packaged
Tauri app — not React component tests.

**Correction (this phase):** an earlier version of this document claimed
"there is no attached display... this environment cannot do that." That
claim was not re-verified before being written down, and this phase found
it to be false — see `docs/TAURI_LIVE_VERIFICATION.md`. A real display and
real native mouse/keyboard automation via `user32.dll` do work here. What
is still true is narrower: no accessible (DOM-level) element tree is
exposed for the WebView2 content, and the virtual display is shorter than
FormuLab's designed window height, so coordinate-based automation could
not reach every tab in the spec's interaction checklist in the time
available. Read `docs/TAURI_LIVE_VERIFICATION.md` for the full, current
investigation and its honest status label before relying on this
document's older framing.

What this phase actually verified, and how:

- **`cargo build --lib` / `cargo clippy -D warnings` / `cargo test`** — the
  Rust side (including the new `attachments.rs` commands and the
  `masterdata.rs` collection additions) compiles, lints clean, and its own
  unit tests pass.
- **`pnpm --filter @ai4s/desktop build`** — the full Vite production
  bundle builds without error.
- **React Testing Library integration tests** (`ApprovalPanel.test.tsx`,
  `AttachmentField.test.tsx`, `TrialsPanel.test.tsx`,
  `StabilityPanel.test.tsx`) — these render the REAL components with only
  the Tauri IPC boundary mocked (`@/lib/masterdata`, `@/lib/formulations`),
  exercising real user interactions (`userEvent.click`/`.type`) against
  real engine code. This is meaningfully more than a unit test, but it is
  still not the packaged native window.

Neither of those is a substitute for actually launching `formulab.exe` (or
the dev build) and clicking through it. Until someone runs the checklist
below on a machine with a display attached to this repository, the items
in it are **not verified**, live or otherwise.

## Running it yourself

```powershell
cd C:\Users\sekip\Desktop\FormuLab
pnpm --filter @ai4s/desktop tauri dev
```

Wait for the window to open, then work through every row. Check the box
only once you have actually done the action and seen the described result
— not once it "looks like it should work."

| # | Action | Expected result | ✅ |
|---|---|---|---|
| 1 | Open a formula project → Formula Builder | Builder loads with the project's lines | ☐ |
| 2 | Open the **Approval** tab | Version selector, status, readiness banner, blocker/warning lists render | ☐ |
| 3 | Click **Manage policies** → **New policy** | Full field form appears (name, description, target status, effective date, scope, min. time points, priority, all requirement toggles) | ☐ |
| 4 | Fill in a name, check a couple of toggles, Save | New policy appears in the list, inactive | ☐ |
| 5 | Click **Edit** on that policy, change a toggle, try Save with no reason | Save stays disabled / an error asks for a change reason | ☐ |
| 6 | Enter a reason, Save | Policy updates; **History** shows two revisions | ☐ |
| 7 | Click **Restore** on revision 1 | A new revision 3 appears with revision 1's field values; revisions 1–2 are unchanged in the history list | ☐ |
| 8 | Click **Clone** on a policy | A new, independent, inactive policy appears with its own (fresh) history | ☐ |
| 9 | Click **Retire** on a policy, confirm reason | Policy shows "Retired"; its Edit/Activate buttons disappear | ☐ |
| 10 | Set two policies' scope to overlap (same family, both unscoped or both scoped to it, both active, same target status) | The Approval tab shows a policy-conflict blocker and the Approve button is disabled | ☐ |
| 11 | Manually select one of the two conflicting policies from the dropdown | The conflict blocker disappears | ☐ |
| 12 | Click **Equivalent versions**, pick a candidate version, read the comparison, enter a justification, Declare | Equivalence appears in the list; the laboratory/stability summary cards show the "Includes evidence from equivalent version(s)" badge | ☐ |
| 13 | Click **Revoke** on that equivalence with a reason | It disappears from the active list; the evidence badge disappears | ☐ |
| 14 | Open **Trials** → a trial's **Tests** tab, record a result with an attached file | Attachment appears under the result, disabled (no remove) | ☐ |
| 15 | Click **Replace** on that finalized attachment, pick a new file | A new result revision appears (`revises <id>`); the old attachment is marked "Superseded" when shown with history visible | ☐ |
| 16 | Open **Test applicability** from the Tests tab | Included/Excluded tabs list definitions; excluded ones show specific reason chips (wrong family/SKU/context/condition/time point/inactive) | ☐ |
| 17 | Reach a formula version's readiness to fully "Ready", fill reviewer fields, click **Approve** | Version's effective status changes; the record appears in Approval history | ☐ |
| 18 | With a not-ready version, confirm **Approve** is disabled and clicking Reject/Cancel does not change status | Status unchanged; a `blocked`/`rejected`/`cancelled` record still appears in history | ☐ |
| 19 | Restart the app (`Ctrl+C` the dev server, run it again) | Every policy, revision, equivalence, and attachment created above is still present | ☐ |
| 20 | Open a test result's **View history** action (Trials or Stability) | The dedicated Result History Browser opens, showing the revision chain oldest-first with the current revision marked | ☐ |
| 21 | Select two revisions in the browser's compare selectors | A comparison table appears; changed fields (mean/pass-fail/reviewer/override) are highlighted, unchanged fields are not | ☐ |
| 22 | Open an attachment from within the history browser, including a superseded one | The file opens via the safe resolver; the superseded attachment is still openable, not hidden | ☐ |
| 23 | Open **Test applicability** from a Stability study's creation form | Included/Excluded lists render using the same engine as Trials — same reason chips | ☐ |
| 24 | Select a test outside the study's applicability scope | The reviewer/reason fields appear; submitting without both blocks creation with an error | ☐ |
| 25 | Fill reviewer + reason, create the study | The manually-included test appears in the captured requirement snapshot with its reviewer, reason, and timestamp recorded | ☐ |
| 26 | Edit a Test Definition referenced by an existing study's snapshot, then reopen that study | The snapshot's original entries are unchanged; if the edit changes what would now be included/excluded, a comparison-only "current definitions differ" note appears without altering the study | ☐ |

Report any row that fails, with the exact error text and the step number,
rather than re-running the whole checklist blind.

## Known gap

No automated end-to-end run of this checklist exists yet. Real native
launch and real native mouse/keyboard interaction ARE available in this
environment (see `docs/TAURI_LIVE_VERIFICATION.md`), but reaching every
row above still requires either `tauri-driver`/WebDriver for reliable
accessible-element targeting, or a taller display than the 1280×800
virtual desktop available during this phase. Until one of those is in
place, run this table by hand; `scripts\windows\verify-formulab-phase1.ps1`
automates only launch/window verification (rows unrelated to 1), not the
interior clicks.
