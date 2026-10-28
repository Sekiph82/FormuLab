import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  can,
  classifyCommercialProductType,
  createRawMaterialApplicationProposal,
  previewRawMaterialApplicationProposal,
  supplierDocumentAcquisitionSchema,
  supplierSdsProductEvidenceRecordSchema,
  identityFieldReviewSchema,
  getDataExchangeTemplate,
  normalizeCasIdentifier,
  normalizeEcIdentifier,
  supplierProductEvidenceRecordSchema,
  type IdentityFieldReview,
  type RawMaterial,
  type ApprovalRole,
  type SupplierDocumentAcquisition,
  type SupplierProductCardVersion,
  type SupplierProductDocumentEvidence,
  type SupplierProductEvidenceRecord,
  type SupplierProductClaimEvidence,
  type SupplierSdsProductEvidenceRecord,
} from "@formulab/shared";
import { appendIdentityFieldReviewRecord, listRecords, readSupplierDocumentPdf } from "@/lib/masterdata";
import { SupplierSdsPdfPagePreview } from "./SupplierSdsPdfPagePreview";
import { DataExchangeImportDialog } from "../DataExchangeImportDialog";
import { Badge, Card } from "./ui";

type Citation = { pageNumber: number; lineNumber: number; excerpt: string };
type ProductCitation = SupplierProductClaimEvidence["evidence"][number];
type ProductCardView = { latest: SupplierProductCardVersion; versions: SupplierProductCardVersion[]; documents: SupplierProductDocumentEvidence[] };
const RAW_MATERIALS_TEMPLATE_KEY = "raw_materials";
const REVIEWABLE_IDENTIFIER_FIELDS = ["casNumber", "ecNumber"] as const;
const RAW_MATERIAL_IDENTIFIER_FIELDS = { casNumber: "casNumbers", ecNumber: "ecNumbers" } as const;

