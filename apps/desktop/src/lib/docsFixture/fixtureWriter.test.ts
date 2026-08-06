/**
 * Phase 10 Session 5 — safety-guard and idempotency coverage for the
 * fixture writer. Uses real `fs` against a throwaway directory under the OS
 * temp folder (never the repo, never a real profile path) so these tests
 * exercise the actual guard logic, not a mock of it.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSafeFixtureRoot,
  DOCS_FIXTURE_MARKER_FILENAME,
  resetDocsFixture,
  seedDocsFixture,
  UnsafeFixtureRootError,
} from "./fixtureWriter";

let testRoot: string;

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "formulab-docs-fixture-test-"));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("assertSafeFixtureRoot — the real-profile guard", () => {
  it("accepts an absolute path whose folder name contains 'docs-fixture'", () => {
    expect(() => assertSafeFixtureRoot(path.join(testRoot, "sub-docs-fixture"))).not.toThrow();
  });

  it("rejects a relative path", () => {
    expect(() => assertSafeFixtureRoot("relative/docs-fixture")).toThrow(UnsafeFixtureRootError);
  });

  it("rejects a path that looks like the real Tauri app-data directory", () => {
    expect(() => assertSafeFixtureRoot("C:\\Users\\someone\\AppData\\Roaming\\com.formulab.app\\docs-fixture")).toThrow(
      UnsafeFixtureRootError,
    );
  });

  it("rejects a path that looks like the real default workspace (Documents/FormuLab)", () => {
    expect(() => assertSafeFixtureRoot("C:\\Users\\someone\\Documents\\FormuLab\\docs-fixture")).toThrow(UnsafeFixtureRootError);
  });

  it("rejects a folder whose own name does not say docs-fixture, even under a safe parent", () => {
    expect(() => assertSafeFixtureRoot(path.join(testRoot, "not-labeled"))).toThrow(UnsafeFixtureRootError);
  });
});

describe("seedDocsFixture — fail-closed on an unknown non-empty directory", () => {
  it("refuses to seed into an existing non-empty directory with no marker file", () => {
    const root = path.join(testRoot, "docs-fixture");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "someone-elses-file.txt"), "not ours");
    expect(() => seedDocsFixture(root)).toThrow(UnsafeFixtureRootError);
  });

  it("seeds happily into a fresh (non-existent) directory", () => {
    const root = path.join(testRoot, "docs-fixture");
    expect(() => seedDocsFixture(root)).not.toThrow();
    expect(fs.existsSync(path.join(root, DOCS_FIXTURE_MARKER_FILENAME))).toBe(true);
    expect(fs.existsSync(path.join(root, "formulas", "index.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "data", "master", "materials.json"))).toBe(true);
  });

  it("re-seeding an already-seeded (marker-present) directory is allowed", () => {
    const root = path.join(testRoot, "docs-fixture");
    seedDocsFixture(root);
    expect(() => seedDocsFixture(root)).not.toThrow();
  });
});

describe("resetDocsFixture — idempotent reset, never adopts an arbitrary folder", () => {
  it("refuses to reset a directory that was never seeded", () => {
    const root = path.join(testRoot, "docs-fixture");
    expect(() => resetDocsFixture(root)).toThrow(UnsafeFixtureRootError);
  });

  it("reset after a manual mutation restores the canonical, deterministic content", () => {
    const root = path.join(testRoot, "docs-fixture");
    seedDocsFixture(root);
    const materialsPath = path.join(root, "data", "master", "materials.json");
    const canonical = fs.readFileSync(materialsPath, "utf8");
    fs.writeFileSync(materialsPath, "[]");
    expect(fs.readFileSync(materialsPath, "utf8")).not.toBe(canonical);

    resetDocsFixture(root);
    expect(fs.readFileSync(materialsPath, "utf8")).toBe(canonical);
  });

  it("resetting twice in a row is idempotent (byte-identical file set both times)", () => {
    const root = path.join(testRoot, "docs-fixture");
    seedDocsFixture(root);
    resetDocsFixture(root);
    const snapshotAfterFirstReset = fs.readFileSync(path.join(root, "data", "master", "doe_studies.json"), "utf8");
    resetDocsFixture(root);
    const snapshotAfterSecondReset = fs.readFileSync(path.join(root, "data", "master", "doe_studies.json"), "utf8");
    expect(snapshotAfterSecondReset).toBe(snapshotAfterFirstReset);
  });

  it("never leaves a stray file from before the reset (full wipe, not a merge)", () => {
    const root = path.join(testRoot, "docs-fixture");
    seedDocsFixture(root);
    fs.writeFileSync(path.join(root, "should-not-survive.json"), "[]");
    resetDocsFixture(root);
    expect(fs.existsSync(path.join(root, "should-not-survive.json"))).toBe(false);
  });
});

describe("seedDocsFixture — never touches anything outside its own root", () => {
  it("does not create or modify any file outside the target root", () => {
    const root = path.join(testRoot, "docs-fixture");
    const sentinelDir = path.join(testRoot, "sentinel");
    fs.mkdirSync(sentinelDir);
    fs.writeFileSync(path.join(sentinelDir, "untouched.txt"), "original");
    seedDocsFixture(root);
    expect(fs.readFileSync(path.join(sentinelDir, "untouched.txt"), "utf8")).toBe("original");
    expect(fs.readdirSync(sentinelDir)).toEqual(["untouched.txt"]);
  });
});
