/**
 * Full approval-policy editor (spec §1.1/§1.2): edit every field of an
 * existing policy, clone it, retire it, browse its revision history and
 * restore an old revision — plus product-family/packaging-SKU scope
 * editors. Every mutating action goes through `engine/approvalPolicy.ts`'s
 * human-gated functions and is handed to the parent (`ApprovalPanel.tsx`)
 * to persist alongside an `ApprovalPolicyRevision` and an
 * `approval.policy_changed` audit event — this component only builds the
 * field values and reasons; it never writes storage directly.
 */
import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import type { ApprovalPolicy, ApprovalPolicyRevision, FormulaStatus } from "@ai4s/shared";
import { newId } from "@ai4s/shared";
import { cn } from "@/lib/cn";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

const POLICY_TOGGLES: { key: keyof ApprovalPolicy; labelKey: string }[] = [
  { key: "requireCompletedTrial", labelKey: "approval.hasCompletedTrial" },
  { key: "requireAllRequiredTestsCompleted", labelKey: "approval.allRequiredTestsCompleted" },
  { key: "requireAllCriticalTestsPassed", labelKey: "approval.allCriticalTestsPassed" },
  { key: "requireNoUnresolvedCriticalDeviation", labelKey: "approval.noOpenCriticalDeviation" },
  { key: "requireNoUnresolvedCriticalCorrectiveAction", labelKey: "approval.noOpenCriticalCorrectiveAction" },
  { key: "requireActiveStudy", labelKey: "approval.hasActiveOrCompletedStudy" },
  { key: "requireInitialTestsPassed", labelKey: "approval.initialTestsPassed" },
  { key: "requireNoUnresolvedCriticalFailure", labelKey: "approval.noOpenCriticalStabilityFailure" },
  { key: "requirePackagingCompatibilityPassed", labelKey: "approval.packagingCompatibility" },
  { key: "requireCostSnapshot", labelKey: "approval.costSnapshotPresent" },
  // Phase 3 §10 dossier gates — all default false, see REGULATORY_DOSSIERS.md.
  { key: "requireRegulatoryDossier", labelKey: "approval.requireRegulatoryDossier" },
  { key: "requireDossierReadyForReview", labelKey: "approval.requireDossierReadyForReview" },
  { key: "requireDossierReviewComplete", labelKey: "approval.requireDossierReviewComplete" },
  { key: "requireNoMissingMandatoryDossierEvidence", labelKey: "approval.requireNoMissingMandatoryDossierEvidence" },
  { key: "requireNoExpiredMandatoryDossierEvidence", labelKey: "approval.requireNoExpiredMandatoryDossierEvidence" },
  { key: "requireAllRequiredJurisdictionDossiers", labelKey: "approval.requireAllRequiredJurisdictionDossiers" },
];

interface DraftFields {
  name: string;
  description: string;
  targetStatus: FormulaStatus;
  effectiveDate: string;
  scopeMode: "all" | "selected";
  productFamilyCodes: string[];
  packagingSkuMode: "all" | "selected";
  packagingSkuCodes: string[];
  toggles: Partial<Record<keyof ApprovalPolicy, boolean>>;
  minimumRequiredTimePoints: string;
  priority: string;
}

function draftFromPolicy(p?: ApprovalPolicy): DraftFields {
  return {
    name: p?.name ?? "",
    description: p?.description ?? "",
    targetStatus: p?.targetStatus ?? "pilot_approved",
    effectiveDate: p?.effectiveDate ?? "",
    scopeMode: p && p.productFamilyCodes.length > 0 ? "selected" : "all",
    productFamilyCodes: p?.productFamilyCodes ?? [],
    packagingSkuMode: p && p.packagingSkuCodes.length > 0 ? "selected" : "all",
    packagingSkuCodes: p?.packagingSkuCodes ?? [],
    toggles: p
      ? Object.fromEntries(POLICY_TOGGLES.map(({ key }) => [key, !!p[key]]))
      : {},
    minimumRequiredTimePoints: p?.minimumRequiredTimePoints !== undefined ? String(p.minimumRequiredTimePoints) : "",
    priority: p?.priority !== undefined ? String(p.priority) : "",
  };
}

function draftToFields(d: DraftFields): Partial<ApprovalPolicy> {
  return {
    name: d.name.trim(),
    description: d.description.trim() || undefined,
    targetStatus: d.targetStatus as "pilot_approved" | "production_approved",
    effectiveDate: d.effectiveDate || undefined,
    productFamilyCodes: d.scopeMode === "all" ? [] : d.productFamilyCodes,
    packagingSkuCodes: d.packagingSkuMode === "all" ? [] : d.packagingSkuCodes,
    minimumRequiredTimePoints: d.minimumRequiredTimePoints.trim() ? Number(d.minimumRequiredTimePoints) : undefined,
    priority: d.priority.trim() ? Number(d.priority) : undefined,
    ...Object.fromEntries(POLICY_TOGGLES.map(({ key }) => [key, !!d.toggles[key]])),
  };
}

