/**
 * Phase 13 Session 4 — Rust/TypeScript workflow-transition parity.
 *
 * `role_policy.rs` (Rust) validates `save_approval_record`'s
 * previousStatus -> requestedStatus transition against
 * `formulaStatusTransitions.json`, not a second, hand-typed copy of
 * `status.ts`'s `ALLOWED_NEXT` graph. This test is the TypeScript-side half
 * of that parity mechanism, mirroring `rolePolicy.roleVocabularyParity.test.ts`'s
 * shape: the checked-in fixture must equal a fresh computation of
 * `ALLOWED_NEXT` right now.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_NEXT } from "./status";
import { FORMULA_STATUSES } from "./formulation";

const FIXTURE_PATH = fileURLToPath(new URL("../engine/formulaStatusTransitions.json", import.meta.url));

interface TransitionsFixture {
  statuses: string[];
  allowedNext: Record<string, string[]>;
}

function loadFixture(): TransitionsFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as TransitionsFixture;
}

describe("status — Rust/TypeScript workflow-transition parity", () => {
  it("the fixture's statuses match FORMULA_STATUSES exactly, including order", () => {
    const fixture = loadFixture();
    expect(fixture.statuses).toEqual([...FORMULA_STATUSES]);
  });

  it("the fixture's allowedNext is exactly ALLOWED_NEXT right now (fails on drift)", () => {
    const fixture = loadFixture();
    for (const status of FORMULA_STATUSES) {
      expect(
        fixture.allowedNext[status],
        `fixture.allowedNext.${status} — run 'pnpm --filter @formulab/shared generate:role-policy-matrix' if ALLOWED_NEXT changed`,
      ).toEqual([...ALLOWED_NEXT[status]]);
    }
  });
});
