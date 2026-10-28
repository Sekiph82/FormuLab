import {
  supplierProductDocumentEvidenceSchema,
  type SupplierProductClaimEvidence,
  type SupplierProductDocumentEvidence,
  type SupplierDocumentAcquisition,
  type SupplierSdsMeasurementContext,
} from "@formulab/shared";
import { extractSupplierSdsReview } from "./supplierSdsReview";
import { extractSupplierPdfText } from "./supplierPdfTextExtraction";
import { runConditionalSupplierPdfOcr } from "./supplierPdfOcr";

export const SUPPLIER_TDS_PARSER_VERSION = "formulab-tds-explicit-label-v1";
type SdsReviewResult = Awaited<ReturnType<typeof extractSupplierSdsReview>>;
type CandidateMeasurementContext = Pick<SupplierSdsMeasurementContext,
  "normalizedValue" | "temperature" | "sampleConcentration" | "deliveredFormBasis" | "deliveredFormBasisText" | "methodOrStandard" | "claimKind" | "evidenceKind">;

const TDS_LABELS: ReadonlyArray<[string, readonly string[]]> = [
  ["active_matter", ["active matter", "active content", "active substance", "actives", "aktif madde", "aktif madde içeriği"]],
  ["total_solids", ["total solids", "solids content", "solids", "dry matter", "toplam katı", "katı madde"]],
  ["nonvolatile_content", ["non volatile content", "non-volatile content", "nonvolatile matter", "uçucu olmayan madde"]],
  ["water_content", ["water content", "moisture content", "su içeriği", "nem"]],
  ["density", ["density", "specific gravity", "yoğunluk", "özgül ağırlık"]],
  ["relative_density", ["relative density", "relative specific gravity", "bağıl yoğunluk"]],
  ["ph", ["ph", "p h", "ph value", "ph değeri"]],
  ["viscosity", ["viscosity", "viskozite"]],
  ["ionic_character", ["ionic character", "ionic nature", "ionicity", "ionic type", "iyonik karakter", "iyonik yapı"]],
  ["appearance", ["appearance", "physical appearance", "görünüm", "fiziksel görünüm"]],
  ["color", ["color", "colour", "renk"]],
  ["odor", ["odor", "odour", "koku"]],
  ["solubility", ["solubility", "water solubility", "çözünürlük", "suda çözünürlük"]],
  ["recommended_dosage", ["recommended dosage", "recommended use level", "dosage", "use level", "önerilen dozaj", "önerilen kullanım miktarı"]],
  ["application_guidance", ["application guidance", "application", "use", "uygulama önerisi", "kullanım önerisi"]],
  ["application_area", ["application area", "applications", "field of application", "kullanım alanı", "uygulama alanı"]],
  ["processing_conditions", ["processing conditions", "processing", "process conditions", "proses koşulları", "işlem koşulları"]],
  ["addition_sequence", ["addition sequence", "order of addition", "sequence of addition", "ekleme sırası", "ilave sırası"]],
  ["compatibility", ["compatibility", "compatible with", "uyumluluk", "uyumludur"]],
  ["stability", ["stability", "stable", "stability information", "kararlılık", "stabilite"]],
  ["storage_conditions", ["storage conditions", "storage", "depolama koşulları", "saklama koşulları"]],
  ["shelf_life", ["shelf life", "storage life", "raf ömrü"]],
  ["packaging", ["packaging", "available packaging", "ambalaj"]],
  ["analytical_method", ["test method", "analytical method", "method of analysis", "test yöntemi", "analiz yöntemi"]],
  ["cloud_point", ["cloud point", "bulutlanma noktası"]],
  ["pour_point", ["pour point", "akma noktası"]],
  ["flash_point", ["flash point", "parlama noktası"]],
  ["performance_claim", ["performance", "performance claim", "foam", "detergency", "cleaning performance", "performans"]],
  ["certification_claim", ["certification", "certified", "certification status", "sertifika", "sertifikasyon"]],
];

type EvidenceLine = {
  pageNumber: number;
  lineNumber?: number;
  excerpt: string;
  source: "digital" | "ocr" | "mixed" | "unknown";
  confidence?: number;
  position?: { x: number; y: number };
};

function citedEvidence(hash: string, lines: EvidenceLine[]) {
  return lines.map((line) => ({
    documentHash: hash,
    pageNumber: line.pageNumber,
    ...(line.lineNumber === undefined ? {} : { lineNumber: line.lineNumber }),
    excerpt: line.excerpt,
    source: line.source,
    ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
    ...(line.position ? { position: line.position } : {}),
  }));
}