function MultiSelectScope({
  label,
  mode,
  onModeChange,
  options,
  selected,
  onSelectedChange,
  t,
}: {
  label: string;
  mode: "all" | "selected";
  onModeChange: (mode: "all" | "selected") => void;
  options: string[];
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  t: SimpleT;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter((o) => o.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <span className="mb-1 block text-[10px] text-muted">{label}</span>
      <div className="mb-1 flex gap-2 text-[10px]">
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === "all"} onChange={() => onModeChange("all")} />
          {t("approval.scopeAll")}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === "selected"} onChange={() => onModeChange("selected")} />
          {t("approval.scopeSelected")}
        </label>
      </div>
      {mode === "selected" && (
        <>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("approval.scopeSearch")}
            className="mb-1 w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
          />
          <div className="max-h-24 overflow-auto rounded-input border border-border-faint">
            {filtered.map((o) => (
              <label key={o} className="flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={selected.includes(o)}
                  onChange={(e) => onSelectedChange(e.target.checked ? [...selected, o] : selected.filter((s) => s !== o))}
                />
                {o}
              </label>
            ))}
            {filtered.length === 0 && <p className="px-1.5 py-1 text-[10px] text-muted">{t("approval.scopeNoMatches")}</p>}
          </div>
          <p className="mt-0.5 text-[10px] text-muted">
            {selected.length === 0 ? t("approval.scopeNoneSelected") : t("approval.scopeSummary", { count: selected.length })}
          </p>
        </>
      )}
    </div>
  );
}

