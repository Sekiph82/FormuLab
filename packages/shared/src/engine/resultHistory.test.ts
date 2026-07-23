import { describe, expect, it } from "vitest";
import {
  buildResultRevisionChain,
  compareResultRevisions,
  groupRetestLineage,
  resolveAttachmentReplacementChain,
  resolveEffectiveResultRevision,
} from "./resultHistory";
import type { HistoricalResult } from "./resultHistory";
import type { AttachmentReference } from "../schemas/testDefinitions";

const NOW = "2026-01-01T00:00:00.000Z";

function result(over: Partial<HistoricalResult> = {}): HistoricalResult {
  return {
    id: "r1",
    attachments: [],
    performedBy: "alice",
    performedAt: NOW,
    passFail: "pass",
    replicates: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function attachment(over: Partial<AttachmentReference> = {}): AttachmentReference {
  return {
    id: "att-1",
    kind: "document",
    title: "file.pdf",
    location: "attachments/att-1.pdf",
    ...over,
  };
}

describe("buildResultRevisionChain", () => {
  it("a single, unrevised result is a chain of one", () => {
    const r = result();
    const { chain, warnings } = buildResultRevisionChain([r], "r1");
    expect(chain).toEqual([r]);
    expect(warnings).toEqual([]);
  });

  it("walks a multi-revision chain oldest-first", () => {
    const r1 = result({ id: "r1" });
    const r2 = result({ id: "r2", revisesResultId: "r1" });
    const r3 = result({ id: "r3", revisesResultId: "r2" });
    // Starting from any member of the chain reaches the same full chain.
    for (const startId of ["r1", "r2", "r3"]) {
      const { chain, warnings } = buildResultRevisionChain([r3, r1, r2], startId);
      expect(chain.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
      expect(warnings).toEqual([]);
    }
  });

  it("reports a missing parent revision honestly instead of crashing", () => {
    const r2 = result({ id: "r2", revisesResultId: "ghost" });
    const { chain, warnings } = buildResultRevisionChain([r2], "r2");
    expect(chain.map((r) => r.id)).toEqual(["r2"]);
    expect(warnings[0]).toMatch(/not found/);
  });

  it("detects a circular revision reference and stops instead of looping forever", () => {
    const r1 = result({ id: "r1", revisesResultId: "r2" });
    const r2 = result({ id: "r2", revisesResultId: "r1" });
    const { warnings } = buildResultRevisionChain([r1, r2], "r1");
    expect(warnings.some((w) => w.includes("Circular"))).toBe(true);
  });

  it("keeps only the first occurrence of a duplicate revision id, with a warning", () => {
    const original = result({ id: "r1", performedBy: "alice" });
    const duplicate = result({ id: "r1", performedBy: "mallory" });
    const { chain, warnings } = buildResultRevisionChain([original, duplicate], "r1");
    expect(chain).toHaveLength(1);
    expect(chain[0].performedBy).toBe("alice");
    expect(warnings[0]).toMatch(/Duplicate revision id/);
  });

  it("returns an honest empty result for an id not present at all", () => {
    const { chain, warnings } = buildResultRevisionChain([result({ id: "r1" })], "does-not-exist");
    expect(chain).toEqual([]);
    expect(warnings[0]).toMatch(/not found/);
  });
});

describe("resolveEffectiveResultRevision", () => {
  it("is the newest (last) entry in the chain", () => {
    const r1 = result({ id: "r1" });
    const r2 = result({ id: "r2", revisesResultId: "r1" });
    const { chain } = buildResultRevisionChain([r1, r2], "r1");
    expect(resolveEffectiveResultRevision(chain)?.id).toBe("r2");
  });

  it("is undefined for an empty chain", () => {
    expect(resolveEffectiveResultRevision([])).toBeUndefined();
  });
});

describe("groupRetestLineage", () => {
  it("a result with no retestOf is its own lineage root", () => {
    const r = result({ id: "r1" });
    const { groups, warnings } = groupRetestLineage([r]);
    expect(groups).toEqual([{ rootId: "r1", results: [r] }]);
    expect(warnings).toEqual([]);
  });

  it("groups a retest under its original sample's result", () => {
    const original = result({ id: "r1" });
    const retest = result({ id: "r2", retestOf: "r1" });
    const { groups } = groupRetestLineage([original, retest]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rootId).toBe("r1");
    expect(groups[0].results.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("an orphan retest (retestOf points nowhere) becomes its own lineage, with a warning", () => {
    const orphan = result({ id: "r2", retestOf: "ghost" });
    const { groups, warnings } = groupRetestLineage([orphan]);
    expect(groups).toEqual([{ rootId: "r2", results: [orphan] }]);
    expect(warnings[0]).toMatch(/not found/);
  });
});

describe("compareResultRevisions", () => {
  it("reports a human override's reason as changed", () => {
    const a = result({ override: undefined });
    const b = result({ override: { reviewerId: "qa-1", reason: "Outlier excluded per SOP.", at: NOW, originalEvaluation: "fail", overriddenEvaluation: "pass" } });
    const diff = compareResultRevisions(a, b);
    expect(diff.overrideReason.changed).toBe(true);
    expect(diff.overrideReason.b).toBe("Outlier excluded per SOP.");
  });

  it("reports no differences between two identical revisions", () => {
    const a = result();
    const b = result();
    const diff = compareResultRevisions(a, b);
    expect(diff.passFail.changed).toBe(false);
    expect(diff.reviewedBy.changed).toBe(false);
    expect(diff.overrideReason.changed).toBe(false);
    expect(diff.attachmentsAdded).toEqual([]);
    expect(diff.attachmentsRemoved).toEqual([]);
  });

  it("reports mean/min/max/stddev/CV differences from stats", () => {
    const a = result({ stats: { count: 2, mean: "7.0", minimum: "6.9", maximum: "7.1", standardDeviation: "0.1", coefficientOfVariationPercent: "1.4" } });
    const b = result({ stats: { count: 2, mean: "7.5", minimum: "7.4", maximum: "7.6", standardDeviation: "0.1", coefficientOfVariationPercent: "1.3" } });
    const diff = compareResultRevisions(a, b);
    expect(diff.mean).toEqual({ a: "7.0", b: "7.5" });
    expect(diff.minimum).toEqual({ a: "6.9", b: "7.4" });
    expect(diff.maximum).toEqual({ a: "7.1", b: "7.6" });
    expect(diff.coefficientOfVariationPercent).toEqual({ a: "1.4", b: "1.3" });
  });

  it("reports attachments added and removed between two revisions", () => {
    const kept = attachment({ id: "kept" });
    const removed = attachment({ id: "removed" });
    const added = attachment({ id: "added" });
    const a = result({ attachments: [kept, removed] });
    const b = result({ attachments: [kept, added] });
    const diff = compareResultRevisions(a, b);
    expect(diff.attachmentsAdded.map((x) => x.id)).toEqual(["added"]);
    expect(diff.attachmentsRemoved.map((x) => x.id)).toEqual(["removed"]);
  });
});

describe("resolveAttachmentReplacementChain", () => {
  it("a single attachment with no replacement is its own one-entry chain", () => {
    const a = attachment({ id: "a1" });
    const { chains, warnings } = resolveAttachmentReplacementChain([a]);
    expect(chains).toEqual([{ chain: [a] }]);
    expect(warnings).toEqual([]);
  });

  it("resolves a replacement chain oldest-first and marks nothing as lost", () => {
    const original = attachment({ id: "a1" });
    const replacement = attachment({ id: "a2", replacesAttachmentId: "a1" });
    const { chains, warnings } = resolveAttachmentReplacementChain([original, replacement]);
    expect(chains).toHaveLength(1);
    expect(chains[0].chain.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(warnings).toEqual([]);
  });

  it("a superseded attachment remains in the chain, never dropped", () => {
    const original = attachment({ id: "a1" });
    const replacement = attachment({ id: "a2", replacesAttachmentId: "a1" });
    const { chains } = resolveAttachmentReplacementChain([original, replacement]);
    expect(chains[0].chain.some((a) => a.id === "a1")).toBe(true);
  });

  it("a dangling replacesAttachmentId reference is reported, not silently dropped", () => {
    const dangling = attachment({ id: "a2", replacesAttachmentId: "ghost" });
    const { chains, warnings } = resolveAttachmentReplacementChain([dangling]);
    expect(chains).toEqual([{ chain: [dangling] }]);
    expect(warnings[0]).toMatch(/not found/);
  });

  it("detects a circular attachment-replacement reference", () => {
    const a1 = attachment({ id: "a1", replacesAttachmentId: "a2" });
    const a2 = attachment({ id: "a2", replacesAttachmentId: "a1" });
    const { warnings } = resolveAttachmentReplacementChain([a1, a2]);
    expect(warnings.some((w) => w.includes("Circular"))).toBe(true);
  });
});
