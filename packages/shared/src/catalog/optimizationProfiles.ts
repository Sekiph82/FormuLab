/**
 * Seed optimization profiles for the Kenya product portfolio (spec §4).
 *
 * A profile is a structural starting point for a chemist building an
 * Advanced Optimizer problem — required/allowed/forbidden functional
 * groups, and a small number of clearly characteristic default
 * constraints — never a percentage, never an approved recipe. Every profile
 * here is `not_verified` and `requiresChemistReview: true`, the same
 * honesty convention as the compatibility and safety seed rule sets
 * (`catalog/compatibilityRules.ts`, `catalog/safetyRules.ts`): this list
 * covers the named families and nothing more, and none of it is
 * authoritative chemistry.
 */
import type { OptimizationProfile } from "../schemas/optimization";

const NOW = "2026-07-19T00:00:00.000Z";

function profile(
  code: string,
  productFamilyCode: string,
  displayName: string,
  opts: {
    required?: OptimizationProfile["requiredFunctionGroups"];
    allowed?: OptimizationProfile["allowedFunctionGroups"];
    forbidden?: OptimizationProfile["forbiddenFunctionGroups"];
    note: string;
  },
): OptimizationProfile {
  return {
    schemaVersion: "1.0",
    code,
    productFamilyCode,
    displayName,
    requiredFunctionGroups: opts.required ?? [],
    allowedFunctionGroups: opts.allowed ?? [],
    forbiddenFunctionGroups: opts.forbidden ?? [],
    defaultCompositionConstraints: [],
    defaultFunctionalConstraints: [],
    defaultRatioConstraints: [],
    defaultConditionalConstraints: [],
    defaultPropertyTargets: [],
    applicableCompatibilityRuleIds: [],
    applicableSafetyRuleIds: [],
    suggestedObjectivePresets: [],
    source: opts.note,
    verificationStatus: "not_verified",
    requiresChemistReview: true,
    editable: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** One profile per family named in the spec — 31 families, each a code that
 *  exists in `KENYA_PRODUCT_FAMILIES` (catalog/kenya.ts). Not every one of
 *  the 55 catalog families has a profile yet; this is explicitly the named
 *  starting set, not claimed as complete. */
export const SEED_OPTIMIZATION_PROFILES: OptimizationProfile[] = [
  profile("OPT-LP-HANDWASH", "LP-HANDWASH", "Hand-Wash Laundry Powder", {
    required: ["anionic_surfactant", "builder"],
    allowed: ["nonionic_surfactant", "chelating_agent", "optical_brightener", "fragrance", "abrasive"],
    forbidden: ["oxygen_donor", "bleaching_agent"],
    note: "Structural default only — hand-wash powders are typically anionic-surfactant + builder based; oxidative actives are excluded to avoid a separate bleach-powder classification.",
  }),
  profile("OPT-LP-MACHINE-WHITES", "LP-MACHINE-WHITES", "Machine Laundry Powder (Whites)", {
    required: ["anionic_surfactant", "builder"],
    allowed: ["nonionic_surfactant", "chelating_agent", "optical_brightener", "oxygen_donor", "enzyme", "anti_redeposition_agent"],
    note: "Structural default only — a whites-oriented machine powder commonly carries an oxygen-donor bleach system; enzyme/oxidizer interaction is a compatibility-engine matter, not enforced here.",
  }),
  profile("OPT-OW-POWDER", "OW-POWDER", "Oxygen Whitening Powder", {
    required: ["oxygen_donor"],
    allowed: ["chelating_agent", "builder", "enzyme"],
    forbidden: ["anionic_surfactant"],
    note: "Structural default only — an oxygen-bleach system is peroxide-based; anionic surfactants are excluded here as a conservative default pending chemist review of activator chemistry.",
  }),
  profile("OPT-AL-POWDER", "AL-POWDER", "Anti-Limescale Powder", {
    required: ["chelating_agent"],
    allowed: ["builder", "ph_adjuster"],
    note: "Structural default only — limescale control is a chelation/sequestration problem.",
  }),
  profile("OPT-LL-COLORS", "LL-COLORS", "Liquid Laundry Detergent (Colors)", {
    required: ["anionic_surfactant"],
    allowed: ["nonionic_surfactant", "amphoteric_surfactant", "chelating_agent", "enzyme", "fragrance", "preservative", "ph_adjuster"],
    forbidden: ["bleaching_agent", "oxygen_donor"],
    note: "Structural default only — a colour-safe liquid excludes oxidative bleach actives as a conservative default.",
  }),
  profile("OPT-LL-BABY", "LL-BABY", "Baby Liquid Laundry Detergent", {
    required: ["nonionic_surfactant"],
    allowed: ["amphoteric_surfactant", "anionic_surfactant", "chelating_agent", "enzyme", "preservative"],
    forbidden: ["fragrance", "colorant", "qac_active", "chlorhexidine_active"],
    note: "Structural default only — the baby sub-tier conservatively excludes fragrance/colorant/disinfectant actives pending chemist review; this is not a fragrance-free claim by itself.",
  }),
  profile("OPT-FS-FLORAL", "FS-FLORAL", "Fabric Softener", {
    required: ["conditioning_agent"],
    allowed: ["fragrance", "preservative", "ph_adjuster", "colorant"],
    note: "Structural default only — cationic conditioning-agent base; conditioning agents on this platform are typically cationic, so an anionic surfactant co-ingredient is a compatibility-engine concern, not a hard exclusion here.",
  }),
  profile("OPT-BL-REGULAR", "BL-REGULAR", "Hypochlorite Bleach", {
    required: ["bleaching_agent"],
    allowed: ["ph_adjuster"],
    forbidden: ["anionic_surfactant", "amphoteric_surfactant", "enzyme", "fragrance", "qac_active", "chlorhexidine_active"],
    note: "Structural default only — sodium hypochlorite is incompatible with acids, amines/ammonia, and most organic actives; this profile forbids the function groups the compatibility/safety engines already flag as high-risk with hypochlorite, as a starting filter, not a substitute for those engines.",
  }),
  profile("OPT-DW-LEMON", "DW-LEMON", "Manual Dishwashing Liquid", {
    required: ["anionic_surfactant"],
    allowed: ["amphoteric_surfactant", "nonionic_surfactant", "solvent", "preservative", "fragrance", "ph_adjuster"],
    note: "Structural default only — classic anionic/amphoteric hand-dishwash base.",
  }),
  profile("OPT-SC-MULTIPURPOSE", "SC-MULTIPURPOSE", "Multipurpose Cleaner", {
    required: ["anionic_surfactant"],
    allowed: ["nonionic_surfactant", "solvent", "ph_adjuster", "chelating_agent", "fragrance"],
    note: "Structural default only.",
  }),
  profile("OPT-IC-DEGREASER", "IC-DEGREASER", "Degreaser", {
    required: ["nonionic_surfactant", "solvent"],
    allowed: ["anionic_surfactant", "builder", "ph_adjuster"],
    note: "Structural default only — high-solvency nonionic/solvent base typical of an industrial degreaser.",
  }),
  profile("OPT-AL-REMOVER", "AL-REMOVER", "Acid Limescale Remover", {
    required: ["ph_adjuster"],
    allowed: ["nonionic_surfactant", "fragrance"],
    forbidden: ["bleaching_agent", "anionic_surfactant"],
    note: "Structural default only — an acid descaler must never be co-formulated with a hypochlorite/oxidizer active; this profile forbids `bleaching_agent` as a hard structural default (acid + hypochlorite is one of the platform's blocking compatibility/safety rules), pending chemist confirmation of the acid system used.",
  }),
  profile("OPT-SC-GLASS", "SC-GLASS", "Glass Cleaner", {
    required: ["solvent"],
    allowed: ["nonionic_surfactant", "anionic_surfactant", "fragrance", "colorant"],
    note: "Structural default only.",
  }),
  profile("OPT-SC-FLOOR", "SC-FLOOR", "Floor Cleaner", {
    required: ["anionic_surfactant"],
    allowed: ["nonionic_surfactant", "fragrance", "colorant", "ph_adjuster"],
    note: "Structural default only.",
  }),
  profile("OPT-SC-TOILETGEL", "SC-TOILETGEL", "Toilet Bowl Cleaner Gel", {
    required: ["ph_adjuster", "rheology_modifier"],
    allowed: ["anionic_surfactant", "nonionic_surfactant", "fragrance", "colorant", "disinfectant_active"],
    note: "Structural default only — thickened acid or disinfectant gel base; if the acid sub-type is used, `bleaching_agent`/`qac_active` co-formulation is a compatibility-engine matter to check per candidate, not pre-excluded here.",
  }),
  profile("OPT-HH-HANDSOAP", "HH-HANDSOAP", "Liquid Hand Soap", {
    required: ["anionic_surfactant"],
    allowed: ["amphoteric_surfactant", "nonionic_surfactant", "preservative", "fragrance", "conditioning_agent", "ph_adjuster"],
    note: "Structural default only.",
  }),
  profile("OPT-HC-SHAMPOO-REG", "HC-SHAMPOO-REG", "Regular Shampoo", {
    required: ["anionic_surfactant"],
    allowed: ["amphoteric_surfactant", "nonionic_surfactant", "conditioning_agent", "preservative", "fragrance", "rheology_modifier", "ph_adjuster"],
    note: "Structural default only — classic anionic/amphoteric surfactant base.",
  }),
  profile("OPT-HC-SHAMPOO-BABY", "HC-SHAMPOO-BABY", "Baby Shampoo", {
    required: ["amphoteric_surfactant"],
    allowed: ["nonionic_surfactant", "preservative", "conditioning_agent", "ph_adjuster"],
    forbidden: ["anionic_surfactant", "fragrance", "colorant"],
    note: "Structural default only — mild amphoteric/nonionic base with anionic surfactant, fragrance and colorant conservatively excluded pending chemist review; not a claim of a validated mildness/no-tears result.",
  }),
  profile("OPT-BC-SHOWERGEL", "BC-SHOWERGEL", "Shower Gel", {
    required: ["anionic_surfactant"],
    allowed: ["amphoteric_surfactant", "nonionic_surfactant", "conditioning_agent", "preservative", "fragrance", "rheology_modifier", "ph_adjuster"],
    note: "Structural default only.",
  }),
  profile("OPT-HC-CONDITIONER", "HC-CONDITIONER", "Hair Conditioner", {
    required: ["conditioning_agent"],
    allowed: ["emollient", "preservative", "fragrance", "ph_adjuster", "rheology_modifier"],
    forbidden: ["anionic_surfactant"],
    note: "Structural default only — cationic conditioning-agent base; anionic surfactant is excluded as it deactivates a cationic conditioner, a compatibility-engine finding this profile also pre-filters on.",
  }),
  profile("OPT-OC-TOOTHPASTE", "OC-TOOTHPASTE", "Toothpaste", {
    required: ["abrasive", "fluoride_active"],
    allowed: ["humectant", "rheology_modifier", "anionic_surfactant", "preservative", "fragrance", "chelating_agent"],
    note: "Structural default only — toothpaste is a `medical_or_health_related_product` under the safety engine's classification; this profile does not itself gate that review.",
  }),
  profile("OPT-SK-FACIALGEL", "SK-FACIALGEL", "Facial Cleansing Gel", {
    required: ["amphoteric_surfactant"],
    allowed: ["nonionic_surfactant", "humectant", "preservative", "fragrance", "rheology_modifier", "ph_adjuster"],
    forbidden: ["anionic_surfactant"],
    note: "Structural default only — mild facial cleanser base.",
  }),
  profile("OPT-SK-MOISTURIZER", "SK-MOISTURIZER", "Moisturizing Cream", {
    required: ["emollient", "humectant"],
    allowed: ["nonionic_surfactant", "preservative", "fragrance", "rheology_modifier", "ph_adjuster"],
    note: "Structural default only — emulsion-based emollient/humectant system; emulsifier selection and phase stability are laboratory matters this profile does not model.",
  }),
  profile("OPT-SK-BODYLOTION", "SK-BODYLOTION", "Body Lotion", {
    required: ["emollient", "humectant"],
    allowed: ["nonionic_surfactant", "preservative", "fragrance", "rheology_modifier", "ph_adjuster"],
    note: "Structural default only.",
  }),
  profile("OPT-AC-CARSHAMPOO", "AC-CARSHAMPOO", "pH-Neutral Car Shampoo", {
    required: ["nonionic_surfactant"],
    allowed: ["anionic_surfactant", "amphoteric_surfactant", "conditioning_agent", "fragrance", "ph_adjuster"],
    note: "Structural default only — \"pH-neutral\" is a property target (see `PropertyTarget`), not itself enforced by function-group selection.",
  }),
  profile("OPT-DI-QAC-SURFACE", "DI-QAC-SURFACE", "QAC Surface Sanitizer", {
    required: ["qac_active"],
    allowed: ["nonionic_surfactant", "fragrance", "ph_adjuster"],
    forbidden: ["anionic_surfactant"],
    note: "Structural default only — QAC actives are deactivated by anionic surfactants (a blocking compatibility rule); `regulated_disinfectant` under the safety engine's classification.",
  }),
  profile("OPT-HH-ALCOHOLFREE", "HH-ALCOHOLFREE", "Alcohol-Free Hand Rub", {
    required: ["disinfectant_active"],
    allowed: ["chlorhexidine_active", "qac_active", "humectant", "fragrance", "preservative"],
    note: "Structural default only — `regulated_disinfectant` or `medical_or_health_related_product` under the safety engine's classification depending on the active used.",
  }),
  profile("OPT-LSA-ADDITIVE", "LSA-ADDITIVE", "Laundry Sanitizer Additive", {
    required: ["disinfectant_active"],
    allowed: ["qac_active", "fragrance", "preservative"],
    note: "Structural default only.",
  }),
  profile("OPT-WW-SURFACE-ANTIBAC", "WW-SURFACE-ANTIBAC", "Surface Wet-Wipe Lotion", {
    required: ["disinfectant_active"],
    allowed: ["qac_active", "nonionic_surfactant", "humectant", "preservative", "fragrance"],
    note: "Structural default only — wipe substrate/lotion-loading compatibility (spec's \"QAC adsorption on incompatible wipe substrates\") is a compatibility-engine matter, not modelled by function group alone.",
  }),
  profile("OPT-WW-MEDICAL-CHX", "WW-MEDICAL-CHX", "Chlorhexidine Wipe Lotion", {
    required: ["chlorhexidine_active"],
    allowed: ["humectant", "preservative", "nonionic_surfactant"],
    forbidden: ["anionic_surfactant"],
    note: "Structural default only — chlorhexidine is incompatible with anionic surfactants (a blocking compatibility rule); `medical_or_health_related_product` under the safety engine's classification.",
  }),
  profile("OPT-WW-BABY", "WW-BABY", "Baby-Wipe Lotion", {
    required: ["humectant"],
    allowed: ["nonionic_surfactant", "preservative", "emollient"],
    forbidden: ["fragrance", "colorant", "qac_active", "chlorhexidine_active", "disinfectant_active"],
    note: "Structural default only — non-disinfectant, fragrance/colorant conservatively excluded pending chemist review; not a hypoallergenic or dermatologist-tested claim.",
  }),
];
