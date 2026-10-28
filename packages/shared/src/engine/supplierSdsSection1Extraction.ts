import { detectSupplierSdsSections, type SupplierSdsSectionDetectionResult, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";

export const SUPPLIER_SDS_SECTION1_PARSER_VERSION = "formulab-sds-section1-v1";

export type SupplierSdsSection1Field =
  | "declared_chemical_name"
  | "chemical_nature"
  | "cas_number"
  | "ec_number"
  | "recommended_use"
  | "use_restrictions"
  | "industry_sector"
  | "product_description";

export interface SupplierSdsSection1Evidence {
  sourceDocumentHash: string;
  sectionNumber: 1;
  pageNumber: number;
  lineNumber: number;
  excerpt: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsSection1Candidate {
  field: SupplierSdsSection1Field;
  /** The original printed value, without chemical identifier/date normalization. */
  rawValue: string;
  extractionMethod: "labeled_field";
  evidence: SupplierSdsSection1Evidence[];
  reviewRequired: boolean;
}

export type SupplierSdsSection1Warning =
  | "section_1_not_detected"
  | "section_1_boundary_incomplete"
  | "no_section_1_candidates"
  | "conflicting_section_1_candidates"
  | "section_1_ocr_requires_review"
  | "section_1_provenance_requires_review";

export interface SupplierSdsSection1ExtractionResult {
  sourceDocumentHash: string;
  parserVersion: typeof SUPPLIER_SDS_SECTION1_PARSER_VERSION;
  ocrParserVersion?: string;
  candidates: SupplierSdsSection1Candidate[];
  warnings: SupplierSdsSection1Warning[];
}

const FIELD_LABELS: Record<SupplierSdsSection1Field, readonly string[]> = {
  declared_chemical_name: [
    "chemical name", "name of the substance", "substance name", "chemical identity", "name of chemical",
    "chemischer name", "stoffname", "nom chimique", "nombre químico", "nome chimico", "chemische naam",
    "nazwa chemiczna", "nome químico", "kimyasal adı", "maddenin adı",
  ],
  chemical_nature: [
    "chemical nature", "nature of product", "substance or mixture", "type of product",
    "chemische beschaffenheit", "nature chimique", "naturaleza química", "natura chimica",
    "chemische aard", "charakter chemiczny", "natureza química", "kimyasal nitelik", "madde veya karışım",
  ],
  cas_number: ["cas number", "cas no", "cas#", "cas-nummer", "nº cas", "numero cas", "cas-nummer", "numer cas", "cas numarası", "cas no."],
  ec_number: ["ec number", "ec no", "eec number", "einecs number", "eg nummer", "numéro ce", "número ce", "numero ce", "ce-nummer", "numer we", "número ec", "ec numarası", "ce numarası"],
  recommended_use: [
    "relevant identified uses", "identified uses", "recommended use", "recommended uses", "use of the substance or mixture",
    "identified uses of the substance or mixture", "verwendung des stoffs", "utilisations identifiées", "usos identificados",
    "usi identificati", "geïdentificeerde toepassingen", "zidentyfikowane zastosowania", "utilizações identificadas",
    "tavsiye edilen kullanım", "tanımlanmış kullanımlar", "belirlenmiş kullanımlar",
  ],
  use_restrictions: [
    "uses advised against", "uses advised against and restrictions", "restrictions on use", "recommended restrictions",
    "verwendungen von denen abgeraten wird", "utilisations déconseillées", "usos desaconsejados", "usi sconsigliati",
    "ontraden gebruik", "zastosowania odradzane", "utilizações desaconselhadas", "tavsiye edilmeyen kullanımlar",
    "kullanımı tavsiye edilmeyen alanlar", "kullanım kısıtlamaları",
  ],
  industry_sector: [
    "industry sector", "sector of use", "industrial sector", "sector of application",
    "industriesektor", "secteur industriel", "sector industrial", "settore industriale", "industriële sector",
    "sektor przemysłowy", "setor industrial", "endüstriyel sektör", "kullanım sektörü",
  ],
  product_description: [
    "product description", "substance description", "product-level description", "description of the product",
    "produktbeschreibung", "description du produit", "descripción del producto", "descrizione del prodotto",
    "productbeschrijving", "opis produktu", "descrição do produto", "ürün tanımı", "ürün açıklaması",
  ],
};

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss")
    .toLocaleLowerCase("en-US").replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function parseLabel(line: SupplierSdsSectionLine): { field: SupplierSdsSection1Field; value: string } | undefined {
  const separator = line.text.search(/[:：]/u);
  const rawLabel = separator < 0 ? line.text : line.text.slice(0, separator);
  const label = normalize(rawLabel.replace(/^\s*1(?:\.\d+)?\s*/, ""));
  const field = (Object.entries(FIELD_LABELS) as Array<[SupplierSdsSection1Field, readonly string[]]>)
    .find(([, aliases]) => aliases.some((alias) => normalize(alias) === label))?.[0];
  if (!field) return undefined;
  return { field, value: separator < 0 ? "" : line.text.slice(separator + 1).trim() };
}

function isSubsectionHeading(line: SupplierSdsSectionLine): boolean {
  return /^\s*1\.\d+(?:\s|[.):\-–—]|$)/u.test(line.text);
}

function requiresReview(evidence: SupplierSdsSection1Evidence[]): boolean {
  return evidence.some((item) => item.source === "mixed" || item.source === "unknown"
    || (item.source === "ocr" && (item.confidence === undefined || !Number.isFinite(item.confidence) || item.confidence < 0.65 || item.confidence > 1)));
}

function evidenceFor(sourceDocumentHash: string, line: SupplierSdsSectionLine): SupplierSdsSection1Evidence {
  return {
    sourceDocumentHash,
    sectionNumber: 1,
    pageNumber: line.pageNumber,
    lineNumber: line.lineNumber,
    excerpt: line.text,
    source: line.source ?? "unknown",
    ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
    ...(line.position ? { position: { x: line.position.x, y: line.position.y } } : {}),
  };
}

function sectionContentLines(lines: SupplierSdsSectionLine[], sections: SupplierSdsSectionDetectionResult): SupplierSdsSectionLine[] | undefined {
  const sectionIndex = sections.sections.findIndex((item) => item.sectionNumber === 1);
  const section = sections.sections[sectionIndex];
  const nextSection = sections.sections[sectionIndex + 1];
  if (!section || sectionIndex < 0 || nextSection?.sectionNumber !== 2) return undefined;
  if (!section.contentStart || !section.contentEnd) return [];
  const start = lines.findIndex((line) => line.pageNumber === section.contentStart!.pageNumber && line.lineNumber === section.contentStart!.lineNumber);
  const end = lines.findIndex((line) => line.pageNumber === section.contentEnd!.pageNumber && line.lineNumber === section.contentEnd!.lineNumber);
  return start >= 0 && end >= start ? lines.slice(start, end + 1) : [];
}

/**
 * Extracts Section 1 commercial identity as source-bound candidates. It does
 * not resolve chemical identity, infer undisclosed content, or modify materials.
 */
export function extractSupplierSdsSection1(input: {
  sourceDocumentHash: string;
  lines: SupplierSdsSectionLine[];
  sections?: SupplierSdsSectionDetectionResult;
  ocrParserVersion?: string;
}): SupplierSdsSection1ExtractionResult {
  if (!/^[a-f0-9]{64}$/i.test(input.sourceDocumentHash)) throw new Error("Supplier SDS Section 1 extraction requires a SHA-256 source document hash.");
  const sections = input.sections ?? detectSupplierSdsSections(input.lines);
  if (!sections.sections.some((section) => section.sectionNumber === 1)) {
    return {
      sourceDocumentHash: input.sourceDocumentHash.toLowerCase(),
      parserVersion: SUPPLIER_SDS_SECTION1_PARSER_VERSION,
      ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
      candidates: [],
      warnings: ["section_1_not_detected"],
    };
  }

  const content = sectionContentLines(input.lines, sections);
  if (content === undefined) {
    return {
      sourceDocumentHash: input.sourceDocumentHash.toLowerCase(),
      parserVersion: SUPPLIER_SDS_SECTION1_PARSER_VERSION,
      ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
      candidates: [],
      warnings: ["section_1_boundary_incomplete"],
    };
  }

  const candidates: SupplierSdsSection1Candidate[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const labelLine = content[index]!;
    const parsed = parseLabel(labelLine);
    if (!parsed) continue;
    const valueParts = parsed.value ? [parsed.value] : [];
    const valueLines: SupplierSdsSectionLine[] = [];
    let cursor = index + 1;
    while (cursor < content.length) {
      const line = content[cursor]!;
      if (line.pageNumber !== labelLine.pageNumber || line.lineNumber !== content[cursor - 1]!.lineNumber + 1
        || !line.text.trim() || parseLabel(line) || isSubsectionHeading(line)) break;
      valueParts.push(line.text.trim());
      valueLines.push(line);
      cursor += 1;
    }
    const rawValue = valueParts.join(" ").trim();
    if (!rawValue) continue;
    const evidence = [evidenceFor(input.sourceDocumentHash, labelLine), ...valueLines.map((line) => evidenceFor(input.sourceDocumentHash, line))];
    candidates.push({
      field: parsed.field,
      rawValue,
      extractionMethod: "labeled_field",
      evidence,
      reviewRequired: requiresReview(evidence),
    });
    index = cursor - 1;
  }

  const valuesByField = new Map<SupplierSdsSection1Field, Set<string>>();
  for (const candidate of candidates) {
    const values = valuesByField.get(candidate.field) ?? new Set<string>();
    values.add(normalize(candidate.rawValue));
    valuesByField.set(candidate.field, values);
  }
  const conflictingFields = new Set([...valuesByField].filter(([, values]) => values.size > 1).map(([field]) => field));
  const finalCandidates = candidates.map((candidate) => ({
    ...candidate,
    reviewRequired: candidate.reviewRequired || conflictingFields.has(candidate.field),
  }));
  const warnings: SupplierSdsSection1Warning[] = [];
  if (finalCandidates.length === 0) warnings.push("no_section_1_candidates");
  if (conflictingFields.size > 0) warnings.push("conflicting_section_1_candidates");
  if (finalCandidates.some((candidate) => candidate.reviewRequired && candidate.evidence.some((item) => item.source === "ocr"))) {
    warnings.push("section_1_ocr_requires_review");
  }
  if (finalCandidates.some((candidate) => candidate.reviewRequired && candidate.evidence.some((item) => item.source === "mixed" || item.source === "unknown"))) {
    warnings.push("section_1_provenance_requires_review");
  }
  return {
    sourceDocumentHash: input.sourceDocumentHash.toLowerCase(),
    parserVersion: SUPPLIER_SDS_SECTION1_PARSER_VERSION,
    ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
    candidates: finalCandidates,
    warnings,
  };
}
