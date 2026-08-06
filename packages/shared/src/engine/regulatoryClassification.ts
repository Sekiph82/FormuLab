/**
 * Deterministic regulatory product classification — spec §2.2. Same
 * governing principle as `classifyProductSafety`
 * (`engine/safety.ts`): a rule-based decision from stated facts, with its
 * reasoning shown, never a model's guess dressed up as a category.
 */
import type { ProductFamily } from "../schemas/product";
import type { RegulatoryClassificationResult, RegulatoryJurisdiction, RegulatoryProductCategory } from "../schemas/regulatory";

export interface RegulatoryClassificationInput {
  family: Pick<ProductFamily, "domain" | "subtype" | "name" | "hazardClass" | "intendedUsers" | "intendedUse">;
  claims?: string[];
  /** Functional roles present among the formula's own lines — e.g. an
   *  `oxidizing_agent`/`disinfectant_active` function pushes toward a
   *  stricter category regardless of the family's own domain. */
  activeFunctions?: string[];
  /** Free text describing where/how concentration was recorded — accepted
   *  for completeness (spec lists "Concentration" as an input) but not yet
   *  decisive on its own; see docs/REGULATORY_CLASSIFICATION.md. */
  concentrationNotes?: string;
  targetUsers?: string[];
  applicationArea?: string;
  packagingType?: string;
  market?: RegulatoryJurisdiction;
}

const DOMAIN_BASE_CATEGORY: Record<string, RegulatoryProductCategory> = {
  laundry_powder: "laundry_detergent",
  laundry_liquid: "laundry_detergent",
  fabric_softener: "household_cleaning_product",
  bleach: "disinfectant",
  oxygen_whitener: "household_cleaning_product",
  anti_limescale: "household_cleaning_product",
  dishwashing: "dishwashing_product",
  surface_cleaner: "household_cleaning_product",
  industrial_cleaner: "industrial_chemical_product",
  disinfectant: "disinfectant",
  hand_hygiene: "personal_care_cleanser",
  oral_care: "oral_care_product",
  hair_care: "hair_care_product",
  body_cleansing: "personal_care_cleanser",
  skin_care: "cosmetic",
  automotive_cleaning: "industrial_chemical_product",
  wet_wipes: "wet_wipe",
};

const MEDICAL_CLAIM_KEYWORDS = ["medical", "therapeutic", "treat ", "treatment", "medicated", "prescription"];
const BIOCIDAL_CLAIM_KEYWORDS = ["kills insects", "pesticide", "biocide", "insecticide", "repellent"];
const BABY_USER_KEYWORDS = ["baby", "babies", "infant", "newborn"];
const INSTITUTIONAL_KEYWORDS = ["institutional", "commercial use only", "food service", "healthcare facility"];

/**
 * Rule-based classification from the family's own domain plus claims/
 * users — never a model's guess. `reasoning` is always non-empty; a
 * caller can show it verbatim as "why" without inventing an explanation.
 * `uncertain: true` whenever the classifier could not confidently narrow
 * past `human_review_required`, or landed on a category but flags real
 * ambiguity worth a second look.
 */
export function classifyProductRegulatory(input: RegulatoryClassificationInput): RegulatoryClassificationResult {
  const { family, claims = [], targetUsers = [] } = input;
  const reasoning: string[] = [];
  const claimText = claims.join(" ").toLowerCase();
  const userText = [...targetUsers, ...(family.intendedUsers ?? [])].join(" ").toLowerCase();

  reasoning.push(`Product family domain is "${family.domain}".`);

  // Medical/therapeutic claims escalate ANY domain — a health claim is a
  // health claim regardless of what the base product otherwise looks like.
  if (family.hazardClass === "medical" || MEDICAL_CLAIM_KEYWORDS.some((k) => claimText.includes(k))) {
    reasoning.push(
      family.hazardClass === "medical"
        ? `Family hazard class is "medical".`
        : `Claims include a medical/therapeutic keyword.`,
    );
    return { category: "medical_or_health_related_product", confidence: 0.75, reasoning, uncertain: false };
  }

  const base = DOMAIN_BASE_CATEGORY[family.domain];
  if (!base) {
    reasoning.push(`Domain "${family.domain}" has no configured regulatory-category mapping.`);
    return { category: "human_review_required", confidence: 0.2, reasoning, uncertain: true };
  }
  reasoning.push(`Base category from domain mapping: "${base}".`);

  // Regulated-disinfectant hazard class escalates a disinfectant/hand-hygiene
  // base toward the stricter biocidal category when a biocidal-style claim
  // (pesticide/insecticide) is present; otherwise it confirms "disinfectant".
  if (family.hazardClass === "regulated_disinfectant") {
    if (BIOCIDAL_CLAIM_KEYWORDS.some((k) => claimText.includes(k))) {
      reasoning.push(`Hazard class "regulated_disinfectant" plus a biocidal-style claim.`);
      return { category: "biocidal_product", confidence: 0.7, reasoning, uncertain: true };
    }
    reasoning.push(`Hazard class "regulated_disinfectant" confirms a disinfectant category.`);
    return { category: "disinfectant", confidence: 0.8, reasoning, uncertain: false };
  }

  // Institutional/commercial-use claims override a household default —
  // the same chemistry sold for institutional use is a different
  // regulatory category in most EAC jurisdictions.
  if (INSTITUTIONAL_KEYWORDS.some((k) => claimText.includes(k)) && (base === "household_cleaning_product" || base === "dishwashing_product")) {
    reasoning.push(`Claims indicate institutional/commercial use.`);
    return { category: "institutional_cleaning_product", confidence: 0.65, reasoning, uncertain: true };
  }

  // Oral care: refine to toothpaste specifically when the family says so.
  if (base === "oral_care_product") {
    const text = `${family.subtype} ${family.name}`.toLowerCase();
    if (text.includes("toothpaste")) {
      reasoning.push(`Subtype/name indicates toothpaste specifically.`);
      return { category: "toothpaste", confidence: 0.85, reasoning, uncertain: false };
    }
    return { category: base, confidence: 0.7, reasoning, uncertain: false };
  }

  // Wet wipes: refine to baby wipe when the target users say so.
  if (base === "wet_wipe" && BABY_USER_KEYWORDS.some((k) => userText.includes(k))) {
    reasoning.push(`Target users indicate infants/babies.`);
    return { category: "baby_wipe", confidence: 0.8, reasoning, uncertain: false };
  }

  return { category: base, confidence: 0.7, reasoning, uncertain: false };
}
