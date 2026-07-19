/**
 * The cost engine.
 *
 * Layers are kept separate all the way through — raw material, landed, bulk,
 * packaging, conversion — because collapsing them produces one number that
 * cannot answer any actual question. "Can we hit the shelf price?" and "should
 * we switch supplier?" read different layers of the same calculation.
 *
 * Missing data is never treated as zero. A material with no price makes the
 * total a lower bound, and the snapshot says so in `missingDataWarnings`. A
 * silently-zero line is the failure mode that makes a costing tool dangerous:
 * the total looks complete and is wrong in the cheap direction.
 */
import Decimal from "decimal.js";
import { ONE_HUNDRED, ZERO, dec, fmt, fmtMoney } from "./decimal";
import { resolvedPercent, toDecimalString } from "./formula";
import type { FormulationLine } from "../schemas/formulation";
import type {
  CostLine,
  CostSnapshot,
  ExchangeRate,
  FactoryCostProfile,
  PackagingBom,
  PackagingComponent,
  SkuCost,
} from "../schemas/costing";
import type { MaterialPrice, RawMaterial } from "../schemas/materials";

// ------------------------------------------------------------ exchange rates ---

export interface RateLookup {
  rate: Decimal;
  rateCode: string;
}

/**
 * Find the rate to convert `from` into `to`, as of `asOf`.
 *
 * Picks the most recent record not later than the date asked about — never a
 * future rate, and never today's rate for a March calculation. Returns
 * undefined rather than assuming parity: two currencies at 1:1 because no rate
 * was found is a fabricated number.
 */
export function findRate(
  rates: ExchangeRate[],
  from: string,
  to: string,
  asOf: string,
): RateLookup | undefined {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return { rate: new Decimal(1), rateCode: "identity" };

  const usable = rates
    .filter((r) => r.effectiveFrom <= asOf)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  const direct = usable.find(
    (r) => r.baseCurrency.toUpperCase() === f && r.quoteCurrency.toUpperCase() === t,
  );
  if (direct) return { rate: dec(direct.rate), rateCode: direct.code };

  const inverse = usable.find(
    (r) => r.baseCurrency.toUpperCase() === t && r.quoteCurrency.toUpperCase() === f,
  );
  if (inverse && !dec(inverse.rate).isZero()) {
    return { rate: new Decimal(1).dividedBy(dec(inverse.rate)), rateCode: inverse.code };
  }

  // Deliberately no triangulation through a third currency: an implied rate is
  // not a rate anyone quoted, and it would appear in a snapshot as if it were.
  return undefined;
}

// --------------------------------------------------------------- landed cost ---

export interface LandedCostBreakdown {
  basePrice: Decimal;
  freight: Decimal;
  insurance: Decimal;
  duty: Decimal;
  tax: Decimal;
  portCharges: Decimal;
  inlandTransport: Decimal;
  bankCharges: Decimal;
  otherCost: Decimal;
  lossUplift: Decimal;
  /** Per one unit of `priceUnit`, in the price's own currency. */
  landedUnitCost: Decimal;
  basis: string;
}

/**
 * Landed cost of one unit of a material.
 *
 * The allocation basis decides how a shipment-level charge becomes a per-kg
 * one, and it is recorded on the result: "freight 400,000" means nothing
 * without knowing whether that was per kilo or for the whole container.
 */
