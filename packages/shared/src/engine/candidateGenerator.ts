import { RawMaterial } from '../schemas/materials';
import { IngredientMappingResult } from './ingredientMapper';
import { AnalyticalAnalysis } from './analyticalInference';
import {
  ReverseConstraintSet,
  TargetProductProfile,
  IngredientDeclarationLine,
} from '../schemas/reverseFormulation';
import { computeTargetMatchScore } from './scoringModel';
import {
  referenceFormulationGenerationContextSchema,
  type ReferenceFormulationGenerationContext,
} from './referenceFormulationGenerationContext';
import { identityFieldReviewSchema, type IdentityFieldReview } from '../schemas/identityFieldReview';

/**
 * Input for candidate generation.
 */
export interface GenerationInput {
  /** Mapped ingredients from declaration lines. */
  mappedIngredients: Array<{
    line: IngredientDeclarationLine;
    mapping: IngredientMappingResult;
    /** Accepted/edited human identity review tied to this RawMaterial; only its reviewed snapshot may identify chemistry. */
    canonicalIdentityReview?: IdentityFieldReview;
  }>;
  /** Analytical insights. */
  analysis: AnalyticalAnalysis;
  /** Target product profile. */
  target: TargetProductProfile;
  /** Constraints derived from evidence, targets, regulations. */
  constraints: ReverseConstraintSet;
  /** Available materials in catalog (filtered by constraints). */
  availableMaterials: RawMaterial[];
  /** Optional reviewed, source-linked reference context. Generation remains valid without it. */
  referenceContext?: ReferenceFormulationGenerationContext;
  /** Exact normalized product-family key selected by reviewed identity resolution. */
  canonicalProductFamilyKey?: string;
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
  /** Source-linked dosage comparison. It is advisory metadata and never mutates the generated formula. */
  dosageGuidance?: Array<{
    asOf: string;
    materialId: string;
    canonicalChemistryId: string;
    functionAssignment: "unassigned_or_unreviewed";
    candidatePercent: number;
    typicalRangePercent: { lower: number; upper: number };
    observedRangePercent: { lower: number; upper: number };
    position: "below_typical_range" | "within_typical_range" | "above_typical_range";
    formulaCount: number;
    supplierCount: number;
    sourceRecordIds: string[];
    interpretation: "advisory_reviewed_empirical_dosage_not_hard_constraint_or_validated_recommendation";
  }>;
  /** Formula-presence evidence is descriptive; it never states that an ingredient is suitable or effective. */
  ingredientGuidance?: Array<{
    materialId: string;
    canonicalChemistryId: string;
    formulaCount: number;
    eligibleFormulaCount: number;
    formulaWeightedFrequency: number;
    supplierNeutralFrequency: number;
    supplierCount: number;
    sourceRecordIds: string[];
    interpretation: "reviewed_formula_appearance_only_not_suitability_safety_compatibility_or_efficacy";
  }>;
  /** Joint appearance in reviewed corpus formulas; never a compatibility or function assignment decision. */
  cooccurrenceGuidance?: Array<{
    materialId: string;
    canonicalChemistryId: string;
    pairKind: "material_pair" | "material_function_pair";
    otherId: string;
    formulaCount: number;
    eligibleFormulaCount: number;
    frequency: number;
    supplierCount: number;
    sourceRecordIds: string[];
    interpretation: "empirical_joint_appearance_only_not_compatibility_or_function_assignment";
  }>;
  /** Comparison against reviewed finished-product active claims; absent input active values remain unknown. */
  activeMatterGuidance?: Array<{
    asOf: string;
    candidatePercent?: number;
    candidateComparisonAvailable: boolean;
    unavailableReason?: "candidate_active_matter_incomplete";
    typicalRangePercent: { lower: number; upper: number };
    observedRangePercent: { lower: number; upper: number };
    position?: "below_typical_range" | "within_typical_range" | "above_typical_range";
    formulaCount: number;
    supplierCount: number;
    sourceRecordIds: string[];
    evidenceRefs: string[];
    interpretation: "reviewed_active_matter_claim_distribution_advisory_only_not_candidate_validation";
  }>;
  /** Reviewed component ranges are exposed, but no candidate projection is made without an exact composition mapping. */
  componentContributionGuidance?: Array<{
    asOf: string;
    canonicalChemistryId: string;
    minimumLowerBound: number;
    maximumUpperBound: number;
    medianRangePercent: { lower: number; upper: number };
    formulaCount: number;
    supplierCount: number;
    sourceRecordIds: string[];
    evidenceRefs: string[];
    candidateComparisonAvailable: false;
    unavailableReason: "candidate_component_composition_not_available";
    interpretation: "reviewed_component_distribution_not_candidate_composition_or_validation";
  }>;
  /** Reviewed supplier process evidence is descriptive; it is never a generated or required procedure. */
  processPatternGuidance?: Array<{
    asOf: string;
    patternKind: "action" | "action_sequence" | "phase" | "condition";
    patternId: string;
    sourceValue: string;
    sourceValues: string[];
    formulaCount: number;
    eligibleProcessFormulaCount: number;
    frequency: number;
    occurrenceCount: number;
    supplierCount: number;
    suppliers: Array<{ supplierId: string; formulaCount: number; share: number; sourceRecordIds: string[] }>;
    sourceRecordIds: string[];
    evidenceRefs: string[];
    interpretation: "reviewed_supplier_process_pattern_not_candidate_recipe_or_requirement";
  }>;
}

