import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  supplierDocumentAcquisitionSchema,
  supplierSdsProductEvidenceRecordSchema,
  type SupplierDocumentAcquisition,
  type SupplierSdsProductEvidenceRecord,
} from "@formulab/shared";
import { listRecords, openSupplierDocumentPdf } from "@/lib/masterdata";
import { Badge, Card } from "./ui";

export function SupplierAcquiredDocumentsScreen() {
  const { t } = useTranslation("session");
  const [documents, setDocuments] = useState<SupplierDocumentAcquisition[]>([]);
  const [evidence, setEvidence] = useState<SupplierSdsProductEvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [documentRows, evidenceRows] = await Promise.all([
        listRecords("supplier_document_acquisitions"),
        listRecords("supplier_sds_product_evidence"),
      ]);
      setDocuments(documentRows.map((row) => supplierDocumentAcquisitionSchema.parse(row)).sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt)));
      setEvidence(evidenceRows.map((row) => supplierSdsProductEvidenceRecordSchema.parse(row)));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openDocument = async (document: SupplierDocumentAcquisition) => {
    setOpening(document.code);
    setFeedback(null);
    try {
      await openSupplierDocumentPdf(document.sha256);
    } catch {
      setFeedback(t("dataExchange.connectors.acquiredDocuments.openError", { document: document.code }));
    } finally {
      setOpening(null);
    }
  };

  const evidenceByAcquisition = new Map(evidence.map((record) => [record.acquisitionCode, record]));
  return (
    <Card title={t("dataExchange.connectors.acquiredDocuments.title")} actions={
      <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-input border border-border px-2 py-1 text-[10px] text-muted disabled:opacity-50">
        {t("dataExchange.connectors.acquiredDocuments.refresh")}
      </button>
    }>
      <p className="mb-3 text-[11px] text-muted">{t("dataExchange.connectors.acquiredDocuments.intro")}</p>
      {loading && <p className="text-[11px] text-muted">{t("dataExchange.connectors.acquiredDocuments.loading")}</p>}
      {loadFailed && <p role="alert" className="text-[11px] text-error">{t("dataExchange.connectors.acquiredDocuments.loadError")}</p>}
      {feedback && <p role="alert" className="mb-2 text-[11px] text-error">{feedback}</p>}
      {!loading && !loadFailed && documents.length === 0 && <p className="text-[11px] text-muted">{t("dataExchange.connectors.acquiredDocuments.empty")}</p>}
      <div className="space-y-2">
        {documents.map((document) => {
          const linkedEvidence = evidenceByAcquisition.get(document.code);
          const previous = document.supersedesCode ? documents.find((candidate) => candidate.code === document.supersedesCode) : undefined;
          return (
            <article key={document.code} className="rounded-input border border-border-faint bg-surface-1 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text">{document.sourceProduct.tradeName ?? document.sourceProduct.supplierItemCode ?? document.sourceProduct.sourceProductId ?? document.code} · {document.documentType}{document.sourceProduct.grade ? ` · ${document.sourceProduct.grade}` : ""}</p>
                  <p className="mt-0.5 text-[10px] text-muted">{document.supplierId} · {document.providerId} · {document.surfaceId} · {document.market} / {document.language}</p>
                </div>
                <Badge>{t(`dataExchange.connectors.acquiredDocuments.parserStatus.${document.parserStatus}`)}</Badge>
              </div>
              <dl className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2 xl:grid-cols-3">
                <Metadata label={t("dataExchange.connectors.acquiredDocuments.filename")} value={document.originalFilename} />
                <Metadata label={t("dataExchange.connectors.acquiredDocuments.hash")} value={document.sha256} mono />
                <Metadata label={t("dataExchange.connectors.acquiredDocuments.size")} value={`${document.byteSize.toLocaleString()} bytes`} />
                <Metadata label={t("dataExchange.connectors.acquiredDocuments.revision")} value={document.sourceRevision ?? t("dataExchange.connectors.acquiredDocuments.notProvided")} />
                <Metadata label={t("dataExchange.connectors.acquiredDocuments.revisionDate")} value={document.revisionDate ?? document.publicationDate ?? t("dataExchange.connectors.acquiredDocuments.notProvided")} />
                <Metadata label={t("dataExchange.connectors.acquiredDocuments.extraction")} value={linkedEvidence ? t("dataExchange.connectors.acquiredDocuments.extractionEvidence", { status: linkedEvidence.extractionStatus }) : t(`dataExchange.connectors.acquiredDocuments.parserStatus.${document.parserStatus}`)} />
                <Metadata label={t("dataExchange.connectors.acquiredDocuments.lineage")} value={document.supersedesCode ? (previous ? `${document.supersedesCode} · ${previous.sourceRevision ?? previous.revisionDate ?? previous.sha256.slice(0, 12)}` : document.supersedesCode) : t("dataExchange.connectors.acquiredDocuments.rootRevision")} />
                {document.sourceUrl && <div className="min-w-0 rounded border border-border-faint px-2 py-1"><dt className="text-muted">{t("dataExchange.connectors.acquiredDocuments.sourceUrl")}</dt><dd className="truncate"><a className="text-accent underline" href={document.sourceUrl} target="_blank" rel="noreferrer">{document.sourceUrl}</a></dd></div>}
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void openDocument(document)} disabled={opening !== null} className="rounded-input border border-border px-2.5 py-1 text-[10px] text-text disabled:opacity-50">
                  {opening === document.code ? t("dataExchange.connectors.acquiredDocuments.opening") : t("dataExchange.connectors.acquiredDocuments.openPdf")}
                </button>
                <span className="text-[10px] text-muted">{document.acquisitionMethod === "manual_assisted" ? document.sourceFileSelection?.originalFilename : t("dataExchange.connectors.acquiredDocuments.supplierSource")}</span>
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}

function Metadata({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0 rounded border border-border-faint px-2 py-1"><dt className="text-muted">{label}</dt><dd className={`break-words font-medium text-text${mono ? " font-mono" : ""}`}>{value}</dd></div>;
}
