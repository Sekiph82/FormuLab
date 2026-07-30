import { z } from 'zod';
import { decimalString } from './primitives';

/**
 * Reverse Formulation Study
 * A container for benchmark products, evidence, constraints, and generated candidates.
 */
export const ReverseFormulationStudy = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().optional(),
  projectId: z.string(),
  productFamilyCode: z.string(),
  status: z.enum([
    'draft',
    'evidence_collection',
    'mapping',
    'candidate_generation',
    'candidate_review',
    'laboratory_validation',
    'selected',
    'archived'
  ]),
  benchmarkProductIds: z.array(z.string()),
  targetProfileId: z.string().optional(),
  constraintSetId: z.string().optional(),
  selectedCandidateId: z.string().optional(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  revision: z.number()
});

export type ReverseFormulationStudy = z.infer<typeof ReverseFormulationStudy>;

/**
 * Benchmark Product
 * The competitor product being analyzed.
 */
export const BenchmarkProduct = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  brand: z.string().optional(),
  manufacturer: z.string().optional(),
  country: z.string().optional(),
  market: z.string().optional(),
  productCategory: z.string().optional(),
  productSubcategory: z.string().optional(),
  packagingType: z.string().optional(),
  declaredNetContent: z.number().optional(), // in grams or ml
  purchaseDate: z.string().optional(),
  batchCode: z.string().optional(),
  manufacturingDate: z.string().optional(),
  expiryDate: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type BenchmarkProduct = z.infer<typeof BenchmarkProduct>;

/**
 * Benchmark Evidence Item
 * Evidence collected about the benchmark product.
 */
export const BenchmarkEvidenceItem = z.object({
  id: z.string(),
  benchmarkProductId: z.string(),
  evidenceType: z.enum([
    'label',
    'ingredient_declaration',
    'technical_data_sheet',
    'safety_data_sheet',
    'certificate_of_analysis',
    'laboratory_report',
    'photograph',
    'supplier_statement',
    'marketplace_listing',
    'manual_observation',
    'other'
  ]),
  sourceName: z.string(),
  sourceReference: z.string().optional(),
  fileName: z.string().optional(),
  sha256: z.string().optional(),
  capturedAt: z.string(),
  capturedBy: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().optional()
});

export type BenchmarkEvidenceItem = z.infer<typeof BenchmarkEvidenceItem>;

/**
 * Ingredient Declaration Line
 * A single line from an ingredient declaration.
 */
export const IngredientDeclarationLine = z.object({
  id: z.string(),
  benchmarkProductId: z.string(),
  rawText: z.string(),
  normalizedText: z.string(),
  declaredOrder: z.number().int().nonnegative(),
  declaredName: z.string(),
  INCI: z.string().optional(),
  CAS: z.string().optional(),
  functionHint: z.string().optional(),
  concentrationHint: z.string().optional(),
  regulatoryNotes: z.string().optional(),
  mappingStatus: z.enum([
    'unmapped',
    'mapped',
    'conflicted',
    'rejected'
  ]),
  mappedMaterialIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().optional()
});

export type IngredientDeclarationLine = z.infer<typeof IngredientDeclarationLine>;

/**
 * Analytical Composition Result
 * Laboratory analysis of the benchmark product.
 */
export const AnalyticalCompositionResult = z.object({
  id: z.string(),
  benchmarkProductId: z.string(),
  analysisType: z.string(), // e.g., 'proximate', 'elemental', 'chromatography'
  analyte: z.string(),
  /** Measured value as an exact decimal string, same convention as money/percent elsewhere. */
  value: decimalString,
  unit: z.string(),
  method: z.string().optional(),
  detectionLimit: z.number().optional(),
  uncertainty: z.number().optional(),
  laboratory: z.string().optional(),
  sampleCode: z.string().optional(),
  testDate: z.string().optional(),
  sourceEvidenceId: z.string().optional(),
  verificationStatus: z.enum(['unverified', 'verified', 'disputed']).default('unverified'),
  notes: z.string().optional()
});

export type AnalyticalCompositionResult = z.infer<typeof AnalyticalCompositionResult>;

/**
 * Target Product Profile
 * Desired characteristics of the target product to be formulated.
 */
export const TargetProductProfile = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  productFamilyCode: z.string(),
  form: z.string().optional(), // e.g., 'liquid', 'cream', 'powder'
  appearance: z.string().optional(),
  color: z.string().optional(),
  odor: z.string().optional(),
  pHMin: z.number().optional(),
  pHMax: z.number().optional(),
  viscosityMin: z.number().optional(),
  viscosityMax: z.number().optional(),
  densityMin: z.number().optional(),
  densityMax: z.number().optional(),
  activeMatterMin: z.number().optional(),
  activeMatterMax: z.number().optional(),
  performanceTargets: z.record(z.string(), z.number()).optional(),
  sensoryTargets: z.record(z.string(), z.number()).optional(),
  costTargetPerKg: z.number().optional(),
  currency: z.string().optional(),
  packagingConstraints: z.string().optional(),
  market: z.string().optional(),
  jurisdictions: z.array(z.string()).default([]),
  claimsTargets: z.array(z.string()).optional(),
  excludedClaims: z.array(z.string()).optional(),
  notes: z.string().optional()
});

export type TargetProductProfile = z.infer<typeof TargetProductProfile>;

