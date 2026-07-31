import { describe, expect, it } from "vitest";
import { laboratoryStandardSchema, laboratoryTestMethodSchema } from "../schemas/laboratoryStandards";
import { SEED_LABORATORY_STANDARDS, SEED_LABORATORY_TEST_METHODS } from "./laboratoryStandards";

describe("SEED_LABORATORY_STANDARDS / SEED_LABORATORY_TEST_METHODS", () => {
  it("every seed standard parses against the schema", () => {
    for (const s of SEED_LABORATORY_STANDARDS) {
      expect(laboratoryStandardSchema.safeParse(s).success, s.id).toBe(true);
    }
  });

  it("every seed method parses against the schema", () => {
    for (const m of SEED_LABORATORY_TEST_METHODS) {
      expect(laboratoryTestMethodSchema.safeParse(m).success, m.id).toBe(true);
    }
  });

  it("every seed standard status is internal, never claiming an official recognized standard", () => {
    for (const s of SEED_LABORATORY_STANDARDS) {
      expect(s.status).toBe("internal");
    }
  });

  it("every seed method links to a standard that exists in the same seed set", () => {
    const ids = new Set(SEED_LABORATORY_STANDARDS.map((s) => s.id));
    for (const m of SEED_LABORATORY_TEST_METHODS) {
      expect(ids.has(m.standardId), `${m.id} -> ${m.standardId}`).toBe(true);
    }
  });
});
