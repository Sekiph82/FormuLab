import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomaticBackupConfig, AutomaticBackupRunRecord, AutomaticBackupState } from "@/lib/tauri";

const bridge = {
  isTauri: true,
  readAutomaticBackupState: vi.fn<() => Promise<AutomaticBackupState>>(),
  writeAutomaticBackupConfig: vi.fn<(config: AutomaticBackupConfig) => Promise<AutomaticBackupState>>(),
  runAutomaticBackup: vi.fn<(cls: string) => Promise<AutomaticBackupRunRecord>>(),
  openAutomaticBackupDestination: vi.fn<(path: string) => Promise<void>>(),
  pickFolder: vi.fn<() => Promise<string | null>>(),
};

vi.mock("@/lib/tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
  readAutomaticBackupState: () => bridge.readAutomaticBackupState(),
  writeAutomaticBackupConfig: (config: AutomaticBackupConfig) => bridge.writeAutomaticBackupConfig(config),
  runAutomaticBackup: (cls: string) => bridge.runAutomaticBackup(cls),
  openAutomaticBackupDestination: (path: string) => bridge.openAutomaticBackupDestination(path),
  pickFolder: () => bridge.pickFolder(),
}));

vi.mock("@/lib/systemNotification", () => ({
  notifyAutomaticBackupFailure: vi.fn(async () => true),
}));

import { useAutomaticBackupStore, DEFAULT_AUTOMATIC_BACKUP_CONFIG } from "@/lib/automaticBackup";
import { AutomaticBackupCard } from "./AutomaticBackupCard";

function config(overrides: Partial<AutomaticBackupConfig> = {}): AutomaticBackupConfig {
  return { ...DEFAULT_AUTOMATIC_BACKUP_CONFIG, ...overrides };
}

function state(overrides: Partial<AutomaticBackupState> = {}): AutomaticBackupState {
  return { config: config(), ...overrides };
}

