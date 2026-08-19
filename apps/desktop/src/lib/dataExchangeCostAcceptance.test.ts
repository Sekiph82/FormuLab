/**
 * FVL-04.006/.008 hardening — real Cost Engine acceptance.
 *
 * The prior session proved MaterialPrice/ExchangeRate commit through Data
 * Exchange, then called `priceFor()`/`findRate()` directly on the committed
 * records. That is real but narrow: it never proves the FULL costing chain
 * (`costFormula()`) a chemist actually sees — price selection, FX
 * conversion, and multi-currency totals together. This file closes that
 * gap: every MaterialPrice/ExchangeRate fixture here is committed through
 * the real `commitDataExchangeRows()` path first, then the committed
 * records (never hand-built ones) are fed into the real `costFormula()`.
 * No price/rate arithmetic is ever duplicated here as a source of truth —
 * every assertion reads the engine's own returned result.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { costFormula, getDataExchangeTemplate, type DataExchangeRowResult, type ExchangeRate, type FormulationLine, type MaterialPrice, type RawMaterial } from "@formulab/shared";
import { commitDataExchangeRows } from "./dataExchangeCommit";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

const ctx = { actorUserId: "local", actorRole: "administrator" as const };

function row(record: Record<string, string>): DataExchangeRowResult {
  return { rowNumber: 2, naturalKey: "TEST-KEY", state: "valid_create", messages: [], record };
}

async function commitPrice(fields: Record<string, string>): Promise<void> {
  await commitDataExchangeRows(getDataExchangeTemplate("material_prices")!, [row(fields)], ctx);
}
async function commitRate(fields: Record<string, string>): Promise<void> {
  await commitDataExchangeRows(getDataExchangeTemplate("exchange_rates")!, [row(fields)], ctx);
}
function committed<T>(collection: string): T[] {
  return bridge.upsertRecords.mock.calls.filter(([c]) => c === collection).map(([, r]) => (r as T[])[0]);
}

function material(code: string): RawMaterial {
  return {
    schemaVersion: "1.0",
    code,
    displayName: code,
    casNumbers: [],
    ecNumbers: [],
    documents: [],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    functions: [],
    activeMatterState: "missing",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function line(materialCode: string, percent: string, supplierCode?: string): FormulationLine {
  return {
    id: `line-${materialCode}`,
    lineNumber: 1,
    phase: "A",
    materialCode,
    supplierCode,
    displayName: materialCode,
    percent,
    isQsToHundred: false,
    functions: [],
    provenance: { origin: "chemist_override", evidenceClaimIds: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

describe("FVL-04.006 hardening — imported MaterialPrice reaches the real Cost Engine", () => {
  it("P1: a single current valid price is selected and costs correctly", async () => {
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "100", currency: "KES", valid_from: "2026-01-01" });
    const prices = committed<MaterialPrice>("material_prices");
    const result = costFormula({
      lines: [line("MAT-A", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-01",
      materials: [material("MAT-A")],
      prices,
      rates: [],
    });
    expect(result.incomplete).toBe(false);
    // 10kg batch, 100% MAT-A -> 10kg * 100 KES/kg = 1000 KES.
    expect(result.rawMaterialCost.toString()).toBe("1000");
  });

  it("P2: an expired price is NOT selected when a current valid price also exists", async () => {
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "999", currency: "KES", valid_from: "2025-01-01", valid_until: "2025-06-30" });
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "100", currency: "KES", valid_from: "2025-07-01" });
    const prices = committed<MaterialPrice>("material_prices");
    const result = costFormula({
      lines: [line("MAT-A", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-01",
      materials: [material("MAT-A")],
      prices,
      rates: [],
    });
    expect(result.rawMaterialCost.toString()).toBe("1000");
    expect(result.lines[0].unitPrice).toBe("100.000000");
  });

  it("P3: a future-dated price is NOT selected before its effectiveFrom", async () => {
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "100", currency: "KES", valid_from: "2025-01-01" });
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "500", currency: "KES", valid_from: "2027-01-01" });
    const prices = committed<MaterialPrice>("material_prices");
    const result = costFormula({
      lines: [line("MAT-A", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-01",
      materials: [material("MAT-A")],
      prices,
      rates: [],
    });
    expect(result.rawMaterialCost.toString()).toBe("1000");
  });

  it("P4: two suppliers with valid prices — a line pinned to a specific supplier gets that supplier's own real price (no importer-local selection)", async () => {
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "100", currency: "KES", valid_from: "2026-01-01" });
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-2", unit_price: "80", currency: "KES", valid_from: "2026-01-01" });
    const prices = committed<MaterialPrice>("material_prices");
    const result = costFormula({
      lines: [line("MAT-A", "100", "SUP-2")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-01",
      materials: [material("MAT-A")],
      prices,
      rates: [],
    });
    expect(result.rawMaterialCost.toString()).toBe("800");
  });

  it("P5: a material with no committed price stays missing — the engine's real no_price state, never a fabricated cost", async () => {
    const result = costFormula({
      lines: [line("MAT-NOPRICE", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-01",
      materials: [material("MAT-NOPRICE")],
      prices: [],
      rates: [],
    });
    expect(result.incomplete).toBe(true);
    expect(result.lines[0].missingReason).toBe("no_price");
  });

  it("P6: historical rows remain append-only and unmodified after a later import", async () => {
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "100", currency: "KES", valid_from: "2026-01-01", valid_until: "2026-06-30" });
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "110", currency: "KES", valid_from: "2026-07-01" });
    const prices = committed<MaterialPrice>("material_prices");
    expect(prices).toHaveLength(2);
    expect(prices[0]).toMatchObject({ price: "100", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" });
    expect(prices[1]).toMatchObject({ price: "110", effectiveFrom: "2026-07-01" });
  });

  it("P7: exact materialCode/supplierCode identity survives from CSV row to committed record", async () => {
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "100", currency: "KES", valid_from: "2026-01-01" });
    const [p] = committed<MaterialPrice>("material_prices");
    expect(p.materialCode).toBe("MAT-A");
    expect(p.supplierCode).toBe("SUP-1");
  });

  it("P8: no importer-local price-selection logic exists — commitMaterialPrices never reads other MaterialPrice rows to decide which one 'wins'", async () => {
    // Proven by construction: commitPrice's own handler signature takes one
    // row at a time and never calls listRecords("material_prices") — grep
    // confirmed in the .006 tracker audit. Re-asserted here operationally:
    // committing an OLDER price after a newer one does not reorder or
    // reject it — selection is entirely `priceFor`/`costFormula`'s job.
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "200", currency: "KES", valid_from: "2026-06-01" });
    await commitPrice({ material_code: "MAT-A", supplier_code: "SUP-1", unit_price: "100", currency: "KES", valid_from: "2026-01-01" });
    const prices = committed<MaterialPrice>("material_prices");
    expect(prices).toHaveLength(2);
    const result = costFormula({
      lines: [line("MAT-A", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-15",
      materials: [material("MAT-A")],
      prices,
      rates: [],
    });
    // The real engine picks the most-recent-effective live price (200),
    // proving selection happens in costFormula/priceFor, not at commit time.
    expect(result.rawMaterialCost.toString()).toBe("2000");
  });
});

describe("FVL-04.008 hardening — imported ExchangeRate reaches the real Cost Engine's full mixed-currency costing", () => {
  it("FX1-FX4: a USD MaterialPrice + an imported USD/KES rate produce a real, engine-computed KES total", async () => {
    await commitPrice({ material_code: "MAT-USD", supplier_code: "SUP-US", unit_price: "10", currency: "USD", valid_from: "2026-01-01" });
    await commitRate({ base_currency: "USD", quote_currency: "KES", rate: "130", effective_from: "2026-01-01", source: "TEST Bank" });
    const prices = committed<MaterialPrice>("material_prices");
    const rates = committed<ExchangeRate>("exchange_rates");
    const result = costFormula({
      lines: [line("MAT-USD", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-01",
      materials: [material("MAT-USD")],
      prices,
      rates,
    });
    expect(result.incomplete).toBe(false);
    // 10kg * 10 USD/kg * 130 KES/USD = 13000 KES.
    expect(result.rawMaterialCost.toString()).toBe("13000");
    expect(result.exchangeRateCodes[0]).toBe(rates[0].code);
  });

  it("FX5: the same USD price WITHOUT a matching imported rate yields the real engine's no_exchange_rate state, never a fabricated conversion", async () => {
    await commitPrice({ material_code: "MAT-USD", supplier_code: "SUP-US", unit_price: "10", currency: "USD", valid_from: "2026-01-01" });
    const prices = committed<MaterialPrice>("material_prices");
    const result = costFormula({
      lines: [line("MAT-USD", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-01",
      materials: [material("MAT-USD")],
      prices,
      rates: [],
    });
    expect(result.incomplete).toBe(true);
    expect(result.lines[0].missingReason).toBe("no_exchange_rate");
  });

  it("FX6: a future-dated imported rate is NOT selected before its effectiveFrom", async () => {
    await commitPrice({ material_code: "MAT-USD", supplier_code: "SUP-US", unit_price: "10", currency: "USD", valid_from: "2026-01-01" });
    await commitRate({ base_currency: "USD", quote_currency: "KES", rate: "130", effective_from: "2026-01-01", source: "TEST Bank" });
    await commitRate({ base_currency: "USD", quote_currency: "KES", rate: "999", effective_from: "2027-01-01", source: "TEST Bank" });
    const prices = committed<MaterialPrice>("material_prices");
    const rates = committed<ExchangeRate>("exchange_rates");
    const result = costFormula({
      lines: [line("MAT-USD", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-01",
      materials: [material("MAT-USD")],
      prices,
      rates,
    });
    expect(result.rawMaterialCost.toString()).toBe("13000");
  });

  it("FX7: the real engine selects the most-recent effective imported rate as of asOf (historical rate semantics)", async () => {
    await commitPrice({ material_code: "MAT-USD", supplier_code: "SUP-US", unit_price: "10", currency: "USD", valid_from: "2026-01-01" });
    await commitRate({ base_currency: "USD", quote_currency: "KES", rate: "130", effective_from: "2026-01-01", source: "TEST Bank" });
    await commitRate({ base_currency: "USD", quote_currency: "KES", rate: "140", effective_from: "2026-07-01", source: "TEST Bank" });
    const prices = committed<MaterialPrice>("material_prices");
    const rates = committed<ExchangeRate>("exchange_rates");
    const result = costFormula({
      lines: [line("MAT-USD", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-08-01",
      materials: [material("MAT-USD")],
      prices,
      rates,
    });
    // 10kg * 10 USD/kg * 140 KES/USD = 14000.
    expect(result.rawMaterialCost.toString()).toBe("14000");
  });

  it("FX8: costing in the material's own price currency (KES priced in KES) needs no imported rate — no 1:1 fallback fabricated for a genuinely different pair", async () => {
    await commitPrice({ material_code: "MAT-KES", supplier_code: "SUP-1", unit_price: "50", currency: "KES", valid_from: "2026-01-01" });
    const prices = committed<MaterialPrice>("material_prices");
    const result = costFormula({
      lines: [line("MAT-KES", "100")],
      batchKg: "10",
      currency: "KES",
      asOf: "2026-06-01",
      materials: [material("MAT-KES")],
      prices,
      rates: [],
    });
    expect(result.incomplete).toBe(false);
    expect(result.rawMaterialCost.toString()).toBe("500");
    expect(result.exchangeRateCodes).toEqual([]);
  });
});
