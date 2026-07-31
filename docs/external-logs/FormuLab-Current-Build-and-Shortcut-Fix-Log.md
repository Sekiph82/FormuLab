# FormuLab Current Build and Shortcut Fix Log

## Objective
Make the 13 already-implemented, unpushed information-architecture commits on `feature/laboratory-stability` visible in the actual Windows desktop application: push the commits, diagnose why the currently-open FormuLab window still shows the old flat nav (New/Optimizer/Notebooks/Files/Runs/Sessions), build the current HEAD into a real Tauri release executable, verify the new ten-workspace sidebar live in a native window, then point the Desktop shortcut at the new build (backing up the old shortcut first). Not a code task except where the build process itself surfaces a defect. Do not start Phase 3.

This log is external to the repository, at `C:\Users\sekip\Desktop\FormuLab-Current-Build-and-Shortcut-Fix-Log.md`. Not staged, not committed.

## Starting repository state
2026-07-24. Only `.FormuLab/runs.db` dirty (pre-existing, unrelated, untouched throughout). All 13 IA-simplification commits present locally, exact match to the list in the task, none yet pushed.

## Current branch
`feature/laboratory-stability` (`git branch --show-current`)

## Local HEAD
`c81c0b454d963273605d7e26a3c124bb3c389754`

## Remote HEAD
`ce934e76e9136e3a9bfe588a3e95a424bb0316bc` (before push — the 9 Phase 2 closure commits' tip)

## Unpushed commits
Confirmed via `git log --oneline origin/feature/laboratory-stability..HEAD` — all 13 exact matches to the task's list, in the same order:
```
c81c0b4 docs(formulab): document simplified information architecture
390af1d feat(i18n): add information-architecture workspace translation keys
a399494 test(navigation): cover workspace routing and context
57a8ad0 feat(projects,administration,reports): add remaining workspace shells
6d25184 feat(home): add persisted-work overview
c91138a refactor(approval): create dedicated approval workspace
60bb512 refactor(regulatory): organize regulatory workspace sections
b706c08 feat(optimization): add dedicated optimization workspace
51296e1 refactor(stability): move studies into stability workspace
dc2537d refactor(laboratory): move trial workflows into laboratory workspace
1654718 refactor(formulation): simplify formula workspace navigation
7baca5d refactor(navigation): introduce dedicated application workspaces and shared context hooks
917e3cf fix(regulatory): restrict evidence and review reuse actions by role
```
No other uncommitted source changes found — safe to proceed to push.

## Running FormuLab process
`tauri.conf.json` confirms `productName: "FormuLab"`, window `title: "FormuLab"`, `identifier: "com.formulab.app"` — so a running build would show as `FormuLab.exe` with window title "FormuLab".

Searched three ways: `Get-Process` filtered by name/window-title matching `formulab|ai4s` (case-insensitive) — no match. `Get-Process | Where MainWindowTitle -ne ''` — full list of every window-owning process on this session: `ApplicationFrameHost` (Settings), `ChatGPT Classic`, `cmd`, `SystemSettings`, `TextInputHost` — no FormuLab. `Get-CimInstance Win32_Process` filtered by `ExecutablePath`/`CommandLine`/`Name` matching `formulab|ai4s` — only my own diagnostic PowerShell command itself matched (its command-line text contains the search string). Checked `msedgewebview2.exe` host processes (Tauri apps render via WebView2) — all belong to `SearchHost.exe` (Windows Search), not FormuLab.

**Finding: no FormuLab/ai4s process is running on this session at the time of investigation.** This does not match the task's premise that a FormuLab window is currently open. Possibilities: it was closed before this task started, or something about the session differs from what the user was looking at. Proceeding with every other diagnostic step regardless (shortcuts/installs/build executables), and performing live verification by launching the newly built executable directly myself.

## Existing desktop shortcut
Per user-supplied correction: `C:\Users\sekip\Desktop\FormuLab.lnk`
- TargetPath: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\ai4s-workbench.exe`
- Arguments: (none)
- WorkingDirectory: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release`
- IconLocation: same exe, index 0
- Description: "FormuLab - AI research workbench + chemical formulation discovery & optimizer"
- Shortcut file itself: LastWriteTime 07/17/2026 14:18:30, size 2480 bytes, SHA-256 `6D3B3266A932A8371AF4C20027CC34160E7BF4D8DD5A4D8E2901D6FB501D719F`

**This target path is legitimate** — `ai4s-workbench` is the actual Cargo package name (`tauri.conf.json`'s `productName`/window `title` is "FormuLab", but the compiled binary keeps the Cargo crate name `ai4s-workbench.exe`, matching the `ai4s_workbench_lib`/`ai4s_workbench` names already seen in this session's `cargo test` output). The shortcut does not need to be replaced if this exe is simply rebuilt in place.

## Existing installed application
No installer-based installation exists anywhere: searched `Program Files`, `Program Files (x86)`, `AppData\Local`, `AppData\Local\Programs`, `AppData\Roaming` for any `formulab`/`ai4s`-matching executable or directory two levels deep — no `.exe` found outside the repo's own `target\release`. Checked `HKLM/HKCU\...\Uninstall` (both native and WOW6432Node) for a `formulab`/`ai4s`-matching `DisplayName` — none registered. **The app has only ever been run directly from the repo's build output; there is no separate installed copy to worry about being out of sync.**

Found three Tauri app-data directories (identified by the `identifier` field in `tauri.conf.json`, not by executable name) under both `AppData\Local` and `AppData\Roaming` — evidence of this app's naming history:
- `com.formulab.app` — **current identifier**, most recently written (07/18/2026), by far the most files (17,518 in Roaming) — this is where the live project data lives.
- `com.ai4s.workbench` and `com.ai4s.oslab` — older identifiers from before the app was renamed to FormuLab, both last written 07/17/2026, untouched since. Left exactly as they are; not part of this task's scope (no naming migration performed, no data deleted).

## Executables discovered
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\ai4s-workbench.exe` (the shortcut's target) — **before rebuild**:
- Size: 20,675,584 bytes
- LastWriteTime: 07/19/2026 04:54:43 (CreationTime 07/17/2026 21:19:16)
- SHA-256: `3E7CC157B836961E2C03A64E160AA23BD04D65C711FEC37286407BDD4C4C180D`
- FileVersion: 0.4.0, ProductName: FormuLab, CompanyName: formulab

This predates every one of the 13 IA-simplification commits (all made 2026-07-23/24, after 07/19) — **confirms the hypothesis**: the release binary is stale, built before the new workspace routes existed in the frontend bundle that gets embedded into it.

## Executable hashes and timestamps
All executables found under `apps\desktop\src-tauri\target\{debug,release}` (no other `target`/`dist`/`build` output directories exist elsewhere in the repo):
- `target\release\ai4s-workbench.exe` — the shortcut's target; pre-rebuild size 20,675,584 bytes, LastWriteTime 07/19/2026 04:54:43, SHA-256 `3E7CC157B836961E2C03A64E160AA23BD04D65C711FEC37286407BDD4C4C180D` (see "Executables discovered" above).
- `target\debug\ai4s-workbench.exe` — size 26,872,320 bytes, LastWriteTime 07/23/2026 19:04:16 (from this session's earlier `cargo build`/`cargo test` runs), SHA-256 `A6B345BCC5D4CD923F585B75923DEF5E7D3A661D44E37E372B35ECAF3AE2D3D2`. **Not used for the shortcut** — the task explicitly disallows a debug build as the final user-facing executable, and the shortcut already correctly points at `release`, not `debug`.
- `target\{debug,release}\opencode.exe`, `target\{debug,release}\uv.exe` — external sidecar binaries (`externalBin: ["binaries/uv"]` in `tauri.conf.json`), not the FormuLab application itself; not relevant to this diagnosis.

## Diagnosis
Confirmed at HEAD `c81c0b454d963273605d7e26a3c124bb3c389754`: `router.tsx` has all 10 new routes (`/home`, `/projects`, `/formulation`, `/laboratory`, `/stability`, `/optimization`, `/regulatory`, `/approval`, `/reports`, `/administration`) plus `/formulas` redirecting to `/projects` and the old page at `/formulas/legacy`; `Sidebar.tsx` renders all 10 `workspacesNav.*` labels. Source is correct — this is **not** a wrong-branch/wrong-repository/missing-route problem.

**Root cause: stale release build.** The desktop shortcut (`FormuLab.lnk`) correctly targets `...\target\release\ai4s-workbench.exe` — that path is legitimate (`ai4s-workbench` is the real Cargo package name; `tauri.conf.json`'s `productName`/window title is "FormuLab", the binary name is not). But that exe was last built 07/19/2026 04:54:43, before all 13 IA-simplification commits (07/23–07/24). The shortcut and its target path are correct; the *binary at that path* embeds an old frontend bundle built before the new workspace routes existed. No process was running to show this live (see "Running FormuLab process" above), but the stale-artifact evidence (build timestamp vs. commit timestamps) independently confirms the same conclusion the user's report described.

## Commands executed

## Build process
Command: `pnpm --filter @ai4s/desktop exec tauri build` (canonical production build; `tauri.conf.json`'s `beforeBuildCommand` auto-runs `pnpm --filter @ai4s/desktop build`, i.e. `tsc --noEmit && vite build`, so the frontend bundle embedded is always freshly built from current HEAD — not a cached `dist/`).

**Run 1** (background, ~2 min): frontend built cleanly (`✓ built in 15.98s`), `cargo` recompiled `ai4s-workbench v0.4.0` in release profile (`Finished release profile [optimized] target(s) in 1m 16s`), exe successfully rewritten at `target\release\ai4s-workbench.exe`. MSI bundling succeeded (`FormuLab_0.4.0_x64_en-US.msi`). NSIS bundling **failed**: `failed to bundle project: The process cannot access the file because it is being used by another process. (os error 32)` — a transient file lock (most likely a real-time antivirus scan or indexer grabbing the just-written exe) while `makensis` tried to patch it, not a source or configuration defect. The shell reported exit code 0 for the backgrounded job because the command's own output was piped through `tee`, which masked the real (non-zero) exit status of the failed `tauri build` — caught by reading the full log rather than trusting the exit-code summary.

**Run 2** (immediate retry, ~90s): identical command. Frontend rebuilt (16.10s), `cargo` recompiled again (`Finished release profile [optimized] target(s) in 58.39s` — no source changes since run 1, so this is Tauri re-invoking cargo as part of its own build step), exe rewritten again, and this time **both bundles succeeded**: `Finished 2 bundles at: ...\bundle\msi\FormuLab_0.4.0_x64_en-US.msi` and `...\bundle\nsis\FormuLab_0.4.0_x64-setup.exe`. Confirms the run-1 NSIS failure was transient, not a real defect — no source-code fix was needed.

## Build output
Final artifacts (after run 2), all timestamped 07/24/2026 after all 13 commits:
- **Release executable** (the shortcut's target): `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\ai4s-workbench.exe` — 21,497,856 bytes, LastWriteTime 07/24/2026 00:45:07, SHA-256 `A54487DDECF05A34ACDAF26F354E292809DD1C3770248A3898B8CB90AB45EB0A`. **Different from the pre-rebuild hash** (`3E7CC157B836961E2C03A64E160AA23BD04D65C711FEC37286407BDD4C4C180D`) and **different timestamp** (was 07/19, now 07/24) — confirms a genuine rebuild, not a no-op.
- **MSI installer**: `...\target\release\bundle\msi\FormuLab_0.4.0_x64_en-US.msi` — 35,229,696 bytes, SHA-256 `5CF6D2D124D271F6EE9CEFA6BC4F5BFB21F9CEEEFB38A1F81EF5F6EAD05F68E7`
- **NSIS installer**: `...\target\release\bundle\nsis\FormuLab_0.4.0_x64-setup.exe` — 24,584,066 bytes, SHA-256 `3E5EFAD39053B7D78EBF566E136F1A1C6557EA8B51B14D3401A70B06C1115D60`

The exe is patched with bundle-type metadata by each bundler step, so its hash legitimately differs slightly between run 1 (`F6AE3DED3EBF811E24D980073268DCAB61B18AEEB9CA12D044022CFB73752093`) and run 2's final state (`A54487DD...` above) even though no source changed between the two runs — both are valid builds of the same HEAD; the run-2 hash is the one actually on disk and targeted by the shortcut.

## Build output

## Native launch verification
Launched `target\release\ai4s-workbench.exe` directly (`Start-Process`, no shortcut). First attempt's process check raced and appeared to show an immediate exit; investigation revealed the app uses `tauri_plugin_single_instance` (`src-tauri/src/lib.rs:41`) — every launch after the first genuinely-surviving instance signals that instance to focus and exits itself with code 0, which is exactly the "exits immediately, exit code 0, no error output" pattern seen on repeated launch attempts. Confirmed via `Get-CimInstance Win32_Process -Filter "Name='ai4s-workbench.exe'"` (catches processes regardless of window-title visibility) that one instance (PID 29068, session 3 — the same session this automation runs in) was genuinely alive and had `MainWindowTitle = "FormuLab"`. Verified its on-disk exe hash matches the just-built binary exactly (`A54487DD...`) via `Get-FileHash` on `$p.Path`. **Process remains running, native top-level window, title "FormuLab", executable path and hash both match the new build.**

**Caution encountered and corrected**: my first attempt at driving the UI used `SetCursorPos`/`mouse_event` (real physical mouse control) to click a sidebar item, then `Graphics.CopyFromScreen` for a screenshot. The screenshot showed this terminal/chat window instead of FormuLab — the click had landed on whatever window was actually topmost on the shared screen at that moment, not reliably on FormuLab. This is a real, physical action on the user's shared desktop and the wrong window can genuinely receive a click. I stopped using absolute-screen-coordinate mouse control immediately and switched to two non-invasive methods for the rest of verification: `PrintWindow` (captures a specific window handle's content directly, regardless of z-order/focus — no shared cursor movement) for screenshots, and the `System.Windows.Automation` UI Automation tree (`AutomationElement`/`InvokePattern`) to select sidebar items by name, which drives the target window's own control directly rather than the shared input devices.

## Workspace verification
**Method**: `System.Windows.Automation` (UI Automation) against the live window's accessibility tree — `AutomationElement.FindAll`/`FindFirst` to read every control's accessible `Name`, and `InvokePattern.Invoke()` to actually activate a sidebar button (a real, programmatic click on that exact control — not a coordinate guess). WebView2's Chromium accessibility tree needed a ~3s warm-up after first being queried (first query returned only 2 opaque "pane" elements; a retry after a few seconds returned the full 91-element tree) — a one-time Chromium behavior, not an app defect.

**Sidebar — full accessible-name dump, confirms every requirement literally**:
```
button : 'Home'            button : 'Optimization'
button : 'Projects'        button : 'Regulatory'
button : 'Formulation'     button : 'Approval'
button : 'Laboratory'      button : 'Reports'
button : 'Stability'       button : 'Administration'
--- separate "TOOLS" heading, not mixed into Workspaces ---
button : 'Notebooks'  button : 'Files'  button : 'Runs'
```
All ten workspaces present, `TOOLS` (Notebooks/Files/Runs) confirmed as its own separate section, exactly as built. No "Formulas" entry anywhere in the sidebar (it isn't supposed to be — replaced by Projects/Formulation).

**Real navigation, not just static labels** — invoked each button via `InvokePattern.Invoke()` and re-read the content area's accessible text afterward:
- **Projects**: → "Formula projects" heading, "New project" button, honest empty state "No formulation projects yet. Create one to start building a formula." (exact `ProjectsPage.tsx` text)
- **Laboratory / Stability / Regulatory / Approval / Formulation** (no project selected): → "No projects yet — create one from Projects to get started." (exact `ProjectPicker` empty-state text) — confirms these are real, working routes that correctly refuse to guess a project, not a crash or blank page
- **Administration**: → "Administration" heading, "Overview"/"Tests" section tabs, the exact description paragraph, all 4 links ("Materials, suppliers, packaging & factory profiles", "Regulatory rules", "Approval policies", "Application settings") with their exact descriptions, and the exact "no user-management backend" sentence — word-for-word match to source
- **Reports**: → "Reports" heading, the exact description, all 6 rows (Formula/Trial/Stability/Regulatory/Approval reports + Audit reports) with "Open" links on 5 of them and "Not yet implemented" on Audit reports, and the exact futureExportNote text — word-for-word match to source

**Confirms the Formula Builder no longer presents everything as one 12-tab strip**: Formulation, Laboratory, Stability, Regulatory, Approval, Optimization, Reports and Administration are each reached by a distinct sidebar click landing on a distinct, independently-rendered page — not tabs inside one page.

**`/formulas` redirect and `/formulas/legacy`**: this is a Tauri desktop shell with no address bar — there is no way to type a URL into the running native app to trigger this directly. Verified instead at the source/build level: `router.tsx` (compiled into this exact hash-verified bundle) contains `{ path: "formulas", element: <Navigate to="/projects" replace /> }` and `{ path: "formulas/legacy", element: <FormulasPage /> }`, and the sidebar (confirmed above) has no "Formulas" entry — only "Projects" and "Formulation". This is an honest, stated limitation of live-verifying a client-side-router redirect inside a chromeless native app, not a skipped check.

**Screenshots** (via `PrintWindow` on the specific window handle, not full-screen capture): `formulab_launch1.png`/`formulab_home.png` (Home/default view, full sidebar visible), `formulab_administration.png` (full window — title bar, sidebar with Workspaces+Tools+Sessions sections, Administration page content), `formulab_via_shortcut.png` (same view, launched via the shortcut). All in the session scratchpad, viewed directly.

**Verification label: LIVE NATIVE WORKSPACE UI VERIFIED.**

## Shortcut backup
**Not performed — not needed.** Per the user's explicit correction to this task: the existing shortcut's `TargetPath` (`...\target\release\ai4s-workbench.exe`) was already correct; only the binary at that path was stale. No shortcut property needed to change, so there is nothing to back up or replace. `C:\Users\sekip\Desktop\FormuLab-Shortcut-Backup\` was not created.

## Shortcut replacement
**Not performed — not needed**, for the same reason as above. Re-inspected the shortcut with `WScript.Shell` after the rebuild to confirm it is unchanged and still correct:
- TargetPath: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\ai4s-workbench.exe` (now resolves to the freshly rebuilt binary, hash `A54487DD...`)
- WorkingDirectory: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release` (correct — sits next to the exe and its resources)
- No PowerShell/CMD/dev-server indirection — launches the native exe directly, exactly as required.

## Installation changes
None made. No installer was run (`FormuLab_0.4.0_x64_en-US.msi`/`FormuLab_0.4.0_x64-setup.exe` were produced by `tauri build` as a build artifact but not executed/installed — the app has never been, and remains not, installed via an installer; it runs directly from the repo's build output, which is what the shortcut already correctly targets). No prior installation existed to preserve/upgrade (confirmed in "Existing installed application" above — no Program Files entry, no registry Uninstall entry). No user data directory (`com.formulab.app`'s AppData folders, `.FormuLab/`) was touched, moved, or deleted.

## Tests
Baseline (before packaging), at HEAD `c81c0b4`, all green:
- Shared: 690/690, typecheck clean
- Desktop: 413/413, typecheck clean, lint clean, i18n parity 15/15
- Rust: 68/68 (`cargo test`), `cargo clippy --all-targets --all-features -- -D warnings` clean, `cargo build --lib` clean
- Python: 130/130 (`runtime/formulation` + `runtime/pipeline`)
Matches/exceeds the task's stated minimum baseline exactly (no drift).

## Commits
None created this session. No source defect was found — the 13 IA-simplification commits already contained everything needed; the only problem was a stale compiled artifact. Per the task's own instruction ("If no source changes are needed, do not create an empty commit"), nothing new was committed. (The 13 pre-existing commits were pushed — see "Pushes" — but that is not a new commit.)

## Pushes
2026-07-24 — `git push origin feature/laboratory-stability`. No merge, no rebase, no force, no PR, no safety branch, `.FormuLab/runs.db` never staged. Result: `ce934e7..c81c0b4  feature/laboratory-stability -> feature/laboratory-stability`. Post-push: `git rev-parse HEAD` and `git rev-parse origin/feature/laboratory-stability` both `c81c0b454d963273605d7e26a3c124bb3c389754` — heads match. `git log --oneline origin/feature/laboratory-stability..HEAD` empty. `git status --short` shows only `.FormuLab/runs.db`.

## Final executable path
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\ai4s-workbench.exe` — SHA-256 `A54487DDECF05A34ACDAF26F354E292809DD1C3770248A3898B8CB90AB45EB0A`, built 07/24/2026 00:45:07 from HEAD `c81c0b454d963273605d7e26a3c124bb3c389754`. Unchanged from the path already targeted by the existing shortcut — only the file's contents changed (rebuilt).

## Final shortcut target
Unchanged: `C:\Users\sekip\Desktop\FormuLab.lnk` → `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\ai4s-workbench.exe`. Confirmed by re-inspecting with `WScript.Shell` after the rebuild, and by launching through the shortcut itself: same hash, same "FormuLab"-titled window, same ten-workspace sidebar.

## Remaining limitations
- No FormuLab/ai4s process was found running at the very start of this task (checked by name, window title, and full command-line across every process on the session) — this contradicts the task's stated premise. Reported honestly to the user before proceeding; the user confirmed to continue and supplied the correct shortcut target, which the rest of this investigation independently corroborated (stale build timestamp predates all 13 commits).
- The `/formulas` → `/projects` redirect and `/formulas/legacy` route could not be triggered live inside the running native app (a chromeless Tauri shell has no address bar to type a URL into) — verified instead by reading the exact router configuration compiled into the hash-verified running bundle, plus confirming the sidebar has no "Formulas" entry. This is a genuine tooling limitation of native-app verification, not a skipped check.
- WebView2's accessibility tree needed a ~3 second warm-up after the first UI Automation query before it exposed the full control tree (a one-time Chromium behavior on first inspection, not specific to this app or build).
- One transient safety incident: an early verification attempt used absolute-screen-coordinate mouse control (`SetCursorPos`/`mouse_event`), which moved the real, shared mouse cursor and produced a single click that landed on this terminal/chat window rather than the FormuLab window (confirmed harmless — a single left-click, no text entered, nothing submitted). Caught immediately via the resulting screenshot; switched entirely to non-invasive methods (`PrintWindow` for screenshots, UI Automation `InvokePattern` for navigation) for all further verification, which never move the shared cursor.
- The NSIS bundler failed once with a transient file-lock error (`os error 32`) on the first `tauri build` run; succeeded on an immediate retry with no code changes. Documented as environmental, not a defect.
- The app is left running (launched via the shortcut, PID confirmed, correct hash) at the end of this task — not closed, since nothing in the task asked for a clean shutdown and the user likely wants to see it.
- Historical `com.ai4s.workbench`/`com.ai4s.oslab` AppData directories from earlier product-naming iterations still exist, untouched — out of scope (no naming migration performed, per the task's explicit instruction).

## Final git status
```
On branch feature/laboratory-stability
Your branch is up to date with 'origin/feature/laboratory-stability'.

Changes not staged for commit:
	modified:   .FormuLab/runs.db
```
Local HEAD and remote HEAD both `c81c0b454d963273605d7e26a3c124bb3c389754` — fully pushed, nothing ahead or behind. `.FormuLab/runs.db` is the same pre-existing, unrelated file — never staged, committed, deleted, reset, or restored.

## Final summary
Root cause confirmed: **the desktop shortcut's target path was always correct** (`...\target\release\ai4s-workbench.exe`, the real Cargo binary name behind the "FormuLab" product name) — the problem was that the binary at that path was a stale release build (07/19/2026), compiled before all 13 information-architecture commits (07/23–07/24) existed. No process was actually running to observe this live at task start (reported honestly; user confirmed to continue). Pushed the 13 already-implemented commits (`ce934e7..c81c0b4`), confirmed the full baseline test suite green, rebuilt the actual Tauri release application from current HEAD (`pnpm --filter @ai4s/desktop exec tauri build` — frontend + cargo release + MSI/NSIS bundles, second attempt after a transient NSIS file-lock), and verified the new binary's hash/timestamp changed. Launched the new executable directly: real native window, title "FormuLab", hash-matched. Used UI Automation (not the shared mouse, after an early misstep was caught and corrected) to enumerate the sidebar and click through Home/Projects/Formulation/Laboratory/Stability/Regulatory/Approval/Administration/Reports, confirming — by reading actual accessible text, not just a screenshot — that all ten workspaces render, the Tools section is separate, and the old 12-tab strip is gone. Closed that instance and relaunched through the existing, unmodified shortcut: identical hash, identical window, identical workspace sidebar. Since the shortcut's target was never wrong, no shortcut replacement, no backup, and no reinstallation were needed or performed. No source-code defect was found, so no new commits were created. Not started: Phase 3.