export function landedUnitCost(price: MaterialPrice): LandedCostBreakdown {
  const base = dec(price.price);
  const shipment = dec(price.shipmentQuantity ?? "0");
  const basis = price.allocationBasis ?? "per_kg";

  const allocate = (amount: string | undefined): Decimal => {
    const a = dec(amount ?? "0");
    if (a.isZero()) return ZERO;
    switch (basis) {
      case "per_kg":
      case "fixed":
        return a;
      case "per_shipment":
        // Spread across the shipment. Without a shipment size the charge cannot
        // be allocated, so it is dropped rather than applied per unit — which
        // would multiply a container's freight onto every single kilo.
        return shipment.greaterThan(0) ? a.dividedBy(shipment) : ZERO;
      case "percent_of_goods":
        return base.times(a).dividedBy(ONE_HUNDRED);
      default:
        return a;
    }
  };

  const freight = allocate(price.freight);
  const insurance = allocate(price.insurance);
  const duty = allocate(price.duty);
  const tax = allocate(price.tax);
  const portCharges = allocate(price.portCharges);
  const inlandTransport = allocate(price.inlandTransport);
  const bankCharges = allocate(price.bankCharges);
  const otherCost = allocate(price.otherCost);

  const subtotal = base
    .plus(freight)
    .plus(insurance)
    .plus(duty)
    .plus(tax)
    .plus(portCharges)
    .plus(inlandTransport)
    .plus(bankCharges)
    .plus(otherCost);

  // Expected loss raises the cost of what survives: if 2% is lost, the usable
  // material carries the cost of 100% of what was bought.
  const lossPct = dec(price.expectedLossPercent ?? "0");
  const usable = ONE_HUNDRED.minus(lossPct);
  const landed = usable.greaterThan(0) ? subtotal.times(ONE_HUNDRED).dividedBy(usable) : subtotal;

  return {
    basePrice: base,
    freight,
    insurance,
    duty,
    tax,
    portCharges,
    inlandTransport,
    bankCharges,
    otherCost,
    lossUplift: landed.minus(subtotal),
    landedUnitCost: landed,
    basis,
  };
}

// -------------------------------------------------------------- price lookup ---

export interface PriceChoice {
  price: MaterialPrice;
  expired: boolean;
}

/**
 * The price to use for a material on a given date.
 *
 * Prefers a price that was in force on that date. If only an expired price
 * exists it is returned, flagged, so the cost is produced with an explicit
 * caveat rather than silently omitted — a stale figure a user can see beats a
 * blank they cannot explain.
 */
export function priceFor(
  prices: MaterialPrice[],
  materialCode: string,
  asOf: string,
  supplierCode?: string,
): PriceChoice | undefined {
  const candidates = prices
    .filter((p) => p.materialCode === materialCode)
    .filter((p) => !supplierCode || p.supplierCode === supplierCode)
    .filter((p) => p.effectiveFrom <= asOf)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  if (candidates.length === 0) return undefined;
  const live = candidates.find((p) => !p.effectiveTo || p.effectiveTo >= asOf);
  return live ? { price: live, expired: false } : { price: candidates[0], expired: true };
}

// ------------------------------------------------------------ formula costing ---

export interface CostInput {
  lines: FormulationLine[];
  batchKg: string;
  /** The currency every figure in the snapshot is expressed in. */
  currency: string;
  asOf: string;
  materials: RawMaterial[];
  prices: MaterialPrice[];
  rates: ExchangeRate[];
  profile?: FactoryCostProfile;
  packagingComponents?: PackagingComponent[];
  boms?: PackagingBom[];
  /** Bulk density in kg/L, when a per-litre or volume-fill figure is wanted. */
  densityKgPerL?: string;
}

export interface FormulaCost {
  lines: CostLine[];
  rawMaterialCost: Decimal;
  landedMaterialCost: Decimal;
  /** True when at least one line had no usable price. */
  incomplete: boolean;
  warnings: string[];
  priceRecordCodes: string[];
  exchangeRateCodes: string[];
}

