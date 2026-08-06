/**
 * Product taxonomy: families, packaging SKUs, and the domains FormuLab covers.
 *
 * Packaging size does not fork the chemistry. A 250 ml bottle and an 8 ml sachet
 * of the same shampoo share one ProductFamily — and normally one approved
 * formula version — while remaining separate PackagingSkus with separate
 * packaging costs. Modelling them as one entity would force a needless formula
 * revision every time a pack size changed.
 *
 * Identity is the stable `code`. Display names change; codes must not, because
 * saved formulas, ERP exports and audit records reference them.
 */
import { z } from "zod";

/** The formulation domains this platform supports, and only these. */
export const PRODUCT_DOMAINS = [
  "laundry_powder",
  "laundry_liquid",
  "fabric_softener",
  "bleach",
  "oxygen_whitener",
  "anti_limescale",
  "dishwashing",
  "surface_cleaner",
  "industrial_cleaner",
  "disinfectant",
  "hand_hygiene",
  "oral_care",
  "hair_care",
  "body_cleansing",
  "skin_care",
  "automotive_cleaning",
  "wet_wipes",
] as const;
export type ProductDomain = (typeof PRODUCT_DOMAINS)[number];

export const PACKAGING_TYPES = [
  "sachet",
  "pouch",
  "bag",
  "bottle",
  "tube",
  "drum",
  "trigger_spray",
  "wet_wipe_pack",
] as const;
export type PackagingType = (typeof PACKAGING_TYPES)[number];

/** `pieces` is a count (wipes), not a mass or volume — costing treats it apart. */
export const PACKAGING_UNITS = ["g", "kg", "ml", "L", "pieces"] as const;
export type PackagingUnit = (typeof PACKAGING_UNITS)[number];

export const packagingSkuSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  /** Stable external identifier. Never derived from the display name. */
  skuCode: z.string().min(1),
  productFamilyCode: z.string().min(1),
  displayName: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.enum(PACKAGING_UNITS),
  packagingType: z.enum(PACKAGING_TYPES),
  /** Populated from the packaging cost model; absent until costed. */
  packagingCostId: z.string().optional(),
});
export type PackagingSku = z.infer<typeof packagingSkuSchema>;

export const productFamilySchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  domain: z.enum(PRODUCT_DOMAINS),
  subtype: z.string(),
  intendedUsers: z.array(z.string()).default([]),
  intendedUse: z.string(),
  targetMarkets: z.array(z.string()).default(["KE"]),
  /** Which regulatory profile applies by default; rules themselves are versioned. */
  defaultRegulatoryProfile: z.string().default("KE-EAC"),
  /** Structural template (expected functional roles), not a commercial recipe. */
  formulationTemplateCode: z.string().optional(),
  /**
   * Products whose purpose is inherently hazardous or claim-regulated (bleach,
   * disinfectants, medical wipes). Drives the safety engine's classification
   * and forces human review before any approval.
   */
  hazardClass: z
    .enum(["ordinary", "industrial", "regulated_disinfectant", "medical"])
    .default("ordinary"),
});
export type ProductFamily = z.infer<typeof productFamilySchema>;

export const productCatalogSchema = z.object({
  schemaVersion: z.literal("1.0"),
  families: z.array(productFamilySchema),
  skus: z.array(packagingSkuSchema),
});
export type ProductCatalog = z.infer<typeof productCatalogSchema>;
