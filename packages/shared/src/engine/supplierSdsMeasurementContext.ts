import type { SupplierSdsPhysicalPropertyCandidate } from "./supplierSdsSection9PhysicalProperties";

export const SUPPLIER_SDS_MEASUREMENT_CONTEXT_VERSION = "formulab-sds-measurement-context-v1";

export type SupplierSdsMeasurementClaimKind = "typical" | "specification" | "mixed_or_ambiguous" | "unspecified";
export type SupplierSdsMeasurementEvidenceKind = "measured" | "literature" | "estimated" | "mixed_or_ambiguous" | "unspecified";
export type SupplierSdsValueNormalizationStatus = "scalar_normalized" | "range_normalized" | "text_only";

export interface SupplierSdsNormalizedPhysicalValue {
  /** Whitespace-normalized source wording; the original is retained separately. */
  text: string;
  status: SupplierSdsValueNormalizationStatus;
  qualifier?: "less_than" | "less_than_or_equal" | "greater_than" | "greater_than_or_equal" | "approximately";
  value?: number;
  lowerBound?: number;
  upperBound?: number;
  /** Canonicalized only for recognized units; otherwise the source unit is kept. */
  unit?: string;
}

export interface SupplierSdsMeasurementContext {
  sourceDocumentHash: string;
  field: SupplierSdsPhysicalPropertyCandidate["field"];
  /** Exact extracted wording, including stated units and conditions. */
  originalText: string;
  normalizedValue: SupplierSdsNormalizedPhysicalValue;
  temperature?: { value: number; unit: "°C" | "°F" | "K"; originalText: string };
  sampleConcentration?: { value: number; basis: "percent"; originalText: string };
  deliveredFormBasis: "as_supplied" | "neat" | "active_matter" | "dry_basis" | "other_explicit" | "unspecified";
  deliveredFormBasisText?: string;
  methodOrStandard?: string[];
  claimKind: SupplierSdsMeasurementClaimKind;
  evidenceKind: SupplierSdsMeasurementEvidenceKind;
  evidence: SupplierSdsPhysicalPropertyCandidate["evidence"];
  reviewRequired: true;
}

export type SupplierSdsMeasurementContextInput = Pick<SupplierSdsPhysicalPropertyCandidate, "field" | "rawValue" | "evidence">;

const UNIT_ALIASES: Record<string, string> = {
  "°c": "°C", "deg c": "°C", "degrees c": "°C",
  "°f": "°F", "deg f": "°F", "degrees f": "°F",
  k: "K", "kpa": "kPa", mpa: "MPa", pa: "Pa", bar: "bar", mbar: "mbar",
  "g/cm3": "g/cm³", "g/cm³": "g/cm³", "g/ml": "g/mL", "kg/m3": "kg/m³", "kg/m³": "kg/m³",
  "mg/l": "mg/L", "g/l": "g/L", "mg/ml": "mg/mL", "mol/l": "mol/L",
  "mpa.s": "mPa·s", "mpa·s": "mPa·s", "cp": "cP", "mm2/s": "mm²/s", "mm²/s": "mm²/s",
  "g/mol": "g/mol", "kg/mol": "kg/mol", ppm: "ppm", ppb: "ppb", "%": "%",
};

function normalizeNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeUnit(unit: string | undefined): string | undefined {
  if (!unit) return undefined;
  const key = unit.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  return UNIT_ALIASES[key] ?? unit.trim().replace(/\s+/gu, " ");
}

