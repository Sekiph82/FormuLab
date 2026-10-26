export type IdentifierNormalizationError = "INVALID_FORMAT" | "INVALID_CHECK_DIGIT";

export type IdentifierNormalizationResult =
  | { ok: true; originalValue: string; normalizedValue: string }
  | { ok: false; originalValue: string; error: IdentifierNormalizationError };

/** Validate a CAS Registry Number and retain its exact source spelling. */
export function normalizeCasIdentifier(value: string): IdentifierNormalizationResult {
  const match = value.trim().match(/^(\d{2,7})-(\d{2})-(\d)$/);
  if (!match) return { ok: false, originalValue: value, error: "INVALID_FORMAT" };
  const body = `${match[1]}${match[2]}`;
  let sum = 0;
  for (let index = body.length - 1, weight = 1; index >= 0; index -= 1, weight += 1) {
    sum += Number(body[index]) * weight;
  }
  if (sum % 10 !== Number(match[3])) {
    return { ok: false, originalValue: value, error: "INVALID_CHECK_DIGIT" };
  }
  return { ok: true, originalValue: value, normalizedValue: `${match[1]}-${match[2]}-${match[3]}` };
}

/** Validate an EC number (EINECS/ELINCS/NLP form) and retain its exact source spelling. */
export function normalizeEcIdentifier(value: string): IdentifierNormalizationResult {
  const match = value.trim().match(/^(\d{3})-(\d{3})-(\d)$/);
  if (!match) return { ok: false, originalValue: value, error: "INVALID_FORMAT" };
  const digits = `${match[1]}${match[2]}`;
  const weightedSum = [...digits].reduce((sum, digit, index) => sum + Number(digit) * (index + 1), 0);
  if (weightedSum % 11 !== Number(match[3])) {
    return { ok: false, originalValue: value, error: "INVALID_CHECK_DIGIT" };
  }
  return { ok: true, originalValue: value, normalizedValue: `${match[1]}-${match[2]}-${match[3]}` };
}

export interface ChemicalIdentifierSet {
  cas: string[];
  ec: string[];
}

export type ChemicalIdentifierComparison =
  | { status: "compatible"; sharedIdentifiers: string[] }
  | { status: "conflict"; conflictingNamespaces: Array<"cas" | "ec"> }
  | { status: "insufficient" }
  | { status: "invalid"; invalidIdentifiers: string[] };

/**
 * Conservative identity comparison. Conflicting identifiers in either shared
 * namespace veto a match; names are intentionally not consulted here.
 */
export function compareChemicalIdentifierSets(
  left: ChemicalIdentifierSet,
  right: ChemicalIdentifierSet,
): ChemicalIdentifierComparison {
  const normalize = (values: string[], kind: "cas" | "ec") => values.map((value) => ({
    value,
    normalized: kind === "cas" ? normalizeCasIdentifier(value) : normalizeEcIdentifier(value),
  }));
  const leftCas = normalize(left.cas, "cas");
  const rightCas = normalize(right.cas, "cas");
  const leftEc = normalize(left.ec, "ec");
  const rightEc = normalize(right.ec, "ec");
  const invalidIdentifiers = [...leftCas, ...rightCas, ...leftEc, ...rightEc]
    .filter((entry) => !entry.normalized.ok)
    .map((entry) => entry.value);
  if (invalidIdentifiers.length) return { status: "invalid", invalidIdentifiers };

  const leftCasValues = leftCas.map((entry) => entry.normalized.ok ? entry.normalized.normalizedValue : "");
  const rightCasValues = rightCas.map((entry) => entry.normalized.ok ? entry.normalized.normalizedValue : "");
  const leftEcValues = leftEc.map((entry) => entry.normalized.ok ? entry.normalized.normalizedValue : "");
  const rightEcValues = rightEc.map((entry) => entry.normalized.ok ? entry.normalized.normalizedValue : "");
  const conflictingNamespaces: Array<"cas" | "ec"> = [];
  if (leftCasValues.length && rightCasValues.length && !leftCasValues.some((value) => rightCasValues.includes(value))) conflictingNamespaces.push("cas");
  if (leftEcValues.length && rightEcValues.length && !leftEcValues.some((value) => rightEcValues.includes(value))) conflictingNamespaces.push("ec");
  if (conflictingNamespaces.length) return { status: "conflict", conflictingNamespaces };

  const sharedIdentifiers = [
    ...leftCasValues.filter((value) => rightCasValues.includes(value)).map((value) => `CAS:${value}`),
    ...leftEcValues.filter((value) => rightEcValues.includes(value)).map((value) => `EC:${value}`),
  ];
  return sharedIdentifiers.length ? { status: "compatible", sharedIdentifiers } : { status: "insufficient" };
}
