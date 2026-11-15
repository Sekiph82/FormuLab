import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { canonicalChemistryIdFromInci } from "./referenceFormulationCanonicalChemistry";
import { getDataExchangeTemplate } from "./dataExchangeRegistry";

/**
 * One raw material seen in supplier formulas, not yet in Material Master. It is only a
 * candidate: nothing about it is verified, and it reaches Material Master only through a
 * person's Data Exchange preview and commit (owner decision D-REF-01-1).
 */
export interface ReferenceMaterialCandidate {
  materialCode: string;
  materialName: string;
  inciName?: string;
  canonicalChemistryId?: string;
  tradeNames: string[];
  supplierIds: string[];
  sourceRecordIds: string[];
  /** Raw-material documents (SDS, TDS, ...) stored for a trade name printed in these formulas. */
  documentAcquisitionCodes: string[];
}

type ProductDocument = { code: string; supplierId?: string; documentType: string; sourceProduct: { tradeName?: string } };
type ExistingMaterial = { code: string; displayName: string; tradeName?: string; inciName?: string };

const key = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[®™©*]/gu, "").replace(/[^a-z0-9]+/gu, " ").trim();
const isName = (value: string) => /[a-z]{3}/iu.test(value) && !/^[\d\s.,%–-]+$/u.test(value) && value.length <= 120;

export function buildReferenceMaterialCandidates(input: {
  records: ReferenceFormulationRecord[];
  productDocuments: ProductDocument[];
  existingMaterials: ExistingMaterial[];
}): ReferenceMaterialCandidate[] {
  const known = new Set(input.existingMaterials.flatMap((material) => [
    material.inciName && canonicalChemistryIdFromInci(material.inciName),
    material.tradeName && `trade:${key(material.tradeName)}`,
    `trade:${key(material.displayName)}`,
  ].filter((value): value is string => Boolean(value))));
  const documentsByTradeName = new Map<string, string[]>();
  for (const document of input.productDocuments) {
    const tradeName = document.sourceProduct.tradeName && key(document.sourceProduct.tradeName);
    if (!tradeName || document.documentType === "FORMULATION") continue;
    documentsByTradeName.set(tradeName, [...(documentsByTradeName.get(tradeName) ?? []), document.code]);
  }

  const groups = new Map<string, ReferenceMaterialCandidate & { names: Map<string, number> }>();
  for (const record of input.records) {
    for (const line of record.ingredientLines) {
      const inci = line.inciOrChemicalName?.rawValue.trim();
      const tradeName = line.ingredientName?.rawValue.trim();
      const chemistryId = canonicalChemistryIdFromInci(inci);
      const groupKey = chemistryId ?? (tradeName && isName(tradeName) ? `trade:${key(tradeName)}` : undefined);
      if (!groupKey || known.has(groupKey) || (tradeName && known.has(`trade:${key(tradeName)}`))) continue;
      let group = groups.get(groupKey);
      if (!group) {
        const slug = groupKey.replace(/^inci:/u, "inci-").replace(/^trade:/u, "trade-").replace(/[^a-z0-9]+/giu, "-").toUpperCase().slice(0, 70);
        group = { materialCode: `REF-${slug}`, materialName: "", tradeNames: [], supplierIds: [], sourceRecordIds: [], documentAcquisitionCodes: [], names: new Map() };
        if (chemistryId) { group.canonicalChemistryId = chemistryId; group.inciName = inci; }
        groups.set(groupKey, group);
      }
      const shownName = chemistryId ? inci! : tradeName!;
      group.names.set(shownName, (group.names.get(shownName) ?? 0) + 1);
      if (tradeName && isName(tradeName) && !group.tradeNames.includes(tradeName)) group.tradeNames.push(tradeName);
      if (!group.supplierIds.includes(record.source.supplierId)) group.supplierIds.push(record.source.supplierId);
      if (!group.sourceRecordIds.includes(record.id)) group.sourceRecordIds.push(record.id);
      for (const code of tradeName ? documentsByTradeName.get(key(tradeName)) ?? [] : []) {
        if (!group.documentAcquisitionCodes.includes(code)) group.documentAcquisitionCodes.push(code);
      }
    }
  }
  return [...groups.values()].map(({ names, ...candidate }) => ({
    ...candidate,
    // The most often printed spelling names the candidate.
    materialName: [...names.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]![0],
  })).sort((left, right) => right.sourceRecordIds.length - left.sourceRecordIds.length || left.materialCode.localeCompare(right.materialCode));
}

/** Rows in the Data Exchange "raw_materials" template; only identity and provenance are filled, missing stays empty. */
export function referenceMaterialCandidatesCsv(candidates: ReferenceMaterialCandidate[]): string {
  const columns = getDataExchangeTemplate("raw_materials")!.columns.map((column) => column.key);
  const cell = (value: string) => /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
  const rows = candidates.map((candidate) => {
    const values: Record<string, string> = {
      material_code: candidate.materialCode,
      material_name: candidate.materialName,
      inci_name: candidate.inciName ?? "",
      notes: [
        `Unverified candidate from ${candidate.sourceRecordIds.length} supplier formula(s) (${candidate.supplierIds.join(", ")}); not a verified material.`,
        candidate.canonicalChemistryId ? `Canonical chemistry candidate: ${candidate.canonicalChemistryId}.` : "No printed INCI name.",
        candidate.tradeNames.length ? `Trade names printed: ${candidate.tradeNames.slice(0, 8).join("; ")}.` : "",
        candidate.documentAcquisitionCodes.length ? `Raw-material documents: ${candidate.documentAcquisitionCodes.slice(0, 8).join("; ")}.` : "",
      ].filter(Boolean).join(" "),
    };
    return columns.map((column) => cell(values[column] ?? "")).join(",");
  });
  return [columns.join(","), ...rows].join("\n") + "\n";
}
