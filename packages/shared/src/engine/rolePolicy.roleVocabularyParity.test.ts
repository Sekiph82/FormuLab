/**
 * Phase 13 Session 3 — Rust/TypeScript role-vocabulary parity.
 *
 * `identity.rs`'s `Role` enum and `status.ts`'s `APPROVAL_ROLES` (this
 * module's `ROLES`) are two independent, hand-declared lists of the same
 * 12 fixed role strings. Nothing at the language level forces them to
 * agree. The mechanism here is a single JSON fixture
 * (`roleVocabulary.json`, checked into the repo, not generated at test
 * time) that both languages check *themselves* against:
 *
 * - this test reads the fixture and asserts it is exactly
 *   `ROLES`/`APPROVAL_ROLES`, in the same order.
 * - `identity.rs`'s own `#[cfg(test)]` block (`role_vocabulary_matches_
 *   the_shared_json_fixture`) reads the *same* file via `include_str!`
 *   and asserts it is exactly `Role::ALL`, in the same order.
 *
 * Neither side hand-copies the other's 12 strings into a third list — a
 * developer who adds/removes/renames a role on one side and forgets the
 * fixture fails that side's own test; a developer who updates the fixture
 * but forgets one side's enum/const fails the other side's test. There is
 * no path through which the two vocabularies can silently diverge without
 * a test failing on at least one side.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLES } from "./rolePolicy";
import { APPROVAL_ROLES } from "../schemas/status";

const FIXTURE_PATH = fileURLToPath(new URL("./roleVocabulary.json", import.meta.url));

describe("rolePolicy — Rust/TypeScript role-vocabulary parity", () => {
  it("ROLES (rolePolicy) is exactly APPROVAL_ROLES (status.ts) — one canonical vocabulary, not two", () => {
    expect(ROLES).toEqual(APPROVAL_ROLES);
  });

  it("has exactly 12 roles", () => {
    expect(ROLES.length).toBe(12);
  });

  it("matches the shared JSON fixture exactly, including order", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as { roles: string[] };
    expect(fixture.roles).toEqual([...ROLES]);
  });

  it("does not contain chemist, packaging, or any other retired/invented role", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as { roles: string[] };
    for (const bogus of ["chemist", "packaging", "admin", "manager", "employee", ""]) {
      expect(fixture.roles).not.toContain(bogus);
      expect(ROLES).not.toContain(bogus);
    }
  });

  it("the fixture has no duplicate entries", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as { roles: string[] };
    expect(new Set(fixture.roles).size).toBe(fixture.roles.length);
  });
});
