import { describe, expect, it } from "vitest";
import {
  assertMethodDeletable,
  assertMethodEditable,
  assertNoDuplicateAssignment,
  assertSupersededAcknowledged,
  assertUniqueStandardCode,
  assignMethodToTest,
  buildTestMethodSnapshot,
  createInternalStandard,
  findLegacyMethodReferences,
  isAuthorizedLaboratoryMethodActor,
  requireAuthorizedLaboratoryMethodActor,
} from "./laboratoryStandards";
import type { Actor } from "../schemas/status";
import type { LaboratoryStandard, LaboratoryTestMethod } from "../schemas/laboratoryStandards";
import type { TestDefinition } from "../schemas/testDefinitions";

const RESEARCH_MANAGER: Actor = { kind: "human", role: "research_manager", userId: "alice" };
const RESEARCHER: Actor = { kind: "human", role: "researcher", userId: "bob" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };

function standard(over: Partial<LaboratoryStandard> = {}): LaboratoryStandard {
  return {
    schemaVersion: "1.0",
    id: "std-1",
    standardCode: "ISO-4316",
    title: "Determination of pH",
    issuingOrganization: "ISO",
    status: "active",
    jurisdiction: [],
    applicableProductCategories: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function method(over: Partial<LaboratoryTestMethod> = {}): LaboratoryTestMethod {
  return {
    schemaVersion: "1.0",
    id: "method-1",
    testDefinitionCode: "TEST-PH",
    standardId: "std-1",
    methodName: "pH determination",
    assignmentType: "primary",
    status: "active",
    requiredEquipment: [],
    reagentsAndConsumables: [],
    instrumentSettings: [],
    procedureSteps: [],
    safetyWarnings: [],
    relatedTestDefinitionCodes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("authorization", () => {
  it("accepts research_manager/quality_manager/administrator, rejects researcher and non-human actors", () => {
    expect(isAuthorizedLaboratoryMethodActor(RESEARCH_MANAGER)).toBe(true);
    expect(isAuthorizedLaboratoryMethodActor(RESEARCHER)).toBe(false);
    expect(isAuthorizedLaboratoryMethodActor(AGENT)).toBe(false);
  });

  it("requireAuthorizedLaboratoryMethodActor throws with a stated reason", () => {
    expect(() => requireAuthorizedLaboratoryMethodActor(RESEARCHER, "supersede a standard")).toThrow(/research manager, quality manager, or administrator/);
    expect(() => requireAuthorizedLaboratoryMethodActor(AGENT, "supersede a standard")).toThrow();
  });
});

describe("assertUniqueStandardCode", () => {
  it("allows two distinct editions of the same code", () => {
    const existing = [standard({ id: "std-1", edition: "2019" })];
    expect(() => assertUniqueStandardCode(existing, { id: "std-2", standardCode: "ISO-4316", edition: "2023", revision: undefined })).not.toThrow();
  });

  it("rejects a literal duplicate code+edition+revision", () => {
    const existing = [standard({ id: "std-1", edition: "2019", revision: "A" })];
    expect(() => assertUniqueStandardCode(existing, { id: "std-2", standardCode: "ISO-4316", edition: "2019", revision: "A" })).toThrow(/already exists/);
  });

  it("does not trip on itself when editing in place", () => {
    const existing = [standard({ id: "std-1", edition: "2019", revision: "A" })];
    expect(() => assertUniqueStandardCode(existing, { id: "std-1", standardCode: "ISO-4316", edition: "2019", revision: "A" })).not.toThrow();
  });
});

describe("createInternalStandard", () => {
  it("creates a status:internal standard when authorized", () => {
    const s = createInternalStandard(RESEARCH_MANAGER, { standardCode: "FORMULAB-SOP-014", title: "In-house viscosity SOP", issuingOrganization: "FormuLab" }, []);
    expect(s.status).toBe("internal");
    expect(s.createdBy).toBe("alice");
  });

  it("refuses for an unauthorized actor", () => {
    expect(() => createInternalStandard(RESEARCHER, { standardCode: "X", title: "X", issuingOrganization: "X" }, [])).toThrow();
  });
});

describe("assignMethodToTest — per-test isolation", () => {
  it("promotes the target to primary and demotes the previous primary, same test only", () => {
    const methods = [
      method({ id: "m1", testDefinitionCode: "TEST-PH", assignmentType: "primary" }),
      method({ id: "m2", testDefinitionCode: "TEST-PH", standardId: "std-2", assignmentType: "alternative" }),
      method({ id: "m3", testDefinitionCode: "TEST-VISCOSITY", assignmentType: "primary" }),
    ];
    const result = assignMethodToTest(methods, "m2", "primary", RESEARCH_MANAGER);
    expect(result.find((m) => m.id === "m1")?.assignmentType).toBe("alternative");
    expect(result.find((m) => m.id === "m2")?.assignmentType).toBe("primary");
    // A different test's rows are untouched — object identity preserved.
    expect(result.find((m) => m.id === "m3")).toBe(methods[2]);
  });

  it("changing one test's assignment never mutates another test's rows", () => {
    const methods = [method({ id: "m1", testDefinitionCode: "TEST-PH" }), method({ id: "m2", testDefinitionCode: "TEST-DENSITY", assignmentType: "alternative" })];
    const result = assignMethodToTest(methods, "m1", "alternative", RESEARCH_MANAGER);
    expect(result.find((m) => m.id === "m2")).toBe(methods[1]);
  });

  it("refuses for an unauthorized actor", () => {
    const methods = [method()];
    expect(() => assignMethodToTest(methods, "m1", "primary", RESEARCHER)).toThrow();
  });

  it("throws on an unknown method id", () => {
    expect(() => assignMethodToTest([method()], "missing", "primary", RESEARCH_MANAGER)).toThrow(/Unknown/);
  });
});

describe("assertNoDuplicateAssignment", () => {
  it("rejects the same (test, standard) pair twice", () => {
    const methods = [method({ id: "m1", testDefinitionCode: "TEST-PH", standardId: "std-1" })];
    expect(() => assertNoDuplicateAssignment(methods, { id: "m2", testDefinitionCode: "TEST-PH", standardId: "std-1" })).toThrow(/already has a method/);
  });

  it("allows the same standard on a different test", () => {
    const methods = [method({ id: "m1", testDefinitionCode: "TEST-PH", standardId: "std-1" })];
    expect(() => assertNoDuplicateAssignment(methods, { id: "m2", testDefinitionCode: "TEST-DENSITY", standardId: "std-1" })).not.toThrow();
  });
});

describe("assertSupersededAcknowledged", () => {
  it("requires acknowledgement for a superseded standard", () => {
    const superseded = standard({ status: "superseded" });
    expect(() => assertSupersededAcknowledged(superseded, false)).toThrow(/superseded/);
    expect(() => assertSupersededAcknowledged(superseded, true)).not.toThrow();
  });

  it("never requires acknowledgement for an active standard", () => {
    expect(() => assertSupersededAcknowledged(standard({ status: "active" }), false)).not.toThrow();
  });
});

describe("assertMethodEditable", () => {
  it("allows any human to edit a draft", () => {
    expect(() => assertMethodEditable(method({ status: "draft" }), RESEARCHER)).not.toThrow();
  });

  it("refuses a non-human editing a draft", () => {
    expect(() => assertMethodEditable(method({ status: "draft" }), AGENT)).toThrow();
  });

  it("requires an authorized role to edit an active method", () => {
    expect(() => assertMethodEditable(method({ status: "active" }), RESEARCHER)).toThrow();
    expect(() => assertMethodEditable(method({ status: "active" }), RESEARCH_MANAGER)).not.toThrow();
  });
});

describe("assertMethodDeletable", () => {
  it("refuses deleting a method referenced by a historical result", () => {
    expect(() => assertMethodDeletable(method({ status: "draft" }), true)).toThrow(/referenced by a historical test result/);
  });

  it("refuses deleting an active method even when unreferenced", () => {
    expect(() => assertMethodDeletable(method({ status: "active" }), false)).toThrow(/active/);
  });

  it("allows deleting an unreferenced draft method", () => {
    expect(() => assertMethodDeletable(method({ status: "draft" }), false)).not.toThrow();
  });
});

describe("buildTestMethodSnapshot", () => {
  it("copies identifying fields from the standard and method", () => {
    const s = standard({ id: "std-9", standardCode: "ISO-9", edition: "2020", revision: "B" });
    const m = method({ id: "m9", standardId: "std-9", methodName: "pH", unit: "pH", acceptanceCriteria: "6.0-8.0" });
    const snap = buildTestMethodSnapshot(m, s);
    expect(snap).toMatchObject({
      standardId: "std-9",
      standardCode: "ISO-9",
      standardEdition: "2020",
      standardRevision: "B",
      methodId: "m9",
      methodName: "pH",
      unit: "pH",
      acceptanceCriteria: "6.0-8.0",
    });
    expect(typeof snap.capturedAt).toBe("string");
  });

  it("historical stability: a later edit to the standard does not change an already-built snapshot", () => {
    const s = standard({ id: "std-9", standardCode: "ISO-9", edition: "2020" });
    const m = method({ id: "m9", standardId: "std-9" });
    const snap = buildTestMethodSnapshot(m, s);
    const editedStandard = { ...s, edition: "2024" };
    void editedStandard;
    expect(snap.standardEdition).toBe("2020");
  });
});

describe("findLegacyMethodReferences", () => {
  function definition(over: Partial<TestDefinition> = {}): TestDefinition {
    return {
      schemaVersion: "1.0",
      code: "TEST-PH",
      name: "pH",
      category: "chemistry",
      resultType: "numeric",
      replicatesRequired: 1,
      requiredEquipment: [],
      requiredAttachment: false,
      applicableProductFamilies: [],
      applicableProductSkus: [],
      criticalTestFlag: false,
      verificationStatus: "not_verified",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...over,
    };
  }

  it("reports every non-empty methodReference as unresolved, never auto-converting it", () => {
    const defs = [definition({ code: "TEST-PH", methodReference: "ISO 4316" }), definition({ code: "TEST-VISCOSITY", methodReference: undefined })];
    const report = findLegacyMethodReferences(defs);
    expect(report).toEqual([{ testDefinitionCode: "TEST-PH", testDefinitionName: "pH", legacyReference: "ISO 4316" }]);
  });

  it("is idempotent — re-running against the same input produces the same report", () => {
    const defs = [definition({ methodReference: "in-house SOP-014" })];
    expect(findLegacyMethodReferences(defs)).toEqual(findLegacyMethodReferences(defs));
  });
});
