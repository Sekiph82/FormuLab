import { describe, expect, it } from "vitest";
import type { CommercialProduct } from "../schemas/commercialProduct";
import { createReferenceFormulationSource } from "../schemas/referenceFormulationSource";
import { supplierDocumentAcquisitionSchema } from "../schemas/supplierDocument";
import { validateReferenceFormulationArithmetic } from "./referenceFormulationArithmetic";
import { extractReferenceFormulationIdentity } from "./referenceFormulationIdentityExtraction";
import { extractReferenceFormulationIngredientLines } from "./referenceFormulationIngredientExtraction";
import { extractReferenceFormulationProcedure } from "./referenceFormulationProcedureExtraction";
import { matchReferenceFormulationProducts } from "./referenceFormulationProductMatching";
import { extractReferenceFormulationTargets } from "./referenceFormulationTargetExtraction";
import { buildReferenceFormulationUnresolvedQueue } from "./referenceFormulationUnresolvedQueue";
import { createReferenceFormulationNormalizationVersion } from "../schemas/referenceFormulationNormalization";
import { createReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import { createReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { supplierSdsProductEvidenceRecordSchema, supplierSdsProductEvidenceSchema } from "../schemas/supplierSdsProductEvidence";
import { buildReferenceFormulationLocalIndex, searchReferenceFormulationLocalIndex } from "./referenceFormulationIndex";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { extractSupplierSdsSection1 } from "./supplierSdsSection1Extraction";
import { commercialProductSchema } from "../schemas/commercialProduct";

const NOW = "2026-10-26T12:00:00.000Z";
const FORMULATION_HASH = "78540c2399aa20c813aab5ff176dfa1229cc59509ec31ea707a331a9f642f38b";

const formulaPages = [{ pageNumber: 1, blocks: [
  { type: "heading" as const, blockIndex: 0, text: "Development Formulation", source: "digital" as const },
  { type: "text" as const, blockIndex: 1, text: "Hand Dishwash Detergent Liquid HC/DW/22", source: "digital" as const },
  { type: "text" as const, blockIndex: 2, text: "Procedure: Add ingredients in order listed with stirring, dissolving each before adding the next ingredient. Use citric acid to adjust the solution pH to ~7. Finally, add EBC Crothix Liquid HC MBAL to thicken the liquid and stir until clear and homogenous.", source: "digital" as const },
  { type: "table" as const, blockIndex: 3, source: "digital" as const, rows: [
    ["Ingredient/INCI Name", "Functionality", "% w/w"],
    ["DI Water", "Diluent", "80.7"],
    ["SLE(3)S (30%, aq.)", "Anionic detergent", "3.0"],
    ["Incromine™ Oxide C", "Nonionic detergent", "3.0"],
    ["ECO Brij™ L6L", "Nonionic detergent", "4.0"],
    ["NatraSense™ AG-810", "Alkylpolyglucoside detergent", "3.0"],
    ["Crodateric™ CDA 38", "Hydrotrope/stabilizer", "3.0"],
    ["Citric acid (25%, aq.)", "pH adjuster (to pH 7)", "0.3"],
    ["EBC Crothix™ Liquid HC MBAL", "Thickening agent", "3.0"],
    ["Total", "-", "100.0"],
    ["Viscosity (cP)", "-", "~375"],
  ] },
] }];

const acquisition = (input: {
  code: string;
  filename: string;
  hash: string;
  byteSize: number;
  documentType: "FORMULATION" | "SDS";
  tradeName: string;
  productCode?: string;
  sourceRevision?: string;
  revisionDate?: string;
}) => supplierDocumentAcquisitionSchema.parse({
  schemaVersion: "1.0",
  code: input.code,
  supplierId: "supplier-croda",
  providerId: "croda-public",
  surfaceId: input.documentType === "FORMULATION" ? "formulation-library" : "sds-library",
  documentType: input.documentType,
  acquisitionMethod: "manual_assisted",
  sourceFileSelection: {
    selectionId: `${input.code}-selection`,
    originalFilename: input.filename,
    sourceFileSha256: input.hash,
    selectedAt: NOW,
    selectedBy: "test-owner",
  },
  sourceProduct: { tradeName: input.tradeName, ...(input.productCode ? { supplierItemCode: input.productCode } : {}) },
  market: "US",
  language: "en",
  ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
  ...(input.revisionDate ? { revisionDate: input.revisionDate } : {}),
  originalFilename: input.filename,
  mimeType: "application/pdf",
  sha256: input.hash,
  byteSize: input.byteSize,
  parserStatus: "completed",
  acquiredAt: NOW,
  createdAt: NOW,
});

const formulaAcquisition = acquisition({
  code: "croda-formulation-hc-dw-22-v1",
  filename: "Croda_787_Hand_Dishwash_Detergent_Liquid.pdf",
  hash: FORMULATION_HASH,
  byteSize: 69279,
  documentType: "FORMULATION",
  tradeName: "Hand Dishwash Detergent Liquid",
});

const source = createReferenceFormulationSource({
  id: "reference-formula-croda-hc-dw-22-v1",
  acquisition: formulaAcquisition,
  formulationCode: "HC/DW/22",
  title: "Hand Dishwash Detergent Liquid",
  parserVersion: "formulab-reference-formulation-layout-v1",
  rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] },
  createdAt: NOW,
});

