import { detectSupplierSdsSections, type SupplierSdsSectionDetectionResult, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";

export const SUPPLIER_SDS_SECTION3_PARSER_VERSION = "formulab-sds-section3-v1";

export type SupplierSdsCompositionField =
  | "substance_or_mixture" | "component_name" | "cas_number" | "ec_number" | "concentration"
  | "m_factor" | "specific_concentration_limit" | "acute_toxicity_estimate"
  | "trade_secret_disclosure" | "undisclosed_remainder";

export interface SupplierSdsCompositionEvidence {
  sourceDocumentHash: string;
  sectionNumber: 3;
  pageNumber: number;
  lineNumber: number;
  excerpt: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsCompositionFact {
  rawValue: string;
  evidence: SupplierSdsCompositionEvidence[];
  reviewRequired: true;
}

export interface SupplierSdsConcentrationFact extends SupplierSdsCompositionFact {
  parsed?: {
    kind: "exact" | "range" | "bounded" | "unparsed";
    lowerBound?: string;
    upperBound?: string;
    bound?: string;
    comparator?: "<" | "<=" | ">" | ">=";
    unit?: string;
    basis?: string;
  };
}

export interface SupplierSdsCompositionAlternateFact {
  field: "component_name" | "cas_number" | "ec_number" | "concentration" | "m_factor" | "specific_concentration_limit" | "acute_toxicity_estimate";
  fact: SupplierSdsCompositionFact | SupplierSdsConcentrationFact;
}

export interface SupplierSdsCompositionComponent {
  /** Extraction-local key only; it is not a material or canonical chemical ID. */
  extractionKey: string;
  originalName?: SupplierSdsCompositionFact;
  casNumber?: SupplierSdsCompositionFact;
  ecNumber?: SupplierSdsCompositionFact;
  concentration?: SupplierSdsConcentrationFact;
  mFactor?: SupplierSdsCompositionFact;
  specificConcentrationLimit?: SupplierSdsCompositionFact;
  acuteToxicityEstimate?: SupplierSdsCompositionFact;
  tradeSecretDisclosures: SupplierSdsCompositionFact[];
  alternateFacts: SupplierSdsCompositionAlternateFact[];
}

export type SupplierSdsSection3Warning =
  | "section_3_not_detected"
  | "section_3_boundary_incomplete"
  | "no_section_3_composition_candidates"
  | "component_identity_missing"
  | "concentration_unit_or_basis_unknown"
  | "conflicting_component_values"
  | "conflicting_declaration_values"
  | "trade_secret_or_proprietary_disclosure"
  | "undisclosed_remainder_disclosed"
  | "section_3_ocr_requires_review"
  | "section_3_provenance_requires_review"
  | "human_review_required";

export interface SupplierSdsSection3CompositionResult {
  sourceDocumentHash: string;
  parserVersion: typeof SUPPLIER_SDS_SECTION3_PARSER_VERSION;
  ocrParserVersion?: string;
  declaration?: SupplierSdsCompositionFact;
  declarationAlternates: SupplierSdsCompositionFact[];
  components: SupplierSdsCompositionComponent[];
  disclosureEvidence: SupplierSdsCompositionFact[];
  warnings: SupplierSdsSection3Warning[];
}

const LABELS: Record<SupplierSdsCompositionField, readonly string[]> = {
  substance_or_mixture: ["product type", "substance or mixture", "substance/mixture", "product form", "type of substance or mixture", "stoff oder gemisch", "substance ou mélange", "sustancia o mezcla", "sostanza o miscela", "stof of mengsel", "substancja lub mieszanina", "substância ou mistura", "madde veya karışım"],
  component_name: ["chemical name", "substance name", "component name", "ingredient name", "name of substance", "identity of component", "chemical identity", "name", "chemischer name", "nom chimique", "nombre químico", "nome chimico", "chemische naam", "nazwa składnika", "nome da substância", "bileşen adı", "madde adı"],
  cas_number: ["cas number", "cas no", "cas#", "cas", "cas-nummer", "nº cas", "numero cas", "cas-nummer", "numer cas", "cas numarası"],
  ec_number: ["ec number", "ec no", "eec number", "einecs number", "ec", "eg nummer", "numéro ce", "número ce", "numero ce", "ce-nummer", "numer we", "número ec", "ec numarası", "ce numarası"],
  concentration: ["concentration", "content", "weight percent", "weight %", "concentration range", "concentration limits", "concentration or concentration range", "gehalt", "concentration ou gamme de concentrations", "concentración", "concentrazione", "concentratie", "stężenie", "concentração", "konsantrasyon", "oran"],
  m_factor: ["m-factor", "m factor", "multiplying factor", "m-faktor", "facteur m", "fator m"],
  specific_concentration_limit: ["specific concentration limit", "specific concentration limits", "scl", "specific limit concentration", "spezifische konzentrationsgrenze", "limite de concentration spécifique", "límite de concentración específica", "limite di concentrazione specifico", "specifieke concentratiegrens", "szczególne stężenie graniczne", "specifica concentração limite", "özel konsantrasyon sınırı"],
  acute_toxicity_estimate: ["acute toxicity estimate", "ate", "estimated acute toxicity", "akute toxizitätsschätzung", "estimation de la toxicité aiguë", "estimación de toxicidad aguda", "stima della tossicità acuta", "acute toxiciteitsschatting", "oszacowana toksyczność ostra", "estimativa de toxicidade aguda", "akut toksisite tahmini"],
  trade_secret_disclosure: ["trade secret", "proprietary", "confidential", "withheld", "business confidential", "trade-secret", "secret commercial", "secreto comercial", "segreto commerciale", "bedrijfsgeheim", "tajemnica handlowa", "segredo comercial", "ticari sır", "ticari gizli"],
  undisclosed_remainder: ["undisclosed remainder", "remaining ingredients not disclosed", "other ingredients not disclosed", "remainder not disclosed", "balance not disclosed", "composition withheld", "undisclosed components", "nicht offengelegte restmenge", "reste non divulgué", "resto no divulgado", "restante não divulgado", "açıklanmayan kalan bileşen"],
};

const CAS_PATTERN = /\b\d{2,7}-\d{2}-\d\b/g;
const EC_PATTERN = /\b\d{3,6}-\d{3}-\d\b/g;
const CONCENTRATION_PATTERN = /^\s*(?<first>(?:[<>]=?\s*)?\d+(?:[.,]\d+)?)\s*(?:(?<rangeSep>-|–|—|\bto\b)\s*(?<second>(?:[<>]=?\s*)?\d+(?:[.,]\d+)?))?\s*(?<unit>wt\s*%|%|ppm|ppb|mg\/l|g\/l)?\s*(?<basis>w\s*\/\s*w|w\s*\/\s*v|v\s*\/\s*v|by\s+weight|by\s+volume)?\s*$/i;
const TRADE_SECRET_PATTERN = /\b(?:trade secret|proprietary|confidential|withheld|business confidential|secret commercial|secreto comercial|segreto commerciale|bedrijfsgeheim|tajemnica handlowa|segredo comercial|ticari sır|ticari gizli)\b/i;
const UNDISCLOSED_PATTERN = /(?:remaining|other|balance|remainder|undisclosed|not disclosed|withheld|proprietary|confidential|trade secret|restante|açıklanmayan).{0,80}(?:ingredient|component|composition|substance|material|bileşen|madde)|(?:ingredient|component|composition|bileşen).{0,80}(?:not disclosed|undisclosed|withheld|confidential|proprietary|trade secret|açıklanmayan)/i;

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss")
    .toLocaleLowerCase("en-US").replace(/[’‘\x60´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function evidence(hash: string, line: SupplierSdsSectionLine): SupplierSdsCompositionEvidence {
  return {
    sourceDocumentHash: hash, sectionNumber: 3, pageNumber: line.pageNumber, lineNumber: line.lineNumber,
    excerpt: line.text, source: line.source ?? "unknown",
    ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
    ...(line.position ? { position: { x: line.position.x, y: line.position.y } } : {}),
  };
}

function fact(rawValue: string, line: SupplierSdsSectionLine, hash: string): SupplierSdsCompositionFact {
  return { rawValue: rawValue.trim(), evidence: [evidence(hash, line)], reviewRequired: true };
}

function concentrationFact(rawValue: string, line: SupplierSdsSectionLine, hash: string): SupplierSdsConcentrationFact {
  const parsed = CONCENTRATION_PATTERN.exec(rawValue);
  if (!parsed?.groups?.first) return { ...fact(rawValue, line, hash), parsed: { kind: "unparsed" } };
  const comparator = parsed.groups.first.trim().match(/^(<=|>=|<|>)/)?.[0] as "<" | "<=" | ">" | ">=" | undefined;
  return {
    ...fact(rawValue, line, hash),
    parsed: {
      kind: parsed.groups.second ? "range" : comparator ? "bounded" : "exact",
      ...(!comparator || parsed.groups.second ? { lowerBound: parsed.groups.first.trim() } : { bound: parsed.groups.first.trim().slice(comparator.length).trim(), comparator }),
      ...(parsed.groups.second ? { upperBound: parsed.groups.second.trim() } : {}),
      ...(parsed.groups.unit ? { unit: parsed.groups.unit.trim() } : {}),
      ...(parsed.groups.basis ? { basis: parsed.groups.basis.trim() } : {}),
    },
  };
}

function parseLabeled(line: SupplierSdsSectionLine): { field: SupplierSdsCompositionField; value: string } | undefined {
  const separator = line.text.search(/[:：]/u);
  if (separator < 0) return undefined;
  const label = normalize(line.text.slice(0, separator).replace(/^\s*3(?:\.\d+)?\s*/, ""));
  const field = (Object.entries(LABELS) as Array<[SupplierSdsCompositionField, readonly string[]]>)
    .find(([, aliases]) => aliases.some((alias) => normalize(alias) === label))?.[0];
  return field ? { field, value: line.text.slice(separator + 1).trim() } : undefined;
}

function sectionContent(lines: SupplierSdsSectionLine[], sections: SupplierSdsSectionDetectionResult): SupplierSdsSectionLine[] | undefined {
  const index = sections.sections.findIndex((section) => section.sectionNumber === 3);
  const section = sections.sections[index];
  if (!section || sections.sections[index + 1]?.sectionNumber !== 4) return undefined;
  if (!section.contentStart || !section.contentEnd) return [];
  const start = lines.findIndex((line) => line.pageNumber === section.contentStart!.pageNumber && line.lineNumber === section.contentStart!.lineNumber);
  const end = lines.findIndex((line) => line.pageNumber === section.contentEnd!.pageNumber && line.lineNumber === section.contentEnd!.lineNumber);
  return start >= 0 && end >= start ? lines.slice(start, end + 1) : [];
}

function emptyComponent(key: string): SupplierSdsCompositionComponent {
  return { extractionKey: key, tradeSecretDisclosures: [], alternateFacts: [] };
}

function setFact<K extends "originalName" | "casNumber" | "ecNumber" | "concentration" | "mFactor" | "specificConcentrationLimit" | "acuteToxicityEstimate">(
  component: SupplierSdsCompositionComponent,
  key: K,
  field: SupplierSdsCompositionAlternateFact["field"],
  value: SupplierSdsCompositionComponent[K] & (SupplierSdsCompositionFact | SupplierSdsConcentrationFact),
): void {
  const existing = component[key];
  if (!existing) {
    component[key] = value as SupplierSdsCompositionComponent[K];
    return;
  }
  if (normalize(existing.rawValue) !== normalize(value.rawValue)) {
    component.alternateFacts.push({ field, fact: value });
    return;
  }
  existing.evidence = [...existing.evidence, ...value.evidence];
}

function parseDelimitedRow(line: SupplierSdsSectionLine, header: string[], hash: string, key: string): SupplierSdsCompositionComponent | undefined {
  const delimiter = line.text.includes("|") ? "|" : line.text.includes("\t") ? "\t" : undefined;
  if (!delimiter) return undefined;
  const cells = line.text.split(delimiter).map((cell) => cell.trim());
  if (cells.length !== header.length) return undefined;
  const component = emptyComponent(key);
  cells.forEach((value, index) => {
    if (!value) return;
    const label = header[index] ?? "";
    if (/\b(?:name|ingredient|component|substance)\b/i.test(label)) setFact(component, "originalName", "component_name", fact(value, line, hash));
    else if (/\bcas\b/i.test(label)) setFact(component, "casNumber", "cas_number", fact(value, line, hash));
    else if (/\b(?:ec|einecs)\b/i.test(label)) setFact(component, "ecNumber", "ec_number", fact(value, line, hash));
    else if (/\b(?:concentration|content|weight\s*%)\b/i.test(label)) setFact(component, "concentration", "concentration", concentrationFact(value, line, hash));
    else if (/\b(?:m\s*factor|m-factor)\b/i.test(label)) setFact(component, "mFactor", "m_factor", fact(value, line, hash));
    else if (/\b(?:scl|specific concentration)\b/i.test(label)) setFact(component, "specificConcentrationLimit", "specific_concentration_limit", fact(value, line, hash));
    else if (/\b(?:ate|acute toxicity estimate)\b/i.test(label)) setFact(component, "acuteToxicityEstimate", "acute_toxicity_estimate", fact(value, line, hash));
    if (TRADE_SECRET_PATTERN.test(value)) component.tradeSecretDisclosures.push(fact(value, line, hash));
  });
  return component.originalName || component.casNumber || component.ecNumber || component.concentration ? component : undefined;
}

export function extractSupplierSdsSection3Composition(input: {
  sourceDocumentHash: string;
  lines: SupplierSdsSectionLine[];
  sections?: SupplierSdsSectionDetectionResult;
  ocrParserVersion?: string;
}): SupplierSdsSection3CompositionResult {
  if (!/^[a-f0-9]{64}$/i.test(input.sourceDocumentHash)) throw new Error("Supplier SDS Section 3 extraction requires a SHA-256 source document hash.");
  const sections = input.sections ?? detectSupplierSdsSections(input.lines);
  const base = {
    sourceDocumentHash: input.sourceDocumentHash.toLowerCase(),
    parserVersion: SUPPLIER_SDS_SECTION3_PARSER_VERSION as typeof SUPPLIER_SDS_SECTION3_PARSER_VERSION,
    ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
  };
  if (!sections.sections.some((section) => section.sectionNumber === 3)) {
    return { ...base, declarationAlternates: [], components: [], disclosureEvidence: [], warnings: ["section_3_not_detected"] };
  }
  const lines = sectionContent(input.lines, sections);
  if (lines === undefined) return { ...base, declarationAlternates: [], components: [], disclosureEvidence: [], warnings: ["section_3_boundary_incomplete"] };

  const hash = input.sourceDocumentHash;
  let declaration: SupplierSdsCompositionFact | undefined;
  const declarationAlternates: SupplierSdsCompositionFact[] = [];
  const components: SupplierSdsCompositionComponent[] = [];
  const disclosureEvidence: SupplierSdsCompositionFact[] = [];
  let current: SupplierSdsCompositionComponent | undefined;
  let tableHeader: string[] | undefined;
  let rowCounter = 0;
  const getCurrent = (): SupplierSdsCompositionComponent => {
    if (!current) {
      rowCounter += 1;
      current = emptyComponent("section3-row-" + rowCounter);
      components.push(current);
    }
    return current;
  };
  const beginComponent = (): SupplierSdsCompositionComponent => {
    rowCounter += 1;
    current = emptyComponent("section3-row-" + rowCounter);
    components.push(current);
    return current;
  };
  const setDeclaration = (value: SupplierSdsCompositionFact): void => {
    if (!declaration) {
      declaration = value;
      return;
    }
    if (normalize(declaration.rawValue) === normalize(value.rawValue)) {
      declaration.evidence.push(...value.evidence);
      return;
    }
    declarationAlternates.push(value);
  };

  for (const line of lines) {
    const rawText = line.text.trim();
    if (!rawText) {
      current = undefined;
      tableHeader = undefined;
      continue;
    }
    const typeMatch = rawText.match(/^\s*(?:(?:product\s+type|type)\s*[:：]\s*)?(substance|mixture)\s*$/i);
    if (typeMatch) {
      setDeclaration(fact(typeMatch[1]!, line, hash));
      continue;
    }

    const delimiter = rawText.includes("|") ? "|" : rawText.includes("\t") ? "\t" : undefined;
    if (delimiter) {
      const cells = rawText.split(delimiter).map((cell) => cell.trim());
      if (cells.some((cell) => /\b(?:cas|ec|einecs|concentration|content)\b/i.test(cell))
        && cells.some((cell) => /\b(?:name|ingredient|component|substance)\b/i.test(cell))) {
        tableHeader = cells;
        current = undefined;
        continue;
      }
      if (tableHeader) {
        rowCounter += 1;
        const row = parseDelimitedRow(line, tableHeader, hash, "section3-row-" + rowCounter);
        if (row) components.push(row);
        for (const cell of cells) {
          if (TRADE_SECRET_PATTERN.test(cell) || UNDISCLOSED_PATTERN.test(cell)) disclosureEvidence.push(fact(cell, line, hash));
        }
        current = undefined;
        continue;
      }
    }

    const parsed = parseLabeled(line);
    if (parsed?.value) {
      if (parsed.field === "substance_or_mixture") {
        setDeclaration(fact(parsed.value, line, hash));
        continue;
      }
      if (parsed.field === "component_name") {
        if (current?.originalName || current?.casNumber || current?.ecNumber || current?.concentration) beginComponent();
        setFact(getCurrent(), "originalName", "component_name", fact(parsed.value, line, hash));
      } else if (parsed.field === "trade_secret_disclosure" || parsed.field === "undisclosed_remainder") {
        const disclosure = fact(parsed.value || rawText, line, hash);
        disclosureEvidence.push(disclosure);
        if (parsed.field === "trade_secret_disclosure") getCurrent().tradeSecretDisclosures.push(disclosure);
      } else {
        const component = getCurrent();
        if (parsed.field === "cas_number") setFact(component, "casNumber", "cas_number", fact(parsed.value, line, hash));
        if (parsed.field === "ec_number") setFact(component, "ecNumber", "ec_number", fact(parsed.value, line, hash));
        if (parsed.field === "concentration") setFact(component, "concentration", "concentration", concentrationFact(parsed.value, line, hash));
        if (parsed.field === "m_factor") setFact(component, "mFactor", "m_factor", fact(parsed.value, line, hash));
        if (parsed.field === "specific_concentration_limit") setFact(component, "specificConcentrationLimit", "specific_concentration_limit", fact(parsed.value, line, hash));
        if (parsed.field === "acute_toxicity_estimate") setFact(component, "acuteToxicityEstimate", "acute_toxicity_estimate", fact(parsed.value, line, hash));
      }
    }

    const casMatch = CAS_PATTERN.exec(rawText);
    CAS_PATTERN.lastIndex = 0;
    const ecNumbers = [...rawText.matchAll(EC_PATTERN)];
    if (casMatch && !parsed) {
      const ecMatch = ecNumbers.find((match) => match.index! > casMatch.index!) ?? ecNumbers[0];
      const concentrationMatch = rawText.match(/(?:\d+(?:[.,]\d+)?\s*(?:-|–|—|to)\s*)?\d+(?:[.,]\d+)?\s*(?:wt\s*%|%|ppm|ppb|mg\/l|g\/l)(?:\s*(?:w\s*\/\s*w|w\s*\/\s*v|v\s*\/\s*v))?/i);
      const name = rawText.slice(0, casMatch.index ?? 0).trim().replace(/[|,;\s]+$/g, "");
      const component = beginComponent();
      if (name) component.originalName = fact(name, line, hash);
      component.casNumber = fact(casMatch[0], line, hash);
      if (ecMatch) component.ecNumber = fact(ecMatch[0], line, hash);
      if (concentrationMatch) component.concentration = concentrationFact(concentrationMatch[0], line, hash);
    }

    if (TRADE_SECRET_PATTERN.test(rawText) || UNDISCLOSED_PATTERN.test(rawText)) {
      const disclosure = fact(rawText, line, hash);
      disclosureEvidence.push(disclosure);
      if (current) current.tradeSecretDisclosures.push(disclosure);
    }
  }

  const finalComponents = components.filter((component) => component.originalName || component.casNumber || component.ecNumber || component.concentration
    || component.mFactor || component.specificConcentrationLimit || component.acuteToxicityEstimate || component.tradeSecretDisclosures.length > 0);
  const warnings: SupplierSdsSection3Warning[] = [];
  if (!declaration && declarationAlternates.length === 0 && finalComponents.length === 0 && disclosureEvidence.length === 0) warnings.push("no_section_3_composition_candidates");
  if (finalComponents.some((component) => !component.originalName || (!component.casNumber && !component.ecNumber))) warnings.push("component_identity_missing");
  const concentrations: SupplierSdsConcentrationFact[] = finalComponents.flatMap((component) => [
    ...(component.concentration ? [component.concentration] : []),
    ...component.alternateFacts.filter((item) => item.field === "concentration" && "parsed" in item.fact)
      .map((item) => item.fact as SupplierSdsConcentrationFact),
  ]);
  if (concentrations.some((item) => !item.parsed?.unit || !item.parsed?.basis)) warnings.push("concentration_unit_or_basis_unknown");
  if (finalComponents.some((component) => component.alternateFacts.length > 0)) warnings.push("conflicting_component_values");
  if (declarationAlternates.length > 0) warnings.push("conflicting_declaration_values");
  if (disclosureEvidence.some((item) => TRADE_SECRET_PATTERN.test(item.rawValue))) warnings.push("trade_secret_or_proprietary_disclosure");
  if (disclosureEvidence.some((item) => UNDISCLOSED_PATTERN.test(item.rawValue))) warnings.push("undisclosed_remainder_disclosed");
  const allEvidence = [...(declaration?.evidence ?? []), ...declarationAlternates.flatMap((item) => item.evidence), ...disclosureEvidence.flatMap((item) => item.evidence), ...finalComponents.flatMap((component) => [
    ...component.originalName?.evidence ?? [], ...component.casNumber?.evidence ?? [], ...component.ecNumber?.evidence ?? [],
    ...component.concentration?.evidence ?? [], ...component.mFactor?.evidence ?? [], ...component.specificConcentrationLimit?.evidence ?? [],
    ...component.acuteToxicityEstimate?.evidence ?? [], ...component.tradeSecretDisclosures.flatMap((item) => item.evidence),
    ...component.alternateFacts.flatMap((item) => item.fact.evidence),
  ])];
  if (allEvidence.some((item) => item.source === "ocr")) warnings.push("section_3_ocr_requires_review");
  if (allEvidence.some((item) => item.source === "unknown" || item.source === "mixed")) warnings.push("section_3_provenance_requires_review");
  if (declaration || declarationAlternates.length > 0 || finalComponents.length > 0 || disclosureEvidence.length > 0) warnings.push("human_review_required");
  return { ...base, ...(declaration ? { declaration } : {}), declarationAlternates, components: finalComponents, disclosureEvidence, warnings };
}
