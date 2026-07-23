/**
 * Enforcing `TestDefinition` applicability — spec §5. The fields
 * (`applicableProductFamilies`, `applicablePackagingSkuCodes`,
 * `applicableContexts`, `applicableConditionCodes`,
 * `applicableTimePointCodes`) already existed or were added to the schema;
 * this module is what actually reads them rather than leaving them
 * decorative. An empty array on any of them means unrestricted, same
 * convention the fields have always used.
 */
import type { TestApplicableContext, TestDefinition, TestRequirementSnapshot } from "../schemas/testDefinitions";

export interface TestApplicabilityContext {
  productFamilyId: string;
  context: TestApplicableContext;
  packagingSkuCodes?: string[];
  conditionCodes?: string[];
  timePointCodes?: string[];
}

function matchesAny(allowed: string[], candidates: string[] | undefined): boolean {
  if (allowed.length === 0) return true;
  if (!candidates || candidates.length === 0) return false;
  return candidates.some((c) => allowed.includes(c));
}

/** Is `definition` applicable to this trial/study context? Checked, not just
 *  stored: a test that fails any applicable dimension cannot be selected as
 *  a requirement for this context. */
export function isTestDefinitionApplicable(definition: TestDefinition, ctx: TestApplicabilityContext): boolean {
  if (!definition.active) return false;
  if (!(definition.applicableContexts ?? ["trial", "stability"]).includes(ctx.context)) return false;
  if (definition.applicableProductFamilies.length && !definition.applicableProductFamilies.includes(ctx.productFamilyId)) return false;
  if (!matchesAny(definition.applicablePackagingSkuCodes ?? [], ctx.packagingSkuCodes)) return false;
  if (ctx.context === "stability") {
    if (!matchesAny(definition.applicableConditionCodes ?? [], ctx.conditionCodes)) return false;
    if (!matchesAny(definition.applicableTimePointCodes ?? [], ctx.timePointCodes)) return false;
  }
  return true;
}

export interface ResolvedTestRequirement {
  definition: TestDefinition;
  required: boolean;
  reason: string;
}

/** Every definition applicable to `ctx`, each labelled with why it was
 *  selected and whether it is mandatory (`requiredByDefault`) or merely
 *  available. Does not include manually added tests — those are recorded
 *  separately (spec: "allow authorized human additions") since they were
 *  not resolved BY applicability. */
export function resolveApplicableTestDefinitions(
  definitions: TestDefinition[],
  ctx: TestApplicabilityContext,
): ResolvedTestRequirement[] {
  return definitions
    .filter((d) => isTestDefinitionApplicable(d, ctx))
    .map((definition) => ({
      definition,
      required: definition.requiredByDefault ?? false,
      reason: `Applicable to product family "${ctx.productFamilyId}"${
        definition.applicableProductFamilies.length ? "" : " (unrestricted test)"
      }, context "${ctx.context}".`,
    }));
}

/** Deterministic reasons a definition failed applicability — spec §1.6.
 *  `manually_excluded`/`superseded_definition` are not included: this
 *  codebase does not model an explicit human exclusion action or a
 *  definition-supersession link, so neither reason is ever computable
 *  here; see docs/TEST_APPLICABILITY.md's known limitations. */
export const EXCLUSION_REASONS = [
  "inactive_definition",
  "wrong_product_family",
  "wrong_packaging_sku",
  "wrong_context",
  "wrong_storage_condition",
  "wrong_time_point",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/** Every reason `definition` fails `ctx` — plural, because more than one
 *  dimension can disqualify a test at once, and hiding the others behind
 *  the first match would make "why isn't this test showing up" harder to
 *  answer than it needs to be. */
export function explainExclusion(definition: TestDefinition, ctx: TestApplicabilityContext): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  if (!definition.active) reasons.push("inactive_definition");
  if (!(definition.applicableContexts ?? ["trial", "stability"]).includes(ctx.context)) reasons.push("wrong_context");
  if (definition.applicableProductFamilies.length && !definition.applicableProductFamilies.includes(ctx.productFamilyId)) {
    reasons.push("wrong_product_family");
  }
  if (!matchesAny(definition.applicablePackagingSkuCodes ?? [], ctx.packagingSkuCodes)) reasons.push("wrong_packaging_sku");
  if (ctx.context === "stability") {
    if (!matchesAny(definition.applicableConditionCodes ?? [], ctx.conditionCodes)) reasons.push("wrong_storage_condition");
    if (!matchesAny(definition.applicableTimePointCodes ?? [], ctx.timePointCodes)) reasons.push("wrong_time_point");
  }
  return reasons;
}

export interface ExcludedTestDefinition {
  definition: TestDefinition;
  reasons: ExclusionReason[];
}

/** The full applicability picture for a context — both what was included
 *  and, for the exclusion explorer, everything that was NOT and exactly
 *  why. An excluded definition never satisfies a mandatory requirement:
 *  it simply never appears in `included`, so nothing downstream (readiness
 *  derivation, the requirement snapshot) can select it by accident. */
export function evaluateApplicability(
  definitions: TestDefinition[],
  ctx: TestApplicabilityContext,
): { included: ResolvedTestRequirement[]; excluded: ExcludedTestDefinition[] } {
  const included = resolveApplicableTestDefinitions(definitions, ctx);
  const includedIds = new Set(included.map((r) => r.definition.code));
  const excluded = definitions
    .filter((d) => !includedIds.has(d.code))
    .map((definition) => ({ definition, reasons: explainExclusion(definition, ctx) }));
  return { included, excluded };
}

/**
 * Build the immutable snapshot recorded once, at trial/study creation. A
 * later edit to any `TestDefinition` referenced here — its applicability,
 * its critical flag, even its deletion — cannot retroactively change what
 * this trial/study's protocol already required; only this snapshot's
 * `entries` govern that from creation onward.
 */
export function buildTestRequirementSnapshot(
  definitions: TestDefinition[],
  ctx: TestApplicabilityContext,
  manualAdditions: { definition: TestDefinition; addedBy: string; reason?: string; at?: string }[] = [],
): TestRequirementSnapshot {
  const resolved = resolveApplicableTestDefinitions(definitions, ctx);
  const resolvedIds = new Set(resolved.map((r) => r.definition.code));

  const entries = [
    ...resolved.map((r) => ({
      testDefinitionId: r.definition.code,
      testDefinitionCode: r.definition.code,
      name: r.definition.name,
      testCapability: r.definition.testCapability ?? "general",
      criticalTestFlag: r.definition.criticalTestFlag,
      required: r.required,
      reason: r.reason,
    })),
    ...manualAdditions
      .filter((m) => !resolvedIds.has(m.definition.code))
      .map((m) => ({
        testDefinitionId: m.definition.code,
        testDefinitionCode: m.definition.code,
        name: m.definition.name,
        testCapability: m.definition.testCapability ?? "general",
        criticalTestFlag: m.definition.criticalTestFlag,
        required: true,
        reason: m.reason
          ? `Added manually by ${m.addedBy} on ${m.at ?? new Date().toISOString()}: ${m.reason}`
          : `Added manually by ${m.addedBy} — not selected by applicability resolution.`,
        addedManuallyBy: m.addedBy,
      })),
  ];

  return { capturedAt: new Date().toISOString(), entries };
}
