/**
 * The Kenya factory product catalog.
 *
 * Codes are stable and generated from the family/SKU definition, never from a
 * display name — renaming "Shampoo – Regular" must not orphan its formulas,
 * ERP rows or audit records.
 *
 * Note the pattern throughout: one family, several packaging SKUs. Shampoo
 * Regular is a single formulation family filling both a 250 ml bottle and an
 * 8 ml sachet. Packaging drives cost and label, not chemistry.
 */
import type {
  PackagingSku,
  PackagingType,
  PackagingUnit,
  ProductCatalog,
  ProductDomain,
  ProductFamily,
} from "../schemas/product";

interface SkuSpec {
  quantity: number;
  unit: PackagingUnit;
  packagingType: PackagingType;
  /** Only when the display name cannot be derived (e.g. "75 g Tube"). */
  label?: string;
}

interface FamilySpec {
  code: string;
  name: string;
  domain: ProductDomain;
  subtype: string;
  intendedUse: string;
  intendedUsers?: string[];
  hazardClass?: ProductFamily["hazardClass"];
  templateCode?: string;
  skus: SkuSpec[];
}

const UNIT_LABEL: Record<PackagingUnit, string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  L: "L",
  pieces: "pieces",
};

const TYPE_LABEL: Record<PackagingType, string> = {
  sachet: "Sachet",
  pouch: "Pouch",
  bag: "Bag",
  bottle: "Bottle",
  tube: "Tube",
  drum: "Drum",
  trigger_spray: "Trigger Spray",
  wet_wipe_pack: "Pack",
};

/** e.g. 250 ml bottle → "250ML-BOTTLE"; deterministic, uppercase, no spaces. */
function skuSuffix(s: SkuSpec): string {
  const qty = String(s.quantity).replace(".", "-");
  return `${qty}${UNIT_LABEL[s.unit]}-${s.packagingType}`
    .toUpperCase()
    .replace(/_/g, "-");
}

function skuDisplayName(family: string, s: SkuSpec): string {
  if (s.label) return `${family}, ${s.label}`;
  return `${family}, ${s.quantity} ${UNIT_LABEL[s.unit]} ${TYPE_LABEL[s.packagingType]}`;
}

