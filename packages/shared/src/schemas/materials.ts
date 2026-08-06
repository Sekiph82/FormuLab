/**
 * Raw material master data, suppliers, price history and inventory.
 *
 * Two ideas shape these schemas.
 *
 * First, identity is the internal code. A trade name is a supplier's marketing
 * asset — the same chemistry ships as "Texapon N70", "Empicol ESB70" and a
 * dozen others, and one trade name can come from several suppliers. So the
 * material is the chemistry, and supply is a separate relationship.
 *
 * Second, "we do not know" is a real answer and gets a real representation.
 * A missing active-matter figure is not zero, an unrecorded CAS number is not
 * "none", and an unverified regulatory position is not "compliant". Every
 * uncertain field can say which kind of not-knowing applies, because the
 * alternative — a blank that reads as a fact — is how a wrong number reaches
 * production.
 */
import { z } from "zod";
import { decimalString, MATERIAL_FUNCTIONS } from "./primitives";

/** Why a value is absent. Never collapse these into an empty string. */
export const DATA_STATES = ["known", "missing", "unknown", "not_applicable", "not_verified"] as const;
export type DataState = (typeof DATA_STATES)[number];

export const PHYSICAL_FORMS = [
  "liquid",
  "powder",
  "granule",
  "paste",
  "flake",
  "pellet",
  "gas",
  "solid",
  "gel",
] as const;
export type PhysicalForm = (typeof PHYSICAL_FORMS)[number];

export const IONIC_CHARACTERS = ["anionic", "cationic", "nonionic", "amphoteric", "not_applicable"] as const;
export type IonicCharacter = (typeof IONIC_CHARACTERS)[number];

/**
 * A regulatory position on a material in one market.
 *
 * `status` defaults to `not_verified` and stays there until a person records a
 * source. FormuLab has no verified Kenyan or EAC ruleset, so an unverified
 * position is the honest default rather than an oversight.
 */
export const regulatoryStatusSchema = z.object({
  market: z.string().min(1),
  status: z
    .enum(["permitted", "restricted", "prohibited", "not_verified", "human_review_required"])
    .default("not_verified"),
  maxPercent: decimalString.optional(),
  /** Where the position came from. Required for anything other than unverified. */
  source: z.string().optional(),
  verifiedBy: z.string().optional(),
  verifiedAt: z.string().optional(),
  notes: z.string().optional(),
});
export type RegulatoryStatusRecord = z.infer<typeof regulatoryStatusSchema>;

export const documentRefSchema = z.object({
  kind: z.enum(["sds", "tds", "coa", "spec", "certificate", "other"]),
  title: z.string().min(1),
  /** Project-relative path or URL. Files stay in the project folder. */
  location: z.string().min(1),
  issuedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  supplierCode: z.string().optional(),
  notes: z.string().optional(),
});
export type DocumentRef = z.infer<typeof documentRefSchema>;

