/**
 * Seed compatibility rules.
 *
 * These are general formulation-chemistry knowledge, not transcriptions of a
 * specific standard or paper — `sourceReferences` is deliberately empty and
 * `verificationStatus` is `not_verified` (a few, where the mechanism is basic
 * inorganic chemistry rather than a formulation judgement call, are marked
 * `human_review_required` instead, meaning: a chemist should confirm the
 * exact wording and thresholds before this is relied on, not that it is
 * unimportant). This list is NOT exhaustive. It covers the categories named
 * in the platform's compatibility-engine specification and nothing more.
 *
 * Every rule is `status: "draft"` for the same reason: nothing here has gone
 * through this project's own rule-review workflow yet, whatever the
 * underlying chemistry's confidence level is.
 */
import type { CompatibilityRule } from "../schemas/compatibility";

const now = "2026-01-01T00:00:00.000Z";

function rule(r: Omit<CompatibilityRule, "schemaVersion" | "version" | "status" | "active" | "createdAt" | "updatedAt">): CompatibilityRule {
  return {
    schemaVersion: "1.0",
    version: "1.0",
    status: "draft",
    active: true,
    createdAt: now,
    updatedAt: now,
    ...r,
  };
}

export const SEED_COMPATIBILITY_RULES: CompatibilityRule[] = [
  rule({
    id: "compat-anionic-cationic",
    name: "Anionic / cationic incompatibility",
    severity: "warning",
    ruleType: "forbidden_combination",
    conditions: [
      { label: "anionic", functionsAny: ["anionic_surfactant"], ionicCharactersAny: ["anionic"] },
      { label: "cationic", functionsAny: ["cationic_surfactant"], ionicCharactersAny: ["cationic"] },
    ],
    message: "Anionic and cationic surfactants are present together. Oppositely charged surfactants commonly form an insoluble complex, which can cloud the product or drop performance of both.",
    scientificReason: "Ionic head groups of opposite charge associate and precipitate out of solution.",
    recommendedAction: "Confirm compatibility at bench scale, or replace one side with an amphoteric/nonionic alternative.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-qac-anionic",
    name: "QAC / anionic incompatibility",
    severity: "error",
    ruleType: "forbidden_combination",
    conditions: [
      { label: "qac", functionsAny: ["qac_active"] },
      { label: "anionic", functionsAny: ["anionic_surfactant"], ionicCharactersAny: ["anionic"] },
    ],
    message: "A quaternary ammonium (QAC) disinfectant active is combined with an anionic surfactant. Anionics neutralise QAC actives, which can silently defeat the disinfectant claim.",
    scientificReason: "The cationic QAC and anionic surfactant ion-pair and precipitate, removing free active QAC from solution.",
    recommendedAction: "Use a nonionic or amphoteric surfactant system with QAC actives. If an anionic must stay, verify residual efficacy by microbiology testing, not formulation math.",
    sourceReferences: [],
    verificationStatus: "human_review_required",
  }),
  rule({
    id: "compat-chlorhexidine-anionic",
    name: "Chlorhexidine / anionic incompatibility",
    severity: "error",
    ruleType: "forbidden_combination",
    conditions: [
      { label: "chlorhexidine", functionsAny: ["chlorhexidine_active"] },
      { label: "anionic", functionsAny: ["anionic_surfactant"], ionicCharactersAny: ["anionic"] },
    ],
    message: "Chlorhexidine is combined with an anionic surfactant. Chlorhexidine is a cationic biguanide and is deactivated by anionic materials the same way QAC actives are.",
    scientificReason: "Cationic chlorhexidine gluconate ion-pairs with anionic surfactants, precipitating and reducing free active.",
    recommendedAction: "Use nonionic/amphoteric surfactants with chlorhexidine. Verify with microbiology testing before any antimicrobial claim.",
    sourceReferences: [],
    verificationStatus: "human_review_required",
  }),
  rule({
    id: "compat-acid-hypochlorite",
    name: "Acid / hypochlorite danger",
    severity: "blocking",
    ruleType: "forbidden_combination",
    conditions: [
      { label: "hypochlorite", nameKeywordsAny: ["hypochlorite", "bleach", "javel"], functionsAny: ["bleaching_agent"] },
      { label: "acid", nameKeywordsAny: ["hydrochloric", "sulfamic", "citric acid", "acetic acid", "phosphoric acid", "strong acid"], functionsAny: ["ph_adjuster"] },
    ],
    message: "Hypochlorite bleach and an acidifying material are both present. Mixing hypochlorite with acid releases chlorine gas.",
    scientificReason: "Acid protonates hypochlorite to hypochlorous acid, which decomposes to chlorine gas — a well-established, physically hazardous reaction.",
    recommendedAction: "These must never be combined in one formula or dosed together. Remove one of the two lines before this formula can proceed.",
    sourceReferences: [],
    verificationStatus: "human_review_required",
  }),
  rule({
    id: "compat-hypochlorite-amine",
    name: "Hypochlorite and ammonia/amines",
    severity: "blocking",
    ruleType: "forbidden_combination",
    conditions: [
      { label: "hypochlorite", nameKeywordsAny: ["hypochlorite", "bleach", "javel"], functionsAny: ["bleaching_agent"] },
      { label: "amine", nameKeywordsAny: ["ammonia", "amine", "amino"], functionsAny: ["cationic_surfactant"] },
    ],
    message: "Hypochlorite bleach and an amine/ammonia-bearing material are both present. This combination releases toxic chloramine gases.",
    scientificReason: "Hypochlorite reacts with ammonia/amine nitrogen to form chloramines (mono-, di-, trichloramine), which are respiratory irritants and, at higher exposure, dangerous.",
    recommendedAction: "These must never be combined. Remove one of the two lines before this formula can proceed.",
    sourceReferences: [],
    verificationStatus: "human_review_required",
  }),
  rule({
    id: "compat-oxidizer-reducer",
    name: "Oxidizer / reducer incompatibility",
    severity: "error",
    ruleType: "forbidden_combination",
    conditions: [
      { label: "oxidizer", functionsAny: ["bleaching_agent", "oxygen_donor"] },
      { label: "reducer", functionsAny: ["antioxidant"] },
    ],
    message: "An oxidising active (bleach/oxygen-donor) and a reducing agent (antioxidant) are both present. They tend to consume each other, weakening both.",
    scientificReason: "Redox reaction between the oxidiser and the reductant depletes the intended active concentration of one or both.",
    recommendedAction: "Separate into different product lines, or confirm by titrating residual active after storage.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-peroxide-metal",
    name: "Peroxide incompatibility",
    severity: "warning",
    ruleType: "warning_combination",
    conditions: [
      { label: "peroxide", nameKeywordsAny: ["peroxide", "percarbonate", "perborate"], functionsAny: ["oxygen_donor"] },
      { label: "metal-bearing", nameKeywordsAny: ["iron", "copper", "manganese", "ferrous", "ferric"] },
    ],
    message: "A peroxide-type active is combined with a material that may carry trace transition-metal ions. Trace metals catalyse peroxide decomposition, which can shorten shelf life or reduce available active on use.",
    scientificReason: "Fenton-type catalytic decomposition of peroxide by trace Fe/Cu/Mn.",
    recommendedAction: "Add a chelating agent, and confirm active-oxygen retention with a stability study.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-preservative-ph",
    name: "Preservative / pH mismatch",
    severity: "warning",
    ruleType: "ph_dependent",
    conditions: [{ label: "preservative", functionsAny: ["preservative"], phMin: "3", phMax: "8" }],
    message: "A preservative is present, and the formula's target pH falls outside (or is not confirmed within) its typical effective range of pH 3–8.",
    scientificReason: "Many common preservative classes (parabens, organic acids, isothiazolinones) lose efficacy or ionise unfavourably outside a pH 3–8 window; the exact window is preservative-specific.",
    recommendedAction: "Check the specific preservative's supplier-stated effective pH range and confirm with a preservative efficacy test (PET/challenge test).",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-carbomer-electrolyte",
    name: "Carbomer / electrolyte sensitivity",
    severity: "warning",
    ruleType: "warning_combination",
    conditions: [
      { label: "carbomer", nameKeywordsAny: ["carbomer", "carbopol"], functionsAny: ["rheology_modifier"] },
      { label: "electrolyte", functionsAny: ["builder"] },
    ],
    message: "A carbomer thickener is combined with an electrolyte/builder. Electrolytes can collapse a carbomer's viscosity, sometimes drastically.",
    scientificReason: "Ionic strength compresses the carbomer's extended, charge-repelled polymer coil, reducing its thickening efficiency.",
    recommendedAction: "Add electrolyte-tolerant thickener or reduce electrolyte load; confirm final viscosity at bench scale.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-carbomer-neutralizer",
    name: "Carbomer neutralizer requirement",
    severity: "warning",
    ruleType: "required_coingredient",
    conditions: [
      { label: "carbomer", nameKeywordsAny: ["carbomer", "carbopol"], functionsAny: ["rheology_modifier"] },
      { label: "neutralizer", functionsAny: ["ph_adjuster"] },
    ],
    message: "A carbomer is present with no pH-adjuster line. Carbomer does not thicken until neutralised.",
    scientificReason: "Carbomer requires deprotonation (typically with NaOH/TEA/AMP) to uncoil and build viscosity.",
    recommendedAction: "Add a neutralising pH-adjuster line (e.g. sodium hydroxide, triethanolamine) and confirm target viscosity is reached.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-fragrance-solubility",
    name: "Fragrance solubility risk",
    severity: "warning",
    ruleType: "required_coingredient",
    conditions: [
      { label: "fragrance", functionsAny: ["fragrance"] },
      { label: "solubilizer", functionsAny: ["nonionic_surfactant", "solvent"] },
    ],
    message: "A fragrance is present with no solubiliser or carrier solvent line. Fragrance oils are often poorly water-soluble and can cloud or separate on their own.",
    scientificReason: "Fragrance oils are predominantly hydrophobic blends; clear aqueous products usually need a solubiliser to keep them in solution.",
    recommendedAction: "Add a nonionic solubiliser (or accept turbidity if the product is not meant to be clear) and confirm clarity on standing.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-active-solubility",
    name: "Active-material solubility risk",
    severity: "warning",
    ruleType: "required_coingredient",
    conditions: [
      { label: "active", functionsAny: ["disinfectant_active", "chlorhexidine_active"] },
      { label: "solubilizer", functionsAny: ["nonionic_surfactant", "solvent"] },
    ],
    message: "An antimicrobial active is present with no solubiliser/carrier line. Actives at use concentration are often not fully water-soluble without one.",
    scientificReason: "Solubility limits of the active in water alone are commonly below the concentration needed for efficacy.",
    recommendedAction: "Add a solubiliser/carrier and confirm the active stays in solution at the coldest storage temperature expected.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-metal-ion-sensitivity",
    name: "Metal-ion sensitivity",
    severity: "warning",
    ruleType: "required_coingredient",
    conditions: [
      { label: "metal-sensitive", functionsAny: ["enzyme", "bleaching_agent", "oxygen_donor"] },
      { label: "chelator", functionsAny: ["chelating_agent"] },
    ],
    message: "An enzyme or oxidising active is present with no chelating agent. Trace metal ions (often from water hardness) can destabilise both.",
    scientificReason: "Transition-metal ions catalyse enzyme denaturation and peroxide/hypochlorite decomposition.",
    recommendedAction: "Add a chelating agent (e.g. EDTA, phosphonate, citrate) sized for local water hardness, and confirm with a stability study.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-enzyme-oxidizer",
    name: "Enzyme / oxidizer incompatibility",
    severity: "error",
    ruleType: "forbidden_combination",
    conditions: [
      { label: "enzyme", functionsAny: ["enzyme"] },
      { label: "oxidizer", functionsAny: ["bleaching_agent", "oxygen_donor"] },
    ],
    message: "An enzyme and an oxidising active (bleach/oxygen-donor) are both present. Oxidisers denature enzymes, which can silently zero out enzyme performance.",
    scientificReason: "Oxidation of the enzyme's active-site residues (commonly cysteine/methionine) destroys catalytic activity.",
    recommendedAction: "Encapsulate the enzyme, separate into different product lines, or confirm residual enzyme activity after storage.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-fragrance-temperature",
    name: "High-temperature fragrance addition",
    severity: "warning",
    ruleType: "temperature_dependent",
    conditions: [{ label: "fragrance", functionsAny: ["fragrance"], maxTemperatureC: "40" }],
    message: "A fragrance line is present and the process temperature is at or above 40°C. Many fragrance top-notes flash off or degrade at higher addition temperatures.",
    scientificReason: "Volatile fragrance top-notes have flash/boiling points that can be approached during hot-process addition, changing the scent profile.",
    recommendedAction: "Add fragrance in the cool-down phase, below 40°C, unless the supplier's technical data sheet states otherwise.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-heat-sensitive-active",
    name: "Heat-sensitive active addition",
    severity: "warning",
    ruleType: "temperature_dependent",
    conditions: [
      { label: "heat-sensitive", functionsAny: ["enzyme", "disinfectant_active", "chlorhexidine_active"], maxTemperatureC: "45" },
    ],
    message: "A heat-sensitive active (enzyme or antimicrobial) is present and the process temperature is at or above 45°C.",
    scientificReason: "Enzymes denature and several antimicrobial actives degrade above typical process temperatures well below water's boiling point.",
    recommendedAction: "Add this active in the cool-down phase; confirm the specific material's supplier-stated thermal limit.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-bleach-packaging",
    name: "Bleach packaging incompatibility",
    severity: "error",
    ruleType: "packaging_incompatibility",
    conditions: [
      { label: "hypochlorite", nameKeywordsAny: ["hypochlorite", "bleach", "javel"], functionsAny: ["bleaching_agent"] },
      { label: "unsuitable packaging", packagingComponentTypesAny: ["pouch", "sachet_film"] },
    ],
    message: "A hypochlorite bleach formula is targeted at a flexible film pack (pouch/sachet). Chlorine off-gassing degrades most flexible films and can build pressure in a sealed pouch.",
    scientificReason: "Hypochlorite slowly releases chlorine/oxygen over shelf life; flexible barrier films are typically not rated for this alongside caustic pH.",
    recommendedAction: "Use a vented or hypochlorite-rated rigid HDPE container instead, and confirm with the packaging supplier's chemical-compatibility data.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-strong-acid-packaging",
    name: "Strong acid packaging risk",
    severity: "warning",
    ruleType: "packaging_incompatibility",
    conditions: [
      { label: "strong acid", nameKeywordsAny: ["hydrochloric", "sulfuric", "phosphoric acid", "strong acid"], functionsAny: ["ph_adjuster"] },
      { label: "drum packaging", packagingComponentTypesAny: ["drum"] },
    ],
    message: "A strong acid line is targeted at drum packaging. Confirm the drum's wetted material is acid-resistant (e.g. HDPE), not bare metal.",
    scientificReason: "Strong mineral acids corrode most bare metals; only acid-rated plastic or lined containers are appropriate.",
    recommendedAction: "Confirm the packaging component's material type with the supplier before production.",
    sourceReferences: [],
    verificationStatus: "not_verified",
  }),
  rule({
    id: "compat-qac-wipe-substrate",
    name: "QAC adsorption on incompatible wipe substrates",
    severity: "warning",
    ruleType: "packaging_incompatibility",
    conditions: [
      { label: "qac", functionsAny: ["qac_active"] },
      { label: "wipe substrate", packagingComponentTypesAny: ["wipe_substrate"] },
    ],
    message: "A QAC disinfectant active is targeted at a nonwoven wipe substrate. QAC actives are known to adsorb onto certain nonwoven fibres (especially cellulose-based), reducing the free active delivered on the wipe.",
    scientificReason: "Cationic QAC actives bind to anionic sites on cellulosic/nonwoven fibre surfaces, depleting solution-phase active.",
    recommendedAction: "Confirm substrate compatibility with the nonwoven supplier and verify delivered active by wet-out testing, not formulation math alone.",
    sourceReferences: [],
    verificationStatus: "human_review_required",
  }),
  rule({
    id: "compat-chlorhexidine-builder",
    name: "Chlorhexidine interaction with incompatible surfactants",
    severity: "warning",
    ruleType: "forbidden_combination",
    conditions: [
      { label: "chlorhexidine", functionsAny: ["chlorhexidine_active"] },
      { label: "builder", functionsAny: ["builder"] },
    ],
    message: "Chlorhexidine is combined with a builder (often carbonate/phosphate/silicate). Chlorhexidine can form insoluble salts with some of these anions.",
    scientificReason: "Chlorhexidine digluconate can precipitate with polyvalent anions such as carbonate or phosphate at typical use pH.",
    recommendedAction: "Confirm the specific builder salt against the chlorhexidine supplier's compatibility data before committing to this formula.",
    sourceReferences: [],
    verificationStatus: "human_review_required",
  }),
];
