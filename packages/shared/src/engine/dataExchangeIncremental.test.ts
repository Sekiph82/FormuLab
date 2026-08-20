/**
 * FVL-04.023 — Incremental Re-import / Conflict Handling acceptance.
 */
import { describe, expect, it } from "vitest";
import { classifyReimport, COMMITTABLE_ROW_STATES, detectMissingFromSource, fingerprintCanonicalCandidate, isSchemaChanged, type PriorCommittedRow, type ReimportClassificationInput } from "./dataExchangeIncremental";

describe("detectMissingFromSource", () => {
  it("a natural key present in the prior job but absent from the current batch is flagged", () => {
    const prior: PriorCommittedRow[] = [
      { naturalKey: "TEST-MAT-001", jobId: "job-1", targetCollection: "materials", targetRecordId: "TEST-MAT-001" },
      { naturalKey: "TEST-MAT-002", jobId: "job-1", targetCollection: "materials", targetRecordId: "TEST-MAT-002" },
    ];
    const current = new Set(["TEST-MAT-001"]); // MAT-002 no longer in this file
    const findings = detectMissingFromSource(prior, current);
    expect(findings).toEqual([{ naturalKey: "TEST-MAT-002", lastSeenJobId: "job-1", targetCollection: "materials", targetRecordId: "TEST-MAT-002" }]);
  });

  it("a natural key present in both is never flagged", () => {
    const prior: PriorCommittedRow[] = [{ naturalKey: "TEST-MAT-001", jobId: "job-1", targetCollection: "materials", targetRecordId: "TEST-MAT-001" }];
    const findings = detectMissingFromSource(prior, new Set(["TEST-MAT-001"]));
    expect(findings).toEqual([]);
  });

  it("a key re-submitted this time even as an unrelated failing row is still 'present' — this function only flags genuine absence, never conflates it with a row-level validation problem", () => {
    // The caller passes every natural key present in the CURRENT batch
    // regardless of row state (see the module's own doc comment) — this
    // test proves the function itself makes no state-based distinction
    // for the current side, only presence/absence.
    const prior: PriorCommittedRow[] = [{ naturalKey: "TEST-MAT-001", jobId: "job-1" }];
    const findings = detectMissingFromSource(prior, new Set(["TEST-MAT-001"]));
    expect(findings).toEqual([]);
  });

  it("a repeated natural key within the prior batch (e.g. a grouped template's replicate rows) is deduplicated, never flagged twice", () => {
    const prior: PriorCommittedRow[] = [
      { naturalKey: "TRIAL-1::S1::TEST-1", jobId: "job-1" },
      { naturalKey: "TRIAL-1::S1::TEST-1", jobId: "job-1" }, // a second replicate row, same natural key
    ];
    const findings = detectMissingFromSource(prior, new Set());
    expect(findings).toHaveLength(1);
  });

  it("a row with no natural key at all is never flagged (nothing to compare)", () => {
    const prior: PriorCommittedRow[] = [{ naturalKey: "", jobId: "job-1" }];
    expect(detectMissingFromSource(prior, new Set())).toEqual([]);
  });

  it("an empty prior batch (first-ever import for this template) never produces findings", () => {
    expect(detectMissingFromSource([], new Set(["ANYTHING"]))).toEqual([]);
  });

  it("never mutates its inputs — a pure comparison only", () => {
    const prior: PriorCommittedRow[] = [{ naturalKey: "A", jobId: "job-1" }];
    const priorBefore = JSON.stringify(prior);
    const current = new Set(["B"]);
    detectMissingFromSource(prior, current);
    expect(JSON.stringify(prior)).toBe(priorBefore);
    expect(current.has("B")).toBe(true);
  });
});

describe("COMMITTABLE_ROW_STATES — the one real authority for which states genuinely reached canonical storage", () => {
  it("matches exactly the production dialog's own committable-state list", () => {
    expect(COMMITTABLE_ROW_STATES).toEqual(["valid_create", "valid_update", "unchanged", "warning"]);
  });
});

function base(overrides: Partial<ReimportClassificationInput> = {}): ReimportClassificationInput {
  return { rawRecordFingerprint: "fp-1", mappingProfileCode: "profile::v1", ...overrides };
}