/** Result of one generation method: a candidate, or an honest reason it
 *  produced nothing. */
interface GenerationAttempt {
  candidate: GeneratedCandidate | null;
  /** Present when `candidate` is null: why this method produced nothing. */
  rejectionReason?: string;
}

/**
 * Generate formula candidates based on inputs.
 * This is a simplified generator that creates a few basic formulas.
 * Deterministic: identical input always produces identical, identically
 * ordered output — no randomness, no wall-clock dependence.
 */
export function generateCandidates(input: GenerationInput): GeneratedCandidate[] {
  const { mappedIngredients, analysis, target, constraints, availableMaterials } = input;
  const referenceContext = input.referenceContext === undefined
    ? undefined
    : referenceFormulationGenerationContextSchema.parse(input.referenceContext);

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

  const attempts: GenerationAttempt[] = [
    generateFromDeclaredHints(mappedIngredients, availableMaterials, target, constraints),
    generateBaselineFormula(mappedIngredients, availableMaterials, target, constraints),
    generateFromAnalytical(mappedIngredients, availableMaterials, analysis, target, constraints),
  ];

  const rejectionReasons: string[] = [];
  const candidates: GeneratedCandidate[] = [];
  const seenFormulas = new Set<string>();

  for (const attempt of attempts) {
    if (!attempt.candidate) {
      if (attempt.rejectionReason) rejectionReasons.push(attempt.rejectionReason);
      continue;
    }
    const signature = formulaSignature(attempt.candidate.formula);
    if (seenFormulas.has(signature)) {
      rejectionReasons.push(
        'A candidate with an identical formula was already generated by another method; not listed separately.'
      );
      continue;
    }
    seenFormulas.add(signature);
    candidates.push(attempt.candidate);
  }

  for (const candidate of candidates) {
    applyEmpiricalDosageGuidance(candidate, mappedIngredients, referenceContext, input.canonicalProductFamilyKey);
    applyEmpiricalIngredientGuidance(candidate, mappedIngredients, referenceContext, input.canonicalProductFamilyKey);
    applyEmpiricalContributionGuidance(candidate, input.availableMaterials, referenceContext, input.canonicalProductFamilyKey);
    applyEmpiricalProcessGuidance(candidate, referenceContext, input.canonicalProductFamilyKey);
  }

  // If we have no candidates, return an explicit, explained fallback rather
  // than a misleading empty-but-unexplained result.
  if (candidates.length === 0) {
    candidates.push({
      formula: [],
      estimatedProperties: {},
      matchScore: 0,
      notes: ['Could not generate any candidate formulas.', ...rejectionReasons],
    });
  }

  return candidates;
}

