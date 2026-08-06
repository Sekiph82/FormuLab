/**
 * Seed structural test-definition templates (spec §5.1).
 *
 * These are starting STRUCTURES — a code, a category, a result type, which
 * fields a lab typically records — never a recognized method, a legal
 * limit, or a verified specification. Every one ships `not_verified`; a
 * chemist attaches the lab's real method reference and real limits.
 */
import type { TestDefinition } from "../schemas/testDefinitions";

const NOW = "2026-01-01T00:00:00.000Z";

function def(
  code: string,
  name: string,
  category: string,
  opts: Partial<TestDefinition> = {},
): TestDefinition {
  return {
    schemaVersion: "1.0",
    code,
    name,
    category,
    resultType: "numeric",
    replicatesRequired: 1,
    requiredEquipment: [],
    requiredAttachment: false,
    applicableProductFamilies: [],
    applicableProductSkus: [],
    applicablePackagingSkuCodes: [],
    applicableContexts: ["trial", "stability"],
    applicableConditionCodes: [],
    applicableTimePointCodes: [],
    requiredByDefault: false,
    testCapability: "general",
    criticalTestFlag: false,
    verificationStatus: "not_verified",
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...opts,
  };
}

export const SEED_TEST_DEFINITIONS: TestDefinition[] = [
  def("TEST-PH", "pH", "physical_chemical", { unit: "pH", passFailLogic: { rule: "within_range" }, replicatesRequired: 2 }),
  def("TEST-VISCOSITY", "Viscosity", "physical_chemical", { unit: "cP", requiredEquipment: ["viscometer"], passFailLogic: { rule: "within_range" }, replicatesRequired: 2 }),
  def("TEST-DENSITY", "Density", "physical_chemical", { unit: "g/mL", passFailLogic: { rule: "within_range" }, replicatesRequired: 2 }),
  def("TEST-APPEARANCE", "Appearance", "sensory", { resultType: "visual_rating", passFailLogic: { rule: "manual_judgment" } }),
  def("TEST-COLOR", "Color", "sensory", { resultType: "categorical", passFailLogic: { rule: "manual_judgment" } }),
  def("TEST-ODOR", "Odor", "sensory", { resultType: "categorical", passFailLogic: { rule: "manual_judgment" } }),
  def("TEST-HOMOGENEITY", "Homogeneity", "physical_chemical", { resultType: "pass_fail", passFailLogic: { rule: "manual_judgment" } }),
  def("TEST-FOAM-HEIGHT", "Foam height", "performance", { unit: "mm", passFailLogic: { rule: "at_least" }, requiredEquipment: ["foam cylinder"] }),
  def("TEST-FOAM-RETENTION", "Foam retention", "performance", { unit: "%", passFailLogic: { rule: "at_least" } }),
  def("TEST-WETTING", "Wetting time", "performance", { unit: "s", passFailLogic: { rule: "at_most" } }),
  def("TEST-CLEANING-PERFORMANCE", "Cleaning performance", "performance", { resultType: "numeric", unit: "%", passFailLogic: { rule: "at_least" }, requiredEquipment: ["soiled test panels"] }),
  def("TEST-SOIL-REMOVAL", "Soil removal", "performance", { unit: "%", passFailLogic: { rule: "at_least" } }),
  def("TEST-CENTRIFUGE", "Centrifuge stability", "stability", { resultType: "pass_fail", passFailLogic: { rule: "manual_judgment" }, requiredEquipment: ["centrifuge"] }),
  def("TEST-FREEZE-THAW", "Freeze-thaw stability", "stability", { resultType: "pass_fail", passFailLogic: { rule: "manual_judgment" } }),
  def("TEST-AVAILABLE-CHLORINE", "Available chlorine", "active_content", { unit: "%", passFailLogic: { rule: "within_range" }, criticalTestFlag: true, replicatesRequired: 2 }),
  def("TEST-PEROXIDE-ACTIVE", "Peroxide active", "active_content", { unit: "%", passFailLogic: { rule: "within_range" }, criticalTestFlag: true, replicatesRequired: 2 }),
  def("TEST-QAC-ACTIVE", "QAC active", "active_content", { unit: "%", passFailLogic: { rule: "within_range" }, criticalTestFlag: true, replicatesRequired: 2 }),
  def("TEST-CHLORHEXIDINE-ACTIVE", "Chlorhexidine active", "active_content", { unit: "%", passFailLogic: { rule: "within_range" }, criticalTestFlag: true, replicatesRequired: 2 }),
  def("TEST-FLUORIDE-ACTIVE", "Fluoride active", "active_content", { unit: "ppm", passFailLogic: { rule: "within_range" }, criticalTestFlag: true, replicatesRequired: 2 }),
  def("TEST-MICROBIOLOGY", "Microbiology (total viable count)", "microbiology", { unit: "CFU/g", passFailLogic: { rule: "at_most" }, criticalTestFlag: true, requiredEquipment: ["incubator"] }),
  def("TEST-PRESERVATIVE-CHALLENGE", "Preservative challenge", "microbiology", { resultType: "pass_fail", passFailLogic: { rule: "manual_judgment" }, criticalTestFlag: true, requiredEquipment: ["challenge organisms", "incubator"] }),
  def("TEST-PACKAGING-COMPATIBILITY", "Packaging compatibility", "packaging", { resultType: "pass_fail", passFailLogic: { rule: "manual_judgment" }, testCapability: "packaging_compatibility", applicableContexts: ["stability"] }),
  def("TEST-WIPE-LOTION-LOADING", "Wipe lotion loading", "wipes", { unit: "%", passFailLogic: { rule: "within_range" } }),
  def("TEST-WIPE-MOISTURE-DISTRIBUTION", "Wipe moisture distribution", "wipes", { resultType: "pass_fail", passFailLogic: { rule: "manual_judgment" } }),
  def("TEST-SEAL-INTEGRITY", "Seal integrity", "packaging", { resultType: "pass_fail", passFailLogic: { rule: "manual_judgment" }, criticalTestFlag: true, testCapability: "seal_integrity", applicableContexts: ["stability"] }),
  def("TEST-LEAK", "Leak test", "packaging", { resultType: "pass_fail", passFailLogic: { rule: "manual_judgment" }, criticalTestFlag: true, testCapability: "leak_test", applicableContexts: ["stability"] }),
  def("TEST-FLUSHABILITY", "Flushability observation", "wipes", { resultType: "text", passFailLogic: { rule: "manual_judgment" } }),
];
