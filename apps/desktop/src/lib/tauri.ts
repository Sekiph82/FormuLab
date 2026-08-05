// Thin bridge to the Tauri Rust side. In a plain browser these are no-ops so the
// app still runs in `pnpm dev`; in the packaged desktop app they invoke Rust commands.

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface OpenCodeCredentials {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type ConfigureResult =
  | { ok: true; path: string }
  | { ok: false; reason: "not-desktop" }
  | { ok: false; reason: "error"; message: string };

/**
 * Write text into the workspace as a file (desktop only), deduplicating the
 * name on collision. Returns the actual file name written.
 */
export async function addTextToWorkspace(filename: string, content: string): Promise<string> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("add_text_to_workspace", { filename, content });
}

/** How agent actions get approved — the composer's Codex-style switch.
 *  "approve": dangerous shell commands (delete / install / remote / privilege)
 *  and web fetches prompt first. "full": everything in-workspace just runs. */
export type ApprovalMode = "approve" | "full";

/** Network proxy for the sidecar: follow the OS, a fixed URL, or direct. */
export type ProxyMode = "system" | "custom" | "none";
export interface ProxySetting {
  mode: ProxyMode;
  /** The custom URL (empty unless mode is "custom"). */
  url: string;
  /** The proxy the sidecar would use right now; null ⇒ direct. */
  effective: string | null;
}

/** uv download mirrors used only when provisioning Python tools (empty ⇒ default). */
export interface MirrorSetting {
  /** PyPI index URL (UV_DEFAULT_INDEX). */
  pypi: string;
  /** Python-download mirror (UV_PYTHON_INSTALL_MIRROR). */
  python: string;
}

/** Per-session goal-mode state, as the bundled goal plugin records it.
 *  Passed through verbatim from goals.json — the plugin owns the schema. */
export interface GoalState {
  objective: string;
  /** The plugin's status enum (its schema owns the literals). */
  status: "active" | "paused" | "budgetLimited" | "usageLimited" | "complete" | "unmet" | string;
  autoTurns?: number | null;
  blocker?: string | null;
  completionEvidence?: string | null;
  lastStatus?: string | null;
}

export interface JupyterStatus {
  installed: boolean;
  running: boolean;
  url: string | null;
  token: string | null;
  mcp_command: string | null;
}

/** State of the app-managed Jupyter environment (desktop only). */
export async function jupyterStatus(): Promise<JupyterStatus | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<JupyterStatus>("jupyter_status");
}

/** Provision the isolated Jupyter env via bundled uv (first run: minutes, ~hundreds of MB). */
export async function setupJupyter(): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("setup_jupyter");
}

/** Start the managed headless jupyter-lab (idempotent). */
export async function startJupyter(): Promise<JupyterStatus> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<JupyterStatus>("start_jupyter");
}

/** Open the app-managed JupyterLab in the system browser, starting the server
 *  if needed. Returns false when Jupyter has not been set up yet (the caller
 *  should point the user at Settings). Same env the agent drives, same files.
 *
 *  `notebook` is a path RELATIVE TO THE LAB ROOT (the active workspace) — pass
 *  it to open that file directly (`/lab/tree/<path>`); omit to land on the lab
 *  home. Only pass a path you know is under the workspace root. */
export async function openJupyterLab(notebook?: string): Promise<boolean> {
  if (!isTauri) return false;
  const st = await jupyterStatus();
  if (!st?.installed) return false;
  const s = await startJupyter(); // idempotent; yields the fixed url + token
  if (!s.url || !s.token) return false;
  const rel = notebook?.trim().replace(/^\/+/, "");
  // Encode each segment but keep the "/" separators so nested paths resolve.
  const tree = rel ? "/tree/" + rel.split("/").map(encodeURIComponent).join("/") : "";
  await openExternal(`${s.url}/lab${tree}?token=${encodeURIComponent(s.token)}`);
  return true;
}

