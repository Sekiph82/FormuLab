export type SupplierSdsHeadingSource = "digital" | "ocr" | "mixed" | "unknown";

export interface SupplierSdsSectionLine {
  pageNumber: number;
  lineNumber: number;
  text: string;
  source?: SupplierSdsHeadingSource;
  confidence?: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsSectionLineReference {
  pageNumber: number;
  lineNumber: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsDetectedSection {
  sectionNumber: number;
  canonicalTitle: string;
  rawHeading: string;
  languageCandidates: string[];
  headingLines: SupplierSdsSectionLineReference[];
  continuationHeadingLines: SupplierSdsSectionLineReference[][];
  contentStart?: SupplierSdsSectionLineReference;
  contentEnd?: SupplierSdsSectionLineReference;
  source: SupplierSdsHeadingSource;
  confidence?: number;
  reviewRequired: boolean;
}

export type SupplierSdsSectionDetectionWarning = "no_sections_detected" | "duplicate_section" | "out_of_order_sections" | "possible_table_of_contents";

export interface SupplierSdsSectionDetectionResult {
  sections: SupplierSdsDetectedSection[];
  sectionCoverage: "not_detected" | "partial" | "all_16_detected";
  unobservedSectionNumbers: number[];
  warnings: SupplierSdsSectionDetectionWarning[];
}

const CANONICAL_TITLES = [
  "Identification of the substance/mixture and of the company/undertaking",
  "Hazards identification",
  "Composition/information on ingredients",
  "First aid measures",
  "Firefighting measures",
  "Accidental release measures",
  "Handling and storage",
  "Exposure controls/personal protection",
  "Physical and chemical properties",
  "Stability and reactivity",
  "Toxicological information",
  "Ecological information",
  "Disposal considerations",
  "Transport information",
  "Regulatory information",
  "Other information",
] as const;

// Titles follow the standardized 16 headings in REACH Annex II (Commission
// Regulation (EU) 2020/878). Initial localized aliases cover English, German,
// Spanish, French, Italian, Dutch, Polish, Portuguese, and Turkish supplier SDSs.
// Other languages return `not_detected` until aliases are reviewed and added.
// https://eur-lex.europa.eu/eli/reg/2020/878/oj
export const SUPPLIER_SDS_SECTION_TITLE_ALIASES = {
  en: [
    "Identification of the substance/mixture and of the company/undertaking|Identification of the substance or mixture and of the company/undertaking",
    "Hazards identification|Identification of hazards",
    "Composition/information on ingredients|Composition and information on ingredients",
    "First aid measures",
    "Firefighting measures|Fire-fighting measures",
    "Accidental release measures",
    "Handling and storage",
    "Exposure controls/personal protection|Exposure controls and personal protection",
    "Physical and chemical properties",
    "Stability and reactivity",
    "Toxicological information",
    "Ecological information|Ecotoxicological information",
    "Disposal considerations",
    "Transport information",
    "Regulatory information",
    "Other information",
  ],
  de: [
    "Bezeichnung des Stoffs beziehungsweise des Gemischs und des Unternehmens|Bezeichnung des Stoffs bzw. des Gemischs und des Unternehmens",
    "Mögliche Gefahren|Gefahrenidentifikation",
    "Zusammensetzung/Angaben zu Bestandteilen|Zusammensetzung und Angaben zu Bestandteilen",
    "Erste-Hilfe-Maßnahmen",
    "Maßnahmen zur Brandbekämpfung",
    "Maßnahmen bei unbeabsichtigter Freisetzung",
    "Handhabung und Lagerung",
    "Begrenzung und Überwachung der Exposition/Persönliche Schutzausrüstungen",
    "Physikalische und chemische Eigenschaften",
    "Stabilität und Reaktivität",
    "Toxikologische Angaben",
    "Umweltbezogene Angaben",
    "Hinweise zur Entsorgung",
    "Angaben zum Transport",
    "Rechtsvorschriften",
    "Sonstige Angaben",
  ],
  fr: [
    "Identification de la substance/du mélange et de la société/de l'entreprise|Identification de la substance ou du mélange et de la société/entreprise",
    "Identification des dangers",
    "Composition/informations sur les composants",
    "Premiers secours",
    "Mesures de lutte contre l'incendie",
    "Mesures à prendre en cas de dispersion accidentelle",
    "Manipulation et stockage",
    "Contrôles de l'exposition/protection individuelle",
    "Propriétés physiques et chimiques",
    "Stabilité et réactivité",
    "Informations toxicologiques",
    "Informations écologiques",
    "Considérations relatives à l'élimination",
    "Informations relatives au transport",
    "Informations réglementaires",
    "Autres informations",
  ],
  es: [
    "Identificación de la sustancia o la mezcla y de la sociedad o la empresa|Identificación de la sustancia/mezcla y de la empresa",
    "Identificación de los peligros",
    "Composición/información sobre los componentes",
    "Primeros auxilios",
    "Medidas de lucha contra incendios",
    "Medidas en caso de vertido accidental",
    "Manipulación y almacenamiento",
    "Controles de exposición/protección individual",
    "Propiedades físicas y químicas",
    "Estabilidad y reactividad",
    "Información toxicológica",
    "Información ecológica",
    "Consideraciones relativas a la eliminación",
    "Información relativa al transporte",
    "Información reglamentaria",
    "Otra información|Otras informaciones",
  ],
  it: [
    "Identificazione della sostanza/miscela e della società/impresa",
    "Identificazione dei pericoli",
    "Composizione/informazioni sugli ingredienti",
    "Misure di primo soccorso",
    "Misure antincendio",
    "Misure in caso di rilascio accidentale",
    "Manipolazione e immagazzinamento",
    "Controlli dell'esposizione/protezione individuale",
    "Proprietà fisiche e chimiche",
    "Stabilità e reattività",
    "Informazioni tossicologiche",
    "Informazioni ecologiche",
    "Considerazioni sullo smaltimento",
    "Informazioni sul trasporto",
    "Informazioni sulla regolamentazione",
    "Altre informazioni",
  ],
  nl: [
    "Identificatie van de stof of het mengsel en van de vennootschap/onderneming|Identificatie van de stof/het mengsel en van de onderneming",
    "Identificatie van de gevaren",
    "Samenstelling en informatie over de bestanddelen|Samenstelling/informatie over de bestanddelen",
    "Eerstehulpmaatregelen",
    "Brandbestrijdingsmaatregelen",
    "Maatregelen bij accidenteel vrijkomen van de stof of het mengsel",
    "Hantering en opslag",
    "Maatregelen ter beheersing van blootstelling/persoonlijke bescherming",
    "Fysische en chemische eigenschappen",
    "Stabiliteit en reactiviteit",
    "Toxicologische informatie",
    "Ecologische informatie",
    "Instructies voor verwijdering",
    "Informatie met betrekking tot het vervoer",
    "Regelgeving",
    "Overige informatie",
  ],
  pl: [
    "Identyfikacja substancji/mieszaniny i identyfikacja przedsiębiorstwa",
    "Identyfikacja zagrożeń",
    "Skład/informacja o składnikach",
    "Środki pierwszej pomocy",
    "Postępowanie w przypadku pożaru",
    "Postępowanie w przypadku niezamierzonego uwolnienia do środowiska",
    "Postępowanie z substancjami i mieszaninami oraz ich magazynowanie",
    "Kontrola narażenia/środki ochrony indywidualnej",
    "Właściwości fizyczne i chemiczne",
    "Stabilność i reaktywność",
    "Informacje toksykologiczne",
    "Informacje ekologiczne",
    "Postępowanie z odpadami",
    "Informacje dotyczące transportu",
    "Informacje dotyczące przepisów prawnych",
    "Inne informacje",
  ],
  pt: [
    "Identificação da substância/mistura e da sociedade/empresa",
    "Identificação dos perigos",
    "Composição/informação sobre os componentes",
    "Medidas de primeiros socorros",
    "Medidas de combate a incêndios",
    "Medidas a tomar em caso de fugas acidentais",
    "Manuseamento e armazenagem",
    "Controlo da exposição/proteção individual",
    "Propriedades físicas e químicas",
    "Estabilidade e reatividade",
    "Informação toxicológica",
    "Informação ecológica",
    "Considerações relativas à eliminação",
    "Informações relativas ao transporte",
    "Informação sobre regulamentação",
    "Outras informações",
  ],
  tr: [
    "Maddenin/karışımın ve şirketin/dağıtıcının tanımı|Madde/karışım ve şirket/dağıtıcı kimliği",
    "Zararların tanımı|Zararlılık tanımlanması",
    "Bileşimi/içindekiler hakkında bilgi|Bileşimi / içindekiler hakkında bilgi",
    "İlk yardım önlemleri",
    "Yangınla mücadele önlemleri",
    "Kaza sonucu yayılma önlemleri|Kaza sonucu yayılmaya karşı önlemler",
    "Elleçleme ve depolama",
    "Maruz kalma kontrolü/kişisel korunma|Maruz kalma kontrolleri/kişisel korunma",
    "Fiziksel ve kimyasal özellikler",
    "Kararlılık ve tepkime",
    "Toksikolojik bilgiler",
    "Ekolojik bilgiler",
    "Bertaraf etme bilgileri",
    "Taşımacılık bilgileri",
    "Mevzuat bilgileri",
    "Diğer bilgiler",
  ],
} as const;

export const SUPPORTED_SUPPLIER_SDS_SECTION_LANGUAGES = ["en", "de", "es", "fr", "it", "nl", "pl", "pt", "tr"] as const;
const SECTION_PREFIX = /^(?:section|sectie|rubrik|rubriek|abschnitt|seccion|sección|sezione|secção|seccao|rubrique|sekcja|bölüm)\s*/i;
const CONTENTS_PAGE_TAIL = /(?:\.{2,}|…{1,}|·{2,}|\s+)\d{1,3}\s*$/u;
const OCR_REVIEW_THRESHOLD = 0.65;

function normalize(value: string): string {
  return value.normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const TITLE_ALIASES = Object.entries(SUPPLIER_SDS_SECTION_TITLE_ALIASES).flatMap(([language, titles]) =>
  titles.flatMap((localized, index) => localized.split("|").map((title) => ({
    sectionNumber: index + 1,
    language,
    normalized: normalize(title),
  }))),
).sort((left, right) => right.normalized.length - left.normalized.length);

interface HeadingCandidate {
  sectionNumber: number;
  endLineIndex: number;
  aliases: Set<string>;
}
type LocatedHeadingCandidate = HeadingCandidate & { lineIndex: number };

function parseHeadingText(value: string): { sectionNumber: number; title: string } | undefined {
  const withoutPrefix = value.trim().replace(SECTION_PREFIX, "");
  const match = withoutPrefix.match(/^(1[0-6]|[1-9])(?=$|\s|[.):\-–—])(?:[.):\-–—]\s*|\s+)?(.*)$/u);
  if (!match) return undefined;
  return { sectionNumber: Number(match[1]), title: match[2] ?? "" };
}

function matchTitle(sectionNumber: number, value: string): Set<string> {
  const title = normalize(value);
  const languages = TITLE_ALIASES.filter((alias) => alias.sectionNumber === sectionNumber
    && (title === alias.normalized || title.startsWith(`${alias.normalized} `)))
    .map((alias) => alias.language);
  return new Set(languages);
}

function locateHeading(lines: SupplierSdsSectionLine[], lineIndex: number): HeadingCandidate | undefined {
  for (let endLineIndex = lineIndex; endLineIndex <= Math.min(lineIndex + 2, lines.length - 1); endLineIndex += 1) {
    if (lines[endLineIndex]!.pageNumber !== lines[lineIndex]!.pageNumber) break;
    const combined = lines.slice(lineIndex, endLineIndex + 1).map((line) => line.text.trim()).join(" ");
    const parsed = parseHeadingText(combined);
    if (!parsed) continue;
    if (CONTENTS_PAGE_TAIL.test(combined)) continue;
    const aliases = matchTitle(parsed.sectionNumber, parsed.title);
    if (aliases.size > 0) return { sectionNumber: parsed.sectionNumber, endLineIndex, aliases };
  }
  return undefined;
}

function reference(line: SupplierSdsSectionLine): SupplierSdsSectionLineReference {
  return {
    pageNumber: line.pageNumber,
    lineNumber: line.lineNumber,
    ...(line.position ? { position: { x: line.position.x, y: line.position.y } } : {}),
  };
}

/**
 * Detects numbered, localized SDS headings using the standardized 16-section
 * vocabulary. It locates evidence only; it does not infer a document language,
 * interpret safety content, or turn OCR output into an approved fact.
 */
export function detectSupplierSdsSections(lines: SupplierSdsSectionLine[]): SupplierSdsSectionDetectionResult {
  const candidates: LocatedHeadingCandidate[] = [];
  let possibleTableOfContents = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (!Number.isSafeInteger(line.pageNumber) || line.pageNumber < 1
      || !Number.isSafeInteger(line.lineNumber) || line.lineNumber < 1 || !line.text.trim()) continue;
    const singleLineHeading = parseHeadingText(line.text);
    const hasKnownTitle = singleLineHeading && matchTitle(singleLineHeading.sectionNumber, singleLineHeading.title).size > 0;
    const nextLineLooksLikePageNumber = lines[lineIndex + 1]?.pageNumber === line.pageNumber
      && /^\s*\d{1,3}\s*$/.test(lines[lineIndex + 1]!.text);
    if (hasKnownTitle && (CONTENTS_PAGE_TAIL.test(line.text) || nextLineLooksLikePageNumber)) {
      possibleTableOfContents = true;
      continue;
    }
    const candidate = locateHeading(lines, lineIndex);
    if (!candidate) continue;
    const followingLine = lines[candidate.endLineIndex + 1];
    if (followingLine?.pageNumber === line.pageNumber && /^\s*\d{1,3}\s*$/.test(followingLine.text)) {
      possibleTableOfContents = true;
      lineIndex = candidate.endLineIndex + 1;
      continue;
    }
    candidates.push({ ...candidate, lineIndex });
    lineIndex = candidate.endLineIndex;
  }

