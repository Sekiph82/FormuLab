import {
  alternativeRankingRecordSchema,
  canonicalizeForFingerprint,
  createAlternativeRankingRecord,
  verifyAlternativeRankingRecord,
  type AlternativeRankingRecord,
  type RankedAlternative,
  type Formulation,
  type FormulationVersion,
} from "@formulab/shared";
import { listFormulations, readFormulation } from "./formulations";
import { fingerprintFormulationVersion } from "./rankingPredictionSource";

export class RankingHandoffError extends Error {
  constructor(message: string) { super(message); this.name = "RankingHandoffError"; }
}

export async function loadUniqueSavedVersion(sourceFormulationVersionId: string): Promise<{ formulation: Formulation; version: FormulationVersion }> {
  const owners = await Promise.all((await listFormulations()).map(async (listed) => {
    const saved = await readFormulation(listed.id);
    return saved.versions.filter((version) => version.id === sourceFormulationVersionId)
      .map((version) => ({ formulation: saved.formulation, version }));
  }));
  const matches = owners.flat();
  if (matches.length !== 1) throw new RankingHandoffError("The ranked source FormulationVersion is missing or has ambiguous ownership.");
  const match = matches[0]!;
  if (match.version.formulationId !== match.formulation.id) throw new RankingHandoffError("The ranked source FormulationVersion owner identity is invalid.");
  return match;
}

async function verifyProjectLineage(input: {
  projectId: string;
  sourceFormulationVersionId: string;
  expectedFingerprint?: string;
  loadVersion?: (id: string) => Promise<{ formulation: Formulation; version: FormulationVersion }>;
}): Promise<void> {
  const source = await (input.loadVersion ?? loadUniqueSavedVersion)(input.sourceFormulationVersionId);
  if (source.version.id !== input.sourceFormulationVersionId || source.version.formulationId !== source.formulation.id) {
    throw new RankingHandoffError("The ranked source FormulationVersion does not resolve to its owning Formulation.");
  }
  if (source.formulation.id !== input.projectId) {
    throw new RankingHandoffError("The selected optimizer project does not own the ranked source FormulationVersion.");
  }
  if (input.expectedFingerprint) {
    const actual = await fingerprintFormulationVersion(source.version);
    if (actual.digest.toLowerCase() !== input.expectedFingerprint.toLowerCase()) {
      throw new RankingHandoffError("The saved source formula content no longer matches the verified ranking fingerprint.");
    }
  }
}

export function assertRankingEntryCanOptimize(entry: RankedAlternative | undefined): asserts entry is RankedAlternative {
  if (!entry) throw new RankingHandoffError("The requested alternative is not present in the current ranking.");
  if (entry.disposition === "BLOCKED") throw new RankingHandoffError(`Optimization is unavailable because this alternative is blocked: ${entry.gateReasons.join(", ") || "hard gate failed"}.`);
  if (entry.disposition === "UNAVAILABLE" || entry.candidate.formulaStatus !== "VALID") throw new RankingHandoffError("Optimization is unavailable because the formula is not valid and available.");
}

function sameRankingState(record: AlternativeRankingRecord, input: {
  sessionId: string;
  context: { batchKg: string; currency: string };
  rankings: RankedAlternative[];
}): boolean {
  return record.sessionId === input.sessionId
    && canonicalizeForFingerprint(record.context) === canonicalizeForFingerprint(input.context)
    && canonicalizeForFingerprint(record.rankings) === canonicalizeForFingerprint(input.rankings);
}

/** Reuse only a schema-valid, checksum-valid snapshot whose complete inputs
 *  match the exact live ranking. Otherwise append, read back and verify. */
