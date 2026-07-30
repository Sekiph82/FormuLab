import { IngredientDeclarationLine } from '../schemas/reverseFormulation';

/**
 * Parse a raw ingredient declaration string into an array of ingredient declaration lines.
 * This is a simple parser that splits by common delimiters and trims.
 * For more advanced parsing (concentrations, INCI names, etc.), additional logic would be needed.
 */
export function parseIngredientDeclaration(rawDeclaration: string): Omit<IngredientDeclarationLine, 'id' | 'benchmarkProductId' | 'mappingStatus' | 'mappedMaterialIds' | 'confidence' | 'notes' | 'createdAt' | 'updatedAt'>[] {
  if (!rawDeclaration || typeof rawDeclaration !== 'string') {
    return [];
  }

  // Normalize whitespace
  const cleaned = rawDeclaration.trim();

  // Define common separators: comma, semicolon, and the word 'and' (case insensitive)
  // We'll split by comma or semicolon first, then handle 'and' within each part.
  const parts = cleaned
    .split(/[,;]/)
    .map(part => part.trim())
    .filter(part => part.length > 0);

  const lines: ReturnType<typeof parseIngredientDeclaration> = [];

  let order = 0;
  for (const part of parts) {
    // Handle "and" as a separator (e.g., "water and sodium chloride")
    // We'll split by ' and ' but only if it's not part of a chemical name (simple approach)
    const subParts = part
      .split(/\s+and\s+/i)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const subPart of subParts) {
      // Remove any parenthetical content (e.g., "(as preservative)") - optional
      const cleanedName = subPart.replace(/\s*\([^)]*\)\s*/g, ' ').trim();

      if (cleanedName.length > 0) {
        lines.push({
          rawText: part, // Keep the original part (before and-split) as raw text for this line? Actually rawText should be the original declaration line? We'll set to the original rawDeclaration for simplicity, but per line we might want the specific fragment.
          normalizedText: cleanedName.toLowerCase(),
          declaredOrder: order++,
          declaredName: cleanedName,
          // The following fields are left undefined for now; they will be filled by mapping/inference steps.
          INCI: undefined,
          CAS: undefined,
          functionHint: undefined,
          concentrationHint: undefined,
          regulatoryNotes: undefined,
        });
      }
    }
  }

  return lines;
}

/**
 * A more advanced parser that attempts to extract concentrations and units.
 * This is optional and can be expanded later.
 */
export function parseIngredientDeclarationWithConcentration(rawDeclaration: string): Array<
  Omit<IngredientDeclarationLine, 'id' | 'benchmarkProductId' | 'mappingStatus' | 'mappedMaterialIds' | 'confidence' | 'notes' | 'createdAt' | 'updatedAt'> & {
    concentrationHint?: string;
  }
> {
  // TODO: Implement regex to capture patterns like "2-5% Sodium Lauryl Sulfate" or "SLS (2%)"
  // For now, fallback to basic parser.
  const basic = parseIngredientDeclaration(rawDeclaration);
  return basic.map(line => ({ ...line }));
}