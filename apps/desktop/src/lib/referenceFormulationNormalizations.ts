import {
  createReferenceFormulationNormalizationVersion,
  referenceFormulationNormalizationVersionSchema,
  referenceFormulationRecordSchema,
  type ReferenceFormulationNormalizationVersion,
} from "@formulab/shared";
import { appendReferenceFormulationNormalizationRecord, listRecords, nowIso } from "./masterdata";

/** Read immutable normalization versions for one source formulation. */
export async function listReferenceFormulationNormalizations(
  referenceFormulationRecordId: string,
): Promise<ReferenceFormulationNormalizationVersion[]> {
  const [sources, versions] = await Promise.all([
    listRecords("reference_formulations"),
    listRecords("reference_formulation_normalizations"),
  ]);
  const source = sources.find((record) => record.id === referenceFormulationRecordId);
  if (!source) throw new Error("Reference formulation record was not found.");
  const parsedSource = referenceFormulationRecordSchema.parse(source);
  const linkedVersions = versions
    .map((version) => referenceFormulationNormalizationVersionSchema.parse(version))
    .filter((version) => version.referenceFormulationRecordId === referenceFormulationRecordId)
    .sort((left, right) => left.version - right.version);
  validateNormalizationHistory(parsedSource, linkedVersions);
  return linkedVersions;
}

/** Append a new candidate-only normalization version without modifying the source formula or RawMaterial. */
export async function appendReferenceFormulationNormalization(input: {
  referenceFormulationRecordId: string;
  canonicalChemicalCandidates?: Record<string, string[]>;
}): Promise<ReferenceFormulationNormalizationVersion> {
  const [sourceRecords, existingRecords] = await Promise.all([
    listRecords("reference_formulations"),
    listRecords("reference_formulation_normalizations"),
  ]);
  const sourceValue = sourceRecords.find((record) => record.id === input.referenceFormulationRecordId);
  if (!sourceValue) throw new Error("Reference formulation record was not found.");
  const source = referenceFormulationRecordSchema.parse(sourceValue);
  const existing = existingRecords
    .map((record) => referenceFormulationNormalizationVersionSchema.parse(record))
    .filter((record) => record.referenceFormulationRecordId === source.id)
    .sort((left, right) => right.version - left.version);
  validateNormalizationHistory(source, [...existing].reverse());
  const latest = existing[0];
  const version = createReferenceFormulationNormalizationVersion({
    id: `normalization-${globalThis.crypto.randomUUID()}`,
    source,
    version: (latest?.version ?? 0) + 1,
    ...(latest ? { supersedesNormalizationId: latest.id } : {}),
    canonicalChemicalCandidates: input.canonicalChemicalCandidates,
    createdAt: nowIso(),
  });
  const saved = await appendReferenceFormulationNormalizationRecord(version);
  return referenceFormulationNormalizationVersionSchema.parse(saved);
}

function validateNormalizationHistory(
  source: ReturnType<typeof referenceFormulationRecordSchema.parse>,
  versions: ReferenceFormulationNormalizationVersion[],
): void {
  const sourceLineIds = source.ingredientLines.map((line) => line.id).sort();
  const productCandidates = new Map(source.productMatches.map((match) => [
    match.ingredientLineId,
    match.candidates.map((candidate) => candidate.commercialProductId),
  ]));
  versions.forEach((version, index) => {
    if (version.sourceDocumentHash.toLowerCase() !== source.sourceDocumentHash.toLowerCase()) {
      throw new Error("Normalization version must retain the immutable source document hash.");
    }
    const versionLineIds = version.lines.map((line) => line.sourceLineId).sort();
    if (JSON.stringify(versionLineIds) !== JSON.stringify(sourceLineIds)) {
      throw new Error("Normalization version must reference every original source line exactly once.");
    }
    for (const line of version.lines) {
      if (JSON.stringify(line.commercialProduct.candidateIds) !== JSON.stringify(productCandidates.get(line.sourceLineId) ?? [])) {
        throw new Error("Commercial product candidates must match the immutable source match snapshot.");
      }
    }
    if (version.version !== index + 1
      || (index === 0 ? version.supersedesNormalizationId !== undefined : version.supersedesNormalizationId !== versions[index - 1]?.id)) {
      throw new Error("Normalization versions must form one unbroken append-only predecessor chain.");
    }
  });
}
