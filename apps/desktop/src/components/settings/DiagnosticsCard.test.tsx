import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticsSummary } from "@/lib/diagnostics";
import { DiagnosticsCard } from "./DiagnosticsCard";

const bridge = {
  isTauri: true,
  getDiagnosticsSummary: vi.fn<() => Promise<DiagnosticsSummary>>(),
  pickSupportBundleDestination: vi.fn<(name: string) => Promise<string | null>>(),
  exportSupportBundle: vi.fn<(dest: string) => Promise<void>>(),
  openLogFolder: vi.fn<() => Promise<void>>(),
  copyText: vi.fn<(text: string) => Promise<void>>(),
};

vi.mock("@/lib/tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
}));

vi.mock("@/lib/diagnostics", () => ({
  getDiagnosticsSummary: () => bridge.getDiagnosticsSummary(),
  pickSupportBundleDestination: (...a: [string]) => bridge.pickSupportBundleDestination(...a),
  exportSupportBundle: (...a: [string]) => bridge.exportSupportBundle(...a),
  openLogFolder: () => bridge.openLogFolder(),
  defaultSupportBundleName: () => "formulab-support-bundle-test.json",
}));

vi.mock("@/lib/clipboard", () => ({
  copyText: (...a: [string]) => bridge.copyText(...a),
}));

function summary(overrides: Partial<DiagnosticsSummary> = {}): DiagnosticsSummary {
  return {
    appVersion: "0.4.0",
    buildId: null,
    os: "windows",
    arch: "x86_64",
    activeDataPath: "C:\\Users\\test\\Documents\\FormuLab",
    rootResolutionSource: "default",
    writable: true,
    freeDiskSpaceBytes: 10_000_000_000,
    rootWarnings: [],
    globalSchemaVersion: "1.0",
    schemaStatus: "current",
    lastMigration: null,
    lastBackup: null,
    storageHealth: { healthyCount: 90, unhealthy: [] },
    logDirectories: ["C:\\Users\\test\\AppData\\Roaming\\com.formulab.app"],
    recentErrors: [],
    pendingMigrationCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  bridge.isTauri = true;
  bridge.getDiagnosticsSummary.mockReset();
  bridge.pickSupportBundleDestination.mockReset();
  bridge.exportSupportBundle.mockReset();
  bridge.openLogFolder.mockReset();
  bridge.copyText.mockReset();
  bridge.getDiagnosticsSummary.mockResolvedValue(summary());
});