/** The interpreter local Python kernels resolve to, and where it came from. */
export interface PythonInterpreter {
  /** The manual override, if one is set (even when it no longer runs). */
  configured: string | null;
  /** What cells would actually run on right now. */
  resolved: string | null;
  source: "manual" | "system" | "jupyter-env" | null;
  error: string | null;
}

export async function pythonInterpreter(): Promise<PythonInterpreter | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PythonInterpreter>("python_interpreter");
}

/** Set (empty clears) the manual Python interpreter override. Validated on save. */
export async function setPythonPath(path: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_python_path", { path });
}

/** One live output line from a uv provisioning run (jupyter / science MCP). */
export interface SetupProgress {
  task: "jupyter" | "science";
  line: string;
}

/** Subscribe to setup progress lines; returns the unlisten function. */
export async function watchSetupProgress(
  cb: (p: SetupProgress) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<SetupProgress>("setup-progress", (e) => cb(e.payload));
}

// ---- Formulation optimizer -------------------------------------------------

/** One raw material row in a formulation problem. */
export interface FormulationMaterial {
  name: string;
  unit_price: number;
  stock: number;
  active_matter_pct: number;
  max_usage_pct: number;
}

export interface FormulationConstraints {
  batch_size: number;
  min_active_pct: number;
}

export interface FormulationInput {
  materials: FormulationMaterial[];
  constraints: FormulationConstraints;
}

export interface FormulationItem {
  name: string;
  quantity_kg: number;
  cost: number;
  share_pct: number;
}

export interface FormulationResult {
  status: "optimal" | "infeasible" | "unbounded" | "undefined" | "error" | string;
  message: string;
  total_cost: number | null;
  items: FormulationItem[];
  achieved_active_pct: number | null;
  batch_size: number;
}

/** Solve a formulation cost-minimization LP (desktop only — needs the bundled
 *  Python + PuLP). Returns null when not running in the desktop app. */
export async function runFormulationOptimize(
  input: FormulationInput,
): Promise<FormulationResult | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FormulationResult>("run_formulation_optimize", { input });
}

/** Solve an Advanced Optimizer `FormulationProblem` (`@formulab/shared`'s
 *  `FormulationProblem`/`AdvancedOptimizationResult` types) — a separate
 *  command and script from the simple optimizer above. Returns null when not
 *  running in the desktop app. */
export async function runAdvancedFormulationOptimize(
  input: unknown,
): Promise<unknown | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("run_advanced_formulation_optimize", { input });
}

/** Kill whatever Advanced Optimizer solve is currently running, if any.
 *  Resolves `true` when a run was actually cancelled. No-op (`false`) in the
 *  browser or when nothing was running. */
export async function cancelAdvancedFormulationOptimize(): Promise<boolean> {
  if (!isTauri) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("cancel_advanced_formulation_optimize");
}

/** Auto-start Jupyter on launch when it was enabled before. Silent no-op otherwise. */
export async function ensureJupyter(): Promise<void> {
  try {
    const s = await jupyterStatus();
    if (s?.installed && !s.running) await startJupyter();
  } catch {
    /* Jupyter is optional — never block the app on it */
  }
}

/** Open an http(s) URL in the system browser (never navigates the webview). */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_url", { url });
    } catch {
      /* opening a link must never break the app */
    }
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export interface LatestRelease {
  version: string;
  url: string;
  name: string | null;
  publishedAt: string | null;
}

export async function latestRelease(): Promise<LatestRelease | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LatestRelease>("latest_release");
}

export type SaveResult =
  | { kind: "saved"; path: string }
  | { kind: "canceled" }
  | { kind: "not-desktop" };

/** Save text via the native "Save As" dialog (desktop only). Throws on write failure. */
export async function saveTextFile(filename: string, content: string): Promise<SaveResult> {
  if (!isTauri) return { kind: "not-desktop" };
  const { invoke } = await import("@tauri-apps/api/core");
  const path = await invoke<string | null>("save_text_file", { filename, content });
  return path ? { kind: "saved", path } : { kind: "canceled" };
}

