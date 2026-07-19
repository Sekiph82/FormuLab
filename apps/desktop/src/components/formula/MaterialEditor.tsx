import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  IONIC_CHARACTERS,
  MATERIAL_FUNCTIONS,
  PHYSICAL_FORMS,
  type MaterialFunction,
  type RawMaterial,
  type Supplier,
} from "@ai4s/shared";
import { cn } from "@/lib/cn";

/**
 * Create or edit a raw material.
 *
 * Almost every field is optional, because a chemist adding a material at 4pm
 * has the code and the name, not the CAS number and the HLB. The form's job is
 * to let them record what they know now and come back — not to block on data
 * they do not have.
 *
 * What it will not do is fill a blank in for them. An empty active-matter box
 * stays empty, and shows as "not recorded" everywhere it is used.
 */
export function MaterialEditor({
  material,
  suppliers,
  onCancel,
  onSave,
}: {
  material: RawMaterial;
  suppliers: Supplier[];
  onCancel: () => void;
  onSave: (m: RawMaterial) => Promise<void> | void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [draft, setDraft] = useState<RawMaterial>(material);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof RawMaterial>(key: K, value: RawMaterial[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /**
   * Bind a plain text field. Built into a lookup before the JSX so the field
   * keys are not bare string literals inside markup, where they read as display
   * text to both a reviewer and the i18n lint rule.
   */
  const text = (key: keyof RawMaterial) => ({
    value: (draft[key] as string | undefined) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, (e.target.value || undefined) as RawMaterial[typeof key]),
  });

  const bind = Object.fromEntries(
    (
      [
        "code","displayName","tradeName","inciName","manufacturer",
        "activeMatterPercent","density","phMin","phMax","hlb",
        "recommendedMinPercent","recommendedMaxPercent","technicalMaxPercent",
        "countryOfOrigin","storageConditions",
      ] as (keyof RawMaterial)[]
    ).map((k) => [k, text(k)]),
  ) as Record<string, ReturnType<typeof text>>;

  const submit = async () => {
    if (!draft.code.trim() || !draft.displayName.trim() || busy) return;
    setBusy(true);
    try {
      await onSave({
        ...draft,
        // Keep the state field honest about what is actually recorded.
        activeMatterState: draft.activeMatterPercent ? "known" : draft.activeMatterState,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("materials.editMaterial")}
    >
      <div className="my-auto w-[46rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">
          {t("materials.editMaterial")}
        </h2>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          <Section title={t("materials.identity")}>
            <Grid>
              <Field label={t("materials.code")} required>
                <input {...bind.code} className={inputClass} aria-label={t("materials.code")} />
              </Field>
              <Field label={t("materials.name")} required>
                <input
                  {...bind.displayName}
                  className={inputClass}
                  aria-label={t("materials.name")}
                />
              </Field>
              <Field label={t("materials.tradeName")}>
                <input {...bind.tradeName} className={inputClass} aria-label={t("materials.tradeName")} />
              </Field>
              <Field label={t("materials.inci")}>
                <input {...bind.inciName} className={inputClass} aria-label={t("materials.inci")} />
              </Field>
              <Field label={t("materials.cas")} hint={t("materials.listHint")}>
                <input
                  value={draft.casNumbers.join("; ")}
                  onChange={(e) =>
                    set("casNumbers", e.target.value.split(";").map((v) => v.trim()).filter(Boolean))
                  }
                  className={inputClass}
                  aria-label={t("materials.cas")}
                />
              </Field>
              <Field label={t("materials.manufacturer")}>
                <input
                  {...bind.manufacturer}
                  className={inputClass}
                  aria-label={t("materials.manufacturer")}
                />
              </Field>
            </Grid>
          </Section>

          <Section title={t("materials.physical")}>
            <Grid>
              <Field label={t("materials.form")}>
                <select
                  value={draft.physicalForm ?? ""}
                  onChange={(e) =>
                    set("physicalForm", (e.target.value || undefined) as RawMaterial["physicalForm"])
                  }
                  className={inputClass}
                  aria-label={t("materials.form")}
                >
                  <option value="">—</option>
                  {PHYSICAL_FORMS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("materials.ionic")}>
                <select
                  value={draft.ionicCharacter ?? ""}
                  onChange={(e) =>
                    set(
                      "ionicCharacter",
                      (e.target.value || undefined) as RawMaterial["ionicCharacter"],
                    )
                  }
                  className={inputClass}
                  aria-label={t("materials.ionic")}
                >
                  <option value="">—</option>
                  {IONIC_CHARACTERS.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("materials.activeMatter")} hint={t("materials.activeHint")}>
                <input
                  {...bind.activeMatterPercent}
                  inputMode="decimal"
                  className={inputClass}
                  aria-label={t("materials.activeMatter")}
                  placeholder={t("materials.notRecorded")}
                />
              </Field>
              <Field label={t("materials.density")} hint={t("materials.densityHint")}>
                <input
                  {...bind.density}
                  inputMode="decimal"
                  className={inputClass}
                  aria-label={t("materials.density")}
                />
              </Field>
              <Field label={t("materials.phRange")}>
                <div className="flex gap-1">
                  <input {...bind.phMin} inputMode="decimal" className={inputClass} aria-label={t("materials.phMin")} />
                  <input {...bind.phMax} inputMode="decimal" className={inputClass} aria-label={t("materials.phMax")} />
                </div>
              </Field>
              <Field label={t("materials.hlb")}>
                <input {...bind.hlb} inputMode="decimal" className={inputClass} aria-label={t("materials.hlb")} />
              </Field>
            </Grid>
          </Section>

          <Section title={t("materials.usage")}>
            <Grid>
              <Field label={t("materials.minUse")}>
                <input
                  {...bind.recommendedMinPercent}
                  inputMode="decimal"
                  className={inputClass}
                  aria-label={t("materials.minUse")}
                />
              </Field>
              <Field label={t("materials.maxUse")}>
                <input
                  {...bind.recommendedMaxPercent}
                  inputMode="decimal"
                  className={inputClass}
                  aria-label={t("materials.maxUse")}
                />
              </Field>
              <Field label={t("materials.technicalMax")} hint={t("materials.technicalMaxHint")}>
                <input
                  {...bind.technicalMaxPercent}
                  inputMode="decimal"
                  className={inputClass}
                  aria-label={t("materials.technicalMax")}
                />
              </Field>
              <Field label={t("materials.shelfLife")}>
                <input
                  value={draft.shelfLifeMonths ?? ""}
                  onChange={(e) =>
                    set("shelfLifeMonths", e.target.value ? Number(e.target.value) : undefined)
                  }
                  inputMode="numeric"
                  className={inputClass}
                  aria-label={t("materials.shelfLife")}
                />
              </Field>
            </Grid>

            <Field label={t("materials.functions")} hint={t("materials.functionsHint")}>
              <div className="max-h-36 overflow-y-auto rounded-input border border-border p-2">
                <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
                  {MATERIAL_FUNCTIONS.map((f) => (
                    <label key={f} className="flex items-center gap-1.5 text-[11px] text-text">
                      <input
                        type="checkbox"
                        checked={draft.functions.includes(f)}
                        onChange={() =>
                          set(
                            "functions",
                            draft.functions.includes(f)
                              ? draft.functions.filter((x) => x !== f)
                              : [...draft.functions, f as MaterialFunction],
                          )
                        }
                      />
                      {f.replace(/_/g, " ")}
                    </label>
                  ))}
                </div>
              </div>
            </Field>
          </Section>

          <Section title={t("materials.supplyAndSafety")}>
            <Grid>
              <Field label={t("materials.countryOfOrigin")}>
                <input
                  {...bind.countryOfOrigin}
                  className={inputClass}
                  aria-label={t("materials.countryOfOrigin")}
                />
              </Field>
              <Field label={t("materials.storage")}>
                <input
                  {...bind.storageConditions}
                  className={inputClass}
                  aria-label={t("materials.storage")}
                />
              </Field>
            </Grid>
            <Field label={t("materials.hazards")} hint={t("materials.hazardsHint")}>
              <input
                value={draft.hazardClassifications.join("; ")}
                onChange={(e) =>
                  set(
                    "hazardClassifications",
                    e.target.value.split(";").map((v) => v.trim()).filter(Boolean),
                  )
                }
                className={inputClass}
                aria-label={t("materials.hazards")}
              />
            </Field>
            <Field label={t("materials.substitutes")} hint={t("materials.listHint")}>
              <input
                value={draft.substituteCodes.join("; ")}
                onChange={(e) =>
                  set(
                    "substituteCodes",
                    e.target.value.split(";").map((v) => v.trim()).filter(Boolean),
                  )
                }
                className={inputClass}
                aria-label={t("materials.substitutes")}
              />
            </Field>
            {suppliers.length > 0 && (
              <p className="text-[11px] text-muted">
                {t("materials.supplierHint", { count: suppliers.length })}
              </p>
            )}
          </Section>

          <Section title={t("materials.other")}>
            <Field label={t("materials.notes")}>
              <textarea
                value={draft.notes ?? ""}
                onChange={(e) => set("notes", e.target.value || undefined)}
                rows={2}
                className={cn(inputClass, "resize-y")}
                aria-label={t("materials.notes")}
              />
            </Field>
            <label className="flex items-center gap-2 text-[12px] text-text">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => set("active", e.target.checked)}
              />
              {t("materials.activeRecord")}
            </label>
            <p className="text-[11px] text-muted">{t("materials.deactivateHint")}</p>
          </Section>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!draft.code.trim() || !draft.displayName.trim() || busy}
            className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {t("common:actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">
        {label}
        {required && <span className="text-error"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-muted">{hint}</span>}
    </label>
  );
}
