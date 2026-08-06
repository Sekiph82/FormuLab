/**
 * Phase 11 Session 5 — basic diagnostics and sanitized log export.
 *
 * The Rust side (`diagnostics_summary`) owns everything except "is a
 * migration pending" — that requires the migration registry, which only
 * exists in TypeScript (`migrationRunner.ts`, reused here rather than
 * duplicated). `getDiagnosticsSummary()` merges the two.
 */
import { isTauri } from "./tauri";
import { computeMigrationPlan } from "./migrationRunner";

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new Error("not-desktop");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export interface CollectionHealth {
  name: string;
  readable: boolean;
}

export interface StorageHealth {
  healthyCount: number;
  unhealthy: CollectionHealth[];
}

export type BackupKind = "preMigration" | "preRestore" | "automaticDaily" | "automaticWeekly";

export interface LastBackupInfo {
  filename: string;
  kind: BackupKind;
  createdAt: number;
}

/** A `debug.log` line matching the "error"/"fail" heuristic. `currentSession`
 *  is `false` for a line that was already in the log when this app instance
 *  started — e.g. a leftover line from a since-removed feature, or simply an
 *  earlier run — so the UI can stop presenting old log residue as a live,
 *  present-tense problem. */
export interface LogErrorLine {
  message: string;
  /** Epoch milliseconds; `0` if the line had no parseable leading timestamp. */
  at: number;
  currentSession: boolean;
}

export type MigrationRunStatusLabel = "completed" | "failed" | "rejectedFutureVersion";

export interface LastMigrationInfo {
  status: MigrationRunStatusLabel;
  at: number;
}

interface DiagnosticsSummaryBase {
  appVersion: string;
  buildId: string | null;
  os: string;
  arch: string;
  activeDataPath: string;
  rootResolutionSource: string;
  writable: boolean;
  freeDiskSpaceBytes: number | null;
  rootWarnings: string[];
  globalSchemaVersion: string;
  schemaStatus: string;
  lastMigration: LastMigrationInfo | null;
  lastBackup: LastBackupInfo | null;
  storageHealth: StorageHealth;
  logDirectories: string[];
  recentErrors: LogErrorLine[];
}

export interface DiagnosticsSummary extends DiagnosticsSummaryBase {
  pendingMigrationCount: number;
}

export async function getDiagnosticsSummary(): Promise<DiagnosticsSummary> {
  const [base, plan] = await Promise.all([
    call<DiagnosticsSummaryBase>("diagnostics_summary"),
    computeMigrationPlan().catch(() => ({ steps: [] })),
  ]);
  return { ...base, pendingMigrationCount: plan.steps.length };
}

/** Native "Save As" dialog for a `.json` support bundle (desktop only). */
export async function pickSupportBundleDestination(defaultName: string): Promise<string | null> {
  if (!isTauri) return null;
  return call<string | null>("pick_support_bundle_destination", { defaultName });
}

/** Writes the sanitized support bundle to `destination`. Never includes
 *  backup contents, localStorage, or any formula/master-data row — only
 *  counts, health, and redacted bounded log lines. */
export async function exportSupportBundle(destination: string): Promise<void> {
  await call("export_support_bundle", { destination });
}

/** Reveals the folder holding `debug.log` (and its rotated siblings). */
export async function openLogFolder(): Promise<void> {
  if (!isTauri) return;
  await call("open_log_folder");
}

export function defaultSupportBundleName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `formulab-support-bundle-${stamp}.json`;
}
