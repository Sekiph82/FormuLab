import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PACKAGING_COMPONENT_TYPES, type PackagingComponent } from "@ai4s/shared";
import { nowIso } from "@/lib/masterdata";

const inputCls =
  "w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Create or edit one packaging component (a bottle, a cap, a label, ...). */
export function PackagingComponentEditor({
  component,
  onCancel,
  onSave,
}: {
  component: PackagingComponent;
  onCancel: () => void;
  onSave: (c: PackagingComponent) => Promise<void> | void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [draft, setDraft] = useState<PackagingComponent>(component);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof PackagingComponent>(key: K, value: PackagingComponent[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    if (!draft.code.trim() || !draft.description.trim() || busy) return;
    setBusy(true);
    try {
      await onSave({ ...draft, updatedAt: nowIso() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={draft.description || t("packaging.newComponent")}
    >
      <div className="my-auto w-[36rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">
          {draft.description || t("packaging.newComponent")}
        </h2>
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          <Field label={t("materials.code")}>
            <input value={draft.code} onChange={(e) => set("code", e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("packaging.description")}>
            <input value={draft.description} onChange={(e) => set("description", e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("packaging.componentType")}>
            <select
              value={draft.componentType}
              onChange={(e) => set("componentType", e.target.value as PackagingComponent["componentType"])}
              className={inputCls}
            >
              {PACKAGING_COMPONENT_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {tp.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("materials.supplier")}>
            <input value={draft.supplierCode ?? ""} onChange={(e) => set("supplierCode", e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("packaging.unit")}>
            <input value={draft.unit} onChange={(e) => set("unit", e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("cost.unitPrice")}>
            <input
              value={draft.unitPrice ?? ""}
              onChange={(e) => set("unitPrice", e.target.value || undefined)}
              inputMode="decimal"
              className={inputCls}
            />
          </Field>
          <Field label={t("materials.currency")}>
            <input value={draft.currency} onChange={(e) => set("currency", e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("materials.effective")}>
            <input
              value={draft.effectiveFrom ?? ""}
              onChange={(e) => set("effectiveFrom", e.target.value || undefined)}
              placeholder="YYYY-MM-DD"
              className={inputCls}
            />
          </Field>
          <Field label={t("packaging.weightG")}>
            <input
              value={draft.weightG ?? ""}
              onChange={(e) => set("weightG", e.target.value || undefined)}
              inputMode="decimal"
              className={inputCls}
            />
          </Field>
          <Field label={t("packaging.materialType")}>
            <input value={draft.materialType ?? ""} onChange={(e) => set("materialType", e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("packaging.wasteFactor")}>
            <input
              value={draft.wasteFactorPercent}
              onChange={(e) => set("wasteFactorPercent", e.target.value)}
              inputMode="decimal"
              className={inputCls}
            />
          </Field>
          <label className="flex items-center gap-1.5 text-[12px] text-text">
            <input type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} />
            {t("materials.activeRecord")}
          </label>
          <Field label={t("materials.notes")}>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className={inputCls}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {t("common:actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
