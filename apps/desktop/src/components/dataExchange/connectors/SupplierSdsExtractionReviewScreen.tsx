import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  supplierDocumentAcquisitionSchema,
  supplierSdsProductEvidenceRecordSchema,
  normalizeCasIdentifier,
  normalizeEcIdentifier,
  type SupplierDocumentAcquisition,
  type SupplierSdsProductEvidenceRecord,
} from "@formulab/shared";
import { listRecords, readSupplierDocumentPdf } from "@/lib/masterdata";
import { extractSupplierSdsReview } from "@/lib/supplierSdsReview";
import { SupplierSdsPdfPagePreview } from "./SupplierSdsPdfPagePreview";
import { Badge, Card } from "./ui";

type ReviewResult = Awaited<ReturnType<typeof extractSupplierSdsReview>>;
type Citation = { pageNumber: number; lineNumber: number; excerpt: string; source: string; confidence?: number };
type Candidate = {
  field: string;
  rawValue: string;
  evidence: Citation[];
  extractionMethod?: string;
  reviewRequired?: boolean;
  measurementContext?: {
    normalizedValue?: { text: string; status: string; value?: number; lowerBound?: number; upperBound?: number; unit?: string; qualifier?: string };
    temperature?: { value: number; unit: string; originalText: string };
    sampleConcentration?: { value: number; basis: string; originalText: string };
    deliveredFormBasis?: string;
    deliveredFormBasisText?: string;
    methodOrStandard?: string[];
    claimKind?: string;
    evidenceKind?: string;
  };
};

export function SupplierSdsExtractionReviewScreen() {
  const { t } = useTranslation("session");
  const [documents, setDocuments] = useState<SupplierDocumentAcquisition[]>([]);
  const [evidence, setEvidence] = useState<SupplierSdsProductEvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedCode, setSelectedCode] = useState("");
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [documentRows, evidenceRows] = await Promise.all([
        listRecords("supplier_document_acquisitions"),
        listRecords("supplier_sds_product_evidence"),
      ]);
      const sdsDocuments = documentRows.map((row) => supplierDocumentAcquisitionSchema.parse(row))
        .filter((row) => row.documentType === "SDS")
        .sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
      const sdsEvidence = evidenceRows.map((row) => supplierSdsProductEvidenceRecordSchema.parse(row));
      setDocuments(sdsDocuments);
      setEvidence(sdsEvidence);
      setSelectedCode((current) => sdsDocuments.some((row) => row.code === current) ? current : sdsDocuments[0]?.code ?? "");
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = documents.find((document) => document.code === selectedCode);
  const savedEvidence = useMemo(() => evidence.find((record) => record.acquisitionCode === selectedCode), [evidence, selectedCode]);

  const runReview = async () => {
    if (!selected) return;
    setRunning(true);
    setError(null);
    setSelectedCitation(null);
    setPdfBytes(null);
    setReview(null);
    try {
      const bytes = await readSupplierDocumentPdf(selected.sha256);
      const result = await extractSupplierSdsReview(selected, bytes);
      setPdfBytes(bytes);
      setReview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("dataExchange.connectors.sdsReview.extractionError"));
    } finally {
      setRunning(false);
    }
  };

  const openPage = async (citation: Citation) => {
    setSelectedCitation(citation);
  };

  const data = review?.status === "extracted" ? review : null;
  const section2Candidates = data?.section2.candidates as Candidate[] | undefined;
  const section7Candidates = data?.section7.candidates as Candidate[] | undefined;
  const section8Candidates = data?.section8.candidates as Candidate[] | undefined;
  const section9Candidates = data?.section9.candidates as Candidate[] | undefined;
  const sections10To15Candidates = data?.sections10To15.candidates as (Candidate & { sectionNumber: number })[] | undefined;

  return (
    <Card title={t("dataExchange.connectors.sdsReview.title")} actions={
      <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-input border border-border px-2 py-1 text-[10px] text-muted disabled:opacity-50">
        {t("dataExchange.connectors.sdsReview.refresh")}
      </button>
    }>
      <p className="mb-3 text-[11px] text-muted">{t("dataExchange.connectors.sdsReview.intro")}</p>
      {loading && <p className="text-[11px] text-muted">{t("dataExchange.connectors.sdsReview.loading")}</p>}
      {loadFailed && <p role="alert" className="text-[11px] text-error">{t("dataExchange.connectors.sdsReview.loadError")}</p>}
      {!loading && !loadFailed && documents.length === 0 && <p className="text-[11px] text-muted">{t("dataExchange.connectors.sdsReview.empty")}</p>}
      {!loadFailed && documents.length > 0 && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 text-[10px] text-muted">
            <span className="mb-1 block">{t("dataExchange.connectors.sdsReview.select")}</span>
            <select value={selectedCode} onChange={(event) => { setSelectedCode(event.target.value); setReview(null); setPdfBytes(null); setSelectedCitation(null); setError(null); }} className="w-full rounded-input border border-border bg-surface-1 px-2 py-1.5 text-text">
              {documents.map((document) => <option key={document.code} value={document.code}>{document.sourceProduct.tradeName ?? document.sourceProduct.supplierItemCode ?? document.code} · {document.sourceRevision ?? document.revisionDate ?? document.sha256.slice(0, 10)} · {document.market}/{document.language}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void runReview()} disabled={!selected || running} className="rounded-input border border-accent px-3 py-1.5 text-[10px] font-medium text-accent disabled:opacity-50">
            {running ? t("dataExchange.connectors.sdsReview.running") : t("dataExchange.connectors.sdsReview.run")}
          </button>
        </div>
      )}
      {selected && <p className="mb-3 break-all text-[10px] text-muted">{selected.supplierId} · {selected.providerId} · SHA-256 {selected.sha256}</p>}
      {error && <p role="alert" className="mb-3 text-[11px] text-error">{error}</p>}
      {review?.status === "quarantined" && <p role="alert" className="mb-3 text-[11px] text-error">{t("dataExchange.connectors.sdsReview.quarantined", { reason: review.reason })}</p>}
      {data && (
        <div className="space-y-3">
          {selectedCitation && pdfBytes && <SupplierSdsPdfPagePreview bytes={pdfBytes} pageNumber={selectedCitation.pageNumber} lineNumber={selectedCitation.lineNumber} />}
          <div className="rounded-input border border-border-faint bg-surface-1 p-2 text-[10px] text-muted">
            {t("dataExchange.connectors.sdsReview.reviewOnly")} · {t("dataExchange.connectors.sdsReview.coverage", { detected: data.sections.sections.length, missing: data.sections.unobservedSectionNumbers.length })}
            <div className="mt-1 flex flex-wrap gap-1">{data.sections.warnings.map((warning) => <Badge key={warning}>{humanize(warning)}</Badge>)}{data.ocr.warnings.map((warning) => <Badge key={warning}>{humanize(warning)}</Badge>)}</div>
          </div>
          {savedEvidence && <StoredSdsEvidence record={savedEvidence} onOpenCitation={openPage} />}
          {!savedEvidence && <p className="text-[10px] text-muted">{t("dataExchange.connectors.sdsReview.noStoredFacts")}</p>}
          <CandidateSection number={2} candidates={section2Candidates ?? []} onOpenCitation={openPage} />
          <CandidateSection number={7} candidates={section7Candidates ?? []} onOpenCitation={openPage} />
          <CandidateSection number={8} candidates={section8Candidates ?? []} onOpenCitation={openPage} />
          <CandidateSection number={9} candidates={section9Candidates ?? []} onOpenCitation={openPage} />
          {[10, 11, 12, 13, 14, 15].map((number) => <CandidateSection key={number} number={number} candidates={(sections10To15Candidates ?? []).filter((candidate) => candidate.sectionNumber === number)} onOpenCitation={openPage} />)}
        </div>
      )}
    </Card>
  );
}

