import { describe, expect, it } from "vitest";
import { canonicalChemicalSchema } from "./canonicalChemical";
import { findCanonicalChemicalNameMatches, normalizeChemicalName } from "./chemicalNameNormalization";

const chemical = (id: string, preferredName: string, synonyms: Array<{ value: string; kind: "abbreviation" | "synonym" }> = []) => canonicalChemicalSchema.parse({
  schemaVersion: "1.0",
  id,
  preferredName,
  synonyms,
  provenance: [{ id: `source-${id}`, sourceType: "curated_reference", sourceReference: `curated:${id}`, recordedAt: "2026-10-26T08:00:00.000Z" }],
});

describe("chemical name normalization", () => {
  it("normalizes Unicode compatibility, case and repeated whitespace while retaining source text", () => {
    expect(normalizeChemicalName("  Ｓodium   Chloride ")).toEqual({
      originalValue: "  Ｓodium   Chloride ",
      normalizedValue: "sodium chloride",
      normalizationVersion: "1.0",
    });
  });

  it("preserves punctuation, stereochemistry, digits, diacritics and Greek descriptors", () => {
    const keys = ["cis-2-butene", "trans-2-butene", "2-butene", "alpha-tocopherol", "β-tocopherol", "café"].map((name) =>
      normalizeChemicalName(name).normalizedValue,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolves controlled exact aliases and leaves similar names separate or ambiguous", () => {
    const catalogue = [
      chemical("chem-sodium-chloride", "Sodium chloride", [{ value: "NaCl", kind: "abbreviation" }]),
      chemical("chem-sodium-chlorite", "Sodium chlorite"),
      chemical("chem-water-a", "Water"),
      chemical("chem-water-b", "Aqua", [{ value: "Water", kind: "synonym" }]),
    ];
    expect(findCanonicalChemicalNameMatches(" nacl ", catalogue)).toMatchObject({
      status: "unique",
      candidates: [{ chemicalId: "chem-sodium-chloride", matchedAlias: "NaCl" }],
    });
    expect(findCanonicalChemicalNameMatches("Sodium chlor", catalogue).status).toBe("none");
    expect(findCanonicalChemicalNameMatches("sodium chloride", catalogue).status).toBe("unique");
    const ambiguous = findCanonicalChemicalNameMatches("water", [catalogue[2]!, catalogue[3]!]);
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.candidates.map((candidate) => candidate.chemicalId)).toEqual(["chem-water-a", "chem-water-b"]);
  });
});
