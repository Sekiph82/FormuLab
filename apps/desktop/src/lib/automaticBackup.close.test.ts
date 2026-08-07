// Phase 12 — window-close fix. Focused tests for the single native
// `onCloseRequested` handler wired by `installAutomaticBackupLifecycle`.
// X, Alt+F4, and a fullscreen window's close button all raise the identical
// Tauri `CloseRequested` event and are indistinguishable to this code, so
// one set of handler-level tests covers all three trigger paths.
//
// Ends with `win.destroy()`, not `win.close()` — confirmed by live testing
// against the real WebView2 window: `close()` re-emits `closeRequested`
// (documented Tauri behavior) and that second cycle never actually
// resolved, permanently hanging the window with the title bar merely
// losing focus. `destroy()` is Tauri's documented non-recursive
// force-close, so there is no second cycle for this code to guard
// against.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomaticBackupConfig, AutomaticBackupRunRecord, AutomaticBackupState } from "./tauri";

const bridge = {
  isTauri: true,
  readAutomaticBackupState: vi.fn<() => Promise<AutomaticBackupState>>(),
  writeAutomaticBackupConfig: vi.fn<(config: AutomaticBackupConfig) => Promise<AutomaticBackupState>>(),
  runAutomaticBackup: vi.fn<(cls: string) => Promise<AutomaticBackupRunRecord>>(),
  logDebug: vi.fn<(message: string) => Promise<void>>(),
};

vi.mock("./tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
  readAutomaticBackupState: () => bridge.readAutomaticBackupState(),
  writeAutomaticBackupConfig: (config: AutomaticBackupConfig) => bridge.writeAutomaticBackupConfig(config),
  runAutomaticBackup: (cls: string) => bridge.runAutomaticBackup(cls),
  logDebug: (message: string) => bridge.logDebug(message),
}));

vi.mock("./systemNotification", () => ({
  notifyAutomaticBackupFailure: () => Promise.resolve(true),
}));

type CloseRequestedHandler = (event: { preventDefault: () => void }) => void | Promise<void>;

const win = {
  onCloseRequested: vi.fn<(handler: CloseRequestedHandler) => Promise<() => void>>(),
  destroy: vi.fn<() => Promise<void>>(),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
}));

import { installAutomaticBackupLifecycle, useAutomaticBackupStore, DEFAULT_AUTOMATIC_BACKUP_CONFIG } from "./automaticBackup";
import { registerUnsavedWork, resolvePendingUnsavedClose, unregisterUnsavedWork } from "./unsavedWork";

function config(overrides: Partial<AutomaticBackupConfig> = {}): AutomaticBackupConfig {
  return { ...DEFAULT_AUTOMATIC_BACKUP_CONFIG, enabled: true, destinationFolder: "D:\\backups", ...overrides };
}

function successRecord(cls: string): AutomaticBackupRunRecord {
  return { class: cls, startedAt: 1000, finishedAt: 1001, status: "success", verificationStatus: "valid" };
}

let capturedHandler: CloseRequestedHandler | undefined;

/** Registers the close listener and waits for the async IIFE inside
 *  `installAutomaticBackupLifecycle` to actually capture it. */
async function installAndCaptureHandler(): Promise<() => void> {
  capturedHandler = undefined;
  win.onCloseRequested.mockImplementation(async (handler) => {
    capturedHandler = handler;
    return () => {};
  });
  const cleanup = installAutomaticBackupLifecycle();
  await vi.waitFor(() => expect(capturedHandler).toBeDefined());
  return cleanup;
}

async function fireCloseRequest(): Promise<void> {
  const event = { preventDefault: vi.fn() };
  await capturedHandler!(event);
}