function normalizeValue(originalText: string): SupplierSdsNormalizedPhysicalValue {
  const text = originalText.trim().replace(/\s+/gu, " ");
  // Keep case-sensitive SI prefixes distinct (mPa·s is not MPa).
  const unitPattern = "(mPa\\s*[·.]?\\s*s|MPa|kPa|Pa|°\\s*[CF]|K|bar|mbar|g\\s*\\/\\s*cm[³3]|g\\s*\\/\\s*mL|kg\\s*\\/\\s*m[³3]|mg\\s*\\/\\s*L|g\\s*\\/\\s*L|mg\\s*\\/\\s*mL|mol\\s*\\/\\s*L|cP|mm[²2]\\s*\\/\\s*s|g\\s*\\/\\s*mol|kg\\s*\\/\\s*mol|ppm|ppb|%)";
  const approximate = "(?:[Aa]pprox\\.?\\s*|[Aa]pproximately\\s*)?";
  const range = text.match(new RegExp(`^\\s*${approximate}([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))\\s*(?:to|–|—|-)\\s*([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))\\s*${unitPattern}?(?![\\d.,]|\\s*(?:[±/]|\\+\\s*/\\s*-)|\\s*[-–—]\\s*\\d)`, "u"));
  if (range) {
    const lowerBound = normalizeNumber(range[1]!);
    const upperBound = normalizeNumber(range[2]!);
    if (lowerBound !== undefined && upperBound !== undefined) {
      return { text, status: "range_normalized", lowerBound, upperBound, ...(range[3] ? { unit: normalizeUnit(range[3]) } : {}) };
    }
  }

  const scalar = text.match(new RegExp(`^\\s*(<=|>=|<|>|~|≈|${approximate})?\\s*([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))\\s*${unitPattern}?(?![\\d.,]|\\s*(?:[±/]|\\+\\s*/\\s*-)|\\s*[-–—]\\s*\\d)`, "u"));
  if (scalar) {
    const value = normalizeNumber(scalar[2]!);
    if (value !== undefined) {
      const qualifierText = scalar[1]?.toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
      const qualifier = qualifierText === "<" ? "less_than"
        : qualifierText === "<=" ? "less_than_or_equal"
          : qualifierText === ">" ? "greater_than"
            : qualifierText === ">=" ? "greater_than_or_equal"
              : qualifierText ? "approximately" : undefined;
      return { text, status: "scalar_normalized", ...(qualifier ? { qualifier } : {}), value, ...(scalar[3] ? { unit: normalizeUnit(scalar[3]) } : {}) };
    }
  }
  return { text, status: "text_only" };
}

function extractTemperature(text: string, field: SupplierSdsPhysicalPropertyCandidate["field"]): SupplierSdsMeasurementContext["temperature"] {
  const temperatureValueFields = new Set(["melting_point", "freezing_point", "melting_freezing_point", "boiling_point", "flash_point"]);
  const temperatureToken = "([+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+))\\s*(°\\s*[CcFf]|\\bK\\b|\\bdeg(?:rees?)?\\s*[CcFf]\\b)";
  const explicitCondition = text.match(new RegExp(`\\b(?:at|measured\\s+at|tested\\s+at)\\s+${temperatureToken}`, "iu"));
  const match = explicitCondition ?? (temperatureValueFields.has(field) ? undefined : text.match(new RegExp(temperatureToken, "iu")));
  if (!match) return undefined;
  const value = normalizeNumber(match[1]!.replace(",", "."));
  if (value === undefined) return undefined;
  const unitText = match[2]!.replace(/\s+/gu, "").toLocaleUpperCase("en-US");
  const unit = unitText.includes("F") ? "°F" : unitText === "K" ? "K" : "°C";
  return { value, unit, originalText: match[0].trim() };
}