export function SupplierCommercialProductResolverScreen({ actorUserId, actorRole }: { actorUserId: string; actorRole: ApprovalRole }) {
  const { t } = useTranslation("session");
  const [documents, setDocuments] = useState<SupplierDocumentAcquisition[]>([]);
  const [productDocumentAcquisitions, setProductDocumentAcquisitions] = useState<SupplierDocumentAcquisition[]>([]);
  const [evidenceRecords, setEvidenceRecords] = useState<SupplierSdsProductEvidenceRecord[]>([]);
  const [productEvidenceRecords, setProductEvidenceRecords] = useState<SupplierProductEvidenceRecord[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [identityReviews, setIdentityReviews] = useState<IdentityFieldReview[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [selectedMaterialCode, setSelectedMaterialCode] = useState("");
  const [reviewError, setReviewError] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ sha256: string; bytes: Uint8Array } | null>(null);
  const pdfReadToken = useRef(0);
  const productPdfReadToken = useRef(0);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [pdfError, setPdfError] = useState(false);
  const [proposalImport, setProposalImport] = useState<{ file: File; lineage: { applicationProposalId: string; acceptedReviewId: string; sourceEvidenceId: string; sourceEvidenceRefs: string[] } } | null>(null);
  const [selectedProductCardId, setSelectedProductCardId] = useState("");
  const [productCitation, setProductCitation] = useState<ProductCitation | null>(null);
  const [productPdfPreview, setProductPdfPreview] = useState<{ sha256: string; bytes: Uint8Array } | null>(null);
  const [productPdfError, setProductPdfError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    pdfReadToken.current += 1;
    productPdfReadToken.current += 1;
    setPdfPreview(null);
    setCitation(null);
    setPdfError(false);
    try {
      const [documentRows, evidenceRows, productEvidenceRows] = await Promise.all([
        listRecords("supplier_document_acquisitions"),
        listRecords("supplier_sds_product_evidence"),
        listRecords("supplier_product_evidence"),
      ]);
      const [materialRows, reviewRows] = await Promise.all([
        listRecords("materials"),
        listRecords("identity_field_reviews"),
      ]);
      const sdsDocuments = documentRows.map((row) => supplierDocumentAcquisitionSchema.parse(row))
        .filter((document) => document.documentType === "SDS")
        .sort((left, right) => right.acquiredAt.localeCompare(left.acquiredAt));
      const allDocuments = documentRows.map((row) => supplierDocumentAcquisitionSchema.parse(row));
      setDocuments(sdsDocuments);
      setProductDocumentAcquisitions(allDocuments);
      setEvidenceRecords(evidenceRows.map((row) => supplierSdsProductEvidenceRecordSchema.parse(row)));
      setProductEvidenceRecords(productEvidenceRows.map((row) => supplierProductEvidenceRecordSchema.parse(row)));
      setMaterials(materialRows);
      setIdentityReviews(reviewRows.map((row) => identityFieldReviewSchema.parse(row)));
      setSelectedMaterialCode((current) => materialRows.some((material) => material.code === current) ? current : materialRows[0]?.code ?? "");
      setSelectedCode((current) => sdsDocuments.some((document) => document.code === current) ? current : sdsDocuments[0]?.code ?? "");
      const parsedProductRecords = productEvidenceRows.map((row) => supplierProductEvidenceRecordSchema.parse(row));
      const cardIds = new Set(parsedProductRecords.filter((row): row is SupplierProductCardVersion => row.recordType === "card_version").map((row) => row.productCardId));
      setSelectedProductCardId((current) => cardIds.has(current) ? current : [...cardIds][0] ?? "");
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
  const selectedMaterial = materials.find((material) => material.code === selectedMaterialCode);
  const productCards = useMemo<ProductCardView[]>(() => {
    const documentsById = new Map(productEvidenceRecords.filter((row): row is SupplierProductDocumentEvidence => row.recordType === "document").map((row) => [row.id, row]));
    const versionsByCard = new Map<string, SupplierProductCardVersion[]>();
    for (const row of productEvidenceRecords) if (row.recordType === "card_version") versionsByCard.set(row.productCardId, [...(versionsByCard.get(row.productCardId) ?? []), row]);
    return [...versionsByCard.values()].map((versions) => {
      versions.sort((left, right) => left.version - right.version);
      const latest = versions[versions.length - 1]!;
      return { latest, versions, documents: latest.evidenceRecordIds.map((id) => documentsById.get(id)).filter((row): row is SupplierProductDocumentEvidence => Boolean(row)) };
    }).sort((left, right) => (left.latest.tradeName ?? left.latest.supplierItemCode ?? "").localeCompare(right.latest.tradeName ?? right.latest.supplierItemCode ?? ""));
  }, [productEvidenceRecords]);
  const selectedProductCard = productCards.find((card) => card.latest.productCardId === selectedProductCardId);
  const acceptedIdentityReviews = identityReviews.filter((review) => review.decision === "accepted"
    && review.sourceEvidenceId === evidenceRecord?.evidence.id
    && review.commercialProductId === evidenceRecord?.evidence.commercialProductId
    && review.targetRecordId === selectedMaterial?.code);

  const reviewIdentityField = async (sourceField: "casNumber" | "ecNumber", targetField: "casNumbers" | "ecNumbers") => {
    if (!evidenceRecord || !selectedMaterial || !isNamedAuthorizedReviewer(actorUserId, actorRole)) return;
    const fact = evidenceRecord.evidence.section1[sourceField];
    if (!fact) return;
    setReviewSaving(true);
    setReviewError(false);
    try {
      const review = await appendIdentityFieldReviewRecord({
        schemaVersion: "1.0",
        id: `identity-review:${crypto.randomUUID()}`,
        commercialProductId: evidenceRecord.evidence.commercialProductId,
        sourceEvidenceId: evidenceRecord.evidence.id,
        targetRecordId: selectedMaterial.code,
        field: "canonical_identity",
        decision: "accepted",
        proposedValueSnapshot: JSON.stringify({ [targetField]: [fact.rawValue] }),
        evidenceRefs: fact.evidenceRefs,
      });
      setIdentityReviews((current) => [...current, identityFieldReviewSchema.parse(review)]);
    } catch {
      setReviewError(true);
    } finally {
      setReviewSaving(false);
    }
  };

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

  const openProductCitation = async (source: ProductCitation) => {
    const sourceDocument = selectedProductCard?.documents.find((item) => item.documentHash.toLowerCase() === source.documentHash.toLowerCase());
    if (!sourceDocument) { setProductPdfError(true); return; }
    setProductPdfError(false);
    setProductCitation(source);
    if (productPdfPreview?.sha256.toLowerCase() === source.documentHash.toLowerCase()) return;
    const requestToken = ++productPdfReadToken.current;
    try {
      const bytes = await readSupplierDocumentPdf(source.documentHash);
      if (requestToken !== productPdfReadToken.current) return;
      setProductPdfPreview({ sha256: source.documentHash, bytes });
    } catch {
      if (requestToken === productPdfReadToken.current) setProductPdfError(true);
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
      {!loading && !loadFailed && <SupplierProductCardMaterialComparison
        cards={productCards}
        acquisitions={productDocumentAcquisitions}
        materials={materials}
        selectedMaterial={selectedMaterial}
        selectedMaterialCode={selectedMaterialCode}
        selectedCardId={selectedProductCardId}
        onSelectMaterial={setSelectedMaterialCode}
        onSelectCard={(id) => { productPdfReadToken.current += 1; setSelectedProductCardId(id); setProductCitation(null); setProductPdfPreview(null); setProductPdfError(false); }}
        onOpenCitation={openProductCitation}
      />}
      {productCitation && productPdfPreview?.sha256.toLowerCase() === productCitation.documentHash.toLowerCase() && <SupplierSdsPdfPagePreview bytes={productPdfPreview.bytes} pageNumber={productCitation.pageNumber} lineNumber={productCitation.lineNumber ?? 1} />}
      {productPdfError && <p role="alert" className="text-[10px] text-error">{t("dataExchange.connectors.productResolver.productCardCompare.pdfError")}</p>}
      {!loading && !loadFailed && documents.length === 0 && <p className="text-[11px] text-muted">{t("dataExchange.connectors.productResolver.empty")}</p>}
      {!loadFailed && documents.length > 0 && (
        <label className="mb-3 block text-[10px] text-muted">
          <span className="mb-1 block">{t("dataExchange.connectors.productResolver.select")}</span>
          <select aria-label={t("dataExchange.connectors.productResolver.select")} value={selectedCode} onChange={(event) => { pdfReadToken.current += 1; setSelectedCode(event.target.value); setPdfPreview(null); setCitation(null); setPdfError(false); }} className="w-full rounded-input border border-border bg-surface-1 px-2 py-1.5 text-text">
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
          {evidenceRecord && (
            <RawMaterialProposalPanel
              evidence={evidenceRecord}
              materials={materials}
              selectedMaterial={selectedMaterial}
              selectedMaterialCode={selectedMaterialCode}
              actorUserId={actorUserId}
              actorRole={actorRole}
              reviews={acceptedIdentityReviews}
              onSelectMaterial={setSelectedMaterialCode}
              onReview={reviewIdentityField}
              reviewSaving={reviewSaving}
              reviewError={reviewError}
              onOpenCitation={openCitation}
              onImportProposal={(proposal, review) => {
                const file = proposalCsvFile(proposal.dataExchangeRow!);
                setProposalImport({ file, lineage: {
                  applicationProposalId: proposal.id,
                  acceptedReviewId: review.id,
                  sourceEvidenceId: review.sourceEvidenceId,
                  sourceEvidenceRefs: review.evidenceRefs,
                } });
              }}
            />
          )}
          {citation && pdfPreview?.sha256.toLowerCase() === document.sha256.toLowerCase() && <SupplierSdsPdfPagePreview bytes={pdfPreview.bytes} pageNumber={citation.pageNumber} lineNumber={citation.lineNumber} />}
          {pdfError && <p role="alert" className="text-[10px] text-error">{t("dataExchange.connectors.productResolver.pdfError")}</p>}
          <p className="rounded-input border border-border-faint p-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.readOnly")}</p>
        </div>
      )}
      {proposalImport && evidenceRecord && <DataExchangeImportDialog
        template={getDataExchangeTemplate(RAW_MATERIALS_TEMPLATE_KEY)!}
        actorRole={actorRole}
        actorUserId={actorUserId}
        initialFile={proposalImport.file}
        proposalLineage={proposalImport.lineage}
        onCancel={() => setProposalImport(null)}
        onCommitted={() => {}}
      />}
    </Card>
  );
}

function SupplierProductCardMaterialComparison({ cards, acquisitions, materials, selectedMaterial, selectedMaterialCode, selectedCardId, onSelectMaterial, onSelectCard, onOpenCitation }: {
  cards: ProductCardView[];
  acquisitions: SupplierDocumentAcquisition[];
  materials: RawMaterial[];
  selectedMaterial?: RawMaterial;
  selectedMaterialCode: string;
  selectedCardId: string;
  onSelectMaterial: (code: string) => void;
  onSelectCard: (id: string) => void;
  onOpenCitation: (source: ProductCitation) => void;
}) {
  const { t } = useTranslation("session");
  const [materialSearch, setMaterialSearch] = useState("");
  const card = cards.find((item) => item.latest.productCardId === selectedCardId);
  const acquisitionByCode = new Map(acquisitions.map((item) => [item.code, item]));
  const documentClaims = card?.documents.flatMap((evidence) => {
    const candidate = acquisitionByCode.get(evidence.acquisitionCode);
    const acquisitionMismatch = Boolean(candidate && candidate.sha256.toLowerCase() !== evidence.documentHash.toLowerCase());
    const acquisition = acquisitionMismatch ? undefined : candidate;
    return evidence.claims.map((claim) => ({ evidence, acquisition, acquisitionMismatch, claim }));
  }) ?? [];
  const matchableClaims = documentClaims.filter((item) => !item.acquisitionMismatch).map((item) => item.claim);
  const productMatches = card ? exactProductMaterialMatches(card.latest, matchableClaims, materials) : [];
  const componentMatches = card ? exactComponentMaterialMatches(matchableClaims, materials) : [];
  const visibleMaterials = materials.filter((material) => `${material.code} ${material.displayName} ${material.tradeName ?? ""} ${material.inciName ?? ""}`.toLocaleLowerCase("en-US").includes(materialSearch.trim().toLocaleLowerCase("en-US")));
  const selectedMaterialOption = materials.find((material) => material.code === selectedMaterialCode);
  const materialOptions = selectedMaterialOption && !visibleMaterials.some((material) => material.code === selectedMaterialOption.code) ? [selectedMaterialOption, ...visibleMaterials] : visibleMaterials;

  return <section className="mb-4 rounded-input border border-border-faint p-3" aria-label={t("dataExchange.connectors.productResolver.productCardCompare.title")}>
    <h4 className="text-xs font-semibold text-text">{t("dataExchange.connectors.productResolver.productCardCompare.title")}</h4>
    <p className="mb-3 mt-1 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.intro")}</p>
    {cards.length === 0
      ? <p className="text-[10px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.empty")}</p>
      : <div className="space-y-3">
        <label className="block text-[10px] text-muted">
          <span className="mb-1 block">{t("dataExchange.connectors.productResolver.productCardCompare.product")}</span>
          <select aria-label={t("dataExchange.connectors.productResolver.productCardCompare.product")} value={selectedCardId} onChange={(event) => onSelectCard(event.target.value)} className="w-full rounded-input border border-border bg-surface-1 px-2 py-1.5 text-text">
            {cards.map((item) => <option key={item.latest.productCardId} value={item.latest.productCardId}>{t("dataExchange.connectors.productResolver.productCardCompare.cardOption", { supplier: item.latest.supplierName ?? item.latest.supplierId ?? t("dataExchange.connectors.productResolver.productCardCompare.unknownSupplier"), product: item.latest.tradeName ?? item.latest.supplierItemCode, version: item.latest.version })}</option>)}
          </select>
        </label>
        {card && <>
          <dl className="grid gap-2 text-[10px] sm:grid-cols-2 lg:grid-cols-4">
            <Fact label={t("dataExchange.connectors.productResolver.productCardCompare.identityStatus")} value={card.latest.identityStatus} />
            <Fact label={t("dataExchange.connectors.productResolver.productCardCompare.supplierCode")} value={card.latest.supplierItemCode ?? "—"} />
            <Fact label={t("dataExchange.connectors.productResolver.productCardCompare.gradeMarket")} value={`${card.latest.grade ?? "—"} · ${card.latest.market} / ${card.latest.language}`} />
            <Fact label={t("dataExchange.connectors.productResolver.productCardCompare.sources")} value={t("dataExchange.connectors.productResolver.productCardCompare.sourceCount", { documents: card.documents.length, versions: card.versions.length, conflicts: card.latest.conflicts.length })} />
          </dl>
          <label className="block text-[10px] text-muted">
            <span className="mb-1 block">{t("dataExchange.connectors.productResolver.productCardCompare.materialSearch")}</span>
            <input value={materialSearch} onChange={(event) => setMaterialSearch(event.target.value)} placeholder={t("dataExchange.connectors.productResolver.productCardCompare.materialSearchPlaceholder")} className="w-full rounded-input border border-border bg-surface-1 px-2 py-1.5 text-text" />
          </label>
          <label className="block text-[10px] text-muted">
            <span className="mb-1 block">{t("dataExchange.connectors.productResolver.productCardCompare.material")}</span>
            <select aria-label={t("dataExchange.connectors.productResolver.productCardCompare.material")} value={selectedMaterialCode} onChange={(event) => onSelectMaterial(event.target.value)} className="w-full rounded-input border border-border bg-surface-1 px-2 py-1.5 text-text">
              <option value="">{t("dataExchange.connectors.productResolver.productCardCompare.noMaterial")}</option>
              {materialOptions.map((material) => <option key={material.code} value={material.code}>{material.code} · {material.displayName}</option>)}
            </select>
          </label>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded border border-border-faint p-2">
              <h5 className="text-[10px] font-semibold text-text">{t("dataExchange.connectors.productResolver.productCardCompare.exactProductCandidates")}</h5>
              <p className="mt-1 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.exactMatchOnly")}</p>
              {productMatches.length === 0
                ? <p className="mt-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.noExactProductCandidates")}</p>
                : <ul className="mt-2 space-y-1">{productMatches.map((match) => <li key={match.material.code} className="rounded border border-border-faint px-2 py-1 text-[10px]"><strong className="text-text">{match.material.code} · {match.material.displayName}</strong><p className="text-muted">{match.reasons.join(" · ")}</p></li>)}</ul>}
            </div>
            <div className="rounded border border-border-faint p-2">
              <h5 className="text-[10px] font-semibold text-text">{t("dataExchange.connectors.productResolver.productCardCompare.exactComponentCandidates")}</h5>
              <p className="mt-1 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.componentCaution")}</p>
              {componentMatches.length === 0
                ? <p className="mt-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.noExactComponentCandidates")}</p>
                : <ul className="mt-2 space-y-1">{componentMatches.map((match, index) => <li key={`${match.material.code}:${index}`} className="rounded border border-border-faint px-2 py-1 text-[10px]"><strong className="text-text">{match.material.code} · {match.material.displayName}</strong><p className="text-muted">{match.reasons.join(" · ")}</p></li>)}</ul>}
            </div>
          </div>
          {card.latest.conflicts.length > 0 && <div role="status" className="rounded border border-warning/30 p-2 text-[10px] text-muted">
            <strong className="text-text">{t("dataExchange.connectors.productResolver.productCardCompare.conflicts", { count: card.latest.conflicts.length })}</strong>
            <ul className="mt-1 list-disc pl-4">{card.latest.conflicts.map((conflict) => <li key={`${conflict.fieldCode}:${conflict.claimIds.join(":")}`}>{conflict.fieldCode}: {conflict.claimIds.join(" · ")}</li>)}</ul>
          </div>}
          <div className="rounded border border-border-faint p-2">
            <h5 className="text-[10px] font-semibold text-text">{t("dataExchange.connectors.productResolver.productCardCompare.fieldComparison")}</h5>
            {!selectedMaterial && <p className="mt-1 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.selectMaterial")}</p>}
            {selectedMaterial && documentClaims.length === 0 && <p className="mt-1 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.noClaims")}</p>}
            {selectedMaterial && documentClaims.length > 0 && <div className="mt-2 space-y-2">{documentClaims.map(({ evidence, acquisition, acquisitionMismatch, claim }) => {
              const existing = rawMaterialValueForClaim(selectedMaterial, claim);
              const source = claim.evidence.filter((citation) => citation.documentHash.toLowerCase() === evidence.documentHash.toLowerCase());
              return <article key={`${evidence.id}:${claim.id}`} className="rounded border border-border-faint bg-surface-1 p-2">
                <div className="flex flex-wrap items-center gap-2"><Badge>{evidence.documentType}{claim.sectionNumber ? ` §${claim.sectionNumber}` : ""}</Badge><Badge>{t(`dataExchange.connectors.productResolver.productCardCompare.subject.${claim.subject}`)}</Badge><span className="text-[10px] font-medium text-text">{claim.fieldCode}</span><span className="text-[10px] text-muted">{acquisition ? acquisition.sourceRevision ?? acquisition.originalFilename : t(acquisitionMismatch ? "dataExchange.connectors.productResolver.productCardCompare.acquisitionHashMismatch" : "dataExchange.connectors.productResolver.productCardCompare.acquisitionMissing")}</span></div>
                <div className="mt-1 grid gap-1 text-[10px] sm:grid-cols-2">
                  <Fact label={t("dataExchange.connectors.productResolver.productCardCompare.sourceClaim")} value={`${claim.rawValue} · ${claim.qualifier} · ${claim.basis}`} />
                  <Fact label={t("dataExchange.connectors.productResolver.productCardCompare.selectedMaterial")} value={existing ?? t("dataExchange.connectors.productResolver.productCardCompare.notComparable")} />
                </div>
                <p className="mt-1 break-all text-[9px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.documentHash")}: {evidence.documentHash}</p>
                {(claim.context.testMethod || claim.context.temperature || claim.context.sampleConcentration || claim.context.conditions) && <p className="mt-1 break-words text-[10px] text-muted">{[claim.context.testMethod, claim.context.temperature, claim.context.sampleConcentration, claim.context.conditions].filter(Boolean).join(" · ")}</p>}
                <div className="mt-1 flex flex-wrap gap-2">{source.map((citation, index) => <button key={`${citation.pageNumber}:${citation.lineNumber ?? 0}:${index}`} type="button" onClick={() => onOpenCitation(citation)} className="text-[10px] text-accent underline">{t("dataExchange.connectors.productResolver.pageLink", { page: citation.pageNumber, line: citation.lineNumber ?? "—" })}</button>)}</div>
              </article>;
            })}</div>}
          </div>
          <p className="rounded border border-border-faint p-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.productCardCompare.noAutomaticChanges")}</p>
        </>}
      </div>}
  </section>;
}