beforeEach(() => {
  bridge.isTauri = true;
  bridge.readAutomaticBackupState.mockReset();
  bridge.writeAutomaticBackupConfig.mockReset();
  bridge.runAutomaticBackup.mockReset();
  bridge.openAutomaticBackupDestination.mockReset();
  bridge.pickFolder.mockReset();
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

describe("AutomaticBackupCard", () => {
  it("shows the desktop-only fallback when not running in Tauri", async () => {
    bridge.isTauri = false;
    render(<AutomaticBackupCard />);
    expect(await screen.findByText(/available in the desktop app/i)).toBeInTheDocument();
  });

  it("disabled state: only the master toggle and pre-migration retention are shown", async () => {
    render(<AutomaticBackupCard />);
    await screen.findByText("Automatic Backups");
    expect(screen.queryByText("Destination folder")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily backup")).not.toBeInTheDocument();
    expect(screen.queryByText("Weekly backup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run Automatic Backup Now/ })).not.toBeInTheDocument();
    expect(screen.getByText("Pre-migration backups kept")).toBeInTheDocument();
  });

  it("enabled state: shows destination, schedule, on-exit, and status rows", async () => {
    bridge.readAutomaticBackupState.mockResolvedValue(state({ config: config({ enabled: true }) }));
    render(<AutomaticBackupCard />);
    expect(await screen.findByText("Destination folder")).toBeInTheDocument();
    expect(screen.getByText("Daily backup")).toBeInTheDocument();
    expect(screen.getByText("Weekly backup")).toBeInTheDocument();
    expect(screen.getByText("Back up on exit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run Automatic Backup Now/ })).toBeInTheDocument();
  });

  it("toggling the master switch on writes config and reveals the rest", async () => {
    bridge.writeAutomaticBackupConfig.mockResolvedValue(state({ config: config({ enabled: true }) }));
    render(<AutomaticBackupCard />);
    await screen.findByText("Automatic Backups");
    await userEvent.click(screen.getByRole("switch", { name: "Automatic backups" }));
    await waitFor(() => expect(bridge.writeAutomaticBackupConfig).toHaveBeenCalledWith(config({ enabled: true })));
    expect(await screen.findByText("Destination folder")).toBeInTheDocument();
  });

  it("choosing a destination folder writes it through", async () => {
    bridge.pickFolder.mockResolvedValue("D:\\backups");
    bridge.readAutomaticBackupState.mockResolvedValue(state({ config: config({ enabled: true }) }));
    bridge.writeAutomaticBackupConfig.mockResolvedValue(
      state({ config: config({ enabled: true, destinationFolder: "D:\\backups" }) }),
    );
    render(<AutomaticBackupCard />);
    await screen.findByText("Destination folder");
    await userEvent.click(screen.getByRole("button", { name: "Choose Folder…" }));
    await waitFor(() =>
      expect(bridge.writeAutomaticBackupConfig).toHaveBeenCalledWith(
        config({ enabled: true, destinationFolder: "D:\\backups" }),
      ),
    );
    expect(await screen.findByText("D:\\backups")).toBeInTheDocument();
  });

  it("a cancelled folder picker never writes config", async () => {
    bridge.pickFolder.mockResolvedValue(null);
    bridge.readAutomaticBackupState.mockResolvedValue(state({ config: config({ enabled: true }) }));
    render(<AutomaticBackupCard />);
    await screen.findByText("Destination folder");
    await userEvent.click(screen.getByRole("button", { name: "Choose Folder…" }));
    await waitFor(() => expect(bridge.pickFolder).toHaveBeenCalledTimes(1));
    expect(bridge.writeAutomaticBackupConfig).not.toHaveBeenCalled();
  });

  it("Run Automatic Backup Now is disabled without a destination folder configured", async () => {
    bridge.readAutomaticBackupState.mockResolvedValue(state({ config: config({ enabled: true, destinationFolder: null }) }));
    render(<AutomaticBackupCard />);
    const button = await screen.findByRole("button", { name: /Run Automatic Backup Now/ });
    expect(button).toBeDisabled();
  });

  it("Run Automatic Backup Now triggers a daily-classed run", async () => {
    bridge.readAutomaticBackupState.mockResolvedValue(
      state({ config: config({ enabled: true, destinationFolder: "D:\\backups" }) }),
    );
    bridge.runAutomaticBackup.mockResolvedValue({
      class: "daily",
      startedAt: 1_700_000_000,
      finishedAt: 1_700_000_010,
      status: "success",
      path: "D:\\backups\\formulab-auto-daily-1700000000.formulab-backup",
      verificationStatus: "valid",
    });
    render(<AutomaticBackupCard />);
    const button = await screen.findByRole("button", { name: /Run Automatic Backup Now/ });
    await userEvent.click(button);
    await waitFor(() => expect(bridge.runAutomaticBackup).toHaveBeenCalledWith("daily"));
  });

  it("shows the last successful and last failed backup with class labels", async () => {
    bridge.readAutomaticBackupState.mockResolvedValue(
      state({
        config: config({ enabled: true, destinationFolder: "D:\\backups" }),
        lastSuccess: {
          class: "weekly",
          startedAt: 1_700_000_000,
          finishedAt: 1_700_000_010,
          status: "success",
          path: "D:\\backups\\formulab-auto-weekly-1700000000.formulab-backup",
        },
        lastFailure: {
          class: "daily",
          startedAt: 1_700_000_100,
          finishedAt: 1_700_000_110,
          status: "failed",
          error: "destination folder does not exist: D:\\gone",
        },
      }),
    );
    render(<AutomaticBackupCard />);
    expect(await screen.findByText(/Weekly — /)).toBeInTheDocument();
    expect(screen.getByText(/Daily — /)).toBeInTheDocument();
    expect(screen.getByText(/destination folder does not exist/)).toBeInTheDocument();
  });

  it("adjusting the daily retention input writes the new count through", async () => {
    bridge.readAutomaticBackupState.mockResolvedValue(state({ config: config({ enabled: true }) }));
    bridge.writeAutomaticBackupConfig.mockResolvedValue(state({ config: config({ enabled: true, retentionDaily: 10 }) }));
    render(<AutomaticBackupCard />);
    const dailyInput = await screen.findByLabelText("Daily backups to keep");
    fireEvent.change(dailyInput, { target: { value: "10" } });
    await waitFor(() =>
      expect(bridge.writeAutomaticBackupConfig).toHaveBeenCalledWith(config({ enabled: true, retentionDaily: 10 })),
    );
  });

  it("opens the destination folder without invoking a write/restore command", async () => {
    bridge.readAutomaticBackupState.mockResolvedValue(
      state({ config: config({ enabled: true, destinationFolder: "D:\\backups" }) }),
    );
    render(<AutomaticBackupCard />);
    await screen.findByText("D:\\backups");
    await userEvent.click(screen.getByTitle("Open destination folder"));
    await waitFor(() => expect(bridge.openAutomaticBackupDestination).toHaveBeenCalledWith("D:\\backups"));
  });

  it("always shows the honest while-open-only limitation note", async () => {
    render(<AutomaticBackupCard />);
    expect(await screen.findByText(/only run while FormuLab is open/)).toBeInTheDocument();
  });
});
