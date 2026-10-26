import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { admitSupplierPdf, SUPPLIER_PDF_DEFAULT_MAX_BYTES } from "./supplierDocumentAdmission";

async function validPdf(pageCount = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) document.addPage();
  return document.save();
}

describe("supplier PDF admission and quarantine", () => {
  it("admits a parseable PDF and returns only safe metadata", async () => {
    const bytes = await validPdf();
    const result = await admitSupplierPdf({ bytes, filename: "supplier-sds 2026.pdf", declaredMimeType: "application/pdf; charset=binary" });
    expect(result).toMatchObject({ status: "admitted", safeFilename: "supplier-sds 2026.pdf", byteSize: bytes.byteLength, pageCount: 1, parser: "pdf-lib" });
    expect("bytes" in result).toBe(false);
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
});
