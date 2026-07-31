/**
 * Phase 10 Session 5 — manifest validity, coverage, and drift-detection
 * tests. Cross-checks against the REAL `HELP_TOPICS` registry and the
 * real `router.tsx` route table via `topicForRoute` — never a hand-copied
 * second list that could silently drift from either.
 */
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { getTopic, topicForRoute } from "@/lib/help/registry";
import {
  defaultManifestPath,
  detectOrphanScreenshots,
  detectStaleOrMissing,
  filenameMatchesConvention,
  loadScreenshotManifest,
  screenshotFilename,
  screenshotIdFor,
  type ScreenshotManifest,
} from "./screenshotManifest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const manifest: ScreenshotManifest = loadScreenshotManifest(defaultManifestPath(REPO_ROOT));

describe("screenshot manifest — structural validity", () => {
  it("loads and has at least one entry", () => {
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.entries.length).toBeGreaterThan(0);
  });

  it("every id is unique", () => {
    const ids = manifest.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every id exactly reconstructs from its own module/page/state/theme/locale fields", () => {
    for (const entry of manifest.entries) {
      expect(entry.id).toBe(screenshotIdFor(entry));
    }
  });

  it("every filename follows the <module>-<page>-<state>-<theme>-<locale>.png convention", () => {
    for (const entry of manifest.entries) {
      expect(filenameMatchesConvention(screenshotFilename(entry))).toBe(true);
    }
  });

  it("dimensions, theme, and locale are all valid for v1 (light theme, English)", () => {
    for (const entry of manifest.entries) {
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
      expect(entry.dpr).toBeGreaterThanOrEqual(1);
      expect(["light", "dark"]).toContain(entry.theme);
      expect(entry.theme).toBe("light"); // v1 scope: light-theme primary
      expect(entry.locale).toBe("en"); // v1 scope: English only
    }
  });

  it("every entry's route starts with a leading slash", () => {
    for (const entry of manifest.entries) {
      expect(entry.route.startsWith("/")).toBe(true);
    }
  });
});

describe("screenshot manifest — cross-checked against the real app", () => {
  it("every route resolves to a real help topic via topicForRoute", () => {
    for (const entry of manifest.entries) {
      expect(topicForRoute(entry.route), `route ${entry.route} (entry ${entry.id}) did not resolve`).toBeDefined();
    }
  });

  it("every non-null helpTopic is a real HELP_TOPICS id", () => {
    for (const entry of manifest.entries) {
      if (entry.helpTopic === null) continue;
      expect(getTopic(entry.helpTopic), `helpTopic ${entry.helpTopic} (entry ${entry.id}) is not a real topic`).toBeDefined();
    }
  });
});

describe("screenshot manifest — required coverage", () => {
  const ids = new Set(manifest.entries.map((e) => e.id));
  const hasEntryLike = (predicate: (id: string) => boolean) => manifest.entries.some((e) => predicate(e.id));

  it("covers every module the session objective listed", () => {
    // Home, Projects, Formulation generation, V1/V2/V3 tabs, Edit formula,
    // function totals + active-matter warning, Laboratory test methods,
    // Stability, Regulatory, Dossiers, Claims & Labels, Approval, Reports,
    // Data Exchange, Administration, Notebooks, Files, Runs, Sessions,
    // Settings, Help panel, Help Center, InfoTooltip, disabled-action
    // explanation, guided tour, onboarding.
    expect(ids.has("home-home-default-light-en")).toBe(true);
    expect(ids.has("projects-projects-default-light-en")).toBe(true);
    expect(ids.has("formulation-live-generation-light-en")).toBe(true);
    expect(ids.has("formulation-live-candidate-tabs-light-en")).toBe(true);
    expect(ids.has("formulation-live-edit-formula-light-en")).toBe(true);
    expect(ids.has("formulation-live-function-totals-warning-light-en")).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("laboratory-") && id.includes("test-methods"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("stability-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("regulatory-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("dossiers-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("claims-labels-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("approval-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("reports-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("data-exchange-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("administration-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("tools-notebooks"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("tools-files"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("tools-runs"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("sessions-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("settings-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("help-panel-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("help-center-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("help-tooltip-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("help-disabled-action-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("help-guided-tour-"))).toBe(true);
    expect(hasEntryLike((id) => id.startsWith("help-onboarding-"))).toBe(true);
  });

  it("has no entry pointing outside its declared v1 scope (no unexpected locale/theme sneaking in)", () => {
    for (const entry of manifest.entries) {
      expect(entry.locale).toBe("en");
    }
  });
});

describe("screenshot manifest — no forbidden real-data path", () => {
  const serialized = JSON.stringify(manifest).toLowerCase();

  it("never references the real dev machine's username or app-data path", () => {
    for (const forbidden of ["sekip", "c:\\users", "c:/users", "appdata", "com.formulab.app"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("detectStaleOrMissing / detectOrphanScreenshots — pure, synthetic-filesystem checks", () => {
  const tiny: ScreenshotManifest = {
    schemaVersion: "1.0",
    entries: [
      { id: "a-a-a-light-en", module: "a", page: "a", state: "a", theme: "light", locale: "en", width: 100, height: 100, dpr: 1, route: "/a", guideChapter: "x", helpTopic: null, lastCapturedCommit: "abc123" },
      { id: "b-b-b-light-en", module: "b", page: "b", state: "b", theme: "light", locale: "en", width: 100, height: 100, dpr: 1, route: "/b", guideChapter: "x", helpTopic: null, lastCapturedCommit: null },
    ],
  };

  it("reports an entry with no file on disk as missing", () => {
    const report = detectStaleOrMissing(tiny, []);
    expect(report.missing).toContain("a-a-a-light-en.png");
    expect(report.missing).toContain("b-b-b-light-en.png");
  });

  it("does not report a captured, unchanged entry as stale", () => {
    const report = detectStaleOrMissing(tiny, ["a-a-a-light-en.png", "b-b-b-light-en.png"]);
    expect(report.missing).toEqual([]);
    expect(report.stale).toEqual([]);
  });

  it("reports a captured entry as stale when its module changed since capture", () => {
    const report = detectStaleOrMissing(tiny, ["a-a-a-light-en.png", "b-b-b-light-en.png"], new Set(["a"]));
    expect(report.stale).toEqual(["a-a-a-light-en.png"]);
  });

  it("never marks a never-captured (lastCapturedCommit: null) entry as stale, even if its module changed", () => {
    const report = detectStaleOrMissing(tiny, ["a-a-a-light-en.png", "b-b-b-light-en.png"], new Set(["b"]));
    expect(report.stale).toEqual([]);
    expect(report.missing).toEqual([]);
  });

  it("detects a file on disk that no manifest entry claims", () => {
    const orphans = detectOrphanScreenshots(tiny, ["a-a-a-light-en.png", "b-b-b-light-en.png", "mystery-file-light-en.png"]);
    expect(orphans).toEqual(["mystery-file-light-en.png"]);
  });

  it("reports no orphans when every file on disk is claimed", () => {
    expect(detectOrphanScreenshots(tiny, ["a-a-a-light-en.png"])).toEqual([]);
  });
});
