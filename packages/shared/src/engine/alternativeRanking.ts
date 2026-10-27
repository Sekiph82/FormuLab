import {
  ALTERNATIVE_RANKING_POLICY_VERSION,
  ALTERNATIVE_RANKING_SCHEMA_VERSION,
  RANKING_DIMENSION_ORDER,
  alternativeRankingRecordSchema,
  type AlternativeRankingCandidate,
  type AlternativeRankingRecord,
  type RankedAlternative,
} from "../schemas/alternativeRanking";
import { CANONICALIZATION_ALGORITHM, DIGEST_ALGORITHM } from "../schemas/datasetManifest";
import { canonicalizeForFingerprint, sha256Hex } from "./datasetManifestBuilder";

/** Versioned lexicographic policy. Hard gates run before these preferences;
 * no values are combined, weighted, or converted into an opaque score. */
export const ALTERNATIVE_RANKING_POLICY = {
  version: ALTERNATIVE_RANKING_POLICY_VERSION,
  dimensionOrder: RANKING_DIMENSION_ORDER,
  hardGateDimensions: ["availability", "compatibility", "safety", "regulatory", "manufacturing"] as const,
  gateOrder: ["ELIGIBLE", "REVIEW_REQUIRED", "BLOCKED", "UNAVAILABLE"] as const,
  tieBreak: "candidateId_ordinal_ascending" as const,
};

function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function gate(candidate: AlternativeRankingCandidate): Pick<RankedAlternative, "disposition" | "gateReasons"> {
  const reasons: string[] = [];
  if (candidate.formulaStatus === "UNAVAILABLE") reasons.push("FORMULA_UNAVAILABLE");
  else if (candidate.formulaStatus === "INVALID") reasons.push("FORMULA_INVALID");
  else if (candidate.formulaStatus === "INCOMPLETE") reasons.push("FORMULA_INCOMPLETE_REVIEW");
  for (const dimension of ["compatibility", "safety", "regulatory"] as const) {
    const status = candidate.dimensions[dimension].status;
    if (status === "FAIL") reasons.push(`${dimension.toUpperCase()}_FAIL`);
    else if (status === "UNKNOWN") reasons.push(`${dimension.toUpperCase()}_NOT_CONFIRMED_PASS`);
    else if (status === "WARNING") reasons.push(`${dimension.toUpperCase()}_WARNING_REVIEW`);
  }
  const availability = candidate.dimensions.availability.status;
  if (availability === "INFEASIBLE") reasons.push("AVAILABILITY_INFEASIBLE");
  else if (availability === "UNKNOWN") reasons.push("AVAILABILITY_NOT_CONFIRMED_FEASIBLE");
  const manufacturing = candidate.dimensions.manufacturing.status;
  if (manufacturing === "NOT_READY") reasons.push("MANUFACTURING_NOT_READY");
  else if (manufacturing === "UNKNOWN") reasons.push("MANUFACTURING_NOT_CONFIRMED_READY");
  if (candidate.formulaStatus === "UNAVAILABLE") return { disposition: "UNAVAILABLE", gateReasons: reasons };
  if (candidate.formulaStatus === "INVALID"
    || (["compatibility", "safety", "regulatory"] as const).some((dimension) => candidate.dimensions[dimension].status === "FAIL")
    || availability === "INFEASIBLE" || manufacturing === "NOT_READY") {
    return { disposition: "BLOCKED", gateReasons: reasons };
  }
  if (reasons.length > 0) return { disposition: "REVIEW_REQUIRED", gateReasons: reasons };
  return { disposition: "ELIGIBLE", gateReasons: [] };
}

const gateRank = { ELIGIBLE: 0, REVIEW_REQUIRED: 1, BLOCKED: 2, UNAVAILABLE: 3 } as const;

function preferredStatus(a: string, b: string, order: readonly string[]): number {
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  return ai === bi ? 0 : (ai < 0 ? 1 : bi < 0 ? -1 : ai - bi);
}

function compareOptionalHigher(a?: number, b?: number): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  return a === b ? 0 : a > b ? -1 : 1;
}

