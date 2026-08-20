/**
 * Session 12 hardening (FVL-04.019, Section 1) — a real, generic,
 * configuration-driven relationship-assembly path for a header/line
 * relational source (e.g. `FormulaHeader` + `FormulaLine`), so a real
 * migration never needs a customer-specific parser or a test-local
 * manual `filter()`/object-merge to join them.
 *
 * The connector layer itself stays pure: `SourceConnector.extract()`
 * still only ever independently stages ONE entity at a time (proven by
 * `connectorEndToEnd.test.ts`'s own header/line acceptance) — NO join
 * happens inside a connector. This module is the one place that DOES
 * join, and it is entirely config-driven: which two entities, which
 * field on each carries the join key, and which header fields get
 * copied onto every joined line record. There is no per-customer branch
 * anywhere in this file.
 *
 * `assembleRelationalRecords()` extracts both entities independently
 * (through the SAME real connector, never a hidden second one),
 * deterministically joins line -> header by the configured key, copies
 * the configured header fields onto every matched line, and reports a
 * structured error (never a silent drop) for a line whose header
 * relationship cannot be resolved. `wrapAssembledSource()` then presents
 * the assembled result as a genuine `SourceConnector` — the exact same
 * shape every other connector already implements — so the UNCHANGED
 * `prepareConnectorImport()`/`confirmConnectorImport()` pipeline
 * consumes it identically to any single-entity source. Relationship
 * resolution belongs in this bridge-layer step, never inside the
 * connector or duplicated into a template-specific commit handler.
 */
import type { ConnectorError, ConnectorIdentity, ConnectorResult, SourceConnector, StagedSourceRecord } from "../schemas/connector";

export interface RelationalJoinConfig {
  /** The header entity name — already independently extractable via the
   *  connector's own `discoverEntities()`/`extract()`. */
  headerEntity: string;
  /** The line entity name — same requirement. */
  lineEntity: string;
  /** The header's own field carrying the join key (e.g. `"FormulaCode"`). */
  headerKeyField: string;
  /** The line's own field carrying the SAME join key — its FK to the
   *  header (e.g. `"FormulaCode"` on the line table too). */
  lineKeyField: string;
  /** Header fields copied onto every successfully-joined line record,
   *  using the header's own field name unchanged as both the source and
   *  destination key — never renamed, never guessed; the caller names
   *  exactly what a real header-level fact (formula name, product
   *  family code, ...) is required downstream. A line record that
   *  already had a field under this same name keeps its OWN value
   *  instead (the line's own data is never silently overwritten by the
   *  header's). */
  headerFieldsToCopy: string[];
  /** The entity name the ASSEMBLED (joined) records should be reported
   *  under — passed to `prepareConnectorImport({ entity })` afterward.
   *  Never one of `headerEntity`/`lineEntity` themselves, so a caller
   *  can never confuse an assembled batch with a raw single-entity one. */
  assembledEntity: string;
}

export interface AssembledRelationalResult {
  records: StagedSourceRecord[];
  errors: ConnectorError[];
  warnings: ConnectorError[];
}

/**
 * Deterministic: line records are joined in the SAME order
 * `lineEntity`'s own extraction returned them — this module performs no
 * reordering of its own (line-order determinism inside one formula is
 * the EXISTING `formula_bom` commit handler's own job, via
 * `line_number`, unaffected by this step).
 */
export async function assembleRelationalRecords(connector: SourceConnector, config: RelationalJoinConfig): Promise<AssembledRelationalResult> {
  const [headerResult, lineResult] = await Promise.all([connector.extract(config.headerEntity), connector.extract(config.lineEntity)]);
  const errors: ConnectorError[] = [...headerResult.errors, ...lineResult.errors];
  const warnings: ConnectorError[] = [...headerResult.warnings, ...lineResult.warnings];

  const headerByKey = new Map<string, StagedSourceRecord>();
  for (const header of headerResult.records) {
    const key = header.fields[config.headerKeyField];
    if (key !== null && key !== undefined && key !== "") headerByKey.set(key, header);
  }

  const records: StagedSourceRecord[] = [];
  for (const line of lineResult.records) {
    const key = line.fields[config.lineKeyField];
    const header = key !== null && key !== undefined && key !== "" ? headerByKey.get(key) : undefined;
    if (!header) {
      // Requirement 7 — a missing header relationship blocks this ONE
      // line (its own formula), never the whole batch, and never a
      // silent drop.
      errors.push({
        code: "missing_header_relationship",
        stage: "extract",
        sourceEntity: config.lineEntity,
        sourceRecordId: line.identity.sourceRecordId,
        message: `Line record (source "${line.identity.sourceRecordId}") references header key "${String(key)}" via "${config.lineKeyField}", but no "${config.headerEntity}" record has that "${config.headerKeyField}" — this line's own formula cannot be assembled.`,
        retryable: false,
      });
      continue;
    }
    const mergedFields: Record<string, string | null> = { ...line.fields };
    for (const f of config.headerFieldsToCopy) {
      // A line's OWN value for this field (if it already has one) is
      // never overwritten by the header's — the header only fills in
      // what the line record didn't already carry.
      if (!(f in mergedFields) || mergedFields[f] === null || mergedFields[f] === undefined || mergedFields[f] === "") {
        mergedFields[f] = header.fields[f] ?? null;
      }
    }
    records.push({ ...line, fields: mergedFields });
  }

  return { records, errors, warnings };
}

/**
 * Presents an already-assembled result as a genuine `SourceConnector` —
 * the exact same shape every real connector implements — so
 * `prepareConnectorImport()` consumes it completely unchanged, with NO
 * knowledge that a join ever happened underneath.
 */
export function wrapAssembledSource(identity: ConnectorIdentity, config: RelationalJoinConfig, assembled: AssembledRelationalResult): SourceConnector {
  const result: ConnectorResult = {
    connector: identity,
    entity: config.assembledEntity,
    records: assembled.records,
    warnings: assembled.warnings,
    errors: assembled.errors,
    stats: { totalRecords: assembled.records.length + assembled.errors.length, readRecords: assembled.records.length, errorRecords: assembled.errors.length },
  };
  return {
    identity,
    discoverEntities: () => [config.assembledEntity],
    extract: (entity: string) => {
      if (entity !== config.assembledEntity) {
        return {
          connector: identity,
          entity,
          records: [],
          warnings: [],
          errors: [{ code: "unknown_entity", stage: "extract", message: `"${entity}" is not the assembled entity this relational source exposes ("${config.assembledEntity}").`, retryable: false }],
          stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
        };
      }
      return result;
    },
  };
}
