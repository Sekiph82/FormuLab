import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileSpreadsheet, Plus, Search, Upload } from "lucide-react";
import {
  INVENTORY_FIELDS,
  MATERIAL_FIELDS,
  MATERIAL_FUNCTIONS,
  PRICE_FIELDS,
  SUPPLIER_FIELDS,
  landedUnitCost,
  templateCsv,
  toCsv,
  type ExchangeRate,
  type FieldSpec,
  type InventoryRecord,
  type MaterialPrice,
  type RawMaterial,
  type Supplier,
} from "@ai4s/shared";
import { ImportDialog } from "@/components/formula/ImportDialog";
import { MaterialEditor } from "@/components/formula/MaterialEditor";
import { buildXlsxBlob } from "@/lib/xlsx";
import {
  listRecords,
  newMaterial,
  newSupplier,
  nowIso,
  upsertRecords,
  type Collection,
} from "@/lib/masterdata";
import { cn } from "@/lib/cn";

type Tab = "materials" | "suppliers" | "prices" | "inventory" | "rates";

const TAB_CONFIG: Record<
  Tab,
  { collection: Collection; fields: FieldSpec[]; appendOnly?: boolean }
> = {
  materials: { collection: "materials", fields: MATERIAL_FIELDS },
  suppliers: { collection: "suppliers", fields: SUPPLIER_FIELDS },
  prices: { collection: "material_prices", fields: PRICE_FIELDS, appendOnly: true },
  inventory: { collection: "inventory", fields: INVENTORY_FIELDS },
  rates: { collection: "exchange_rates", fields: [], appendOnly: true },
};

/**
 * Raw material master data: materials, suppliers, price history, inventory and
 * exchange rates.
 *
 * Price and rate records are append-only, and the UI says so rather than
 * offering an edit that the storage layer would refuse. A cost snapshot taken
 * last quarter points at these rows; letting someone rewrite one would silently
 * change what a past margin review was based on.
 */
