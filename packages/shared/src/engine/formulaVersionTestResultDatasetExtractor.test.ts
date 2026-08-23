import { describe, expect, it } from "vitest";
import {
  FormulaVersionTestResultDatasetExtractionError,
  extractFormulaVersionTestResultRows,
  type FormulaVersionTestResultDatasetExtractionInput,
} from "./formulaVersionTestResultDatasetExtractor";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionTestResultRowSchema,
  trialTestResultsSchema,
} from "../schemas/dataset";
import { extractFormulaVersionTestResultRows as extractFromPublicEntryPoint } from "../index";
import { testResultSchema } from "../schemas/testDefinitions";
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { LaboratoryTrial } from "../schemas/laboratory";
import type { TestResult } from "../schemas/testDefinitions";

function formulation(over: Partial<Formulation> = {}): Formulation {
  return {
    schemaVersion: "1.0",
    id: "FORM-0001",
    code: "HC-SHAMPOO-REG-001",
    name: "Regular Shampoo",
    productFamilyCode: "HC-SHAMPOO-REG",
    targetSkuCodes: [],
    targetMarkets: ["KE"],
    targetClaims: [],
    targetBatchKg: "100",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
    ...over,
  };
}

function version(over: Partial<FormulationVersion> = {}): FormulationVersion {
  return {
    schemaVersion: "1.0",
    id: "VER-0001",
    formulationId: "FORM-0001",
    versionNumber: 1,
    status: "concept",
    author: "local",
    createdAt: "2026-01-02T00:00:00.000Z",
    lines: [],
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
    ...over,
  };
}

function trial(over: Partial<LaboratoryTrial> = {}): LaboratoryTrial {
  return {
    schemaVersion: "1.0",
    id: "TRIAL-0001",
    code: "TRL-0001",
    projectId: "FORM-0001",
    sourceType: "saved_version",
    sourceFormulaVersionId: "VER-0001",
    formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-03T00:00:00.000Z" },
    productFamilyId: "PF-0001",
    targetPackagingSkuIds: [],
    title: "Trial 1",
    batchSize: "10",
    batchUnit: "kg",
    status: "completed",
    priority: "normal",
    equipmentIds: [],
    materialUsage: [],
    processSteps: [],
    observations: [],
    hasOpenCriticalDeviation: false,
    createdAt: "2026-01-03T00:00:00.000Z",
    createdBy: "local",
    updatedAt: "2026-01-03T00:00:00.000Z",
    ...over,
  };
}

function testResult(over: Partial<TestResult> = {}): TestResult {
  return {
    schemaVersion: "1.0",
    id: "RESULT-0001",
    trialId: "TRIAL-0001",
    testDefinitionId: "TESTDEF-0001",
    resultType: "numeric",
    replicates: [],
    passFail: "not_evaluated",
    attachments: [],
    performedBy: "alice",
    performedAt: "2026-01-03T10:00:00.000Z",
    createdAt: "2026-01-03T10:05:00.000Z",
    updatedAt: "2026-01-03T10:05:00.000Z",
    ...over,
  };
}

function buildInput(
  over: Partial<FormulaVersionTestResultDatasetExtractionInput> & { formulationVersions: FormulationVersion[] },
): FormulaVersionTestResultDatasetExtractionInput {
  return {
    formulationVersionIds: over.formulationVersions.map((v) => v.id),
    formulations: [formulation()],
    trials: [],
    testResults: [],
    ...over,
  };
}