describe("DiagnosticsCard", () => {
  it("shows the desktop-only fallback when not running in Tauri", async () => {
    bridge.isTauri = false;
    render(<DiagnosticsCard />);
    expect(await screen.findByText(/available in the desktop app/i)).toBeInTheDocument();
  });

  it("shows a loading state before the summary resolves", async () => {
    let resolve!: (s: DiagnosticsSummary) => void;
    bridge.getDiagnosticsSummary.mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<DiagnosticsCard />);
    expect(screen.getByText(/Checking…/)).toBeInTheDocument();
    resolve(summary());
    await screen.findByText("0.4.0");
  });

  it("shows the real diagnostics fields once loaded", async () => {
    render(<DiagnosticsCard />);
    expect(await screen.findByText("0.4.0")).toBeInTheDocument();
    expect(screen.getByText("windows (x86_64)")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\test\\Documents\\FormuLab")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText(/9\.3 GB|10 GB/)).toBeInTheDocument();
  });

  it("shows a failure state when the summary check itself throws", async () => {
    bridge.getDiagnosticsSummary.mockRejectedValue(new Error("could not resolve a documents directory"));
    render(<DiagnosticsCard />);
    expect(await screen.findByText(/could not resolve a documents directory/)).toBeInTheDocument();
  });

  it("shows a not-writable value distinctly", async () => {
    bridge.getDiagnosticsSummary.mockResolvedValue(summary({ writable: false }));
    render(<DiagnosticsCard />);
    await screen.findByText("0.4.0");
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("shows storage-health failures with the unhealthy count", async () => {
    bridge.getDiagnosticsSummary.mockResolvedValue(
      summary({ storageHealth: { healthyCount: 88, unhealthy: [{ name: "suppliers", readable: false }] } }),
    );
    render(<DiagnosticsCard />);
    expect(await screen.findByText(/88 healthy, 1 unhealthy/)).toBeInTheDocument();
  });

  it("shows root warnings when present", async () => {
    bridge.getDiagnosticsSummary.mockResolvedValue(
      summary({ rootWarnings: ["base-workspace.txt is set but invalid (the pointer file is empty) — ignored, falling back"] }),
    );
    render(<DiagnosticsCard />);
    expect(await screen.findByText(/base-workspace\.txt is set but invalid/)).toBeInTheDocument();
  });

  it("shows current-session error lines when present", async () => {
    bridge.getDiagnosticsSummary.mockResolvedValue(
      summary({ recentErrors: [{ message: "sidecar connection failed", at: 1_700_000_000_000, currentSession: true }] }),
    );
    render(<DiagnosticsCard />);
    expect(await screen.findByText(/This session's log lines mentioning an error \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/sidecar connection failed/)).toBeInTheDocument();
  });

  it("shows historical error lines separately from current-session ones", async () => {
    bridge.getDiagnosticsSummary.mockResolvedValue(
      summary({ recentErrors: [{ message: "Timed out opening OpenCode event stream", at: 1_000, currentSession: false }] }),
    );
    render(<DiagnosticsCard />);
    expect(await screen.findByText(/Earlier log lines mentioning an error, from before this session \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Timed out opening OpenCode event stream/)).toBeInTheDocument();
  });

  it("shows the last backup and last migration when present", async () => {
    bridge.getDiagnosticsSummary.mockResolvedValue(
      summary({
        lastBackup: { filename: "pre-migration-1700000000.formulab-backup", kind: "preMigration", createdAt: 1_700_000_000 },
        lastMigration: { status: "completed", at: 1_700_000_000 },
        pendingMigrationCount: 2,
      }),
    );
    render(<DiagnosticsCard />);
    expect(await screen.findByText(/pre-migration safety backup/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 · 2 pending/)).toBeInTheDocument();
  });

  it("opens the log folder without invoking any write/restore command", async () => {
    render(<DiagnosticsCard />);
    await screen.findByText("0.4.0");
    await userEvent.click(screen.getByRole("button", { name: /Open Log Folder/ }));
    await waitFor(() => expect(bridge.openLogFolder).toHaveBeenCalledTimes(1));
    expect(bridge.exportSupportBundle).not.toHaveBeenCalled();
  });

  it("copies a plain-text summary to the clipboard", async () => {
    render(<DiagnosticsCard />);
    await screen.findByText("0.4.0");
    await userEvent.click(screen.getByRole("button", { name: /Copy Summary/ }));
    await waitFor(() => expect(bridge.copyText).toHaveBeenCalledTimes(1));
    const copied = bridge.copyText.mock.calls[0][0];
    expect(copied).toContain("FormuLab 0.4.0");
    expect(copied).toContain("Schema version: 1.0");
  });

  it("exports a support bundle after picking a destination", async () => {
    bridge.pickSupportBundleDestination.mockResolvedValue("C:\\bundles\\formulab-support-bundle-test.json");
    render(<DiagnosticsCard />);
    await screen.findByText("0.4.0");
    await userEvent.click(screen.getByRole("button", { name: /Export Support Bundle/ }));
    await waitFor(() =>
      expect(bridge.exportSupportBundle).toHaveBeenCalledWith("C:\\bundles\\formulab-support-bundle-test.json"),
    );
  });

  it("does nothing when the export destination picker is cancelled", async () => {
    bridge.pickSupportBundleDestination.mockResolvedValue(null);
    render(<DiagnosticsCard />);
    await screen.findByText("0.4.0");
    await userEvent.click(screen.getByRole("button", { name: /Export Support Bundle/ }));
    await waitFor(() => expect(bridge.pickSupportBundleDestination).toHaveBeenCalled());
    expect(bridge.exportSupportBundle).not.toHaveBeenCalled();
  });

  it("refreshes on demand and reflects a changed summary", async () => {
    render(<DiagnosticsCard />);
    await screen.findByText("0.4.0");
    bridge.getDiagnosticsSummary.mockResolvedValue(summary({ appVersion: "0.5.0" }));
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("0.5.0")).toBeInTheDocument();
    expect(bridge.getDiagnosticsSummary).toHaveBeenCalledTimes(2);
  });
});
