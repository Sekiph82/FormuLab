/**
 * Matching logic shared by the compatibility and safety evaluators: does a
 * formula line (or the target packaging) satisfy one `RuleCondition`?
 */
import type { FormulationLine } from "../schemas/formulation";
import type { RawMaterial } from "../schemas/materials";
import type { RuleCondition } from "../schemas/ruleConditions";

export function materialFor(line: FormulationLine, byCode: Map<string, RawMaterial>): RawMaterial | undefined {
  return line.materialCode ? byCode.get(line.materialCode) : undefined;
}

/** Does this one condition match this one line (material-side fields only)? */
export function lineMatchesCondition(
  line: FormulationLine,
  material: RawMaterial | undefined,
  cond: RuleCondition,
): boolean {
  const anyFieldSet =
    (cond.functionsAny?.length ?? 0) > 0 ||
    (cond.ionicCharactersAny?.length ?? 0) > 0 ||
    (cond.materialCodesAny?.length ?? 0) > 0 ||
    (cond.casNumbersAny?.length ?? 0) > 0 ||
    (cond.nameKeywordsAny?.length ?? 0) > 0;
  if (!anyFieldSet) return false;

  if (cond.materialCodesAny?.length && line.materialCode && cond.materialCodesAny.includes(line.materialCode)) {
    return true;
  }
  if (cond.functionsAny?.length && line.functions.some((f) => cond.functionsAny!.includes(f))) return true;
  if (
    cond.ionicCharactersAny?.length &&
    material?.ionicCharacter &&
    cond.ionicCharactersAny.includes(material.ionicCharacter)
  ) {
    return true;
  }
  if (cond.casNumbersAny?.length && material?.casNumbers.some((c) => cond.casNumbersAny!.includes(c))) return true;
  if (cond.nameKeywordsAny?.length) {
    const name = `${line.displayName} ${line.tradeName ?? ""}`.toLowerCase();
    if (cond.nameKeywordsAny.some((k) => name.includes(k.toLowerCase()))) return true;
  }
  return false;
}

/** Every formula line matching a condition's material-side fields. Empty when
 *  the condition has no material-side field set at all (a packaging-only
 *  condition, matched separately by `packagingMatches`). */
export function matchLines(
  cond: RuleCondition,
  lines: FormulationLine[],
  byCode: Map<string, RawMaterial>,
): FormulationLine[] {
  return lines.filter((l) => lineMatchesCondition(l, materialFor(l, byCode), cond));
}

/** Whether a condition's packaging-side field is satisfied by the given
 *  packaging component types (the types the target SKU(s) actually use). */
export function packagingMatches(cond: RuleCondition, packagingComponentTypes: string[] | undefined): boolean {
  if (!cond.packagingComponentTypesAny?.length) return false;
  return cond.packagingComponentTypesAny.some((t) => packagingComponentTypes?.includes(t));
}
