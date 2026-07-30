import { RawMaterial } from '../schemas/materials';
import { IngredientMappingResult } from './ingredientMapper';
import { AnalyticalAnalysis } from './analyticalInference';
import {
  ReverseConstraintSet,
  TargetProductProfile,
  IngredientDeclarationLine,
} from '../schemas/reverseFormulation';

/**
 * Input for candidate generation.
 */
export interface GenerationInput {
  /** Mapped ingredients from declaration lines. */
  mappedIngredients: Array<{
    line: IngredientDeclarationLine;
    mapping: IngredientMappingResult;
  }>;
  /** Analytical insights. */
  analysis: AnalyticalAnalysis;
  /** Target product profile. */
  target: TargetProductProfile;
  /** Constraints derived from evidence, targets, regulations. */
  constraints: ReverseConstraintSet;
  /** Available materials in catalog (filtered by constraints). */
  availableMaterials: RawMaterial[];
}

/**
 * A generated formula candidate.
 */
export interface GeneratedCandidate {
  /** List of materials with percentages. */
  formula: Array<{
    materialId: string;
    percentage: number;
    function?: string;
  }>;
  /** Estimated properties. */
  estimatedProperties: Record<string, number>;
  /** How well it matches the target. */
  matchScore: number;
  /** Reasoning. */
  notes: string[];
}

/**
 * Generate formula candidates based on inputs.
 * This is a simplified generator that creates a few basic formulas.
 */
export function generateCandidates(input: GenerationInput): GeneratedCandidate[] {
  const { mappedIngredients, analysis, target, constraints, availableMaterials } = input;

  // If no mapped ingredients, we cannot generate meaningful candidates.
  if (mappedIngredients.length === 0) {
    return [
      {
        formula: [],
        estimatedProperties: {},
        matchScore: 0,
        notes: ['No mapped ingredients to base formulation on.'],
      },
    ];
  }

  // We'll create a simple candidate: use the top mapped ingredient as base, then add others to match constraints.
  const candidates: GeneratedCandidate[] = [];

  // Candidate 1: Try to match the declared order and concentrations from hints.
  const cand1 = generateFromDeclaredHints(mappedIngredients, availableMaterials, target, constraints);
  if (cand1) candidates.push(cand1);

  // Candidate 2: Use a simple baseline formula (water + surfactant + thickener) adjusted to target.
  const cand2 = generateBaselineFormula(mappedIngredients, availableMaterials, target, constraints);
  if (cand2) candidates.push(cand2);

  // Candidate 3: If we have analytical data, try to match detected analytes.
  const cand3 = generateFromAnalytical(mappedIngredients, availableMaterials, analysis, target, constraints);
  if (cand3) candidates.push(cand3);

  // If we have no candidates, return a fallback.
  if (candidates.length === 0) {
    candidates.push({
      formula: [],
      estimatedProperties: {},
      matchScore: 0,
      notes: ['Could not generate any candidate formulas.'],
    });
  }

  return candidates;
}

/**
 * Generate a candidate by respecting declared order and concentration hints.
 */
function generateFromDeclaredHints(
  mappedIngredients: Array<{
    line: IngredientDeclarationLine;
    mapping: IngredientMappingResult;
  }>,
  availableMaterials: RawMaterial[],
  target: TargetProductProfile,
  constraints: ReverseConstraintSet
): GeneratedCandidate | null {
  // We'll attempt to assign percentages based on concentration hints or assume descending order.
  const materialsWithCandidates: Array<{
    material: RawMaterial;
    declaredName: string;
    order: number;
    concentrationHint: string | undefined;
    functionHint: string | undefined;
  }> = [];

  for (const item of mappedIngredients) {
    const mat = item.mapping.material;
    if (!mat) continue;
    materialsWithCandidates.push({
      material: mat,
      declaredName: item.line.declaredName,
      order: item.line.declaredOrder,
      concentrationHint: item.line.concentrationHint,
      functionHint: item.line.functionHint,
    });
  }

  // Sort by declared order
  materialsWithCandidates.sort((a, b) => a.order - b.order);

  // Assign percentages: if we have concentration hints, try to use them; otherwise distribute evenly.
  const total = 100;
  let remaining = total;
  const formula: Array<{
    materialId: string;
    percentage: number;
    function?: string;
  }> = [];

  for (const item of materialsWithCandidates) {
    let percent = 0;
    if (item.concentrationHint) {
      // Extract number from hint (e.g., "5%" -> 5)
      const match = item.concentrationHint.match(/(\d+(?:\.\d+)?)%?/);
      if (match) {
        const val = parseFloat(match[1]);
        // If it's a range like "2-4%", take the midpoint.
        if (item.concentrationHint.includes('-')) {
          const parts = item.concentrationHint.split('-').map(p => parseFloat(p.trim()));
          if (parts.length === 2) {
            const min = Math.min(parts[0], parts[1]);
            const max = Math.max(parts[0], parts[1]);
            percent = (min + max) / 2;
          } else {
            percent = val;
          }
        } else {
          percent = val;
        }
        // Clamp to remaining
        if (percent > remaining) percent = remaining;
      }
    }
    if (percent === 0 && remaining > 0) {
      // Distribute remaining equally among remaining items
      const remainingCount = materialsWithCandidates.length - materialsWithCandidates.indexOf(item);
      percent = remaining / remainingCount;
    }
    // Ensure we don't go negative
    if (percent < 0) percent = 0;
    if (percent > remaining) percent = remaining;

    formula.push({
      materialId: item.material.code,
      percentage: parseFloat(percent.toFixed(2)),
      function: item.functionHint || undefined,
    });

    remaining -= percent;
    if (remaining <= 0) break;
  }

  // If there's leftover, add to the first ingredient (usually water)
  if (remaining > 0 && formula.length > 0) {
    formula[0].percentage += parseFloat(remaining.toFixed(2));
  }

  // Calculate estimated properties (simplified)
  const estimatedProps = estimateProperties(formula, availableMaterials);

  // Compute match score against target (simplified)
  const matchScore = computeMatchScore(estimatedProps, target);

  return {
    formula,
    estimatedProperties: estimatedProps,
    matchScore,
    notes: [
      'Generated based on declared order and concentration hints.',
      `Used ${formula.length} ingredients.`,
    ],
  };
}