export const rawMaterialSchema = z.object({
  schemaVersion: z.literal("1.0"),
  /** Identity. Stable forever; display names may change freely. */
  code: z.string().min(1),
  displayName: z.string().min(1),
  tradeName: z.string().optional(),
  inciName: z.string().optional(),
  iupacName: z.string().optional(),
  /** A material can be a mixture, so several CAS numbers is normal. */
  casNumbers: z.array(z.string()).default([]),
  ecNumbers: z.array(z.string()).default([]),
  manufacturer: z.string().optional(),
  countryOfOrigin: z.string().optional(),

  physicalForm: z.enum(PHYSICAL_FORMS).optional(),
  appearance: z.string().optional(),
  color: z.string().optional(),
  odor: z.string().optional(),

  /** As-supplied active content. Absent means unknown, never 0. */
  activeMatterPercent: decimalString.optional(),
  activeMatterState: z.enum(DATA_STATES).default("missing"),
  solidsPercent: decimalString.optional(),
  waterPercent: decimalString.optional(),
  /** kg per litre. Needed to cost a volume fill from a mass formula. */
  density: decimalString.optional(),
  phMin: decimalString.optional(),
  phMax: decimalString.optional(),
  viscosityMin: decimalString.optional(),
  viscosityMax: decimalString.optional(),
  hlb: decimalString.optional(),
  ionicCharacter: z.enum(IONIC_CHARACTERS).optional(),
  solubility: z.string().optional(),

  functions: z.array(z.enum(MATERIAL_FUNCTIONS)).default([]),
  recommendedMinPercent: decimalString.optional(),
  recommendedMaxPercent: decimalString.optional(),
  /** Hard ceiling: above this the material does not work, whatever a spec says. */
  technicalMaxPercent: decimalString.optional(),

  storageConditions: z.string().optional(),
  shelfLifeMonths: z.number().int().positive().optional(),
  documents: z.array(documentRefSchema).default([]),
  regulatoryStatuses: z.array(regulatoryStatusSchema).default([]),
  /** GHS or supplier hazard statements, recorded verbatim, never inferred. */
  hazardClassifications: z.array(z.string()).default([]),
  allergens: z.array(z.string()).default([]),
  /** Material codes this must not be combined with, and why. */
  incompatibilities: z
    .array(z.object({ materialCode: z.string(), reason: z.string() }))
    .default([]),
  substituteCodes: z.array(z.string()).default([]),
  notes: z.string().optional(),

  active: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RawMaterial = z.infer<typeof rawMaterialSchema>;

export const supplierSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  legalName: z.string().min(1),
  displayName: z.string().min(1),
  country: z.string().optional(),
  contactPerson: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  /** Currency this supplier normally quotes in. */
  currency: z.string().default("KES"),
  incoterm: z.string().optional(),
  paymentTerms: z.string().optional(),
  defaultLeadTimeDays: z.number().int().nonnegative().optional(),
  moqNotes: z.string().optional(),
  /** Approved-supplier status is a quality decision, so it defaults to false. */
  approved: z.boolean().default(false),
  qualityStatus: z
    .enum(["approved", "conditional", "under_review", "suspended", "not_assessed"])
    .default("not_assessed"),
  notes: z.string().optional(),
  active: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Supplier = z.infer<typeof supplierSchema>;

/** Which suppliers can supply a material, and under what reference. */
export const materialSupplierSchema = z.object({
  code: z.string().min(1),
  materialCode: z.string().min(1),
  supplierCode: z.string().min(1),
  /** The supplier's own name for it, which is often not our display name. */
  supplierTradeName: z.string().optional(),
  supplierMaterialCode: z.string().optional(),
  preferred: z.boolean().default(false),
  qualified: z.boolean().default(false),
  notes: z.string().optional(),
});
export type MaterialSupplier = z.infer<typeof materialSupplierSchema>;

/**
 * One quoted price at one moment.
 *
 * Append-only. A new quotation is a new record; the old one stays, because a
 * cost snapshot taken last March must keep meaning what it meant in March.
 */
export const materialPriceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  materialCode: z.string().min(1),
  supplierCode: z.string().optional(),
  price: decimalString,
  currency: z.string().min(1),
  /** Unit the price is per, e.g. "kg", "L", "piece". */
  priceUnit: z.string().default("kg"),
  moq: decimalString.optional(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),
  quotationRef: z.string().optional(),
  incoterm: z.string().optional(),

  // Landed-cost components, each optional because a local purchase has none.
  freight: decimalString.optional(),
  insurance: decimalString.optional(),
  duty: decimalString.optional(),
  tax: decimalString.optional(),
  portCharges: decimalString.optional(),
  inlandTransport: decimalString.optional(),
  bankCharges: decimalString.optional(),
  otherCost: decimalString.optional(),
  /** How each charge is spread over the goods. */
  allocationBasis: z.enum(["per_kg", "per_shipment", "percent_of_goods", "fixed"]).default("per_kg"),
  /** Shipment size, needed when charges are per-shipment. */
  shipmentQuantity: decimalString.optional(),
  /** Expected loss in handling, as a percentage. */
  expectedLossPercent: decimalString.optional(),

  /** Computed and stored so the snapshot does not depend on today's code. */
  landedUnitCost: decimalString.optional(),
  verification: z.enum(["quoted", "invoiced", "estimated", "not_verified"]).default("not_verified"),
  notes: z.string().optional(),
  recordedAt: z.string(),
  recordedBy: z.string().default("local"),
});
export type MaterialPrice = z.infer<typeof materialPriceSchema>;

export const inventoryRecordSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  materialCode: z.string().min(1),
  warehouse: z.string().default("main"),
  lot: z.string().optional(),
  supplierLot: z.string().optional(),
  quantity: decimalString,
  unit: z.string().default("kg"),
  reservedQuantity: decimalString.default("0"),
  manufacturedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  coaStatus: z.enum(["received", "pending", "not_required", "missing"]).default("pending"),
  /** Quarantined and released are separate facts, not one flag. */
  quarantined: z.boolean().default(false),
  released: z.boolean().default(false),
  unitCost: decimalString.optional(),
  currency: z.string().optional(),
  updatedAt: z.string(),
  notes: z.string().optional(),
});
export type InventoryRecord = z.infer<typeof inventoryRecordSchema>;
