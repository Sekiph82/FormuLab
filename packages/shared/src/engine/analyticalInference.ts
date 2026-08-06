import { AnalyticalCompositionResult, TargetProductProfile } from '../schemas/reverseFormulation';
import { MaterialFunction } from '../schemas/formulation';

/**
 * Analyze a set of analytical composition results and derive summary metrics.
 */
export interface AnalyticalAnalysis {
  /** Total detected analytes count. */
  totalAnalytes: number;
  /** Sum of concentrations (if same unit) - only meaningful if same analyte and unit. */
  totalConcentration: number;
  /** Average concentration. */
  averageConcentration: number;
  /** Detected analytes grouped by type. */
  analytesByType: Record<string, number[]>;
  /** Estimated pH if pH-related analytes present. */
  estimatedPh: number | null;
  /** Estimated active matter if active ingredient analytes present. */
  estimatedActiveMatter: number | null;
  /** Notes on the analysis. */
  notes: string[];
}

/**
 * Result of inferring functional contributions from analytical data.
 */
export interface AnalyticalInferenceResult {
  /** The analyte that was analyzed. */
  analyte: string;
  /** The measured value. */
  value: number;
  /** The unit of measurement. */
  unit: string;
  /** Inferred functional group(s) that could explain the analyte. */
  inferredFunctions: MaterialFunction[];
  /** Confidence in the inference (0-1). */
  confidence: number;
  /** Explanation of the reasoning. */
  explanation: string;
}

/**
 * Known analyte-to-function mappings.
 * In a real system, this would be extensible and based on a knowledge base.
 */
const ANALYTE_FUNCTION_MAP: Record<
  string,
  { functions: MaterialFunction[]; confidence: number; explanation: string }
> = {
  // Example: Sodium (Na+) often indicates anionic surfactants or salts
  'Na': {
    functions: ['anionic_surfactant', 'builder', 'chelating_agent'],
    confidence: 0.7,
    explanation: 'Sodium detection suggests presence of sodium-containing ingredients such as surfactants or builders.',
  },
  'K': {
    functions: ['anionic_surfactant', 'builder'],
    confidence: 0.6,
    explanation: 'Potassium detection suggests potassium-containing ingredients.',
  },
  'Cl': {
    functions: ['anionic_surfactant', 'preservative', 'ph_adjuster'],
    confidence: 0.6,
    explanation: 'Chloride detection may indicate chlorinated surfactants, preservatives, or pH-adjusting agents.',
  },
  'S': {
    functions: ['anionic_surfactant', 'oxygen_donor', 'bleaching_agent'],
    confidence: 0.6,
    explanation: 'Sulfur detection may indicate sulfur-containing compounds like sulfates or peroxides.',
  },
  'P': {
    functions: ['builder', 'chelating_agent', 'oxygen_donor'],
    confidence: 0.7,
    explanation: 'Phosphorus detection suggests phosphates (builders, chelating agents) or peroxides.',
  },
  'Fe': {
    functions: ['oxygen_donor', 'bleaching_agent'],
    confidence: 0.5,
    explanation: 'Iron detection may indicate iron-based catalysts or oxygen donors.',
  },
  // Organic markers (simplified)
  'C': {
    functions: ['nonionic_surfactant', 'emollient', 'fragrance', 'preservative'],
    confidence: 0.3,
    explanation: 'Carbon detection is generic; indicates organic content but not specific function.',
  },
  'O': {
    functions: ['nonionic_surfactant', 'emollient', 'humectant', 'preservative'],
    confidence: 0.3,
    explanation: 'Oxygen detection is common in many organic compounds.',
  },
  // Specific compounds (if we had exact identification)
  'Sodium Lauryl Sulfate': {
    functions: ['anionic_surfactant'],
    confidence: 0.9,
    explanation: 'Direct detection of SLS indicates anionic surfactant.',
  },
  'Ethanol': {
    functions: ['solvent', 'preservative'],
    confidence: 0.8,
    explanation: 'Ethanol detected acts as a solvent and preservative.',
  },
};

