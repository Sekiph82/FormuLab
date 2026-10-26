import { detectSupplierSdsSections, type SupplierSdsSectionDetectionResult, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";

export const SUPPLIER_SDS_SECTION7_PARSER_VERSION = "formulab-sds-section7-v1";

export type SupplierSdsSection7Field =
  | "storage_temperature"
  | "storage_conditions"
  | "container_material_compatibility"
  | "shelf_life"
  | "storage_stability"
  | "incompatible_materials"
  | "handling_constraints";

export interface SupplierSdsSection7Evidence {
  sourceDocumentHash: string;
  sectionNumber: 7;
  pageNumber: number;
  lineNumber: number;
  excerpt: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsSection7Candidate {
  field: SupplierSdsSection7Field;
  rawValue: string;
  extractionMethod: "explicit_label" | "explicit_statement";
  evidence: SupplierSdsSection7Evidence[];
  reviewRequired: true;
}

export type SupplierSdsSection7Warning =
  | "section_7_not_detected"
  | "section_7_boundary_incomplete"
  | "no_section_7_storage_handling_candidates"
  | "conflicting_section_7_candidates"
  | "section_7_ocr_requires_review"
  | "section_7_provenance_requires_review"
  | "human_review_required";

export interface SupplierSdsSection7Result {
  sourceDocumentHash: string;
  parserVersion: typeof SUPPLIER_SDS_SECTION7_PARSER_VERSION;
  ocrParserVersion?: string;
  candidates: SupplierSdsSection7Candidate[];
  warnings: SupplierSdsSection7Warning[];
}

const LABELS: Record<SupplierSdsSection7Field, readonly string[]> = {
  storage_temperature: ["storage temperature", "recommended storage temperature", "temperature for storage", "lagerungstemperatur", "température de stockage", "temperatura de almacenamiento", "temperatura di conservazione", "opslagtemperatuur", "temperatura przechowywania", "temperatura de armazenamento", "depolama sıcaklığı", "saklama sıcaklığı"],
  storage_conditions: ["conditions for safe storage", "storage conditions", "conditions of storage", "storage and handling", "safe storage", "lagerbedingungen", "conditions de stockage", "condiciones de almacenamiento", "condizioni di conservazione", "opslagcondities", "warunki przechowywania", "condições de armazenagem", "depolama koşulları", "saklama koşulları"],
  container_material_compatibility: ["suitable container material", "suitable materials", "compatible materials", "container compatibility", "packaging material", "material of container", "geeignete behältermaterialien", "matériaux compatibles", "materiales compatibles", "materiali compatibili", "geschikte verpakkingsmaterialen", "odpowiednie materiały", "materiais compatíveis", "uygun kap malzemesi", "uyumlu ambalaj malzemesi"],
  shelf_life: ["shelf life", "storage life", "shelf-life", "haltbarkeit", "durée de conservation", "vida útil", "validità", "houdbaarheid", "okres trwałości", "prazo de validade", "raf ömrü"],
  storage_stability: ["storage stability", "stability in storage", "stability during storage", "lagerstabilität", "stabilité au stockage", "estabilidad durante el almacenamiento", "stabilità durante lo stoccaggio", "opslagstabiliteit", "stabilność podczas przechowywania", "estabilidade durante o armazenamento", "depolama stabilitesi"],
  incompatible_materials: ["incompatible materials", "materials to avoid", "incompatibilities", "materials and substances to avoid", "unverträgliche materialien", "matières incompatibles", "materiales incompatibles", "materiali incompatibili", "onverenigbare materialen", "materiały niezgodne", "materiais incompatíveis", "uyumsuz malzemeler", "kaçınılması gereken malzemeler"],
  handling_constraints: ["handling precautions", "safe handling", "precautions for safe handling", "handling restrictions", "sichere handhabung", "précautions de manipulation", "precauciones de manipulación", "precauzioni per la manipolazione", "veilige hantering", "środki ostrożności dotyczące postępowania", "precauções de manuseamento", "güvenli elleçleme", "elleçleme önlemleri", "elleçleme kısıtlamaları"],
};

const IMPERATIVE_STORAGE = /\b(?:store|keep\s+(?:in|at|below|above|container|tightly|sealed|away from heat)|protect\s+from|maintain\s+(?:at|below|above)|do not store|avoid storage|preserve|almacenar|conservar|protéger|stocker|lagern|aufbewahren|bewahren|conservare|bewaren|przechowywać|armazenar|depolayın|saklayın|koruyun)\b/i;
const IMPERATIVE_HANDLING = /\b(?:avoid|do not|must not|use only|prevent|ensure|wear|handle|keep away|avoid contact|evitar|ne pas|vermeiden|non usare|voorkom|unikać|evite|kaçının|kullanmayın|temasından kaçının)\b/i;
const HANDLING_CONTEXT = /\b(?:contact|transfer|handling|handle|ventilation|wear|gloves|skin|eyes|inhal(?:e|ation)|exposure|loading|unloading|mixing|opening|closed process)\b/i;

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss")
    .toLocaleLowerCase("en-US").replace(/[’‘\x60´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function parseLabel(line: SupplierSdsSectionLine): { field: SupplierSdsSection7Field; value: string } | undefined {
  const separator = line.text.search(/[:：]/u);
  const rawLabel = separator < 0 ? line.text : line.text.slice(0, separator);
  const label = normalize(rawLabel.replace(/^\s*7(?:\.\d+)?\s*/, ""));
  const field = (Object.entries(LABELS) as Array<[SupplierSdsSection7Field, readonly string[]]>)
    .find(([, aliases]) => aliases.some((alias) => normalize(alias) === label))?.[0];
  return field ? { field, value: separator < 0 ? "" : line.text.slice(separator + 1).trim() } : undefined;
}

function sectionContent(lines: SupplierSdsSectionLine[], sections: SupplierSdsSectionDetectionResult): SupplierSdsSectionLine[] | undefined {
  const index = sections.sections.findIndex((section) => section.sectionNumber === 7);
  const section = sections.sections[index];
  if (!section || sections.sections[index + 1]?.sectionNumber !== 8) return undefined;
  if (!section.contentStart || !section.contentEnd) return [];
  const start = lines.findIndex((line) => line.pageNumber === section.contentStart!.pageNumber && line.lineNumber === section.contentStart!.lineNumber);
  const end = lines.findIndex((line) => line.pageNumber === section.contentEnd!.pageNumber && line.lineNumber === section.contentEnd!.lineNumber);
  return start >= 0 && end >= start ? lines.slice(start, end + 1) : [];
}

function makeEvidence(hash: string, line: SupplierSdsSectionLine): SupplierSdsSection7Evidence {
  return {
    sourceDocumentHash: hash, sectionNumber: 7, pageNumber: line.pageNumber, lineNumber: line.lineNumber,
    excerpt: line.text, source: line.source ?? "unknown",
    ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
    ...(line.position ? { position: { x: line.position.x, y: line.position.y } } : {}),
  };
}

function makeCandidate(field: SupplierSdsSection7Field, rawValue: string, evidenceLines: SupplierSdsSectionLine[], hash: string, method: SupplierSdsSection7Candidate["extractionMethod"]): SupplierSdsSection7Candidate {
  return {
    field,
    rawValue,
    extractionMethod: method,
    evidence: evidenceLines.map((line) => makeEvidence(hash, line)),
    reviewRequired: true,
  };
}

function isSubsectionHeading(line: SupplierSdsSectionLine): boolean {
  return /^\s*7\.\d+(?:\s|[.):\-–—]|$)/u.test(line.text);
}

function continuation(lines: SupplierSdsSectionLine[], startIndex: number, field: "storage_conditions" | "handling_constraints"): SupplierSdsSectionLine[] {
  const collected = [lines[startIndex]!];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const previous = lines[index - 1]!;
    if (line.pageNumber !== previous.pageNumber || line.lineNumber !== previous.lineNumber + 1 || !line.text.trim()
      || parseLabel(line) || isSubsectionHeading(line)
      || (field === "storage_conditions" && IMPERATIVE_HANDLING.test(line.text))
      || (field === "handling_constraints" && IMPERATIVE_STORAGE.test(line.text))) break;
    collected.push(line);
  }
  return collected;
}

export function extractSupplierSdsSection7StorageHandling(input: {
  sourceDocumentHash: string;
  lines: SupplierSdsSectionLine[];
  sections?: SupplierSdsSectionDetectionResult;
  ocrParserVersion?: string;
}): SupplierSdsSection7Result {
  if (!/^[a-f0-9]{64}$/i.test(input.sourceDocumentHash)) throw new Error("Supplier SDS Section 7 extraction requires a SHA-256 source document hash.");
  const sections = input.sections ?? detectSupplierSdsSections(input.lines);
  const base = {
    sourceDocumentHash: input.sourceDocumentHash.toLowerCase(),
    parserVersion: SUPPLIER_SDS_SECTION7_PARSER_VERSION as typeof SUPPLIER_SDS_SECTION7_PARSER_VERSION,
    ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
  };
  if (!sections.sections.some((section) => section.sectionNumber === 7)) return { ...base, candidates: [], warnings: ["section_7_not_detected"] };
  const lines = sectionContent(input.lines, sections);
  if (lines === undefined) return { ...base, candidates: [], warnings: ["section_7_boundary_incomplete"] };
  const candidates: SupplierSdsSection7Candidate[] = [];
  const hash = input.sourceDocumentHash;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const parsed = parseLabel(line);
    if (parsed) {
      const valueLines = [line];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = lines[cursor]!;
        const previous = lines[cursor - 1]!;
        if (next.pageNumber !== previous.pageNumber || next.lineNumber !== previous.lineNumber + 1
          || !next.text.trim() || parseLabel(next) || isSubsectionHeading(next)
          || IMPERATIVE_STORAGE.test(next.text) || IMPERATIVE_HANDLING.test(next.text)) break;
        valueLines.push(next);
        cursor += 1;
      }
      const rawValue = [parsed.value, ...valueLines.slice(1).map((item) => item.text.trim())].join(" ").trim();
      if (rawValue) {
        candidates.push(makeCandidate(parsed.field, rawValue, valueLines, hash, "explicit_label"));
        if (parsed.field === "storage_conditions") {
          const handlingClauses = parsed.value.split(/;\s*/).map((clause) => clause.trim())
            .filter((clause) => IMPERATIVE_HANDLING.test(clause) && HANDLING_CONTEXT.test(clause));
          if (handlingClauses.length > 0) candidates.push(makeCandidate("handling_constraints", handlingClauses.join("; "), [line], hash, "explicit_statement"));
        }
        index = cursor - 1;
      }
      continue;
    }
    if (IMPERATIVE_STORAGE.test(line.text)) {
      const evidenceLines = continuation(lines, index, "storage_conditions");
      candidates.push(makeCandidate("storage_conditions", evidenceLines.map((item) => item.text.trim()).join(" "), evidenceLines, hash, "explicit_statement"));
      index += evidenceLines.length - 1;
      continue;
    }
    if (IMPERATIVE_HANDLING.test(line.text)) {
      const evidenceLines = continuation(lines, index, "handling_constraints");
      candidates.push(makeCandidate("handling_constraints", evidenceLines.map((item) => item.text.trim()).join(" "), evidenceLines, hash, "explicit_statement"));
      index += evidenceLines.length - 1;
    }
  }

  const valuesByField = new Map<SupplierSdsSection7Field, Set<string>>();
  for (const candidate of candidates) {
    const values = valuesByField.get(candidate.field) ?? new Set<string>();
    values.add(normalize(candidate.rawValue));
    valuesByField.set(candidate.field, values);
  }
  const warnings: SupplierSdsSection7Warning[] = [];
  if (candidates.length === 0) warnings.push("no_section_7_storage_handling_candidates");
  if ([...valuesByField.values()].some((values) => values.size > 1)) warnings.push("conflicting_section_7_candidates");
  if (candidates.some((candidate) => candidate.evidence.some((item) => item.source === "ocr"))) warnings.push("section_7_ocr_requires_review");
  if (candidates.some((candidate) => candidate.evidence.some((item) => item.source === "unknown" || item.source === "mixed"))) warnings.push("section_7_provenance_requires_review");
  if (candidates.length > 0) warnings.push("human_review_required");
  return { ...base, candidates, warnings };
}
