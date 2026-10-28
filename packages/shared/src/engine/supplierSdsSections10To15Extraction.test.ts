import { describe, expect, it } from "vitest";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { extractSupplierSdsSections10To15 } from "./supplierSdsSections10To15Extraction";

const HASH = "c".repeat(64);
const line = (pageNumber: number, lineNumber: number, text: string, extra: Partial<SupplierSdsSectionLine> = {}): SupplierSdsSectionLine => ({ pageNumber, lineNumber, text, source: "digital", ...extra });

describe("supplier SDS Sections 10-15 extraction", () => {
  it("extracts labeled evidence across stability, toxicology, ecology, disposal, transport, and regulation", () => {
    const lines = [
      line(3, 1, "SECTION 10: Stability and reactivity"),
      line(3, 2, "Chemical stability: Stable under normal ambient conditions."),
      line(3, 3, "Incompatible materials: Strong oxidizing agents."),
      line(3, 4, "SECTION 11: Toxicological information"),
      line(3, 5, "Acute toxicity: No data available."),
      line(3, 6, "Skin corrosion/irritation: Not irritating in the available study."),
      line(3, 7, "SECTION 12: Ecological information"),
      line(3, 8, "12.1 Toxicity"),
      line(3, 9, "Harmful to aquatic life with long lasting effects."),
      line(3, 10, "Persistence and degradability: Readily biodegradable."),
      line(3, 11, "Bioaccumulative potential: No data available."),
      line(3, 12, "SECTION 13: Disposal considerations"),
      line(3, 13, "Waste treatment methods: Dispose of contents in accordance with local regulations."),
      line(3, 14, "Contaminated packaging: Empty containers should be sent to an approved waste handling site."),
      line(3, 15, "SECTION 14: Transport information"),
      line(3, 16, "UN number: UN 3082"),
      line(3, 17, "UN proper shipping name: ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S."),
      line(3, 18, "Transport hazard class(es): 9"),
      line(3, 19, "Packing group: III"),
      line(3, 20, "Environmental hazards: Marine pollutant"),
      line(3, 21, "SECTION 15: Regulatory information"),
      line(3, 22, "Chemical safety assessment: A chemical safety assessment has not been carried out."),
      line(3, 23, "SECTION 16: Other information"),
      line(3, 24, "This later-section material must not be captured."),
    ];
    const result = extractSupplierSdsSections10To15({ sourceDocumentHash: HASH, lines, sections: detectSupplierSdsSections(lines) });
    expect(result.candidates.map(({ sectionNumber, field, rawValue }) => [sectionNumber, field, rawValue])).toEqual([
      [10, "chemical_stability", "Stable under normal ambient conditions."],
      [10, "incompatible_materials", "Strong oxidizing agents."],
      [11, "skin_corrosion_irritation", "Not irritating in the available study."],
      [12, "ecological_toxicity", "Harmful to aquatic life with long lasting effects."],
      [12, "persistence_degradability", "Readily biodegradable."],
      [13, "waste_treatment_methods", "Dispose of contents in accordance with local regulations."],
      [13, "contaminated_packaging_disposal", "Empty containers should be sent to an approved waste handling site."],
      [14, "un_number", "UN 3082"],
      [14, "un_proper_shipping_name", "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S."],
      [14, "transport_hazard_class", "9"],
      [14, "packing_group", "III"],
      [14, "environmental_transport_hazard", "Marine pollutant"],
      [15, "chemical_safety_assessment", "A chemical safety assessment has not been carried out."],
    ]);
    expect(result.candidates.every((candidate) => candidate.reviewRequired && candidate.evidence.every((source) => source.sourceDocumentHash === HASH))).toBe(true);
    expect(result.candidates.some(({ rawValue }) => rawValue.includes("This later-section material"))).toBe(false);
    expect(result.warnings).toContain("human_review_required");
  });

  it("preserves wrapped values and OCR evidence without deciding safety or regulatory outcomes", () => {
    const lines = [
      line(1, 1, "SECTION 10: Stability and reactivity"),
      line(1, 2, "Conditions to avoid: Avoid temperatures above 40 °C and"),
      line(1, 3, "direct sunlight.", { source: "ocr", confidence: 0.78, position: { x: 12, y: 22 } }),
      line(1, 4, "SECTION 11: Toxicological information"),
      line(1, 5, "Carcinogenicity: No classification assigned by supplier."),
      line(1, 6, "SECTION 12: Ecological information"),
      line(1, 7, "PBT/vPvB assessment: Not considered PBT or vPvB."),
      line(1, 8, "SECTION 13: Disposal considerations"),
      line(1, 9, "Waste treatment methods: Follow local requirements."),
      line(1, 10, "SECTION 14: Transport information"),
      line(1, 11, "Special precautions for user: None stated."),
      line(1, 12, "SECTION 15: Regulatory information"),
      line(1, 13, "National regulations: Regional requirements may apply."),
      line(1, 14, "SECTION 16: Other information"),
    ];
    const result = extractSupplierSdsSections10To15({ sourceDocumentHash: HASH, lines, ocrParserVersion: "ocr-test-v1" });
    expect(result.candidates).toMatchObject([
      { sectionNumber: 10, field: "conditions_to_avoid", rawValue: "Avoid temperatures above 40 °C and direct sunlight.", evidence: [{ pageNumber: 1, lineNumber: 2 }, { pageNumber: 1, lineNumber: 3 }] },
      { sectionNumber: 11, field: "carcinogenicity", rawValue: "No classification assigned by supplier." },
      { sectionNumber: 12, field: "pbt_vpvb_assessment", rawValue: "Not considered PBT or vPvB." },
      { sectionNumber: 13, field: "waste_treatment_methods", rawValue: "Follow local requirements." },
      { sectionNumber: 14, field: "user_transport_precautions", rawValue: "None stated." },
      { sectionNumber: 15, field: "regulatory_safety_health_environment", rawValue: "Regional requirements may apply." },
    ]);
    expect(result.candidates[0]?.evidence[1]).toMatchObject({ source: "ocr", confidence: 0.78, position: { x: 12, y: 22 } });
    expect(result.ocrParserVersion).toBe("ocr-test-v1");
    expect(result.warnings).toContain("sections_10_to_15_ocr_requires_review");
  });

  it("returns boundary warnings and never reads an incomplete section into the next section", () => {
    const lines = [
      line(1, 1, "SECTION 10: Stability and reactivity"),
      line(1, 2, "Chemical stability: Stable."),
      line(1, 3, "SECTION 11: Toxicological information"),
      line(1, 4, "Acute toxicity: Not reported."),
      line(1, 5, "SECTION 12: Ecological information"),
      line(1, 6, "Toxicity: Not reported."),
      line(1, 7, "SECTION 13: Disposal considerations"),
      line(1, 8, "Waste treatment methods: Not reported."),
      line(1, 9, "SECTION 14: Transport information"),
      line(1, 10, "UN number: Not reported."),
      line(1, 11, "SECTION 15: Regulatory information"),
      line(1, 12, "National regulations: Not reported."),
    ];
    const result = extractSupplierSdsSections10To15({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.map(({ sectionNumber, field, rawValue }) => [sectionNumber, field, rawValue])).toEqual([[10, "chemical_stability", "Stable."]]);
    expect(result.warnings).toContain("section_boundary_incomplete");
  });

  it("reports missing sections and rejects invalid source hashes", () => {
    expect(extractSupplierSdsSections10To15({ sourceDocumentHash: HASH, lines: [] }).warnings).toEqual(["sections_10_to_15_not_detected"]);
    expect(() => extractSupplierSdsSections10To15({ sourceDocumentHash: "bad", lines: [] })).toThrow(/SHA-256/u);
  });

  it("recognizes localized safety and transport labels without changing their statements", () => {
    const lines = [
      line(1, 1, "SECTION 10: Stabilität und Reaktivität"),
      line(1, 2, "Unverträgliche Materialien: Starke Oxidationsmittel vermeiden."),
      line(1, 3, "SECTION 11: Toxikologische Angaben"),
      line(1, 4, "Akute Toxizität: Keine Daten verfügbar."),
      line(1, 5, "Cancérogénicité: Non classé par le fournisseur."),
      line(1, 6, "SECTION 12: Umweltbezogene Angaben"),
      line(1, 7, "Persistenz und Abbaubarkeit: Leicht biologisch abbaubar."),
      line(1, 8, "SECTION 13: Hinweise zur Entsorgung"),
      line(1, 9, "Verfahren der Abfallbehandlung: Gemäß lokalen Vorschriften entsorgen."),
      line(1, 10, "Emballages contaminés: Confier les emballages contaminés à un prestataire autorisé."),
      line(1, 11, "SECTION 14: Angaben zum Transport"),
      line(1, 12, "UN-Nummer: UN 1993"),
      line(1, 13, "Verpackungsgruppe: III"),
      line(1, 14, "Classe(s) de danger pour le transport: 9"),
      line(1, 15, "Dangers pour l'environnement: Polluant marin"),
      line(1, 16, "SECTION 15: Rechtsvorschriften"),
      line(1, 17, "Chemische Sicherheitsbeurteilung: Nicht durchgeführt."),
      line(1, 18, "Réglementations nationales: Les règles nationales peuvent s'appliquer."),
      line(1, 19, "SECTION 16: Sonstige Angaben"),
    ];
    const result = extractSupplierSdsSections10To15({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.map(({ sectionNumber, field, rawValue }) => [sectionNumber, field, rawValue])).toEqual([
      [10, "incompatible_materials", "Starke Oxidationsmittel vermeiden."],
      [11, "carcinogenicity", "Non classé par le fournisseur."],
      [12, "persistence_degradability", "Leicht biologisch abbaubar."],
      [13, "waste_treatment_methods", "Gemäß lokalen Vorschriften entsorgen."],
      [13, "contaminated_packaging_disposal", "Confier les emballages contaminés à un prestataire autorisé."],
      [14, "un_number", "UN 1993"],
      [14, "packing_group", "III"],
      [14, "transport_hazard_class", "9"],
      [14, "environmental_transport_hazard", "Polluant marin"],
      [15, "chemical_safety_assessment", "Nicht durchgeführt."],
      [15, "regulatory_safety_health_environment", "Les règles nationales peuvent s'appliquer."],
    ]);
  });

  it("recognizes localized wastewater, disposal-consideration, and national-regulation labels", () => {
    const lines = [
      line(1, 1, "SECTION 10: Stability and reactivity"),
      line(1, 2, "SECTION 11: Toxicological information"),
      line(1, 3, "SECTION 12: Ecological information"),
      line(1, 4, "SECTION 13: Hinweise zur Entsorgung"),
      line(1, 5, "Abwasserentsorgung: Nach örtlichen Vorgaben entsorgen."),
      line(1, 6, "Considérations relatives à l'élimination: Suivre les exigences locales."),
      line(1, 7, "SECTION 14: Transport information"),
      line(1, 8, "SECTION 15: Información reglamentaria"),
      line(1, 9, "Normativa nacional: Pueden aplicar requisitos regionales."),
      line(1, 10, "SECTION 16: Other information"),
    ];
    const result = extractSupplierSdsSections10To15({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.map(({ sectionNumber, field, rawValue }) => [sectionNumber, field, rawValue])).toEqual([
      [13, "wastewater_disposal", "Nach örtlichen Vorgaben entsorgen."],
      [13, "disposal_other", "Suivre les exigences locales."],
      [15, "regulatory_safety_health_environment", "Pueden aplicar requisitos regionales."],
    ]);
  });
});
