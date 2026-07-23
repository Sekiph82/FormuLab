# Native Tauri live verification

Records the spec-§4 investigation into real, native click-through
verification of the packaged Tauri desktop app — not React component
tests, not a browser tab against the Vite dev server, the actual
`ai4s-workbench.exe` window. This corrects a prior assumption
(`docs/OPTIMIZER_UI_VERIFICATION.md`'s "no tool available here can attach
to or drive a native WebView window"): that claim was not re-verified
before being written down, and this session found it to be **false** in
this environment. A real desktop session is available here.

**Status: PARTIALLY LIVE VERIFIED.** Native launch is fully confirmed
(real process, real window, real rendered content). Real native mouse and
keyboard input was also driven and confirmed against the running window —
this goes meaningfully beyond "launch verified." The full 19-item
Trials/Stability/Result-History/Approval checklist in the task spec was
**not** completed, for reasons recorded below, so this is not being
claimed as "LIVE TAURI UI VERIFIED."

## Automation tooling investigated

| Tool | Availability here | Outcome |
|---|---|---|
| `tauri-driver` | Not installed; not attempted to install (requires a matching Microsoft Edge WebDriver download and is the kind of new system dependency the task asked to avoid installing without necessity, given a simpler path worked) | Not used |
| WebDriver / Selenium | Not installed | Not used |
| Windows Application Driver (WinAppDriver) | Not installed (`where WinAppDriver.exe` found nothing) | Not used |
| **PowerShell + Win32 API (`user32.dll`) mouse/keyboard input** | Built into Windows, no install | **Used successfully** — this is what actually drove the app |
| **Microsoft UI Automation** (`System.Windows.Automation`, .NET) | Built into Windows, no install | Attempted; see "What did not work" below |
| pywinauto | Not installed (`pip show pywinauto` → not found); not installed since UI Automation directly showed the same limitation pywinauto would hit | Not used |
| Appium Windows Driver | Not installed | Not used |
| Playwright connected to the Tauri WebView | Not installed for this app; also would not attach to a native (non-devtools-protocol-exposed) WebView2 host without extra Tauri-side plumbing | Not used |
| Accessibility automation generally | Investigated via UI Automation (above) | Chromium/WebView2's accessibility tree is not exposed by default; see below |

## What was actually done

1. **Built the app for real**, with the frontend properly embedded (not
   just `cargo build`, which — discovered during this session — produces a
   debug binary that still points at `http://localhost:5173` and fails
   with "localhost refused to connect" once Vite isn't running):
   ```
   pnpm --filter @ai4s/desktop build
   pnpm --filter @ai4s/desktop exec tauri build --debug --no-bundle
   ```
   Executable: `apps/desktop/src-tauri/target/debug/ai4s-workbench.exe`

2. **Launched it and confirmed a real native window**, twice — once
   against the real (pre-existing) `%APPDATA%\com.formulab.app` data
   directory, once against a fresh one (see "Data safety" below):
   - Process name: `ai4s-workbench`, real PID (e.g. 20468, 16288, 22344
     across separate launches)
   - `MainWindowTitle`: `FormuLab` — matches `tauri.conf.json`'s
     configured window title
   - `MainWindowHandle`: non-zero real HWND (e.g. `9897536`) — confirms an
     actual native window exists, not just a background process
   - Launch command used: `Start-Process -FilePath <exe-path> -PassThru`,
     confirmed via `Get-Process ai4s-workbench | Select Id, MainWindowTitle, MainWindowHandle`

3. **Captured real screenshots** of the rendered window (`GetWindowRect` +
   `System.Drawing.Graphics.CopyFromScreen`), confirming actual application
   content — the FormuLab sidebar (New / Formulas / Materials / Optimizer /
   Notebooks / Files / Runs), the "What do you want to formulate" landing
   panel, a real session list — not a blank or crashed window.

4. **Drove real native mouse clicks and keyboard input** against the
   window using `user32.dll`'s `SetCursorPos` / `mouse_event` /
   `SendKeys`, and confirmed the results via follow-up screenshots:
   - Clicked the **Optimizer** nav item → the Advanced Optimizer panel
     rendered (raw-materials list, "Add material" control)
   - Clicked the **Files** nav item → the Data/Formulas file browser
     rendered, showing the real `sessions` folder
   - Clicked the **Formulas** nav item → the "Formula projects" list
     rendered (empty, on the fresh data directory)
   - Clicked into the **Target product** textarea and typed real text via
     `SendKeys` → the exact typed text appeared in the field with a live
     cursor, confirmed by screenshot

   This is real, OS-level input reaching the actual native window — not a
   mocked component test.

## What did not work / genuine blockers

- **Chromium's accessibility tree is not exposed to UI Automation here.**
  `AutomationElement.FromHandle` on the app's window found only 2
  descendants (`"FormuLab"` and `"FormuLab - Web content"` panes) — the
  WebView2 content itself never appears in the UIA tree, with or without
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--force-renderer-accessibility`
  set before launch (confirmed via the `msedgewebview2.exe` child
  processes' actual command lines — the flag did not propagate). Without
  an accessible element tree, buttons/fields cannot be targeted by name;
  every interaction above was done by screen coordinate instead.
- **The virtual display here is 1280×800** (`[System.Windows.Forms.Screen]::PrimaryScreen.Bounds`,
  confirmed against a real 2560×1600 physical resolution reported by WMI —
  i.e. 200% OS scaling). FormuLab's window is configured for
  1440×900 with a 640-tall minimum; on this 800-tall virtual desktop, the
  bottom of longer forms (e.g. the new-formulation submit button below the
  Target Product/Category/Target Market fields) renders below the visible
  area, and the content pane did not respond to a simulated mouse-wheel
  scroll. Blind Tab-key navigation toward the submit control was attempted
  and did not visibly trigger a submission either. This blocked reaching
  the Formula Builder → Trials/Stability/Approval tabs the spec's
  checklist asks about, since no project could be created through this
  path in the time available.
- Coordinate targeting itself required an empirical calibration step —
  visual position estimates from a screenshot needed to be halved to land
  correctly (a 2× mismatch between the coordinate frame used to describe
  an image and the image's actual pixel dimensions), discovered by
  deliberately mis-clicking, observing which control actually received
  the click, and correcting for it. This is workable but slow and
  error-prone for anything beyond a handful of clicks per screenshot
  round-trip, which is the practical reason the full 19-item checklist
  was not completed live in this session.

## Data safety

The real `%APPDATA%\com.formulab.app` directory contains genuine project
history (19,672 files/directories). To avoid any risk of the verification
run mutating or corrupting that data:

1. Confirmed the file/directory count (`19672`) before touching anything.
2. Moved the real directory aside by rename (not copy, not delete) to
   `com.formulab.app.verify-backup-<timestamp>`.
3. Ran all launches/clicks in this document against the fresh, empty
   directory Tauri created in its place.
4. Stopped the app, deleted the throwaway fresh directory (8 files, no
   real project was ever successfully created in it — the one creation
   attempt never reached a submit control, per above), and renamed the
   backup back to `com.formulab.app`.
5. Re-counted: `19672` — an exact match, confirming nothing was lost or
   altered.

No native-verification step in this session ever wrote to, read from, or
otherwise touched the real backed-up data while it was in use.

## Native interaction checklist (spec §4.3) — status

| # | Step | Status |
|---|---|---|
| 1 | Launch FormuLab | ✅ Done — real process/window/title/PID confirmed |
| 2 | Open an existing project | ❌ Not attempted against real data (see "Data safety" — deliberately avoided to protect real project history); not reached on the fresh instance either |
| 3 | Open Formula Builder | ❌ Not reached (blocked on project creation, see above) |
| 4 | Open Trials | ❌ Not reached |
| 5 | Open result history browser | ❌ Not reached |
| 6 | Compare result revisions | ❌ Not reached |
| 7 | Open historical attachment | ❌ Not reached |
| 8 | Open Stability | ❌ Not reached |
| 9 | Create/inspect stability study | ❌ Not reached |
| 10 | Open Included/Excluded tests | ❌ Not reached |
| 11 | Filter excluded reasons | ❌ Not reached |
| 12 | Manually include a test | ❌ Not reached |
| 13 | Confirm captured snapshot | ❌ Not reached |
| 14 | Open Approval | ❌ Not reached |
| 15 | Inspect policy/readiness | ❌ Not reached |
| 16 | Close app | ✅ Done (`Stop-Process`, confirmed via `Get-Process` returning nothing afterward) |
| 17 | Restart app | ✅ Done (relaunched multiple times across this session) |
| 18 | Confirm persistence | ⚠️ Partial — confirmed the app's data directory persists across restarts (the fresh directory's 8 files were still present after each relaunch); did not confirm persistence of a created project, since none was successfully created |
| 19 | (General) real UI interaction, not just launch | ✅ Done — nav clicks and text input, confirmed via screenshots |

## Honest summary

- **Native launch: fully verified.** Real executable, real window, real
  title, real PID, real rendered content — repeatable and confirmed
  multiple times.
- **Native UI interaction: partially verified.** Real mouse/keyboard input
  was driven against the real window and its effects were observed, which
  is a genuine, new capability this environment was not previously known
  to have. It did not extend to the specific Trials/Stability/Result
  History/Approval flows the spec's checklist names, due to the two
  disclosed environment constraints above (no accessible element tree; a
  virtual display shorter than the app's designed layout).
- The correct spec §9 label for this work is **"PARTIALLY LIVE
  VERIFIED"** — not "LIVE TAURI UI VERIFIED" (the full checklist was not
  driven) and not "NOT LIVE VERIFIED" (real native launch and real native
  interaction were both genuinely demonstrated, which is strictly more
  than a launch-only confirmation).

## Recommendation for a future pass

- Installing `tauri-driver` (with a matching `msedgedriver.exe`) would
  give WebDriver-based, DOM-accessible element targeting and remove the
  coordinate-calibration fragility entirely — the main reason this was not
  done here is that the coordinate-based approach above worked well enough
  to prove real interaction without a new system dependency, per the
  task's own caution against installing tooling without necessity.
- If `tauri-driver` is added, running against a virtual display taller
  than 900px (or a headless display sized to match the app's configured
  window) would remove the clipping issue that blocked reaching the
  deeper tabs.
