import { describe, expect, it } from "vitest";
import { activeMatterEvidenceSchema, createActiveMatterEvidence, validateActiveMatterEvidenceAgainstSource, type AuthorizedProductClaimInput } from "./activeMatterEvidence";

const claim = (overrides: Partial<AuthorizedProductClaimInput> = {}): AuthorizedProductClaimInput => ({
  schemaVersion: "1.0",
  id: "claim-1",
  commercialProductId: "product-1",
  sourceDocumentType: "TDS",
  sourceDocumentHash: "a".repeat(64),
  sourceEvidenceId: "tds-1",
  sourceFactId: "tds-fact-1",
  quantityKind: "active_matter",
  explicitPropertyLabel: "Active matter (as supplied)",
  originalValue: "38-42%",
  basis: "as_supplied",
  evidenceRefs: ["tds:p2:active-matter"],
  ...overrides,
});

describe("explicit active matter, solids and assay evidence", () => {
  it("normalizes only explicitly labeled cited percent claims and retains their source context", () => {
    expect(createActiveMatterEvidence(claim())).toMatchObject({
      quantityKind: "active_matter",
      percent: { lowerBound: 38, upperBound: 42, interpretation: "range" },
      sourceDocumentType: "TDS",
      originalValue: "38-42%",
      basis: "as_supplied",
      provenanceStatus: "provisional",
      reviewRequired: true,
      evidenceRefs: ["tds:p2:active-matter"],
    });
    expect(createActiveMatterEvidence(claim({ quantityKind: "solids_content", explicitPropertyLabel: "Total solids content", originalValue: "10%" })).percent)
      .toEqual({ lowerBound: 10, upperBound: 10, interpretation: "exact" });
    expect(createActiveMatterEvidence(claim({ quantityKind: "assay", explicitPropertyLabel: "Purity assay", originalValue: "reported as high" })).percent)
      .toEqual({ interpretation: "unparsed" });
  });

  it("rejects hazard-disclosure ranges and labels that do not explicitly support the claimed quantity", () => {
    expect(() => createActiveMatterEvidence(claim({ sourceDocumentType: "SDS", sourceSectionNumber: 3 })))
      .toThrow(/Section 3 hazard-disclosure composition/);
    expect(() => createActiveMatterEvidence(claim({ explicitPropertyLabel: "Composition range", originalValue: "38-42%" })))
      .toThrow(/must explicitly identify active_matter/);
    expect(() => createActiveMatterEvidence(claim({ explicitPropertyLabel: "Non-active matter" })))
      .toThrow(/must explicitly identify active_matter/);
    expect(() => createActiveMatterEvidence(claim({ sourceDocumentType: "OTHER_AUTHORIZED" })))
      .toThrow(/authorization reference/);
    expect(() => activeMatterEvidenceSchema.parse({
      ...createActiveMatterEvidence(claim()),
      percent: { lowerBound: 10, upperBound: 20, interpretation: "exact" },
    })).toThrow(/bounds are inconsistent/);
  });

  it("keeps claims provisional and verifies persisted lineage against the extracted source claim", () => {
    const sourceClaim = claim();
    const record = createActiveMatterEvidence(sourceClaim);
    expect(validateActiveMatterEvidenceAgainstSource(record, sourceClaim)).toEqual(record);
    expect(() => validateActiveMatterEvidenceAgainstSource({ ...record, sourceFactId: "forged" }, sourceClaim))
      .toThrow(/lineage does not match/);
  });
});