/**
 * Generate a baseline formula: water, surfactant, thickener, preservative.
 */
function generateBaselineFormula(
  mappedIngredients: Array<{
    line: IngredientDeclarationLine;
    mapping: IngredientMappingResult;
  }>,
  availableMaterials: RawMaterial[],
  target: TargetProductProfile,
  constraints: ReverseConstraintSet
): GeneratedCandidate | null {
  // We'll try to find materials that match common functions.
  const water = availableMaterials.find(m =>
    m.functions?.includes('solvent') &&
    (m.inciName?.toLowerCase().includes('aqua') || m.displayName.toLowerCase().includes('water'))
  );
  const surfactant = availableMaterials.find(m =>
    m.functions?.some(f =>
      ['anionic_surfactant', 'nonionic_surfactant', 'cationic_surfactant', 'amphoteric_surfactant'].includes(f)
    )
  );
  const thickener = availableMaterials.find(m =>
    m.functions?.includes('rheology_modifier')
  );
  const preservative = availableMaterials.find(m =>
    m.functions?.includes('preservative')
  );

  const selected: Array<{ material: RawMaterial; percentage: number; function: string }> = [];

  if (water) selected.push({ material: water, percentage: 60, function: 'solvent' });
  if (surfactant) selected.push({ material: surfactant, percentage: 15, function: surfactant.functions?.[0] || 'surfactant' });
  if (thickener) selected.push({ material: thickener, percentage: 3, function: 'rheology_modifier' });
  if (preservative) selected.push({ material: preservative, percentage: 0.5, function: 'preservative' });

  // Adjust to sum to 100% by scaling water
  let total = selected.reduce((sum, item) => sum + item.percentage, 0);
  if (total > 0 && total < 100) {
    const waterItem = selected.find(i => i.function === 'solvent');
    if (waterItem) {
      waterItem.percentage += 100 - total;
      total = 100;
    }
  }

  if (selected.length === 0) return null;

  const formula = selected.map(item => ({
    materialId: item.material.code,
    percentage: parseFloat(item.percentage.toFixed(2)),
    function: item.function,
  }));

  const estimatedProps = estimateProperties(formula, availableMaterials);
  const matchScore = computeMatchScore(estimatedProps, target);

  return {
    formula,
    estimatedProperties: estimatedProps,
    matchScore,
    notes: [
      'Generated baseline formula (water, surfactant, thickener, preservative).',
      `Adjusted to sum to 100%.`,
    ],
  };
}

/**
 * Generate a candidate by matching analytes to materials.
 */
function generateFromAnalytical(
  mappedIngredients: Array<{
    line: IngredientDeclarationLine;
    mapping: IngredientMappingResult;
  }>,
  availableMaterials: RawMaterial[],
  analysis: AnalyticalAnalysis,
  target: TargetProductProfile,
  constraints: ReverseConstraintSet
): GeneratedCandidate | null {
  // For simplicity, we'll just reuse the declared hints method but adjust based on analytes.
  // In a real implementation, we would map detected analytes to specific materials and quantify.
  return generateFromDeclaredHints(mappedIngredients, availableMaterials, target, constraints);
}

/**
 * Estimate properties of a formula based on its components.
 * Very simplified: just average of some properties weighted by fraction.
 */
function estimateProperties(
  formula: Array<{ materialId: string; percentage: number; function?: string }>,
  materials: ReadonlyArray<RawMaterial>
): Record<string, number> {
  const map = new Map<string, RawMaterial>();
  for (const mat of materials) {
    map.set(mat.code, mat);
  }

  let totalWeight = 0;
  const props: Record<string, number> = {};

  for (const comp of formula) {
    const mat = map.get(comp.materialId);
    if (!mat) continue;
    const weight = comp.percentage / 100; // fraction
    totalWeight += weight;

    // Example properties: active matter, pH (if available), viscosity (if available)
    // We'll just sum whatever numeric properties we have, but this is naive.
    // In reality, you'd need mixing rules.
    if (mat.activeMatterPercent !== undefined) {
      const amt = parseFloat(mat.activeMatterPercent);
      props.activeMatter = (props.activeMatter ?? 0) + amt * weight;
    }
    // For pH, we cannot simply average; we'll skip.
  }

  // Normalize by total weight (should be 1 if percentages sum to 100)
  if (totalWeight > 0) {
    for (const key of Object.keys(props)) {
      props[key] = props[key] / totalWeight;
    }
  }

  return props;
}

/**
 * Compute a simple match score between estimated properties and target.
 * Returns a value between 0 and 1.
 */
function computeMatchScore(
  estimated: Record<string, number>,
  target: TargetProductProfile
): number {
  let score = 0;
  let count = 0;

  // pH
  if (
    target.pHMin !== undefined &&
    target.pHMax !== undefined &&
    estimated.pH !== undefined
  ) {
    const mid = (target.pHMin + target.pHMax) / 2;
    const halfRange = (target.pHMax - target.pHMin) / 2;
    const diff = Math.abs(estimated.pH - mid);
    const pScore = Math.max(0, 1 - diff / halfRange); // 1 if on target, 0 if outside range
    score += pScore;
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

  return count > 0 ? score / count : 0.5; // default middle if no comparable props
}