import { describe, expect, it } from "vitest";
import { compareChemicalIdentifierSets, normalizeCasIdentifier, normalizeEcIdentifier } from "./chemicalIdentifiers";

describe("chemical identifier normalization", () => {
  it("validates CAS check digits and preserves the exact source text", () => {
    expect(normalizeCasIdentifier(" 7732-18-5 ")).toEqual({ ok: true, originalValue: " 7732-18-5 ", normalizedValue: "7732-18-5" });
    expect(normalizeCasIdentifier("7732-18-4")).toEqual({ ok: false, originalValue: "7732-18-4", error: "INVALID_CHECK_DIGIT" });
    expect(normalizeCasIdentifier("7732185")).toEqual({ ok: false, originalValue: "7732185", error: "INVALID_FORMAT" });
  });

  it("validates EC check digits and preserves the exact source text", () => {
    expect(normalizeEcIdentifier(" 200-001-8 ")).toEqual({ ok: true, originalValue: " 200-001-8 ", normalizedValue: "200-001-8" });
    expect(normalizeEcIdentifier("200-001-7")).toEqual({ ok: false, originalValue: "200-001-7", error: "INVALID_CHECK_DIGIT" });
    expect(normalizeEcIdentifier("2000018")).toEqual({ ok: false, originalValue: "2000018", error: "INVALID_FORMAT" });
  });

  it("only compares validated identifier namespaces and refuses conflicting IDs", () => {
    expect(compareChemicalIdentifierSets(
      { cas: ["7732-18-5"], ec: ["231-791-2"] },
      { cas: ["7732-18-5"], ec: ["231-791-2"] },
    )).toEqual({ status: "compatible", sharedIdentifiers: ["CAS:7732-18-5", "EC:231-791-2"] });
    expect(compareChemicalIdentifierSets(
      { cas: ["7732-18-5"], ec: [] },
      { cas: ["64-17-5"], ec: [] },
    )).toEqual({ status: "conflict", conflictingNamespaces: ["cas"] });
    expect(compareChemicalIdentifierSets({ cas: [], ec: [] }, { cas: ["64-17-5"], ec: [] })).toEqual({ status: "insufficient" });
    expect(compareChemicalIdentifierSets({ cas: ["bad"], ec: [] }, { cas: [], ec: [] })).toMatchObject({ status: "invalid", invalidIdentifiers: ["bad"] });
  });
});
