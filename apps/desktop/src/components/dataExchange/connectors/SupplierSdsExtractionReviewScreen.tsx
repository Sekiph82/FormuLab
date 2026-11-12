import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  supplierDocumentAcquisitionSchema,
  supplierProductEvidenceRecordSchema,
  supplierSdsProductEvidenceRecordSchema,
  normalizeCasIdentifier,
  normalizeEcIdentifier,
  type SupplierDocumentAcquisition,
  type SupplierSdsProductEvidenceRecord,
  type SupplierProductCardVersion,
  type SupplierProductDocumentEvidence,
  type SupplierProductClaimEvidence,
  type SupplierProductClaimReview,
  type SupplierProductEvidenceRecord,
} from "@formulab/shared";
import { appendSupplierProductClaimReview, appendSupplierProductEvidenceUpdate, listRecords, readSupplierDocumentPdf } from "@/lib/masterdata";
import { extractSupplierSdsReview } from "@/lib/supplierSdsReview";
import { extractSupplierProductDocumentEvidence } from "@/lib/supplierProductExtraction";
import { createSupplierProductCardVersion, deriveSupplierProductCardId } from "@/lib/supplierProductCards";
import { SupplierSdsPdfPagePreview } from "./SupplierSdsPdfPagePreview";
import { Badge, Card } from "./ui";