/** Save arbitrary bytes (e.g. a generated PDF/DOCX) via the same native
 *  "Save As" dialog `saveTextFile` uses (desktop only). `bytes` is sent as a
 *  plain number array — never coerced through a UTF-8 string — so the Rust
 *  side writes the exact bytes given. Throws on write failure. */
export async function saveBinaryFile(filename: string, bytes: Uint8Array): Promise<SaveResult> {
  if (!isTauri) return { kind: "not-desktop" };
  const { invoke } = await import("@tauri-apps/api/core");
  const path = await invoke<string | null>("save_binary_file", { filename, bytes: Array.from(bytes) });
  return path ? { kind: "saved", path } : { kind: "canceled" };
}

/** The active workspace directory (desktop only; null in browser). */
export async function workspacePath(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("workspace_path");
  } catch {
    return null;
  }
}

/** The base folder new dated workspaces are created under (desktop only). */
export async function workspaceBase(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("workspace_base");
  } catch {
    return null;
  }
}

/** Choose the base folder new session workspaces are created under.
 *  Returns the canonical path. Throws in the browser. */
export async function setWorkspaceBase(path: string): Promise<string> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("set_workspace_base", { path });
}

/** Reveal the base workspace folder in the OS file manager. */
export async function openWorkspaceBase(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_workspace_base");
}

// ---- Active data location (Phase 11 Session 4) -----------------------------

export type RootSource =
  | "formulabRootOverride"
  | "activeWorkspaceOverride"
  | "baseWorkspaceOverride"
  | "default";

export interface ConflictingRoot {
  source: RootSource;
  path: string;
}

export interface DataRootStatus {
  path: string;
  source: RootSource;
  writable: boolean;
  warnings: string[];
  conflictingRoots: ConflictingRoot[];
}

/** The unified active-data-root resolution (`data_root::resolve_data_root`)
 *  — same root `project_root()`/`workspace_dir()` use internally, with the
 *  resolution source, writability, and any conflict/fallback warnings a
 *  malformed or divergent pointer file produced. Never modifies anything. */
export async function activeDataRootStatus(): Promise<DataRootStatus | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DataRootStatus>("active_data_root_status");
}

/** Reveal the resolved active data root in the OS file manager. */
export async function openActiveDataRoot(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_active_data_root");
}

// ---- Data Location Manager (Phase 11 Session 8) ----------------------------

export type DestinationKind =
  | "empty"
  | "existingCompatibleRoot"
  | "conflicting"
  | "sameAsCurrent"
  | "notADirectory"
  | "unwritable";

export interface DestinationValidation {
  path: string;
  kind: DestinationKind;
  writable: boolean;
  requiredBytes: number;
  availableBytes: number | null;
  sufficientSpace: boolean;
  canMove: boolean;
  canUseExisting: boolean;
  warnings: string[];
  blockers: string[];
}

/** Checks whether `path` is safe to move data into or use as-is — never
 *  copies, writes a pointer, or otherwise changes anything. Safe to call
 *  repeatedly while a user is choosing a folder. */
export async function validateDataMoveDestination(path: string): Promise<DestinationValidation> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DestinationValidation>("validate_data_move_destination", { path });
}

export interface AutomaticBackupDestinationAdjustment {
  adjusted: boolean;
  note: string;
}

export interface DataMoveResult {
  runId: string;
  sourceRoot: string;
  destinationRoot: string;
  filesMoved: number;
  totalBytes: number;
  safetyBackupPath: string;
  automaticBackup: AutomaticBackupDestinationAdjustment;
  warnings: string[];
}

/** Full safe move: validate -> safety backup -> stage -> verify (size +
 *  SHA256) -> activate -> update the pointer -> confirm resolution. The
 *  old location is never touched — throws (including on cancellation,
 *  `message === "cancelled"`) with the previous location still active on
 *  any failure. Subscribe to `watchDataMoveProgress` first for progress. */