export function MaterialsPage() {
  const { t } = useTranslation(["session", "common"]);
  const [tab, setTab] = useState<Tab>("materials");
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [prices, setPrices] = useState<MaterialPrice[]>([]);
  const [inventory, setInventory] = useState<InventoryRecord[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [query, setQuery] = useState("");
  const [fnFilter, setFnFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<RawMaterial | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, s, p, i, r] = await Promise.all([
      listRecords("materials"),
      listRecords("suppliers"),
      listRecords("material_prices"),
      listRecords("inventory"),
      listRecords("exchange_rates"),
    ]);
    setMaterials(m);
    setSuppliers(s);
    setPrices(p);
    setInventory(i);
    setRates(r);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredMaterials = useMemo(() => {
    const q = query.trim().toLowerCase();
    return materials
      .filter((m) => showInactive || m.active)
      .filter((m) => !fnFilter || m.functions.includes(fnFilter as never))
      .filter(
        (m) =>
          !q ||
          [m.code, m.displayName, m.tradeName, m.inciName, m.manufacturer, ...m.casNumbers]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      );
  }, [materials, query, fnFilter, showInactive]);

  /** How many price records exist per material — "has a price" at a glance. */
  const priceCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of prices) counts.set(p.materialCode, (counts.get(p.materialCode) ?? 0) + 1);
    return counts;
  }, [prices]);

  const stock = useMemo(() => {
    const totals = new Map<string, number>();
    for (const i of inventory) {
      const available = Number(i.quantity) - Number(i.reservedQuantity ?? "0");
      totals.set(i.materialCode, (totals.get(i.materialCode) ?? 0) + available);
    }
    return totals;
  }, [inventory]);

  const config = TAB_CONFIG[tab];

  const currentRows = (): Record<string, unknown>[] =>
    tab === "materials"
      ? filteredMaterials
      : tab === "suppliers"
        ? suppliers
        : tab === "prices"
          ? prices
          : tab === "inventory"
            ? inventory
            : rates;

  const exportCurrent = () => {
    const rows = currentRows();
    const headers = config.fields.length > 0 ? config.fields.map((f) => f.field) : Object.keys(rows[0] ?? {});
    download(`${tab}.csv`, toCsv(headers, rows));
  };

  const exportCurrentXlsx = async () => {
    const rows = currentRows();
    const headers = config.fields.length > 0 ? config.fields.map((f) => f.field) : Object.keys(rows[0] ?? {});
    downloadBlob(`${tab}.xlsx`, await buildXlsxBlob(headers, rows, tab));
  };

  const downloadTemplate = () => {
    if (config.fields.length === 0) return;
    download(`${tab}-template.csv`, templateCsv(config.fields));
  };

  const downloadTemplateXlsx = async () => {
    if (config.fields.length === 0) return;
    downloadBlob(`${tab}-template.xlsx`, await buildXlsxBlob(config.fields.map((f) => f.field), [], tab));
  };

  const onImported = async (records: Record<string, unknown>[]) => {
    const stamped = records.map((r) => stampDefaults(tab, r));
    const result = await upsertRecords(config.collection, stamped as never);
    setStatus(
      t("materials.importResult", { inserted: result.inserted, updated: result.updated }),
    );
    setImporting(false);
    await load();
  };

  const createMaterial = async () => {
    const code = `RM-${Date.now().toString(36).toUpperCase()}`;
    setEditing(newMaterial(code, ""));
  };

  const saveMaterial = async (m: RawMaterial) => {
    await upsertRecords("materials", [{ ...m, updatedAt: nowIso() }]);
    setEditing(null);
    await load();
  };

  const createSupplier = async () => {
    const code = `SUP-${Date.now().toString(36).toUpperCase()}`;
    await upsertRecords("suppliers", [newSupplier(code, code)]);
    await load();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2">
        <nav className="flex gap-1" aria-label={t("materials.sections")}>
          {(Object.keys(TAB_CONFIG) as Tab[]).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-current={tab === k ? "page" : undefined}
              className={cn(
                "rounded-input px-2.5 py-1 text-xs",
                tab === k ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text",
              )}
            >
              {t(`materials.tab.${k}`)}
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        {tab === "materials" && (
          <button
            onClick={createMaterial}
            className="flex items-center gap-1.5 rounded-input bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90"
          >
            <Plus size={13} /> {t("materials.newMaterial")}
          </button>
        )}
        {tab === "suppliers" && (
          <button
            onClick={createSupplier}
            className="flex items-center gap-1.5 rounded-input bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90"
          >
            <Plus size={13} /> {t("materials.newSupplier")}
          </button>
        )}
        {config.fields.length > 0 && (
          <>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
            >
              <Download size={13} /> {t("materials.template")}
            </button>
            <button
              onClick={() => void downloadTemplateXlsx()}
              title={t("materials.templateXlsx")}
              className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
            >
              <FileSpreadsheet size={13} /> {t("materials.templateXlsx")}
            </button>
            <button
              onClick={() => setImporting(true)}
              className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
            >
              <Upload size={13} /> {t("materials.import")}
            </button>
          </>
        )}
        <button
          onClick={exportCurrent}
          className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
        >
          <Download size={13} /> {t("materials.export")}
        </button>
        <button
          onClick={() => void exportCurrentXlsx()}
          title={t("materials.exportXlsx")}
          className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
        >
          <FileSpreadsheet size={13} /> {t("materials.exportXlsx")}
        </button>
      </header>

      {status && (
        <div role="status" className="shrink-0 bg-ok/10 px-5 py-1.5 text-[12px] text-ok">
          {status}
        </div>
      )}

      {config.appendOnly && (
        <p className="shrink-0 border-b border-border-faint px-5 py-1.5 text-[11px] text-muted">
          {t("materials.appendOnlyNote")}
        </p>
      )}

      {tab === "materials" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-faint px-5 py-2">
          <label className="flex items-center gap-1 text-[12px] text-muted">
            <Search size={13} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("materials.search")}
              aria-label={t("materials.search")}
              className="w-52 rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-accent"
            />
          </label>
          <select
            value={fnFilter}
            onChange={(e) => setFnFilter(e.target.value)}
            aria-label={t("materials.filterFunction")}
            className="rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-accent"
          >
            <option value="">{t("materials.allFunctions")}</option>
            {MATERIAL_FUNCTIONS.map((f) => (
              <option key={f} value={f}>
                {f.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            {t("materials.showInactive")}
          </label>
          <span className="text-[11px] text-muted">
            {t("materials.count", { count: filteredMaterials.length })}
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "materials" && (
          <MaterialTable
            materials={filteredMaterials}
            priceCount={priceCount}
            stock={stock}
            onEdit={setEditing}
          />
        )}
        {tab === "suppliers" && <SupplierTable suppliers={suppliers} />}
        {tab === "prices" && <PriceTable prices={prices} />}
        {tab === "inventory" && <InventoryTable inventory={inventory} />}
        {tab === "rates" && <RateTable rates={rates} />}
      </div>

      {importing && (
        <ImportDialog
          title={t(`materials.tab.${tab}`)}
          fields={config.fields}
          existingCodes={existingCodesFor(tab, { materials, suppliers, prices, inventory, rates })}
          onCancel={() => setImporting(false)}
          onCommit={onImported}
        />
      )}

      {editing && (
        <MaterialEditor
          material={editing}
          suppliers={suppliers}
          onCancel={() => setEditing(null)}
          onSave={saveMaterial}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ tables ---

function MaterialTable({
  materials,
  priceCount,
  stock,
  onEdit,
}: {
  materials: RawMaterial[];
  priceCount: Map<string, number>;
  stock: Map<string, number>;
  onEdit: (m: RawMaterial) => void;
}) {
  const { t } = useTranslation("session");
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead className="sticky top-0 bg-surface">
        <tr className="border-b border-border text-left text-muted">
          <th className="px-3 py-1.5 font-medium">{t("materials.code")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.name")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.functions")}</th>
          <th className="px-3 py-1.5 text-right font-medium">{t("materials.active")}</th>
          <th className="px-3 py-1.5 text-right font-medium">{t("materials.density")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.supplierData")}</th>
          <th className="px-3 py-1.5 text-right font-medium">{t("materials.stock")}</th>
        </tr>
      </thead>
      <tbody>
        {materials.map((m) => (
          <tr key={m.code} className="border-b border-border-faint hover:bg-surface-2">
            <td className="px-3 py-1.5">
              <button onClick={() => onEdit(m)} className="font-mono text-[11px] text-accent hover:underline">
                {m.code}
              </button>
            </td>
            <td className="px-3 py-1.5 text-text">
              {m.displayName}
              {!m.active && (
                <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] text-muted">
                  {t("materials.inactive")}
                </span>
              )}
            </td>
            <td className="px-3 py-1.5 text-muted">
              {m.functions.map((f) => f.replace(/_/g, " ")).join(", ") || "—"}
            </td>
            {/* Missing data is shown as missing, never as a zero. */}
            <td className="px-3 py-1.5 text-right tabular-nums">
              {m.activeMatterPercent ? (
                <span className="text-text">{m.activeMatterPercent}%</span>
              ) : (
                <span className="text-warn">{t("materials.notRecorded")}</span>
              )}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-muted">{m.density ?? "—"}</td>
            <td className="px-3 py-1.5 text-muted">
              {priceCount.get(m.code)
                ? t("materials.priceCount", { count: priceCount.get(m.code) })
                : t("materials.noPrice")}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-muted">
              {stock.has(m.code) ? stock.get(m.code)!.toFixed(2) : "—"}
            </td>
          </tr>
        ))}
        {materials.length === 0 && (
          <tr>
            <td colSpan={7} className="py-10 text-center text-muted">
              {t("materials.empty")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function SupplierTable({ suppliers }: { suppliers: Supplier[] }) {
  const { t } = useTranslation("session");
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead className="sticky top-0 bg-surface">
        <tr className="border-b border-border text-left text-muted">
          <th className="px-3 py-1.5 font-medium">{t("materials.code")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.name")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.country")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.currency")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.quality")}</th>
        </tr>
      </thead>
      <tbody>
        {suppliers.map((s) => (
          <tr key={s.code} className="border-b border-border-faint">
            <td className="px-3 py-1.5 font-mono text-[11px] text-muted">{s.code}</td>
            <td className="px-3 py-1.5 text-text">{s.displayName}</td>
            <td className="px-3 py-1.5 text-muted">{s.country ?? "—"}</td>
            <td className="px-3 py-1.5 text-muted">{s.currency}</td>
            <td className="px-3 py-1.5 text-muted">{s.qualityStatus.replace(/_/g, " ")}</td>
          </tr>
        ))}
        {suppliers.length === 0 && (
          <tr>
            <td colSpan={5} className="py-10 text-center text-muted">
              {t("materials.empty")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function PriceTable({ prices }: { prices: MaterialPrice[] }) {
  const { t } = useTranslation("session");
  const sorted = [...prices].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead className="sticky top-0 bg-surface">
        <tr className="border-b border-border text-left text-muted">
          <th className="px-3 py-1.5 font-medium">{t("materials.material")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.supplier")}</th>
          <th className="px-3 py-1.5 text-right font-medium">{t("materials.price")}</th>
          <th className="px-3 py-1.5 text-right font-medium">{t("materials.landed")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.effective")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.verification")}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const landed = landedUnitCost(p);
          return (
            <tr key={p.code} className="border-b border-border-faint">
              <td className="px-3 py-1.5 font-mono text-[11px] text-text">{p.materialCode}</td>
              <td className="px-3 py-1.5 text-muted">{p.supplierCode ?? "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-text">
                {p.price} {p.currency}/{p.priceUnit}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted">
                {landed.landedUnitCost.toFixed(4)}
              </td>
              <td className="px-3 py-1.5 text-muted">
                {p.effectiveFrom.slice(0, 10)}
                {p.effectiveTo ? ` → ${p.effectiveTo.slice(0, 10)}` : ""}
              </td>
              <td className="px-3 py-1.5 text-muted">{p.verification.replace(/_/g, " ")}</td>
            </tr>
          );
        })}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={6} className="py-10 text-center text-muted">
              {t("materials.empty")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function InventoryTable({ inventory }: { inventory: InventoryRecord[] }) {
  const { t } = useTranslation("session");
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead className="sticky top-0 bg-surface">
        <tr className="border-b border-border text-left text-muted">
          <th className="px-3 py-1.5 font-medium">{t("materials.material")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.lot")}</th>
          <th className="px-3 py-1.5 text-right font-medium">{t("materials.quantity")}</th>
          <th className="px-3 py-1.5 text-right font-medium">{t("materials.available")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.expiry")}</th>
          <th className="px-3 py-1.5 font-medium">{t("materials.qcState")}</th>
        </tr>
      </thead>
      <tbody>
        {inventory.map((i) => (
          <tr key={i.code} className="border-b border-border-faint">
            <td className="px-3 py-1.5 font-mono text-[11px] text-text">{i.materialCode}</td>
            <td className="px-3 py-1.5 text-muted">{i.lot ?? "—"}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-muted">
              {i.quantity} {i.unit}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-text">
              {(Number(i.quantity) - Number(i.reservedQuantity ?? "0")).toFixed(2)}
            </td>
            <td className="px-3 py-1.5 text-muted">{i.expiresAt?.slice(0, 10) ?? "—"}</td>
            <td className="px-3 py-1.5 text-muted">
              {i.quarantined
                ? t("materials.quarantined")
                : i.released
                  ? t("materials.released")
                  : t("materials.pending")}
            </td>
          </tr>
        ))}
        {inventory.length === 0 && (
          <tr>
            <td colSpan={6} className="py-10 text-center text-muted">
              {t("materials.empty")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function RateTable({ rates }: { rates: ExchangeRate[] }) {
  const { t } = useTranslation("session");
  const sorted = [...rates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return (
    <>
      <p className="px-5 py-2 text-[11px] text-muted">{t("materials.ratesNote")}</p>
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-muted">
            <th className="px-3 py-1.5 font-medium">{t("materials.pair")}</th>
            <th className="px-3 py-1.5 text-right font-medium">{t("materials.rate")}</th>
            <th className="px-3 py-1.5 font-medium">{t("materials.effective")}</th>
            <th className="px-3 py-1.5 font-medium">{t("materials.source")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.code} className="border-b border-border-faint">
              <td className="px-3 py-1.5 text-text">
                {r.baseCurrency} → {r.quoteCurrency}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-text">{r.rate}</td>
              <td className="px-3 py-1.5 text-muted">{r.effectiveFrom.slice(0, 10)}</td>
              <td className="px-3 py-1.5 text-muted">{r.source}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={4} className="py-10 text-center text-muted">
                {t("materials.noRates")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

// ------------------------------------------------------------------ helpers ---

/** Fill in the fields an imported row cannot carry but the schema requires. */
function stampDefaults(tab: Tab, row: Record<string, unknown>): Record<string, unknown> {
  const base = { schemaVersion: "1.0", ...row };
  switch (tab) {
    case "materials":
      return {
        casNumbers: [],
        ecNumbers: [],
        functions: [],
        documents: [],
        regulatoryStatuses: [],
        hazardClassifications: [],
        allergens: [],
        incompatibilities: [],
        substituteCodes: [],
        activeMatterState: row.activeMatterPercent ? "known" : "missing",
        active: true,
        createdAt: nowIso(),
        ...base,
        updatedAt: nowIso(),
      };
    case "suppliers":
      return {
        legalName: row.displayName,
        currency: "KES",
        approved: false,
        qualityStatus: "not_assessed",
        active: true,
        createdAt: nowIso(),
        ...base,
        updatedAt: nowIso(),
      };
    case "prices":
      return {
        priceUnit: "kg",
        allocationBasis: "per_kg",
        // An imported price is not a verified one until someone checks it
        // against the invoice.
        verification: "not_verified",
        recordedBy: "import",
        ...base,
        recordedAt: nowIso(),
      };
    case "inventory":
      return {
        warehouse: "main",
        unit: "kg",
        reservedQuantity: "0",
        coaStatus: "pending",
        quarantined: false,
        released: false,
        ...base,
        updatedAt: nowIso(),
      };
    default:
      return base;
  }
}

function existingCodesFor(
  tab: Tab,
  data: {
    materials: RawMaterial[];
    suppliers: Supplier[];
    prices: MaterialPrice[];
    inventory: InventoryRecord[];
    rates: ExchangeRate[];
  },
): string[] {
  switch (tab) {
    case "materials":
      return data.materials.map((m) => m.code);
    case "suppliers":
      return data.suppliers.map((s) => s.code);
    case "prices":
      return data.prices.map((p) => p.code);
    case "inventory":
      return data.inventory.map((i) => i.code);
    default:
      return data.rates.map((r) => r.code);
  }
}

function download(filename: string, content: string) {
  // A BOM so Excel opens the file as UTF-8 instead of mangling accented names.
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8" });
  downloadBlob(filename, blob);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
