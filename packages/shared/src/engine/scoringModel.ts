import {
  ReverseFormulaCandidate,
  TargetProductProfile,
  IngredientDeclarationLine,
} from '../schemas/reverseFormulation';
import { AnalyticalAnalysis } from './analyticalInference';
import { IngredientMappingResult } from './ingredientMapper';

/**
 * Compute a comprehensive score for a formula candidate based on multiple evidence streams.
 */
export interface ScoringModelOutput {
  /** Overall score (0-1), normalized by the actual weight total used. */
  overallScore: number;
  /** Breakdown by score type, each clamped to [0, 1]. */
  scores: Record<string, number>;
  /** Explanation for each score component. */
  explanations: Record<string, string>;
  /** Suggested improvements. */
  suggestions: string[];
  /** Dimensions backed by real evidence this call, as opposed to a neutral
   *  placeholder (e.g. "order"/"performance"/"regulatory" have no model yet
   *  and are always neutral). Separates confidence in the assessment from
   *  the score values themselves. */
  evaluatedDimensions: string[];
  /** Fraction of scoring dimensions backed by real evidence (0-1). Low
   *  confidence does not by itself lower the score — it says how much of
   *  the score to trust, not what the score is. */
  evidenceConfidence: number;
}

/**
 * Weights for each score component. Nominally sum to 1.0, but the weighted
 * average below normalizes by the actual (valid) weight total rather than
 * assuming that — so an edit that breaks the sum-to-1 invariant degrades
 * gracefully instead of silently mis-scaling the result.
 */
const SCORE_WEIGHTS: Record<string, number> = {
  evidence: 0.25,      // How well the formula explains the declared ingredients and analytical data
  order: 0.15,         // Consistency with ingredient order in declaration
  analytical: 0.2,     // Match with analytical composition results
  properties: 0.15,    // Match with predicted physical/chemical properties
  performance: 0.1,    // Match with desired performance targets
  cost: 0.1,           // Cost effectiveness
  regulatory: 0.05,    // Regulatory compliance
};

const ALL_DIMENSIONS = Object.keys(SCORE_WEIGHTS);

/** An invalid number is unknown, not zero — neutral midpoint, not a penalty. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/** 1.0 inside [min, max], linear falloff outside, 0 once twice the range
 *  away. A zero-width (or inverted) range only matches an exact value —
 *  never divides by zero. */
function rangeMatchScore(value: number, min: number, max: number): number {
  if (value >= min && value <= max) return 1;
  const range = max - min;
  if (range <= 0) return 0;
  const excess = Math.min(Math.abs(value - min), Math.abs(value - max));
  return Math.max(0, 1 - 2 * (excess / range));
}

/**
 * Score a candidate's estimated/predicted properties against a target
 * profile's ranges. Shared by candidate generation (ranking candidates as
 * they're built) and scoring (the "properties" dimension) — same domain
 * rule, one implementation. Returns 0.5 (neutral) when there is nothing
 * comparable, never a fabricated pass or fail.
 */
export function computeTargetMatchScore(
  estimated: Record<string, number>,
  target: TargetProductProfile
): number {
  let score = 0;
  let count = 0;

  if (
    target.pHMin !== undefined &&
    target.pHMax !== undefined &&
    estimated.pH !== undefined &&
    Number.isFinite(estimated.pH)
  ) {
    score += rangeMatchScore(estimated.pH, target.pHMin, target.pHMax);
    count++;
  }

  if (
    target.activeMatterMin !== undefined &&
    target.activeMatterMax !== undefined &&
    estimated.activeMatter !== undefined &&
    Number.isFinite(estimated.activeMatter)
  ) {
    score += rangeMatchScore(estimated.activeMatter, target.activeMatterMin, target.activeMatterMax);
    count++;
  }

  // Add more properties as needed (viscosity, density, etc.)

  return count > 0 ? score / count : 0.5;
}

/**
 * Score a candidate formula.
 * @param candidate The candidate formula to score.
 * @param mappings Results from mapping declaration lines to materials.
 * @param analysis Analysis of analytical data.
 * @param target Target product profile.
 * @param availableMaterials Catalog of available materials (for cost, etc.).
 * @returns Scoring result.
 */
