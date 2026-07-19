import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  newId,
  type MaterialPrice,
  type MaterialSupplier,
  type RawMaterial,
  type Supplier,
} from "@ai4s/shared";
import { nowIso, upsertRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";

const QUALITY_STATUSES = ["approved", "conditional", "under_review", "suspended", "not_assessed"] as const;

/**
 * Create or edit a supplier: contact/commercial terms, approved/quality
 * status, plus the two things a supplier record exists to anchor —
 * which materials it supplies (`material_suppliers`, editable here) and its
 * price history (`material_prices`, read-only here: prices are append-only,
 * added from the Materials tab's price import, not edited on this screen).
 */
export function SupplierEditor({
  supplier,
  materials,
  links,
  prices,
  onCancel,
  onSave,
  onLinksChanged,
}: {
  supplier: Supplier;
  materials: RawMaterial[];
  links: MaterialSupplier[];
  prices: MaterialPrice[];
  onCancel: () => void;
  onSave: (s: Supplier) => Promise<void> | void;
  onLinksChanged: () => Promise<void> | void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [draft, setDraft] = useState<Supplier>(supplier);
  const [busy, setBusy] = useState(false);
  const [newMaterialCode, setNewMaterialCode] = useState("");

  const set = <K extends keyof Supplier>(key: K, value: Supplier[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    if (!draft.code.trim() || !draft.displayName.trim() || busy) return;
    setBusy(true);
    try {
      await onSave({ ...draft, updatedAt: nowIso() });
    } finally {
      setBusy(false);
    }
  };

  const addLink = async () => {
    if (!newMaterialCode) return;
    await upsertRecords("material_suppliers", [
      {
        code: newId("matsup"),
        materialCode: newMaterialCode,
        supplierCode: supplier.code,
        preferred: false,
        qualified: false,
      },
    ]);
    setNewMaterialCode("");
    await onLinksChanged();
  };

  const supplierPrices = prices.filter((p) => p.supplierCode === supplier.code);
  const linkedMaterials = links.filter((l) => l.supplierCode === supplier.code);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={draft.displayName || t("materials.newSupplier")}
    >
      <div className="my-auto w-[40rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">
          {draft.displayName || t("materials.newSupplier")}
        </h2>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("materials.code")}>
              <input
                value={draft.code}
                onChange={(e) => set("code", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={t("materials.name")}>
              <input
                value={draft.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={t("supplier.legalName")}>
              <input value={draft.legalName} onChange={(e) => set("legalName", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("materials.country")}>
              <input value={draft.country ?? ""} onChange={(e) => set("country", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("supplier.contactPerson")}>
              <input value={draft.contactPerson ?? ""} onChange={(e) => set("contactPerson", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("supplier.email")}>
              <input value={draft.email ?? ""} onChange={(e) => set("email", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("supplier.phone")}>
              <input value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("materials.currency")}>
              <input value={draft.currency} onChange={(e) => set("currency", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("supplier.incoterm")}>
              <input value={draft.incoterm ?? ""} onChange={(e) => set("incoterm", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("supplier.paymentTerms")}>
              <input value={draft.paymentTerms ?? ""} onChange={(e) => set("paymentTerms", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("supplier.leadTime")}>
              <input
                value={draft.defaultLeadTimeDays ?? ""}
                onChange={(e) => set("defaultLeadTimeDays", e.target.value ? Number(e.target.value) : undefined)}
                inputMode="numeric"
                className={inputCls}
              />
            </Field>
            <Field label={t("materials.quality")}>
              <select
                value={draft.qualityStatus}
                onChange={(e) => set("qualityStatus", e.target.value as Supplier["qualityStatus"])}
                className={inputCls}
              >
                {QUALITY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("supplier.moq")}>
              <input value={draft.moqNotes ?? ""} onChange={(e) => set("moqNotes", e.target.value)} className={inputCls} />
            </Field>
            <label className="flex items-center gap-1.5 text-[12px] text-text">
              <input type="checkbox" checked={draft.approved} onChange={(e) => set("approved", e.target.checked)} />
              {t("supplier.approvedStatus")}
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-text">
              <input type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} />
              {t("materials.activeRecord")}
            </label>
            <Field label={t("materials.notes")}>
              <textarea
                value={draft.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
                rows={2}
                className={cn(inputCls, "sm:col-span-2")}
              />
            </Field>
          </div>

          <section className="mt-4 border-t border-border-faint pt-3">
            <h3 className="mb-2 text-[12px] font-medium text-text">{t("supplier.associatedMaterials")}</h3>
            {linkedMaterials.length === 0 ? (
              <p className="text-[11px] text-muted">{t("supplier.noLinks")}</p>
            ) : (
              <ul className="mb-2 space-y-1 text-[11px] text-muted">
                {linkedMaterials.map((l) => (
                  <li key={l.code}>{materials.find((m) => m.code === l.materialCode)?.displayName ?? l.materialCode}</li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <select
                value={newMaterialCode}
                onChange={(e) => setNewMaterialCode(e.target.value)}
                aria-label={t("supplier.linkMaterial")}
                className={inputCls}
              >
                <option value="">{t("supplier.selectMaterial")}</option>
                {materials.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void addLink()}
                disabled={!newMaterialCode}
                className="rounded-input border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-2 disabled:opacity-40"
              >
                {t("supplier.linkMaterial")}
              </button>
            </div>
          </section>

          <section className="mt-4 border-t border-border-faint pt-3">
            <h3 className="mb-2 text-[12px] font-medium text-text">{t("supplier.priceHistory")}</h3>
            {supplierPrices.length === 0 ? (
              <p className="text-[11px] text-muted">{t("materials.noPrice")}</p>
            ) : (
              <ul className="space-y-1 text-[11px] text-muted">
                {supplierPrices.map((p) => (
                  <li key={p.code}>
                    {p.materialCode}: {p.price} {p.currency}/{p.priceUnit} ({p.effectiveFrom.slice(0, 10)})
                  </li>
                ))}
              </ul>
            )}
          </section>
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
