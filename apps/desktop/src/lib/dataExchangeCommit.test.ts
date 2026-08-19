/**
 * Behavior coverage for the Data Exchange commit layer, focused on the
 * "critical deep coverage" templates named in the Phase 6 spec: raw
 * materials, suppliers, material-supplier prices, formula/BOM, lab results,
 * stability protocols, stability results, regulatory rules, dossier
 * evidence, product claims, label content, DOE factors/responses and DOE
 * observations — plus a still-genuinely-unsupported synthetic template
 * code, asserting the honest `isTemplateCommitSupported`/`"skipped"` path
 * stays available for whatever future template ships registered before its
 * handler does.
 *
 * `dataExchangeCommitShapes.test.ts` already verifies each handler's output
 * record shape against the real Zod schemas; this file verifies the
 * *behavior* around it — reference resolution failures, grouped-row
 * commits, immutability refusals and enum validation — using the same
 * `@/lib/masterdata` / `@/lib/formulations` mocking discipline as
 * `DataExchangePage.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDataExchangeTemplate, type DataExchangeRowResult } from "@formulab/shared";
import { commitDataExchangeRows, isTemplateCommitSupported } from "./dataExchangeCommit";
import { loadExisting } from "./dataExchangeExisting";

const bridge = {
  listRecords: vi.fn(),
  upsertRecords: vi.fn(),
};
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

const formulationsBridge = {
  listFormulations: vi.fn(),
  readFormulation: vi.fn(),
  saveFormulation: vi.fn(),
  saveFormulationVersion: vi.fn(),
};
vi.mock("@/lib/formulations", () => ({
  listFormulations: (...a: []) => formulationsBridge.listFormulations(...a),
  readFormulation: (...a: [string]) => formulationsBridge.readFormulation(...a),
  saveFormulation: (...a: [unknown]) => formulationsBridge.saveFormulation(...a),
  saveFormulationVersion: (...a: [unknown]) => formulationsBridge.saveFormulationVersion(...a),
  newFormulation: (name: string, family: string, opts: { code?: string }) => ({
    schemaVersion: "1.0",
    id: "formulation-1",
    code: opts.code ?? "GEN-1",
    name,
    productFamilyCode: family,
    targetSkuCodes: [],
    targetMarkets: ["KE"],
    targetClaims: [],
    targetBatchKg: "100",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
  }),
  newVersion: (formulationId: string, lines: unknown[], opts: { versionNumber: number }) => ({
    schemaVersion: "1.0",
    id: "version-1",
    formulationId,
    versionNumber: opts.versionNumber,
    status: "concept",
    author: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    lines,
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
  }),
}));

const ctx = { actorUserId: "local", actorRole: "administrator" as const };

function row(record: Record<string, string>, overrides: Partial<DataExchangeRowResult> = {}): DataExchangeRowResult {
  return { rowNumber: 2, naturalKey: "TEST-KEY", state: "valid_create", messages: [], record, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
  formulationsBridge.listFormulations.mockResolvedValue([]);
  formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [] });
  formulationsBridge.saveFormulation.mockImplementation((f: unknown) => Promise.resolve(f));
  formulationsBridge.saveFormulationVersion.mockImplementation((v: unknown) => Promise.resolve(v));
});

describe("commitDataExchangeRows — raw materials / suppliers / material prices", () => {
  it("creates a raw material", async () => {
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("raw_materials")!, [row({ material_code: "TEST-MAT-001", material_name: "TEST Water" })], ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("materials", expect.arrayContaining([expect.objectContaining({ code: "TEST-MAT-001" })]));
  });

  it("FVL-04.001 M1/M2/M3: a real material with functions and concentration-range fields commits with all of them mapped, never dropped", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("raw_materials")!,
      [row({
        material_code: "TEST-MAT-002", material_name: "TEST Decyl Glucoside",
        material_function: "nonionic_surfactant;solvent",
        recommended_min_percent: "5.0", recommended_max_percent: "15.0", technical_max_percent: "20.0",
      })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("materials", expect.arrayContaining([
      expect.objectContaining({
        code: "TEST-MAT-002",
        functions: ["nonionic_surfactant", "solvent"],
        recommendedMinPercent: "5.0",
        recommendedMaxPercent: "15.0",
        technicalMaxPercent: "20.0",
      }),
    ]));
  });

  it("FVL-04.001: an unrecognized function token is dropped, never fabricated as a real role", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("raw_materials")!,
      [row({ material_code: "TEST-MAT-003", material_name: "TEST Mystery Ingredient", material_function: "nonionic_surfactant;not_a_real_function" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("materials", expect.arrayContaining([
      expect.objectContaining({ code: "TEST-MAT-003", functions: ["nonionic_surfactant"] }),
    ]));
  });

  it("FVL-04.001 M4: missing optional concentration-range fields stay missing, never defaulted to zero", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("raw_materials")!,
      [row({ material_code: "TEST-MAT-004", material_name: "TEST No Range Data" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("materials", expect.arrayContaining([
      expect.objectContaining({
        code: "TEST-MAT-004",
        recommendedMinPercent: undefined,
        recommendedMaxPercent: undefined,
        technicalMaxPercent: undefined,
        functions: [],
      }),
    ]));
  });

  it("creates a supplier", async () => {
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("suppliers")!, [row({ supplier_code: "TEST-SUP-001", supplier_name: "TEST Supplier" })], ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("suppliers", expect.arrayContaining([expect.objectContaining({ code: "TEST-SUP-001" })]));
  });

  it("creates a material-supplier price record", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("material_prices")!,
      [row({ material_code: "TEST-MAT-001", supplier_code: "TEST-SUP-001", unit_price: "10", currency: "KES", valid_from: "2026-01-01" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("material_prices", expect.arrayContaining([expect.objectContaining({ materialCode: "TEST-MAT-001" })]));
  });

  it("FVL-04.002 S2/S6/S7: the material-supplier link (supplier_material_code, preferred) commits with real codes, reconstructing the full FVL-03 provenance chain", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("material_prices")!,
      [row({
        material_code: "TEST-MAT-001", supplier_code: "TEST-SUP-001", supplier_material_code: "SUP-OWN-CODE-77",
        unit_price: "10", currency: "KES", valid_from: "2026-01-01", preferred: "true",
      })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("material_prices", expect.arrayContaining([
      expect.objectContaining({
        materialCode: "TEST-MAT-001",
        supplierCode: "TEST-SUP-001",
        // FVL-03's own Cost/Substitution paths resolve the supplier via
        // MaterialPrice.supplierCode (a real code, confirmed by audit —
        // never a display-name join) — reconstructible here without
        // parsing any free text.
        notes: expect.stringContaining("supplier_material_code: SUP-OWN-CODE-77"),
      }),
    ]));
    // "preferred" is folded into the same real-code-scoped record's own
    // notes (this template has no dedicated boolean field for it on
    // MaterialPrice — confirmed by schema read) rather than silently
    // dropped.
    const call = bridge.upsertRecords.mock.calls.find(([c]) => c === "material_prices");
    expect(call?.[1][0].notes).toContain("preferred");
  });

  it("FVL-04.002 S3: a same-display-name supplier with a different code never silently matches — identity is the code, never the name", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("suppliers")!,
      [row({ supplier_code: "TEST-SUP-002", supplier_name: "TEST Supplier" }, { naturalKey: "TEST-SUP-002" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    // A second supplier sharing the exact same display name as
    // TEST-SUP-001 (from the prior test) is a genuinely distinct record —
    // upsertRecords was called with the real, distinct code, never
    // resolved/merged against the other supplier by name.
    expect(bridge.upsertRecords).toHaveBeenCalledWith("suppliers", expect.arrayContaining([expect.objectContaining({ code: "TEST-SUP-002", displayName: "TEST Supplier" })]));
  });
});

describe("commitDataExchangeRows — FVL-04.003/.004: TDS and SDS reuse the existing material_documents path, never a second document registry", () => {
  it("T1/T2/T3/T4: a TDS row enters the existing lifecycle, links to the exact canonical materialCode, and preserves the original filename as metadata", async () => {
    const rows = [row({
      material_code: "TEST-MAT-001", supplier_code: "TEST-SUP-001", document_type: "TDS", document_number: "TDS-77",
      document_title: "TEST Technical Data Sheet", revision: "2", issuer: "TEST Chemicals Ltd", issue_date: "2026-01-01",
      file_name: "test-tds-dg50-v2.pdf", expected_sha256: "abc123",
    })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("material_documents")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("material_documents", expect.arrayContaining([
      expect.objectContaining({
        materialCode: "TEST-MAT-001",
        documentType: "TDS",
        fileName: "test-tds-dg50-v2.pdf",
        expectedSha256: "abc123",
        // Never verified by import alone, regardless of what the file said.
        verificationStatus: "unverified",
      }),
    ]));
  });

  it("D1/D2/D3/D4: an SDS row enters the same existing lifecycle, links to the exact canonical materialCode, and preserves source/filename metadata", async () => {
    const rows = [row({
      material_code: "TEST-MAT-001", supplier_code: "TEST-SUP-001", document_type: "SDS", document_number: "SDS-77",
      document_title: "TEST Safety Data Sheet", revision: "1", issuer: "TEST Chemicals Ltd",
      file_name: "test-sds-dg50-v1.pdf",
    })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("material_documents")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("material_documents", expect.arrayContaining([
      expect.objectContaining({ materialCode: "TEST-MAT-001", documentType: "SDS", fileName: "test-sds-dg50-v1.pdf", supplierCode: "TEST-SUP-001" }),
    ]));
  });

  it("T5/D-optional: missing optional TDS/SDS metadata (revision, issue_date, expected_sha256) stays undefined, never fabricated", async () => {
    const rows = [row({ material_code: "TEST-MAT-001", document_type: "SDS", document_title: "TEST minimal SDS" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("material_documents")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("material_documents", expect.arrayContaining([
      expect.objectContaining({ revision: undefined, issueDate: undefined, expectedSha256: undefined, fileName: undefined, supplierCode: undefined }),
    ]));
  });

  it("D6/D7: SDS import never creates a Safety or Regulatory verdict — the commit writes only document metadata, no finding/verdict shape at all", async () => {
    const rows = [row({ material_code: "TEST-MAT-001", document_type: "SDS", document_title: "TEST SDS" })];
    await commitDataExchangeRows(getDataExchangeTemplate("material_documents")!, rows, ctx);
    const [, written] = bridge.upsertRecords.mock.calls.find(([c]) => c === "material_documents")!;
    const record = written[0];
    expect(record).not.toHaveProperty("severity");
    expect(record).not.toHaveProperty("formulaState");
    expect(record).not.toHaveProperty("status");
    expect(Object.keys(record).sort()).toEqual([
      "code", "createdAt", "documentNumber", "documentTitle", "documentType", "expectedSha256", "expiryDate",
      "fileName", "issueDate", "issuer", "language", "materialCode", "notes", "revision", "schemaVersion",
      "supplierCode", "tags", "updatedAt", "verificationStatus",
    ].sort());
  });

  it("T7/D8: TDS and SDS commit through the exact same material_documents collection — no separate document registry per document type", async () => {
    await commitDataExchangeRows(getDataExchangeTemplate("material_documents")!, [row({ material_code: "TEST-MAT-001", document_type: "TDS", document_title: "T" })], ctx);
    await commitDataExchangeRows(getDataExchangeTemplate("material_documents")!, [row({ material_code: "TEST-MAT-001", document_type: "SDS", document_title: "S" })], ctx);
    const targets = bridge.upsertRecords.mock.calls.map(([c]) => c);
    expect(new Set(targets)).toEqual(new Set(["material_documents"]));
  });
});

describe("commitDataExchangeRows — master/formulation templates without their own describe block", () => {
  it("material_documents: creates then updates the same (material, document_type, document_number) record", async () => {
    const rows = [row({ material_code: "TEST-MAT-001", document_type: "coa", document_number: "DOC-1", document_title: "TEST CoA" })];
    const created = await commitDataExchangeRows(getDataExchangeTemplate("material_documents")!, rows, ctx);
    expect(created[0].outcome).toBe("created");
    const naturalCode = "TEST-MAT-001-coa-DOC-1";
    bridge.listRecords.mockResolvedValue([{ code: naturalCode, createdAt: "2026-01-01T00:00:00.000Z" }]);
    const updated = await commitDataExchangeRows(getDataExchangeTemplate("material_documents")!, rows, ctx);
    expect(updated[0].outcome).toBe("updated");
    expect(bridge.upsertRecords).toHaveBeenLastCalledWith("material_documents", expect.arrayContaining([expect.objectContaining({ code: naturalCode })]));
  });

  it("product_families: creates then updates the same family_code", async () => {
    const rows = [row({ family_code: "TEST-FAM-001", family_name: "TEST Family" })];
    const created = await commitDataExchangeRows(getDataExchangeTemplate("product_families")!, rows, ctx);
    expect(created[0].outcome).toBe("created");
    bridge.listRecords.mockResolvedValue([{ code: "TEST-FAM-001", createdAt: "2026-01-01T00:00:00.000Z" }]);
    const updated = await commitDataExchangeRows(getDataExchangeTemplate("product_families")!, rows, ctx);
    expect(updated[0].outcome).toBe("updated");
  });

  it("finished_products: creates then updates the same sku_code", async () => {
    const rows = [row({ sku_code: "TEST-SKU-001", sku_name: "TEST SKU" })];
    const created = await commitDataExchangeRows(getDataExchangeTemplate("finished_products")!, rows, ctx);
    expect(created[0].outcome).toBe("created");
    bridge.listRecords.mockResolvedValue([{ code: "TEST-SKU-001", createdAt: "2026-01-01T00:00:00.000Z" }]);
    const updated = await commitDataExchangeRows(getDataExchangeTemplate("finished_products")!, rows, ctx);
    expect(updated[0].outcome).toBe("updated");
  });

  it("packaging_bom: a second line for the same SKU is added alongside the first, not overwriting it", async () => {
    const rows1 = [row({ packaging_sku_code: "TEST-PKGBOM-001", component_code: "TEST-PKG-001", component_quantity: "1" })];
    const created = await commitDataExchangeRows(getDataExchangeTemplate("packaging_bom")!, rows1, ctx);
    expect(created[0].outcome).toBe("created");
    const savedFirst = bridge.upsertRecords.mock.calls[0][1][0] as { code: string; lines: unknown[] };
    bridge.listRecords.mockResolvedValue([{ code: savedFirst.code, skuCode: "TEST-PKGBOM-001", lines: savedFirst.lines }]);
    const rows2 = [row({ packaging_sku_code: "TEST-PKGBOM-001", component_code: "TEST-PKG-002", component_quantity: "2" })];
    const updated = await commitDataExchangeRows(getDataExchangeTemplate("packaging_bom")!, rows2, ctx);
    expect(updated[0].outcome).toBe("updated");
    const savedSecond = bridge.upsertRecords.mock.calls[1][1][0] as { lines: { componentCode: string }[] };
    expect(savedSecond.lines.map((l) => l.componentCode)).toEqual(expect.arrayContaining(["TEST-PKG-001", "TEST-PKG-002"]));
  });

  it("packaging_bom: persists product_family_code and tags as real structured fields", async () => {
    const rows = [row({ packaging_sku_code: "TEST-PKGBOM-002", component_code: "TEST-PKG-001", component_quantity: "1", product_family_code: "TEST-FAM-001", tags: "bottle-pack;hero" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("packaging_bom")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("packaging_boms", expect.arrayContaining([expect.objectContaining({ productFamilyCode: "TEST-FAM-001", tags: ["bottle-pack", "hero"] })]));
  });

  it("process_parameters: creates then updates the same (formula, version, step)", async () => {
    const rows = [row({ formula_code: "TEST-FORM-001", formula_version: "1", step_number: "1", step_name: "Heat" })];
    const created = await commitDataExchangeRows(getDataExchangeTemplate("process_parameters")!, rows, ctx);
    expect(created[0].outcome).toBe("created");
    bridge.listRecords.mockResolvedValue([{ code: "TEST-FORM-001-v1-step1", createdAt: "2026-01-01T00:00:00.000Z" }]);
    const updated = await commitDataExchangeRows(getDataExchangeTemplate("process_parameters")!, rows, ctx);
    expect(updated[0].outcome).toBe("updated");
  });

  it("formula_cost_overrides: always appends a new history row, by design, never updates in place", async () => {
    const rows = [row({ formula_code: "TEST-FORM-001", formula_version: "1", material_code: "TEST-MAT-001", override_price: "480.00", currency: "KES", effective_from: "2026-01-01" })];
    const first = await commitDataExchangeRows(getDataExchangeTemplate("formula_cost_overrides")!, rows, ctx);
    expect(first[0].outcome).toBe("created");
    const second = await commitDataExchangeRows(getDataExchangeTemplate("formula_cost_overrides")!, rows, ctx);
    expect(second[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledTimes(2);
    const firstCode = (bridge.upsertRecords.mock.calls[0][1][0] as { code: string }).code;
    const secondCode = (bridge.upsertRecords.mock.calls[1][1][0] as { code: string }).code;
    expect(firstCode).not.toBe(secondCode);
  });
});

describe("commitDataExchangeRows — Costing Assumptions (structured fields, not notes)", () => {
  it("stores freight/duty/tax/target-margin as real structured fields on the factory profile", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("costing_assumptions")!,
      [row({ costing_profile_code: "TEST-COST-001", currency: "KES", effective_date: "2026-01-01", freight_percent: "3", duty_percent: "0", tax_percent: "16", target_margin_percent: "30" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "factory_profiles",
      expect.arrayContaining([
        expect.objectContaining({
          code: "TEST-COST-001",
          freightPercent: "3",
          dutyPercent: "0",
          taxPercent: "16",
          targetMarginPercent: "30",
        }),
      ]),
    );
    // Never folded into notes text — the structured fields are the real
    // record of these values now, not a spreadsheet-in-a-string.
    const saved = bridge.upsertRecords.mock.calls[0][1][0] as { notes?: string };
    expect(saved.notes ?? "").not.toMatch(/freight_percent/);
  });
});

describe("commitDataExchangeRows — formula/BOM (grouped)", () => {
  it("groups multiple lines into one saved version", async () => {
    const rows = [
      row({ formula_code: "TEST-FORM-001", formula_name: "TEST Formula", material_code: "TEST-MAT-001", percentage: "60", phase: "A", line_number: "1" }, { rowNumber: 2, naturalKey: "TEST-FORM-001::1" }),
      row({ formula_code: "TEST-FORM-001", formula_name: "TEST Formula", material_code: "TEST-MAT-002", percentage: "40", phase: "A", line_number: "2" }, { rowNumber: 3, naturalKey: "TEST-FORM-001::2" }),
    ];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("formula_bom")!, rows, ctx);
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.outcome === "created")).toBe(true);
    expect(formulationsBridge.saveFormulationVersion).toHaveBeenCalledTimes(1);
    const saved = formulationsBridge.saveFormulationVersion.mock.calls[0][0] as { lines: unknown[] };
    expect(saved.lines).toHaveLength(2);
  });

  it("refuses to overwrite an existing, immutable formula version", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([{ id: "formulation-1", code: "TEST-FORM-001" }]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [{ id: "version-1", versionNumber: 1 }] });
    const rows = [row({ formula_code: "TEST-FORM-001", material_code: "TEST-MAT-001", percentage: "100", phase: "A", line_number: "1", formula_version: "1" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("formula_bom")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/already exists and is immutable/);
    expect(formulationsBridge.saveFormulationVersion).not.toHaveBeenCalled();
  });
});

describe("commitDataExchangeRows — lab results (grouped, reference resolution)", () => {
  it("fails honestly when the referenced trial does not exist", async () => {
    const rows = [row({ trial_code: "TEST-TRIAL-001", sample_code: "S1", test_code: "TEST-T-001", replicate_number: "1", numeric_value: "5.0" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("lab_results")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No laboratory trial/);
  });

  it("fails honestly when the referenced test definition does not exist", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "laboratory_trials" ? [{ id: "trial-1", code: "TEST-TRIAL-001" }] : []));
    const rows = [row({ trial_code: "TEST-TRIAL-001", sample_code: "S1", test_code: "TEST-T-001", replicate_number: "1", numeric_value: "5.0" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("lab_results")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No test definition/);
  });

  it("groups replicate rows into one saved result once trial and test definition resolve", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "laboratory_trials") return Promise.resolve([{ id: "trial-1", code: "TEST-TRIAL-001" }]);
      // Real `test_definitions` records carry no separate `id` field — their
      // `code` is their identity (see `TrialsPanel.tsx`'s
      // `testDefinitionId: definition.code`). No `id` here on purpose, to
      // catch a regression back to `testDef.id` (which would be `undefined`).
      if (collection === "test_definitions") return Promise.resolve([{ code: "TEST-T-001", resultType: "numeric" }]);
      return Promise.resolve([]);
    });
    const rows = [
      row({ trial_code: "TEST-TRIAL-001", sample_code: "S1", test_code: "TEST-T-001", replicate_number: "1", numeric_value: "5.0" }, { rowNumber: 2, naturalKey: "TEST-TRIAL-001::S1::TEST-T-001" }),
      row({ trial_code: "TEST-TRIAL-001", sample_code: "S1", test_code: "TEST-T-001", replicate_number: "2", numeric_value: "5.2" }, { rowNumber: 3, naturalKey: "TEST-TRIAL-001::S1::TEST-T-001" }),
    ];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("lab_results")!, rows, ctx);
    expect(outcomes.every((o) => o.outcome === "created")).toBe(true);
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "test_results",
      expect.arrayContaining([expect.objectContaining({ trialId: "trial-1", testDefinitionId: "TEST-T-001", replicates: expect.arrayContaining([expect.objectContaining({ replicateNumber: 1 }), expect.objectContaining({ replicateNumber: 2 })]) })]),
    );
  });
});

describe("commitDataExchangeRows — regulatory rules", () => {
  it("rejects an unrecognized rule_type rather than silently mis-filing it", async () => {
    const rows = [row({ rule_code: "TEST-RULE-001", jurisdiction: "KE", requirement: "Must state X.", rule_type: "not_a_real_type" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("regulatory_rules")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/not a recognized rule_type/);
  });

  it("creates a rule with a valid rule_type, always unverified", async () => {
    const rows = [row({ rule_code: "TEST-RULE-001", jurisdiction: "KE", requirement: "Must state X.", rule_type: "label_requirement" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("regulatory_rules")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_rules", expect.arrayContaining([expect.objectContaining({ verificationStatus: "not_verified" })]));
  });
});

describe("commitDataExchangeRows — dossier evidence", () => {
  const dossier = { id: "dossier-1", dossierCode: "TEST-DOS-001", formulationId: "formulation-1", formulaVersionId: "version-1" };
  const requirement = { id: "req-1", dossierId: "dossier-1", requirementCode: "TEST-REQ-001" };

  it("fails honestly when the referenced dossier does not exist", async () => {
    const rows = [row({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-001", title: "TEST Evidence" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_evidence")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No dossier/);
  });

  it("fails honestly when the referenced requirement does not exist on that dossier", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "regulatory_dossiers" ? [dossier] : []));
    const rows = [row({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-999", evidence_code: "TEST-EVID-001", title: "TEST Evidence" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_evidence")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No requirement/);
  });

  it("inherits formulationId/formulaVersionId from the resolved dossier, never draft-approved, and proposes (never accepts) the requirement link", async () => {
    bridge.listRecords.mockImplementation((collection: string) =>
      Promise.resolve(collection === "regulatory_dossiers" ? [dossier] : collection === "regulatory_dossier_requirements" ? [requirement] : []),
    );
    const rows = [row({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-001", title: "TEST Evidence" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_evidence")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "regulatory_evidence_items",
      expect.arrayContaining([expect.objectContaining({ evidenceCode: "TEST-EVID-001", formulationId: "formulation-1", formulaVersionId: "version-1", status: "draft" })]),
    );
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "regulatory_requirement_evidence_links",
      expect.arrayContaining([expect.objectContaining({ dossierId: "dossier-1", requirementId: "req-1", linkStatus: "proposed", linkedBy: "data-exchange-import" })]),
    );
  });

  it("re-importing the same evidence_code updates the existing evidence item instead of creating a duplicate, and does not propose a second link", async () => {
    const existingEvidence = { id: "evid-1", dossierId: "dossier-1", evidenceCode: "TEST-EVID-001", createdBy: "data-exchange-import", createdAt: "2026-01-01T00:00:00.000Z", attachmentIds: [] };
    const existingLink = { id: "link-1", dossierId: "dossier-1", requirementId: "req-1", evidenceItemId: "evid-1", linkStatus: "proposed" };
    bridge.listRecords.mockImplementation((collection: string) =>
      Promise.resolve(
        collection === "regulatory_dossiers"
          ? [dossier]
          : collection === "regulatory_dossier_requirements"
            ? [requirement]
            : collection === "regulatory_evidence_items"
              ? [existingEvidence]
              : collection === "regulatory_requirement_evidence_links"
                ? [existingLink]
                : [],
      ),
    );
    const rows = [row({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-001", title: "TEST Evidence Updated" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_evidence")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("updated");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_evidence_items", expect.arrayContaining([expect.objectContaining({ id: "evid-1", evidenceCode: "TEST-EVID-001" })]));
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("regulatory_requirement_evidence_links", expect.anything());
  });
});

describe("commitDataExchangeRows — Phase 8 dossier expansion: dossier headers", () => {
  it("fails honestly when the dossier_code already exists", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "regulatory_dossiers" ? [{ id: "dossier-1", dossierCode: "TEST-DOS-100" }] : []));
    const rows = [row({ dossier_code: "TEST-DOS-100", title: "TEST Dossier", formula_code: "TEST-FORM-001", jurisdictions: "KE" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_headers")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/already exists/);
  });

  it("fails honestly and never auto-creates a formula when the named formula does not exist", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([]);
    const rows = [row({ dossier_code: "TEST-DOS-100", title: "TEST Dossier", formula_code: "TEST-FORM-999", jurisdictions: "KE" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_headers")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No formula/);
    expect(formulationsBridge.saveFormulation).not.toHaveBeenCalled();
  });

  it("fails honestly when the formula has no saved version", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([{ id: "formulation-1", code: "TEST-FORM-001", productFamilyCode: "TEST-FAM" }]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [] });
    const rows = [row({ dossier_code: "TEST-DOS-100", title: "TEST Dossier", formula_code: "TEST-FORM-001", jurisdictions: "KE" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_headers")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/no saved version/);
  });

  it("creates a dossier always as draft/revision 1, regardless of any status the file might have implied", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([{ id: "formulation-1", code: "TEST-FORM-001", productFamilyCode: "TEST-FAM" }]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [{ id: "version-1", versionNumber: 1 }, { id: "version-2", versionNumber: 2 }] });
    const rows = [row({ dossier_code: "TEST-DOS-100", title: "TEST Dossier", formula_code: "TEST-FORM-001", jurisdictions: "KE" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_headers")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "regulatory_dossiers",
      expect.arrayContaining([expect.objectContaining({ dossierCode: "TEST-DOS-100", status: "draft", revision: 1, formulaVersionId: "version-2" })]),
    );
    const [, records] = bridge.upsertRecords.mock.calls.find((c: unknown[]) => c[0] === "regulatory_dossiers")!;
    const created = (records as Record<string, unknown>[])[0];
    expect(created.submittedBy).toBeUndefined();
    expect(created.approvedBy).toBeUndefined();
    expect(created.supersedesDossierId).toBeUndefined();
  });

  it("binds to the exact requested formula_version rather than always the latest", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([{ id: "formulation-1", code: "TEST-FORM-001", productFamilyCode: "TEST-FAM" }]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [{ id: "version-1", versionNumber: 1 }, { id: "version-2", versionNumber: 2 }] });
    const rows = [row({ dossier_code: "TEST-DOS-100", title: "TEST Dossier", formula_code: "TEST-FORM-001", formula_version: "1", jurisdictions: "KE" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_headers")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("regulatory_dossiers", expect.arrayContaining([expect.objectContaining({ formulaVersionId: "version-1" })]));
  });
});

describe("commitDataExchangeRows — Phase 8 dossier expansion: submissions", () => {
  const dossier = { id: "dossier-1", dossierCode: "TEST-DOS-001", revision: 1 };

  it("fails honestly when the referenced dossier does not exist", async () => {
    const rows = [row({ dossier_code: "TEST-DOS-001", jurisdiction: "KE", submitted_by: "TEST User", submitted_at: "2026-01-15T00:00:00.000Z" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_submissions")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No dossier/);
  });

  it("always records status as prepared, never an authority's response", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "regulatory_dossiers" ? [dossier] : []));
    const rows = [row({ dossier_code: "TEST-DOS-001", jurisdiction: "KE", submitted_by: "TEST User", submitted_at: "2026-01-15T00:00:00.000Z" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_submissions")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "regulatory_dossier_submissions",
      expect.arrayContaining([expect.objectContaining({ dossierId: "dossier-1", jurisdiction: "KE", status: "prepared" })]),
    );
    const [, records] = bridge.upsertRecords.mock.calls.find((c: unknown[]) => c[0] === "regulatory_dossier_submissions")!;
    expect((records as Record<string, unknown>[])[0]).not.toHaveProperty("responseStatus");
  });
});

describe("commitDataExchangeRows — Phase 8 dossier expansion: evidence links", () => {
  const dossier = { id: "dossier-1", dossierCode: "TEST-DOS-001" };
  const requirement = { id: "req-1", dossierId: "dossier-1", requirementCode: "TEST-REQ-001" };
  const evidence = { id: "evid-1", dossierId: "dossier-1", evidenceCode: "TEST-EVID-001" };

  it("fails honestly when the referenced dossier does not exist", async () => {
    const rows = [row({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-001" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_evidence_links")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No dossier/);
  });

  it("fails honestly when the referenced requirement does not exist on that dossier", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "regulatory_dossiers" ? [dossier] : []));
    const rows = [row({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-999", evidence_code: "TEST-EVID-001" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_evidence_links")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No requirement/);
  });

  it("fails honestly when the referenced evidence does not exist on that dossier", async () => {
    bridge.listRecords.mockImplementation((collection: string) =>
      Promise.resolve(collection === "regulatory_dossiers" ? [dossier] : collection === "regulatory_dossier_requirements" ? [requirement] : []),
    );
    const rows = [row({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-999" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_evidence_links")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No evidence/);
  });

  it("always creates the link as proposed, never accepted/rejected/revoked", async () => {
    bridge.listRecords.mockImplementation((collection: string) =>
      Promise.resolve(
        collection === "regulatory_dossiers" ? [dossier] : collection === "regulatory_dossier_requirements" ? [requirement] : collection === "regulatory_evidence_items" ? [evidence] : [],
      ),
    );
    const rows = [row({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-001", link_status: "accepted" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_evidence_links")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "regulatory_requirement_evidence_links",
      expect.arrayContaining([expect.objectContaining({ dossierId: "dossier-1", requirementId: "req-1", evidenceItemId: "evid-1", linkStatus: "proposed" })]),
    );
  });
});

describe("commitDataExchangeRows — Phase 8 dossier expansion: review revocations", () => {
  const dossier = { id: "dossier-1", dossierCode: "TEST-DOS-001" };
  const review = { id: "review-1", dossierId: "dossier-1", dossierRevision: 1, reviewedAt: "2026-01-10T00:00:00.000Z" };

  it("fails honestly when the referenced dossier does not exist", async () => {
    const rows = [row({ dossier_code: "TEST-DOS-001", dossier_revision: "1", reviewed_at: "2026-01-10T00:00:00.000Z", revoked_by: "TEST Admin", reason: "TEST reason" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_review_revocations")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No dossier/);
  });

  it("fails honestly when no matching review exists — a revocation must reference a real, existing review", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "regulatory_dossiers" ? [dossier] : []));
    const rows = [row({ dossier_code: "TEST-DOS-001", dossier_revision: "1", reviewed_at: "2026-01-10T00:00:00.000Z", revoked_by: "TEST Admin", reason: "TEST reason" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_review_revocations")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No review found/);
  });

  it("creates a revocation referencing the resolved review's real id", async () => {
    bridge.listRecords.mockImplementation((collection: string) =>
      Promise.resolve(collection === "regulatory_dossiers" ? [dossier] : collection === "regulatory_dossier_reviews" ? [review] : []),
    );
    const rows = [row({ dossier_code: "TEST-DOS-001", dossier_revision: "1", reviewed_at: "2026-01-10T00:00:00.000Z", revoked_by: "TEST Admin", reason: "TEST reason" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("dossier_review_revocations")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "regulatory_dossier_review_revocations",
      expect.arrayContaining([expect.objectContaining({ revokesReviewId: "review-1", revokedBy: "TEST Admin", reason: "TEST reason" })]),
    );
  });
});

describe("commitDataExchangeRows — Phase 8 dossier expansion: unsafe-to-import templates stay honestly unsupported", () => {
  it("has no wired commit handler for dossier_reviews or dossier_manual_requirement_actions", () => {
    expect(isTemplateCommitSupported("dossier_reviews")).toBe(false);
    expect(isTemplateCommitSupported("dossier_manual_requirement_actions")).toBe(false);
  });
});

describe("Phase 8 dossier expansion — export -> import round trip", () => {
  /** A tiny in-memory store so a committed row is genuinely readable back
   *  out through the real export loader, not just re-asserted against the
   *  same mock call. */
  function stubStore() {
    const store: Record<string, Record<string, unknown>[]> = {};
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(store[collection] ?? []));
    bridge.upsertRecords.mockImplementation((collection: string, records: Record<string, unknown>[]) => {
      store[collection] = [...(store[collection] ?? []), ...records];
      return Promise.resolve({ inserted: records.length, updated: 0, total: records.length });
    });
    return store;
  }

  it("dossier_headers: importing the template's own example row round-trips through the export loader with the same natural key", async () => {
    stubStore();
    formulationsBridge.listFormulations.mockResolvedValue([{ id: "formulation-1", code: "TEST-FORM-001", productFamilyCode: "TEST-FAM-001" }]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [{ id: "version-1", versionNumber: 1 }] });
    const template = getDataExchangeTemplate("dossier_headers")!;
    const exampleRow = template.exampleRows[0]!;
    const commitOutcomes = await commitDataExchangeRows(template, [row(exampleRow)], ctx);
    expect(commitOutcomes[0]!.outcome).toBe("created");

    const { naturalKeys, rows } = await loadExisting("dossier_headers");
    expect(naturalKeys.has(exampleRow.dossier_code)).toBe(true);
    expect(rows[0]).toMatchObject({ dossier_code: exampleRow.dossier_code, formula_code: "TEST-FORM-001", formula_version: "1" });
  });

  it("dossier_submissions: importing the template's own example row round-trips through the export loader with the same natural key", async () => {
    const store = stubStore();
    store.regulatory_dossiers = [{ id: "dossier-1", dossierCode: "TEST-DOS-001", revision: 1 }];
    const template = getDataExchangeTemplate("dossier_submissions")!;
    const exampleRow: Record<string, string> = { ...template.exampleRows[0]!, dossier_code: "TEST-DOS-001" };
    const commitOutcomes = await commitDataExchangeRows(template, [row(exampleRow)], ctx);
    expect(commitOutcomes[0]!.outcome).toBe("created");

    const { naturalKeys, rows } = await loadExisting("dossier_submissions");
    expect(naturalKeys.has(`TEST-DOS-001::1::${exampleRow.jurisdiction}::${exampleRow.submitted_at}`)).toBe(true);
    expect(rows[0]).toMatchObject({ dossier_code: "TEST-DOS-001", status: "prepared" });
  });

  it("dossier_evidence_links: importing the template's own example row round-trips through the export loader with the same natural key", async () => {
    const store = stubStore();
    store.regulatory_dossiers = [{ id: "dossier-1", dossierCode: "TEST-DOS-001" }];
    store.regulatory_dossier_requirements = [{ id: "req-1", dossierId: "dossier-1", requirementCode: "TEST-REQ-001" }];
    store.regulatory_evidence_items = [{ id: "evid-1", dossierId: "dossier-1", evidenceCode: "TEST-EVID-001" }];
    const template = getDataExchangeTemplate("dossier_evidence_links")!;
    const exampleRow: Record<string, string> = { ...template.exampleRows[0]!, dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-001" };
    const commitOutcomes = await commitDataExchangeRows(template, [row(exampleRow)], ctx);
    expect(commitOutcomes[0]!.outcome).toBe("created");

    const { naturalKeys, rows } = await loadExisting("dossier_evidence_links");
    expect(naturalKeys.has(`TEST-DOS-001::TEST-REQ-001::TEST-EVID-001::${exampleRow.linked_at}`)).toBe(true);
    expect(rows[0]).toMatchObject({ link_status: "proposed" });
  });

  it("dossier_review_revocations: importing the template's own example row round-trips through the export loader with the same natural key", async () => {
    const store = stubStore();
    store.regulatory_dossiers = [{ id: "dossier-1", dossierCode: "TEST-DOS-001" }];
    store.regulatory_dossier_reviews = [{ id: "review-1", dossierId: "dossier-1", dossierRevision: 1, reviewedAt: "2026-01-10T00:00:00.000Z" }];
    const template = getDataExchangeTemplate("dossier_review_revocations")!;
    const exampleRow: Record<string, string> = { ...template.exampleRows[0]!, dossier_code: "TEST-DOS-001", dossier_revision: "1", reviewed_at: "2026-01-10T00:00:00.000Z" };
    const commitOutcomes = await commitDataExchangeRows(template, [row(exampleRow)], ctx);
    expect(commitOutcomes[0]!.outcome).toBe("created");

    const { naturalKeys, rows } = await loadExisting("dossier_review_revocations");
    expect(naturalKeys.has("TEST-DOS-001::1::2026-01-10T00:00:00.000Z")).toBe(true);
    expect(rows[0]).toMatchObject({ dossier_code: "TEST-DOS-001", revoked_by: exampleRow.revoked_by });
  });
});