beforeEach(() => {
  bridge.isTauri = true;
  bridge.readAutomaticBackupState.mockReset().mockResolvedValue({ config: config({ enabled: false }) });
  bridge.writeAutomaticBackupConfig.mockReset();
  bridge.runAutomaticBackup.mockReset();
  bridge.logDebug.mockReset().mockResolvedValue(undefined);
  win.onCloseRequested.mockReset();
  win.destroy.mockReset().mockResolvedValue(undefined);
  useAutomaticBackupStore.setState({
    config: DEFAULT_AUTOMATIC_BACKUP_CONFIG,
    lastDailyAt: null,
    lastWeeklyAt: null,
    lastSuccess: null,
    lastFailure: null,
    loaded: false,
    running: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
  unregisterUnsavedWork("test-formulation");
});

describe("window close — no unsaved work, exit backup disabled", () => {
  it("closes immediately (default close behavior)", async () => {
    const cleanup = await installAndCaptureHandler();
    await fireCloseRequest();
    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(bridge.runAutomaticBackup).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("window close — unsaved formulation draft", () => {
  it("cancel keeps the window open and never closes", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    registerUnsavedWork("test-formulation", { save });
    const cleanup = await installAndCaptureHandler();

    const closePromise = fireCloseRequest();
    resolvePendingUnsavedClose("cancel");
    await closePromise;

    expect(win.destroy).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    cleanup();
  });

  it("a subsequent close attempt after Cancel runs the flow again (not permanently ignored)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    registerUnsavedWork("test-formulation", { save });
    const cleanup = await installAndCaptureHandler();

    let closePromise = fireCloseRequest();
    resolvePendingUnsavedClose("cancel");
    await closePromise;
    expect(win.destroy).not.toHaveBeenCalled();

    closePromise = fireCloseRequest();
    resolvePendingUnsavedClose("discard");
    await closePromise;
    expect(win.destroy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("close without saving closes without invoking the save callback", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    registerUnsavedWork("test-formulation", { save });
    const cleanup = await installAndCaptureHandler();

    const closePromise = fireCloseRequest();
    resolvePendingUnsavedClose("discard");
    await closePromise;

    expect(save).not.toHaveBeenCalled();
    expect(win.destroy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("save and close invokes the save callback before destroying the window", async () => {
    const order: string[] = [];
    const save = vi.fn().mockImplementation(async () => {
      order.push("save");
    });
    win.destroy.mockImplementation(async () => {
      order.push("destroy");
    });
    registerUnsavedWork("test-formulation", { save });
    const cleanup = await installAndCaptureHandler();

    const closePromise = fireCloseRequest();
    resolvePendingUnsavedClose("save");
    await closePromise;

    expect(order).toEqual(["save", "destroy"]);
    cleanup();
  });

  it("a failing save is logged but the window still closes", async () => {
    registerUnsavedWork("test-formulation", { save: () => Promise.reject(new Error("disk full")) });
    const cleanup = await installAndCaptureHandler();

    const closePromise = fireCloseRequest();
    resolvePendingUnsavedClose("save");
    await closePromise;

    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(bridge.logDebug).toHaveBeenCalledWith(expect.stringContaining("saving unsaved work (test-formulation) failed"));
    cleanup();
  });
});

describe("window close — automatic exit backup", () => {
  it("a failed exit backup is logged and does not block close", async () => {
    bridge.runAutomaticBackup.mockRejectedValue(new Error("destination folder does not exist: D:\\gone"));
    // dailyEnabled/weeklyEnabled off so the lifecycle's own startup
    // scheduled-check can't race with the close-triggered run below.
    const cfg = config({ backupOnExitEnabled: true, dailyEnabled: false, weeklyEnabled: false });
    useAutomaticBackupStore.setState({ config: cfg });
    bridge.readAutomaticBackupState.mockResolvedValue({ config: cfg });
    const cleanup = await installAndCaptureHandler();

    await fireCloseRequest();

    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(bridge.logDebug).toHaveBeenCalledWith(expect.stringContaining("automatic exit backup failed"));
    cleanup();
  });

  it("a hung exit backup times out and closes anyway, with the hang logged", async () => {
    bridge.runAutomaticBackup.mockReturnValue(new Promise(() => {})); // never resolves
    const cfg = config({ backupOnExitEnabled: true, dailyEnabled: false, weeklyEnabled: false });
    useAutomaticBackupStore.setState({ config: cfg });
    bridge.readAutomaticBackupState.mockResolvedValue({ config: cfg });
    const cleanup = await installAndCaptureHandler();

    vi.useFakeTimers();
    const closePromise = fireCloseRequest();
    await vi.advanceTimersByTimeAsync(10_000);
    await closePromise;

    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(bridge.logDebug).toHaveBeenCalledWith(expect.stringContaining("did not finish within"));
    cleanup();
  });

  it("a successful exit backup completes normally before close", async () => {
    bridge.runAutomaticBackup.mockResolvedValue(successRecord("daily"));
    const cfg = config({ backupOnExitEnabled: true, dailyEnabled: false, weeklyEnabled: false });
    bridge.readAutomaticBackupState.mockResolvedValue({ config: cfg, lastDailyAt: 1000 });
    useAutomaticBackupStore.setState({ config: cfg });
    const cleanup = await installAndCaptureHandler();

    await fireCloseRequest();

    expect(bridge.runAutomaticBackup).toHaveBeenCalledWith("daily");
    expect(win.destroy).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

describe("window close — win.destroy() itself fails (live-reproduced: a denied permission)", () => {
  it("logs the failure and does not permanently ignore future close attempts", async () => {
    win.destroy.mockRejectedValueOnce(
      new Error("window.destroy not allowed. Permissions associated with this command: core:window:allow-destroy"),
    );
    const cleanup = await installAndCaptureHandler();

    await fireCloseRequest();
    expect(bridge.logDebug).toHaveBeenCalledWith(expect.stringContaining("win.destroy() failed"));

    // Without resetting `closing` on failure, this second attempt would be
    // silently ignored forever — exactly the live bug this test guards
    // against (found via a real WebView2 permission denial, see
    // capabilities/default.json's core:window:allow-destroy grant).
    win.destroy.mockResolvedValue(undefined);
    await fireCloseRequest();
    expect(win.destroy).toHaveBeenCalledTimes(2);
    cleanup();
  });
});

describe("window close — a duplicate close request while one is already in flight", () => {
  it("ignores the duplicate (no double dialog, no double backup)", async () => {
    const cleanup = await installAndCaptureHandler();
    win.destroy.mockImplementation(() => new Promise(() => {})); // never resolves, so the first request stays "in flight"

    void fireCloseRequest();
    await vi.waitFor(() => expect(win.destroy).toHaveBeenCalledTimes(1));

    // A second close signal arriving while the first hasn't resolved yet
    // must not re-run the flow.
    await fireCloseRequest();
    expect(win.destroy).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