  const consolidated: Array<LocatedHeadingCandidate & { continuationCandidates: LocatedHeadingCandidate[] }> = [];
  for (const candidate of candidates) {
    const previous = consolidated[consolidated.length - 1];
    const candidateLine = lines[candidate.lineIndex]!;
    const previousLine = previous ? lines[previous.lineIndex]! : undefined;
    if (previous && previous.sectionNumber === candidate.sectionNumber
      && candidateLine.pageNumber > previousLine!.pageNumber && candidateLine.lineNumber <= 2) {
      previous.continuationCandidates.push(candidate);
    } else {
      consolidated.push({ ...candidate, continuationCandidates: [] });
    }
  }

  const duplicateSections = new Set<number>();
  const seen = new Set<number>();
  const outOfOrder = new Set<number>();
  let previous = 0;
  for (const candidate of consolidated) {
    if (seen.has(candidate.sectionNumber)) duplicateSections.add(candidate.sectionNumber);
    if (candidate.sectionNumber < previous) outOfOrder.add(candidate.sectionNumber);
    seen.add(candidate.sectionNumber);
    previous = candidate.sectionNumber;
  }

  const sections = consolidated.map((candidate, index): SupplierSdsDetectedSection => {
    const headingLines = lines.slice(candidate.lineIndex, candidate.endLineIndex + 1);
    const continuationHeadingLines = candidate.continuationCandidates.map((continuation) =>
      lines.slice(continuation.lineIndex, continuation.endLineIndex + 1));
    const nextCandidate = consolidated[index + 1];
    const contentEndIndex = nextCandidate ? nextCandidate.lineIndex - 1 : lines.length - 1;
    const allHeadingLines = [...headingLines, ...continuationHeadingLines.flat()];
    const sources = new Set(allHeadingLines.map((line) => line.source ?? "unknown"));
    const source: SupplierSdsHeadingSource = sources.size === 1 ? [...sources][0]!
      : sources.has("ocr") && sources.has("digital") ? "mixed"
        : sources.has("ocr") ? "ocr" : sources.has("digital") ? "digital" : "unknown";
    const ocrConfidence = allHeadingLines.filter((line) => line.source === "ocr" && line.confidence !== undefined)
      .map((line) => line.confidence!).filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
    const confidence = ocrConfidence.length > 0 ? Math.min(...ocrConfidence) : undefined;
    const invalidOcrConfidence = allHeadingLines.some((line) => line.source === "ocr"
      && (line.confidence === undefined || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1));
    return {
      sectionNumber: candidate.sectionNumber,
      canonicalTitle: CANONICAL_TITLES[candidate.sectionNumber - 1]!,
      rawHeading: headingLines.map((line) => line.text.trim()).join(" "),
      languageCandidates: [...candidate.aliases].sort(),
      headingLines: headingLines.map(reference),
      continuationHeadingLines: continuationHeadingLines.map((group) => group.map(reference)),
      ...(candidate.endLineIndex + 1 <= contentEndIndex ? { contentStart: reference(lines[candidate.endLineIndex + 1]!) } : {}),
      ...(contentEndIndex >= candidate.endLineIndex + 1 ? { contentEnd: reference(lines[contentEndIndex]!) } : {}),
      source,
      ...(confidence === undefined ? {} : { confidence }),
      reviewRequired: invalidOcrConfidence || ocrConfidence.some((value) => value < OCR_REVIEW_THRESHOLD),
    };
  });
  const warnings: SupplierSdsSectionDetectionWarning[] = [];
  if (sections.length === 0) warnings.push("no_sections_detected");
  if (duplicateSections.size > 0) warnings.push("duplicate_section");
  if (outOfOrder.size > 0) warnings.push("out_of_order_sections");
  if (possibleTableOfContents) warnings.push("possible_table_of_contents");
  const sectionCoverage = sections.length === 0 ? "not_detected"
    : seen.size === CANONICAL_TITLES.length ? "all_16_detected" : "partial";
  return {
    sections,
    sectionCoverage,
    unobservedSectionNumbers: sections.length === 0 ? []
      : Array.from({ length: CANONICAL_TITLES.length }, (_, index) => index + 1).filter((number) => !seen.has(number)),
    warnings,
  };
}
