import { describe, expect, it, vi } from "vitest";
import { createAlternativeRankingRecord, rankAlternatives, type AlternativeRankingCandidate } from "@formulab/shared";
import { assertRankingEntryCanOptimize, ensureCurrentRankingSnapshot, resolveVerifiedRankingSource } from "./rankingOptimization";

function candidate(id: string, safety: "PASS" | "FAIL" = "PASS"): AlternativeRankingCandidate {
  return {
    candidateId: id, sessionId: "session-1", alternativeId: id, versionLabel: id,
    formulaStatus: "VALID",
    formulaFingerprint: { algorithm: "sha256", canonicalization: "formulab-canonical-json-v1", digest: "a".repeat(64) },
    dimensions: {
      performance: { status: "UNAVAILABLE_MODEL" }, uncertainty: { status: "UNKNOWN" },
      cost: { status: "AVAILABLE", costPerKg: 2, currency: "KES", batchKg: "100", sourceSnapshot: { authority: "FormuLab Cost Engine" } },
      availability: { status: "FEASIBLE" }, compatibility: { status: "PASS" }, safety: { status: safety }, regulatory: { status: "PASS" },
      manufacturing: { status: "READY" }, evidence: { status: "NO_LINKED_EVIDENCE", ingredientCount: 1, linkedIngredientCount: 0, uniqueSourceCount: 0 },
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
      sourceSessionId: "session-1", sourceAlternativeId: "eligible", sourceFormulaFingerprint: "a".repeat(64),
      rankingRecordCode: record.code, records: [record],
    });
    expect(result?.sourceAlternative).toEqual({ origin: "ranking", sessionId: "session-1", alternativeId: "eligible", formulaFingerprint: candidate("eligible").formulaFingerprint, rankingRecordCode: "rank-eligible" });
  });

  it("rejects URL metadata that points to a tampered or blocked persisted snapshot", async () => {
    const blocked = await createAlternativeRankingRecord({ code: "rank-blocked", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00Z", context, rankings: rankAlternatives([candidate("blocked", "FAIL")]) });
    await expect(resolveVerifiedRankingSource({ sourceSessionId: "session-1", sourceAlternativeId: "blocked", sourceFormulaFingerprint: "a".repeat(64), rankingRecordCode: blocked.code, records: [blocked] })).rejects.toThrow(/blocked/i);
    await expect(resolveVerifiedRankingSource({ sourceSessionId: "session-1", sourceAlternativeId: "eligible", sourceFormulaFingerprint: null, rankingRecordCode: blocked.code, records: [{ ...blocked, sessionId: "other-session" }] })).rejects.toThrow(/checksum/i);
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
