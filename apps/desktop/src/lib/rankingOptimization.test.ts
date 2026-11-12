import { describe, expect, it, vi } from "vitest";
import { createAlternativeRankingRecord, rankAlternatives, type AlternativeRankingCandidate, type Formulation, type FormulationVersion } from "@formulab/shared";
import { assertRankingEntryCanOptimize, ensureCurrentRankingSnapshot, resolveVerifiedRankingSource } from "./rankingOptimization";
import { fingerprintFormulationVersion } from "./rankingPredictionSource";

const FORMULATION = { id: "project-A" } as Formulation;
const VERSION = { id: "version-A", formulationId: "project-A", lines: [] } as unknown as FormulationVersion;
const loadVersion = vi.fn(async () => ({ formulation: FORMULATION, version: VERSION }));

function candidate(id: string, safety: "PASS" | "FAIL" = "PASS", regulatory: "PASS" | "FAIL" = "PASS", formulaFingerprint?: AlternativeRankingCandidate["formulaFingerprint"], sourceFormulationVersionId = "version-A"): AlternativeRankingCandidate {
  return {
    candidateId: id, sessionId: "session-1", alternativeId: id, versionLabel: id,
    sourceFormulationVersionId,
    formulaStatus: "VALID",
    ...(formulaFingerprint ? { formulaFingerprint } : {}),
    dimensions: {
      performance: { status: "UNAVAILABLE_MODEL" }, uncertainty: { status: "UNKNOWN" },
      cost: { status: "AVAILABLE", costPerKg: 2, currency: "KES", batchKg: "100", sourceSnapshot: { authority: "FormuLab Cost Engine" } },
      availability: { status: "FEASIBLE" }, compatibility: { status: "PASS" }, safety: { status: safety }, regulatory: { status: regulatory },
      manufacturing: { status: "READY" }, evidence: { status: "NO_LINKED_EVIDENCE", ingredientCount: 1, linkedIngredientCount: 0, uniqueSourceCount: 0 },
      referenceSupport: { status: "UNKNOWN", formulaCount: 0, supplierCount: 0, sourceRecordIds: [] },
    },
  };
}

const context = { batchKg: "100", currency: "KES" };