describe("commitDataExchangeRows — product claims", () => {
  it("fails honestly when the referenced project does not exist", async () => {
    const rows = [row({ project_code: "TEST-FORM-001", claim_code: "TEST-CLM-001", claim_text: "Softens skin." })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("product_claims")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No project\/formulation/);
  });

  it("falls back claim_category to \"other\" instead of throwing on an invalid category, and always starts as draft", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([{ id: "formulation-1", code: "TEST-FORM-001" }]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [{ id: "version-1", versionNumber: 1 }] });
    const rows = [row({ project_code: "TEST-FORM-001", claim_code: "TEST-CLM-001", claim_text: "Softens skin.", claim_category: "not_a_real_category" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("product_claims")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("product_claims", expect.arrayContaining([expect.objectContaining({ claimCategory: "other", status: "draft" })]));
  });
});

describe("commitDataExchangeRows — label content", () => {
  it("fails honestly when the referenced label does not exist", async () => {
    const rows = [row({ label_code: "TEST-LBL-001", label_revision: "1", content_text: "Net 100 mL", language: "en" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("label_content")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No label/);
  });

  it("creates a draft content block once the label resolves, persisting panel as a real field", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "product_labels" ? [{ id: "label-1", labelCode: "TEST-LBL-001" }] : []));
    const rows = [row({ label_code: "TEST-LBL-001", label_revision: "1", panel: "front", content_text: "Net 100 mL", language: "en" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("label_content")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("label_content_blocks", expect.arrayContaining([expect.objectContaining({ labelId: "label-1", panel: "front", status: "draft", source: "imported" })]));
  });
});

describe("commitDataExchangeRows — DOE factors/responses and observations", () => {
  it("fails honestly when the referenced study does not exist (factors/responses)", async () => {
    const rows = [row({ study_code: "TEST-STUDY-001", record_type: "factor", factor_or_response_code: "TEST-F-001", name: "Temperature", factor_type: "continuous" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("doe_factors_responses")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No DOE study/);
  });

  it("dispatches record_type=factor and record_type=response to distinct collections", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "doe_studies" ? [{ id: "study-1", studyCode: "TEST-STUDY-001", revision: 1 }] : []));
    const factorOutcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("doe_factors_responses")!,
      [row({ study_code: "TEST-STUDY-001", record_type: "factor", factor_or_response_code: "TEST-F-001", name: "Temperature", factor_type: "continuous" })],
      ctx,
    );
    expect(factorOutcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("doe_factors", expect.arrayContaining([expect.objectContaining({ factorCode: "TEST-F-001", studyRevision: 1 })]));

    const responseOutcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("doe_factors_responses")!,
      [row({ study_code: "TEST-STUDY-001", record_type: "response", factor_or_response_code: "TEST-R-001", name: "Viscosity", objective: "maximize" })],
      ctx,
    );
    expect(responseOutcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("doe_responses", expect.arrayContaining([expect.objectContaining({ responseCode: "TEST-R-001" })]));
  });

  it("resolves study/run/response for an observation and stamps studyRevision", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "doe_studies") return Promise.resolve([{ id: "study-1", studyCode: "TEST-STUDY-001", revision: 2 }]);
      if (collection === "doe_runs") return Promise.resolve([{ id: "run-1", studyId: "study-1", runNumber: 1 }]);
      if (collection === "doe_responses") return Promise.resolve([{ id: "response-1", studyId: "study-1", responseCode: "TEST-R-001" }]);
      return Promise.resolve([]);
    });
    const rows = [row({ study_code: "TEST-STUDY-001", run_number: "1", response_code: "TEST-R-001", numeric_value: "42" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("doe_observations")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "doe_observations",
      expect.arrayContaining([expect.objectContaining({ runId: "run-1", responseId: "response-1", studyRevision: 2, status: "recorded" })]),
    );
  });

  it("fails honestly when the run does not exist for an observation", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "doe_studies" ? [{ id: "study-1", studyCode: "TEST-STUDY-001", revision: 1 }] : []));
    const rows = [row({ study_code: "TEST-STUDY-001", run_number: "1", response_code: "TEST-R-001", numeric_value: "42" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("doe_observations")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/does not exist for study/);
  });
});

