import type { SupplierSdsSectionDetectionResult, SupplierSdsSectionLine } from "./supplierSdsSectionDetection";

export const SUPPLIER_SDS_DOCUMENT_IDENTITY_PARSER_VERSION = "formulab-sds-document-identity-v1";

export type SupplierSdsDocumentIdentityField =
  | "supplier_name"
  | "manufacturer_name"
  | "product_name"
  | "trade_name"
  | "supplier_product_code"
  | "material_code"
  | "sds_version"
  | "revision_identifier"
  | "revision_date"
  | "issue_date"
  | "print_date"
  | "market"
  | "regulatory_regime"
  | "document_language"
  | "source_identifier";

export interface SupplierSdsIdentityEvidence {
  sourceDocumentHash: string;
  pageNumber: number;
  lineNumber: number;
  excerpt: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsDocumentIdentityCandidate {
  field: SupplierSdsDocumentIdentityField;
  /** Value as printed; dates and codes are deliberately not reformatted. */
  rawValue: string;
  /** Present only for explicit, unambiguous language names/codes. */
  normalizedValue?: string;
  extractionMethod: "labeled_field" | "regulatory_reference" | "section_heading_consensus";
  evidence: SupplierSdsIdentityEvidence[];
  reviewRequired: boolean;
}

export interface SupplierSdsAcquisitionIdentityContext {
  code: string;
  market?: string;
  language?: string;
  sourceRevision?: string;
  revisionDate?: string;
  publicationDate?: string;
  sourceProduct?: {
    supplierItemCode?: string;
    tradeName?: string;
    grade?: string;
  };
}

export interface SupplierSdsIdentityMetadataComparison {
  field: SupplierSdsDocumentIdentityField;
  acquisitionField: string;
  acquisitionValue: string;
  extractedValues: string[];
  result: "matches" | "differs" | "ambiguous";
  reviewRequired: boolean;
  acquisitionCode: string;
}

export type SupplierSdsDocumentIdentityWarning =
  | "no_identity_candidates"
  | "conflicting_identity_candidates"
  | "ocr_identity_requires_review"
  | "unsupported_document_language"
  | "identity_provenance_requires_review"
  | "regulatory_regime_requires_review";

export interface SupplierSdsDocumentIdentityResult {
  sourceDocumentHash: string;
  acquisitionCode?: string;
  parserVersion: typeof SUPPLIER_SDS_DOCUMENT_IDENTITY_PARSER_VERSION;
  ocrParserVersion?: string;
  candidates: SupplierSdsDocumentIdentityCandidate[];
  metadataComparisons: SupplierSdsIdentityMetadataComparison[];
  warnings: SupplierSdsDocumentIdentityWarning[];
}

const FIELD_LABELS: Record<SupplierSdsDocumentIdentityField, readonly string[]> = {
  supplier_name: [
    "supplier", "supplier name", "supplier of the safety data sheet", "details of the supplier of the safety data sheet",
    "safety data sheet supplier", "lieferant", "lieferant des sicherheitsdatenblatts", "details zum lieferanten",
    "fournisseur", "fournisseur de la fiche de données de sécurité", "proveedor", "proveedor de la ficha de datos de seguridad",
    "leverancier", "leverancier van het veiligheidsinformatieblad", "dostawca", "fornecedor", "tedarikçi", "güvenlik bilgi formu sağlayıcısı",
  ],
  manufacturer_name: ["manufacturer", "manufacturer name", "hersteller", "fabricant", "fabricante", "fabbricante", "producent", "üretici"],
  product_name: ["product identifier", "product name", "product identification", "product", "produktidentifikator", "produktname", "identificateur de produit", "identificador de producto", "productidentificatie", "identyfikator produktu", "identificador do produto", "ürün adı", "ürün kimliği"],
  trade_name: ["trade name", "commercial name", "product trade name", "handelsname", "nom commercial", "nombre comercial", "handelsnaam", "nome commerciale", "nome comercial", "nazwa handlowa", "ticari adı", "ticari isim"],
  supplier_product_code: ["product code", "supplier product code", "product number", "supplier item code", "item code", "article number", "product id", "product reference", "produktnummer", "artikelnummer", "code produit", "référence produit", "código de producto", "número de producto", "productnummer", "artikelnummer", "kod produktu", "código do produto", "ürün kodu", "ürün numarası"],
  material_code: ["material code", "material number", "material id", "material no", "materialnummer", "matériel numéro", "número de material", "materiaalkenmerk", "numer materiału", "código de material", "malzeme kodu", "malzeme numarası"],
  sds_version: ["sds version", "safety data sheet version", "version", "version number", "version no", "version number of sds", "version des sicherheitsdatenblatts", "version de la fiche", "versión", "versie", "versione", "wersja", "versão", "gbf sürümü", "sürüm"],
  revision_identifier: ["revision", "revision number", "revision no", "revision identifier", "revisionsnummer", "révision", "número de revisión", "revisienummer", "numer wersji rewizji", "numero di revisione", "número de revisão", "revizyon numarası", "revizyon"],
  revision_date: ["revision date", "date of revision", "date revised", "date of last revision", "date of last revision of the safety data sheet", "revisionsdatum", "überarbeitet am", "date de révision", "fecha de revisión", "revisiedatum", "data rewizji", "data di revisione", "data de revisão", "revizyon tarihi", "son revizyon tarihi"],
  issue_date: ["issue date", "date of issue", "date issued", "date of first issue", "first issue date", "date of preparation", "erstellt am", "ausgabedatum", "date d'émission", "fecha de emisión", "datum van uitgave", "data wydania", "data di emissione", "data de emissão", "yayın tarihi", "hazırlanma tarihi"],
  print_date: ["print date", "date printed", "date of printing", "printed on", "druckdatum", "date d'impression", "fecha de impresión", "afdrukdatum", "data wydruku", "data di stampa", "data de impressão", "baskı tarihi", "yazdırma tarihi"],
  market: ["market", "market area", "country/market", "country of sale", "country where placed on the market", "market region", "land/markt", "marché", "mercado", "marktgebied", "rynek", "mercato", "mercado de destino", "pazar", "ülke/pazar"],
  regulatory_regime: ["regulatory regime", "applicable regulation", "applicable regulations", "regulatory framework", "applicable legislation", "geltende vorschriften", "réglementation applicable", "reglamentación aplicable", "toepasselijke regelgeving", "obowiązujące przepisy", "normativa applicabile", "regulamentação aplicável", "uygulanan mevzuat"],
  document_language: ["language", "document language", "sds language", "safety data sheet language", "sprache", "langue", "idioma", "taal", "język", "lingua", "dil", "gbf dili"],
  source_identifier: ["sds number", "sds no", "safety data sheet number", "document number", "document no", "document id", "document identifier", "reference number", "reference no", "file number", "sicherheitsdatenblatt nummer", "numéro de la fiche", "número de ficha", "documentnummer", "numer dokumentu", "numero scheda dati sicurezza", "número do documento", "belge numarası", "gbf numarası"],
};

const REGULATORY_REFERENCES = [
  { value: "EU_REACH", pattern: /\b(?:reach\s+regulation|regulation\s*\((?:ec|eu)\)\s*(?:no\.?\s*)?1907\s*\/\s*2006)\b/i },
  { value: "EU_CLP", pattern: /\b(?:clp|regulation\s*\(ec\)\s*(?:no\.?\s*)?1272\s*\/\s*2008)\b/i },
  { value: "US_OSHA_HAZCOM", pattern: /\b(?:osha|29\s*cfr\s*1910\.1200|hazard communication standard)\b/i },
  { value: "UN_GHS", pattern: /\b(?:un\s*ghs|globally harmonized system|globally harmonised system)\b/i },
  { value: "US_TSCA", pattern: /\btsca\b/i },
  { value: "EU_SDS_FORMAT_2020_878", pattern: /\b(?:eu\s*)?regulation\s*\(eu\)\s*2020\s*\/\s*878\b/i },
] as const;

const LANGUAGE_VALUES: Record<string, readonly string[]> = {
  en: ["en", "eng", "english", "anglais", "englisch", "inglés", "inglese", "engels", "angielski", "inglês", "inglês", "İngilizce"],
  de: ["de", "deu", "ger", "german", "deutsch", "allemand", "alemán", "tedesco", "duits", "niemiecki", "alemão", "almanca"],
  es: ["es", "spa", "spanish", "español", "espagnol", "spagnolo", "spaans", "hiszpański", "espanhol", "ispanyolca"],
  fr: ["fr", "fra", "fre", "french", "français", "francés", "francese", "frans", "francuski", "francês", "fransızca"],
  it: ["it", "ita", "italian", "italiano", "italien", "italiaans", "włoski", "italiano", "italyanca"],
  nl: ["nl", "nld", "dut", "dutch", "nederlands", "néerlandais", "holandés", "olandese", "holenderski", "holandês", "flemenkçe"],
  pl: ["pl", "pol", "polish", "polski", "polonais", "polaco", "polacco", "pols", "polonês", "lehçe"],
  pt: ["pt", "por", "portuguese", "português", "portugais", "portugiesisch", "portoghese", "portugees", "portugalski", "portekizce"],
  tr: ["tr", "tur", "turkish", "türkçe", "turc", "turco", "turco", "turks", "turecki", "turco", "türk dili"],
};

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss")
    .toLocaleLowerCase("en-US").replace(/[’‘`´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function cleanLabel(value: string): string {
  return normalize(value.replace(/^\s*\d+(?:\.\d+)?\s*/, ""));
}

function evidenceFor(sourceDocumentHash: string, line: SupplierSdsSectionLine): SupplierSdsIdentityEvidence {
  return {
    sourceDocumentHash,
    pageNumber: line.pageNumber,
    lineNumber: line.lineNumber,
    excerpt: line.text,
    source: line.source ?? "unknown",
    ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
    ...(line.position ? { position: { x: line.position.x, y: line.position.y } } : {}),
  };
}

function requiresProvenanceReview(evidence: SupplierSdsIdentityEvidence[]): boolean {
  return evidence.some((item) => item.source === "unknown" || item.source === "mixed"
    || (item.source === "ocr" && (item.confidence === undefined || !Number.isFinite(item.confidence) || item.confidence < 0.65 || item.confidence > 1)));
}

function explicitLanguageCode(value: string): string | undefined {
  const normalized = normalize(value);
  return Object.entries(LANGUAGE_VALUES).find(([, aliases]) => aliases.some((alias) => normalize(alias) === normalized))?.[0];
}

function languageCandidate(rawValue: string, evidence: SupplierSdsIdentityEvidence[], extractionMethod: SupplierSdsDocumentIdentityCandidate["extractionMethod"]): SupplierSdsDocumentIdentityCandidate {
  const normalizedValue = explicitLanguageCode(rawValue);
  return {
    field: "document_language",
    rawValue,
    ...(normalizedValue ? { normalizedValue } : {}),
    extractionMethod,
    evidence,
    reviewRequired: !normalizedValue || requiresProvenanceReview(evidence),
  };
}

function selectedLineIndexes(lines: SupplierSdsSectionLine[], sections?: SupplierSdsSectionDetectionResult): { identity: Set<number>; regulatory: Set<number> } {
  const identity = new Set<number>();
  const regulatory = new Set<number>();
  lines.forEach((line, index) => {
    if (line.pageNumber === 1) {
      identity.add(index);
      regulatory.add(index);
    }
  });
  for (const section of sections?.sections ?? []) {
    if (section.sectionNumber !== 1 && section.sectionNumber !== 15) continue;
    const start = lines.findIndex((line) => line.pageNumber === section.headingLines[0]?.pageNumber
      && line.lineNumber === section.headingLines[0]?.lineNumber);
    if (start < 0) continue;
    const endReference = section.contentEnd ?? section.headingLines[section.headingLines.length - 1];
    const end = endReference ? lines.findIndex((line) => line.pageNumber === endReference.pageNumber && line.lineNumber === endReference.lineNumber) : start;
    for (let index = start; index <= (end < 0 ? start : end); index += 1) {
      (section.sectionNumber === 1 ? identity : regulatory).add(index);
    }
  }
  return { identity, regulatory };
}

function parseLabeledValue(line: SupplierSdsSectionLine): { label: string; value: string } | undefined {
  const separator = line.text.search(/[:：]/u);
  if (separator < 0) {
    const label = cleanLabel(line.text);
    return Object.values(FIELD_LABELS).some((aliases) => aliases.some((alias) => normalize(alias) === label))
      ? { label, value: "" }
      : undefined;
  }
  return { label: cleanLabel(line.text.slice(0, separator)), value: line.text.slice(separator + 1).trim() };
}

function languageHeadingCandidates(
  sections: SupplierSdsSectionDetectionResult | undefined,
  lines: SupplierSdsSectionLine[],
  sourceDocumentHash: string,
): SupplierSdsDocumentIdentityCandidate[] {
  if (!sections) return [];
  const relevant = sections.sections.filter((section) => section.languageCandidates.length > 0);
  if (relevant.length < 3) return [];
  const countByLanguage = new Map<string, number>();
  for (const section of relevant) {
    for (const language of section.languageCandidates) countByLanguage.set(language, (countByLanguage.get(language) ?? 0) + 1);
  }
  const languageCodes = [...countByLanguage]
    .filter(([, count]) => count >= 3)
    .map(([language]) => language)
    .sort();
  return languageCodes.map((language) => {
    const matchingSections = relevant.filter((section) => section.languageCandidates.includes(language));
    const evidence = matchingSections.flatMap((section) => section.headingLines.map((reference) => {
      const sourceLine = lines.find((line) => line.pageNumber === reference.pageNumber && line.lineNumber === reference.lineNumber);
      return sourceLine
        ? evidenceFor(sourceDocumentHash, sourceLine)
        : {
          sourceDocumentHash,
          pageNumber: reference.pageNumber,
          lineNumber: reference.lineNumber,
          excerpt: `Section ${section.sectionNumber}: ${section.rawHeading}`,
          source: "unknown" as const,
          ...(reference.position ? { position: { x: reference.position.x, y: reference.position.y } } : {}),
        };
    }));
    return {
    field: "document_language",
    rawValue: evidence.map((item) => item.excerpt).join(" | "),
    normalizedValue: language,
    extractionMethod: "section_heading_consensus",
    evidence,
    reviewRequired: languageCodes.length > 1 || matchingSections.some((section) => section.reviewRequired) || requiresProvenanceReview(evidence),
  };
  });
}

function acquisitionComparisons(
  candidates: SupplierSdsDocumentIdentityCandidate[],
  acquisition: SupplierSdsAcquisitionIdentityContext | undefined,
): SupplierSdsIdentityMetadataComparison[] {
  if (!acquisition) return [];
  const mappings: Array<{ field: SupplierSdsDocumentIdentityField; acquisitionField: string; value?: string }> = [
    { field: "trade_name", acquisitionField: "sourceProduct.tradeName", value: acquisition.sourceProduct?.tradeName },
    { field: "supplier_product_code", acquisitionField: "sourceProduct.supplierItemCode", value: acquisition.sourceProduct?.supplierItemCode },
    { field: "revision_identifier", acquisitionField: "sourceRevision", value: acquisition.sourceRevision },
    { field: "revision_date", acquisitionField: "revisionDate", value: acquisition.revisionDate },
    { field: "issue_date", acquisitionField: "publicationDate", value: acquisition.publicationDate },
    { field: "market", acquisitionField: "market", value: acquisition.market },
    { field: "document_language", acquisitionField: "language", value: acquisition.language },
  ];
  return mappings.flatMap(({ field, acquisitionField, value }) => {
    if (!value) return [];
    const fieldCandidates = candidates.filter((candidate) => candidate.field === field);
    if (fieldCandidates.length === 0) return [];
    const extractedValues = [...new Set(fieldCandidates.map((candidate) => candidate.normalizedValue ?? candidate.rawValue))];
    const metadataValue = field === "document_language" ? explicitLanguageCode(value) : undefined;
    if (field === "document_language" && !metadataValue) return [];
    const equalsMetadata = (extracted: string): boolean => field === "document_language"
      ? extracted === metadataValue
      : extracted.trim().toLocaleLowerCase("en-US") === value.trim().toLocaleLowerCase("en-US");
    const matchingValues = extractedValues.filter(equalsMetadata);
    const result = extractedValues.length > 1 || (matchingValues.length > 0 && matchingValues.length !== extractedValues.length)
      ? "ambiguous" as const
      : matchingValues.length === extractedValues.length ? "matches" as const : "differs" as const;
    return [{ field, acquisitionField, acquisitionValue: value, extractedValues, result, reviewRequired: result === "ambiguous", acquisitionCode: acquisition.code }];
  });
}

/**
 * Extracts document-printed identity as evidence-bound candidates only. It is
 * deliberately separate from the immutable acquisition receipt and does not
 * update supplier/material records or declare any candidate verified.
 */
export function extractSupplierSdsDocumentIdentity(input: {
  sourceDocumentHash: string;
  lines: SupplierSdsSectionLine[];
  sections?: SupplierSdsSectionDetectionResult;
  acquisitionContext?: SupplierSdsAcquisitionIdentityContext;
  ocrParserVersion?: string;
}): SupplierSdsDocumentIdentityResult {
  if (!/^[a-f0-9]{64}$/i.test(input.sourceDocumentHash)) throw new Error("Supplier SDS identity extraction requires a SHA-256 source document hash.");
  const { identity, regulatory } = selectedLineIndexes(input.lines, input.sections);
  const candidates: SupplierSdsDocumentIdentityCandidate[] = [];

  for (const lineIndex of [...identity].sort((left, right) => left - right)) {
    const line = input.lines[lineIndex]!;
    const parsed = parseLabeledValue(line);
    if (parsed) {
      const field = (Object.entries(FIELD_LABELS) as Array<[SupplierSdsDocumentIdentityField, readonly string[]]>)
        .find(([, aliases]) => aliases.some((alias) => normalize(alias) === parsed.label))?.[0];
      if (field) {
        const next = input.lines[lineIndex + 1];
        const nextParsed = next ? parseLabeledValue(next) : undefined;
        const valueLine = !parsed.value && next?.pageNumber === line.pageNumber && !nextParsed ? next : undefined;
        const rawValue = parsed.value || valueLine?.text.trim() || "";
        if (rawValue) {
          const evidence = [evidenceFor(input.sourceDocumentHash, line), ...(valueLine ? [evidenceFor(input.sourceDocumentHash, valueLine)] : [])];
          if (field === "document_language") candidates.push(languageCandidate(rawValue, evidence, "labeled_field"));
          else candidates.push({
            field,
            rawValue,
            extractionMethod: "labeled_field",
            evidence,
            reviewRequired: requiresProvenanceReview(evidence),
          });
        }
      }
    }
  }

  const regulatoryLines = [...regulatory].sort((left, right) => left - right).map((index) => input.lines[index]!);
  for (const line of regulatoryLines) {
    for (const reference of REGULATORY_REFERENCES) {
      const match = reference.pattern.exec(line.text);
      if (!match) continue;
      candidates.push({
        field: "regulatory_regime",
        rawValue: match[0],
        normalizedValue: reference.value,
        extractionMethod: "regulatory_reference",
        evidence: [evidenceFor(input.sourceDocumentHash, line)],
        reviewRequired: true,
      });
    }
  }

  candidates.push(...languageHeadingCandidates(input.sections, input.lines, input.sourceDocumentHash));

  const conflictingFields = new Set<SupplierSdsDocumentIdentityField>();
  const candidatesByField = new Map<SupplierSdsDocumentIdentityField, Set<string>>();
  for (const candidate of candidates) {
    const values = candidatesByField.get(candidate.field) ?? new Set<string>();
    values.add(normalize(candidate.normalizedValue ?? candidate.rawValue));
    candidatesByField.set(candidate.field, values);
  }
  for (const [field, values] of candidatesByField) if (values.size > 1) conflictingFields.add(field);
  const finalCandidates = candidates.map((candidate) => ({
    ...candidate,
    reviewRequired: candidate.reviewRequired || conflictingFields.has(candidate.field),
  }));
  const warnings: SupplierSdsDocumentIdentityWarning[] = [];
  if (finalCandidates.length === 0) warnings.push("no_identity_candidates");
  if (conflictingFields.size > 0) warnings.push("conflicting_identity_candidates");
  if (finalCandidates.some((candidate) => candidate.reviewRequired && candidate.evidence.some((item) => item.source === "ocr"))) {
    warnings.push("ocr_identity_requires_review");
  }
  if (finalCandidates.some((candidate) => candidate.reviewRequired && candidate.evidence.some((item) => item.source === "mixed" || item.source === "unknown"))) {
    warnings.push("identity_provenance_requires_review");
  }
  if (finalCandidates.some((candidate) => candidate.field === "document_language" && !candidate.normalizedValue)) warnings.push("unsupported_document_language");
  if (finalCandidates.some((candidate) => candidate.field === "regulatory_regime" && candidate.reviewRequired)) warnings.push("regulatory_regime_requires_review");

  return {
    sourceDocumentHash: input.sourceDocumentHash.toLowerCase(),
    ...(input.acquisitionContext ? { acquisitionCode: input.acquisitionContext.code } : {}),
    parserVersion: SUPPLIER_SDS_DOCUMENT_IDENTITY_PARSER_VERSION,
    ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
    candidates: finalCandidates,
    metadataComparisons: acquisitionComparisons(finalCandidates, input.acquisitionContext),
    warnings,
  };
}
