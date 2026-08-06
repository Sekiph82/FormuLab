import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Plus, Upload } from "lucide-react";
import { buildXlsxBlob } from "@/lib/xlsx";
import { upsertRecords, type Collection } from "@/lib/masterdata";
import { cn } from "@/lib/cn";

/** The fields common to both CompatibilityRule and SafetyRule — enough for
 *  the list view and the metadata form. Everything else (conditions, and the
 *  kind-specific fields like a safety rule's PPE list) is edited as JSON,
 *  which also doubles as this screen's structured import/export format. */
interface CommonRuleFields {
  id: string;
  name: string;
  status: "draft" | "verified" | "deprecated";
  severity: "info" | "warning" | "error" | "blocking";
  verificationStatus: string;
  active: boolean;
  message: string;
  updatedAt: string;
}

type AnyRule = CommonRuleFields & Record<string, unknown>;

const COLLECTION_FOR: Record<"compatibility" | "safety", Collection> = {
  compatibility: "compatibility_rules",
  safety: "safety_rules",
};

const SEVERITIES: readonly CommonRuleFields["severity"][] = ["info", "warning", "error", "blocking"];
const STATUSES: readonly CommonRuleFields["status"][] = ["draft", "verified", "deprecated"];
const VERIFICATION_STATUSES = ["verified", "not_verified", "human_review_required", "imported_unverified"] as const;

/**
 * Rule management for both engines: the compatibility and safety rule sets
 * are structurally close enough (id/name/status/severity/conditions/
 * verificationStatus/active) to share one screen rather than build two.
 *
 * Every rule here started as a seed with `status: "draft"` and an honest
 * `verificationStatus` — this screen is where a chemist promotes one to
 * `verified` after checking it, or `deprecated` when it no longer applies.
 * Nothing here invents a citation on the rule's behalf.
 */
