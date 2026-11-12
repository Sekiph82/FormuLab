import { detectSupplierSdsSections, type SupplierSdsSectionDetectionResult, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { createSupplierSdsMeasurementContext, type SupplierSdsMeasurementContext } from "./supplierSdsMeasurementContext";

export const SUPPLIER_SDS_SECTION9_PARSER_VERSION = "formulab-sds-section9-v1";

export type SupplierSdsPhysicalPropertyField =
  | "physical_state"
  | "appearance"
  | "color"
  | "odor"
  | "odor_threshold"
  | "ph"
  | "melting_point"
  | "freezing_point"
  | "melting_freezing_point"
  | "boiling_point"
  | "flash_point"
  | "density"
  | "relative_density"
  | "density_or_relative_density"
  | "solubility"
  | "vapor_pressure"
  | "vapor_density"
  | "partition_coefficient"
  | "viscosity"
  | "molecular_weight"
  | "other_physical_property";

export interface SupplierSdsPhysicalPropertyEvidence {
  sourceDocumentHash: string;
  sectionNumber: 9;
  pageNumber: number;
  lineNumber: number;
  excerpt: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsPhysicalPropertyCandidate {
  field: SupplierSdsPhysicalPropertyField;
  /** Original printed value, retaining stated units, qualifiers, conditions, and wording. */
  rawValue: string;
  extractionMethod: "explicit_label" | "explicit_property_code";
  evidence: SupplierSdsPhysicalPropertyEvidence[];
  measurementContext: SupplierSdsMeasurementContext;
  reviewRequired: true;
}

export type SupplierSdsSection9Warning =
  | "section_9_not_detected"
  | "section_9_boundary_incomplete"
  | "no_section_9_property_candidates"
  | "conflicting_section_9_candidates"
  | "section_9_ocr_requires_review"
  | "section_9_provenance_requires_review"
  | "section_9_typical_value_not_specification"
  | "human_review_required";

export interface SupplierSdsSection9Result {
  sourceDocumentHash: string;
  parserVersion: typeof SUPPLIER_SDS_SECTION9_PARSER_VERSION;
  ocrParserVersion?: string;
  candidates: SupplierSdsPhysicalPropertyCandidate[];
  warnings: SupplierSdsSection9Warning[];
}

const LABELS: Record<SupplierSdsPhysicalPropertyField, readonly string[]> = {
  physical_state: ["physical state", "physical form", "state of matter", "physical state at 20°c", "physikalischer zustand", "état physique", "estado físico", "stato fisico", "fysische toestand", "stan fizyczny", "estado físico", "fiziksel durum", "fiziksel hâl"],
  appearance: ["appearance", "physical appearance", "form", "appearance and color", "aussehen", "aspect", "aspecto", "aspetto", "uiterlijk", "wygląd", "aparência", "görünüm"],
  color: ["colour", "color", "colour/color", "farbe", "couleur", "color", "colore", "kleur", "barwa", "cor", "renk"],
  odor: ["odour", "odor", "geruch", "odeur", "olor", "odore", "geur", "zapach", "odor", "koku"],
  odor_threshold: ["odour threshold", "odor threshold", "geruchsschwelle", "seuil olfactif", "umbral olfativo", "soglia olfattiva", "geurdrempel", "próg węchowy", "limiar olfativo", "koku eşiği"],
  ph: ["ph", "ph value", "ph-value", "ph (value)", "pH"],
  melting_point: ["melting point", "melting temperature", "schmelzpunkt", "point de fusion", "punto de fusión", "punto di fusione", "smeltpunt", "temperatura topnienia", "ponto de fusão", "erime noktası"],
  freezing_point: ["freezing point", "freezing temperature", "solidification point", "congelation point", "gefriertemperatur", "point de congélation", "punto de congelación", "punto di congelamento", "vriespunt", "temperatura zamarzania", "ponto de congelamento", "donma noktası"],
  melting_freezing_point: ["melting point/freezing point", "melting point / freezing point", "melting/freezing point", "melting/freezing temperature", "schmelz-/gefrierpunkt", "point de fusion/congélation", "punto de fusión/congelación", "ponto de fusão/congelamento"],
  boiling_point: ["boiling point", "initial boiling point", "initial boiling point and boiling range", "boiling point/range", "siedepunkt", "point initial d'ébullition", "punto inicial de ebullición", "punto iniziale di ebollizione", "beginkookpunt", "początkowa temperatura wrzenia", "ponto de ebulição inicial", "kaynama noktası", "başlangıç kaynama noktası"],
  flash_point: ["flash point", "closed cup flash point", "open cup flash point", "flammpunkt", "point d'éclair", "punto de inflamación", "punto di infiammabilità", "vlampunt", "temperatura zapłonu", "ponto de inflamação", "parlama noktası"],
  density: ["density", "mass density", "dichte", "masse volumique", "densidad", "densità", "dichtheid", "gęstość", "densidade", "yoğunluk"],
  density_or_relative_density: ["density and/or relative density", "density/relative density", "density or relative density"],
  relative_density: ["relative density", "relative density (water = 1)", "specific gravity", "relative dichte", "densité relative", "densidad relativa", "densità relativa", "relatieve dichtheid", "gęstość względna", "densidade relativa", "bağıl yoğunluk", "özgül ağırlık"],
  solubility: ["solubility", "solubility in water", "water solubility", "solubilities", "löslichkeit", "solubilité", "solubilidad", "solubilità", "oplosbaarheid", "rozpuszczalność", "solubilidade", "çözünürlük", "suda çözünürlük"],
  vapor_pressure: ["vapor pressure", "vapour pressure", "vapor pressure at 20°c", "vapour pressure at 20°c", "dampfdruck", "pression de vapeur", "presión de vapor", "tensione di vapore", "dampspanning", "prężność par", "pressão de vapor", "buhar basıncı"],
  vapor_density: ["vapor density", "vapour density", "relative vapor density", "relative vapour density", "dampfdichte", "densité de vapeur", "densidad de vapor", "densità di vapore", "dampdichtheid", "gęstość par", "densidade de vapor", "buhar yoğunluğu"],
  partition_coefficient: ["partition coefficient", "partition coefficient n-octanol/water", "log pow", "log kow", "octanol/water partition coefficient", "verteilungskoeffizient", "coefficient de partage", "coeficiente de reparto", "coefficiente di ripartizione", "verdelingscoëfficiënt", "współczynnik podziału", "coeficiente de partição", "dağılım katsayısı", "log pow"],
  viscosity: ["viscosity", "dynamic viscosity", "kinematic viscosity", "viskosität", "viscosité", "viscosidad", "viscosità", "viscositeit", "lepkość", "viscosidade", "viskozite"],
  molecular_weight: ["molecular weight", "molecular mass", "molecular weight/mass", "molecular formula weight", "molekulargewicht", "masse moléculaire", "peso molecular", "peso molecolare", "molecuulgewicht", "masa cząsteczkowa", "massa molecular", "molekül ağırlığı", "moleküler ağırlık"],
  other_physical_property: ["decomposition temperature", "auto-ignition temperature", "autoignition temperature", "flammability", "explosive properties", "oxidizing properties", "surface tension", "particle characteristics", "decomposition temperature", "self-ignition temperature", "zersetungstemperatur", "température de décomposition", "temperatura de descomposición", "temperatura di decomposizione", "ontledingstemperatuur", "temperatura rozkładu", "dekompozisyon sıcaklığı"],
};

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss")
    .toLocaleLowerCase("en-US").replace(/[’‘\x60´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const SORTED_LABELS = (Object.entries(LABELS) as Array<[SupplierSdsPhysicalPropertyField, readonly string[]]>)
  .flatMap(([field, aliases]) => aliases.map((rawAlias) => ({ field, alias: normalize(rawAlias), rawAlias })))
  .sort((left, right) => right.alias.length - left.alias.length);

function parseLabel(line: SupplierSdsSectionLine): { field: SupplierSdsPhysicalPropertyField; value: string } | undefined {
  const separator = line.text.search(/[:：]/u);
  const labelText = separator < 0 ? line.text : line.text.slice(0, separator);
  const normalizedLabel = normalize(labelText.replace(/^\s*9(?:\.\d+)?\s*/, ""));
  const match = SORTED_LABELS.find((item) => item.alias === normalizedLabel);
  if (match) return { field: match.field, value: separator < 0 ? "" : line.text.slice(separator + 1).trim() };
  if (separator >= 0) return undefined;

  const normalizedLine = normalize(line.text);
  const shorthand = SORTED_LABELS.find((item) => normalizedLine.startsWith(item.alias + " "));
  if (!shorthand) return undefined;
  return { field: shorthand.field, value: line.text.slice(shorthand.rawAlias.length).trim().replace(/^[:：\s]+/u, "") };
}

function sectionContent(lines: SupplierSdsSectionLine[], sections: SupplierSdsSectionDetectionResult): SupplierSdsSectionLine[] | undefined {
  const index = sections.sections.findIndex((section) => section.sectionNumber === 9);
  const section = sections.sections[index];
  if (!section || sections.sections[index + 1]?.sectionNumber !== 10) return undefined;
  if (!section.contentStart || !section.contentEnd) return [];
  const start = lines.findIndex((line) => line.pageNumber === section.contentStart!.pageNumber && line.lineNumber === section.contentStart!.lineNumber);
  const end = lines.findIndex((line) => line.pageNumber === section.contentEnd!.pageNumber && line.lineNumber === section.contentEnd!.lineNumber);
  return start >= 0 && end >= start ? lines.slice(start, end + 1) : [];
}

function evidence(hash: string, line: SupplierSdsSectionLine): SupplierSdsPhysicalPropertyEvidence {
  return {
    sourceDocumentHash: hash, sectionNumber: 9, pageNumber: line.pageNumber, lineNumber: line.lineNumber,
    excerpt: line.text, source: line.source ?? "unknown",
    ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
    ...(line.position ? { position: { x: line.position.x, y: line.position.y } } : {}),
  };
}

function candidate(field: SupplierSdsPhysicalPropertyField, rawValue: string, evidenceLines: SupplierSdsSectionLine[], hash: string, extractionMethod: SupplierSdsPhysicalPropertyCandidate["extractionMethod"]): SupplierSdsPhysicalPropertyCandidate {
  const item = { field, rawValue, extractionMethod, evidence: evidenceLines.map((line) => evidence(hash, line)) };
  return { ...item, measurementContext: createSupplierSdsMeasurementContext(item), reviewRequired: true };
}

function isSubsectionHeading(line: SupplierSdsSectionLine): boolean {
  return /^\s*9\.\d+(?:\s|[.):\-–—]|$)/u.test(line.text);
}

function isUnavailableValue(value: string): boolean {
  return /^(?:data\s+not\s+available|not\s+available|no\s+data(?:\s+available)?|not\s+determined|not\s+known|not\s+applicable|n\/?a|[-—*])[.!]?$/iu.test(value.trim());
}

function continuation(lines: SupplierSdsSectionLine[], startIndex: number): SupplierSdsSectionLine[] {
  const collected = [lines[startIndex]!];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const previous = lines[index - 1]!;
    if (line.pageNumber !== previous.pageNumber || line.lineNumber !== previous.lineNumber + 1 || !line.text.trim()
      || parseLabel(line) || isSubsectionHeading(line)) break;
    collected.push(line);
  }
  return collected;
}

export function extractSupplierSdsSection9PhysicalProperties(input: {
  sourceDocumentHash: string;
  lines: SupplierSdsSectionLine[];
  sections?: SupplierSdsSectionDetectionResult;
  ocrParserVersion?: string;
}): SupplierSdsSection9Result {
  if (!/^[a-f0-9]{64}$/i.test(input.sourceDocumentHash)) throw new Error("Supplier SDS Section 9 extraction requires a SHA-256 source document hash.");
  const sections = input.sections ?? detectSupplierSdsSections(input.lines);
  const base = {
    sourceDocumentHash: input.sourceDocumentHash.toLowerCase(),
    parserVersion: SUPPLIER_SDS_SECTION9_PARSER_VERSION as typeof SUPPLIER_SDS_SECTION9_PARSER_VERSION,
    ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
  };
  if (!sections.sections.some((section) => section.sectionNumber === 9)) return { ...base, candidates: [], warnings: ["section_9_not_detected"] };
  const lines = sectionContent(input.lines, sections);
  if (lines === undefined) return { ...base, candidates: [], warnings: ["section_9_boundary_incomplete"] };

  const candidates: SupplierSdsPhysicalPropertyCandidate[] = [];
  const hash = input.sourceDocumentHash;
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
          || !next.text.trim() || parseLabel(next) || isSubsectionHeading(next)) break;
        evidenceLines.push(next);
        cursor += 1;
      }
      const rawValue = [parsed.value, ...evidenceLines.slice(1).map((item) => item.text.trim())].filter(Boolean).join(" ").trim();
      if (rawValue && !isUnavailableValue(rawValue)) {
        candidates.push(candidate(parsed.field, rawValue, evidenceLines, hash, "explicit_label"));
        index = cursor - 1;
      }
      continue;
    }
    if (/\b(?:log\s*(?:P|K\s*ow)|T\s*°?C)\b/i.test(line.text)) candidates.push(candidate("other_physical_property", line.text.trim(), continuation(lines, index), hash, "explicit_property_code"));
  }

  const valuesByField = new Map<SupplierSdsPhysicalPropertyField, Set<string>>();
  for (const item of candidates) {
    const values = valuesByField.get(item.field) ?? new Set<string>();
    values.add(normalize(item.rawValue));
    valuesByField.set(item.field, values);
  }
  const warnings: SupplierSdsSection9Warning[] = [];
  if (candidates.length === 0) warnings.push("no_section_9_property_candidates");
  if ([...valuesByField.values()].some((values) => values.size > 1)) warnings.push("conflicting_section_9_candidates");
  if (candidates.some((item) => item.evidence.some((source) => source.source === "ocr"))) warnings.push("section_9_ocr_requires_review");
  if (candidates.some((item) => item.evidence.some((source) => source.source === "unknown" || source.source === "mixed"))) warnings.push("section_9_provenance_requires_review");
  if (candidates.some((item) => item.measurementContext.claimKind === "typical")) warnings.push("section_9_typical_value_not_specification");
  if (candidates.length > 0) warnings.push("human_review_required");
  return { ...base, candidates, warnings };
}
