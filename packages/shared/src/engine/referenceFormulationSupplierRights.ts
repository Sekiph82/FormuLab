import { z } from "zod";
import {
  referenceFormulationRightsSchema,
  type ReferenceFormulationRights,
} from "../schemas/referenceFormulationSource";

export const referenceFormulationSupplierRightsUseSchema = z.enum([
  "internalResearch", "sameSupplierPrior", "crossSupplierPrior", "sourceExport", "derivedExport",
]);
export type ReferenceFormulationSupplierRightsUse = z.infer<typeof referenceFormulationSupplierRightsUseSchema>;

export const referenceFormulationSupplierRightsDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum([
    "explicit_permission", "permission_unknown", "permission_prohibited", "restricted_source",
    "redistribution_not_allowed", "retention_unknown", "retention_expired", "delete_after_use",
  ]),
  use: referenceFormulationSupplierRightsUseSchema,
  evidenceRefs: z.array(z.string().trim().min(1)),
}).strict();
export type ReferenceFormulationSupplierRightsDecision = z.infer<typeof referenceFormulationSupplierRightsDecisionSchema>;

const priorCandidateSchema = z.object({
  sourceRecordId: z.string().trim().min(1),
  supplierId: z.string().trim().min(1),
  rights: referenceFormulationRightsSchema,
}).strict();
export type ReferenceFormulationPriorCandidate = z.infer<typeof priorCandidateSchema>;

export const referenceFormulationSupplierBiasProfileSchema = z.object({
  formulaCount: z.number().int().nonnegative(),
  supplierCount: z.number().int().nonnegative(),
  largestSupplierShare: z.number().finite().min(0).max(1),
  hhi: z.number().finite().min(0).max(1),
  effectiveSupplierCount: z.number().finite().nonnegative(),
  suppliers: z.array(z.object({
    supplierId: z.string().trim().min(1),
    formulaCount: z.number().int().positive(),
    share: z.number().finite().min(0).max(1),
  }).strict()),
}).strict().superRefine((profile, context) => {
  const total = profile.suppliers.reduce((sum, supplier) => sum + supplier.formulaCount, 0);
  const hhi = profile.suppliers.reduce((sum, supplier) => sum + supplier.share ** 2, 0);
  const largest = profile.suppliers.reduce((max, supplier) => Math.max(max, supplier.share), 0);
  if (total !== profile.formulaCount || profile.supplierCount !== profile.suppliers.length
    || (profile.formulaCount === 0 && (profile.largestSupplierShare !== 0 || profile.hhi !== 0 || profile.effectiveSupplierCount !== 0))
    || (profile.formulaCount > 0 && (profile.suppliers.some((supplier) => supplier.share !== supplier.formulaCount / profile.formulaCount)
      || profile.largestSupplierShare !== largest || profile.hhi !== hhi
      || profile.effectiveSupplierCount !== (hhi === 0 ? 0 : 1 / hhi)))) {
    context.addIssue({ code: "custom", path: ["suppliers"], message: "Supplier concentration values must match the unique formula counts." });
  }
});
export type ReferenceFormulationSupplierBiasProfile = z.infer<typeof referenceFormulationSupplierBiasProfileSchema>;

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const permissionForUse: Record<ReferenceFormulationSupplierRightsUse, keyof NonNullable<ReferenceFormulationRights["usePermissions"]>> = {
  internalResearch: "internalResearch",
  sameSupplierPrior: "sameSupplierPrior",
  crossSupplierPrior: "crossSupplierPrior",
  sourceExport: "sourceExport",
  derivedExport: "derivedExport",
};

/** Evaluate permission for persistent corpus use. Missing rights/retention metadata always fails closed. */
export function evaluateReferenceFormulationSourceUse(input: {
  rights: ReferenceFormulationRights;
  use: ReferenceFormulationSupplierRightsUse;
  asOf: string;
}): ReferenceFormulationSupplierRightsDecision {
  const rights = referenceFormulationRightsSchema.parse(input.rights);
  const asOf = z.string().datetime({ offset: true }).parse(input.asOf);
  const decision = rights.usePermissions?.[permissionForUse[input.use]];
  const retention = rights.retentionPolicy;
  let allowed = false;
  let reason: ReferenceFormulationSupplierRightsDecision["reason"];
  if (rights.status === "restricted") reason = "restricted_source";
  else if (!retention || retention.status === "unknown") reason = "retention_unknown";
  else if (retention.status === "delete_after_use") reason = "delete_after_use";
  else if (retention.status === "retain_until_date" && Date.parse(asOf) >= Date.parse(retention.expiresAt!)) reason = "retention_expired";
  else if (!decision || decision.status === "unknown") reason = "permission_unknown";
  else if (decision.status === "prohibited") reason = "permission_prohibited";
  else if (input.use === "sourceExport" && rights.redistribution !== "allowed") reason = "redistribution_not_allowed";
  else {
    allowed = true;
    reason = "explicit_permission";
  }
  return referenceFormulationSupplierRightsDecisionSchema.parse({
    allowed, reason, use: input.use, evidenceRefs: [...new Set([...(decision?.evidenceRefs ?? []), ...(retention?.evidenceRefs ?? [])])].sort(),
  });
}

