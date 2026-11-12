import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import {
  HUMAN_REVIEW_CLASSIFICATIONS,
  SEED_SAFETY_RULES,
  buildKenyaCatalog,
  classifyProductSafety,
  evaluateSafety,
  newId,
  summarizeSafetyFindings,
  recordSafetyResolution,
  can,
  type Formulation,
  type FormulationLine,
  type RawMaterial,
  type RuleSeverity,
  type SafetyFinding,
  type SafetyResolution,
  type SafetyRule,
} from "@formulab/shared";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { RuleManager } from "./RuleManager";
import { cn } from "@/lib/cn";
import { useTrustedActor } from "@/lib/currentActor";

const SEVERITY_TONE: Record<RuleSeverity, string> = {
  blocking: "border-error/50 bg-error/10 text-error",
  error: "border-error/40 bg-error/5 text-error",
  warning: "border-warn/40 bg-warn/5 text-warn",
  info: "border-border bg-surface-2 text-muted",
};

const SEVERITIES: readonly RuleSeverity[] = ["blocking", "error", "warning", "info"];

export function SafetyPanel({
  formulation,
  versionId,
  lines,
  onFocusLine,
}: {
  formulation: Formulation;
  versionId?: string;
  lines: FormulationLine[];
  onFocusLine: (lineId: string) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const actor = useTrustedActor();
  const canResolveSafety = Boolean(actor && can(actor.role, "formulation", "edit"));
  const [tab, setTab] = useState<"findings" | "rules">("findings");
  const [rules, setRules] = useState<SafetyRule[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [resolutions, setResolutions] = useState<SafetyResolution[]>([]);
  const [phTarget, setPhTarget] = useState("");
  const [processTempC, setProcessTempC] = useState("");
  const [severityFilter, setSeverityFilter] = useState<RuleSeverity | "">("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [resolving, setResolving] = useState<SafetyFinding | null>(null);

  const load = useCallback(async () => {
    const [r, m, res] = await Promise.all([
      listRecordsSeeded("safety_rules", SEED_SAFETY_RULES),
      listRecords("materials"),
      listRecords("safety_resolutions"),
    ]);
    setRules(r);
    setMaterials(m);
    setResolutions(res.filter((x) => x.formulationId === formulation.id));
  }, [formulation.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const catalog = useMemo(() => buildKenyaCatalog(), []);
  const family = catalog.families.find((f) => f.code === formulation.productFamilyCode);
  const classification = family
    ? classifyProductSafety(family, formulation.targetClaims)
    : "human_review_required";
  const needsHumanReview = HUMAN_REVIEW_CLASSIFICATIONS.includes(classification);
  const reviewAcknowledged = resolutions.some((r) => r.findingId === `classification:${classification}`);

  const findings = useMemo(
    () => evaluateSafety(lines, rules, { materials, phTarget: phTarget || undefined, processTempC: processTempC || undefined }),
    [lines, rules, materials, phTarget, processTempC],
  );

  const resolvedIds = new Set(resolutions.map((r) => r.findingId));
  const summary = summarizeSafetyFindings(findings);
  const visible = severityFilter ? findings.filter((f) => f.severity === severityFilter) : findings;
  const lineName = (lineId: string) => lines.find((l) => l.id === lineId)?.displayName ?? lineId;

  const saveSnapshot = async () => {
    if (!versionId) {
      setStatus(t("cost.needVersion"));
      return;
    }
    setSaving(true);
    try {
      await upsertRecords("safety_snapshots", [
        {
          schemaVersion: "1.0",
          code: newId("safetysnap"),
          formulationId: formulation.id,
          versionId,
          calculatedAt: new Date().toISOString(),
          productClassification: classification,
          ruleVersionsUsed: rules.map((r) => ({ ruleId: r.id, version: r.version })),
          findings,
        },
      ]);
      setStatus(t("safety.snapshotSaved"));
    } catch (e) {
      setStatus(String(e));
    } finally {
      setSaving(false);
    }
  };

  const persistResolution = async (findingId: string, reason: string, resolutionKind: SafetyResolution["resolutionKind"]) => {
    if (!actor) throw new Error("A signed-in human is required to record a safety resolution.");
    const resolution = recordSafetyResolution({
      schemaVersion: "1.0",
      id: newId("safetyres"),
      formulationId: formulation.id,
      versionId: versionId ?? "draft",
      findingId,
      resolvedAt: new Date().toISOString(),
      resolutionReason: reason,
      resolutionKind,
    }, { kind: "human", role: actor.role, userId: actor.userId });
    await upsertRecords("safety_resolutions", [resolution]);
    await load();
  };

  const acknowledgeClassification = async (reason: string) => {
    await persistResolution(`classification:${classification}`, reason, "accepted_risk");
  };

  const resolveFinding = async (finding: SafetyFinding, reason: string, kind: SafetyResolution["resolutionKind"]) => {
    await persistResolution(finding.id, reason, kind);
    setResolving(null);
    await load();
  };

  const showFindings = () => setTab("findings");
  const showRules = () => setTab("rules");

  if (tab === "rules") {
    return <RuleManager kind="safety" rules={rules} onBack={showFindings} onReload={load} />;
  }

  return (
    <div className="h-full overflow-auto px-5 py-4">
      <section className="mb-4 rounded-card border border-border px-3 py-2.5">
        <div className="flex items-center gap-2 text-[12px] font-medium text-text">
          <ShieldAlert size={14} aria-hidden />
          {t("safety.classification")}: {t(`safety.classificationValue.${classification}`)}
        </div>
        {needsHumanReview && !reviewAcknowledged && (
          <div className="mt-2">
            <p className="text-[11px] text-warn">{t("safety.humanReviewRequired")}</p>
            {canResolveSafety && actor ? <AcknowledgeForm reviewerName={actor.displayName} onSubmit={acknowledgeClassification} t={t} /> : <p role="alert" className="mt-2 text-[11px] text-error">{actor ? t("safety.formulationEditRequired") : t("safety.signInToResolve")}</p>}
          </div>
        )}
        {needsHumanReview && reviewAcknowledged && (
          <p className="mt-1 text-[11px] text-ok">{t("safety.humanReviewAcknowledged")}</p>
        )}
      </section>

      <div className="print-hide mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted">{t("compatibility.phTarget")}</span>
          <input
            value={phTarget}
            onChange={(e) => setPhTarget(e.target.value)}
            inputMode="decimal"
            aria-label={t("compatibility.phTarget")}
            className="w-28 rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted">{t("compatibility.processTemp")}</span>
          <input
            value={processTempC}
            onChange={(e) => setProcessTempC(e.target.value)}
            inputMode="decimal"
            aria-label={t("compatibility.processTemp")}
            className="w-28 rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
          />
        </label>
        <div className="flex-1" />
        <button
          onClick={showRules}
          className="rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2"
        >
          {t("safety.manageRules")}
        </button>
        <button
          onClick={() => void saveSnapshot()}
          disabled={saving || !versionId}
          title={versionId ? t("safety.snapshotTitle") : t("cost.needVersion")}
          className="flex items-center gap-1.5 rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2 disabled:opacity-40"
        >
          <RefreshCw size={13} /> {t("safety.saveSnapshot")}
        </button>
      </div>

      {status && (
        <div role="status" className="mb-3 rounded-input bg-surface-2 px-3 py-2 text-[12px] text-text">
          {status}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 text-[12px]">
        {SEVERITIES.map((sev) => (
          <button
            key={sev}
            onClick={() => setSeverityFilter(severityFilter === sev ? "" : sev)}
            className={cn(
              "rounded-input border px-2.5 py-1 tabular-nums",
              SEVERITY_TONE[sev],
              severityFilter === sev && "ring-2 ring-accent/50",
            )}
          >
            {t(`compatibility.severity.${sev}`)} <strong>{summary[sev]}</strong>
          </button>
        ))}
        <span className="rounded-input border border-border bg-surface-2 px-2.5 py-1 text-muted">
          {t("safety.humanReviewCount", { count: summary.humanReviewRequired })}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted">{t("safety.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              resolved={resolvedIds.has(f.id)}
              canResolve={canResolveSafety}
              lineName={lineName}
              onFocusLine={onFocusLine}
              onResolve={() => setResolving(f)}
              t={t}
            />
          ))}
        </ul>
      )}

      {resolving && canResolveSafety && (
        <ResolveDialog
          finding={resolving}
          reviewerName={actor?.displayName ?? ""}
          onCancel={() => setResolving(null)}
          onSubmit={(reason, kind) => void resolveFinding(resolving, reason, kind)}
          t={t}
        />
      )}
    </div>
  );
}

function AcknowledgeForm({
  reviewerName,
  onSubmit,
  t,
}: {
  reviewerName: string;
  onSubmit: (reason: string) => Promise<void>;
  t: TFunction<readonly ["session", "common"]>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await onSubmit(reason.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <span className="text-[11px] text-muted">{t("safety.reviewerName")}: {reviewerName}</span>
      <label className="block">
        <span className="mb-1 block text-[11px] text-muted">{t("safety.resolutionReason")}</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label={t("safety.resolutionReason")}
          className="w-64 rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-accent"
        />
      </label>
      <button
        onClick={() => void submit()}
        disabled={busy || !reason.trim()}
        className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
      >
        {t("safety.acknowledge")}
      </button>
    </div>
  );
}

function FindingCard({
  finding,
  resolved,
  canResolve,
  lineName,
  onFocusLine,
  onResolve,
  t,
}: {
  finding: SafetyFinding;
  resolved: boolean;
  canResolve: boolean;
  lineName: (lineId: string) => string;
  onFocusLine: (lineId: string) => void;
  onResolve: () => void;
  t: TFunction<readonly ["session", "common"]>;
}) {
  return (
    <li className={cn("rounded-card border px-3 py-2.5", SEVERITY_TONE[finding.severity], resolved && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium">
            <AlertTriangle size={13} aria-hidden />
            {t(`compatibility.severity.${finding.severity}`)}
            {resolved && (
              <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] text-ok">{t("safety.resolved")}</span>
            )}
            {finding.dataIncomplete && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                {t("compatibility.unknown")}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-text">{finding.message}</p>
          {finding.requiredAction && (
            <p className="mt-1 text-[11px] text-text">
              <strong>{t("compatibility.recommendedAction")}:</strong> {finding.requiredAction}
            </p>
          )}
          {finding.requiredPpe.length > 0 && (
            <p className="mt-1 text-[11px] text-muted">
              {t("safety.requiredPpe")}: {finding.requiredPpe.join(", ")}
            </p>
          )}
          {finding.requiredEngineeringControls.length > 0 && (
            <p className="mt-1 text-[11px] text-muted">
              {t("safety.requiredControls")}: {finding.requiredEngineeringControls.join(", ")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {finding.affectedLineIds.map((id) => (
            <button
              key={id}
              onClick={() => onFocusLine(id)}
              className="rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text hover:bg-surface-2"
            >
              {lineName(id)}
            </button>
          ))}
          {finding.severity === "blocking" && !resolved && canResolve && (
            <button
              onClick={onResolve}
              className="rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text hover:bg-surface-2"
            >
              {t("safety.resolve")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function ResolveDialog({
  finding,
  reviewerName,
  onCancel,
  onSubmit,
  t,
}: {
  finding: SafetyFinding;
  reviewerName: string;
  onCancel: () => void;
  onSubmit: (reason: string, kind: SafetyResolution["resolutionKind"]) => void;
  t: TFunction<readonly ["session", "common"]>;
}) {
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<SafetyResolution["resolutionKind"]>("accepted_risk");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("safety.resolve")}
    >
      <div className="my-auto w-[32rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{t("safety.resolveDialogTitle")}</h2>
        <div className="space-y-3 px-5 py-4">
          <p className="text-[12px] text-text">{finding.message}</p>
          <p className="text-[11px] text-muted">{t("safety.reviewerName")}: {reviewerName}</p>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("safety.resolutionKind")}</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SafetyResolution["resolutionKind"])}
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            >
              <option value="accepted_risk">{t("safety.resolutionKindAccepted")}</option>
              <option value="formula_changed">{t("safety.resolutionKindChanged")}</option>
              <option value="rule_disputed">{t("safety.resolutionKindDisputed")}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("safety.resolutionReason")}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={() => onSubmit(reason.trim(), kind)}
            disabled={!reason.trim()}
            className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {t("safety.confirmResolve")}
          </button>
        </div>
      </div>
    </div>
  );
}
