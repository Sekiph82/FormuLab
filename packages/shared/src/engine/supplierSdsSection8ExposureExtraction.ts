import { detectSupplierSdsSections, type SupplierSdsSectionDetectionResult, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";

export const SUPPLIER_SDS_SECTION8_PARSER_VERSION = "formulab-sds-section8-v1";

export type SupplierSdsExposureField =
  | "occupational_exposure_limit"
  | "exposure_limit_source"
  | "personal_protective_equipment"
  | "glove_material"
  | "glove_breakthrough_time"
  | "glove_thickness"
  | "respiratory_protection"
  | "engineering_control";

export interface SupplierSdsExposureEvidence {
  sourceDocumentHash: string;
  sectionNumber: 8;
  pageNumber: number;
  lineNumber: number;
  excerpt: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsExposureCandidate {
  field: SupplierSdsExposureField;
  /** Original printed wording/value, retaining stated units and qualifiers. */
  rawValue: string;
  extractionMethod: "explicit_label" | "explicit_limit_code" | "explicit_statement";
  evidence: SupplierSdsExposureEvidence[];
  reviewRequired: true;
}

export type SupplierSdsSection8Warning =
  | "section_8_not_detected"
  | "section_8_boundary_incomplete"
  | "no_section_8_exposure_candidates"
  | "conflicting_section_8_candidates"
  | "section_8_ocr_requires_review"
  | "section_8_provenance_requires_review"
  | "human_review_required";

export interface SupplierSdsSection8Result {
  sourceDocumentHash: string;
  parserVersion: typeof SUPPLIER_SDS_SECTION8_PARSER_VERSION;
  ocrParserVersion?: string;
  candidates: SupplierSdsExposureCandidate[];
  warnings: SupplierSdsSection8Warning[];
}

const LABELS: Record<SupplierSdsExposureField, readonly string[]> = {
  occupational_exposure_limit: ["occupational exposure limit", "exposure limit", "exposure limits", "workplace exposure limit", "oel", "twa", "stel", "ceiling limit", "short term exposure limit", "long term exposure limit", "arbeitsplatzgrenzwert", "limite d'exposition professionnelle", "límite de exposición profesional", "limite di esposizione professionale", "grenswaarde voor beroepsmatige blootstelling", "wartość dopuszczalnego narażenia zawodowego", "limite de exposição ocupacional", "mesleki maruziyet sınırı"],
  exposure_limit_source: ["source", "regulation", "regulatory source", "standard", "limit source", "exposure limit source", "quelle", "fuente", "fonte", "kaynak", "mevzuat", "yönetmelik"],
  personal_protective_equipment: ["personal protective equipment", "personal protection", "personal protective measures", "ppe", "individual protection", "persönliche schutzausrüstung", "équipements de protection individuelle", "equipo de protección individual", "dispositivi di protezione individuale", "persoonlijke beschermingsmiddelen", "środki ochrony indywidualnej", "equipamento de proteção individual", "kişisel koruyucu donanım", "kişisel korunma"],
  glove_material: ["glove material", "gloves", "protective gloves", "hand protection", "material of gloves", "handschoenen", "gants", "guantes", "guanti", "rękawice", "luvas", "eldiven", "el koruması", "el koruma"],
  glove_breakthrough_time: ["breakthrough time", "permeation time", "glove breakthrough time", "Durchbruchszeit", "temps de pénétration", "tiempo de penetración", "tempo di permeazione", "doorbraaktijd", "czas przebicia", "tempo de permeação", "delinme süresi", "geçirgenlik süresi"],
  glove_thickness: ["glove thickness", "glove material thickness", "dicke des handschuhs", "épaisseur des gants", "espesor del guante", "spessore del guanto", "handschoendikte", "grubość rękawicy", "espessura da luva", "eldiven kalınlığı"],
  respiratory_protection: ["respiratory protection", "respiratory equipment", "respiratory protective equipment", "respirator", "atemschutz", "protection respiratoire", "protección respiratoria", "protezione respiratoria", "ademhalingsbescherming", "ochrona dróg oddechowych", "proteção respiratória", "solunum koruması", "solunum koruyucu"],
  engineering_control: ["engineering controls", "engineering control", "technical measures", "technical controls", "ventilation", "technical protection", "technische schutzmaßnahmen", "contrôles techniques", "controles de ingeniería", "controlli tecnici", "technische beheersmaatregelen", "środki techniczne", "controles de engenharia", "mühendislik kontrolleri", "teknik önlemler"],
};

const LIMIT_CODE = /\b(?:TWA|STEL|OEL|OES|PEL|REL|TLV|MAK|AGW|WEL|Ceiling)\b/i;
const SOURCE_NAME = /\b(?:OSHA|ACGIH|NIOSH|EU\s*Indicative|Directive\s+98\/24\/EC|EH40|TRGS\s*900|GESTIS|ACGIH|NIOSH)\b/i;
const REGULATION_NUMBER = /\b(?:directive|regulation|standard|ordinance|gesetz|règlement|reglamento|regolamento|regeling|rozporządzenie|regulamento|yönetmelik)\b/i;
const BREAKTHROUGH_VALUE = /(?:breakthrough(?:\s+time)?|permeation time|penetration time)\s*[:=]?\s*(?:[<>]=?\s*)?\d+(?:[.,]\d+)?\s*(?:min(?:ute)?s?|h(?:ours?)?|s)/i;
const GLOVE_THICKNESS_VALUE = /(?:glove\s+)?thickness\s*[:=]?\s*\d+(?:[.,]\d+)?\s*(?:mm|µm|um)/i;
const RESPIRATORY_STATEMENT = /\b(?:respirator|respiratory protection|respiratory protective|respiratory equipment|facepiece|mask)\b/i;
const ENGINEERING_STATEMENT = /\b(?:local exhaust(?:\s+ventilation)?|mechanical ventilation|general ventilation|enclosed process|closed system|engineering control)\b/i;
const PPE_STATEMENT = /\b(?:wear|use|provide|must wear|should wear)\b.{0,80}\b(?:protective gloves|gloves|goggles|safety glasses|protective clothing|personal protective equipment)\b/i;

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss")
    .toLocaleLowerCase("en-US").replace(/[’‘\x60´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function parseLabel(line: SupplierSdsSectionLine): { field: SupplierSdsExposureField; value: string } | undefined {
  const separator = line.text.search(/[:：]/u);
  const rawLabel = separator < 0 ? line.text : line.text.slice(0, separator);
  const label = normalize(rawLabel.replace(/^\s*8(?:\.\d+)?\s*/, ""));
  const field = (Object.entries(LABELS) as Array<[SupplierSdsExposureField, readonly string[]]>)
    .find(([, aliases]) => aliases.some((alias) => normalize(alias) === label))?.[0];
  return field ? { field, value: separator < 0 ? "" : line.text.slice(separator + 1).trim() } : undefined;
}

function sectionContent(lines: SupplierSdsSectionLine[], sections: SupplierSdsSectionDetectionResult): SupplierSdsSectionLine[] | undefined {
  const index = sections.sections.findIndex((section) => section.sectionNumber === 8);
  const section = sections.sections[index];
  if (!section || sections.sections[index + 1]?.sectionNumber !== 9) return undefined;
  if (!section.contentStart || !section.contentEnd) return [];
  const start = lines.findIndex((line) => line.pageNumber === section.contentStart!.pageNumber && line.lineNumber === section.contentStart!.lineNumber);
  const end = lines.findIndex((line) => line.pageNumber === section.contentEnd!.pageNumber && line.lineNumber === section.contentEnd!.lineNumber);
  return start >= 0 && end >= start ? lines.slice(start, end + 1) : [];
}

function evidence(hash: string, line: SupplierSdsSectionLine): SupplierSdsExposureEvidence {
  return {
    sourceDocumentHash: hash, sectionNumber: 8, pageNumber: line.pageNumber, lineNumber: line.lineNumber,
    excerpt: line.text, source: line.source ?? "unknown",
    ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
    ...(line.position ? { position: { x: line.position.x, y: line.position.y } } : {}),
  };
}

function candidate(field: SupplierSdsExposureField, rawValue: string, lines: SupplierSdsSectionLine[], hash: string, extractionMethod: SupplierSdsExposureCandidate["extractionMethod"]): SupplierSdsExposureCandidate {
  return { field, rawValue, extractionMethod, evidence: lines.map((line) => evidence(hash, line)), reviewRequired: true };
}

function isSubsectionHeading(line: SupplierSdsSectionLine): boolean {
  return /^\s*8\.\d+(?:\s|[.):\-–—]|$)/u.test(line.text);
}

function isNextLabel(line: SupplierSdsSectionLine): boolean {
  return parseLabel(line) !== undefined || isSubsectionHeading(line);
}

function continuation(lines: SupplierSdsSectionLine[], startIndex: number): SupplierSdsSectionLine[] {
  const collected = [lines[startIndex]!];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const previous = lines[index - 1]!;
    if (line.pageNumber !== previous.pageNumber || line.lineNumber !== previous.lineNumber + 1 || !line.text.trim()
      || isNextLabel(line) || LIMIT_CODE.test(line.text) || SOURCE_NAME.test(line.text) || REGULATION_NUMBER.test(line.text)
      || BREAKTHROUGH_VALUE.test(line.text) || GLOVE_THICKNESS_VALUE.test(line.text)
      || RESPIRATORY_STATEMENT.test(line.text) || ENGINEERING_STATEMENT.test(line.text) || PPE_STATEMENT.test(line.text)) break;
    collected.push(line);
  }
  return collected;
}

export function extractSupplierSdsSection8Exposure(input: {
  sourceDocumentHash: string;
  lines: SupplierSdsSectionLine[];
  sections?: SupplierSdsSectionDetectionResult;
  ocrParserVersion?: string;
}): SupplierSdsSection8Result {
  if (!/^[a-f0-9]{64}$/i.test(input.sourceDocumentHash)) throw new Error("Supplier SDS Section 8 extraction requires a SHA-256 source document hash.");
  const sections = input.sections ?? detectSupplierSdsSections(input.lines);
  const base = {
    sourceDocumentHash: input.sourceDocumentHash.toLowerCase(),
    parserVersion: SUPPLIER_SDS_SECTION8_PARSER_VERSION as typeof SUPPLIER_SDS_SECTION8_PARSER_VERSION,
    ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
  };
  if (!sections.sections.some((section) => section.sectionNumber === 8)) return { ...base, candidates: [], warnings: ["section_8_not_detected"] };
  const lines = sectionContent(input.lines, sections);
  if (lines === undefined) return { ...base, candidates: [], warnings: ["section_8_boundary_incomplete"] };

  const candidates: SupplierSdsExposureCandidate[] = [];
  const hash = input.sourceDocumentHash;
  const addInlineEvidence = (line: SupplierSdsSectionLine, primaryField?: SupplierSdsExposureField): void => {
    const sourceMatch = line.text.match(SOURCE_NAME);
    if (sourceMatch && primaryField !== "exposure_limit_source") {
      candidates.push(candidate("exposure_limit_source", sourceMatch[0], [line], hash, "explicit_statement"));
    }
    if (primaryField === "glove_material" || /\b(?:glove|gloves|eldiven|gants|guantes|guanti|rękawice|luvas)\b/i.test(line.text)) {
      const breakthrough = line.text.match(BREAKTHROUGH_VALUE);
      const thickness = line.text.match(GLOVE_THICKNESS_VALUE);
      if (breakthrough && primaryField !== "glove_breakthrough_time") candidates.push(candidate("glove_breakthrough_time", breakthrough[0], [line], hash, "explicit_statement"));
      if (thickness && primaryField !== "glove_thickness") candidates.push(candidate("glove_thickness", thickness[0], [line], hash, "explicit_statement"));
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const parsed = parseLabel(line);
    if (parsed) {
      const evidenceLines = [line];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = lines[cursor]!;
        const previous = lines[cursor - 1]!;
        if (next.pageNumber !== previous.pageNumber || next.lineNumber !== previous.lineNumber + 1
          || !next.text.trim() || isNextLabel(next) || LIMIT_CODE.test(next.text)
          || SOURCE_NAME.test(next.text) || REGULATION_NUMBER.test(next.text)
          || BREAKTHROUGH_VALUE.test(next.text) || GLOVE_THICKNESS_VALUE.test(next.text)) break;
        evidenceLines.push(next);
        cursor += 1;
      }
      const value = [parsed.value, ...evidenceLines.slice(1).map((item) => item.text.trim())].filter(Boolean).join(" ").trim();
      if (value) {
        candidates.push(candidate(parsed.field, value, evidenceLines, hash, "explicit_label"));
        addInlineEvidence(line, parsed.field);
        index = cursor - 1;
      }
      continue;
    }
    if (LIMIT_CODE.test(line.text)) {
      const limitLines = continuation(lines, index);
      candidates.push(candidate("occupational_exposure_limit", limitLines.map((item) => item.text.trim()).join(" "), limitLines, hash, "explicit_limit_code"));
      addInlineEvidence(line, "occupational_exposure_limit");
      index += limitLines.length - 1;
      continue;
    }
    if (SOURCE_NAME.test(line.text) || REGULATION_NUMBER.test(line.text)) {
      candidates.push(candidate("exposure_limit_source", line.text.trim(), [line], hash, "explicit_statement"));
    }
    const breakthrough = line.text.match(BREAKTHROUGH_VALUE);
    const thickness = line.text.match(GLOVE_THICKNESS_VALUE);
    if (breakthrough) candidates.push(candidate("glove_breakthrough_time", breakthrough[0], [line], hash, "explicit_statement"));
    if (thickness) candidates.push(candidate("glove_thickness", thickness[0], [line], hash, "explicit_statement"));
    const statementFields: SupplierSdsExposureField[] = [];
    if (RESPIRATORY_STATEMENT.test(line.text)) statementFields.push("respiratory_protection");
    if (ENGINEERING_STATEMENT.test(line.text)) statementFields.push("engineering_control");
    if (PPE_STATEMENT.test(line.text)) statementFields.push("personal_protective_equipment");
    if (breakthrough) statementFields.push("glove_breakthrough_time");
    if (thickness) statementFields.push("glove_thickness");
    if (statementFields.length > 0) {
      const statementLines = continuation(lines, index);
      const statementText = statementLines.map((item) => item.text.trim()).join(" ");
      for (const field of statementFields) {
        const matchedValue = field === "glove_breakthrough_time" ? breakthrough![0]
          : field === "glove_thickness" ? thickness![0]
            : statementText;
        candidates.push(candidate(field, matchedValue, statementLines, hash, "explicit_statement"));
      }
      index += statementLines.length - 1;
    }
  }

  const deduplicated = candidates.filter((item, index) => candidates.findIndex((other) => other.field === item.field
    && normalize(other.rawValue) === normalize(item.rawValue)
    && other.evidence[0]?.pageNumber === item.evidence[0]?.pageNumber
    && other.evidence[0]?.lineNumber === item.evidence[0]?.lineNumber) === index);
  const valuesByField = new Map<SupplierSdsExposureField, Set<string>>();
  for (const item of deduplicated) {
    const values = valuesByField.get(item.field) ?? new Set<string>();
    values.add(normalize(item.rawValue));
    valuesByField.set(item.field, values);
  }
  const warnings: SupplierSdsSection8Warning[] = [];
  if (deduplicated.length === 0) warnings.push("no_section_8_exposure_candidates");
  if ([...valuesByField.values()].some((values) => values.size > 1)) warnings.push("conflicting_section_8_candidates");
  if (deduplicated.some((item) => item.evidence.some((source) => source.source === "ocr"))) warnings.push("section_8_ocr_requires_review");
  if (deduplicated.some((item) => item.evidence.some((source) => source.source === "unknown" || source.source === "mixed"))) warnings.push("section_8_provenance_requires_review");
  if (deduplicated.length > 0) warnings.push("human_review_required");
  return { ...base, candidates: deduplicated, warnings };
}