describe("FVL-08 ranking optimizer boundary", () => {
  it("refuses blocked alternatives before any handoff persistence can run", () => {
    const entry = rankAlternatives([candidate("blocked", "FAIL")])[0]!;
    expect(() => assertRankingEntryCanOptimize(entry)).toThrow(/blocked/i);
  });

  it("accepts only a checksum-valid eligible source and returns exact ranking linkage", async () => {
    const rankings = rankAlternatives([candidate("eligible")]);
    const record = await createAlternativeRankingRecord({ code: "rank-eligible", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context, rankings });
    const result = await resolveVerifiedRankingSource({
      projectId: "project-A", sourceSessionId: "session-1", sourceAlternativeId: "eligible", sourceFormulaFingerprint: null,
      rankingRecordCode: record.code, records: [record], loadVersion,
    });
    expect(result?.sourceAlternative).toEqual({ origin: "ranking", sessionId: "session-1", alternativeId: "eligible", sourceFormulationVersionId: "version-A", rankingRecordCode: "rank-eligible" });
  });

  it("rejects URL metadata that points to a tampered or blocked persisted snapshot", async () => {
    const blocked = await createAlternativeRankingRecord({ code: "rank-blocked", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context, rankings: rankAlternatives([candidate("blocked", "FAIL")]) });
    await expect(resolveVerifiedRankingSource({ projectId: "project-A", sourceSessionId: "session-1", sourceAlternativeId: "blocked", sourceFormulaFingerprint: null, rankingRecordCode: blocked.code, records: [blocked], loadVersion })).rejects.toThrow(/blocked/i);
    await expect(resolveVerifiedRankingSource({ projectId: "project-A", sourceSessionId: "session-1", sourceAlternativeId: "eligible", sourceFormulaFingerprint: null, rankingRecordCode: blocked.code, records: [{ ...blocked, sessionId: "other-session" }], loadVersion })).rejects.toThrow(/checksum/i);
  });

  it("fails closed for a substituted project, wrong version identity, or missing version identity", async () => {
    const record = await createAlternativeRankingRecord({ code: "rank-bound", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context, rankings: rankAlternatives([candidate("eligible")]) });
    const request = { sourceSessionId: "session-1", sourceAlternativeId: "eligible", sourceFormulaFingerprint: null, rankingRecordCode: record.code, records: [record], loadVersion };
    await expect(resolveVerifiedRankingSource({ ...request, projectId: "project-B" })).rejects.toThrow(/does not own/i);
    await expect(resolveVerifiedRankingSource({ ...request, projectId: "project-A", sourceFormulationVersionId: "wrong-version" })).rejects.toThrow(/does not match/i);
    await expect(resolveVerifiedRankingSource({ ...request, projectId: "project-A", loadVersion: async () => ({ formulation: FORMULATION, version: { ...VERSION, id: "other-version" } }) })).rejects.toThrow(/missing or has ambiguous ownership|does not resolve/i);
    const missingCandidate = candidate("eligible");
    delete missingCandidate.sourceFormulationVersionId;
    const missing = await createAlternativeRankingRecord({ code: "rank-no-version", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context, rankings: rankAlternatives([missingCandidate]) });
    await expect(resolveVerifiedRankingSource({ ...request, projectId: "project-A", rankingRecordCode: missing.code, records: [missing] })).rejects.toThrow(/no saved source FormulationVersion/i);
  });

  it("recomputes saved-version content fingerprint and rejects changed formula content", async () => {
    const fingerprint = await fingerprintFormulationVersion(VERSION);
    const record = await createAlternativeRankingRecord({ code: "rank-fingerprint", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context, rankings: rankAlternatives([candidate("eligible", "PASS", "PASS", fingerprint)]) });
    const request = { projectId: "project-A", sourceSessionId: "session-1", sourceAlternativeId: "eligible", sourceFormulaFingerprint: null, rankingRecordCode: record.code, records: [record] };
    await expect(resolveVerifiedRankingSource({ ...request, loadVersion })).resolves.toBeDefined();
    await expect(resolveVerifiedRankingSource({ ...request, loadVersion: async () => ({ formulation: FORMULATION, version: { ...VERSION, lines: [{ displayName: "tampered" }] } as FormulationVersion }) })).rejects.toThrow(/no longer matches/i);
  });

  it.each([["Safety", "FAIL", "PASS"], ["Regulatory", "PASS", "FAIL"]] as const)("keeps %s FAIL as a hard gate when the project is substituted", async (_gate, safety, regulatory) => {
    const record = await createAlternativeRankingRecord({ code: `rank-${_gate}`, sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context, rankings: rankAlternatives([candidate("blocked", safety, regulatory)]) });
    await expect(resolveVerifiedRankingSource({ projectId: "project-B", sourceSessionId: "session-1", sourceAlternativeId: "blocked", sourceFormulaFingerprint: null, rankingRecordCode: record.code, records: [record], loadVersion })).rejects.toThrow(/blocked/i);
  });

  it("reuses a matching snapshot but appends a fresh one when the ranking input changes", async () => {
    const original = rankAlternatives([candidate("eligible")]);
    const stored = await createAlternativeRankingRecord({ code: "rank-original", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context, rankings: original });
    const append = vi.fn(async () => undefined);
    const readBack = vi.fn(async () => [stored]);
    const reused = await ensureCurrentRankingSnapshot({ sessionId: "session-1", context, rankings: original, existingRecords: [stored], createCode: () => "rank-new", now: () => "2026-10-21T13:00:00Z", append, readBack });
    expect(reused.code).toBe("rank-original");
    expect(append).not.toHaveBeenCalled();

    const changed = rankAlternatives([candidate("eligible"), candidate("second")]);
    const changedRecord = await createAlternativeRankingRecord({ code: "rank-new", sessionId: "session-1", capturedAt: "2026-10-21T13:00:00Z", context, rankings: changed });
    readBack.mockResolvedValue([stored, changedRecord]);
    const created = await ensureCurrentRankingSnapshot({ sessionId: "session-1", context, rankings: changed, existingRecords: [stored], createCode: () => "rank-new", now: () => "2026-10-21T13:00:00Z", append: async () => undefined, readBack });
    expect(created.code).toBe("rank-new");
  });

  it("does not proceed when immutable snapshot persistence fails", async () => {
    await expect(ensureCurrentRankingSnapshot({
      sessionId: "session-1", context, rankings: rankAlternatives([candidate("eligible")]), existingRecords: [],
      createCode: () => "rank-new", now: () => "2026-10-21T13:00:00Z",
      append: async () => { throw new Error("storage unavailable"); }, readBack: async () => [],
    })).rejects.toThrow("storage unavailable");
  });
});
