/**
 * FVL-03.005 — the one seam between a generated formula card and the
 * existing Advanced Optimizer workflow.
 *
 * `formulationProblemSchema` (the optimizer's real input contract,
 * `packages/shared/src/schemas/optimization.ts`) requires a real
 * `projectId`/`productFamilyId` — both non-optional. A generated AI
 * session card has neither (sessions carry no project association at
 * all). Fabricating placeholder IDs would violate this project's
 * standing "no fake persistent IDs" rule, so this module does the
 * opposite: it builds a REAL `Formulation`/`FormulationVersion` from the
 * card's own real data, using the exact same helpers
 * (`newFormulation()`/`newVersion()`) and the exact same
 * `materialCode`-carrying line conversion (`linesFromGeneratedFormula()`,
 * FVL-03.002/.003) every other save path in this app already uses — no
 * new persistence shape, no new mapping logic.
 *
 * Pure — this function makes no Tauri call and mutates nothing. The
 * caller is responsible for actually persisting the returned records
 * (`saveFormulation()`/`saveFormulationVersion()`) and for never writing
 * back to the source session, which stays exactly as generated.
 */
import type { Formulation, FormulationVersion } from "@formulab/shared";
import { newFormulation, newVersion, linesFromGeneratedFormula } from "./formulations";
import type { FormulationCard, SessionDetail } from "./formulationV2";

export interface PromotedFormulation {
  formulation: Formulation;
  version: FormulationVersion;
}

export function buildPromotedFormulation(
  session: SessionDetail,
  card: FormulationCard,
  batchKg: string,
): PromotedFormulation {
  const target = session.brief?.target?.trim() || "Formulation";
  const name = `${target} — ${card.version.toUpperCase()}`;
  // Real request data only — never a fabricated specific product family.
  // "general" is an honest, disclosed fallback for a brief that left
  // category unspecified ("Auto-detect" in the request UI), not a guess
  // at what the category actually is.
  const productFamilyCode = session.brief?.category?.trim() || "general";

  const formulation = newFormulation(name, productFamilyCode, {
    brief: target,
    targetBatchKg: batchKg,
  });

  const version = newVersion(formulation.id, linesFromGeneratedFormula(card.formula), {
    versionNumber: 1,
    basisBatchKg: batchKg,
    changeReason: `Promoted from AI-generated session ${session.id}, ${card.version.toUpperCase()}, for Advanced Optimizer refinement.`,
  });

  return { formulation, version };
}
