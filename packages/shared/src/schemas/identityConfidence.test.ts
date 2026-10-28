import { describe, expect, it } from "vitest";
import { classifyIdentityConfidence, identityConfidenceResultSchema, type IdentityConfidenceInput, type IdentityConfidenceResult } from "./identityConfidence";

const evidenceRef = ["sds:section1:4", "sds:section3:1"];
const base = {
  candidateCanonicalIds: ["chemical-1"],
  exactIdentifierMatches: ["cas", "ec"] as Array<"cas" | "ec" | "material_number">,
  nameAliasMatch: true,
  sectionReconciliation: "consistent" as const,
  disclosureStatus: "disclosed" as const,
  conflictCodes: [],
  evidenceRefs: evidenceRef,
};

describe("identity confidence engine", () => {
  const cases: Array<{ state: IdentityConfidenceResult["state"]; input: IdentityConfidenceInput; reason: string }> = [
    { state: "EXACT", input: base, reason: "unique_candidate_with_exact_cas_ec_and_section_agreement" },
    { state: "HIGH_CONFIDENCE", input: { ...base, exactIdentifierMatches: ["cas"] }, reason: "unique_candidate_with_exact_identifier_and_section_agreement" },
    { state: "PARTIAL", input: { ...base, exactIdentifierMatches: [], sectionReconciliation: "unresolved" }, reason: "section_identity_unresolved" },
    { state: "AMBIGUOUS", input: { ...base, candidateCanonicalIds: ["chemical-1", "chemical-2"] }, reason: "multiple_canonical_candidates" },
    { state: "AMBIGUOUS", input: { ...base, conflictCodes: ["section_identifier_conflict"] }, reason: "conflicting_identity_evidence" },
    { state: "UNKNOWN", input: { ...base, candidateCanonicalIds: [], exactIdentifierMatches: [], nameAliasMatch: false, sectionReconciliation: "not_applicable" }, reason: "no_identity_evidence" },
  ];

  it.each(cases)("classifies $state from deterministic cited evidence", ({ state, input, reason }) => {
    const result = classifyIdentityConfidence(input);
    expect(result.state).toBe(state);
    expect(result.reasonCodes).toContain(reason);
    expect(result.evidenceRefs).toEqual(evidenceRef);
  });

  it("does not treat a name-only match as exact and refuses uncited evidence claims", () => {
    expect(classifyIdentityConfidence({
      ...base,
      exactIdentifierMatches: [],
      nameAliasMatch: true,
      sectionReconciliation: "not_applicable",
    })).toMatchObject({ state: "PARTIAL", reasonCodes: ["candidate_supported_by_name_alias_only", "name_alias_is_not_identity_proof"] });
    expect(() => classifyIdentityConfidence({ ...base, evidenceRefs: [] })).toThrow(/require source references/);
    expect(() => classifyIdentityConfidence({ ...base, candidateCanonicalIds: ["chemical-1", "chemical-1"] })).toThrow(/must be unique/);
  });

  it("rejects unsupported hand-built high-confidence results", () => {
    expect(() => identityConfidenceResultSchema.parse({
      state: "EXACT",
      candidateCanonicalIds: ["chemical-1"],
      reasonCodes: ["unique_candidate_with_exact_cas_ec_and_section_agreement"],
      evidenceRefs: [],
    })).toThrow(/source references/);
    expect(() => identityConfidenceResultSchema.parse({
      state: "EXACT",
      candidateCanonicalIds: ["chemical-1"],
      reasonCodes: ["unique_candidate_with_exact_cas_ec_and_section_agreement", "multiple_canonical_candidates"],
      evidenceRefs: evidenceRef,
    })).toThrow(/do not match EXACT/);
    expect(() => identityConfidenceResultSchema.parse({
      state: "PARTIAL",
      candidateCanonicalIds: ["chemical-1"],
      reasonCodes: ["source_disclosure_partial", "source_disclosure_unknown"],
      evidenceRefs: evidenceRef,
    })).toThrow(/both partially and unknown/);
    expect(() => identityConfidenceResultSchema.parse({
      state: "PARTIAL",
      candidateCanonicalIds: [],
      reasonCodes: ["candidate_supported_by_name_alias_only", "name_alias_is_not_identity_proof"],
      evidenceRefs: evidenceRef,
    })).toThrow(/require one candidate/);
  });
});
