import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import {
  assembleDossierExportSnapshot,
  DOCUMENT_FORMAT_MIME_TYPES,
  type DossierExportSnapshotInput,
  type RegulatoryDossier,
  type RegulatoryDossierEvidenceItem,
  type RegulatoryDossierRequirement,
  type RegulatoryRequirementEvidenceLink,
} from "@ai4s/shared";
import { renderDossierDocx } from "./dossierDocx";
import { renderDossierPdf } from "./dossierPdf";
import { renderDossierDocument } from "./index";

const DOSSIER: RegulatoryDossier = {
  schemaVersion: "1.0",
  id: "dossier-1",
  dossierCode: "TEST-DOSS-001",
  title: "Test Dossier",
  formulationId: "formulation-1",
  formulaVersionId: "version-1",
  jurisdictions: ["KE"],
  productFamilyCode: "HAIR_CARE",
  targetMarkets: ["KE"],
  status: "draft",
  revision: 1,
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const REQ_A: RegulatoryDossierRequirement = {
  schemaVersion: "1.0",
  id: "req-a",
  dossierId: DOSSIER.id,
  dossierRevision: 1,
  jurisdiction: "KE",
  requirementCode: "REQ-A",
  requirementType: "document",
  title: "Requirement A",
  isManual: false,
  mandatory: true,
  critical: false,
  applicabilityStatus: "applicable",
  applicabilityReason: "Applies to KE.",
  evidenceRequirement: true,
  documentTypesAccepted: ["sds"],
  minimumEvidenceCount: 1,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const EVID_NEW: RegulatoryDossierEvidenceItem = {
  schemaVersion: "1.0",
  id: "evid-new",
  dossierId: DOSSIER.id,
  formulationId: DOSSIER.formulationId,
  formulaVersionId: DOSSIER.formulaVersionId,
  jurisdictions: ["KE"],
  evidenceType: "sds",
  title: "SDS v2",
  status: "verified",
  sourceType: "uploaded",
  attachmentIds: [],
  confidentiality: "normal",
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const LINK_ACCEPTED: RegulatoryRequirementEvidenceLink = {
  schemaVersion: "1.0",
  id: "link-1",
  dossierId: DOSSIER.id,
  requirementId: "req-a",
  evidenceItemId: "evid-new",
  linkStatus: "accepted",
  linkedBy: "u1",
  linkedAt: "2026-01-02T00:00:00.000Z",
};

function baseInput(overrides: Partial<DossierExportSnapshotInput> = {}): DossierExportSnapshotInput {
  return {
    dossier: DOSSIER,
    dossierRevision: 1,
    requirements: [REQ_A],
    evidenceItems: [EVID_NEW],
    links: [LINK_ACCEPTED],
    reviews: [],
    reviewRevocations: [],
    submissions: [],
    manualRequirementActions: [],
    generationTimestamp: "2026-02-01T00:00:00.000Z",
    generatedBy: "u3",
    ...overrides,
  };
}

const DRAFT_SNAPSHOT = assembleDossierExportSnapshot(baseInput({ formulaApprovalStatusAtGeneration: "concept" }));
const APPROVED_SNAPSHOT = assembleDossierExportSnapshot(baseInput({ formulaApprovalStatusAtGeneration: "production_approved" }));

const PDF_MAGIC = "%PDF-";

describe("renderDossierPdf", () => {
  it("produces valid PDF bytes", async () => {
    const bytes = await renderDossierPdf(DRAFT_SNAPSHOT);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe(PDF_MAGIC);
  });

  it("includes dossier traceability in the structural content", async () => {
    const bytes = await renderDossierPdf(DRAFT_SNAPSHOT);
    expect(extractPdfText(bytes)).toContain("TEST-DOSS-001");
  });

  it("shows a draft warning for a non-approved source", async () => {
    const bytes = await renderDossierPdf(DRAFT_SNAPSHOT);
    expect(extractPdfText(bytes)).toContain("NOT PRODUCTION APPROVED");
  });

  it("does not show a false draft warning for a production-approved source", async () => {
    const bytes = await renderDossierPdf(APPROVED_SNAPSHOT);
    expect(extractPdfText(bytes)).not.toContain("NOT PRODUCTION APPROVED");
  });

  it("produces byte-identical output for identical input", async () => {
    const a = await renderDossierPdf(DRAFT_SNAPSHOT);
    const b = await renderDossierPdf(DRAFT_SNAPSHOT);
    expect(a).toEqual(b);
  });

  it("contains no absolute local path", async () => {
    const bytes = await renderDossierPdf(DRAFT_SNAPSHOT);
    const text = new TextDecoder("latin1").decode(bytes) + extractPdfText(bytes);
    expect(text).not.toMatch(/[A-Za-z]:\\/);
    expect(text).not.toContain("C:\\Users");
  });

  it("does not mutate the input snapshot", async () => {
    const before = JSON.parse(JSON.stringify(DRAFT_SNAPSHOT));
    await renderDossierPdf(DRAFT_SNAPSHOT);
    expect(DRAFT_SNAPSHOT).toEqual(before);
  });

  it("renders a blank packaging SKU as 'unknown', never zero or empty", async () => {
    const bytes = await renderDossierPdf(DRAFT_SNAPSHOT);
    expect(extractPdfText(bytes)).toContain("Packaging SKU: unknown");
  });
});

describe("renderDossierDocx", () => {
  it("produces valid DOCX (zip) bytes", async () => {
    const bytes = await renderDossierDocx(DRAFT_SNAPSHOT);
    expect(bytes).toBeInstanceOf(Uint8Array);
    // Zip local file header magic: 'PK\x03\x04'.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it("includes dossier traceability in the extracted document body", async () => {
    const bytes = await renderDossierDocx(DRAFT_SNAPSHOT);
    const documentXml = await extractDocumentXml(bytes);
    expect(documentXml).toContain("TEST-DOSS-001");
  });

  it("shows a draft warning for a non-approved source", async () => {
    const bytes = await renderDossierDocx(DRAFT_SNAPSHOT);
    const documentXml = await extractDocumentXml(bytes);
    expect(documentXml).toContain("NOT PRODUCTION APPROVED");
  });

  it("does not show a false draft warning for a production-approved source", async () => {
    const bytes = await renderDossierDocx(APPROVED_SNAPSHOT);
    const documentXml = await extractDocumentXml(bytes);
    expect(documentXml).not.toContain("NOT PRODUCTION APPROVED");
  });

  it("produces structurally identical document content for identical input", async () => {
    // docx's public API exposes no way to pin its zip/core-properties
    // timestamps, so raw bytes are not guaranteed equal — compare the
    // actual document body XML instead (the permitted fallback).
    const a = await renderDossierDocx(DRAFT_SNAPSHOT);
    const b = await renderDossierDocx(DRAFT_SNAPSHOT);
    const [xmlA, xmlB] = await Promise.all([extractDocumentXml(a), extractDocumentXml(b)]);
    expect(xmlA).toBe(xmlB);
  });

  it("contains no absolute local path", async () => {
    const bytes = await renderDossierDocx(DRAFT_SNAPSHOT);
    const documentXml = await extractDocumentXml(bytes);
    expect(documentXml).not.toMatch(/[A-Za-z]:\\/);
  });

  it("does not mutate the input snapshot", async () => {
    const before = JSON.parse(JSON.stringify(DRAFT_SNAPSHOT));
    await renderDossierDocx(DRAFT_SNAPSHOT);
    expect(DRAFT_SNAPSHOT).toEqual(before);
  });

  it("renders a blank packaging SKU as 'unknown', never zero or empty", async () => {
    const bytes = await renderDossierDocx(DRAFT_SNAPSHOT);
    const documentXml = await extractDocumentXml(bytes);
    // Label and value are separate runs (bold label, plain value) — strip
    // tags to get the visible text a reader actually sees, concatenated.
    const visibleText = documentXml.replace(/<[^>]+>/g, "");
    expect(visibleText).toContain("Packaging SKU: unknown");
  });
});

describe("renderDossierDocument — MIME mapping", () => {
  it("uses DOCUMENT_FORMAT_MIME_TYPES for pdf", async () => {
    const result = await renderDossierDocument(DRAFT_SNAPSHOT, "pdf");
    expect(result.mimeType).toBe(DOCUMENT_FORMAT_MIME_TYPES.pdf);
    expect(result.mimeType).toBe("application/pdf");
  });

  it("uses DOCUMENT_FORMAT_MIME_TYPES for docx", async () => {
    const result = await renderDossierDocument(DRAFT_SNAPSHOT, "docx");
    expect(result.mimeType).toBe(DOCUMENT_FORMAT_MIME_TYPES.docx);
  });
});

async function extractDocumentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("word/document.xml not found in generated DOCX");
  return entry.async("string");
}

/**
 * pdf-lib FlateDecode-compresses content/object streams, so drawn text
 * is not literally present in the raw file bytes — and within the
 * decompressed content stream, `drawText` emits each string as a hex
 * literal text-show operator (`<...> Tj`), not a plain `(...) Tj`
 * string. Inflates every `stream…endstream` block, then hex-decodes
 * every `<HEX> Tj` operator, and returns everything concatenated so a
 * plain substring check finds real drawn text.
 */
function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const latin1 = raw.toString("latin1");
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let inflatedContent = "";
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(latin1))) {
    try {
      inflatedContent += "\n" + inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    } catch {
      // Not a zlib/Flate stream (e.g. embedded font binary) — skip it.
    }
  }
  const hexTextRegex = /<([0-9A-Fa-f]+)>\s*Tj/g;
  let decodedText = "";
  let hexMatch: RegExpExecArray | null;
  while ((hexMatch = hexTextRegex.exec(inflatedContent))) {
    decodedText += Buffer.from(hexMatch[1], "hex").toString("latin1") + "\n";
  }
  return latin1 + "\n" + inflatedContent + "\n" + decodedText;
}
