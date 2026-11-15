/** Layout parser generation of a record ("...-layout-v3-..." -> 3); 0 when unknown. */
export function referenceFormulationParserGeneration(parserVersion: string | undefined): number {
  return Number(/layout-v(\d+)/.exec(parserVersion ?? "")?.[1] ?? 0);
}

/**
 * Records are immutable, so re-parsing a source PDF with a newer layout parser adds
 * records instead of replacing them. Aggregations must only use the newest parse of
 * each source document; older parses stay as history.
 */
export function currentReferenceFormulations<T extends { sourceDocumentHash: string; source: { parserVersion: string } }>(records: T[]): T[] {
  const newest = new Map<string, number>();
  for (const record of records) {
    const key = record.sourceDocumentHash.toLowerCase();
    newest.set(key, Math.max(newest.get(key) ?? 0, referenceFormulationParserGeneration(record.source.parserVersion)));
  }
  return records.filter((record) =>
    referenceFormulationParserGeneration(record.source.parserVersion) === newest.get(record.sourceDocumentHash.toLowerCase()));
}
