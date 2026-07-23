/**
 * The regulatory rule evaluator (spec §2.3/§2.4) and the rule's own
 * edit/revision lifecycle (spec §2.6's "rule version history") — mirrors
 * `engine/safety.ts`'s evaluator structure and `engine/approvalPolicy.ts`'s
 * append-only-revision pattern respectively, rather than inventing either
 * from scratch.
 */
import { resolvedPercent } from "./formula";
import { matchLines } from "./ruleConditions";
import { newId } from "./versioning";
import type { FormulationLine } from "../schemas/formulation";
import type { RawMaterial } from "../schemas/materials";
import {
  EAC_MEMBER_STATES,
  NON_BLOCKING_FINDING_STATUSES,
  type RegulatoryFinding,
  type RegulatoryFindingStatus,
  type RegulatoryJurisdiction,
  type RegulatoryProductCategory,
  type RegulatoryRule,
  type RegulatoryRuleChangeType,
  type RegulatoryRuleRevision,
} from "../schemas/regulatory";
import { dec } from "./decimal";
import type { Actor } from "../schemas/status";
import { requireAuthorizedRegulatoryActor } from "./regulatoryAuthorization";

export interface RegulatoryEvaluationContext {
  jurisdiction: RegulatoryJurisdiction;
  category: RegulatoryProductCategory;
  materials: RawMaterial[];
  claims?: string[];
  /** Evidence types the caller confirms are already on file — feeds
   *  `claim_evidence_requirement` rules. Absent/empty means none on file. */
  providedEvidenceTypes?: string[];
  /** Rule ids a named human has explicitly confirmed satisfied — the
   *  product-level requirement types (label/warning/document/testing/
   *  packaging/language/responsible-party/registration/notification/
   *  market-identifier) have no automatic way to confirm compliance
   *  without a real dossier/evidence system (Phase 3), so they default to
   *  `missing_data` unless the caller names them here. See
   *  docs/REGULATORY_ENGINE.md's known limitations. */
  manuallyConfirmedRuleIds?: string[];
  /** ISO date; defaults to "now" — governs `effectiveDate`/`expiryDate`
   *  windowing. */
  asOf?: string;
}

function ruleApplies(rule: RegulatoryRule, ctx: RegulatoryEvaluationContext): boolean {
  if (!rule.active || rule.status === "deprecated") return false;
  const sameJurisdiction = rule.jurisdiction === ctx.jurisdiction;
  const eacOverlay = rule.jurisdiction === "EAC" && EAC_MEMBER_STATES.includes(ctx.jurisdiction);
  if (!sameJurisdiction && !eacOverlay) return false;
  if (rule.productCategories.length && !rule.productCategories.includes(ctx.category)) return false;
  const asOf = ctx.asOf ?? new Date().toISOString();
  if (rule.effectiveDate && asOf < rule.effectiveDate) return false;
  if (rule.expiryDate && asOf > rule.expiryDate) return false;
  return true;
}

function finding(
  rule: RegulatoryRule,
  status: RegulatoryFindingStatus,
  reason: string,
  extra: Partial<Pick<RegulatoryFinding, "affectedMaterialCodes" | "affectedLineIds" | "affectedClaim" | "evidenceRequired">> = {},
): RegulatoryFinding {
  return {
    id: `regulatory-finding:${rule.id}:${status}:${[...(extra.affectedMaterialCodes ?? []), extra.affectedClaim ?? ""].join("+")}`,
    ruleId: rule.id,
    ruleCode: rule.code,
    ruleVersion: rule.version,
    jurisdiction: rule.jurisdiction,
    status,
    severity: rule.severity,
    affectedMaterialCodes: extra.affectedMaterialCodes ?? [],
    affectedLineIds: extra.affectedLineIds ?? [],
    affectedClaim: extra.affectedClaim,
    reason,
    requiredAction: rule.requirement,
    evidenceRequired: extra.evidenceRequired ?? rule.requiredEvidenceTypes,
    source: rule.sourceReference,
    verificationStatus: rule.verificationStatus,
  };
}

/**
 * Evaluate every applicable rule against a formula + its claims. Never
 * returns `compliant_with_rule` for something it could not actually check
 * — a requirement-type rule with no dossier evidence yet returns
 * `missing_data`, and `unknown` (reserved for genuinely indeterminate
 * cases) is never collapsed into `compliant_with_rule`.
 */