export async function moveDataLocation(destination: string): Promise<DataMoveResult> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DataMoveResult>("move_data_location", { destination });
}

/** Request cancellation of a running move (best-effort, checked between steps). */
export async function cancelDataMove(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("cancel_data_move");
}

/** One progress tick from a running move or "use existing location" switch.
 *  Same wire shape as `BackupProgress` (both come from the same Rust
 *  `emit_progress` pattern) but a distinct phase set, since a move's own
 *  phases (backing up, staging, activating, confirming) don't match
 *  backup/restore's. */
export interface DataMoveProgress {
  phase: "backingUp" | "staging" | "verifying" | "activating" | "confirming" | "done" | "cancelled" | "error";
  current: number;
  total: number;
  message: string;
}

/** Subscribe to move progress events; returns the unlisten function. */
export async function watchDataMoveProgress(cb: (p: DataMoveProgress) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<DataMoveProgress>("data-move-progress", (e) => cb(e.payload));
}

/** Points the app at an already-existing FormuLab data root — no files are
 *  copied. Makes a safety backup of the current root first, then switches
 *  and confirms resolution, exactly like a move's own activation step.
 *  Named without a `use` prefix on purpose — `react-hooks/rules-of-hooks`
 *  treats any `use*`-named function called from a callback as a hook
 *  violation, and this one is a plain async Tauri wrapper. */
export async function activateExistingDataLocation(path: string): Promise<DataMoveResult> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DataMoveResult>("use_existing_data_location", { path });
}

export interface RestoreDefaultResult {
  status: DataRootStatus;
  pointerRemoved: boolean;
}

/** Clears the base-workspace.txt pointer this manager (and the existing
 *  "Change workspace folder" control) write — falls back to the built-in
 *  default. Never touches formulab-root.txt/active-workspace.txt, which
 *  this app has never written itself. */
export async function restoreDefaultDataLocation(): Promise<RestoreDefaultResult> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RestoreDefaultResult>("restore_default_data_location");
}

export interface DataMoveJournalEntry {
  runId: string;
  ts: number;
  step: string;
  sourceRoot: string;
  destinationRoot: string;
  message?: string;
}

/** Non-null when an earlier move/relocate quit or crashed partway through. */
export async function checkInterruptedDataMove(): Promise<DataMoveJournalEntry | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DataMoveJournalEntry | null>("check_interrupted_data_move");
}

export interface DataMoveRecoveryResult {
  runId: string;
  action: "completed" | "rolledBack";
  detail: string;
  destinationRoot: string;
}

/** Resumes an interrupted move: completes it if what was already verified
 *  and activated is safe to finish, otherwise rolls back to the previous
 *  location. Never leaves the app pointed at a half-written destination. */
export async function resumeInterruptedDataMove(): Promise<DataMoveRecoveryResult> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DataMoveRecoveryResult>("resume_interrupted_data_move");
}

/** Deletes the old location entirely — never called automatically, only
 *  from an explicit, separately-confirmed cleanup action after a
 *  successful move. Refuses if `oldRoot` is still the active root. */
export async function cleanupOldDataLocation(oldRoot: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("cleanup_old_data_location", { oldRoot });
}

/** A project: a named workspace folder under the base dir, marked by its
 *  `.FormuLab/project.json`. Sessions group under it by `directory`. */
export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  /** Absolute workspace folder (canonical, matches session `directory`). For an
   *  imported project this is the external repo, not the app's stub folder. */
  path: string;
  /** True when this project points at a user-brought external repo/folder — the
   *  app never auto-commits into an imported workspace. */
  imported: boolean;
  /** Whether this project is pinned to the sidebar. */
  pinned: boolean;
}

/** Native folder picker; null on cancel or in the browser. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("pick_folder");
}

/** Native file picker, filtered to `extensions`; null on cancel or in the browser. */
export async function pickFile(extensions: string[] = []): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("pick_file", { extensions });
}

