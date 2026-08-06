/**
 * Phase 4 — Claims & Label Review workspace. First-class `/claims-labels`
 * route (never a Formula Builder tab). A claim and a label are each always
 * bound to a real, saved formula version, an explicit jurisdiction, and
 * (for labels) an explicit language — never a working draft. See
 * engine/claims.ts, engine/labels.ts, docs/PRODUCT_CLAIMS.md,
 * docs/PRODUCT_LABELS.md.
 *
 * Compliance-assistance only: nothing here ever asserts legal compliance.
 * A claim's derived status/risk and a label's readiness are always
 * advisory — only a recorded `ClaimReview`/`LabelReview` from an authorized
 * regulatory actor changes the persisted record, and "unknown"/human-
 * review-required findings never silently resolve to "supported"/"ready".
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ClipboardCheck, History, Plus, ShieldAlert, Tags, Upload } from "lucide-react";
import {
  APPROVAL_ROLES,
  CLAIM_CATEGORIES,
  CLAIM_REVIEW_OUTCOMES,
  LABEL_CONTENT_BLOCK_TYPES,
  CLAIM_RISK_LEVELS,
  CLAIM_STATUSES,
  LABEL_REVIEW_OUTCOMES,
  LABEL_STATUSES,
  LABEL_UI_LANGUAGES,
  REGULATORY_JURISDICTIONS,
  SEED_REGULATORY_RULES,
  acceptClaimEvidenceLink,
  activeLinksForClaim,
  approveArtwork,
  calculateClaimsReadiness,
  calculateLabelReadiness,
  createClaim,
  createLabel,
  currentContentForRevision,
  deriveArtworkEffectiveStatus,
  deriveClaimEffectiveStatus,
  deriveClaimRisk,
  deriveClaimStatus,
  deriveLabelEffectiveStatus,
  evaluateArtworkReadiness,
  evaluateClaimAgainstRules,
  evaluateClaimEvidence,
  evaluateClaimEvidenceEligibility,
  evaluateClaimLabelConsistency,
  evaluateFormulaLabelConsistency,
  evaluateLabelContent,
  findClaimConflicts,
  isAuthorizedRegulatoryActor,
  isClaimImmutable,
  isClaimReviewActive,
  isLabelImmutable,
  isLabelReviewActive,
  newId,
  recordClaimReview,
  recordLabelReview,
  rejectArtwork,
  rejectClaimEvidenceLink,
  replaceArtwork,
  resolveLabelRequirements,
  reviseClaim,
  reviseLabel,
  revokeClaimEvidenceLink,
  revokeClaimReview,
  revokeLabelReview,
  setLabelContent,
  parseCsv,
  proposeClaimEvidenceLink,
  toCsv,
  updateClaimStatus,
  updateLabelStatus,
  uploadArtwork,
  type Actor,
  type ApprovalRole,
  type AuditEvent,
  type ClaimCategory,
  type ClaimEvidenceLink,
  type ClaimReview,
  type ClaimReviewRevocation,
  type ClaimStatus,
  type ConsistencyFinding,
  type Formulation,
  type FormulationVersion,
  type LabelArtwork,
  type LabelContentBlock,
  type LabelContentBlockType,
  type LabelReview,
  type LabelReviewRevocation,
  type LabelStatus,
  type ProductClaim,
  type ProductLabel,
  type RegulatoryDossier,
  type RegulatoryDossierEvidenceItem,
  type RegulatoryJurisdiction,
  type RegulatoryRule,
} from "@formulab/shared";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { appendAudit, auditEvent } from "@/lib/formulations";
import { cn } from "@/lib/cn";
import { AttachmentField } from "./AttachmentField";
import { buildXlsxBlob } from "@/lib/xlsx";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

const TOP_SECTIONS = ["claims", "labels", "history", "audit"] as const;
type TopSection = (typeof TOP_SECTIONS)[number];

const CLAIM_DETAIL_SECTIONS = ["overview", "evidence", "reviews"] as const;
type ClaimDetailSection = (typeof CLAIM_DETAIL_SECTIONS)[number];

const LABEL_DETAIL_SECTIONS = ["overview", "content", "artwork", "reviews", "consistency"] as const;
type LabelDetailSection = (typeof LABEL_DETAIL_SECTIONS)[number];

/** Displayed via {eligibility.reason} only when the evidence record behind
 *  a claim evidence link has vanished from the dossier evidence list — not
 *  a real `evaluateClaimEvidenceEligibility` reason code, so a distinct,
 *  clearly-not-a-rule-code constant avoids colliding with those. */
const EVIDENCE_RECORD_MISSING = "evidence_record_missing";

const CLAIM_STATUS_STYLE: Record<string, string> = {
  draft: "bg-surface-2 text-muted",
  proposed: "bg-surface-2 text-muted",
  under_review: "bg-accent/10 text-accent",
  supported: "bg-success/10 text-success",
  supported_with_conditions: "bg-success/10 text-success",
  restricted: "bg-warn/10 text-warn",
  prohibited: "bg-error/10 text-error",
  rejected: "bg-error/10 text-error",
  withdrawn: "bg-surface-2 text-muted",
  superseded: "bg-surface-2 text-muted",
  unknown: "bg-error/10 text-error",
};

const RISK_STYLE: Record<string, string> = {
  low: "bg-success/10 text-success",
  medium: "bg-warn/10 text-warn",
  high: "bg-error/10 text-error",
  critical: "bg-error/10 text-error",
  unknown: "bg-error/10 text-error",
};

const READINESS_STYLE: Record<string, string> = {
  not_ready: "bg-error/10 text-error",
  partially_ready: "bg-warn/10 text-warn",
  ready_for_review: "bg-success/10 text-success",
  under_review: "bg-accent/10 text-accent",
  review_complete: "bg-success/10 text-success",
  blocked: "bg-error/10 text-error",
  unknown: "bg-error/10 text-error",
};

const LABEL_STATUS_STYLE: Record<string, string> = {
  draft: "bg-surface-2 text-muted",
  content_in_progress: "bg-surface-2 text-muted",
  under_review: "bg-accent/10 text-accent",
  changes_requested: "bg-warn/10 text-warn",
  review_complete: "bg-success/10 text-success",
  approved_for_artwork: "bg-success/10 text-success",
  artwork_in_progress: "bg-surface-2 text-muted",
  approved: "bg-success/10 text-success",
  rejected: "bg-error/10 text-error",
  superseded: "bg-surface-2 text-muted",
};

/** Groups the 26 content block types into the coherent editor sections the
 *  spec asks for (Front/Back/Side panel, Ingredients, Directions, Warnings,
 *  Claims, Manufacturer, Codes/identifiers) — never a free-form rich-text
 *  editor, always one bounded field per real block type. */
const CONTENT_GROUPS: { key: string; blockTypes: LabelContentBlockType[] }[] = [
  { key: "frontBackSide", blockTypes: ["product_name", "product_description", "net_quantity", "barcode"] },
  { key: "ingredients", blockTypes: ["ingredients", "inci"] },
  { key: "directions", blockTypes: ["directions", "storage", "disposal"] },
  { key: "warnings", blockTypes: ["warnings", "precautions", "first_aid"] },
  { key: "claims", blockTypes: ["claims"] },
  { key: "manufacturer", blockTypes: ["manufacturer", "responsible_party", "country_of_origin", "contact_information", "website"] },
  { key: "codes", blockTypes: ["batch_code", "manufacture_date", "expiry_date", "best_before", "registration_number", "certification_mark", "recycling", "other"] },
];

