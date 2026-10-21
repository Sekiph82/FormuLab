import {
  alternativeRankingRecordSchema,
  canonicalizeForFingerprint,
  createAlternativeRankingRecord,
  verifyAlternativeRankingRecord,
  type AlternativeRankingRecord,
  type RankedAlternative,
} from "@formulab/shared";

export class RankingHandoffError extends Error {
  constructor(message: string) { super(message); this.name = "RankingHandoffError"; }
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
  sourceSessionId: string | null;
  sourceAlternativeId: string | null;
  sourceFormulaFingerprint: string | null;
  rankingRecordCode: string | null;
  records: unknown[];
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
  return {
    record,
    entry,
    sourceAlternative: {
      origin: "ranking" as const,
      sessionId: record.sessionId,
      alternativeId: entry.candidate.alternativeId,
      ...(entry.candidate.formulaFingerprint ? { formulaFingerprint: entry.candidate.formulaFingerprint } : {}),
      rankingRecordCode: record.code,
    },
  };
}