export function PolicyEditor({
  policies,
  revisions,
  productFamilyOptions,
  packagingSkuOptions,
  onCreate,
  onEdit,
  onToggleActive,
  onRetire,
  onClone,
  onRestoreRevision,
  t,
}: {
  policies: ApprovalPolicy[];
  revisions: ApprovalPolicyRevision[];
  productFamilyOptions: string[];
  packagingSkuOptions: string[];
  onCreate: (policy: ApprovalPolicy) => Promise<void>;
  onEdit: (current: ApprovalPolicy, updates: Partial<ApprovalPolicy>, reason: string) => Promise<void>;
  onToggleActive: (current: ApprovalPolicy, active: boolean) => Promise<void>;
  onRetire: (current: ApprovalPolicy, reason: string) => Promise<void>;
  onClone: (source: ApprovalPolicy, newName: string) => Promise<void>;
  onRestoreRevision: (current: ApprovalPolicy, revision: ApprovalPolicyRevision) => Promise<void>;
  t: SimpleT;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<DraftFields>(draftFromPolicy());
  const [changeReason, setChangeReason] = useState("");
  const [historyForId, setHistoryForId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = editingId && editingId !== "new" ? policies.find((p) => p.id === editingId) : undefined;

  const openCreate = () => {
    setEditingId("new");
    setDraft(draftFromPolicy());
    setChangeReason("");
  };
  const openEdit = (p: ApprovalPolicy) => {
    setEditingId(p.id);
    setDraft(draftFromPolicy(p));
    setChangeReason("");
  };
  const close = () => setEditingId(null);

  const submit = async () => {
    if (!draft.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId === "new") {
        const now = new Date().toISOString();
        const policy: ApprovalPolicy = {
          schemaVersion: "1.0",
          id: newId("policy"),
          verificationStatus: "not_verified",
          active: false,
          retired: false,
          revisionNumber: 1,
          createdBy: "local",
          createdAt: now,
          updatedAt: now,
          ...(draftToFields(draft) as Omit<ApprovalPolicy, "schemaVersion" | "id" | "verificationStatus" | "active" | "retired" | "revisionNumber" | "createdBy" | "createdAt" | "updatedAt">),
        };
        await onCreate(policy);
      } else if (editing) {
        if (!changeReason.trim()) {
          setError(t("approval.changeReasonRequired"));
          setBusy(false);
          return;
        }
        await onEdit(editing, draftToFields(draft), changeReason);
      }
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {error && <p className="mb-2 text-[11px] text-error">{error}</p>}
      <ul className="mb-2 space-y-1">
        {policies.map((p) => (
          <li key={p.id} className="rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text">{p.name}</span>
              <span className="text-[10px] text-muted">
                {t(`approval.status.${p.targetStatus}`)} · {p.productFamilyCodes.length === 0 ? t("approval.scopeAll") : p.productFamilyCodes.join(", ")}
                {p.packagingSkuCodes.length > 0 && ` / ${p.packagingSkuCodes.join(", ")}`}
              </span>
              <span
                className={cn(
                  "rounded px-1 py-0.5 text-[9px]",
                  p.retired ? "bg-surface-2 text-muted" : p.active ? "bg-success/10 text-success" : "bg-warn/10 text-warn",
                )}
              >
                {p.retired ? t("approval.policyRetired") : p.active ? t("approval.ready") : t("approval.notReady")}
              </span>
              <span className="text-[9px] text-muted">{t("approval.policyRevision", { n: p.revisionNumber })}</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <button onClick={() => setHistoryForId(historyForId === p.id ? null : p.id)} className="flex items-center gap-1 text-[10px] text-accent hover:underline">
                  <History size={10} /> {t("approval.policyHistory")}
                </button>
                {!p.retired && (
                  <>
                    <button onClick={() => openEdit(p)} className="text-[10px] text-accent hover:underline">
                      {t("approval.editPolicy")}
                    </button>
                    <button onClick={() => void onToggleActive(p, !p.active)} className="text-[10px] text-accent hover:underline">
                      {t(p.active ? "approval.deactivatePolicy" : "approval.activatePolicy")}
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    const name = window.prompt(t("approval.clonePromptName"), `${p.name} (copy)`);
                    if (name) void onClone(p, name);
                  }}
                  className="text-[10px] text-accent hover:underline"
                >
                  {t("approval.clonePolicy")}
                </button>
                {!p.retired && (
                  <button
                    onClick={() => {
                      const reason = window.prompt(t("approval.retirePromptReason"));
                      if (reason) void onRetire(p, reason);
                    }}
                    className="text-[10px] text-error hover:underline"
                  >
                    {t("approval.retirePolicy")}
                  </button>
                )}
              </div>
            </div>
            {historyForId === p.id && (
              <ul className="mt-1.5 space-y-1 border-t border-border-faint pt-1.5">
                {revisions
                  .filter((r) => r.policyId === p.id)
                  .sort((a, b) => b.revisionNumber - a.revisionNumber)
                  .map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-[10px] text-muted">
                      <span className="rounded bg-surface-2 px-1 py-0.5">{t("approval.policyRevision", { n: r.revisionNumber })}</span>
                      <span>{r.changeType}</span>
                      <span>{r.changeReason}</span>
                      <span>{r.changedBy}</span>
                      <span>{new Date(r.changedAt).toLocaleString()}</span>
                      <button
                        onClick={() => void onRestoreRevision(p, r)}
                        disabled={r.revisionNumber === p.revisionNumber}
                        className="ml-auto flex items-center gap-1 text-accent hover:underline disabled:opacity-30"
                      >
                        <RotateCcw size={10} /> {t("approval.restoreRevision")}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </li>
        ))}
        {policies.length === 0 && <p className="text-[11px] text-muted">{t("approval.noPolicy")}</p>}
      </ul>

      {editingId === null && (
        <button onClick={openCreate} className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
          {t("approval.newPolicy")}
        </button>
      )}

      {editingId !== null && (
        <div className="rounded-card border border-border p-2.5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted">{t("approval.policyName")}</span>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted">{t("approval.policyDescription")}</span>
              <input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted">{t("approval.requestedStatus")}</span>
              <select
                value={draft.targetStatus}
                onChange={(e) => setDraft((d) => ({ ...d, targetStatus: e.target.value as FormulaStatus }))}
                className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
              >
                <option value="pilot_approved">{t("approval.status.pilot_approved")}</option>
                <option value="production_approved">{t("approval.status.production_approved")}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted">{t("approval.effectiveDate")}</span>
              <input
                type="date"
                value={draft.effectiveDate}
                onChange={(e) => setDraft((d) => ({ ...d, effectiveDate: e.target.value }))}
                className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted">{t("approval.minimumTimePoints")}</span>
              <input
                inputMode="numeric"
                value={draft.minimumRequiredTimePoints}
                onChange={(e) => setDraft((d) => ({ ...d, minimumRequiredTimePoints: e.target.value }))}
                className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted">{t("approval.priority")}</span>
              <input
                inputMode="numeric"
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
                className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
              />
            </label>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MultiSelectScope
              label={t("approval.scopeProductFamilies")}
              mode={draft.scopeMode}
              onModeChange={(m) => setDraft((d) => ({ ...d, scopeMode: m }))}
              options={productFamilyOptions}
              selected={draft.productFamilyCodes}
              onSelectedChange={(next) => setDraft((d) => ({ ...d, productFamilyCodes: next }))}
              t={t}
            />
            <MultiSelectScope
              label={t("approval.scopePackagingSkus")}
              mode={draft.packagingSkuMode}
              onModeChange={(m) => setDraft((d) => ({ ...d, packagingSkuMode: m }))}
              options={packagingSkuOptions}
              selected={draft.packagingSkuCodes}
              onSelectedChange={(next) => setDraft((d) => ({ ...d, packagingSkuCodes: next }))}
              t={t}
            />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {POLICY_TOGGLES.map(({ key, labelKey }) => (
              <label key={key} className="flex items-center gap-1 text-[10px] text-muted">
                <input
                  type="checkbox"
                  checked={!!draft.toggles[key]}
                  onChange={(e) => setDraft((d) => ({ ...d, toggles: { ...d.toggles, [key]: e.target.checked } }))}
                />
                {t(labelKey)}
              </label>
            ))}
          </div>

          {editingId !== "new" && (
            <label className="mt-2 block">
              <span className="mb-1 block text-[10px] text-muted">{t("approval.changeReason")}</span>
              <input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} className="w-full rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
            </label>
          )}

          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void submit()}
              disabled={busy || !draft.name.trim() || (editingId !== "new" && !changeReason.trim())}
              className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {t("common:actions.save")}
            </button>
            <button onClick={close} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
              {t("common:actions.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
