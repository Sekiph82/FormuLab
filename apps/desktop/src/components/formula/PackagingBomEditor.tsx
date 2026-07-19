import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { displayMoney, type PackagingBom, type PackagingBomLine, type PackagingComponent } from "@ai4s/shared";
import { nowIso } from "@/lib/masterdata";
import { cn } from "@/lib/cn";

const FILL_UNITS = ["g", "kg", "ml", "L", "pieces"] as const;

const inputCls =
  "w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent";

/**
 * Build the bill of materials for one packaging SKU: which components it
 * takes, how many of each per unit (fractional for carton/shrink allocation
 * — a carton over twelve units is 1/12 of a carton per unit), the fill and
 * its loss, and units per case.
 */
export function PackagingBomEditor({
  bom,
  skuOptions,
  components,
  onCancel,
  onSave,
}: {
  bom: PackagingBom;
  skuOptions: { code: string; label: string }[];
  components: PackagingComponent[];
  onCancel: () => void;
  onSave: (b: PackagingBom) => Promise<void> | void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [draft, setDraft] = useState<PackagingBom>(bom);
  const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const set = <K extends keyof PackagingBom>(key: K, value: PackagingBom[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const componentByCode = new Map(components.map((c) => [c.code, c]));

  const addLine = () => {
    if (components.length === 0) return;
    set("lines", [...draft.lines, { componentCode: components[0].code, quantityPerUnit: "1" }]);
  };

  const updateLine = (i: number, patch: Partial<PackagingBomLine>) => {
    set(
      "lines",
      draft.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  };

  const removeLine = (i: number) => set("lines", draft.lines.filter((_, idx) => idx !== i));

  const moveLine = (from: number, to: number) => {
    if (from === to) return;
    const next = [...draft.lines];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set("lines", next);
  };

  const totalPackagingCost = draft.lines.reduce((sum, l) => {
    const comp = componentByCode.get(l.componentCode);
    if (!comp?.unitPrice) return sum;
    return sum + Number(comp.unitPrice) * Number(l.quantityPerUnit || "0");
  }, 0);
  const currency = componentByCode.get(draft.lines[0]?.componentCode ?? "")?.currency ?? "KES";

  const submit = async () => {
    if (!draft.code.trim() || !draft.skuCode.trim() || busy) return;
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
      aria-label={draft.skuCode || t("packaging.newBom")}
    >
      <div className="my-auto w-[44rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">
          {draft.skuCode || t("packaging.newBom")}
        </h2>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">{t("packaging.targetSku")}</span>
              <select value={draft.skuCode} onChange={(e) => set("skuCode", e.target.value)} className={inputCls}>
                <option value="">{t("packaging.selectSku")}</option>
                {skuOptions.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">{t("materials.code")}</span>
              <input value={draft.code} onChange={(e) => set("code", e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">{t("packaging.fillQuantity")}</span>
              <input
                value={draft.fillQuantity}
                onChange={(e) => set("fillQuantity", e.target.value)}
                inputMode="decimal"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">{t("packaging.fillUnit")}</span>
              <select value={draft.fillUnit} onChange={(e) => set("fillUnit", e.target.value as PackagingBom["fillUnit"])} className={inputCls}>
                {FILL_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">{t("packaging.fillLoss")}</span>
              <input
                value={draft.fillLossPercent}
                onChange={(e) => set("fillLossPercent", e.target.value)}
                inputMode="decimal"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">{t("packaging.unitsPerCase")}</span>
              <input
                value={draft.unitsPerCase ?? ""}
                onChange={(e) => set("unitsPerCase", e.target.value ? Number(e.target.value) : undefined)}
                inputMode="numeric"
                className={inputCls}
              />
            </label>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[12px] font-medium text-text">{t("packaging.bomLines")}</h3>
            <button
              onClick={addLine}
              disabled={components.length === 0}
              className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2 disabled:opacity-40"
            >
              <Plus size={12} /> {t("packaging.addLine")}
            </button>
          </div>

          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="w-6" />
                <th className="px-2 py-1 font-medium">{t("packaging.component")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("packaging.quantityPerUnit")}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line, i) => (
                <tr
                  key={i}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) moveLine(dragIndex, i);
                    setDragIndex(null);
                  }}
                  className={cn("border-b border-border-faint", dragIndex === i && "opacity-40")}
                >
                  <td className="cursor-grab px-1 text-center text-muted">
                    <GripVertical size={12} className="mx-auto" aria-hidden />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={line.componentCode}
                      onChange={(e) => updateLine(i, { componentCode: e.target.value })}
                      className={inputCls}
                    >
                      {components.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.description}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={line.quantityPerUnit}
                      onChange={(e) => updateLine(i, { quantityPerUnit: e.target.value })}
                      inputMode="decimal"
                      className={cn(inputCls, "text-right")}
                    />
                  </td>
                  <td className="px-1 text-center">
                    <button
                      onClick={() => removeLine(i)}
                      title={t("common:actions.remove")}
                      className="text-muted hover:text-error"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {draft.lines.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted">
                    {t("packaging.noBomLines")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="mt-3 text-[12px] text-text">
            {t("packaging.totalCost")}: <strong>{displayMoney(totalPackagingCost.toFixed(4), currency)}</strong>
          </p>
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
