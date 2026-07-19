import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBSTITUTION_WEIGHTS,
  activeEquivalentPercent,
  buildCandidateRecord,
  rankCandidates,
  scoreCandidate,
  type SubstitutionCandidateInput,
  type SubstitutionTarget,
} from "./substitution";

const TARGET: SubstitutionTarget = {
  materialId: "m-sles",
  materialCode: "SLES",
  linePercent: "10",
  functions: ["anionic_surfactant"],
  ionicCharacter: "anionic",
  activeMatterPercent: "70",
  hlb: "12",
  phMin: "6",
  phMax: "8",
  landedCost: "1.40",
};

function candidate(over: Partial<SubstitutionCandidateInput> = {}): SubstitutionCandidateInput {
  return {
    materialId: "m-candidate",
    materialCode: "CAND",
    name: "Candidate",
    functions: ["anionic_surfactant"],
    ionicCharacter: "anionic",
    activeMatterPercent: "70",
    hlb: "12",
    phMin: "6",
    phMax: "8",
    landedCost: "1.40",
    ...over,
  };
}

describe("scoreCandidate", () => {
  it("scores a near-identical, fully-known-good candidate close to 1", () => {
    // Every dimension has real, favorable data — this is what the panel
    // actually sends once it has re-run compatibility/safety and looked up
    // stock/supplier/regulatory records, not a fixture with unset optionals.
    const { totalScore } = scoreCandidate(
      TARGET,
      candidate({
        recommendedMinPercent: "5",
        recommendedMaxPercent: "20",
        hasBlockingCompatibilityFinding: false,
        hasBlockingSafetyFinding: false,
        regulatoryPermitted: true,
        availableStockKg: "500",
        supplierApproved: true,
        kenyaLocal: true,
        leadTimeDays: 7,
        evidenceConfidenceScore: 0.9,
      }),
    );
    expect(totalScore).toBeGreaterThan(0.85);
  });

  it("scores materially lower when every optional dimension is genuinely unknown", () => {
    // The bare fixture only has function/ionic/active/hlb/pH/cost — every
    // other dimension (stock, supplier, regulatory, compat/safety re-run,
    // evidence) is legitimately missing data, which must weigh the score
    // down rather than being silently excluded from the denominator.
    const { totalScore } = scoreCandidate(TARGET, candidate());
    expect(totalScore).toBeLessThan(0.7);
    expect(totalScore).toBeGreaterThan(0.3);
  });

  it("scores a candidate with no shared function group low on that dimension", () => {
    const { dimensions } = scoreCandidate(TARGET, candidate({ functions: ["preservative"] }));
    const fn = dimensions.find((d) => d.dimension === "function_match")!;
    expect(fn.normalizedScore).toBe(0);
    expect(fn.missingData).toBe(false);
  });

  it("reports missing data rather than a perfect match when a dimension has no source field", () => {
    const { dimensions } = scoreCandidate(TARGET, candidate({ hlb: undefined }));
    const hlb = dimensions.find((d) => d.dimension === "hlb_similarity")!;
    expect(hlb.missingData).toBe(true);
    expect(hlb.normalizedScore).toBeUndefined();
  });

  it("a missing dimension contributes the configured missingDataPenalty, not a perfect-match score", () => {
    const zeroPenalty = scoreCandidate(TARGET, candidate({ hlb: undefined }), DEFAULT_SUBSTITUTION_WEIGHTS, 0);
    const fullPenalty = scoreCandidate(TARGET, candidate({ hlb: undefined }), DEFAULT_SUBSTITUTION_WEIGHTS, 1);
    expect(fullPenalty.totalScore).toBeGreaterThan(zeroPenalty.totalScore);
  });

  it("scores a blocking compatibility finding at 0 on that dimension", () => {
    const { dimensions } = scoreCandidate(
      TARGET,
      candidate({ hasBlockingCompatibilityFinding: true, compatibilityFindingIds: ["f1"] }),
    );
    const compat = dimensions.find((d) => d.dimension === "compatibility_impact")!;
    expect(compat.normalizedScore).toBe(0);
  });

  it("scores an unknown regulatory position as missing, never assumed permitted", () => {
    const { dimensions } = scoreCandidate(TARGET, candidate({ regulatoryPermitted: undefined }));
    const reg = dimensions.find((d) => d.dimension === "regulatory_status")!;
    expect(reg.missingData).toBe(true);
  });

  it("is deterministic: same target/candidate/weights always score the same", () => {
    const a = scoreCandidate(TARGET, candidate());
    const b = scoreCandidate(TARGET, candidate());
    expect(a.totalScore).toBe(b.totalScore);
    expect(a.dimensions).toEqual(b.dimensions);
  });

  it("total score is always within [0, 1]", () => {
    const { totalScore } = scoreCandidate(TARGET, candidate({ landedCost: "1000" }));
    expect(totalScore).toBeGreaterThanOrEqual(0);
    expect(totalScore).toBeLessThanOrEqual(1);
  });
});

