/**
 * Kenya/EAC Regulatory Engine desktop workspace (Phase 2). Mirrors the
 * split every other engine in this codebase already uses: a durable,
 * editable rule (`RegulatoryRule`) with its own append-only revision
 * history (`RegulatoryRuleRevision`, same lifecycle as `ApprovalPolicy`/
 * `ApprovalPolicyRevision` via `engine/regulatoryRules.ts`'s
 * `editRule`/`setRuleActive`/`deprecateRule`), evaluated live against the
 * current draft (`evaluateRegulatory`, never persisted as a snapshot —
 * a finding is a live read of current rules + current formula, not a
 * frozen fact), and a human's recorded regulatory review
 * (`RegulatoryReview`, append-only sign-off).
 *
 * Every seed rule (`SEED_REGULATORY_RULES`) is an explicit structural
 * placeholder — `not_verified`, `status: "draft"` — never presented as
 * verified legislation. See docs/REGULATORY_ENGINE.md.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, History, Plus, RotateCcw, Scale, Upload } from "lucide-react";
import {
  buildKenyaCatalog,
  classifyProductRegulatory,
  deprecateRule,
  editRule,
  evaluateRegulatory,
  initialRuleRevision,
  newId,
  setRuleActive,
  summarizeRegulatoryFindings,
  NON_BLOCKING_FINDING_STATUSES,
  REGULATORY_JURISDICTIONS,
  SEED_REGULATORY_RULES,
  type Actor,
  type Formulation,
  type FormulationLine,
  type RawMaterial,
  type RegulatoryFinding,
  type RegulatoryJurisdiction,
  type RegulatoryReview,
  type RegulatoryRule,
  type RegulatoryRuleRevision,
} from "@ai4s/shared";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

const LOCAL_HUMAN: Actor = { kind: "human", role: "chemist", userId: "local" };

const FINDING_STATUS_STYLE: Record<string, string> = {
  compliant_with_rule: "bg-success/10 text-success",
  not_applicable: "bg-surface-2 text-muted",
  non_compliant: "bg-error/10 text-error",
  missing_data: "bg-warn/10 text-warn",
  human_review_required: "bg-warn/10 text-warn",
  unknown: "bg-error/10 text-error",
};

const SECTIONS = ["findings", "rules", "reviews"] as const;

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function RegulatoryPanel({
  formulation,
  currentLines,
  materials,
}: {
  formulation: Formulation;
  currentLines: FormulationLine[];
  materials: RawMaterial[];
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;

  const [rules, setRules] = useState<RegulatoryRule[]>(SEED_REGULATORY_RULES);
  const [revisions, setRevisions] = useState<RegulatoryRuleRevision[]>([]);
  const [reviews, setReviews] = useState<RegulatoryReview[]>([]);
  const [jurisdiction, setJurisdiction] = useState<RegulatoryJurisdiction>(
    (formulation.targetMarkets[0] as RegulatoryJurisdiction) ?? "KE",
  );
  const [section, setSection] = useState<"findings" | "rules" | "reviews">("findings");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const [ru, rv, rev] = await Promise.all([
        listRecordsSeeded("regulatory_rules", SEED_REGULATORY_RULES),
        listRecords("regulatory_rule_revisions"),
        listRecords("regulatory_reviews"),
      ]);
      setRules(ru);
      setRevisions(rv);
      setReviews(rev.filter((r) => r.formulationId === formulation.id));
    };
    void load();
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

  const [manuallyConfirmedRuleIds, setManuallyConfirmedRuleIds] = useState<Set<string>>(new Set());
  const [providedEvidenceTypes, setProvidedEvidenceTypes] = useState<Set<string>>(new Set());
  const [evaluated, setEvaluated] = useState(false);

  const findings: RegulatoryFinding[] = useMemo(
    () =>
      evaluateRegulatory(currentLines, rules, {
        jurisdiction,
        category: classification.category,
        materials,
        claims: formulation.targetClaims,
        providedEvidenceTypes: [...providedEvidenceTypes],
        manuallyConfirmedRuleIds: [...manuallyConfirmedRuleIds],
      }),
    [currentLines, rules, jurisdiction, classification.category, materials, formulation.targetClaims, providedEvidenceTypes, manuallyConfirmedRuleIds],
  );
  const summary = summarizeRegulatoryFindings(findings);

  const reviewForJurisdiction = reviews
    .filter((r) => r.jurisdiction === jurisdiction)
    .sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1))[0];

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
        const revision = initialRuleRevision(parsed, LOCAL_HUMAN);
        await persistRule(parsed, revision);
      } else {
        const current = rules.find((r) => r.id === editingId);
        if (!current) return;
        if (!changeReason.trim()) {
          setJsonError(t("regulatory.changeReasonRequired"));
          return;
        }
        const { rule, revision } = editRule(current, parsed, LOCAL_HUMAN, changeReason);
        await persistRule(rule, revision);
      }
      setEditingId(null);
    } catch (e) {
      setJsonError(String(e));
    }
  };

  const toggleActive = async (rule: RegulatoryRule) => {
    const { rule: updated, revision } = setRuleActive(rule, !rule.active, LOCAL_HUMAN);
    await persistRule(updated, revision);
  };

  const deprecate = async (rule: RegulatoryRule) => {
    const reason = window.prompt(t("regulatory.deprecateReasonPrompt"));
    if (!reason) return;
    const { rule: updated, revision } = deprecateRule(rule, LOCAL_HUMAN, reason);
    await persistRule(updated, revision);
  };

  // --- Import / export --------------------------------------------------
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
    downloadBlob(`regulatory-rules-${jurisdiction}.json`, blob);
  };

  const commitImport = async () => {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setImportError(t("regulatory.invalidJson"));
      return;
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const bad = arr.find((r) => typeof r !== "object" || !r || !("id" in r) || !("code" in r) || !("jurisdiction" in r) || !("ruleType" in r));
    if (bad) {
      setImportError(t("regulatory.invalidShape"));
      return;
    }
    // Imported rules never claim verification they haven't earned — force
    // an honest status regardless of what the source file says, same rule
    // RuleManager.tsx's compatibility/safety import already follows.
    const withImportStatus = (arr as RegulatoryRule[]).map((r) => ({ ...r, verificationStatus: "imported_unverified" as const }));
    await upsertRecords("regulatory_rules", withImportStatus as never);
    setRules((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const r of withImportStatus) byId.set(r.id, r);
      return [...byId.values()];
    });
    setImporting(false);
    setImportText("");
    setImportStatus(t("regulatory.importResult", { count: arr.length }));
  };

  // --- Human review -------------------------------------------------
  const [reviewOutcome, setReviewOutcome] = useState<RegulatoryReview["outcome"]>("compliant");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewedBy, setReviewedBy] = useState("local");
  const [reviewBusy, setReviewBusy] = useState(false);

  const recordReview = async () => {
    if (!reviewedBy.trim() || !reviewNotes.trim()) {
      setError(t("regulatory.reviewNeedsReviewerAndNotes"));
      return;
    }
    setReviewBusy(true);
    setError(null);
    try {
      const review: RegulatoryReview = {
        schemaVersion: "1.0",
        id: newId("regreview"),
        formulationId: formulation.id,
        versionId: "working_draft",
        jurisdiction,
        reviewedBy: reviewedBy.trim(),
        reviewedAt: new Date().toISOString(),
        outcome: reviewOutcome,
        notes: reviewNotes.trim(),
      };
      await upsertRecords("regulatory_reviews", [review]);
      setReviews((prev) => [...prev, review]);
      setReviewNotes("");
    } finally {
      setReviewBusy(false);
    }
  };

  const jurisdictionRules = rules.filter((r) => r.jurisdiction === jurisdiction || r.jurisdiction === "EAC");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Scale size={14} className="text-accent" />
        <h2 className="text-[14px] font-medium text-text">{t("regulatory.heading")}</h2>
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
                  {f.status === "missing_data" && !NON_BLOCKING_FINDING_STATUSES.includes(f.status) && (
                    <label className="mt-1 flex items-center gap-1.5 text-[10px] text-muted">
                      <input
                        type="checkbox"
                        checked={manuallyConfirmedRuleIds.has(f.ruleId)}
                        onChange={(e) =>
                          setManuallyConfirmedRuleIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(f.ruleId);
                            else next.delete(f.ruleId);
                            return next;
                          })
                        }
                      />
                      {t("regulatory.confirmSatisfied")}
                    </label>
                  )}
                  {f.evidenceRequired.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.evidenceRequired.map((e) => (
                        <label key={e} className="flex items-center gap-1 rounded bg-surface-2 px-1 py-0.5 text-[9px] text-muted">
                          <input
                            type="checkbox"
                            checked={providedEvidenceTypes.has(e)}
                            onChange={(ev) =>
                              setProvidedEvidenceTypes((prev) => {
                                const next = new Set(prev);
                                if (ev.target.checked) next.add(e);
                                else next.delete(e);
                                return next;
                              })
                            }
                          />
                          {e}
                        </label>
                      ))}
                    </div>
                  )}
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
                  <span className={cn("rounded px-1 py-0.5 text-[9px]", r.verificationStatus === "verified" ? "bg-success/10 text-success" : "bg-warn/10 text-warn")}>
                    {r.verificationStatus.replace(/_/g, " ")}
                  </span>
                  <span className="rounded px-1 py-0.5 text-[9px]" data-active={r.active}>
                    {r.active ? t("regulatory.activeYes") : t("regulatory.activeNo")}
                  </span>
                  <div className="ml-auto flex gap-1.5">
                    <button onClick={() => setHistoryForId(historyForId === r.id ? null : r.id)} className="flex items-center gap-1 text-[10px] text-accent hover:underline">
                      <History size={10} /> {t("regulatory.history")}
                    </button>
                    <button onClick={() => openEdit(r)} className="text-[10px] text-accent hover:underline">
                      {t("regulatory.edit")}
                    </button>
                    <button onClick={() => void toggleActive(r)} className="text-[10px] text-accent hover:underline">
                      {r.active ? t("regulatory.deactivate") : t("regulatory.activate")}
                    </button>
                    {r.status !== "deprecated" && (
                      <button onClick={() => void deprecate(r)} className="text-[10px] text-error hover:underline">
                        {t("regulatory.deprecateAction")}
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-0.5 text-[10px] text-muted">{r.requirement}</p>
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
          <div className="mb-3 rounded-card border border-border p-2.5">
            <p className="mb-2 text-[11px] font-medium text-muted">{t("regulatory.recordReview")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">{t("regulatory.reviewedBy")}</span>
                <input value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
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
              disabled={reviewBusy}
              className="mt-2 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {t("regulatory.saveReview")}
            </button>
          </div>

          <ul className="space-y-1">
            {reviews
              .slice()
              .sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1))
              .map((r) => (
                <li key={r.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-surface-2 px-1 py-0.5 text-[9px]">{t(`regulatory.jurisdiction.${r.jurisdiction}`)}</span>
                    <span className={cn("rounded px-1 py-0.5 text-[9px]", r.outcome === "compliant" ? "bg-success/10 text-success" : r.outcome === "non_compliant" ? "bg-error/10 text-error" : "bg-warn/10 text-warn")}>
                      {t(`regulatory.outcome.${r.outcome}`)}
                    </span>
                    <span className="text-text">{r.reviewedBy}</span>
                    <span className="text-[10px] text-muted">{new Date(r.reviewedAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted">{r.notes}</p>
                </li>
              ))}
            {reviews.length === 0 && <p className="text-[11px] text-muted">{t("regulatory.noReviews")}</p>}
          </ul>
        </div>
      )}

      {reviewForJurisdiction && section !== "reviews" && (
        <p className="mt-3 text-[10px] text-muted">
          {t("regulatory.lastReview", { who: reviewForJurisdiction.reviewedBy, at: new Date(reviewForJurisdiction.reviewedAt).toLocaleDateString(), outcome: t(`regulatory.outcome.${reviewForJurisdiction.outcome}`) })}
        </p>
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
          <div className="my-auto w-[40rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
            <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{t("regulatory.importJson")}</h2>
            <div className="space-y-2 px-5 py-4">
              <p className="text-[11px] text-muted">{t("regulatory.importHint")}</p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={12}
                aria-label={t("regulatory.importJson")}
                className="w-full rounded-input border border-border bg-surface px-2 py-1.5 font-mono text-[11px] text-text outline-none focus:border-accent"
              />
              {importError && <p className="text-[12px] text-error">{importError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setImporting(false)} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">
                {t("common:actions.cancel")}
              </button>
              <button onClick={() => void commitImport()} disabled={!importText.trim()} className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
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