/**
 * Perform basic inference from analytical results.
 * This is a simplified version; real implementation would use known conversion factors.
 */
export function analyzeAnalyticalResults(
  results: ReadonlyArray<AnalyticalCompositionResult>
): AnalyticalAnalysis {
  if (!results.length) {
    return {
      totalAnalytes: 0,
      totalConcentration: 0,
      averageConcentration: 0,
      analytesByType: {},
      estimatedPh: null,
      estimatedActiveMatter: null,
      notes: ['No analytical data provided.'],
    };
  }

  const analytesByType: Record<string, number[]> = {};
  let totalConcentration = 0;
  let phValues: number[] = [];
  let activeMatterValues: number[] = [];

  for (const res of results) {
    const value = parseFloat(res.value);
    if (isNaN(value)) continue;

    // Group by analyte
    if (!analytesByType[res.analyte]) {
      analytesByType[res.analyte] = [];
    }
    analytesByType[res.analyte].push(value);

    totalConcentration += value;

    // Simple heuristics: if analyte name suggests pH (e.g., "H+", "pH")
    if (
      res.analyte.toLowerCase().includes('h+') ||
      res.analyte.toLowerCase() === 'ph' ||
      res.analyte.toLowerCase().includes('acidity')
    ) {
      // Assume the value is pH if unit is pH or if value is in typical pH range
      if (res.unit?.toLowerCase() === 'ph' || (value >= 0 && value <= 14)) {
        phValues.push(value);
      }
    }

    // If analyte is known active ingredient (we could have a list, but for demo we'll assume any analyte with % unit)
    if (
      res.unit?.toLowerCase() === '%' ||
      res.unit?.toLowerCase() === 'g/100g' ||
      res.unit?.toLowerCase() === 'mg/g'
    ) {
      activeMatterValues.push(value);
    }
  }

  const averageConcentration = totalConcentration / results.length;

  // Estimate pH as average of pH-related readings
  const estimatedPh = phValues.length > 0 ? phValues.reduce((a, b) => a + b) / phValues.length : null;

  // Estimate active matter as sum of concentrations that look like active ingredients
  const estimatedActiveMatter =
    activeMatterValues.length > 0
      ? activeMatterValues.reduce((a, b) => a + b)
      : null;

  const notes: string[] = [];
  if (phValues.length === 0) {
    notes.push('No pH-related analytes detected.');
  }
  if (activeMatterValues.length === 0) {
    notes.push('No clear active ingredient analytes detected (based on unit heuristics).');
  }

  return {
    totalAnalytes: results.length,
    totalConcentration,
    averageConcentration,
    analytesByType,
    estimatedPh,
    estimatedActiveMatter,
    notes,
  };
}

/**
 * Analyze an analytical result and infer possible functional contributions.
 * @param result The analytical composition result.
 * @returns An inference result with possible functions and confidence.
 */
export function inferFunctionFromAnalyte(
  result: AnalyticalCompositionResult
): AnalyticalInferenceResult {
  const { analyte, value, unit } = result;
  const key = analyte.trim();

  // Direct match
  if (ANALYTE_FUNCTION_MAP[key]) {
    const { functions, confidence, explanation } = ANALYTE_FUNCTION_MAP[key];
    return {
      analyte: key,
      value: Number(value),
      unit,
      inferredFunctions: functions,
      confidence,
      explanation,
    };
  }

  // Try to match by element symbol (first one or two letters)
  const elementMatch = key.match(/^([A-Z][a-z]?)/);
  if (elementMatch) {
    const element = elementMatch[1];
    if (ANALYTE_FUNCTION_MAP[element]) {
      const { functions, confidence, explanation } = ANALYTE_FUNCTION_MAP[element];
      return {
        analyte: key,
        value: Number(value),
        unit,
        inferredFunctions: functions,
        confidence: confidence * 0.8, // lower confidence for elemental inference
        explanation: `Elemental ${element} detected: ${explanation}`,
      };
    }
  }

  // Fallback: unknown analyte
  return {
    analyte: key,
    value: Number(value),
    unit,
    inferredFunctions: [],
    confidence: 0.1,
    explanation: `No known inference rules for analyte "${key}".`,
  };
}

