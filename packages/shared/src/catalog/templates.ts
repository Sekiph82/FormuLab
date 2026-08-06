/**
 * Structural templates for the Kenya product families.
 *
 * A template says which functional ROLES a product of this type needs, and in
 * what phase order they are normally added. It deliberately carries no
 * percentages: a number in a template would be read as a recommendation, and
 * FormuLab has no verified source for "the right level" of anything. Levels
 * come from the literature pipeline, a supplier's technical data sheet, or a
 * chemist — each carrying its own provenance.
 *
 * So a template answers "have I forgotten the chelant?", not "how much?".
 */
import type { MaterialFunction } from "../schemas/formulation";

export interface PhaseTemplate {
  name: string;
  description: string;
  functions: MaterialFunction[];
}

export interface FormulaTemplate {
  /** Matches a ProductFamily.code in the Kenya catalog. */
  familyCode: string;
  name: string;
  /** Roles without which the product does not work. */
  requiredFunctions: MaterialFunction[];
  /** Roles a formulator would commonly consider. */
  optionalFunctions: MaterialFunction[];
  phases: PhaseTemplate[];
  /** Whether an aqueous product needs preservation — drives validation. */
  requiresPreservative: boolean;
  requiresPhAdjuster: boolean;
  /** Personal-care products declare INCI; household ones do not. */
  requiresInci: boolean;
  /** Specification fields a finished product of this type is released against. */
  specFields: string[];
  /** Risks worth flagging in review, phrased as questions, not verdicts. */
  warningTopics: string[];
  notes?: string;
}

/** Every template is structural. Nothing here is an approved formulation. */
export const TEMPLATE_DISCLAIMER =
  "Structural template: required functional roles only. No percentages are supplied, " +
  "and nothing here is validated or production approved.";

interface Spec {
  familyCodes: string[];
  name: string;
  required: MaterialFunction[];
  optional?: MaterialFunction[];
  phases: [string, string, MaterialFunction[]][];
  preservative?: boolean;
  ph?: boolean;
  inci?: boolean;
  spec: string[];
  warn: string[];
  notes?: string;
}

const POWDER_SPEC = ["bulk density", "moisture", "active matter", "pH (1% solution)", "solubility"];
const LIQUID_SPEC = ["appearance", "pH", "viscosity", "active matter", "density", "cloud point"];
const CARE_SPEC = ["appearance", "pH", "viscosity", "density", "odour", "microbiological limits"];

