/**
 * Costing: currencies, exchange rates, packaging, factory profiles, snapshots.
 *
 * Three rules this module exists to hold.
 *
 * 1. Raw-material cost is not manufacturing cost. Merging them produces a
 *    single ambiguous number that nobody can act on: a purchasing decision and
 *    a pricing decision need different layers of it.
 *
 * 2. Nothing fetches an exchange rate on its own. Rates are records a person
 *    entered or imported, each carrying its date and source, and every cost
 *    shows which rate it used. A cost that silently re-based overnight is worse
 *    than no cost at all.
 *
 * 3. A snapshot is immutable. Updating a supplier price must never rewrite what
 *    a formula cost last quarter — that history is what a margin review reads.
 */
import { z } from "zod";
import { decimalString } from "./formulation";

/** Currencies the platform ships with. Adding one is a data change. */
export const CURRENCIES = ["KES", "USD", "EUR", "GBP", "TRY"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const currencySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  symbol: z.string().optional(),
  decimalPlaces: z.number().int().min(0).max(6).default(2),
});
export type Currency = z.infer<typeof currencySchema>;

export const DEFAULT_CURRENCIES: Currency[] = [
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", decimalPlaces: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 },
  { code: "GBP", name: "Pound Sterling", symbol: "£", decimalPlaces: 2 },
  { code: "TRY", name: "Turkish Lira", symbol: "₺", decimalPlaces: 2 },
];

/**
 * One rate, at one date, from one stated source.
 *
 * `source` is required: "where did this rate come from?" is the first question
 * asked of any cost that looks wrong, and an unanswerable rate is a dead end.
 */
export const exchangeRateSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  baseCurrency: z.string().min(1),
  quoteCurrency: z.string().min(1),
  /** Units of quote currency per one unit of base. */
  rate: decimalString,
  effectiveFrom: z.string(),
  /** Where it came from: a bank, a portal, a finance email. Never "the app". */
  source: z.string().min(1),
  entryMethod: z.enum(["manual", "imported"]).default("manual"),
  verification: z.enum(["verified", "not_verified"]).default("not_verified"),
  notes: z.string().optional(),
  recordedAt: z.string(),
});
export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

export const PACKAGING_COMPONENT_TYPES = [
  "bottle",
  "cap",
  "pump",
  "trigger",
  "tube",
  "sachet_film",
  "pouch",
  "bag",
  "drum",
  "label",
  "carton",
  "shrink_wrap",
  "wipe_substrate",
  "wipe_pack",
  "lid",
  "seal",
  "corrugated_case",
  "other",
] as const;
export type PackagingComponentType = (typeof PACKAGING_COMPONENT_TYPES)[number];

export const packagingComponentSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  description: z.string().min(1),
  componentType: z.enum(PACKAGING_COMPONENT_TYPES),
  supplierCode: z.string().optional(),
  /** Unit the price is per, usually "piece" but "m" for film. */
  unit: z.string().default("piece"),
  unitPrice: decimalString.optional(),
  currency: z.string().default("KES"),
  moq: decimalString.optional(),
  effectiveFrom: z.string().optional(),
  /** Component weight in grams, for transport and sustainability figures. */
  weightG: decimalString.optional(),
  materialType: z.string().optional(),
  /** Expected scrap on the line, as a percentage. Real and rarely zero. */
  wasteFactorPercent: decimalString.default("0"),
  notes: z.string().optional(),
  active: z.boolean().default(true),
  updatedAt: z.string(),
});
export type PackagingComponent = z.infer<typeof packagingComponentSchema>;

/**
 * The bill of materials for one packaging SKU.
 *
 * A 500 ml trigger spray is a bottle, a trigger, a label, plus a share of a
 * carton and shrink wrap. Carton and case components are allocated fractionally
 * — one carton over twelve units is 1/12 of a carton per unit — which is why
 * `quantityPerUnit` is a decimal rather than an integer count.
 */
export const packagingBomLineSchema = z.object({
  componentCode: z.string().min(1),
  quantityPerUnit: decimalString.default("1"),
  notes: z.string().optional(),
});
export type PackagingBomLine = z.infer<typeof packagingBomLineSchema>;

export const packagingBomSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  /** Matches a PackagingSku.code in the Kenya catalog. */
  skuCode: z.string().min(1),
  description: z.string().optional(),
  lines: z.array(packagingBomLineSchema).default([]),
  /** Product actually filled per unit, e.g. 250 for a 250 ml bottle. */
  fillQuantity: decimalString,
  fillUnit: z.enum(["g", "kg", "ml", "L", "pieces"]).default("ml"),
  /** Overfill and line loss, as a percentage of the fill. */
  fillLossPercent: decimalString.default("0"),
  /** Units per case, for the carton-level view. */
  unitsPerCase: z.number().int().positive().optional(),
  notes: z.string().optional(),
  updatedAt: z.string(),
});
export type PackagingBom = z.infer<typeof packagingBomSchema>;