function compareOptionalLower(a?: number, b?: number): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareCandidate(a: AlternativeRankingCandidate, b: AlternativeRankingCandidate): number {
  const ga = gate(a);
  const gb = gate(b);
  const byGate = gateRank[ga.disposition] - gateRank[gb.disposition];
  if (byGate !== 0) return byGate;

  const ap = a.dimensions.performance;
  const bp = b.dimensions.performance;
  let result = preferredStatus(ap.status, bp.status, ["PREDICTED", "OUT_OF_DOMAIN", "MODEL_NOT_ACCEPTED", "INSUFFICIENT_DATA", "MISSING_FEATURES", "UNAVAILABLE_MODEL", "ENGINE_ERROR", "INVALID_CONTRACT"]);
  if (result) return result;
  if (ap.status === "PREDICTED" && bp.status === "PREDICTED") {
    result = compareOptionalHigher(ap.numericValue, bp.numericValue);
    if (result) return result;
    result = ordinal(ap.categoryValue ?? "", bp.categoryValue ?? "");
    if (result) return result;
  }

  const au = a.dimensions.uncertainty;
  const bu = b.dimensions.uncertainty;
  result = preferredStatus(au.status, bu.status, ["SUPPORTED", "UNKNOWN", "UNSUPPORTED"]);
  if (result) return result;
  result = compareOptionalLower(au.numericValue, bu.numericValue);
  if (result) return result;

  const ac = a.dimensions.cost;
  const bc = b.dimensions.cost;
  result = preferredStatus(ac.status, bc.status, ["AVAILABLE", "INCOMPLETE", "MISSING", "ERROR"]);
  if (result) return result;
  result = compareOptionalLower(ac.costPerKg, bc.costPerKg);
  if (result) return result;

  const aa = a.dimensions.availability;
  const ba = b.dimensions.availability;
  result = preferredStatus(aa.status, ba.status, ["FEASIBLE", "UNKNOWN", "INFEASIBLE"]);
  if (result) return result;

  const statusOrders = {
    compatibility: ["PASS", "WARNING", "UNKNOWN", "FAIL"],
    safety: ["PASS", "WARNING", "UNKNOWN", "FAIL"],
    regulatory: ["PASS", "WARNING", "UNKNOWN", "FAIL"],
  } as const;
  for (const name of ["compatibility", "safety", "regulatory"] as const) {
    const left = a.dimensions[name];
    const right = b.dimensions[name];
    result = preferredStatus(left.status, right.status, statusOrders[name]);
    if (result) return result;
  }

  const am = a.dimensions.manufacturing;
  const bm = b.dimensions.manufacturing;
  result = preferredStatus(am.status, bm.status, ["READY", "UNKNOWN", "NOT_READY"]);
  if (result) return result;

  const ae = a.dimensions.evidence;
  const be = b.dimensions.evidence;
  result = preferredStatus(ae.bestEvidenceClass ?? "", be.bestEvidenceClass ?? "", ["A", "B", "C", "D", "E", ""]);
  if (result) return result;
  const aCoverage = ae.ingredientCount === 0 ? 0 : ae.linkedIngredientCount / ae.ingredientCount;
  const bCoverage = be.ingredientCount === 0 ? 0 : be.linkedIngredientCount / be.ingredientCount;
  result = compareOptionalHigher(aCoverage, bCoverage);
  if (result) return result;
  result = compareOptionalHigher(ae.uniqueSourceCount, be.uniqueSourceCount);
  return result || ordinal(a.candidateId, b.candidateId);
}

export function rankAlternatives(candidates: AlternativeRankingCandidate[]): RankedAlternative[] {
  const parsed = candidates.map((candidate) => ({ ...candidate, dimensions: candidate.dimensions }));
  const ids = parsed.map(({ candidateId }) => candidateId);
  if (new Set(ids).size !== ids.length) throw new Error("Alternative ranking candidate ids must be unique.");
  return parsed.sort(compareCandidate).map((candidate, index) => ({
    candidate,
    rank: index + 1,
    ...gate(candidate),
  }));
}

type NewAlternativeRankingRecord = Omit<AlternativeRankingRecord, "schemaVersion" | "rankingPolicyVersion" | "dimensionOrder" | "artifactChecksum">;

export async function createAlternativeRankingRecord(input: NewAlternativeRankingRecord): Promise<AlternativeRankingRecord> {
  const base = {
    ...input,
    schemaVersion: ALTERNATIVE_RANKING_SCHEMA_VERSION,
    rankingPolicyVersion: ALTERNATIVE_RANKING_POLICY_VERSION,
    dimensionOrder: [...RANKING_DIMENSION_ORDER],
  };
  const artifactChecksum = {
    algorithm: DIGEST_ALGORITHM,
    canonicalization: CANONICALIZATION_ALGORITHM,
    digest: await sha256Hex(canonicalizeForFingerprint(base)),
  };
  return alternativeRankingRecordSchema.parse({ ...base, artifactChecksum });
}

export async function verifyAlternativeRankingRecord(record: AlternativeRankingRecord): Promise<boolean> {
  const { artifactChecksum, ...base } = record;
  return artifactChecksum.algorithm === DIGEST_ALGORITHM
    && artifactChecksum.canonicalization === CANONICALIZATION_ALGORITHM
    && artifactChecksum.digest === await sha256Hex(canonicalizeForFingerprint(base));
}