/**
 * Analyze multiple analytical results and aggregate inferred functions.
 * @param results Array of analytical results.
 * @returns Aggregated inference with combined confidence and list of functions.
 */
export function inferFunctionsFromAnalytics(
  results: AnalyticalCompositionResult[]
): {
  /** Unique inferred functions across all results. */
  functions: Set<MaterialFunction>;
  /** Average confidence across results. */
  averageConfidence: number;
  /** Detailed results per analyte. */
  details: AnalyticalInferenceResult[];
} {
  const funcSet = new Set<MaterialFunction>();
  let totalConf = 0;
  const details: AnalyticalInferenceResult[] = [];

  for (const result of results) {
    const inf = inferFunctionFromAnalyte(result);
    details.push(inf);
    totalConf += inf.confidence;
    for (const func of inf.inferredFunctions) {
      funcSet.add(func);
    }
  }

  const avgConf = results.length > 0 ? totalConf / results.length : 0;

  return {
    functions: funcSet,
    averageConfidence: avgConf,
    details,
  };
}

/**
 * Compare analytical analysis results against a target product profile.
 * Returns a set of gaps and recommendations.
 */
export function compareToTargetProfile(
  analysis: AnalyticalAnalysis,
  target: TargetProductProfile
): {
  matches: string[];
  gaps: string[];
  recommendations: string[];
} {
  const matches: string[] = [];
  const gaps: string[] = [];
  const recommendations: string[] = [];

  // pH check
  if (analysis.estimatedPh !== null) {
    const phMin = target.pHMin ?? null;
    const phMax = target.pHMax ?? null;
    if (phMin !== null && phMax !== null) {
      if (analysis.estimatedPh >= phMin && analysis.estimatedPh <= phMax) {
        matches.push(
          `pH ${analysis.estimatedPh.toFixed(1)} is within target range ${phMin}-${phMax}.`
        );
      } else {
        gaps.push(
          `pH ${analysis.estimatedPh.toFixed(
            1
          )} is outside target range ${phMin}-${phMax}.`
        );
        if (analysis.estimatedPh < phMin) {
          recommendations.push(
            `Consider adding a pH increaser to reach minimum pH of ${phMin}.`
          );
        } else {
          recommendations.push(
            `Consider adding a pH reducer to reach maximum pH of ${phMax}.`
          );
        }
      }
    }
  }

  // Active matter check (if we have estimate and target has active matter range)
  if (
    analysis.estimatedActiveMatter !== null &&
    target.activeMatterMin !== undefined &&
    target.activeMatterMax !== undefined
  ) {
    const amt = analysis.estimatedActiveMatter;
    const min = target.activeMatterMin;
    const max = target.activeMatterMax;
    if (amt >= min && amt <= max) {
      matches.push(
        `Active matter ${amt.toFixed(1)}% is within target range ${min}-${max}%.`
      );
    } else {
      gaps.push(
        `Active matter ${amt.toFixed(
          1
        )}% is outside target range ${min}-${max}%.`
      );
      if (amt < min) {
        recommendations.push(
          `Consider increasing active ingredient concentration to reach minimum ${min}%.`
        );
      } else {
        recommendations.push(
          `Consider decreasing active ingredient concentration to stay below maximum ${max}%.`
        );
      }
    }
  }

  // If we have no specific matches, add a general note
  if (matches.length === 0 && gaps.length === 0) {
    matches.push(
      'No specific quantitative targets matched; consider reviewing analytical methods.'
    );
  }

  return { matches, gaps, recommendations };
}