/** Attach reviewed family dosage context only through caller-supplied exact identity links. */
function applyEmpiricalDosageGuidance(
  candidate: GeneratedCandidate,
  mappedIngredients: GenerationInput["mappedIngredients"],
  referenceContext: ReferenceFormulationGenerationContext | undefined,
  canonicalProductFamilyKey: string | undefined,
): void {
  if (!referenceContext?.dosageGuidanceAvailable || canonicalProductFamilyKey !== referenceContext.productFamilyKey) return;
  const guidance: NonNullable<GeneratedCandidate["dosageGuidance"]> = [];
  for (const item of mappedIngredients) {
    const material = item.mapping.material;
    const canonicalChemistryId = reviewedCanonicalChemistryId(item.canonicalIdentityReview, material?.code);
    if (!material || !canonicalChemistryId) continue;
    const formulaLine = candidate.formula.find((line) => line.materialId === material.code);
    if (!formulaLine) continue;
    const matches = referenceContext.dosageGuidance.filter((entry) => entry.canonicalChemistryId === canonicalChemistryId
      && entry.functionAssignment === "unassigned_or_unreviewed"
      && entry.canonicalFunctionId === undefined);
    if (matches.length !== 1) continue;
    const sample = matches[0]!;
    const position = formulaLine.percentage < sample.typicalRangePercent.lower
      ? "below_typical_range"
      : formulaLine.percentage > sample.typicalRangePercent.upper
        ? "above_typical_range"
        : "within_typical_range";
    guidance.push({
      asOf: sample.asOf,
      materialId: material.code,
      canonicalChemistryId,
      functionAssignment: "unassigned_or_unreviewed",
      candidatePercent: formulaLine.percentage,
      typicalRangePercent: sample.typicalRangePercent,
      observedRangePercent: sample.observedRangePercent,
      position,
      formulaCount: sample.formulaCount,
      supplierCount: sample.supplierCount,
      sourceRecordIds: sample.sourceRecordIds,
      interpretation: "advisory_reviewed_empirical_dosage_not_hard_constraint_or_validated_recommendation",
    });
  }
  if (guidance.length === 0) return;
  candidate.dosageGuidance = guidance;
  candidate.notes.push(...guidance.map((item) => {
    const range = `${item.typicalRangePercent.lower.toFixed(2)}–${item.typicalRangePercent.upper.toFixed(2)}% w/w`;
    const position = item.position === "within_typical_range" ? "within"
      : item.position === "below_typical_range" ? "below" : "above";
    return `Reviewed reference dosage context for ${item.materialId} as of ${item.asOf}: ${item.candidatePercent.toFixed(2)}% w/w is ${position} the observed central range ${range} (${item.formulaCount} reviewed formula${item.formulaCount === 1 ? "" : "s"}, ${item.supplierCount} supplier${item.supplierCount === 1 ? "" : "s"}; sources: ${item.sourceRecordIds.join(", ")}). Advisory only; not a hard constraint, safety approval, or validated recommendation.`;
  }));
}

