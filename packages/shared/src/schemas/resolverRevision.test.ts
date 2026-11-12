import { describe, expect, it } from "vitest";
import { createReferenceFormulaMappingRevision, createResolverResolutionRevision, type ResolverResolutionRevision } from "./resolverRevision";
import { recordIdentityFieldReview } from "./identityFieldReview";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";
import type { Actor } from "./status";

const source = (id: string, hash: string) => supplierSdsProductEvidenceSchema.parse({
  schemaVersion: "1.0", id, commercialProductId: "product-1",
  section1: { sectionNumber: 1, sourceDocumentHash: hash, declaredChemicalName: { id: `${id}-name`, rawValue: "Example grade", evidenceRefs: [`${id}:s1`] } },
  section3: { sectionNumber: 3, sourceDocumentHash: hash, components: [] },
});
const actor: Actor = { kind: "human", role: "raw_material", userId: "reviewer-1" };
const revision = (id: string, sourceId: string, hash: string, date: string, snapshot: unknown, previous?: ResolverResolutionRevision) => createResolverResolutionRevision({
  id, source: source(sourceId, hash), resolverKind: "single_component", sourceRevisionDate: date,
  resolutionSnapshot: JSON.stringify(snapshot), createdAt: `${date}T12:00:00.000Z`, previous,
});

describe("resolver evidence revision lineage", () => {
  it("appends newer SDS resolution evidence and marks changed candidates for review without mutating history", () => {
    const first = revision("resolution-1", "sds-1", "a".repeat(64), "2025-01-01", { canonicalId: "chem-a" });
    const second = revision("resolution-2", "sds-2", "b".repeat(64), "2026-01-01", { canonicalId: "chem-b" }, first);
    expect(second).toMatchObject({ revision: 2, previousResolutionId: first.id, comparisonToPrior: "changed", reviewStatus: "needs_review" });
    expect(first).toMatchObject({ revision: 1, sourceEvidenceId: "sds-1", resolutionSnapshot: JSON.stringify({ canonicalId: "chem-a" }) });
    expect(() => revision("resolution-duplicate", "sds-3", "a".repeat(64), "2026-01-01", { canonicalId: "chem-b" }, first))
      .toThrow(/identical SDS document hash/);
  });

  it("keeps unordered or older source evidence unresolved and distinguishes unchanged candidates", () => {
    const first = revision("resolution-1", "sds-1", "a".repeat(64), "2025-01-01", { canonicalId: "chem-a" });
    expect(revision("resolution-2", "sds-2", "b".repeat(64), "2024-01-01", { canonicalId: "chem-a" }, first).comparisonToPrior).toBe("source_not_newer");
    expect(revision("resolution-3", "sds-3", "c".repeat(64), "2026-01-01", { canonicalId: "chem-a" }, first).comparisonToPrior).toBe("unchanged");
    expect(createResolverResolutionRevision({ id: "resolution-4", source: source("sds-4", "d".repeat(64)), resolverKind: "single_component", resolutionSnapshot: "{}", createdAt: "2026-01-01T00:00:00.000Z", previous: first }).comparisonToPrior).toBe("source_order_unknown");
  });

  it("updates a formula-line mapping only as a new revision with matching accepted human review", () => {
    const resolution = revision("resolution-1", "sds-1", "a".repeat(64), "2026-01-01", { canonicalId: "chem-a" });
    const review = recordIdentityFieldReview({
      id: "review-1", commercialProductId: "product-1", sourceEvidenceId: "sds-1", targetRecordId: "mapping-1",
      field: "canonical_identity", decision: "accepted", proposedValueSnapshot: JSON.stringify({ canonicalId: "chem-a" }),
      evidenceRefs: ["sds-1:s1"], reviewedAt: "2026-01-01T13:00:00.000Z",
    }, actor);
    const mapping = createReferenceFormulaMappingRevision({
      resolution, review, reviewer: actor, formulaId: "formula-1", formulaLineId: "line-1", mappingId: "mapping-1", id: "mapping-rev-1",
      normalizedMappingSnapshot: JSON.stringify({ canonicalId: "chem-a" }), reviewedAt: "2026-01-01T13:00:00.000Z",
    });
    const secondResolution = revision("resolution-2", "sds-2", "b".repeat(64), "2026-01-01", { canonicalId: "chem-b" }, resolution);
    const secondReview = recordIdentityFieldReview({
      ...review, id: "review-2", sourceEvidenceId: "sds-2", proposedValueSnapshot: JSON.stringify({ canonicalId: "chem-b" }), evidenceRefs: ["sds-2:s1"],
    }, actor);
    const updated = createReferenceFormulaMappingRevision({
      prior: mapping, resolution: secondResolution, review: secondReview, reviewer: actor,
      formulaId: "formula-1", formulaLineId: "line-1", mappingId: "mapping-1", id: "mapping-rev-2",
      normalizedMappingSnapshot: JSON.stringify({ canonicalId: "chem-b" }), reviewedAt: "2026-01-01T14:00:00.000Z",
    });
    expect(updated).toMatchObject({ revision: 2, previousMappingRevisionId: mapping.id, resolverRevisionId: "resolution-2" });
    expect(mapping.normalizedMappingSnapshot).toBe(JSON.stringify({ canonicalId: "chem-a" }));
    expect(() => createReferenceFormulaMappingRevision({
      resolution, review: { ...review, decision: "needs_review", decisionNote: "More evidence is needed." }, reviewer: actor, formulaId: "formula-1", formulaLineId: "line-1", mappingId: "mapping-2", id: "bad",
      normalizedMappingSnapshot: "{}", reviewedAt: "2026-01-01T13:00:00.000Z",
    })).toThrow(/accepted identity review/);
    expect(() => createReferenceFormulaMappingRevision({
      resolution, review, reviewer: actor, formulaId: "formula-1", formulaLineId: "line-1", mappingId: "mapping-1", id: "bad-value",
      normalizedMappingSnapshot: JSON.stringify({ canonicalId: "chem-b" }), reviewedAt: "2026-01-01T13:00:00.000Z",
    })).toThrow(/exactly match/);
    const wrongTargetReview = recordIdentityFieldReview({ ...review, id: "wrong-target", targetRecordId: "another-mapping" }, actor);
    expect(() => createReferenceFormulaMappingRevision({
      resolution, review: wrongTargetReview, reviewer: actor, formulaId: "formula-1", formulaLineId: "line-1", mappingId: "mapping-1", id: "wrong-scope",
      normalizedMappingSnapshot: JSON.stringify({ canonicalId: "chem-a" }), reviewedAt: "2026-01-01T13:00:00.000Z",
    })).toThrow(/same product and resolver source evidence/);
    expect(() => createReferenceFormulaMappingRevision({
      resolution, review, reviewer: { kind: "human", role: "researcher", userId: "other-user" }, formulaId: "formula-1", formulaLineId: "line-1", mappingId: "mapping-1", id: "unauthorized",
      normalizedMappingSnapshot: JSON.stringify({ canonicalId: "chem-a" }), reviewedAt: "2026-01-01T13:00:00.000Z",
    })).toThrow(/same currently authorized human/);
  });
});