function exactProductMaterialMatches(card: SupplierProductCardVersion, claims: SupplierProductClaimEvidence[], materials: RawMaterial[]): Array<{ material: RawMaterial; reasons: string[] }> {
  const productCas = claims.filter((claim) => claim.subject === "product" && claim.fieldCode === "product_cas").map((claim) => normalizeCasIdentifier(claim.rawValue)).filter((item) => item.ok).map((item) => item.normalizedValue);
  const productEc = claims.filter((claim) => claim.subject === "product" && claim.fieldCode === "product_ec").map((claim) => normalizeEcIdentifier(claim.rawValue)).filter((item) => item.ok).map((item) => item.normalizedValue);
  return materials.map((material) => {
    const reasons: string[] = [];
    const norm = normalizeIdentityForComparison;
    const materialCas = material.casNumbers.map((value) => normalizeCasIdentifier(value)).filter((item) => item.ok).map((item) => item.normalizedValue);
    const materialEc = material.ecNumbers.map((value) => normalizeEcIdentifier(value)).filter((item) => item.ok).map((item) => item.normalizedValue);
    if (card.supplierItemCode && norm(card.supplierItemCode) === norm(material.code)) reasons.push("Exact supplier item code / RawMaterial code");
    if (card.tradeName && [material.tradeName, material.displayName].some((value) => value && norm(value) === norm(card.tradeName!))) reasons.push("Exact trade name");
    if (card.grade && [material.tradeName, material.displayName].some((value) => value && norm(value) === norm(card.grade!))) reasons.push("Exact grade text");
    if (productCas.some((value) => materialCas.includes(value))) reasons.push("Exact Section 1 CAS");
    if (productEc.some((value) => materialEc.includes(value))) reasons.push("Exact Section 1 EC");
    const supplier = [card.supplierId, card.supplierName].filter((value): value is string => Boolean(value)).map(norm);
    if (material.manufacturer && supplier.includes(norm(material.manufacturer))) reasons.push("Exact supplier/manufacturer");
    return { material, reasons };
  }).filter((match) => match.reasons.some((reason) => reason !== "Exact supplier/manufacturer"));
}