describe("commitDataExchangeRows — Stability Protocols (grouped, attaches to an existing editable study)", () => {
  it("fails honestly when the referenced study does not exist", async () => {
    const rows = [row({ protocol_code: "TEST-PROT-001", condition_code: "40C", time_point: "3MO", test_code: "TEST-TST-001" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_protocols")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No stability study/);
  });

  it("refuses to attach a protocol to a terminal (immutable) study", async () => {
    bridge.listRecords.mockImplementation((collection: string) =>
      Promise.resolve(collection === "stability_studies" ? [{ id: "study-1", code: "TEST-PROT-001", status: "completed", packagingSkuCode: "TEST-PKGBOM-001", conditionIds: [], timePointIds: [], requiredTestDefinitionIds: [] }] : []),
    );
    const rows = [row({ protocol_code: "TEST-PROT-001", condition_code: "40C", time_point: "3MO", test_code: "TEST-TST-001" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_protocols")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/immutable/);
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized condition or time-point code rather than fabricating one", async () => {
    bridge.listRecords.mockImplementation((collection: string) =>
      Promise.resolve(collection === "stability_studies" ? [{ id: "study-1", code: "TEST-PROT-001", status: "planned", packagingSkuCode: "TEST-PKGBOM-001", conditionIds: [], timePointIds: [], requiredTestDefinitionIds: [] }] : []),
    );
    const rows = [row({ protocol_code: "TEST-PROT-001", condition_code: "999C", time_point: "3MO", test_code: "TEST-TST-001" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_protocols")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/not a recognized storage condition code/);
  });

  it("groups every row for one protocol_code into a single atomic study update", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "stability_studies") return Promise.resolve([{ id: "study-1", code: "TEST-PROT-001", status: "planned", packagingSkuCode: "TEST-PKGBOM-001", conditionIds: [], timePointIds: [], requiredTestDefinitionIds: [] }]);
      // No `id` field on purpose — real `test_definitions` records have
      // none (their `code` is their identity). Regression coverage for a
      // live-verification bug: `requiredTestDefinitionIds.add(testDef.id)`
      // silently wrote `null` (JSON-serialized `undefined`) instead of the
      // code, which made re-importing the same file never converge to
      // "unchanged" — see `commitStabilityProtocols`.
      if (collection === "test_definitions") return Promise.resolve([{ code: "TEST-TST-001" }]);
      return Promise.resolve([]);
    });
    const rows = [
      row({ protocol_code: "TEST-PROT-001", condition_code: "40C", time_point: "3MO", test_code: "TEST-TST-001" }, { rowNumber: 2, naturalKey: "TEST-PROT-001::40C::3MO::TEST-TST-001" }),
      row({ protocol_code: "TEST-PROT-001", condition_code: "25C", time_point: "6MO", test_code: "TEST-TST-001" }, { rowNumber: 3, naturalKey: "TEST-PROT-001::25C::6MO::TEST-TST-001" }),
    ];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_protocols")!, rows, ctx);
    expect(outcomes.every((o) => o.outcome === "updated")).toBe(true);
    expect(bridge.upsertRecords).toHaveBeenCalledTimes(1);
    const saved = bridge.upsertRecords.mock.calls[0][1][0] as { conditionIds: string[]; timePointIds: string[]; requiredTestDefinitionIds: string[] };
    expect(saved.conditionIds).toHaveLength(2);
    expect(saved.timePointIds).toHaveLength(2);
    expect(saved.requiredTestDefinitionIds).toEqual(["TEST-TST-001"]);
  });
});

describe("commitDataExchangeRows — Stability Results (append-only, attaches to a generated sample)", () => {
  it("fails honestly when the referenced study does not exist", async () => {
    const rows = [row({ study_code: "TEST-STAB-001", sample_code: "S1", test_code: "TEST-TST-001", numeric_value: "5.3" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_results")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No stability study/);
  });

  it("fails honestly when the sample has not been generated yet", async () => {
    bridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "stability_studies" ? [{ id: "study-1", code: "TEST-STAB-001" }] : []));
    const rows = [row({ study_code: "TEST-STAB-001", sample_code: "S1", test_code: "TEST-TST-001", numeric_value: "5.3" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_results")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No stability sample/);
  });

  it("leaves a blank future time point missing — writes nothing, never zero", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "stability_studies") return Promise.resolve([{ id: "study-1", code: "TEST-STAB-001" }]);
      // No `id` on `test_definitions` on purpose — real records have none
      // (see the "groups every row for one protocol_code" test above).
      // `sample.testDefinitionIds` holds the code directly.
      if (collection === "stability_samples") return Promise.resolve([{ id: "sample-1", studyId: "study-1", sampleCode: "S1", conditionId: "cond-40c", timePointId: "tp-3mo", testDefinitionIds: ["TEST-TST-001"] }]);
      if (collection === "test_definitions") return Promise.resolve([{ code: "TEST-TST-001", resultType: "numeric" }]);
      return Promise.resolve([]);
    });
    const rows = [row({ study_code: "TEST-STAB-001", sample_code: "S1", test_code: "TEST-TST-001", numeric_value: "", text_value: "" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_results")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("skipped");
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  it("creates a result once study/sample/test all resolve and the test is required for the sample", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "stability_studies") return Promise.resolve([{ id: "study-1", code: "TEST-STAB-001" }]);
      if (collection === "stability_samples") return Promise.resolve([{ id: "sample-1", studyId: "study-1", sampleCode: "S1", conditionId: "cond-40c", timePointId: "tp-3mo", testDefinitionIds: ["TEST-TST-001"] }]);
      if (collection === "test_definitions") return Promise.resolve([{ code: "TEST-TST-001", resultType: "numeric" }]);
      if (collection === "stability_results") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const rows = [row({ study_code: "TEST-STAB-001", sample_code: "S1", test_code: "TEST-TST-001", numeric_value: "5.3" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_results")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    // Regression: `testDefinitionId` must be the real code ("TEST-TST-001"),
    // not `testDef.id` (`undefined` on a real record — a live-verification
    // bug that also broke `sample.testDefinitionIds.includes(...)` above,
    // which would otherwise always report "not required for sample").
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "stability_results",
      expect.arrayContaining([expect.objectContaining({ sampleId: "sample-1", testDefinitionId: "TEST-TST-001", conditionId: "cond-40c", timePointId: "tp-3mo" })]),
    );
  });

  it("rejects a test that the sample's own protocol does not require", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "stability_studies") return Promise.resolve([{ id: "study-1", code: "TEST-STAB-001" }]);
      if (collection === "stability_samples") return Promise.resolve([{ id: "sample-1", studyId: "study-1", sampleCode: "S1", conditionId: "cond-40c", timePointId: "tp-3mo", testDefinitionIds: ["some-other-test"] }]);
      if (collection === "test_definitions") return Promise.resolve([{ code: "TEST-TST-001", resultType: "numeric" }]);
      return Promise.resolve([]);
    });
    const rows = [row({ study_code: "TEST-STAB-001", sample_code: "S1", test_code: "TEST-TST-001", numeric_value: "5.3" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_results")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/is not required for sample/);
  });

  it("creates a new append-only revision — never overwrites — when a prior result already exists for the same sample+test", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "stability_studies") return Promise.resolve([{ id: "study-1", code: "TEST-STAB-001" }]);
      if (collection === "stability_samples") return Promise.resolve([{ id: "sample-1", studyId: "study-1", sampleCode: "S1", conditionId: "cond-40c", timePointId: "tp-3mo", testDefinitionIds: ["TEST-TST-001"] }]);
      if (collection === "test_definitions") return Promise.resolve([{ code: "TEST-TST-001", resultType: "numeric" }]);
      if (collection === "stability_results") return Promise.resolve([{ id: "old-result-1", sampleId: "sample-1", testDefinitionId: "TEST-TST-001", createdAt: "2025-01-01T00:00:00.000Z" }]);
      return Promise.resolve([]);
    });
    const rows = [row({ study_code: "TEST-STAB-001", sample_code: "S1", test_code: "TEST-TST-001", numeric_value: "5.5" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_results")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("updated");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("stability_results", expect.arrayContaining([expect.objectContaining({ revisesResultId: "old-result-1" })]));
    // The prior result's own record is never touched — only a new one is written.
    const written = bridge.upsertRecords.mock.calls[0][1][0] as { id: string };
    expect(written.id).not.toBe("old-result-1");
  });
});

describe("commitDataExchangeRows — Reverse Formulation", () => {
  const study = { id: "study-1", code: "TEST-RFS-001", revision: 0 };
  const product = { id: "product-1", code: "TEST-BMP-001" };
  const declLine = { id: "declline-1", benchmarkProductId: "product-1", declaredOrder: 1 };
  const material = { code: "TEST-MAT-001" };
  const candidate = { id: "candidate-1", candidateCode: "TEST-CAND-001", revision: 0 };

  function byCollection(map: Record<string, unknown[]>) {
    return (collection: string) => Promise.resolve(map[collection] ?? []);
  }

  it("reverse_formulation_studies: creates a study, always starting at status draft", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("reverse_formulation_studies")!,
      [row({ study_code: "TEST-RFS-001", study_name: "TEST Study", project_code: "TEST-PROJ-001", product_family_code: "TEST-FAM-001" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("reverse_formulation_studies", expect.arrayContaining([expect.objectContaining({ code: "TEST-RFS-001", status: "draft" })]));
  });

  it("benchmark_products: creates a benchmark product", async () => {
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("benchmark_products")!, [row({ product_code: "TEST-BMP-001", product_name: "TEST Product" })], ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("benchmark_products", expect.arrayContaining([expect.objectContaining({ code: "TEST-BMP-001" })]));
  });

  it("benchmark_evidence_items: fails honestly when the referenced benchmark product does not exist, and never fabricates one", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("benchmark_evidence_items")!,
      [row({ product_code: "TEST-BMP-001", evidence_type: "label", source_name: "TEST label photo" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No benchmark product/);
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  it("benchmark_evidence_items: creates evidence once the benchmark product resolves", async () => {
    bridge.listRecords.mockImplementation(byCollection({ benchmark_products: [product] }));
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("benchmark_evidence_items")!,
      [row({ product_code: "TEST-BMP-001", evidence_type: "label", source_name: "TEST label photo" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("benchmark_evidence_items", expect.arrayContaining([expect.objectContaining({ benchmarkProductId: "product-1", evidenceType: "label" })]));
  });

  it("ingredient_declaration_lines: fails honestly when the referenced benchmark product does not exist", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("ingredient_declaration_lines")!,
      [row({ product_code: "TEST-BMP-001", declared_order: "1", declared_name: "Aqua" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No benchmark product/);
  });

  it("ingredient_declaration_lines: creates a line that always starts unmapped, never fabricating a mapping", async () => {
    bridge.listRecords.mockImplementation(byCollection({ benchmark_products: [product] }));
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("ingredient_declaration_lines")!,
      [row({ product_code: "TEST-BMP-001", declared_order: "1", declared_name: "Aqua" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "ingredient_declaration_lines",
      expect.arrayContaining([expect.objectContaining({ benchmarkProductId: "product-1", declaredOrder: 1, mappingStatus: "unmapped", mappedMaterialIds: [] })]),
    );
  });

  it("analytical_composition_results: is append-only — every import is a new record, the value preserved as an exact decimal string, always unverified", async () => {
    bridge.listRecords.mockImplementation(byCollection({ benchmark_products: [product] }));
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("analytical_composition_results")!,
      [row({ product_code: "TEST-BMP-001", analysis_type: "elemental", analyte: "Na", value: "1.20", unit: "%" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "analytical_composition_results",
      expect.arrayContaining([expect.objectContaining({ analyte: "Na", value: "1.20", verificationStatus: "unverified" })]),
    );
    // A second import of the same measurement is a second, independent
    // record — never an in-place edit of the first.
    await commitDataExchangeRows(
      getDataExchangeTemplate("analytical_composition_results")!,
      [row({ product_code: "TEST-BMP-001", analysis_type: "elemental", analyte: "Na", value: "1.30", unit: "%" })],
      ctx,
    );
    const firstId = (bridge.upsertRecords.mock.calls[0][1][0] as { id: string }).id;
    const secondId = (bridge.upsertRecords.mock.calls[1][1][0] as { id: string }).id;
    expect(firstId).not.toBe(secondId);
  });

  it("target_product_profiles: creates a target profile", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("target_product_profiles")!,
      [row({ profile_code: "TEST-TPP-001", profile_name: "TEST Profile", product_family_code: "TEST-FAM-001" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("target_product_profiles", expect.arrayContaining([expect.objectContaining({ code: "TEST-TPP-001" })]));
  });

  it("reverse_constraint_sets: fails honestly when the referenced study does not exist", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("reverse_constraint_sets")!,
      [row({ constraint_set_code: "TEST-RCS-001", constraint_set_name: "TEST Constraints", study_code: "TEST-RFS-001" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No Reverse Formulation study/);
  });

  it("reverse_constraint_sets: creates a constraint set once the study resolves", async () => {
    bridge.listRecords.mockImplementation(byCollection({ reverse_formulation_studies: [study] }));
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("reverse_constraint_sets")!,
      [row({ constraint_set_code: "TEST-RCS-001", constraint_set_name: "TEST Constraints", study_code: "TEST-RFS-001" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("reverse_constraint_sets", expect.arrayContaining([expect.objectContaining({ studyId: "study-1" })]));
  });

  it("ingredient_mappings: fails honestly at each missing-parent step rather than fabricating any of them", async () => {
    const base = { study_code: "TEST-RFS-001", product_code: "TEST-BMP-001", declared_order: "1", candidate_material_code: "TEST-MAT-001", mapping_method: "INCI", confidence: "0.8" };

    const noStudy = await commitDataExchangeRows(getDataExchangeTemplate("ingredient_mappings")!, [row(base)], ctx);
    expect(noStudy[0].message).toMatch(/No Reverse Formulation study/);

    bridge.listRecords.mockImplementation(byCollection({ reverse_formulation_studies: [study] }));
    const noProduct = await commitDataExchangeRows(getDataExchangeTemplate("ingredient_mappings")!, [row(base)], ctx);
    expect(noProduct[0].message).toMatch(/No benchmark product/);

    bridge.listRecords.mockImplementation(byCollection({ reverse_formulation_studies: [study], benchmark_products: [product] }));
    const noLine = await commitDataExchangeRows(getDataExchangeTemplate("ingredient_mappings")!, [row(base)], ctx);
    expect(noLine[0].message).toMatch(/No declaration line/);

    bridge.listRecords.mockImplementation(byCollection({ reverse_formulation_studies: [study], benchmark_products: [product], ingredient_declaration_lines: [declLine] }));
    const noMaterial = await commitDataExchangeRows(getDataExchangeTemplate("ingredient_mappings")!, [row(base)], ctx);
    expect(noMaterial[0].message).toMatch(/No material/);

    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  it("ingredient_mappings: creates a mapping that always starts proposed once every parent resolves", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({ reverse_formulation_studies: [study], benchmark_products: [product], ingredient_declaration_lines: [declLine], materials: [material] }),
    );
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("ingredient_mappings")!,
      [row({ study_code: "TEST-RFS-001", product_code: "TEST-BMP-001", declared_order: "1", candidate_material_code: "TEST-MAT-001", mapping_method: "INCI", confidence: "0.8" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "ingredient_mappings",
      expect.arrayContaining([expect.objectContaining({ declarationLineId: "declline-1", candidateMaterialId: "TEST-MAT-001", status: "proposed" })]),
    );
  });

  it("substitution_rules: fails honestly when a referenced material does not exist, and never fabricates it", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("substitution_rules")!,
      [row({ source_material_code: "TEST-MAT-001", target_material_code: "TEST-MAT-002" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No material/);
  });

  it("substitution_rules: creates a rule that always starts proposed once both materials resolve", async () => {
    bridge.listRecords.mockImplementation(byCollection({ materials: [{ code: "TEST-MAT-001" }, { code: "TEST-MAT-002" }] }));
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("substitution_rules")!,
      [row({ source_material_code: "TEST-MAT-001", target_material_code: "TEST-MAT-002" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("substitution_rules", expect.arrayContaining([expect.objectContaining({ status: "proposed" })]));
  });

  it("reverse_formula_candidates (grouped): fails honestly when the study does not exist", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("reverse_formula_candidates")!,
      [row({ study_code: "TEST-RFS-001", candidate_code: "TEST-CAND-001", generation_method: "declared_hints", material_code: "TEST-MAT-001", percentage: "100" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No Reverse Formulation study/);
  });

  it("reverse_formula_candidates (grouped): fails honestly when a line's material does not exist, and never fabricates it", async () => {
    bridge.listRecords.mockImplementation(byCollection({ reverse_formulation_studies: [study] }));
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("reverse_formula_candidates")!,
      [row({ study_code: "TEST-RFS-001", candidate_code: "TEST-CAND-001", generation_method: "declared_hints", material_code: "TEST-MAT-001", percentage: "100" })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No material/);
  });

  it("reverse_formula_candidates (grouped): groups multiple lines into one candidate that always starts as generated", async () => {
    bridge.listRecords.mockImplementation(byCollection({ reverse_formulation_studies: [study], materials: [{ code: "TEST-MAT-001" }, { code: "TEST-MAT-002" }] }));
    const rows = [
      row({ study_code: "TEST-RFS-001", candidate_code: "TEST-CAND-001", generation_method: "declared_hints", material_code: "TEST-MAT-001", percentage: "60" }, { rowNumber: 2, naturalKey: "TEST-CAND-001::TEST-MAT-001" }),
      row({ study_code: "TEST-RFS-001", candidate_code: "TEST-CAND-001", generation_method: "declared_hints", material_code: "TEST-MAT-002", percentage: "40" }, { rowNumber: 3, naturalKey: "TEST-CAND-001::TEST-MAT-002" }),
    ];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("reverse_formula_candidates")!, rows, ctx);
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.outcome === "created")).toBe(true);
    expect(bridge.upsertRecords).toHaveBeenCalledTimes(1);
    const saved = bridge.upsertRecords.mock.calls[0][1][0] as { status: string; formulaLines: unknown[] };
    expect(saved.status).toBe("generated");
    expect(saved.formulaLines).toHaveLength(2);
  });

  it("candidate_score_explanations: fails honestly when the referenced candidate does not exist, and never fabricates it", async () => {
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("candidate_score_explanations")!,
      [row({ candidate_code: "TEST-CAND-001", score_type: "evidence", score: "0.7", weight: "0.25", reason: "Coverage 80%." })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("failed");
    expect(outcomes[0].message).toMatch(/No candidate/);
  });

  it("candidate_score_explanations: has a stable persistence key and is append-only — the Session 3 row_key() blocker is resolved", async () => {
    bridge.listRecords.mockImplementation(byCollection({ reverse_formula_candidates: [candidate] }));
    const outcomes = await commitDataExchangeRows(
      getDataExchangeTemplate("candidate_score_explanations")!,
      [row({ candidate_code: "TEST-CAND-001", score_type: "evidence", score: "0.7", weight: "0.25", reason: "Coverage 80%." })],
      ctx,
    );
    expect(outcomes[0].outcome).toBe("created");
    const written = bridge.upsertRecords.mock.calls[0][1][0] as { id?: string; candidateId: string };
    expect(written.id).toBeTruthy();
    expect(written.candidateId).toBe("candidate-1");

    // A second import of the same (candidate, score_type) is a second,
    // independent record with its own id — never an in-place overwrite.
    await commitDataExchangeRows(
      getDataExchangeTemplate("candidate_score_explanations")!,
      [row({ candidate_code: "TEST-CAND-001", score_type: "evidence", score: "0.9", weight: "0.25", reason: "Re-scored." })],
      ctx,
    );
    const secondWritten = bridge.upsertRecords.mock.calls[1][1][0] as { id?: string };
    expect(secondWritten.id).toBeTruthy();
    expect(secondWritten.id).not.toBe(written.id);
  });
});

describe("commitDataExchangeRows — genuinely unsupported templates stay honest", () => {
  it("isTemplateCommitSupported reports false for a template code with no handler", () => {
    expect(isTemplateCommitSupported("not_a_real_template")).toBe(false);
    expect(isTemplateCommitSupported("raw_materials")).toBe(true);
    expect(isTemplateCommitSupported("stability_protocols")).toBe(true);
    expect(isTemplateCommitSupported("stability_results")).toBe(true);
    expect(isTemplateCommitSupported("reverse_formulation_studies")).toBe(true);
    expect(isTemplateCommitSupported("candidate_score_explanations")).toBe(true);
  });

  it("reports every row as skipped for a template with no commit handler, never silently accepting it", async () => {
    const fakeTemplate = { ...getDataExchangeTemplate("stability_protocols")!, templateCode: "not_a_real_template" };
    const rows = [row({ study_code: "TEST-STUDY-001" }), row({ study_code: "TEST-STUDY-002" }, { rowNumber: 3 })];
    const outcomes = await commitDataExchangeRows(fakeTemplate, rows, ctx);
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.outcome === "skipped")).toBe(true);
    expect(outcomes[0].message).toMatch(/No commit handler is wired/);
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });
});
