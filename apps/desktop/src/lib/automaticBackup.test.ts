import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomaticBackupConfig, AutomaticBackupRunRecord, AutomaticBackupState } from "./tauri";

const bridge = {
  isTauri: true,
  readAutomaticBackupState: vi.fn<() => Promise<AutomaticBackupState>>(),
  writeAutomaticBackupConfig: vi.fn<(config: AutomaticBackupConfig) => Promise<AutomaticBackupState>>(),
  runAutomaticBackup: vi.fn<(cls: string) => Promise<AutomaticBackupRunRecord>>(),
};

vi.mock("./tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
  readAutomaticBackupState: () => bridge.readAutomaticBackupState(),
  writeAutomaticBackupConfig: (config: AutomaticBackupConfig) => bridge.writeAutomaticBackupConfig(config),
  runAutomaticBackup: (cls: string) => bridge.runAutomaticBackup(cls),
}));

const notifyMock = vi.fn<(cls: string, message: string) => Promise<boolean>>();
vi.mock("./systemNotification", () => ({
  notifyAutomaticBackupFailure: (cls: string, message: string) => notifyMock(cls, message),
}));

import {
  DAY_MS,
  DEFAULT_AUTOMATIC_BACKUP_CONFIG,
  WEEK_MS,
  isDailyEligible,
  isWeeklyEligible,
  nextEligibleAt,
  useAutomaticBackupStore,
} from "./automaticBackup";

function config(overrides: Partial<AutomaticBackupConfig> = {}): AutomaticBackupConfig {
  return { ...DEFAULT_AUTOMATIC_BACKUP_CONFIG, enabled: true, destinationFolder: "D:\\backups", ...overrides };
}

function state(overrides: Partial<AutomaticBackupState> = {}): AutomaticBackupState {
  return { config: config(), ...overrides };
}

function successRecord(cls: string, overrides: Partial<AutomaticBackupRunRecord> = {}): AutomaticBackupRunRecord {
  return {
    class: cls,
    startedAt: 1000,
    finishedAt: 1001,
    status: "success",
    path: "D:\\backups\\formulab-auto-daily-1000.formulab-backup",
    verificationStatus: "valid",
    ...overrides,
  };
}

function failureRecord(cls: string, error: string): AutomaticBackupRunRecord {
  return { class: cls, startedAt: 1000, finishedAt: 1001, status: "failed", error };
}

