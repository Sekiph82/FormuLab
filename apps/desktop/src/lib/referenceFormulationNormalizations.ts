import {
  buildReferenceFormulationLocalIndex,
  createReferenceFormulationQueryRecord,
  createReferenceFormulationNormalizationVersion,
  referenceFormulationNormalizationVersionSchema,
  referenceFormulationRecordSchema,
  validateReferenceFormulationContributionAgainstSource,
  type ReferenceFormulationNormalizationVersion,
  type ReferenceFormulationContribution,
  type MaterialFunction,
  createReferenceFormulationFunctionNormalization,
  validateReferenceFormulationFunctionNormalizationAgainstSource,
  createReferenceFormulationProcessNormalization,
  validateReferenceFormulationProcessNormalizationAgainstSource,
  createReferenceFormulationTargetNormalization,
  validateReferenceFormulationTargetNormalizationAgainstSource,
  supplierSdsProductEvidenceRecordSchema,
  type SupplierSdsProductEvidenceRecord,
  type ReferenceFormulationQueryRecord,
  type ReferenceFormulationLocalIndex,
} from "@formulab/shared";
import { appendReferenceFormulationNormalizationRecord, listRecords, nowIso } from "./masterdata";

/** Read immutable normalization versions for one source formulation. */
export async function listReferenceFormulationNormalizations(
  referenceFormulationRecordId: string,
): Promise<ReferenceFormulationNormalizationVersion[]> {
  const [sources, versions, sdsEvidence] = await Promise.all([
    listRecords("reference_formulations"),
    listRecords("reference_formulation_normalizations"),
    listRecords("supplier_sds_product_evidence"),
  ]);
  const source = sources.find((record) => record.id === referenceFormulationRecordId);
  if (!source) throw new Error("Reference formulation record was not found.");
  const parsedSource = referenceFormulationRecordSchema.parse(source);
  const linkedVersions = versions
    .map((version) => referenceFormulationNormalizationVersionSchema.parse(version))
    .filter((version) => version.referenceFormulationRecordId === referenceFormulationRecordId)
    .sort((left, right) => left.version - right.version);
  validateNormalizationHistory(parsedSource, linkedVersions, sdsEvidence.map((record) => supplierSdsProductEvidenceRecordSchema.parse(record)));
  return linkedVersions;
}

/** Rebuild query projections and deterministic postings from restored immutable source and normalization records. */
export async function rebuildReferenceFormulationCorpusIndex(): Promise<{
  queryRecords: ReferenceFormulationQueryRecord[];
  index: ReferenceFormulationLocalIndex;
}> {
  const [sourceRows, versionRows, sdsRows] = await Promise.all([
    listRecords("reference_formulations"),
    listRecords("reference_formulation_normalizations"),
    listRecords("supplier_sds_product_evidence"),
  ]);
  const sources = sourceRows.map((record) => referenceFormulationRecordSchema.parse(record))
    .sort((left, right) => compareStable(left.id, right.id));
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error("Corpus index rebuild cannot contain duplicate immutable source record IDs.");
  }
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const versions = versionRows.map((record) => referenceFormulationNormalizationVersionSchema.parse(record));
  if (new Set(versions.map((version) => version.id)).size !== versions.length) {
    throw new Error("Corpus index rebuild cannot contain duplicate normalization version IDs.");
  }
  const versionsBySource = new Map<string, ReferenceFormulationNormalizationVersion[]>();
  for (const version of versions) {
    if (!sourceById.has(version.referenceFormulationRecordId)) {
      throw new Error("Corpus index rebuild found a normalization version without its immutable source record.");
    }
    const sourceVersions = versionsBySource.get(version.referenceFormulationRecordId) ?? [];
    sourceVersions.push(version);
    versionsBySource.set(version.referenceFormulationRecordId, sourceVersions);
  }
  const sdsEvidence = sdsRows.map((record) => supplierSdsProductEvidenceRecordSchema.parse(record));
  if (new Set(sdsEvidence.map((record) => record.code)).size !== sdsEvidence.length) {
    throw new Error("Corpus index rebuild cannot contain duplicate immutable SDS evidence IDs.");
  }
  const queryRecords = sources.map((source) => {
    const history = (versionsBySource.get(source.id) ?? []).sort((left, right) => left.version - right.version);
    validateNormalizationHistory(source, history, sdsEvidence);
    const latest = history[history.length - 1] ?? createReferenceFormulationNormalizationVersion({
      id: `derived-normalization:${source.id}:${source.sourceDocumentHash}`,
      source,
      version: 1,
      createdAt: source.createdAt,
    });
    return createReferenceFormulationQueryRecord({ source, normalization: latest });
  });
  return { queryRecords, index: buildReferenceFormulationLocalIndex(queryRecords) };
}

