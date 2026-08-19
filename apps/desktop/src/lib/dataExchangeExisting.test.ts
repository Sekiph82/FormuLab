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
import { buildReferenceResolver, hasExistingLookup, loadExisting, loadPriorCommittedRows } from "./dataExchangeExisting";

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

describe("all 24 Phase 6 templates plus the 6 Phase 8 dossier-expansion templates have a loader", () => {
  const templates = [
    "raw_materials", "suppliers", "material_prices", "material_documents", "product_families", "finished_products",
    "packaging_components", "packaging_bom", "process_parameters", "costing_assumptions", "formula_cost_overrides",
    "test_definitions", "lab_results", "stability_protocols", "stability_results", "regulatory_rules",
    "dossier_requirements", "dossier_evidence", "product_claims", "label_content", "artwork_register",
    "doe_factors_responses", "doe_observations",
    // Phase 8: dossier_reviews and dossier_manual_requirement_actions are
    // import-disabled (see dataExchangeRegistry.ts) but still get a real
    // export loader — export/audit visibility is exactly what they're
    // allowed to do.
    "dossier_headers", "dossier_reviews", "dossier_submissions", "dossier_evidence_links",
    "dossier_manual_requirement_actions", "dossier_review_revocations",
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
        // `testDefinitionId` is already the code — real `test_definitions`
        // records carry no separate `id` (see `commitLabResults`).
        test_results: [{ trialId: "trial-1", testDefinitionId: "TEST-TST-001", sampleId: "S1", unit: "pH", performedAt: "2026-01-15", performedBy: "Analyst", replicates: [{ replicateNumber: 1, numericValue: "5.4" }] }],
        laboratory_trials: [{ id: "trial-1", code: "TEST-TRIAL-001" }],
        test_definitions: [{ code: "TEST-TST-001" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("lab_results");
    expect(naturalKeys.has("TEST-TRIAL-001::S1::TEST-TST-001::1")).toBe(true);
    expect(rows[0]).toMatchObject({ trial_code: "TEST-TRIAL-001", sample_code: "S1", test_code: "TEST-TST-001", replicate_number: "1", numeric_value: "5.4" });
  });
});

describe("stability_protocols loader", () => {
  it("reconstructs the (protocol, condition, time-point, test) cross-product from a study's id arrays", async () => {
    // No `id` on `test_definitions` on purpose — real records have none
    // (their `code` is their identity). Regression coverage for a
    // live-verification bug: the loader used to compare `td.id` (always
    // `undefined`) against the code stored in `requiredTestDefinitionIds`,
    // so it silently produced zero rows for every real study.
    bridge.listRecords.mockImplementation(
      byCollection({
        stability_studies: [{ code: "TEST-STAB-001", packagingSkuCode: "TEST-PKGBOM-001", conditionIds: ["cond-25c"], timePointIds: ["tp-2wk"], requiredTestDefinitionIds: ["TEST-VISCOSITY"] }],
        test_definitions: [{ code: "TEST-VISCOSITY" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("stability_protocols");
    expect(naturalKeys.has("TEST-STAB-001::25C::2WK::TEST-VISCOSITY")).toBe(true);
    expect(rows).toEqual([{ protocol_code: "TEST-STAB-001", condition_code: "25C", time_point: "2WK", test_code: "TEST-VISCOSITY", packaging_sku_code: "TEST-PKGBOM-001" }]);
  });
});

describe("stability_results loader", () => {
  it("joins result/study/sample/test back to natural-key columns", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        stability_results: [{ studyId: "study-1", sampleId: "sample-1", conditionId: "cond-25c", timePointId: "tp-2wk", testDefinitionId: "TEST-VISCOSITY", replicates: [{ numericValue: "1200" }], performedAt: "2026-07-26", performedBy: "TEST Analyst" }],
        stability_studies: [{ id: "study-1", code: "TEST-STAB-001" }],
        stability_samples: [{ id: "sample-1", sampleCode: "TEST-STAB-001-25C-2WK-R1" }],
        // No `id` on `test_definitions` on purpose — see the
        // `stability_protocols loader` test above for why.
        test_definitions: [{ code: "TEST-VISCOSITY" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("stability_results");
    expect(naturalKeys.has("TEST-STAB-001::TEST-STAB-001-25C-2WK-R1::25C::2WK::TEST-VISCOSITY")).toBe(true);
    expect(rows[0]).toMatchObject({ study_code: "TEST-STAB-001", sample_code: "TEST-STAB-001-25C-2WK-R1", condition_code: "25C", time_point: "2WK", test_code: "TEST-VISCOSITY", numeric_value: "1200" });
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

describe("dossier_headers loader", () => {
  it("resolves formulationId/formulaVersionId back to formula_code/formula_version and keys by dossier_code alone", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([{ id: "formulation-1", code: "TEST-FORM-001" }]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [{ id: "version-1", versionNumber: 1 }] });
    bridge.listRecords.mockImplementation(
      byCollection({
        regulatory_dossiers: [
          { dossierCode: "TEST-DOS-001", title: "TEST Dossier", formulationId: "formulation-1", formulaVersionId: "version-1", jurisdictions: ["KE"], productFamilyCode: "TEST-FAM-001", status: "draft" },
        ],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("dossier_headers");
    expect(naturalKeys.has("TEST-DOS-001")).toBe(true);
    expect(rows[0]).toMatchObject({ dossier_code: "TEST-DOS-001", formula_code: "TEST-FORM-001", formula_version: "1", jurisdictions: "KE", status: "draft" });
  });
});

describe("dossier_submissions loader", () => {
  it("resolves dossierId back to dossier_code and keys by (dossier, revision, jurisdiction, timestamp)", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        regulatory_dossier_submissions: [{ dossierId: "dossier-1", dossierRevision: 1, jurisdiction: "KE", submittedBy: "TEST User", submittedAt: "2026-01-15T00:00:00.000Z", status: "prepared" }],
        regulatory_dossiers: [{ id: "dossier-1", dossierCode: "TEST-DOS-001" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("dossier_submissions");
    expect(naturalKeys.has("TEST-DOS-001::1::KE::2026-01-15T00:00:00.000Z")).toBe(true);
    expect(rows[0]).toMatchObject({ dossier_code: "TEST-DOS-001", status: "prepared" });
  });
});

describe("dossier_evidence_links loader", () => {
  it("resolves dossier/requirement/evidence ids back to their codes and excludes evidence without an evidenceCode", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        regulatory_requirement_evidence_links: [
          { dossierId: "dossier-1", requirementId: "req-1", evidenceItemId: "evid-1", linkedBy: "TEST Importer", linkedAt: "2026-01-08T00:00:00.000Z", linkStatus: "proposed" },
          { dossierId: "dossier-1", requirementId: "req-1", evidenceItemId: "evid-2", linkedBy: "TEST Importer", linkedAt: "2026-01-08T00:00:00.000Z", linkStatus: "proposed" },
        ],
        regulatory_dossiers: [{ id: "dossier-1", dossierCode: "TEST-DOS-001" }],
        regulatory_dossier_requirements: [{ id: "req-1", requirementCode: "TEST-REQ-001" }],
        regulatory_evidence_items: [
          { id: "evid-1", evidenceCode: "TEST-EVID-001" },
          { id: "evid-2", title: "No code — not from Data Exchange" },
        ],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("dossier_evidence_links");
    expect(rows).toHaveLength(1);
    expect(naturalKeys.has("TEST-DOS-001::TEST-REQ-001::TEST-EVID-001::2026-01-08T00:00:00.000Z")).toBe(true);
    expect(rows[0]).toMatchObject({ dossier_code: "TEST-DOS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-001", link_status: "proposed" });
  });
});

describe("dossier_review_revocations loader", () => {
  it("resolves revokesReviewId to its review, then to the review's dossier_code/revision/reviewed_at", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        regulatory_dossier_review_revocations: [{ revokesReviewId: "review-1", revokedBy: "TEST Admin", revokedByRole: "administrator", reason: "TEST reason" }],
        regulatory_dossier_reviews: [{ id: "review-1", dossierId: "dossier-1", dossierRevision: 1, reviewedAt: "2026-01-10T00:00:00.000Z" }],
        regulatory_dossiers: [{ id: "dossier-1", dossierCode: "TEST-DOS-001" }],
      }),
    );
    const { naturalKeys, rows } = await loadExisting("dossier_review_revocations");
    expect(naturalKeys.has("TEST-DOS-001::1::2026-01-10T00:00:00.000Z")).toBe(true);
    expect(rows[0]).toMatchObject({ dossier_code: "TEST-DOS-001", dossier_revision: "1", reviewed_at: "2026-01-10T00:00:00.000Z", revoked_by: "TEST Admin" });
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

describe("FVL-04 hardening (Session 8, Part 1): buildReferenceResolver is field-aware, not merely template-aware", () => {
  it("REF1: raw_materials.material_code existence resolves against the real field, not a composite string", async () => {
    bridge.listRecords.mockImplementation(byCollection({ materials: [{ code: "TEST-MAT-001" }] }));
    const resolve = await buildReferenceResolver([{ referenceTemplate: "raw_materials", referenceField: "material_code" }]);
    expect(resolve("raw_materials", "material_code", "TEST-MAT-001")).toBe(true);
  });

  it("REF2: suppliers.supplier_code existence", async () => {
    bridge.listRecords.mockImplementation(byCollection({ suppliers: [{ code: "TEST-SUP-001" }] }));
    const resolve = await buildReferenceResolver([{ referenceTemplate: "suppliers", referenceField: "supplier_code" }]);
    expect(resolve("suppliers", "supplier_code", "TEST-SUP-001")).toBe(true);
  });

  it("REF3/REF8 — THE BUG THIS SESSION CLOSES: packaging_bom.packaging_sku_code resolves against the SKU field, not the composite natural key 'SKU::COMPONENT'", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        packaging_boms: [
          { skuCode: "SKU-001", description: "Bottle Pack", lines: [{ componentCode: "BOTTLE-01", quantityPerUnit: "1" }, { componentCode: "CAP-01", quantityPerUnit: "1" }] },
        ],
      }),
    );
    // Sanity: the composite natural key is what it always was — proves this
    // test fixture genuinely has a composite key, not a coincidentally
    // single-field one.
    const { naturalKeys } = await loadExisting("packaging_bom");
    expect(naturalKeys.has("SKU-001::BOTTLE-01")).toBe(true);
    expect(naturalKeys.has("SKU-001")).toBe(false); // the bare SKU is NEVER a natural key on its own

    const resolve = await buildReferenceResolver([{ referenceTemplate: "packaging_bom", referenceField: "packaging_sku_code" }]);
    // REF3: the bare SKU, which appears twice (once per BOM line), resolves true.
    expect(resolve("packaging_bom", "packaging_sku_code", "SKU-001")).toBe(true);
    // REF8: a genuinely nonexistent SKU resolves false.
    expect(resolve("packaging_bom", "packaging_sku_code", "SKU-DOES-NOT-EXIST")).toBe(false);
  });

  it("REF4/REF9: label_content.label_code resolves against the real field", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        label_content_blocks: [{ labelId: "label-1", labelRevision: 1, panel: "front", blockType: "product_name", language: "en", text: "x" }],
        product_labels: [{ id: "label-1", labelCode: "TEST-LBL-001" }],
      }),
    );
    const resolve = await buildReferenceResolver([{ referenceTemplate: "label_content", referenceField: "label_code" }]);
    expect(resolve("label_content", "label_code", "TEST-LBL-001")).toBe(true);
    expect(resolve("label_content", "label_code", "NO-SUCH-LABEL")).toBe(false);
  });

  it("REF5/REF10: doe_factors_responses.factor_or_response_code resolves against the real field, not the composite (study, code) natural key", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        doe_studies: [{ id: "study-1", studyCode: "TEST-DOE-001" }],
        doe_factors: [{ studyId: "study-1", factorCode: "TEST-FACTOR-A", name: "Surfactant" }],
        doe_responses: [{ studyId: "study-1", responseCode: "TEST-RESPONSE-1", name: "Viscosity" }],
      }),
    );
    const resolve = await buildReferenceResolver([{ referenceTemplate: "doe_factors_responses", referenceField: "factor_or_response_code" }]);
    expect(resolve("doe_factors_responses", "factor_or_response_code", "TEST-RESPONSE-1")).toBe(true);
    expect(resolve("doe_factors_responses", "factor_or_response_code", "TEST-FACTOR-A")).toBe(true);
    expect(resolve("doe_factors_responses", "factor_or_response_code", "NO-SUCH-CODE")).toBe(false);
  });

  it("REF6/REF11: artwork_register.artwork_code — the self-reference target field — resolves against real canonical artwork, missing artwork resolves false", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        label_artworks: [{ labelId: "label-1", labelRevision: 1, artworkCode: "ART-001", status: "approved" }],
        product_labels: [{ id: "label-1", labelCode: "TEST-LBL-001" }],
      }),
    );
    const resolve = await buildReferenceResolver([{ referenceTemplate: "artwork_register", referenceField: "artwork_code" }]);
    expect(resolve("artwork_register", "artwork_code", "ART-001")).toBe(true);
    expect(resolve("artwork_register", "artwork_code", "ART-MISSING")).toBe(false);
  });

  it("a template referenced by two different fields loads its rows only once, shared across both field indexes", async () => {
    bridge.listRecords.mockImplementation(byCollection({ packaging_boms: [{ skuCode: "SKU-001", lines: [{ componentCode: "BOTTLE-01" }] }] }));
    const resolve = await buildReferenceResolver([
      { referenceTemplate: "packaging_bom", referenceField: "packaging_sku_code" },
      { referenceTemplate: "packaging_bom", referenceField: "component_code" },
    ]);
    expect(resolve("packaging_bom", "packaging_sku_code", "SKU-001")).toBe(true);
    expect(resolve("packaging_bom", "component_code", "BOTTLE-01")).toBe(true);
    // Exactly one load of the underlying collection despite two fields.
    expect(bridge.listRecords).toHaveBeenCalledTimes(1);
  });

  it("an unresolved (referenceTemplate, referenceField) pair not in the requirement set resolves false, never throws", async () => {
    const resolve = await buildReferenceResolver([]);
    expect(resolve("raw_materials", "material_code", "ANYTHING")).toBe(false);
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

describe("FVL-04.023: loadPriorCommittedRows — reads the EXISTING import-history model, never a second batch-tracking store", () => {
  it("returns [] when this template has no completed import yet — the honest first-import case, not an error", async () => {
    bridge.listRecords.mockImplementation(byCollection({ data_exchange_import_jobs: [], data_exchange_import_row_results: [] }));
    expect(await loadPriorCommittedRows("raw_materials")).toEqual([]);
  });

  it("uses only the MOST RECENT completed job for this exact template — an older completed job's own rows are never mixed in", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        data_exchange_import_jobs: [
          { id: "job-old", templateCode: "raw_materials", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z" },
          { id: "job-new", templateCode: "raw_materials", status: "completed", startedAt: "2026-02-01T00:00:00.000Z", completedAt: "2026-02-01T00:00:00.000Z" },
        ],
        data_exchange_import_row_results: [
          { id: "r-old", jobId: "job-old", rowNumber: 1, naturalKey: "OLD-MAT", state: "valid_create", targetCollection: "materials", targetRecordId: "OLD-MAT" },
          { id: "r-new", jobId: "job-new", rowNumber: 1, naturalKey: "NEW-MAT", state: "valid_create", targetCollection: "materials", targetRecordId: "NEW-MAT" },
        ],
      }),
    );
    const rows = await loadPriorCommittedRows("raw_materials");
    expect(rows).toEqual([{ naturalKey: "NEW-MAT", jobId: "job-new", targetCollection: "materials", targetRecordId: "NEW-MAT" }]);
  });

  it("filters out a different template's own jobs and rows entirely", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        data_exchange_import_jobs: [{ id: "job-1", templateCode: "suppliers", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z" }],
        data_exchange_import_row_results: [{ id: "r-1", jobId: "job-1", rowNumber: 1, naturalKey: "SUP-1", state: "valid_create", targetCollection: "suppliers", targetRecordId: "SUP-1" }],
      }),
    );
    expect(await loadPriorCommittedRows("raw_materials")).toEqual([]);
  });

  it("only includes committable-state rows that genuinely reached a target collection — an invalid/reference_missing row was never canonical and is correctly excluded", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        data_exchange_import_jobs: [{ id: "job-1", templateCode: "raw_materials", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z" }],
        data_exchange_import_row_results: [
          { id: "r-1", jobId: "job-1", rowNumber: 1, naturalKey: "GOOD-MAT", state: "valid_create", targetCollection: "materials", targetRecordId: "GOOD-MAT" },
          { id: "r-2", jobId: "job-1", rowNumber: 2, naturalKey: "BAD-MAT", state: "invalid", messages: ["missing required field"] },
        ],
      }),
    );
    const rows = await loadPriorCommittedRows("raw_materials");
    expect(rows).toEqual([{ naturalKey: "GOOD-MAT", jobId: "job-1", targetCollection: "materials", targetRecordId: "GOOD-MAT" }]);
  });

  it("an incomplete (not yet committed) job is never used as the comparison baseline", async () => {
    bridge.listRecords.mockImplementation(
      byCollection({
        data_exchange_import_jobs: [{ id: "job-1", templateCode: "raw_materials", status: "awaiting_confirmation", startedAt: "2026-01-01T00:00:00.000Z" }],
        data_exchange_import_row_results: [],
      }),
    );
    expect(await loadPriorCommittedRows("raw_materials")).toEqual([]);
  });
});
