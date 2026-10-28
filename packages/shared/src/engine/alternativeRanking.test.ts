import { describe, expect, it } from "vitest";
import { createAlternativeRankingRecord, rankAlternatives, verifyAlternativeRankingRecord } from "./alternativeRanking";
import { alternativeRankingRecordSchema, rankingReferenceSupportSchema, type AlternativeRankingCandidate } from "../schemas/alternativeRanking";
import { CANONICALIZATION_ALGORITHM, DIGEST_ALGORITHM } from "../schemas/datasetManifest";
import { canonicalizeForFingerprint, sha256Hex } from "./datasetManifestBuilder";

function candidate(id: string, overrides: Partial<AlternativeRankingCandidate["dimensions"]> = {}, formulaStatus: AlternativeRankingCandidate["formulaStatus"] = "VALID"): AlternativeRankingCandidate {
  const dimensionSnapshot = { evaluator: "fixture", resultId: `${id}-result` };
  return {
    candidateId: id,
    sessionId: "session-1",
    alternativeId: id,
    versionLabel: id,
    formulaFingerprint: { algorithm: "sha256", canonicalization: "formulab-canonical-json-v1", digest: "a".repeat(64) },
    formulaStatus,
    dimensions: {
      performance: { status: "UNAVAILABLE_MODEL" },
      uncertainty: { status: "UNKNOWN" },
      cost: { status: "MISSING", sourceSnapshot: dimensionSnapshot },
      availability: { status: "FEASIBLE", sourceSnapshot: dimensionSnapshot },
      compatibility: { status: "PASS", sourceSnapshot: dimensionSnapshot },
      safety: { status: "PASS", sourceSnapshot: dimensionSnapshot },
      regulatory: { status: "PASS", sourceSnapshot: dimensionSnapshot },
      manufacturing: { status: "READY", sourceSnapshot: dimensionSnapshot },
      evidence: { status: "NO_LINKED_EVIDENCE", ingredientCount: 2, linkedIngredientCount: 0, uniqueSourceCount: 0, sourceSnapshot: dimensionSnapshot },
      referenceSupport: { status: "UNKNOWN", formulaCount: 0, supplierCount: 0, sourceRecordIds: [] },
      ...overrides,
    },
  };
}