/** Cost the formula's raw materials for one batch. */
export function costFormula(input: CostInput): FormulaCost {
  const batch = dec(input.batchKg || "0");
  const materialsByCode = new Map(input.materials.map((m) => [m.code, m]));
  const lines: CostLine[] = [];
  const warnings: string[] = [];
  const priceCodes = new Set<string>();
  const rateCodes = new Set<string>();

  let rawTotal = ZERO;
  let landedTotal = ZERO;
  let incomplete = false;

  for (const line of input.lines) {
    const pct = resolvedPercent(line, input.lines);
    const qtyKg = batch.times(pct).dividedBy(ONE_HUNDRED);

    const base: CostLine = {
      lineId: line.id,
      materialCode: line.materialCode,
      displayName: line.displayName,
      percent: toDecimalString(pct),
      quantityKg: toDecimalString(qtyKg),
    };

    // A line can carry its own price (a snapshot, or a one-off quote typed into
    // the builder) which takes precedence over the library.
    let unitPrice: Decimal | undefined;
    let sourceCurrency: string | undefined;
    let landedUnit: Decimal | undefined;
    let priceCode: string | undefined;
    let expired = false;

    if (line.unitPrice && line.currency) {
      unitPrice = dec(line.unitPrice);
      landedUnit = unitPrice;
      sourceCurrency = line.currency;
    } else if (line.materialCode) {
      const choice = priceFor(input.prices, line.materialCode, input.asOf, line.supplierCode);
      if (choice) {
        unitPrice = dec(choice.price.price);
        landedUnit = landedUnitCost(choice.price).landedUnitCost;
        sourceCurrency = choice.price.currency;
        priceCode = choice.price.code;
        expired = choice.expired;
        priceCodes.add(choice.price.code);
      }
    }

    if (!unitPrice || !sourceCurrency) {
      incomplete = true;
      lines.push({ ...base, missingReason: "no_price" });
      warnings.push(
        `No price for "${line.displayName}" — the total excludes it and is therefore a lower bound.`,
      );
      continue;
    }

    const rate = findRate(input.rates, sourceCurrency, input.currency, input.asOf);
    if (!rate) {
      incomplete = true;
      lines.push({
        ...base,
        unitPrice: toDecimalString(unitPrice, 6),
        sourceCurrency,
        priceRecordCode: priceCode,
        missingReason: "no_exchange_rate",
      });
      warnings.push(
        `No ${sourceCurrency}→${input.currency} exchange rate on or before ${input.asOf}, ` +
          `so "${line.displayName}" could not be costed. Enter a rate to include it.`,
      );
      continue;
    }
    if (rate.rateCode !== "identity") rateCodes.add(rate.rateCode);

    if (expired) {
      warnings.push(
        `The most recent price for "${line.displayName}" expired before ${input.asOf}; it was used anyway and may be stale.`,
      );
    }

    // Prices are quoted per unit of the material; a per-litre price needs the
    // material's density to become a per-kg cost. Without one, the conversion
    // would be a guess, so the line is reported as uncosted instead.
    const material = line.materialCode ? materialsByCode.get(line.materialCode) : undefined;
    const priceUnit = (
      line.priceUnit ??
      (priceCode ? input.prices.find((p) => p.code === priceCode)?.priceUnit : undefined) ??
      "kg"
    ).toLowerCase();

    let qtyInPriceUnit = qtyKg;
    if (priceUnit === "l" || priceUnit === "litre" || priceUnit === "liter") {
      const density = material?.density ? dec(material.density) : undefined;
      if (!density || density.isZero()) {
        incomplete = true;
        lines.push({
          ...base,
          unitPrice: toDecimalString(unitPrice, 6),
          sourceCurrency,
          priceRecordCode: priceCode,
          missingReason: "no_price",
        });
        warnings.push(
          `"${line.displayName}" is priced per litre but has no recorded density, so its ` +
            `mass cannot be converted to volume.`,
        );
        continue;
      }
      qtyInPriceUnit = qtyKg.dividedBy(density);
    }

    const lineCost = qtyInPriceUnit.times(unitPrice).times(rate.rate);
    const landedLineCost = qtyInPriceUnit.times(landedUnit ?? unitPrice).times(rate.rate);
    rawTotal = rawTotal.plus(lineCost);
    landedTotal = landedTotal.plus(landedLineCost);

    lines.push({
      ...base,
      unitPrice: toDecimalString(unitPrice, 6),
      sourceCurrency,
      exchangeRateCode: rate.rateCode === "identity" ? undefined : rate.rateCode,
      priceRecordCode: priceCode,
      lineCost: fmtMoney(lineCost, input.currency),
      landedLineCost: fmtMoney(landedLineCost, input.currency),
    });
  }

  return {
    lines,
    rawMaterialCost: rawTotal,
    landedMaterialCost: landedTotal,
    incomplete,
    warnings,
    priceRecordCodes: [...priceCodes],
    exchangeRateCodes: [...rateCodes],
  };
}