function candidateLines(candidate: { evidence: Array<{ pageNumber: number; lineNumber?: number; excerpt: string; source?: string; confidence?: number; position?: { x: number; y: number } }> }): EvidenceLine[] {
  return candidate.evidence.map((item) => ({
    pageNumber: item.pageNumber,
    ...(item.lineNumber === undefined ? {} : { lineNumber: item.lineNumber }),
    excerpt: item.excerpt,
    source: item.source === "digital" || item.source === "ocr" || item.source === "mixed" || item.source === "unknown" ? item.source : "unknown",
    ...(item.confidence === undefined ? {} : { confidence: item.confidence }),
    ...(item.position ? { position: item.position } : {}),
  }));
}

function normalizeSdsField(field: string): { fieldCode: string; subject: "product" | "disclosed_component" | "regulatory"; sectionNumber: number } | undefined {
  const section1: Record<string, string> = {
    declared_chemical_name: "product_identifier", chemical_nature: "product_chemical_nature", cas_number: "product_cas", ec_number: "product_ec",
    recommended_use: "recommended_use", use_restrictions: "use_restrictions", industry_sector: "industry_sector", product_description: "product_description",
  };
  if (section1[field]) return { fieldCode: section1[field]!, subject: "product", sectionNumber: 1 };
  const section7: Record<string, string> = {
    handling_constraints: "handling_constraints", storage_temperature: "storage_temperature", storage_conditions: "storage_conditions",
    storage_stability: "storage_stability", container_material_compatibility: "container_material_compatibility", shelf_life: "sds_shelf_life",
  };
  if (section7[field]) return { fieldCode: section7[field]!, subject: "product", sectionNumber: 7 };
  const section9: Record<string, string> = {
    physical_state: "physical_state", appearance: "appearance", color: "color", odor: "odor", odor_threshold: "odor_threshold", ph: "ph",
    density: "density", relative_density: "relative_density", viscosity: "viscosity", solubility: "solubility", flash_point: "flash_point",
    boiling_point: "boiling_point", melting_point: "melting_point", freezing_point: "freezing_point", melting_freezing_point: "melting_freezing_point",
    vapor_pressure: "vapor_pressure", vapor_density: "vapor_density", partition_coefficient: "partition_coefficient", molecular_weight: "molecular_weight",
    other_physical_property: "other_physical_property",
  };
  if (section9[field]) return { fieldCode: section9[field]!, subject: "product", sectionNumber: 9 };
  if (field === "regulatory_safety_health_environment") return { fieldCode: "regulatory_status", subject: "regulatory", sectionNumber: 15 };
  if (field === "chemical_safety_assessment") return { fieldCode: "chemical_safety_assessment", subject: "regulatory", sectionNumber: 15 };
  if (field === "regulatory_other") return { fieldCode: "other_regulatory_information", subject: "regulatory", sectionNumber: 15 };
  return undefined;
}

export async function extractSupplierProductDocumentEvidence(
  acquisition: SupplierDocumentAcquisition,
  bytes: Uint8Array,
  productCardId: string,
  preparedSdsReview?: SdsReviewResult,
): Promise<SupplierProductDocumentEvidence> {
  if (acquisition.documentType === "SDS") return extractSdsEvidence(acquisition, bytes, productCardId, preparedSdsReview);
  if (acquisition.documentType === "TDS") return extractTdsEvidence(acquisition, bytes, productCardId);
  throw new Error("Product evidence extraction accepts SDS or TDS documents only.");
}

