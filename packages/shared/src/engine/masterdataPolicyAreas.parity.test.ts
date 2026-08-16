/**
 * Phase 13 Session 4A — Rust/TypeScript masterdata-policy-area parity.
 *
 * `masterdata.rs`'s `area_for_collection()` (Rust) has no hand-typed
 * mapping of its own — it reads `masterdataCollectionAreas.generated.json`
 * via `include_str!`. This test is the TypeScript-side half of the parity
 * mechanism, identical in shape to `rolePolicy.matrixParity.test.ts`: the
 * checked-in fixture must equal a fresh read of
 * `MASTERDATA_COLLECTION_POLICY_AREAS` right now.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POLICY_AREAS } from "./rolePolicy";
import {
  MASTERDATA_COLLECTIONS,
  MASTERDATA_COLLECTION_POLICY_AREAS,
  isKnownPolicyArea,
} from "./masterdataPolicyAreas";

const FIXTURE_PATH = fileURLToPath(new URL("./masterdataCollectionAreas.generated.json", import.meta.url));

interface MasterdataAreasFixture {
  collections: string[];
  areas: Record<string, string>;
}

function loadFixture(): MasterdataAreasFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as MasterdataAreasFixture;
}

describe("masterdataPolicyAreas — Rust/TypeScript parity", () => {
  it("the fixture's collection list matches MASTERDATA_COLLECTIONS exactly, including order", () => {
    const fixture = loadFixture();
    expect(fixture.collections).toEqual([...MASTERDATA_COLLECTIONS]);
  });

  it("has exactly 90 collections", () => {
    expect(MASTERDATA_COLLECTIONS.length).toBe(90);
  });

  it("the fixture's area map is exactly MASTERDATA_COLLECTION_POLICY_AREAS right now (fails on drift)", () => {
    const fixture = loadFixture();
    for (const collection of MASTERDATA_COLLECTIONS) {
      expect(
        fixture.areas[collection],
        `fixture.areas.${collection} — run 'pnpm --filter @formulab/shared generate:role-policy-matrix' if the mapping changed`,
      ).toBe(MASTERDATA_COLLECTION_POLICY_AREAS[collection]);
    }
  });

  it("every collection has exactly one mapping — none missing, none extra", () => {
    const fixture = loadFixture();
    const fixtureKeys = Object.keys(fixture.areas).sort();
    const collectionKeys = [...MASTERDATA_COLLECTIONS].sort();
    expect(fixtureKeys).toEqual(collectionKeys);
  });

  it("every mapped area is a real, recognized PolicyArea", () => {
    for (const collection of MASTERDATA_COLLECTIONS) {
      const area = MASTERDATA_COLLECTION_POLICY_AREAS[collection];
      expect(isKnownPolicyArea(area), `${collection} -> ${area} is not a real PolicyArea`).toBe(true);
      expect(POLICY_AREAS).toContain(area);
    }
  });
});
