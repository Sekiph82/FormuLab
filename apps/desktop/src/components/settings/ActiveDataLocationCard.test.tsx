import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DataMoveJournalEntry,
  DataMoveRecoveryResult,
  DataMoveResult,
  DataRootStatus,
  DestinationValidation,
} from "@/lib/tauri";
import { ActiveDataLocationCard } from "./ActiveDataLocationCard";

const bridge = {
  isTauri: true,
  activeDataRootStatus: vi.fn<() => Promise<DataRootStatus | null>>(),
  openActiveDataRoot: vi.fn<() => Promise<void>>(),
  pickFolder: vi.fn<() => Promise<string | null>>(),
  validateDataMoveDestination: vi.fn<(path: string) => Promise<DestinationValidation>>(),
  moveDataLocation: vi.fn<(destination: string) => Promise<DataMoveResult>>(),
  cancelDataMove: vi.fn<() => Promise<void>>(),
  activateExistingDataLocation: vi.fn<(path: string) => Promise<DataMoveResult>>(),
  restoreDefaultDataLocation: vi.fn<() => Promise<{ status: DataRootStatus; pointerRemoved: boolean }>>(),
  checkInterruptedDataMove: vi.fn<() => Promise<DataMoveJournalEntry | null>>(),
  resumeInterruptedDataMove: vi.fn<() => Promise<DataMoveRecoveryResult>>(),
  cleanupOldDataLocation: vi.fn<(oldRoot: string) => Promise<void>>(),
  watchDataMoveProgress: vi.fn(async (_cb: unknown) => () => {}),
};

vi.mock("@/lib/tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
  activeDataRootStatus: () => bridge.activeDataRootStatus(),
  openActiveDataRoot: () => bridge.openActiveDataRoot(),
  pickFolder: () => bridge.pickFolder(),
  validateDataMoveDestination: (path: string) => bridge.validateDataMoveDestination(path),
  moveDataLocation: (destination: string) => bridge.moveDataLocation(destination),
  cancelDataMove: () => bridge.cancelDataMove(),
  activateExistingDataLocation: (path: string) => bridge.activateExistingDataLocation(path),
  restoreDefaultDataLocation: () => bridge.restoreDefaultDataLocation(),
  checkInterruptedDataMove: () => bridge.checkInterruptedDataMove(),
  resumeInterruptedDataMove: () => bridge.resumeInterruptedDataMove(),
  cleanupOldDataLocation: (oldRoot: string) => bridge.cleanupOldDataLocation(oldRoot),
  watchDataMoveProgress: (cb: unknown) => bridge.watchDataMoveProgress(cb),
}));

function status(overrides: Partial<DataRootStatus> = {}): DataRootStatus {
  return {
    path: "C:\\Users\\test\\Documents\\FormuLab",
    source: "default",
    writable: true,
    warnings: [],
    conflictingRoots: [],
    ...overrides,
  };
}

function validation(overrides: Partial<DestinationValidation> = {}): DestinationValidation {
  return {
    path: "D:\\NewLocation",
    kind: "empty",
    writable: true,
    requiredBytes: 1000,
    availableBytes: 5_000_000,
    sufficientSpace: true,
    canMove: true,
    canUseExisting: false,
    warnings: [],
    blockers: [],
    ...overrides,
  };
}

function moveResult(overrides: Partial<DataMoveResult> = {}): DataMoveResult {
  return {
    runId: "move-1",
    sourceRoot: "C:\\Users\\test\\Documents\\FormuLab",
    destinationRoot: "D:\\NewLocation",
    filesMoved: 12,
    totalBytes: 45000,
    safetyBackupPath: "C:\\backups\\pre-move-1.formulab-backup",
    automaticBackup: { adjusted: false, note: "no automatic backup destination folder was configured" },
    warnings: [],
    ...overrides,
  };
}

beforeEach(() => {
  bridge.isTauri = true;
  for (const fn of Object.values(bridge)) {
    if (typeof fn === "function" && "mockReset" in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  bridge.activeDataRootStatus.mockResolvedValue(status());
  bridge.checkInterruptedDataMove.mockResolvedValue(null);
  bridge.watchDataMoveProgress.mockResolvedValue(() => {});
});

describe("ActiveDataLocationCard — read-only status (existing behavior preserved)", () => {
  it("shows the desktop-only fallback when not running in Tauri", async () => {
    bridge.isTauri = false;
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText(/available in the desktop app/i)).toBeInTheDocument();
  });

  it("shows the real resolved path and default source label", async () => {
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText("C:\\Users\\test\\Documents\\FormuLab")).toBeInTheDocument();
    expect(screen.getByText(/Default \(~\/Documents\/FormuLab\)/)).toBeInTheDocument();
  });

  it("opens the resolved folder without invoking any write/move command", async () => {
    render(<ActiveDataLocationCard />);
    await screen.findByText("C:\\Users\\test\\Documents\\FormuLab");
    await userEvent.click(screen.getByRole("button", { name: /Open Folder/ }));
    await waitFor(() => expect(bridge.openActiveDataRoot).toHaveBeenCalledTimes(1));
    expect(bridge.moveDataLocation).not.toHaveBeenCalled();
  });
});