describe("activeEquivalentPercent", () => {
  it("computes the raw percentage needed to match active contribution", () => {
    // 10% of a 70%-active material contributes 7% active. A 35%-active
    // candidate needs 20% raw to contribute the same 7% active.
    const pct = activeEquivalentPercent("10", "70", "35");
    expect(pct).toBe("20.0000");
  });

  it("returns undefined when the target's active-matter percentage is unknown", () => {
    expect(activeEquivalentPercent("10", undefined, "35")).toBeUndefined();
  });

  it("returns undefined when the candidate's active-matter percentage is unknown", () => {
    expect(activeEquivalentPercent("10", "70", undefined)).toBeUndefined();
  });

  it("returns undefined rather than dividing by zero for a 0%-active candidate", () => {
    expect(activeEquivalentPercent("10", "70", "0")).toBeUndefined();
  });

  it("is a 1:1 swap when actives match exactly", () => {
    expect(activeEquivalentPercent("10", "70", "70")).toBe("10.0000");
  });
});

describe("buildCandidateRecord", () => {
  it("caps the suggested percentage at the candidate's technical maximum", () => {
    const scored = scoreCandidate(TARGET, candidate({ activeMatterPercent: "10", technicalMaxPercent: "5" }));
    const record = buildCandidateRecord(TARGET, candidate({ activeMatterPercent: "10", technicalMaxPercent: "5" }), scored);
    // Active-equivalent for a 10%-active candidate replacing 10% of a
    // 70%-active target would be 70% raw — capped to the 5% technical max.
    expect(record.suggestedPercent).toBe("5");
  });

  it("names a blocking finding in the ranking reason rather than a numeric score", () => {
    const input = candidate({ hasBlockingSafetyFinding: true, safetyFindingIds: ["s1"] });
    const scored = scoreCandidate(TARGET, input);
    const record = buildCandidateRecord(TARGET, input, scored);
    expect(record.rankingReason).toContain("blocking safety finding");
  });

  it("flags no available stock in the ranking reason", () => {
    const input = candidate({ availableStockKg: "0" });
    const scored = scoreCandidate(TARGET, input);
    const record = buildCandidateRecord(TARGET, input, scored);
    expect(record.rankingReason).toContain("no available stock");
  });
});

describe("rankCandidates", () => {
  it("sorts a blocking candidate after every non-blocking one regardless of score", () => {
    const blocked = buildCandidateRecord(
      TARGET,
      candidate({ materialId: "blocked", materialCode: "BLOCKED", hasBlockingSafetyFinding: true }),
      scoreCandidate(TARGET, candidate({ hasBlockingSafetyFinding: true })),
    );
    const clean = buildCandidateRecord(
      TARGET,
      candidate({ materialId: "clean", materialCode: "CLEAN", activeMatterPercent: "10" }),
      scoreCandidate(TARGET, candidate({ activeMatterPercent: "10" })),
    );
    const ranked = rankCandidates([blocked, clean]);
    expect(ranked[0].materialCode).toBe("CLEAN");
    expect(ranked[1].materialCode).toBe("BLOCKED");
  });

  it("breaks a tie deterministically by material code", () => {
    const a = buildCandidateRecord(TARGET, candidate({ materialId: "a", materialCode: "B" }), scoreCandidate(TARGET, candidate()));
    const b = buildCandidateRecord(TARGET, candidate({ materialId: "b", materialCode: "A" }), scoreCandidate(TARGET, candidate()));
    const ranked = rankCandidates([a, b]);
    expect(ranked[0].materialCode).toBe("A");
  });
});
