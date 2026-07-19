import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  buildCostSnapshot,
  displayMoney,
  newId,
  type CostSnapshot,
  type ExchangeRate,
  type FactoryCostProfile,
  type Formulation,
  type FormulationLine,
  type MaterialPrice,
  type PackagingBom,
  type PackagingComponent,
  type RawMaterial,
} from "@ai4s/shared";
import { listRecords, upsertRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";

/**
 * Cost of the formula currently in the builder, plus its saved snapshots.
 *
 * The layers are shown separately and never rolled into one figure. "Raw
 * material cost" and "total manufacturing cost" answer different questions, and
 * a single blended number would answer neither.
 *
 * The live figure recalculates as the formula changes; a snapshot is written
 * only when asked for, and once written it does not move.
 */
export function CostPanel({
  formulation,
  versionId,
  lines,
  batchKg,
}: {
  formulation: Formulation;
  versionId?: string;
  lines: FormulationLine[];
  batchKg: string;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [prices, setPrices] = useState<MaterialPrice[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [profiles, setProfiles] = useState<FactoryCostProfile[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [boms, setBoms] = useState<PackagingBom[]>([]);
  const [snapshots, setSnapshots] = useState<CostSnapshot[]>([]);
  const [profileCode, setProfileCode] = useState<string>("");
  const [currency, setCurrency] = useState("KES");
  const [density, setDensity] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, p, r, f, c, b, s] = await Promise.all([
      listRecords("materials"),
      listRecords("material_prices"),
      listRecords("exchange_rates"),
      listRecords("factory_profiles"),
      listRecords("packaging_components"),
      listRecords("packaging_boms"),
      listRecords("cost_snapshots"),
    ]);
    setMaterials(m);
    setPrices(p);
    setRates(r);
    setProfiles(f);
    setComponents(c);
    setBoms(b);
    setSnapshots(s.filter((x) => x.formulationId === formulation.id));
  }, [formulation.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const profile = profiles.find((p) => p.code === profileCode);

  /** SKUs this project is meant to fill, and only those. */
  const relevantBoms = useMemo(
    () => boms.filter((b) => formulation.targetSkuCodes.includes(b.skuCode)),
    [boms, formulation.targetSkuCodes],
  );

  const live = useMemo(
    () =>
      buildCostSnapshot(
        formulation.id,
        versionId ?? "draft",
        {
          lines,
          batchKg,
          currency,
          asOf: new Date().toISOString(),
          materials,
          prices,
          rates,
          profile,
          packagingComponents: components,
          boms: relevantBoms,
          densityKgPerL: density || undefined,
        },
        { code: "live" },
      ),
    [
      formulation.id,
      versionId,
      lines,
      batchKg,
      currency,
      materials,
      prices,
      rates,
      profile,
      components,
      relevantBoms,
      density,
    ],
  );

  const saveSnapshot = async () => {
    if (!versionId) {
      setError(t("cost.needVersion"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertRecords("cost_snapshots", [{ ...live, code: newId("cost") }]);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-auto px-5 py-4">
      {/* Controls */}
      <div className="print-hide mb-4 flex flex-wrap items-end gap-3">
        <Select
          label={t("cost.currency")}
          value={currency}
          onChange={setCurrency}
          options={["KES", "USD", "EUR", "GBP", "TRY"].map((c) => ({ value: c, label: c }))}
        />
        <Select
          label={t("cost.factoryProfile")}
          value={profileCode}
          onChange={setProfileCode}
          options={[
            { value: "", label: t("cost.noProfile") },
            ...profiles.map((p) => ({
              value: p.code,
              label:
                p.verification === "example_only" ? `${p.name} — ${t("cost.exampleOnly")}` : p.name,
            })),
          ]}
        />
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted">{t("cost.density")}</span>
          <input
            value={density}
            onChange={(e) => setDensity(e.target.value)}
            inputMode="decimal"
            placeholder={t("cost.densityPlaceholder")}
            aria-label={t("cost.density")}
            className="w-28 rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
          />
        </label>
        <div className="flex-1" />
        <button
          onClick={saveSnapshot}
          disabled={saving || !versionId}
          title={versionId ? t("cost.snapshotTitle") : t("cost.needVersion")}
          className="flex items-center gap-1.5 rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2 disabled:opacity-40"
        >
          <RefreshCw size={13} /> {t("cost.saveSnapshot")}
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}

      {/* Layers, kept separate on purpose. */}
      <section className="mb-5">
        <h2 className="mb-2 text-[12px] font-medium text-text">{t("cost.layers")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Money label={t("cost.rawMaterial")} value={live.rawMaterialCost} currency={currency} />
          <Money label={t("cost.landed")} value={live.landedMaterialCost} currency={currency} />
          <Money label={t("cost.labour")} value={live.labourCost} currency={currency} />
          <Money label={t("cost.utilities")} value={live.utilitiesCost} currency={currency} />
          <Money label={t("cost.qc")} value={live.qcCost} currency={currency} />
          <Money label={t("cost.waste")} value={live.wasteCost} currency={currency} />
          <Money label={t("cost.overhead")} value={live.overheadCost} currency={currency} />
          <Money
            label={t("cost.totalManufacturing")}
            value={live.totalManufacturingCost}
            currency={currency}
            emphasis
          />
          <Money label={t("cost.perKg")} value={live.costPerKg} currency={currency} />
          {live.costPerLitre && (
            <Money label={t("cost.perLitre")} value={live.costPerLitre} currency={currency} />
          )}
        </div>
      </section>

      {/* SKU costs */}
      {live.skuCosts.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-[12px] font-medium text-text">{t("cost.perSku")}</h2>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="px-2 py-1.5 font-medium">{t("cost.sku")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("cost.fill")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("cost.bulk")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("cost.packaging")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("cost.filled")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("cost.packed")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("cost.perCase")}</th>
              </tr>
            </thead>
            <tbody>
              {live.skuCosts.map((s) => (
                <tr key={s.skuCode} className="border-b border-border-faint">
                  <td className="px-2 py-1 text-text">{s.skuCode}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted">
                    {s.fillQuantity} {s.fillUnit}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted">
                    {s.bulkCostPerUnit ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted">
                    {s.packagingCostPerUnit ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted">
                    {s.filledUnitCost ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium text-text">
                    {s.packedUnitCost ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted">
                    {s.caseCost ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Line detail */}
      <section className="mb-5">
        <h2 className="mb-2 text-[12px] font-medium text-text">{t("cost.lines")}</h2>
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-2 py-1.5 font-medium">{t("cost.material")}</th>
              <th className="px-2 py-1.5 text-right font-medium">%</th>
              <th className="px-2 py-1.5 text-right font-medium">{t("builder.kgUnit")}</th>
              <th className="px-2 py-1.5 text-right font-medium">{t("cost.unitPrice")}</th>
              <th className="px-2 py-1.5 text-right font-medium">{t("cost.lineCost")}</th>
              <th className="px-2 py-1.5 font-medium">{t("cost.basis")}</th>
            </tr>
          </thead>
          <tbody>
            {live.lines.map((l) => (
              <tr key={l.lineId} className="border-b border-border-faint">
                <td className="px-2 py-1 text-text">{l.displayName}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted">{l.percent}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted">{l.quantityKg}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted">
                  {l.unitPrice ? `${l.unitPrice} ${l.sourceCurrency ?? ""}` : "—"}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-text">
                  {l.landedLineCost ?? "—"}
                </td>
                <td className="px-2 py-1 text-[11px] text-muted">
                  {l.missingReason ? (
                    <span className="text-warn">{t(`cost.missing.${l.missingReason}`)}</span>
                  ) : (
                    [l.priceRecordCode, l.exchangeRateCode].filter(Boolean).join(" · ") || "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Warnings — never hidden, because the total depends on them. */}
      {live.missingDataWarnings.length > 0 && (
        <section className="mb-5 rounded-card border border-warn/40 bg-warn/5 px-3 py-2">
          <h2 className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-warn">
            <AlertTriangle size={13} aria-hidden />
            {t("cost.incomplete")}
          </h2>
          <ul className="space-y-0.5 text-[11px] text-muted">
            {live.missingDataWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Saved snapshots */}
      <section>
        <h2 className="mb-2 text-[12px] font-medium text-text">{t("cost.snapshots")}</h2>
        {snapshots.length === 0 ? (
          <p className="text-[12px] text-muted">{t("cost.noSnapshots")}</p>
        ) : (
          <ul className="divide-y divide-border-faint">
            {snapshots.map((s) => (
              <li key={s.code} className="flex items-baseline gap-3 py-1.5 text-[12px]">
                <span className="font-mono text-[11px] text-muted">{s.code}</span>
                <span className="text-muted">{new Date(s.calculatedAt).toLocaleString()}</span>
                <span className="flex-1" />
                <span className="tabular-nums text-text">
                  {displayMoney(s.totalManufacturingCost ?? "0", s.currency)}
                </span>
                {s.missingDataWarnings.length > 0 && (
                  <span className="text-[11px] text-warn">
                    {t("cost.warningCount", { count: s.missingDataWarnings.length })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Money({
  label,
  value,
  currency,
  emphasis,
}: {
  label: string;
  value?: string;
  currency: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-card border px-3 py-2",
        emphasis ? "border-accent/40 bg-accent/5" : "border-border",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={cn(
          "mt-0.5 tabular-nums",
          emphasis ? "text-[14px] font-medium text-text" : "text-[13px] text-text",
        )}
      >
        {value ? displayMoney(value, currency) : "—"}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