describe("FVL-04.023 Part E — classifyReimport() (RI1-RI9)", () => {
  it("RI1: no prior commit at all -> NEW", () => {
    expect(classifyReimport(base())).toBe("NEW");
  });

  it("RI2: identical raw fingerprint + identical mapping profile -> UNCHANGED", () => {
    const prior: PriorCommittedRow = { naturalKey: "k", jobId: "job-1", rawRecordFingerprint: "fp-1", mappingProfileCode: "profile::v1", targetRecordId: "REC-1" };
    expect(classifyReimport(base({ prior, canonicalStillExists: true }))).toBe("UNCHANGED");
  });

  it("RI3: different raw fingerprint, same profile, canonical unchanged locally -> CHANGED", () => {
    const prior: PriorCommittedRow = { naturalKey: "k", jobId: "job-1", rawRecordFingerprint: "fp-OLD", mappingProfileCode: "profile::v1", targetRecordId: "REC-1", canonicalCandidateFingerprint: "cfp-1" };
    expect(classifyReimport(base({ prior, canonicalStillExists: true, canonicalCurrentFingerprint: "cfp-1" }))).toBe("CHANGED");
  });

  it("RI4: changed source + unchanged canonical -> CHANGED (an update candidate, not a conflict)", () => {
    const prior: PriorCommittedRow = { naturalKey: "k", jobId: "job-1", rawRecordFingerprint: "fp-OLD", mappingProfileCode: "profile::v1", targetRecordId: "REC-1", canonicalCandidateFingerprint: "cfp-SAME" };
    const state = classifyReimport(base({ prior, canonicalStillExists: true, canonicalCurrentFingerprint: "cfp-SAME" }));
    expect(state).toBe("CHANGED");
  });

  it("RI5: changed source + canonical locally edited since prior import -> CANONICAL_LOCAL_CONFLICT, never a silent overwrite", () => {
    const prior: PriorCommittedRow = { naturalKey: "k", jobId: "job-1", rawRecordFingerprint: "fp-OLD", mappingProfileCode: "profile::v1", targetRecordId: "REC-1", canonicalCandidateFingerprint: "cfp-1" };
    const state = classifyReimport(base({ prior, canonicalStillExists: true, canonicalCurrentFingerprint: "cfp-EDITED-BY-HUMAN" }));
    expect(state).toBe("CANONICAL_LOCAL_CONFLICT");
  });

  it("RI5b: canonical locally edited but source UNCHANGED is not a conflict (nothing new to apply)", () => {
    const prior: PriorCommittedRow = { naturalKey: "k", jobId: "job-1", rawRecordFingerprint: "fp-1", mappingProfileCode: "profile::v1", targetRecordId: "REC-1", canonicalCandidateFingerprint: "cfp-1" };
    const state = classifyReimport(base({ prior, canonicalStillExists: true, canonicalCurrentFingerprint: "cfp-EDITED-BY-HUMAN" }));
    expect(state).toBe("UNCHANGED");
  });

  it("RI7: prior crosswalk/commit target no longer exists -> CANONICAL_MISSING", () => {
    const prior: PriorCommittedRow = { naturalKey: "k", jobId: "job-1", rawRecordFingerprint: "fp-1", mappingProfileCode: "profile::v1", targetRecordId: "REC-1" };
    expect(classifyReimport(base({ prior, canonicalStillExists: false }))).toBe("CANONICAL_MISSING");
  });

  it("RI9: same raw record, different mapping profile version -> MAPPING_PROFILE_CHANGED, never silently unchanged", () => {
    const prior: PriorCommittedRow = { naturalKey: "k", jobId: "job-1", rawRecordFingerprint: "fp-1", mappingProfileCode: "profile::v1", targetRecordId: "REC-1" };
    const state = classifyReimport(base({ prior, canonicalStillExists: true, mappingProfileCode: "profile::v2" }));
    expect(state).toBe("MAPPING_PROFILE_CHANGED");
  });

  it("precedence: CANONICAL_MISSING is checked before profile-changed and source-changed", () => {
    const prior: PriorCommittedRow = { naturalKey: "k", jobId: "job-1", rawRecordFingerprint: "fp-OLD", mappingProfileCode: "profile::v1", targetRecordId: "REC-1" };
    const state = classifyReimport(base({ prior, canonicalStillExists: false, mappingProfileCode: "profile::v2" }));
    expect(state).toBe("CANONICAL_MISSING");
  });

  it("precedence: CANONICAL_LOCAL_CONFLICT is checked before MAPPING_PROFILE_CHANGED", () => {
    const prior: PriorCommittedRow = { naturalKey: "k", jobId: "job-1", rawRecordFingerprint: "fp-OLD", mappingProfileCode: "profile::v1", targetRecordId: "REC-1", canonicalCandidateFingerprint: "cfp-1" };
    const state = classifyReimport(base({ prior, canonicalStillExists: true, canonicalCurrentFingerprint: "cfp-EDITED", mappingProfileCode: "profile::v2" }));
    expect(state).toBe("CANONICAL_LOCAL_CONFLICT");
  });
});

describe("fingerprintCanonicalCandidate", () => {
  it("is stable regardless of key order — only values matter", () => {
    const a = fingerprintCanonicalCandidate({ material_code: "M-1", material_name: "Water" });
    const b = fingerprintCanonicalCandidate({ material_name: "Water", material_code: "M-1" });
    expect(a).toBe(b);
  });

  it("changes when a value genuinely changes", () => {
    const a = fingerprintCanonicalCandidate({ material_code: "M-1", material_name: "Water" });
    const b = fingerprintCanonicalCandidate({ material_code: "M-1", material_name: "Purified Water" });
    expect(a).not.toBe(b);
  });
});

describe("isSchemaChanged (RI8)", () => {
  it("true when the profile's own recorded fingerprint no longer matches the current source structure", () => {
    expect(isSchemaChanged("fp-old", "fp-new")).toBe(true);
  });
  it("false when they match", () => {
    expect(isSchemaChanged("fp-1", "fp-1")).toBe(false);
  });
});
