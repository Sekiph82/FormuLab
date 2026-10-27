import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, ClipboardCheck, Edit3, Eye, RotateCcw, X } from "lucide-react";
import type { ReferenceFormulationQueryRecord, ReferenceFormulationRecord, ReferenceFormulationReview } from "@formulab/shared";
import { useTrustedActor } from "@/lib/currentActor";
import { appendReferenceFormulationReview, listReferenceFormulationReviews } from "@/lib/referenceFormulationReviews";
import { listReferenceFormulations } from "@/lib/referenceFormulations";
import { rebuildReferenceFormulationCorpusIndex } from "@/lib/referenceFormulationNormalizations";
import { buildReferenceFormulationReviewItems, type ReferenceFormulationReviewItem } from "@/lib/referenceFormulationReviewItems";
import { getReferenceFormulationCorpusReviewData, type ReferenceFormulationCorpusReviewData } from "@/lib/referenceFormulationCorpusReview";
import { readSupplierDocumentPdf } from "@/lib/masterdata";
import { SupplierSdsPdfPagePreview } from "@/components/dataExchange/connectors/SupplierSdsPdfPagePreview";

const DECISIONS = [
  { value: "accepted", labelKey: "decisionAccept", icon: Check },
  { value: "edited", labelKey: "decisionEdit", icon: Edit3 },
  { value: "rejected", labelKey: "decisionReject", icon: X },
  { value: "needs_review", labelKey: "decisionNeedsReview", icon: Eye },
] as const;

type Decision = typeof DECISIONS[number]["value"];

