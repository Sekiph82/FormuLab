# Approval workflow — manual smoke test

## Why this document exists

Spec §1.7 asked for a real, interactive click-through of the packaged
Tauri app — not React component tests. This environment cannot do that:
there is no attached display, no `tauri-driver`/WebDriver bridge, and no
accessibility-automation tool installed for a Windows GUI app in this
sandboxed, headless session. Claiming "live-verified" here would be false.

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

Report any row that fails, with the exact error text and the step number,
rather than re-running the whole checklist blind.

## Known gap

No automated end-to-end run of this checklist exists yet. If GUI
automation becomes available in a future session (e.g. `tauri-driver` +
WebDriver, or a Windows box with a real display CI can drive), replace
this manual table with a scripted equivalent and update this document to
say so — do not just delete the caveat.
