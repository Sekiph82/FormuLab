import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical, Play, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  isTauri,
  runFormulationOptimize,
  type FormulationInput,
  type FormulationMaterial,
  type FormulationResult,
} from "@/lib/tauri";
import { cn } from "@/lib/cn";

/**
 * Chemical formulation cost optimizer. Edit the raw-material table and the two
 * batch constraints, then solve the linear program (bundled Python + PuLP via
 * the `run_formulation_optimize` Tauri command). Results — the cheapest mix
 * that hits the active-matter target within stock/usage limits — render below.
 */

type Row = FormulationMaterial & { id: number };

let nextId = 100;
const row = (m: Partial<FormulationMaterial>): Row => ({
  id: nextId++,
  name: m.name ?? "",
  unit_price: m.unit_price ?? 0,
  stock: m.stock ?? 0,
  active_matter_pct: m.active_matter_pct ?? 0,
  max_usage_pct: m.max_usage_pct ?? 100,
});

// A small worked example so the page is never a blank grid — two actives at
// different price/strength, target 50% active. Cheapest feasible mix is 50/50.
const DEMO: Row[] = [
  row({ name: "Surfactant A", unit_price: 3.2, stock: 400, active_matter_pct: 90, max_usage_pct: 100 }),
  row({ name: "Surfactant B", unit_price: 1.1, stock: 400, active_matter_pct: 20, max_usage_pct: 100 }),
  row({ name: "Filler", unit_price: 0.4, stock: 400, active_matter_pct: 0, max_usage_pct: 60 }),
];

/** Editable numeric columns, in display order. Declared outside the JSX
 *  subtree so the i18n literal-string lint (which scans JSX for user-facing
 *  text) does not mistake these field keys for translatable copy. */
const NUMERIC_FIELDS = ["unit_price", "stock", "active_matter_pct", "max_usage_pct"] as const;

