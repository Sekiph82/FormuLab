import type { CanonicalChemical } from "./canonicalChemical";

export const CHEMICAL_NAME_NORMALIZATION_VERSION = "1.0" as const;

export interface NormalizedChemicalName {
  originalValue: string;
  normalizedValue: string;
  normalizationVersion: typeof CHEMICAL_NAME_NORMALIZATION_VERSION;
}

/**
 * Deterministic exact-alias key. Punctuation, stereochemical descriptors,
 * diacritics, digits and Greek symbols are retained because they can change
 * chemical identity.
 */
export function normalizeChemicalName(value: string): NormalizedChemicalName {
  return {
    originalValue: value,
    normalizedValue: value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"),
    normalizationVersion: CHEMICAL_NAME_NORMALIZATION_VERSION,
  };
}

export type CanonicalChemicalNameMatch =
  | { status: "none"; candidates: [] }
  | { status: "unique"; candidates: Array<{ chemicalId: string; matchedAlias: string }> }
  | { status: "ambiguous"; candidates: Array<{ chemicalId: string; matchedAlias: string }> };

/** Resolve exact normalized preferred-name/synonym aliases only; never fuzzy-merge records. */
export function findCanonicalChemicalNameMatches(
  query: string,
  chemicals: CanonicalChemical[],
): CanonicalChemicalNameMatch {
  const queryKey = normalizeChemicalName(query).normalizedValue;
  if (!queryKey) return { status: "none", candidates: [] };

  const matches: Array<{ chemicalId: string; matchedAlias: string }> = [];
  for (const chemical of chemicals) {
    const aliases = [chemical.preferredName, ...chemical.synonyms.map((synonym) => synonym.value)];
    for (const alias of aliases) {
      if (normalizeChemicalName(alias).normalizedValue === queryKey) {
        matches.push({ chemicalId: chemical.id, matchedAlias: alias });
        break;
      }
    }
  }
  if (matches.length === 0) return { status: "none", candidates: [] };
  return matches.length === 1 ? { status: "unique", candidates: matches } : { status: "ambiguous", candidates: matches };
}
