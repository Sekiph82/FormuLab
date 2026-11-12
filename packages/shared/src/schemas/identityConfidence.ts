import { z } from "zod";

export const IDENTITY_CONFIDENCE_STATES = ["EXACT", "HIGH_CONFIDENCE", "PARTIAL", "AMBIGUOUS", "UNKNOWN"] as const;
const IDENTITY_MATCH_KINDS = ["cas", "ec", "material_number"] as const;
const IDENTITY_CONFLICT_CODES = [
  "section_identifier_conflict",
  "invalid_identifier",
  "conflicting_type_evidence",
  "conflicting_source_evidence",
] as const;
const IDENTITY_CONFIDENCE_REASON_CODES = [
  "unique_candidate_with_exact_cas_ec_and_section_agreement",
  "unique_candidate_with_exact_identifier_and_section_agreement",
  "candidate_supported_by_name_alias_only",
  "section_identity_unresolved",
  "source_disclosure_partial",
  "source_disclosure_unknown",
  "no_canonical_candidate_for_exact_identifier",
  "name_alias_is_not_identity_proof",
  "identity_evidence_incomplete",
  "conflicting_identity_evidence",
  "multiple_canonical_candidates",
  "no_identity_evidence",
] as const;

export const identityConfidenceInputSchema = z.object({
  candidateCanonicalIds: z.array(z.string().trim().min(1)),
  exactIdentifierMatches: z.array(z.enum(IDENTITY_MATCH_KINDS)),
  nameAliasMatch: z.boolean(),
  sectionReconciliation: z.enum(["consistent", "conflict", "unresolved", "not_applicable"]),
  disclosureStatus: z.enum(["disclosed", "partial", "unknown"]),
  conflictCodes: z.array(z.enum(IDENTITY_CONFLICT_CODES)).default([]),
  evidenceRefs: z.array(z.string().trim().min(1)),
}).strict().superRefine((input, context) => {
  if (new Set(input.candidateCanonicalIds).size !== input.candidateCanonicalIds.length) {
    context.addIssue({ code: "custom", path: ["candidateCanonicalIds"], message: "Candidate canonical IDs must be unique." });
  }
  if (new Set(input.exactIdentifierMatches).size !== input.exactIdentifierMatches.length) {
    context.addIssue({ code: "custom", path: ["exactIdentifierMatches"], message: "Exact identifier match kinds must be unique." });
  }
  const hasEvidenceClaim = input.candidateCanonicalIds.length > 0 || input.exactIdentifierMatches.length > 0
    || input.nameAliasMatch || input.conflictCodes.length > 0 || input.sectionReconciliation !== "not_applicable"
    || input.disclosureStatus !== "unknown";
  if (hasEvidenceClaim && input.evidenceRefs.length === 0) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Identity evidence decisions require source references." });
  }
});

export const identityConfidenceResultSchema = z.object({
  state: z.enum(IDENTITY_CONFIDENCE_STATES),
  candidateCanonicalIds: z.array(z.string().trim().min(1)),
  reasonCodes: z.array(z.enum(IDENTITY_CONFIDENCE_REASON_CODES)).min(1),
  evidenceRefs: z.array(z.string().trim().min(1)),
}).strict().superRefine((result, context) => {
  const allowedReasonsByState: Record<typeof IDENTITY_CONFIDENCE_STATES[number], readonly string[]> = {
    EXACT: ["unique_candidate_with_exact_cas_ec_and_section_agreement"],
    HIGH_CONFIDENCE: ["unique_candidate_with_exact_identifier_and_section_agreement"],
    PARTIAL: ["candidate_supported_by_name_alias_only", "section_identity_unresolved", "source_disclosure_partial", "source_disclosure_unknown", "no_canonical_candidate_for_exact_identifier", "name_alias_is_not_identity_proof", "identity_evidence_incomplete"],
    AMBIGUOUS: ["conflicting_identity_evidence", "multiple_canonical_candidates"],
    UNKNOWN: ["no_identity_evidence"],
  };
  if (result.reasonCodes.some((reason) => !allowedReasonsByState[result.state].includes(reason))) {
    context.addIssue({ code: "custom", path: ["reasonCodes"], message: `Reason codes do not match ${result.state} confidence.` });
  }
  if (result.state !== "PARTIAL" && result.reasonCodes.length !== 1) {
    context.addIssue({ code: "custom", path: ["reasonCodes"], message: `${result.state} confidence requires exactly one reason code.` });
  }
  if (result.state === "PARTIAL") {
    const reasons = new Set(result.reasonCodes);
    if (reasons.has("source_disclosure_partial") && reasons.has("source_disclosure_unknown")) {
      context.addIssue({ code: "custom", path: ["reasonCodes"], message: "A source cannot be both partially and unknown disclosed." });
    }
    if (reasons.has("candidate_supported_by_name_alias_only")
      && (result.candidateCanonicalIds.length !== 1 || !reasons.has("name_alias_is_not_identity_proof"))) {
      context.addIssue({ code: "custom", path: ["reasonCodes"], message: "Name-alias candidate reasons require one candidate and an explicit non-proof reason." });
    }
    if (reasons.has("no_canonical_candidate_for_exact_identifier") && result.candidateCanonicalIds.length !== 0) {
      context.addIssue({ code: "custom", path: ["reasonCodes"], message: "An unmatched exact identifier cannot include a canonical candidate." });
    }
    if (reasons.has("identity_evidence_incomplete") && result.reasonCodes.length !== 1) {
      context.addIssue({ code: "custom", path: ["reasonCodes"], message: "Generic incomplete evidence cannot be combined with specific reasons." });
    }
  }
  if (result.state !== "UNKNOWN" && result.evidenceRefs.length === 0) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Identity confidence results require source references." });
  }
  if (["EXACT", "HIGH_CONFIDENCE"].includes(result.state) && result.candidateCanonicalIds.length !== 1) {
    context.addIssue({ code: "custom", path: ["candidateCanonicalIds"], message: `${result.state} confidence requires exactly one canonical candidate.` });
  }
  if (result.state === "EXACT" && !result.reasonCodes.includes("unique_candidate_with_exact_cas_ec_and_section_agreement")) {
    context.addIssue({ code: "custom", path: ["reasonCodes"], message: "EXACT confidence requires exact CAS/EC and section agreement." });
  }
  if (result.state === "HIGH_CONFIDENCE" && !result.reasonCodes.includes("unique_candidate_with_exact_identifier_and_section_agreement")) {
    context.addIssue({ code: "custom", path: ["reasonCodes"], message: "HIGH_CONFIDENCE requires an exact identifier and section agreement." });
  }
  if (result.state === "AMBIGUOUS" && result.candidateCanonicalIds.length < 2 && !result.reasonCodes.includes("conflicting_identity_evidence")) {
    context.addIssue({ code: "custom", path: ["reasonCodes"], message: "AMBIGUOUS confidence requires multiple candidates or an explicit conflict reason." });
  }
});

