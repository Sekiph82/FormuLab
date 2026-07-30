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
  /** Overall score (0-1). */
  overallScore: number;
  /** Breakdown by score type. */
  scores: Record<string, number>;
  /** Explanation for each score component. */
  explanations: Record<string, string>;
  /** Suggested improvements. */
  suggestions: string[];
}

/**
 * Weights for each score component (must sum to 1.0).
 */
const SCORE_WEIGHTS = {
  evidence: 0.25,      // How well the formula explains the declared ingredients and analytical data
  order: 0.15,         // Consistency with ingredient order in declaration
  analytical: 0.2,     // Match with analytical composition results
  properties: 0.15,    // Match with predicted physical/chemical properties
  performance: 0.1,    // Match with desired performance targets
  cost: 0.1,           // Cost effectiveness
  regulatory: 0.05,    // Regulatory compliance
};

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

  // 1. Evidence score: based on mapping confidence and coverage
  const mappedLines = mappings.length;
  const totalLines = candidate.formulaLines.length; // Actually we need to compare to declaration lines, but we'll approximate
  const coverage = mappedLines > 0 ? Math.min(1.0, mappedLines / Math.max(1, totalLines)) : 0;
  const avgConfidence =
    mappings.reduce((sum, m) => sum + (m.mapping.confidence ?? 0), 0) /
    Math.max(1, mappedLines);
  scores.evidence = (coverage * 0.5 + avgConfidence * 0.5);
  explanations.evidence = `Coverage: ${(coverage * 100).toFixed(0)}%, Avg mapping confidence: ${(avgConfidence * 100).toFixed(
    0
  )}%`;
  if (coverage < 0.8) {
    suggestions.push(
      `Increase ingredient mapping coverage (currently ${(coverage * 100).toFixed(
        0
      )}%). Consider reviewing unmapped declaration lines.`
    );
  }

  // 2. Order score: compare declared order vs formula order (simplified)
  // Not yet implemented — neutral score, not a claim that order was verified.
  scores.order = 0.5;
  explanations.order = 'Not evaluated: declared-order comparison is not implemented yet.';
  // In a real implementation, we would compare the sequence of mapped materials.

  // 3. Analytical score: how well the candidate predicts the analytical results
  // We'll use the analysis from analyticalInference and compare to predicted properties from candidate.
  // For simplicity, we'll compute a match between analysis.estimatedProps and candidate's predictedProperties.
  const candProps = candidate.predictedProperties ?? {};
  let analogScore = 0;
  let analogCount = 0;
  if (analysis.estimatedPh !== null && analysis.estimatedPh !== undefined && candProps.pH !== undefined) {
    const diff = Math.abs(analysis.estimatedPh - candProps.pH);
    const score = Math.max(0, 1 - diff / 2); // pH range 0-14, but we expect small diff
    scores.analytical = score;
    explanations.analytical = `pH difference: ${diff.toFixed(2)}`;
    analogScore += score;
    analogCount++;
  }
  // Add more comparisons as needed...
  if (analogCount === 0) {
    scores.analytical = 0.5; // neutral if no data
    explanations.analytical = 'Insufficient analytical data for scoring.';
  } else {
    scores.analytical = analogScore / analogCount;
  }

  // 4. Properties score: match with target product profile (similar to candidateGenerator's computeMatchScore)
  // We'll reuse a simplified version.
  const propsScore = computeMatchScore(candProps, target);
  scores.properties = propsScore;
  explanations.properties = `Compared predicted properties to target profile.`;

  // 5. Performance score: no performance model exists yet — neutral score.
  scores.performance = 0.5;
  explanations.performance = 'Not evaluated: no performance prediction model is wired up yet.';

  // 6. Cost score: lower cost is better, but we need a target cost.
  // If target has costTargetPerKg, we can compare.
  let costScore = 0.5;
  if (target.costTargetPerKg !== undefined && candidate.estimatedCost !== undefined) {
    const targetCost = target.costTargetPerKg;
    const actualCost = candidate.estimatedCost;
    // Assume we want to be at or below target cost.
    if (actualCost <= targetCost) {
      costScore = 1.0; // under budget is good
    } else {
      const overRatio = (actualCost - targetCost) / targetCost;
      costScore = Math.max(0, 1 - overRatio); // linear penalty
    }
    suggestions.push(
      `Estimated cost $${actualCost
        .toFixed(2)}/kg vs target $${targetCost
        .toFixed(2)}/kg: ${
        actualCost <= targetCost ? 'within target' : `over by $${(actualCost - targetCost)
          .toFixed(2)}/kg`
      }.`
    );
  }
  scores.cost = costScore;
  explanations.cost = `Cost comparison to target.`;

  // 7. Regulatory score: no restricted-substance check has actually run — a
  // neutral score, never a claim of compliance that wasn't verified.
  scores.regulatory = 0.5;
  explanations.regulatory = 'Not evaluated: no regulatory/restricted-substance check has been run.';

  // Compute weighted average
  let overall = 0;
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    overall += (scores[key] ?? 0) * weight;
  }

  // Ensure overall is between 0 and 1
  overall = Math.max(0, Math.min(1, overall));

  // Format explanations for output
  const formattedExplanations: Record<string, string> = {};
  for (const [key, exp] of Object.entries(explanations)) {
    formattedExplanations[key] = exp;
  }

  return {
    overallScore: overall,
    scores,
    explanations: formattedExplanations,
    suggestions,
  };
}

/**
 * Helper: compute match score between estimated properties and target (simplified).
 */
function computeMatchScore(
  estimated: Record<string, number>,
  target: TargetProductProfile
): number {
  let score = 0;
  let count = 0;

  // pH
  if (target.pHMin !== undefined && target.pHMax !== undefined && estimated.pH !== undefined) {
    const min = target.pHMin;
    const max = target.pHMax;
    const val = estimated.pH;
    if (val >= min && val <= max) {
      score += 1;
    } else {
      // linear falloff outside range
      const range = max - min;
      const excess = Math.min(Math.abs(val - min), Math.abs(val - max));
      score += Math.max(0, 1 - 2 * (excess / range)); // penalty increases linearly outside
    }
    count++;
  }

  // Active matter
  if (
    target.activeMatterMin !== undefined &&
    target.activeMatterMax !== undefined &&
    estimated.activeMatter !== undefined
  ) {
    const min = target.activeMatterMin;
    const max = target.activeMatterMax;
    const val = estimated.activeMatter;
    if (val >= min && val <= max) {
      score += 1;
    } else {
      const range = max - min;
      const excess = Math.min(Math.abs(val - min), Math.abs(val - max));
      score += Math.max(0, 1 - 2 * (excess / range));
    }
    count++;
  }

  // Add more properties as needed (viscosity, density, etc.)

  return count > 0 ? score / count : 0.5; // neutral if no comparable props
}