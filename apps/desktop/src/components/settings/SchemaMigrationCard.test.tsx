import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DryRunResult,
  InterruptedMigration,
  MigrationPlan,
  MigrationRunStatus,
  SchemaCompatibility,
} from "@/lib/migrationRunner";
import { SchemaMigrationCard } from "./SchemaMigrationCard";

const bridge = {
  isTauri: true,
  checkForInterruptedMigration: vi.fn<() => Promise<InterruptedMigration | null>>(),
  checkSchemaCompatibility: vi.fn<() => Promise<SchemaCompatibility>>(),
  computeMigrationPlan: vi.fn<() => Promise<MigrationPlan>>(),
  dryRunMigration: vi.fn<() => Promise<DryRunResult>>(),
  runMigration: vi.fn<() => Promise<MigrationRunStatus>>(),
  recoverInterruptedMigration: vi.fn<(runId: string, backupPath: string) => Promise<void>>(),
};

vi.mock("@/lib/tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
}));

vi.mock("@/lib/migrationRunner", () => ({
  checkForInterruptedMigration: () => bridge.checkForInterruptedMigration(),
  checkSchemaCompatibility: () => bridge.checkSchemaCompatibility(),
  computeMigrationPlan: () => bridge.computeMigrationPlan(),
  dryRunMigration: () => bridge.dryRunMigration(),
  runMigration: () => bridge.runMigration(),
  recoverInterruptedMigration: (...a: [string, string]) => bridge.recoverInterruptedMigration(...a),
}));

function compat(overrides: Partial<SchemaCompatibility> = {}): SchemaCompatibility {
  return { currentVersion: "1.0", supportedVersion: "1.0", status: "current", ...overrides };
}

beforeEach(() => {
  bridge.isTauri = true;
  Object.values(bridge).forEach((f) => {
    if (typeof f === "function" && "mockReset" in f) (f as { mockReset: () => void }).mockReset();
  });
  bridge.checkForInterruptedMigration.mockResolvedValue(null);
  bridge.checkSchemaCompatibility.mockResolvedValue(compat());
  bridge.computeMigrationPlan.mockResolvedValue({ steps: [] });
});