/**
 * A factory's conversion costs.
 *
 * Every figure is editable and dated, and nothing here ships with a number
 * presented as fact. Seeded profiles are labelled as examples precisely because
 * a plausible-looking electricity tariff that nobody checked will silently
 * become the basis of a pricing decision.
 */
export const factoryCostProfileSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().default("KES"),
  electricityPerKwh: decimalString.optional(),
  waterPerM3: decimalString.optional(),
  steamPerKg: decimalString.optional(),
  compressedAirPerBatch: decimalString.optional(),
  directLabourPerHour: decimalString.optional(),
  /** Hours of direct labour a batch of this type consumes. */
  labourHoursPerBatch: decimalString.optional(),
  kwhPerBatch: decimalString.optional(),
  waterM3PerBatch: decimalString.optional(),
  steamKgPerBatch: decimalString.optional(),
  /** QC cost per batch, or as a percentage of batch cost. */
  qcCostPerBatch: decimalString.optional(),
  qcPercentOfBatch: decimalString.optional(),
  /** Process loss as a percentage of the batch. */
  processLossPercent: decimalString.default("0"),
  wasteDisposalPerBatch: decimalString.optional(),
  /** Overhead as a percentage of direct cost, or a flat rate per batch. */
  overheadPercent: decimalString.optional(),
  overheadPerBatch: decimalString.optional(),
  effectiveFrom: z.string(),
  /**
   * Unverified until a person confirms the figures against the factory's own
   * accounts. Seeded examples stay `example_only` forever unless edited.
   */
  verification: z.enum(["verified", "not_verified", "example_only"]).default("not_verified"),
  notes: z.string().optional(),
  active: z.boolean().default(true),
  updatedAt: z.string(),
});
export type FactoryCostProfile = z.infer<typeof factoryCostProfileSchema>;

// ---------------------------------------------------------------- snapshots ---

export const costLineSchema = z.object({
  lineId: z.string(),
  materialCode: z.string().optional(),
  displayName: z.string(),
  percent: decimalString,
  quantityKg: decimalString,
  unitPrice: decimalString.optional(),
  sourceCurrency: z.string().optional(),
  exchangeRateCode: z.string().optional(),
  priceRecordCode: z.string().optional(),
  /** In the snapshot's currency. Absent when no price was available. */
  lineCost: decimalString.optional(),
  landedLineCost: decimalString.optional(),
  /** Why a cost is missing, stated rather than left as a silent zero. */
  missingReason: z.enum(["no_price", "no_exchange_rate", "expired_price"]).optional(),
});
export type CostLine = z.infer<typeof costLineSchema>;

export const skuCostSchema = z.object({
  skuCode: z.string(),
  bomCode: z.string().optional(),
  fillQuantity: decimalString,
  fillUnit: z.string(),
  /** Mass of product per unit, derived from the fill and the density. */
  fillMassKg: decimalString.optional(),
  bulkCostPerUnit: decimalString.optional(),
  packagingCostPerUnit: decimalString.optional(),
  labourCostPerUnit: decimalString.optional(),
  utilitiesCostPerUnit: decimalString.optional(),
  qcCostPerUnit: decimalString.optional(),
  overheadCostPerUnit: decimalString.optional(),
  filledUnitCost: decimalString.optional(),
  packedUnitCost: decimalString.optional(),
  caseCost: decimalString.optional(),
  warnings: z.array(z.string()).default([]),
});
export type SkuCost = z.infer<typeof skuCostSchema>;

/**
 * An immutable costing of one formula version.
 *
 * It records every input it used — which price rows, which exchange rates,
 * which factory profile — so the number can be explained and reproduced later,
 * even after all of those have moved on.
 */
export const costSnapshotSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  formulationId: z.string().min(1),
  versionId: z.string().min(1),
  currency: z.string().default("KES"),
  batchKg: decimalString,
  calculatedAt: z.string(),
  calculatedBy: z.string().default("local"),

  /** Inputs, by code, so the calculation can be re-explained a year later. */
  priceRecordCodes: z.array(z.string()).default([]),
  exchangeRateCodes: z.array(z.string()).default([]),
  packagingComponentCodes: z.array(z.string()).default([]),
  factoryProfileCode: z.string().optional(),

  lines: z.array(costLineSchema).default([]),

  rawMaterialCost: decimalString.optional(),
  landedMaterialCost: decimalString.optional(),
  packagingCost: decimalString.optional(),
  labourCost: decimalString.optional(),
  utilitiesCost: decimalString.optional(),
  qcCost: decimalString.optional(),
  wasteCost: decimalString.optional(),
  overheadCost: decimalString.optional(),
  totalManufacturingCost: decimalString.optional(),

  costPerKg: decimalString.optional(),
  costPerLitre: decimalString.optional(),
  skuCosts: z.array(skuCostSchema).default([]),

  /** Everything the calculation could not establish. Never silently omitted. */
  missingDataWarnings: z.array(z.string()).default([]),
});
export type CostSnapshot = z.infer<typeof costSnapshotSchema>;
