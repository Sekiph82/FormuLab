import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  classifyCommercialProductType,
  supplierDocumentAcquisitionSchema,
  supplierSdsProductEvidenceRecordSchema,
  type SupplierDocumentAcquisition,
  type SupplierSdsProductEvidenceRecord,
} from "@formulab/shared";
import { listRecords, readSupplierDocumentPdf } from "@/lib/masterdata";
import { SupplierSdsPdfPagePreview } from "./SupplierSdsPdfPagePreview";
import { Badge, Card } from "./ui";

type Citation = { pageNumber: number; lineNumber: number; excerpt: string };

export function SupplierCommercialProductResolverScreen() {
  const { t } = useTranslation("session");
  const [documents, setDocuments] = useState<SupplierDocumentAcquisition[]>([]);
  const [evidenceRecords, setEvidenceRecords] = useState<SupplierSdsProductEvidenceRecord[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ sha256: string; bytes: Uint8Array } | null>(null);
  const pdfReadToken = useRef(0);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [pdfError, setPdfError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    pdfReadToken.current += 1;
    setPdfPreview(null);
    setCitation(null);
    setPdfError(false);
    try {
      const [documentRows, evidenceRows] = await Promise.all([
        listRecords("supplier_document_acquisitions"),
        listRecords("supplier_sds_product_evidence"),
      ]);
      const sdsDocuments = documentRows.map((row) => supplierDocumentAcquisitionSchema.parse(row))
        .filter((document) => document.documentType === "SDS")
        .sort((left, right) => right.acquiredAt.localeCompare(left.acquiredAt));
      setDocuments(sdsDocuments);
      setEvidenceRecords(evidenceRows.map((row) => supplierSdsProductEvidenceRecordSchema.parse(row)));
      setSelectedCode((current) => sdsDocuments.some((document) => document.code === current) ? current : sdsDocuments[0]?.code ?? "");
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const document = documents.find((item) => item.code === selectedCode);
  const linkedEvidenceRecord = useMemo(
    () => evidenceRecords.find((item) => item.acquisitionCode === selectedCode),
    [evidenceRecords, selectedCode],
  );
  const evidenceMatchesDocument = Boolean(document && linkedEvidenceRecord
    && linkedEvidenceRecord.evidence.section1.sourceDocumentHash.toLowerCase() === document.sha256.toLowerCase()
    && linkedEvidenceRecord.evidence.section3.sourceDocumentHash.toLowerCase() === document.sha256.toLowerCase());
  const evidenceRecord = evidenceMatchesDocument ? linkedEvidenceRecord : undefined;
  const classification = useMemo(() => evidenceRecord ? classifyEvidenceProductType(evidenceRecord) : undefined, [evidenceRecord]);

  const openCitation = async (reference: string, excerpt: string) => {
    const match = /(?:^|:)p(\d+)(?::l(\d+))?\b/u.exec(reference);
    if (!match || !document) return;
    setPdfError(false);
    setCitation({ pageNumber: Number(match[1]), lineNumber: Number(match[2] ?? 1), excerpt });
    if (pdfPreview?.sha256.toLowerCase() === document.sha256.toLowerCase()) return;
    const requestToken = ++pdfReadToken.current;
    try {
      const bytes = await readSupplierDocumentPdf(document.sha256);
      if (requestToken !== pdfReadToken.current) return;
      setPdfPreview({ sha256: document.sha256, bytes });
    } catch {
      if (requestToken === pdfReadToken.current) setPdfError(true);
    }
  };

  return (
    <Card title={t("dataExchange.connectors.productResolver.title")} actions={
      <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-input border border-border px-2 py-1 text-[10px] text-muted disabled:opacity-50">
        {t("dataExchange.connectors.productResolver.refresh")}
      </button>
    }>
      <p className="mb-3 text-[11px] text-muted">{t("dataExchange.connectors.productResolver.intro")}</p>
      {loading && <p className="text-[11px] text-muted">{t("dataExchange.connectors.productResolver.loading")}</p>}
      {loadFailed && <p role="alert" className="text-[11px] text-error">{t("dataExchange.connectors.productResolver.loadError")}</p>}
      {!loading && !loadFailed && documents.length === 0 && <p className="text-[11px] text-muted">{t("dataExchange.connectors.productResolver.empty")}</p>}
      {!loadFailed && documents.length > 0 && (
        <label className="mb-3 block text-[10px] text-muted">
          <span className="mb-1 block">{t("dataExchange.connectors.productResolver.select")}</span>
          <select value={selectedCode} onChange={(event) => { pdfReadToken.current += 1; setSelectedCode(event.target.value); setPdfPreview(null); setCitation(null); setPdfError(false); }} className="w-full rounded-input border border-border bg-surface-1 px-2 py-1.5 text-text">
            {documents.map((item) => <option key={item.code} value={item.code}>{item.sourceProduct.tradeName ?? item.sourceProduct.supplierItemCode ?? item.code} · {item.sourceProduct.grade ?? item.sourceRevision ?? item.code}</option>)}
          </select>
        </label>
      )}
      {document && (
        <div className="space-y-3">
          <section className="rounded-input border border-border-faint p-3">
            <h4 className="mb-2 text-xs font-semibold text-text">{t("dataExchange.connectors.productResolver.sourceProduct")}</h4>
            <dl className="grid gap-2 text-[10px] sm:grid-cols-2">
              <Fact label={t("dataExchange.connectors.productResolver.tradeName")} value={document.sourceProduct.tradeName ?? t("dataExchange.connectors.productResolver.notReported")} />
              <Fact label={t("dataExchange.connectors.productResolver.productCode")} value={document.sourceProduct.supplierItemCode ?? document.sourceProduct.sourceProductId ?? t("dataExchange.connectors.productResolver.notReported")} />
              <Fact label={t("dataExchange.connectors.productResolver.grade")} value={document.sourceProduct.grade ?? t("dataExchange.connectors.productResolver.notReported")} />
              <Fact label={t("dataExchange.connectors.productResolver.supplierMarket")} value={`${document.supplierId} · ${document.market} / ${document.language}`} />
              <Fact label={t("dataExchange.connectors.productResolver.document")} value={`${document.code} · SHA-256 ${document.sha256}`} />
              <Fact label={t("dataExchange.connectors.productResolver.commercialProductId")} value={evidenceRecord?.evidence.commercialProductId ?? t("dataExchange.connectors.productResolver.noProductRecord")} />
            </dl>
          </section>

          {linkedEvidenceRecord && !evidenceMatchesDocument && <p role="alert" className="rounded-input border border-error p-3 text-[10px] text-error">{t("dataExchange.connectors.productResolver.evidenceHashMismatch")}</p>}
          {!linkedEvidenceRecord && <p className="rounded-input border border-border-faint p-3 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.noEvidence")}</p>}
          {evidenceRecord && classification && (
            <>
              <section className="rounded-input border border-border-faint p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-xs font-semibold text-text">{t("dataExchange.connectors.productResolver.productType")}</h4>
                  <Badge>{classification.productType}</Badge>
                  <Badge>{t("dataExchange.connectors.productResolver.reviewRequired")}</Badge>
                </div>
                <p className="mt-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.typeReasons", { reasons: classification.reasonCodes.map(humanizeCode).join(", ") })}</p>
                <EvidenceLinks references={classification.evidenceRefs} excerpt={t("dataExchange.connectors.productResolver.typeEvidenceExcerpt")} onOpen={openCitation} />
              </section>

              <section className="rounded-input border border-border-faint p-3">
                <h4 className="mb-1 text-xs font-semibold text-text">{t("dataExchange.connectors.productResolver.components")}</h4>
                <p className="mb-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.section3Limit")}</p>
                {evidenceRecord.evidence.section3.components.length === 0
                  ? <p className="text-[10px] text-muted">{t("dataExchange.connectors.productResolver.noComponents")}</p>
                  : <div className="space-y-2">{evidenceRecord.evidence.section3.components.map((component) => {
                    const facts = [component.componentName, component.casNumber, component.ecNumber, component.materialNumber, component.concentration].filter((fact) => fact !== undefined);
                    return <article key={component.id} className="rounded border border-border-faint bg-surface-1 p-2">
                      <div className="flex flex-wrap items-start justify-between gap-1"><p className="text-[10px] font-medium text-text">{component.componentName?.rawValue ?? t("dataExchange.connectors.productResolver.nameNotDisclosed")}</p><Badge>{t(`dataExchange.connectors.productResolver.disclosure.${component.disclosure}`)}</Badge></div>
                      <dl className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2 xl:grid-cols-3">
                        <Fact label={t("dataExchange.connectors.productResolver.cas")} value={component.casNumber?.rawValue ?? t("dataExchange.connectors.productResolver.notReported")} />
                        <Fact label={t("dataExchange.connectors.productResolver.ec")} value={component.ecNumber?.rawValue ?? t("dataExchange.connectors.productResolver.notReported")} />
                        <Fact label={t("dataExchange.connectors.productResolver.materialNumber")} value={component.materialNumber?.rawValue ?? t("dataExchange.connectors.productResolver.notReported")} />
                        <Fact label={t("dataExchange.connectors.productResolver.concentration")} value={component.concentration?.rawValue ?? t("dataExchange.connectors.productResolver.notReported")} />
                      </dl>
                      <EvidenceLinks references={facts.flatMap((fact) => fact.evidenceRefs)} excerpt={component.componentName?.rawValue ?? component.casNumber?.rawValue ?? t("dataExchange.connectors.productResolver.componentEvidenceExcerpt")} onOpen={openCitation} />
                      <div className="mt-2 rounded border border-border-faint px-2 py-1.5">
                        <p className="text-[10px] font-medium text-text">{t("dataExchange.connectors.productResolver.canonicalCandidate")}</p>
                        <p className="mt-0.5 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.canonicalCatalogUnavailable")}</p>
                      </div>
                    </article>;
                  })}</div>}
                <div className="mt-2 rounded border border-border-faint px-2 py-1.5">
                  <p className="text-[10px] font-medium text-text">{t("dataExchange.connectors.productResolver.unresolvedRemainder")}</p>
                  {evidenceRecord.evidence.section3.undisclosedRemainder
                    ? <><p className="mt-0.5 text-[10px] text-muted">{evidenceRecord.evidence.section3.undisclosedRemainder.rawValue}</p><EvidenceLinks references={evidenceRecord.evidence.section3.undisclosedRemainder.evidenceRefs} excerpt={evidenceRecord.evidence.section3.undisclosedRemainder.rawValue} onOpen={openCitation} /></>
                    : <p className="mt-0.5 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.remainderNotReported")}</p>}
                </div>
              </section>
            </>
          )}
          {citation && pdfPreview?.sha256.toLowerCase() === document.sha256.toLowerCase() && <SupplierSdsPdfPagePreview bytes={pdfPreview.bytes} pageNumber={citation.pageNumber} lineNumber={citation.lineNumber} />}
          {pdfError && <p role="alert" className="text-[10px] text-error">{t("dataExchange.connectors.productResolver.pdfError")}</p>}
          <p className="rounded-input border border-border-faint p-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.readOnly")}</p>
        </div>
      )}
    </Card>
  );
}

