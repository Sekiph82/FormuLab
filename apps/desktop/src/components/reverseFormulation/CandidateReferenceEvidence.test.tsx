import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { GeneratedCandidate } from "@formulab/shared";
import { CandidateReferenceEvidence } from "./CandidateComparisonPanel";

describe("candidate reference evidence", () => {
  it("shows reviewed prior counts, supplier mix, dosage ranges, similar references, and source links", () => {
    const candidate = {
      formula: [], estimatedProperties: {}, matchScore: 0, notes: [], referenceProductFamilyKey: "hand_dishwash",
      referenceSupportQuality: {
        status: "BROAD", policyVersion: "formulab-reference-support-quality-v1", familyFormulaCount: 10,
        eligibleFormulaCount: 10, supplierCount: 3, identityResolvedFormulaCount: 9, identityResolutionPercent: 90,
        ingredientLineCount: 25, sourceCitedIngredientLineCount: 24, sourceCitationCoveragePercent: 96,
        interpretation: "deterministic_reviewed_corpus_sample_resolution_and_source_coverage_not_ai_confidence_or_validation",
      },
      ingredientGuidance: [{
        materialId: "RM-SURF-1", canonicalChemistryId: "chem-surf-1", formulaCount: 2, eligibleFormulaCount: 4,
        formulaWeightedFrequency: 0.5, supplierNeutralFrequency: 0.625, supplierCount: 2,
        suppliers: [
          { supplierId: "supplier-a", eligibleFormulaCount: 2, ingredientFormulaCount: 1, frequency: 0.5, sourceRecordIds: ["ref-a"] },
          { supplierId: "supplier-b", eligibleFormulaCount: 2, ingredientFormulaCount: 1, frequency: 0.5, sourceRecordIds: ["ref-b"] },
        ],
        sourceRecordIds: ["ref-a", "ref-b"],
        interpretation: "reviewed_formula_appearance_only_not_suitability_safety_compatibility_or_efficacy",
      }],
      dosageGuidance: [{
        asOf: "2026-10-26T12:00:00.000Z", materialId: "RM-SURF-1", canonicalChemistryId: "chem-surf-1",
        functionAssignment: "unassigned_or_unreviewed", candidatePercent: 5, typicalRangePercent: { lower: 3, upper: 7 },
        observedRangePercent: { lower: 2, upper: 8 }, position: "within_typical_range", formulaCount: 2, supplierCount: 2,
        suppliers: [
          { supplierId: "supplier-a", formulaCount: 1, share: 0.5, sourceRecordIds: ["ref-a"] },
          { supplierId: "supplier-b", formulaCount: 1, share: 0.5, sourceRecordIds: ["ref-b"] },
        ],
        sourceRecordIds: ["ref-a", "ref-b"],
        interpretation: "advisory_reviewed_empirical_dosage_not_hard_constraint_or_validated_recommendation",
      }],
      nearestReferenceGuidance: [{
        sourceRecordId: "ref-near", sourceDocumentHash: "a".repeat(64), distance: 0.2, similarity: 0.8,
        featureCoverage: 0.75, contributingFeatureKeys: ["ingredient:chem-surf-1"], evidenceRefs: ["formula:hash:line-1"],
        interpretation: "supplier_neutral_reference_similarity_not_validation_or_compatibility",
      }],
    } satisfies GeneratedCandidate;

    render(<MemoryRouter><CandidateReferenceEvidence candidate={candidate} /></MemoryRouter>);

    expect(screen.getByRole("region", { name: "Reviewed reference evidence" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("not measured validation or a prediction of candidate performance");
    expect(screen.getByText("hand_dishwash")).toBeInTheDocument();
    expect(screen.getByText("Reference support: BROAD")).toBeInTheDocument();
    expect(screen.getByText(/10 family records; 10 fully eligible reviewed formulas across 3 suppliers; identity resolved 9\/10 \(90.0%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Deterministic tiers: BROAD/)).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 4 reviewed formulas/)).toBeInTheDocument();
    expect(screen.getByText(/Supplier sample mix: supplier-a \(1\/2, 50.0%\), supplier-b \(1\/2, 50.0%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Candidate 5.00% w\/w; typical 3.00–7.00%/)).toBeInTheDocument();
    expect(screen.getByText(/80.0% similarity; 75.0% feature coverage/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ref-near" })).toHaveAttribute("href", "/reference-formulations/ref-near");
    expect(screen.getAllByRole("link", { name: "ref-a" })).toHaveLength(2);
  });

  it("does not invent a reference panel when no reviewed reference metadata exists", () => {
    const candidate = { formula: [], estimatedProperties: {}, matchScore: 0, notes: [] } satisfies GeneratedCandidate;
    const { container } = render(<MemoryRouter><CandidateReferenceEvidence candidate={candidate} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