function exactComponentMaterialMatches(claims: SupplierProductClaimEvidence[], materials: RawMaterial[]): Array<{ material: RawMaterial; reasons: string[] }> {
  const components = claims.filter((claim) => claim.subject === "disclosed_component" && ["disclosed_component_cas", "disclosed_component_ec"].includes(claim.fieldCode));
  return components.flatMap((claim) => {
    const normalized = claim.fieldCode.endsWith("_cas") ? normalizeCasIdentifier(claim.rawValue) : normalizeEcIdentifier(claim.rawValue);
    if (!normalized.ok) return [];
    return materials.flatMap((material) => {
      const identifiers = (claim.fieldCode.endsWith("_cas") ? material.casNumbers.map((value) => normalizeCasIdentifier(value)) : material.ecNumbers.map((value) => normalizeEcIdentifier(value))).filter((item) => item.ok).map((item) => item.normalizedValue);
      return identifiers.includes(normalized.normalizedValue) ? [{ material, reasons: [`Exact Section 3 ${claim.fieldCode.endsWith("_cas") ? "CAS" : "EC"} · disclosed component only`] }] : [];
    });
  });
}

function rawMaterialValueForClaim(material: RawMaterial, claim: SupplierProductClaimEvidence): string | undefined {
  const values: Record<string, string | undefined> = {
    product_cas: material.casNumbers.length ? material.casNumbers.join("; ") : undefined,
    product_ec: material.ecNumbers.length ? material.ecNumbers.join("; ") : undefined,
    product_identifier: [material.tradeName, material.displayName].filter(Boolean).join(" · ") || undefined,
    supplier_material_number: material.code,
    active_matter: material.activeMatterPercent,
    total_solids: material.solidsPercent,
    nonvolatile_content: material.solidsPercent,
    density: material.density,
    ph: [material.phMin, material.phMax].filter(Boolean).join("–") || undefined,
    viscosity: [material.viscosityMin, material.viscosityMax].filter(Boolean).join("–") || undefined,
    ionic_character: material.ionicCharacter,
    appearance: material.appearance,
    color: material.color,
    solubility: material.solubility,
    recommended_dosage: [material.recommendedMinPercent, material.recommendedMaxPercent].filter(Boolean).join("–") || undefined,
    storage_conditions: material.storageConditions,
    shelf_life: material.shelfLifeMonths ? `${material.shelfLifeMonths} months` : undefined,
    sds_shelf_life: material.shelfLifeMonths ? `${material.shelfLifeMonths} months` : undefined,
  };
  if (claim.subject !== "product") return undefined;
  return values[claim.fieldCode];
}