export function scoreReverseFormulaCandidate(
  candidate: ReverseFormulaCandidate,
  mappings: Array<{
    line: IngredientDeclarationLine;
    mapping: IngredientMappingResult;
  }>,
  analysis: AnalyticalAnalysis,
  target: TargetProductProfile,
  availableMaterials: Map<string, any> // We'll use any for simplicity; in reality would be Material[]
): ScoringModelOutput {
  const scores: Record<string, number> = {};
  const explanations: Record<string, string> = {};
  const suggestions: string[] = [];
  const evaluatedDimensions: string[] = [];

  // 1. Evidence score: based on mapping confidence and coverage. Always a
  // real (if possibly zero) measurement, never a placeholder.
  const mappedLines = mappings.length;
  const totalLines = candidate.formulaLines.length; // approximation: compared to formula lines, not declaration lines
  const coverage = mappedLines > 0 ? Math.min(1.0, mappedLines / Math.max(1, totalLines)) : 0;
  const avgConfidence =
    mappedLines > 0
      ? mappings.reduce((sum, m) => sum + clamp01(m.mapping.confidence ?? 0), 0) / mappedLines
      : 0;
  scores.evidence = clamp01(coverage * 0.5 + avgConfidence * 0.5);
  explanations.evidence = `Coverage: ${(coverage * 100).toFixed(0)}%, Avg mapping confidence: ${(avgConfidence * 100).toFixed(
    0
  )}%`;
  evaluatedDimensions.push('evidence');
  if (coverage < 0.8) {
    suggestions.push(
      `Increase ingredient mapping coverage (currently ${(coverage * 100).toFixed(
        0
      )}%). Consider reviewing unmapped declaration lines.`
    );
  }

  // 2. Order score: declared-order comparison is not implemented — neutral,
  // never a claim that order was verified.
  scores.order = 0.5;
  explanations.order = 'Not evaluated: declared-order comparison is not implemented yet.';
  // In a real implementation, we would compare the sequence of mapped materials.

  // 3. Analytical score: compare the candidate's predicted pH to the
  // benchmark's estimated pH, when both exist.
  const candProps = candidate.predictedProperties ?? {};
  if (
    analysis.estimatedPh !== null &&
    analysis.estimatedPh !== undefined &&
    candProps.pH !== undefined &&
    Number.isFinite(candProps.pH)
  ) {
    const diff = Math.abs(analysis.estimatedPh - candProps.pH);
    scores.analytical = clamp01(1 - diff / 2); // pH spans 0-14; a small diff should still score well
    explanations.analytical = `pH difference: ${diff.toFixed(2)}`;
    evaluatedDimensions.push('analytical');
  } else {
    scores.analytical = 0.5; // neutral if no data
    explanations.analytical = 'Insufficient analytical data for scoring.';
  }
  // Add more comparisons as needed...

  // 4. Properties score: match predicted properties against the target profile.
  const propertiesEvaluated =
    (target.pHMin !== undefined && target.pHMax !== undefined && candProps.pH !== undefined) ||
    (target.activeMatterMin !== undefined &&
      target.activeMatterMax !== undefined &&
      candProps.activeMatter !== undefined);
  scores.properties = clamp01(computeTargetMatchScore(candProps, target));
  explanations.properties = propertiesEvaluated
    ? 'Compared predicted properties to target profile.'
    : 'Not evaluated: no comparable predicted properties and target ranges.';
  if (propertiesEvaluated) evaluatedDimensions.push('properties');

  // 5. Performance score: no performance model exists yet — neutral score.
  scores.performance = 0.5;
  explanations.performance = 'Not evaluated: no performance prediction model is wired up yet.';

  // 6. Cost score: lower cost is better, but we need a target cost.
  let costScore = 0.5;
  if (
    target.costTargetPerKg !== undefined &&
    Number.isFinite(target.costTargetPerKg) &&
    candidate.estimatedCost !== undefined &&
    Number.isFinite(candidate.estimatedCost)
  ) {
    const targetCost = target.costTargetPerKg;
    const actualCost = candidate.estimatedCost;
    if (actualCost <= targetCost) {
      costScore = 1.0; // under budget is good
    } else if (targetCost > 0) {
      const overRatio = (actualCost - targetCost) / targetCost;
      costScore = Math.max(0, 1 - overRatio); // linear penalty
    } else {
      costScore = 0; // over a zero/negative target cost
    }
    evaluatedDimensions.push('cost');
    explanations.cost = 'Compared estimated cost to target cost per kg.';
    suggestions.push(
      `Estimated cost $${actualCost
        .toFixed(2)}/kg vs target $${targetCost
        .toFixed(2)}/kg: ${
        actualCost <= targetCost ? 'within target' : `over by $${(actualCost - targetCost)
          .toFixed(2)}/kg`
      }.`
    );
  } else {
    explanations.cost = 'Not evaluated: no target cost or estimated cost available.';
  }
  scores.cost = clamp01(costScore);

  // 7. Regulatory score: no restricted-substance check has actually run — a
  // neutral score, never a claim of compliance that wasn't verified.
  scores.regulatory = 0.5;
  explanations.regulatory = 'Not evaluated: no regulatory/restricted-substance check has been run.';

  // Weighted average, normalized by the actual (valid) weight total rather
  // than assumed to sum to 1.
  let overall = 0;
  let weightTotal = 0;
  for (const key of ALL_DIMENSIONS) {
    const weight = SCORE_WEIGHTS[key];
    if (!Number.isFinite(weight) || weight < 0) continue;
    overall += clamp01(scores[key] ?? 0.5) * weight;
    weightTotal += weight;
  }
  overall = weightTotal > 0 ? clamp01(overall / weightTotal) : 0.5;

  return {
    overallScore: overall,
    scores,
    explanations,
    suggestions,
    evaluatedDimensions,
    evidenceConfidence: clamp01(evaluatedDimensions.length / ALL_DIMENSIONS.length),
  };
}
