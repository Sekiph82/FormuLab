import { describe, expect, it } from "vitest";
import { extractSupplierSdsSection1 } from "./supplierSdsSection1Extraction";
import { extractSupplierSdsSection2Hazards } from "./supplierSdsSection2HazardExtraction";
import { extractSupplierSdsSection3Composition } from "./supplierSdsSection3CompositionExtraction";
import { extractSupplierSdsSection7StorageHandling } from "./supplierSdsSection7StorageHandling";
import { extractSupplierSdsSection8Exposure } from "./supplierSdsSection8ExposureExtraction";
import { extractSupplierSdsSection9PhysicalProperties } from "./supplierSdsSection9PhysicalProperties";
import { extractSupplierSdsSections10To15 } from "./supplierSdsSections10To15Extraction";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";

const HASH = "e".repeat(64);
type Scenario = {
  id: string;
  profileId: string;
  section3: string[];
  section9: string[];
  source: SupplierSdsSectionLine["source"];
  expectedType: "substance" | "mixture";
  expectedPhysicalField: string;
  expectTypicalWarning?: boolean;
  expectTradeSecret?: boolean;
};

// These are authored synthetic conformance cases. Supplier SDS PDFs are not
// checked into this repository; no test below claims to reproduce a vendor PDF.
const scenarios: Scenario[] = [
  {
    id: "single-substance-with-typical-properties",
    profileId: "Dow-style synthetic layout",
    section3: ["Product type: Substance", "Chemical name: Example solvent", "CAS number: 111-11-1", "Concentration: 99–100%"],
    section9: ["Boiling point: >100 °C at 101.3 kPa", "Density: Typical value 0.95 g/mL at 25 °C"],
    source: "digital", expectedType: "substance", expectedPhysicalField: "density", expectTypicalWarning: true,
  },
  {
    id: "aqueous-solution-with-condition-bound-ph-and-viscosity",
    profileId: "Evonik-style synthetic layout",
    section3: ["Product type: Mixture", "Name: Active ingredient", "CAS No: 222-22-2", "Concentration: 35–45% w/w", "Name: Water", "CAS No: 7732-18-5", "Concentration: 55–65% w/w"],
    section9: ["pH: 5.0–6.0 (10% aqueous solution at 20 °C)", "Viscosity: 120 mPa·s at 25 °C (Brookfield method)"],
    source: "digital", expectedType: "mixture", expectedPhysicalField: "ph",
  },
  {
    id: "polymer-with-numbered-properties-and-ocr-evidence",
    profileId: "Clariant-style synthetic layout",
    section3: ["Product type: Substance", "Chemical name: Example crosspolymer", "Concentration: 90–100%"],
    section9: ["9.1 Physical state", "Powder", "9.2 pH", "4.0–6.0 (1% dispersion, 25 °C)"],
    source: "ocr", expectedType: "substance", expectedPhysicalField: "ph",
  },
  {
    id: "complex-partially-disclosed-blend-with-layout-variation",
    profileId: "Croda-style synthetic layout",
    section3: ["Product type: Mixture", "Name | CAS No | Concentration | Disclosure", "Known component | 333-33-3 | 10–20% | disclosed", "Proprietary surfactant | 444-44-4 | 1–5% | Confidential", "Other ingredients not disclosed"],
    section9: ["Appearance: Clear liquid", "Density: Data not available"],
    source: "mixed", expectedType: "mixture", expectedPhysicalField: "appearance", expectTradeSecret: true,
  },
];

