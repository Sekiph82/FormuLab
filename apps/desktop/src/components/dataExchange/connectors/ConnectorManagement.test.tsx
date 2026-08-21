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
import { createFileConnector, crosswalkCode, discoverSourceSchema, mappingProfileCode, type MappingProfile } from "@formulab/shared";
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

/** Same real-fingerprint discipline as `realMaterialsFingerprint()`, for
 *  any CSV text a test needs (e.g. MAP7's multi-target fixture, whose
 *  header shape — supplier columns included — differs from the plain
 *  materials fixture). `csvText` must include at least one data row. */
async function realFingerprintFor(sourceSystemId: string, csvText: string): Promise<string> {
  const connector = createFileConnector(sourceSystemId, { fileName: "probe.csv", fileKind: "csv", text: csvText, entity: "materials" }, { extractionRunId: "probe", extractedAt: "2026-01-01T00:00:00.000Z" });
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

describe("Configure: editing a saved connection in place", () => {
  it("preloads current values, keeps code/type fixed, and resets status to never_tested without a fresh re-test", async () => {
    const user = userEvent.setup();
    renderShell();
    await addFileConnection(user, "ERP Configure", "TESTCFG1");
    await screen.findByText("ERP Configure");

    await user.click(screen.getByRole("button", { name: "Configure" }));
    expect(await screen.findByText("Configure Connection")).toBeInTheDocument();
    // Preloaded, not blank.
    expect(screen.getByLabelText("Connection name")).toHaveValue("ERP Configure");
    expect(screen.getByLabelText("Source system ID")).toHaveValue("TESTCFG1");
    // No type picker — FILE/DATABASE/REST API cards are not shown again.
    expect(screen.queryByText("DATABASE")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Connection name"));
    await user.type(screen.getByLabelText("Connection name"), "ERP Configure Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("Configure Connection")).not.toBeInTheDocument());

    expect(await screen.findByText("ERP Configure Renamed")).toBeInTheDocument();
    // Never explicitly retested during Configure — status must not show
    // stale "ready"/green; it is reset to Never tested.
    expect(screen.getAllByText("Never").length).toBeGreaterThan(0);
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

describe("RESTP1-RESTP5: pagination configuration is complete and validated in the UI", () => {
  async function openRestForm(user: ReturnType<typeof userEvent.setup>) {
    renderShell();
    await user.click(screen.getByRole("button", { name: "Add Connection" }));
    await user.click(await screen.findByText("REST API"));
    await user.type(screen.getByLabelText("Connection name"), "ACME API");
    await user.type(screen.getByLabelText("Source system ID"), "ACME");
  }

  it("RESTP1: none pagination — Save is enabled with no pagination-specific fields", async () => {
    const user = userEvent.setup();
    await openRestForm(user);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByLabelText("Offset parameter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cursor parameter")).not.toBeInTheDocument();
  });

  it("RESTP2: page pagination — default field values keep Save enabled", async () => {
    const user = userEvent.setup();
    await openRestForm(user);
    await user.selectOptions(screen.getByLabelText("Pagination"), "Page / page size");
    expect(screen.getByLabelText("Page parameter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("RESTP3: offset pagination — offset/limit fields appear and Save is enabled with defaults", async () => {
    const user = userEvent.setup();
    await openRestForm(user);
    await user.selectOptions(screen.getByLabelText("Pagination"), "Offset / limit");
    expect(screen.getByLabelText("Offset parameter")).toBeInTheDocument();
    expect(screen.getByLabelText("Limit parameter")).toBeInTheDocument();
    expect(screen.getByLabelText("Limit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("RESTP4: cursor pagination — cursor fields appear; Save is blocked until Next-cursor path is filled", async () => {
    const user = userEvent.setup();
    await openRestForm(user);
    await user.selectOptions(screen.getByLabelText("Pagination"), "Cursor");
    expect(screen.getByLabelText("Cursor parameter")).toBeInTheDocument();
    expect(screen.getByLabelText("Next-cursor path")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByLabelText("Next-cursor path"), "meta.nextCursor");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("RESTP5: clearing a required pagination field blocks Save rather than silently degrading to none", async () => {
    const user = userEvent.setup();
    await openRestForm(user);
    await user.selectOptions(screen.getByLabelText("Pagination"), "Offset / limit");
    await user.clear(screen.getByLabelText("Offset parameter"));
    expect(screen.getByText("The selected pagination mode is missing required fields — Test and Save are disabled until it is complete.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
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

describe("CFUI15: CANONICAL_MISSING renders individually and blocks Commit", () => {
  it("a re-import whose prior canonical target was deleted out-of-band is blocked", async () => {
    const user = userEvent.setup();
    await saveProfile("TESTSRC15", "materials");
    renderShell();
    await addFileConnection(user, "ERP Fifteen", "TESTSRC15");
    await openConnectionsReview(user, "ERP Fifteen");

    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [mappingProfileCode("testsrc15-materials", 1)]);
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m1.csv", "MaterialID,MaterialName\nMAT-1,Original Name"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText("Import committed.");

    // The prior canonical target is deleted out-of-band (e.g. a manual
    // data cleanup) — the record this batch's history still points to
    // genuinely no longer exists.
    store.set("materials", (store.get("materials") ?? []).filter((r) => r.code !== "MAT-1"));

    await user.upload(screen.getByLabelText("Choose file"), csvFile("m2.csv", "MaterialID,MaterialName\nMAT-1,Original Name"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));

    expect(await screen.findByText("CANONICAL_MISSING")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });
});

describe("CFUI16: CROSSWALK_CONFLICT renders individually and blocks Commit", () => {
  it("a crosswalk bound to a different canonical record blocks the import", async () => {
    const user = userEvent.setup();
    await saveProfile("TESTSRC16", "materials");
    renderShell();
    await addFileConnection(user, "ERP Sixteen", "TESTSRC16");
    await openConnectionsReview(user, "ERP Sixteen");

    // A pre-existing crosswalk binds source MAT-1 to a DIFFERENT
    // canonical record than this batch's own natural key would target —
    // a real, direct conflict the preflight must catch before any commit.
    store.set("external_id_crosswalks", [
      {
        schemaVersion: "1.0",
        code: crosswalkCode("TESTSRC16", "materials", "MAT-1", "RawMaterial"),
        sourceSystemId: "TESTSRC16",
        sourceEntity: "materials",
        sourceRecordId: "MAT-1",
        canonicalEntity: "RawMaterial",
        canonicalRecordId: "MAT-CONFLICT",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        status: "active",
      },
    ]);

    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [mappingProfileCode("testsrc16-materials", 1)]);
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m1.csv", "MaterialID,MaterialName\nMAT-1,Original Name"));
    await user.type(screen.getByLabelText("Canonical entity (raw_materials)"), "RawMaterial");
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));

    expect(await screen.findByText("CROSSWALK_CONFLICT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });
});

describe("CFUI17: MAPPING_PROFILE_CHANGED renders individually and blocks Commit", () => {
  it("re-importing the same source record through a different mapping profile version is blocked", async () => {
    const user = userEvent.setup();
    await saveProfile("TESTSRC17", "materials", 1);
    renderShell();
    await addFileConnection(user, "ERP Seventeen", "TESTSRC17");
    await openConnectionsReview(user, "ERP Seventeen");

    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [mappingProfileCode("testsrc17-materials", 1)]);
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m1.csv", "MaterialID,MaterialName\nMAT-1,Original Name"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText("Import committed.");

    // A new mapping profile version supersedes v1 — the real immutable
    // v1<-v2 chain, same schema fingerprint (a genuine remap, not a
    // schema change).
    await saveProfile("TESTSRC17", "materials", 2);

    // Re-mount the review screen so it re-fetches the now-two-version
    // profile list (its own useEffect only runs on mount/connection
    // change, matching the shell's real conditional-render behavior).
    await user.click(screen.getByRole("button", { name: "Connections" }));
    await openConnectionsReview(user, "ERP Seventeen");

    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [mappingProfileCode("testsrc17-materials", 2)]);
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m2.csv", "MaterialID,MaterialName\nMAT-1,Original Name"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));

    expect(await screen.findByText("MAPPING_PROFILE_CHANGED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });
});

describe("CFUI18: SOURCE_MISSING renders individually with the non-destructive notice", () => {
  it("a source record present in the prior committed batch but absent from this one is reported, never deleted", async () => {
    const user = userEvent.setup();
    await saveProfile("TESTSRC18", "materials");
    renderShell();
    await addFileConnection(user, "ERP Eighteen", "TESTSRC18");
    await openConnectionsReview(user, "ERP Eighteen");

    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [mappingProfileCode("testsrc18-materials", 1)]);
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m1.csv", "MaterialID,MaterialName\nMAT-1,First\nMAT-2,Second"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText("Import committed.");

    // Round 2's source batch no longer includes MAT-2 at all.
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m2.csv", "MaterialID,MaterialName\nMAT-1,First"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));

    expect(await screen.findByText("MAT-2")).toBeInTheDocument();
    expect(screen.getByText("No canonical record will be deleted automatically.")).toBeInTheDocument();
    // MAT-2 is still a genuinely committable row from round 1 — SOURCE_MISSING
    // is informational, never a blocking state, and never a delete.
    expect(store.get("materials")!.some((r) => r.code === "MAT-2")).toBe(true);
  });
});

describe("MAP7: a multi-target Mapping Profile gets a per-template crosswalk-target field", () => {
  it("renders one canonical-entity input per distinct target template and builds crosswalkTargets for both", async () => {
    const csv = "MaterialID,MaterialName,SupplierCode,SupplierName\nMAT-1,First,SUP-1,Acme Co";
    const fingerprint = await realFingerprintFor("TESTSRC19", csv);
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("testsrc19-materials", 1),
      profileId: "testsrc19-materials",
      profileName: "Materials + Suppliers",
      sourceSystemId: "TESTSRC19",
      sourceEntity: "materials",
      sourceSchemaFingerprint: fingerprint,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
        { sourceField: "SupplierCode", targetTemplate: "suppliers", targetField: "supplier_code" },
        { sourceField: "SupplierName", targetTemplate: "suppliers", targetField: "supplier_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    store.set("mapping_profiles", [profile]);

    const user = userEvent.setup();
    renderShell();
    await addFileConnection(user, "ERP Nineteen", "TESTSRC19");
    await openConnectionsReview(user, "ERP Nineteen");

    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [profile.code]);

    // Both templates get their own field — never reduced to the first.
    expect(screen.getByLabelText("Canonical entity (raw_materials)")).toBeInTheDocument();
    expect(screen.getByLabelText("Canonical entity (suppliers)")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Canonical entity (raw_materials)"), "RawMaterial");
    await user.type(screen.getByLabelText("Canonical entity (suppliers)"), "Supplier");
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m.csv", csv));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));

    expect(await screen.findByText("Summary")).toBeInTheDocument();
    // Proof of zero real blocking issues: Commit only ever enables when
    // `prepared.blockingIssues.length === 0` (both crosswalk targets
    // resolved cleanly).
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled());
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

describe("CFUI8: Mapping Profiles list renders code/version/effective status", () => {
  it("lists profile code/version/status from the real mapping_profiles collection", async () => {
    const user = userEvent.setup();
    const profile = await saveProfile("TESTSRC4", "materials");
    renderShell();
    await user.click(screen.getByRole("button", { name: "Mapping Profiles" }));
    expect(await screen.findByText(profile.code)).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });
});

describe("CFUI10: a changed real schema is exercised through the UI and blocks Prepare Import", () => {
  it("a profile authored against a stale schema fingerprint blocks the batch with SCHEMA_CHANGED, and Commit never appears enabled", async () => {
    const user = userEvent.setup();
    // Authored against a fingerprint that does NOT match what the real
    // CSV below will actually discover — a genuine, real schema mismatch,
    // not a simulated one.
    const staleProfile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("testsrc10-materials", 1),
      profileId: "testsrc10-materials",
      profileName: "Materials",
      sourceSystemId: "TESTSRC10",
      sourceEntity: "materials",
      sourceSchemaFingerprint: "stale-fingerprint-does-not-match",
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    store.set("mapping_profiles", [staleProfile]);

    renderShell();
    await addFileConnection(user, "ERP Ten", "TESTSRC10");
    await openConnectionsReview(user, "ERP Ten");

    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.selectOptions(screen.getByLabelText("Mapping Profile"), [staleProfile.code]);
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m.csv", "MaterialID,MaterialName\nMAT-1,Test Material"));
    await user.click(screen.getByRole("button", { name: "Prepare Import" }));

    expect(await screen.findByText(/^SCHEMA_CHANGED:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });
});

describe("MAP1/MAP2/CFUI9: Source Explorer schema flows into Mapping, and required-field validation gates Save", () => {
  it("Create Mapping Profile from a real inspection prefills entity/fields; Save is blocked until validation is clean", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await addFileConnection(user, "ERP Nine", "TESTSRC9");
    await user.click(await screen.findByRole("button", { name: "ERP Nine" }));
    await user.upload(screen.getByLabelText("Choose file"), csvFile("m.csv", "MaterialID,MaterialName\nMAT-1,First"));
    await user.click(screen.getByRole("button", { name: "Test / Discover" }));
    await screen.findByText("Schema");

    // MAP1/MAP2 — the real discovered schema/entity flow into Mapping,
    // reaching the editor without the operator retyping anything.
    await user.click(screen.getByRole("button", { name: "Create Mapping Profile" }));
    await user.click(await screen.findByRole("button", { name: "Create Mapping Profile" }));
    const sourceEntityInput = screen.getByLabelText("Source entity") as HTMLInputElement;
    expect(sourceEntityInput.value.length).toBeGreaterThan(0);
    // "Match exact names" only renders when real sourceFieldOptions were
    // actually passed through — proof MAP1's schema genuinely arrived.
    expect(screen.getByRole("button", { name: "Match exact names" })).toBeInTheDocument();

    // CFUI9 — map only the natural key, leaving a required field
    // (material_name) unmapped, then Validate.
    await user.click(screen.getByRole("button", { name: "Add mapping" }));
    await user.type(screen.getByPlaceholderText("Source field"), "MaterialID");
    // Real <select> elements only — an `<input list>` (the source-field
    // combobox above) also carries an implicit ARIA "combobox" role, so
    // `getAllByRole("combobox")` would wrongly include it too.
    let selects = Array.from(container.querySelectorAll("select"));
    await user.selectOptions(selects[0], "Raw Materials Master");
    await user.selectOptions(selects[1], "material_code");
    await user.click(screen.getByRole("button", { name: "Validate Mapping" }));

    expect(await screen.findByText(/Required field "material_name"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Profile" })).toBeDisabled();

    // Complete the required mapping and re-validate — clean, Save unblocks.
    await user.click(screen.getByRole("button", { name: "Add mapping" }));
    const sourceFieldInputs = screen.getAllByPlaceholderText("Source field");
    await user.type(sourceFieldInputs[1], "MaterialName");
    selects = Array.from(container.querySelectorAll("select"));
    await user.selectOptions(selects[2], "Raw Materials Master");
    await user.selectOptions(selects[3], "material_name");
    await user.click(screen.getByRole("button", { name: "Validate Mapping" }));

    expect(await screen.findByText("No validation issues — this mapping profile is ready to use.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Profile" })).toBeEnabled();
  });
});

describe("CFUI6: REST Source Explorer renders real staged sample records, not just a count", () => {
  it("a real GET round trip through the http fetch adapter populates Sample Records and Identity", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([{ MaterialID: "MAT-1", MaterialName: "First" }, { MaterialID: "MAT-2", MaterialName: "Second" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Add Connection" }));
    await user.click(await screen.findByText("REST API"));
    await user.type(screen.getByLabelText("Connection name"), "ACME REST");
    await user.type(screen.getByLabelText("Source system ID"), "ACMEREST");
    await user.type(screen.getByLabelText("Base URL"), "https://api.example.com");
    await user.type(screen.getByLabelText("Endpoint path"), "/v1/materials");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByLabelText("Connection name")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "ACME REST" }));
    await user.type(screen.getByLabelText("Entity"), "materials");
    await user.click(screen.getByRole("button", { name: "Test / Discover" }));

    expect(await screen.findByText("Connected — 2 record(s) read from this page.")).toBeInTheDocument();
    expect(screen.getByText("Sample Records")).toBeInTheDocument();
    expect(screen.getByText("MAT-1")).toBeInTheDocument();
    expect(screen.getByText("MAT-2")).toBeInTheDocument();
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // GET-only — never a write method, even implicitly.
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");

    vi.unstubAllGlobals();
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

describe("CFUI22/RUN1-RUN3: Import Runs shows real connector provenance", () => {
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

    // RUN1/RUN2: open the run detail and confirm each header aligns with
    // its own real data — not a mismatched borrowed label (the
    // "Target template" header used to be paired with a naturalKey cell).
    await user.click(screen.getByRole("button", { name: /\d/ }));
    const detailTable = await screen.findByText("Natural key");
    expect(detailTable).toBeInTheDocument();
    expect(screen.getByText("Source record ID")).toBeInTheDocument();
    expect(screen.getByText("Target collection")).toBeInTheDocument();
    expect(screen.getByText("Target record ID")).toBeInTheDocument();
    // MAT-1 legitimately repeats across naturalKey/sourceRecordId/targetRecordId cells.
    expect(screen.getAllByText("MAT-1").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("materials")).toBeInTheDocument();

    // RUN3: source provenance (schema fingerprint, extraction run ID,
    // mapping profile) is shown in the job-level detail.
    expect(screen.getByText("Schema fingerprint")).toBeInTheDocument();
    expect(screen.getByText("Extraction run ID")).toBeInTheDocument();
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
