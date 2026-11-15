import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";

const WATER = /^(?:aqua|water|eau)(?:\s*(?:\/|\()\s*(?:aqua|water|eau)\s*\)?)?$/u;
/** Separators between INCI names of a blend; "/" stays, it is part of names like "Acrylates/C10-30 Alkyl Acrylate Crosspolymer". */
const BLEND_SEPARATOR = /\s*\(and\)\s*|\s*;\s*|,\s+|\s+&\s+/u;

/**
 * Deterministic canonical-chemistry id for one printed INCI name ("Sodium Laureth Sulfate"
 * -> "inci:sodium-laureth-sulfate"). Undefined for blends, which are several chemistries,
 * and for text that does not look like a name; missing stays missing.
 */
export function canonicalChemistryIdFromInci(raw: string | undefined): string | undefined {
  const text = (raw ?? "").normalize("NFKC").toLowerCase()
    .replace(/[®™©*†‡¹²³⁴⁵⁶⁷⁸⁹⁰]/gu, "")
    .replace(/\s*\(\d{1,2}\)\s*$/u, "")
    .replace(/\s+/gu, " ").trim();
  if (!text || text.length > 120 || /%/u.test(text) || !/[a-z]{3}/u.test(text)) return undefined;
  if (WATER.test(text)) return "inci:water";
  if (text.split(BLEND_SEPARATOR).filter(Boolean).length > 1) return undefined;
  const slug = text.replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return slug ? `inci:${slug}` : undefined;
}

/** Canonical-chemistry candidates per ingredient line, read only from the printed INCI/chemical name cell. */
export function referenceFormulationCanonicalChemistryCandidates(record: Pick<ReferenceFormulationRecord, "ingredientLines">): Record<string, string[]> {
  const candidates: Record<string, string[]> = {};
  for (const line of record.ingredientLines) {
    const id = canonicalChemistryIdFromInci(line.inciOrChemicalName?.rawValue);
    if (id) candidates[line.id] = [id];
  }
  return candidates;
}
