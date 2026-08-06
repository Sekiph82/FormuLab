/**
 * The safety evaluator: deterministic hazard checking and product
 * classification, no model in the loop — mirrors `engine/compatibility.ts`
 * in structure and in the reason it exists: prompt instructions are not a
 * safety control, a rule with a stated verification status is.
 */
import Decimal from "decimal.js";
import { resolvedPercent } from "./formula";
import { matchLines, packagingMatches } from "./ruleConditions";
import type { FormulationLine } from "../schemas/formulation";
import type { RawMaterial } from "../schemas/materials";
import type { ProductFamily } from "../schemas/product";
import type { ProductSafetyClassification, SafetyFinding, SafetyRule } from "../schemas/safety";

export interface SafetyContext {
  materials: RawMaterial[];
  phTarget?: string;
  processTempC?: string;
  packagingComponentTypes?: string[];
}

const dec = (s: string | undefined) => (s === undefined || s === "" ? undefined : new Decimal(s));

// Family name/code fragments that push an "industrial" family into the
// stricter "hazardous_lawful_product" tier rather than plain industrial
// cleaning. Keyword-based because the Kenya catalog's `hazardClass` field
// only carries four coarse tiers; this refines within "industrial".
const HAZARDOUS_KEYWORDS = ["bleach", "hypochlorite", "acid", "limescale", "descal", "degreaser", "caustic"];

// A claim on an otherwise "ordinary" product that a person should confirm
// before the product ships as ordinary — antimicrobial/medical claims carry
// their own regulatory weight regardless of what family it was seeded under.
const ESCALATING_CLAIM_KEYWORDS = [
  "antibacterial",
  "antimicrobial",
  "disinfect",
  "kills germs",
  "kills 99.9",
  "medical",
  "therapeutic",
  "medicated",
];

/**
 * Deterministic product-safety classification from the seeded catalog's
 * `hazardClass` plus the project's own claims — never a model's guess. The
 * catalog's four-tier `hazardClass` was seeded in Phase 1 specifically to
 * drive this (see the field's own doc comment in schemas/product.ts).
 */
export function classifyProductSafety(
  family: Pick<ProductFamily, "hazardClass" | "name" | "code">,
  claims: string[] = [],
): ProductSafetyClassification {
  if (family.hazardClass === "medical") return "medical_or_health_related_product";
  if (family.hazardClass === "regulated_disinfectant") return "regulated_disinfectant";
  if (family.hazardClass === "industrial") {
    const text = `${family.name} ${family.code}`.toLowerCase();
    return HAZARDOUS_KEYWORDS.some((k) => text.includes(k)) ? "hazardous_lawful_product" : "industrial_cleaning_product";
  }
  const claimText = claims.join(" ").toLowerCase();
  if (ESCALATING_CLAIM_KEYWORDS.some((k) => claimText.includes(k))) return "human_review_required";
  return "ordinary_consumer_product";
}

/** Classifications that always require a named human to review before the
 *  formula may progress toward approval, whatever findings it does or does
 *  not have. */
export const HUMAN_REVIEW_CLASSIFICATIONS: readonly ProductSafetyClassification[] = [
  "hazardous_lawful_product",
  "regulated_disinfectant",
  "medical_or_health_related_product",
  "restricted_request",
  "human_review_required",
];

function findingId(ruleId: string, lineIds: string[], conditions: number[]): string {
  return `safety-finding:${ruleId}:${[...lineIds].sort().join("+")}:${conditions.join(",")}`;
}

function buildFinding(
  rule: SafetyRule,
  materialIds: string[],
  lineIds: string[],
  triggeredConditions: number[],
  opts: { dataIncomplete?: boolean; message?: string } = {},
): SafetyFinding {
  const humanReviewRequired =
    rule.alwaysRequiresHumanReview ||
    rule.verificationStatus === "human_review_required" ||
    rule.severity === "blocking" ||
    rule.severity === "error";
  return {
    id: findingId(rule.id, lineIds, triggeredConditions),
    ruleId: rule.id,
    ruleVersion: rule.version,
    severity: opts.dataIncomplete && rule.severity === "blocking" ? "warning" : rule.severity,
    category: rule.category,
    affectedMaterialIds: [...new Set(materialIds)],
    affectedLineIds: [...new Set(lineIds)],
    message: opts.message ?? rule.message,
    requiredAction: rule.requiredAction,
    requiredPpe: rule.requiredPpe,
    requiredEngineeringControls: rule.requiredEngineeringControls,
    verificationStatus: rule.verificationStatus,
    humanReviewRequired,
    dataIncomplete: opts.dataIncomplete ?? false,
  };
}