function normalizeIdentityForComparison(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
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

function isNamedAuthorizedReviewer(userId: string, role: ApprovalRole): boolean {
  return userId.trim().length > 0 && can(role, "rawMaterials", "edit");
}

function RawMaterialProposalPanel({
  evidence, materials, selectedMaterial, selectedMaterialCode, actorUserId, actorRole, reviews,
  onSelectMaterial, onReview, reviewSaving, reviewError,
  onOpenCitation,
  onImportProposal,
}: {
  evidence: SupplierSdsProductEvidenceRecord;
  materials: RawMaterial[];
  selectedMaterial?: RawMaterial;
  selectedMaterialCode: string;
  actorUserId: string;
  actorRole: ApprovalRole;
  reviews: IdentityFieldReview[];
  onSelectMaterial: (code: string) => void;
  onReview: (sourceField: "casNumber" | "ecNumber", targetField: "casNumbers" | "ecNumbers") => void;
  reviewSaving: boolean;
  reviewError: boolean;
  onOpenCitation: (reference: string, excerpt: string) => void;
  onImportProposal: (proposal: ReturnType<typeof createRawMaterialApplicationProposal>, review: IdentityFieldReview) => void;
}) {
  const { t } = useTranslation("session");
  const reviewByField = new Map<string, IdentityFieldReview>();
  for (const review of reviews) {
    const parsed = JSON.parse(review.proposedValueSnapshot) as Record<string, unknown>;
    if (typeof parsed.casNumbers !== "undefined") reviewByField.set("casNumbers", review);
    if (typeof parsed.ecNumbers !== "undefined") reviewByField.set("ecNumbers", review);
  }
  const mayReview = isNamedAuthorizedReviewer(actorUserId, actorRole);
  return <section className="rounded-input border border-border-faint p-3">
    <h4 className="mb-1 text-xs font-semibold text-text">{t("dataExchange.connectors.productResolver.rawMaterialProposals.title")}</h4>
    <p className="mb-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.rawMaterialProposals.intro")}</p>
    {materials.length === 0
      ? <p className="text-[10px] text-muted">{t("dataExchange.connectors.productResolver.rawMaterialProposals.noMaterials")}</p>
      : <label className="mb-3 block text-[10px] text-muted">
        <span className="mb-1 block">{t("dataExchange.connectors.productResolver.rawMaterialProposals.target")}</span>
        <select aria-label={t("dataExchange.connectors.productResolver.rawMaterialProposals.target")} value={selectedMaterialCode} onChange={(event) => onSelectMaterial(event.target.value)} className="w-full rounded-input border border-border bg-surface-1 px-2 py-1.5 text-text">
          {materials.map((material) => <option key={material.code} value={material.code}>{material.code} · {material.displayName}</option>)}
        </select>
      </label>}
    {selectedMaterial && <div className="space-y-2">
      {REVIEWABLE_IDENTIFIER_FIELDS.map((sourceField) => {
        const targetField = RAW_MATERIAL_IDENTIFIER_FIELDS[sourceField];
        const fact = evidence.evidence.section1[sourceField];
        const current = sourceField === "casNumber" ? selectedMaterial.casNumbers : selectedMaterial.ecNumbers;
        const review = reviewByField.get(targetField);
        return <article key={sourceField} className="grid gap-2 rounded border border-border-faint bg-surface-1 p-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <div><p className="text-[10px] text-muted">{t(`dataExchange.connectors.productResolver.rawMaterialProposals.${sourceField}`)}</p><p className="break-all text-[11px] font-medium text-text">{fact?.rawValue ?? t("dataExchange.connectors.productResolver.notReported")}</p></div>
          <div><p className="text-[10px] text-muted">{t("dataExchange.connectors.productResolver.rawMaterialProposals.currentValue")}</p><p className="break-all text-[11px] font-medium text-text">{current.length ? current.join("; ") : t("dataExchange.connectors.productResolver.rawMaterialProposals.emptyValue")}</p></div>
          {fact && <button type="button" disabled={!mayReview || reviewSaving || Boolean(review) || !evidenceMatchesHash(fact, evidence)} onClick={() => onReview(sourceField, targetField)} className="rounded-input border border-border px-2 py-1 text-[10px] text-text disabled:opacity-50">
            {review ? t("dataExchange.connectors.productResolver.rawMaterialProposals.accepted") : t("dataExchange.connectors.productResolver.rawMaterialProposals.acceptField")}
          </button>}
        </article>;
      })}
    </div>}
    {!mayReview && <p className="mt-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.rawMaterialProposals.authorizationRequired")}</p>}
    {reviewError && <p role="alert" className="mt-2 text-[10px] text-error">{t("dataExchange.connectors.productResolver.rawMaterialProposals.reviewError")}</p>}
    {selectedMaterial && reviews.length > 0 && <div className="mt-3 space-y-2">
      <h5 className="text-[10px] font-semibold text-text">{t("dataExchange.connectors.productResolver.rawMaterialProposals.proposalTitle")}</h5>
      {reviews.map((review) => {
        const proposal = createRawMaterialApplicationProposal({ target: selectedMaterial, review });
        const preview = previewRawMaterialApplicationProposal({ proposal, currentTarget: selectedMaterial, acceptedReview: review, actorRole });
        return <article key={review.id} className="rounded border border-border-faint p-2">
          <div className="grid gap-1 text-[10px] sm:grid-cols-3">
            <Fact label={t("dataExchange.connectors.productResolver.rawMaterialProposals.field")} value={reviewFieldName(review)} />
            <Fact label={t("dataExchange.connectors.productResolver.rawMaterialProposals.proposedValue")} value={proposedIdentityValue(review)} />
            <Fact label={t("dataExchange.connectors.productResolver.rawMaterialProposals.status")} value={t(`dataExchange.connectors.productResolver.rawMaterialProposals.${preview.status}`)} />
          </div>
          {proposal.reasonCodes.length > 0 && <p className="mt-1 break-words text-[10px] text-muted">{proposal.reasonCodes.join(" · ")}</p>}
          <EvidenceLinks references={review.evidenceRefs} excerpt={t("dataExchange.connectors.productResolver.rawMaterialProposals.sourceEvidence")} onOpen={onOpenCitation} />
          {preview.preview && <>
            <p className="mt-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.rawMaterialProposals.dataExchangeRows", { count: preview.preview.rows.length })}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => onImportProposal(proposal, review)} className="rounded-input border border-accent px-2 py-1 text-[10px] text-accent">{t("dataExchange.connectors.productResolver.rawMaterialProposals.reviewAndApply")}</button>
              <button type="button" onClick={() => downloadProposalCsv(proposal.dataExchangeRow!, t("dataExchange.connectors.productResolver.rawMaterialProposals.downloadCsv"))} className="rounded-input border border-border px-2 py-1 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.rawMaterialProposals.downloadCsv")}</button>
            </div>
          </>}
          <p className="mt-2 text-[10px] text-muted">{t("dataExchange.connectors.productResolver.rawMaterialProposals.applyGate")}</p>
        </article>;
      })}
    </div>}
  </section>;
}