/**
 * Reverse Constraint Set
 * Constraints derived from evidence, targets, regulations, and resources.
 */
export const ReverseConstraintSet = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  studyId: z.string(),
  requiredMaterials: z.array(z.string()).default([]), // material IDs that must be present
  preferredMaterials: z.array(z.string()).default([]),
  excludedMaterials: z.array(z.string()).default([]),
  requiredFunctions: z.array(z.string()).default([]),
  minimumPercentages: z.record(z.string(), z.number()).default({}), // material ID -> min %
  maximumPercentages: z.record(z.string(), z.number()).default({}), // material ID -> max %
  totalActiveMatterRange: z.tuple([z.number(), z.number()]).optional(),
  pHRange: z.tuple([z.number(), z.number()]).optional(),
  viscosityRange: z.tuple([z.number(), z.number()]).optional(),
  densityRange: z.tuple([z.number(), z.number()]).optional(),
  costRange: z.tuple([z.number(), z.number()]).optional(),
  regulatoryRestrictions: z.record(z.string(), z.any()).optional(), // jurisdiction -> restrictions
  allergenRestrictions: z.array(z.string()).optional(),
  sustainabilityRequirements: z.array(z.string()).optional(),
  supplierRestrictions: z.array(z.string()).optional(),
  countryOfOriginRestrictions: z.array(z.string()).optional(),
  notes: z.string().optional()
});

export type ReverseConstraintSet = z.infer<typeof ReverseConstraintSet>;

/**
 * Ingredient Mapping
 * Mapping from an ingredient declaration line to a material in the FormuLab catalog.
 */
export const IngredientMapping = z.object({
  id: z.string(),
  studyId: z.string(),
  benchmarkProductId: z.string(),
  declarationLineId: z.string(),
  candidateMaterialId: z.string(),
  mappingMethod: z.enum([
    'exact_code',
    'exact_name',
    'INCI',
    'CAS',
    'synonym',
    'supplier_trade_name',
    'functional_equivalent',
    'analytical_inference',
    'manual'
  ]),
  confidence: z.number().min(0).max(1),
  evidence: z.string().optional(),
  assumptions: z.string().optional(),
  status: z.enum(['proposed', 'confirmed', 'rejected']).default('proposed'),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type IngredientMapping = z.infer<typeof IngredientMapping>;

/**
 * Substitution Rule
 * Known substitution rules between materials.
 */
export const SubstitutionRule = z.object({
  id: z.string(),
  sourceMaterialId: z.string(),
  targetMaterialId: z.string(),
  productFamilyCode: z.string().optional(),
  function: z.string().optional(),
  substitutionRatioMin: z.number().positive().optional(),
  substitutionRatioMax: z.number().positive().optional(),
  conditions: z.string().optional(),
  limitations: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().optional(),
  status: z.enum(['proposed', 'validated', 'deprecated']).default('proposed')
});

export type SubstitutionRule = z.infer<typeof SubstitutionRule>;

/**
 * Reverse Formula Candidate
 * A generated candidate formula for the benchmark product.
 */
export const ReverseFormulaCandidate = z.object({
  id: z.string(),
  studyId: z.string(),
  candidateCode: z.string(),
  name: z.string(),
  revision: z.number().int().nonnegative().default(0),
  generationMethod: z.string(),
  status: z.enum([
    'generated',
    'validated',
    'rejected',
    'selected'
  ]).default('generated'),
  formulaLines: z.array(z.object({
    materialId: z.string(),
    percentage: z.number().nonnegative(),
    function: z.string().optional(),
    notes: z.string().optional()
  })).nonempty(),
  processSteps: z.array(z.string()).optional(),
  predictedProperties: z.record(z.string(), z.number()).optional(),
  estimatedCost: z.number().optional(),
  regulatoryAssessment: z.object({
    status: z.enum(['not_assessed', 'assessment_in_progress', 'issues_found', 'candidate_compliant', 'requires_regulatory_review']),
    issues: z.array(z.string()).optional(),
    missingEvidence: z.array(z.string()).optional()
  }).optional(),
  evidenceCoverage: z.number().min(0).max(1).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  similarityScore: z.number().min(0).max(1).optional(),
  performanceScore: z.number().min(0).max(1).optional(),
  costScore: z.number().min(0).max(1).optional(),
  regulatoryScore: z.number().min(0).max(1).optional(),
  manufacturabilityScore: z.number().min(0).max(1).optional(),
  assumptions: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  createdAt: z.string(),
  createdBy: z.string()
});

export type ReverseFormulaCandidate = z.infer<typeof ReverseFormulaCandidate>;

/**
 * Candidate Score Explanation
 * Breakdown of a candidate's score.
 */
export const CandidateScoreExplanation = z.object({
  candidateId: z.string(),
  scoreType: z.enum([
    'evidence',
    'order',
    'analytical',
    'properties',
    'performance',
    'cost',
    'regulatory',
    'availability',
    'manufacturability',
    'confidence'
  ]),
  score: z.number().min(0).max(1),
  weight: z.number().positive(),
  reason: z.string(),
  evidenceReferences: z.array(z.string()).optional(),
  limitations: z.array(z.string()).optional()
});

export type CandidateScoreExplanation = z.infer<typeof CandidateScoreExplanation>;