const IMPORT_FORMATS = ["json", "csv", "excel"] as const;
const CLAIM_EXPORT_HEADERS = ["claimCode", "claimText", "claimCategory", "formulaVersionId", "packagingSkuCode", "jurisdictions", "languages", "status", "riskLevel"];
const CLAIM_IMPORT_HEADERS = ["claimCode", "claimText", "claimCategory", "jurisdictions", "languages"];
const CLAIM_REVIEW_SUMMARY_HEADERS = ["claimCode", "claimText", "status", "riskLevel", "reviewOutcome", "reviewedBy", "reviewedAt"];
const LABEL_CONTENT_EXPORT_HEADERS = ["blockType", "text", "language", "mandatory"];
const LABEL_READINESS_SUMMARY_HEADERS = ["labelCode", "jurisdiction", "language", "status", "overallReadiness", "missingRequirements", "artworkStatus"];

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ClaimsLabelsPanel({
  formulation,
  versions,
  auditLog,
  initialVersionId,
  initialJurisdiction,
  initialPackagingSkuCode,
  initialClaimId,
  initialLabelId,
  onAuditChanged,
}: {
  formulation: Formulation;
  versions: FormulationVersion[];
  auditLog: AuditEvent[];
  initialVersionId?: string;
  initialJurisdiction?: RegulatoryJurisdiction;
  initialPackagingSkuCode?: string;
  initialClaimId?: string;
  initialLabelId?: string;
  onAuditChanged: () => Promise<void>;
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;

  const [rules, setRules] = useState<RegulatoryRule[]>(SEED_REGULATORY_RULES);
  const [dossiers, setDossiers] = useState<RegulatoryDossier[]>([]);
  const [dossierEvidence, setDossierEvidence] = useState<RegulatoryDossierEvidenceItem[]>([]);
  const [claims, setClaims] = useState<ProductClaim[]>([]);
  const [claimLinks, setClaimLinks] = useState<ClaimEvidenceLink[]>([]);
  const [claimReviews, setClaimReviews] = useState<ClaimReview[]>([]);
  const [claimReviewRevocations, setClaimReviewRevocations] = useState<ClaimReviewRevocation[]>([]);
  const [labels, setLabels] = useState<ProductLabel[]>([]);
  const [labelContent, setLabelContentBlocks] = useState<LabelContentBlock[]>([]);
  const [labelArtworks, setLabelArtworks] = useState<LabelArtwork[]>([]);
  const [labelReviews, setLabelReviews] = useState<LabelReview[]>([]);
  const [labelReviewRevocations, setLabelReviewRevocations] = useState<LabelReviewRevocation[]>([]);

  const [reviewerRole, setReviewerRole] = useState<ApprovalRole>("regulatory");
  const [topSection, setTopSection] = useState<TopSection>("claims");
  const [error, setError] = useState<string | null>(null);

  const actor: Actor = useMemo(() => ({ kind: "human", role: reviewerRole, userId: "local" }), [reviewerRole]);
  const canActRegulatory = isAuthorizedRegulatoryActor(actor);

  const load = async () => {
    const [cl, clk, crv, crvrv, lb, lc, la, lr, lrrv, ds, ev, ru] = await Promise.all([
      listRecords("product_claims"),
      listRecords("claim_evidence_links"),
      listRecords("claim_reviews"),
      listRecords("claim_review_revocations"),
      listRecords("product_labels"),
      listRecords("label_content_blocks"),
      listRecords("label_artworks"),
      listRecords("label_reviews"),
      listRecords("label_review_revocations"),
      listRecords("regulatory_dossiers"),
      listRecords("regulatory_evidence_items"),
      listRecordsSeeded("regulatory_rules", SEED_REGULATORY_RULES),
    ]);
    setClaims(cl.filter((c) => c.formulationId === formulation.id));
    setClaimLinks(clk);
    setClaimReviews(crv);
    setClaimReviewRevocations(crvrv);
    setLabels(lb.filter((l) => l.formulationId === formulation.id));
    setLabelContentBlocks(lc);
    setLabelArtworks(la);
    setLabelReviews(lr);
    setLabelReviewRevocations(lrrv);
    setDossiers(ds.filter((d) => d.formulationId === formulation.id));
    setDossierEvidence(ev.filter((e) => e.formulationId === formulation.id));
    setRules(ru);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulation.id]);

  // =========================================================== CLAIMS =====
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(initialClaimId ?? null);
  const [claimSection, setClaimSection] = useState<ClaimDetailSection>("overview");
  const [claimStatusFilter, setClaimStatusFilter] = useState("");
  const [claimJurisdictionFilter, setClaimJurisdictionFilter] = useState("");
  const [claimRiskFilter, setClaimRiskFilter] = useState("");

  const selectedClaim = claims.find((c) => c.id === selectedClaimId);

  const [creatingClaim, setCreatingClaim] = useState(false);
  const [claimDraftCode, setClaimDraftCode] = useState("");
  const [claimDraftText, setClaimDraftText] = useState("");
  const [claimDraftCategory, setClaimDraftCategory] = useState<ClaimCategory | "">("");
  const [claimDraftVersionId, setClaimDraftVersionId] = useState(initialVersionId ?? "");
  const [claimDraftSku, setClaimDraftSku] = useState(initialPackagingSkuCode ?? "");
  const [claimDraftJurisdictions, setClaimDraftJurisdictions] = useState<RegulatoryJurisdiction[]>(initialJurisdiction ? [initialJurisdiction] : []);
  const [claimDraftLanguages, setClaimDraftLanguages] = useState<string[]>(["en"]);
  const [claimCreateBusy, setClaimCreateBusy] = useState(false);

  const openCreateClaim = () => {
    setCreatingClaim(true);
    setClaimDraftCode(`CLM-${Date.now().toString(36).toUpperCase()}`);
    setClaimDraftText("");
    setClaimDraftCategory("");
    setClaimDraftVersionId(initialVersionId ?? versions[0]?.id ?? "");
    setClaimDraftSku(initialPackagingSkuCode ?? "");
    setClaimDraftJurisdictions(initialJurisdiction ? [initialJurisdiction] : []);
    setClaimDraftLanguages(["en"]);
    setError(null);
  };

  const submitCreateClaim = async () => {
    if (!claimDraftVersionId) {
      setError(t("claimsLabels.needSavedVersion"));
      return;
    }
    if (claimDraftJurisdictions.length === 0) {
      setError(t("claimsLabels.needJurisdiction"));
      return;
    }
    if (!claimDraftText.trim()) {
      setError(t("claimsLabels.needClaimText"));
      return;
    }
    setClaimCreateBusy(true);
    setError(null);
    try {
      const claim = createClaim(
        {
          claimCode: claimDraftCode.trim() || newId("claim"),
          claimText: claimDraftText.trim(),
          claimCategory: claimDraftCategory || undefined,
          formulationId: formulation.id,
          formulaVersionId: claimDraftVersionId,
          packagingSkuCode: claimDraftSku || undefined,
          jurisdictions: claimDraftJurisdictions,
          languages: claimDraftLanguages,
        },
        actor,
      );
      await upsertRecords("product_claims", [claim]);
      setClaims((prev) => [...prev, claim]);
      await appendAudit(
        auditEvent(formulation.id, "claim.created", {
          versionId: claim.formulaVersionId,
          detail: claim.claimText,
          metadata: { claimId: claim.id, claimCategory: claim.claimCategory },
        }),
      );
      await onAuditChanged();
      setCreatingClaim(false);
      setSelectedClaimId(claim.id);
      setClaimSection("overview");
    } catch (e) {
      setError(String(e));
    } finally {
      setClaimCreateBusy(false);
    }
  };

  const [claimStatusDraft, setClaimStatusDraft] = useState<ClaimStatus>("draft");
  useEffect(() => {
    if (selectedClaim) setClaimStatusDraft(selectedClaim.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClaim?.id, selectedClaim?.status]);

  const doChangeClaimStatus = async () => {
    if (!selectedClaim) return;
    try {
      const updated = updateClaimStatus(selectedClaim, claimStatusDraft, actor);
      await upsertRecords("product_claims", [updated]);
      setClaims((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      const action = claimStatusDraft === "withdrawn" ? "claim.withdrawn" : "claim.revised";
      await appendAudit(auditEvent(formulation.id, action, { versionId: updated.formulaVersionId, detail: claimStatusDraft, metadata: { claimId: updated.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const [reviseClaimText, setReviseClaimText] = useState("");
  const [revisingClaim, setRevisingClaim] = useState(false);

  const doReviseClaim = async () => {
    if (!selectedClaim) return;
    try {
      const { superseded, revised } = reviseClaim(selectedClaim, reviseClaimText.trim() ? { claimText: reviseClaimText.trim() } : {}, actor);
      await upsertRecords("product_claims", [superseded, revised]);
      setClaims((prev) => [...prev.map((c) => (c.id === superseded.id ? superseded : c)), revised]);
      await appendAudit(auditEvent(formulation.id, "claim.revised", { versionId: revised.formulaVersionId, detail: revised.claimText, metadata: { claimId: revised.id, supersedesClaimId: superseded.id } }));
      await onAuditChanged();
      setSelectedClaimId(revised.id);
      setRevisingClaim(false);
      setReviseClaimText("");
    } catch (e) {
      setError(String(e));
    }
  };

  const claimFindings = useMemo(() => {
    if (!selectedClaim) return [];
    return evaluateClaimAgainstRules(selectedClaim, { jurisdictions: selectedClaim.jurisdictions, rules });
  }, [selectedClaim, rules]);
  const claimActiveLinks = selectedClaim ? activeLinksForClaim(claimLinks, selectedClaim.id) : [];
  const claimEvidenceState = selectedClaim
    ? evaluateClaimEvidence(selectedClaim, claimLinks, dossierEvidence, {
        formulaVersionId: selectedClaim.formulaVersionId,
        packagingSkuCode: selectedClaim.packagingSkuCode,
        jurisdictions: selectedClaim.jurisdictions,
      })
    : { hasVerifiedEligibleEvidence: false, missingEvidence: true, findings: [] };
  const combinedClaimFindings = [...claimFindings, ...claimEvidenceState.findings];
  const derivedClaimStatus = selectedClaim ? deriveClaimStatus(combinedClaimFindings, claimEvidenceState) : "unknown";
  const derivedClaimRisk = selectedClaim ? deriveClaimRisk(selectedClaim, combinedClaimFindings) : "unknown";
  const claimConflicts = useMemo(() => findClaimConflicts(claims), [claims]);

  const findingsByClaimId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof evaluateClaimAgainstRules>>();
    for (const c of claims) {
      const ruleFindings = evaluateClaimAgainstRules(c, { jurisdictions: c.jurisdictions, rules });
      const evState = evaluateClaimEvidence(c, claimLinks, dossierEvidence, { formulaVersionId: c.formulaVersionId, packagingSkuCode: c.packagingSkuCode, jurisdictions: c.jurisdictions });
      map.set(c.id, [...ruleFindings, ...evState.findings]);
    }
    return map;
  }, [claims, rules, claimLinks, dossierEvidence]);
  const claimsReadiness = useMemo(() => calculateClaimsReadiness(claims, findingsByClaimId), [claims, findingsByClaimId]);

  const filteredClaims = claims.filter((c) => {
    const effective = deriveClaimEffectiveStatus(c, claims);
    if (claimStatusFilter && effective !== claimStatusFilter) return false;
    if (claimJurisdictionFilter && !c.jurisdictions.includes(claimJurisdictionFilter as RegulatoryJurisdiction)) return false;
    if (claimRiskFilter) {
      const findings = findingsByClaimId.get(c.id) ?? [];
      if (deriveClaimRisk(c, findings) !== claimRiskFilter) return false;
    }
    return true;
  });

  // ------------------------------------------------------ claims export/import
  // Phase 4 §21 — JSON/CSV/Excel claims export/import + a claim-review
  // summary export. No PDF/DOCX here (Phase 7). Imported rows always go
  // through `createClaim`'s own draft/unreviewed path — the import actor
  // can never verify or review what it just imported.
  const exportClaimsJson = () => {
    downloadBlob("claims.json", new Blob([JSON.stringify(filteredClaims, null, 2)], { type: "application/json" }));
  };
  const claimExportRows = (rows: ProductClaim[]) =>
    rows.map((c) => ({
      claimCode: c.claimCode,
      claimText: c.claimText,
      claimCategory: c.claimCategory,
      formulaVersionId: c.formulaVersionId,
      packagingSkuCode: c.packagingSkuCode ?? "",
      jurisdictions: c.jurisdictions.join(";"),
      languages: c.languages.join(";"),
      status: c.status,
      riskLevel: c.riskLevel,
    }));
  const exportClaimsCsv = () => downloadBlob("claims.csv", new Blob([toCsv(CLAIM_EXPORT_HEADERS, claimExportRows(filteredClaims))], { type: "text/csv;charset=utf-8" }));
  const exportClaimsXlsx = async () => downloadBlob("claims.xlsx", await buildXlsxBlob(CLAIM_EXPORT_HEADERS, claimExportRows(filteredClaims), "claims"));
  const exportClaimReviewSummaryCsv = () => {
    const rows = filteredClaims.map((c) => {
      const latestReview = claimReviews.filter((r) => r.claimId === c.id).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))[0];
      return {
        claimCode: c.claimCode,
        claimText: c.claimText,
        status: c.status,
        riskLevel: c.riskLevel,
        reviewOutcome: latestReview?.outcome ?? "",
        reviewedBy: latestReview?.reviewedBy ?? "",
        reviewedAt: latestReview?.reviewedAt ?? "",
      };
    });
    downloadBlob("claim-review-summary.csv", new Blob([toCsv(CLAIM_REVIEW_SUMMARY_HEADERS, rows)], { type: "text/csv;charset=utf-8" }));
  };

  const [importingClaims, setImportingClaims] = useState(false);
  const [claimImportFormat, setClaimImportFormat] = useState<(typeof IMPORT_FORMATS)[number]>("json");
  const [claimImportText, setClaimImportText] = useState("");
  const [claimImportFile, setClaimImportFile] = useState<File | null>(null);
  const [claimImportError, setClaimImportError] = useState<string | null>(null);
  const [claimImportVersionId, setClaimImportVersionId] = useState("");
  const [claimImportPreview, setClaimImportPreview] = useState<{ valid: Record<string, unknown>[]; errors: string[]; duplicates: number } | null>(null);

  const buildClaimImportPreview = (rows: Record<string, unknown>[]) => {
    const valid: Record<string, unknown>[] = [];
    const errors: string[] = [];
    let duplicates = 0;
    const existing = new Set(claims.map((c) => `${c.claimCode}::${c.formulaVersionId}`));
    rows.forEach((row, i) => {
      const claimCode = row.claimCode ? String(row.claimCode) : "";
      const claimText = row.claimText ? String(row.claimText) : "";
      if (!claimCode || !claimText) {
        errors.push(t("claimsLabels.importRowError", { row: i + 1 }));
        return;
      }
      const key = `${claimCode}::${claimImportVersionId}`;
      if (existing.has(key)) {
        duplicates += 1;
        return;
      }
      valid.push({ ...row, claimCode, claimText });
    });
    setClaimImportPreview({ valid, errors, duplicates });
  };
  const previewClaimJsonOrCsv = () => {
    setClaimImportError(null);
    if (claimImportFormat === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(claimImportText);
      } catch {
        setClaimImportError(t("claimsLabels.invalidJson"));
        return;
      }
      buildClaimImportPreview((Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[]);
    } else if (claimImportFormat === "csv") {
      const parsedRows = parseCsv(claimImportText);
      if (parsedRows.length < 2) {
        setClaimImportError(t("claimsLabels.invalidShape"));
        return;
      }
      const [header, ...dataRows] = parsedRows;
      buildClaimImportPreview(dataRows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]]))));
    }
  };
  const previewClaimExcel = async () => {
    setClaimImportError(null);
    if (!claimImportFile) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await claimImportFile.arrayBuffer());
    const sheet = wb.worksheets[0];
    if (!sheet) {
      setClaimImportError(t("claimsLabels.invalidShape"));
      return;
    }
    const header = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
    const rows: Record<string, unknown>[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const values = (sheet.getRow(r).values as unknown[]).slice(1);
      if (values.every((v) => v === undefined || v === null || v === "")) continue;
      rows.push(Object.fromEntries(header.map((h, i) => [h, values[i]])));
    }
    buildClaimImportPreview(rows);
  };
  const commitImportClaims = async () => {
    if (!claimImportVersionId || !claimImportPreview || claimImportPreview.valid.length === 0) return;
    try {
      const created = claimImportPreview.valid.map((row) =>
        createClaim(
          {
            claimCode: String(row.claimCode),
            claimText: String(row.claimText),
            claimCategory: row.claimCategory ? (String(row.claimCategory) as ClaimCategory) : undefined,
            formulationId: formulation.id,
            formulaVersionId: claimImportVersionId,
            packagingSkuCode: row.packagingSkuCode ? String(row.packagingSkuCode) : undefined,
            jurisdictions: row.jurisdictions ? (String(row.jurisdictions).split(";").filter(Boolean) as RegulatoryJurisdiction[]) : [],
            languages: row.languages ? String(row.languages).split(";").filter(Boolean) : ["en"],
          },
          actor,
        ),
      );
      await upsertRecords("product_claims", created);
      setClaims((prev) => [...prev, ...created]);
      await appendAudit(
        auditEvent(formulation.id, "claim.created", {
          versionId: claimImportVersionId,
          detail: `imported ${created.length} claim(s), ${claimImportPreview.duplicates} skipped as duplicates`,
        }),
      );
      await onAuditChanged();
      setImportingClaims(false);
      setClaimImportText("");
      setClaimImportFile(null);
      setClaimImportPreview(null);
    } catch (e) {
      setError(String(e));
    }
  };

  // --------------------------------------------------------- claim evidence
  const [linkEvidenceId, setLinkEvidenceId] = useState("");
  const eligibleEvidenceForClaim = selectedClaim
    ? dossierEvidence.filter((e) => e.formulaVersionId === selectedClaim.formulaVersionId)
    : [];

  const doProposeClaimLink = async () => {
    if (!selectedClaim || !linkEvidenceId) return;
    const evidence = dossierEvidence.find((e) => e.id === linkEvidenceId);
    if (!evidence) return;
    try {
      const link = proposeClaimEvidenceLink(selectedClaim.id, linkEvidenceId, evidence.dossierId, dossiers.find((d) => d.id === evidence.dossierId)?.revision ?? 1, actor);
      await upsertRecords("claim_evidence_links", [link]);
      setClaimLinks((prev) => [...prev, link]);
      await appendAudit(auditEvent(formulation.id, "claim.evidence_link_proposed", { metadata: { claimId: selectedClaim.id, evidenceItemId: linkEvidenceId } }));
      await onAuditChanged();
      setLinkEvidenceId("");
    } catch (e) {
      setError(String(e));
    }
  };
  const doAcceptClaimLink = async (link: ClaimEvidenceLink) => {
    try {
      const updated = acceptClaimEvidenceLink(link, actor);
      await upsertRecords("claim_evidence_links", [updated]);
      setClaimLinks((prev) => [...prev, updated]);
      await appendAudit(auditEvent(formulation.id, "claim.evidence_link_accepted", { metadata: { claimId: link.claimId, evidenceItemId: link.evidenceItemId } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };
  const doRejectClaimLink = async (link: ClaimEvidenceLink) => {
    const reason = window.prompt(t("claimsLabels.rejectReasonPrompt"));
    if (!reason) return;
    try {
      const updated = rejectClaimEvidenceLink(link, actor, reason);
      await upsertRecords("claim_evidence_links", [updated]);
      setClaimLinks((prev) => [...prev, updated]);
      await appendAudit(auditEvent(formulation.id, "claim.evidence_link_rejected", { detail: reason, metadata: { claimId: link.claimId, evidenceItemId: link.evidenceItemId } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };
  const doRevokeClaimLink = async (link: ClaimEvidenceLink) => {
    const reason = window.prompt(t("claimsLabels.revokeReasonPrompt"));
    if (!reason) return;
    try {
      const updated = revokeClaimEvidenceLink(link, actor, reason);
      await upsertRecords("claim_evidence_links", [updated]);
      setClaimLinks((prev) => [...prev, updated]);
      await appendAudit(auditEvent(formulation.id, "claim.evidence_link_revoked", { detail: reason, metadata: { claimId: link.claimId, evidenceItemId: link.evidenceItemId } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  // ---------------------------------------------------------- claim review
  const [claimReviewJurisdiction, setClaimReviewJurisdiction] = useState<RegulatoryJurisdiction | "">("");
  const [claimReviewLanguage, setClaimReviewLanguage] = useState("");
  const [claimReviewOutcome, setClaimReviewOutcome] = useState<ClaimReview["outcome"]>("supported");
  const [claimReviewConditions, setClaimReviewConditions] = useState("");
  const [claimReviewNotes, setClaimReviewNotes] = useState("");

  useEffect(() => {
    if (selectedClaim) {
      setClaimReviewJurisdiction(selectedClaim.jurisdictions[0] ?? "");
      setClaimReviewLanguage(selectedClaim.languages[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClaim?.id]);

  const submitClaimReview = async () => {
    if (!selectedClaim || !claimReviewJurisdiction || !claimReviewLanguage) return;
    try {
      const review = recordClaimReview(
        {
          claimId: selectedClaim.id,
          claimRevision: 1,
          formulationId: formulation.id,
          formulaVersionId: selectedClaim.formulaVersionId,
          packagingSkuCode: selectedClaim.packagingSkuCode,
          jurisdiction: claimReviewJurisdiction,
          language: claimReviewLanguage,
          outcome: claimReviewOutcome,
          conditions: claimReviewConditions ? claimReviewConditions.split(",").map((s) => s.trim()).filter(Boolean) : [],
          notes: claimReviewNotes,
          evidenceSnapshot: claimActiveLinks,
          ruleSnapshot: claimFindings
            .filter((f): f is typeof f & { ruleId: string } => !!f.ruleId)
            .map((f) => {
              const rule = rules.find((r) => r.id === f.ruleId);
              return { ruleId: f.ruleId, ruleCode: rule?.code ?? f.ruleId, version: f.ruleVersion ?? rule?.version ?? 1 };
            }),
        },
        actor,
      );
      await upsertRecords("claim_reviews", [review]);
      setClaimReviews((prev) => [...prev, review]);
      await appendAudit(auditEvent(formulation.id, "claim.review_recorded", { detail: claimReviewOutcome, metadata: { claimId: selectedClaim.id, reviewId: review.id } }));
      await onAuditChanged();
      setClaimReviewNotes("");
      setClaimReviewConditions("");
    } catch (e) {
      setError(String(e));
    }
  };
  const doRevokeClaimReview = async (review: ClaimReview) => {
    const reason = window.prompt(t("claimsLabels.revokeReasonPrompt"));
    if (!reason) return;
    try {
      const revocation = revokeClaimReview(review.id, actor, reason);
      await upsertRecords("claim_review_revocations", [revocation]);
      setClaimReviewRevocations((prev) => [...prev, revocation]);
      await appendAudit(auditEvent(formulation.id, "claim.review_revoked", { detail: reason, metadata: { claimId: review.claimId, reviewId: review.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const claimReviewsForSelected = selectedClaim ? claimReviews.filter((r) => r.claimId === selectedClaim.id) : [];

  // =========================================================== LABELS =====
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(initialLabelId ?? null);
  const [labelSection, setLabelSection] = useState<LabelDetailSection>("overview");
  const [labelStatusFilter, setLabelStatusFilter] = useState("");
  const [labelJurisdictionFilter, setLabelJurisdictionFilter] = useState("");
  const [labelLanguageFilter, setLabelLanguageFilter] = useState("");

  const selectedLabel = labels.find((l) => l.id === selectedLabelId);

  const [creatingLabel, setCreatingLabel] = useState(false);
  const [labelDraftCode, setLabelDraftCode] = useState("");
  const [labelDraftVersionId, setLabelDraftVersionId] = useState(initialVersionId ?? "");
  const [labelDraftSku, setLabelDraftSku] = useState(initialPackagingSkuCode ?? "");
  const [labelDraftJurisdiction, setLabelDraftJurisdiction] = useState<RegulatoryJurisdiction>(initialJurisdiction ?? "KE");
  const [labelDraftLanguage, setLabelDraftLanguage] = useState("en");
  const [labelCreateBusy, setLabelCreateBusy] = useState(false);

  const openCreateLabel = () => {
    setCreatingLabel(true);
    setLabelDraftCode(`LBL-${Date.now().toString(36).toUpperCase()}`);
    setLabelDraftVersionId(initialVersionId ?? versions[0]?.id ?? "");
    setLabelDraftSku(initialPackagingSkuCode ?? "");
    setLabelDraftJurisdiction(initialJurisdiction ?? "KE");
    setLabelDraftLanguage("en");
    setError(null);
  };

  const submitCreateLabel = async () => {
    if (!labelDraftVersionId) {
      setError(t("claimsLabels.needSavedVersion"));
      return;
    }
    setLabelCreateBusy(true);
    setError(null);
    try {
      const label = createLabel(
        {
          labelCode: labelDraftCode.trim() || newId("label"),
          formulationId: formulation.id,
          formulaVersionId: labelDraftVersionId,
          packagingSkuCode: labelDraftSku || undefined,
          jurisdiction: labelDraftJurisdiction,
          language: labelDraftLanguage,
        },
        actor,
      );
      await upsertRecords("product_labels", [label]);
      setLabels((prev) => [...prev, label]);
      await appendAudit(auditEvent(formulation.id, "label.created", { versionId: label.formulaVersionId, detail: label.labelCode, metadata: { labelId: label.id } }));
      await onAuditChanged();
      setCreatingLabel(false);
      setSelectedLabelId(label.id);
      setLabelSection("overview");
    } catch (e) {
      setError(String(e));
    } finally {
      setLabelCreateBusy(false);
    }
  };

  const [labelStatusDraft, setLabelStatusDraft] = useState<LabelStatus>("draft");
  useEffect(() => {
    if (selectedLabel) setLabelStatusDraft(selectedLabel.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLabel?.id, selectedLabel?.status]);

  const doChangeLabelStatus = async () => {
    if (!selectedLabel) return;
    try {
      const updated = updateLabelStatus(selectedLabel, labelStatusDraft, actor);
      await upsertRecords("product_labels", [updated]);
      setLabels((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      await appendAudit(auditEvent(formulation.id, "label.revised", { versionId: updated.formulaVersionId, detail: labelStatusDraft, metadata: { labelId: updated.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const doReviseLabel = async () => {
    if (!selectedLabel) return;
    try {
      const { superseded, revised } = reviseLabel(selectedLabel, actor);
      await upsertRecords("product_labels", [superseded, revised]);
      setLabels((prev) => [...prev.map((l) => (l.id === superseded.id ? superseded : l)), revised]);
      await appendAudit(auditEvent(formulation.id, "label.revised", { versionId: revised.formulaVersionId, detail: revised.labelCode, metadata: { labelId: revised.id, supersedesLabelId: superseded.id } }));
      await appendAudit(auditEvent(formulation.id, "label.superseded", { detail: superseded.labelCode, metadata: { labelId: superseded.id } }));
      await onAuditChanged();
      setSelectedLabelId(revised.id);
    } catch (e) {
      setError(String(e));
    }
  };

  const labelBlocks = selectedLabel ? currentContentForRevision(labelContent, selectedLabel.id, selectedLabel.revision) : [];
  const labelArtworksForSelected = selectedLabel ? labelArtworks.filter((a) => a.labelId === selectedLabel.id && a.labelRevision === selectedLabel.revision) : [];
  const currentArtwork = labelArtworksForSelected.find((a) => deriveArtworkEffectiveStatus(a, labelArtworksForSelected) !== "superseded");
  const hasActiveClaimsForLabel = selectedLabel
    ? claims.some((c) => c.formulaVersionId === selectedLabel.formulaVersionId && c.jurisdictions.includes(selectedLabel.jurisdiction) && deriveClaimEffectiveStatus(c, claims) !== "superseded" && c.status !== "withdrawn" && c.status !== "rejected")
    : false;
  const labelRequirements = selectedLabel ? resolveLabelRequirements({ jurisdiction: selectedLabel.jurisdiction, language: selectedLabel.language, rules, hasActiveClaims: hasActiveClaimsForLabel }) : [];
  const labelContentRows = selectedLabel ? evaluateLabelContent(labelRequirements, labelBlocks, selectedLabel.language) : [];
  const selectedFormulaVersionForLabel = selectedLabel ? versions.find((v) => v.id === selectedLabel.formulaVersionId) : undefined;
  const labelReadiness = selectedLabel
    ? calculateLabelReadiness(selectedLabel, labelContentRows, [selectedLabel.language], [selectedLabel.language], currentArtwork)
    : undefined;
  const labelReviewsForSelected = selectedLabel ? labelReviews.filter((r) => r.labelId === selectedLabel.id) : [];

  const filteredLabels = labels.filter((l) => {
    const effective = deriveLabelEffectiveStatus(l, labels);
    if (labelStatusFilter && effective !== labelStatusFilter) return false;
    if (labelJurisdictionFilter && l.jurisdiction !== labelJurisdictionFilter) return false;
    if (labelLanguageFilter && l.language !== labelLanguageFilter) return false;
    return true;
  });

  // Phase 4 §21 — label readiness summary export, computed per label the
  // same way the label detail Overview computes it for a single label.
  const exportLabelReadinessSummaryCsv = () => {
    const rows = filteredLabels.map((l) => {
      const blocks = currentContentForRevision(labelContent, l.id, l.revision);
      const artworksForLabel = labelArtworks.filter((a) => a.labelId === l.id && a.labelRevision === l.revision);
      const artwork = artworksForLabel.find((a) => deriveArtworkEffectiveStatus(a, artworksForLabel) !== "superseded");
      const hasActiveClaims = claims.some((c) => c.formulaVersionId === l.formulaVersionId && c.jurisdictions.includes(l.jurisdiction) && deriveClaimEffectiveStatus(c, claims) !== "superseded");
      const requirements = resolveLabelRequirements({ jurisdiction: l.jurisdiction, language: l.language, rules, hasActiveClaims });
      const rows2 = evaluateLabelContent(requirements, blocks, l.language);
      const readiness = calculateLabelReadiness(l, rows2, [l.language], [l.language], artwork);
      return {
        labelCode: l.labelCode,
        jurisdiction: l.jurisdiction,
        language: l.language,
        status: l.status,
        overallReadiness: readiness.overallReadiness,
        missingRequirements: readiness.missingRequirements,
        artworkStatus: artwork?.status ?? "",
      };
    });
    downloadBlob("label-readiness-summary.csv", new Blob([toCsv(LABEL_READINESS_SUMMARY_HEADERS, rows)], { type: "text/csv;charset=utf-8" }));
  };

  // --------------------------------------------------------- label content
  const [contentDrafts, setContentDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const block of labelBlocks) next[block.blockType] = block.text;
    setContentDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLabel?.id, selectedLabel?.revision]);

  const doSaveContentBlock = async (blockType: LabelContentBlockType) => {
    if (!selectedLabel) return;
    try {
      const block = setLabelContent({ labelId: selectedLabel.id, labelRevision: selectedLabel.revision, blockType, text: contentDrafts[blockType] ?? "", language: selectedLabel.language }, actor);
      await upsertRecords("label_content_blocks", [block]);
      setLabelContentBlocks((prev) => [...prev, block]);
      await appendAudit(auditEvent(formulation.id, "label.content_changed", { detail: blockType, metadata: { labelId: selectedLabel.id, blockType } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  // ------------------------------------------- label content export/import
  // Phase 4 §21 — JSON/CSV/Excel export/import of the SELECTED label's
  // current content blocks (content is revision-scoped, so export/import
  // operates on one label at a time, unlike the claims list export above).
  const labelContentExportRows = (blocks: LabelContentBlock[]) => blocks.map((b) => ({ blockType: b.blockType, text: b.text, language: b.language, mandatory: b.mandatory ? "true" : "false" }));
  const exportLabelContentJson = () => {
    if (!selectedLabel) return;
    downloadBlob(`${selectedLabel.labelCode}-content.json`, new Blob([JSON.stringify(labelBlocks, null, 2)], { type: "application/json" }));
  };
  const exportLabelContentCsv = () => {
    if (!selectedLabel) return;
    downloadBlob(`${selectedLabel.labelCode}-content.csv`, new Blob([toCsv(LABEL_CONTENT_EXPORT_HEADERS, labelContentExportRows(labelBlocks))], { type: "text/csv;charset=utf-8" }));
  };
  const exportLabelContentXlsx = async () => {
    if (!selectedLabel) return;
    downloadBlob(`${selectedLabel.labelCode}-content.xlsx`, await buildXlsxBlob(LABEL_CONTENT_EXPORT_HEADERS, labelContentExportRows(labelBlocks), "label-content"));
  };

  const [importingContent, setImportingContent] = useState(false);
  const [contentImportFormat, setContentImportFormat] = useState<(typeof IMPORT_FORMATS)[number]>("json");
  const [contentImportText, setContentImportText] = useState("");
  const [contentImportFile, setContentImportFile] = useState<File | null>(null);
  const [contentImportError, setContentImportError] = useState<string | null>(null);
  const [contentImportPreview, setContentImportPreview] = useState<{ valid: Record<string, unknown>[]; errors: string[] } | null>(null);

  const buildContentImportPreview = (rows: Record<string, unknown>[]) => {
    const valid: Record<string, unknown>[] = [];
    const errors: string[] = [];
    rows.forEach((row, i) => {
      const blockType = row.blockType ? String(row.blockType) : "";
      if (!(LABEL_CONTENT_BLOCK_TYPES as readonly string[]).includes(blockType)) {
        errors.push(t("claimsLabels.importRowError", { row: i + 1 }));
        return;
      }
      valid.push({ ...row, blockType, text: row.text ? String(row.text) : "" });
    });
    setContentImportPreview({ valid, errors });
  };
  const previewContentJsonOrCsv = () => {
    setContentImportError(null);
    if (contentImportFormat === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(contentImportText);
      } catch {
        setContentImportError(t("claimsLabels.invalidJson"));
        return;
      }
      buildContentImportPreview((Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[]);
    } else if (contentImportFormat === "csv") {
      const parsedRows = parseCsv(contentImportText);
      if (parsedRows.length < 2) {
        setContentImportError(t("claimsLabels.invalidShape"));
        return;
      }
      const [header, ...dataRows] = parsedRows;
      buildContentImportPreview(dataRows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]]))));
    }
  };
  const previewContentExcel = async () => {
    setContentImportError(null);
    if (!contentImportFile) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await contentImportFile.arrayBuffer());
    const sheet = wb.worksheets[0];
    if (!sheet) {
      setContentImportError(t("claimsLabels.invalidShape"));
      return;
    }
    const header = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
    const rows: Record<string, unknown>[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const values = (sheet.getRow(r).values as unknown[]).slice(1);
      if (values.every((v) => v === undefined || v === null || v === "")) continue;
      rows.push(Object.fromEntries(header.map((h, i) => [h, values[i]])));
    }
    buildContentImportPreview(rows);
  };
  const commitImportContent = async () => {
    if (!selectedLabel || !contentImportPreview || contentImportPreview.valid.length === 0) return;
    try {
      const blocks = contentImportPreview.valid.map((row) =>
        setLabelContent(
          {
            labelId: selectedLabel.id,
            labelRevision: selectedLabel.revision,
            blockType: String(row.blockType) as LabelContentBlockType,
            text: String(row.text ?? ""),
            language: row.language ? String(row.language) : selectedLabel.language,
            source: "imported",
          },
          actor,
        ),
      );
      await upsertRecords("label_content_blocks", blocks);
      setLabelContentBlocks((prev) => [...prev, ...blocks]);
      await appendAudit(auditEvent(formulation.id, "label.content_changed", { detail: `imported ${blocks.length} block(s)`, metadata: { labelId: selectedLabel.id } }));
      await onAuditChanged();
      setImportingContent(false);
      setContentImportText("");
      setContentImportFile(null);
      setContentImportPreview(null);
    } catch (e) {
      setError(String(e));
    }
  };

  // --------------------------------------------------------- label artwork
  const [artworkCode, setArtworkCode] = useState("");
  const [artworkAttachments, setArtworkAttachments] = useState<LabelArtwork["attachmentIds"]>([]);
  const [replacingArtwork, setReplacingArtwork] = useState<LabelArtwork | null>(null);

  const openUploadArtwork = () => {
    setArtworkCode(`ART-${Date.now().toString(36).toUpperCase()}`);
    setArtworkAttachments([]);
    setReplacingArtwork(null);
  };

  const submitArtwork = async () => {
    if (!selectedLabel) return;
    try {
      if (replacingArtwork) {
        const { superseded, replacement } = replaceArtwork(replacingArtwork, { artworkCode: artworkCode.trim() || newId("labelartwork"), attachmentIds: artworkAttachments }, actor);
        await upsertRecords("label_artworks", [superseded, replacement]);
        setLabelArtworks((prev) => [...prev.map((a) => (a.id === superseded.id ? superseded : a)), replacement]);
        await appendAudit(auditEvent(formulation.id, "label.artwork_replaced", { metadata: { labelId: selectedLabel.id, oldArtworkId: superseded.id, newArtworkId: replacement.id } }));
      } else {
        const artwork = uploadArtwork({ labelId: selectedLabel.id, labelRevision: selectedLabel.revision, artworkCode: artworkCode.trim() || newId("labelartwork"), attachmentIds: artworkAttachments }, actor);
        await upsertRecords("label_artworks", [artwork]);
        setLabelArtworks((prev) => [...prev, artwork]);
        await appendAudit(auditEvent(formulation.id, "label.artwork_uploaded", { metadata: { labelId: selectedLabel.id, artworkId: artwork.id } }));
      }
      await onAuditChanged();
      setArtworkCode("");
      setArtworkAttachments([]);
      setReplacingArtwork(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const doApproveArtwork = async (artwork: LabelArtwork) => {
    try {
      const updated = approveArtwork(artwork, actor);
      await upsertRecords("label_artworks", [updated]);
      setLabelArtworks((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      await appendAudit(auditEvent(formulation.id, "label.artwork_approved", { metadata: { labelId: artwork.labelId, artworkId: artwork.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };
  const doRejectArtwork = async (artwork: LabelArtwork) => {
    const reason = window.prompt(t("claimsLabels.rejectReasonPrompt"));
    if (!reason) return;
    try {
      const updated = rejectArtwork(artwork, actor, reason);
      await upsertRecords("label_artworks", [updated]);
      setLabelArtworks((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      await appendAudit(auditEvent(formulation.id, "label.artwork_rejected", { detail: reason, metadata: { labelId: artwork.labelId, artworkId: artwork.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  // ---------------------------------------------------------- label review
  const [labelReviewArtworkId, setLabelReviewArtworkId] = useState("");
  const [labelReviewOutcome, setLabelReviewOutcome] = useState<LabelReview["outcome"]>("approved");
  const [labelReviewNotes, setLabelReviewNotes] = useState("");

  const submitLabelReview = async () => {
    if (!selectedLabel) return;
    try {
      const artwork = labelArtworksForSelected.find((a) => a.id === labelReviewArtworkId);
      const review = recordLabelReview(
        {
          labelId: selectedLabel.id,
          labelRevision: selectedLabel.revision,
          artworkId: artwork?.id,
          artworkRevision: artwork ? 1 : undefined,
          formulaVersionId: selectedLabel.formulaVersionId,
          packagingSkuCode: selectedLabel.packagingSkuCode,
          jurisdiction: selectedLabel.jurisdiction,
          language: selectedLabel.language,
          outcome: labelReviewOutcome,
          notes: labelReviewNotes,
          findingsSnapshot: consistencyFindings,
          contentSnapshot: labelBlocks,
          claimsSnapshot: claims.filter((c) => c.formulaVersionId === selectedLabel.formulaVersionId).map((c) => c.id),
        },
        actor,
      );
      await upsertRecords("label_reviews", [review]);
      setLabelReviews((prev) => [...prev, review]);
      await appendAudit(auditEvent(formulation.id, "label.review_recorded", { detail: labelReviewOutcome, metadata: { labelId: selectedLabel.id, reviewId: review.id } }));
      await onAuditChanged();
      setLabelReviewNotes("");
    } catch (e) {
      setError(String(e));
    }
  };
  const doRevokeLabelReview = async (review: LabelReview) => {
    const reason = window.prompt(t("claimsLabels.revokeReasonPrompt"));
    if (!reason) return;
    try {
      const revocation = revokeLabelReview(review.id, actor, reason);
      await upsertRecords("label_review_revocations", [revocation]);
      setLabelReviewRevocations((prev) => [...prev, revocation]);
      await appendAudit(auditEvent(formulation.id, "label.review_revoked", { detail: reason, metadata: { labelId: review.labelId, reviewId: review.id } }));
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  // -------------------------------------------------------------- consistency
  const [consistencyRan, setConsistencyRan] = useState(false);
  const consistencyFindings: ConsistencyFinding[] = useMemo(() => {
    if (!selectedLabel || !selectedFormulaVersionForLabel) return [];
    const formulaFindings = evaluateFormulaLabelConsistency(
      { formulationName: formulation.name, formulaVersion: selectedFormulaVersionForLabel, label: selectedLabel, packagingSkuCode: selectedLabel.packagingSkuCode },
      labelBlocks,
    );
    const claimFindingsForLabel = evaluateClaimLabelConsistency({ claims: claims.filter((c) => c.formulaVersionId === selectedLabel.formulaVersionId) }, labelBlocks);
    const artworkFindings = evaluateArtworkReadiness(currentArtwork);
    return [...formulaFindings, ...claimFindingsForLabel, ...artworkFindings];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLabel?.id, selectedLabel?.revision, labelBlocks, claims, currentArtwork]);

  const doRunConsistencyCheck = async () => {
    if (!selectedLabel) return;
    setConsistencyRan(true);
    await appendAudit(
      auditEvent(formulation.id, "label.consistency_checked", {
        detail: `${consistencyFindings.length} finding(s)`,
        metadata: { labelId: selectedLabel.id, blockingCount: String(consistencyFindings.filter((f) => f.severity === "blocking").length) },
      }),
    );
    await onAuditChanged();
  };

  const labelsAuditLog = auditLog.filter((e) => e.action.startsWith("label."));
  const claimsAuditLog = auditLog.filter((e) => e.action.startsWith("claim."));

  // -------------------------------------------------------------- rendering
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tags size={14} className="text-accent" />
        <h2 className="text-[14px] font-medium text-text">{t("claimsLabels.heading")}</h2>
        <div className="flex flex-wrap gap-1">
          {TOP_SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setTopSection(s)}
              className={cn("rounded px-2 py-1 text-[11px]", topSection === s ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface-2")}
            >
              {t(`claimsLabels.topSection.${s}`)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-[10px] text-muted">
          {t("claimsLabels.actingAsRole")}
          <select value={reviewerRole} onChange={(e) => setReviewerRole(e.target.value as ApprovalRole)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
            {APPROVAL_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}

      {topSection === "claims" && (
        <div>
          {!selectedClaim && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select value={claimStatusFilter} onChange={(e) => setClaimStatusFilter(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.allStatuses")}</option>
                  {CLAIM_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select value={claimJurisdictionFilter} onChange={(e) => setClaimJurisdictionFilter(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.allJurisdictions")}</option>
                  {REGULATORY_JURISDICTIONS.map((j) => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
                <select value={claimRiskFilter} onChange={(e) => setClaimRiskFilter(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.allRiskLevels")}</option>
                  {CLAIM_RISK_LEVELS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{t(`claimsLabels.readiness.${claimsReadiness.overallReadiness}`)}</span>
                <div className="flex-1" />
                <button onClick={exportClaimsJson} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                  {t("claimsLabels.exportJson")}
                </button>
                <button onClick={exportClaimsCsv} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                  {t("claimsLabels.exportCsv")}
                </button>
                <button onClick={() => void exportClaimsXlsx()} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                  {t("claimsLabels.exportXlsx")}
                </button>
                <button onClick={exportClaimReviewSummaryCsv} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                  {t("claimsLabels.exportReviewSummary")}
                </button>
                <button
                  onClick={() => {
                    setImportingClaims(true);
                    setClaimImportVersionId(versions[0]?.id ?? "");
                    setClaimImportError(null);
                    setClaimImportPreview(null);
                  }}
                  className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
                >
                  <Upload size={12} /> {t("claimsLabels.importClaims")}
                </button>
                <button onClick={openCreateClaim} className="flex items-center gap-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
                  <Plus size={12} /> {t("claimsLabels.newClaim")}
                </button>
              </div>

              {filteredClaims.length === 0 ? (
                <div className="rounded-card border border-dashed border-border-faint px-4 py-8 text-center">
                  <p className="mb-2 text-[12px] text-muted">{t("claimsLabels.emptyClaimsState")}</p>
                  <button onClick={openCreateClaim} className="rounded-input border border-accent px-3 py-1.5 text-[11px] text-accent hover:bg-accent/10">
                    {t("claimsLabels.newClaim")}
                  </button>
                </div>
              ) : (
                <ul className="space-y-1">
                  {filteredClaims.map((c) => {
                    const effective = deriveClaimEffectiveStatus(c, claims);
                    const findings = findingsByClaimId.get(c.id) ?? [];
                    const risk = deriveClaimRisk(c, findings);
                    const conflict = claimConflicts.some((cf) => cf.claimAId === c.id || cf.claimBId === c.id);
                    return (
                      <li key={c.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                        <button onClick={() => { setSelectedClaimId(c.id); setClaimSection("overview"); }} className="flex w-full flex-wrap items-center gap-1.5 text-left">
                          <span className="text-text">{c.claimCode}</span>
                          <span className="text-[10px] text-muted">{c.claimText}</span>
                          <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{c.claimCategory}</span>
                          <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{c.jurisdictions.join(", ")}</span>
                          {conflict && <ShieldAlert size={11} className="text-warn" />}
                          <span className={cn("rounded px-1.5 py-0.5 text-[9px]", RISK_STYLE[risk])}>{risk}</span>
                          <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[9px]", CLAIM_STATUS_STYLE[effective])}>{effective}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {selectedClaim && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button onClick={() => setSelectedClaimId(null)} className="flex items-center gap-1 text-[11px] text-muted hover:text-text">
                  <ArrowLeft size={12} /> {t("claimsLabels.backToClaims")}
                </button>
                <span className="text-[12px] font-medium text-text">{selectedClaim.claimCode}</span>
                <span className="text-[11px] text-muted">{selectedClaim.claimText}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-[9px]", RISK_STYLE[derivedClaimRisk])}>{derivedClaimRisk}</span>
                <div className="flex-1" />
                <div className="flex flex-wrap gap-1">
                  {CLAIM_DETAIL_SECTIONS.map((s) => (
                    <button key={s} onClick={() => setClaimSection(s)} className={cn("rounded px-2 py-1 text-[11px]", claimSection === s ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface-2")}>
                      {t(`claimsLabels.claimSection.${s}`)}
                    </button>
                  ))}
                </div>
              </div>

              {claimSection === "overview" && (
                <div className="space-y-2">
                  <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                    <p className="mb-1 font-medium text-muted">{t("claimsLabels.statusHeading")}</p>
                    {isClaimImmutable(selectedClaim) ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text">{selectedClaim.status}</span>
                        <span className="text-[10px] text-muted">{t("claimsLabels.immutableNotice")}</span>
                        <button onClick={() => setRevisingClaim(true)} className="rounded-input border border-accent px-2 py-1 text-[10px] text-accent hover:bg-accent/10">
                          {t("claimsLabels.createRevision")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={claimStatusDraft} onChange={(e) => setClaimStatusDraft(e.target.value as ClaimStatus)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                          {CLAIM_STATUSES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <button onClick={() => void doChangeClaimStatus()} disabled={claimStatusDraft === selectedClaim.status} className="rounded-input border border-accent px-2 py-1 text-[10px] text-accent hover:bg-accent/10 disabled:opacity-40">
                          {t("common:actions.save")}
                        </button>
                      </div>
                    )}
                    {revisingClaim && (
                      <div className="mt-2 space-y-1.5 border-t border-border-faint pt-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.claimText")}</span>
                          <textarea value={reviseClaimText || selectedClaim.claimText} onChange={(e) => setReviseClaimText(e.target.value)} rows={2} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                        </label>
                        <div className="flex gap-2">
                          <button onClick={() => void doReviseClaim()} className="rounded-input bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90">{t("common:actions.save")}</button>
                          <button onClick={() => setRevisingClaim(false)} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">{t("common:actions.cancel")}</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                    <p className="mb-1 font-medium text-muted">{t("claimsLabels.derivedAssessment")}</p>
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className={cn("rounded px-1.5 py-0.5", CLAIM_STATUS_STYLE[derivedClaimStatus])}>{t("claimsLabels.derivedStatus", { status: derivedClaimStatus })}</span>
                      <span className={cn("rounded px-1.5 py-0.5", RISK_STYLE[derivedClaimRisk])}>{t("claimsLabels.derivedRisk", { risk: derivedClaimRisk })}</span>
                    </div>
                    <p className="mt-1 text-[9px] text-muted">{t("claimsLabels.derivedNotice")}</p>
                  </div>
                  {combinedClaimFindings.length > 0 && (
                    <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                      <p className="mb-1 font-medium text-muted">{t("claimsLabels.findingsHeading")}</p>
                      <ul className="space-y-1">
                        {combinedClaimFindings.map((f, i) => (
                          <li key={i} className={cn("rounded px-1.5 py-1 text-[10px]", f.severity === "blocking" ? "bg-error/10 text-error" : "bg-warn/10 text-warn")}>
                            <span className="font-medium">{f.findingType}</span> — {f.message}
                            {f.humanReviewRequired && <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t("claimsLabels.humanReviewRequiredTag")}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {claimSection === "evidence" && (
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <select value={linkEvidenceId} onChange={(e) => setLinkEvidenceId(e.target.value)} aria-label={t("claimsLabels.selectEvidence")} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                      <option value="">{t("claimsLabels.selectEvidence")}</option>
                      {eligibleEvidenceForClaim.map((e) => (
                        <option key={e.id} value={e.id}>{e.title}</option>
                      ))}
                    </select>
                    <button onClick={() => void doProposeClaimLink()} disabled={!linkEvidenceId} className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40">
                      {t("claimsLabels.proposeLink")}
                    </button>
                    <span className="text-[10px] text-muted">{t("claimsLabels.evidenceFromDossier")}</span>
                  </div>
                  <ul className="space-y-1">
                    {claimActiveLinks.map((link) => {
                      const evidence = dossierEvidence.find((e) => e.id === link.evidenceItemId);
                      const eligibility = evidence
                        ? evaluateClaimEvidenceEligibility(evidence, { formulaVersionId: selectedClaim.formulaVersionId, packagingSkuCode: selectedClaim.packagingSkuCode, jurisdictions: selectedClaim.jurisdictions })
                        : { eligible: false, reason: EVIDENCE_RECORD_MISSING };
                      return (
                        <li key={link.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-text">{evidence?.title ?? link.evidenceItemId}</span>
                            <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{link.linkStatus}</span>
                            {!eligibility.eligible && <span className="rounded bg-error/10 px-1 py-0.5 text-[9px] text-error">{eligibility.reason}</span>}
                            <div className="ml-auto flex gap-1.5">
                              {link.linkStatus === "proposed" && (
                                <>
                                  <button onClick={() => void doAcceptClaimLink(link)} className="text-[10px] text-accent hover:underline">{t("claimsLabels.acceptLink")}</button>
                                  <button onClick={() => void doRejectClaimLink(link)} className="text-[10px] text-error hover:underline">{t("claimsLabels.rejectLink")}</button>
                                </>
                              )}
                              {link.linkStatus === "accepted" && (
                                <button onClick={() => void doRevokeClaimLink(link)} className="text-[10px] text-error hover:underline">{t("claimsLabels.revokeLink")}</button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                    {claimActiveLinks.length === 0 && <p className="text-[11px] text-muted">{t("claimsLabels.noEvidenceLinks")}</p>}
                  </ul>
                </div>
              )}

              {claimSection === "reviews" && (
                <div>
                  {canActRegulatory && (
                    <div className="mb-3 rounded-card border border-border p-2.5">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.col.jurisdiction")}</span>
                          <select value={claimReviewJurisdiction} onChange={(e) => setClaimReviewJurisdiction(e.target.value as RegulatoryJurisdiction)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                            {selectedClaim.jurisdictions.map((j) => (
                              <option key={j} value={j}>{j}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.col.language")}</span>
                          <select value={claimReviewLanguage} onChange={(e) => setClaimReviewLanguage(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                            {selectedClaim.languages.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.reviewOutcome")}</span>
                          <select value={claimReviewOutcome} onChange={(e) => setClaimReviewOutcome(e.target.value as ClaimReview["outcome"])} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                            {CLAIM_REVIEW_OUTCOMES.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.reviewConditions")}</span>
                          <input value={claimReviewConditions} onChange={(e) => setClaimReviewConditions(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.reviewNotes")}</span>
                          <textarea value={claimReviewNotes} onChange={(e) => setClaimReviewNotes(e.target.value)} rows={2} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                        </label>
                      </div>
                      <div className="mt-2">
                        <button onClick={() => void submitClaimReview()} disabled={!claimReviewNotes.trim()} className="rounded-input bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
                          {t("claimsLabels.recordReview")}
                        </button>
                      </div>
                    </div>
                  )}
                  <ul className="space-y-1">
                    {claimReviewsForSelected.map((r) => {
                      const active = isClaimReviewActive(r, claimReviewRevocations, 1);
                      return (
                        <li key={r.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={cn("rounded px-1.5 py-0.5 text-[9px]", CLAIM_STATUS_STYLE[r.outcome] ?? "bg-surface-2 text-muted")}>{r.outcome}</span>
                            <span className="text-[10px] text-muted">{r.jurisdiction}/{r.language}</span>
                            <span className="text-[10px] text-muted">{r.reviewedBy}</span>
                            <span className="text-[10px] text-muted">{new Date(r.reviewedAt).toLocaleString()}</span>
                            {!active && <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t("claimsLabels.revokedTag")}</span>}
                            {active && canActRegulatory && (
                              <button onClick={() => void doRevokeClaimReview(r)} className="ml-auto text-[10px] text-error hover:underline">{t("claimsLabels.revokeReview")}</button>
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted">{r.notes}</p>
                        </li>
                      );
                    })}
                    {claimReviewsForSelected.length === 0 && <p className="text-[11px] text-muted">{t("claimsLabels.noReviews")}</p>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {topSection === "labels" && (
        <div>
          {!selectedLabel && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select value={labelStatusFilter} onChange={(e) => setLabelStatusFilter(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.allStatuses")}</option>
                  {LABEL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select value={labelJurisdictionFilter} onChange={(e) => setLabelJurisdictionFilter(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.allJurisdictions")}</option>
                  {REGULATORY_JURISDICTIONS.map((j) => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
                <select value={labelLanguageFilter} onChange={(e) => setLabelLanguageFilter(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.allLanguages")}</option>
                  {LABEL_UI_LANGUAGES.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <div className="flex-1" />
                <button onClick={exportLabelReadinessSummaryCsv} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                  {t("claimsLabels.exportReadinessSummary")}
                </button>
                <button onClick={openCreateLabel} className="flex items-center gap-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
                  <Plus size={12} /> {t("claimsLabels.newLabel")}
                </button>
              </div>

              {filteredLabels.length === 0 ? (
                <div className="rounded-card border border-dashed border-border-faint px-4 py-8 text-center">
                  <p className="mb-2 text-[12px] text-muted">{t("claimsLabels.emptyLabelsState")}</p>
                  <button onClick={openCreateLabel} className="rounded-input border border-accent px-3 py-1.5 text-[11px] text-accent hover:bg-accent/10">
                    {t("claimsLabels.newLabel")}
                  </button>
                </div>
              ) : (
                <ul className="space-y-1">
                  {filteredLabels.map((l) => {
                    const effective = deriveLabelEffectiveStatus(l, labels);
                    return (
                      <li key={l.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                        <button onClick={() => { setSelectedLabelId(l.id); setLabelSection("overview"); }} className="flex w-full flex-wrap items-center gap-1.5 text-left">
                          <span className="text-text">{l.labelCode}</span>
                          <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{l.jurisdiction}</span>
                          <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{l.language}</span>
                          {l.packagingSkuCode && <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{l.packagingSkuCode}</span>}
                          <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t("claimsLabels.revisionLabel", { n: l.revision })}</span>
                          <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[9px]", LABEL_STATUS_STYLE[effective])}>{effective}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {selectedLabel && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button onClick={() => setSelectedLabelId(null)} className="flex items-center gap-1 text-[11px] text-muted hover:text-text">
                  <ArrowLeft size={12} /> {t("claimsLabels.backToLabels")}
                </button>
                <span className="text-[12px] font-medium text-text">{selectedLabel.labelCode}</span>
                {labelReadiness && <span className={cn("rounded px-1.5 py-0.5 text-[9px]", READINESS_STYLE[labelReadiness.overallReadiness])}>{t(`claimsLabels.readiness.${labelReadiness.overallReadiness}`)}</span>}
                <div className="flex-1" />
                <div className="flex flex-wrap gap-1">
                  {LABEL_DETAIL_SECTIONS.map((s) => (
                    <button key={s} onClick={() => setLabelSection(s)} className={cn("rounded px-2 py-1 text-[11px]", labelSection === s ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface-2")}>
                      {t(`claimsLabels.labelSection.${s}`)}
                    </button>
                  ))}
                </div>
              </div>

              {labelSection === "overview" && (
                <div className="space-y-2">
                  <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                    <p className="mb-1 font-medium text-muted">{t("claimsLabels.statusHeading")}</p>
                    {isLabelImmutable(selectedLabel) ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text">{selectedLabel.status}</span>
                        <span className="text-[10px] text-muted">{t("claimsLabels.immutableNotice")}</span>
                        <button onClick={() => void doReviseLabel()} className="rounded-input border border-accent px-2 py-1 text-[10px] text-accent hover:bg-accent/10">
                          {t("claimsLabels.createRevision")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={labelStatusDraft} onChange={(e) => setLabelStatusDraft(e.target.value as LabelStatus)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                          {LABEL_STATUSES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <button onClick={() => void doChangeLabelStatus()} disabled={labelStatusDraft === selectedLabel.status} className="rounded-input border border-accent px-2 py-1 text-[10px] text-accent hover:bg-accent/10 disabled:opacity-40">
                          {t("common:actions.save")}
                        </button>
                      </div>
                    )}
                  </div>
                  {labelReadiness && (
                    <div className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                      <p className="mb-1 font-medium text-muted">{t("claimsLabels.readinessSummary")}</p>
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        <span className="rounded bg-surface-2 px-1.5 py-0.5">{t("claimsLabels.totalRequirements", { n: labelReadiness.totalRequirements })}</span>
                        <span className="rounded bg-success/10 px-1.5 py-0.5 text-success">{t("claimsLabels.presentRequirements", { n: labelReadiness.presentRequirements })}</span>
                        <span className="rounded bg-error/10 px-1.5 py-0.5 text-error">{t("claimsLabels.missingRequirements", { n: labelReadiness.missingRequirements })}</span>
                        <span className="rounded bg-error/10 px-1.5 py-0.5 text-error">{t("claimsLabels.humanReviewRequired", { n: labelReadiness.humanReviewRequiredCount })}</span>
                        {labelReadiness.languagesMissing.length > 0 && (
                          <span className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{t("claimsLabels.languagesMissing", { list: labelReadiness.languagesMissing.join(", ") })}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {labelSection === "content" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button onClick={exportLabelContentJson} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                      {t("claimsLabels.exportJson")}
                    </button>
                    <button onClick={exportLabelContentCsv} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                      {t("claimsLabels.exportCsv")}
                    </button>
                    <button onClick={() => void exportLabelContentXlsx()} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                      {t("claimsLabels.exportXlsx")}
                    </button>
                    <button
                      onClick={() => {
                        setImportingContent(true);
                        setContentImportError(null);
                        setContentImportPreview(null);
                      }}
                      className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
                    >
                      <Upload size={12} /> {t("claimsLabels.importContent")}
                    </button>
                  </div>
                  {CONTENT_GROUPS.map((group) => (
                    <div key={group.key} className="rounded-card border border-border-faint px-3 py-2">
                      <p className="mb-1.5 text-[11px] font-medium text-muted">{t(`claimsLabels.contentGroup.${group.key}`)}</p>
                      <div className="space-y-2">
                        {group.blockTypes.map((blockType) => {
                          const row = labelContentRows.find((r) => r.requirement.blockType === blockType);
                          return (
                            <label key={blockType} className="block">
                              <span className="mb-1 flex items-center gap-1.5 text-[10px] text-muted">
                                {t(`claimsLabels.blockType.${blockType}`)}
                                {row && <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px]">{t(`claimsLabels.requirementState.${row.state}`)}</span>}
                              </span>
                              <textarea
                                value={contentDrafts[blockType] ?? ""}
                                onChange={(e) => setContentDrafts((prev) => ({ ...prev, [blockType]: e.target.value }))}
                                rows={2}
                                className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                              />
                              <button onClick={() => void doSaveContentBlock(blockType)} className="mt-1 rounded-input border border-border px-2 py-0.5 text-[10px] text-muted hover:bg-surface-2 hover:text-text">
                                {t("common:actions.save")}
                              </button>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {labelSection === "artwork" && (
                <div>
                  <div className="mb-3 rounded-card border border-border p-2.5">
                    <p className="mb-2 text-[11px] font-medium text-muted">{replacingArtwork ? t("claimsLabels.replaceArtwork") : t("claimsLabels.uploadArtwork")}</p>
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.artworkCode")}</span>
                      <input value={artworkCode} onChange={(e) => setArtworkCode(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                    </label>
                    <div className="mt-2">
                      <span className="mb-1 block text-[10px] text-muted">{t("dossier.attachments")}</span>
                      <AttachmentField formulationId={formulation.id} attachments={artworkAttachments} onChange={setArtworkAttachments} t={t} />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => void submitArtwork()} disabled={!artworkCode.trim()} className="rounded-input bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
                        {t("common:actions.save")}
                      </button>
                      {!artworkCode && (
                        <button onClick={openUploadArtwork} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
                          {t("claimsLabels.uploadArtwork")}
                        </button>
                      )}
                    </div>
                  </div>
                  <ul className="space-y-1">
                    {labelArtworksForSelected.map((a) => {
                      const effective = deriveArtworkEffectiveStatus(a, labelArtworksForSelected);
                      return (
                        <li key={a.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-text">{a.artworkCode}</span>
                            <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{effective}</span>
                            <span className="text-[10px] text-muted">{a.attachmentIds.length} {t("claimsLabels.attachmentCount")}</span>
                            {effective !== "superseded" && (
                              <div className="ml-auto flex gap-1.5">
                                {canActRegulatory && a.status === "uploaded" && (
                                  <>
                                    <button onClick={() => void doApproveArtwork(a)} className="text-[10px] text-accent hover:underline">{t("claimsLabels.approveArtwork")}</button>
                                    <button onClick={() => void doRejectArtwork(a)} className="text-[10px] text-error hover:underline">{t("claimsLabels.rejectArtwork")}</button>
                                  </>
                                )}
                                <button onClick={() => { setReplacingArtwork(a); setArtworkCode(`ART-${Date.now().toString(36).toUpperCase()}`); setArtworkAttachments([]); }} className="text-[10px] text-muted hover:underline">
                                  {t("claimsLabels.replaceArtwork")}
                                </button>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                    {labelArtworksForSelected.length === 0 && <p className="text-[11px] text-muted">{t("claimsLabels.noArtwork")}</p>}
                  </ul>
                </div>
              )}

              {labelSection === "reviews" && (
                <div>
                  {canActRegulatory && (
                    <div className="mb-3 rounded-card border border-border p-2.5">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.artwork")}</span>
                          <select value={labelReviewArtworkId} onChange={(e) => setLabelReviewArtworkId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                            <option value="">{t("claimsLabels.noArtwork")}</option>
                            {labelArtworksForSelected.map((a) => (
                              <option key={a.id} value={a.id}>{a.artworkCode}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.reviewOutcome")}</span>
                          <select value={labelReviewOutcome} onChange={(e) => setLabelReviewOutcome(e.target.value as LabelReview["outcome"])} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                            {LABEL_REVIEW_OUTCOMES.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.reviewNotes")}</span>
                          <textarea value={labelReviewNotes} onChange={(e) => setLabelReviewNotes(e.target.value)} rows={2} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                        </label>
                      </div>
                      <div className="mt-2">
                        <button onClick={() => void submitLabelReview()} disabled={!labelReviewNotes.trim()} className="rounded-input bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
                          {t("claimsLabels.recordReview")}
                        </button>
                      </div>
                    </div>
                  )}
                  <ul className="space-y-1">
                    {labelReviewsForSelected.map((r) => {
                      const active = isLabelReviewActive(r, labelReviewRevocations, selectedLabel.revision, r.artworkRevision);
                      return (
                        <li key={r.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] text-text">{r.outcome}</span>
                            <span className="text-[10px] text-muted">{r.reviewedBy}</span>
                            <span className="text-[10px] text-muted">{new Date(r.reviewedAt).toLocaleString()}</span>
                            {!active && <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t("claimsLabels.staleOrRevokedTag")}</span>}
                            {active && canActRegulatory && (
                              <button onClick={() => void doRevokeLabelReview(r)} className="ml-auto text-[10px] text-error hover:underline">{t("claimsLabels.revokeReview")}</button>
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted">{r.notes}</p>
                        </li>
                      );
                    })}
                    {labelReviewsForSelected.length === 0 && <p className="text-[11px] text-muted">{t("claimsLabels.noReviews")}</p>}
                  </ul>
                </div>
              )}

              {labelSection === "consistency" && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <button onClick={() => void doRunConsistencyCheck()} className="flex items-center gap-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
                      <ClipboardCheck size={12} /> {t("claimsLabels.runConsistencyCheck")}
                    </button>
                    {consistencyRan && <span className="text-[10px] text-muted">{t("claimsLabels.consistencyResultCount", { n: consistencyFindings.length })}</span>}
                  </div>
                  {consistencyRan && (
                    <ul className="space-y-1">
                      {consistencyFindings.map((f, i) => (
                        <li key={i} className={cn("rounded px-1.5 py-1 text-[10px]", f.severity === "blocking" ? "bg-error/10 text-error" : "bg-warn/10 text-warn")}>
                          <span className="font-medium">{f.code}</span> — {f.message}
                        </li>
                      ))}
                      {consistencyFindings.length === 0 && <p className="text-[11px] text-success">{t("claimsLabels.noConsistencyFindings")}</p>}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {topSection === "history" && (
        <div className="space-y-3">
          <div>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted"><History size={12} /> {t("claimsLabels.claimRevisionHistory")}</p>
            <ul className="space-y-1">
              {claims.filter((c) => !c.supersedesClaimId).map((c) => {
                const chain: ProductClaim[] = [c];
                let cursor = c;
                for (; ;) {
                  const next = claims.find((x) => x.supersedesClaimId === cursor.id);
                  if (!next) break;
                  chain.push(next);
                  cursor = next;
                }
                if (chain.length < 2) return null;
                return (
                  <li key={c.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                    <span className="text-text">{c.claimCode}</span>
                    <span className="ml-2 text-[10px] text-muted">{chain.map((x) => x.status).join(" → ")}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted"><History size={12} /> {t("claimsLabels.labelRevisionHistory")}</p>
            <ul className="space-y-1">
              {labels.filter((l) => !l.supersedesLabelId).map((l) => {
                const chain: ProductLabel[] = [l];
                let cursor = l;
                for (; ;) {
                  const next = labels.find((x) => x.supersedesLabelId === cursor.id);
                  if (!next) break;
                  chain.push(next);
                  cursor = next;
                }
                if (chain.length < 2) return null;
                return (
                  <li key={l.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                    <span className="text-text">{l.labelCode}</span>
                    <span className="ml-2 text-[10px] text-muted">{t("claimsLabels.revisionCount", { n: chain.length })}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted"><History size={12} /> {t("claimsLabels.artworkRevisionHistory")}</p>
            <ul className="space-y-1">
              {labelArtworks.filter((a) => !a.supersedesArtworkId && labelArtworks.some((x) => x.supersedesArtworkId === a.id)).map((a) => {
                const chain: LabelArtwork[] = [a];
                let cursor = a;
                for (; ;) {
                  const next = labelArtworks.find((x) => x.supersedesArtworkId === cursor.id);
                  if (!next) break;
                  chain.push(next);
                  cursor = next;
                }
                return (
                  <li key={a.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                    <span className="text-text">{a.artworkCode}</span>
                    <span className="ml-2 text-[10px] text-muted">{t("claimsLabels.revisionCount", { n: chain.length })}</span>
                  </li>
                );
              })}
              {labelArtworks.every((a) => !labelArtworks.some((x) => x.supersedesArtworkId === a.id)) && <p className="text-[11px] text-muted">{t("claimsLabels.noArtworkHistory")}</p>}
            </ul>
          </div>
        </div>
      )}

      {topSection === "audit" && (
        <ul className="space-y-1">
          {[...claimsAuditLog, ...labelsAuditLog]
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((e) => (
              <li key={e.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{e.action}</span>
                  <span className="text-[10px] text-muted">{new Date(e.at).toLocaleString()}</span>
                  <span className="text-[10px] text-muted">{e.actor}</span>
                </div>
                {e.detail && <p className="mt-0.5 text-[10px] text-muted">{e.detail}</p>}
              </li>
            ))}
          {claimsAuditLog.length === 0 && labelsAuditLog.length === 0 && <p className="text-[11px] text-muted">{t("claimsLabels.noAuditEvents")}</p>}
        </ul>
      )}

      {importingClaims && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("claimsLabels.importClaims")}>
          <div className="my-auto w-[36rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
            <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{t("claimsLabels.importClaims")}</h2>
            <div className="space-y-2 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.formulaVersion")}</span>
                <select value={claimImportVersionId} onChange={(e) => setClaimImportVersionId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.selectVersion")}</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>{t("claimsLabels.versionOption", { n: v.versionNumber })}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2 text-[10px]">
                {IMPORT_FORMATS.map((f) => (
                  <label key={f} className="flex items-center gap-1">
                    <input type="radio" checked={claimImportFormat === f} onChange={() => { setClaimImportFormat(f); setClaimImportPreview(null); }} /> {f}
                  </label>
                ))}
              </div>
              {claimImportFormat === "excel" ? (
                <input type="file" accept=".xlsx" onChange={(e) => setClaimImportFile(e.target.files?.[0] ?? null)} className="w-full text-[11px]" />
              ) : (
                <textarea
                  value={claimImportText}
                  onChange={(e) => setClaimImportText(e.target.value)}
                  placeholder={t("claimsLabels.importHint", { headers: CLAIM_IMPORT_HEADERS.join(", ") })}
                  rows={5}
                  className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
              )}
              <button
                onClick={() => void (claimImportFormat === "excel" ? previewClaimExcel() : previewClaimJsonOrCsv())}
                className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
              >
                {t("claimsLabels.previewImport")}
              </button>
              {claimImportError && <p className="text-[10px] text-error">{claimImportError}</p>}
              {claimImportPreview && (
                <div className="rounded-input border border-border-faint px-2 py-1.5 text-[10px]">
                  <p className="text-success">{t("claimsLabels.previewValidCount", { count: claimImportPreview.valid.length })}</p>
                  {claimImportPreview.duplicates > 0 && <p className="text-muted">{t("claimsLabels.previewDuplicateCount", { count: claimImportPreview.duplicates })}</p>}
                  {claimImportPreview.errors.map((e, i) => (
                    <p key={i} className="text-error">{e}</p>
                  ))}
                </div>
              )}
              <p className="text-[9px] text-muted">{t("claimsLabels.importUnverifiedNotice")}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setImportingClaims(false)} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">{t("common:actions.cancel")}</button>
              <button
                onClick={() => void commitImportClaims()}
                disabled={!claimImportVersionId || !claimImportPreview || claimImportPreview.valid.length === 0}
                className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                {t("claimsLabels.commitImport")}
              </button>
            </div>
          </div>
        </div>
      )}

      {creatingClaim && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("claimsLabels.newClaim")}>
          <div className="my-auto w-[36rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
            <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{t("claimsLabels.newClaim")}</h2>
            <div className="space-y-2 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.claimCode")}</span>
                <input value={claimDraftCode} onChange={(e) => setClaimDraftCode(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.claimText")}</span>
                <textarea value={claimDraftText} onChange={(e) => setClaimDraftText(e.target.value)} rows={2} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.claimCategory")}</span>
                <select value={claimDraftCategory} onChange={(e) => setClaimDraftCategory(e.target.value as ClaimCategory | "")} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.autoClassify")}</option>
                  {CLAIM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.formulaVersion")}</span>
                <select value={claimDraftVersionId} onChange={(e) => setClaimDraftVersionId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.selectVersion")}</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>{t("claimsLabels.versionOption", { n: v.versionNumber })}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.packagingSku")}</span>
                <select value={claimDraftSku} onChange={(e) => setClaimDraftSku(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.noPackagingSku")}</option>
                  {formulation.targetSkuCodes.map((sku) => (
                    <option key={sku} value={sku}>{sku}</option>
                  ))}
                </select>
              </label>
              <div>
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.jurisdictions")}</span>
                <div className="flex flex-wrap gap-2">
                  {REGULATORY_JURISDICTIONS.map((j) => (
                    <label key={j} className="flex items-center gap-1 text-[10px]">
                      <input type="checkbox" checked={claimDraftJurisdictions.includes(j)} onChange={(e) => setClaimDraftJurisdictions((prev) => (e.target.checked ? [...prev, j] : prev.filter((x) => x !== j)))} />
                      {j}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.languages")}</span>
                <div className="flex flex-wrap gap-2">
                  {LABEL_UI_LANGUAGES.map((l) => (
                    <label key={l} className="flex items-center gap-1 text-[10px]">
                      <input type="checkbox" checked={claimDraftLanguages.includes(l)} onChange={(e) => setClaimDraftLanguages((prev) => (e.target.checked ? [...prev, l] : prev.filter((x) => x !== l)))} />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setCreatingClaim(false)} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">{t("common:actions.cancel")}</button>
              <button onClick={() => void submitCreateClaim()} disabled={claimCreateBusy} className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">{t("common:actions.save")}</button>
            </div>
          </div>
        </div>
      )}

      {importingContent && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("claimsLabels.importContent")}>
          <div className="my-auto w-[36rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
            <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{t("claimsLabels.importContent")}</h2>
            <div className="space-y-2 px-5 py-4">
              <div className="flex gap-2 text-[10px]">
                {IMPORT_FORMATS.map((f) => (
                  <label key={f} className="flex items-center gap-1">
                    <input type="radio" checked={contentImportFormat === f} onChange={() => { setContentImportFormat(f); setContentImportPreview(null); }} /> {f}
                  </label>
                ))}
              </div>
              {contentImportFormat === "excel" ? (
                <input type="file" accept=".xlsx" onChange={(e) => setContentImportFile(e.target.files?.[0] ?? null)} className="w-full text-[11px]" />
              ) : (
                <textarea
                  value={contentImportText}
                  onChange={(e) => setContentImportText(e.target.value)}
                  placeholder={t("claimsLabels.importHint", { headers: LABEL_CONTENT_EXPORT_HEADERS.join(", ") })}
                  rows={5}
                  className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
              )}
              <button
                onClick={() => void (contentImportFormat === "excel" ? previewContentExcel() : previewContentJsonOrCsv())}
                className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
              >
                {t("claimsLabels.previewImport")}
              </button>
              {contentImportError && <p className="text-[10px] text-error">{contentImportError}</p>}
              {contentImportPreview && (
                <div className="rounded-input border border-border-faint px-2 py-1.5 text-[10px]">
                  <p className="text-success">{t("claimsLabels.previewValidCount", { count: contentImportPreview.valid.length })}</p>
                  {contentImportPreview.errors.map((e, i) => (
                    <p key={i} className="text-error">{e}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setImportingContent(false)} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">{t("common:actions.cancel")}</button>
              <button
                onClick={() => void commitImportContent()}
                disabled={!contentImportPreview || contentImportPreview.valid.length === 0}
                className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                {t("claimsLabels.commitImport")}
              </button>
            </div>
          </div>
        </div>
      )}

      {creatingLabel && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("claimsLabels.newLabel")}>
          <div className="my-auto w-[36rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
            <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{t("claimsLabels.newLabel")}</h2>
            <div className="space-y-2 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.labelCode")}</span>
                <input value={labelDraftCode} onChange={(e) => setLabelDraftCode(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.formulaVersion")}</span>
                <select value={labelDraftVersionId} onChange={(e) => setLabelDraftVersionId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.selectVersion")}</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>{t("claimsLabels.versionOption", { n: v.versionNumber })}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.packagingSku")}</span>
                <select value={labelDraftSku} onChange={(e) => setLabelDraftSku(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("claimsLabels.noPackagingSku")}</option>
                  {formulation.targetSkuCodes.map((sku) => (
                    <option key={sku} value={sku}>{sku}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.col.jurisdiction")}</span>
                <select value={labelDraftJurisdiction} onChange={(e) => setLabelDraftJurisdiction(e.target.value as RegulatoryJurisdiction)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  {REGULATORY_JURISDICTIONS.map((j) => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("claimsLabels.col.language")}</span>
                <select value={labelDraftLanguage} onChange={(e) => setLabelDraftLanguage(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  {LABEL_UI_LANGUAGES.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setCreatingLabel(false)} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">{t("common:actions.cancel")}</button>
              <button onClick={() => void submitCreateLabel()} disabled={labelCreateBusy} className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">{t("common:actions.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