type ReviewResult = Awaited<ReturnType<typeof extractSupplierSdsReview>>;
type Citation = { documentHash?: string; pageNumber: number; lineNumber: number; excerpt: string; source: string; confidence?: number };
type ProductCardView = { latest: SupplierProductCardVersion; versions: SupplierProductCardVersion[]; documents: SupplierProductDocumentEvidence[] };
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
  const [productEvidence, setProductEvidence] = useState<SupplierProductEvidenceRecord[]>([]);
  const [candidateEvidence, setCandidateEvidence] = useState<SupplierProductDocumentEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedCode, setSelectedCode] = useState("");
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingReviewId, setSavingReviewId] = useState<string | null>(null);
  const [savedCardVersion, setSavedCardVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [documentRows, evidenceRows, productEvidenceRows] = await Promise.all([
        listRecords("supplier_document_acquisitions"),
        listRecords("supplier_sds_product_evidence"),
        listRecords("supplier_product_evidence"),
      ]);
      const sdsDocuments = documentRows.map((row) => supplierDocumentAcquisitionSchema.parse(row))
        .filter((row) => row.documentType === "SDS" || row.documentType === "TDS")
        .sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
      const sdsEvidence = evidenceRows.map((row) => supplierSdsProductEvidenceRecordSchema.parse(row));
      const productRecords = productEvidenceRows.map((row) => supplierProductEvidenceRecordSchema.parse(row));
      setDocuments(sdsDocuments);
      setEvidence(sdsEvidence);
      setProductEvidence(productRecords);
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
  const productCards = useMemo<ProductCardView[]>(() => {
    const documentsById = new Map(productEvidence.filter((record): record is SupplierProductDocumentEvidence => record.recordType === "document").map((record) => [record.id, record]));
    const versionsByCard = new Map<string, SupplierProductCardVersion[]>();
    for (const record of productEvidence) if (record.recordType === "card_version") versionsByCard.set(record.productCardId, [...(versionsByCard.get(record.productCardId) ?? []), record]);
    return [...versionsByCard.values()].map((versions) => {
      versions.sort((left, right) => left.version - right.version);
      const latest = versions[versions.length - 1]!;
      return { latest, versions, documents: latest.evidenceRecordIds.map((id) => documentsById.get(id)).filter((record): record is SupplierProductDocumentEvidence => Boolean(record)) };
    }).sort((left, right) => (left.latest.tradeName ?? left.latest.supplierItemCode ?? "").localeCompare(right.latest.tradeName ?? right.latest.supplierItemCode ?? ""));
  }, [productEvidence]);

  const runReview = async () => {
    if (!selected) return;
    setRunning(true);
    setError(null);
    setSelectedCitation(null);
    setPdfBytes(null);
    setReview(null);
    setCandidateEvidence(null);
    setSavedCardVersion(null);
    try {
      const bytes = await readSupplierDocumentPdf(selected.sha256);
      setPdfBytes(bytes);
      const productCardId = await deriveSupplierProductCardId(selected);
      if (selected.documentType === "SDS") {
        const result = await extractSupplierSdsReview(selected, bytes);
        setReview(result);
        if (result.status === "extracted") setCandidateEvidence(await extractSupplierProductDocumentEvidence(selected, bytes, productCardId, result));
      } else {
        setReview(null);
        setCandidateEvidence(await extractSupplierProductDocumentEvidence(selected, bytes, productCardId));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("dataExchange.connectors.sdsReview.extractionError"));
    } finally {
      setRunning(false);
    }
  };

  const saveProductCard = async () => {
    if (!selected || !candidateEvidence) return;
    setSaving(true);
    setError(null);
    try {
      const cardVersion = createSupplierProductCardVersion({ acquisition: selected, evidence: candidateEvidence, existingRecords: productEvidence });
      const saved = await appendSupplierProductEvidenceUpdate(candidateEvidence, cardVersion);
      setSavedCardVersion(saved.cardVersion.version);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the product evidence.");
    } finally {
      setSaving(false);
    }
  };

  const saveClaimDecision = async (productCardId: string, sourceEvidenceId: string, claim: SupplierProductClaimEvidence, decision: SupplierProductClaimReview["decision"]) => {
    const decisionNote = decision === "accepted" ? undefined : window.prompt(t(decision === "rejected" ? "dataExchange.connectors.sdsReview.claimRejectReason" : "dataExchange.connectors.sdsReview.claimNeedsReviewReason"))?.trim();
    if (decision !== "accepted" && !decisionNote) return;
    const prior = productEvidence.filter((record): record is SupplierProductClaimReview => record.recordType === "claim_review"
      && record.productCardId === productCardId && record.sourceEvidenceId === sourceEvidenceId && record.claimId === claim.id)
      .sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt)).slice(-1)[0];
    const reviewId = crypto.randomUUID();
    const review = {
      recordType: "claim_review" as const,
      schemaVersion: "1.0" as const,
      id: reviewId,
      productCardId,
      sourceEvidenceId,
      claimId: claim.id,
      claimSnapshot: claim,
      decision,
      ...(decisionNote ? { decisionNote } : {}),
      evidenceRefs: claim.evidence.map((citation) => `${citation.documentHash}:p${citation.pageNumber}${citation.lineNumber ? `:l${citation.lineNumber}` : ""}`),
      ...(prior ? { supersedesReviewId: prior.id } : {}),
    };
    setSavingReviewId(reviewId);
    setError(null);
    try {
      await appendSupplierProductClaimReview(review);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the product claim review.");
    } finally {
      setSavingReviewId(null);
    }
  };

  const openPage = async (citation: Citation) => {
    const documentHash = citation.documentHash ?? selected?.sha256;
    if (documentHash) {
      try {
        setPdfBytes(await readSupplierDocumentPdf(documentHash));
      } catch {
        setError(t("dataExchange.connectors.sdsReview.openError", { page: citation.pageNumber }));
        return;
      }
    }
    setSelectedCitation(citation);
  };

  const data = review?.status === "extracted" ? review : null;
  const section1Candidates = data?.section1.candidates as Candidate[] | undefined;
  const section3Candidates: Candidate[] = data ? [
    ...(data.section3.declaration ? [{ field: "substance_or_mixture", rawValue: data.section3.declaration.rawValue, evidence: data.section3.declaration.evidence }] : []),
    ...data.section3.components.flatMap((component) => {
    const row = component as unknown as Record<string, { rawValue?: string; evidence?: Citation[] } | undefined>;
    return [["component_name", row.originalName], ["cas_number", row.casNumber], ["ec_number", row.ecNumber], ["concentration", row.concentration]]
      .filter((entry): entry is [string, { rawValue?: string; evidence?: Citation[] }] => Boolean(entry[1]))
      .map(([field, fact]) => ({ field, rawValue: fact.rawValue ?? "", evidence: fact.evidence ?? [] }));
    }),
  ] : [];
  const section7Candidates = data?.section7.candidates as Candidate[] | undefined;
  const section9Candidates = data?.section9.candidates as Candidate[] | undefined;
  const section15Candidates = data?.sections10To15.candidates.filter((candidate) => candidate.sectionNumber === 15) as Candidate[] | undefined;

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
      {!loading && !loadFailed && <ProductCardLibrary cards={productCards} acquisitions={documents} records={productEvidence} savingReviewId={savingReviewId} onReviewClaim={saveClaimDecision} onOpenCitation={openPage} />}
      {!loadFailed && documents.length > 0 && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 text-[10px] text-muted">
            <span className="mb-1 block">{t("dataExchange.connectors.sdsReview.select")}</span>
            <select value={selectedCode} onChange={(event) => { setSelectedCode(event.target.value); setReview(null); setCandidateEvidence(null); setPdfBytes(null); setSelectedCitation(null); setSavedCardVersion(null); setError(null); }} className="w-full rounded-input border border-border bg-surface-1 px-2 py-1.5 text-text">
              {documents.map((document) => <option key={document.code} value={document.code}>{document.sourceProduct.tradeName ?? document.sourceProduct.supplierItemCode ?? document.code} · {document.sourceRevision ?? document.revisionDate ?? document.sha256.slice(0, 10)} · {document.market}/{document.language}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void runReview()} disabled={!selected || running} className="rounded-input border border-accent px-3 py-1.5 text-[10px] font-medium text-accent disabled:opacity-50">
            {running ? t("dataExchange.connectors.sdsReview.running") : t("dataExchange.connectors.sdsReview.run")}
          </button>
        </div>
      )}
      {selected && <p className="mb-3 break-all text-[10px] text-muted">{t("dataExchange.connectors.sdsReview.sourceIdentity", { supplier: selected.supplierId, provider: selected.providerId, hash: selected.sha256 })}</p>}
      {error && <p role="alert" className="mb-3 text-[11px] text-error">{error}</p>}
      {review?.status === "quarantined" && <p role="alert" className="mb-3 text-[11px] text-error">{t("dataExchange.connectors.sdsReview.quarantined", { reason: review.reason })}</p>}
      {data && (
        <div className="space-y-3">
          <div className="rounded-input border border-border-faint bg-surface-1 p-2 text-[10px] text-muted">
            {t("dataExchange.connectors.sdsReview.reviewOnly")} · {t("dataExchange.connectors.sdsReview.coverage", { detected: data.sections.sections.length, missing: data.sections.unobservedSectionNumbers.length })}
            <div className="mt-1 flex flex-wrap gap-1">{data.sections.warnings.map((warning) => <Badge key={warning}>{humanize(warning)}</Badge>)}{data.ocr.warnings.map((warning) => <Badge key={warning}>{humanize(warning)}</Badge>)}</div>
          </div>
          <CandidateSection number={1} candidates={section1Candidates ?? []} onOpenCitation={openPage} />
          <CandidateSection number={3} candidates={section3Candidates} onOpenCitation={openPage} />
          {savedEvidence && <StoredSdsEvidence record={savedEvidence} onOpenCitation={openPage} />}
          {!savedEvidence && <p className="text-[10px] text-muted">{t("dataExchange.connectors.sdsReview.noStoredFacts")}</p>}
          <CandidateSection number={7} candidates={section7Candidates ?? []} onOpenCitation={openPage} />
          <CandidateSection number={9} candidates={section9Candidates ?? []} onOpenCitation={openPage} />
          <CandidateSection number={15} candidates={section15Candidates ?? []} onOpenCitation={openPage} />
        </div>
      )}
      {candidateEvidence && (
        <section className="mt-3 rounded-input border border-border-faint p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h4 className="text-xs font-semibold text-text">{t("dataExchange.connectors.sdsReview.productEvidencePreview")}</h4><p className="mt-1 text-[10px] text-muted">{t("dataExchange.connectors.sdsReview.extractedClaims", { documentType: candidateEvidence.documentType, count: candidateEvidence.claims.length })} {candidateEvidence.documentHash.slice(0, 12)}…</p></div>
            <button type="button" onClick={() => void saveProductCard()} disabled={saving} className="rounded-input border border-accent px-3 py-1.5 text-[10px] font-medium text-accent disabled:opacity-50">{saving ? t("dataExchange.connectors.sdsReview.savingProductCard") : t("dataExchange.connectors.sdsReview.saveProductCard")}</button>
          </div>
          {savedCardVersion !== null && <p role="status" className="mt-2 text-[10px] text-success">{t("dataExchange.connectors.sdsReview.savedProductCard", { version: savedCardVersion })}</p>}
          {candidateEvidence.documentType === "TDS" && <div className="mt-2 space-y-2">{candidateEvidence.claims.map((claim) => <article key={claim.id} className="rounded border border-border-faint px-2 py-1.5 text-[10px]"><p className="font-medium text-text">{humanize(claim.fieldCode)}</p><p className="text-muted">{claim.rawValue}</p>{claim.evidence.map((source, index) => <button key={`${source.pageNumber}-${index}`} type="button" onClick={() => void openPage({ documentHash: source.documentHash, pageNumber: source.pageNumber, lineNumber: source.lineNumber ?? 1, excerpt: source.excerpt, source: source.source, confidence: source.confidence })} className="mr-2 text-accent underline">{t("dataExchange.connectors.sdsReview.pageLink", { page: source.pageNumber, line: source.lineNumber ?? "—" })}</button>)}</article>)}</div>}
          <p className="mt-2 text-[10px] text-muted">{t("dataExchange.connectors.sdsReview.extractionDoesNotOverwrite")}</p>
        </section>
      )}
      {selectedCitation && pdfBytes && <SupplierSdsPdfPagePreview bytes={pdfBytes} pageNumber={selectedCitation.pageNumber} lineNumber={selectedCitation.lineNumber} />}
    </Card>
  );
}