// ------------------------------------------------------------- factory costs ---

export interface ConversionCost {
  labour: Decimal;
  utilities: Decimal;
  qc: Decimal;
  waste: Decimal;
  overhead: Decimal;
  /** Batch mass after process loss — what actually reaches a filler. */
  yieldKg: Decimal;
  warnings: string[];
}

/**
 * Conversion cost for one batch, from a factory profile.
 *
 * Every component is optional: a factory that has not measured its steam cost
 * gets a cost without steam in it, plus a warning saying so — not a plausible
 * invented figure.
 */
export function conversionCost(
  batchKg: string,
  directCost: Decimal,
  profile?: FactoryCostProfile,
): ConversionCost {
  const batch = dec(batchKg || "0");
  const warnings: string[] = [];
  if (!profile) {
    return {
      labour: ZERO,
      utilities: ZERO,
      qc: ZERO,
      waste: ZERO,
      overhead: ZERO,
      yieldKg: batch,
      warnings: [
        "No factory cost profile selected, so the figure is raw-material cost only — not manufacturing cost.",
      ],
    };
  }

  const need = (value: string | undefined, label: string): Decimal => {
    if (value === undefined || value === "") {
      warnings.push(`${label} is not set in the "${profile.name}" profile and was excluded.`);
      return ZERO;
    }
    return dec(value);
  };

  const labour = need(profile.directLabourPerHour, "Direct labour rate").times(
    dec(profile.labourHoursPerBatch ?? "0"),
  );

  const electricity = dec(profile.electricityPerKwh ?? "0").times(dec(profile.kwhPerBatch ?? "0"));
  const water = dec(profile.waterPerM3 ?? "0").times(dec(profile.waterM3PerBatch ?? "0"));
  const steam = dec(profile.steamPerKg ?? "0").times(dec(profile.steamKgPerBatch ?? "0"));
  const air = dec(profile.compressedAirPerBatch ?? "0");
  const utilities = electricity.plus(water).plus(steam).plus(air);

  const qc = profile.qcCostPerBatch
    ? dec(profile.qcCostPerBatch)
    : profile.qcPercentOfBatch
      ? directCost.times(dec(profile.qcPercentOfBatch)).dividedBy(ONE_HUNDRED)
      : ZERO;

  const lossPct = dec(profile.processLossPercent ?? "0");
  const yieldKg = batch.times(ONE_HUNDRED.minus(lossPct)).dividedBy(ONE_HUNDRED);
  // Lost material was still paid for; that cost stays in the batch.
  const waste = directCost
    .times(lossPct)
    .dividedBy(ONE_HUNDRED)
    .plus(dec(profile.wasteDisposalPerBatch ?? "0"));

  const directTotal = directCost.plus(labour).plus(utilities).plus(qc).plus(waste);
  const overhead = profile.overheadPerBatch
    ? dec(profile.overheadPerBatch)
    : profile.overheadPercent
      ? directTotal.times(dec(profile.overheadPercent)).dividedBy(ONE_HUNDRED)
      : ZERO;

  if (profile.verification === "example_only") {
    warnings.push(
      `The "${profile.name}" profile holds example figures, not this factory's costs. Replace them before using this number.`,
    );
  } else if (profile.verification === "not_verified") {
    warnings.push(`The "${profile.name}" profile has not been verified against factory accounts.`);
  }

  return { labour, utilities, qc, waste, overhead, yieldKg, warnings };
}

