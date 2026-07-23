/**
 * Deterministic chemical compatibility rules and findings.
 *
 * The point of this module: an LLM may explain a compatibility finding in
 * plain language, but it is never the thing that decides whether one exists.
 * A finding exists because a rule — versioned, with a verification status and
 * a stated (possibly absent) source — matched the formula. Two people running
 * the same formula through the same rule set get the same findings, and a
 * rule that nobody has verified says so rather than looking authoritative.
 */
import { z } from "zod";
import { MATERIAL_FUNCTIONS } from "./primitives";
import { IONIC_CHARACTERS } from "./materials";
import { PRODUCT_DOMAINS } from "./product";
import { ruleConditionSchema, type RuleCondition } from "./ruleConditions";

export { ruleConditionSchema as compatibilityConditionSchema };
export type CompatibilityCondition = RuleCondition;

export const RULE_SEVERITIES = ["info", "warning", "error", "blocking"] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

export const RULE_STATUSES = ["draft", "verified", "deprecated"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/**
 * Whether a rule's factual claim has been checked against a real source.
 * `human_review_required` is distinct from `not_verified`: it is a flag that
 * someone with the right background should look at this specific rule, not
 * just the general absence of a citation.
 */
export const RULE_VERIFICATION_STATUSES = ["verified", "not_verified", "human_review_required"] as const;
export type RuleVerificationStatus = (typeof RULE_VERIFICATION_STATUSES)[number];

export const COMPATIBILITY_RULE_TYPES = [
  "forbidden_combination",
  "warning_combination",
  "required_coingredient",
  "ph_dependent",
  "temperature_dependent",
  "concentration_dependent",
  "order_of_addition",
  "packaging_incompatibility",
  "storage_incompatibility",
] as const;
export type CompatibilityRuleType = (typeof COMPATIBILITY_RULE_TYPES)[number];

export const compatibilityRuleSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  /** The rule's own content version — bump when its conditions or message
   *  change, so a stored finding can note which rule text produced it. */
  version: z.string().default("1.0"),
  name: z.string().min(1),
  status: z.enum(RULE_STATUSES).default("draft"),
  severity: z.enum(RULE_SEVERITIES),

  productDomains: z.array(z.enum(PRODUCT_DOMAINS)).optional(),
  materialIds: z.array(z.string()).optional(),
  casNumbers: z.array(z.string()).optional(),
  functionGroups: z.array(z.enum(MATERIAL_FUNCTIONS)).optional(),
  ionicCharacters: z.array(z.enum(IONIC_CHARACTERS)).optional(),

  ruleType: z.enum(COMPATIBILITY_RULE_TYPES),
  /** Two conditions for a combination rule (A, B); one for a concentration-,
   *  temperature- or pH-dependent rule; two for order-of-addition (do-first,
   *  do-second). `required_coingredient` reads condition[0] as "material
   *  present" and condition[1] as "co-ingredient that must also be present". */
  conditions: z.array(ruleConditionSchema).min(1),

  message: z.string().min(1),
  /** Plain-language mechanism, in the rule author's own words. Not a citation. */
  scientificReason: z.string().optional(),
  recommendedAction: z.string().optional(),
  /** Empty is honest for a rule built from general formulation-chemistry
   *  knowledge rather than a specific paper or standard. */
  sourceReferences: z.array(z.string()).default([]),
  verificationStatus: z.enum(RULE_VERIFICATION_STATUSES).default("not_verified"),

  active: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CompatibilityRule = z.infer<typeof compatibilityRuleSchema>;

export const compatibilityFindingSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  ruleVersion: z.string(),
  severity: z.enum(RULE_SEVERITIES),
  materialIds: z.array(z.string()).default([]),
  lineIds: z.array(z.string()).default([]),
  message: z.string().min(1),
  scientificReason: z.string().optional(),
  recommendedAction: z.string().optional(),
  verificationStatus: z.enum(RULE_VERIFICATION_STATUSES),
  /** Which of the rule's conditions matched, by index — lets the UI point
   *  back at the exact clause responsible without re-running the evaluator. */
  triggeredConditions: z.array(z.number().int().nonnegative()).default([]),
  /** True when the rule needed data the formula does not have (e.g. no pH
   *  target on a `ph_dependent` rule) — this is a distinct, honest outcome
   *  from "checked and found no issue", never silently downgraded to safe. */
  dataIncomplete: z.boolean().default(false),
});
export type CompatibilityFinding = z.infer<typeof compatibilityFindingSchema>;

/**
 * An immutable record of one evaluation run, snapshotted the same way a cost
 * calculation is: a formula edit re-runs the engine and produces a new
 * snapshot, but a version's original snapshot never changes underneath it.
 */
export const compatibilitySnapshotSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  formulationId: z.string().min(1),
  versionId: z.string().min(1),
  calculatedAt: z.string(),
  /** Rule ids + their `version` at evaluation time, so a later rule edit
   *  cannot retroactively change what a past snapshot says it found. */
  ruleVersionsUsed: z.array(z.object({ ruleId: z.string(), version: z.string() })).default([]),
  findings: z.array(compatibilityFindingSchema).default([]),
});
export type CompatibilitySnapshot = z.infer<typeof compatibilitySnapshotSchema>;