/** Append a new candidate-only normalization version without modifying the source formula or RawMaterial. */
export async function appendReferenceFormulationNormalization(input: {
  referenceFormulationRecordId: string;
  canonicalChemicalCandidates?: Record<string, string[]>;
  componentContributions?: Record<string, ReferenceFormulationContribution[]>;
  canonicalFunctionCandidates?: Record<string, MaterialFunction[]>;
}): Promise<ReferenceFormulationNormalizationVersion> {
  const [sourceRecords, existingRecords, sdsEvidenceRecords] = await Promise.all([
    listRecords("reference_formulations"),
    listRecords("reference_formulation_normalizations"),
    listRecords("supplier_sds_product_evidence"),
  ]);
  const sourceValue = sourceRecords.find((record) => record.id === input.referenceFormulationRecordId);
  if (!sourceValue) throw new Error("Reference formulation record was not found.");
  const source = referenceFormulationRecordSchema.parse(sourceValue);
  const existing = existingRecords
    .map((record) => referenceFormulationNormalizationVersionSchema.parse(record))
    .filter((record) => record.referenceFormulationRecordId === source.id)
    .sort((left, right) => right.version - left.version);
  const parsedSdsEvidence = sdsEvidenceRecords.map((record) => supplierSdsProductEvidenceRecordSchema.parse(record));
  validateNormalizationHistory(source, [...existing].reverse(), parsedSdsEvidence);
  const latest = existing[0];
  const version = createReferenceFormulationNormalizationVersion({
    id: `normalization-${globalThis.crypto.randomUUID()}`,
    source,
    version: (latest?.version ?? 0) + 1,
    ...(latest ? { supersedesNormalizationId: latest.id } : {}),
    canonicalChemicalCandidates: input.canonicalChemicalCandidates,
    canonicalFunctionCandidates: input.canonicalFunctionCandidates,
    componentContributions: input.componentContributions,
    supplierSdsEvidenceRecords: parsedSdsEvidence,
    createdAt: nowIso(),
  });
  const saved = await appendReferenceFormulationNormalizationRecord(version);
  return referenceFormulationNormalizationVersionSchema.parse(saved);
}

function validateNormalizationHistory(
  source: ReturnType<typeof referenceFormulationRecordSchema.parse>,
  versions: ReferenceFormulationNormalizationVersion[],
  sdsEvidenceRecords: SupplierSdsProductEvidenceRecord[] = [],
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
      for (const contribution of line.componentContributions) {
        if (contribution.sourceFormulaLineId !== line.sourceLineId) {
          throw new Error("Component contribution must remain attached to its immutable normalization source line.");
        }
        validateReferenceFormulationContributionAgainstSource(contribution, source, sdsEvidenceRecords);
      }
      const functionNormalization = line.functionNormalization ?? createReferenceFormulationFunctionNormalization({
        source,
        sourceFormulaLineId: line.sourceLineId,
      });
      validateReferenceFormulationFunctionNormalizationAgainstSource(functionNormalization, source, line.sourceLineId);
    }
    const processNormalization = version.processNormalization ?? createReferenceFormulationProcessNormalization(source);
    validateReferenceFormulationProcessNormalizationAgainstSource(processNormalization, source);
    const targetNormalization = version.targetNormalization ?? createReferenceFormulationTargetNormalization(source);
    validateReferenceFormulationTargetNormalizationAgainstSource(targetNormalization, source);
    if (version.version !== index + 1
      || (index === 0 ? version.supersedesNormalizationId !== undefined : version.supersedesNormalizationId !== versions[index - 1]?.id)) {
      throw new Error("Normalization versions must form one unbroken append-only predecessor chain.");
    }
  });
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