export function evaluateRegulatory(lines: FormulationLine[], rules: RegulatoryRule[], ctx: RegulatoryEvaluationContext): RegulatoryFinding[] {
  const byCode = new Map(ctx.materials.map((m) => [m.code, m]));
  const claims = ctx.claims ?? [];
  const claimTextByIndex = claims.map((c) => c.toLowerCase());
  const findings: RegulatoryFinding[] = [];

  for (const rule of rules) {
    if (!ruleApplies(rule, ctx)) continue;

    switch (rule.ruleType) {
      case "ingredient_prohibition": {
        for (const cond of rule.conditions) {
          const matches = matchLines(cond, lines, byCode);
          if (matches.length > 0) {
            findings.push(
              finding(rule, "non_compliant", `Prohibited ingredient present: ${rule.requirement}`, {
                affectedMaterialCodes: matches.map((l) => l.materialCode ?? l.id),
                affectedLineIds: matches.map((l) => l.id),
              }),
            );
          }
        }
        break;
      }

      case "ingredient_restriction": {
        for (const cond of rule.conditions) {
          const matches = matchLines(cond, lines, byCode);
          if (matches.length > 0) {
            findings.push(
              finding(rule, "human_review_required", `Restricted ingredient present — conditions must be confirmed: ${rule.requirement}`, {
                affectedMaterialCodes: matches.map((l) => l.materialCode ?? l.id),
                affectedLineIds: matches.map((l) => l.id),
              }),
            );
          }
        }
        break;
      }

      case "concentration_limit": {
        for (const cond of rule.conditions) {
          const min = cond.minConcentrationPercent ? dec(cond.minConcentrationPercent) : undefined;
          const max = cond.maxConcentrationPercent ? dec(cond.maxConcentrationPercent) : undefined;
          for (const line of matchLines(cond, lines, byCode)) {
            const pct = resolvedPercent(line, lines);
            const outOfRange = (min && pct.lessThan(min)) || (max && pct.greaterThan(max));
            findings.push(
              finding(rule, outOfRange ? "non_compliant" : "compliant_with_rule", rule.requirement, {
                affectedMaterialCodes: [line.materialCode ?? line.id],
                affectedLineIds: [line.id],
              }),
            );
          }
        }
        break;
      }

      case "claim_restriction": {
        const matchedClaims = claims.filter((_, i) => rule.claimKeywordsAny.some((k) => claimTextByIndex[i].includes(k.toLowerCase())));
        for (const claim of matchedClaims) {
          findings.push(finding(rule, "non_compliant", `Restricted claim: "${claim}" — ${rule.requirement}`, { affectedClaim: claim }));
        }
        break;
      }

      case "claim_evidence_requirement": {
        const matchedClaims = claims.filter((_, i) => rule.claimKeywordsAny.some((k) => claimTextByIndex[i].includes(k.toLowerCase())));
        const provided = ctx.providedEvidenceTypes ?? [];
        for (const claim of matchedClaims) {
          const missing = rule.requiredEvidenceTypes.filter((e) => !provided.includes(e));
          findings.push(
            finding(rule, missing.length === 0 ? "compliant_with_rule" : "missing_data", rule.requirement, {
              affectedClaim: claim,
              evidenceRequired: missing,
            }),
          );
        }
        break;
      }

      // Every other rule type is a product-level requirement (label,
      // warning, document, testing, packaging, language, responsible
      // party, registration, notification, market identifier) — it
      // applies (category matched, above) but there is no automatic way
      // to confirm it was actually satisfied without a real evidence
      // system (Phase 3), so it defaults to `missing_data` unless a human
      // explicitly confirmed this exact rule.
      default: {
        const confirmed = (ctx.manuallyConfirmedRuleIds ?? []).includes(rule.id);
        findings.push(finding(rule, confirmed ? "compliant_with_rule" : "missing_data", rule.requirement));
      }
    }
  }

  return findings;
}

export function summarizeRegulatoryFindings(findings: RegulatoryFinding[]) {
  return {
    compliant: findings.filter((f) => f.status === "compliant_with_rule").length,
    nonCompliant: findings.filter((f) => f.status === "non_compliant").length,
    missingData: findings.filter((f) => f.status === "missing_data").length,
    humanReviewRequired: findings.filter((f) => f.status === "human_review_required").length,
    notApplicable: findings.filter((f) => f.status === "not_applicable").length,
    unknown: findings.filter((f) => f.status === "unknown").length,
    blocking: findings.filter((f) => !NON_BLOCKING_FINDING_STATUSES.includes(f.status)).length,
  };
}

// ---------------------------------------------------------------------------
// Rule lifecycle — mirrors engine/approvalPolicy.ts exactly.
// ---------------------------------------------------------------------------

export interface RuleChangeResult {
  rule: RegulatoryRule;
  revision: RegulatoryRuleRevision;
}

function buildRevision(rule: RegulatoryRule, changeType: RegulatoryRuleChangeType, changeReason: string, changedBy: string, changedAt: string): RegulatoryRuleRevision {
  return {
    schemaVersion: "1.0",
    id: newId("regrulerev"),
    ruleId: rule.id,
    version: rule.version,
    snapshot: rule,
    changeType,
    changeReason,
    changedBy,
    changedAt,
  };
}

export function initialRuleRevision(rule: RegulatoryRule, actor: Actor): RegulatoryRuleRevision {
  if (actor.kind !== "human") throw new Error("Only a human may create a regulatory rule.");
  return buildRevision({ ...rule, version: 1 }, "created", "Created.", actor.userId, rule.createdAt);
}

