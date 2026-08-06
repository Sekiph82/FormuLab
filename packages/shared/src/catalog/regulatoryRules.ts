/**
 * Seed structural regulatory-rule placeholders (spec §2.1).
 *
 * These are starting STRUCTURES only — a jurisdiction, an authority name,
 * a rule type, a category scope — never a verified legal requirement or a
 * real concentration limit. Every one ships `not_verified`/
 * `requires_regulatory_review`, `status: "draft"`, and a `requirement`
 * string that says so explicitly. A qualified regulatory reviewer must
 * confirm the actual requirement, its source, and its limits before any
 * of this is relied on for a real compliance decision — see
 * docs/REGULATORY_RULES.md.
 */
import type { RegulatoryRule, RegulatoryRuleType, RegulatoryProductCategory, RegulatoryJurisdiction } from "../schemas/regulatory";
import type { RuleCondition } from "../schemas/ruleConditions";

const NOW = "2026-01-01T00:00:00.000Z";

function def(
  code: string,
  jurisdiction: RegulatoryJurisdiction,
  authority: string,
  ruleType: RegulatoryRuleType,
  productCategories: RegulatoryProductCategory[],
  requirement: string,
  opts: Partial<RegulatoryRule> = {},
): RegulatoryRule {
  return {
    schemaVersion: "1.0",
    id: code,
    code,
    name: code,
    jurisdiction,
    authority: `${authority} — placeholder authority name, not verified`,
    ruleType,
    productCategories,
    requirement: `Placeholder — not verified. ${requirement} Confirm the exact requirement, authority, and source with a qualified regulatory reviewer before relying on this rule for any compliance decision.`,
    severity: "warning",
    status: "draft",
    conditions: [],
    claimKeywordsAny: [],
    requiredEvidenceTypes: [],
    requiredLabelElements: [],
    requiredWarnings: [],
    requiredDocumentTypes: [],
    requiredTestTypes: [],
    requiredPackagingElements: [],
    requiredLanguages: [],
    requiresRegistration: false,
    requiresNotification: false,
    requiresResponsiblePartyInMarket: false,
    requiresMarketSpecificIdentifier: false,
    version: 1,
    verificationStatus: "not_verified",
    humanReviewStatus: "review_required",
    active: true,
    createdBy: "local",
    createdAt: NOW,
    updatedAt: NOW,
    ...opts,
  };
}

const CHLORINE_ACTIVE_CONDITION: RuleCondition = { label: "Chlorine-releasing active", functionsAny: ["disinfectant_active"] };
const QAC_ACTIVE_CONDITION: RuleCondition = { label: "QAC active", functionsAny: ["qac_active"] };
const FLUORIDE_ACTIVE_CONDITION: RuleCondition = { label: "Fluoride active", functionsAny: ["fluoride_active"] };