describe("extractFormulaVersionTestResultRows", () => {
  it("emits one schema-valid dataset row for one formula version with no linked trials", () => {
    const rows = extractFormulaVersionTestResultRows(buildInput({ formulationVersions: [version()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].trials).toEqual([]);
    expect(formulaVersionTestResultRowSchema.safeParse(rows[0]).success).toBe(true);
  });

  it("emits one trial with one valid result", () => {
    const rows = extractFormulaVersionTestResultRows(
      buildInput({
        formulationVersions: [version()],
        trials: [trial()],
        testResults: [testResult()],
      }),
    );
    expect(rows[0].trials).toHaveLength(1);
    expect(rows[0].trials[0].trialId).toBe("TRIAL-0001");
    expect(rows[0].trials[0].testResults).toHaveLength(1);
    expect(rows[0].trials[0].testResults[0].id).toBe("RESULT-0001");
  });

  it("emits multiple results on one trial, ordered by performedAt then id regardless of input order", () => {
    const results = [
      testResult({ id: "R2", performedAt: "2026-01-03T11:00:00.000Z" }),
      testResult({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z" }),
      testResult({ id: "R3", performedAt: "2026-01-03T11:00:00.000Z" }),
    ];
    const rows = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trial()], testResults: results }),
    );
    expect(rows[0].trials[0].testResults.map((r) => r.id)).toEqual(["R1", "R2", "R3"]);
  });

  it("emits multiple trials for one formula version, each with its own distinct results, ordered by createdAt/id regardless of input order", () => {
    const trialA = trial({ id: "TRIAL-A", code: "TRL-A", createdAt: "2026-01-03T00:00:00.000Z" });
    const trialB = trial({ id: "TRIAL-B", code: "TRL-B", createdAt: "2026-01-04T00:00:00.000Z" });
    const resultA = testResult({ id: "RESULT-A", trialId: "TRIAL-A" });
    const resultB = testResult({ id: "RESULT-B", trialId: "TRIAL-B" });
    const forward = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trialA, trialB], testResults: [resultA, resultB] }),
    );
    const reversed = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trialB, trialA], testResults: [resultB, resultA] }),
    );
    expect(forward[0].trials.map((t) => t.trialId)).toEqual(["TRIAL-A", "TRIAL-B"]);
    expect(forward[0].trials[0].testResults[0].id).toBe("RESULT-A");
    expect(forward[0].trials[1].testResults[0].id).toBe("RESULT-B");
    expect(reversed[0]).toEqual(forward[0]);
  });

  it("preserves exact result value/unit/qualifier/status/timestamp fields", () => {
    const richResult = testResult({
      id: "R1",
      resultType: "numeric",
      replicates: [{ replicateNumber: 1, numericValue: "4.5", isOutlier: false }],
      unit: "cP",
      instrument: "Brookfield DV-II",
      passFail: "pass",
      performedAt: "2026-01-03T10:00:00.000Z",
      notes: "Ran twice to confirm.",
    });
    const rows = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [richResult] }),
    );
    const emitted = rows[0].trials[0].testResults[0];
    expect(emitted.unit).toBe("cP");
    expect(emitted.instrument).toBe("Brookfield DV-II");
    expect(emitted.passFail).toBe("pass");
    expect(emitted.performedAt).toBe("2026-01-03T10:00:00.000Z");
    expect(emitted.replicates).toEqual([{ replicateNumber: 1, numericValue: "4.5", isOutlier: false }]);
    expect(emitted.notes).toBe("Ran twice to confirm.");
  });

  it("keeps missing optional fields absent, following the existing dataset contract", () => {
    const bareResult = testResult({ id: "R1" });
    const rows = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [bareResult] }),
    );
    const emitted = rows[0].trials[0].testResults[0];
    expect(emitted.unit).toBeUndefined();
    expect(emitted.instrument).toBeUndefined();
    expect(emitted.sampleId).toBeUndefined();
    const roundTripped = JSON.parse(JSON.stringify(emitted));
    expect("unit" in roundTripped).toBe(false);
    expect("instrument" in roundTripped).toBe(false);
    expect("sampleId" in roundTripped).toBe(false);
  });

  it("preserves explicit zero, false, and empty-but-valid values through extraction", () => {
    const edgeResult = testResult({
      id: "R1",
      booleanValue: false,
      replicates: [{ replicateNumber: 1, numericValue: "0", isOutlier: false }],
      passFail: "fail",
    });
    const rows = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [edgeResult] }),
    );
    const emitted = rows[0].trials[0].testResults[0];
    expect(emitted.booleanValue).toBe(false);
    expect(emitted.replicates[0].numericValue).toBe("0");
    expect(emitted.passFail).toBe("fail");
  });

  it("preserves a full revisesResultId chain as distinct, separately-cited records — never collapsed to latest-only", () => {
    const original = testResult({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z", notes: "first read" });
    const revision = testResult({
      id: "R2",
      performedAt: "2026-01-03T11:00:00.000Z",
      notes: "corrected read",
      revisesResultId: "R1",
    });
    const rows = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [revision, original] }),
    );
    expect(rows[0].trials[0].testResults).toHaveLength(2);
    expect(rows[0].trials[0].testResults.map((r) => r.id)).toEqual(["R1", "R2"]);
    expect(rows[0].trials[0].testResults[1].revisesResultId).toBe("R1");
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "testResult", sourceRecordId: "R1" });
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "testResult", sourceRecordId: "R2" });
  });

  it("preserves attachments exactly, verbatim, since testResultSchema is reused wholesale", () => {
    const attachment = { id: "att-1", kind: "photo" as const, title: "Result photo", location: "s3://bucket/photo.jpg" };
    const resultWithAttachment = testResult({ id: "R1", attachments: [attachment] });
    const rows = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [resultWithAttachment] }),
    );
    expect(rows[0].trials[0].testResults[0].attachments).toEqual([attachment]);
  });

  it("emits no fabricated result for a trial with zero recorded results", () => {
    const rows = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [] }),
    );
    expect(rows[0].trials[0].testResults).toEqual([]);
  });

  it("never lets a trial linked to another formula version leak into this row", () => {
    const otherVersionTrial = trial({ id: "TRIAL-OTHER", sourceFormulaVersionId: "VER-OTHER" });
    const rows = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version({ id: "VER-0001" })], trials: [otherVersionTrial] }),
    );
    expect(rows[0].trials).toEqual([]);
  });

  it("never lets a result belonging to a trial linked to a different formula version leak into this row", () => {
    const relevantTrial = trial({ id: "TRIAL-REL", sourceFormulaVersionId: "VER-0001" });
    const otherTrial = trial({ id: "TRIAL-OTHER", sourceFormulaVersionId: "VER-OTHER" });
    const relevantResult = testResult({ id: "R-REL", trialId: "TRIAL-REL" });
    const otherResult = testResult({ id: "R-OTHER", trialId: "TRIAL-OTHER" });
    const rows = extractFormulaVersionTestResultRows(
      buildInput({
        formulationVersions: [version({ id: "VER-0001" })],
        trials: [relevantTrial, otherTrial],
        testResults: [relevantResult, otherResult],
      }),
    );
    expect(rows[0].trials).toHaveLength(1);
    expect(rows[0].trials[0].trialId).toBe("TRIAL-REL");
    expect(rows[0].trials[0].testResults.map((r) => r.id)).toEqual(["R-REL"]);
  });

  it("emits one row per requested identity, including a duplicate-requested version id twice in order", () => {
    const rows = extractFormulaVersionTestResultRows(
      buildInput({
        formulationVersions: [version({ id: "VER-0001" })],
        formulationVersionIds: ["VER-0001", "VER-0001"],
        trials: [trial()],
        testResults: [testResult()],
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].formulaVersionId).toBe("VER-0001");
    expect(rows[1].formulaVersionId).toBe("VER-0001");
    expect(rows[0]).toEqual(rows[1]);
  });

  it("fails closed when a requested formula version id is not found", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" })],
      formulationVersionIds: ["VER-DOES-NOT-EXIST"],
    });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionTestResultDatasetExtractionError);
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("formula_version_not_found");
    }
  });

  it("fails closed on duplicate/ambiguous exact formula version identities", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" }), version({ id: "VER-0001", versionNumber: 2 })],
    });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("duplicate_formula_version_id");
    }
  });

  it("fails closed on duplicate/ambiguous exact owning-formulation identities", () => {
    const input = buildInput({
      formulationVersions: [version()],
      formulations: [formulation(), formulation({ code: "DUP", name: "Duplicate" })],
    });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("duplicate_formulation_id");
    }
  });

  it("fails closed when a formula version references a formula that was not supplied", () => {
    const input = buildInput({ formulationVersions: [version()], formulations: [] });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("formulation_not_found");
    }
  });

  it("fails closed on duplicate/ambiguous exact trial identities in the supplied pool", () => {
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ id: "TRIAL-0001" }), trial({ id: "TRIAL-0001", code: "TRL-DUP" })],
    });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("duplicate_trial_id");
    }
  });

  it("fails closed on a trial whose sourceFormulaVersionId matches but whose projectId does not resolve to the owning formulation (conflicting link)", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001", formulationId: "FORM-0001" })],
      trials: [trial({ sourceFormulaVersionId: "VER-0001", projectId: "FORM-OTHER" })],
    });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionTestResultDatasetExtractionError);
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("trial_formula_link_conflict");
    }
  });

  it("fails closed on a saved_version trial with a missing sourceFormulaVersionId, rather than silently treating it as unlinked", () => {
    const malformedTrial = trial({ sourceType: "saved_version", sourceFormulaVersionId: undefined });
    const input = buildInput({ formulationVersions: [version()], trials: [malformedTrial] });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionTestResultDatasetExtractionError);
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("invalid_saved_version_trial_link");
    }
  });

  it("a working_draft trial with no sourceFormulaVersionId at all remains legitimate (not a saved_version trial)", () => {
    const draftTrial = trial({ sourceType: "working_draft", sourceFormulaVersionId: undefined, sourceDraftId: "FORM-0001" });
    const rows = extractFormulaVersionTestResultRows(buildInput({ formulationVersions: [version()], trials: [draftTrial] }));
    expect(rows[0].trials).toEqual([]);
  });

  it("fails closed on a duplicate test result identity in the supplied pool, pool-wide, regardless of relevance", () => {
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial()],
      testResults: [testResult({ id: "R-DUP" }), testResult({ id: "R-DUP", performedAt: "2026-01-03T11:00:00.000Z" })],
    });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionTestResultDatasetExtractionError);
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("duplicate_test_result_id");
    }
  });

  it("fails closed when a test result's trialId does not resolve to any supplied trial, pool-wide, regardless of relevance to any requested version", () => {
    const input = buildInput({
      formulationVersions: [version()],
      trials: [],
      testResults: [testResult({ id: "R1", trialId: "TRIAL-DOES-NOT-EXIST" })],
    });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionTestResultDatasetExtractionError);
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("test_result_trial_not_found");
    }
  });

  it("fails closed on a trial with a createdAt value that is not the canonical toISOString() format", () => {
    const input = buildInput({ formulationVersions: [version()], trials: [trial({ createdAt: "2026-01-03 00:00:00" })] });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("invalid_timestamp_format");
    }
  });

  it("fails closed on a test result with a performedAt value that is not the canonical toISOString() format", () => {
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial()],
      testResults: [testResult({ performedAt: "not-a-real-timestamp" })],
    });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("invalid_timestamp_format");
    }
  });

  it("fails closed, and emits nothing, when a constructed row would fail its own schema (malformed source data)", () => {
    const input = buildInput({ formulationVersions: [version()], formulations: [formulation({ code: "   " })] });
    try {
      extractFormulaVersionTestResultRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("row_schema_validation_failed");
    }
  });

  it("does not mutate its inputs, including on a failure path", () => {
    const trials = Object.freeze([Object.freeze(trial())]);
    const results = Object.freeze([Object.freeze(testResult())]);
    const formulations = Object.freeze([Object.freeze(formulation())]);
    const versions = Object.freeze([Object.freeze(version())]);
    const snapshotBefore = JSON.parse(JSON.stringify({ formulations, versions, trials, results }));

    expect(() =>
      extractFormulaVersionTestResultRows({
        formulationVersionIds: [versions[0]!.id],
        formulations: [...formulations],
        formulationVersions: [...versions],
        trials: [...trials],
        testResults: [...results],
      }),
    ).not.toThrow();

    const failingInput: FormulaVersionTestResultDatasetExtractionInput = {
      formulationVersionIds: ["VER-BAD"],
      formulations: [...formulations],
      formulationVersions: [version({ id: "VER-BAD" }), version({ id: "VER-BAD", versionNumber: 2 })],
      trials: [...trials],
      testResults: [...results],
    };
    expect(() => extractFormulaVersionTestResultRows(failingInput)).toThrow(FormulaVersionTestResultDatasetExtractionError);

    expect(JSON.parse(JSON.stringify({ formulations, versions, trials, results }))).toEqual(snapshotBefore);
  });

  it("does not let mutating returned nested output mutate the source fixtures", () => {
    const sourceResult = testResult({ id: "R1", notes: "original" });
    const input = buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [sourceResult] });
    const rows = extractFormulaVersionTestResultRows(input);

    (rows[0].trials[0].testResults[0] as { notes?: string }).notes = "mutated";
    rows[0].trials[0].testResults[0].replicates.push({ replicateNumber: 99, isOutlier: false });

    expect(sourceResult.notes).toBe("original");
    expect(sourceResult.replicates).toEqual([]);
  });

  it("is deterministic: repeated extraction on identical inputs produces deeply equal results", () => {
    const input = buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [testResult()] });
    const first = extractFormulaVersionTestResultRows(input);
    const second = extractFormulaVersionTestResultRows(input);
    expect(first).toEqual(second);
  });

  it("preserves the exact payload through JSON serialization and parsing, and the row schema accepts it", () => {
    const rows = extractFormulaVersionTestResultRows(
      buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [testResult()] }),
    );
    const roundTripped = JSON.parse(JSON.stringify(rows[0]));
    expect(roundTripped).toEqual(rows[0]);
    expect(formulaVersionTestResultRowSchema.safeParse(roundTripped).success).toBe(true);
    expect(roundTripped.datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
  });

  it("rejects a payload missing mandatory identity fields via the schema, and rejects a non-row payload", () => {
    const rows = extractFormulaVersionTestResultRows(buildInput({ formulationVersions: [version()] }));
    const { formulaVersionId, ...withoutVersionId } = rows[0];
    expect(formulaVersionTestResultRowSchema.safeParse(withoutVersionId).success).toBe(false);
    expect(formulaVersionTestResultRowSchema.safeParse({ not: "a row" }).success).toBe(false);
    void formulaVersionId;
  });

  it("is available from the shared package's public export path", () => {
    const rows = extractFromPublicEntryPoint(buildInput({ formulationVersions: [version()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].formulaVersionId).toBe("VER-0001");
  });

  describe("global test-result identity (no parent-scoped lineage)", () => {
    it("two different trials may each record a result — results never collide because TestResult.id is a genuinely global identity, never needing parentRecordId", () => {
      const trialA = trial({ id: "TRIAL-A", createdAt: "2026-01-03T00:00:00.000Z" });
      const trialB = trial({ id: "TRIAL-B", createdAt: "2026-01-04T00:00:00.000Z" });
      const resultA = testResult({ id: "R-A", trialId: "TRIAL-A" });
      const resultB = testResult({ id: "R-B", trialId: "TRIAL-B" });
      const rows = extractFormulaVersionTestResultRows(
        buildInput({ formulationVersions: [version()], trials: [trialA, trialB], testResults: [resultA, resultB] }),
      );
      const citations = rows[0].sourceRecords.filter((r) => r.sourceEntity === "testResult");
      expect(citations).toHaveLength(2);
      expect(citations).toContainEqual({ sourceEntity: "testResult", sourceRecordId: "R-A" });
      expect(citations).toContainEqual({ sourceEntity: "testResult", sourceRecordId: "R-B" });
      // Per the current FVL-05 lineage contract, parentRecordId is used ONLY
      // when true source identity is parent-scoped — TestResult's is not.
      for (const citation of citations) {
        expect(citation.parentRecordId).toBeUndefined();
      }
    });

    it("delimiter-containing and Unicode trial/result ids remain unambiguous and deterministic", () => {
      const trialA = trial({ id: "A:B", createdAt: "2026-01-03T00:00:00.000Z" });
      const resultA = testResult({ id: "C:D", trialId: "A:B" });
      const rows = extractFormulaVersionTestResultRows(
        buildInput({ formulationVersions: [version()], trials: [trialA], testResults: [resultA] }),
      );
      expect(rows[0].trials[0].testResults[0].id).toBe("C:D");
      expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "testResult", sourceRecordId: "C:D" });

      const trialOmega = trial({ id: "TRIAL-Ω", createdAt: "2026-01-03T00:00:00.000Z" });
      const trialAlpha = trial({ id: "TRIAL-α", createdAt: "2026-01-03T00:00:00.000Z" });
      const forward = extractFormulaVersionTestResultRows(
        buildInput({ formulationVersions: [version()], trials: [trialOmega, trialAlpha] }),
      );
      const reversed = extractFormulaVersionTestResultRows(
        buildInput({ formulationVersions: [version()], trials: [trialAlpha, trialOmega] }),
      );
      expect(forward).toEqual(reversed);
    });
  });

  describe("ordinal (locale-independent) ordering", () => {
    it("ordering is environment-independent ordinal comparison, not locale-collation-aware — proven on a case pair where the two disagree", () => {
      expect("a".localeCompare("B")).toBeLessThan(0);
      expect("a" > "B").toBe(true);

      const results = [
        testResult({ id: "a-result", performedAt: "2026-01-03T10:00:00.000Z" }),
        testResult({ id: "B-result", performedAt: "2026-01-03T10:00:00.000Z" }),
      ];
      const rows = extractFormulaVersionTestResultRows(
        buildInput({ formulationVersions: [version()], trials: [trial()], testResults: results }),
      );
      expect(rows[0].trials[0].testResults.map((r) => r.id)).toEqual(["B-result", "a-result"]);
    });
  });

  describe("dataset schema version + canonical schema reuse", () => {
    it("VERSION: DATASET_SCHEMA_VERSION reflects the bump this task's new row type required, shared with every other FVL-05 row type", () => {
      const rows = extractFormulaVersionTestResultRows(buildInput({ formulationVersions: [version()] }));
      expect(rows[0].datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
      expect(formulaVersionTestResultRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.0" }).success).toBe(false);
      expect(formulaVersionTestResultRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.1" }).success).toBe(false);
    });

    it("PARITY: the embedded testResults element schema is the literal same testResultSchema object as the canonical source — never a re-modeled copy", () => {
      expect(trialTestResultsSchema.shape.testResults.element).toBe(testResultSchema);
    });
  });

  describe("revisesResultId / retestOf referential integrity (AUDIT_FVL05_GPT_000005 finding 1)", () => {
    it("a valid revisesResultId chain (same trial) still passes and both records are fully preserved", () => {
      const original = testResult({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z" });
      const revision = testResult({ id: "R2", performedAt: "2026-01-03T11:00:00.000Z", revisesResultId: "R1" });
      const rows = extractFormulaVersionTestResultRows(
        buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [revision, original] }),
      );
      expect(rows[0].trials[0].testResults.map((r) => r.id)).toEqual(["R1", "R2"]);
      expect(rows[0].trials[0].testResults[1].revisesResultId).toBe("R1");
    });

    it("a dangling revisesResultId fails closed", () => {
      const input = buildInput({
        formulationVersions: [version()],
        trials: [trial()],
        testResults: [testResult({ id: "R1", revisesResultId: "R-GHOST" })],
      });
      try {
        extractFormulaVersionTestResultRows(input);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(FormulaVersionTestResultDatasetExtractionError);
        expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("dangling_test_result_revision_reference");
        expect((err as FormulaVersionTestResultDatasetExtractionError).testResultId).toBe("R1");
      }
    });

    it("a cross-trial revisesResultId fails closed — no source evidence proves cross-trial revision linkage is legitimate", () => {
      const trialA = trial({ id: "TRIAL-A", createdAt: "2026-01-03T00:00:00.000Z" });
      const trialB = trial({ id: "TRIAL-B", createdAt: "2026-01-04T00:00:00.000Z" });
      const original = testResult({ id: "R1", trialId: "TRIAL-A" });
      const revision = testResult({ id: "R2", trialId: "TRIAL-B", revisesResultId: "R1", performedAt: "2026-01-04T10:00:00.000Z" });
      const input = buildInput({ formulationVersions: [version()], trials: [trialA, trialB], testResults: [original, revision] });
      try {
        extractFormulaVersionTestResultRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("cross_trial_test_result_revision_reference");
        expect((err as FormulaVersionTestResultDatasetExtractionError).testResultId).toBe("R2");
        expect((err as FormulaVersionTestResultDatasetExtractionError).trialId).toBe("TRIAL-B");
      }
    });

    it("a self-revising result fails closed", () => {
      const input = buildInput({
        formulationVersions: [version()],
        trials: [trial()],
        testResults: [testResult({ id: "R1", revisesResultId: "R1" })],
      });
      try {
        extractFormulaVersionTestResultRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("test_result_revision_cycle_detected");
        expect((err as FormulaVersionTestResultDatasetExtractionError).testResultId).toBe("R1");
      }
    });

    it("a longer revisesResultId cycle (length 2) fails closed", () => {
      const input = buildInput({
        formulationVersions: [version()],
        trials: [trial()],
        testResults: [
          testResult({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z", revisesResultId: "R2" }),
          testResult({ id: "R2", performedAt: "2026-01-03T11:00:00.000Z", revisesResultId: "R1" }),
        ],
      });
      expect(() => extractFormulaVersionTestResultRows(input)).toThrow(FormulaVersionTestResultDatasetExtractionError);
      try {
        extractFormulaVersionTestResultRows(input);
      } catch (err) {
        expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("test_result_revision_cycle_detected");
      }
    });

    it("a valid retestOf reference (same trial) is accepted and preserved, per the recovered domain semantics (a retest is a fresh sample, distinct from a revision)", () => {
      const original = testResult({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z" });
      const retest = testResult({ id: "R2", performedAt: "2026-01-04T10:00:00.000Z", retestOf: "R1" });
      const rows = extractFormulaVersionTestResultRows(
        buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [retest, original] }),
      );
      expect(rows[0].trials[0].testResults.map((r) => r.id)).toEqual(["R1", "R2"]);
      expect(rows[0].trials[0].testResults[1].retestOf).toBe("R1");
    });

    it("a dangling retestOf fails closed — the extractor does not adopt resultHistory.ts's UI-browsing 'orphan retest' tolerance, since a historical dataset has no way to surface a warning to a downstream consumer", () => {
      const input = buildInput({
        formulationVersions: [version()],
        trials: [trial()],
        testResults: [testResult({ id: "R1", retestOf: "R-GHOST" })],
      });
      try {
        extractFormulaVersionTestResultRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("dangling_test_result_retest_reference");
        expect((err as FormulaVersionTestResultDatasetExtractionError).testResultId).toBe("R1");
      }
    });

    it("a cross-trial retestOf fails closed — no source evidence proves cross-trial retest linkage is legitimate either", () => {
      const trialA = trial({ id: "TRIAL-A", createdAt: "2026-01-03T00:00:00.000Z" });
      const trialB = trial({ id: "TRIAL-B", createdAt: "2026-01-04T00:00:00.000Z" });
      const original = testResult({ id: "R1", trialId: "TRIAL-A" });
      const retest = testResult({ id: "R2", trialId: "TRIAL-B", retestOf: "R1", performedAt: "2026-01-04T10:00:00.000Z" });
      const input = buildInput({ formulationVersions: [version()], trials: [trialA, trialB], testResults: [original, retest] });
      try {
        extractFormulaVersionTestResultRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("cross_trial_test_result_retest_reference");
      }
    });

    it("a self-retesting result fails closed", () => {
      const input = buildInput({
        formulationVersions: [version()],
        trials: [trial()],
        testResults: [testResult({ id: "R1", retestOf: "R1" })],
      });
      try {
        extractFormulaVersionTestResultRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("test_result_retest_cycle_detected");
      }
    });

    it("a longer retestOf cycle (length 2) fails closed", () => {
      const input = buildInput({
        formulationVersions: [version()],
        trials: [trial()],
        testResults: [
          testResult({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z", retestOf: "R2" }),
          testResult({ id: "R2", performedAt: "2026-01-03T11:00:00.000Z", retestOf: "R1" }),
        ],
      });
      try {
        extractFormulaVersionTestResultRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionTestResultDatasetExtractionError).code).toBe("test_result_retest_cycle_detected");
      }
    });

    it("does not mutate its inputs on any of the new referential-integrity failure paths", () => {
      const trials = Object.freeze([Object.freeze(trial())]);
      const results = Object.freeze([Object.freeze(testResult({ id: "R1", revisesResultId: "R-GHOST" }))]);
      const formulations = Object.freeze([Object.freeze(formulation())]);
      const versions = Object.freeze([Object.freeze(version())]);
      const snapshotBefore = JSON.parse(JSON.stringify({ formulations, versions, trials, results }));

      const failingInput: FormulaVersionTestResultDatasetExtractionInput = {
        formulationVersionIds: [versions[0]!.id],
        formulations: [...formulations],
        formulationVersions: [...versions],
        trials: [...trials],
        testResults: [...results],
      };
      expect(() => extractFormulaVersionTestResultRows(failingInput)).toThrow(FormulaVersionTestResultDatasetExtractionError);
      expect(JSON.parse(JSON.stringify({ formulations, versions, trials, results }))).toEqual(snapshotBefore);
    });

    it("reordering the testResults input does not change whether a cycle is detected", () => {
      const cyclicResults = [
        testResult({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z", revisesResultId: "R2" }),
        testResult({ id: "R2", performedAt: "2026-01-03T11:00:00.000Z", revisesResultId: "R1" }),
      ];
      const forward = buildInput({ formulationVersions: [version()], trials: [trial()], testResults: cyclicResults });
      const backward = buildInput({ formulationVersions: [version()], trials: [trial()], testResults: [...cyclicResults].reverse() });
      expect(() => extractFormulaVersionTestResultRows(forward)).toThrow(FormulaVersionTestResultDatasetExtractionError);
      expect(() => extractFormulaVersionTestResultRows(backward)).toThrow(FormulaVersionTestResultDatasetExtractionError);
    });
  });
});