export function OptimizerPage() {
  const { t } = useTranslation(["pages", "common"]);
  const [rows, setRows] = useState<Row[]>(DEMO);
  const [batchSize, setBatchSize] = useState(1000);
  const [minActive, setMinActive] = useState(40);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FormulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const numberField =
    (id: number, key: keyof FormulationMaterial) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = key === "name" ? e.target.value : Number(e.target.value);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    };

  const addRow = () => setRows((prev) => [...prev, row({})]);
  const removeRow = (id: number) => setRows((prev) => prev.filter((r) => r.id !== id));

  const canSolve = useMemo(
    () => isTauri && rows.length > 0 && batchSize > 0 && !busy,
    [rows.length, batchSize, busy],
  );

  const solve = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const input: FormulationInput = {
      materials: rows.map(({ id: _id, ...m }) => m),
      constraints: { batch_size: batchSize, min_active_pct: minActive },
    };
    try {
      const res = await runFormulationOptimize(input);
      if (!res) {
        setError(t("optimizer.desktopOnly"));
      } else {
        setResult(res);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const optimal = result?.status === "optimal";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <h1 className="flex items-center gap-2 font-serif text-xl text-text">
          <FlaskConical size={20} className="text-accent" />
          {t("optimizer.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("optimizer.description")}</p>

        {!isTauri && (
          <div className="mt-4 rounded-card border border-border bg-surface p-4 text-sm text-muted">
            {t("optimizer.desktopOnly")}
          </div>
        )}

        {/* Materials table */}
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
            {t("optimizer.materials.heading")}
          </h2>
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">{t("optimizer.materials.name")}</th>
                  <th className="px-3 py-2 font-medium">{t("optimizer.materials.price")}</th>
                  <th className="px-3 py-2 font-medium">{t("optimizer.materials.stock")}</th>
                  <th className="px-3 py-2 font-medium">{t("optimizer.materials.active")}</th>
                  <th className="px-3 py-2 font-medium">{t("optimizer.materials.maxUsage")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border-faint last:border-0">
                    <td className="px-2 py-1.5">
                      <input
                        value={r.name}
                        onChange={numberField(r.id, "name")}
                        placeholder={t("optimizer.materials.namePlaceholder")}
                        className="w-40 rounded-input border border-transparent bg-transparent px-2 py-1 text-text outline-none hover:border-border focus:border-accent"
                      />
                    </td>
                    {NUMERIC_FIELDS.map(
                      (key) => (
                        <td key={key} className="px-2 py-1.5">
                          <input
                            type="number"
                            value={r[key]}
                            onChange={numberField(r.id, key)}
                            className="w-24 rounded-input border border-transparent bg-transparent px-2 py-1 text-right tabular-nums text-text outline-none hover:border-border focus:border-accent"
                          />
                        </td>
                      ),
                    )}
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={() => removeRow(r.id)}
                        aria-label={t("optimizer.materials.removeAria", { name: r.name || "row" })}
                        className="rounded p-1 text-muted hover:bg-surface-2 hover:text-error"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={addRow}
            className="mt-2 flex items-center gap-1.5 rounded-input px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-text"
          >
            <Plus size={14} /> {t("optimizer.materials.add")}
          </button>
        </section>

        {/* Constraints + solve */}
        <section className="mt-6 flex flex-wrap items-end gap-6 rounded-card border border-border bg-surface p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wider text-muted">
              {t("optimizer.constraints.batchSize")}
            </span>
            <input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="w-32 rounded-input border border-border bg-surface px-3 py-1.5 text-right tabular-nums text-text outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wider text-muted">
              {t("optimizer.constraints.minActive")}
            </span>
            <input
              type="number"
              value={minActive}
              onChange={(e) => setMinActive(Number(e.target.value))}
              className="w-32 rounded-input border border-border bg-surface px-3 py-1.5 text-right tabular-nums text-text outline-none focus:border-accent"
            />
          </label>
          <button
            onClick={() => void solve()}
            disabled={!canSolve}
            className="ml-auto flex items-center gap-2 rounded-input bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            <Play size={15} />
            {busy ? t("optimizer.solving") : t("optimizer.solve")}
          </button>
        </section>

        {/* Errors */}
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-card border border-error/40 bg-error/5 p-4 text-sm text-text">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-error" />
            <span className="whitespace-pre-wrap">{error}</span>
          </div>
        )}

        {/* Result */}
        {result && !optimal && (
          <div className="mt-4 flex items-start gap-2 rounded-card border border-border bg-surface p-4 text-sm text-text">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-muted" />
            <div>
              <div className="font-medium">
                {t("optimizer.result.notOptimal", { status: result.status })}
              </div>
              {result.message && <div className="mt-1 text-muted">{result.message}</div>}
            </div>
          </div>
        )}

        {result && optimal && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
              {t("optimizer.result.heading")}
            </h2>
            <div className="mb-3 flex flex-wrap gap-4">
              <Stat
                label={t("optimizer.result.totalCost")}
                value={result.total_cost != null ? result.total_cost.toLocaleString() : "—"}
              />
              <Stat
                label={t("optimizer.result.achievedActive")}
                value={
                  result.achieved_active_pct != null
                    ? `${result.achieved_active_pct}%`
                    : "—"
                }
              />
              <Stat label={t("optimizer.result.batch")} value={`${result.batch_size} kg`} />
            </div>
            <div className="overflow-x-auto rounded-card border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">{t("optimizer.materials.name")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("optimizer.result.qty")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("optimizer.result.share")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("optimizer.result.cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((it) => (
                    <tr key={it.name} className="border-b border-border-faint last:border-0">
                      <td className="px-3 py-2 text-text">{it.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text">{it.quantity_kg}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{it.share_pct}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text">{it.cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface px-4 py-3")}>
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 font-serif text-lg text-text tabular-nums">{value}</div>
    </div>
  );
}
