/**
 * FVL-04.023 — Incremental Re-import / Conflict Handling acceptance.
 */
import { describe, expect, it } from "vitest";
import { COMMITTABLE_ROW_STATES, detectMissingFromSource, type PriorCommittedRow } from "./dataExchangeIncremental";

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