describe("ActiveDataLocationCard — destination validation", () => {
  it("a valid empty destination offers Move Data after confirmation", async () => {
    bridge.pickFolder.mockResolvedValue("D:\\NewLocation");
    bridge.validateDataMoveDestination.mockResolvedValue(validation({ kind: "empty", canMove: true }));
    render(<ActiveDataLocationCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Change Location/ }));
    expect(await screen.findByText("Empty folder — ready to move your data here")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    expect(await screen.findByText(/Move your data to this location/)).toBeInTheDocument();
  });

  it("an existing compatible root offers Use Existing Location", async () => {
    bridge.pickFolder.mockResolvedValue("D:\\ExistingProject");
    bridge.validateDataMoveDestination.mockResolvedValue(
      validation({ kind: "existingCompatibleRoot", canMove: false, canUseExisting: true, warnings: ["already contains FormuLab data"] }),
    );
    render(<ActiveDataLocationCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Use Existing Location/ }));
    expect(await screen.findByText("Already a FormuLab data location")).toBeInTheDocument();
    expect(screen.getByText("already contains FormuLab data")).toBeInTheDocument();
  });

  it("a conflicting destination blocks both actions and shows the reason", async () => {
    bridge.pickFolder.mockResolvedValue("D:\\RandomFolder");
    bridge.validateDataMoveDestination.mockResolvedValue(
      validation({
        kind: "conflicting",
        canMove: false,
        canUseExisting: false,
        blockers: ["this folder contains other files but no recognizable FormuLab data"],
      }),
    );
    render(<ActiveDataLocationCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Change Location/ }));
    expect(await screen.findByText("Not usable — contains unrelated files")).toBeInTheDocument();
    expect(screen.getByText(/no recognizable FormuLab data/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Data" })).not.toBeInTheDocument();
  });

  it("insufficient space blocks the move and shows the blocker text", async () => {
    bridge.pickFolder.mockResolvedValue("D:\\TooSmall");
    bridge.validateDataMoveDestination.mockResolvedValue(
      validation({
        kind: "empty",
        canMove: false,
        sufficientSpace: false,
        availableBytes: 100,
        requiredBytes: 5_000_000,
        blockers: ["not enough free disk space at destination: 5500096 bytes required, 100 available"],
      }),
    );
    render(<ActiveDataLocationCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Change Location/ }));
    expect(await screen.findByText(/not enough free disk space/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Data" })).not.toBeInTheDocument();
  });

  it("an unwritable destination blocks both actions", async () => {
    bridge.pickFolder.mockResolvedValue("D:\\Locked");
    bridge.validateDataMoveDestination.mockResolvedValue(validation({ kind: "unwritable", canMove: false, canUseExisting: false }));
    render(<ActiveDataLocationCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Change Location/ }));
    expect(await screen.findByText("Not writable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Data" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Existing Location…" })).not.toBeInTheDocument();
  });

  it("a cancelled folder picker never calls validate", async () => {
    bridge.pickFolder.mockResolvedValue(null);
    render(<ActiveDataLocationCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Change Location/ }));
    await waitFor(() => expect(bridge.pickFolder).toHaveBeenCalledTimes(1));
    expect(bridge.validateDataMoveDestination).not.toHaveBeenCalled();
  });
});