const FAMILIES: FamilySpec[] = [
  // ---------------------------------------------------------- laundry powders
  {
    code: "LP-HANDWASH",
    name: "Hand-Wash Powder",
    domain: "laundry_powder",
    subtype: "hand_wash",
    intendedUse: "Manual laundry washing",
    templateCode: "TPL-LAUNDRY-POWDER",
    skus: [
      { quantity: 20, unit: "g", packagingType: "sachet" },
      { quantity: 1, unit: "kg", packagingType: "pouch" },
      { quantity: 10, unit: "kg", packagingType: "bag" },
    ],
  },
  {
    code: "LP-MACHINE-WHITES",
    name: "Machine Powder – Whites",
    domain: "laundry_powder",
    subtype: "machine_whites",
    intendedUse: "Machine laundry washing for white fabrics",
    templateCode: "TPL-LAUNDRY-POWDER",
    skus: [
      { quantity: 40, unit: "g", packagingType: "sachet" },
      { quantity: 1, unit: "kg", packagingType: "pouch" },
      { quantity: 10, unit: "kg", packagingType: "bag" },
    ],
  },
  {
    code: "LP-MACHINE-COLORS",
    name: "Machine Powder – Colors",
    domain: "laundry_powder",
    subtype: "machine_colors",
    intendedUse: "Machine laundry washing for coloured fabrics",
    templateCode: "TPL-LAUNDRY-POWDER",
    skus: [
      { quantity: 40, unit: "g", packagingType: "sachet" },
      { quantity: 1, unit: "kg", packagingType: "pouch" },
      { quantity: 10, unit: "kg", packagingType: "bag" },
    ],
  },
  {
    code: "OW-POWDER",
    name: "Oxygen Whitening Powder",
    domain: "oxygen_whitener",
    subtype: "oxygen_bleach_powder",
    intendedUse: "Oxygen-based whitening additive for laundry",
    hazardClass: "ordinary",
    templateCode: "TPL-LAUNDRY-POWDER",
    skus: [
      { quantity: 20, unit: "g", packagingType: "sachet" },
      { quantity: 1, unit: "kg", packagingType: "pouch" },
      { quantity: 10, unit: "kg", packagingType: "bag" },
    ],
  },
  {
    code: "AL-POWDER",
    name: "Anti-Limescale Powder",
    domain: "anti_limescale",
    subtype: "descaler_powder",
    intendedUse: "Limescale control in washing machines",
    templateCode: "TPL-LAUNDRY-POWDER",
    skus: [
      { quantity: 25, unit: "g", packagingType: "sachet" },
      { quantity: 1, unit: "kg", packagingType: "pouch" },
      { quantity: 10, unit: "kg", packagingType: "bag" },
    ],
  },

  // ------------------------------------------------ laundry liquids, softeners
  {
    code: "LL-COLORS",
    name: "Liquid Detergent – Colors",
    domain: "laundry_liquid",
    subtype: "colors",
    intendedUse: "Liquid laundry detergent for coloured fabrics",
    templateCode: "TPL-LAUNDRY-LIQUID",
    skus: [
      { quantity: 1, unit: "L", packagingType: "bottle" },
      { quantity: 40, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "LL-WHITES",
    name: "Liquid Detergent – Whites",
    domain: "laundry_liquid",
    subtype: "whites",
    intendedUse: "Liquid laundry detergent for white fabrics",
    templateCode: "TPL-LAUNDRY-LIQUID",
    skus: [
      { quantity: 1, unit: "L", packagingType: "bottle" },
      { quantity: 50, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "LL-BABY",
    name: "Liquid Detergent – Baby",
    domain: "laundry_liquid",
    subtype: "baby",
    intendedUse: "Liquid laundry detergent for infant clothing",
    intendedUsers: ["infants"],
    templateCode: "TPL-LAUNDRY-LIQUID",
    skus: [
      { quantity: 1, unit: "L", packagingType: "bottle" },
      { quantity: 40, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "FS-FLORAL",
    name: "Fabric Softener – Floral",
    domain: "fabric_softener",
    subtype: "floral",
    intendedUse: "Fabric softening and fragrance",
    templateCode: "TPL-FABRIC-SOFTENER",
    skus: [{ quantity: 1, unit: "L", packagingType: "bottle" }],
  },
  {
    code: "FS-SENSITIVE",
    name: "Fabric Softener – Sensitive",
    domain: "fabric_softener",
    subtype: "sensitive",
    intendedUse: "Fabric softening for sensitive skin",
    intendedUsers: ["sensitive_skin"],
    templateCode: "TPL-FABRIC-SOFTENER",
    skus: [{ quantity: 1, unit: "L", packagingType: "bottle" }],
  },
  {
    code: "FS-SACHET",
    name: "Fabric Softener",
    domain: "fabric_softener",
    subtype: "sachet_all_variants",
    intendedUse: "Fabric softening, single-dose format",
    templateCode: "TPL-FABRIC-SOFTENER",
    skus: [{ quantity: 30, unit: "ml", packagingType: "sachet" }],
  },
  {
    code: "LSA-ADDITIVE",
    name: "Laundry Sanitizer Additive",
    domain: "disinfectant",
    subtype: "laundry_sanitizer",
    intendedUse: "Laundry sanitising additive",
    hazardClass: "regulated_disinfectant",
    skus: [
      { quantity: 500, unit: "ml", packagingType: "bottle" },
      { quantity: 10, unit: "L", packagingType: "drum" },
    ],
  },
  {
    code: "LSR-STAIN",
    name: "Liquid Stain Remover",
    domain: "laundry_liquid",
    subtype: "stain_remover",
    intendedUse: "Pre-treatment of laundry stains",
    skus: [
      { quantity: 50, unit: "ml", packagingType: "sachet" },
      { quantity: 500, unit: "ml", packagingType: "bottle" },
    ],
  },

  // ------------------------------------------------- bleach, industrial laundry
  {
    code: "BL-REGULAR",
    name: "Bleach – Regular",
    domain: "bleach",
    subtype: "hypochlorite_regular",
    intendedUse: "Household hypochlorite bleach",
    hazardClass: "industrial",
    templateCode: "TPL-BLEACH",
    skus: [{ quantity: 20, unit: "L", packagingType: "drum" }],
  },
  {
    code: "BL-CONCENTRATED",
    name: "Bleach – Concentrated",
    domain: "bleach",
    subtype: "hypochlorite_concentrated",
    intendedUse: "Concentrated household hypochlorite bleach",
    hazardClass: "industrial",
    templateCode: "TPL-BLEACH",
    skus: [{ quantity: 1, unit: "L", packagingType: "bottle" }],
  },
  {
    code: "BL-INDUSTRIAL",
    name: "Industrial Bleach",
    domain: "bleach",
    subtype: "hypochlorite_industrial",
    intendedUse: "Industrial hypochlorite bleach",
    hazardClass: "industrial",
    templateCode: "TPL-BLEACH",
    skus: [{ quantity: 20, unit: "L", packagingType: "drum" }],
  },
  {
    code: "FS-INDUSTRIAL",
    name: "Industrial Fabric Softener",
    domain: "fabric_softener",
    subtype: "industrial",
    intendedUse: "Industrial laundry fabric softening",
    hazardClass: "industrial",
    templateCode: "TPL-FABRIC-SOFTENER",
    skus: [{ quantity: 20, unit: "L", packagingType: "drum" }],
  },

  // ------------------------------------------------------------- dishwashing
  {
    code: "DW-LEMON",
    name: "Dishwashing – Lemon",
    domain: "dishwashing",
    subtype: "lemon",
    intendedUse: "Manual dishwashing liquid",
    templateCode: "TPL-DISHWASH",
    skus: [
      { quantity: 1, unit: "L", packagingType: "bottle" },
      { quantity: 15, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "DW-ORANGE",
    name: "Dishwashing – Orange",
    domain: "dishwashing",
    subtype: "orange",
    intendedUse: "Manual dishwashing liquid",
    templateCode: "TPL-DISHWASH",
    skus: [{ quantity: 1, unit: "L", packagingType: "bottle" }],
  },
  {
    code: "DW-ANTIBAC",
    name: "Dishwashing – Antibacterial",
    domain: "dishwashing",
    subtype: "antibacterial",
    intendedUse: "Manual dishwashing liquid with antibacterial claim",
    hazardClass: "regulated_disinfectant",
    templateCode: "TPL-DISHWASH",
    skus: [{ quantity: 1, unit: "L", packagingType: "bottle" }],
  },
  {
    code: "DW-INDUSTRIAL",
    name: "Industrial Dishwashing",
    domain: "dishwashing",
    subtype: "industrial",
    intendedUse: "Institutional dishwashing",
    hazardClass: "industrial",
    templateCode: "TPL-DISHWASH",
    skus: [{ quantity: 20, unit: "L", packagingType: "drum" }],
  },

  // --------------------------------------- household + institutional cleaners
  {
    code: "SC-MULTIPURPOSE",
    name: "Multi-Purpose Cleaner",
    domain: "surface_cleaner",
    subtype: "multi_purpose",
    intendedUse: "General household surface cleaning",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [
      { quantity: 30, unit: "ml", packagingType: "sachet" },
      { quantity: 1, unit: "L", packagingType: "bottle" },
    ],
  },
  {
    code: "SC-BLACKSOAP",
    name: "Liquid Black Soap",
    domain: "surface_cleaner",
    subtype: "black_soap",
    intendedUse: "General cleaning, soap-based",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [{ quantity: 1, unit: "L", packagingType: "bottle" }],
  },
  {
    code: "IC-DEGREASER",
    name: "Degreaser",
    domain: "industrial_cleaner",
    subtype: "degreaser",
    intendedUse: "Grease removal from hard surfaces",
    hazardClass: "industrial",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [{ quantity: 1, unit: "L", packagingType: "bottle" }],
  },
  {
    code: "AL-REMOVER",
    name: "Limescale Remover",
    domain: "anti_limescale",
    subtype: "acid_descaler",
    intendedUse: "Limescale removal from hard surfaces",
    hazardClass: "industrial",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [{ quantity: 1, unit: "L", packagingType: "bottle" }],
  },
  {
    code: "SC-GLASS",
    name: "Glass Cleaner",
    domain: "surface_cleaner",
    subtype: "glass",
    intendedUse: "Glass and mirror cleaning",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [
      { quantity: 20, unit: "ml", packagingType: "sachet" },
      { quantity: 500, unit: "ml", packagingType: "bottle" },
    ],
  },
  {
    code: "SC-FLOOR",
    name: "Floor Cleaner",
    domain: "surface_cleaner",
    subtype: "floor",
    intendedUse: "Floor cleaning",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [
      { quantity: 1, unit: "L", packagingType: "bottle" },
      { quantity: 30, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "SC-TOILETGEL",
    name: "Toilet Bowl Cleaner Gel",
    domain: "surface_cleaner",
    subtype: "toilet_gel",
    intendedUse: "Toilet bowl cleaning",
    hazardClass: "industrial",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [
      { quantity: 750, unit: "ml", packagingType: "bottle" },
      { quantity: 50, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "SC-CREAM",
    name: "Cream Cleaner",
    domain: "surface_cleaner",
    subtype: "cream_abrasive",
    intendedUse: "Abrasive surface cleaning",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [{ quantity: 500, unit: "g", packagingType: "bottle" }],
  },
  {
    code: "DI-TRIGGER",
    name: "Disinfectant Trigger Spray",
    domain: "disinfectant",
    subtype: "surface_disinfectant",
    intendedUse: "Surface disinfection",
    hazardClass: "regulated_disinfectant",
    skus: [{ quantity: 500, unit: "ml", packagingType: "trigger_spray" }],
  },
  {
    code: "SC-TILEBATH",
    name: "Tile & Bathroom Cleaner",
    domain: "surface_cleaner",
    subtype: "bathroom",
    intendedUse: "Bathroom and tile cleaning",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [
      { quantity: 50, unit: "ml", packagingType: "sachet" },
      { quantity: 500, unit: "ml", packagingType: "bottle" },
    ],
  },
  {
    code: "SC-AIRFRESH",
    name: "Air Freshener (Water-Based)",
    domain: "surface_cleaner",
    subtype: "air_freshener",
    intendedUse: "Room air freshening",
    skus: [{ quantity: 300, unit: "ml", packagingType: "trigger_spray" }],
  },
  {
    code: "DI-INDUSTRIAL",
    name: "Industrial Disinfectant",
    domain: "disinfectant",
    subtype: "industrial",
    intendedUse: "Industrial surface disinfection",
    hazardClass: "regulated_disinfectant",
    skus: [{ quantity: 20, unit: "L", packagingType: "drum" }],
  },

  // ------------------------------------------------------ automotive cleaning
  {
    code: "AC-CARSHAMPOO",
    name: "Car Shampoo (pH Neutral)",
    domain: "automotive_cleaning",
    subtype: "car_shampoo",
    intendedUse: "Vehicle exterior washing",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [
      { quantity: 30, unit: "ml", packagingType: "sachet" },
      { quantity: 500, unit: "ml", packagingType: "bottle" },
    ],
  },
  {
    code: "AC-INTERIOR",
    name: "Interior Cleaner (Water-Based)",
    domain: "automotive_cleaning",
    subtype: "interior",
    intendedUse: "Vehicle interior cleaning",
    templateCode: "TPL-SURFACE-CLEANER",
    skus: [{ quantity: 500, unit: "ml", packagingType: "bottle" }],
  },

  // ------------------------------------------- hand hygiene and sanitization
  {
    code: "HH-HANDSOAP",
    name: "Liquid Hand Soap",
    domain: "hand_hygiene",
    subtype: "hand_soap",
    intendedUse: "Hand washing",
    templateCode: "TPL-BODY-CLEANSING",
    skus: [
      { quantity: 500, unit: "ml", packagingType: "bottle" },
      { quantity: 5, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "HH-SANITIZER",
    name: "Hand Sanitizer",
    domain: "hand_hygiene",
    subtype: "alcohol_sanitizer",
    intendedUse: "Hand sanitisation",
    hazardClass: "regulated_disinfectant",
    skus: [{ quantity: 500, unit: "ml", packagingType: "bottle" }],
  },
  {
    code: "DI-QAC-SURFACE",
    name: "QAC-Based Surface Sanitizer",
    domain: "disinfectant",
    subtype: "qac_sanitizer",
    intendedUse: "Surface sanitisation",
    hazardClass: "regulated_disinfectant",
    skus: [
      { quantity: 500, unit: "ml", packagingType: "bottle" },
      { quantity: 20, unit: "L", packagingType: "drum" },
    ],
  },
  {
    code: "HH-ALCOHOLFREE",
    name: "Alcohol-Free Hand Rub",
    domain: "hand_hygiene",
    subtype: "alcohol_free_rub",
    intendedUse: "Alcohol-free hand sanitisation",
    hazardClass: "regulated_disinfectant",
    skus: [
      { quantity: 250, unit: "ml", packagingType: "bottle" },
      { quantity: 10, unit: "L", packagingType: "drum" },
    ],
  },

  // ---------------------------------------------------------------- oral care
  {
    code: "OC-WHITENING",
    name: "Whitening Toothpaste",
    domain: "oral_care",
    subtype: "whitening",
    intendedUse: "Daily oral care with whitening claim",
    templateCode: "TPL-TOOTHPASTE",
    // The source list said "75 gr"; normalised to grams, display preserved.
    skus: [{ quantity: 75, unit: "g", packagingType: "tube", label: "75 g Tube" }],
  },
  {
    code: "OC-TOOTHPASTE",
    name: "Toothpaste",
    domain: "oral_care",
    subtype: "regular",
    intendedUse: "Daily oral care",
    templateCode: "TPL-TOOTHPASTE",
    skus: [{ quantity: 6, unit: "g", packagingType: "sachet" }],
  },

  // ------------------------------------------------- hair and body cleansing
  {
    code: "HC-SHAMPOO-REG",
    name: "Shampoo – Regular",
    domain: "hair_care",
    subtype: "regular",
    intendedUse: "Hair cleansing",
    templateCode: "TPL-SHAMPOO",
    skus: [
      { quantity: 250, unit: "ml", packagingType: "bottle" },
      { quantity: 8, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "HC-SHAMPOO-BABY",
    name: "Shampoo – Baby",
    domain: "hair_care",
    subtype: "baby",
    intendedUse: "Hair cleansing for infants",
    intendedUsers: ["infants"],
    templateCode: "TPL-SHAMPOO",
    skus: [
      { quantity: 250, unit: "ml", packagingType: "bottle" },
      { quantity: 8, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "BC-SHOWERGEL",
    name: "Shower Gel",
    domain: "body_cleansing",
    subtype: "shower_gel",
    intendedUse: "Body cleansing",
    templateCode: "TPL-BODY-CLEANSING",
    skus: [
      { quantity: 250, unit: "ml", packagingType: "bottle" },
      { quantity: 8, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "BC-SHOWERGEL-INST",
    name: "Shower Gel – Institutional",
    domain: "body_cleansing",
    subtype: "institutional",
    intendedUse: "Body cleansing, institutional supply",
    templateCode: "TPL-BODY-CLEANSING",
    skus: [{ quantity: 20, unit: "L", packagingType: "drum" }],
  },
  {
    code: "HC-CONDITIONER",
    name: "Hair Conditioner",
    domain: "hair_care",
    subtype: "conditioner",
    intendedUse: "Hair conditioning",
    templateCode: "TPL-CONDITIONER",
    skus: [
      { quantity: 250, unit: "ml", packagingType: "bottle" },
      { quantity: 10, unit: "ml", packagingType: "sachet" },
    ],
  },
  {
    code: "HC-CONDITIONER-INST",
    name: "Hair Conditioner – Institutional",
    domain: "hair_care",
    subtype: "institutional",
    intendedUse: "Hair conditioning, institutional supply",
    templateCode: "TPL-CONDITIONER",
    skus: [{ quantity: 20, unit: "L", packagingType: "drum" }],
  },

  // ------------------------------------------------------- facial, body care
  {
    code: "SK-FACIALGEL",
    name: "Facial Cleansing Gel",
    domain: "skin_care",
    subtype: "facial_cleanser",
    intendedUse: "Facial cleansing",
    templateCode: "TPL-BODY-CLEANSING",
    skus: [
      { quantity: 10, unit: "ml", packagingType: "sachet" },
      { quantity: 150, unit: "ml", packagingType: "bottle" },
    ],
  },
  {
    code: "SK-MOISTURIZER",
    name: "Moisturizing Cream",
    domain: "skin_care",
    subtype: "moisturizer",
    intendedUse: "Skin moisturising",
    templateCode: "TPL-EMULSION",
    skus: [
      { quantity: 10, unit: "ml", packagingType: "sachet" },
      { quantity: 150, unit: "ml", packagingType: "bottle" },
    ],
  },
  {
    code: "SK-SHAVING",
    name: "Shaving Cream",
    domain: "skin_care",
    subtype: "shaving",
    intendedUse: "Shaving preparation",
    templateCode: "TPL-EMULSION",
    skus: [{ quantity: 100, unit: "ml", packagingType: "bottle" }],
  },
  {
    code: "SK-BODYLOTION",
    name: "Body Lotion",
    domain: "skin_care",
    subtype: "body_lotion",
    intendedUse: "Body moisturising",
    templateCode: "TPL-EMULSION",
    skus: [
      { quantity: 20, unit: "ml", packagingType: "sachet" },
      { quantity: 250, unit: "ml", packagingType: "bottle" },
    ],
  },

  // ---------------------------------------------------------------- wet wipes
  {
    code: "WW-SURFACE-ANTIBAC",
    name: "Antibacterial Surface Wet Wipes",
    domain: "wet_wipes",
    subtype: "surface_antibacterial",
    intendedUse: "Surface cleaning and sanitising wipes",
    hazardClass: "regulated_disinfectant",
    templateCode: "TPL-WET-WIPE",
    skus: [
      { quantity: 64, unit: "pieces", packagingType: "wet_wipe_pack" },
      { quantity: 100, unit: "pieces", packagingType: "wet_wipe_pack" },
    ],
  },
  {
    code: "WW-MEDICAL-CHX",
    name: "Medical Wipes (Chlorhexidine)",
    domain: "wet_wipes",
    subtype: "medical_chlorhexidine",
    intendedUse: "Medical skin antisepsis wipes",
    hazardClass: "medical",
    templateCode: "TPL-WET-WIPE",
    skus: [
      { quantity: 50, unit: "pieces", packagingType: "wet_wipe_pack" },
      { quantity: 100, unit: "pieces", packagingType: "wet_wipe_pack" },
    ],
  },
  {
    code: "WW-FLUSHABLE",
    name: "Flushable Toilet Wipes",
    domain: "wet_wipes",
    subtype: "flushable",
    intendedUse: "Personal hygiene wipes, flushable claim",
    templateCode: "TPL-WET-WIPE",
    skus: [
      { quantity: 50, unit: "pieces", packagingType: "wet_wipe_pack" },
      { quantity: 80, unit: "pieces", packagingType: "wet_wipe_pack" },
    ],
  },
  {
    code: "WW-BABY",
    name: "Baby Wipes",
    domain: "wet_wipes",
    subtype: "baby",
    intendedUse: "Infant skin cleansing wipes",
    intendedUsers: ["infants"],
    templateCode: "TPL-WET-WIPE",
    skus: [
      { quantity: 48, unit: "pieces", packagingType: "wet_wipe_pack" },
      { quantity: 72, unit: "pieces", packagingType: "wet_wipe_pack" },
    ],
  },
];

/**
 * Build the catalog. Pure and deterministic — the same input always yields the
 * same ids, so re-seeding is idempotent and never duplicates records.
 */
export function buildKenyaCatalog(): ProductCatalog {
  const families: ProductFamily[] = [];
  const skus: PackagingSku[] = [];

  for (const spec of FAMILIES) {
    families.push({
      schemaVersion: "1.0",
      id: `family:${spec.code}`,
      code: spec.code,
      name: spec.name,
      domain: spec.domain,
      subtype: spec.subtype,
      intendedUsers: spec.intendedUsers ?? [],
      intendedUse: spec.intendedUse,
      targetMarkets: ["KE", "EAC"],
      defaultRegulatoryProfile: "KE-EAC",
      formulationTemplateCode: spec.templateCode,
      hazardClass: spec.hazardClass ?? "ordinary",
    });

    for (const s of spec.skus) {
      const skuCode = `${spec.code}-${skuSuffix(s)}`;
      skus.push({
        schemaVersion: "1.0",
        id: `sku:${skuCode}`,
        skuCode,
        productFamilyCode: spec.code,
        displayName: skuDisplayName(spec.name, s),
        quantity: s.quantity,
        unit: s.unit,
        packagingType: s.packagingType,
      });
    }
  }

  return { schemaVersion: "1.0", families, skus };
}

export const KENYA_CATALOG_FAMILY_COUNT = FAMILIES.length;
export const KENYA_CATALOG_SKU_COUNT = FAMILIES.reduce(
  (n, f) => n + f.skus.length,
  0,
);
