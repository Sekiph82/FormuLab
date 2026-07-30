/** Phase 8 — the document-export barrel. `renderDossierDocument` is the
 *  single entry point a future desktop UI action (Session 4) calls; its
 *  `mimeType` always comes from `@ai4s/shared`'s `DOCUMENT_FORMAT_MIME_TYPES`,
 *  never a locally re-declared value. */
import { DOCUMENT_FORMAT_MIME_TYPES, type DocumentFormat, type DossierExportSnapshot } from "@ai4s/shared";
import { renderDossierPdf } from "./dossierPdf";
import { renderDossierDocx } from "./dossierDocx";
import type { RenderOptions } from "./content";

export { renderDossierPdf } from "./dossierPdf";
export { renderDossierDocx } from "./dossierDocx";
export { computeSnapshotWatermark, type DocumentWatermark } from "./watermark";
export { buildDossierDocumentContent, type DocumentContentBlock, type RenderOptions } from "./content";

export interface RenderedDocument {
  bytes: Uint8Array;
  mimeType: string;
}

export async function renderDossierDocument(
  snapshot: DossierExportSnapshot,
  format: DocumentFormat,
  options: RenderOptions = {},
): Promise<RenderedDocument> {
  const bytes = format === "pdf" ? await renderDossierPdf(snapshot, options) : await renderDossierDocx(snapshot, options);
  return { bytes, mimeType: DOCUMENT_FORMAT_MIME_TYPES[format] };
}