describe("ActiveDataLocationCard — move data", () => {
  async function getToConfirmMove() {
    bridge.pickFolder.mockResolvedValue("D:\\NewLocation");
    bridge.validateDataMoveDestination.mockResolvedValue(validation({ kind: "empty", canMove: true }));
    render(<ActiveDataLocationCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Change Location/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Move Data" }));
    await screen.findByText(/Move your data to this location/);
  }

  it("a successful move shows the summary with files/size/safety backup", async () => {
    bridge.moveDataLocation.mockResolvedValue(moveResult());
    await getToConfirmMove();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    expect(await screen.findByText("Move complete")).toBeInTheDocument();
    expect(screen.getByText("D:\\NewLocation")).toBeInTheDocument();
    expect(screen.getByText("12 files, 44 KB")).toBeInTheDocument();
    expect(screen.getByText("C:\\backups\\pre-move-1.formulab-backup")).toBeInTheDocument();
  });

  it("offers old-location cleanup after a successful move, gated by explicit confirmation", async () => {
    bridge.moveDataLocation.mockResolvedValue(moveResult());
    bridge.cleanupOldDataLocation.mockResolvedValue(undefined);
    await getToConfirmMove();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    await screen.findByText("Move complete");
    await userEvent.click(screen.getByRole("button", { name: /Clean Up Old Location/ }));
    expect(await screen.findByText(/Delete the old location/)).toBeInTheDocument();
    expect(bridge.cleanupOldDataLocation).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete Old Location" }));
    await waitFor(() => expect(bridge.cleanupOldDataLocation).toHaveBeenCalledWith("C:\\Users\\test\\Documents\\FormuLab"));
  });

  it("shows the automatic-backup destination adjustment note when it was inside the old root", async () => {
    bridge.moveDataLocation.mockResolvedValue(
      moveResult({ automaticBackup: { adjusted: true, note: "automatic backup destination moved to D:\\NewLocation\\auto-backups" } }),
    );
    await getToConfirmMove();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    expect(await screen.findByText(/automatic backup destination moved to/)).toBeInTheDocument();
  });

  it("a safety-backup failure surfaces the exact error and the old root remains shown as active", async () => {
    bridge.moveDataLocation.mockRejectedValue(new Error("safety backup failed: not enough free disk space at destination: 900 bytes required, 100 available"));
    await getToConfirmMove();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    expect(await screen.findByText(/safety backup failed/)).toBeInTheDocument();
    // the top-level status still shows the ORIGINAL location — nothing switched
    expect(screen.getByText("C:\\Users\\test\\Documents\\FormuLab")).toBeInTheDocument();
  });

  it("a staged hash mismatch surfaces as a failure and never claims success", async () => {
    bridge.moveDataLocation.mockRejectedValue(
      new Error("staged copy of data/master/materials.json failed verification — move aborted, nothing activated"),
    );
    await getToConfirmMove();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    expect(await screen.findByText(/failed verification/)).toBeInTheDocument();
    expect(screen.queryByText("Move complete")).not.toBeInTheDocument();
  });

  it("an activation failure is reported with the source data confirmed untouched", async () => {
    bridge.moveDataLocation.mockRejectedValue(
      new Error("activation failed, rolled back: some error (source data untouched, safety backup: C:\\backups\\pre-move-1.formulab-backup)"),
    );
    await getToConfirmMove();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    expect(await screen.findByText(/source data untouched/)).toBeInTheDocument();
  });

  it("a cancelled move (message === 'cancelled') returns to idle quietly, with no failure panel", async () => {
    bridge.moveDataLocation.mockRejectedValue(new Error("cancelled"));
    await getToConfirmMove();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    expect(await screen.findByRole("button", { name: /Change Location/ })).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });
});

describe("ActiveDataLocationCard — use existing location", () => {
  it("a successful switch shows the summary without a files-moved row", async () => {
    bridge.pickFolder.mockResolvedValue("D:\\ExistingProject");
    bridge.validateDataMoveDestination.mockResolvedValue(
      validation({ path: "D:\\ExistingProject", kind: "existingCompatibleRoot", canMove: false, canUseExisting: true }),
    );
    bridge.activateExistingDataLocation.mockResolvedValue(moveResult({ filesMoved: 0, totalBytes: 0, destinationRoot: "D:\\ExistingProject" }));
    render(<ActiveDataLocationCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Use Existing Location/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Use Existing Location…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use Existing Location…" }));
    expect(await screen.findByText("Move complete")).toBeInTheDocument();
    expect(screen.queryByText("Files moved")).not.toBeInTheDocument();
    expect(bridge.activateExistingDataLocation).toHaveBeenCalledWith("D:\\ExistingProject");
  });
});

describe("ActiveDataLocationCard — restore default", () => {
  it("requires confirmation before restoring, then reports success", async () => {
    bridge.restoreDefaultDataLocation.mockResolvedValue({ status: status(), pointerRemoved: true });
    render(<ActiveDataLocationCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Restore Default/ }));
    expect(bridge.restoreDefaultDataLocation).not.toHaveBeenCalled();
    expect(await screen.findByText(/Restore the default location/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore Default" }));
    await waitFor(() => expect(bridge.restoreDefaultDataLocation).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Default location restored")).toBeInTheDocument();
  });
});

describe("ActiveDataLocationCard — interrupted move recovery", () => {
  it("shows a recovery banner and resumes on demand", async () => {
    bridge.checkInterruptedDataMove.mockResolvedValue({
      runId: "move-99",
      ts: 1000,
      step: "move_started",
      sourceRoot: "C:\\old",
      destinationRoot: "D:\\new",
      message: undefined,
    });
    bridge.resumeInterruptedDataMove.mockResolvedValue({
      runId: "move-99",
      action: "rolledBack",
      detail: "the move never got far enough to change anything — your data was never touched",
      destinationRoot: "D:\\new",
    });
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText("An earlier move did not finish")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => expect(bridge.resumeInterruptedDataMove).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("The interrupted move was rolled back")).toBeInTheDocument();
    expect(screen.queryByText("An earlier move did not finish")).not.toBeInTheDocument();
  });

  it("no banner appears when there is nothing interrupted", async () => {
    render(<ActiveDataLocationCard />);
    await screen.findByText("C:\\Users\\test\\Documents\\FormuLab");
    expect(screen.queryByText("An earlier move did not finish")).not.toBeInTheDocument();
  });
});