export function ReferenceFormulationsPage() {
  const { t } = useTranslation("session");
  const { recordId } = useParams();
  const [records, setRecords] = useState<ReferenceFormulationRecord[]>([]);
  const [queryRecords, setQueryRecords] = useState<ReferenceFormulationQueryRecord[]>([]);
  const [searchText, setSearchText] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [reviews, setReviews] = useState<ReferenceFormulationReview[]>([]);
  const [traceData, setTraceData] = useState<ReferenceFormulationCorpusReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourcePdf, setSourcePdf] = useState<{ sha256: string; bytes: Uint8Array } | null>(null);
  const [sourcePage, setSourcePage] = useState<{ pageNumber: number; excerpt: string } | null>(null);
  const [sourcePdfError, setSourcePdfError] = useState<string | null>(null);
  const pdfReadToken = useRef(0);
  const actor = useTrustedActor();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!recordId) setQueryRecords([]);
    try {
      const available = await listReferenceFormulations();
      setRecords(available.sort((left, right) => left.source.title.localeCompare(right.source.title)));
      if (recordId) {
        const [reviewHistory, trace] = await Promise.all([
          listReferenceFormulationReviews(recordId), getReferenceFormulationCorpusReviewData(recordId),
        ]);
        setReviews(reviewHistory);
        setTraceData(trace);
      } else {
        const corpus = await rebuildReferenceFormulationCorpusIndex();
        setQueryRecords(corpus.queryRecords);
        setReviews([]);
        setTraceData(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = records.find((record) => record.id === recordId) ?? null;
  const queryBySourceId = useMemo(() => {
    const recordById = new Map(records.map((record) => [record.id, record]));
    return new Map(queryRecords.filter((query) => recordById.get(query.sourceRecordId)?.sourceDocumentHash.toLowerCase() === query.sourceDocumentHash.toLowerCase())
      .map((query) => [query.sourceRecordId, query]));
  }, [queryRecords, records]);
  const suppliers = useMemo(() => [...new Set(records.map((record) => record.source.supplierId))].sort((left, right) => left.localeCompare(right)), [records]);
  const filteredRecords = useMemo(() => {
    const needle = searchText.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    return records.filter((record) => {
      const query = queryBySourceId.get(record.id);
      if (supplierFilter && record.source.supplierId !== supplierFilter) return false;
      if (!needle) return true;
      const sourceText = [record.source.title, record.source.supplierId, record.source.formulationCode,
        record.source.originalFilename, record.source.acquisitionCode, record.source.sourceRevision,
        record.source.revisionDate, record.source.publicationDate, record.source.market, record.source.language,
        record.sourceDocumentHash, ...record.ingredientLines.flatMap((line) => [line.ingredientName?.rawValue,
          line.supplierProductCode?.rawValue, line.inciOrChemicalName?.rawValue, line.function?.rawValue,
          line.amount?.rawValue, line.unit?.rawValue, line.basis?.rawValue]),
        ...record.procedureSteps.map((step) => step.rawInstruction),
        ...record.targetCandidates.flatMap((target) => [target.rawPropertyLabel, target.rawValue])]
        .filter(Boolean).join(" ");
      const normalized = `${sourceText} ${query ? collectSearchStrings(query).join(" ") : ""}`.normalize("NFKC").toLocaleLowerCase("en-US");
      return normalized.includes(needle);
    });
  }, [records, queryBySourceId, searchText, supplierFilter]);
  const items = useMemo(() => selected ? buildReferenceFormulationReviewItems(selected) : [], [selected]);
  useEffect(() => {
    pdfReadToken.current += 1;
    setSourcePdf(null);
    setSourcePage(null);
    setSourcePdfError(null);
  }, [selected?.id]);

  const openSourcePage = async (pageNumber: number, excerpt: string) => {
    if (!selected || !Number.isInteger(pageNumber) || pageNumber < 1) return;
    const expectedHash = selected.sourceDocumentHash.toLowerCase();
    if (expectedHash !== selected.source.sourcePdfSha256.toLowerCase()) {
      setSourcePdfError(t("referenceFormulations.pdfHashMismatch"));
      return;
    }
    setSourcePdfError(null);
    setSourcePage({ pageNumber, excerpt });
    if (sourcePdf?.sha256.toLowerCase() === expectedHash) return;
    const requestToken = ++pdfReadToken.current;
    try {
      const bytes = await readSupplierDocumentPdf(expectedHash);
      if (requestToken !== pdfReadToken.current) return;
      setSourcePdf({ sha256: expectedHash, bytes });
    } catch (cause) {
      if (requestToken === pdfReadToken.current) setSourcePdfError(t("referenceFormulations.pdfReadError", { message: cause instanceof Error ? cause.message : "" }));
    }
  };
  const latestByTarget = useMemo(() => {
    const latest = new Map<string, ReferenceFormulationReview>();
    for (const review of reviews) latest.set(review.targetKey, review);
    return latest;
  }, [reviews]);

  const saveDecision = async (item: ReferenceFormulationReviewItem, decision: Decision, reviewedValue?: string, note?: string) => {
    if (!selected || !actor) return;
    setError(null);
    setNotice(null);
    try {
      const review = await appendReferenceFormulationReview({
        referenceFormulationRecordId: selected.id,
        sourceDocumentHash: selected.sourceDocumentHash,
        targetType: item.targetType,
        targetKey: item.targetKey,
        fieldPath: item.fieldPath,
        sourceValue: item.sourceValue,
        evidenceExcerpt: item.evidenceExcerpt,
        ...(item.pageNumber !== undefined ? { pageNumber: item.pageNumber } : {}),
        ...(item.blockIndex !== undefined ? { blockIndex: item.blockIndex } : {}),
        ...(item.rowIndex !== undefined ? { rowIndex: item.rowIndex } : {}),
        ...(item.cellIndex !== undefined ? { cellIndex: item.cellIndex } : {}),
        decision,
        ...(decision === "edited" ? { reviewedValue: reviewedValue?.trim() } : {}),
        ...(note?.trim() ? { note: note.trim() } : {}),
        reviewer: { userId: actor.userId, displayName: actor.displayName },
      });
      setReviews((current) => [...current, review]);
      setNotice(t("referenceFormulations.decisionSaved", { field: item.label, decision: t(`referenceFormulations.${DECISIONS.find((entry) => entry.value === decision)?.labelKey ?? "decisionNeedsReview"}`) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (loading) return <div className="p-8 text-sm text-muted">{t("referenceFormulations.loading")}</div>;
  if (error && !records.length && recordId) return <div role="alert" className="p-8 text-sm text-error"><p>{t("referenceFormulations.loadError", { message: error })}</p><button type="button" onClick={() => void refresh()} className="mt-2 underline">{t("referenceFormulations.retry")}</button></div>;
  if (recordId && !selected) return <div role="alert" className="p-8 text-sm text-error">{t("referenceFormulations.notFound")}</div>;

  if (!selected) {
    return (
      <main className="mx-auto w-full max-w-6xl p-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-text">{t("referenceFormulations.title")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">{t("referenceFormulations.intro")}</p>
        </header>
        {error && <div role="alert" className="mb-4 rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error"><p>{t("referenceFormulations.loadError", { message: error })}</p><button type="button" onClick={() => void refresh()} className="mt-2 underline">{t("referenceFormulations.retry")}</button></div>}
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <label className="block text-sm font-medium text-text">{t("referenceFormulations.searchLabel")}
            <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={t("referenceFormulations.searchPlaceholder")} className="mt-1 w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text" />
            <span className="mt-1 block text-xs text-muted">{t("referenceFormulations.searchHint")}</span>
          </label>
          <label className="block text-sm font-medium text-text">{t("referenceFormulations.supplierFilter")}
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text">
              <option key="all-suppliers" value="">{t("referenceFormulations.allSuppliers")}</option>
              {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
            </select>
          </label>
        </div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p role="status" className="text-xs text-muted">{t("referenceFormulations.showingRecords", { filtered: filteredRecords.length, total: records.length })}</p>
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2"><RotateCcw size={13} />{t("referenceFormulations.refreshCorpus")}</button>
        </div>
        {records.length === 0 && !error ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">{t("referenceFormulations.empty")}</div>
        ) : records.length > 0 && !error && filteredRecords.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">{t("referenceFormulations.noMatches")}</div>
        ) : <ul className="grid gap-3 md:grid-cols-2">{filteredRecords.map((record) => <ReferenceFormulationCorpusCard key={record.id} record={record} query={queryBySourceId.get(record.id)} />)}</ul>}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl p-6">
      <Link to="/reference-formulations" className="mb-4 inline-flex items-center gap-2 text-sm text-accent hover:underline"><ArrowLeft size={15} />{t("referenceFormulations.allFormulations")}</Link>
      <header className="mb-5 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <ClipboardCheck size={20} className="mt-1 text-accent" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-text">{selected.source.title}</h1>
            <p className="mt-1 text-sm text-muted">{t("referenceFormulations.detailIdentity", { supplier: selected.source.supplierId, code: selected.source.formulationCode ?? selected.code, filename: selected.source.originalFilename, acquisition: selected.source.acquisitionCode })}</p>
            <p className="mt-2 break-all font-mono text-[11px] text-muted">{t("referenceFormulations.sourceHash", { hash: selected.sourceDocumentHash })}</p>
          </div>
        </div>
        <p className="mt-4 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">{t("referenceFormulations.reviewBoundary")}</p>
      </header>
      {error && <p role="alert" className="mb-4 rounded-md border border-error/30 bg-error/5 p-3 text-sm text-error">{t("referenceFormulations.reviewSaveError", { message: error })}</p>}
      {notice && <p role="status" className="mb-4 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">{notice}</p>}
      {!actor && <p role="alert" className="mb-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-text">{t("referenceFormulations.signInReview")}</p>}
      <div className="mb-5 grid items-start gap-4 xl:grid-cols-2">
        <section aria-label={t("referenceFormulations.sourcePdfSection")} className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-text">{t("referenceFormulations.sourcePdfTitle")}</h2>
          <p className="mb-3 break-all font-mono text-[10px] text-muted">{t("referenceFormulations.sourceFileHash", { file: selected.source.originalFilename ?? selected.source.title, hash: selected.sourceDocumentHash })}</p>
          {sourcePdfError && <p role="alert" className="mb-2 text-xs text-error">{sourcePdfError}</p>}
          {sourcePage && sourcePdf?.sha256.toLowerCase() === selected.sourceDocumentHash.toLowerCase()
            ? <><SupplierSdsPdfPagePreview bytes={sourcePdf.bytes} pageNumber={sourcePage.pageNumber} lineNumber={1} documentLabel={t("referenceFormulations.supplierFormulation")} /><p className="mt-2 whitespace-pre-wrap text-xs text-muted">{sourcePage.excerpt}</p></>
            : <p className="rounded bg-surface-2 p-3 text-xs text-muted">{t("referenceFormulations.pdfPageHint")}</p>}
        </section>
        <FormulationExtractionOverview record={selected} reviewItems={items} onOpenPage={openSourcePage} />
      </div>
      <div className="mb-4 flex items-center justify-between text-sm text-muted">
        <span>{t("referenceFormulations.reviewFieldCount", { count: items.length })}</span>
        <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-text hover:bg-surface-2"><RotateCcw size={13} />{t("referenceFormulations.refresh")}</button>
      </div>
      {items.length === 0 ? <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">{t("referenceFormulations.noReviewValues")}</p> : (
        <div className="space-y-3">
          {items.map((item) => <ReviewCard key={item.targetKey} item={item} review={latestByTarget.get(item.targetKey)} disabled={!actor} onSave={saveDecision} onOpenSourcePage={openSourcePage} />)}
        </div>
      )}
      {traceData && <ReferenceFormulationNormalizationTrace data={traceData} />}
    </main>
  );
}

function collectSearchStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectSearchStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectSearchStrings);
  return [];
}

function ReferenceFormulationCorpusCard({ record, query }: { record: ReferenceFormulationRecord; query?: ReferenceFormulationQueryRecord }) {
  const { t } = useTranslation("session");
  const unique = (values: Array<string | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))];
  const families = query?.productFamily.candidates.map((candidate) => candidate.rawValue) ?? [];
  const products = unique(query?.lines.flatMap((line) => line.commercialProducts.candidateIds) ?? []);
  const chemistry = unique(query?.lines.flatMap((line) => line.canonicalChemistry.candidateIds) ?? []);
  const functions = unique(query?.lines.flatMap((line) => [line.supplierFunction.originalValue, ...line.canonicalFunctions.candidateIds]) ?? []);
  const amounts = unique(query?.lines.map((line) => [line.amount.originalValue, line.amount.unit, line.amount.basis].filter(Boolean).join(" ")) ?? []);
  const process = unique(query?.processSteps.map((step) => step.originalInstruction) ?? []);
  const targets = unique(query?.targets.map((target) => [target.property, target.originalValue, target.resultSemantics].filter(Boolean).join(" ")) ?? []);
  const revisions = unique([record.source.sourceRevision, record.source.revisionDate, record.source.publicationDate]);
  const evidenceRefs = unique(query?.lines.flatMap((line) => [...line.sourceLineEvidenceRefs, ...line.amount.evidenceRefs]) ?? []);
  return (
    <li>
      <Link to={`/reference-formulations/${encodeURIComponent(record.id)}`} className="block h-full rounded-lg border border-border bg-surface p-4 hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <span className="font-medium text-text">{record.source.title}</span>
        <span className="mt-1 block text-xs text-muted">{t("referenceFormulations.cardIdentity", { supplier: record.source.supplierId, code: record.source.formulationCode ?? record.code, product: record.source.sourceProduct.tradeName ?? t("referenceFormulations.productNotStated"), grade: record.source.sourceProduct.grade ? ` (${record.source.sourceProduct.grade})` : "" })}</span>
        <span className="mt-2 block text-xs text-muted">{t("referenceFormulations.cardCounts", { lines: record.ingredientLines.length, process: record.procedureSteps.length, targets: record.targetCandidates.length, normalization: query ? t("referenceFormulations.normalizationVersion", { version: query.normalizationVersion }) : t("referenceFormulations.indexUnavailable") })}</span>
        <div className="mt-3 space-y-1.5 text-xs">
          <CorpusField label={t("referenceFormulations.familyCandidates")} values={families} emptyText={t("referenceFormulations.notStatedOrUnresolved")} />
          <CorpusField label={t("referenceFormulations.commercialCandidates")} values={products} emptyText={t("referenceFormulations.notStatedOrUnresolved")} />
          <CorpusField label={t("referenceFormulations.chemistryCandidates")} values={chemistry} emptyText={t("referenceFormulations.notStatedOrUnresolved")} />
          <CorpusField label={t("referenceFormulations.functions")} values={functions} emptyText={t("referenceFormulations.notStatedOrUnresolved")} />
          <CorpusField label={t("referenceFormulations.dosages")} values={amounts} emptyText={t("referenceFormulations.notStatedOrUnresolved")} />
          <CorpusField label={t("referenceFormulations.processEvidence")} values={process} emptyText={t("referenceFormulations.notStatedOrUnresolved")} />
          <CorpusField label={t("referenceFormulations.targetEvidence")} values={targets} emptyText={t("referenceFormulations.notStatedOrUnresolved")} />
        </div>
        <div className="mt-3 border-t border-border pt-2 text-[10px] text-muted">
          <p>{t("referenceFormulations.sourceLineage", { provider: record.source.providerId, surface: record.source.surfaceId, market: record.source.market, language: record.source.language, revision: revisions.join(" / ") || t("referenceFormulations.notStated") })}</p>
          <p>{t("referenceFormulations.acquisitionLineage", { code: record.source.acquisitionCode, filename: record.source.originalFilename })}</p>
          <p className="mt-1 break-all font-mono">{t("referenceFormulations.sha256", { hash: record.sourceDocumentHash })}</p>
          <p className="mt-1 break-all">{t("referenceFormulations.evidenceRefs", { refs: evidenceRefs.slice(0, 3).join(", ") || t("referenceFormulations.openForCitations") })}</p>
          <p className="mt-2 font-medium">{t("referenceFormulations.candidateOnly")}</p>
        </div>
      </Link>
    </li>
  );
}

function CorpusField({ label, values, emptyText }: { label: string; values: string[]; emptyText: string }) {
  return <p className="break-words"><span className="font-medium text-text">{label}:</span> <span className="text-muted">{values.join("; ") || emptyText}</span></p>;
}

function ReferenceFormulationNormalizationTrace({ data }: { data: ReferenceFormulationCorpusReviewData }) {
  const { t } = useTranslation("session");
  return (
    <section aria-label={t("referenceFormulations.normalizationTraceLabel")} className="mt-8 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-text">{t("referenceFormulations.normalizationTraceTitle")}</h2>
      <p className="mb-5 mt-1 text-sm text-muted">{t("referenceFormulations.normalizationTraceIntro")}</p>
      {data.versions.length === 0 ? <p className="rounded border border-border bg-surface-2 p-4 text-sm text-muted">{t("referenceFormulations.noNormalizationVersions")}</p> : (
        <div className="space-y-5">
          {data.versions.map(({ version, lines }) => <section key={version.id} aria-label={`Normalization version ${version.version}`} className="rounded-md border border-border p-4">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-text">{t("referenceFormulations.normalizationVersionCreated", { version: version.version, createdAt: version.createdAt })}</h3>
              <span className="font-mono text-[10px] text-muted">{t("referenceFormulations.normalizationSourceHash", { id: version.id, hash: version.sourceDocumentHash })}</span>
            </header>
            <div className="space-y-3">
              {lines.map(({ sourceLine, normalizedLine, contributions }) => <article key={sourceLine.id} aria-label={t("referenceFormulations.normalizedSourceLineLabel", { id: sourceLine.id })} className="rounded border border-border bg-surface-2 p-4">
                <h4 className="text-sm font-semibold text-text">{t("referenceFormulations.sourceLine", { order: sourceLine.orderIndex, id: sourceLine.id })}</h4>
                <p className="mt-1 break-words text-sm text-text">{sourceLine.rawRow.join(" | ")}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted">{sourceLine.ingredientName?.evidence.pageNumber !== undefined ? `${t("referenceFormulations.sourceCoordinates", { page: sourceLine.ingredientName.evidence.pageNumber, block: sourceLine.ingredientName.evidence.blockIndex })} · ` : ""}{sourceLine.ingredientName?.evidence.excerpt ?? t("referenceFormulations.sourceRowEvidenceRetained")} · {data.source.sourceDocumentHash}</p>
                <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                  <div><span className="font-semibold text-text">{t("referenceFormulations.commercialCandidates")}:</span> <span className="text-muted">{normalizedLine.commercialProduct.candidateIds.join(", ") || t("referenceFormulations.unresolved")} · {t("referenceFormulations.reviewRequired")}</span></div>
                  <div><span className="font-semibold text-text">{t("referenceFormulations.chemistryCandidates")}:</span> <span className="text-muted">{normalizedLine.canonicalChemistry.candidateIds.join(", ") || t("referenceFormulations.unresolved")} · {t("referenceFormulations.reviewRequired")}</span></div>
                  <div><span className="font-semibold text-text">{t("referenceFormulations.supplierFunction")}:</span> <span className="text-muted">{normalizedLine.functionNormalization?.supplierFunction.originalValue ?? t("referenceFormulations.notStated")}</span></div>
                  <div><span className="font-semibold text-text">{t("referenceFormulations.functions")}:</span> <span className="text-muted">{normalizedLine.functionNormalization?.canonicalFunction.candidateIds.join(", ") || t("referenceFormulations.unresolved")} · {t("referenceFormulations.reviewRequired")}</span></div>
                </div>
                {contributions.length === 0 ? <p className="mt-3 rounded border border-border p-3 text-xs text-muted">{t("referenceFormulations.noContribution")}</p> : (
                  <div className="mt-3 space-y-2">
                    {contributions.map(({ contribution, sds }) => <section key={contribution.id} aria-label={`Component contribution ${contribution.id}`} className="rounded border border-border p-3">
                      <h5 className="text-xs font-semibold text-text">{t("referenceFormulations.componentContributionTitle", { id: contribution.id, status: t(`referenceFormulations.status.${contribution.status}`) })}</h5>
                      <p className="mt-1 text-xs text-muted">{t("referenceFormulations.componentChemistryCandidates", { candidates: contribution.canonicalChemistry.candidateIds.join(", ") || t("referenceFormulations.unresolved") })}</p>
                      <p className="mt-1 text-xs text-muted">{t("referenceFormulations.formulaAmountLineage", { amount: contribution.formulaAmount.originalValue ?? t("referenceFormulations.unknown"), unit: contribution.formulaAmount.unit ?? "", basis: contribution.formulaAmount.basis ?? "", line: contribution.sourceFormulaLineId, hash: contribution.sourceFormulaDocumentHash })}</p>
                      <p className="mt-1 text-xs text-muted">{t("referenceFormulations.calculatedContribution", { contribution: contribution.contributionPercentRange ? `${contribution.contributionPercentRange.lowerBound}–${contribution.contributionPercentRange.upperBound}% w/w` : t("referenceFormulations.unknown"), refs: [...contribution.formulaAmount.evidenceRefs, ...contribution.sourceSds.evidenceRefs].join(", ") || t("referenceFormulations.none") })}</p>
                      {!sds ? <p className="mt-2 rounded bg-surface-2 p-2 text-xs text-muted">{t("referenceFormulations.sdsEvidenceMissing", { reasons: contribution.unknownReasons.join(", ") || t("referenceFormulations.notSupplied") })}</p> : (
                        <div className="mt-2 rounded bg-surface-2 p-3 text-xs text-muted">
                          <p>{t("referenceFormulations.sdsLineage", { product: sds.acquisition.sourceProduct.tradeName ?? sds.acquisition.sourceProduct.supplierItemCode ?? sds.acquisition.originalFilename, supplier: sds.acquisition.supplierId, code: sds.acquisition.code, revision: sds.acquisition.revisionDate ?? sds.acquisition.sourceRevision ?? t("referenceFormulations.revisionNotStated") })}</p>
                          <p className="mt-1 break-all font-mono text-[10px]">{t("referenceFormulations.sdsEvidenceIdentity", { evidence: sds.evidence.code, hash: sds.acquisition.sha256, component: contribution.sourceSds.sourceComponentId ?? t("referenceFormulations.notResolved"), fact: contribution.sourceSds.sourceFactId ?? t("referenceFormulations.notResolved") })}</p>
                          <p className="mt-1">{t("referenceFormulations.sdsDisclosure", { disclosure: contribution.sourceSds.disclosure ?? t("referenceFormulations.unknown"), value: contribution.sourceSds.originalValue ?? t("referenceFormulations.notDisclosed"), fraction: contribution.sourceSds.fractionRange ? `${contribution.sourceSds.fractionRange.lowerBound}–${contribution.sourceSds.fractionRange.upperBound}` : t("referenceFormulations.unknown") })}</p>
                          <p className="mt-1 break-words">{t("referenceFormulations.sdsComponentFacts", { name: sds.sourceComponent?.componentName?.rawValue ?? t("referenceFormulations.nameNotDisclosed"), cas: sds.sourceComponent?.casNumber?.rawValue ?? t("referenceFormulations.notStated"), ec: sds.sourceComponent?.ecNumber?.rawValue ?? t("referenceFormulations.notStated"), material: sds.sourceComponent?.materialNumber?.rawValue ?? t("referenceFormulations.notStated"), refs: contribution.sourceSds.evidenceRefs.join(", ") || t("referenceFormulations.none") })}</p>
                        </div>
                      )}
                    </section>)}
                  </div>
                )}
              </article>)}
            </div>
          </section>)}
        </div>
      )}
    </section>
  );
}

function FormulationExtractionOverview({ record, reviewItems, onOpenPage }: {
  record: ReferenceFormulationRecord;
  reviewItems: ReferenceFormulationReviewItem[];
  onOpenPage: (pageNumber: number, excerpt: string) => Promise<void>;
}) {
  const { t } = useTranslation("session");
  const itemFor = (targetKey: string) => reviewItems.find((item) => item.targetKey === targetKey);
  const cite = (item: ReferenceFormulationReviewItem | undefined) => item?.pageNumber
    ? <button type="button" onClick={() => void onOpenPage(item.pageNumber!, item.evidenceExcerpt)} className="ml-2 text-[10px] text-accent underline">{t("referenceFormulations.viewPdfPage", { page: item.pageNumber })}</button>
    : null;
  return (
    <section aria-label={t("referenceFormulations.extractionOverviewLabel")} className="max-h-[76vh] space-y-4 overflow-y-auto rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text">{t("referenceFormulations.extractionOverviewTitle")}</h2>
      <section aria-label={t("referenceFormulations.formulaLinesLabel")} className="rounded border border-border-faint p-3">
        <h3 className="mb-2 text-xs font-semibold text-text">{t("referenceFormulations.formulaLinesTitle")}</h3>
        {record.ingredientLines.length === 0 ? <p className="text-xs text-muted">{t("referenceFormulations.noIngredientLines")}</p> : <div className="space-y-2">{record.ingredientLines.map((line) => {
          const match = record.productMatches.find((candidate) => candidate.ingredientLineId === line.id);
          const productItem = itemFor(`ingredient:${line.id}:supplierProductCode`)
            ?? itemFor(`ingredient:${line.id}:ingredientName`);
          return <article key={line.id} className="rounded border border-border-faint bg-surface-1 p-2">
            <p className="text-[10px] font-medium text-text">{line.orderIndex}. {line.ingredientName?.rawValue ?? line.inciOrChemicalName?.rawValue ?? line.supplierProductCode?.rawValue ?? t("referenceFormulations.ingredientNameNotStated")}</p>
            {line.rawRow.length > 0 && <p className="mt-1 break-words text-[10px] text-muted">{t("referenceFormulations.sourceRow", { row: line.rawRow.join(" | ") })}</p>}
            <div className="mt-2 grid gap-1 text-[10px] sm:grid-cols-2">
              <SourceValue label={t("referenceFormulations.supplierFunction")} value={line.function?.rawValue ?? t("referenceFormulations.notStated")} citation={cite(itemFor(`ingredient:${line.id}:function`))} />
              <SourceValue label={t("referenceFormulations.amountUnitBasis")} value={[line.amount?.rawValue, line.unit?.rawValue, line.basis?.rawValue].filter(Boolean).join(" ") || (line.quantitySemantics === "q_s" ? t("referenceFormulations.qsAmountRetained") : t("referenceFormulations.notStated"))} citation={cite(itemFor(`ingredient:${line.id}:amount`))} />
              <SourceValue label={t("referenceFormulations.phaseSequence")} value={line.phase?.rawValue ?? String(line.orderIndex)} citation={cite(itemFor(`ingredient:${line.id}:phase`))} />
              <SourceValue label={t("referenceFormulations.quantitySemantics")} value={t(`referenceFormulations.quantity.${line.quantitySemantics}`)} />
            </div>
            <div className="mt-2 rounded border border-border-faint px-2 py-1.5">
              <p className="text-[10px] font-medium text-text">{t("referenceFormulations.commercialLinkCandidates")}</p>
              <p className="mt-0.5 text-[10px] text-muted">{match ? t("referenceFormulations.matchStatus", { resolution: t(`referenceFormulations.resolution.${match.resolution}`), linkage: t(match.autoLinked ? "referenceFormulations.autoLinked" : "referenceFormulations.notAutoLinked") }) : t("referenceFormulations.noProductMatch")}</p>
              {match?.candidates.length ? <ul className="mt-1 space-y-1">{match.candidates.map((candidate) => <li key={candidate.commercialProductId} className="break-words text-[10px] text-muted"><code className="text-accent">{candidate.commercialProductId}</code> · {t(`referenceFormulations.matchTier.${candidate.tier}`)} · {candidate.matchedOn.join(", ") || t("referenceFormulations.identifierMatch")}{candidate.matchedValues.length ? ` · ${candidate.matchedValues.join(", ")}` : ""}{candidate.similarity !== undefined ? ` · ${t("referenceFormulations.similarityProposal", { percent: (candidate.similarity * 100).toFixed(1) })}` : ""}</li>)}</ul>
                : <p className="mt-1 text-[10px] text-muted">{t("referenceFormulations.noCommercialCandidate")}</p>}
              {cite(productItem)}
            </div>
          </article>;
        })}</div>}
      </section>
      <section aria-label={t("referenceFormulations.procedureLabel")} className="rounded border border-border-faint p-3">
        <h3 className="mb-2 text-xs font-semibold text-text">{t("referenceFormulations.procedureTitle")}</h3>
        {record.procedureSteps.length === 0 ? <p className="text-xs text-muted">{t("referenceFormulations.noProcedureSteps")}</p> : <ol className="space-y-2">{record.procedureSteps.map((step) => <li key={step.id} className="rounded border border-border-faint bg-surface-1 p-2">
          <p className="text-[10px] font-medium text-text">{step.sequenceOrder}. {step.phase?.rawValue ? `${step.phase.rawValue} · ` : ""}{step.rawInstruction}</p>
          <p className="mt-1 text-[10px] text-muted">{t("referenceFormulations.processStepDetails", { actions: step.actions.join(", ") || t("referenceFormulations.notClassified"), conditions: step.conditions.map((condition) => `${condition.kind}: ${condition.rawValue}`).join("; ") || t("referenceFormulations.notStated") })}</p>
          {cite(itemFor(`procedure:${step.id}:instruction`))}
        </li>)}</ol>}
      </section>
      <section aria-label={t("referenceFormulations.targetsLabel")} className="rounded border border-border-faint p-3">
        <h3 className="mb-2 text-xs font-semibold text-text">{t("referenceFormulations.targetsTitle")}</h3>
        {record.targetCandidates.length === 0 ? <p className="text-xs text-muted">{t("referenceFormulations.noTargetCandidates")}</p> : <ul className="space-y-2">{record.targetCandidates.map((target) => {
          const item = itemFor(`target:${target.id}`);
          return <li key={target.id} className="rounded border border-border-faint bg-surface-1 p-2">
            <p className="text-[10px] font-medium text-text">{target.rawPropertyLabel}: {target.rawValue}</p>
            <p className="mt-1 text-[10px] text-muted">{t(`referenceFormulations.resultSemantics.${target.resultSemantics}`)} · {t(`referenceFormulations.valueShape.${target.valueShape}`)}</p>
            {cite(item)}
          </li>;
        })}</ul>}
      </section>
    </section>
  );
}

function SourceValue({ label, value, citation }: { label: string; value: string; citation?: ReactNode }) {
  return <p className="break-words text-muted">{label}: <span className="text-text">{value}</span>{citation}</p>;
}

function ReviewCard({
  item, review, disabled, onSave, onOpenSourcePage,
}: {
  item: ReferenceFormulationReviewItem;
  review?: ReferenceFormulationReview;
  disabled: boolean;
  onSave: (item: ReferenceFormulationReviewItem, decision: Decision, value?: string, note?: string) => Promise<void>;
  onOpenSourcePage: (pageNumber: number, excerpt: string) => Promise<void>;
}) {
  const { t } = useTranslation("session");
  const [decision, setDecision] = useState<Decision>("needs_review");
  const [value, setValue] = useState(review?.decision === "edited" ? review.reviewedValue ?? "" : item.sourceValue);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (disabled || saving || (decision === "edited" && !value.trim())) return;
    setSaving(true);
    try { await onSave(item, decision, value, note); }
    finally { setSaving(false); }
  };
  const location = [item.pageNumber ? t("referenceFormulations.pageNumber", { page: item.pageNumber }) : undefined, item.rowIndex !== undefined ? t("referenceFormulations.rowNumber", { row: item.rowIndex }) : undefined, item.cellIndex !== undefined ? t("referenceFormulations.cellNumber", { cell: item.cellIndex }) : undefined]
    .filter(Boolean).join(" · ");

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div><h2 className="text-sm font-semibold capitalize text-text">{item.label}</h2><p className="text-[11px] text-muted">{item.targetType} · {item.fieldPath}</p></div>
        {review && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-text">{t(`referenceFormulations.decision.${review.decision}`)} · {review.reviewer.displayName}</span>}
      </header>
      <div className="grid md:grid-cols-2">
        <section className="border-b border-border p-4 md:border-b-0 md:border-r" aria-label={t("referenceFormulations.sourceEvidenceLabel")}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{t("referenceFormulations.sourceEvidenceHeading", { location })}</h3>
          <blockquote className="whitespace-pre-wrap break-words rounded bg-surface-2 p-3 text-sm text-text">{item.evidenceExcerpt || t("referenceFormulations.noSourceExcerpt")}</blockquote>
          {item.sourceKind && <p className="mt-2 text-[11px] text-muted">{t(({ digital: "referenceFormulations.sourceKind.digital", ocr: "referenceFormulations.sourceKind.ocr", mixed: "referenceFormulations.sourceKind.mixed", unknown: "referenceFormulations.sourceKind.unknown" } as const)[item.sourceKind] ?? "referenceFormulations.sourceKind.unknown")}{item.confidence !== undefined ? ` · ${t("referenceFormulations.extractionConfidence", { percent: (item.confidence * 100).toFixed(0) })}` : ""}</p>}
          {item.pageNumber !== undefined && <button type="button" onClick={() => void onOpenSourcePage(item.pageNumber!, item.evidenceExcerpt)} className="mt-2 text-[11px] text-accent underline">{t("referenceFormulations.viewSourcePdfPage", { page: item.pageNumber })}</button>}
        </section>
        <section className="p-4" aria-label={t("referenceFormulations.extractedValueLabel")}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{t("referenceFormulations.extractedValueHeading")}</h3>
          <p className="mb-3 whitespace-pre-wrap break-words rounded border border-border p-3 text-sm text-text">{item.sourceValue || t("referenceFormulations.emptyValue")}</p>
          <label className="mb-2 block text-xs text-muted">{t("referenceFormulations.reviewDecision")}
            <select value={decision} onChange={(event) => setDecision(event.target.value as Decision)} disabled={disabled || saving} className="mt-1 block w-full rounded border border-border bg-surface px-2 py-2 text-sm text-text">
              {DECISIONS.map((option) => <option key={option.value} value={option.value}>{t(`referenceFormulations.${option.labelKey}`)}</option>)}
            </select>
          </label>
          {decision === "edited" && <label className="mb-2 block text-xs text-muted">{t("referenceFormulations.proposedValue")}
            <input value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled || saving} className="mt-1 block w-full rounded border border-border bg-surface px-2 py-2 text-sm text-text" />
          </label>}
          <label className="mb-3 block text-xs text-muted">{t("referenceFormulations.reviewNote")}
            <input value={note} onChange={(event) => setNote(event.target.value)} disabled={disabled || saving} maxLength={2000} className="mt-1 block w-full rounded border border-border bg-surface px-2 py-2 text-sm text-text" />
          </label>
          <button type="button" onClick={() => void submit()} disabled={disabled || saving || (decision === "edited" && !value.trim())} className="rounded bg-accent px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? t("referenceFormulations.saving") : t("referenceFormulations.saveDecision")}
          </button>
          {review && <p className="mt-2 text-[11px] text-muted">{t("referenceFormulations.previousDecisionRetained", { date: new Date(review.reviewedAt).toLocaleString() })}</p>}
        </section>
      </div>
    </article>
  );
}