describe("FVL-08 alternative ranking", () => {
  it("keeps dimensions separate and ranks deterministically without an aggregate score", () => {
    const inputs = [
      candidate("B", { performance: { status: "PREDICTED", numericValue: 12, unit: "%", modelId: "m1", modelVersion: 1 }, cost: { status: "AVAILABLE", costPerKg: 3, currency: "KES" } }),
      candidate("A", { performance: { status: "PREDICTED", numericValue: 10, unit: "%", modelId: "m1", modelVersion: 1 }, cost: { status: "AVAILABLE", costPerKg: 2, currency: "KES" } }),
    ];
    const first = rankAlternatives(inputs);
    expect(rankAlternatives([...inputs].reverse())).toEqual(first);
    expect(first.map(({ candidate: row, rank }) => [row.candidateId, rank])).toEqual([["B", 1], ["A", 2]]);
    expect(first[0]!.candidate.dimensions).toHaveProperty("performance");
    expect(first[0]!.candidate.dimensions).toHaveProperty("uncertainty");
    expect(first[0]!.candidate.dimensions).toHaveProperty("cost");
    expect(first[0]!.candidate.dimensions).toHaveProperty("availability");
    expect(first[0]!.candidate.dimensions).toHaveProperty("compatibility");
    expect(first[0]!.candidate.dimensions).toHaveProperty("safety");
    expect(first[0]!.candidate.dimensions).toHaveProperty("regulatory");
    expect(first[0]!.candidate.dimensions).toHaveProperty("manufacturing");
    expect(first[0]!.candidate.dimensions).toHaveProperty("evidence");
    expect(first[0]!.candidate.dimensions).toHaveProperty("referenceSupport");
    expect(first[0]).not.toHaveProperty("score");
  });

  it("uses the documented ordinal candidate identity for exact ties", () => {
    const tied = [candidate("zeta"), candidate("alpha"), candidate("mu")];
    expect(rankAlternatives(tied).map(({ candidate: row }) => row.candidateId)).toEqual(["alpha", "mu", "zeta"]);
    expect(rankAlternatives([...tied].reverse()).map(({ candidate: row }) => row.candidateId)).toEqual(["alpha", "mu", "zeta"]);
  });

  it.each(["compatibility", "safety", "regulatory"] as const)("never lets a %s FAIL outrank a PASS on other dimensions or evidence support", (failedGate) => {
    const passing = candidate("passing", { performance: { status: "PREDICTED", numericValue: 1 } });
    const failing = candidate("failing", {
      performance: { status: "PREDICTED", numericValue: 1_000_000 },
      cost: { status: "AVAILABLE", costPerKg: 0, currency: "KES" },
      availability: { status: "FEASIBLE" },
      manufacturing: { status: "READY" },
      evidence: { status: "LINKED", ingredientCount: 2, linkedIngredientCount: 2, bestEvidenceClass: "A", uniqueSourceCount: 100 },
      [failedGate]: { status: "FAIL", sourceSnapshot: { verdict: "FAIL" } },
    });
    const result = rankAlternatives([failing, passing]);
    expect(result[0]!.candidate.candidateId).toBe("passing");
    expect(result[1]!.disposition).toBe("BLOCKED");
    expect(result[1]!.gateReasons).toContain(`${failedGate.toUpperCase()}_FAIL`);
  });

  it.each([
    ["availability", "INFEASIBLE", "AVAILABILITY_INFEASIBLE"],
    ["manufacturing", "NOT_READY", "MANUFACTURING_NOT_READY"],
  ] as const)("blocks a candidate with %s infeasibility regardless of performance/evidence", (dimension, status, reason) => {
    const passing = candidate("feasible", { performance: { status: "PREDICTED", numericValue: 1 } });
    const blocked = candidate("blocked", {
      performance: { status: "PREDICTED", numericValue: 1_000_000 },
      evidence: { status: "LINKED", ingredientCount: 2, linkedIngredientCount: 2, bestEvidenceClass: "A", uniqueSourceCount: 100 },
      [dimension]: { status, sourceSnapshot: { status } },
    });
    const result = rankAlternatives([blocked, passing]);
    expect(result[0]!.candidate.candidateId).toBe("feasible");
    expect(result[0]!.disposition).toBe("ELIGIBLE");
    expect(result[1]!.disposition).toBe("BLOCKED");
    expect(result[1]!.gateReasons).toContain(reason);
  });

  it.each([
    ["availability", "UNKNOWN", "AVAILABILITY_NOT_CONFIRMED_FEASIBLE"],
    ["manufacturing", "UNKNOWN", "MANUFACTURING_NOT_CONFIRMED_READY"],
  ] as const)("requires review when %s is %s", (dimension, status, reason) => {
    const eligible = candidate("eligible", { performance: { status: "PREDICTED", numericValue: 1 } });
    const uncertain = candidate("uncertain", {
      performance: { status: "PREDICTED", numericValue: 1_000_000 },
      [dimension]: { status, sourceSnapshot: { status } },
    });
    const result = rankAlternatives([uncertain, eligible]);
    expect(result[0]!.candidate.candidateId).toBe("eligible");
    expect(result[1]!.disposition).toBe("REVIEW_REQUIRED");
    expect(result[1]!.gateReasons).toContain(reason);
  });

  it("preserves both failed authoritative verdicts and unknown is not treated as PASS", () => {
    const bothFailed = candidate("both", { safety: { status: "FAIL" }, regulatory: { status: "FAIL" } });
    const unknown = candidate("unknown", { safety: { status: "UNKNOWN" } });
    const passed = candidate("passed");
    const result = rankAlternatives([bothFailed, unknown, passed]);
    expect(result.map(({ candidate: row }) => row.candidateId)).toEqual(["passed", "unknown", "both"]);
    expect(result[1]!.gateReasons).toContain("SAFETY_NOT_CONFIRMED_PASS");
    expect(result[2]!.gateReasons).toEqual(["SAFETY_FAIL", "REGULATORY_FAIL"]);
  });

  it("never coerces missing and out-of-domain performance to numeric zero", () => {
    const rows = rankAlternatives([
      candidate("missing"),
      candidate("ood", { performance: { status: "OUT_OF_DOMAIN" } }),
      candidate("valid", { performance: { status: "PREDICTED", numericValue: 0 } }),
    ]);
    expect(rows.map(({ candidate: row }) => row.candidateId)).toEqual(["valid", "ood", "missing"]);
    expect(rows[1]!.candidate.dimensions.performance).toMatchObject({ status: "OUT_OF_DOMAIN" });
    expect(rows[2]!.candidate.dimensions.performance).toMatchObject({ status: "UNAVAILABLE_MODEL" });
  });

  it("does not collapse uncertainty, cost, availability, compatibility, manufacturing or evidence into performance", () => {
    const reliable = candidate("reliable", {
      performance: { status: "PREDICTED", numericValue: 10 },
      uncertainty: { status: "SUPPORTED", numericValue: 1, unit: "%", method: "held-out residual scale" },
    });
    const uncertain = candidate("uncertain", {
      performance: { status: "PREDICTED", numericValue: 10 },
      uncertainty: { status: "SUPPORTED", numericValue: 9, unit: "%", method: "held-out residual scale" },
    });
    expect(rankAlternatives([uncertain, reliable])[0]!.candidate.candidateId).toBe("reliable");
  });

  it("uses reviewed reference support only as a late tie-break and never as performance", () => {
    const supported = candidate("supported", {
      performance: { status: "PREDICTED", numericValue: 10 },
      referenceSupport: { status: "SUPPORTED", formulaCount: 2, supplierCount: 2, sourceRecordIds: ["ref-1", "ref-2"] },
    });
    const unknown = candidate("unknown", { performance: { status: "PREDICTED", numericValue: 10 } });
    expect(rankAlternatives([unknown, supported])[0]!.candidate.candidateId).toBe("supported");

    const betterPerformance = candidate("better-performance", { performance: { status: "PREDICTED", numericValue: 11 } });
    expect(rankAlternatives([supported, betterPerformance])[0]!.candidate.candidateId).toBe("better-performance");
    expect(supported.dimensions.performance).toEqual({ status: "PREDICTED", numericValue: 10 });
    expect(supported.dimensions.referenceSupport).toMatchObject({ status: "SUPPORTED", formulaCount: 2, supplierCount: 2 });
  });

  it("requires source-backed counts for supported reference evidence", () => {
    expect(() => rankingReferenceSupportSchema.parse({ status: "SUPPORTED", formulaCount: 0, supplierCount: 0, sourceRecordIds: [] })).toThrow();
    expect(() => rankingReferenceSupportSchema.parse({ status: "UNKNOWN", formulaCount: 1, supplierCount: 1, sourceRecordIds: ["ref-1"] })).toThrow();
    expect(rankingReferenceSupportSchema.parse({ status: "UNKNOWN", formulaCount: 0, supplierCount: 0, sourceRecordIds: [] }).status).toBe("UNKNOWN");
  });

  it("creates a checksummed immutable input snapshot and detects tampering", async () => {
    const record = await createAlternativeRankingRecord({
      code: "rank-1",
      sessionId: "session-1",
      capturedAt: "2026-10-20T20:00:00.000Z",
      context: { batchKg: "100", currency: "KES" },
      rankings: rankAlternatives([candidate("A")]),
    });
    expect(record.rankingPolicyVersion).toBe("1.2");
    expect(record.schemaVersion).toBe("1.1");
    expect(alternativeRankingRecordSchema.shape.rankingPolicyVersion.safeParse("1.0").success).toBe(true);
    expect(alternativeRankingRecordSchema.shape.rankingPolicyVersion.safeParse("1.1").success).toBe(true);
    expect(record.dimensionOrder).toEqual(["performance", "uncertainty", "cost", "availability", "compatibility", "safety", "regulatory", "manufacturing", "evidence", "referenceSupport"]);
    expect(await verifyAlternativeRankingRecord(record)).toBe(true);
    const roundTripped = alternativeRankingRecordSchema.parse(JSON.parse(JSON.stringify(record)));
    expect(await verifyAlternativeRankingRecord(roundTripped)).toBe(true);
    expect(rankAlternatives(roundTripped.rankings.map(({ candidate: item }) => item))).toEqual(roundTripped.rankings);
    expect(await verifyAlternativeRankingRecord({ ...record, context: { ...record.context, currency: "USD" } })).toBe(false);
  });

  it("continues to parse and verify immutable policy 1.1 records without the new dimension", async () => {
    const current = await createAlternativeRankingRecord({
      code: "rank-legacy", sessionId: "session-1", capturedAt: "2026-10-20T20:00:00.000Z",
      context: { batchKg: "100", currency: "KES" }, rankings: rankAlternatives([candidate("legacy")]),
    });
    const legacyBase = {
      ...current,
      schemaVersion: "1.0" as const,
      rankingPolicyVersion: "1.1" as const,
      dimensionOrder: current.dimensionOrder.slice(0, 9),
      rankings: current.rankings.map((entry) => {
        const { referenceSupport: _referenceSupport, ...dimensions } = entry.candidate.dimensions;
        return { ...entry, candidate: { ...entry.candidate, dimensions } };
      }),
    };
    const { artifactChecksum: _checksum, ...base } = legacyBase;
    const legacyRaw = {
      ...legacyBase,
      artifactChecksum: {
        algorithm: DIGEST_ALGORITHM,
        canonicalization: CANONICALIZATION_ALGORITHM,
        digest: await sha256Hex(canonicalizeForFingerprint(base)),
      },
    };
    const parsed = alternativeRankingRecordSchema.parse(legacyRaw);
    expect(parsed.rankingPolicyVersion).toBe("1.1");
    expect(parsed.rankings[0]!.candidate.dimensions).not.toHaveProperty("referenceSupport");
    expect(await verifyAlternativeRankingRecord(parsed)).toBe(true);
  });

  it("requires reference-support data on every policy 1.2 ranking candidate", async () => {
    const current = await createAlternativeRankingRecord({
      code: "rank-incomplete-current", sessionId: "session-1", capturedAt: "2026-10-20T20:00:00.000Z",
      context: { batchKg: "100", currency: "KES" }, rankings: rankAlternatives([candidate("current")]),
    });
    const malformed = {
      ...current,
      rankings: current.rankings.map((entry) => {
        const { referenceSupport: _referenceSupport, ...dimensions } = entry.candidate.dimensions;
        return { ...entry, candidate: { ...entry.candidate, dimensions } };
      }),
    };
    expect(alternativeRankingRecordSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects duplicate candidate identities", () => {
    expect(() => rankAlternatives([candidate("same"), candidate("same")])).toThrow("ids must be unique");
  });
});
