import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  { value: "accepted", label: "Accept", icon: Check },
  { value: "edited", label: "Edit proposal", icon: Edit3 },
  { value: "rejected", label: "Reject", icon: X },
  { value: "needs_review", label: "Needs review", icon: Eye },
] as const;

type Decision = typeof DECISIONS[number]["value"];

export function ReferenceFormulationsPage() {
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
      setSourcePdfError("The reference record and source metadata PDF hashes do not match.");
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
      if (requestToken === pdfReadToken.current) setSourcePdfError(cause instanceof Error ? cause.message : "The source PDF could not be read.");
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
      setNotice(`${item.label}: ${DECISIONS.find((entry) => entry.value === decision)?.label} saved.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (loading) return <div className="p-8 text-sm text-muted">Loading reference formulations…</div>;
  if (error && !records.length && recordId) return <div role="alert" className="p-8 text-sm text-error">{error}</div>;
  if (recordId && !selected) return <div role="alert" className="p-8 text-sm text-error">Reference formulation not found.</div>;

  if (!selected) {
    return (
      <main className="mx-auto w-full max-w-6xl p-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-text">Reference formulation review</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">Search the reference corpus across supplier, product family, commercial-product and canonical-chemistry candidates, function, dosage, process, and targets. Results are supplier-source evidence, not measured validation; candidate normalizations remain review-required.</p>
        </header>
        {error && <div role="alert" className="mb-4 rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error"><p>{error}</p><button type="button" onClick={() => void refresh()} className="mt-2 underline">Retry corpus load</button></div>}
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <label className="block text-sm font-medium text-text">Search corpus fields
            <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Supplier, product, chemical, function, 4%, process, pH…" className="mt-1 w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text" />
            <span className="mt-1 block text-xs text-muted">Searches source metadata and indexed, review-required formulation candidates, including amount, process, and target evidence.</span>
          </label>
          <label className="block text-sm font-medium text-text">Supplier
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text">
              <option key="all-suppliers" value="">All suppliers</option>
              {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
            </select>
          </label>
        </div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p role="status" className="text-xs text-muted">Showing {filteredRecords.length} of {records.length} source records</p>
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2"><RotateCcw size={13} />Refresh corpus</button>
        </div>
        {records.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">No extracted reference formulations are available yet.</div>
        ) : filteredRecords.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">No source records match these filters. Search uses source and candidate text; it does not imply a validated product or chemical identity.</div>
        ) : <ul className="grid gap-3 md:grid-cols-2">{filteredRecords.map((record) => <ReferenceFormulationCorpusCard key={record.id} record={record} query={queryBySourceId.get(record.id)} />)}</ul>}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl p-6">
      <Link to="/reference-formulations" className="mb-4 inline-flex items-center gap-2 text-sm text-accent hover:underline"><ArrowLeft size={15} />All reference formulations</Link>
      <header className="mb-5 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <ClipboardCheck size={20} className="mt-1 text-accent" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-text">{selected.source.title}</h1>
            <p className="mt-1 text-sm text-muted">{selected.source.supplierId} · {selected.source.formulationCode ?? selected.code} · {selected.source.originalFilename} · acquisition {selected.source.acquisitionCode}</p>
            <p className="mt-2 break-all font-mono text-[11px] text-muted">Source SHA-256: {selected.sourceDocumentHash}</p>
          </div>
        </div>
        <p className="mt-4 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">Source snippets and page/cell coordinates are shown beside each extracted value. A decision records a review outcome only; the source snapshot, RawMaterial, and production formulas remain unchanged.</p>
      </header>
      {error && <p role="alert" className="mb-4 rounded-md border border-error/30 bg-error/5 p-3 text-sm text-error">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">{notice}</p>}
      {!actor && <p role="alert" className="mb-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-text">Sign in to record a named human review decision.</p>}
      <div className="mb-5 grid items-start gap-4 xl:grid-cols-2">
        <section aria-label="Source formulation PDF" className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-text">Source formulation PDF</h2>
          <p className="mb-3 break-all font-mono text-[10px] text-muted">{selected.source.originalFilename ?? selected.source.title} · SHA-256 {selected.sourceDocumentHash}</p>
          {sourcePdfError && <p role="alert" className="mb-2 text-xs text-error">{sourcePdfError}</p>}
          {sourcePage && sourcePdf?.sha256.toLowerCase() === selected.sourceDocumentHash.toLowerCase()
            ? <><SupplierSdsPdfPagePreview bytes={sourcePdf.bytes} pageNumber={sourcePage.pageNumber} lineNumber={1} documentLabel="Supplier formulation" /><p className="mt-2 whitespace-pre-wrap text-xs text-muted">{sourcePage.excerpt}</p></>
            : <p className="rounded bg-surface-2 p-3 text-xs text-muted">Select a cited extraction value to load its verified source PDF page here.</p>}
        </section>
        <FormulationExtractionOverview record={selected} reviewItems={items} onOpenPage={openSourcePage} />
      </div>
      <div className="mb-4 flex items-center justify-between text-sm text-muted">
        <span>{items.length} reviewable extraction fields</span>
        <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-text hover:bg-surface-2"><RotateCcw size={13} />Refresh</button>
      </div>
      {items.length === 0 ? <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">This source has no identity, ingredient, process, or target values to review.</p> : (
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
        <span className="mt-1 block text-xs text-muted">{record.source.supplierId} · {record.source.formulationCode ?? record.code} · {record.source.sourceProduct.tradeName ?? "Product not stated"}{record.source.sourceProduct.grade ? ` (${record.source.sourceProduct.grade})` : ""}</span>
        <span className="mt-2 block text-xs text-muted">{record.ingredientLines.length} ingredient lines · {record.procedureSteps.length} process steps · {record.targetCandidates.length} targets · {query ? `normalization v${query.normalizationVersion}` : "candidate index unavailable"}</span>
        <div className="mt-3 space-y-1.5 text-xs">
          <CorpusField label="Product family candidates" values={families} />
          <CorpusField label="Commercial product candidates" values={products} />
          <CorpusField label="Canonical chemistry candidates" values={chemistry} />
          <CorpusField label="Functions" values={functions} />
          <CorpusField label="Source dosages" values={amounts} />
          <CorpusField label="Process evidence" values={process} />
          <CorpusField label="Target evidence" values={targets} />
        </div>
        <div className="mt-3 border-t border-border pt-2 text-[10px] text-muted">
          <p>Source: {record.source.providerId} / {record.source.surfaceId} · {record.source.market} · {record.source.language} · revision {revisions.join(" / ") || "not stated"}</p>
          <p>Acquisition: {record.source.acquisitionCode} · {record.source.originalFilename}</p>
          <p className="mt-1 break-all font-mono">SHA-256 {record.sourceDocumentHash}</p>
          <p className="mt-1 break-all">Source evidence refs: {evidenceRefs.slice(0, 3).join(", ") || "open record for cited extraction details"}</p>
          <p className="mt-2 font-medium">Source evidence only · normalization candidates require review · not measured validation</p>
        </div>
      </Link>
    </li>
  );
}

function CorpusField({ label, values }: { label: string; values: string[] }) {
  return <p className="break-words"><span className="font-medium text-text">{label}:</span> <span className="text-muted">{values.join("; ") || "not stated or unresolved"}</span></p>;
}

function ReferenceFormulationNormalizationTrace({ data }: { data: ReferenceFormulationCorpusReviewData }) {
  return (
    <section aria-label="Normalization source trace" className="mt-8 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-text">Normalized lines and contribution evidence</h2>
      <p className="mb-5 mt-1 text-sm text-muted">Each candidate remains review-required. Source formulation lines and SDS Section 3 facts are linked by immutable record IDs and document hashes; SDS disclosure is not treated as a complete commercial composition.</p>
      {data.versions.length === 0 ? <p className="rounded border border-border bg-surface-2 p-4 text-sm text-muted">No normalization versions have been recorded for this source.</p> : (
        <div className="space-y-5">
          {data.versions.map(({ version, lines }) => <section key={version.id} aria-label={`Normalization version ${version.version}`} className="rounded-md border border-border p-4">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-text">Version {version.version} · {version.createdAt}</h3>
              <span className="font-mono text-[10px] text-muted">{version.id} · source {version.sourceDocumentHash}</span>
            </header>
            <div className="space-y-3">
              {lines.map(({ sourceLine, normalizedLine, contributions }) => <article key={sourceLine.id} aria-label={`Normalized source line ${sourceLine.id}`} className="rounded border border-border bg-surface-2 p-4">
                <h4 className="text-sm font-semibold text-text">Source line {sourceLine.orderIndex} · {sourceLine.id}</h4>
                <p className="mt-1 break-words text-sm text-text">{sourceLine.rawRow.join(" | ")}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted">{sourceLine.ingredientName?.evidence.pageNumber !== undefined ? `Page ${sourceLine.ingredientName.evidence.pageNumber} · block ${sourceLine.ingredientName.evidence.blockIndex} · ` : ""}{sourceLine.ingredientName?.evidence.excerpt ?? "Source-row evidence retained with the immutable formulation record."} · {data.source.sourceDocumentHash}</p>
                <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                  <div><span className="font-semibold text-text">Commercial product candidates:</span> <span className="text-muted">{normalizedLine.commercialProduct.candidateIds.join(", ") || "unresolved"} · review required</span></div>
                  <div><span className="font-semibold text-text">Canonical chemistry candidates:</span> <span className="text-muted">{normalizedLine.canonicalChemistry.candidateIds.join(", ") || "unresolved"} · review required</span></div>
                  <div><span className="font-semibold text-text">Supplier function:</span> <span className="text-muted">{normalizedLine.functionNormalization?.supplierFunction.originalValue ?? "not stated"}</span></div>
                  <div><span className="font-semibold text-text">Function candidates:</span> <span className="text-muted">{normalizedLine.functionNormalization?.canonicalFunction.candidateIds.join(", ") || "unresolved"} · review required</span></div>
                </div>
                {contributions.length === 0 ? <p className="mt-3 rounded border border-border p-3 text-xs text-muted">No component contribution has been recorded for this line in this normalization version.</p> : (
                  <div className="mt-3 space-y-2">
                    {contributions.map(({ contribution, sds }) => <section key={contribution.id} aria-label={`Component contribution ${contribution.id}`} className="rounded border border-border p-3">
                      <h5 className="text-xs font-semibold text-text">Component contribution · {contribution.id} · {contribution.status} · review required</h5>
                      <p className="mt-1 text-xs text-muted">Component chemistry candidates: {contribution.canonicalChemistry.candidateIds.join(", ") || "unresolved"} · review required</p>
                      <p className="mt-1 text-xs text-muted">Formula amount: {contribution.formulaAmount.originalValue ?? "unknown"} {contribution.formulaAmount.unit ?? ""} {contribution.formulaAmount.basis ?? ""} · source line {contribution.sourceFormulaLineId} · formula SHA-256 {contribution.sourceFormulaDocumentHash}</p>
                      <p className="mt-1 text-xs text-muted">Calculated contribution: {contribution.contributionPercentRange ? `${contribution.contributionPercentRange.lowerBound}–${contribution.contributionPercentRange.upperBound}% w/w` : "unknown"} · evidence refs: {[...contribution.formulaAmount.evidenceRefs, ...contribution.sourceSds.evidenceRefs].join(", ") || "none"}</p>
                      {!sds ? <p className="mt-2 rounded bg-surface-2 p-2 text-xs text-muted">SDS evidence missing; composition remains unknown. Reasons: {contribution.unknownReasons.join(", ") || "not supplied"}.</p> : (
                        <div className="mt-2 rounded bg-surface-2 p-3 text-xs text-muted">
                          <p><span className="font-semibold text-text">SDS:</span> {sds.acquisition.sourceProduct.tradeName ?? sds.acquisition.sourceProduct.supplierItemCode ?? sds.acquisition.originalFilename} · supplier {sds.acquisition.supplierId} · acquisition {sds.acquisition.code} · {sds.acquisition.revisionDate ?? sds.acquisition.sourceRevision ?? "revision not stated"}</p>
                          <p className="mt-1 break-all font-mono text-[10px]">Evidence {sds.evidence.code} · SDS SHA-256 {sds.acquisition.sha256} · Section 3 component {contribution.sourceSds.sourceComponentId ?? "not resolved"} · fact {contribution.sourceSds.sourceFactId ?? "not resolved"}</p>
                          <p className="mt-1">Disclosure: {contribution.sourceSds.disclosure ?? "unknown"} · source value: {contribution.sourceSds.originalValue ?? "not disclosed or not extracted"} · normalized fraction: {contribution.sourceSds.fractionRange ? `${contribution.sourceSds.fractionRange.lowerBound}–${contribution.sourceSds.fractionRange.upperBound}` : "unknown"}</p>
                          <p className="mt-1 break-words">Section 3 component: {sds.sourceComponent?.componentName?.rawValue ?? "name not disclosed"} · CAS {sds.sourceComponent?.casNumber?.rawValue ?? "not stated"} · EC {sds.sourceComponent?.ecNumber?.rawValue ?? "not stated"} · material number {sds.sourceComponent?.materialNumber?.rawValue ?? "not stated"} · cited evidence: {contribution.sourceSds.evidenceRefs.join(", ") || "none"}</p>
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
  const itemFor = (targetKey: string) => reviewItems.find((item) => item.targetKey === targetKey);
  const cite = (item: ReferenceFormulationReviewItem | undefined) => item?.pageNumber
    ? <button type="button" onClick={() => void onOpenPage(item.pageNumber!, item.evidenceExcerpt)} className="ml-2 text-[10px] text-accent underline">View PDF page {item.pageNumber}</button>
    : null;
  return (
    <section aria-label="Formulation extraction overview" className="max-h-[76vh] space-y-4 overflow-y-auto rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text">Extracted formulation evidence · review required</h2>
      <section aria-label="Extracted formula lines" className="rounded border border-border-faint p-3">
        <h3 className="mb-2 text-xs font-semibold text-text">Formula lines, functions, amounts and commercial products</h3>
        {record.ingredientLines.length === 0 ? <p className="text-xs text-muted">No ingredient lines were extracted.</p> : <div className="space-y-2">{record.ingredientLines.map((line) => {
          const match = record.productMatches.find((candidate) => candidate.ingredientLineId === line.id);
          const productItem = itemFor(`ingredient:${line.id}:supplierProductCode`)
            ?? itemFor(`ingredient:${line.id}:ingredientName`);
          return <article key={line.id} className="rounded border border-border-faint bg-surface-1 p-2">
            <p className="text-[10px] font-medium text-text">{line.orderIndex}. {line.ingredientName?.rawValue ?? line.inciOrChemicalName?.rawValue ?? line.supplierProductCode?.rawValue ?? "Ingredient name not stated"}</p>
            {line.rawRow.length > 0 && <p className="mt-1 break-words text-[10px] text-muted">Source row: {line.rawRow.join(" | ")}</p>}
            <div className="mt-2 grid gap-1 text-[10px] sm:grid-cols-2">
              <SourceValue label="Supplier-stated function" value={line.function?.rawValue ?? "Not stated"} citation={cite(itemFor(`ingredient:${line.id}:function`))} />
              <SourceValue label="Amount / unit / basis" value={[line.amount?.rawValue, line.unit?.rawValue, line.basis?.rawValue].filter(Boolean).join(" ") || (line.quantitySemantics === "q_s" ? "q.s. · source amount retained" : "Not stated")} citation={cite(itemFor(`ingredient:${line.id}:amount`))} />
              <SourceValue label="Phase / sequence" value={line.phase?.rawValue ?? String(line.orderIndex)} citation={cite(itemFor(`ingredient:${line.id}:phase`))} />
              <SourceValue label="Quantity semantics" value={line.quantitySemantics} />
            </div>
            <div className="mt-2 rounded border border-border-faint px-2 py-1.5">
              <p className="text-[10px] font-medium text-text">Commercial-product link candidates</p>
              <p className="mt-0.5 text-[10px] text-muted">{match ? `${match.resolution.replace(/_/gu, " ")} · ${match.autoLinked ? "auto-linked" : "not auto-linked"} · review required` : "No product match record"}</p>
              {match?.candidates.length ? <ul className="mt-1 space-y-1">{match.candidates.map((candidate) => <li key={candidate.commercialProductId} className="break-words text-[10px] text-muted"><code className="text-accent">{candidate.commercialProductId}</code> · {candidate.tier.replace(/_/gu, " ")} · {candidate.matchedOn.join(", ") || "identifier match"}{candidate.matchedValues.length ? ` · ${candidate.matchedValues.join(", ")}` : ""}{candidate.similarity !== undefined ? ` · similarity proposal ${(candidate.similarity * 100).toFixed(1)}%` : ""}</li>)}</ul>
                : <p className="mt-1 text-[10px] text-muted">No commercial product candidate; the source line remains unresolved.</p>}
              {cite(productItem)}
            </div>
          </article>;
        })}</div>}
      </section>
      <section aria-label="Extracted procedure" className="rounded border border-border-faint p-3">
        <h3 className="mb-2 text-xs font-semibold text-text">Procedure and stated conditions</h3>
        {record.procedureSteps.length === 0 ? <p className="text-xs text-muted">No procedure steps were extracted.</p> : <ol className="space-y-2">{record.procedureSteps.map((step) => <li key={step.id} className="rounded border border-border-faint bg-surface-1 p-2">
          <p className="text-[10px] font-medium text-text">{step.sequenceOrder}. {step.phase?.rawValue ? `${step.phase.rawValue} · ` : ""}{step.rawInstruction}</p>
          <p className="mt-1 text-[10px] text-muted">Actions: {step.actions.join(", ") || "not classified"} · Conditions: {step.conditions.map((condition) => `${condition.kind}: ${condition.rawValue}`).join("; ") || "not stated"}</p>
          {cite(itemFor(`procedure:${step.id}:instruction`))}
        </li>)}</ol>}
      </section>
      <section aria-label="Extracted formulation targets" className="rounded border border-border-faint p-3">
        <h3 className="mb-2 text-xs font-semibold text-text">Source-stated targets and reported results</h3>
        {record.targetCandidates.length === 0 ? <p className="text-xs text-muted">No target or result candidates were extracted.</p> : <ul className="space-y-2">{record.targetCandidates.map((target) => {
          const item = itemFor(`target:${target.id}`);
          return <li key={target.id} className="rounded border border-border-faint bg-surface-1 p-2">
            <p className="text-[10px] font-medium text-text">{target.rawPropertyLabel}: {target.rawValue}</p>
            <p className="mt-1 text-[10px] text-muted">{target.resultSemantics.replace(/_/gu, " ")} · {target.valueShape.replace(/_/gu, " ")}</p>
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
  const location = [item.pageNumber ? `Page ${item.pageNumber}` : undefined, item.rowIndex !== undefined ? `row ${item.rowIndex}` : undefined, item.cellIndex !== undefined ? `cell ${item.cellIndex}` : undefined]
    .filter(Boolean).join(" · ");

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div><h2 className="text-sm font-semibold capitalize text-text">{item.label}</h2><p className="text-[11px] text-muted">{item.targetType} · {item.fieldPath}</p></div>
        {review && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-text">{review.decision.replace(/_/g, " ")} · {review.reviewer.displayName}</span>}
      </header>
      <div className="grid md:grid-cols-2">
        <section className="border-b border-border p-4 md:border-b-0 md:border-r" aria-label="Source evidence">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Source evidence {location && `· ${location}`}</h3>
          <blockquote className="whitespace-pre-wrap break-words rounded bg-surface-2 p-3 text-sm text-text">{item.evidenceExcerpt || "No source excerpt was retained."}</blockquote>
          {item.sourceKind && <p className="mt-2 text-[11px] text-muted">{item.sourceKind}{item.confidence !== undefined ? ` · ${(item.confidence * 100).toFixed(0)}% extraction confidence` : ""}</p>}
          {item.pageNumber !== undefined && <button type="button" onClick={() => void onOpenSourcePage(item.pageNumber!, item.evidenceExcerpt)} className="mt-2 text-[11px] text-accent underline">View source PDF page {item.pageNumber}</button>}
        </section>
        <section className="p-4" aria-label="Extracted value">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Extracted value</h3>
          <p className="mb-3 whitespace-pre-wrap break-words rounded border border-border p-3 text-sm text-text">{item.sourceValue || "(empty)"}</p>
          <label className="mb-2 block text-xs text-muted">Review decision
            <select value={decision} onChange={(event) => setDecision(event.target.value as Decision)} disabled={disabled || saving} className="mt-1 block w-full rounded border border-border bg-surface px-2 py-2 text-sm text-text">
              {DECISIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {decision === "edited" && <label className="mb-2 block text-xs text-muted">Proposed reviewed value
            <input value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled || saving} className="mt-1 block w-full rounded border border-border bg-surface px-2 py-2 text-sm text-text" />
          </label>}
          <label className="mb-3 block text-xs text-muted">Review note (optional)
            <input value={note} onChange={(event) => setNote(event.target.value)} disabled={disabled || saving} maxLength={2000} className="mt-1 block w-full rounded border border-border bg-surface px-2 py-2 text-sm text-text" />
          </label>
          <button type="button" onClick={() => void submit()} disabled={disabled || saving || (decision === "edited" && !value.trim())} className="rounded bg-accent px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Saving…" : "Save review decision"}
          </button>
          {review && <p className="mt-2 text-[11px] text-muted">Previous decision retained · {new Date(review.reviewedAt).toLocaleString()}</p>}
        </section>
      </div>
    </article>
  );
}