// ----------------------------------------------------------------- SKU costs ---

/**
 * Cost one packaging SKU.
 *
 * A 250 ml bottle and an 8 ml sachet share a formula and cost completely
 * different amounts. The fill is converted to mass through density, so a
 * volume-filled product is costed on what the tank actually gives up, not on
 * the nominal millilitres.
 */
export function costSku(
  bom: PackagingBom,
  components: PackagingComponent[],
  bulkCostPerKg: Decimal,
  currency: string,
  opts: {
    densityKgPerL?: string;
    rates?: ExchangeRate[];
    asOf?: string;
    conversionPerKg?: Decimal;
  } = {},
): SkuCost {
  const byCode = new Map(components.map((c) => [c.code, c]));
  const warnings: string[] = [];

  // Fill → kg of product.
  const fill = dec(bom.fillQuantity);
  const lossPct = dec(bom.fillLossPercent ?? "0");
  const filled = fill.times(ONE_HUNDRED.plus(lossPct)).dividedBy(ONE_HUNDRED);

  let fillMassKg: Decimal | undefined;
  switch (bom.fillUnit) {
    case "kg":
      fillMassKg = filled;
      break;
    case "g":
      fillMassKg = filled.dividedBy(1000);
      break;
    case "ml":
    case "L": {
      const litres = bom.fillUnit === "ml" ? filled.dividedBy(1000) : filled;
      if (!opts.densityKgPerL) {
        warnings.push(
          `${bom.skuCode} is filled by volume but the product has no recorded density, ` +
            `so the mass of product per unit is unknown and the bulk cost cannot be calculated.`,
        );
      } else {
        fillMassKg = litres.times(dec(opts.densityKgPerL));
      }
      break;
    }
    default:
      warnings.push(`${bom.skuCode} is filled in "${bom.fillUnit}", which cannot be converted to mass.`);
  }

  const bulkCostPerUnit = fillMassKg ? fillMassKg.times(bulkCostPerKg) : undefined;

  let packaging = ZERO;
  for (const bomLine of bom.lines) {
    const component = byCode.get(bomLine.componentCode);
    if (!component) {
      warnings.push(`Packaging component ${bomLine.componentCode} is not in the library.`);
      continue;
    }
    if (!component.unitPrice) {
      warnings.push(`No price for packaging component "${component.description}".`);
      continue;
    }
    let unit = dec(component.unitPrice);
    if (component.currency.toUpperCase() !== currency.toUpperCase()) {
      const rate = opts.rates
        ? findRate(opts.rates, component.currency, currency, opts.asOf ?? new Date().toISOString())
        : undefined;
      if (!rate) {
        warnings.push(
          `No ${component.currency}→${currency} rate for "${component.description}", so it was excluded.`,
        );
        continue;
      }
      unit = unit.times(rate.rate);
    }
    // Scrap on the line means more components are bought than shipped.
    const waste = ONE_HUNDRED.plus(dec(component.wasteFactorPercent ?? "0")).dividedBy(ONE_HUNDRED);
    packaging = packaging.plus(unit.times(dec(bomLine.quantityPerUnit)).times(waste));
  }

  const conversionPerUnit =
    opts.conversionPerKg && fillMassKg ? opts.conversionPerKg.times(fillMassKg) : undefined;

  const filledUnitCost =
    bulkCostPerUnit !== undefined
      ? bulkCostPerUnit.plus(conversionPerUnit ?? ZERO)
      : undefined;
  const packedUnitCost =
    filledUnitCost !== undefined ? filledUnitCost.plus(packaging) : undefined;

  return {
    skuCode: bom.skuCode,
    bomCode: bom.code,
    fillQuantity: bom.fillQuantity,
    fillUnit: bom.fillUnit,
    fillMassKg: fillMassKg ? fmt(fillMassKg, "quantity") : undefined,
    bulkCostPerUnit: bulkCostPerUnit ? fmtMoney(bulkCostPerUnit, currency) : undefined,
    packagingCostPerUnit: fmtMoney(packaging, currency),
    overheadCostPerUnit: conversionPerUnit ? fmtMoney(conversionPerUnit, currency) : undefined,
    filledUnitCost: filledUnitCost ? fmtMoney(filledUnitCost, currency) : undefined,
    packedUnitCost: packedUnitCost ? fmtMoney(packedUnitCost, currency) : undefined,
    caseCost:
      packedUnitCost && bom.unitsPerCase
        ? fmtMoney(packedUnitCost.times(bom.unitsPerCase), currency)
        : undefined,
    warnings,
  };
}

