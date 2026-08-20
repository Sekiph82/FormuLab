/**
 * Session 12 hardening (FVL-04.019, Section 1) — real, generic
 * relationship-assembly acceptance, config-driven, no per-customer
 * branch.
 */
import { describe, expect, it } from "vitest";
import { assembleRelationalRecords, wrapAssembledSource, type RelationalJoinConfig } from "./relationalAssembly";
import type { ConnectorIdentity, ConnectorResult, SourceConnector, StagedSourceRecord } from "../schemas/connector";

const identity: ConnectorIdentity = { connectorId: "test-connector", connectorType: "DATABASE", connectorVersion: "1.0", sourceSystemId: "TEST", sourceSystemName: "TEST" };

function record(entity: string, id: string, fields: Record<string, string | null>): StagedSourceRecord {
  return {
    identity: { sourceEntity: entity, sourceRecordId: id, idSource: "configured" },
    fields,
    lineage: { sourceSystemId: "TEST", sourceEntity: entity, sourceRecordId: id, extractionRunId: "run-1", connectorVersion: "1.0", rawRecordFingerprint: `fp-${entity}-${id}` },
    extraction: { extractedAt: "2026-01-01T00:00:00.000Z", extractionRunId: "run-1" },
  };
}

function connectorFrom(byEntity: Record<string, ConnectorResult>): SourceConnector {
  return {
    identity,
    discoverEntities: () => Object.keys(byEntity),
    extract: (entity: string) => byEntity[entity] ?? { connector: identity, entity, records: [], warnings: [], errors: [], stats: { totalRecords: 0, readRecords: 0, errorRecords: 0 } },
  };
}

const config: RelationalJoinConfig = {
  headerEntity: "formula_header",
  lineEntity: "formula_line",
  headerKeyField: "FormulaCode",
  lineKeyField: "FormulaCode",
  headerFieldsToCopy: ["FormulaName", "ProductFamilyCode"],
  assembledEntity: "assembled_formulas",
};

describe("assembleRelationalRecords — generic, config-driven header/line join", () => {
  it("joins line records to their header by the configured key, copying only the configured header fields, in the line's own extraction order", async () => {
    const connector = connectorFrom({
      formula_header: {
        connector: identity,
        entity: "formula_header",
        records: [record("formula_header", "H-1", { FormulaCode: "FH-1", FormulaName: "Test Formula", ProductFamilyCode: "FAM-1" })],
        warnings: [],
        errors: [],
        stats: { totalRecords: 1, readRecords: 1, errorRecords: 0 },
      },
      formula_line: {
        connector: identity,
        entity: "formula_line",
        records: [
          record("formula_line", "L-2", { FormulaCode: "FH-1", LineNumber: "2", MaterialCode: "MAT-B" }),
          record("formula_line", "L-1", { FormulaCode: "FH-1", LineNumber: "1", MaterialCode: "MAT-A" }),
        ],
        warnings: [],
        errors: [],
        stats: { totalRecords: 2, readRecords: 2, errorRecords: 0 },
      },
    });
    const result = await assembleRelationalRecords(connector, config);
    expect(result.errors).toEqual([]);
    expect(result.records.map((r) => r.identity.sourceRecordId)).toEqual(["L-2", "L-1"]); // deterministic — the line entity's own extraction order, untouched
    expect(result.records[0].fields).toMatchObject({ FormulaCode: "FH-1", LineNumber: "2", MaterialCode: "MAT-B", FormulaName: "Test Formula", ProductFamilyCode: "FAM-1" });
  });

  it("a line whose header key resolves to no real header record produces a structured error and is excluded — never a silent drop, never blocking OTHER lines", async () => {
    const connector = connectorFrom({
      formula_header: {
        connector: identity,
        entity: "formula_header",
        records: [record("formula_header", "H-1", { FormulaCode: "FH-1", FormulaName: "Real Formula" })],
        warnings: [],
        errors: [],
        stats: { totalRecords: 1, readRecords: 1, errorRecords: 0 },
      },
      formula_line: {
        connector: identity,
        entity: "formula_line",
        records: [
          record("formula_line", "L-1", { FormulaCode: "FH-1", LineNumber: "1", MaterialCode: "MAT-A" }),
          record("formula_line", "L-2", { FormulaCode: "FH-MISSING", LineNumber: "1", MaterialCode: "MAT-B" }),
        ],
        warnings: [],
        errors: [],
        stats: { totalRecords: 2, readRecords: 2, errorRecords: 0 },
      },
    });
    const result = await assembleRelationalRecords(connector, { ...config, headerFieldsToCopy: ["FormulaName"] });
    expect(result.records.map((r) => r.identity.sourceRecordId)).toEqual(["L-1"]); // the OTHER line still assembles fine
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "missing_header_relationship", sourceRecordId: "L-2" });
  });

  it("a line's OWN value for a header-copied field name is never overwritten by the header's", async () => {
    const connector = connectorFrom({
      formula_header: {
        connector: identity,
        entity: "formula_header",
        records: [record("formula_header", "H-1", { FormulaCode: "FH-1", FormulaName: "Header Name" })],
        warnings: [],
        errors: [],
        stats: { totalRecords: 1, readRecords: 1, errorRecords: 0 },
      },
      formula_line: {
        connector: identity,
        entity: "formula_line",
        records: [record("formula_line", "L-1", { FormulaCode: "FH-1", FormulaName: "Line's Own Name" })],
        warnings: [],
        errors: [],
        stats: { totalRecords: 1, readRecords: 1, errorRecords: 0 },
      },
    });
    const result = await assembleRelationalRecords(connector, { ...config, headerFieldsToCopy: ["FormulaName"] });
    expect(result.records[0].fields.FormulaName).toBe("Line's Own Name");
  });
});

describe("wrapAssembledSource — the assembled result is a genuine SourceConnector, indistinguishable from any other", () => {
  it("exposes exactly the configured assembledEntity, and refuses any other entity name honestly", async () => {
    const connector = wrapAssembledSource(identity, config, { records: [record("formula_line", "L-1", { FormulaCode: "FH-1" })], errors: [], warnings: [] });
    expect(connector.discoverEntities()).toEqual(["assembled_formulas"]);
    const good = await connector.extract("assembled_formulas");
    expect(good.records).toHaveLength(1);
    const bad = await connector.extract("something_else");
    expect(bad.errors[0].code).toBe("unknown_entity");
  });
});
