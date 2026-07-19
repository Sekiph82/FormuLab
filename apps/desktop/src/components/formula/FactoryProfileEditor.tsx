import { useState } from "react";
import { useTranslation } from "react-i18next";
import { newId, type FactoryCostProfile } from "@ai4s/shared";
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

const DECIMAL_FIELDS: { key: keyof FactoryCostProfile; labelKey: string }[] = [
  { key: "electricityPerKwh", labelKey: "factoryProfile.electricityPerKwh" },
  { key: "kwhPerBatch", labelKey: "factoryProfile.kwhPerBatch" },
  { key: "waterPerM3", labelKey: "factoryProfile.waterPerM3" },
  { key: "waterM3PerBatch", labelKey: "factoryProfile.waterM3PerBatch" },
  { key: "steamPerKg", labelKey: "factoryProfile.steamPerKg" },
  { key: "steamKgPerBatch", labelKey: "factoryProfile.steamKgPerBatch" },
  { key: "compressedAirPerBatch", labelKey: "factoryProfile.compressedAirPerBatch" },
  { key: "directLabourPerHour", labelKey: "factoryProfile.directLabourPerHour" },
  { key: "labourHoursPerBatch", labelKey: "factoryProfile.labourHoursPerBatch" },
  { key: "qcCostPerBatch", labelKey: "factoryProfile.qcCostPerBatch" },
  { key: "qcPercentOfBatch", labelKey: "factoryProfile.qcPercentOfBatch" },
  { key: "processLossPercent", labelKey: "factoryProfile.processLossPercent" },
  { key: "wasteDisposalPerBatch", labelKey: "factoryProfile.wasteDisposalPerBatch" },
  { key: "overheadPercent", labelKey: "factoryProfile.overheadPercent" },
  { key: "overheadPerBatch", labelKey: "factoryProfile.overheadPerBatch" },
];

/**
 * Create, edit or clone a factory cost profile.
 *
 * Nothing here is presented as fact: `verification` defaults to
 * `not_verified`, and a cloned/seeded profile stays `example_only` until a
 * person edits and confirms it against the factory's own accounts.
 */
export function FactoryProfileEditor({
  profile,
  onCancel,
  onSave,
}: {
  profile: FactoryCostProfile;
  onCancel: () => void;
  onSave: (p: FactoryCostProfile) => Promise<void> | void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [draft, setDraft] = useState<FactoryCostProfile>(profile);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FactoryCostProfile>(key: K, value: FactoryCostProfile[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    if (!draft.code.trim() || !draft.name.trim() || busy) return;
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
      aria-label={draft.name || t("factoryProfile.newProfile")}
    >
      <div className="my-auto w-[40rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">
          {draft.name || t("factoryProfile.newProfile")}
        </h2>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("materials.code")}>
              <input value={draft.code} onChange={(e) => set("code", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("materials.name")}>
              <input value={draft.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("materials.currency")}>
              <input value={draft.currency} onChange={(e) => set("currency", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("materials.effective")}>
              <input value={draft.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} className={inputCls} />
            </Field>
            {DECIMAL_FIELDS.map(({ key, labelKey }) => (
              <Field key={key} label={t(labelKey as never)}>
                <input
                  value={(draft[key] as string | undefined) ?? ""}
                  onChange={(e) => set(key, (e.target.value || undefined) as FactoryCostProfile[typeof key])}
                  inputMode="decimal"
                  className={inputCls}
                />
              </Field>
            ))}
            <Field label={t("materials.verification")}>
              <select
                value={draft.verification}
                onChange={(e) => set("verification", e.target.value as FactoryCostProfile["verification"])}
                className={inputCls}
              >
                <option value="not_verified">{t("factoryProfile.notVerified")}</option>
                <option value="verified">{t("factoryProfile.verified")}</option>
                <option value="example_only">{t("factoryProfile.exampleOnly")}</option>
              </select>
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

/** A fresh, unverified profile — cloning copies every figure but resets
 *  identity and marks the result `not_verified`, never inheriting a
 *  `verified` status that belonged to the source profile's own numbers. */
export function cloneFactoryProfile(source: FactoryCostProfile): FactoryCostProfile {
  return {
    ...source,
    code: newId("factory"),
    name: `${source.name} (copy)`,
    verification: "not_verified",
    updatedAt: nowIso(),
  };
}
