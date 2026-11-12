import { detectSupplierSdsSections, type SupplierSdsSectionDetectionResult, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";

export const SUPPLIER_SDS_SECTIONS10_TO15_PARSER_VERSION = "formulab-sds-sections10-15-v1";
export type SupplierSdsEvidenceSectionNumber = 10 | 11 | 12 | 13 | 14 | 15;
export type SupplierSdsSections10To15Field =
  | "reactivity" | "chemical_stability" | "hazardous_reactions" | "conditions_to_avoid" | "incompatible_materials" | "hazardous_decomposition_products"
  | "acute_toxicity" | "skin_corrosion_irritation" | "serious_eye_damage_irritation" | "respiratory_skin_sensitization" | "germ_cell_mutagenicity" | "carcinogenicity"
  | "reproductive_toxicity" | "stot_single_exposure" | "stot_repeated_exposure" | "aspiration_hazard" | "toxicological_symptoms" | "toxicological_other"
  | "ecological_toxicity" | "persistence_degradability" | "bioaccumulative_potential" | "mobility_in_soil" | "pbt_vpvb_assessment" | "endocrine_disruption_ecological" | "ecological_other"
  | "waste_treatment_methods" | "wastewater_disposal" | "contaminated_packaging_disposal" | "disposal_other"
  | "un_number" | "un_proper_shipping_name" | "transport_hazard_class" | "packing_group" | "environmental_transport_hazard" | "user_transport_precautions" | "maritime_bulk_transport" | "transport_other"
  | "regulatory_safety_health_environment" | "chemical_safety_assessment" | "regulatory_other";

export interface SupplierSdsSections10To15Evidence {
  sourceDocumentHash: string;
  sectionNumber: SupplierSdsEvidenceSectionNumber;
  pageNumber: number;
  lineNumber: number;
  excerpt: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
}

export interface SupplierSdsSections10To15Candidate {
  field: SupplierSdsSections10To15Field;
  sectionNumber: SupplierSdsEvidenceSectionNumber;
  rawValue: string;
  extractionMethod: "explicit_label";
  evidence: SupplierSdsSections10To15Evidence[];
  reviewRequired: true;
}

export type SupplierSdsSections10To15Warning =
  | "sections_10_to_15_not_detected"
  | "section_boundary_incomplete"
  | "no_sections_10_to_15_candidates"
  | "conflicting_section_candidates"
  | "sections_10_to_15_ocr_requires_review"
  | "sections_10_to_15_provenance_requires_review"
  | "human_review_required";

export interface SupplierSdsSections10To15Result {
  sourceDocumentHash: string;
  parserVersion: typeof SUPPLIER_SDS_SECTIONS10_TO15_PARSER_VERSION;
  ocrParserVersion?: string;
  candidates: SupplierSdsSections10To15Candidate[];
  warnings: SupplierSdsSections10To15Warning[];
}

type Label = { sectionNumber: SupplierSdsEvidenceSectionNumber; field: SupplierSdsSections10To15Field; aliases: readonly string[] };
const LABELS: readonly Label[] = [
  { sectionNumber: 10, field: "reactivity", aliases: ["reactivity", "reactivity hazards", "reaktivität", "réactivité", "reactividad", "reattività", "reactiviteit", "reaktywność", "reatividade", "reaktivite"] },
  { sectionNumber: 10, field: "chemical_stability", aliases: ["chemical stability", "stability", "chemische stabilität", "stabilité chimique", "estabilidad química", "stabilità chimica", "chemische stabiliteit", "stabilność chemiczna", "estabilidade química", "kimyasal kararlılık"] },
  { sectionNumber: 10, field: "hazardous_reactions", aliases: ["possibility of hazardous reactions", "hazardous reactions", "hazardous polymerisation", "möglichkeit gefährlicher reaktionen", "possibilité de réactions dangereuses", "posibilidad de reacciones peligrosas", "possibilità di reazioni pericolose", "mogelijke gevaarlijke reacties", "możliwość wystąpienia niebezpiecznych reakcji", "possibilidade de reações perigosas", "zararlı reaksiyon olasılığı"] },
  { sectionNumber: 10, field: "conditions_to_avoid", aliases: ["conditions to avoid", "conditions to be avoided", "zu vermeidende bedingungen", "conditions à éviter", "condiciones que deben evitarse", "condizioni da evitare", "te vermijden omstandigheden", "warunki, których należy unikać", "condições a evitar", "kaçınılması gereken koşullar"] },
  { sectionNumber: 10, field: "incompatible_materials", aliases: ["incompatible materials", "materials to avoid", "incompatible materials or substances", "materials and substances to avoid", "unverträgliche materialien", "matières incompatibles", "materiales incompatibles", "materiali incompatibili", "chemisch op elkaar inwerkende materialen", "materiały niezgodne", "materiais incompatíveis", "kaçınılması gereken maddeler"] },
  { sectionNumber: 10, field: "hazardous_decomposition_products", aliases: ["hazardous decomposition products", "decomposition products", "gefährliche zersetzungsprodukte", "produits de décomposition dangereux", "productos de descomposición peligrosos", "prodotti di decomposizione pericolosi", "gevaarlijke ontledingsproducten", "niebezpieczne produkty rozkładu", "produtos de decomposição perigosos", "zararlı bozunma ürünleri"] },
  { sectionNumber: 11, field: "acute_toxicity", aliases: ["acute toxicity", "acute toxic effects", "acute toxicity estimates", "akute toxizität", "toxicité aiguë", "toxicidad aguda", "tossicità acuta", "acute toxiciteit", "toksyczność ostra", "toxicidade aguda", "akut toksisite"] },
  { sectionNumber: 11, field: "skin_corrosion_irritation", aliases: ["skin corrosion/irritation", "skin corrosion irritation", "skin irritation", "skin corrosion", "ätzung/reizung der haut", "corrosion/irritation cutanée", "corrosión/irritación cutánea", "corrosione/irritazione cutanea", "huidcorrosie/-irritatie", "działanie żrące/drażniące na skórę", "corrosão/irritação cutânea", "cilt aşınması/tahrişi"] },
  { sectionNumber: 11, field: "serious_eye_damage_irritation", aliases: ["serious eye damage/eye irritation", "serious eye damage irritation", "eye damage/irritation", "eye irritation", "schwere augenschädigung/augenreizung", "lésions oculaires graves/irritation oculaire", "lesiones oculares graves/irritación ocular"] },
  { sectionNumber: 11, field: "respiratory_skin_sensitization", aliases: ["respiratory or skin sensitisation", "respiratory or skin sensitization", "respiratory sensitisation", "respiratory sensitization", "skin sensitisation", "skin sensitization", "sensibilisierung der atemwege oder der haut", "sensibilisation respiratoire ou cutanée", "sensibilización respiratoria o cutánea"] },
  { sectionNumber: 11, field: "germ_cell_mutagenicity", aliases: ["germ cell mutagenicity", "mutagenicity", "keimzell-mutagenität", "mutagénicité sur les cellules germinales", "mutagenicidad en células germinales"] },
  { sectionNumber: 11, field: "carcinogenicity", aliases: ["carcinogenicity", "carcinogenic effects", "karzinogenität", "cancérogénicité", "carcinogenicidad"] },
  { sectionNumber: 11, field: "reproductive_toxicity", aliases: ["reproductive toxicity", "reproductive effects", "reproduktionstoxizität", "toxicité pour la reproduction", "toxicidad para la reproducción"] },
  { sectionNumber: 11, field: "stot_single_exposure", aliases: ["specific target organ toxicity - single exposure", "specific target organ toxicity single exposure", "stot single exposure", "spezifische zielorgan-toxizität bei einmaliger exposition", "toxicité spécifique pour certains organes cibles - exposition unique", "toxicidad específica en determinados órganos - exposición única"] },
  { sectionNumber: 11, field: "stot_repeated_exposure", aliases: ["specific target organ toxicity - repeated exposure", "specific target organ toxicity repeated exposure", "stot repeated exposure", "spezifische zielorgan-toxizität bei wiederholter exposition", "toxicité spécifique pour certains organes cibles - exposition répétée", "toxicidad específica en determinados órganos - exposiciones repetidas"] },
  { sectionNumber: 11, field: "aspiration_hazard", aliases: ["aspiration hazard", "aspiration toxicity", "aspirationsgefahr", "danger par aspiration", "peligro por aspiración"] },
  { sectionNumber: 11, field: "toxicological_symptoms", aliases: ["symptoms related to the physical, chemical and toxicological characteristics", "symptoms related to exposure", "symptoms"] },
  { sectionNumber: 11, field: "toxicological_other", aliases: ["information on toxicological effects", "other toxicological information", "additional toxicological information"] },
  { sectionNumber: 12, field: "ecological_toxicity", aliases: ["toxicity", "ecotoxicity", "ecological toxicity", "toxizität", "toxicité", "toxicidad", "tossicità", "toxiciteit", "toksyczność", "toxicidade", "sucul ortam toksisitesi"] },
  { sectionNumber: 12, field: "persistence_degradability", aliases: ["persistence and degradability", "persistence/degradability", "biodegradability", "persistenz und abbaubarkeit", "persistance et dégradabilité", "persistencia y degradabilidad", "persistenza e degradabilità", "persistentie en afbreekbaarheid", "trwałość i zdolność do rozkładu", "persistência e degradabilidade", "kalıcılık ve bozunabilirlik"] },
  { sectionNumber: 12, field: "bioaccumulative_potential", aliases: ["bioaccumulative potential", "bioaccumulation potential", "bioakkumulationspotenzial", "potentiel de bioaccumulation", "potencial de bioacumulación", "potenziale di bioaccumulo", "bioaccumulatiepotentieel", "zdolność do bioakumulacji", "potencial de bioacumulação", "biyobirikim potansiyeli"] },
  { sectionNumber: 12, field: "mobility_in_soil", aliases: ["mobility in soil", "mobility", "mobility in the environment", "mobilität im boden", "mobilité dans le sol", "movilidad en el suelo", "mobilità nel suolo", "mobiliteit in de bodem", "mobilność w glebie", "mobilidade no solo", "toprakta hareketlilik"] },
  { sectionNumber: 12, field: "pbt_vpvb_assessment", aliases: ["results of pbt and vpvb assessment", "pbt/vpvb assessment", "pbt and vpvb assessment", "ergebnisse der pbt- und vpvb-beurteilung", "résultats des évaluations pbt et vpvb", "resultados de la valoración pbt y vpvb"] },
  { sectionNumber: 12, field: "endocrine_disruption_ecological", aliases: ["endocrine disrupting properties", "endocrine disruptor assessment", "endokrinschädliche eigenschaften", "propriétés perturbant le système endocrinien", "propiedades de alteración endocrina"] },
  { sectionNumber: 12, field: "ecological_other", aliases: ["other adverse effects", "additional ecological information", "other ecological information"] },
  { sectionNumber: 13, field: "waste_treatment_methods", aliases: ["waste treatment methods", "product disposal", "disposal methods", "verfahren der abfallbehandlung", "méthodes de traitement des déchets", "métodos para el tratamiento de residuos", "metodi di trattamento dei rifiuti", "afvalverwerkingsmethoden", "metody unieszkodliwiania odpadów", "métodos de tratamento de resíduos", "atık işleme yöntemleri"] },
  { sectionNumber: 13, field: "wastewater_disposal", aliases: ["wastewater disposal", "sewage disposal", "abwasserentsorgung", "élimination des eaux usées", "eliminación de aguas residuales", "smaltimento delle acque reflue", "afvalwaterverwijdering", "usuwanie ścieków", "eliminação de águas residuais", "atık su bertarafı"] },
  { sectionNumber: 13, field: "contaminated_packaging_disposal", aliases: ["contaminated packaging", "contaminated packaging disposal", "packaging disposal", "verunreinigte verpackungen", "emballages contaminés", "envases contaminados", "imballaggi contaminati", "verontreinigde verpakking", "zanieczyszczone opakowania", "embalagens contaminadas", "kirlenmiş ambalaj"] },
  { sectionNumber: 13, field: "disposal_other", aliases: ["disposal considerations", "other disposal information", "entsorgung", "considérations relatives à l'élimination", "consideraciones relativas a la eliminación", "considerazioni sullo smaltimento", "overwegingen bij de verwijdering", "kwestie dotyczące usuwania", "considerações relativas à eliminação", "bertaraf hususları"] },
  { sectionNumber: 14, field: "un_number", aliases: ["un number", "un no", "un/id number", "un/id no", "identification number", "un-nummer", "numéro onu", "número onu", "numero onu", "un-nummer", "numer un", "número onu", "un numarası"] },
  { sectionNumber: 14, field: "un_proper_shipping_name", aliases: ["un proper shipping name", "proper shipping name", "shipping name", "ordnungsgemäße un-versandbezeichnung", "désignation officielle de transport de l'onu", "designación oficial de transporte de las naciones unidas", "juiste vervoersnaam overeenkomstig de modelreglementen van de vn", "prawidłowa nazwa przewozowa un", "designação oficial de transporte da onu", "un uygun sevkiyat adı"] },
  { sectionNumber: 14, field: "transport_hazard_class", aliases: ["transport hazard class(es)", "transport hazard class", "hazard class", "transport class", "transportgefahrenklasse", "classe(s) de danger pour le transport", "clase(s) de peligro para el transporte", "classe di pericolo connessa al trasporto", "transportgevarenklasse", "klasa zagrożenia w transporcie", "classe de perigo para efeitos de transporte", "taşımacılık zararlılık sınıfı"] },
  { sectionNumber: 14, field: "packing_group", aliases: ["packing group", "packing groups", "verpackungsgruppe", "groupe d'emballage", "grupo de embalaje", "gruppo d'imballaggio", "verpakkingsgroep", "grupa pakowania", "grupo de embalagem", "ambalaj grubu"] },
  { sectionNumber: 14, field: "environmental_transport_hazard", aliases: ["environmental hazards", "environmental hazards for transport", "marine pollutant", "umweltgefahren", "dangers pour l'environnement", "peligros para el medio ambiente", "pericoli per l'ambiente", "milieugevaren", "zagrożenia dla środowiska", "perigos para o ambiente", "çevresel zararlar"] },
  { sectionNumber: 14, field: "user_transport_precautions", aliases: ["special precautions for user", "special precautions", "transport precautions", "besondere vorsichtsmaßnahmen für den verwender", "précautions particulières à prendre par l'utilisateur", "precauciones particulares para los usuarios", "precauzioni speciali per gli utilizzatori", "bijzondere voorzorgen voor de gebruiker", "szczególne środki ostrożności dla użytkowników", "precauções especiais para o utilizador", "kullanıcı için özel önlemler"] },
  { sectionNumber: 14, field: "maritime_bulk_transport", aliases: ["maritime transport in bulk according to imo instruments", "transport in bulk according to annex ii of marpol and the ibc code"] },
  { sectionNumber: 14, field: "transport_other", aliases: ["transport information", "other transport information"] },
  { sectionNumber: 15, field: "regulatory_safety_health_environment", aliases: ["safety, health and environmental regulations/legislation specific for the substance or mixture", "safety, health and environmental regulations specific for the substance or mixture", "national regulations", "regulations", "nationale vorschriften", "réglementations nationales", "normativa nacional", "normativa nazionale", "nationale regelgeving", "przepisy krajowe", "regulamentação nacional", "ulusal mevzuat"] },
  { sectionNumber: 15, field: "chemical_safety_assessment", aliases: ["chemical safety assessment", "chemical safety assessment carried out", "chemische sicherheitsbeurteilung", "évaluation de la sécurité chimique", "evaluación de la seguridad química", "valutazione della sicurezza chimica", "chemische veiligheidsbeoordeling", "ocena bezpieczeństwa chemicznego", "avaliação da segurança química", "kimyasal güvenlik değerlendirmesi"] },
  { sectionNumber: 15, field: "regulatory_other", aliases: ["regulatory information", "other regulatory information"] },
];

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").toLocaleLowerCase("en-US")
    .replace(/[’‘\x60´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const SORTED_LABELS = LABELS.flatMap((item) => item.aliases.map((rawAlias) => ({ ...item, rawAlias, alias: normalize(rawAlias) })))
  .sort((left, right) => right.alias.length - left.alias.length);

function parseLabel(line: SupplierSdsSectionLine): { item: Label; value: string } | undefined {
  const sectionPrefix = line.text.match(/^\s*(?:section\s*)?(?:1[0-5])(?:\.\d+)?(?=\s|[:：])\s*/iu)?.[0] ?? "";
  const separator = line.text.search(/[:：]/u);
  const rawLabel = separator < 0 ? line.text : line.text.slice(0, separator);
  const normalized = normalize(rawLabel.slice(sectionPrefix.length));
  const exact = SORTED_LABELS.find((item) => item.alias === normalized);
  if (exact) return { item: exact, value: separator < 0 ? "" : line.text.slice(separator + 1).trim() };
  if (separator >= 0) return undefined;
  const lineNormalized = normalize(line.text.slice(sectionPrefix.length));
  const shorthand = SORTED_LABELS.find((item) => lineNormalized.startsWith(item.alias + " "));
  if (!shorthand) return undefined;
  return { item: shorthand, value: line.text.slice(sectionPrefix.length + shorthand.rawAlias.length).trim().replace(/^[:：\s]+/u, "") };
}

function sectionContent(lines: SupplierSdsSectionLine[], sections: SupplierSdsSectionDetectionResult, sectionNumber: SupplierSdsEvidenceSectionNumber): SupplierSdsSectionLine[] | undefined {
  const index = sections.sections.findIndex((section) => section.sectionNumber === sectionNumber);
  const section = sections.sections[index];
  if (!section || sections.sections[index + 1]?.sectionNumber !== sectionNumber + 1) return undefined;
  if (!section.contentStart || !section.contentEnd) return [];
  const start = lines.findIndex((line) => line.pageNumber === section.contentStart!.pageNumber && line.lineNumber === section.contentStart!.lineNumber);
  const end = lines.findIndex((line) => line.pageNumber === section.contentEnd!.pageNumber && line.lineNumber === section.contentEnd!.lineNumber);
  return start >= 0 && end >= start ? lines.slice(start, end + 1) : [];
}

function makeCandidate(item: Label, rawValue: string, evidenceLines: SupplierSdsSectionLine[], hash: string): SupplierSdsSections10To15Candidate {
  return {
    field: item.field, sectionNumber: item.sectionNumber, rawValue,
    extractionMethod: "explicit_label",
    evidence: evidenceLines.map((line) => ({
      sourceDocumentHash: hash, sectionNumber: item.sectionNumber, pageNumber: line.pageNumber, lineNumber: line.lineNumber, excerpt: line.text,
      source: line.source ?? "unknown",
      ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
      ...(line.position ? { position: { x: line.position.x, y: line.position.y } } : {}),
    })),
    reviewRequired: true,
  };
}

function isSubsectionHeading(line: SupplierSdsSectionLine, section: number): boolean {
  return new RegExp(`^\\s*${section}\\.\\d+(?:\\s|[.):\\-–—]|$)`, "u").test(line.text);
}

function isNoDataStatement(value: string): boolean {
  return /^(?:data not available|not available|no data(?: available)?|not determined|not reported|no information available|not applicable|n a|keine daten verfugbar|keine informationen verfugbar|aucune donnee disponible|pas de donnees disponibles|no hay datos disponibles|nessun dato disponibile|geen gegevens beschikbaar|brak dostepnych danych|dados nao disponiveis|veri mevcut degil)$/u.test(normalize(value))
    || /^\s*[-—*]\s*$/u.test(value);
}

export function extractSupplierSdsSections10To15(input: {
  sourceDocumentHash: string;
  lines: SupplierSdsSectionLine[];
  sections?: SupplierSdsSectionDetectionResult;
  ocrParserVersion?: string;
}): SupplierSdsSections10To15Result {
  if (!/^[a-f0-9]{64}$/iu.test(input.sourceDocumentHash)) throw new Error("Supplier SDS Sections 10-15 extraction requires a SHA-256 source document hash.");
  const sections = input.sections ?? detectSupplierSdsSections(input.lines);
  const base = {
    sourceDocumentHash: input.sourceDocumentHash.toLowerCase(), parserVersion: SUPPLIER_SDS_SECTIONS10_TO15_PARSER_VERSION as typeof SUPPLIER_SDS_SECTIONS10_TO15_PARSER_VERSION,
    ...(input.ocrParserVersion ? { ocrParserVersion: input.ocrParserVersion } : {}),
  };
  const detected = sections.sections.filter((section) => section.sectionNumber >= 10 && section.sectionNumber <= 15);
  if (!detected.length) return { ...base, candidates: [], warnings: ["sections_10_to_15_not_detected"] };

  const candidates: SupplierSdsSections10To15Candidate[] = [];
  let incompleteBoundary = false;
  const hash = input.sourceDocumentHash.toLowerCase();
  for (const section of detected) {
    const lines = sectionContent(input.lines, sections, section.sectionNumber as SupplierSdsEvidenceSectionNumber);
    if (lines === undefined) { incompleteBoundary = true; continue; }
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const parsed = parseLabel(line);
      if (!parsed || parsed.item.sectionNumber !== section.sectionNumber) continue;
      const evidenceLines = [line];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = lines[cursor]!;
        const previous = lines[cursor - 1]!;
        if (next.pageNumber !== previous.pageNumber || next.lineNumber !== previous.lineNumber + 1 || !next.text.trim()
          || parseLabel(next) || isSubsectionHeading(next, section.sectionNumber)) break;
        evidenceLines.push(next);
        cursor += 1;
      }
      const rawValue = [parsed.value, ...evidenceLines.slice(1).map((item) => item.text.trim())].filter(Boolean).join(" ").trim();
      if (rawValue && !isNoDataStatement(rawValue)) {
        candidates.push(makeCandidate(parsed.item, rawValue, evidenceLines, hash));
        index = cursor - 1;
      }
    }
  }

  const values = new Map<SupplierSdsSections10To15Field, Set<string>>();
  for (const item of candidates) {
    const fieldValues = values.get(item.field) ?? new Set<string>();
    fieldValues.add(normalize(item.rawValue));
    values.set(item.field, fieldValues);
  }
  const warnings: SupplierSdsSections10To15Warning[] = [];
  if (incompleteBoundary) warnings.push("section_boundary_incomplete");
  if (!candidates.length) warnings.push("no_sections_10_to_15_candidates");
  if ([...values.values()].some((items) => items.size > 1)) warnings.push("conflicting_section_candidates");
  if (candidates.some((item) => item.evidence.some((source) => source.source === "ocr"))) warnings.push("sections_10_to_15_ocr_requires_review");
  if (candidates.some((item) => item.evidence.some((source) => source.source === "unknown" || source.source === "mixed"))) warnings.push("sections_10_to_15_provenance_requires_review");
  if (candidates.length) warnings.push("human_review_required");
  return { ...base, candidates, warnings };
}