/** Resolve a dosage identity only from a named human's accepted RawMaterial canonical-identity review. */
function reviewedCanonicalChemistryId(review: IdentityFieldReview | undefined, materialCode: string | undefined): string | undefined {
  if (!review || !materialCode) return undefined;
  const parsedReview = identityFieldReviewSchema.safeParse(review);
  if (!parsedReview.success) return undefined;
  const acceptedReview = parsedReview.data;
  if (acceptedReview.targetRecordId !== materialCode || acceptedReview.field !== "canonical_identity"
    || (acceptedReview.decision !== "accepted" && acceptedReview.decision !== "edited")) return undefined;
  const snapshot = acceptedReview.decision === "edited" ? acceptedReview.reviewedValueSnapshot : acceptedReview.proposedValueSnapshot;
  if (!snapshot) return undefined;
  try {
    const identity = JSON.parse(snapshot) as { canonicalChemistryId?: unknown };
    return typeof identity.canonicalChemistryId === "string" && identity.canonicalChemistryId.trim()
      ? identity.canonicalChemistryId.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Attach only identity-bound family presence and co-occurrence context; never alter the formula or its hard gates. */
function applyEmpiricalIngredientGuidance(
  candidate: GeneratedCandidate,
  mappedIngredients: GenerationInput["mappedIngredients"],
  referenceContext: ReferenceFormulationGenerationContext | undefined,
  canonicalProductFamilyKey: string | undefined,
): void {
  if (!referenceContext?.available || canonicalProductFamilyKey !== referenceContext.productFamilyKey) return;
  const ingredientGuidance: NonNullable<GeneratedCandidate["ingredientGuidance"]> = [];
  const cooccurrenceGuidance: NonNullable<GeneratedCandidate["cooccurrenceGuidance"]> = [];
  const seenIngredients = new Set<string>();
  const seenPairs = new Set<string>();
  for (const item of mappedIngredients) {
    const material = item.mapping.material;
    const canonicalChemistryId = reviewedCanonicalChemistryId(item.canonicalIdentityReview, material?.code);
    if (!material || !canonicalChemistryId || !candidate.formula.some((line) => line.materialId === material.code)) continue;
    const prior = referenceContext.ingredientPriors.find((entry) => entry.canonicalChemistryId === canonicalChemistryId);
    if (!prior) continue;
    const ingredientKey = `${material.code}\u0000${canonicalChemistryId}`;
    if (!seenIngredients.has(ingredientKey)) {
      seenIngredients.add(ingredientKey);
      ingredientGuidance.push({
        materialId: material.code,
        canonicalChemistryId,
        formulaCount: prior.formulaCount,
        eligibleFormulaCount: prior.eligibleFormulaCount,
        formulaWeightedFrequency: prior.formulaWeightedFrequency,
        supplierNeutralFrequency: prior.supplierNeutralFrequency,
        supplierCount: prior.supplierCount,
        sourceRecordIds: prior.sourceRecordIds,
        interpretation: "reviewed_formula_appearance_only_not_suitability_safety_compatibility_or_efficacy",
      });
    }

    for (const pair of referenceContext.cooccurrenceGuidance) {
      if (pair.pairKind !== "material_pair" && pair.pairKind !== "material_function_pair") continue;
      const isFirst = pair.firstId === canonicalChemistryId;
      const isSecond = pair.secondId === canonicalChemistryId;
      if (!isFirst && !isSecond) continue;
      const otherId = isFirst ? pair.secondId : pair.firstId;
      const pairKey = `${material.code}\u0000${pair.pairKind}\u0000${canonicalChemistryId}\u0000${otherId}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      cooccurrenceGuidance.push({
        materialId: material.code,
        canonicalChemistryId,
        pairKind: pair.pairKind,
        otherId,
        formulaCount: pair.formulaCount,
        eligibleFormulaCount: pair.eligibleFormulaCount,
        frequency: pair.frequency,
        supplierCount: pair.supplierCount,
        sourceRecordIds: pair.sourceRecordIds,
        interpretation: "empirical_joint_appearance_only_not_compatibility_or_function_assignment",
      });
    }
  }
  if (ingredientGuidance.length > 0) {
    candidate.ingredientGuidance = ingredientGuidance;
    candidate.notes.push(...ingredientGuidance.map((item) =>
      `Reviewed ${referenceContext.productFamilyKey} formula appearance for ${item.materialId}: ${item.formulaCount}/${item.eligibleFormulaCount} eligible formulas (${(item.formulaWeightedFrequency * 100).toFixed(1)}% formula-weighted; ${(item.supplierNeutralFrequency * 100).toFixed(1)}% equal-supplier average across ${item.supplierCount} suppliers; source records: ${item.sourceRecordIds.join(", ")}). Appearance only; this does not establish suitability, safety, compatibility, or efficacy.`));
  }
  if (cooccurrenceGuidance.length > 0) {
    candidate.cooccurrenceGuidance = cooccurrenceGuidance;
    candidate.notes.push(...cooccurrenceGuidance.map((item) =>
      `Reviewed ${referenceContext.productFamilyKey} formulas jointly included ${item.materialId} and ${item.otherId} in ${item.formulaCount}/${item.eligibleFormulaCount} eligible formulas (${(item.frequency * 100).toFixed(1)}%; ${item.supplierCount} suppliers; source records: ${item.sourceRecordIds.join(", ")}). Joint appearance only; it is not a compatibility result or function assignment.`));
  }
}

/** Compare candidate active matter only when every formula line has an explicitly known catalog value. */
function applyEmpiricalContributionGuidance(
  candidate: GeneratedCandidate,
  availableMaterials: RawMaterial[],
  referenceContext: ReferenceFormulationGenerationContext | undefined,
  canonicalProductFamilyKey: string | undefined,
): void {
  if (!referenceContext?.available || canonicalProductFamilyKey !== referenceContext.productFamilyKey
    || !referenceContext.contributionGuidanceAvailable) return;
  const activeSamples = referenceContext.contributionGuidance.filter((sample) => sample.quantityKind === "active_matter_claim");
  const componentSamples = referenceContext.contributionGuidance.filter((sample) => sample.quantityKind === "component_contribution" && sample.canonicalChemistryId);
  if (activeSamples.length > 0) {
    let candidateActivePercent = 0;
    let complete = candidate.formula.length > 0
      && Math.abs(candidate.formula.reduce((sum, line) => sum + line.percentage, 0) - 100) < 0.01;
    for (const line of candidate.formula) {
      const material = availableMaterials.find((item) => item.code === line.materialId);
      const active = material?.activeMatterPercent === undefined ? Number.NaN : Number(material.activeMatterPercent);
      if (!material || material.activeMatterState !== "known" || !Number.isFinite(active) || active < 0 || active > 100
        || !Number.isFinite(line.percentage) || line.percentage < 0 || line.percentage > 100) {
        complete = false;
        break;
      }
      candidateActivePercent += line.percentage * active / 100;
    }
    candidate.activeMatterGuidance = activeSamples.map((sample) => {
      const typicalRangePercent = { lower: sample.lowerBoundQuantiles.p50, upper: sample.upperBoundQuantiles.p50 };
      const candidatePercent = complete ? Number(candidateActivePercent.toFixed(6)) : undefined;
      const position = candidatePercent === undefined ? undefined
        : candidatePercent < typicalRangePercent.lower ? "below_typical_range"
          : candidatePercent > typicalRangePercent.upper ? "above_typical_range" : "within_typical_range";
      candidate.notes.push(candidatePercent === undefined
        ? `Reviewed ${referenceContext.productFamilyKey} active-matter claims are available (${sample.formulaCount} formulas), but candidate active matter cannot be compared because at least one formula ingredient has no known active-matter value. Unknown values were not treated as zero.`
        : `Candidate active matter (${candidatePercent.toFixed(2)}%) is ${position!.replace(/_/gu, " ")} the reviewed ${referenceContext.productFamilyKey} typical claim range (${typicalRangePercent.lower}-${typicalRangePercent.upper}%; ${sample.formulaCount} formulas; source records: ${sample.sourceRecordIds.join(", ")}). This is advisory context, not candidate validation.`);
      return {
        asOf: sample.asOf,
        ...(candidatePercent !== undefined ? { candidatePercent, position } : { unavailableReason: "candidate_active_matter_incomplete" as const }),
        candidateComparisonAvailable: candidatePercent !== undefined,
        typicalRangePercent,
        observedRangePercent: { lower: sample.minimumLowerBound, upper: sample.maximumUpperBound },
        formulaCount: sample.formulaCount,
        supplierCount: sample.supplierCount,
        sourceRecordIds: sample.sourceRecordIds,
        evidenceRefs: sample.evidenceRefs,
        interpretation: "reviewed_active_matter_claim_distribution_advisory_only_not_candidate_validation",
      };
    });
  }
  if (componentSamples.length > 0) {
    candidate.componentContributionGuidance = componentSamples.map((sample) => ({
      asOf: sample.asOf,
      canonicalChemistryId: sample.canonicalChemistryId!,
      minimumLowerBound: sample.minimumLowerBound,
      maximumUpperBound: sample.maximumUpperBound,
      medianRangePercent: { lower: sample.lowerBoundQuantiles.p50, upper: sample.upperBoundQuantiles.p50 },
      formulaCount: sample.formulaCount,
      supplierCount: sample.supplierCount,
      sourceRecordIds: sample.sourceRecordIds,
      evidenceRefs: sample.evidenceRefs,
      candidateComparisonAvailable: false,
      unavailableReason: "candidate_component_composition_not_available",
      interpretation: "reviewed_component_distribution_not_candidate_composition_or_validation",
    }));
    candidate.notes.push(`Reviewed component-contribution ranges exist for ${componentSamples.length} component identity or identities, but candidate component amounts are unavailable because the generator input has no source-reviewed raw-material composition mapping. SDS component ranges were not assumed to represent candidate composition.`);
  }
}

/** Attach exact-family reviewed process patterns as historical context, without proposing process controls. */
function applyEmpiricalProcessGuidance(
  candidate: GeneratedCandidate,
  referenceContext: ReferenceFormulationGenerationContext | undefined,
  canonicalProductFamilyKey: string | undefined,
): void {
  if (!referenceContext?.available || !referenceContext.processGuidanceAvailable
    || canonicalProductFamilyKey !== referenceContext.productFamilyKey) return;
  candidate.processPatternGuidance = referenceContext.processGuidance.map((pattern) => ({
    asOf: pattern.asOf,
    patternKind: pattern.patternKind,
    patternId: pattern.patternId,
    sourceValue: pattern.sourceValue,
    sourceValues: pattern.sourceValues,
    formulaCount: pattern.formulaCount,
    eligibleProcessFormulaCount: pattern.eligibleProcessFormulaCount,
    frequency: pattern.frequency,
    occurrenceCount: pattern.occurrenceCount,
    supplierCount: pattern.supplierCount,
    suppliers: pattern.suppliers,
    sourceRecordIds: pattern.sourceRecordIds,
    evidenceRefs: pattern.evidenceRefs,
    interpretation: "reviewed_supplier_process_pattern_not_candidate_recipe_or_requirement",
  }));
  candidate.notes.push(`Reviewed supplier process examples are available for ${referenceContext.productFamilyKey} (${candidate.processPatternGuidance.length} patterns; sources: ${[...new Set(candidate.processPatternGuidance.flatMap((pattern) => pattern.sourceRecordIds))].join(", ")}). They describe cited historical evidence only; no missing temperatures, times, speeds, or required process steps were inferred.`);
}

/** Canonical, order-independent identity of a formula: same materials at
 *  the same rounded percentages are the same candidate, regardless of
 *  which generation method produced them or what it labeled the function as. */
function formulaSignature(formula: GeneratedCandidate['formula']): string {
  return formula
    .map(l => `${l.materialId}:${l.percentage.toFixed(2)}`)
    .sort()
    .join('|');
}

/** An invalid/non-finite number is not a valid percentage — treat as 0
 *  rather than propagating NaN/Infinity into a formula. */
function roundTo2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Round each line to 2dp and push any rounding residual onto the largest
 *  line, so the formula's total matches `targetTotal` exactly instead of
 *  drifting by a cent from independent per-line rounding. Never produces a
 *  negative percentage. */
function normalizeToTotal(
  formula: GeneratedCandidate['formula'],
  targetTotal: number
): GeneratedCandidate['formula'] {
  if (formula.length === 0) return formula;
  const rounded = formula.map(l => ({ ...l, percentage: Math.max(0, roundTo2(l.percentage)) }));
  const sum = rounded.reduce((s, l) => s + l.percentage, 0);
  const residual = roundTo2(targetTotal - sum);
  if (residual !== 0) {
    let largestIndex = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i].percentage > rounded[largestIndex].percentage) largestIndex = i;
    }
    rounded[largestIndex] = {
      ...rounded[largestIndex],
      percentage: Math.max(0, roundTo2(rounded[largestIndex].percentage + residual)),
    };
  }
  return rounded;
}

/** Checks a finished formula against the study's constraints. Returns a
 *  human-readable violation, or null if the formula is acceptable. We
 *  reject rather than silently reflow percentages to satisfy constraints —
 *  that would require real optimization, out of scope here. */
function validateAgainstConstraints(
  formula: GeneratedCandidate['formula'],
  constraints: ReverseConstraintSet
): string | null {
  for (const line of formula) {
    const min = constraints.minimumPercentages[line.materialId];
    if (min !== undefined && line.percentage < min) {
      return `${line.materialId} at ${line.percentage.toFixed(2)}% is below the required minimum of ${min}%.`;
    }
    const max = constraints.maximumPercentages[line.materialId];
    if (max !== undefined && line.percentage > max) {
      return `${line.materialId} at ${line.percentage.toFixed(2)}% exceeds the maximum of ${max}%.`;
    }
  }
  for (const required of constraints.requiredMaterials) {
    if (!formula.some(l => l.materialId === required)) {
      return `Required material ${required} is missing from the formula.`;
    }
  }
  return null;
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
): GenerationAttempt {
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
    if (constraints.excludedMaterials.includes(mat.code)) continue;
    materialsWithCandidates.push({
      material: mat,
      declaredName: item.line.declaredName,
      order: item.line.declaredOrder,
      concentrationHint: item.line.concentrationHint,
      functionHint: item.line.functionHint,
    });
  }

  if (materialsWithCandidates.length === 0) {
    return {
      candidate: null,
      rejectionReason:
        'Declared-order candidate: every mapped ingredient was unmapped or excluded by constraints.',
    };
  }

  // Sort by declared order (stable: ties keep declaration order).
  materialsWithCandidates.sort((a, b) => a.order - b.order);

  // Assign percentages: if we have concentration hints, try to use them; otherwise distribute evenly.
  const total = 100;
  let remaining = total;
  const formula: GeneratedCandidate['formula'] = [];

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
          if (parts.length === 2 && parts.every(Number.isFinite)) {
            const min = Math.min(parts[0], parts[1]);
            const max = Math.max(parts[0], parts[1]);
            percent = (min + max) / 2;
          } else {
            percent = val;
          }
        } else {
          percent = val;
        }
        if (!Number.isFinite(percent)) percent = 0;
        // Clamp to remaining
        if (percent > remaining) percent = remaining;
      }
    }
    if (percent === 0 && remaining > 0) {
      // Blank/unparseable hints are not treated as "0%" — distribute the
      // remaining budget evenly among the items still to be placed.
      const remainingCount = materialsWithCandidates.length - materialsWithCandidates.indexOf(item);
      percent = remaining / remainingCount;
    }
    // Ensure we don't go negative or non-finite
    if (!Number.isFinite(percent) || percent < 0) percent = 0;
    if (percent > remaining) percent = remaining;

    // Respect a per-material constraint ceiling, if one is declared.
    const maxAllowed = constraints.maximumPercentages[item.material.code];
    if (maxAllowed !== undefined && percent > maxAllowed) percent = maxAllowed;

    formula.push({
      materialId: item.material.code,
      percentage: roundTo2(percent),
      function: item.functionHint || undefined,
    });

    remaining -= percent;
    if (remaining <= 0) break;
  }

  // If there's leftover, add to the first ingredient (usually water)
  if (remaining > 0 && formula.length > 0) {
    formula[0] = { ...formula[0], percentage: roundTo2(formula[0].percentage + remaining) };
  }

  const normalized = normalizeToTotal(formula, total);

  const violation = validateAgainstConstraints(normalized, constraints);
  if (violation) {
    return { candidate: null, rejectionReason: `Declared-order candidate rejected: ${violation}` };
  }

  const estimatedProps = estimateProperties(normalized, availableMaterials);
  const matchScore = computeTargetMatchScore(estimatedProps, target);

  return {
    candidate: {
      formula: normalized,
      estimatedProperties: estimatedProps,
      matchScore,
      notes: [
        'Generated based on declared order and concentration hints.',
        `Used ${normalized.length} ingredients.`,
      ],
    },
  };
}

/**
 * Generate a baseline formula: water, surfactant, thickener, preservative.
 */
function generateBaselineFormula(
  // Reserved: the baseline method deliberately ignores declared ingredients
  // (it builds a generic water/surfactant/thickener/preservative skeleton),
  // but keeps the same parameter shape as the other generation methods so
  // `generateCandidates` can call all three uniformly.
  _mappedIngredients: Array<{
    line: IngredientDeclarationLine;
    mapping: IngredientMappingResult;
  }>,
  availableMaterials: RawMaterial[],
  target: TargetProductProfile,
  constraints: ReverseConstraintSet
): GenerationAttempt {
  const usableMaterials = availableMaterials.filter(m => !constraints.excludedMaterials.includes(m.code));

  // We'll try to find materials that match common functions.
  const water = usableMaterials.find(m =>
    m.functions?.includes('solvent') &&
    (m.inciName?.toLowerCase().includes('aqua') || m.displayName.toLowerCase().includes('water'))
  );
  const surfactant = usableMaterials.find(m =>
    m.functions?.some(f =>
      ['anionic_surfactant', 'nonionic_surfactant', 'cationic_surfactant', 'amphoteric_surfactant'].includes(f)
    )
  );
  const thickener = usableMaterials.find(m =>
    m.functions?.includes('rheology_modifier')
  );
  const preservative = usableMaterials.find(m =>
    m.functions?.includes('preservative')
  );

  const selected: Array<{ material: RawMaterial; percentage: number; function: string }> = [];

  if (water) selected.push({ material: water, percentage: 60, function: 'solvent' });
  if (surfactant) selected.push({ material: surfactant, percentage: 15, function: surfactant.functions?.[0] || 'surfactant' });
  if (thickener) selected.push({ material: thickener, percentage: 3, function: 'rheology_modifier' });
  if (preservative) selected.push({ material: preservative, percentage: 0.5, function: 'preservative' });

  if (selected.length === 0) {
    return {
      candidate: null,
      rejectionReason:
        'Baseline candidate: no solvent, surfactant, rheology modifier, or preservative found in the available (non-excluded) material catalog.',
    };
  }

  // Adjust to sum to 100% by scaling water, when a water line exists.
  let total = selected.reduce((sum, item) => sum + item.percentage, 0);
  if (total > 0 && total < 100) {
    const waterItem = selected.find(i => i.function === 'solvent');
    if (waterItem) {
      waterItem.percentage += 100 - total;
      total = 100;
    }
  }

  const rawFormula: GeneratedCandidate['formula'] = selected.map(item => ({
    materialId: item.material.code,
    percentage: roundTo2(item.percentage),
    function: item.function,
  }));

  const formula = normalizeToTotal(rawFormula, roundTo2(total));

  const violation = validateAgainstConstraints(formula, constraints);
  if (violation) {
    return { candidate: null, rejectionReason: `Baseline candidate rejected: ${violation}` };
  }

  const estimatedProps = estimateProperties(formula, availableMaterials);
  const matchScore = computeTargetMatchScore(estimatedProps, target);

  return {
    candidate: {
      formula,
      estimatedProperties: estimatedProps,
      matchScore,
      notes: [
        'Generated baseline formula (water, surfactant, thickener, preservative).',
        total >= 100
          ? 'Adjusted to sum to 100%.'
          : `Total is ${total.toFixed(2)}% — could not reach 100% with the available baseline materials.`,
      ],
    },
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
): GenerationAttempt {
  if (analysis.totalAnalytes === 0) {
    return {
      candidate: null,
      rejectionReason:
        'Analytical candidate: no analytical composition data was provided, so no analytical-based candidate was attempted.',
    };
  }
  // No analyte-to-material quantification model exists yet (out of scope for
  // this session) — reuse the declared-hints method rather than fabricate a
  // distinct analytical formula. `generateCandidates` drops this candidate
  // as a duplicate if it ends up identical to another one.
  const base = generateFromDeclaredHints(mappedIngredients, availableMaterials, target, constraints);
  if (!base.candidate) {
    return {
      candidate: null,
      rejectionReason: base.rejectionReason
        ? `Analytical candidate: ${base.rejectionReason}`
        : 'Analytical candidate: underlying declared-order generation failed.',
    };
  }
  return {
    candidate: {
      ...base.candidate,
      notes: [
        ...base.candidate.notes,
        'Analytical data is present but no analyte-to-material quantification model exists yet; this matches the declared-order candidate.',
      ],
    },
  };
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
      if (Number.isFinite(amt)) {
        props.activeMatter = (props.activeMatter ?? 0) + amt * weight;
      }
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