const sdsDocuments = [
  {
    code: "croda-sds-ha42553", filename: "HA42553_INCROMINE OXIDE C-LQ-(MH)_USENSDS.pdf",
    hash: "4b22d1a57150d299f2e66de683fe950d30882b0e083d75bd2f37e2f00e79688e", byteSize: 323352,
    tradeName: "INCROMINE OXIDE C-LQ-(MH)", productCode: "HA42553", sourceRevision: "2.0", revisionDate: "12/22/2025",
    formulaAlias: "Incromine™ Oxide C",
  },
  {
    code: "croda-sds-et49803", filename: "ET49803_ECO BRIJ L6L-LQ-(AP)_USENSDS.pdf",
    hash: "cc494a64611eea5c9dc4331f50873d6baecc9d55538e90424a1fcd7ffe80f7ac", byteSize: 136710,
    tradeName: "ECO BRIJ L6L-LQ-(AP)", productCode: "ET49803", sourceRevision: "1.0", revisionDate: "12/30/2020",
    formulaAlias: "ECO Brij™ L6L",
  },
  {
    code: "croda-sds-inr2882", filename: "INR2882_NATRASENSE AG-810-LQ-(MV)_USENSDS.pdf",
    hash: "272b5cc4a5657c436324fe6668b422cc29cf1b40aad5c19c536ab411281077ba", byteSize: 189660,
    tradeName: "NATRASENSE AG-810-LQ-(MV)", productCode: "INR2882", sourceRevision: "1.1", revisionDate: "08/17/2016",
    formulaAlias: "NatraSense™ AG-810",
  },
  {
    code: "croda-sds-hh47997", filename: "HH47997_CRODATERIC CDA 38-LQ-(AP)_USENSDS.pdf",
    hash: "e9809869173ae0e4dab1c1ecf50ba32095b5bacf6ee5c5e2957e446e3cff1a56", byteSize: 313486,
    tradeName: "CRODATERIC CDA 38-LQ-(AP)", productCode: "HH47997", sourceRevision: "2.0", revisionDate: "12/22/2025",
    formulaAlias: "Crodateric™ CDA 38",
  },
].map((item) => ({
  item,
  acquisition: acquisition({ ...item, documentType: "SDS" }),
  product: {
    schemaVersion: "1.0" as const,
    id: `commercial-${item.productCode!.toLowerCase()}`,
    supplierId: "supplier-croda",
    tradeName: item.tradeName,
    productCode: item.productCode,
    aliases: [{ value: item.formulaAlias, kind: "trade_name" as const, sourceDocumentCode: item.code }],
    sourceDocumentCodes: [item.code],
    sourceFormulationReferences: [],
    lifecycleStatus: "active" as const,
    reviewStatus: "unreviewed" as const,
  },
}));

