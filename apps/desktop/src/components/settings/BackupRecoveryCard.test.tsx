import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupManifest, BackupProgress, RestoreResult, VerificationReport } from "@/lib/tauri";
import { BackupRecoveryCard } from "./BackupRecoveryCard";

const bridge = {
  isTauri: true,
  pickBackupDestination: vi.fn<(name: string) => Promise<string | null>>(),
  pickBackupSource: vi.fn<() => Promise<string | null>>(),
  createBackup: vi.fn<(dest: string) => Promise<BackupManifest>>(),
  cancelBackup: vi.fn<() => Promise<void>>(),
  inspectBackup: vi.fn<(source: string) => Promise<BackupManifest>>(),
  restoreBackup: vi.fn<(source: string) => Promise<RestoreResult>>(),
  cancelRestore: vi.fn<() => Promise<void>>(),
  verifyBackup: vi.fn<(source: string) => Promise<VerificationReport>>(),
  watchBackupProgress: vi.fn<(cb: (p: BackupProgress) => void) => Promise<() => void>>(),
  watchRestoreProgress: vi.fn<(cb: (p: BackupProgress) => void) => Promise<() => void>>(),
};

vi.mock("@/lib/tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
  pickBackupDestination: (...a: [string]) => bridge.pickBackupDestination(...a),
  pickBackupSource: () => bridge.pickBackupSource(),
  createBackup: (...a: [string]) => bridge.createBackup(...a),
  cancelBackup: () => bridge.cancelBackup(),
  inspectBackup: (...a: [string]) => bridge.inspectBackup(...a),
  restoreBackup: (...a: [string]) => bridge.restoreBackup(...a),
  cancelRestore: () => bridge.cancelRestore(),
  verifyBackup: (...a: [string]) => bridge.verifyBackup(...a),
  watchBackupProgress: (cb: (p: BackupProgress) => void) => bridge.watchBackupProgress(cb),
  watchRestoreProgress: (cb: (p: BackupProgress) => void) => bridge.watchRestoreProgress(cb),
}));

function manifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    backupFormatVersion: "1.0",
    formulabAppVersion: "0.4.0",
    createdAt: 1_800_000_000,
    dataRoot: {
      resolvedProjectRoot: "C:\\Users\\test\\Documents\\FormuLab",
      resolvedWorkspaceRoot: "C:\\Users\\test\\Documents\\FormuLab",
      resolvedBaseRoot: "C:\\Users\\test\\Documents\\FormuLab",
      formulabRootOverrideActive: false,
      activeWorkspaceOverrideActive: false,
    },
    schemaVersions: { _global: "1.0" },
    included: ["data/master/materials.json"],
    excluded: [".FormuLab/runs.db (never touched)"],
    fileInventory: [{ path: "data/master/materials.json", bytes: 42, sha256: "abc" }],
    totalBytes: 42,
    warnings: [],
    compatibility: { minSupportedAppVersion: "0.4.0", maxKnownAppVersion: "0.4.0" },
    ...overrides,
  };
}