/** Report measured concentration without choosing a policy threshold or discarding supplier evidence. */
export function calculateReferenceFormulationSupplierBiasProfile(
  input: Array<{ sourceRecordId: string; supplierId: string }>,
): ReferenceFormulationSupplierBiasProfile {
  const rows = input.map((row) => ({ sourceRecordId: z.string().trim().min(1).parse(row.sourceRecordId), supplierId: z.string().trim().min(1).parse(row.supplierId) }));
  if (new Set(rows.map((row) => row.sourceRecordId)).size !== rows.length) throw new Error("Supplier-bias input cannot contain duplicate source formula IDs.");
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.supplierId, (counts.get(row.supplierId) ?? 0) + 1);
  const formulaCount = rows.length;
  const suppliers = [...counts.entries()].map(([supplierId, count]) => ({
    supplierId, formulaCount: count, share: formulaCount === 0 ? 0 : count / formulaCount,
  })).sort((left, right) => right.formulaCount - left.formulaCount || compareStable(left.supplierId, right.supplierId));
  const hhi = suppliers.reduce((sum, supplier) => sum + supplier.share ** 2, 0);
  return referenceFormulationSupplierBiasProfileSchema.parse({
    formulaCount, supplierCount: suppliers.length,
    largestSupplierShare: suppliers[0]?.share ?? 0,
    hhi,
    effectiveSupplierCount: hhi === 0 ? 0 : 1 / hhi,
    suppliers,
  });
}

/** Filter by explicit source rights, then give each eligible supplier equal total weight for a prior. */
export function buildSupplierBalancedReferenceFormulationPrior(input: {
  candidates: ReferenceFormulationPriorCandidate[];
  targetSupplierId: string;
  asOf: string;
}): {
  weights: Array<{ sourceRecordId: string; supplierId: string; weight: number }>;
  decisions: Array<{ sourceRecordId: string; allowed: boolean; reason: ReferenceFormulationSupplierRightsDecision["reason"] }>;
} {
  const targetSupplierId = z.string().trim().min(1).parse(input.targetSupplierId);
  const asOf = z.string().datetime({ offset: true }).parse(input.asOf);
  const candidates = input.candidates.map((candidate) => priorCandidateSchema.parse(candidate))
    .sort((left, right) => compareStable(left.sourceRecordId, right.sourceRecordId));
  if (new Set(candidates.map((candidate) => candidate.sourceRecordId)).size !== candidates.length) {
    throw new Error("Supplier-balanced prior input cannot contain duplicate source formula IDs.");
  }
  const evaluated = candidates.map((candidate) => {
    const sameSupplier = candidate.supplierId === targetSupplierId;
    const decision = evaluateReferenceFormulationSourceUse({ rights: candidate.rights, use: sameSupplier ? "sameSupplierPrior" : "crossSupplierPrior", asOf });
    return { candidate, decision };
  });
  const eligible = evaluated.filter(({ decision }) => decision.allowed);
  const supplierCounts = new Map<string, number>();
  for (const { candidate } of eligible) supplierCounts.set(candidate.supplierId, (supplierCounts.get(candidate.supplierId) ?? 0) + 1);
  const eligibleSupplierCount = supplierCounts.size;
  const weights = eligible.map(({ candidate }) => ({
    sourceRecordId: candidate.sourceRecordId,
    supplierId: candidate.supplierId,
    weight: 1 / eligibleSupplierCount / supplierCounts.get(candidate.supplierId)!,
  }));
  return {
    weights,
    decisions: evaluated.map(({ candidate, decision }) => ({ sourceRecordId: candidate.sourceRecordId, allowed: decision.allowed, reason: decision.reason })),
  };
}
