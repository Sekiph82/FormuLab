/**
 * Connector Management frontend — real FILE source inspection, wired to
 * the actual `createFileConnector()`/`discoverSourceSchema()` engines
 * (never a second parser). Reused by both the Add Connection wizard's
 * own inspect step and the Source Explorer.
 */
import { createFileConnector, discoverSourceSchema, type ConnectorFileKind, type ConnectorResult, type SourceSchema } from "@formulab/shared";
import { readWorkbookAllSheets } from "./xlsx";

export interface FileInspectResult {
  ok: boolean;
  message: string;
  entities: string[];
  staged?: ConnectorResult;
  schema?: SourceSchema;
}

export async function discoverFileEntities(file: File, fileKind: ConnectorFileKind): Promise<string[]> {
  if (fileKind !== "xlsx") return [];
  try {
    const sheets = await readWorkbookAllSheets(await file.arrayBuffer());
    return sheets.map((s) => s.sheetName);
  } catch {
    return [];
  }
}

export async function inspectFile(
  sourceSystemId: string,
  file: File,
  fileKind: ConnectorFileKind,
  opts: { entity?: string; idField?: string; requireExplicitId?: boolean },
): Promise<FileInspectResult> {
  const stageOpts = {
    extractionRunId: `explore-${Date.now()}`,
    extractedAt: new Date().toISOString(),
    ...(opts.idField ? { idField: opts.idField } : {}),
    ...(opts.requireExplicitId ? { requireExplicitId: opts.requireExplicitId } : {}),
  };

  try {
    const connector =
      fileKind === "xlsx"
        ? createFileConnector(sourceSystemId, { fileName: file.name, fileKind: "xlsx", bytes: await file.arrayBuffer(), entity: opts.entity }, stageOpts, { readWorkbook: readWorkbookAllSheets })
        : createFileConnector(sourceSystemId, { fileName: file.name, fileKind, text: await file.text(), entity: opts.entity }, stageOpts);

    const entities = await connector.discoverEntities();
    const targetEntity = opts.entity ?? entities[0];
    if (!targetEntity) {
      return { ok: false, message: "No entities/sheets could be discovered in this file.", entities };
    }
    const staged = await connector.extract(targetEntity);
    if (staged.errors.length > 0) {
      return { ok: false, message: staged.errors[0].message, entities, staged };
    }
    const schema = discoverSourceSchema(sourceSystemId, [{ entity: targetEntity, records: staged.records }]);
    return { ok: true, message: `Parsed ${staged.records.length} row(s) from "${targetEntity}".`, entities, staged, schema };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The file could not be read.", entities: [] };
  }
}