function StoredSdsEvidence({ record, onOpenCitation }: { record: SupplierSdsProductEvidenceRecord; onOpenCitation: (citation: Citation) => Promise<void> }) {
  const { t } = useTranslation("session");
  const productFacts = Object.entries(record.evidence.section1).filter(([key, value]) => key !== "sectionNumber" && key !== "sourceDocumentHash" && value && typeof value === "object") as Array<[string, { id: string; rawValue: string; evidenceRefs: string[] }]>;
  const componentFacts = record.evidence.section3.components.flatMap((component) => [
    ["component_name", component.componentName], ["cas_number", component.casNumber], ["ec_number", component.ecNumber], ["material_number", component.materialNumber], ["concentration", component.concentration],
  ].filter((entry): entry is [string, { id: string; rawValue: string; evidenceRefs: string[] }] => Boolean(entry[1])).map(([field, fact]) => ({ field, fact, disclosure: component.disclosure })));
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-input border border-border-faint p-3">
        <h4 className="mb-2 text-xs font-semibold text-text">{t("dataExchange.connectors.sdsReview.section", { number: 1 })} · {t("dataExchange.connectors.sdsReview.savedFacts")}</h4>
        <div className="space-y-2">{productFacts.map(([field, fact]) => <StoredFact key={fact.id} field={field} fact={fact} onOpenCitation={onOpenCitation} />)}</div>
      </section>
      <section className="rounded-input border border-border-faint p-3">
        <h4 className="mb-2 text-xs font-semibold text-text">{t("dataExchange.connectors.sdsReview.section", { number: 3 })} · {t("dataExchange.connectors.sdsReview.disclosedComponents")}</h4>
        <p className="mb-2 text-[10px] text-muted">{t("dataExchange.connectors.sdsReview.section3Limit")}</p>
        <div className="space-y-2">{componentFacts.map(({ field, fact, disclosure }) => <StoredFact key={fact.id} field={field} fact={fact} disclosure={disclosure} onOpenCitation={onOpenCitation} />)}</div>
      </section>
    </div>
  );
}

