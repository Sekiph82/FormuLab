/**
 * The compatibility evaluator: deterministic, rule-driven, no model in the
 * loop. Given a formula and a rule set, it always produces the same findings
 * — that is the entire reason this exists instead of asking an LLM whether
 * two ingredients get along.
 *
 * A rule's `conditions` are ANDed: every condition must be satisfied by
 * *something* in the formula (or, for packaging conditions, by the target
 * packaging) before the rule fires. Each condition's own `*Any` lists are
 * ORed. That is enough to express "anionic surfactant present AND cationic
 * surfactant present" without a general boolean-expression language.
 */
import Decimal from "decimal.js";
import { resolvedPercent } from "./formula";
import { matchLines, packagingMatches } from "./ruleConditions";
import type { FormulationLine } from "../schemas/formulation";
import type { RawMaterial } from "../schemas/materials";
import type { ProductDomain } from "../schemas/product";
import type { CompatibilityFinding, CompatibilityRule } from "../schemas/compatibility";

export interface CompatibilityContext {
  materials: RawMaterial[];
  /** Target pH of the finished formula, if the chemist has set one. */
  phTarget?: string;
  /** Planned process temperature, in °C, if known. */
  processTempC?: string;
  productDomain?: ProductDomain;
  /** Packaging component types the target SKU(s) actually use. */
  packagingComponentTypes?: string[];
}

const dec = (s: string | undefined) => (s === undefined || s === "" ? undefined : new Decimal(s));

function findingId(ruleId: string, lineIds: string[], conditions: number[]): string {
  return `finding:${ruleId}:${[...lineIds].sort().join("+")}:${conditions.join(",")}`;
}

function buildFinding(
  rule: CompatibilityRule,
  materialIds: string[],
  lineIds: string[],
  triggeredConditions: number[],
  opts: { dataIncomplete?: boolean; message?: string } = {},
): CompatibilityFinding {
  return {
    id: findingId(rule.id, lineIds, triggeredConditions),
    ruleId: rule.id,
    ruleVersion: rule.version,
    severity: opts.dataIncomplete && rule.severity === "blocking" ? "warning" : rule.severity,
    materialIds: [...new Set(materialIds)],
    lineIds: [...new Set(lineIds)],
    message: opts.message ?? rule.message,
    scientificReason: rule.scientificReason,
    recommendedAction: rule.recommendedAction,
    verificationStatus: rule.verificationStatus,
    triggeredConditions,
    dataIncomplete: opts.dataIncomplete ?? false,
  };
}

/**
 * Evaluate every active, non-deprecated rule against a formula. Deterministic
 * and idempotent: the same formula and rule set always produce the same
 * findings in the same order, and a finding's id is derived from the rule and
 * the lines it fired on, so evaluating twice never duplicates a finding.
 */
export function evaluateCompatibility(
  lines: FormulationLine[],
  rules: CompatibilityRule[],
  context: CompatibilityContext,
): CompatibilityFinding[] {
  const byCode = new Map(context.materials.map((m) => [m.code, m]));
  const findings: CompatibilityFinding[] = [];
  const seen = new Set<string>();

  const push = (f: CompatibilityFinding) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    findings.push(f);
  };

  for (const rule of rules) {
    if (!rule.active || rule.status === "deprecated") continue;
    if (rule.productDomains?.length && context.productDomain && !rule.productDomains.includes(context.productDomain)) {
      continue;
    }

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
        // A condition is satisfied when it matched at least one line, or it is
        // a packaging-only condition whose packaging type is present in context.
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
            if (outOfRange) {
              push(buildFinding(rule, [line.materialCode ?? line.id], [line.id], [i]));
            }
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

/** Findings grouped by severity, for a summary strip in the UI. */
export function summarizeCompatibilityFindings(findings: CompatibilityFinding[]) {
  return {
    blocking: findings.filter((f) => f.severity === "blocking").length,
    error: findings.filter((f) => f.severity === "error").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    dataIncomplete: findings.filter((f) => f.dataIncomplete).length,
  };
}
