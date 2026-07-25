/**
 * Behavior coverage for the 9 current-data-export loaders added to close
 * Phase 6: packaging_bom, lab_results, dossier_requirements,
 * dossier_evidence, product_claims, label_content, artwork_register,
 * doe_factors_responses, doe_observations. Each of these flattens a real
 * persisted collection (sometimes joined across several) back into its
 * template's row shape — this file checks the field mapping is real and
 * that `naturalKeys` matches exactly what `naturalKeyOf` would build from
 * the same row's natural-key columns (see `dataExchangeValidation.ts`),
 * since a mismatch there would silently break re-import's create-vs-update
 * classification.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasExistingLookup, loadExisting } from "./dataExchangeExisting";

const bridge = { listRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
}));

const formulationsBridge = { listFormulations: vi.fn(), readFormulation: vi.fn() };
vi.mock("@/lib/formulations", () => ({
  listFormulations: (...a: []) => formulationsBridge.listFormulations(...a),
  readFormulation: (...a: [string]) => formulationsBridge.readFormulation(...a),
}));

function byCollection(map: Record<string, unknown[]>) {
  return (collection: string) => Promise.resolve(map[collection] ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  formulationsBridge.listFormulations.mockResolvedValue([]);
  formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [] });
});

describe("all 24 templates have a loader", () => {
  const templates = [
    "raw_materials", "suppliers", "material_prices", "material_documents", "product_families", "finished_products",
    "packaging_components", "packaging_bom", "process_parameters", "costing_assumptions", "formula_cost_overrides",
    "test_definitions", "lab_results", "stability_protocols", "stability_results", "regulatory_rules",
    "dossier_requirements", "dossier_evidence", "product_claims", "label_content", "artwork_register",
    "doe_factors_responses", "doe_observations",
  ];
  it.each(templates)("%s has a current-data-export loader", (code) => {
    expect(hasExistingLookup(code)).toBe(true);
  });
  // formula_bom is intentionally excluded — it has its own dedicated
  // loadExistingFormulaBom, not routed through hasExistingLookup/loadExisting.
});

describe("packaging_bom loader", () => {
  it("flattens one row per BOM line, keys by (sku, component), and round-trips product_family_code/tags", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        packaging_boms: [
          { skuCode: "TEST-PKGBOM-001", description: "TEST Bottle Pack", fillQuantity: "250", productFamilyCode: "TEST-FAM-001", tags: ["bottle-pack"], lines: [{ componentCode: "TEST-PKG-001", quantityPerUnit: "1", notes: "cap" }] },
        ],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("packaging_bom");
    expect(naturalKeys.has("TEST-PKGBOM-001::TEST-PKG-001")).toBe(true);
    expect(rows).toEqual([
      { packaging_sku_code: "TEST-PKGBOM-001", packaging_sku_name: "TEST Bottle Pack", product_family_code: "TEST-FAM-001", component_code: "TEST-PKG-001", component_quantity: "1", fill_volume: "250", tags: "bottle-pack", notes: "cap" },
    ]);
  });
});

describe("lab_results loader", () => {
  it("flattens one row per replicate and keys by (trial, sample, test, replicate)", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        test_results: [{ trialId: "trial-1", testDefinitionId: "testdef-1", sampleId: "S1", unit: "pH", performedAt: "2026-01-15", performedBy: "Analyst", replicates: [{ replicateNumber: 1, numericValue: "5.4" }] }],
        laboratory_trials: [{ id: "trial-1", code: "TEST-TRIAL-001" }],
        test_definitions: [{ id: "testdef-1", code: "TEST-TST-001" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("lab_results");
    expect(naturalKeys.has("TEST-TRIAL-001::S1::TEST-TST-001::1")).toBe(true);
    expect(rows[0]).toMatchObject({ trial_code: "TEST-TRIAL-001", sample_code: "S1", test_code: "TEST-TST-001", replicate_number: "1", numeric_value: "5.4" });
  });
});

describe("dossier_requirements loader", () => {
  it("resolves dossierId back to dossier_code and keys by (dossier, requirement)", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        regulatory_dossier_requirements: [{ dossierId: "dossier-1", requirementCode: "TEST-REQ-001", jurisdiction: "KE", requirementType: "label_content", title: "Net contents" }],
        regulatory_dossiers: [{ id: "dossier-1", dossierCode: "TEST-DOS-001" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("dossier_requirements");
    expect(naturalKeys.has("TEST-DOS-001::TEST-REQ-001")).toBe(true);
    expect(rows[0]).toMatchObject({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", title: "Net contents" });
  });
});

describe("dossier_evidence loader", () => {
  it("reconstructs requirement_code from the active link and excludes evidence without an evidenceCode", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        regulatory_evidence_items: [
          { id: "evid-1", dossierId: "dossier-1", evidenceCode: "TEST-EVID-001", evidenceType: "other", title: "TEST Evidence" },
          { id: "evid-2", dossierId: "dossier-1", title: "No code — not from Data Exchange" },
        ],
        regulatory_dossiers: [{ id: "dossier-1", dossierCode: "TEST-DOS-001" }],
        regulatory_dossier_requirements: [{ id: "req-1", requirementCode: "TEST-REQ-001" }],
        regulatory_requirement_evidence_links: [{ evidenceItemId: "evid-1", requirementId: "req-1", linkStatus: "proposed" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("dossier_evidence");
    expect(rows).toHaveLength(1);
    expect(naturalKeys.has("TEST-DOS-001::TEST-REQ-001::TEST-EVID-001")).toBe(true);
    expect(rows[0]).toMatchObject({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-001" });
  });

  it("ignores a revoked link when reconstructing requirement_code", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        regulatory_evidence_items: [{ id: "evid-1", dossierId: "dossier-1", evidenceCode: "TEST-EVID-001", title: "TEST Evidence" }],
        regulatory_dossiers: [{ id: "dossier-1", dossierCode: "TEST-DOS-001" }],
        regulatory_dossier_requirements: [{ id: "req-1", requirementCode: "TEST-REQ-001" }],
        regulatory_requirement_evidence_links: [{ evidenceItemId: "evid-1", requirementId: "req-1", linkStatus: "revoked" }],
      }),
    );
    const { rows } = await loadExisting("dossier_evidence");
    expect(rows[0].requirement_code).toBe("");
  });
});

describe("product_claims loader", () => {
  it("resolves formulationId/formulaVersionId back to project_code/formula_version", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([{ id: "formulation-1", code: "TEST-PROJ-001" }]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [{ id: "version-1", versionNumber: 2 }] });
    bridge.listRecords.mockImplementation(
      byCollection({ product_claims: [{ claimCode: "TEST-CLAIM-001", formulationId: "formulation-1", formulaVersionId: "version-1", claimText: "TEST gentle", jurisdictions: ["KE"], languages: ["en"] }] }),
    );
    const { naturalKeys, rows } = await loadExisting("product_claims");
    expect(naturalKeys.has("TEST-CLAIM-001")).toBe(true);
    expect(rows[0]).toMatchObject({ claim_code: "TEST-CLAIM-001", project_code: "TEST-PROJ-001", formula_version: "2", jurisdictions: "KE" });
  });
});

describe("label_content loader", () => {
  it("joins through the parent label for formula_version/packaging_sku_code/jurisdiction, panel round-trips for real", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([{ id: "formulation-1", code: "TEST-PROJ-001" }]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [{ id: "version-1", versionNumber: 1 }] });
    bridge.listRecords.mockImplementation(
      byCollection({
        label_content_blocks: [{ labelId: "label-1", labelRevision: 1, panel: "front", blockType: "product_name", language: "en", text: "TEST Soap", mandatory: true, source: "imported", status: "draft" }],
        product_labels: [{ id: "label-1", labelCode: "TEST-LBL-001", formulaVersionId: "version-1", packagingSkuCode: "TEST-PKGBOM-001", jurisdiction: "KE" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("label_content");
    expect(naturalKeys.has("TEST-LBL-001::1::front::product_name::en")).toBe(true);
    expect(rows[0]).toMatchObject({ label_code: "TEST-LBL-001", formula_version: "1", packaging_sku_code: "TEST-PKGBOM-001", jurisdiction: "KE", panel: "front" });
  });
});

describe("artwork_register loader", () => {
  it("resolves labelId back to label_code, keys by artwork_code, and parses width/height/dimension_unit back out of the stored dimensions string", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        label_artworks: [{ labelId: "label-1", labelRevision: 1, artworkCode: "TEST-ART-001", format: "AI", dimensions: "100x200 mm", status: "draft" }],
        product_labels: [{ id: "label-1", labelCode: "TEST-LBL-001" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("artwork_register");
    expect(naturalKeys.has("TEST-ART-001")).toBe(true);
    expect(rows[0]).toMatchObject({ artwork_code: "TEST-ART-001", label_code: "TEST-LBL-001", format: "AI", width: "100", height: "200", dimension_unit: "mm" });
  });

  it("exports width/height blank when dimensions doesn't match the writer's format", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        label_artworks: [{ labelId: "label-1", labelRevision: 1, artworkCode: "TEST-ART-002", dimensions: "large poster", status: "draft" }],
        product_labels: [{ id: "label-1", labelCode: "TEST-LBL-001" }],
      }),
    );
    const { rows } = await loadExisting("artwork_register");
    expect(rows[0]).toMatchObject({ width: "", height: "", dimension_unit: "" });
  });
});

describe("doe_factors_responses loader", () => {
  it("flattens both factors and responses, tagging record_type, keyed by (study, code)", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        doe_studies: [{ id: "study-1", studyCode: "TEST-DOE-001" }],
        doe_factors: [{ studyId: "study-1", factorCode: "TEST-FACTOR-A", name: "Surfactant", factorType: "continuous" }],
        doe_responses: [{ studyId: "study-1", responseCode: "TEST-RESPONSE-1", name: "Viscosity", objective: "within_range" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("doe_factors_responses");
    expect(naturalKeys.has("TEST-DOE-001::TEST-FACTOR-A")).toBe(true);
    expect(naturalKeys.has("TEST-DOE-001::TEST-RESPONSE-1")).toBe(true);
    expect(rows.find((r) => r.record_type === "factor")).toMatchObject({ factor_or_response_code: "TEST-FACTOR-A", factor_type: "continuous" });
    expect(rows.find((r) => r.record_type === "response")).toMatchObject({ factor_or_response_code: "TEST-RESPONSE-1", objective: "within_range" });
  });
});

describe("doe_observations loader", () => {
  it("resolves study/run/response and keys by (study, run_number, response_code)", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        doe_studies: [{ id: "study-1", studyCode: "TEST-DOE-001" }],
        doe_runs: [{ id: "run-1", studyId: "study-1", runNumber: 1 }],
        doe_responses: [{ id: "response-1", studyId: "study-1", responseCode: "TEST-RESPONSE-1", unit: "cP" }],
        doe_observations: [{ studyId: "study-1", runId: "run-1", responseId: "response-1", value: "12500", status: "recorded" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("doe_observations");
    expect(naturalKeys.has("TEST-DOE-001::1::TEST-RESPONSE-1")).toBe(true);
    expect(rows[0]).toMatchObject({ study_code: "TEST-DOE-001", run_number: "1", response_code: "TEST-RESPONSE-1", numeric_value: "12500", unit: "cP" });
  });
});
