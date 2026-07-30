import { IngredientDeclarationLine } from '../schemas/reverseFormulation';
import { RawMaterial } from '../schemas/materials';

/**
 * Result of attempting to map an ingredient declaration line to a material.
 */
export interface IngredientMappingResult {
  /** The matched material, if any. */
  material: RawMaterial | null;
  /** Confidence score between 0 and 1. */
  confidence: number;
  /** Reasoning for the match. */
  reason: string;
  /** Alternative matches (if any). */
  alternatives: Array<{ material: RawMaterial; confidence: number; reason: string }>;
}

/**
 * Normalize a string for comparison: lowercase, trim, remove extra spaces.
 */
function normalize(str: string): string {
  return str.toLowerCase().trim();
}

/**
 * Compute similarity between two strings using a simple token overlap metric.
 * Returns a value between 0 and 1.
 */
function stringSimilarity(a: string, b: string): number {
  const aTokens = new Set(normalize(a).split(/\s+/));
  const bTokens = new Set(normalize(b).split(/\s+/));
  if (aTokens.size === 0 && bTokens.size === 0) return 1.0;
  const intersection = [...aTokens].filter(t => bTokens.has(t));
  const union = new Set([...aTokens, ...bTokens]);
  return intersection.length / union.size;
}

/**
 * Check if two CAS numbers match (ignoring whitespace and leading zeros).
 */
function casMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  // Normalize: remove leading zeros from each segment
  const norm = (s: string) => s.split('-').map(part => parseInt(part, 10).toString()).join('-');
  return norm(a) === norm(b);
}

/**
 * Find the best material match for an ingredient declaration line.
 *
 * @param line The parsed ingredient declaration line.
 * @param materials Array of all available materials (from the RawMaterial collection).
 * @returns Mapping result with confidence and reasoning.
 */
export function mapIngredientToMaterial(
  line: IngredientDeclarationLine,
  materials: ReadonlyArray<RawMaterial>
): IngredientMappingResult {
  if (!materials.length) {
    return {
      material: null,
      confidence: 0,
      reason: 'No materials available in catalog.',
      alternatives: [],
    };
  }

  const candidates: Array<{
    material: RawMaterial;
    score: number;
    reason: string;
  }> = [];

  // Prepare lookup values from the declaration line
  const declInci = line.INCI?.trim();
  const declCas = line.CAS?.trim();
  const declName = line.declaredName.trim();
  const declFunctionHint = line.functionHint?.toLowerCase().trim();

  for (const mat of materials) {
    let score = 0;
    const reasons: string[] = [];

    // 1. Exact INCI match (highest confidence)
    if (declInci && mat.inciName && declInci.toLowerCase() === mat.inciName.toLowerCase()) {
      score += 0.5;
      reasons.push('INCI match');
    }

    // 2. Exact CAS match (high confidence)
    if (declCas) {
      const matCasList = mat.casNumbers ?? [];
      const casMatchFound = matCasList.some(cas => casMatch(declCas, cas));
      if (casMatchFound) {
        score += 0.4;
        reasons.push('CAS match');
      }
    }

    // 3. Name similarity (declared name vs material displayName or tradeName)
    const nameSimilarity = stringSimilarity(declName, mat.displayName);
    if (nameSimilarity > 0.8) {
      score += 0.3 * nameSimilarity;
      reasons.push(`name similarity ${(nameSimilarity * 100).toFixed(0)}%`);
    } else if (declName && mat.tradeName) {
      const tradeNameSimilarity = stringSimilarity(declName, mat.tradeName);
      if (tradeNameSimilarity > 0.8) {
        score += 0.3 * tradeNameSimilarity;
        reasons.push(`trade name similarity ${(tradeNameSimilarity * 100).toFixed(0)}%`);
      }
    }

    // 4. Function hint matching
    if (declFunctionHint && mat.functions?.length) {
      const funcMatch = mat.functions.some(f =>
        f.toLowerCase().includes(declFunctionHint) ||
        declFunctionHint.includes(f.toLowerCase())
      );
      if (funcMatch) {
        score += 0.2;
        reasons.push('function hint match');
      }
    }

    if (score > 0) {
      candidates.push({ material: mat, score, reason: reasons.join(', ') });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) {
    return {
      material: null,
      confidence: 0,
      reason: 'No matching candidates found.',
      alternatives: [],
    };
  }

  // Cap confidence at 0.95 to leave room for uncertainty
  const confidence = Math.min(0.95, best.score);

  // Prepare alternatives (top 3 excluding the best)
  const alternatives = candidates
    .slice(1, 4)
    .map(c => ({
      material: c.material,
      confidence: Math.min(0.9, c.score),
      reason: c.reason,
    }));

  return {
    material: best.material,
    confidence,
    reason: best.reason,
    alternatives,
  };
}

/**
 * Batch map an array of declaration lines to materials.
 * Returns an array of mapping results in the same order.
 */
export function mapIngredientsToMaterials(
  lines: ReadonlyArray<IngredientDeclarationLine>,
  materials: ReadonlyArray<RawMaterial>
): IngredientMappingResult[] {
  return lines.map(line => mapIngredientToMaterial(line, materials));
}