// ----------------------------------------------------------------- snapshot ---

/**
 * Build the immutable cost snapshot for a version.
 *
 * The snapshot names every input it used. That is what lets someone open a
 * six-month-old costing and see that it used the March freight quote and the
 * exchange rate from the day before, rather than wondering why the number no
 * longer reproduces.
 */
export function buildCostSnapshot(
  formulationId: string,
  versionId: string,
  input: CostInput,
  opts: { code: string; calculatedBy?: string } = { code: "" },
): CostSnapshot {
  const formula = costFormula(input);
  const conversion = conversionCost(input.batchKg, formula.landedMaterialCost, input.profile);

  const batch = dec(input.batchKg || "0");
  const total = formula.landedMaterialCost
    .plus(conversion.labour)
    .plus(conversion.utilities)
    .plus(conversion.qc)
    .plus(conversion.waste)
    .plus(conversion.overhead);

  // Divide by the yield, not the batch size: the cost of what is lost is
  // carried by what survives.
  const yieldKg = conversion.yieldKg.greaterThan(0) ? conversion.yieldKg : batch;
  const costPerKg = yieldKg.greaterThan(0) ? total.dividedBy(yieldKg) : ZERO;
  const bulkPerKg = yieldKg.greaterThan(0)
    ? formula.landedMaterialCost.dividedBy(yieldKg)
    : ZERO;
  const conversionPerKg = yieldKg.greaterThan(0)
    ? total.minus(formula.landedMaterialCost).dividedBy(yieldKg)
    : ZERO;

  const skuCosts: SkuCost[] = (input.boms ?? []).map((bom) =>
    costSku(bom, input.packagingComponents ?? [], bulkPerKg, input.currency, {
      densityKgPerL: input.densityKgPerL,
      rates: input.rates,
      asOf: input.asOf,
      conversionPerKg,
    }),
  );

  const warnings = [
    ...formula.warnings,
    ...conversion.warnings,
    ...skuCosts.flatMap((s) => s.warnings),
  ];

  return {
    schemaVersion: "1.0",
    code: opts.code,
    formulationId,
    versionId,
    currency: input.currency,
    batchKg: input.batchKg,
    calculatedAt: new Date().toISOString(),
    calculatedBy: opts.calculatedBy ?? "local",
    priceRecordCodes: formula.priceRecordCodes,
    exchangeRateCodes: formula.exchangeRateCodes,
    packagingComponentCodes: (input.packagingComponents ?? []).map((c) => c.code),
    factoryProfileCode: input.profile?.code,
    lines: formula.lines,
    rawMaterialCost: fmtMoney(formula.rawMaterialCost, input.currency),
    landedMaterialCost: fmtMoney(formula.landedMaterialCost, input.currency),
    packagingCost: skuCosts.length > 0 ? skuCosts[0].packagingCostPerUnit : undefined,
    labourCost: fmtMoney(conversion.labour, input.currency),
    utilitiesCost: fmtMoney(conversion.utilities, input.currency),
    qcCost: fmtMoney(conversion.qc, input.currency),
    wasteCost: fmtMoney(conversion.waste, input.currency),
    overheadCost: fmtMoney(conversion.overhead, input.currency),
    totalManufacturingCost: fmtMoney(total, input.currency),
    costPerKg: fmtMoney(costPerKg, input.currency),
    costPerLitre: input.densityKgPerL
      ? fmtMoney(costPerKg.times(dec(input.densityKgPerL)), input.currency)
      : undefined,
    skuCosts,
    missingDataWarnings: warnings,
  };
}