async function extractSdsEvidence(acquisition: SupplierDocumentAcquisition, bytes: Uint8Array, productCardId: string, preparedReview?: SdsReviewResult): Promise<SupplierProductDocumentEvidence> {
  const review = preparedReview ?? await extractSupplierSdsReview(acquisition, bytes);
  if (review.status !== "extracted") throw new Error(`SDS could not be extracted: ${review.reason}`);
  const hash = acquisition.sha256.toLowerCase();
  const claims: SupplierProductClaimEvidence[] = [];
  let sequence = 0;
  const add = (field: string, rawValue: string, lines: EvidenceLine[], method?: string, measurement?: CandidateMeasurementContext) => {
    const mapped = normalizeSdsField(field);
    if (!mapped) return;
    const citations = citedEvidence(hash, lines);
    if (!rawValue.trim() || !citations.length) return;
    claims.push({
      id: `${acquisition.code}:claim:${++sequence}`,
      fieldCode: mapped.fieldCode,
      sectionNumber: mapped.sectionNumber,
      subject: mapped.subject,
      rawValue: rawValue.trim(),
      ...(measurement?.normalizedValue?.text ? { normalizedValue: measurement.normalizedValue.text } : {}),
      ...(measurement?.normalizedValue?.unit ? { normalizedUnit: measurement.normalizedValue.unit } : {}),
      qualifier: measurement?.claimKind === "typical" ? "typical" : measurement?.claimKind === "specification" ? "specified" : "unknown",
      basis: measurement?.deliveredFormBasis === "as_supplied" ? "as_supplied"
        : measurement?.deliveredFormBasis === "active_matter" ? "active_matter"
          : measurement?.deliveredFormBasis === "dry_basis" ? "dry_weight" : "unknown",
      context: {
        ...(measurement?.methodOrStandard?.length ? { testMethod: measurement.methodOrStandard.join("; ") } : {}),
        ...(measurement?.temperature?.originalText ? { temperature: measurement.temperature.originalText } : {}),
        ...(measurement?.sampleConcentration?.originalText ? { sampleConcentration: measurement.sampleConcentration.originalText } : {}),
        ...([measurement?.deliveredFormBasisText, measurement?.claimKind, measurement?.evidenceKind].filter(Boolean).length
          ? { conditions: [measurement?.deliveredFormBasisText, measurement?.claimKind, measurement?.evidenceKind].filter(Boolean).join("; ") } : {}),
      },
      extraction: { method: method === "labeled_field" || method === "explicit_label" ? "explicit_label" : "other", parserVersion: review.sections10To15.parserVersion },
      evidence: citations,
    });
  };
  for (const candidate of review.section1.candidates) add(candidate.field, candidate.rawValue, candidateLines(candidate), candidate.extractionMethod);
  for (const candidate of review.section3.components) {
    const component = candidate as unknown as Record<string, unknown>;
    for (const [property, field] of [["originalName", "component_name"], ["casNumber", "cas_number"], ["ecNumber", "ec_number"], ["concentration", "concentration"]] as const) {
      const fact = component[property] as { rawValue?: string; evidence?: EvidenceLine[] } | undefined;
      if (fact?.rawValue && fact.evidence) add(field === "component_name" ? "disclosed_component_name" : field === "cas_number" ? "disclosed_component_cas" : field === "ec_number" ? "disclosed_component_ec" : "disclosed_component_concentration", fact.rawValue, fact.evidence, "explicit_label");
    }
  }
  if (review.section3.declaration) add("substance_or_mixture", review.section3.declaration.rawValue, review.section3.declaration.evidence, "explicit_label");
  for (const candidate of review.section7.candidates) add(candidate.field, candidate.rawValue, candidateLines(candidate), candidate.extractionMethod);
  for (const candidate of review.section9.candidates) add(candidate.field, candidate.rawValue, candidateLines(candidate), candidate.extractionMethod, candidate.measurementContext);
  for (const candidate of review.sections10To15.candidates.filter((item) => item.sectionNumber === 15)) add(candidate.field, candidate.rawValue, candidateLines(candidate), candidate.extractionMethod);
  return supplierProductDocumentEvidenceSchema.parse({
    recordType: "document", schemaVersion: "1.0", id: `product-evidence-${crypto.randomUUID()}`,
    acquisitionCode: acquisition.code, productCardId, documentType: "SDS", documentHash: hash,
    parserVersion: review.extraction.parserVersion, ocrVersion: review.ocr.parserVersion,
    claims, reviewStatus: "unreviewed", createdAt: new Date().toISOString(),
  });
}

