import { detectSupplierSdsSections, type SupplierSdsSectionDetectionResult, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";

export const SUPPLIER_SDS_SECTION2_PARSER_VERSION = "formulab-sds-section2-v1";

export type SupplierSdsHazardField =
  | "classification_scheme"
  | "hazard_classification"
  | "signal_word"
  | "hazard_statement"
  | "precautionary_statement"
  | "pictogram"
  | "pbt_statement"
  | "vpvb_statement"
  | "endocrine_disruption_statement"
  | "market_context";

export interface SupplierSdsHazardEvidence {
  sourceDocumentHash: string;
  sectionNumber: 2;
  pageNumber: number;
  lineNumber: number;
  excerpt: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsHazardCandidate {
  field: SupplierSdsHazardField;
  /** The exact printed value or statement; no classification is approved here. */
  rawValue: string;
  extractionMethod: "explicit_label" | "explicit_code" | "explicit_regulatory_reference" | "explicit_statement";
  evidence: SupplierSdsHazardEvidence[];
  /** All extracted hazard content requires a qualified human review. */
  reviewRequired: true;
}

export type SupplierSdsHazardWarning =
  | "section_2_not_detected"
  | "section_2_boundary_incomplete"
  | "no_section_2_hazard_candidates"
  | "conflicting_market_context"
  | "section_2_ocr_requires_review"
  | "section_2_provenance_requires_review"
  | "human_review_required";

export interface SupplierSdsSection2HazardResult {
  sourceDocumentHash: string;
  parserVersion: typeof SUPPLIER_SDS_SECTION2_PARSER_VERSION;
  ocrParserVersion?: string;
  candidates: SupplierSdsHazardCandidate[];
  warnings: SupplierSdsHazardWarning[];
}

const LABELS: Record<SupplierSdsHazardField, readonly string[]> = {
  classification_scheme: ["classification scheme", "classification system", "applicable classification", "hazard classification system", "klassifizierungssystem", "système de classification", "sistema de clasificación", "classificatiesysteem", "klassificeringssystem", "sınıflandırma sistemi"],
  hazard_classification: ["classification", "hazard classification", "hazard class", "hazard category", "classification of the substance or mixture", "einstufung", "classification de la substance ou du mélange", "clasificación", "classificazione", "classificatie", "klasyfikacja", "classificação", "sınıflandırma", "zarar sınıfı", "zararlılık kategorisi"],
  signal_word: ["signal word", "signalwort", "mention d'avertissement", "palabra de advertencia", "avvertenza", "signaalwoord", "hasło ostrzegawcze", "palavra-sinal", "uyarı kelimesi", "işaret kelimesi"],
  hazard_statement: ["hazard statement", "hazard statements", "hazard statements (h-statements)", "hazardous statements", "gefahrenhinweis", "mentions de danger", "indicaciones de peligro", "indicazioni di pericolo", "gevarenaanduidingen", "zwroty wskazujące rodzaj zagrożenia", "advertências de perigo", "zararlılık ifadeleri", "h ifadeleri"],
  precautionary_statement: ["precautionary statement", "precautionary statements", "precautionary statements (p-statements)", "sicherheitshinweise", "conseils de prudence", "consejos de prudencia", "consigli di prudenza", "voorzorgsmaatregelen", "zwroty wskazujące środki ostrożności", "recomendações de prudência", "önlem ifadeleri", "p ifadeleri"],
  pictogram: ["pictogram", "pictograms", "hazard pictogram", "hazard pictograms", "gefahrenpiktogramm", "pictogramme de danger", "pictograma de peligro", "pittogramma di pericolo", "gevarenpictogram", "piktogram zagrożenia", "pictograma de perigo", "zararlılık piktogramı"],
  pbt_statement: ["pbt", "pbt assessment", "pbt assessment results", "persistent bioaccumulative and toxic", "pbt değerlendirmesi"],
  vpvb_statement: ["vpvb", "vpvb assessment", "vpvb assessment results", "very persistent and very bioaccumulative", "vpvb değerlendirmesi"],
  endocrine_disruption_statement: ["endocrine disruptor", "endocrine disrupting properties", "endocrine disruption", "endocrine properties", "endokrin bozucu özellikler"],
  market_context: ["market", "market context", "country", "country/market", "applicable market", "market region", "land/markt", "marché", "mercado", "pazar", "ülke/pazar"],
};

const SCHEME_PATTERNS = [
  /\b(?:un\s*)?ghs\b/i,
  /\bclp\b|\bregulation\s*\((?:ec|eu)\)\s*(?:no\.?\s*)?1272\s*\/\s*2008\b/i,
  /\b(?:osha|hazard communication standard|29\s*cfr\s*1910\.1200)\b/i,
] as const;
const HAZARD_CODE = /\b(?:EUH|H)\s*\d{3}(?:[A-Z])?\b/gi;
const PRECAUTION_CODE = /\bP\s*\d{3}(?:\s*\+\s*P?\s*\d{3}){0,3}\b/gi;
const PICTOGRAM_CODE = /\bGHS\s*0[1-9]\b/gi;
const CATEGORY_PATTERN = /\bcategory\s+[0-9]+[A-Z]?(?:\s*[,;/]\s*category\s+[0-9]+[A-Z]?)*\b/i;
const SIGNAL_WORDS = new Set(["danger", "warning", "gefahr", "achtung", "danger", "attention", "peligro", "atención", "pericolo", "attenzione", "gevaar", "niebezpieczeństwo", "uwaga", "perigo", "atenção", "tehlike", "uyarı"]);

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss")
    .toLocaleLowerCase("en-US").replace(/[’‘`´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function parseLabeled(line: SupplierSdsSectionLine): { field: SupplierSdsHazardField; value: string } | undefined {
  const separator = line.text.search(/[:：]/u);
  if (separator < 0) return undefined;
  const label = normalize(line.text.slice(0, separator).replace(/^\s*2(?:\.\d+)?\s*/, ""));
  const field = (Object.entries(LABELS) as Array<[SupplierSdsHazardField, readonly string[]]>)
    .find(([, aliases]) => aliases.some((alias) => normalize(alias) === label))?.[0];
  return field ? { field, value: line.text.slice(separator + 1).trim() } : undefined;
}

function contentLines(lines: SupplierSdsSectionLine[], sections: SupplierSdsSectionDetectionResult): SupplierSdsSectionLine[] | undefined {
  const index = sections.sections.findIndex((section) => section.sectionNumber === 2);
  const section = sections.sections[index];
  if (!section || sections.sections[index + 1]?.sectionNumber !== 3) return undefined;
  if (!section.contentStart || !section.contentEnd) return [];
  const start = lines.findIndex((line) => line.pageNumber === section.contentStart!.pageNumber && line.lineNumber === section.contentStart!.lineNumber);
  const end = lines.findIndex((line) => line.pageNumber === section.contentEnd!.pageNumber && line.lineNumber === section.contentEnd!.lineNumber);
  return start >= 0 && end >= start ? lines.slice(start, end + 1) : [];
}

function evidence(sourceDocumentHash: string, line: SupplierSdsSectionLine): SupplierSdsHazardEvidence {
  return {
    sourceDocumentHash,
    sectionNumber: 2,
    pageNumber: line.pageNumber,
    lineNumber: line.lineNumber,
    excerpt: line.text,
    source: line.source ?? "unknown",
    ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
    ...(line.position ? { position: { x: line.position.x, y: line.position.y } } : {}),
  };
}

function candidate(field: SupplierSdsHazardField, rawValue: string, line: SupplierSdsSectionLine, hash: string, extractionMethod: SupplierSdsHazardCandidate["extractionMethod"]): SupplierSdsHazardCandidate {
  return { field, rawValue, extractionMethod, evidence: [evidence(hash, line)], reviewRequired: true };
}

function statementCandidate(field: "hazard_statement" | "precautionary_statement", lines: SupplierSdsSectionLine[], hash: string): SupplierSdsHazardCandidate {
  return {
    field,
    rawValue: lines.map((line) => line.text.trim()).join(" "),
    extractionMethod: "explicit_code",
    evidence: lines.map((line) => evidence(hash, line)),
    reviewRequired: true,
  };
}

function isHazardStatementBoundary(line: SupplierSdsSectionLine): boolean {
  const normalized = normalize(line.text);
  return SIGNAL_WORDS.has(normalized)
    || [...line.text.matchAll(PICTOGRAM_CODE)].length > 0
    || /^(?:signal word|signalwort|mention d['’]avertissement|palabra de advertencia|avvertenza|signaalwoord|hasło ostrzegawcze|palavra-sinal|uyarı kelimesi|işaret kelimesi)\s*[:：]?$/i.test(line.text.trim());
}

function statementContinuation(lines: SupplierSdsSectionLine[], startIndex: number): SupplierSdsSectionLine[] {
  const collected = [lines[startIndex]!];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const previous = lines[index - 1]!;
    if (line.pageNumber !== previous.pageNumber || line.lineNumber !== previous.lineNumber + 1 || !line.text.trim()
      || parseLabeled(line) || /^\s*2\.\d+(?:\s|[.):\-–—]|$)/u.test(line.text)
      || [...line.text.matchAll(HAZARD_CODE)].length > 0 || [...line.text.matchAll(PRECAUTION_CODE)].length > 0
      || isHazardStatementBoundary(line)) break;
    collected.push(line);
  }
  return collected;
}

/**
 * Extracts explicit Section 2 hazard evidence only. It does not validate
 * regulatory status, make safety decisions, approve classifications or write
 * to material/safety records.
 */
export function extractSupplierSdsSection2Hazards(input: {
  sourceDocumentHash: string;
  lines: SupplierSdsSectionLine[];
  sections?: SupplierSdsSectionDetectionResult;
  ocrParserVersion?: string;
}): SupplierSdsSection2HazardResult {
  if (!/^[a-f0-9]{64}$/i.test(input.sourceDocumentHash)) throw new Error("Supplier SDS Section 2 extraction requires a SHA-256 source document hash.");
  const sections = input.sections ?? detectSupplierSdsSections(input.lines);
  const section2Index = sections.sections.findIndex((section) => section.sectionNumber === 2);
  if (section2Index < 0) {
    return { sourceDocumentHash: input.sourceDocumentHash.toLowerCase(), parserVersion: SUPPLIER_SDS_SECTION2_PARSER_VERSION, ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}), candidates: [], warnings: ["section_2_not_detected"] };
  }
  const lines = contentLines(input.lines, sections);
  if (lines === undefined) {
    return { sourceDocumentHash: input.sourceDocumentHash.toLowerCase(), parserVersion: SUPPLIER_SDS_SECTION2_PARSER_VERSION, ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}), candidates: [], warnings: ["section_2_boundary_incomplete"] };
  }

  const hash = input.sourceDocumentHash;
  const candidates: SupplierSdsHazardCandidate[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const parsed = parseLabeled(line);
    if (parsed?.value) {
      candidates.push(candidate(parsed.field, parsed.value, line, hash, "explicit_label"));
      if (parsed.field === "hazard_classification" && !/classification system|classification scheme/i.test(parsed.value)) {
        const category = CATEGORY_PATTERN.exec(parsed.value);
        if (category) candidates.push(candidate("hazard_classification", parsed.value, line, hash, "explicit_label"));
      }
    }

    for (const pattern of SCHEME_PATTERNS) {
      const match = pattern.exec(line.text);
      if (match) candidates.push(candidate("classification_scheme", match[0], line, hash, "explicit_regulatory_reference"));
    }
    if ([...line.text.matchAll(HAZARD_CODE)].length > 0) candidates.push(statementCandidate("hazard_statement", statementContinuation(lines, index), hash));
    if ([...line.text.matchAll(PRECAUTION_CODE)].length > 0) candidates.push(statementCandidate("precautionary_statement", statementContinuation(lines, index), hash));
    for (const match of line.text.matchAll(PICTOGRAM_CODE)) candidates.push(candidate("pictogram", match[0].replace(/\s+/g, ""), line, hash, "explicit_code"));

    const normalizedLine = normalize(line.text);
    if (parsed?.field === "signal_word" || SIGNAL_WORDS.has(normalizedLine) || /^signal word\s*[:：]/i.test(line.text)) {
      const value = parsed?.field === "signal_word" && parsed.value ? parsed.value : line.text.trim();
      candidates.push(candidate("signal_word", value, line, hash, parsed?.field === "signal_word" ? "explicit_label" : "explicit_statement"));
    }
    if (/\bpbt\b|persistent bioaccumulative and toxic/i.test(line.text)) candidates.push(candidate("pbt_statement", line.text.trim(), line, hash, "explicit_statement"));
    if (/\bvpvb\b|very persistent and very bioaccumulative/i.test(line.text)) candidates.push(candidate("vpvb_statement", line.text.trim(), line, hash, "explicit_statement"));
    if (/endocrine[- ](?:disrupt(?:or|ing|ion)|properties)|endocrine system/i.test(line.text)) candidates.push(candidate("endocrine_disruption_statement", line.text.trim(), line, hash, "explicit_statement"));
    if (!parsed && CATEGORY_PATTERN.test(line.text)) candidates.push(candidate("hazard_classification", line.text.trim(), line, hash, "explicit_statement"));
  }

  const deduplicated = candidates.filter((item, index) => candidates.findIndex((candidateItem) =>
    candidateItem.field === item.field && normalize(candidateItem.rawValue) === normalize(item.rawValue)
    && candidateItem.evidence[0]?.pageNumber === item.evidence[0]?.pageNumber
    && candidateItem.evidence[0]?.lineNumber === item.evidence[0]?.lineNumber) === index);
  const marketValues = new Set(deduplicated.filter((item) => item.field === "market_context").map((item) => normalize(item.rawValue)));
  const warnings: SupplierSdsHazardWarning[] = [];
  if (deduplicated.length === 0) warnings.push("no_section_2_hazard_candidates");
  if (marketValues.size > 1) warnings.push("conflicting_market_context");
  if (deduplicated.some((item) => item.evidence.some((source) => source.source === "ocr"))) warnings.push("section_2_ocr_requires_review");
  if (deduplicated.some((item) => item.evidence.some((source) => source.source === "unknown" || source.source === "mixed"))) warnings.push("section_2_provenance_requires_review");
  if (deduplicated.length > 0) warnings.push("human_review_required");
  return {
    sourceDocumentHash: input.sourceDocumentHash.toLowerCase(),
    parserVersion: SUPPLIER_SDS_SECTION2_PARSER_VERSION,
    ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
    candidates: deduplicated,
    warnings,
  };
}