function extractConcentration(text: string): SupplierSdsMeasurementContext["sampleConcentration"] {
  const match = text.match(/\b([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*%\s*(?:w\s*\/\s*w|w\s*\/\s*v|v\s*\/\s*v)?\s*(?:aqueous\s+)?(?:solution|dilution|dispersion|in\s+water)\b/iu);
  if (!match) return undefined;
  const value = normalizeNumber(match[1]!.replace(",", "."));
  return value === undefined ? undefined : { value, basis: "percent", originalText: match[0].trim() };
}

function extractDeliveredFormBasis(text: string): Pick<SupplierSdsMeasurementContext, "deliveredFormBasis" | "deliveredFormBasisText"> {
  const patterns: Array<[SupplierSdsMeasurementContext["deliveredFormBasis"], RegExp]> = [
    ["as_supplied", /\b(?:as supplied|as delivered|commercial product as supplied)\b/iu],
    ["neat", /\b(?:neat|undiluted|un-diluted)\b/iu],
    ["active_matter", /\b(?:as active matter|on an active basis|active substance basis)\b/iu],
    ["dry_basis", /\b(?:on a dry basis|dry basis|anhydrous basis)\b/iu],
  ];
  for (const [basis, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) return { deliveredFormBasis: basis, deliveredFormBasisText: match[0] };
  }
  const explicit = text.match(/\b(?:basis|form)\s*:\s*([^;,.)]+)/iu);
  return explicit ? { deliveredFormBasis: "other_explicit", deliveredFormBasisText: explicit[0].trim() } : { deliveredFormBasis: "unspecified" };
}

function extractMethods(text: string): string[] | undefined {
  const values = new Set<string>();
  for (const match of text.matchAll(/\b(?:ISO|ASTM|OECD|DIN|EN|AOCS|USP|Ph\.\s*Eur\.)\s*(?:\d{2,}(?:[-/:]\d+)*(?:\s*[-–]\s*\d{2,})?)/giu)) values.add(match[0].replace(/\s+/gu, " ").trim());
  for (const match of text.matchAll(/\b(?:Brookfield|Ubbelohde|Cannon-Fenske|Saybolt|Pensky-Martens|Tag closed cup|Cleveland open cup)\b[^;,]*/giu)) values.add(match[0].trim());
  return values.size ? [...values] : undefined;
}

function classifyClaim(text: string): SupplierSdsMeasurementClaimKind {
  const typical = /\b(?:typical(?:ly)?|typical value|characteristic value|indicative value)\b/iu.test(text);
  const specification = /\b(?:specification(?: limit)?|specified range|release limit|acceptance limit)\b/iu.test(text);
  if (typical && specification) return "mixed_or_ambiguous";
  if (typical) return "typical";
  if (specification) return "specification";
  return "unspecified";
}

function classifyEvidence(text: string): SupplierSdsMeasurementEvidenceKind {
  const kinds: SupplierSdsMeasurementEvidenceKind[] = [];
  if (/\b(?:estimated|estimate|calculated|predicted)\b/iu.test(text)) kinds.push("estimated");
  if (/\b(?:literature|literature value|reported in literature|reference value)\b/iu.test(text)) kinds.push("literature");
  if (/\b(?:measured|measurement|determined experimentally|experimentally determined)\b/iu.test(text)) kinds.push("measured");
  if (new Set(kinds).size > 1) return "mixed_or_ambiguous";
  if (kinds.length) return kinds[0]!;
  return "unspecified";
}

/** Builds a review-only evidence context; it never updates a RawMaterial or assigns unstated conditions. */
export function createSupplierSdsMeasurementContext(candidate: SupplierSdsMeasurementContextInput): SupplierSdsMeasurementContext {
  const sourceDocumentHash = candidate.evidence[0]?.sourceDocumentHash;
  if (!sourceDocumentHash || !/^[a-f0-9]{64}$/iu.test(sourceDocumentHash)) throw new Error("A physical-property measurement context requires SHA-256 source evidence.");
  const text = candidate.rawValue.trim();
  const temperature = extractTemperature(text, candidate.field);
  const sampleConcentration = extractConcentration(text);
  const methods = extractMethods(text);
  return {
    sourceDocumentHash: sourceDocumentHash.toLowerCase(),
    field: candidate.field,
    originalText: candidate.rawValue,
    normalizedValue: normalizeValue(candidate.rawValue),
    ...(temperature ? { temperature } : {}),
    ...(sampleConcentration ? { sampleConcentration } : {}),
    ...extractDeliveredFormBasis(text),
    ...(methods ? { methodOrStandard: methods } : {}),
    claimKind: classifyClaim(text),
    evidenceKind: classifyEvidence(text),
    evidence: candidate.evidence.map((item) => ({ ...item })),
    reviewRequired: true,
  };
}
