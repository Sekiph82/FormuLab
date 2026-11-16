import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";

const WATER = /^(?:(?:de-?ionized|demineralized|distilled|purified|di|soft|ro)\s+(?:or\s+\w+\s+)?)?(?:aqua|water|eau)(?:\s*(?:\/|\()\s*(?:aqua|water|eau)\s*\)?)?$/u;
/**
 * The first word of a supplier or distributor that formulas print after a name ("Butylene Glycol /
 * Making Cosmetics", "Zemea / DuPont"). Only a listed first word is cut, so "Glycerin / Water" stays.
 */
const SUPPLIER_SUFFIX = new RegExp(String.raw`\s+\/\s*(?:dow|croda|sensient|making|basf|vantage|dsm|dsm-firmenich|hallstar|dupont|symrise|earthoil|miyoshi`
  + String.raw`|ashland|spectrum|angus|clariant|oleon|henry|stepan|kobo|merck|kahlwax|lubrizol|activon|kao|elementis|evonik`
  + String.raw`|seppic|biosynthis|cargill|univar|arxada|nagase|sytheon|ingredion|robertet|givaudan|nouryon|zschimmer|codif`
  + String.raw`|lanxess|floratech|dksh|wacker|innospec|inolex|lonza|momentive|gattefoss[eé]|azelis|imcd|brenntag|biesterfeld`
  + String.raw`|lotioncrafter|solvay|arkema|firmenich|iff|mane|akema|aak|ioi|kci|icsc|sun chemical)\b[^/]*$`, "iu");
/** A list number ("1. DI water", "12) Glycerin"), a phase letter ("A ACULYN 22"), or the next column's label. */
const LIST_NUMBER = /^\s*(?:\(\d{1,2}\)|\d{1,2}\s*[.)])\s+/u;
const PHASE_LETTER = /^[A-F]\s+(?=[A-Z][A-Za-z])/u;
const PROPERTY_LABEL = /\s+(?:appearance|stability|product characteristics|viscosity|odou?r|colou?r)\s*:.*$/iu;

/**
 * The material name a formula line prints, without list numbers, phase letters, supplier suffixes
 * or a neighbouring column's label. Twin of the pipeline's clean_printed_name; both must agree.
 */
export function cleanPrintedMaterialName(raw: string | undefined): string {
  const text = (raw ?? "").replace(/\s+/gu, " ").trim()
    .replace(LIST_NUMBER, "").replace(PHASE_LETTER, "").replace(PROPERTY_LABEL, "");
  const withoutSupplier = text.replace(SUPPLIER_SUFFIX, "").trim();
  // "08005-J / Sensient FD&C Red", "AA2G / DKSH": the part before the slash is no name by itself.
  return /[A-Za-z]{3}/u.test(withoutSupplier) ? withoutSupplier : text;
}
/** Separators between INCI names of a blend; "/" stays, it is part of names like "Acrylates/C10-30 Alkyl Acrylate Crosspolymer". */
const BLEND_SEPARATOR = /\s*\(and\)\s*|\s*;\s*|,\s+|\s+&\s+/u;

/**
 * Deterministic canonical-chemistry id for one printed INCI name ("Sodium Laureth Sulfate"
 * -> "inci:sodium-laureth-sulfate"). Undefined for blends, which are several chemistries,
 * and for text that does not look like a name; missing stays missing.
 */
export function canonicalChemistryIdFromInci(raw: string | undefined): string | undefined {
  const text = cleanPrintedMaterialName(raw).normalize("NFKC").toLowerCase()
    .replace(/[®™©*†‡¹²³⁴⁵⁶⁷⁸⁹⁰�]/gu, "")
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
