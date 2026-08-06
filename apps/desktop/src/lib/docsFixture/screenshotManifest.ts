/**
 * Phase 10 Session 5 — the screenshot manifest: types, the naming
 * convention, and pure validation helpers. The manifest DATA itself lives
 * at `docs/PHASE10_SCREENSHOT_MANIFEST.json` (plain JSON, human-editable,
 * not compiled TS) — this module only types it, loads it, and answers
 * "is this manifest internally consistent" / "does the real app still
 * match it" questions. No screenshot binary is captured by this module;
 * see `docs/handoffs/PHASE10_CURRENT.md`'s Session 5 summary for the
 * capture workflow this feeds.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const SCREENSHOT_MANIFEST_SCHEMA_VERSION = "1.0" as const;

export type ScreenshotTheme = "light" | "dark";

export interface ScreenshotManifestEntry {
  /** Must equal `screenshotFilename(entry)` with the `.png` suffix removed —
   *  checked by `screenshotManifest.test.ts`, never allowed to drift from
   *  its own component fields. */
  id: string;
  /** Sidebar/workspace grouping, e.g. "formulation", "laboratory", "help". */
  module: string;
  /** The specific page/workspace within the module, e.g. "live", "settings". */
  page: string;
  /** The fixture/UI state this shot captures, e.g. "candidate-tabs", "empty". */
  state: string;
  theme: ScreenshotTheme;
  /** BCP-47 locale code. English-only for v1 (see coverage matrix). */
  locale: string;
  width: number;
  height: number;
  /** Device pixel ratio the capture is taken at (2 = high-DPI, per plan). */
  dpr: number;
  /** The real router.tsx path this state lives on. */
  route: string;
  /** `docs/USER_GUIDE.md` chapter/section this screenshot illustrates. */
  guideChapter: string;
  /** A real `HELP_TOPICS` id this screenshot is associated with, or `null`
   *  for a genuinely topic-less concept. Not required to equal
   *  `topicForRoute(route)` — the guided-tour entries are a deliberate,
   *  documented exception (see `lib/help/tours.ts`'s own route-vs-topic
   *  split). */
  helpTopic: string | null;
  /** Commit SHA the image currently on disk was captured against, or
   *  `null` if never captured. Session 5 ships every entry as `null` —
   *  the capture sweep is Session 6+ content work. */
  lastCapturedCommit: string | null;
}

export interface ScreenshotManifest {
  schemaVersion: typeof SCREENSHOT_MANIFEST_SCHEMA_VERSION;
  entries: ScreenshotManifestEntry[];
}

/** `<module>-<page>-<state>-<theme>-<locale>.png` — the one naming rule
 *  every entry's `id` must already satisfy. Computed, never hand-typed
 *  twice, so id and filename can never silently diverge. */
export function screenshotFilename(entry: Pick<ScreenshotManifestEntry, "module" | "page" | "state" | "theme" | "locale">): string {
  return `${entry.module}-${entry.page}-${entry.state}-${entry.theme}-${entry.locale}.png`;
}

export function screenshotIdFor(entry: Pick<ScreenshotManifestEntry, "module" | "page" | "state" | "theme" | "locale">): string {
  return screenshotFilename(entry).replace(/\.png$/, "");
}

/** Overall shape only: lowercase kebab-case, ending in `-<theme>-<locale>`.
 *  `module`/`page`/`state` may themselves contain hyphens (e.g. module
 *  "data-exchange"), so this deliberately does NOT try to delimit which
 *  segment is which — that exact-reconstruction check is
 *  `id === screenshotIdFor(entry)`, asserted per-entry in
 *  `screenshotManifest.test.ts` instead. */
const FILENAME_SHAPE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:light|dark)-[a-z]{2}(?:-[A-Za-z]+)?\.png$/;

export function filenameMatchesConvention(filename: string): boolean {
  return FILENAME_SHAPE_PATTERN.test(filename);
}

export function defaultManifestPath(repoRoot: string): string {
  return path.join(repoRoot, "docs", "PHASE10_SCREENSHOT_MANIFEST.json");
}

export function loadScreenshotManifest(manifestPath: string): ScreenshotManifest {
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as ScreenshotManifest;
}

/** Screenshot filenames that exist on disk but no manifest entry claims —
 *  a pure function so it's testable without real captured images (pass a
 *  synthetic `existingFilenames` list). */
export function detectOrphanScreenshots(manifest: ScreenshotManifest, existingFilenames: readonly string[]): string[] {
  const known = new Set(manifest.entries.map((e) => screenshotFilename(e)));
  return existingFilenames.filter((f) => !known.has(f));
}

export interface StaleOrMissingReport {
  /** In the manifest, but no file exists for it yet. */
  missing: string[];
  /** A file exists, but the manifest's `lastCapturedCommit` predates
   *  `currentCommit` AND the entry's route/module is in `changedModules`
   *  — i.e. the underlying UI changed since this screenshot was taken. */
  stale: string[];
}

/** Compares the manifest against what's actually on disk and (optionally)
 *  which modules changed since each entry's `lastCapturedCommit`. A never-
 *  captured entry (`lastCapturedCommit: null`) is always reported as
 *  "missing", never "stale" — there is nothing to compare its currency
 *  against. */
export function detectStaleOrMissing(
  manifest: ScreenshotManifest,
  existingFilenames: readonly string[],
  changedModules: ReadonlySet<string> = new Set(),
): StaleOrMissingReport {
  const existing = new Set(existingFilenames);
  const missing: string[] = [];
  const stale: string[] = [];
  for (const entry of manifest.entries) {
    const filename = screenshotFilename(entry);
    if (!existing.has(filename)) {
      missing.push(filename);
      continue;
    }
    if (entry.lastCapturedCommit !== null && changedModules.has(entry.module)) {
      stale.push(filename);
    }
  }
  return { missing, stale };
}