const SPECS: Spec[] = [
  // ---------------------------------------------------------------- laundry ---
  {
    familyCodes: ["LP-HANDWASH"],
    name: "Hand-wash laundry powder",
    required: ["anionic_surfactant", "builder", "filler"],
    optional: ["nonionic_surfactant", "chelating_agent", "anti_redeposition_agent", "optical_brightener", "fragrance", "colorant", "foam_controller"],
    phases: [
      ["A", "Dry blend base", ["builder", "filler", "anti_redeposition_agent"]],
      ["B", "Surfactant addition", ["anionic_surfactant", "nonionic_surfactant"]],
      ["C", "Minors and post-dose", ["optical_brightener", "fragrance", "colorant", "enzyme"]],
    ],
    spec: POWDER_SPEC,
    warn: [
      "Hand-wash powders contact skin directly — is the free alkalinity acceptable?",
      "Is foam profile appropriate for hand washing rather than a machine?",
    ],
  },
  {
    familyCodes: ["LP-MACHINE-WHITES", "LP-MACHINE-COLORS"],
    name: "Machine laundry powder",
    required: ["anionic_surfactant", "builder", "filler"],
    optional: ["nonionic_surfactant", "chelating_agent", "enzyme", "optical_brightener", "oxygen_donor", "anti_redeposition_agent", "foam_controller", "fragrance"],
    phases: [
      ["A", "Dry blend base", ["builder", "filler", "anti_redeposition_agent"]],
      ["B", "Surfactant addition", ["anionic_surfactant", "nonionic_surfactant"]],
      ["C", "Heat-sensitive post-dose", ["enzyme", "oxygen_donor", "fragrance"]],
    ],
    spec: POWDER_SPEC,
    warn: [
      "Foam control is required for front-loading machines.",
      "Enzymes and oxygen bleach must be post-dosed, not blended hot.",
      "Whites variants using optical brighteners are unsuitable for coloured fabrics.",
    ],
  },
  {
    familyCodes: ["OW-POWDER"],
    name: "Oxygen whitening powder",
    required: ["oxygen_donor", "builder"],
    optional: ["anionic_surfactant", "chelating_agent", "filler", "optical_brightener", "enzyme"],
    phases: [
      ["A", "Dry base", ["builder", "filler", "chelating_agent"]],
      ["B", "Oxygen source", ["oxygen_donor"]],
      ["C", "Minors", ["anionic_surfactant", "optical_brightener"]],
    ],
    spec: [...POWDER_SPEC, "available oxygen"],
    warn: [
      "Percarbonate loses available oxygen with moisture and heavy-metal traces — is a chelant present?",
      "Storage humidity is a stability question, not a formulation one.",
    ],
  },
  {
    familyCodes: ["AL-POWDER"],
    name: "Anti-limescale powder",
    required: ["chelating_agent", "ph_adjuster"],
    optional: ["builder", "filler", "anionic_surfactant", "fragrance"],
    phases: [
      ["A", "Acid/chelant base", ["chelating_agent", "ph_adjuster"]],
      ["B", "Carriers", ["filler", "builder"]],
      ["C", "Minors", ["anionic_surfactant", "fragrance"]],
    ],
    spec: [...POWDER_SPEC, "chelating value"],
    warn: ["Acidic descalers attack aluminium and some machine seals."],
  },
  {
    familyCodes: ["LL-COLORS", "LL-WHITES"],
    name: "Liquid laundry detergent",
    required: ["anionic_surfactant", "nonionic_surfactant", "water", "preservative"],
    optional: ["amphoteric_surfactant", "chelating_agent", "enzyme", "optical_brightener", "solvent", "rheology_modifier", "ph_adjuster", "fragrance", "colorant"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent", "builder"]],
      ["B", "Surfactants", ["anionic_surfactant", "nonionic_surfactant", "amphoteric_surfactant"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "rheology_modifier", "preservative"]],
      ["D", "Post-dose", ["enzyme", "fragrance", "colorant"]],
    ],
    preservative: true,
    ph: true,
    spec: LIQUID_SPEC,
    warn: [
      "Enzyme stability in liquids depends on the preservative and pH chosen.",
      "Phase separation at Kenyan ambient temperatures should be part of stability testing.",
    ],
  },
  {
    familyCodes: ["LL-BABY"],
    name: "Baby liquid laundry detergent",
    required: ["anionic_surfactant", "nonionic_surfactant", "water", "preservative"],
    optional: ["amphoteric_surfactant", "chelating_agent", "ph_adjuster", "rheology_modifier"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Mild surfactants", ["anionic_surfactant", "nonionic_surfactant", "amphoteric_surfactant"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "rheology_modifier", "preservative"]],
    ],
    preservative: true,
    ph: true,
    spec: [...LIQUID_SPEC, "rinsability", "residue on fabric"],
    warn: [
      "Baby products are typically fragrance-free and dye-free — is that intended here?",
      "Rinse-out residue matters more than for a general laundry liquid.",
      "Any skin-mildness claim requires testing, not formulation reasoning.",
    ],
  },
  {
    familyCodes: ["FS-FLORAL", "FS-SENSITIVE", "FS-SACHET", "FS-INDUSTRIAL"],
    name: "Fabric softener",
    required: ["cationic_surfactant", "water"],
    optional: ["preservative", "ph_adjuster", "solvent", "rheology_modifier", "fragrance", "colorant", "opacifier"],
    phases: [
      ["A", "Water phase, heated", ["water"]],
      ["B", "Cationic softener", ["cationic_surfactant"]],
      ["C", "Cool down", ["fragrance", "colorant", "preservative", "ph_adjuster"]],
    ],
    preservative: true,
    ph: true,
    spec: [...LIQUID_SPEC, "cationic active", "emulsion stability"],
    warn: [
      "Esterquats hydrolyse outside a narrow acidic pH band.",
      "Anionic carryover from the wash destabilises the emulsion.",
    ],
  },
  {
    familyCodes: ["LSA-ADDITIVE"],
    name: "Laundry sanitizer additive",
    required: ["disinfectant_active", "water"],
    optional: ["qac_active", "nonionic_surfactant", "chelating_agent", "ph_adjuster", "fragrance", "preservative"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Active", ["disinfectant_active", "qac_active"]],
      ["C", "Adjust", ["ph_adjuster", "nonionic_surfactant", "fragrance"]],
    ],
    preservative: true,
    ph: true,
    spec: [...LIQUID_SPEC, "active concentration", "contact time"],
    warn: [
      "Any sanitising claim requires efficacy testing and registration. FormuLab does not verify either.",
      "Anionic detergent residue inactivates QAC actives.",
    ],
  },
  {
    familyCodes: ["LSR-STAIN"],
    name: "Laundry stain remover",
    required: ["anionic_surfactant", "solvent", "water"],
    optional: ["nonionic_surfactant", "enzyme", "chelating_agent", "ph_adjuster", "preservative"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Surfactant and solvent", ["anionic_surfactant", "nonionic_surfactant", "solvent"]],
      ["C", "Adjust and post-dose", ["ph_adjuster", "preservative", "enzyme"]],
    ],
    preservative: true,
    ph: true,
    spec: LIQUID_SPEC,
    warn: ["Direct-application products sit on fabric undiluted — colour fastness needs testing."],
  },
  // ----------------------------------------------------------------- bleach ---
  {
    familyCodes: ["BL-REGULAR", "BL-CONCENTRATED", "BL-INDUSTRIAL"],
    name: "Hypochlorite bleach",
    required: ["bleaching_agent", "water", "ph_adjuster"],
    optional: ["nonionic_surfactant", "chelating_agent", "fragrance"],
    phases: [
      ["A", "Water phase", ["water"]],
      ["B", "Hypochlorite", ["bleaching_agent"]],
      ["C", "Stabilise", ["ph_adjuster", "chelating_agent", "nonionic_surfactant"]],
    ],
    ph: true,
    spec: ["available chlorine", "free alkali", "density", "appearance", "stability at 40 °C"],
    warn: [
      "Hypochlorite must stay alkaline; acidification releases chlorine gas.",
      "Never combine with ammonia, acid or amine-containing raw materials.",
      "Fragrance and most surfactants are oxidised by hypochlorite.",
      "Available chlorine declines on storage — shelf life is a stability result, not a formulation one.",
    ],
  },
  // ------------------------------------------------------------ dishwashing ---
  {
    familyCodes: ["DW-LEMON", "DW-ORANGE", "DW-INDUSTRIAL"],
    name: "Manual dishwashing liquid",
    required: ["anionic_surfactant", "amphoteric_surfactant", "water", "preservative"],
    optional: ["nonionic_surfactant", "rheology_modifier", "ph_adjuster", "chelating_agent", "humectant", "fragrance", "colorant", "opacifier"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Surfactants", ["anionic_surfactant", "amphoteric_surfactant", "nonionic_surfactant"]],
      ["C", "Thicken and adjust", ["rheology_modifier", "ph_adjuster"]],
      ["D", "Minors", ["fragrance", "colorant", "preservative"]],
    ],
    preservative: true,
    ph: true,
    spec: [...LIQUID_SPEC, "foam height", "plate count per dose"],
    warn: [
      "Salt thickening has a viscosity peak — past it, viscosity collapses.",
      "The product contacts hands for long periods; mildness is a real design constraint.",
    ],
  },
  {
    familyCodes: ["DW-ANTIBAC"],
    name: "Antibacterial dishwashing liquid",
    required: ["anionic_surfactant", "amphoteric_surfactant", "disinfectant_active", "water", "preservative"],
    optional: ["nonionic_surfactant", "rheology_modifier", "ph_adjuster", "fragrance"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Surfactants", ["anionic_surfactant", "amphoteric_surfactant", "nonionic_surfactant"]],
      ["C", "Active", ["disinfectant_active"]],
      ["D", "Adjust and preserve", ["rheology_modifier", "ph_adjuster", "preservative", "fragrance"]],
    ],
    preservative: true,
    ph: true,
    spec: [...LIQUID_SPEC, "active concentration"],
    warn: [
      "Antibacterial claims require efficacy data and may require registration.",
      "Anionic surfactants inactivate cationic actives — check compatibility before selecting.",
    ],
  },
  // -------------------------------------------------------- surface cleaning ---
  {
    familyCodes: ["SC-MULTIPURPOSE", "SC-BLACKSOAP"],
    name: "Multipurpose cleaner",
    required: ["nonionic_surfactant", "water", "preservative"],
    optional: ["anionic_surfactant", "amphoteric_surfactant", "solvent", "chelating_agent", "ph_adjuster", "fragrance", "colorant"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Surfactants and solvent", ["nonionic_surfactant", "anionic_surfactant", "amphoteric_surfactant", "solvent"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "preservative", "fragrance", "colorant"]],
    ],
    preservative: true,
    ph: true,
    spec: LIQUID_SPEC,
    warn: ["Surface compatibility (stone, aluminium, varnish) depends on pH and solvent choice."],
  },
  {
    familyCodes: ["IC-DEGREASER"],
    name: "Industrial degreaser",
    required: ["nonionic_surfactant", "ph_adjuster", "water"],
    optional: ["anionic_surfactant", "solvent", "chelating_agent", "builder", "preservative"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent", "builder"]],
      ["B", "Alkali", ["ph_adjuster"]],
      ["C", "Surfactants and solvent", ["nonionic_surfactant", "anionic_surfactant", "solvent"]],
    ],
    preservative: false,
    ph: true,
    spec: [...LIQUID_SPEC, "free alkalinity"],
    warn: [
      "Strongly alkaline products are corrosive — PPE and labelling are not optional.",
      "Caustic degreasers attack aluminium and galvanised surfaces.",
    ],
  },
  {
    familyCodes: ["AL-REMOVER"],
    name: "Limescale remover",
    required: ["ph_adjuster", "water"],
    optional: ["nonionic_surfactant", "chelating_agent", "solvent", "fragrance", "colorant", "preservative"],
    phases: [
      ["A", "Water phase", ["water"]],
      ["B", "Acid", ["ph_adjuster"]],
      ["C", "Wetting and minors", ["nonionic_surfactant", "chelating_agent", "fragrance"]],
    ],
    preservative: false,
    ph: true,
    spec: [...LIQUID_SPEC, "free acidity"],
    warn: [
      "Acids attack marble, terrazzo, enamel and aluminium.",
      "Never let an acid product mix with hypochlorite bleach in use or in the plant.",
    ],
  },
  {
    familyCodes: ["SC-GLASS"],
    name: "Glass cleaner",
    required: ["solvent", "water"],
    optional: ["nonionic_surfactant", "amphoteric_surfactant", "ph_adjuster", "fragrance", "colorant", "preservative"],
    phases: [
      ["A", "Water phase", ["water"]],
      ["B", "Solvent", ["solvent"]],
      ["C", "Wetting and minors", ["nonionic_surfactant", "fragrance", "colorant", "preservative"]],
    ],
    preservative: true,
    spec: [...LIQUID_SPEC, "streak-free drying"],
    warn: ["Too much surfactant causes streaking — this is the defining constraint of the type."],
  },
  {
    familyCodes: ["SC-FLOOR"],
    name: "Floor cleaner",
    required: ["nonionic_surfactant", "water", "preservative"],
    optional: ["anionic_surfactant", "solvent", "chelating_agent", "ph_adjuster", "fragrance", "colorant", "opacifier"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Surfactants", ["nonionic_surfactant", "anionic_surfactant", "solvent"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "preservative", "fragrance", "colorant"]],
    ],
    preservative: true,
    ph: true,
    spec: [...LIQUID_SPEC, "residue after drying"],
    warn: ["Low-foam behaviour matters when the product is used with a mop and bucket."],
  },
  {
    familyCodes: ["SC-TOILETGEL"],
    name: "Toilet bowl cleaner gel",
    required: ["ph_adjuster", "rheology_modifier", "water"],
    optional: ["nonionic_surfactant", "amphoteric_surfactant", "disinfectant_active", "fragrance", "colorant", "preservative"],
    phases: [
      ["A", "Water phase", ["water"]],
      ["B", "Acid", ["ph_adjuster"]],
      ["C", "Thicken", ["rheology_modifier", "nonionic_surfactant", "amphoteric_surfactant"]],
      ["D", "Minors", ["fragrance", "colorant", "disinfectant_active"]],
    ],
    preservative: false,
    ph: true,
    spec: [...LIQUID_SPEC, "cling time on a vertical surface", "free acidity"],
    warn: [
      "Cling time is what makes the product work — viscosity alone does not capture it.",
      "Acid plus hypochlorite releases chlorine gas; the label must warn against mixing.",
    ],
  },
  {
    familyCodes: ["SC-CREAM"],
    name: "Cream cleaner",
    required: ["abrasive", "anionic_surfactant", "water", "preservative"],
    optional: ["nonionic_surfactant", "rheology_modifier", "chelating_agent", "ph_adjuster", "fragrance", "colorant"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent", "rheology_modifier"]],
      ["B", "Surfactants", ["anionic_surfactant", "nonionic_surfactant"]],
      ["C", "Abrasive dispersion", ["abrasive"]],
      ["D", "Minors", ["fragrance", "colorant", "preservative", "ph_adjuster"]],
    ],
    preservative: true,
    ph: true,
    spec: [...LIQUID_SPEC, "abrasive settling after 3 months", "particle size"],
    warn: [
      "Suspension stability of the abrasive is the main failure mode.",
      "Abrasive hardness must suit the intended surface, not just the soil.",
    ],
  },
  {
    familyCodes: ["SC-TILEBATH"],
    name: "Tile and bathroom cleaner",
    required: ["nonionic_surfactant", "water"],
    optional: ["ph_adjuster", "chelating_agent", "solvent", "disinfectant_active", "fragrance", "preservative"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Surfactants and acid", ["nonionic_surfactant", "ph_adjuster", "solvent"]],
      ["C", "Minors", ["fragrance", "preservative", "disinfectant_active"]],
    ],
    preservative: true,
    ph: true,
    spec: LIQUID_SPEC,
    warn: ["Soap scum removal usually needs acidity, which limits surface compatibility."],
  },
  {
    familyCodes: ["SC-AIRFRESH"],
    name: "Air freshener",
    required: ["fragrance", "solvent"],
    optional: ["water", "nonionic_surfactant", "preservative"],
    phases: [
      ["A", "Solvent base", ["solvent", "water"]],
      ["B", "Fragrance", ["fragrance"]],
      ["C", "Solubilise", ["nonionic_surfactant", "preservative"]],
    ],
    preservative: true,
    spec: ["appearance", "clarity", "density", "flash point"],
    warn: [
      "Ethanol-based products are flammable — flash point drives transport classification.",
      "Fragrance solubility governs clarity; a cloudy product is usually under-solubilised.",
    ],
  },
  // ----------------------------------------------------------- disinfectant ---
  {
    familyCodes: ["DI-TRIGGER", "DI-QAC-SURFACE", "DI-INDUSTRIAL"],
    name: "QAC surface sanitizer",
    required: ["qac_active", "water"],
    optional: ["nonionic_surfactant", "solvent", "chelating_agent", "ph_adjuster", "fragrance", "preservative"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "QAC active", ["qac_active"]],
      ["C", "Adjust", ["nonionic_surfactant", "solvent", "ph_adjuster", "fragrance"]],
    ],
    preservative: true,
    ph: true,
    spec: ["appearance", "pH", "active quat content", "contact time", "hard-water tolerance"],
    warn: [
      "Anionic surfactants inactivate QACs — this is the single most common formulation error of the type.",
      "Hard water reduces QAC efficacy; a chelant is usually needed.",
      "Disinfectant claims require registration and efficacy testing that FormuLab does not perform.",
    ],
  },
  // ---------------------------------------------------------- hand hygiene ---
  {
    familyCodes: ["HH-HANDSOAP"],
    name: "Liquid hand soap",
    required: ["anionic_surfactant", "amphoteric_surfactant", "water", "preservative"],
    optional: ["nonionic_surfactant", "humectant", "conditioning_agent", "rheology_modifier", "chelating_agent", "ph_adjuster", "fragrance", "colorant", "opacifier"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent", "humectant"]],
      ["B", "Surfactants", ["anionic_surfactant", "amphoteric_surfactant", "nonionic_surfactant"]],
      ["C", "Condition and thicken", ["conditioning_agent", "rheology_modifier"]],
      ["D", "Adjust and preserve", ["ph_adjuster", "preservative", "fragrance", "colorant"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: CARE_SPEC,
    warn: ["Repeated-use hand products need a mildness profile, not just cleaning power."],
  },
  {
    familyCodes: ["HH-SANITIZER"],
    name: "Alcohol hand sanitizer",
    required: ["solvent", "water"],
    optional: ["humectant", "rheology_modifier", "ph_adjuster", "emollient", "fragrance"],
    phases: [
      ["A", "Alcohol phase", ["solvent"]],
      ["B", "Water and humectant", ["water", "humectant"]],
      ["C", "Thicken and adjust", ["rheology_modifier", "ph_adjuster", "emollient"]],
    ],
    preservative: false,
    ph: true,
    inci: true,
    spec: ["appearance", "pH", "viscosity", "alcohol content (% v/v)", "density"],
    warn: [
      "Alcohol content must be verified analytically — it is the efficacy-determining parameter.",
      "High alcohol content is flammable and affects storage and transport classification.",
      "Efficacy claims require testing to a recognised standard.",
    ],
  },
  {
    familyCodes: ["HH-ALCOHOLFREE"],
    name: "Alcohol-free hand rub",
    required: ["qac_active", "water"],
    optional: ["humectant", "rheology_modifier", "emollient", "ph_adjuster", "preservative", "fragrance"],
    phases: [
      ["A", "Water phase", ["water", "humectant"]],
      ["B", "Active", ["qac_active"]],
      ["C", "Thicken and adjust", ["rheology_modifier", "emollient", "ph_adjuster", "preservative"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: [...CARE_SPEC, "active concentration"],
    warn: [
      "Alcohol-free rubs have a different efficacy spectrum from alcohol — claims must match the evidence.",
      "Anionic ingredients inactivate the cationic active.",
    ],
  },
  // -------------------------------------------------------------- oral care ---
  {
    familyCodes: ["OC-TOOTHPASTE", "OC-WHITENING"],
    name: "Toothpaste",
    required: ["abrasive", "humectant", "rheology_modifier", "water", "preservative"],
    optional: ["fluoride_active", "anionic_surfactant", "ph_adjuster", "colorant", "fragrance", "opacifier"],
    phases: [
      ["A", "Humectant/water premix", ["water", "humectant"]],
      ["B", "Binder hydration", ["rheology_modifier"]],
      ["C", "Abrasive and actives", ["abrasive", "fluoride_active"]],
      ["D", "Surfactant, flavour, preserve", ["anionic_surfactant", "fragrance", "preservative", "colorant"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: ["appearance", "pH", "consistency / extrudability", "abrasivity (RDA)", "available fluoride", "microbiological limits"],
    warn: [
      "Fluoride availability depends on the abrasive: calcium abrasives bind fluoride from sodium fluoride.",
      "Abrasivity must be measured (RDA), not inferred from the abrasive grade.",
      "Toothpaste is ingested in small amounts — the regulatory position is stricter than for cosmetics.",
      "Any fluoride level here is a formulation input, not a verified regulatory limit.",
    ],
  },
  // --------------------------------------------------------------- hair care ---
  {
    familyCodes: ["HC-SHAMPOO-REG"],
    name: "Regular shampoo",
    required: ["anionic_surfactant", "amphoteric_surfactant", "water", "preservative"],
    optional: ["nonionic_surfactant", "conditioning_agent", "humectant", "rheology_modifier", "chelating_agent", "ph_adjuster", "opacifier", "fragrance", "colorant"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent", "humectant"]],
      ["B", "Surfactants", ["anionic_surfactant", "amphoteric_surfactant", "nonionic_surfactant"]],
      ["C", "Conditioning", ["conditioning_agent", "cationic_surfactant"]],
      ["D", "Adjust, thicken, preserve", ["ph_adjuster", "rheology_modifier", "preservative", "fragrance", "colorant"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: CARE_SPEC,
    warn: [
      "Salt-thickened systems have a viscosity peak; overshooting it thins the product.",
      "Cationic conditioners and anionic surfactants form complexes — that can be the mechanism or the defect.",
    ],
  },
  {
    familyCodes: ["HC-SHAMPOO-BABY"],
    name: "Baby shampoo",
    required: ["amphoteric_surfactant", "nonionic_surfactant", "water", "preservative"],
    optional: ["anionic_surfactant", "humectant", "conditioning_agent", "rheology_modifier", "ph_adjuster", "chelating_agent"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent", "humectant"]],
      ["B", "Mild surfactants", ["amphoteric_surfactant", "nonionic_surfactant", "anionic_surfactant"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "rheology_modifier", "preservative"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: [...CARE_SPEC, "ocular mildness test result"],
    warn: [
      "A no-tears claim requires an ocular irritation test result — it cannot be reasoned from the surfactant blend.",
      "pH is usually set near the eye's own pH; this is a design target, not a rule FormuLab verifies.",
    ],
  },
  {
    familyCodes: ["HC-CONDITIONER", "HC-CONDITIONER-INST"],
    name: "Hair conditioner",
    required: ["cationic_surfactant", "emollient", "water", "preservative"],
    optional: ["conditioning_agent", "humectant", "rheology_modifier", "ph_adjuster", "fragrance", "colorant"],
    phases: [
      ["A", "Water phase, heated", ["water", "humectant"]],
      ["B", "Oil phase, heated", ["emollient", "cationic_surfactant"]],
      ["C", "Emulsify and cool", ["rheology_modifier", "conditioning_agent"]],
      ["D", "Cool down", ["preservative", "fragrance", "ph_adjuster", "colorant"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: [...CARE_SPEC, "emulsion stability at 40 °C"],
    warn: [
      "The emulsion is formed by the cationic/fatty alcohol pair — changing either changes the structure.",
      "Preservatives are added below their heat limit, in the cool-down phase.",
    ],
  },
  // ---------------------------------------------------------- body cleansing ---
  {
    familyCodes: ["BC-SHOWERGEL", "BC-SHOWERGEL-INST"],
    name: "Shower gel",
    required: ["anionic_surfactant", "amphoteric_surfactant", "water", "preservative"],
    optional: ["nonionic_surfactant", "emollient", "humectant", "conditioning_agent", "rheology_modifier", "chelating_agent", "ph_adjuster", "opacifier", "fragrance", "colorant"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent", "humectant"]],
      ["B", "Surfactants", ["anionic_surfactant", "amphoteric_surfactant", "nonionic_surfactant"]],
      ["C", "Care additives", ["emollient", "conditioning_agent"]],
      ["D", "Adjust and preserve", ["ph_adjuster", "rheology_modifier", "preservative", "fragrance", "colorant"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: CARE_SPEC,
    warn: ["Skin pH is around 5.5; a shower gel is normally formulated toward it."],
  },
  // ----------------------------------------------------------------- skin care ---
  {
    familyCodes: ["SK-FACIALGEL"],
    name: "Facial cleansing gel",
    required: ["amphoteric_surfactant", "water", "preservative"],
    optional: ["anionic_surfactant", "nonionic_surfactant", "humectant", "rheology_modifier", "chelating_agent", "ph_adjuster", "fragrance"],
    phases: [
      ["A", "Water phase", ["water", "humectant", "chelating_agent"]],
      ["B", "Mild surfactants", ["amphoteric_surfactant", "nonionic_surfactant", "anionic_surfactant"]],
      ["C", "Thicken, adjust, preserve", ["rheology_modifier", "ph_adjuster", "preservative", "fragrance"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: CARE_SPEC,
    warn: ["Facial products need a milder surfactant system than a body wash."],
  },
  {
    familyCodes: ["SK-MOISTURIZER", "SK-BODYLOTION"],
    name: "Moisturizing cream / body lotion",
    required: ["emollient", "water", "preservative", "rheology_modifier"],
    optional: ["humectant", "nonionic_surfactant", "antioxidant", "chelating_agent", "ph_adjuster", "fragrance", "colorant"],
    phases: [
      ["A", "Water phase, heated", ["water", "humectant", "chelating_agent"]],
      ["B", "Oil phase, heated", ["emollient", "nonionic_surfactant", "antioxidant"]],
      ["C", "Emulsify", ["rheology_modifier"]],
      ["D", "Cool down", ["preservative", "fragrance", "ph_adjuster"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: [...CARE_SPEC, "emulsion stability", "centrifuge test"],
    warn: [
      "Emulsion stability is the dominant failure mode; it is established by testing, not by HLB arithmetic alone.",
      "Preservative efficacy in an emulsion must be challenge-tested.",
      "Heat-sensitive ingredients go in the cool-down phase.",
    ],
  },
  {
    familyCodes: ["SK-SHAVING"],
    name: "Shaving cream",
    required: ["anionic_surfactant", "emollient", "water", "preservative"],
    optional: ["humectant", "ph_adjuster", "rheology_modifier", "conditioning_agent", "fragrance"],
    phases: [
      ["A", "Water phase, heated", ["water", "humectant"]],
      ["B", "Fatty phase", ["emollient", "anionic_surfactant"]],
      ["C", "Saponify / neutralise", ["ph_adjuster"]],
      ["D", "Cool down", ["preservative", "fragrance", "conditioning_agent"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: [...CARE_SPEC, "foam density", "foam stability"],
    warn: ["Foam quality and cushion are the performance attributes; viscosity alone does not predict them."],
  },
  // ---------------------------------------------------------------- automotive ---
  {
    familyCodes: ["AC-CARSHAMPOO"],
    name: "Car shampoo",
    required: ["anionic_surfactant", "nonionic_surfactant", "water", "preservative"],
    optional: ["amphoteric_surfactant", "chelating_agent", "ph_adjuster", "rheology_modifier", "fragrance", "colorant"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Surfactants", ["anionic_surfactant", "nonionic_surfactant", "amphoteric_surfactant"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "rheology_modifier", "preservative", "fragrance", "colorant"]],
    ],
    preservative: true,
    ph: true,
    spec: [...LIQUID_SPEC, "spot-free drying", "paint and clearcoat compatibility"],
    warn: ["Must be safe on clearcoat and wax — a high-pH degreaser is not a car shampoo."],
  },
  {
    familyCodes: ["AC-INTERIOR"],
    name: "Water-based interior cleaner",
    required: ["nonionic_surfactant", "water", "preservative"],
    optional: ["amphoteric_surfactant", "solvent", "conditioning_agent", "ph_adjuster", "fragrance"],
    phases: [
      ["A", "Water phase", ["water"]],
      ["B", "Surfactants and solvent", ["nonionic_surfactant", "amphoteric_surfactant", "solvent"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "preservative", "fragrance", "conditioning_agent"]],
    ],
    preservative: true,
    ph: true,
    spec: [...LIQUID_SPEC, "residue on vinyl", "no gloss change"],
    warn: ["Interior plastics and vinyl are solvent-sensitive; compatibility must be tested per substrate."],
  },
  // ----------------------------------------------------------------- wet wipes ---
  {
    familyCodes: ["WW-SURFACE-ANTIBAC"],
    name: "Surface wet-wipe lotion",
    required: ["qac_active", "water", "preservative"],
    optional: ["nonionic_surfactant", "solvent", "chelating_agent", "ph_adjuster", "fragrance"],
    phases: [
      ["A", "Water phase", ["water", "chelating_agent"]],
      ["B", "Active", ["qac_active"]],
      ["C", "Adjust and preserve", ["nonionic_surfactant", "ph_adjuster", "preservative", "fragrance"]],
    ],
    preservative: true,
    ph: true,
    spec: ["appearance", "pH", "active concentration", "lotion pick-up per wipe", "substrate compatibility"],
    warn: [
      "The nonwoven substrate adsorbs cationic actives — the concentration ON the wipe is not the concentration in the lotion.",
      "Efficacy must be tested on the finished wipe, not the lotion.",
    ],
  },
  {
    familyCodes: ["WW-MEDICAL-CHX"],
    name: "Chlorhexidine wipe lotion",
    required: ["chlorhexidine_active", "water", "preservative"],
    optional: ["solvent", "humectant", "ph_adjuster", "chelating_agent"],
    phases: [
      ["A", "Water phase", ["water", "humectant"]],
      ["B", "Active", ["chlorhexidine_active"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "preservative", "solvent"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: ["appearance", "pH", "chlorhexidine assay", "lotion pick-up per wipe", "microbiological limits"],
    warn: [
      "This is a medical-device or medicinal product in most jurisdictions — regulatory route must be confirmed by a person, not by FormuLab.",
      "Chlorhexidine is incompatible with anionics and precipitates outside a narrow pH band.",
      "Chlorhexidine adsorbs strongly onto some nonwoven substrates.",
    ],
  },
  {
    familyCodes: ["WW-FLUSHABLE"],
    name: "Flushable-wipe lotion",
    required: ["water", "preservative"],
    optional: ["amphoteric_surfactant", "nonionic_surfactant", "humectant", "emollient", "ph_adjuster", "chelating_agent", "fragrance"],
    phases: [
      ["A", "Water phase", ["water", "humectant", "chelating_agent"]],
      ["B", "Mild surfactants and emollients", ["amphoteric_surfactant", "nonionic_surfactant", "emollient"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "preservative", "fragrance"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: ["appearance", "pH", "lotion pick-up per wipe", "dispersibility of the finished wipe", "microbiological limits"],
    warn: [
      "Flushability is a property of the substrate and must be tested to a recognised dispersibility protocol.",
      "The lotion must not bind the substrate fibres together.",
    ],
  },
  {
    familyCodes: ["WW-BABY"],
    name: "Baby-wipe lotion",
    required: ["water", "preservative"],
    optional: ["amphoteric_surfactant", "humectant", "emollient", "ph_adjuster", "chelating_agent"],
    phases: [
      ["A", "Water phase", ["water", "humectant", "chelating_agent"]],
      ["B", "Mild additives", ["amphoteric_surfactant", "emollient"]],
      ["C", "Adjust and preserve", ["ph_adjuster", "preservative"]],
    ],
    preservative: true,
    ph: true,
    inci: true,
    spec: ["appearance", "pH", "lotion pick-up per wipe", "microbiological limits", "skin compatibility test result"],
    warn: [
      "Baby wipes are normally fragrance-free and formulated near skin pH.",
      "Preservative choice for infant skin is a safety-assessment decision, not a formulation preference.",
      "Preservative efficacy must be challenge-tested on the finished wipe.",
    ],
  },
];

/** Built once and frozen; templates are reference data, not state. */
function build(): Map<string, FormulaTemplate> {
  const map = new Map<string, FormulaTemplate>();
  for (const s of SPECS) {
    for (const familyCode of s.familyCodes) {
      map.set(familyCode, {
        familyCode,
        name: s.name,
        requiredFunctions: s.required,
        optionalFunctions: s.optional ?? [],
        phases: s.phases.map(([name, description, functions]) => ({
          name,
          description,
          functions,
        })),
        requiresPreservative: s.preservative ?? false,
        requiresPhAdjuster: s.ph ?? false,
        requiresInci: s.inci ?? false,
        specFields: s.spec,
        warningTopics: s.warn,
        notes: s.notes,
      });
    }
  }
  return map;
}

const TEMPLATES = build();

export function templateForFamily(familyCode: string): FormulaTemplate | undefined {
  return TEMPLATES.get(familyCode);
}

export function allTemplates(): FormulaTemplate[] {
  return [...TEMPLATES.values()];
}

/** Distinct product types covered, ignoring families that share a template. */
export function templateTypeCount(): number {
  return SPECS.length;
}

export interface TemplateGap {
  fn: MaterialFunction;
  required: boolean;
}

/**
 * Which roles the template expects but the formula does not yet contain.
 *
 * A gap is a prompt to think, not an error: a chemist may have a good reason to
 * leave a role out, and the builder shows gaps without blocking the save.
 */
export function templateGaps(
  template: FormulaTemplate,
  presentFunctions: MaterialFunction[],
): TemplateGap[] {
  const present = new Set(presentFunctions);
  return [
    ...template.requiredFunctions.filter((f) => !present.has(f)).map((fn) => ({ fn, required: true })),
    ...template.optionalFunctions.filter((f) => !present.has(f)).map((fn) => ({ fn, required: false })),
  ];
}