async function extractTdsEvidence(acquisition: SupplierDocumentAcquisition, bytes: Uint8Array, productCardId: string): Promise<SupplierProductDocumentEvidence> {
  const extraction = await extractSupplierPdfText({ bytes, filename: acquisition.originalFilename, declaredMimeType: acquisition.mimeType });
  if (extraction.status !== "extracted") throw new Error(`TDS could not be extracted: ${extraction.reason}`);
  if (extraction.documentHash.toLowerCase() !== acquisition.sha256.toLowerCase()) throw new Error("Extracted TDS hash does not match its immutable acquisition.");
  const ocr = await runConditionalSupplierPdfOcr(extraction, { languages: ["eng", "tur", "deu"], maxPages: 30, sourcePdfBytes: bytes });
  const lines: EvidenceLine[] = [
    ...extraction.pages.flatMap((page) => page.lines.map((line) => ({ pageNumber: page.pageNumber, lineNumber: line.lineNumber, excerpt: line.text, source: "digital" as const, ...(line.position ? { position: line.position } : {}) }))),
    ...ocr.lines.map((line) => ({ pageNumber: line.pageNumber, excerpt: line.text, source: "ocr" as const, confidence: line.confidence })),
  ].sort((left, right) => left.pageNumber - right.pageNumber || (("lineNumber" in left ? left.lineNumber : 0) - ("lineNumber" in right ? right.lineNumber : 0)));
  const claims: SupplierProductClaimEvidence[] = [];
  const hash = acquisition.sha256.toLowerCase();
  const used = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const normalized = normalizeLabel(line.excerpt);
    const mapping = TDS_LABELS.flatMap(([field, aliases]) => aliases.map((rawAlias) => ({ field, rawAlias, alias: normalizeLabel(rawAlias) })))
      .sort((a, b) => b.alias.length - a.alias.length)
      .find(({ alias }) => normalized === alias || normalized.startsWith(`${alias}:`) || normalized.startsWith(`${alias}=`) || normalized.startsWith(`${alias} `));
    if (!mapping) continue;
    let value = valueAfterTdsLabel(line.excerpt, mapping.rawAlias);
    const evidenceLines = [line];
    if (!value) {
      const next = lines[index + 1];
      if (next && next.pageNumber === line.pageNumber && !matchesTdsLabel(next.excerpt)) {
        value = next.excerpt.trim();
        evidenceLines.push(next);
      }
    }
    const dedupeKey = `${mapping.field}:${normalizeLabel(value)}`;
    if (!value || used.has(dedupeKey)) continue;
    used.add(dedupeKey);
    claims.push({
      id: `${acquisition.code}:claim:${claims.length + 1}`, fieldCode: mapping.field, subject: "product", rawValue: value,
      qualifier: tdsQualifier(mapping.field, value),
      basis: tdsBasis(value),
      context: tdsContext(value),
      extraction: { method: "explicit_label", parserVersion: SUPPLIER_TDS_PARSER_VERSION },
      evidence: citedEvidence(hash, evidenceLines),
    });
  }
  return supplierProductDocumentEvidenceSchema.parse({
    recordType: "document", schemaVersion: "1.0", id: `product-evidence-${crypto.randomUUID()}`,
    acquisitionCode: acquisition.code, productCardId, documentType: "TDS", documentHash: hash,
    parserVersion: `${extraction.parserVersion}+${SUPPLIER_TDS_PARSER_VERSION}`, ocrVersion: ocr.parserVersion,
    claims, reviewStatus: "unreviewed", createdAt: new Date().toISOString(),
  });
}

function normalizeLabel(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}%]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function matchesTdsLabel(value: string): boolean {
  const normalized = normalizeLabel(value);
  return TDS_LABELS.some(([, aliases]) => aliases.some((alias) => normalized === normalizeLabel(alias)));
}

function valueAfterTdsLabel(line: string, alias: string): string {
  const escaped = alias.trim().split(/\s+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\s+");
  const match = new RegExp(`^\\s*${escaped}\\s*(?:[:=–—-]\\s*)?(.*)$`, "iu").exec(line);
  return match?.[1]?.trim() ?? "";
}

function tdsQualifier(field: string, value: string): SupplierProductClaimEvidence["qualifier"] {
  if (["recommended_dosage", "application_guidance", "application_area"].includes(field)) return "recommended";
  const text = value.toLocaleLowerCase("en-US");
  if (/\btypical\b|\btypically\b|\btypical value\b/iu.test(text)) return "typical";
  if (/\b(specification|specified|limit|minimum requirement)\b/iu.test(text)) return "specified";
  if (/\bminimum\b/iu.test(text)) return "minimum";
  if (/\bmaximum\b/iu.test(text)) return "maximum";
  if (/[+-]?\d[\d.,]*\s*(?:%|ppm|ppb|mg\/l|g\/l|cps?|mpa\.s)?\s*(?:-|–|to)\s*[+-]?\d[\d.,]*/iu.test(text)) return "range";
  return "unknown";
}

function tdsBasis(value: string): SupplierProductClaimEvidence["basis"] {
  const text = value.toLocaleLowerCase("en-US");
  if (/\bas supplied\b|\bas delivered\b|\bproduct as is\b|tedarik edildiği haliyle/iu.test(text)) return "as_supplied";
  if (/\bon active matter\b|\bactive basis\b|aktif madde bazında/iu.test(text)) return "active_matter";
  if (/\bon dry basis\b|\bdry weight basis\b|kuru madde bazında/iu.test(text)) return "dry_weight";
  if (/\bsolution basis\b|\bin solution\b|çözelti bazında/iu.test(text)) return "solution";
  return "unknown";
}

function tdsContext(value: string): SupplierProductClaimEvidence["context"] {
  const temperature = /(?:at|@|at a temperature of|sıcaklıkta)\s*(-?\d+(?:[.,]\d+)?)\s*(°\s*[CF]|°?\s*C|°?\s*F|K)\b/iu.exec(value)?.[0];
  const method = /\b(Brookfield(?:\s+[A-Za-z0-9-]+)?|ASTM\s+[A-Z0-9.-]+|ISO\s+[0-9.-]+|DIN\s+[0-9.-]+)\b/iu.exec(value)?.[0];
  return {
    ...(method ? { testMethod: method } : {}),
    ...(temperature ? { temperature: temperature.trim() } : {}),
  };
}