function evidenceMatchesHash(fact: { evidenceRefs: string[] }, evidence: SupplierSdsProductEvidenceRecord): boolean {
  return evidence.evidence.section1.sourceDocumentHash.toLowerCase() === evidence.evidence.section3.sourceDocumentHash.toLowerCase()
    && fact.evidenceRefs.length > 0;
}

function reviewFieldName(review: IdentityFieldReview): string {
  const value = JSON.parse(review.proposedValueSnapshot) as Record<string, unknown>;
  return "casNumbers" in value ? "CAS" : "EC";
}

function proposedIdentityValue(review: IdentityFieldReview): string {
  const value = JSON.parse(review.proposedValueSnapshot) as Record<string, unknown>;
  const item = value.casNumbers ?? value.ecNumbers;
  return Array.isArray(item) ? item.join("; ") : "—";
}

function proposalCsvFile(row: Record<string, string>): File {
  const headers = Object.keys(row);
  const csv = [headers, headers.map((header) => row[header])]
    .map((values) => values.map((value) => `"${String(value).replace(/"/gu, '""')}"`).join(","))
    .join("\r\n");
  return new File([`\uFEFF${csv}`], `raw-material-proposal-${Date.now()}.csv`, { type: "text/csv;charset=utf-8" });
}

function downloadProposalCsv(row: Record<string, string>, label: string): void {
  const file = proposalCsvFile(row);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.setAttribute("aria-label", label);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