export async function ensureCurrentRankingSnapshot(input: {
  sessionId: string;
  context: { batchKg: string; currency: string };
  rankings: RankedAlternative[];
  existingRecords: unknown[];
  createCode: () => string;
  now: () => string;
  append: (record: AlternativeRankingRecord) => Promise<void>;
  readBack: () => Promise<unknown[]>;
}): Promise<AlternativeRankingRecord> {
  for (const raw of input.existingRecords) {
    const parsed = alternativeRankingRecordSchema.safeParse(raw);
    if (!parsed.success || !sameRankingState(parsed.data, input)) continue;
    if (await verifyAlternativeRankingRecord(parsed.data)) return parsed.data;
  }
  if (input.rankings.length === 0) throw new RankingHandoffError("Cannot snapshot an empty ranking.");
  const created = await createAlternativeRankingRecord({
    code: input.createCode(), sessionId: input.sessionId, capturedAt: input.now(),
    context: input.context, rankings: input.rankings,
  });
  await input.append(created);
  const raw = (await input.readBack()).find((item) => (item as { code?: unknown })?.code === created.code);
  const persisted = alternativeRankingRecordSchema.safeParse(raw);
  if (!persisted.success || !sameRankingState(persisted.data, input) || !(await verifyAlternativeRankingRecord(persisted.data))) {
    throw new RankingHandoffError("The persisted ranking snapshot failed schema, content, or checksum verification.");
  }
  return persisted.data;
}

export async function resolveVerifiedRankingSource(input: {
  projectId: string;
  sourceSessionId: string | null;
  sourceAlternativeId: string | null;
  sourceFormulationVersionId?: string | null;
  sourceFormulaFingerprint: string | null;
  rankingRecordCode: string | null;
  records: unknown[];
  loadVersion?: (id: string) => Promise<{ formulation: Formulation; version: FormulationVersion }>;
}) {
  const hasSource = !!(input.sourceSessionId || input.sourceAlternativeId || input.sourceFormulaFingerprint || input.rankingRecordCode);
  if (!hasSource) return undefined;
  if (!input.sourceSessionId || !input.sourceAlternativeId || !input.rankingRecordCode) {
    throw new RankingHandoffError("Ranking-originated optimization requires a source session, alternative, and immutable ranking record.");
  }
  const raw = input.records.find((item) => (item as { code?: unknown })?.code === input.rankingRecordCode);
  const parsed = alternativeRankingRecordSchema.safeParse(raw);
  if (!parsed.success || !(await verifyAlternativeRankingRecord(parsed.data))) {
    throw new RankingHandoffError("The source ranking record is missing, invalid, or has a checksum mismatch.");
  }
  const record = parsed.data;
  if (record.sessionId !== input.sourceSessionId) throw new RankingHandoffError("The ranking record belongs to a different source session.");
  const entry = record.rankings.find(({ candidate }) => candidate.alternativeId === input.sourceAlternativeId);
  assertRankingEntryCanOptimize(entry);
  const savedFingerprint = entry.candidate.formulaFingerprint?.digest;
  if (input.sourceFormulaFingerprint && input.sourceFormulaFingerprint.toLowerCase() !== savedFingerprint?.toLowerCase()) {
    throw new RankingHandoffError("The source formula fingerprint does not match the verified ranking snapshot.");
  }
  const sourceFormulationVersionId = entry.candidate.sourceFormulationVersionId;
  if (!sourceFormulationVersionId) throw new RankingHandoffError("The verified ranking candidate has no saved source FormulationVersion identity.");
  if (input.sourceFormulationVersionId && input.sourceFormulationVersionId !== sourceFormulationVersionId) {
    throw new RankingHandoffError("The requested source FormulationVersion does not match the verified ranking candidate.");
  }
  await verifyProjectLineage({
    projectId: input.projectId,
    sourceFormulationVersionId,
    expectedFingerprint: savedFingerprint,
    loadVersion: input.loadVersion,
  });
  return {
    record,
    entry,
    sourceAlternative: {
      origin: "ranking" as const,
      sessionId: record.sessionId,
      alternativeId: entry.candidate.alternativeId,
      sourceFormulationVersionId,
      ...(entry.candidate.formulaFingerprint ? { formulaFingerprint: entry.candidate.formulaFingerprint } : {}),
      rankingRecordCode: record.code,
    },
  };
}
