import { supplierDocumentAcquisitionSchema, type SupplierDocumentAcquisition } from "@formulab/shared";
import type { SupplierPdfTextExtractionResult } from "./supplierPdfTextExtraction";
import {
  runConditionalSupplierPdfOcr,
  type SupplierPdfOcrOptions,
  type SupplierPdfOcrResult,
  type SupplierPdfOcrWarning,
} from "./supplierPdfOcr";

export const REFERENCE_FORMULATION_OCR_PARSER_VERSION = "formulab-reference-formulation-ocr-v1";

export interface ReferenceFormulationOcrResult extends Omit<SupplierPdfOcrResult, "parserVersion"> {
  textExtractionParserVersion: string;
  ocrParserVersion: typeof REFERENCE_FORMULATION_OCR_PARSER_VERSION;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", ownedBytes.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Reuse bounded local supplier-PDF OCR for formulation acquisitions only. */
export async function runConditionalReferenceFormulationOcr(input: {
  acquisition: SupplierDocumentAcquisition;
  extraction: SupplierPdfTextExtractionResult;
  options: SupplierPdfOcrOptions;
}, signal?: AbortSignal): Promise<ReferenceFormulationOcrResult> {
  const acquisition = supplierDocumentAcquisitionSchema.parse(input.acquisition);
  if (acquisition.documentType !== "FORMULATION") {
    throw new Error("Reference formulation OCR requires a FORMULATION document acquisition.");
  }
  if (input.extraction.status === "extracted" && input.extraction.documentHash !== acquisition.sha256) {
    throw new Error("PDF text extraction hash does not match the immutable formulation acquisition hash.");
  }
  if (input.options.sourcePdfBytes && await sha256(input.options.sourcePdfBytes) !== acquisition.sha256) {
    throw new Error("OCR source PDF bytes do not match the immutable formulation acquisition hash.");
  }

  const result = await runConditionalSupplierPdfOcr(input.extraction, input.options, signal);
  return {
    ...result,
    sourceDocumentHash: acquisition.sha256,
    textExtractionParserVersion: input.extraction.parserVersion,
    ocrParserVersion: REFERENCE_FORMULATION_OCR_PARSER_VERSION,
  };
}

export type ReferenceFormulationOcrWarning = SupplierPdfOcrWarning;
