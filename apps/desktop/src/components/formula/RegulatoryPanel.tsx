/**
 * Kenya/EAC Regulatory Engine desktop workspace (Phase 2 closure).
 * Mirrors the split every other engine in this codebase already uses: a
 * durable, editable rule (`RegulatoryRule`) with its own append-only
 * revision history, evaluated live against the current draft
 * (`evaluateRegulatory` — never persisted as a snapshot; a live finding
 * is a live read of current rules + current formula), a human's
 * persisted evidence confirmation
 * (`RegulatoryEvidenceConfirmation` — replaces what used to be
 * session-local checkboxes), and a human's recorded regulatory review
 * bound to an EXACT saved formula version/jurisdiction/packaging SKU
 * (`RegulatoryReview`, append-only, never satisfying a different version
 * — see `engine/regulatoryReviews.ts`).
 *
 * Every seed rule (`SEED_REGULATORY_RULES`) is an explicit structural
 * placeholder — `not_verified`, `status: "draft"` — never presented as
 * verified legislation. See docs/REGULATORY_ENGINE.md.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, History, Plus, RotateCcw, Scale, ShieldCheck, Upload } from "lucide-react";
import {
  buildKenyaCatalog,
  classifyProductRegulatory,
  declareRegulatoryReviewEquivalence,
  deprecateRule,
  deriveRegulatoryReviewStatus,
  editRule,
  evaluateRegulatory,
  explainRegulatoryReviewStatus,
  findApplicableRegulatoryReview,
  initialRuleRevision,
  newId,
  parseCsv,
  recordEvidenceConfirmation,
  recordRegulatoryReview,
  rejectRuleVerification,
  revokeEvidenceConfirmation,
  revokeRegulatoryReview,
  revokeRegulatoryReviewEquivalence,
  setRuleActive,
  summarizeRegulatoryFindings,
  supersedeRule,
  toCsv,
  verifyRule,
  APPROVAL_ROLES,
  REGULATORY_JURISDICTIONS,
  SEED_REGULATORY_RULES,
  type Actor,
  type ApprovalRole,
  type Formulation,
  type FormulationLine,
  type FormulationVersion,
  type RawMaterial,
  type RegulatoryEvidenceConfirmation,
  type RegulatoryEvidenceConfirmationRevocation,
  type RegulatoryFinding,
  type RegulatoryJurisdiction,
  type RegulatoryReview,
  type RegulatoryReviewEquivalence,
  type RegulatoryReviewRevocation,
  type RegulatoryRule,
  type RegulatoryRuleRevision,
} from "@ai4s/shared";
import { buildXlsxBlob } from "@/lib/xlsx";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { appendAudit, auditEvent } from "@/lib/formulations";
import { cn } from "@/lib/cn";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

const FINDING_STATUS_STYLE: Record<string, string> = {
  compliant_with_rule: "bg-success/10 text-success",
  not_applicable: "bg-surface-2 text-muted",
  non_compliant: "bg-error/10 text-error",
  missing_data: "bg-warn/10 text-warn",
  human_review_required: "bg-warn/10 text-warn",
  unknown: "bg-error/10 text-error",
};

const REVIEW_STATUS_STYLE: Record<string, string> = {
  current: "bg-success/10 text-success",
  stale_formula_version: "bg-warn/10 text-warn",
  stale_rule_version: "bg-warn/10 text-warn",
  wrong_jurisdiction: "bg-surface-2 text-muted",
  wrong_packaging_sku: "bg-surface-2 text-muted",
  revoked: "bg-error/10 text-error",
  superseded: "bg-surface-2 text-muted",
  unknown: "bg-error/10 text-error",
};

const SECTIONS = ["findings", "rules", "reviews"] as const;
const IMPORT_FORMATS = ["json", "csv", "excel"] as const;

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const RULE_EXPORT_HEADERS = ["id", "code", "name", "jurisdiction", "authority", "ruleType", "requirement", "severity", "status", "verificationStatus", "active"];

export function RegulatoryPanel({
  formulation,
  currentLines,
  materials,
  versions,
}: {
  formulation: Formulation;
  currentLines: FormulationLine[];
  materials: RawMaterial[];
  versions: FormulationVersion[];
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;

  const [rules, setRules] = useState<RegulatoryRule[]>(SEED_REGULATORY_RULES);
  const [revisions, setRevisions] = useState<RegulatoryRuleRevision[]>([]);
  const [reviews, setReviews] = useState<RegulatoryReview[]>([]);
  const [reviewRevocations, setReviewRevocations] = useState<RegulatoryReviewRevocation[]>([]);
  const [reviewEquivalences, setReviewEquivalences] = useState<RegulatoryReviewEquivalence[]>([]);
  const [confirmations, setConfirmations] = useState<RegulatoryEvidenceConfirmation[]>([]);
  const [confirmationRevocations, setConfirmationRevocations] = useState<RegulatoryEvidenceConfirmationRevocation[]>([]);
  const [jurisdiction, setJurisdiction] = useState<RegulatoryJurisdiction>(
    (formulation.targetMarkets[0] as RegulatoryJurisdiction) ?? "KE",
  );
  const [packagingSkuCode, setPackagingSkuCode] = useState<string>(formulation.targetSkuCodes[0] ?? "");
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [reviewerRole, setReviewerRole] = useState<ApprovalRole>("regulatory");
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("findings");
  const [error, setError] = useState<string | null>(null);

  const actor: Actor = useMemo(() => ({ kind: "human", role: reviewerRole, userId: "local" }), [reviewerRole]);

  const load = async () => {
    const [ru, rv, rev, revrev, revequiv, conf, confrev] = await Promise.all([
      listRecordsSeeded("regulatory_rules", SEED_REGULATORY_RULES),
      listRecords("regulatory_rule_revisions"),
      listRecords("regulatory_reviews"),
      listRecords("regulatory_review_revocations"),
      listRecords("regulatory_review_equivalences"),
      listRecords("regulatory_evidence_confirmations"),
      listRecords("regulatory_evidence_confirmation_revocations"),
    ]);
    setRules(ru);
    setRevisions(rv);
    setReviews(rev.filter((r) => r.formulationId === formulation.id));
    setReviewRevocations(revrev);
    setReviewEquivalences(revequiv.filter((e) => e.formulationId === formulation.id));
    setConfirmations(conf.filter((c) => c.formulationId === formulation.id));
    setConfirmationRevocations(confrev);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulation.id]);

  const catalog = useMemo(() => buildKenyaCatalog(), []);
  const family = catalog.families.find((f) => f.code === formulation.productFamilyCode);

  const classification = useMemo(
    () =>
      family
        ? classifyProductRegulatory({ family, claims: formulation.targetClaims, market: jurisdiction })
        : { category: "human_review_required" as const, confidence: 0, reasoning: [t("regulatory.noFamilyMatch")], uncertain: true },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [family, formulation.targetClaims, jurisdiction],
  );

  const activeConfirmationsHere = confirmations.filter(
    (c) =>
      c.formulaVersionId === (selectedVersionId || "working_draft") &&
      c.jurisdiction === jurisdiction &&
      c.packagingSkuCode === (packagingSkuCode || undefined) &&
      c.status !== "revoked" &&
      !confirmationRevocations.some((r) => r.revokesConfirmationId === c.id) &&
      !confirmations.some((other) => other.revokesConfirmationId === c.id),
  );
  const confirmedRuleIds = activeConfirmationsHere.filter((c) => c.status === "confirmed" || c.status === "not_applicable").map((c) => c.ruleId!).filter(Boolean);
  const providedEvidenceRuleIds = new Set(confirmedRuleIds);

  const [evaluated, setEvaluated] = useState(false);

  const findings: RegulatoryFinding[] = useMemo(
    () =>
      evaluateRegulatory(currentLines, rules, {
        jurisdiction,
        category: classification.category,
        materials,
        claims: formulation.targetClaims,
        manuallyConfirmedRuleIds: confirmedRuleIds,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentLines, rules, jurisdiction, classification.category, materials, formulation.targetClaims, confirmedRuleIds.join(",")],
  );
  const summary = summarizeRegulatoryFindings(findings);

  const reviewCtx = { formulaVersionId: selectedVersionId || "working_draft", jurisdiction, packagingSkuCode: packagingSkuCode || undefined };
  const applicableReview = findApplicableRegulatoryReview(reviewCtx, reviews, reviewRevocations, reviewEquivalences, rules);
  const reviewStatusForCtx = applicableReview ? "current" : explainRegulatoryReviewStatus(reviewCtx, reviews, reviewRevocations, rules);

  // --- Evidence confirmations ------------------------------------------
  const confirmRequirement = async (f: RegulatoryFinding, status: "confirmed" | "not_available" | "not_applicable" | "rejected") => {
    if (!selectedVersionId) {
      setError(t("regulatory.needVersionForConfirmation"));
      return;
    }
    try {
      const confirmation = recordEvidenceConfirmation(
        {
          formulationId: formulation.id,
          formulaVersionId: selectedVersionId,
          jurisdiction,
          packagingSkuCode: packagingSkuCode || undefined,
          ruleId: f.ruleId,
          requirementType: "document",
          requirementCode: f.ruleCode,
          status,
        },
        actor,
      );
      await upsertRecords("regulatory_evidence_confirmations", [confirmation]);
      setConfirmations((prev) => [...prev, confirmation]);
      await appendAudit(
        auditEvent(formulation.id, "regulatory.confirmation_recorded", {
          versionId: selectedVersionId,
          detail: `${f.ruleCode}: ${status}`,
          metadata: { confirmationId: confirmation.id, ruleId: f.ruleId, jurisdiction, status },
        }),
      );
    } catch (e) {
      setError(String(e));
    }
  };

  const revokeConfirmationFor = async (ruleId: string) => {
    const confirmation = activeConfirmationsHere.find((c) => c.ruleId === ruleId);
    if (!confirmation) return;
    const reason = window.prompt(t("regulatory.revokeConfirmationReasonPrompt"));
    if (!reason) return;
    try {
      const revocation = revokeEvidenceConfirmation(confirmation.id, actor, reason);
      await upsertRecords("regulatory_evidence_confirmation_revocations", [revocation]);
      setConfirmationRevocations((prev) => [...prev, revocation]);
      await appendAudit(
        auditEvent(formulation.id, "regulatory.confirmation_revoked", {
          versionId: selectedVersionId,
          detail: reason,
          metadata: { confirmationId: confirmation.id, revocationId: revocation.id, ruleId },
        }),
      );
    } catch (e) {
      setError(String(e));
    }
  };

  // --- Rule lifecycle -------------------------------------------------
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draftJson, setDraftJson] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [historyForId, setHistoryForId] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const persistRule = async (rule: RegulatoryRule, revision: RegulatoryRuleRevision) => {
    await upsertRecords("regulatory_rules", [rule]);
    await upsertRecords("regulatory_rule_revisions", [revision]);
    setRules((prev) => (prev.some((r) => r.id === rule.id) ? prev.map((r) => (r.id === rule.id ? rule : r)) : [...prev, rule]));
    setRevisions((prev) => [...prev, revision]);
  };

  const openCreate = () => {
    setEditingId("new");
    const now = new Date().toISOString();
    setDraftJson(
      JSON.stringify(
        {
          schemaVersion: "1.0",
          id: newId("regrule"),
          code: `CUSTOM-${Date.now().toString(36)}`,
          name: "New rule",
          jurisdiction,
          authority: "",
          ruleType: "registration_requirement",
          productCategories: [],
          requirement: "",
          severity: "warning",
          status: "draft",
          conditions: [],
          claimKeywordsAny: [],
          requiredEvidenceTypes: [],
          requiredLabelElements: [],
          requiredWarnings: [],
          requiredDocumentTypes: [],
          requiredTestTypes: [],
          requiredPackagingElements: [],
          requiredLanguages: [],
          requiresRegistration: false,
          requiresNotification: false,
          requiresResponsiblePartyInMarket: false,
          requiresMarketSpecificIdentifier: false,
          version: 1,
          verificationStatus: "not_verified",
          humanReviewStatus: "review_required",
          active: true,
          createdBy: "local",
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      ),
    );
    setChangeReason("");
    setJsonError(null);
  };

  const openEdit = (rule: RegulatoryRule) => {
    setEditingId(rule.id);
    setDraftJson(JSON.stringify(rule, null, 2));
    setChangeReason("");
    setJsonError(null);
  };

  const submit = async () => {
    let parsed: RegulatoryRule;
    try {
      parsed = JSON.parse(draftJson) as RegulatoryRule;
    } catch {
      setJsonError(t("regulatory.invalidJson"));
      return;
    }
    try {
      if (editingId === "new") {
        const revision = initialRuleRevision(parsed, actor);
        await persistRule(parsed, revision);
      } else {
        const current = rules.find((r) => r.id === editingId);
        if (!current) return;
        if (!changeReason.trim()) {
          setJsonError(t("regulatory.changeReasonRequired"));
          return;
        }
        const { rule, revision } = editRule(current, parsed, actor, changeReason);
        await persistRule(rule, revision);
      }
      setEditingId(null);
    } catch (e) {
      setJsonError(String(e));
    }
  };

  const toggleActive = async (rule: RegulatoryRule) => {
    const { rule: updated, revision } = setRuleActive(rule, !rule.active, actor);
    await persistRule(updated, revision);
  };

  const deprecate = async (rule: RegulatoryRule) => {
    const reason = window.prompt(t("regulatory.deprecateReasonPrompt"));
    if (!reason) return;
    try {
      const { rule: updated, revision } = deprecateRule(rule, actor, reason);
      await persistRule(updated, revision);
    } catch (e) {
      setError(String(e));
    }
  };

  const verify = async (rule: RegulatoryRule) => {
    try {
      const { rule: updated, revision } = verifyRule(rule, actor);
      await persistRule(updated, revision);
      await appendAudit(auditEvent(formulation.id, "regulatory.rule_verified", { detail: rule.code, metadata: { ruleId: rule.id } }));
    } catch (e) {
      setError(String(e));
    }
  };

  const rejectVerification = async (rule: RegulatoryRule) => {
    const reason = window.prompt(t("regulatory.rejectVerificationReasonPrompt"));
    if (!reason) return;
    try {
      const { rule: updated, revision } = rejectRuleVerification(rule, actor, reason);
      await persistRule(updated, revision);
      await appendAudit(auditEvent(formulation.id, "regulatory.rule_verification_rejected", { detail: reason, metadata: { ruleId: rule.id } }));
    } catch (e) {
      setError(String(e));
    }
  };

  const supersede = async (rule: RegulatoryRule) => {
    const reason = window.prompt(t("regulatory.supersedeReasonPrompt"));
    if (!reason) return;
    try {
      const { rule: updated, revision } = supersedeRule(rule, actor, reason);
      await persistRule(updated, revision);
      await appendAudit(auditEvent(formulation.id, "regulatory.rule_superseded", { detail: reason, metadata: { ruleId: rule.id } }));
    } catch (e) {
      setError(String(e));
    }
  };

  // --- Import / export --------------------------------------------------
  const [importing, setImporting] = useState(false);
  const [importFormat, setImportFormat] = useState<"json" | "csv" | "excel">("json");
  const [importText, setImportText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{ valid: RegulatoryRule[]; errors: string[] } | null>(null);

  const jurisdictionRules = rules.filter((r) => r.jurisdiction === jurisdiction || r.jurisdiction === "EAC");

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(jurisdictionRules, null, 2)], { type: "application/json" });
    downloadBlob(`regulatory-rules-${jurisdiction}.json`, blob);
  };
  const exportCsv = () => {
    const rows = jurisdictionRules.map((r) => ({ ...r, active: r.active ? "yes" : "no" }));
    downloadBlob(`regulatory-rules-${jurisdiction}.csv`, new Blob([toCsv(RULE_EXPORT_HEADERS, rows)], { type: "text/csv;charset=utf-8" }));
  };
  const exportExcel = async () => {
    const rows = jurisdictionRules.map((r) => ({ ...r, active: r.active ? "yes" : "no" }));
    downloadBlob(`regulatory-rules-${jurisdiction}.xlsx`, await buildXlsxBlob(RULE_EXPORT_HEADERS, rows, "regulatory-rules"));
  };

  // A flat CSV/Excel row can only ever carry the scalar fields — never
  // arrays. Any array/boolean field the row doesn't supply gets its
  // schema default, the same defaults `def()` (catalog/regulatoryRules.ts)
  // uses for seed rules, rather than leaving it `undefined` and crashing
  // `evaluateRegulatory` the moment the imported rule is actually
  // evaluated. A JSON row that already supplies a real array is kept as-is.
  function normalizeImportedRow(row: Record<string, unknown>): RegulatoryRule {
    const now = new Date().toISOString();
    const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    return {
      schemaVersion: "1.0",
      id: String(row.id),
      code: String(row.code),
      name: String(row.name ?? row.code),
      jurisdiction: row.jurisdiction as RegulatoryRule["jurisdiction"],
      authority: String(row.authority ?? ""),
      ruleType: row.ruleType as RegulatoryRule["ruleType"],
      productCategories: asArray(row.productCategories) as RegulatoryRule["productCategories"],
      requirement: String(row.requirement ?? ""),
      severity: (row.severity as RegulatoryRule["severity"]) ?? "warning",
      status: (row.status as RegulatoryRule["status"]) ?? "draft",
      conditions: asArray(row.conditions) as RegulatoryRule["conditions"],
      claimKeywordsAny: asArray(row.claimKeywordsAny) as string[],
      requiredEvidenceTypes: asArray(row.requiredEvidenceTypes) as string[],
      requiredLabelElements: asArray(row.requiredLabelElements) as string[],
      requiredWarnings: asArray(row.requiredWarnings) as string[],
      requiredDocumentTypes: asArray(row.requiredDocumentTypes) as string[],
      requiredTestTypes: asArray(row.requiredTestTypes) as string[],
      requiredPackagingElements: asArray(row.requiredPackagingElements) as string[],
      requiredLanguages: asArray(row.requiredLanguages) as string[],
      requiresRegistration: row.requiresRegistration === true || row.requiresRegistration === "yes",
      requiresNotification: row.requiresNotification === true || row.requiresNotification === "yes",
      requiresResponsiblePartyInMarket: row.requiresResponsiblePartyInMarket === true || row.requiresResponsiblePartyInMarket === "yes",
      requiresMarketSpecificIdentifier: row.requiresMarketSpecificIdentifier === true || row.requiresMarketSpecificIdentifier === "yes",
      version: typeof row.version === "number" ? row.version : 1,
      verificationStatus: "imported_unverified",
      humanReviewStatus: "review_required",
      active: row.active === true || row.active === "yes" || row.active === undefined,
      createdBy: String(row.createdBy ?? "import"),
      createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
      updatedAt: now,
    };
  }

  function validateRow(row: Record<string, unknown>, index: number): { rule?: RegulatoryRule; error?: string } {
    if (!row.id || !row.code || !row.jurisdiction || !row.ruleType) {
      return { error: t("regulatory.importRowError", { row: index + 1, reason: t("regulatory.invalidShape") }) };
    }
    return { rule: normalizeImportedRow(row) };
  }

  const buildPreviewFromRows = (rows: Record<string, unknown>[]) => {
    const valid: RegulatoryRule[] = [];
    const errors: string[] = [];
    rows.forEach((row, i) => {
      const result = validateRow(row, i);
      if (result.rule) valid.push(result.rule);
      else if (result.error) errors.push(result.error);
    });
    setImportPreview({ valid, errors });
  };

  const previewJsonOrCsv = () => {
    setImportError(null);
    if (importFormat === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(importText);
      } catch {
        setImportError(t("regulatory.invalidJson"));
        return;
      }
      const arr = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
      buildPreviewFromRows(arr);
    } else if (importFormat === "csv") {
      const parsedRows = parseCsv(importText);
      if (parsedRows.length < 2) {
        setImportError(t("regulatory.invalidShape"));
        return;
      }
      const [header, ...dataRows] = parsedRows;
      const rows = dataRows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]])));
      buildPreviewFromRows(rows);
    }
  };

  const previewExcel = async () => {
    setImportError(null);
    if (!importFile) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await importFile.arrayBuffer());
    const sheet = wb.worksheets[0];
    if (!sheet) {
      setImportError(t("regulatory.invalidShape"));
      return;
    }
    const header = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
    const rows: Record<string, unknown>[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const values = (sheet.getRow(r).values as unknown[]).slice(1);
      if (values.every((v) => v === undefined || v === null || v === "")) continue;
      rows.push(Object.fromEntries(header.map((h, i) => [h, values[i]])));
    }
    buildPreviewFromRows(rows);
  };

  const commitImport = async () => {
    if (!importPreview || importPreview.valid.length === 0) return;
    // Imported rules never claim verification they haven't earned — force
    // an honest status regardless of what the source file says, same rule
    // RuleManager.tsx's compatibility/safety import already follows. An
    // import can never verify a rule (see engine/regulatoryRules.ts's
    // verifyRule — it is never called from this path).
    const withImportStatus = importPreview.valid.map((r) => ({ ...r, verificationStatus: "imported_unverified" as const })) as RegulatoryRule[];
    await upsertRecords("regulatory_rules", withImportStatus as never);
    setRules((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const r of withImportStatus) byId.set(r.id, r);
      return [...byId.values()];
    });
    setImporting(false);
    setImportText("");
    setImportFile(null);
    setImportPreview(null);
    setImportStatus(t("regulatory.importResult", { count: withImportStatus.length }));
  };

  // --- Human review -------------------------------------------------
  const [reviewOutcome, setReviewOutcome] = useState<RegulatoryReview["outcome"]>("compliant");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const recordReview = async () => {
    if (!selectedVersionId) {
      setError(t("regulatory.needVersionForReview"));
      return;
    }
    if (!reviewNotes.trim()) {
      setError(t("regulatory.reviewNeedsReviewerAndNotes"));
      return;
    }
    setReviewBusy(true);
    setError(null);
    try {
      const ruleVersionSnapshot = jurisdictionRules.map((r) => ({ ruleId: r.id, ruleCode: r.code, version: r.version, verificationStatus: r.verificationStatus }));
      const review = recordRegulatoryReview(
        {
          formulationId: formulation.id,
          formulaVersionId: selectedVersionId,
          jurisdiction,
          packagingSkuCode: packagingSkuCode || undefined,
          classificationSnapshot: classification,
          findingSnapshot: findings,
          ruleVersionSnapshot,
          outcome: reviewOutcome,
          notes: reviewNotes.trim(),
        },
        actor,
      );
      await upsertRecords("regulatory_reviews", [review]);
      setReviews((prev) => [...prev, review]);
      setReviewNotes("");
      await appendAudit(
        auditEvent(formulation.id, "regulatory.review_recorded", {
          versionId: selectedVersionId,
          detail: `${jurisdiction}: ${reviewOutcome}`,
          metadata: { reviewId: review.id, jurisdiction },
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setReviewBusy(false);
    }
  };

  const revokeReview = async (review: RegulatoryReview) => {
    const reason = window.prompt(t("regulatory.revokeReviewReasonPrompt"));
    if (!reason) return;
    try {
      const revocation = revokeRegulatoryReview(review.id, actor, reason);
      await upsertRecords("regulatory_review_revocations", [revocation]);
      setReviewRevocations((prev) => [...prev, revocation]);
      await appendAudit(
        auditEvent(formulation.id, "regulatory.review_revoked", {
          versionId: review.formulaVersionId,
          detail: reason,
          metadata: { reviewId: review.id, revocationId: revocation.id },
        }),
      );
    } catch (e) {
      setError(String(e));
    }
  };

  // --- Review equivalence reuse ---------------------------------------
  const [equivSourceVersionId, setEquivSourceVersionId] = useState("");
  const [equivJustification, setEquivJustification] = useState("");

  const declareEquivalence = async () => {
    if (!selectedVersionId || !equivSourceVersionId) return;
    try {
      const equivalence = declareRegulatoryReviewEquivalence(
        { formulationId: formulation.id, targetVersionId: selectedVersionId, sourceVersionId: equivSourceVersionId, jurisdiction, packagingSkuCode: packagingSkuCode || undefined, justification: equivJustification },
        actor,
      );
      await upsertRecords("regulatory_review_equivalences", [equivalence]);
      setReviewEquivalences((prev) => [...prev, equivalence]);
      setEquivJustification("");
      await appendAudit(
        auditEvent(formulation.id, "regulatory.review_reused", {
          versionId: selectedVersionId,
          detail: `${jurisdiction}: reused from ${equivSourceVersionId}`,
          metadata: { equivalenceId: equivalence.id, sourceVersionId: equivSourceVersionId, targetVersionId: selectedVersionId, jurisdiction },
        }),
      );
    } catch (e) {
      setError(String(e));
    }
  };

  const revokeEquivalence = async (equivalence: RegulatoryReviewEquivalence) => {
    const reason = window.prompt(t("regulatory.revokeReviewReasonPrompt"));
    if (!reason) return;
    try {
      const revoked = revokeRegulatoryReviewEquivalence(equivalence, actor, reason);
      await upsertRecords("regulatory_review_equivalences", [revoked]);
      setReviewEquivalences((prev) => [...prev, revoked]);
      await appendAudit(
        auditEvent(formulation.id, "regulatory.review_reuse_revoked", {
          versionId: equivalence.targetVersionId,
          detail: reason,
          metadata: { equivalenceId: equivalence.id },
        }),
      );
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Scale size={14} className="text-accent" />
        <h2 className="text-[14px] font-medium text-text">{t("regulatory.heading")}</h2>
        <select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
          <option value="">{t("regulatory.currentDraft")}</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {t("regulatory.versionOption", { n: v.versionNumber, status: v.status })}
            </option>
          ))}
        </select>
        <select
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value as RegulatoryJurisdiction)}
          className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
        >
          {REGULATORY_JURISDICTIONS.map((j) => (
            <option key={j} value={j}>
              {t(`regulatory.jurisdiction.${j}`)}
            </option>
          ))}
        </select>
        <select value={packagingSkuCode} onChange={(e) => setPackagingSkuCode(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
          <option value="">{t("regulatory.noPackagingSku")}</option>
          {formulation.targetSkuCodes.map((sku) => (
            <option key={sku} value={sku}>
              {sku}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <div className="flex gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={cn("rounded px-2 py-1 text-[11px]", section === s ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface-2")}
            >
              {t(`regulatory.section.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {!selectedVersionId && (
        <p className="mb-2 rounded-input bg-warn/10 px-2 py-1 text-[10px] text-warn">{t("regulatory.workingDraftNotice")}</p>
      )}

      {error && (
        <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}

      <div className="mb-3 rounded-card border border-border-faint px-3 py-2 text-[11px]">
        <p className="mb-1 font-medium text-muted">{t("regulatory.classificationHeading")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{t(`regulatory.category.${classification.category}`)}</span>
          <span className="text-[10px] text-muted">{t("regulatory.confidence", { pct: Math.round(classification.confidence * 100) })}</span>
          {classification.uncertain && <span className="rounded bg-warn/10 px-1.5 py-0.5 text-[9px] text-warn">{t("regulatory.uncertain")}</span>}
        </div>
        <ul className="mt-1 space-y-0.5 text-[10px] text-muted">
          {classification.reasoning.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      {section === "findings" && (
        <div>
          <div className="mb-2 flex flex-wrap gap-2 text-[10px]">
            <span className={cn("rounded px-1.5 py-0.5", FINDING_STATUS_STYLE.compliant_with_rule)}>{t("regulatory.summary.compliant", { n: summary.compliant })}</span>
            <span className={cn("rounded px-1.5 py-0.5", FINDING_STATUS_STYLE.non_compliant)}>{t("regulatory.summary.nonCompliant", { n: summary.nonCompliant })}</span>
            <span className={cn("rounded px-1.5 py-0.5", FINDING_STATUS_STYLE.missing_data)}>{t("regulatory.summary.missingData", { n: summary.missingData })}</span>
            <span className={cn("rounded px-1.5 py-0.5", FINDING_STATUS_STYLE.human_review_required)}>{t("regulatory.summary.humanReview", { n: summary.humanReviewRequired })}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">{t("regulatory.summary.blocking", { n: summary.blocking })}</span>
          </div>
          <button onClick={() => setEvaluated(true)} className="mb-2 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
            {t("regulatory.evaluate")}
          </button>
          {evaluated && (
            <ul className="space-y-1">
              {findings.map((f) => (
                <li key={f.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded px-1 py-0.5 text-[9px]", FINDING_STATUS_STYLE[f.status] ?? "bg-surface-2")}>{t(`regulatory.findingStatus.${f.status}`)}</span>
                    <span className="text-text">{f.ruleCode}</span>
                    <span className="text-[10px] text-muted">{f.reason}</span>
                  </div>
                  {f.affectedMaterialCodes.length > 0 && (
                    <p className="mt-0.5 text-[10px] text-muted">{t("regulatory.affectedMaterials", { codes: f.affectedMaterialCodes.join(", ") })}</p>
                  )}
                  {(providedEvidenceRuleIds.has(f.ruleId) || (f.status === "missing_data" || f.status === "human_review_required")) && (
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                      {providedEvidenceRuleIds.has(f.ruleId) ? (
                        <>
                          <span className="rounded bg-success/10 px-1.5 py-0.5 text-success">{t("regulatory.confirmedForThisVersion")}</span>
                          <button onClick={() => void revokeConfirmationFor(f.ruleId)} className="text-error hover:underline">
                            {t("regulatory.revokeAction")}
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => void confirmRequirement(f, "confirmed")} className="rounded bg-surface-2 px-1.5 py-0.5 text-muted hover:text-text">
                            {t("regulatory.confirmSatisfied")}
                          </button>
                          <button onClick={() => void confirmRequirement(f, "not_applicable")} className="rounded bg-surface-2 px-1.5 py-0.5 text-muted hover:text-text">
                            {t("regulatory.confirmNotApplicable")}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {f.evidenceRequired.length > 0 && <p className="mt-1 text-[9px] text-muted">{t("regulatory.evidenceRequiredList", { list: f.evidenceRequired.join(", ") })}</p>}
                </li>
              ))}
              {findings.length === 0 && <p className="text-[11px] text-muted">{t("regulatory.noFindings")}</p>}
            </ul>
          )}
        </div>
      )}

      {section === "rules" && (
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <button onClick={openCreate} className="flex items-center gap-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
              <Plus size={12} /> {t("regulatory.newRule")}
            </button>
            <button onClick={() => setImporting(true)} className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
              <Upload size={12} /> {t("regulatory.importJson")}
            </button>
            <button onClick={exportJson} className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
              <Download size={12} /> {t("regulatory.exportJson")}
            </button>
            <button onClick={exportCsv} className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
              <Download size={12} /> {t("regulatory.exportCsv")}
            </button>
            <button onClick={() => void exportExcel()} className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
              <Download size={12} /> {t("regulatory.exportExcel")}
            </button>
          </div>
          {importStatus && <p role="status" className="mb-2 text-[11px] text-success">{importStatus}</p>}

          <ul className="space-y-1">
            {jurisdictionRules.map((r) => (
              <li key={r.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-text">{r.code}</span>
                  <span className="text-[10px] text-muted">{r.name}</span>
                  <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{t(`regulatory.jurisdiction.${r.jurisdiction}`)}</span>
                  <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{r.ruleType}</span>
                  <span className={cn("rounded px-1 py-0.5 text-[9px]", r.verificationStatus === "verified" ? "bg-success/10 text-success" : r.verificationStatus === "rejected" ? "bg-error/10 text-error" : "bg-warn/10 text-warn")}>
                    {r.verificationStatus.replace(/_/g, " ")}
                  </span>
                  <span className="rounded px-1 py-0.5 text-[9px]" data-active={r.active}>
                    {r.active ? t("regulatory.activeYes") : t("regulatory.activeNo")}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    <button onClick={() => setHistoryForId(historyForId === r.id ? null : r.id)} className="flex items-center gap-1 text-[10px] text-accent hover:underline">
                      <History size={10} /> {t("regulatory.history")}
                    </button>
                    <button onClick={() => openEdit(r)} className="text-[10px] text-accent hover:underline">
                      {t("regulatory.edit")}
                    </button>
                    <button onClick={() => void toggleActive(r)} className="text-[10px] text-accent hover:underline">
                      {r.active ? t("regulatory.deactivate") : t("regulatory.activate")}
                    </button>
                    {r.verificationStatus !== "verified" && (
                      <button onClick={() => void verify(r)} className="flex items-center gap-1 text-[10px] text-success hover:underline">
                        <ShieldCheck size={10} /> {t("regulatory.verifyAction")}
                      </button>
                    )}
                    {r.verificationStatus !== "rejected" && (
                      <button onClick={() => void rejectVerification(r)} className="text-[10px] text-error hover:underline">
                        {t("regulatory.rejectVerificationAction")}
                      </button>
                    )}
                    {r.verificationStatus === "verified" && (
                      <button onClick={() => void supersede(r)} className="text-[10px] text-error hover:underline">
                        {t("regulatory.supersedeAction")}
                      </button>
                    )}
                    {r.status !== "deprecated" && (
                      <button onClick={() => void deprecate(r)} className="text-[10px] text-error hover:underline">
                        {t("regulatory.deprecateAction")}
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-0.5 text-[10px] text-muted">{r.requirement}</p>
                {(r.sourceAuthority || r.sourceReference) && (
                  <p className="mt-0.5 text-[9px] text-muted">
                    {t("regulatory.sourceSummary", { authority: r.sourceAuthority ?? "—", reference: r.sourceReference ?? "—" })}
                  </p>
                )}
                {historyForId === r.id && (
                  <ul className="mt-1.5 space-y-1 border-t border-border-faint pt-1.5">
                    {revisions
                      .filter((rv) => rv.ruleId === r.id)
                      .sort((a, b) => b.version - a.version)
                      .map((rv) => (
                        <li key={rv.id} className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
                          <span className="rounded bg-surface-2 px-1 py-0.5">{t("regulatory.version", { n: rv.version })}</span>
                          <span>{rv.changeType}</span>
                          <span>{rv.changeReason}</span>
                          <span>{rv.changedBy}</span>
                          <span>{new Date(rv.changedAt).toLocaleString()}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
            {jurisdictionRules.length === 0 && <p className="text-[11px] text-muted">{t("regulatory.noRules")}</p>}
          </ul>
        </div>
      )}

      {section === "reviews" && (
        <div>
          <div className="mb-2 flex items-center gap-2 rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
            <span className="text-muted">{t("regulatory.currentReviewStatus")}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[9px]", REVIEW_STATUS_STYLE[reviewStatusForCtx] ?? "bg-surface-2")}>{t(`regulatory.reviewStatus.${reviewStatusForCtx}`)}</span>
            {applicableReview?.reusedViaEquivalenceId && <span className="text-[9px] text-muted">{t("regulatory.reusedViaEquivalence")}</span>}
          </div>

          <div className="mb-3 rounded-card border border-border p-2.5">
            <p className="mb-2 text-[11px] font-medium text-muted">{t("regulatory.recordReview")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("regulatory.reviewerRoleLabel")}</span>
                <select value={reviewerRole} onChange={(e) => setReviewerRole(e.target.value as ApprovalRole)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  {APPROVAL_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("regulatory.outcomeLabel")}</span>
                <select
                  value={reviewOutcome}
                  onChange={(e) => setReviewOutcome(e.target.value as RegulatoryReview["outcome"])}
                  className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                >
                  <option value="compliant">{t("regulatory.outcomeCompliant")}</option>
                  <option value="conditionally_compliant">{t("regulatory.outcomeConditional")}</option>
                  <option value="non_compliant">{t("regulatory.outcomeNonCompliant")}</option>
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[10px] text-muted">{t("regulatory.reviewNotes")}</span>
                <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={3} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
              </label>
            </div>
            <button
              onClick={() => void recordReview()}
              disabled={reviewBusy || !selectedVersionId}
              className="mt-2 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {t("regulatory.saveReview")}
            </button>
            {!selectedVersionId && <p className="mt-1 text-[10px] text-muted">{t("regulatory.needVersionForReview")}</p>}
          </div>

          <ul className="space-y-1">
            {reviews
              .slice()
              .sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1))
              .map((r) => {
                const status = deriveRegulatoryReviewStatus(r, reviewCtx, reviewRevocations, reviews, rules);
                const versionLabel = versions.find((v) => v.id === r.formulaVersionId);
                return (
                  <li key={r.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px]">{t(`regulatory.jurisdiction.${r.jurisdiction}`)}</span>
                      <span className="text-[10px] text-muted">{versionLabel ? t("regulatory.versionOption", { n: versionLabel.versionNumber, status: versionLabel.status }) : r.formulaVersionId}</span>
                      {r.packagingSkuCode && <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">{r.packagingSkuCode}</span>}
                      <span className={cn("rounded px-1 py-0.5 text-[9px]", r.outcome === "compliant" ? "bg-success/10 text-success" : r.outcome === "non_compliant" ? "bg-error/10 text-error" : "bg-warn/10 text-warn")}>
                        {t(`regulatory.outcome.${r.outcome}`)}
                      </span>
                      <span className={cn("rounded px-1 py-0.5 text-[9px]", REVIEW_STATUS_STYLE[status] ?? "bg-surface-2")}>{t(`regulatory.reviewStatus.${status}`)}</span>
                      <span className="text-text">{r.reviewedBy}</span>
                      <span className="text-[10px] text-muted">({r.reviewerRole})</span>
                      <span className="text-[10px] text-muted">{new Date(r.reviewedAt).toLocaleString()}</span>
                      {status !== "revoked" && (
                        <button onClick={() => void revokeReview(r)} className="ml-auto text-[10px] text-error hover:underline">
                          {t("regulatory.revokeAction")}
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted">{r.notes}</p>
                  </li>
                );
              })}
            {reviews.length === 0 && <p className="text-[11px] text-muted">{t("regulatory.noReviews")}</p>}
          </ul>

          <div className="mt-3 rounded-card border border-border p-2.5">
            <p className="mb-2 text-[11px] font-medium text-muted">{t("regulatory.declareEquivalenceHeading")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("regulatory.equivalenceSourceVersion")}</span>
                <select value={equivSourceVersionId} onChange={(e) => setEquivSourceVersionId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                  <option value="">{t("regulatory.selectVersion")}</option>
                  {versions.filter((v) => v.id !== selectedVersionId).map((v) => (
                    <option key={v.id} value={v.id}>
                      {t("regulatory.versionOption", { n: v.versionNumber, status: v.status })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("regulatory.justification")}</span>
                <input value={equivJustification} onChange={(e) => setEquivJustification(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
              </label>
            </div>
            <button
              onClick={() => void declareEquivalence()}
              disabled={!selectedVersionId || !equivSourceVersionId || !equivJustification.trim()}
              className="mt-2 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {t("regulatory.declareEquivalenceAction")}
            </button>
            <ul className="mt-2 space-y-1">
              {reviewEquivalences.filter((e) => !e.revokesEquivalenceId).map((e) => {
                const revoked = reviewEquivalences.some((other) => other.revokesEquivalenceId === e.id);
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-1.5 rounded-input border border-border-faint px-2 py-1 text-[10px] text-muted">
                    <span>{t("regulatory.equivalenceSummary", { target: e.targetVersionId, source: e.sourceVersionId })}</span>
                    {revoked ? (
                      <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px]">{t("regulatory.reviewStatus.revoked")}</span>
                    ) : (
                      <button onClick={() => void revokeEquivalence(e)} className="ml-auto text-error hover:underline">
                        {t("regulatory.revokeAction")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {editingId !== null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("regulatory.newRule")}>
          <div className="my-auto w-[44rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
            <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{editingId === "new" ? t("regulatory.newRule") : t("regulatory.edit")}</h2>
            <div className="space-y-2 px-5 py-4">
              <p className="text-[11px] text-muted">{t("regulatory.jsonHint")}</p>
              <textarea
                value={draftJson}
                onChange={(e) => setDraftJson(e.target.value)}
                rows={16}
                className="w-full rounded-input border border-border bg-surface px-2 py-1.5 font-mono text-[11px] text-text outline-none focus:border-accent"
              />
              {editingId !== "new" && (
                <label className="block">
                  <span className="mb-1 block text-[10px] text-muted">{t("regulatory.changeReason")}</span>
                  <input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
                </label>
              )}
              {jsonError && <p className="text-[12px] text-error">{jsonError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setEditingId(null)} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">
                {t("common:actions.cancel")}
              </button>
              <button onClick={() => void submit()} className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90">
                {t("common:actions.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {importing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("regulatory.importJson")}>
          <div className="my-auto w-[42rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
            <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{t("regulatory.importJson")}</h2>
            <div className="space-y-2 px-5 py-4">
              <div className="flex gap-1">
                {IMPORT_FORMATS.map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => {
                      setImportFormat(fmt);
                      setImportPreview(null);
                      setImportError(null);
                    }}
                    className={cn("rounded px-2 py-1 text-[11px]", importFormat === fmt ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface-2")}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted">{t("regulatory.importHint")}</p>
              {importFormat !== "excel" ? (
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={10}
                  aria-label={t("regulatory.importJson")}
                  className="w-full rounded-input border border-border bg-surface px-2 py-1.5 font-mono text-[11px] text-text outline-none focus:border-accent"
                />
              ) : (
                <input type="file" accept=".xlsx" aria-label={t("regulatory.importExcelFile")} onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} className="text-[11px]" />
              )}
              <button
                onClick={() => void (importFormat === "excel" ? previewExcel() : previewJsonOrCsv())}
                className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2"
              >
                {t("regulatory.previewImport")}
              </button>
              {importError && <p className="text-[12px] text-error">{importError}</p>}
              {importPreview && (
                <div className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                  <p className="text-success">{t("regulatory.previewValidCount", { count: importPreview.valid.length })}</p>
                  {importPreview.errors.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-error">
                      {importPreview.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setImporting(false)} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">
                {t("common:actions.cancel")}
              </button>
              <button onClick={() => void commitImport()} disabled={!importPreview || importPreview.valid.length === 0} className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
                {t("regulatory.commitImport")}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-4 flex items-center gap-1 text-[9px] text-muted">
        <RotateCcw size={9} /> {t("regulatory.notLegalAdvice")}
      </p>
    </div>
  );
}
