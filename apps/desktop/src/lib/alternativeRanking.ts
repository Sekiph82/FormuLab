import {
  canonicalizeForFingerprint,
  sha256Hex,
  type AlternativeRankingCandidate,
  type CostSnapshot,
  type PredictionResult,
} from "@formulab/shared";
import type { FormulationCard } from "./formulationV2";
import type { FormulaInventoryFeasibility } from "./generatedFormulaInventory";
import type { GeneratedFormulaCompatibility } from "./generatedFormulaCompatibility";
import type { GeneratedFormulaRegulatory } from "./generatedFormulaRegulatory";
import type { GeneratedFormulaSafety } from "./generatedFormulaSafety";
import { asGeneratedFormula } from "./generatedFormula";

export interface BuildAlternativeRankingInput {
  sessionId: string;
  cards: FormulationCard[];
  costSnapshots: (CostSnapshot | undefined)[];
  availability: (FormulaInventoryFeasibility | undefined)[];
  compatibility: (GeneratedFormulaCompatibility | undefined)[];
  safety: (GeneratedFormulaSafety | undefined)[];
  regulatory: (GeneratedFormulaRegulatory | undefined)[];
  predictions?: ReadonlyMap<string, PredictionResult>;
}

function gateStatus(value: string | undefined): "PASS" | "WARNING" | "FAIL" | "UNKNOWN" {
  if (value === "compatible" || value === "safe" || value === "compliant") return "PASS";
  if (value === "warning") return "WARNING";
  if (value === "blocked") return "FAIL";
  return "UNKNOWN";
}

function costDimension(snapshot: CostSnapshot | undefined) {
  if (!snapshot) return { status: "MISSING" as const };
  const rawCost = snapshot.costPerKg;
  const costPerKg = rawCost === undefined ? undefined : Number(rawCost);
  const usableValue = costPerKg !== undefined && Number.isFinite(costPerKg) && costPerKg >= 0;
  const complete = snapshot.missingDataWarnings.length === 0 && usableValue;
  return {
    status: complete ? "AVAILABLE" as const : "INCOMPLETE" as const,
    ...(usableValue ? { costPerKg } : {}),
    currency: snapshot.currency,
    batchKg: snapshot.batchKg,
    sourceSnapshot: { authority: "FormuLab Cost Engine", snapshot },
  };
}

function evidenceDimension(card: FormulationCard, formula: ReturnType<typeof asGeneratedFormula>) {
  if (!formula) return { status: "UNKNOWN" as const, ingredientCount: 0, linkedIngredientCount: 0, uniqueSourceCount: 0 };
  const ingredients = formula.ingredients ?? [];
  const links = card.evidence_links ?? [];
  const linkedIngredients = new Set(links.map((link) => link.ingredient_key));
  const bestClass = [...links].map(({ evidence_class }) => evidence_class).sort()[0];
  const uniqueSourceCount = new Set(links.map((link) => link.paper_doi || `${link.paper_title}:${link.paper_year}`)).size;
  return {
    status: links.length ? "LINKED" as const : "NO_LINKED_EVIDENCE" as const,
    ingredientCount: ingredients.length,
    linkedIngredientCount: linkedIngredients.size,
    ...(bestClass ? { bestEvidenceClass: bestClass } : {}),
    uniqueSourceCount,
    sourceSnapshot: {
      evidenceLinks: links.map(({ formula_version_id, ingredient_key, evidence_class, source_depth, paper_doi, paper_title, paper_year, unique_source_count, provenance_sources }) => ({
        formula_version_id, ingredient_key, evidence_class, source_depth, paper_doi, paper_title, paper_year, unique_source_count, provenance_sources,
      })),
      evidenceGaps: card.evidence_gaps ?? [],
      researchCorpus: card.research_corpus,
    },
  };
}

