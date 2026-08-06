/**
 * Phase 10 Session 6 — content-quality tests against the REAL
 * `docs/USER_GUIDE.md` file (not a synthetic fixture): required chapters
 * exist, and every known-stale claim this session fixed stays fixed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { findMissingRequiredTopics, findStaleClaims, REQUIRED_GUIDE_TOPICS, STALE_CLAIM_CHECKS } from "./guideContent";

const GUIDE_PATH = path.resolve(__dirname, "../../../../../docs/USER_GUIDE.md");

function readGuide(): string {
  return fs.readFileSync(GUIDE_PATH, "utf8");
}

describe("docs/USER_GUIDE.md — guide source exists", () => {
  it("is a real, non-empty file", () => {
    expect(fs.existsSync(GUIDE_PATH)).toBe(true);
    const md = readGuide();
    expect(md.length).toBeGreaterThan(1000);
  });
});

describe("docs/USER_GUIDE.md — required chapters exist", () => {
  it("has at least one heading covering every topic the session objective listed", () => {
    expect(findMissingRequiredTopics(readGuide())).toEqual([]);
  });

  it("REQUIRED_GUIDE_TOPICS is non-trivial (guards against an accidentally emptied list)", () => {
    expect(REQUIRED_GUIDE_TOPICS.length).toBeGreaterThanOrEqual(20);
  });
});

describe("docs/USER_GUIDE.md — stale claims absent", () => {
  it("contains none of the known-stale patterns this session fixed", () => {
    expect(findStaleClaims(readGuide())).toEqual([]);
  });

  it("STALE_CLAIM_CHECKS is non-trivial (guards against an accidentally emptied list)", () => {
    expect(STALE_CLAIM_CHECKS.length).toBeGreaterThanOrEqual(5);
  });
});

describe("docs/USER_GUIDE.md — no real profile paths or private data", () => {
  const md = readGuide().toLowerCase();

  it("never references the real dev machine's username or app-data path", () => {
    for (const forbidden of ["sekip", "c:\\users", "c:/users", "appdata", "com.formulab.app"]) {
      expect(md).not.toContain(forbidden);
    }
  });

  it("never contains an email address", () => {
    expect(md).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