export interface ToolStatus {
  name: string;
  found: boolean;
  version?: string | null;
}

/** Host aliases from the user's ~/.ssh/config (desktop only). */
export async function listSshHosts(): Promise<string[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("list_ssh_hosts");
}

export interface GpuInfo {
  name: string;
  mem_total_mib: number;
  mem_used_mib: number;
  util_pct: number;
}

/** One live SSH probe of a remote machine (capabilities + usage snapshot). */
export interface ComputeProbe {
  reachable: boolean;
  message: string | null;
  os: string | null;
  cores: number | null;
  load1: number | null;
  mem_total_bytes: number | null;
  mem_avail_bytes: number | null;
  disk_total_bytes: number | null;
  disk_free_bytes: number | null;
  gpus: GpuInfo[];
  slurm: string | null;
}

/** Static capability cache the agent reads to pick a machine. */
export interface MachineCaps {
  cores: number | null;
  mem_total_bytes: number | null;
  gpus: string[];
  slurm: string | null;
}

export interface Machine {
  host: string;
  label: string | null;
  caps: MachineCaps | null;
}

/** A Slurm queue entry. */
export interface ComputeJob {
  id: string;
  state: string;
  time: string;
  partition: string;
  name: string;
}

/** Saved remote machines (migrates a legacy hpc.json on first read). */
export async function computeMachines(): Promise<Machine[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Machine[]>("compute_machines");
}

/** Save (or update the label of) a remote machine. */
export async function addComputeMachine(host: string, label?: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("add_compute_machine", { host, label: label ?? null });
}

export async function removeComputeMachine(host: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_compute_machine", { host });
}

/** Probe a machine over SSH; also caches its static caps for the agent. */
export async function computeProbe(host: string): Promise<ComputeProbe> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ComputeProbe>("compute_probe", { host });
}

/** A Slurm host's queue. */
export async function computeJobs(host: string): Promise<ComputeJob[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ComputeJob[]>("compute_jobs", { host });
}

export async function computeCancel(host: string, jobId: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("compute_cancel", { host, jobId });
}

export interface ModalStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  hint: string | null;
}

/** Detect whether the user's Modal CLI is installed and authenticated. */
export async function modalStatus(): Promise<ModalStatus | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ModalStatus>("modal_status");
}

/** Append a diagnostic line to <app-data>/debug.log (desktop only; no-op in browser). */
export async function logDebug(message: string): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("log_debug", { message });
  } catch {
    /* never let diagnostics break the app */
  }
}

/** Sync the native window appearance with the in-app theme so the macOS
 *  vibrancy material behind the translucent sidebar matches (warm and light
 *  are both light appearances). */
export async function setWindowTheme(dark: boolean): Promise<void> {
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(dark ? "dark" : "light");
  } catch (e) {
    // Best-effort — without it the material follows the system appearance.
    // Loud in the console: a denied capability here looks like a CSS bug.
    console.warn("setWindowTheme failed:", e);
  }
}

/** Set the webview page zoom (desktop only). We own zoom ourselves rather than
 *  Tauri's `zoomHotkeysEnabled` so the titlebar strips can counter-scale by the
 *  same factor — the native traffic lights don't zoom (see ZoomProvider). */
export async function setWebviewZoom(factor: number): Promise<void> {
  if (!isTauri) return;
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(factor);
  } catch (e) {
    // Best-effort — a denied capability just leaves the page at 100%.
    console.warn("setWebviewZoom failed:", e);
  }
}

/** True when the current UA is macOS (traffic lights live in the window chrome). */
export function isMacUA(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
}

/** Whether the macOS traffic lights overlap our content and need a left inset.
 *  Only in the packaged macOS webview (overlay titlebar) AND when not fullscreen
 *  — native fullscreen slides the lights away, so the inset would be an empty
 *  gap (the sidebar/expand buttons floated oddly indented in fullscreen). */