describe("SchemaMigrationCard", () => {
  it("shows the desktop-only fallback when not running in Tauri", async () => {
    bridge.isTauri = false;
    render(<SchemaMigrationCard />);
    expect(await screen.findByText(/available in the desktop app/i)).toBeInTheDocument();
  });

  it("shows the current version and zero pending migrations when up to date", async () => {
    render(<SchemaMigrationCard />);
    expect(await screen.findByText("1.0")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    const runButton = screen.getByRole("button", { name: /Run Migration/ });
    expect(runButton).toBeDisabled();
  });

  it("enables Run Migration when a plan is pending", async () => {
    bridge.computeMigrationPlan.mockResolvedValue({
      steps: [{ collection: "widgets", currentVersion: "1.0", targetVersion: "1.1", stepIds: ["widgets-1.0-to-1.1"] }],
    });
    render(<SchemaMigrationCard />);
    await screen.findByText("1"); // pending count
    expect(screen.getByRole("button", { name: /Run Migration/ })).not.toBeDisabled();
  });

  it("shows a rejected state for an unsupported future schema version", async () => {
    bridge.checkSchemaCompatibility.mockResolvedValue(
      compat({ currentVersion: "9.9", status: "futureUnsupported" }),
    );
    render(<SchemaMigrationCard />);
    expect(await screen.findByText(/Data schema version not supported/)).toBeInTheDocument();
    expect(screen.getByText(/Your data is at schema version 9\.9/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run Migration/ })).not.toBeInTheDocument();
  });

  it("runs a dry run and shows rows that would change", async () => {
    bridge.computeMigrationPlan.mockResolvedValue({
      steps: [{ collection: "widgets", currentVersion: "1.0", targetVersion: "1.1", stepIds: ["widgets-1.0-to-1.1"] }],
    });
    bridge.dryRunMigration.mockResolvedValue({
      currentGlobalVersion: "1.0",
      supportedVersion: "1.0",
      collections: [
        {
          collection: "widgets",
          currentVersion: "1.0",
          targetVersion: "1.1",
          stepIds: ["widgets-1.0-to-1.1"],
          rowsInspected: 3,
          rowsThatWouldChange: 2,
        },
      ],
    });
    render(<SchemaMigrationCard />);
    await waitFor(() => expect(bridge.computeMigrationPlan).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: /Dry Run/ }));

    expect(await screen.findByText(/Dry run complete/)).toBeInTheDocument();
    expect(screen.getByText(/widgets/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 rows would change/)).toBeInTheDocument();
  });

  it("shows a dry-run failure state", async () => {
    bridge.dryRunMigration.mockRejectedValue(new Error("could not read collection"));
    render(<SchemaMigrationCard />);
    await waitFor(() => expect(bridge.computeMigrationPlan).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: /Dry Run/ }));
    expect(await screen.findByText(/Migration failed/)).toBeInTheDocument();
    expect(screen.getByText(/could not read collection/)).toBeInTheDocument();
  });

  it("runs a real migration and shows the completed summary", async () => {
    bridge.computeMigrationPlan.mockResolvedValue({
      steps: [{ collection: "widgets", currentVersion: "1.0", targetVersion: "1.1", stepIds: ["widgets-1.0-to-1.1"] }],
    });
    bridge.runMigration.mockResolvedValue({
      kind: "completed",
      runId: "run-1",
      migratedCollections: ["widgets"],
      newVersion: "1.1",
    });
    render(<SchemaMigrationCard />);
    await waitFor(() => expect(bridge.computeMigrationPlan).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: /Run Migration/ }));

    expect(await screen.findByText(/Migration complete/)).toBeInTheDocument();
    expect(screen.getByText(/1 collection\(s\) migrated to schema version 1\.1/)).toBeInTheDocument();
  });

  it("shows a failed-and-rolled-back state when a run fails", async () => {
    bridge.computeMigrationPlan.mockResolvedValue({
      steps: [{ collection: "widgets", currentVersion: "1.0", targetVersion: "1.1", stepIds: ["widgets-1.0-to-1.1"] }],
    });
    bridge.runMigration.mockResolvedValue({
      kind: "failed",
      runId: "run-1",
      message: "failed its own post-migration validation",
      backupPath: "C:\\backups\\pre-migration-1.formulab-backup",
      rolledBack: true,
    });
    render(<SchemaMigrationCard />);
    await waitFor(() => expect(bridge.computeMigrationPlan).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: /Run Migration/ }));

    expect(await screen.findByText(/Migration failed/)).toBeInTheDocument();
    expect(screen.getByText(/failed its own post-migration validation/)).toBeInTheDocument();
    expect(screen.getByText(/restored from the pre-migration backup/)).toBeInTheDocument();
  });

  it("shows the rollback-did-not-complete message when rolledBack is false", async () => {
    bridge.computeMigrationPlan.mockResolvedValue({
      steps: [{ collection: "widgets", currentVersion: "1.0", targetVersion: "1.1", stepIds: ["widgets-1.0-to-1.1"] }],
    });
    bridge.runMigration.mockResolvedValue({
      kind: "failed",
      runId: "run-1",
      message: "disk full",
      backupPath: "C:\\backups\\pre-migration-1.formulab-backup",
      rolledBack: false,
    });
    render(<SchemaMigrationCard />);
    await waitFor(() => expect(bridge.computeMigrationPlan).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: /Run Migration/ }));

    expect(await screen.findByText(/Rollback could not complete automatically/)).toBeInTheDocument();
  });

  it("shows the interrupted-migration banner and recovers on click", async () => {
    bridge.checkForInterruptedMigration.mockResolvedValue({
      runId: "run-1",
      backupPath: "C:\\backups\\pre-migration-1.formulab-backup",
    });
    render(<SchemaMigrationCard />);
    expect(await screen.findByText(/An earlier migration did not finish/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Restore Pre-Migration Backup/ }));
    await waitFor(() =>
      expect(bridge.recoverInterruptedMigration).toHaveBeenCalledWith(
        "run-1",
        "C:\\backups\\pre-migration-1.formulab-backup",
      ),
    );
  });

  it("does not show the interrupted banner when none is found", async () => {
    render(<SchemaMigrationCard />);
    await waitFor(() => expect(bridge.checkForInterruptedMigration).toHaveBeenCalled());
    expect(screen.queryByText(/An earlier migration did not finish/)).not.toBeInTheDocument();
  });
});
