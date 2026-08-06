/**
 * Phase 11 Session 7 — automatic backups.
 *
 * Owns settings + scheduling only: WHEN a daily/weekly/on-exit backup is
 * due, and driving the existing `.formulab-backup` engine (via the Rust
 * `run_automatic_backup` command — see `apps/desktop/src-tauri/src/automatic_backup.rs`)
 * to actually create, verify, and prune one. No second backup mechanism —
 * every byte written here goes through Session 1's `try_create_backup` and
 * Session 2's `verify_backup_report`, unchanged.
 *
 * Persistence pattern matches `lib/update.ts` (Settings' own auto-check
 * store): the run history and destination/retention settings live in an
 * app-private JSON file (`read_automatic_backup_state`/
 * `write_automatic_backup_config`), not localStorage — unlike the update
 * checker's settings, these describe where real backup files land on disk,
 * so they need to survive exactly as long as the backups they describe.
 *
 * No background service: this module only ever runs while FormuLab is the
 * foreground process (see `installAutomaticBackupLifecycle`, wired from
 * `AppShell`) — on launch, on a while-open interval, and on window close.
 * A day or week where the app never opens has no automatic backup for
 * that day/week. This is a real, disclosed limitation, not a bug.
 */
import { create } from "zustand";
import {
  isTauri,
  logDebug,
  readAutomaticBackupState,
  runAutomaticBackup,
  writeAutomaticBackupConfig,
  type AutomaticBackupClass,
  type AutomaticBackupConfig,
  type AutomaticBackupRunRecord,
} from "./tauri";
import { notifyAutomaticBackupFailure } from "./systemNotification";
import { toast } from "./toast";
import { hasUnsavedWork, requestUnsavedCloseDecision, saveAllUnsavedWork } from "./unsavedWork";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** While the app is open, how often to re-check daily/weekly eligibility —
 *  independent of the intervals themselves, just how fine-grained the
 *  "was it due while I was open" check is. */
export const SCHEDULE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export const DEFAULT_AUTOMATIC_BACKUP_CONFIG: AutomaticBackupConfig = {
  enabled: false,
  dailyEnabled: true,
  weeklyEnabled: true,
  backupOnExitEnabled: false,
  destinationFolder: null,
  retentionDaily: 7,
  retentionWeekly: 4,
  retentionPreMigration: 2,
};

/** Pure eligibility check — no `lastAt` (never run) is always eligible. */
export function isDailyEligible(lastDailyAt: number | null | undefined, now: number): boolean {
  return !lastDailyAt || now - lastDailyAt >= DAY_MS;
}

export function isWeeklyEligible(lastWeeklyAt: number | null | undefined, now: number): boolean {
  return !lastWeeklyAt || now - lastWeeklyAt >= WEEK_MS;
}

/** `null` means "eligible now" — matches `isDailyEligible`/`isWeeklyEligible`'s
 *  own "no `lastAt` ⇒ eligible" rule, so the UI's "next eligible run" and the
 *  scheduler's own decision can never disagree. */
export function nextEligibleAt(lastAt: number | null | undefined, intervalMs: number): number | null {
  if (!lastAt) return null;
  return lastAt + intervalMs;
}

interface AutomaticBackupStoreState {
  config: AutomaticBackupConfig;
  lastDailyAt: number | null;
  lastWeeklyAt: number | null;
  lastSuccess: AutomaticBackupRunRecord | null;
  lastFailure: AutomaticBackupRunRecord | null;
  loaded: boolean;
  /** Non-null while an automatic run is in flight — the in-tab half of
   *  concurrency prevention; the Rust side (`BackupState`) is the other
   *  half, catching a manual backup/restore or a second app instance. */
  running: AutomaticBackupClass | null;
  refresh: () => Promise<void>;
  setConfig: (config: AutomaticBackupConfig) => Promise<void>;
  runNow: (cls: AutomaticBackupClass) => Promise<AutomaticBackupRunRecord>;
  maybeRunScheduled: (now?: number) => Promise<void>;
  runOnExit: () => Promise<void>;
}

function applyRustState(state: Awaited<ReturnType<typeof readAutomaticBackupState>>) {
  return {
    config: state.config,
    lastDailyAt: state.lastDailyAt ?? null,
    lastWeeklyAt: state.lastWeeklyAt ?? null,
    lastSuccess: state.lastSuccess ?? null,
    lastFailure: state.lastFailure ?? null,
  };
}