export function trafficLightsPresent(tauri: boolean, mac: boolean, fullscreen: boolean): boolean {
  return tauri && mac && !fullscreen;
}

/** Watch the window's fullscreen state (desktop only). Reports the current
 *  value immediately and on every enter/leave — fullscreen resizes the window,
 *  so a resize listener catches it. Returns an unlisten fn; in a plain browser
 *  it reports `false` once and unlisten is a no-op. */
export async function watchFullscreen(cb: (fullscreen: boolean) => void): Promise<() => void> {
  if (!isTauri) {
    cb(false);
    return () => {};
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const sync = async () => {
    try {
      cb(await win.isFullscreen());
    } catch {
      // Window gone or API unavailable — keep the last known value.
    }
  };
  await sync();
  return win.onResized(() => void sync());
}

// ---- Backup and restore (Phase 11) -----------------------------------------

export interface BackupFileEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BackupDataRootIdentifier {
  resolvedProjectRoot: string;
  resolvedWorkspaceRoot: string;
  resolvedBaseRoot: string;
  formulabRootOverrideActive: boolean;
  activeWorkspaceOverrideActive: boolean;
}

export interface BackupManifest {
  backupFormatVersion: string;
  formulabAppVersion: string;
  createdAt: number;
  dataRoot: BackupDataRootIdentifier;
  schemaVersions: Record<string, string>;
  included: string[];
  excluded: string[];
  fileInventory: BackupFileEntry[];
  totalBytes: number;
  warnings: string[];
  compatibility: { minSupportedAppVersion: string; maxKnownAppVersion: string };
}

export interface RestoreResult {
  manifest: BackupManifest;
  safetyBackupPath: string;
  restoredPaths: string[];
  warnings: string[];
}

/** One progress tick from a running backup or restore. */
export interface BackupProgress {
  phase:
    | "scanning"
    | "hashing"
    | "writing"
    | "verifying"
    | "extracting"
    | "activating"
    | "done"
    | "cancelled"
    | "error";
  current: number;
  total: number;
  message: string;
}

/** Native "Save As" dialog for a new `.formulab-backup` package (desktop only). */
export async function pickBackupDestination(defaultName: string): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("pick_backup_destination", { defaultName });
}

/** Native "choose a file" dialog filtered to `.formulab-backup` packages. */
export async function pickBackupSource(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("pick_file", { extensions: ["formulab-backup"] });
}

/** Create a `.formulab-backup` package at `destination`. Throws on failure
 *  (including cancellation, reported as an error whose message is
 *  `"cancelled"`). Subscribe to `watchBackupProgress` first to see progress. */
export async function createBackup(destination: string): Promise<BackupManifest> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BackupManifest>("create_backup", { destination });
}

/** Request cancellation of a running backup (best-effort, checked between steps). */
export async function cancelBackup(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("cancel_backup");
}

/** Subscribe to backup progress events; returns the unlisten function. */
export async function watchBackupProgress(cb: (p: BackupProgress) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<BackupProgress>("backup-progress", (e) => cb(e.payload));
}

/** Read a `.formulab-backup` package's manifest without restoring it. */
export async function inspectBackup(source: string): Promise<BackupManifest> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BackupManifest>("inspect_backup", { source });
}

/** Full restore from `source`. Creates a safety backup of the current data
 *  first, stages and verifies every file, then activates — rolling back on
 *  any failure. Throws on failure (including cancellation). Subscribe to
 *  `watchRestoreProgress` first to see progress. */
export async function restoreBackup(source: string): Promise<RestoreResult> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RestoreResult>("restore_backup", { source });
}

/** Request cancellation of a running restore (best-effort). */
export async function cancelRestore(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("cancel_restore");
}

/** Subscribe to restore progress events; returns the unlisten function. */
export async function watchRestoreProgress(cb: (p: BackupProgress) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<BackupProgress>("restore-progress", (e) => cb(e.payload));
}