export const SEED_REGULATORY_RULES: RegulatoryRule[] = [
  // ---- Kenya --------------------------------------------------------
  def(
    "KE-REG-001",
    "KE",
    "Kenya Bureau of Standards (KEBS)",
    "registration_requirement",
    ["disinfectant", "biocidal_product"],
    "Disinfectant/biocidal products sold in Kenya may require product registration before sale.",
  ),
  def(
    "KE-REG-002",
    "KE",
    "Pest Control Products Board (PCPB)",
    "concentration_limit",
    ["disinfectant"],
    "Chlorine-releasing actives in a disinfectant may be subject to a maximum available-chlorine concentration.",
    { conditions: [{ ...CHLORINE_ACTIVE_CONDITION, maxConcentrationPercent: "10" }], requiredTestTypes: ["available_chlorine_assay"] },
  ),
  def(
    "KE-REG-003",
    "KE",
    "Kenya Bureau of Standards (KEBS)",
    "label_requirement",
    [],
    "Consumer household/cleaning products may require specific label elements (net content, batch code, manufacturer, country of origin).",
    { requiredLabelElements: ["net_content", "batch_code", "manufacturer_name", "country_of_origin"] },
  ),
  def(
    "KE-REG-004",
    "KE",
    "Kenya Bureau of Standards (KEBS)",
    "claim_evidence_requirement",
    ["disinfectant", "biocidal_product", "personal_care_cleanser"],
    "Antimicrobial/antibacterial efficacy claims may require supporting laboratory evidence on file.",
    { claimKeywordsAny: ["antibacterial", "antimicrobial", "kills germs", "kills 99.9", "disinfects"], requiredEvidenceTypes: ["antimicrobial_efficacy_report"] },
  ),
  def(
    "KE-REG-005",
    "KE",
    "Pharmacy and Poisons Board",
    "ingredient_restriction",
    ["oral_care_product", "toothpaste"],
    "Fluoride actives in oral-care products may be subject to a maximum concentration and a required warning statement for children.",
    { conditions: [FLUORIDE_ACTIVE_CONDITION], requiredWarnings: ["do_not_swallow_children_under_6"] },
  ),

  // ---- Uganda ---------------------------------------------------------
  def(
    "UG-REG-001",
    "UG",
    "Uganda National Bureau of Standards (UNBS)",
    "registration_requirement",
    ["disinfectant", "biocidal_product", "medical_or_health_related_product"],
    "Disinfectant/biocidal/medical products may require UNBS product registration before sale.",
  ),
  def(
    "UG-REG-002",
    "UG",
    "Uganda National Bureau of Standards (UNBS)",
    "language_requirement",
    [],
    "Product labels may be required in English, and locally in additional languages depending on distribution channel.",
    { requiredLanguages: ["en"] },
  ),
  def(
    "UG-REG-003",
    "UG",
    "National Drug Authority (NDA)",
    "ingredient_prohibition",
    ["cosmetic", "personal_care_cleanser", "hair_care_product"],
    "Certain actives may be prohibited in cosmetic/personal-care products above a de-minimis trace level.",
    { conditions: [QAC_ACTIVE_CONDITION] },
  ),

  // ---- Tanzania -------------------------------------------------------
  def(
    "TZ-REG-001",
    "TZ",
    "Tanzania Bureau of Standards (TBS)",
    "registration_requirement",
    ["disinfectant", "biocidal_product"],
    "Disinfectant/biocidal products may require TBS registration and a certificate of conformity before sale.",
  ),
  def(
    "TZ-REG-002",
    "TZ",
    "Tanzania Food and Drugs Authority (TFDA/TMDA)",
    "responsible_party_requirement",
    ["cosmetic", "personal_care_cleanser", "hair_care_product", "medical_or_health_related_product"],
    "Cosmetic/personal-care/medical products may require a named in-market responsible party on the label.",
    { requiresResponsiblePartyInMarket: true },
  ),
  def(
    "TZ-REG-003",
    "TZ",
    "Tanzania Bureau of Standards (TBS)",
    "packaging_requirement",
    ["wet_wipe", "baby_wipe"],
    "Wet-wipe products may require flushability/disposal labelling on the primary package.",
    { requiredPackagingElements: ["disposal_instructions"] },
  ),

  // ---- Rwanda ---------------------------------------------------------
  def(
    "RW-REG-001",
    "RW",
    "Rwanda Standards Board (RSB)",
    "notification_requirement",
    ["household_cleaning_product", "laundry_detergent", "dishwashing_product"],
    "Household cleaning products may require a notification filing before first sale, distinct from full registration.",
    { requiresNotification: true },
  ),
  def(
    "RW-REG-002",
    "RW",
    "Rwanda FDA",
    "document_requirement",
    ["disinfectant", "biocidal_product", "medical_or_health_related_product"],
    "Disinfectant/biocidal/medical products may require a safety data sheet and product dossier on file.",
    { requiredDocumentTypes: ["safety_data_sheet", "product_dossier"] },
  ),

  // ---- Burundi ---------------------------------------------------------
  def(
    "BI-REG-001",
    "BI",
    "Bureau Burundais de Normalisation et Contrôle de la Qualité (BBN)",
    "registration_requirement",
    ["disinfectant", "biocidal_product"],
    "Disinfectant/biocidal products may require BBN registration before sale.",
  ),
  def(
    "BI-REG-002",
    "BI",
    "BBN",
    "language_requirement",
    [],
    "Product labels may be required in French and/or Kirundi depending on distribution channel.",
    { requiredLanguages: ["fr"] },
  ),

  // ---- South Sudan ------------------------------------------------------
  def(
    "SS-REG-001",
    "SS",
    "South Sudan National Bureau of Standards (SSNBS)",
    "registration_requirement",
    ["disinfectant", "biocidal_product", "medical_or_health_related_product"],
    "Disinfectant/biocidal/medical products may require SSNBS registration before sale.",
  ),

  // ---- EAC regional (overlays a member state's own rules — see
  //      EAC_MEMBER_STATES / docs/EAC_MARKET_PROFILES.md) ----------------
  def(
    "EAC-REG-001",
    "EAC",
    "East African Community Secretariat",
    "market_specific_identifier",
    [],
    "Products traded across EAC member states may require an EAC-wide conformity mark in addition to any national mark.",
    { requiresMarketSpecificIdentifier: true },
  ),
  def(
    "EAC-REG-002",
    "EAC",
    "East African Community Secretariat",
    "testing_requirement",
    ["disinfectant", "biocidal_product"],
    "Disinfectant/biocidal products traded regionally may require testing against an EAC-harmonized standard.",
    { requiredTestTypes: ["eac_harmonized_efficacy_test"] },
  ),
];