export function editRule(
  current: RegulatoryRule,
  updates: Partial<Omit<RegulatoryRule, "id" | "schemaVersion" | "createdBy" | "createdAt" | "version">>,
  actor: Actor,
  changeReason: string,
): RuleChangeResult {
  if (actor.kind !== "human") throw new Error("Only a human may edit a regulatory rule.");
  const reason = changeReason.trim();
  if (!reason) throw new Error("A reason is required to edit a regulatory rule.");
  const now = new Date().toISOString();
  const rule: RegulatoryRule = { ...current, ...updates, version: current.version + 1, updatedBy: actor.userId, updatedAt: now };
  return { rule, revision: buildRevision(rule, "edited", reason, actor.userId, now) };
}

export function setRuleActive(current: RegulatoryRule, active: boolean, actor: Actor): RuleChangeResult {
  if (actor.kind !== "human") throw new Error("Only a human may activate or deactivate a regulatory rule.");
  const now = new Date().toISOString();
  const rule: RegulatoryRule = { ...current, active, version: current.version + 1, updatedBy: actor.userId, updatedAt: now };
  return { rule, revision: buildRevision(rule, active ? "activated" : "deactivated", active ? "Activated." : "Deactivated.", actor.userId, now) };
}

export function deprecateRule(current: RegulatoryRule, actor: Actor, reason: string): RuleChangeResult {
  if (actor.kind !== "human") throw new Error("Only a human may deprecate a regulatory rule.");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to deprecate a regulatory rule.");
  const now = new Date().toISOString();
  const rule: RegulatoryRule = { ...current, status: "deprecated", active: false, version: current.version + 1, updatedBy: actor.userId, updatedAt: now };
  return { rule, revision: buildRevision(rule, "deprecated", trimmed, actor.userId, now) };
}

/**
 * Marks a rule `verified` — spec §3.7. Only an authorized human
 * regulatory/quality/administrator role may do this; an AI, system or
 * import actor can never verify a rule (an import forces
 * `imported_unverified` and stops there — see
 * `catalog/regulatoryRules.ts`/the desktop import path). Refuses unless
 * both `sourceAuthority` and `sourceReference` are already present on the
 * rule — a "verified" rule with no stated source would be exactly the
 * invented-legislation risk this whole engine exists to avoid.
 */
export function verifyRule(current: RegulatoryRule, actor: Actor, notes?: string): RuleChangeResult {
  requireAuthorizedRegulatoryActor(actor, "verify a regulatory rule");
  if (!current.sourceAuthority?.trim() || !current.sourceReference?.trim()) {
    throw new Error("A rule must have both a source authority and a source reference before it can be marked verified.");
  }
  const now = new Date().toISOString();
  const rule: RegulatoryRule = {
    ...current,
    verificationStatus: "verified",
    verifiedBy: actor.userId,
    verifiedByRole: actor.role,
    verifiedAt: now,
    verificationNotes: notes,
    version: current.version + 1,
    updatedBy: actor.userId,
    updatedAt: now,
  };
  return { rule, revision: buildRevision(rule, "verified", notes?.trim() || "Verified.", actor.userId, now) };
}

/** A reviewer looked and declined to verify — distinct from
 *  `not_verified` (nobody has looked yet). Requires a reason. */
export function rejectRuleVerification(current: RegulatoryRule, actor: Actor, reason: string): RuleChangeResult {
  requireAuthorizedRegulatoryActor(actor, "reject a regulatory rule's verification");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to reject a regulatory rule's verification.");
  const now = new Date().toISOString();
  const rule: RegulatoryRule = {
    ...current,
    verificationStatus: "rejected",
    verifiedBy: actor.userId,
    verifiedByRole: actor.role,
    verifiedAt: now,
    verificationNotes: trimmed,
    version: current.version + 1,
    updatedBy: actor.userId,
    updatedAt: now,
  };
  return { rule, revision: buildRevision(rule, "verification_rejected", trimmed, actor.userId, now) };
}

/** A previously verified rule that no longer reflects current
 *  law/standard (replaced by a newer rule, or the underlying regulation
 *  changed) — distinct from `expired` (its own effective window lapsed,
 *  handled by `expiryDate`/`ruleApplies` already). Neither `expired` nor
 *  `superseded` satisfies a "current verified rules" policy gate. */
export function supersedeRule(current: RegulatoryRule, actor: Actor, reason: string): RuleChangeResult {
  requireAuthorizedRegulatoryActor(actor, "mark a regulatory rule superseded");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to mark a regulatory rule superseded.");
  const now = new Date().toISOString();
  const rule: RegulatoryRule = {
    ...current,
    verificationStatus: "superseded",
    active: false,
    version: current.version + 1,
    updatedBy: actor.userId,
    updatedAt: now,
  };
  return { rule, revision: buildRevision(rule, "superseded", trimmed, actor.userId, now) };
}