function StoredFact({ field, fact, disclosure, onOpenCitation }: { field: string; fact: { id: string; rawValue: string; evidenceRefs: string[] }; disclosure?: string; onOpenCitation: (citation: Citation) => Promise<void> }) {
  const { t } = useTranslation("session");
  const identifier = field === "casNumber" || field === "cas_number"
    ? normalizeCasIdentifier(fact.rawValue)
    : field === "ecNumber" || field === "ec_number" ? normalizeEcIdentifier(fact.rawValue) : undefined;
  const normalized = identifier ? (identifier.ok ? identifier.normalizedValue : "") : fact.rawValue.trim().replace(/\s+/gu, " ");
  return <div className="rounded border border-border-faint px-2 py-1.5 text-[10px]">
    <p className="font-medium text-text">{humanize(field)}{disclosure ? ` · ${humanize(disclosure)}` : ""}</p>
    <p className="mt-0.5 text-muted">{t("dataExchange.connectors.sdsReview.original")}: <span className="text-text">{fact.rawValue}</span></p>
    <p className="text-muted">{t("dataExchange.connectors.sdsReview.normalized")}: <span className="text-text">{normalized || t("dataExchange.connectors.sdsReview.notAvailable")}</span></p>
    <p className="text-muted">{t("dataExchange.connectors.sdsReview.context")}: {t("dataExchange.connectors.sdsReview.storedFactContext")}</p>
    <p className="text-muted">{t("dataExchange.connectors.sdsReview.confidenceUnavailable")}</p>
    {fact.evidenceRefs.map((reference) => {
      const page = /(?:^|:)p(\d+)(?::l(\d+))?\b/u.exec(reference);
      return page ? <button key={reference} type="button" onClick={() => void onOpenCitation({ pageNumber: Number(page[1]), lineNumber: Number(page[2] ?? 1), excerpt: fact.rawValue, source: "saved" })} className="mt-1 mr-1 text-accent underline">{t("dataExchange.connectors.sdsReview.pageLink", { page: page[1], line: page[2] ?? "—" })}</button>
        : <span key={reference} className="mt-1 mr-1 inline-block break-all text-muted">{reference}</span>;
    })}
  </div>;
}

function CandidateSection({ number, candidates, onOpenCitation }: { number: number; candidates: Candidate[]; onOpenCitation: (citation: Citation) => Promise<void> }) {
  const { t } = useTranslation("session");
  return <section className="rounded-input border border-border-faint p-3">
    <h4 className="mb-2 text-xs font-semibold text-text">{t("dataExchange.connectors.sdsReview.section", { number })}</h4>
    {candidates.length === 0 && <p className="text-[10px] text-muted">{t("dataExchange.connectors.sdsReview.noCandidates")}</p>}
    <div className="space-y-2">{candidates.map((candidate, index) => {
      const context = candidate.measurementContext;
      const normalized = context?.normalizedValue;
      const normalizedLabel = normalized
        ? [normalized.text, normalized.value !== undefined ? String(normalized.value) : undefined, normalized.lowerBound !== undefined ? `${normalized.lowerBound}–${normalized.upperBound}` : undefined, normalized.unit, normalized.qualifier].filter(Boolean).join(" · ")
        : candidate.rawValue.trim().replace(/\s+/gu, " ");
      const contextLabel = context ? [context.deliveredFormBasis, context.deliveredFormBasisText, context.claimKind, context.evidenceKind, context.temperature?.originalText, context.sampleConcentration?.originalText, context.methodOrStandard?.join(", ")].filter(Boolean).join(" · ") : candidate.extractionMethod;
      return <article key={`${candidate.field}-${index}`} className="rounded border border-border-faint bg-surface-1 px-2 py-1.5 text-[10px]">
        <div className="flex flex-wrap justify-between gap-1"><span className="font-medium text-text">{humanize(candidate.field)}</span><Badge>{t("dataExchange.connectors.sdsReview.reviewRequired")}</Badge></div>
        <p className="mt-1 text-muted">{t("dataExchange.connectors.sdsReview.original")}: <span className="text-text">{candidate.rawValue}</span></p>
        <p className="text-muted">{t("dataExchange.connectors.sdsReview.normalized")}: <span className="text-text">{normalizedLabel || t("dataExchange.connectors.sdsReview.notAvailable")}</span></p>
        {contextLabel && <p className="text-muted">{t("dataExchange.connectors.sdsReview.context")}: {contextLabel}</p>}
        {candidate.evidence.map((citation, citationIndex) => <div key={`${citation.pageNumber}-${citation.lineNumber}-${citationIndex}`} className="mt-1 border-l-2 border-border pl-2">
          <p className="text-muted">{citation.excerpt}</p>
          <button type="button" onClick={() => void onOpenCitation(citation)} className="text-accent underline">{t("dataExchange.connectors.sdsReview.pageLink", { page: citation.pageNumber, line: citation.lineNumber })}</button>
          <span className="ml-2 text-muted">{humanize(citation.source)} · {citation.confidence === undefined ? t("dataExchange.connectors.sdsReview.confidenceUnavailable") : t("dataExchange.connectors.sdsReview.confidence", { value: Math.round(citation.confidence * 100) })}</span>
        </div>)}
      </article>;
    })}</div>
  </section>;
}

function humanize(value: string): string {
  return value.replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase("en-US"));
}