/**
 * Evaluate every active, non-deprecated safety rule against a formula.
 * Deterministic and idempotent in exactly the same sense as
 * `evaluateCompatibility` — same formula and rules always produce the same
 * findings, with the same stable ids.
 */
export function evaluateSafety(lines: FormulationLine[], rules: SafetyRule[], context: SafetyContext): SafetyFinding[] {
  const byCode = new Map(context.materials.map((m) => [m.code, m]));
  const findings: SafetyFinding[] = [];
  const seen = new Set<string>();
  const push = (f: SafetyFinding) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    findings.push(f);
  };

  for (const rule of rules) {
    if (!rule.active || rule.status === "deprecated") continue;

    switch (rule.ruleType) {
      case "forbidden_combination":
      case "warning_combination":
      case "order_of_addition":
      case "packaging_incompatibility":
      case "storage_incompatibility": {
        const isPackagingOnly = (i: number) => (rule.conditions[i].packagingComponentTypesAny?.length ?? 0) > 0;
        const perCondition = rule.conditions.map((cond, i) => ({
          index: i,
          lines: isPackagingOnly(i) ? [] : matchLines(cond, lines, byCode),
          packagingOk: isPackagingOnly(i) ? packagingMatches(cond, context.packagingComponentTypes) : false,
        }));
        const satisfied = perCondition.every((c) => c.lines.length > 0 || (isPackagingOnly(c.index) && c.packagingOk));
        if (satisfied) {
          const allLines = perCondition.flatMap((c) => c.lines);
          push(
            buildFinding(
              rule,
              allLines.map((l) => l.materialCode ?? l.id),
              allLines.map((l) => l.id),
              perCondition.map((c) => c.index),
            ),
          );
        }
        break;
      }

      case "required_coingredient": {
        const [need, required] = rule.conditions;
        if (!need) break;
        const needMatches = matchLines(need, lines, byCode);
        if (needMatches.length === 0) break;
        const reqMatches = required ? matchLines(required, lines, byCode) : [];
        if (reqMatches.length === 0) {
          push(
            buildFinding(
              rule,
              needMatches.map((l) => l.materialCode ?? l.id),
              needMatches.map((l) => l.id),
              [0],
            ),
          );
        }
        break;
      }

      case "concentration_dependent": {
        rule.conditions.forEach((cond, i) => {
          const min = dec(cond.minConcentrationPercent);
          const max = dec(cond.maxConcentrationPercent);
          for (const line of matchLines(cond, lines, byCode)) {
            const pct = resolvedPercent(line, lines);
            const outOfRange = (min && pct.lessThan(min)) || (max && pct.greaterThan(max));
            if (outOfRange) push(buildFinding(rule, [line.materialCode ?? line.id], [line.id], [i]));
          }
        });
        break;
      }

      case "ph_dependent": {
        rule.conditions.forEach((cond, i) => {
          const matches = matchLines(cond, lines, byCode);
          if (matches.length === 0) return;
          const materialIds = matches.map((l) => l.materialCode ?? l.id);
          const lineIds = matches.map((l) => l.id);
          if (context.phTarget === undefined) {
            push(
              buildFinding(rule, materialIds, lineIds, [i], {
                dataIncomplete: true,
                message: `${rule.message} — formula pH target is not set, so this cannot be confirmed either way.`,
              }),
            );
            return;
          }
          const ph = new Decimal(context.phTarget);
          const min = dec(cond.phMin);
          const max = dec(cond.phMax);
          const outOfRange = (min && ph.lessThan(min)) || (max && ph.greaterThan(max));
          if (outOfRange) push(buildFinding(rule, materialIds, lineIds, [i]));
        });
        break;
      }

      case "temperature_dependent": {
        rule.conditions.forEach((cond, i) => {
          const matches = matchLines(cond, lines, byCode);
          if (matches.length === 0) return;
          const materialIds = matches.map((l) => l.materialCode ?? l.id);
          const lineIds = matches.map((l) => l.id);
          if (context.processTempC === undefined) {
            push(
              buildFinding(rule, materialIds, lineIds, [i], {
                dataIncomplete: true,
                message: `${rule.message} — process temperature is not set, so this cannot be confirmed either way.`,
              }),
            );
            return;
          }
          const t = new Decimal(context.processTempC);
          const max = dec(cond.maxTemperatureC);
          if (max && t.greaterThan(max)) push(buildFinding(rule, materialIds, lineIds, [i]));
        });
        break;
      }
    }
  }

  return findings;
}

export function summarizeSafetyFindings(findings: SafetyFinding[]) {
  return {
    blocking: findings.filter((f) => f.severity === "blocking").length,
    error: findings.filter((f) => f.severity === "error").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    humanReviewRequired: findings.filter((f) => f.humanReviewRequired).length,
    dataIncomplete: findings.filter((f) => f.dataIncomplete).length,
  };
}