// --------------------------------------------------------- cost comparison ---

export type CostChangeCause =
  | "formula_change"
  | "price_change"
  | "exchange_rate_change"
  | "packaging_change"
  | "factory_cost_change"
  | "missing_data";

export interface CostDelta {
  label: string;
  before?: string;
  after?: string;
  delta?: string;
}

export interface CostComparison {
  currency: string;
  deltas: CostDelta[];
  /** Which inputs differ between the two snapshots. */
  causes: CostChangeCause[];
  skuDeltas: CostDelta[];
  notes: string[];
}

/**
 * Compare two cost snapshots and attribute the difference.
 *
 * Attribution is by comparing which INPUTS differ — the formula lines, the
 * price record ids, the rate ids, the profile — not by modelling. If both the
 * formula and the prices moved, both causes are reported; the engine does not
 * invent a split between them, because any split would be arbitrary.
 */
export function compareCostSnapshots(
  before: CostSnapshot,
  after: CostSnapshot,
): CostComparison {
  const notes: string[] = [];
  if (before.currency !== after.currency) {
    notes.push(
      `The snapshots are in different currencies (${before.currency} vs ${after.currency}); ` +
        `the differences below are not comparable.`,
    );
  }

  const diff = (label: string, b?: string, a?: string): CostDelta => ({
    label,
    before: b,
    after: a,
    delta: b !== undefined && a !== undefined ? fmtMoney(dec(a).minus(dec(b)), after.currency) : undefined,
  });

  const deltas = [
    diff("Raw material", before.rawMaterialCost, after.rawMaterialCost),
    diff("Landed material", before.landedMaterialCost, after.landedMaterialCost),
    diff("Packaging", before.packagingCost, after.packagingCost),
    diff("Labour", before.labourCost, after.labourCost),
    diff("Utilities", before.utilitiesCost, after.utilitiesCost),
    diff("QC", before.qcCost, after.qcCost),
    diff("Waste", before.wasteCost, after.wasteCost),
    diff("Overhead", before.overheadCost, after.overheadCost),
    diff("Total manufacturing", before.totalManufacturingCost, after.totalManufacturingCost),
    diff("Cost per kg", before.costPerKg, after.costPerKg),
  ];

  const causes: CostChangeCause[] = [];
  const same = (x: string[], y: string[]) =>
    JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());

  const formulaKey = (s: CostSnapshot) =>
    s.lines.map((l) => `${l.displayName}:${l.percent}`).sort().join("|");
  if (formulaKey(before) !== formulaKey(after)) causes.push("formula_change");
  if (!same(before.priceRecordCodes, after.priceRecordCodes)) causes.push("price_change");
  if (!same(before.exchangeRateCodes, after.exchangeRateCodes)) causes.push("exchange_rate_change");
  if (!same(before.packagingComponentCodes, after.packagingComponentCodes)) {
    causes.push("packaging_change");
  }
  if (before.factoryProfileCode !== after.factoryProfileCode) causes.push("factory_cost_change");
  if (before.missingDataWarnings.length > 0 || after.missingDataWarnings.length > 0) {
    causes.push("missing_data");
    notes.push(
      "At least one snapshot has missing cost data, so the difference is partly an artefact of what could not be costed.",
    );
  }

  const beforeSkus = new Map(before.skuCosts.map((s) => [s.skuCode, s]));
  const skuDeltas: CostDelta[] = after.skuCosts.map((s) =>
    diff(s.skuCode, beforeSkus.get(s.skuCode)?.packedUnitCost, s.packedUnitCost),
  );

  return { currency: after.currency, deltas, causes, skuDeltas, notes };
}