describe("BackupRecoveryCard", () => {
  beforeEach(() => {
    Object.values(bridge).forEach((f) => {
      if (typeof f === "function" && "mockReset" in f) (f as { mockReset: () => void }).mockReset();
    });
    bridge.isTauri = true;
    bridge.watchBackupProgress.mockResolvedValue(() => {});
    bridge.watchRestoreProgress.mockResolvedValue(() => {});
  });

  it("shows the desktop-only fallback when not running in Tauri", () => {
    bridge.isTauri = false;
    render(<BackupRecoveryCard />);
    expect(screen.getByText(/available in the desktop app/i)).toBeInTheDocument();
    expect(screen.queryByText("Create Backup")).not.toBeInTheDocument();
  });

  it("renders Create Backup and Restore Backup actions in idle state", () => {
    render(<BackupRecoveryCard />);
    expect(screen.getByRole("button", { name: /Create Backup/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Restore Backup/ })).toBeInTheDocument();
  });

  it("does nothing when the save dialog is cancelled (no destination picked)", async () => {
    bridge.pickBackupDestination.mockResolvedValue(null);
    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Create Backup/ }));
    await waitFor(() => expect(bridge.pickBackupDestination).toHaveBeenCalled());
    expect(bridge.createBackup).not.toHaveBeenCalled();
  });

  it("creates a backup and shows the file/size summary on success", async () => {
    bridge.pickBackupDestination.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.createBackup.mockResolvedValue(manifest({ totalBytes: 2048, fileInventory: [
      { path: "a", bytes: 1024, sha256: "x" },
      { path: "b", bytes: 1024, sha256: "y" },
    ] }));

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Create Backup/ }));

    expect(await screen.findByText(/Backup created/)).toBeInTheDocument();
    expect(screen.getByText(/2 files, 2\.0 KB/)).toBeInTheDocument();
    expect(bridge.createBackup).toHaveBeenCalledWith("C:\\backups\\one.formulab-backup");
  });

  it("shows manifest warnings after a successful backup", async () => {
    bridge.pickBackupDestination.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.createBackup.mockResolvedValue(
      manifest({ warnings: ["data/literature was NOT included (network cache)"] }),
    );
    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Create Backup/ }));
    expect(await screen.findByText(/data\/literature was NOT included/)).toBeInTheDocument();
  });

  it("shows a failure state with the error message when backup creation fails", async () => {
    bridge.pickBackupDestination.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.createBackup.mockRejectedValue(new Error("not enough free disk space"));
    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Create Backup/ }));
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.getByText(/not enough free disk space/)).toBeInTheDocument();
  });

  it("returns quietly to idle when backup creation is cancelled", async () => {
    bridge.pickBackupDestination.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.createBackup.mockRejectedValue(new Error("cancelled"));
    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Create Backup/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Create Backup/ })).toBeInTheDocument());
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it("shows live progress while a backup is running", async () => {
    let progressCb: ((p: BackupProgress) => void) | undefined;
    bridge.watchBackupProgress.mockImplementation(async (cb) => {
      progressCb = cb;
      return () => {};
    });
    bridge.pickBackupDestination.mockResolvedValue("C:\\backups\\one.formulab-backup");
    let resolveCreate!: (m: BackupManifest) => void;
    bridge.createBackup.mockImplementation(
      () => new Promise<BackupManifest>((resolve) => (resolveCreate = resolve)),
    );

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Create Backup/ }));
    await waitFor(() => expect(progressCb).toBeDefined());
    act(() => {
      progressCb?.({ phase: "hashing", current: 3, total: 10, message: "data/master/materials.json" });
    });

    expect(await screen.findByText(/3\/10/)).toBeInTheDocument();
    resolveCreate(manifest());
    expect(await screen.findByText(/Backup created/)).toBeInTheDocument();
  });

  it("walks the restore flow: pick source, inspect, confirm, then restore", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.inspectBackup.mockResolvedValue(manifest({ warnings: ["example warning"] }));
    bridge.restoreBackup.mockResolvedValue({
      manifest: manifest(),
      safetyBackupPath: "C:\\AppData\\backups\\pre-restore-1.formulab-backup",
      restoredPaths: ["data/master/materials.json"],
      warnings: [],
    });

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Restore Backup/ }));

    expect(await screen.findByText(/This will replace your current data/)).toBeInTheDocument();
    expect(screen.getByText(/example warning/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Restore Now/ }));

    expect(await screen.findByText(/Restore complete/)).toBeInTheDocument();
    expect(screen.getByText(/1 files restored/)).toBeInTheDocument();
    expect(screen.getByText(/pre-restore-1\.formulab-backup/)).toBeInTheDocument();
  });

  it("lets the user cancel out of the restore confirmation without restoring", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.inspectBackup.mockResolvedValue(manifest());

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Restore Backup/ }));
    expect(await screen.findByText(/This will replace your current data/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /Create Backup/ })).toBeInTheDocument();
    expect(bridge.restoreBackup).not.toHaveBeenCalled();
  });

  it("shows a failure state when restore fails", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.inspectBackup.mockResolvedValue(manifest());
    bridge.restoreBackup.mockRejectedValue(new Error("corrupted package: bad hash"));

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Restore Backup/ }));
    await screen.findByText(/This will replace your current data/);
    await userEvent.click(screen.getByRole("button", { name: /Restore Now/ }));

    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.getByText(/corrupted package: bad hash/)).toBeInTheDocument();
  });

  it("shows a failure state when the package cannot be inspected", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\bad.formulab-backup");
    bridge.inspectBackup.mockRejectedValue(new Error("not a readable archive"));

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Restore Backup/ }));

    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.getByText(/not a readable archive/)).toBeInTheDocument();
  });

  function report(overrides: Partial<VerificationReport> = {}): VerificationReport {
    return {
      status: "valid",
      manifest: manifest(),
      errors: [],
      warnings: [],
      ...overrides,
    };
  }

  it("does nothing when the file picker is cancelled during verify", async () => {
    bridge.pickBackupSource.mockResolvedValue(null);
    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Verify Backup/ }));
    await waitFor(() => expect(bridge.pickBackupSource).toHaveBeenCalled());
    expect(bridge.verifyBackup).not.toHaveBeenCalled();
  });

  it("shows a Valid result with the manifest summary", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.verifyBackup.mockResolvedValue(report({ status: "valid" }));

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Verify Backup/ }));

    expect(await screen.findByText("Valid")).toBeInTheDocument();
    expect(screen.getByText("0.4.0")).toBeInTheDocument();
    expect(bridge.verifyBackup).toHaveBeenCalledWith("C:\\backups\\one.formulab-backup");
  });

  it("shows a Valid with warnings result and lists each warning", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.verifyBackup.mockResolvedValue(
      report({
        status: "validWithWarnings",
        warnings: [{ code: "unexpected_file", message: "archive contains an undeclared file" }],
      }),
    );

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Verify Backup/ }));

    expect(await screen.findByText("Valid, with warnings")).toBeInTheDocument();
    expect(screen.getByText(/undeclared file/)).toBeInTheDocument();
  });

  it("shows a Corrupted result with each error listed", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.verifyBackup.mockResolvedValue(
      report({
        status: "corrupted",
        errors: [{ code: "hash_mismatch", message: "data/master/materials.json failed a SHA256 check" }],
      }),
    );

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Verify Backup/ }));

    expect(await screen.findByText("Corrupted")).toBeInTheDocument();
    expect(screen.getByText(/failed a SHA256 check/)).toBeInTheDocument();
  });

  it("shows an Unsafe result distinctly from Incompatible", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.verifyBackup.mockResolvedValue(
      report({ status: "unsafe", errors: [{ code: "runs_db_present", message: "runs.db must never be included" }] }),
    );

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Verify Backup/ }));

    expect(await screen.findByText("Unsafe")).toBeInTheDocument();
    expect(screen.queryByText("Incompatible")).not.toBeInTheDocument();
  });

  it("shows an Incompatible result distinctly from Corrupted", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.verifyBackup.mockResolvedValue(
      report({
        status: "incompatible",
        errors: [{ code: "unsupported_backup_format_version", message: "backup format version 9.9 is not supported" }],
      }),
    );

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Verify Backup/ }));

    expect(await screen.findByText("Incompatible")).toBeInTheDocument();
    expect(screen.queryByText("Corrupted")).not.toBeInTheDocument();
  });

  it("returns to the action buttons after dismissing a verify result", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.verifyBackup.mockResolvedValue(report({ status: "valid" }));

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Verify Backup/ }));
    await screen.findByText("Valid");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByRole("button", { name: /Verify Backup/ })).toBeInTheDocument();
  });

  it("shows a failure state when verification itself cannot run", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.verifyBackup.mockRejectedValue(new Error("not running in the desktop app"));

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Verify Backup/ }));

    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.getByText(/not running in the desktop app/)).toBeInTheDocument();
  });

  it("never calls restore or create while verifying", async () => {
    bridge.pickBackupSource.mockResolvedValue("C:\\backups\\one.formulab-backup");
    bridge.verifyBackup.mockResolvedValue(report());

    render(<BackupRecoveryCard />);
    await userEvent.click(screen.getByRole("button", { name: /Verify Backup/ }));
    await screen.findByText("Valid");

    expect(bridge.restoreBackup).not.toHaveBeenCalled();
    expect(bridge.createBackup).not.toHaveBeenCalled();
  });
});
