import { describe, expect, it } from "vitest";
import { laboratoryStandardSchema, laboratoryTestMethodSchema, testMethodSnapshotSchema } from "./laboratoryStandards";
import { testResultSchema } from "./testDefinitions";

function validStandard() {
  return {
    schemaVersion: "1.0" as const,
    id: "std-1",
    standardCode: "ISO-4316",
    title: "Determination of pH",
    issuingOrganization: "ISO",
    status: "active" as const,
    jurisdiction: [],
    applicableProductCategories: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function validMethod() {
  return {
    schemaVersion: "1.0" as const,
    id: "method-1",
    testDefinitionCode: "TEST-PH",
    standardId: "std-1",
    methodName: "pH determination",
    assignmentType: "primary" as const,
    status: "active" as const,
    requiredEquipment: [],
    reagentsAndConsumables: [],
    instrumentSettings: [],
    procedureSteps: [],
    safetyWarnings: [],
    relatedTestDefinitionCodes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function validSnapshot() {
  return {
    standardId: "std-1",
    standardCode: "ISO-4316",
    methodId: "method-1",
    methodName: "pH determination",
    instrumentSettings: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("laboratoryStandardSchema", () => {
  it("accepts a valid standard", () => {
    expect(laboratoryStandardSchema.safeParse(validStandard()).success).toBe(true);
  });

  it("rejects a missing standardCode", () => {
    const { standardCode: _drop, ...malformed } = validStandard();
    expect(laboratoryStandardSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects an unknown status value", () => {
    expect(laboratoryStandardSchema.safeParse({ ...validStandard(), status: "not-a-real-status" }).success).toBe(false);
  });
});

describe("laboratoryTestMethodSchema", () => {
  it("accepts a valid method", () => {
    expect(laboratoryTestMethodSchema.safeParse(validMethod()).success).toBe(true);
  });

  it("rejects a missing testDefinitionCode", () => {
    const { testDefinitionCode: _drop, ...malformed } = validMethod();
    expect(laboratoryTestMethodSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects an unknown assignmentType", () => {
    expect(laboratoryTestMethodSchema.safeParse({ ...validMethod(), assignmentType: "tertiary" }).success).toBe(false);
  });

  it("rejects a malformed instrumentSettings entry (missing value)", () => {
    expect(laboratoryTestMethodSchema.safeParse({ ...validMethod(), instrumentSettings: [{ parameter: "temperature" }] }).success).toBe(false);
  });
});

describe("testMethodSnapshotSchema", () => {
  it("accepts a valid snapshot", () => {
    expect(testMethodSnapshotSchema.safeParse(validSnapshot()).success).toBe(true);
  });

  it("rejects malformed imported snapshot data safely (missing required fields)", () => {
    expect(testMethodSnapshotSchema.safeParse({ standardCode: "ISO-4316" }).success).toBe(false);
  });
});

describe("testResultSchema — methodSnapshot is additive", () => {
  function validResult() {
    return {
      schemaVersion: "1.0" as const,
      id: "result-1",
      trialId: "trial-1",
      testDefinitionId: "TEST-PH",
      resultType: "numeric" as const,
      replicates: [],
      passFail: "not_evaluated" as const,
      attachments: [],
      performedBy: "alice",
      performedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("a pre-Session-1A result with no methodSnapshot still parses", () => {
    expect(testResultSchema.safeParse(validResult()).success).toBe(true);
  });

  it("accepts a result with a valid methodSnapshot attached", () => {
    expect(testResultSchema.safeParse({ ...validResult(), methodSnapshot: validSnapshot() }).success).toBe(true);
  });

  it("rejects a malformed methodSnapshot rather than silently dropping it", () => {
    expect(testResultSchema.safeParse({ ...validResult(), methodSnapshot: { standardCode: 123 } }).success).toBe(false);
  });
});
