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
  manualAdditions: { definition: TestDefinition; addedBy: string }[] = [],
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
        reason: `Added manually by ${m.addedBy} — not selected by applicability resolution.`,
        addedManuallyBy: m.addedBy,
      })),
  ];

  return { capturedAt: new Date().toISOString(), entries };
}