describe("Croda HC/DW/22 supplied-source acceptance", () => {
  it("extracts the printed formula, reconciles its total, matches only supplied SDS products, and queues unsupported lines", () => {
    const identity = extractReferenceFormulationIdentity({ acquisition: formulaAcquisition, pages: formulaPages });
    expect(identity.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "formulation_title", rawValue: "Hand Dishwash Detergent Liquid" }),
      expect.objectContaining({ field: "formulation_code", rawValue: "HC/DW/22" }),
    ]));

    const procedure = extractReferenceFormulationProcedure({ source, pages: formulaPages });
    expect(procedure.steps).toHaveLength(1);
    expect(procedure.steps[0]).toMatchObject({
      extractionMethod: "procedure_section_text",
      actions: ["addition", "dissolve", "mix", "adjust_ph", "thicken", "appearance_check"],
      conditions: expect.arrayContaining([
        expect.objectContaining({ kind: "ph", rawValue: "pH to ~7" }),
        expect.objectContaining({ kind: "appearance", rawValue: "clear" }),
        expect.objectContaining({ kind: "homogeneity", rawValue: "homogenous" }),
      ]),
      evidence: { sourceDocumentHash: FORMULATION_HASH, pageNumber: 1, blockIndex: 2 },
      reviewRequired: true,
    });

    const extraction = extractReferenceFormulationIngredientLines({ source, pages: formulaPages });
    expect(extraction.lines.map(({ ingredientName, function: role, amount }) => [ingredientName?.rawValue, role?.rawValue, amount?.rawValue])).toEqual([
      ["DI Water", "Diluent", "80.7"],
      ["SLE(3)S (30%, aq.)", "Anionic detergent", "3.0"],
      ["Incromine™ Oxide C", "Nonionic detergent", "3.0"],
      ["ECO Brij™ L6L", "Nonionic detergent", "4.0"],
      ["NatraSense™ AG-810", "Alkylpolyglucoside detergent", "3.0"],
      ["Crodateric™ CDA 38", "Hydrotrope/stabilizer", "3.0"],
      ["Citric acid (25%, aq.)", "pH adjuster (to pH 7)", "0.3"],
      ["EBC Crothix™ Liquid HC MBAL", "Thickening agent", "3.0"],
    ]);
    expect(extraction.lines.every((line) => line.reviewRequired && line.sourceDocumentHash === FORMULATION_HASH)).toBe(true);
    expect(extraction.warnings).toContain("summary_rows_excluded");

    const arithmetic = validateReferenceFormulationArithmetic({
      source,
      lines: extraction.lines,
      sourceDeclaredTotal: {
        rawValue: "100.0",
        unit: "% w/w",
        evidence: { sourceDocumentHash: FORMULATION_HASH, pageNumber: 1, blockIndex: 3, excerpt: "Total - 100.0", source: "digital" },
      },
    });
    expect(arithmetic).toMatchObject({
      calculatedTotal: { kind: "exact", lowerBound: "100", upperBound: "100", unit: "% w/w" },
      arithmeticStatus: "consistent",
      lineCount: 8,
      warnings: [],
    });

    const targets = extractReferenceFormulationTargets({ source, pages: formulaPages });
    expect(targets.candidates).toHaveLength(1);
    expect(targets.candidates[0]).toMatchObject({
      field: "viscosity", rawPropertyLabel: "Viscosity (cP)", rawValue: "~375", valueShape: "approximate",
      evidence: { sourceDocumentHash: FORMULATION_HASH, pageNumber: 1, blockIndex: 3, rowIndex: 10, cellIndex: 2, source: "digital" },
      reviewRequired: true,
    });
    expect(targets.candidates.some(({ field }) => field === "ph")).toBe(false);

    const products = sdsDocuments.map(({ product }) => product) as CommercialProduct[];
    const matching = matchReferenceFormulationProducts({ source, lines: extraction.lines, products });
    expect(matching.lines.filter(({ resolution }) => resolution === "alias_match_candidate")).toHaveLength(4);
    expect(matching.lines.every(({ autoLinked, reviewRequired }) => autoLinked === false && reviewRequired)).toBe(true);
    const unresolved = buildReferenceFormulationUnresolvedQueue({
      source,
      lines: extraction.lines,
      matching,
      products,
      supplierDocuments: sdsDocuments.map(({ acquisition: document }) => document),
    });
    const acquisitionNames = unresolved.entries
      .filter(({ status }) => status === "ready_for_acquisition")
      .map(({ ingredientLine }) => ingredientLine.ingredientName?.rawValue);
    expect(acquisitionNames).toEqual(["DI Water", "SLE(3)S (30%, aq.)", "Citric acid (25%, aq.)", "EBC Crothix™ Liquid HC MBAL"]);
    expect(unresolved.entries.filter(({ status }) => status === "ready_for_review")).toHaveLength(4);
    expect(unresolved.entries.find(({ ingredientLine }) => ingredientLine.ingredientName?.rawValue === "SLE(3)S (30%, aq.)")).toMatchObject({
      status: "ready_for_acquisition", reasons: ["product_identity_unmatched", "supporting_sds_missing"],
    });
    expect(unresolved.entries.find(({ ingredientLine }) => ingredientLine.ingredientName?.rawValue === "EBC Crothix™ Liquid HC MBAL")).toMatchObject({
      status: "ready_for_acquisition", reasons: ["product_identity_unmatched", "supporting_sds_missing"],
    });
    expect(unresolved.sourceLines).toEqual(extraction.lines);
  });

  it("carries a four-document Croda fixture through source-linked review, normalization, indexing, and retrieval", () => {
    // These are synthetic parser inputs keyed to the supplied document names and hashes;
    // they do not claim to reproduce or disclose the contents of supplier SDS PDFs.
    const fixtureFormulaAcquisition = acquisition({
      code: "croda-formulation-e2e-synthetic", filename: "synthetic-Croda_787_Hand_Dishwash_Detergent_Liquid.pdf",
      hash: "f".repeat(64), byteSize: 1024, documentType: "FORMULATION", tradeName: "Hand Dishwash Detergent Liquid",
    });
    const fixtureSource = createReferenceFormulationSource({
      id: "reference-source-croda-hc-dw-22-e2e-fixture", acquisition: fixtureFormulaAcquisition,
      formulationCode: "HC/DW/22", title: "Hand Dishwash Detergent Liquid",
      parserVersion: "formulab-reference-formulation-layout-v1",
      rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: NOW,
    });
    const extractedIdentity = extractReferenceFormulationIdentity({ acquisition: fixtureFormulaAcquisition, pages: formulaPages });
    const extractedLines = extractReferenceFormulationIngredientLines({ source: fixtureSource, pages: formulaPages });
    const arithmetic = validateReferenceFormulationArithmetic({
      source: fixtureSource,
      lines: extractedLines.lines,
      sourceDeclaredTotal: {
        rawValue: "100.0", unit: "% w/w",
        evidence: { sourceDocumentHash: fixtureSource.sourcePdfSha256, pageNumber: 1, blockIndex: 3, excerpt: "Total - 100.0", source: "digital" },
      },
    });
    const procedure = extractReferenceFormulationProcedure({ source: fixtureSource, pages: formulaPages });
    const targets = extractReferenceFormulationTargets({ source: fixtureSource, pages: formulaPages });

    const sdsRecords = sdsDocuments.map(({ item }, index) => {
      const syntheticHash = String(index + 1).repeat(64);
      const acquisitionRecord = supplierDocumentAcquisitionSchema.parse({
        ...acquisition({ ...item, hash: syntheticHash, filename: `synthetic-${item.filename}`, documentType: "SDS" }),
        sourceProduct: { supplierItemCode: item.productCode, tradeName: item.tradeName },
      });
      const lines: SupplierSdsSectionLine[] = [
        { pageNumber: 1, lineNumber: 1, text: "SECTION 1: Identification of the substance/mixture and of the company/undertaking", source: "digital" },
        { pageNumber: 1, lineNumber: 2, text: `Chemical name: ${item.tradeName}`, source: "digital" },
        { pageNumber: 1, lineNumber: 3, text: "SECTION 2: Hazards identification", source: "digital" },
        { pageNumber: 1, lineNumber: 4, text: "SECTION 3: Composition/information on ingredients", source: "digital" },
        { pageNumber: 1, lineNumber: 5, text: "SECTION 4: First aid measures", source: "digital" },
      ];
      const sections = detectSupplierSdsSections(lines);
      const section1 = extractSupplierSdsSection1({ sourceDocumentHash: syntheticHash, lines, sections });
      const nameCandidate = section1.candidates.find((candidate) => candidate.field === "declared_chemical_name");
      expect(nameCandidate?.rawValue).toBe(item.tradeName);
      const evidence = supplierSdsProductEvidenceSchema.parse({
        schemaVersion: "1.0", id: `sds-evidence-${item.productCode}`,
        commercialProductId: `commercial-${item.productCode!.toLowerCase()}`,
        section1: {
          sectionNumber: 1, sourceDocumentHash: syntheticHash,
          declaredChemicalName: {
            id: `sds-name-${item.productCode}`, rawValue: nameCandidate!.rawValue,
            evidenceRefs: nameCandidate!.evidence.map((entry) => `${item.code}:page:${entry.pageNumber}:line:${entry.lineNumber}`),
          },
        },
        section3: { sectionNumber: 3, sourceDocumentHash: syntheticHash, components: [] },
      });
      const product = commercialProductSchema.parse({
        schemaVersion: "1.0", id: `commercial-${item.productCode!.toLowerCase()}`, supplierId: "supplier-croda",
        tradeName: nameCandidate!.rawValue, productCode: item.productCode,
        aliases: [{ value: item.formulaAlias, kind: "trade_name", sourceDocumentCode: acquisitionRecord.code }],
        sourceDocumentCodes: [acquisitionRecord.code], sourceFormulationReferences: [],
        lifecycleStatus: "active", reviewStatus: "unreviewed",
      });
      return { acquisition: acquisitionRecord, evidence, product };
    });

    const products = sdsRecords.map(({ product }) => product);
    const matching = matchReferenceFormulationProducts({ source: fixtureSource, lines: extractedLines.lines, products });
    const unresolved = buildReferenceFormulationUnresolvedQueue({
      source: fixtureSource, lines: extractedLines.lines, matching, products,
      supplierDocuments: sdsRecords.map(({ acquisition: record }) => record),
    });
    const record = createReferenceFormulationRecord({
      id: "reference-formula-croda-hc-dw-22-e2e-fixture", code: "reference-formula-croda-hc-dw-22-e2e-fixture", source: fixtureSource,
      identityCandidates: extractedIdentity.candidates, identityMetadataComparisons: extractedIdentity.metadataComparisons,
      identityWarnings: extractedIdentity.warnings, ingredientLines: extractedLines.lines, arithmetic,
      procedureSteps: procedure.steps, procedureWarnings: procedure.warnings,
      targetCandidates: targets.candidates, targetWarnings: targets.warnings,
      productMatches: matching.lines, productMatchWarnings: matching.warnings,
      unresolvedEntries: unresolved.entries, createdAt: NOW,
    });
    const normalization = createReferenceFormulationNormalizationVersion({
      id: "normalization-croda-hc-dw-22-e2e-fixture", source: record, version: 1,
      supplierSdsEvidenceRecords: sdsRecords.map(({ acquisition: acquired, evidence }) => supplierSdsProductEvidenceRecordSchema.parse({
        schemaVersion: "1.0", code: evidence.id, acquisitionCode: acquired.code, evidence, extractionStatus: "unreviewed", createdAt: NOW,
      })),
      createdAt: NOW,
    });
    const queryRecord = createReferenceFormulationQueryRecord({ source: record, normalization });
    const index = buildReferenceFormulationLocalIndex([queryRecord]);

    expect(sdsRecords).toHaveLength(4);
    expect(sdsRecords.every(({ evidence, acquisition: acquired }) =>
      evidence.section1.sourceDocumentHash === acquired.sha256.toLowerCase()
      && evidence.section3.sourceDocumentHash === acquired.sha256.toLowerCase())).toBe(true);
    expect(record.sourceDocumentHash).toBe("f".repeat(64));
    expect(record.identityCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "formulation_code", rawValue: "HC/DW/22" }),
    ]));
    expect(record.arithmetic.arithmeticStatus).toBe("consistent");
    expect(record.productMatches.filter((match) => match.resolution === "alias_match_candidate")).toHaveLength(4);
    expect(record.productMatches.every((match) => match.autoLinked === false && match.reviewRequired)).toBe(true);
    expect(record.unresolvedEntries.filter((entry) => entry.status === "ready_for_acquisition").map((entry) => entry.ingredientLine.ingredientName?.rawValue))
      .toEqual(["DI Water", "SLE(3)S (30%, aq.)", "Citric acid (25%, aq.)", "EBC Crothix™ Liquid HC MBAL"]);
    expect(normalization.lines.every((line) => line.canonicalChemistry.status === "unresolved")).toBe(true);
    expect(searchReferenceFormulationLocalIndex(index, { supplierIds: ["supplier-croda"], aliases: ["HC/DW/22"] }))
      .toEqual([queryRecord.id]);
    expect(queryRecord).not.toHaveProperty("productionFormulaId");
    expect(queryRecord).not.toHaveProperty("rawMaterial");
  });
});