export const useAutomaticBackupStore = create<AutomaticBackupStoreState>((set, get) => ({
  config: DEFAULT_AUTOMATIC_BACKUP_CONFIG,
  lastDailyAt: null,
  lastWeeklyAt: null,
  lastSuccess: null,
  lastFailure: null,
  loaded: false,
  running: null,

  refresh: async () => {
    const state = await readAutomaticBackupState();
    set({ ...applyRustState(state), loaded: true });
  },

  setConfig: async (config) => {
    const state = await writeAutomaticBackupConfig(config);
    set(applyRustState(state));
  },

  runNow: async (cls) => {
    if (get().running) {
      throw new Error("an automatic backup is already running");
    }
    set({ running: cls });
    try {
      const record = await runAutomaticBackup(cls);
      // Re-read rather than hand-merge `record` into state: the Rust side
      // is the single source of truth for lastDailyAt/lastWeeklyAt/
      // lastSuccess/lastFailure, and retention may have pruned files this
      // tab doesn't otherwise know about.
      const state = await readAutomaticBackupState();
      set(applyRustState(state));
      if (record.status === "failed") {
        toast.error(`Automatic backup (${cls}) failed: ${record.error ?? "unknown error"}`);
        void notifyAutomaticBackupFailure(cls, record.error ?? "unknown error");
      }
      return record;
    } finally {
      set({ running: null });
    }
  },

  maybeRunScheduled: async (now = Date.now()) => {
    const s = get();
    if (!isTauri || s.running || !s.config.enabled) return;
    if (s.config.dailyEnabled && isDailyEligible(s.lastDailyAt, now)) {
      await get().runNow("daily");
      return; // one run per tick; a still-due weekly is picked up next tick
    }
    if (s.config.weeklyEnabled && isWeeklyEligible(s.lastWeeklyAt, now)) {
      await get().runNow("weekly");
    }
  },

  runOnExit: async () => {
    const s = get();
    if (!isTauri || s.running || !s.config.enabled || !s.config.backupOnExitEnabled) return;
    // Exit-triggered backups are classified "daily" (see module doc) —
    // this also satisfies the day's own daily-backup eligibility, so
    // closing the app in the evening doesn't cause a second daily backup
    // on next launch the same day.
    await get().runNow("daily");
  },
}));

/** A hung exit backup must never trap the user in an unclosable window
 *  (req: "any backup or cleanup failure must not trap the application
 *  indefinitely"). `run_automatic_backup` has no server-side timeout of
 *  its own, so this is enforced here: if it hasn't settled within
 *  `EXIT_BACKUP_TIMEOUT_MS`, the close proceeds anyway and the abandoned
 *  Rust task is left to be killed with the process — its orphaned `.tmp`
 *  file is cleaned up by the next successful run of the same class
 *  (`apply_retention`'s orphan-tmp sweep already handles an interrupted
 *  write; this is that same case, just triggered by a close instead of a
 *  crash). */
const EXIT_BACKUP_TIMEOUT_MS = 10_000;

async function runExitBackupWithTimeout(): Promise<void> {
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, EXIT_BACKUP_TIMEOUT_MS);
  });
  const run = useAutomaticBackupStore
    .getState()
    .runOnExit()
    .catch((e) => {
      void logDebug(`window close: automatic exit backup failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  await Promise.race([run, timeout]);
  if (timedOut) {
    void logDebug(`window close: automatic exit backup did not finish within ${EXIT_BACKUP_TIMEOUT_MS}ms, closing anyway`);
  }
}

/** Wires the scheduling tick (mount + while-open interval) and the single
 *  native close-request handler. Called once from `AppShell`, matching the
 *  existing `ensureJupyter()`/`ensureSetupProgressListener()` pattern of
 *  app-lifetime setup living in a `lib/` module, not inline in the shell.
 *  Returns a cleanup function.
 *
 *  This is the ONLY place that intercepts the native window-close event —
 *  the title bar is the OS's own (`decorations`/native, no custom close
 *  button; see `tauri.conf.json`), so clicking X and pressing Alt+F4 both
 *  raise the identical Tauri `CloseRequested` event and go through this
 *  exact same sequence: unsaved-work check → optional exit backup (bounded)
 *  → close. Minimize/maximize use separate window APIs entirely and are
 *  untouched by any of this. */
export function installAutomaticBackupLifecycle(): () => void {
  if (!isTauri) return () => {};

  void useAutomaticBackupStore.getState().refresh().then(() => {
    void useAutomaticBackupStore.getState().maybeRunScheduled();
  });
  const interval = setInterval(() => {
    void useAutomaticBackupStore.getState().maybeRunScheduled();
  }, SCHEDULE_CHECK_INTERVAL_MS);

  let unlistenClose: (() => void) | undefined;
  let cancelled = false;
  let closing = false;
  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const unlisten = await win.onCloseRequested(async (event) => {
      if (closing) return; // this app-initiated re-close already ran the flow once — let it through
      event.preventDefault();

      try {
        if (hasUnsavedWork()) {
          const choice = await requestUnsavedCloseDecision();
          if (choice === "cancel") return; // stays open; preventDefault above already blocked this attempt
          if (choice === "save") {
            await saveAllUnsavedWork(); // logs its own per-draft failures; never rejects
          }
        }

        const s = useAutomaticBackupStore.getState();
        if (s.config.enabled && s.config.backupOnExitEnabled) {
          await runExitBackupWithTimeout();
        }
      } catch (e) {
        // Every step above already catches its own failures; this is only
        // reached by a genuinely unexpected error. Per requirement: a
        // backup/cleanup failure must never trap the app — log it and close
        // anyway rather than leave the window stuck.
        void logDebug(`window close: unexpected error in close flow, closing anyway: ${e instanceof Error ? e.message : String(e)}`);
      }

      closing = true;
      await win.close();
    });
    if (cancelled) unlisten();
    else unlistenClose = unlisten;
  })();

  return () => {
    cancelled = true;
    clearInterval(interval);
    unlistenClose?.();
  };
}