// ---- Backup verification (Phase 11 Session 2) ------------------------------

export type VerificationStatus = "valid" | "validWithWarnings" | "incompatible" | "corrupted" | "unsafe";

export interface VerificationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface VerificationReport {
  status: VerificationStatus;
  manifest?: BackupManifest;
  errors: VerificationIssue[];
  warnings: VerificationIssue[];
}

/** Standalone verification: inspects a `.formulab-backup` package without
 *  restoring it or touching the active data root. Never throws for a bad
 *  package — a corrupted/unsafe/incompatible package is a normal, typed
 *  `VerificationReport` result, not an exception; this only throws for a
 *  genuine desktop-boundary problem (not running in Tauri). */
export async function verifyBackup(source: string): Promise<VerificationReport> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<VerificationReport>("verify_backup", { source });
}

// ---- Automatic backups (Phase 11 Session 7) --------------------------------

/** "preMigration" reuses the app-private pre-migration backup mechanism
 *  from Session 3 (`create_pre_migration_backup`) — only its retention is
 *  new here. "daily"/"weekly" write into the user-configured destination
 *  folder below. */
export type AutomaticBackupClass = "daily" | "weekly" | "preMigration";

export interface AutomaticBackupConfig {
  enabled: boolean;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  backupOnExitEnabled: boolean;
  destinationFolder: string | null;
  retentionDaily: number;
  retentionWeekly: number;
  retentionPreMigration: number;
}

export interface AutomaticBackupRunRecord {
  class: string;
  startedAt: number;
  finishedAt: number;
  status: "success" | "failed";
  path?: string;
  error?: string;
  verificationStatus?: VerificationStatus;
}

export interface AutomaticBackupState {
  config: AutomaticBackupConfig;
  lastDailyAt?: number;
  lastWeeklyAt?: number;
  lastSuccess?: AutomaticBackupRunRecord;
  lastFailure?: AutomaticBackupRunRecord;
}

/** Reads persisted automatic-backup settings + run history (app-private
 *  JSON, never the workspace). Returns the same shape a fresh install
 *  would have (disabled, no history) when not running in the desktop app,
 *  so callers never need an `isTauri` branch just to read state. */
export async function readAutomaticBackupState(): Promise<AutomaticBackupState> {
  if (!isTauri) {
    return {
      config: {
        enabled: false,
        dailyEnabled: true,
        weeklyEnabled: true,
        backupOnExitEnabled: false,
        destinationFolder: null,
        retentionDaily: 7,
        retentionWeekly: 4,
        retentionPreMigration: 2,
      },
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutomaticBackupState>("read_automatic_backup_state");
}

export async function writeAutomaticBackupConfig(config: AutomaticBackupConfig): Promise<AutomaticBackupState> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutomaticBackupState>("write_automatic_backup_config", { config });
}

/** Runs one automatic backup of `cls`, verifying it before it counts as
 *  successful and applying that class's retention afterward. Never throws
 *  for an expected failure (missing destination, low disk space, a
 *  concurrent backup already running, a failed verification) — those come
 *  back as a normal `{ status: "failed", error }` record; this only
 *  throws for a genuine desktop-boundary problem. */
export async function runAutomaticBackup(cls: AutomaticBackupClass): Promise<AutomaticBackupRunRecord> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutomaticBackupRunRecord>("run_automatic_backup", { class: cls });
}

/** Prunes app-private pre-migration backups down to `keep` (never the last
 *  one). Returns the paths deleted, for logging by the caller. */
export async function applyPreMigrationRetention(keep: number): Promise<string[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("apply_pre_migration_retention", { keep });
}

/** Reveals the configured automatic-backup destination folder — an
 *  absolute, user-picked path outside the workspace, so unlike
 *  `revealPath` this takes no workspace-relative `root`. */
export async function openAutomaticBackupDestination(path: string): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_automatic_backup_destination", { path });
}