function ProductCardLibrary({ cards, acquisitions, records, savingReviewId, onReviewClaim, onOpenCitation }: {
  cards: ProductCardView[];
  acquisitions: SupplierDocumentAcquisition[];
  records: SupplierProductEvidenceRecord[];
  savingReviewId: string | null;
  onReviewClaim: (productCardId: string, sourceEvidenceId: string, claim: SupplierProductClaimEvidence, decision: SupplierProductClaimReview["decision"]) => Promise<void>;
  onOpenCitation: (citation: Citation) => Promise<void>;
}) {
  const { t } = useTranslation("session");
  const acquisitionByCode = new Map(acquisitions.map((record) => [record.code, record]));
  return <section className="mb-4 rounded-input border border-border-faint bg-surface-1 p-3">
    <div className="flex items-baseline justify-between gap-3"><h4 className="text-xs font-semibold text-text">{t("dataExchange.connectors.sdsReview.productCards")}</h4><span className="text-[10px] text-muted">{cards.length}</span></div>
    {cards.length === 0 ? <p className="mt-2 text-[10px] text-muted">{t("dataExchange.connectors.sdsReview.noProductCards")}</p> : <div className="mt-2 space-y-2">{cards.map(({ latest, versions, documents }) => {
      const claims = documents.flatMap((record) => record.claims.map((claim) => ({ sourceEvidenceId: record.id, claim }))).filter(({ claim }) => latest.claimIds.includes(claim.id));
      const conflicts = new Set(latest.conflicts.flatMap((conflict) => conflict.claimIds));
      return <details key={latest.productCardId} className="rounded-input border border-border-faint bg-surface p-2">
        <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[11px] font-medium text-text">{latest.tradeName ?? latest.supplierItemCode ?? latest.productCardId}</span><span className="text-[10px] text-muted">{latest.supplierName ?? latest.supplierId ?? t("dataExchange.connectors.sdsReview.unknownSupplier")} · {t("dataExchange.connectors.sdsReview.cardVersion", { version: latest.version })} · {humanize(latest.identityStatus)}</span></div><div className="mt-1 flex flex-wrap gap-1">{latest.grade && <Badge>{latest.grade}</Badge>}<Badge>{latest.market}/{latest.language}</Badge>{documents.map((document) => <Badge key={document.id}>{document.documentType}</Badge>)}</div></summary>
        <div className="mt-2 space-y-2">
          <p className="break-all text-[9px] text-muted">{latest.productCardId}</p>
          <div><p className="text-[10px] font-medium text-text">{t("dataExchange.connectors.sdsReview.sourceDocuments")}</p><div className="mt-1 space-y-1">{documents.map((document) => { const acquisition = acquisitionByCode.get(document.acquisitionCode); return <p key={document.id} className="break-all text-[9px] text-muted">{t("dataExchange.connectors.sdsReview.sourceDocumentSummary", { type: document.documentType, revision: acquisition?.sourceRevision ?? acquisition?.revisionDate ?? acquisition?.publicationDate ?? t("dataExchange.connectors.sdsReview.revisionUnknown"), hash: document.documentHash })}</p>; })}</div></div>
          <div><p className="text-[10px] font-medium text-text">{t("dataExchange.connectors.sdsReview.claimsHeading", { count: claims.length })}</p>{claims.length === 0 ? <p className="mt-1 text-[9px] text-muted">{t("dataExchange.connectors.sdsReview.noClaims")}</p> : <div className="mt-1 space-y-1">{claims.map(({ sourceEvidenceId, claim }) => {
            const history = records.filter((record): record is SupplierProductClaimReview => record.recordType === "claim_review" && record.productCardId === latest.productCardId && record.sourceEvidenceId === sourceEvidenceId && record.claimId === claim.id).sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));
            const current = history[history.length - 1];
            const decisionLabel = current ? current.decision === "accepted" ? t("dataExchange.connectors.sdsReview.accepted") : current.decision === "rejected" ? t("dataExchange.connectors.sdsReview.rejected") : t("dataExchange.connectors.sdsReview.needsReview") : t("dataExchange.connectors.sdsReview.reviewRequired");
            return <article key={claim.id} className="rounded border border-border-faint px-2 py-1.5 text-[9px]"><div className="flex flex-wrap items-center gap-1"><span className="font-medium text-text">{humanize(claim.fieldCode)}</span>{conflicts.has(claim.id) && <Badge>{t("dataExchange.connectors.sdsReview.conflictReview")}</Badge>}<Badge>{current ? decisionLabel + " · " + current.reviewedBy : decisionLabel}</Badge></div><p className="mt-0.5 break-words text-muted">{claim.rawValue}{claim.originalUnit ? " · " + claim.originalUnit : ""}{claim.basis !== "unknown" ? " · " + humanize(claim.basis) : ""}</p>{Object.entries(claim.context).length > 0 && <p className="text-muted">{Object.entries(claim.context).map(([key, value]) => humanize(key) + ": " + value).join(" · ")}</p>}{claim.evidence.map((citation, index) => <button key={claim.id + ":" + index} type="button" onClick={() => void onOpenCitation({ documentHash: citation.documentHash, pageNumber: citation.pageNumber, lineNumber: citation.lineNumber ?? 1, excerpt: citation.excerpt, source: citation.source, confidence: citation.confidence })} className="mr-2 text-accent underline">{t("dataExchange.connectors.sdsReview.pageLink", { page: citation.pageNumber, line: citation.lineNumber ?? "—" })}</button>)}<div className="mt-1 flex gap-2"><button type="button" disabled={savingReviewId !== null} onClick={() => void onReviewClaim(latest.productCardId, sourceEvidenceId, claim, "accepted")} className="text-accent underline disabled:opacity-50">{savingReviewId ? t("dataExchange.connectors.sdsReview.savingClaimReview") : t("dataExchange.connectors.sdsReview.acceptClaim")}</button><button type="button" disabled={savingReviewId !== null} onClick={() => void onReviewClaim(latest.productCardId, sourceEvidenceId, claim, "needs_review")} className="text-muted underline disabled:opacity-50">{t("dataExchange.connectors.sdsReview.needsReview")}</button><button type="button" disabled={savingReviewId !== null} onClick={() => void onReviewClaim(latest.productCardId, sourceEvidenceId, claim, "rejected")} className="text-muted underline disabled:opacity-50">{t("dataExchange.connectors.sdsReview.rejectClaim")}</button></div></article>;
          })}</div>}</div>
          <details className="text-[9px] text-muted"><summary className="cursor-pointer">{t("dataExchange.connectors.sdsReview.cardHistory", { count: versions.length })}</summary><ol className="mt-1 space-y-1">{versions.map((version) => <li key={version.id}>{t("dataExchange.connectors.sdsReview.cardVersion", { version: version.version })} · {version.evidenceRecordIds.length} {t("dataExchange.connectors.sdsReview.sourceCount")} · {new Date(version.createdAt).toLocaleString()}</li>)}</ol></details>
        </div>
      </details>;
    })}</div>}
  </section>;
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
