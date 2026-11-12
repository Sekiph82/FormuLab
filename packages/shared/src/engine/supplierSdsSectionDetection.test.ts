import { describe, expect, it } from "vitest";
import {
  detectSupplierSdsSections,
  SUPPLIER_SDS_SECTION_TITLE_ALIASES,
  SUPPORTED_SUPPLIER_SDS_SECTION_LANGUAGES,
  type SupplierSdsSectionLine,
} from "./supplierSdsSectionDetection";

const line = (pageNumber: number, lineNumber: number, text: string, extra: Partial<SupplierSdsSectionLine> = {}): SupplierSdsSectionLine => ({
  pageNumber,
  lineNumber,
  text,
  source: "digital",
  ...extra,
});

describe("supplier SDS section detection", () => {
  it("detects standardized English headings and returns page/line content spans", () => {
    const result = detectSupplierSdsSections([
      line(1, 2, "SECTION 1: Identification of the substance/mixture and of the company/undertaking", { position: { x: 36, y: 720 } }),
      line(1, 3, "Product identifier: Sample A"),
      line(1, 4, "SECTION 2: Hazards identification"),
      line(1, 5, "Not classified"),
      line(2, 1, "SECTION 3: Composition/information on ingredients"),
      line(2, 2, "Mixture details"),
    ]);
    expect(result.sections.map(({ sectionNumber, languageCandidates }) => [sectionNumber, languageCandidates])).toEqual([
      [1, ["en"]], [2, ["en"]], [3, ["en"]],
    ]);
    expect(result.sections[0]).toMatchObject({
      canonicalTitle: "Identification of the substance/mixture and of the company/undertaking",
      rawHeading: "SECTION 1: Identification of the substance/mixture and of the company/undertaking",
      headingLines: [{ pageNumber: 1, lineNumber: 2, position: { x: 36, y: 720 } }],
      contentStart: { pageNumber: 1, lineNumber: 3 },
      contentEnd: { pageNumber: 1, lineNumber: 3 },
      source: "digital",
      reviewRequired: false,
    });
    expect(result.sections[2]).toMatchObject({ contentStart: { pageNumber: 2, lineNumber: 2 }, contentEnd: { pageNumber: 2, lineNumber: 2 } });
    expect(result.unobservedSectionNumbers).not.toContain(1);
  });

  it("recognizes all 16 standardized section titles", () => {
    const titles = [
      "Identification of the substance/mixture and of the company/undertaking",
      "Hazards identification",
      "Composition/information on ingredients",
      "First aid measures",
      "Firefighting measures",
      "Accidental release measures",
      "Handling and storage",
      "Exposure controls/personal protection",
      "Physical and chemical properties",
      "Stability and reactivity",
      "Toxicological information",
      "Ecological information",
      "Disposal considerations",
      "Transport information",
      "Regulatory information",
      "Other information",
    ];
    const result = detectSupplierSdsSections(titles.map((title, index) => line(index + 1, 1, `SECTION ${index + 1}: ${title}`)));
    expect(result.sections.map(({ sectionNumber }) => sectionNumber)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    expect(result.sectionCoverage).toBe("all_16_detected");
    expect(result.unobservedSectionNumbers).toEqual([]);
  });

  it("validates every declared localized title alias against its canonical section", () => {
    expect(Object.keys(SUPPLIER_SDS_SECTION_TITLE_ALIASES).sort()).toEqual([...SUPPORTED_SUPPLIER_SDS_SECTION_LANGUAGES].sort());
    for (const [language, titles] of Object.entries(SUPPLIER_SDS_SECTION_TITLE_ALIASES)) {
      expect(titles).toHaveLength(16);
      titles.forEach((aliases, index) => {
        for (const title of aliases.split("|")) {
          const result = detectSupplierSdsSections([line(1, 1, `SECTION ${index + 1}: ${title}`)]);
          expect(result.sections, `${language} section ${index + 1}: ${title}`).toHaveLength(1);
          expect(result.sections[0]?.sectionNumber).toBe(index + 1);
          expect(result.sections[0]?.languageCandidates).toContain(language);
        }
      });
    }
  });

  it.each([
    ["de", "ABSCHNITT 1: Bezeichnung des Stoffs beziehungsweise des Gemischs und des Unternehmens"],
    ["fr", "RUBRIQUE 2 — Identification des dangers"],
    ["es", "SECCIÓN 3. Composición/información sobre los componentes"],
    ["it", "SEZIONE 4: Misure di primo soccorso"],
    ["nl", "RUBRIEK 5: Brandbestrijdingsmaatregelen"],
    ["pl", "SEKCJA 6: Postępowanie w przypadku niezamierzonego uwolnienia do środowiska"],
    ["pt", "SECÇÃO 7: Manuseamento e armazenagem"],
    ["tr", "BÖLÜM 8: Maruz kalma kontrolü/kişisel korunma"],
  ])("recognizes localized heading language %s", (language, text) => {
    const result = detectSupplierSdsSections([line(1, 1, text)]);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({ sectionNumber: Number(text.match(/\d+/)?.[0]), languageCandidates: [language] });
  });

  it("accepts split heading lines and punctuation variants while ignoring subsection numbers", () => {
    const result = detectSupplierSdsSections([
      line(1, 1, "Section"),
      line(1, 2, "9 – Physical and chemical properties"),
      line(1, 3, "9.1 Information on basic physical and chemical properties"),
      line(1, 4, "10"),
      line(1, 5, "Stability and reactivity"),
    ]);
    expect(result.sections.map(({ sectionNumber }) => sectionNumber)).toEqual([9, 10]);
    expect(result.sections[0]?.headingLines.map(({ lineNumber }) => lineNumber)).toEqual([1, 2]);
    expect(result.sections[1]?.headingLines.map(({ lineNumber }) => lineNumber)).toEqual([4, 5]);
    expect(result.sections[1]?.canonicalTitle).toBe("Stability and reactivity");
  });

  it("does not infer sections from numbered lists, subsections, or table-of-contents entries", () => {
    const result = detectSupplierSdsSections([
      line(1, 1, "1. Product code: AB-123"),
      line(1, 2, "1.1 Product identifier"),
      line(1, 3, "2.1 Classification of the substance or mixture"),
      line(1, 4, "1. Identification of the substance/mixture and of the company/undertaking .... 2"),
      line(1, 5, "2. Hazards identification 3"),
      line(1, 6, "3. Composition/information on ingredients"),
      line(1, 7, "4"),
    ]);
    expect(result.sections).toEqual([]);
    expect(result.warnings).toContain("no_sections_detected");
    expect(result.warnings).toContain("possible_table_of_contents");
  });

  it("skips a split section/title followed by a standalone contents page number", () => {
    const result = detectSupplierSdsSections([
      line(1, 1, "SECTION 4:"),
      line(1, 2, "First aid measures"),
      line(1, 3, "5"),
    ]);
    expect(result.sections).toEqual([]);
    expect(result.warnings).toContain("possible_table_of_contents");
  });

  it("keeps a repeated page-top heading as a continuation instead of a duplicate section", () => {
    const result = detectSupplierSdsSections([
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Store in original container."),
      line(2, 1, "SECTION 7: Handling and storage"),
      line(2, 2, "Keep tightly closed."),
      line(3, 1, "SECTION 8: Exposure controls/personal protection"),
    ]);
    expect(result.sections.map(({ sectionNumber }) => sectionNumber)).toEqual([7, 8]);
    expect(result.sections[0]?.continuationHeadingLines).toEqual([[{ pageNumber: 2, lineNumber: 1 }]]);
    expect(result.sections[0]?.contentEnd).toEqual({ pageNumber: 2, lineNumber: 2 });
    expect(result.warnings).not.toContain("duplicate_section");
  });

  it("preserves OCR provenance/confidence and requires review for low or missing confidence", () => {
    const result = detectSupplierSdsSections([
      line(1, 1, "SECTION 14: Transport information", { source: "ocr", confidence: 0.42 }),
      line(1, 2, "SECTION 15: Regulatory information", { source: "ocr" }),
      line(1, 3, "SECTION 16: Other information", { source: "digital" }),
    ]);
    expect(result.sections).toMatchObject([
      { sectionNumber: 14, source: "ocr", confidence: 0.42, reviewRequired: true },
      { sectionNumber: 15, source: "ocr", reviewRequired: true },
      { sectionNumber: 16, source: "digital", reviewRequired: false },
    ]);
  });

  it("reports duplicate and out-of-order section markers without discarding evidence", () => {
    const result = detectSupplierSdsSections([
      line(1, 1, "SECTION 2: Hazards identification"),
      line(1, 2, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(2, 1, "SECTION 2: Hazards identification"),
    ]);
    expect(result.sections.map(({ sectionNumber }) => sectionNumber)).toEqual([2, 1, 2]);
    expect(result.warnings).toEqual(["duplicate_section", "out_of_order_sections"]);
  });

  it("returns no inferred language for unknown labels", () => {
    const result = detectSupplierSdsSections([line(1, 1, "SECTION 1: Product catalog overview")]);
    expect(result.sections).toEqual([]);
    expect(result.sectionCoverage).toBe("not_detected");
    expect(result.unobservedSectionNumbers).toEqual([]);
  });

  it("reports unsupported-language heading text as not detected", () => {
    const result = detectSupplierSdsSections([line(1, 1, "AVSNITT 1: Identifiering av ämnet/blandningen och företaget")]);
    expect(result.sectionCoverage).toBe("not_detected");
    expect(result.sections).toEqual([]);
    expect(result.unobservedSectionNumbers).toEqual([]);
  });
});