export type IdentityConfidenceInput = z.input<typeof identityConfidenceInputSchema>;
export type IdentityConfidenceResult = z.infer<typeof identityConfidenceResultSchema>;

/** Deterministic, reasoned confidence state; no numeric score or inferred chemical identity is created. */
export function classifyIdentityConfidence(input: IdentityConfidenceInput): IdentityConfidenceResult {
  const parsed = identityConfidenceInputSchema.parse(input);
  let state: typeof IDENTITY_CONFIDENCE_STATES[number];
  let reasonCodes: string[];
  const hasConflict = parsed.conflictCodes.length > 0 || parsed.sectionReconciliation === "conflict";
  if (hasConflict) {
    state = "AMBIGUOUS";
    reasonCodes = ["conflicting_identity_evidence"];
  } else if (parsed.candidateCanonicalIds.length > 1) {
    state = "AMBIGUOUS";
    reasonCodes = ["multiple_canonical_candidates"];
  } else if (parsed.candidateCanonicalIds.length === 1
    && parsed.exactIdentifierMatches.includes("cas")
    && parsed.exactIdentifierMatches.includes("ec")
    && parsed.sectionReconciliation === "consistent"
    && parsed.disclosureStatus === "disclosed") {
    state = "EXACT";
    reasonCodes = ["unique_candidate_with_exact_cas_ec_and_section_agreement"];
  } else if (parsed.candidateCanonicalIds.length === 1
    && parsed.exactIdentifierMatches.length > 0
    && parsed.sectionReconciliation === "consistent"
    && parsed.disclosureStatus === "disclosed") {
    state = "HIGH_CONFIDENCE";
    reasonCodes = ["unique_candidate_with_exact_identifier_and_section_agreement"];
  } else if (parsed.candidateCanonicalIds.length === 1 || parsed.exactIdentifierMatches.length > 0 || parsed.nameAliasMatch) {
    state = "PARTIAL";
    reasonCodes = [];
    if (parsed.candidateCanonicalIds.length === 1 && parsed.exactIdentifierMatches.length === 0 && parsed.nameAliasMatch) reasonCodes.push("candidate_supported_by_name_alias_only");
    if (parsed.sectionReconciliation === "unresolved") reasonCodes.push("section_identity_unresolved");
    if (parsed.disclosureStatus === "partial") reasonCodes.push("source_disclosure_partial");
    if (parsed.disclosureStatus === "unknown") reasonCodes.push("source_disclosure_unknown");
    if (parsed.exactIdentifierMatches.length > 0 && parsed.candidateCanonicalIds.length === 0) reasonCodes.push("no_canonical_candidate_for_exact_identifier");
    if (parsed.nameAliasMatch && parsed.exactIdentifierMatches.length === 0) reasonCodes.push("name_alias_is_not_identity_proof");
    if (reasonCodes.length === 0) reasonCodes.push("identity_evidence_incomplete");
  } else {
    state = "UNKNOWN";
    reasonCodes = ["no_identity_evidence"];
  }
  return identityConfidenceResultSchema.parse({
    state,
    candidateCanonicalIds: parsed.candidateCanonicalIds,
    reasonCodes,
    evidenceRefs: [...new Set(parsed.evidenceRefs)],
  });
}