function formulaStatus(card: FormulationCard, hasFormula: boolean): AlternativeRankingCandidate["formulaStatus"] {
  if (card.status === "generation_failed" || !hasFormula) return "UNAVAILABLE";
  if (card.formula_state?.startsWith("invalid")) return "INVALID";
  if (card.formula_state === "complete") return "VALID";
  return "INCOMPLETE";
}

export async function buildAlternativeRankingCandidates(input: BuildAlternativeRankingInput): Promise<AlternativeRankingCandidate[]> {
  return Promise.all(input.cards.map(async (card, index) => {
    const formula = asGeneratedFormula(card.formula);
    const hasFormula = formula !== undefined;
    const prediction = input.predictions?.get(card.version);
    const cost = costDimension(input.costSnapshots[index]);
    const inventory = input.availability[index];
    const compatibility = input.compatibility[index];
    const safety = input.safety[index];
    const regulatory = input.regulatory[index];
    const cardIdentity = `${input.sessionId}:${card.version}`;
    const dimensions = {
      performance: prediction
        ? {
            status: prediction.status,
            ...(prediction.predictedNumericValue !== undefined ? { numericValue: prediction.predictedNumericValue } : {}),
            ...(prediction.predictedCategory !== undefined ? { categoryValue: prediction.predictedCategory } : {}),
            ...(prediction.targetUnit ? { unit: prediction.targetUnit } : {}),
            targetKey: prediction.targetDefinition.testDefinitionId,
            modelId: prediction.modelId,
            modelVersion: prediction.modelVersion,
            sourceSnapshot: { authority: "FVL-07 Predictive Performance", prediction },
          }
        : { status: "UNAVAILABLE_MODEL" as const },
      uncertainty: prediction?.status === "PREDICTED"
        ? { status: "UNSUPPORTED" as const, sourceSnapshot: { authority: "FVL-07 Predictive Performance", modelId: prediction.modelId, modelVersion: prediction.modelVersion, uncertainty: prediction.uncertainty } }
        : { status: prediction ? "UNKNOWN" as const : "UNKNOWN" as const },
      cost,
      availability: {
        status: inventory?.formulaState === "feasible" ? "FEASIBLE" as const : inventory?.formulaState === "infeasible" ? "INFEASIBLE" as const : "UNKNOWN" as const,
        ...(inventory ? { sourceSnapshot: { authority: "FormuLab Inventory Availability Engine", evaluation: inventory } } : {}),
      },
      compatibility: { status: gateStatus(compatibility?.formulaState), ...(compatibility ? { sourceSnapshot: { authority: "FormuLab Compatibility Engine", evaluation: compatibility } } : {}) },
      safety: { status: gateStatus(safety?.formulaState), ...(safety ? { sourceSnapshot: { authority: "FormuLab Safety Engine", evaluation: safety } } : {}) },
      regulatory: { status: gateStatus(regulatory?.formulaState), ...(regulatory ? { sourceSnapshot: { authority: "FormuLab Regulatory Engine", evaluation: regulatory } } : {}) },
      manufacturing: {
        status: card.manufacturing ? card.manufacturing.ready ? "READY" as const : "NOT_READY" as const : "UNKNOWN" as const,
        ...(card.manufacturing ? { sourceSnapshot: { plan: card.manufacturing, formulaState: card.formula_state } } : {}),
      },
      evidence: evidenceDimension(card, formula),
    };
    const formulaFingerprint = hasFormula
      ? {
          algorithm: "sha256" as const,
          canonicalization: "formulab-canonical-json-v1" as const,
          digest: await sha256Hex(canonicalizeForFingerprint(card.formula)),
        }
      : undefined;
    return {
      candidateId: cardIdentity,
      sessionId: input.sessionId,
      alternativeId: cardIdentity,
      versionLabel: card.version,
      ...(formulaFingerprint ? { formulaFingerprint } : {}),
      formulaStatus: formulaStatus(card, hasFormula),
      dimensions,
    };
  }));
}