function classifyEvidenceProductType(record: SupplierSdsProductEvidenceRecord) {
  const section3 = record.evidence.section3;
  const observations: Parameters<typeof classifyCommercialProductType>[0]["observations"] = [];
  if (section3.substanceOrMixture) observations.push({ kind: "substance_or_mixture", value: section3.substanceOrMixture.rawValue, evidenceRefs: section3.substanceOrMixture.evidenceRefs });
  const componentReferences = section3.components.flatMap((component) => [component.componentName, component.casNumber, component.ecNumber, component.materialNumber, component.concentration].flatMap((fact) => fact?.evidenceRefs ?? []));
  if (section3.components.length > 0 && componentReferences.length > 0) observations.push({ kind: "component_count", value: section3.components.length, evidenceRefs: [...new Set(componentReferences)] });
  for (const component of section3.components.filter((item) => item.disclosure === "trade_secret")) {
    const refs = [component.componentName, component.casNumber, component.ecNumber, component.materialNumber].flatMap((fact) => fact?.evidenceRefs ?? []);
    if (refs.length) observations.push({ kind: "trade_secret", value: true, evidenceRefs: [...new Set(refs)] });
  }
  if (section3.undisclosedRemainder) observations.push({ kind: "undisclosed_remainder", value: true, evidenceRefs: section3.undisclosedRemainder.evidenceRefs });
  return classifyCommercialProductType({ observations });
}

function EvidenceLinks({ references, excerpt, onOpen }: { references: string[]; excerpt: string; onOpen: (reference: string, excerpt: string) => void }) {
  const { t } = useTranslation("session");
  const cited = [...new Set(references)];
  return <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">{cited.map((reference) => {
    const match = /(?:^|:)p(\d+)(?::l(\d+))?\b/u.exec(reference);
    return match
      ? <button key={reference} type="button" onClick={() => onOpen(reference, excerpt)} className="text-[10px] text-accent underline">{t("dataExchange.connectors.productResolver.pageLink", { page: match[1], line: match[2] ?? "—" })}</button>
      : <span key={reference} className="break-all text-[10px] text-muted">{reference}</span>;
  })}</div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded border border-border-faint px-2 py-1"><dt className="text-muted">{label}</dt><dd className="break-words font-medium text-text">{value}</dd></div>;
}

function humanizeCode(value: string): string {
  return value.replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase("en-US"));
}
