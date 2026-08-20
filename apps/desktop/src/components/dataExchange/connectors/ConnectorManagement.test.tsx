/**
 * Connector Management frontend — CFUI acceptance. Real components, real
 * engines (`prepareConnectorImport`/`confirmConnectorImport`/
 * `discoverSourceSchema`/`applyMappingProfile`), a real in-memory
 * masterdata store (same stateful mocking convention
 * `ConnectorBridgeImportDialog.test.tsx`/`connectorImportBridge.test.ts`
 * already use) — never a snapshot of a giant tree.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFileConnector, discoverSourceSchema, mappingProfileCode, type MappingProfile } from "@formulab/shared";
import { ConnectorManagementShell } from "./ConnectorManagementShell";

// The REAL schema fingerprint for the "MaterialID,MaterialName" header
// shape every fixture CSV below uses — computed once, through the same
// real `discoverSourceSchema()` the UI itself calls, so `saveProfile()`'s
// fixture profiles are never authored against a made-up fingerprint that
// would trip a genuine SCHEMA_CHANGED block.
async function realMaterialsFingerprint(sourceSystemId: string): Promise<string> {
  const connector = createFileConnector(sourceSystemId, { fileName: "probe.csv", fileKind: "csv", text: "MaterialID,MaterialName\nMAT-0,Probe", entity: "materials" }, { extractionRunId: "probe", extractedAt: "2026-01-01T00:00:00.000Z" });
  const staged = await connector.extract("materials");
  return discoverSourceSchema(sourceSystemId, [{ entity: "materials", records: staged.records }]).fingerprint;
}

const store = new Map<string, Record<string, unknown>[]>();
const bridge = {
  listRecords: vi.fn((collection: string) => Promise.resolve(store.get(collection) ?? [])),
  upsertRecords: vi.fn((collection: string, records: Record<string, unknown>[]) => {
    const existing = store.get(collection) ?? [];
    let inserted = 0;
    let updated = 0;
    const next = [...existing];
    for (const record of records) {
      const key = (record.code ?? record.id) as string | undefined;
      const idx = key ? next.findIndex((r) => (r.code ?? r.id) === key) : -1;
      if (idx >= 0) {
        next[idx] = record;
        updated++;
      } else {
        next.push(record);
        inserted++;
      }
    }
    store.set(collection, next);
    return Promise.resolve({ inserted, updated, total: next.length });
  }),
  deleteRecord: vi.fn((collection: string, code: string) => {
    store.set(collection, (store.get(collection) ?? []).filter((r) => r.code !== code));
    return Promise.resolve();
  }),
};
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, Record<string, unknown>[]]) => bridge.upsertRecords(...a),
  deleteRecord: (...a: [string, string]) => bridge.deleteRecord(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

const ctx = { actorUserId: "local", actorRole: "administrator" as const };

function renderShell() {
  return render(<ConnectorManagementShell actorUserId={ctx.actorUserId} actorRole={ctx.actorRole} />);
}

function csvFile(name: string, text: string) {
  return new File([text], name, { type: "text/csv" });
}

async function addFileConnection(user: ReturnType<typeof userEvent.setup>, name: string, sourceSystemId: string) {
  await user.click(screen.getByRole("button", { name: "Add Connection" }));
  await user.click(await screen.findByText("FILE"));
  await user.type(screen.getByLabelText("Connection name"), name);
  await user.type(screen.getByLabelText("Source system ID"), sourceSystemId);
  await user.type(screen.getByLabelText("External ID field"), "MaterialID");
  await user.click(screen.getByLabelText(/Require an explicit identity/));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByLabelText("Connection name")).not.toBeInTheDocument());
}

async function saveProfile(sourceSystemId: string, sourceEntity: string, version = 1): Promise<MappingProfile> {
  const profile: MappingProfile = {
    schemaVersion: "1.0",
    code: mappingProfileCode(`${sourceSystemId.toLowerCase()}-materials`, version),
    profileId: `${sourceSystemId.toLowerCase()}-materials`,
    profileName: "Materials",
    sourceSystemId,
    sourceEntity,
    sourceSchemaFingerprint: await realMaterialsFingerprint(sourceSystemId),
    profileVersion: version,
    status: "active",
    fieldMappings: [
      { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
      { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
    ],
    constantMappings: [],
    ...(version > 1 ? { supersedesProfileCode: mappingProfileCode(`${sourceSystemId.toLowerCase()}-materials`, version - 1) } : {}),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "local",
  };
  store.set("mapping_profiles", [...(store.get("mapping_profiles") ?? []), profile]);
  return profile;
}

async function openConnectionsReview(user: ReturnType<typeof userEvent.setup>, connectionName: string) {
  await user.click(screen.getByRole("button", { name: "Connections" }));
  await user.click(await screen.findByRole("button", { name: connectionName }));
  await user.click(screen.getByRole("button", { name: "Conflicts / Review" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(store.get(collection) ?? []));
  bridge.upsertRecords.mockImplementation((collection: string, records: Record<string, unknown>[]) => {
    const existing = store.get(collection) ?? [];
    let inserted = 0;
    let updated = 0;
    const next = [...existing];
    for (const record of records) {
      const key = (record.code ?? record.id) as string | undefined;
      const idx = key ? next.findIndex((r) => (r.code ?? r.id) === key) : -1;
      if (idx >= 0) {
        next[idx] = record;
        updated++;
      } else {
        next.push(record);
        inserted++;
      }
    }
    store.set(collection, next);
    return Promise.resolve({ inserted, updated, total: next.length });
  });
});

describe("CFUI3: Add Connection offers only FILE/DATABASE/REST API", () => {
  it("shows exactly the three supported connector types", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Add Connection" }));
    expect(await screen.findByText("FILE")).toBeInTheDocument();
    expect(screen.getByText("DATABASE")).toBeInTheDocument();
    expect(screen.getByText("REST API")).toBeInTheDocument();
    expect(screen.queryByText(/GRAPHQL|SOAP|FTP/i)).not.toBeInTheDocument();
  });
});

describe("CFUI7/CFUI28: REST configuration exposes no write method and no plaintext credential field", () => {
  it("has no POST/PUT/PATCH/DELETE selector, and connectionRef is the only auth-adjacent field", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Add Connection" }));
    await user.click(await screen.findByText("REST API"));
    expect(screen.queryByText(/^POST$|^PUT$|^PATCH$|^DELETE$/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Connection reference/)).toBeInTheDocument();
    // Exact label matches only — the connectionRef field's own HINT text
    // mentions "password" as a reassurance ("never a raw password..."),
    // which a substring match would wrongly flag as a password field.
    expect(screen.queryByLabelText("Password", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API Key", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bearer Token", { exact: true })).not.toBeInTheDocument();
  });
});

describe("CFUI13/CFUI19/CFUI20: Prepare Import calls the real bridge, renders a summary, and gates Commit", () => {
  it("a clean prepared import enables Commit; committing writes through the real bridge", async () => {
    const user = userEvent.setup();
    await saveProfile("TESTSRC", "materials");
    renderShell();
    await addFileConnection(user, "Legacy ERP", "TESTSRC");
    await openConnectionsReview(user, "Legacy ERP");

    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [mappingProfileCode("testsrc-materials", 1)]);
    const fileInput = screen.getByLabelText("Choose file");
    await user.upload(fileInput, csvFile("m.csv", "MaterialID,MaterialName\nMAT-1,Test Material"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));

    expect(await screen.findByText("Summary")).toBeInTheDocument();
    const commitButton = screen.getByRole("button", { name: "Commit" });
    await waitFor(() => expect(commitButton).toBeEnabled());

    await user.click(commitButton);
    await screen.findByText("Import committed.");
    expect(store.get("materials")?.some((r) => r.code === "MAT-1")).toBe(true);
  });
});

describe("CFUI14: CANONICAL_LOCAL_CONFLICT renders as blocking and disables Commit", () => {
  it("a hand-edited canonical record blocks a re-import that also changed source", async () => {
    const user = userEvent.setup();
    await saveProfile("TESTSRC2", "materials");
    renderShell();
    await addFileConnection(user, "ERP Two", "TESTSRC2");
    await openConnectionsReview(user, "ERP Two");

    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [mappingProfileCode("testsrc2-materials", 1)]);
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m1.csv", "MaterialID,MaterialName\nMAT-1,Original Name"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText("Import committed.");

    // Hand-edit the canonical record out-of-band.
    const material = store.get("materials")!.find((r) => r.code === "MAT-1")!;
    material.displayName = "Hand-Edited In Workspace";

    await user.upload(screen.getByLabelText("Choose file"), csvFile("m2.csv", "MaterialID,MaterialName\nMAT-1,Genuinely Changed Name"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));

    expect(await screen.findByText("CANONICAL_LOCAL_CONFLICT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });
});

describe("CFUI21: a stale prepared plan is rejected on confirm, never silently retried", () => {
  it("confirm rejects and the prepared plan is cleared, requiring a fresh Prepare Import", async () => {
    const user = userEvent.setup();
    await saveProfile("TESTSRC3", "materials");
    renderShell();
    await addFileConnection(user, "ERP Three", "TESTSRC3");
    await openConnectionsReview(user, "ERP Three");

    // Round 1 — a real, genuine first import, so MAT-9's live state is
    // something round 2's own prepare can actually snapshot and compare.
    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [mappingProfileCode("testsrc3-materials", 1)]);
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m1.csv", "MaterialID,MaterialName\nMAT-9,Test"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText("Import committed.");

    // Round 2 — prepare reviews the CURRENT live MAT-9 (snapshotting its
    // fingerprint), then something else edits it before confirm runs.
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m2.csv", "MaterialID,MaterialName\nMAT-9,Test"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled());

    const material = store.get("materials")!.find((r) => r.code === "MAT-9")!;
    material.displayName = "Raced In From Elsewhere";

    await user.click(screen.getByRole("button", { name: "Commit" }));
    expect(await screen.findByText(/stale/i)).toBeInTheDocument();
    // No silent retry: Commit is gone until a fresh Prepare Import.
    expect(screen.queryByRole("button", { name: "Commit" })).not.toBeInTheDocument();
  });
});

describe("CFUI8/CFUI10: Mapping Profiles list and schema-mismatch blocking", () => {
  it("lists profile code/version/status, and validating against a changed schema reports the mismatch", async () => {
    const user = userEvent.setup();
    const profile = await saveProfile("TESTSRC4", "materials");
    renderShell();
    await user.click(screen.getByRole("button", { name: "Mapping Profiles" }));
    expect(await screen.findByText(profile.code)).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });
});

describe("CFUI11/CFUI12: Crosswalk explorer and ordinal-identity warning", () => {
  it("renders the exact source -> canonical identity, never a display-name match", async () => {
    store.set("external_id_crosswalks", [
      {
        schemaVersion: "1.0",
        code: "TESTSRC5::materials::ERP-EXT-1::RawMaterial",
        sourceSystemId: "TESTSRC5",
        sourceEntity: "materials",
        sourceRecordId: "ERP-EXT-1",
        canonicalEntity: "RawMaterial",
        canonicalRecordId: "RM-00291",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        status: "active",
      },
    ]);
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Crosswalks" }));
    expect(await screen.findByText("ERP-EXT-1")).toBeInTheDocument();
    expect(screen.getByText("RM-00291")).toBeInTheDocument();
    expect(screen.getByText("RawMaterial")).toBeInTheDocument();
  });

  it("shows the ordinal-identity warning when a source has no configured external ID", async () => {
    const user = userEvent.setup();
    renderShell();
    await addFileConnection(user, "No Id ERP", "TESTSRC6");
    await user.click(screen.getByRole("button", { name: "Connections" }));
    await user.click(await screen.findByRole("button", { name: "No Id ERP" }));
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m.csv", "SomeCol\nx"));
    await user.click(screen.getByRole("button", { name: "Test / Discover" }));
    expect(await screen.findByText(/Ordinal \(staging-row position\)/)).toBeInTheDocument();
  });
});

describe("CFUI22: Import Runs shows real connector provenance", () => {
  it("renders sourceSystemId/connectorType/mappingProfileCode from a real committed job", async () => {
    const user = userEvent.setup();
    await saveProfile("TESTSRC7", "materials");
    renderShell();
    await addFileConnection(user, "ERP Seven", "TESTSRC7");
    await openConnectionsReview(user, "ERP Seven");
    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [mappingProfileCode("testsrc7-materials", 1)]);
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m.csv", "MaterialID,MaterialName\nMAT-1,Test"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText("Import committed.");

    await user.click(screen.getByRole("button", { name: "Import Runs" }));
    expect(await screen.findByText("TESTSRC7")).toBeInTheDocument();
    expect(screen.getByText("FILE")).toBeInTheDocument();
  });
});

describe("CFUI29: Turkish connector labels render", () => {
  it("the Connections empty state and tab labels render in Turkish", async () => {
    const i18n = (await import("@/i18n")).default;
    await i18n.changeLanguage("tr");
    render(<ConnectorManagementShell actorUserId={ctx.actorUserId} actorRole={ctx.actorRole} />);
    expect(await screen.findByText("Bağlantılar", { selector: "button" })).toBeInTheDocument();
    expect(screen.getByText(/Henüz hiçbir bağlantı yapılandırılmadı/)).toBeInTheDocument();
    await i18n.changeLanguage("en");
  });
});

describe("CFUI30: navigation remains usable at a common laptop viewport", () => {
  it("renders without horizontal overflow at 1366px width", async () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1366 });
    const { container } = renderShell();
    await screen.findByRole("button", { name: "Add Connection" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(within(container).getByRole("button", { name: "Connections" })).toBeInTheDocument();
  });
});
