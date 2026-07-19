import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  buildCostSnapshot,
  compareCostSnapshots,
  conversionCost,
  costFormula,
  costSku,
  findRate,
  landedUnitCost,
  priceFor,
} from "./cost";
import type { FormulationLine } from "../schemas/formulation";
import type {
  ExchangeRate,
  FactoryCostProfile,
  PackagingBom,
  PackagingComponent,
} from "../schemas/costing";
import type { MaterialPrice, RawMaterial } from "../schemas/materials";

const NOW = "2026-07-19T00:00:00Z";

function material(over: Partial<RawMaterial> & { code: string }): RawMaterial {
  return {
    schemaVersion: "1.0",
    displayName: over.code,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function price(over: Partial<MaterialPrice> & { code: string; materialCode: string }): MaterialPrice {
  return {
    schemaVersion: "1.0",
    price: "100",
    currency: "KES",
    priceUnit: "kg",
    effectiveFrom: "2026-01-01",
    allocationBasis: "per_kg",
    verification: "quoted",
    recordedAt: NOW,
    recordedBy: "test",
    ...over,
  };
}

function line(over: Partial<FormulationLine> & { displayName: string; percent: string }): FormulationLine {
  return {
    id: over.id ?? `line-${over.displayName}`,
    lineNumber: over.lineNumber ?? 1,
    phase: over.phase ?? "A",
    displayName: over.displayName,
    percent: over.percent,
    isQsToHundred: over.isQsToHundred ?? false,
    functions: over.functions ?? [],
    materialCode: over.materialCode,
    provenance: over.provenance ?? { origin: "chemist_override", evidenceClaimIds: [] },
  };
}

const RATES: ExchangeRate[] = [
  {
    schemaVersion: "1.0",
    code: "fx-usd-kes-jan",
    baseCurrency: "USD",
    quoteCurrency: "KES",
    rate: "130",
    effectiveFrom: "2026-01-01",
    source: "Equity Bank daily sheet",
    entryMethod: "manual",
    verification: "verified",
    recordedAt: NOW,
  },
  {
    schemaVersion: "1.0",
    code: "fx-usd-kes-jul",
    baseCurrency: "USD",
    quoteCurrency: "KES",
    rate: "140",
    effectiveFrom: "2026-07-01",
    source: "Equity Bank daily sheet",
    entryMethod: "manual",
    verification: "verified",
    recordedAt: NOW,
  },
];

describe("exchange rates", () => {
  it("uses the most recent rate not later than the date asked about", () => {
    expect(findRate(RATES, "USD", "KES", "2026-03-01")?.rate.toString()).toBe("130");
    expect(findRate(RATES, "USD", "KES", "2026-08-01")?.rate.toString()).toBe("140");
  });

  it("never uses a future rate for a past calculation", () => {
    expect(findRate(RATES, "USD", "KES", "2025-06-01")).toBeUndefined();
  });

  it("inverts a rate when only the opposite pair exists", () => {
    const r = findRate(RATES, "KES", "USD", "2026-07-19")!;
    expect(r.rate.times(140).toFixed(4)).toBe("1.0000");
  });

  it("returns undefined rather than assuming parity", () => {
    // A missing rate must never silently become 1:1.
    expect(findRate(RATES, "TRY", "KES", NOW)).toBeUndefined();
  });

  it("treats a currency as identical to itself without a record", () => {
    expect(findRate([], "KES", "KES", NOW)?.rate.toString()).toBe("1");
  });
});

describe("landed cost", () => {
  it("adds per-kg charges directly", () => {
    const l = landedUnitCost(
      price({ code: "p1", materialCode: "M1", price: "100", freight: "12", duty: "8", allocationBasis: "per_kg" }),
    );
    expect(l.landedUnitCost.toString()).toBe("120");
  });

  it("spreads a shipment charge over the shipment", () => {
    const l = landedUnitCost(
      price({
        code: "p2",
        materialCode: "M1",
        price: "100",
        freight: "400000",
        allocationBasis: "per_shipment",
        shipmentQuantity: "20000",
      }),
    );
    // 400,000 over 20 tonnes is 20 per kg, not 400,000 per kg.
    expect(l.landedUnitCost.toString()).toBe("120");
  });

  it("drops a shipment charge that has no shipment size, rather than misapplying it", () => {
    const l = landedUnitCost(
      price({ code: "p3", materialCode: "M1", price: "100", freight: "400000", allocationBasis: "per_shipment" }),
    );
    expect(l.landedUnitCost.toString()).toBe("100");
  });

  it("computes a percentage charge on the goods value", () => {
    const l = landedUnitCost(
      price({ code: "p4", materialCode: "M1", price: "200", duty: "10", allocationBasis: "percent_of_goods" }),
    );
    expect(l.landedUnitCost.toString()).toBe("220");
  });

  it("uplifts for expected loss so the surviving material carries the cost", () => {
    const l = landedUnitCost(
      price({ code: "p5", materialCode: "M1", price: "100", expectedLossPercent: "2" }),
    );
    // 100 paid, 98% usable → the usable kilo costs 100/0.98.
    expect(l.landedUnitCost.toFixed(4)).toBe("102.0408");
  });
});

describe("price selection", () => {
  const prices = [
    price({ code: "old", materialCode: "M1", price: "90", effectiveFrom: "2026-01-01", effectiveTo: "2026-03-01" }),
    price({ code: "cur", materialCode: "M1", price: "110", effectiveFrom: "2026-04-01" }),
  ];

  it("picks the price in force on the date", () => {
    expect(priceFor(prices, "M1", "2026-02-01")?.price.code).toBe("old");
    expect(priceFor(prices, "M1", "2026-07-19")?.price.code).toBe("cur");
  });

  it("flags an expired price rather than hiding it", () => {
    const only = [prices[0]];
    const chosen = priceFor(only, "M1", "2026-07-19")!;
    expect(chosen.expired).toBe(true);
  });

  it("returns nothing when no price predates the calculation", () => {
    expect(priceFor(prices, "M1", "2025-01-01")).toBeUndefined();
  });
});

describe("formula cost", () => {
  const materials = [
    material({ code: "M-SLES", displayName: "SLES 70", density: "1.05" }),
    material({ code: "M-WATER", displayName: "Water", density: "1" }),
  ];
  const prices = [
    price({ code: "pr-sles", materialCode: "M-SLES", price: "180", currency: "KES" }),
    price({ code: "pr-water", materialCode: "M-WATER", price: "0.5", currency: "KES" }),
  ];
  const lines = [
    line({ id: "w", displayName: "Water", percent: "0", isQsToHundred: true, materialCode: "M-WATER" }),
    line({ id: "s", displayName: "SLES", percent: "20", materialCode: "M-SLES" }),
  ];

  it("costs each line from its quantity and price", () => {
    const c = costFormula({
      lines,
      batchKg: "1000",
      currency: "KES",
      asOf: NOW,
      materials,
      prices,
      rates: RATES,
    });
    // 200 kg SLES at 180 = 36,000; 800 kg water at 0.5 = 400.
    expect(c.rawMaterialCost.toString()).toBe("36400");
    expect(c.incomplete).toBe(false);
  });

  it("converts a foreign-currency price at the dated rate", () => {
    const usd = [price({ code: "pr-usd", materialCode: "M-SLES", price: "2", currency: "USD" })];
    const c = costFormula({
      lines: [line({ id: "s", displayName: "SLES", percent: "100", materialCode: "M-SLES" })],
      batchKg: "100",
      currency: "KES",
      asOf: "2026-07-19",
      materials,
      prices: usd,
      rates: RATES,
    });
    // 100 kg × 2 USD × 140 KES/USD.
    expect(c.rawMaterialCost.toString()).toBe("28000");
    expect(c.exchangeRateCodes).toContain("fx-usd-kes-jul");
  });

  it("reports a missing price instead of costing the line at zero", () => {
    const c = costFormula({
      lines,
      batchKg: "1000",
      currency: "KES",
      asOf: NOW,
      materials,
      prices: [prices[0]],
      rates: RATES,
    });
    expect(c.incomplete).toBe(true);
    expect(c.lines.find((l) => l.lineId === "w")!.missingReason).toBe("no_price");
    expect(c.warnings.join(" ")).toMatch(/lower bound/);
  });

  it("reports a missing exchange rate as its own distinct problem", () => {
    const tryPrice = [price({ code: "pr-try", materialCode: "M-SLES", price: "50", currency: "TRY" })];
    const c = costFormula({
      lines: [line({ id: "s", displayName: "SLES", percent: "100", materialCode: "M-SLES" })],
      batchKg: "100",
      currency: "KES",
      asOf: NOW,
      materials,
      prices: tryPrice,
      rates: RATES,
    });
    expect(c.lines[0].missingReason).toBe("no_exchange_rate");
    expect(c.warnings.join(" ")).toMatch(/TRY→KES/);
  });

  it("converts a per-litre price using the material's density", () => {
    const perLitre = [
      price({ code: "pr-l", materialCode: "M-SLES", price: "100", currency: "KES", priceUnit: "L" }),
    ];
    const c = costFormula({
      lines: [line({ id: "s", displayName: "SLES", percent: "100", materialCode: "M-SLES" })],
      batchKg: "105",
      currency: "KES",
      asOf: NOW,
      materials,
      prices: perLitre,
      rates: RATES,
    });
    // 105 kg at 1.05 kg/L is 100 L, at 100/L.
    expect(c.rawMaterialCost.toString()).toBe("10000");
  });

  it("refuses to convert a per-litre price with no density on record", () => {
    const noDensity = [material({ code: "M-X", displayName: "Unknown" })];
    const c = costFormula({
      lines: [line({ id: "x", displayName: "X", percent: "100", materialCode: "M-X" })],
      batchKg: "100",
      currency: "KES",
      asOf: NOW,
      materials: noDensity,
      prices: [price({ code: "p", materialCode: "M-X", price: "10", priceUnit: "L" })],
      rates: RATES,
    });
    expect(c.incomplete).toBe(true);
    expect(c.warnings.join(" ")).toMatch(/no recorded density/);
  });
});

describe("conversion cost", () => {
  const profile: FactoryCostProfile = {
    schemaVersion: "1.0",
    code: "fp-1",
    name: "Nairobi line 1",
    currency: "KES",
    electricityPerKwh: "25",
    kwhPerBatch: "40",
    waterPerM3: "150",
    waterM3PerBatch: "2",
    directLabourPerHour: "500",
    labourHoursPerBatch: "6",
    qcCostPerBatch: "2000",
    processLossPercent: "2",
    overheadPercent: "10",
    effectiveFrom: "2026-01-01",
    verification: "verified",
    updatedAt: NOW,
  };

  it("computes labour, utilities, QC, waste and overhead separately", () => {
    const c = conversionCost("1000", new Decimal("100000"), profile);
    expect(c.labour.toString()).toBe("3000");
    // 40 kWh × 25 + 2 m³ × 150 = 1000 + 300.
    expect(c.utilities.toString()).toBe("1300");
    expect(c.qc.toString()).toBe("2000");
    // 2% of the material cost is lost material still paid for.
    expect(c.waste.toString()).toBe("2000");
    expect(c.yieldKg.toString()).toBe("980");
  });

  it("says plainly when there is no factory profile", () => {
    const c = conversionCost("1000", new Decimal("100000"));
    expect(c.overhead.toString()).toBe("0");
    expect(c.warnings.join(" ")).toMatch(/not manufacturing cost/);
  });

  it("warns loudly about example-only figures", () => {
    const example = { ...profile, verification: "example_only" as const };
    expect(conversionCost("1000", new Decimal("1000"), example).warnings.join(" ")).toMatch(
      /example figures/,
    );
  });

  it("excludes an unset cost and says so, instead of inventing one", () => {
    const partial = { ...profile, directLabourPerHour: undefined };
    const c = conversionCost("1000", new Decimal("1000"), partial);
    expect(c.labour.toString()).toBe("0");
    expect(c.warnings.join(" ")).toMatch(/Direct labour rate is not set/);
  });
});

describe("SKU costing", () => {
  const components: PackagingComponent[] = [
    { schemaVersion: "1.0", code: "PK-BOT250", description: "250 ml bottle", componentType: "bottle", unit: "piece", unitPrice: "12", currency: "KES", wasteFactorPercent: "0", active: true, updatedAt: NOW },
    { schemaVersion: "1.0", code: "PK-CAP", description: "Flip cap", componentType: "cap", unit: "piece", unitPrice: "3", currency: "KES", wasteFactorPercent: "2", active: true, updatedAt: NOW },
    { schemaVersion: "1.0", code: "PK-LABEL", description: "Label", componentType: "label", unit: "piece", unitPrice: "1.5", currency: "KES", wasteFactorPercent: "0", active: true, updatedAt: NOW },
    { schemaVersion: "1.0", code: "PK-CASE", description: "Case of 12", componentType: "corrugated_case", unit: "piece", unitPrice: "36", currency: "KES", wasteFactorPercent: "0", active: true, updatedAt: NOW },
    { schemaVersion: "1.0", code: "PK-SACHET", description: "Sachet film", componentType: "sachet_film", unit: "piece", unitPrice: "0.4", currency: "KES", wasteFactorPercent: "5", active: true, updatedAt: NOW },
    { schemaVersion: "1.0", code: "PK-DRUM", description: "200 L drum", componentType: "drum", unit: "piece", unitPrice: "3500", currency: "KES", wasteFactorPercent: "0", active: true, updatedAt: NOW },
    { schemaVersion: "1.0", code: "PK-WIPEPACK", description: "Wipe pack + lid", componentType: "wipe_pack", unit: "piece", unitPrice: "9", currency: "KES", wasteFactorPercent: "1", active: true, updatedAt: NOW },
    { schemaVersion: "1.0", code: "PK-SUBSTRATE", description: "Nonwoven substrate, 80 wipes", componentType: "wipe_substrate", unit: "piece", unitPrice: "22", currency: "KES", wasteFactorPercent: "3", active: true, updatedAt: NOW },
  ];

  const bottle: PackagingBom = {
    schemaVersion: "1.0",
    code: "BOM-250",
    skuCode: "HC-SHAMPOO-REG-250ML-BOTTLE",
    lines: [
      { componentCode: "PK-BOT250", quantityPerUnit: "1" },
      { componentCode: "PK-CAP", quantityPerUnit: "1" },
      { componentCode: "PK-LABEL", quantityPerUnit: "1" },
      // One case over twelve units: a fractional allocation, not a whole case.
      { componentCode: "PK-CASE", quantityPerUnit: "0.0833333333" },
    ],
    fillQuantity: "250",
    fillUnit: "ml",
    fillLossPercent: "1",
    unitsPerCase: 12,
    updatedAt: NOW,
  };

  const bulkPerKg = new Decimal("120");

  it("costs a bottle SKU from fill, density and components", () => {
    const c = costSku(bottle, components, bulkPerKg, "KES", { densityKgPerL: "1.02" });
    // 250 ml + 1% overfill = 252.5 ml → 0.25755 kg.
    expect(c.fillMassKg).toBe("0.2576");
    // 12 + 3×1.02 + 1.5 + 36/12 = 12 + 3.06 + 1.5 + 3.
    expect(c.packagingCostPerUnit).toBe("19.56");
    expect(Number(c.packedUnitCost)).toBeGreaterThan(Number(c.bulkCostPerUnit));
  });

  it("costs a sachet of the same formula completely differently", () => {
    const sachet: PackagingBom = {
      ...bottle,
      code: "BOM-8ML",
      skuCode: "HC-SHAMPOO-REG-8ML-SACHET",
      lines: [{ componentCode: "PK-SACHET", quantityPerUnit: "1" }],
      fillQuantity: "8",
      unitsPerCase: undefined,
    };
    const s = costSku(sachet, components, bulkPerKg, "KES", { densityKgPerL: "1.02" });
    const b = costSku(bottle, components, bulkPerKg, "KES", { densityKgPerL: "1.02" });
    expect(Number(s.packedUnitCost)).toBeLessThan(Number(b.packedUnitCost));
    // 0.4 with 5% film scrap.
    expect(s.packagingCostPerUnit).toBe("0.42");
  });

  it("costs a drum", () => {
    const drum: PackagingBom = {
      ...bottle,
      code: "BOM-DRUM",
      skuCode: "IC-DEGREASER-200L-DRUM",
      lines: [{ componentCode: "PK-DRUM", quantityPerUnit: "1" }],
      fillQuantity: "200",
      fillUnit: "L",
      fillLossPercent: "0",
      unitsPerCase: undefined,
    };
    const c = costSku(drum, components, bulkPerKg, "KES", { densityKgPerL: "1.02" });
    expect(c.fillMassKg).toBe("204.0000");
    expect(c.packagingCostPerUnit).toBe("3500.00");
    expect(c.bulkCostPerUnit).toBe("24480.00");
  });

  it("costs a wet-wipe pack from substrate plus pack", () => {
    const wipes: PackagingBom = {
      ...bottle,
      code: "BOM-WIPES",
      skuCode: "WW-BABY-80-PACK",
      lines: [
        { componentCode: "PK-SUBSTRATE", quantityPerUnit: "1" },
        { componentCode: "PK-WIPEPACK", quantityPerUnit: "1" },
      ],
      fillQuantity: "240",
      fillUnit: "g",
      fillLossPercent: "0",
      unitsPerCase: undefined,
    };
    const c = costSku(wipes, components, bulkPerKg, "KES", {});
    // 22×1.03 + 9×1.01.
    expect(c.packagingCostPerUnit).toBe("31.75");
    expect(c.fillMassKg).toBe("0.2400");
  });

  it("refuses to guess a volume fill without a density", () => {
    const c = costSku(bottle, components, bulkPerKg, "KES", {});
    expect(c.bulkCostPerUnit).toBeUndefined();
    expect(c.warnings.join(" ")).toMatch(/no recorded density/);
  });

  it("reports a packaging component that has no price", () => {
    const noPrice = components.map((c) =>
      c.code === "PK-CAP" ? { ...c, unitPrice: undefined } : c,
    );
    const c = costSku(bottle, noPrice, bulkPerKg, "KES", { densityKgPerL: "1.02" });
    expect(c.warnings.join(" ")).toMatch(/No price for packaging component "Flip cap"/);
  });

  it("applies the case allocation to the carton-level cost", () => {
    const c = costSku(bottle, components, bulkPerKg, "KES", { densityKgPerL: "1.02" });
    expect(Number(c.caseCost)).toBeCloseTo(Number(c.packedUnitCost) * 12, 1);
  });
});

describe("cost snapshots", () => {
  const materials = [material({ code: "M-SLES", displayName: "SLES 70", density: "1.05" })];
  const prices = [price({ code: "pr-sles", materialCode: "M-SLES", price: "180", currency: "KES" })];
  const lines = [line({ id: "s", displayName: "SLES", percent: "100", materialCode: "M-SLES" })];

  const input = {
    lines,
    batchKg: "1000",
    currency: "KES",
    asOf: NOW,
    materials,
    prices,
    rates: RATES,
    densityKgPerL: "1.05",
  };

  it("separates raw material from total manufacturing cost", () => {
    const s = buildCostSnapshot("f1", "v1", input, { code: "cs-1" });
    expect(s.rawMaterialCost).toBe("180000.00");
    // With no factory profile the two are equal, and the snapshot says why.
    expect(s.totalManufacturingCost).toBe("180000.00");
    expect(s.missingDataWarnings.join(" ")).toMatch(/not manufacturing cost/);
  });

  it("records the inputs it used so the number can be re-explained", () => {
    const s = buildCostSnapshot("f1", "v1", input, { code: "cs-2" });
    expect(s.priceRecordCodes).toEqual(["pr-sles"]);
    expect(s.calculatedAt).toBeTruthy();
  });

  it("is not rewritten when the current price changes", () => {
    const s = buildCostSnapshot("f1", "v1", input, { code: "cs-3" });
    const frozen = JSON.stringify(s);

    // A new, higher price is recorded later. History must not move.
    const newer = [
      ...prices,
      price({ code: "pr-sles-2", materialCode: "M-SLES", price: "260", effectiveFrom: "2026-08-01" }),
    ];
    const refreshed = buildCostSnapshot(
      "f1",
      "v1",
      { ...input, prices: newer, asOf: "2026-09-01" },
      { code: "cs-4" },
    );

    expect(JSON.stringify(s)).toBe(frozen);
    expect(refreshed.rawMaterialCost).toBe("260000.00");
    expect(s.rawMaterialCost).toBe("180000.00");
  });

  it("computes cost per litre when a density is known", () => {
    const s = buildCostSnapshot("f1", "v1", input, { code: "cs-5" });
    expect(s.costPerKg).toBe("180.00");
    expect(s.costPerLitre).toBe("189.00");
  });
});

describe("cost comparison", () => {
  const materials = [material({ code: "M-SLES", displayName: "SLES 70", density: "1.05" })];
  const lines = [line({ id: "s", displayName: "SLES", percent: "100", materialCode: "M-SLES" })];
  const base = {
    lines,
    batchKg: "1000",
    currency: "KES",
    asOf: NOW,
    materials,
    rates: RATES,
  };

  it("attributes a change to the price when only the price moved", () => {
    const a = buildCostSnapshot("f1", "v1", { ...base, prices: [price({ code: "p-a", materialCode: "M-SLES", price: "180" })] }, { code: "c1" });
    const b = buildCostSnapshot("f1", "v1", { ...base, prices: [price({ code: "p-b", materialCode: "M-SLES", price: "200" })] }, { code: "c2" });
    const c = compareCostSnapshots(a, b);
    expect(c.causes).toContain("price_change");
    expect(c.causes).not.toContain("formula_change");
    expect(c.deltas.find((d) => d.label === "Raw material")!.delta).toBe("20000.00");
  });

  it("attributes a change to the formula when only the formula moved", () => {
    const prices = [price({ code: "p", materialCode: "M-SLES", price: "180" })];
    const a = buildCostSnapshot("f1", "v1", { ...base, prices }, { code: "c3" });
    const b = buildCostSnapshot(
      "f1",
      "v2",
      { ...base, prices, lines: [line({ id: "s", displayName: "SLES", percent: "50", materialCode: "M-SLES" })] },
      { code: "c4" },
    );
    const c = compareCostSnapshots(a, b);
    expect(c.causes).toContain("formula_change");
    expect(c.causes).not.toContain("price_change");
  });

  it("reports both causes rather than inventing a split", () => {
    const a = buildCostSnapshot("f1", "v1", { ...base, prices: [price({ code: "p-a", materialCode: "M-SLES", price: "180" })] }, { code: "c5" });
    const b = buildCostSnapshot(
      "f1",
      "v2",
      {
        ...base,
        prices: [price({ code: "p-b", materialCode: "M-SLES", price: "200" })],
        lines: [line({ id: "s", displayName: "SLES", percent: "50", materialCode: "M-SLES" })],
      },
      { code: "c6" },
    );
    const c = compareCostSnapshots(a, b);
    expect(c.causes).toEqual(expect.arrayContaining(["price_change", "formula_change"]));
  });

  it("flags a comparison where data is missing on either side", () => {
    const a = buildCostSnapshot("f1", "v1", { ...base, prices: [] }, { code: "c7" });
    const b = buildCostSnapshot("f1", "v1", { ...base, prices: [price({ code: "p", materialCode: "M-SLES", price: "180" })] }, { code: "c8" });
    const c = compareCostSnapshots(a, b);
    expect(c.causes).toContain("missing_data");
    expect(c.notes.join(" ")).toMatch(/partly an artefact/);
  });
});