beforeEach(() => {
  bridge.isTauri = true;
  bridge.readAutomaticBackupState.mockReset();
  bridge.writeAutomaticBackupConfig.mockReset();
  bridge.runAutomaticBackup.mockReset();
  notifyMock.mockReset();
  bridge.readAutomaticBackupState.mockResolvedValue(state());
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

describe("isDailyEligible / isWeeklyEligible", () => {
  const now = 1_700_000_000_000;

  it("is eligible when never run", () => {
    expect(isDailyEligible(null, now)).toBe(true);
    expect(isWeeklyEligible(undefined, now)).toBe(true);
  });

  it("daily is due once 24h have passed, not before", () => {
    expect(isDailyEligible(now - DAY_MS + 1000, now)).toBe(false);
    expect(isDailyEligible(now - DAY_MS, now)).toBe(true);
  });

  it("weekly is due once 7 days have passed, not before", () => {
    expect(isWeeklyEligible(now - WEEK_MS + 1000, now)).toBe(false);
    expect(isWeeklyEligible(now - WEEK_MS, now)).toBe(true);
  });
});

describe("nextEligibleAt", () => {
  it("is null (eligible now) when never run", () => {
    expect(nextEligibleAt(null, DAY_MS)).toBeNull();
  });

  it("is lastAt + interval otherwise", () => {
    expect(nextEligibleAt(1000, DAY_MS)).toBe(1000 + DAY_MS);
  });
});

describe("useAutomaticBackupStore.refresh/setConfig", () => {
  it("refresh loads config and history from the Rust side", async () => {
    bridge.readAutomaticBackupState.mockResolvedValue(
      state({ lastDailyAt: 500, lastSuccess: successRecord("daily") }),
    );
    await useAutomaticBackupStore.getState().refresh();
    const s = useAutomaticBackupStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.lastDailyAt).toBe(500);
    expect(s.lastSuccess?.class).toBe("daily");
  });

  it("setConfig writes through and applies the returned state", async () => {
    const next = config({ retentionDaily: 10 });
    bridge.writeAutomaticBackupConfig.mockResolvedValue(state({ config: next }));
    await useAutomaticBackupStore.getState().setConfig(next);
    expect(bridge.writeAutomaticBackupConfig).toHaveBeenCalledWith(next);
    expect(useAutomaticBackupStore.getState().config.retentionDaily).toBe(10);
  });
});

describe("useAutomaticBackupStore.runNow", () => {
  it("prevents a second concurrent run (duplicate trigger prevention)", async () => {
    let resolveFirst!: (r: AutomaticBackupRunRecord) => void;
    bridge.runAutomaticBackup.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const first = useAutomaticBackupStore.getState().runNow("daily");
    expect(useAutomaticBackupStore.getState().running).toBe("daily");

    // NOTE: `.rejects.toThrow(pattern)` (string/regex argument form) is
    // broken in this vitest/chai combo (see `download.test.ts`'s own note on
    // the same defect) — asserts the exact same thing via the
    // proven-working combination instead: `.rejects.toThrow(Error)` plus a
    // manual try/catch for the message.
    await expect(useAutomaticBackupStore.getState().runNow("weekly")).rejects.toThrow(Error);
    let caught: unknown;
    try {
      await useAutomaticBackupStore.getState().runNow("weekly");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/already running/);

    resolveFirst(successRecord("daily"));
    await first;
    expect(useAutomaticBackupStore.getState().running).toBeNull();
  });

  it("on success, re-reads state and never notifies/toasts", async () => {
    bridge.runAutomaticBackup.mockResolvedValue(successRecord("daily"));
    bridge.readAutomaticBackupState.mockResolvedValue(state({ lastDailyAt: 1000, lastSuccess: successRecord("daily") }));
    const record = await useAutomaticBackupStore.getState().runNow("daily");
    expect(record.status).toBe("success");
    expect(useAutomaticBackupStore.getState().lastDailyAt).toBe(1000);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("on a failed run (missing destination), records the failure and notifies", async () => {
    const failure = failureRecord("daily", "destination folder does not exist: D:\\gone");
    bridge.runAutomaticBackup.mockResolvedValue(failure);
    bridge.readAutomaticBackupState.mockResolvedValue(state({ lastFailure: failure }));
    const record = await useAutomaticBackupStore.getState().runNow("daily");
    expect(record.status).toBe("failed");
    expect(useAutomaticBackupStore.getState().lastFailure?.error).toMatch(/destination folder does not exist/);
    expect(notifyMock).toHaveBeenCalledWith("daily", expect.stringMatching(/destination folder does not exist/));
  });

  it("on a failed run (low disk space), still surfaces the exact Rust error text", async () => {
    const failure = failureRecord("daily", "not enough free disk space at destination: 900 bytes required, 100 available");
    bridge.runAutomaticBackup.mockResolvedValue(failure);
    bridge.readAutomaticBackupState.mockResolvedValue(state({ lastFailure: failure }));
    const record = await useAutomaticBackupStore.getState().runNow("daily");
    expect(record.error).toMatch(/not enough free disk space/);
  });

  it("on a failed verification, the failure record carries the verification status", async () => {
    const failure: AutomaticBackupRunRecord = {
      class: "daily",
      startedAt: 1000,
      finishedAt: 1001,
      status: "failed",
      error: "automatic backup failed verification: corrupted",
      verificationStatus: "corrupted",
    };
    bridge.runAutomaticBackup.mockResolvedValue(failure);
    bridge.readAutomaticBackupState.mockResolvedValue(state({ lastFailure: failure }));
    await useAutomaticBackupStore.getState().runNow("daily");
    expect(useAutomaticBackupStore.getState().lastFailure?.verificationStatus).toBe("corrupted");
  });

  it("clears `running` even when the Rust call throws", async () => {
    bridge.runAutomaticBackup.mockRejectedValue(new Error("not running in the desktop app"));
    await expect(useAutomaticBackupStore.getState().runNow("daily")).rejects.toThrow();
    expect(useAutomaticBackupStore.getState().running).toBeNull();
  });
});

describe("useAutomaticBackupStore.maybeRunScheduled", () => {
  it("does nothing when automatic backups are disabled", async () => {
    useAutomaticBackupStore.setState({ config: config({ enabled: false }), lastDailyAt: null });
    await useAutomaticBackupStore.getState().maybeRunScheduled(2_000_000_000_000);
    expect(bridge.runAutomaticBackup).not.toHaveBeenCalled();
  });

  it("does nothing when not yet due", async () => {
    const now = 2_000_000_000_000;
    useAutomaticBackupStore.setState({ config: config(), lastDailyAt: now - 1000, lastWeeklyAt: now - 1000 });
    await useAutomaticBackupStore.getState().maybeRunScheduled(now);
    expect(bridge.runAutomaticBackup).not.toHaveBeenCalled();
  });

  it("runs a due daily backup", async () => {
    const now = 2_000_000_000_000;
    bridge.runAutomaticBackup.mockResolvedValue(successRecord("daily", { startedAt: now }));
    bridge.readAutomaticBackupState.mockResolvedValue(state({ lastDailyAt: now }));
    useAutomaticBackupStore.setState({ config: config(), lastDailyAt: null, lastWeeklyAt: now });
    await useAutomaticBackupStore.getState().maybeRunScheduled(now);
    expect(bridge.runAutomaticBackup).toHaveBeenCalledWith("daily");
  });

  it("runs a due weekly backup when daily is not due", async () => {
    const now = 2_000_000_000_000;
    bridge.runAutomaticBackup.mockResolvedValue(successRecord("weekly", { startedAt: now }));
    bridge.readAutomaticBackupState.mockResolvedValue(state({ lastWeeklyAt: now }));
    useAutomaticBackupStore.setState({ config: config(), lastDailyAt: now, lastWeeklyAt: null });
    await useAutomaticBackupStore.getState().maybeRunScheduled(now);
    expect(bridge.runAutomaticBackup).toHaveBeenCalledWith("weekly");
  });

  it("respects the per-class enabled flags independent of the master toggle", async () => {
    const now = 2_000_000_000_000;
    useAutomaticBackupStore.setState({
      config: config({ dailyEnabled: false }),
      lastDailyAt: null,
      lastWeeklyAt: now,
    });
    await useAutomaticBackupStore.getState().maybeRunScheduled(now);
    expect(bridge.runAutomaticBackup).not.toHaveBeenCalled();
  });
});

describe("useAutomaticBackupStore.runOnExit", () => {
  it("does nothing when backup-on-exit is disabled", async () => {
    useAutomaticBackupStore.setState({ config: config({ backupOnExitEnabled: false }) });
    await useAutomaticBackupStore.getState().runOnExit();
    expect(bridge.runAutomaticBackup).not.toHaveBeenCalled();
  });

  it("does nothing when automatic backups are disabled overall", async () => {
    useAutomaticBackupStore.setState({ config: config({ enabled: false, backupOnExitEnabled: true }) });
    await useAutomaticBackupStore.getState().runOnExit();
    expect(bridge.runAutomaticBackup).not.toHaveBeenCalled();
  });

  it("runs a (daily-classed) backup when enabled", async () => {
    bridge.runAutomaticBackup.mockResolvedValue(successRecord("daily"));
    bridge.readAutomaticBackupState.mockResolvedValue(state({ lastDailyAt: 1000 }));
    useAutomaticBackupStore.setState({ config: config({ backupOnExitEnabled: true }) });
    await useAutomaticBackupStore.getState().runOnExit();
    expect(bridge.runAutomaticBackup).toHaveBeenCalledWith("daily");
  });
});
