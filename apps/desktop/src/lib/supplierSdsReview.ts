import { supplierDocumentAcquisitionSchema, type SupplierDocumentAcquisition } from "@formulab/shared";
import {
  extractSupplierSdsSection1,
  extractSupplierSdsSection3Composition,
  detectSupplierSdsSections,
  extractSupplierSdsSection2Hazards,
  extractSupplierSdsSection7StorageHandling,
  extractSupplierSdsSection8Exposure,
  extractSupplierSdsSection9PhysicalProperties,
  extractSupplierSdsSections10To15,
  type SupplierSdsSectionLine,
} from "@formulab/shared";
import { extractSupplierPdfText } from "./supplierPdfTextExtraction";
import { runConditionalSupplierPdfOcr } from "./supplierPdfOcr";

export async function extractSupplierSdsReview(acquisitionInput: SupplierDocumentAcquisition, bytes: Uint8Array) {
  const acquisition = supplierDocumentAcquisitionSchema.parse(acquisitionInput);
  if (acquisition.documentType !== "SDS") throw new Error("SDS review requires an acquired SDS document.");
  const extraction = await extractSupplierPdfText({ bytes, filename: acquisition.originalFilename, declaredMimeType: acquisition.mimeType });
  if (extraction.status !== "extracted") return { status: "quarantined" as const, reason: extraction.reason, parserVersion: extraction.parserVersion };
  if (extraction.documentHash !== acquisition.sha256) throw new Error("Extracted PDF hash does not match the immutable SDS acquisition.");

  const ocr = await runConditionalSupplierPdfOcr(extraction, {
    languages: ["eng", "tur", "deu"],
    maxPages: 20,
    sourcePdfBytes: bytes,
  });
  const nextOcrLineByPage = new Map<number, number>();
  const digitalLines = extraction.pages.flatMap((page) => page.lines.map((line) => ({
    pageNumber: page.pageNumber, lineNumber: line.lineNumber, text: line.text, source: "digital" as const,
    ...(line.position ? { position: line.position } : {}),
  })));
  const ocrLines = ocr.lines.map((line) => {
    const next = (extraction.pages.find((page) => page.pageNumber === line.pageNumber)?.lines.length ?? 0)
      + (nextOcrLineByPage.get(line.pageNumber) ?? 0) + 1;
    nextOcrLineByPage.set(line.pageNumber, next - (extraction.pages.find((page) => page.pageNumber === line.pageNumber)?.lines.length ?? 0));
    return { pageNumber: line.pageNumber, lineNumber: next, text: line.text, source: "ocr" as const, confidence: line.confidence };
  });
  const lines: SupplierSdsSectionLine[] = [...digitalLines, ...ocrLines]
    .sort((a, b) => a.pageNumber - b.pageNumber || a.lineNumber - b.lineNumber);
  const sections = detectSupplierSdsSections(lines);
  const parserInput = { sourceDocumentHash: acquisition.sha256, lines, sections, ocrParserVersion: ocr.parserVersion };
  return {
    status: "extracted" as const,
    extraction,
    ocr,
    lines,
    sections,
    section1: extractSupplierSdsSection1(parserInput),
    section3: extractSupplierSdsSection3Composition(parserInput),
    section2: extractSupplierSdsSection2Hazards(parserInput),
    section7: extractSupplierSdsSection7StorageHandling(parserInput),
    section8: extractSupplierSdsSection8Exposure(parserInput),
    section9: extractSupplierSdsSection9PhysicalProperties(parserInput),
    sections10To15: extractSupplierSdsSections10To15(parserInput),
  };
}
