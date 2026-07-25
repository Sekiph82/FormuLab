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
import { getDataExchangeTemplate, type DataExchangeRowResult } from "@ai4s/shared";
import { commitDataExchangeRows, isTemplateCommitSupported } from "./dataExchangeCommit";

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
      if (collection === "test_definitions") return Promise.resolve([{ id: "testdef-1", code: "TEST-T-001", resultType: "numeric" }]);
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
      expect.arrayContaining([expect.objectContaining({ trialId: "trial-1", testDefinitionId: "testdef-1", replicates: expect.arrayContaining([expect.objectContaining({ replicateNumber: 1 }), expect.objectContaining({ replicateNumber: 2 })]) })]),
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
      if (collection === "test_definitions") return Promise.resolve([{ id: "testdef-1", code: "TEST-TST-001" }]);
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
    expect(saved.requiredTestDefinitionIds).toHaveLength(1);
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
      if (collection === "stability_samples") return Promise.resolve([{ id: "sample-1", studyId: "study-1", sampleCode: "S1", conditionId: "cond-40c", timePointId: "tp-3mo", testDefinitionIds: ["testdef-1"] }]);
      if (collection === "test_definitions") return Promise.resolve([{ id: "testdef-1", code: "TEST-TST-001", resultType: "numeric" }]);
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
      if (collection === "stability_samples") return Promise.resolve([{ id: "sample-1", studyId: "study-1", sampleCode: "S1", conditionId: "cond-40c", timePointId: "tp-3mo", testDefinitionIds: ["testdef-1"] }]);
      if (collection === "test_definitions") return Promise.resolve([{ id: "testdef-1", code: "TEST-TST-001", resultType: "numeric" }]);
      if (collection === "stability_results") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const rows = [row({ study_code: "TEST-STAB-001", sample_code: "S1", test_code: "TEST-TST-001", numeric_value: "5.3" })];
    const outcomes = await commitDataExchangeRows(getDataExchangeTemplate("stability_results")!, rows, ctx);
    expect(outcomes[0].outcome).toBe("created");
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "stability_results",
      expect.arrayContaining([expect.objectContaining({ sampleId: "sample-1", testDefinitionId: "testdef-1", conditionId: "cond-40c", timePointId: "tp-3mo" })]),
    );
  });

  it("rejects a test that the sample's own protocol does not require", async () => {
    bridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "stability_studies") return Promise.resolve([{ id: "study-1", code: "TEST-STAB-001" }]);
      if (collection === "stability_samples") return Promise.resolve([{ id: "sample-1", studyId: "study-1", sampleCode: "S1", conditionId: "cond-40c", timePointId: "tp-3mo", testDefinitionIds: ["some-other-test"] }]);
      if (collection === "test_definitions") return Promise.resolve([{ id: "testdef-1", code: "TEST-TST-001", resultType: "numeric" }]);
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
      if (collection === "stability_samples") return Promise.resolve([{ id: "sample-1", studyId: "study-1", sampleCode: "S1", conditionId: "cond-40c", timePointId: "tp-3mo", testDefinitionIds: ["testdef-1"] }]);
      if (collection === "test_definitions") return Promise.resolve([{ id: "testdef-1", code: "TEST-TST-001", resultType: "numeric" }]);
      if (collection === "stability_results") return Promise.resolve([{ id: "old-result-1", sampleId: "sample-1", testDefinitionId: "testdef-1", createdAt: "2025-01-01T00:00:00.000Z" }]);
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

describe("commitDataExchangeRows — genuinely unsupported templates stay honest", () => {
  it("isTemplateCommitSupported reports false for a template code with no handler", () => {
    expect(isTemplateCommitSupported("not_a_real_template")).toBe(false);
    expect(isTemplateCommitSupported("raw_materials")).toBe(true);
    expect(isTemplateCommitSupported("stability_protocols")).toBe(true);
    expect(isTemplateCommitSupported("stability_results")).toBe(true);
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
