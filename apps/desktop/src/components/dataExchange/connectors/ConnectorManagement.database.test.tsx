/**
 * DBUI8 (+ CFUI5 real exercise) — the DATABASE Source Explorer renders
 * REAL production adapter facts (PK/FK/type/nullability/sample rows),
 * never a "database unavailable" message. Isolated in its own file so
 * `@/lib/tauri`'s `isTauri` and `@tauri-apps/api/core`'s `invoke` can be
 * mocked as truthy/real for exactly this suite, without touching the
 * rest of `ConnectorManagement.test.tsx` (which deliberately runs in the
 * non-Tauri jsdom default, where `pickFile()`/database calls are no-ops).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, isTauri: true };
});

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: [string, Record<string, unknown>]) => invokeMock(...a),
}));

const store = new Map<string, Record<string, unknown>[]>();
const bridge = {
  listRecords: vi.fn((collection: string) => Promise.resolve(store.get(collection) ?? [])),
  upsertRecords: vi.fn((collection: string, records: Record<string, unknown>[]) => {
    store.set(collection, records);
    return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
  }),
  deleteRecord: vi.fn((_collection: string, _code: string) => Promise.resolve()),
};
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, Record<string, unknown>[]]) => bridge.upsertRecords(...a),
  deleteRecord: (...a: [string, string]) => bridge.deleteRecord(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

import { ConnectorManagementShell } from "./ConnectorManagementShell";

const FIXTURE_PATH = "C:/fake/materials.sqlite";

beforeEach(() => {
  invokeMock.mockReset();
  store.clear();
  store.set("connector_connections", [
    {
      schemaVersion: "1.0",
      code: "connconn-db-1",
      name: "Local ERP SQLite",
      connectorType: "DATABASE",
      sourceSystemId: "LOCALERP",
      driver: "sqlite",
      database: FIXTURE_PATH,
      table: "materials",
      status: "never_tested",
      mappingProfileCount: 0,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    },
  ]);
});

describe("DBUI8/CFUI5: DATABASE Source Explorer renders real PK/FK/type/nullability metadata and sample rows", () => {
  it("never shows a 'database unavailable' message — real adapter facts render", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "connector_sqlite_list_tables") {
        return [
          { table: "suppliers", kind: "table" },
          { table: "materials", kind: "table" },
        ];
      }
      if (cmd === "connector_sqlite_describe_table") {
        return {
          table: "materials",
          kind: "table",
          columns: [
            { name: "code", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 1 },
            { name: "supplier_id", declaredType: "INTEGER", nullable: true, isPrimaryKey: false },
            { name: "name", declaredType: "TEXT", nullable: false, isPrimaryKey: false },
          ],
          foreignKeys: [{ fromColumns: ["supplier_id"], toTable: "suppliers", toColumns: ["id"] }],
        };
      }
      if (cmd === "connector_sqlite_read_page") {
        return { columns: ["code", "supplier_id", "name"], rows: [["MAT-1", "1", "First"], ["MAT-2", "1", "Second"]], nextCursor: undefined };
      }
      throw new Error(`unexpected command ${cmd}`);
    });

    const user = userEvent.setup();
    render(<ConnectorManagementShell actorUserId="local" actorRole="administrator" />);
    await user.click(screen.getByRole("button", { name: "Connections" }));
    await user.click(await screen.findByRole("button", { name: "Local ERP SQLite" }));

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Test / Discover" }));

    // Never the old "no production database driver" limitation message.
    expect(screen.queryByText(/no database driver is available/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no production database driver/i)).not.toBeInTheDocument();

    expect(await screen.findByText("Columns")).toBeInTheDocument();
    expect(screen.getAllByText("code").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TEXT").length).toBeGreaterThan(0);
    expect(screen.getByText("suppliers.id")).toBeInTheDocument(); // real FK target
    expect(screen.getByText("Sample Records")).toBeInTheDocument();
    expect(screen.getByText("MAT-1")).toBeInTheDocument();
    expect(screen.getByText("MAT-2")).toBeInTheDocument();
  });
});