const HEADINGS = [
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

function fixtureLines(scenario: Scenario): SupplierSdsSectionLine[] {
  const content: Record<number, string[]> = {
    1: ["Product identifier: Synthetic test product", "Recommended use: Laboratory conformance only"],
    2: ["Classification: Not classified in this synthetic fixture", "Signal word: None"],
    3: scenario.section3,
    7: ["Storage conditions: Keep container tightly closed."],
    8: ["Personal protective equipment: Use suitable protective equipment."],
    9: scenario.section9,
    10: ["Chemical stability: Stable under stated test conditions."],
    11: ["Acute toxicity: No data available."],
    12: ["Persistence and degradability: Not reported."],
    13: ["Waste treatment methods: Follow applicable local requirements."],
    14: ["UN number: Not applicable."],
    15: ["Chemical safety assessment: Not performed in this synthetic fixture."],
  };
  const lines: SupplierSdsSectionLine[] = [];
  let lineNumber = 1;
  for (let section = 1; section <= 16; section += 1) {
    lines.push({ pageNumber: 1, lineNumber: lineNumber++, text: `SECTION ${section}: ${HEADINGS[section - 1]}`, source: scenario.source });
    for (const text of content[section] ?? []) lines.push({ pageNumber: 1, lineNumber: lineNumber++, text, source: scenario.source, ...(scenario.source === "ocr" ? { confidence: 0.82, position: { x: 10, y: lineNumber * 4 } } : {}) });
  }
  return lines;
}

describe("universal SDS extraction acceptance matrix", () => {
  it.each(scenarios)("retains review-only evidence across $profileId / $id", (scenario) => {
    const lines = fixtureLines(scenario);
    const sections = detectSupplierSdsSections(lines);
    const section1 = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines, sections });
    const section2 = extractSupplierSdsSection2Hazards({ sourceDocumentHash: HASH, lines, sections });
    const section3 = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines, sections });
    const section7 = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines, sections });
    const section8 = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines, sections });
    const section9 = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: HASH, lines, sections });
    const laterSections = extractSupplierSdsSections10To15({ sourceDocumentHash: HASH, lines, sections });

    expect(section1.candidates.length).toBeGreaterThan(0);
    expect(section2.candidates.length).toBeGreaterThan(0);
    expect(section3.declaration?.rawValue.toLocaleLowerCase("en-US")).toBe(scenario.expectedType);
    expect(section3.components.length).toBeGreaterThan(0);
    expect(section7.candidates.length).toBeGreaterThan(0);
    expect(section8.candidates.length).toBeGreaterThan(0);
    expect(section9.candidates.some(({ field }) => field === scenario.expectedPhysicalField)).toBe(true);
    expect(laterSections.candidates.some(({ sectionNumber }) => sectionNumber === 10)).toBe(true);

    expect(section1.candidates.every((candidate) => candidate.reviewRequired === (scenario.source === "mixed"))).toBe(true);
    const extracted = [section2.candidates, section7.candidates, section8.candidates, section9.candidates, laterSections.candidates].flat();
    expect(extracted.every((candidate) => candidate.reviewRequired === true
      && candidate.evidence.length > 0
      && candidate.evidence.every((evidence) => evidence.sourceDocumentHash === HASH))).toBe(true);
    const compositionFacts = [
      ...(section3.declaration ? [section3.declaration] : []),
      ...section3.declarationAlternates,
      ...section3.disclosureEvidence,
      ...section3.components.flatMap((component) => [
        component.originalName, component.casNumber, component.ecNumber, component.concentration,
        component.mFactor, component.specificConcentrationLimit, component.acuteToxicityEstimate,
        ...component.tradeSecretDisclosures, ...component.alternateFacts.map(({ fact }) => fact),
      ].filter((fact) => fact !== undefined)),
    ];
    expect(compositionFacts.length).toBeGreaterThan(0);
    expect(compositionFacts.every((fact) => fact.reviewRequired === true
      && fact.evidence.length > 0
      && fact.evidence.every((evidence) => evidence.sourceDocumentHash === HASH))).toBe(true);
    expect(section9.warnings.includes("section_9_typical_value_not_specification")).toBe(Boolean(scenario.expectTypicalWarning));
    if (scenario.expectTradeSecret) {
      expect(section3.warnings).toContain("trade_secret_or_proprietary_disclosure");
      expect(section3.warnings).toContain("undisclosed_remainder_disclosed");
    }
    if (scenario.source === "ocr") expect(section9.warnings).toContain("section_9_ocr_requires_review");
    if (scenario.source === "mixed") expect(section9.warnings).toContain("section_9_provenance_requires_review");
  });
});
