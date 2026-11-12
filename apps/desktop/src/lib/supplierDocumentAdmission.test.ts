import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { admitSupplierPdf, SUPPLIER_PDF_DEFAULT_MAX_BYTES } from "./supplierDocumentAdmission";
import { extractSupplierPdfText, SUPPLIER_PDF_TEXT_PARSER_VERSION } from "./supplierPdfTextExtraction";

async function validPdf(pageCount = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = document.addPage();
    page.drawText(`Supplier page ${pageIndex + 1}`, { x: 72, y: 720 });
  }
  return document.save();
}

describe("supplier PDF admission and quarantine", () => {
  it("admits a parseable PDF and returns only safe metadata", async () => {
    const bytes = await validPdf();
    const result = await admitSupplierPdf({ bytes, filename: "supplier-sds 2026.pdf", declaredMimeType: "application/pdf; charset=binary" });
    expect(result).toMatchObject({ status: "admitted", safeFilename: "supplier-sds 2026.pdf", byteSize: bytes.byteLength, pageCount: 1, parser: "pdf-lib" });
    expect("bytes" in result).toBe(false);
  });

  it("admits supplier filenames with safe product-name parentheses", async () => {
    const filename = "HA42553_INCROMINE OXIDE C-LQ-(MH)_USENSDS.pdf";
    const result = await admitSupplierPdf({ bytes: await validPdf(), filename, declaredMimeType: "application/pdf" });
    expect(result).toMatchObject({ status: "admitted", safeFilename: filename });
  });

  it.each([
    ["", "application/pdf", "empty_file"],
    ["<html>not pdf</html>", "application/pdf", "invalid_signature"],
    ["%PDF-1.7\n", "text/html", "invalid_content_type"],
    ["%PDF-1.7\n", "application/pdf", "malformed_pdf"],
  ] as const)("quarantines invalid input with a fixed reason (%s)", async (text, declaredMimeType, reason) => {
    await expect(admitSupplierPdf({ bytes: new TextEncoder().encode(text), filename: "source.pdf", declaredMimeType }))
      .resolves.toEqual({ status: "quarantined", reason });
  });

  it("rejects encrypted and over-page-limit documents before downstream parsing", async () => {
    const loadSpy = vi.spyOn(PDFDocument, "load").mockRejectedValueOnce(new Error("Input document to PDFDocument.load is encrypted."));
    await expect(admitSupplierPdf({ bytes: await validPdf(), filename: "encrypted.pdf", declaredMimeType: "application/pdf" }))
      .resolves.toMatchObject({ status: "quarantined", reason: "encrypted_pdf" });
    loadSpy.mockRestore();
    await expect(admitSupplierPdf({ bytes: await validPdf(3), filename: "large.pdf", declaredMimeType: "application/pdf" }, { maxPages: 2 }))
      .resolves.toMatchObject({ status: "quarantined", reason: "page_limit_exceeded" });
  });

  it("quarantines parser failures without returning exception text, URLs or secrets", async () => {
    const privateDetails = "https://supplier.example/sds.pdf?token=TOPSECRET password=PRIVATE-CREDENTIAL";
    const loadSpy = vi.spyOn(PDFDocument, "load").mockRejectedValueOnce(new Error(privateDetails));

    const result = await admitSupplierPdf({
      bytes: await validPdf(),
      filename: "supplier.pdf",
      declaredMimeType: "application/pdf",
    });

    expect(result).toEqual({ status: "quarantined", reason: "malformed_pdf" });
    expect(JSON.stringify(result)).not.toContain("TOPSECRET");
    expect(JSON.stringify(result)).not.toContain("PRIVATE-CREDENTIAL");
    expect(JSON.stringify(result)).not.toContain("supplier.example");
    loadSpy.mockRestore();
  });

  it.each(["../escape.pdf", "C:\\temp\\source.pdf", "CON.pdf", "bad:name.pdf", ".hidden.pdf", "a..b.pdf"])(
    "quarantines unsafe filename %s", async (filename) => {
      await expect(admitSupplierPdf({ bytes: await validPdf(), filename, declaredMimeType: "application/pdf" }))
        .resolves.toMatchObject({ status: "quarantined", reason: "unsafe_filename" });
    },
  );

  it("applies the configured byte cap and refuses invalid cap overrides", async () => {
    const bytes = await validPdf();
    await expect(admitSupplierPdf({ bytes, filename: "source.pdf", declaredMimeType: "application/pdf" }, { maxBytes: 1 }))
      .resolves.toMatchObject({ status: "quarantined", reason: "file_too_large" });
    await expect(admitSupplierPdf({ bytes, filename: "source.pdf", declaredMimeType: "application/pdf" }, { maxBytes: SUPPLIER_PDF_DEFAULT_MAX_BYTES + 1 }))
      .resolves.toMatchObject({ status: "admitted" });
    await expect(admitSupplierPdf({ bytes, filename: "source.pdf", declaredMimeType: "application/pdf" }, { maxPages: 5_001 }))
      .rejects.toThrow(/limits exceed the supported policy/);
  });

  it("extracts page-separated lines with stable parser version and document hash", async () => {
    const bytes = await validPdf(2);
    const result = await extractSupplierPdfText({ bytes, filename: "supplier.pdf", declaredMimeType: "application/pdf" });
    expect(result).toMatchObject({ status: "extracted", pageCount: 2, parserVersion: SUPPLIER_PDF_TEXT_PARSER_VERSION });
    if (result.status !== "extracted") return;
    expect(result.documentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.pages.map(({ pageNumber }) => pageNumber)).toEqual([1, 2]);
    expect(result.pages[0]?.lines.map(({ text }) => text).join(" ")).toContain("Supplier page 1");
    expect(result.pages[1]?.lines.map(({ text }) => text).join(" ")).toContain("Supplier page 2");
    expect(result.pages[0]?.lines[0]?.position).toBeDefined();
  });

  it("keeps a deterministic character cap and reports truncation", async () => {
    const result = await extractSupplierPdfText({
      bytes: await validPdf(),
      filename: "supplier.pdf",
      declaredMimeType: "application/pdf",
    }, { maxChars: 6 });
    expect(result.status).toBe("extracted");
    if (result.status !== "extracted") return;
    expect(result.pages.flatMap(({ lines }) => lines).map(({ text }) => text).join("").length).toBeLessThanOrEqual(6);
    expect(result.warnings).toContain("text_limit_reached");
  });
});
