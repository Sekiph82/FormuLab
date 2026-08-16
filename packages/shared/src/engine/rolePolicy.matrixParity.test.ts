/**
 * Phase 13 Session 4 — Rust/TypeScript full-matrix parity.
 *
 * `role_policy.rs` (Rust) has no hand-typed permission matrix of its own —
 * it reads `rolePolicyMatrix.generated.json` via `include_str!` and does a
 * flat lookup. This test is the TypeScript-side half of the parity
 * mechanism: it asserts the checked-in JSON fixture is byte-for-byte what
 * `rolePolicy.ts`'s own `MATRIX` (via `fullMatrixSnapshot()`) computes
 * *right now* — a developer who changes `MATRIX` and forgets to re-run
 * `pnpm --filter @formulab/shared generate:role-policy-matrix` fails this
 * test; a developer who hand-edits the JSON fixture directly (never a
 * supported workflow) fails it too. Rust's own tests
 * (`role_policy.rs`'s `#[cfg(test)]` block) read the same file and assert
 * representative cells against the same source-of-truth facts documented in
 * `rolePolicy.test.ts` — the shared file is what keeps the two languages
 * from silently disagreeing, not a promise either side keeps by hand.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, POLICY_AREAS, ROLES, fullMatrixSnapshot } from "./rolePolicy";

const FIXTURE_PATH = fileURLToPath(new URL("./rolePolicyMatrix.generated.json", import.meta.url));

interface MatrixFixture {
  areas: string[];
  roles: string[];
  capabilities: string[];
  matrix: Record<string, Record<string, string[]>>;
}

function loadFixture(): MatrixFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as MatrixFixture;
}

describe("rolePolicy — Rust/TypeScript full-matrix parity", () => {
  it("the fixture's areas/roles/capabilities vocabularies match rolePolicy.ts exactly", () => {
    const fixture = loadFixture();
    expect(fixture.areas).toEqual([...POLICY_AREAS]);
    expect(fixture.roles).toEqual([...ROLES]);
    expect(fixture.capabilities).toEqual([...CAPABILITIES]);
  });

  it("the fixture's matrix is exactly what MATRIX computes right now (fails on drift)", () => {
    const fixture = loadFixture();
    const live = fullMatrixSnapshot();
    for (const area of POLICY_AREAS) {
      for (const role of ROLES) {
        expect(
          fixture.matrix[area]?.[role],
          `fixture.matrix.${area}.${role} — run 'pnpm --filter @formulab/shared generate:role-policy-matrix' if MATRIX changed`,
        ).toEqual([...live[area][role]]);
      }
    }
  });

  it("has no area/role cell missing from the fixture", () => {
    const fixture = loadFixture();
    for (const area of POLICY_AREAS) {
      expect(fixture.matrix[area], `fixture is missing area ${area}`).toBeDefined();
      for (const role of ROLES) {
        expect(fixture.matrix[area][role], `fixture is missing ${area}.${role}`).toBeDefined();
      }
    }
  });
});