export function RuleManager({
  kind,
  rules,
  onBack,
  onReload,
}: {
  kind: "compatibility" | "safety";
  rules: AnyRule[];
  onBack: () => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation(["session", "common"]);
  const collection = COLLECTION_FOR[kind];
  const [editing, setEditing] = useState<AnyRule | null>(null);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const save = async (rule: AnyRule) => {
    await upsertRecords(collection, [{ ...rule, updatedAt: new Date().toISOString() }] as never);
    setEditing(null);
    await onReload();
  };

  const toggleActive = async (rule: AnyRule) => {
    await upsertRecords(collection, [{ ...rule, active: !rule.active, updatedAt: new Date().toISOString() }] as never);
    await onReload();
  };

  const deprecate = async (rule: AnyRule) => {
    await upsertRecords(collection, [{ ...rule, status: "deprecated", updatedAt: new Date().toISOString() }] as never);
    await onReload();
  };

  const createRule = () => {
    const base: AnyRule = {
      id: `${kind}-custom-${Date.now().toString(36)}`,
      schemaVersion: "1.0",
      version: "1.0",
      name: t("ruleManager.newRuleName"),
      status: "draft",
      severity: "warning",
      ruleType: "warning_combination",
      conditions: [{ label: "A", functionsAny: [] }, { label: "B", functionsAny: [] }],
      message: "",
      sourceReferences: [],
      verificationStatus: "not_verified",
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(kind === "safety" ? { category: "custom", requiredPpe: [], requiredEngineeringControls: [], alwaysRequiresHumanReview: false } : {}),
    } as AnyRule;
    setEditing(base);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
    downloadBlob(`${kind}-rules.json`, blob);
  };

  const exportXlsx = async () => {
    const headers = ["id", "name", "status", "severity", "ruleType", "verificationStatus", "active", "message"];
    const blob = await buildXlsxBlob(
      headers,
      rules.map((r) => ({ ...r, ruleType: r.ruleType, active: r.active ? "yes" : "no" })),
      `${kind}-rules`,
    );
    downloadBlob(`${kind}-rules.xlsx`, blob);
  };

  const commitImport = async () => {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setImportError(t("ruleManager.invalidJson"));
      return;
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const bad = arr.find((r) => typeof r !== "object" || !r || !("id" in r) || !("name" in r) || !("conditions" in r));
    if (bad) {
      setImportError(t("ruleManager.invalidShape"));
      return;
    }
    await upsertRecords(collection, arr as never);
    setImporting(false);
    setImportText("");
    setStatus(t("ruleManager.importResult", { count: arr.length }));
    await onReload();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2">
        <button onClick={onBack} className="text-[12px] text-muted hover:text-text">
          ← {t("ruleManager.backToFindings")}
        </button>
        <h2 className="text-[13px] font-medium text-text">{t("ruleManager.title")}</h2>
        <div className="flex-1" />
        <button
          onClick={createRule}
          className="flex items-center gap-1.5 rounded-input bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90"
        >
          <Plus size={13} /> {t("ruleManager.newRule")}
        </button>
        <button
          onClick={() => setImporting(true)}
          className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
        >
          <Upload size={13} /> {t("ruleManager.importJson")}
        </button>
        <button
          onClick={exportJson}
          className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
        >
          <Download size={13} /> {t("ruleManager.exportJson")}
        </button>
        <button
          onClick={() => void exportXlsx()}
          className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
        >
          <Download size={13} /> {t("ruleManager.exportXlsx")}
        </button>
      </header>

      {status && (
        <div role="status" className="shrink-0 bg-ok/10 px-5 py-1.5 text-[12px] text-ok">
          {status}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-left text-muted">
              <th className="px-3 py-1.5 font-medium">{t("ruleManager.name")}</th>
              <th className="px-3 py-1.5 font-medium">{t("ruleManager.severity")}</th>
              <th className="px-3 py-1.5 font-medium">{t("ruleManager.status")}</th>
              <th className="px-3 py-1.5 font-medium">{t("ruleManager.verification")}</th>
              <th className="px-3 py-1.5 font-medium">{t("ruleManager.active")}</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-border-faint hover:bg-surface-2">
                <td className="px-3 py-1.5">
                  <button onClick={() => setEditing(r)} className="text-left text-accent hover:underline">
                    {r.name}
                  </button>
                </td>
                <td className="px-3 py-1.5 text-muted">{r.severity}</td>
                <td className="px-3 py-1.5 text-muted">{r.status}</td>
                <td className="px-3 py-1.5 text-muted">
                  {r.verificationStatus === "verified" ? (
                    <span className="text-ok">{t("ruleManager.verified")}</span>
                  ) : (
                    <span className="text-warn">{r.verificationStatus.replace(/_/g, " ")}</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => void toggleActive(r)}
                    className={cn(
                      "rounded-input px-2 py-0.5 text-[11px]",
                      r.active ? "bg-ok/10 text-ok" : "bg-surface-2 text-muted",
                    )}
                  >
                    {r.active ? t("ruleManager.activeYes") : t("ruleManager.activeNo")}
                  </button>
                </td>
                <td className="px-3 py-1.5 text-right">
                  {r.status !== "deprecated" && (
                    <button
                      onClick={() => void deprecate(r)}
                      className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
                    >
                      {t("ruleManager.deprecate")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-muted">
                  {t("ruleManager.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && <RuleEditor rule={editing} onCancel={() => setEditing(null)} onSave={save} />}

      {importing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t("ruleManager.importJson")}
        >
          <div className="my-auto w-[40rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
            <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">
              {t("ruleManager.importJson")}
            </h2>
            <div className="space-y-2 px-5 py-4">
              <p className="text-[11px] text-muted">{t("ruleManager.importHint")}</p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={12}
                aria-label={t("ruleManager.importJson")}
                className="w-full rounded-input border border-border bg-surface px-2 py-1.5 font-mono text-[11px] text-text outline-none focus:border-accent"
              />
              {importError && <p className="text-[12px] text-error">{importError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setImporting(false)}
                className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
              >
                {t("common:actions.cancel")}
              </button>
              <button
                onClick={() => void commitImport()}
                disabled={!importText.trim()}
                className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                {t("materials.commit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleEditor({
  rule,
  onCancel,
  onSave,
}: {
  rule: AnyRule;
  onCancel: () => void;
  onSave: (rule: AnyRule) => Promise<void>;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [draft, setDraft] = useState<AnyRule>(rule);
  const [json, setJson] = useState(() => JSON.stringify(rule, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const applyJson = () => {
    try {
      const parsed = JSON.parse(json) as AnyRule;
      setDraft(parsed);
      setJsonError(null);
    } catch {
      setJsonError(t("ruleManager.invalidJson"));
    }
  };

  const commit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={draft.name}
    >
      <div className="my-auto w-[44rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{draft.name}</h2>
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("ruleManager.name")}</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("ruleManager.severity")}</span>
            <select
              value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: e.target.value as AnyRule["severity"] })}
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("ruleManager.status")}</span>
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as AnyRule["status"] })}
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("ruleManager.verification")}</span>
            <select
              value={draft.verificationStatus}
              onChange={(e) => setDraft({ ...draft, verificationStatus: e.target.value })}
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            >
              {VERIFICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("ruleManager.message")}</span>
            <textarea
              value={draft.message}
              onChange={(e) => setDraft({ ...draft, message: e.target.value })}
              rows={2}
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            />
          </label>

          <div className="sm:col-span-2">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("ruleManager.fullJson")}</span>
            <p className="mb-1 text-[11px] text-muted">{t("ruleManager.jsonHint")}</p>
            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              onBlur={applyJson}
              rows={10}
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 font-mono text-[11px] text-text outline-none focus:border-accent"
            />
            {jsonError && <p className="mt-1 text-[12px] text-error">{jsonError}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={() => void commit()}
            disabled={saving}
            className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {t("common:actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
