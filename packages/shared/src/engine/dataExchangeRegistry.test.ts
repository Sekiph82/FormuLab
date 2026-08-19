import { describe, expect, it } from "vitest";
import { DATA_EXCHANGE_TEMPLATES, getDataExchangeTemplate, isDataExchangeRoleAuthorized, listDataExchangeTemplates } from "./dataExchangeRegistry";

describe("Data Exchange template registry", () => {
  it("registers exactly the 24 mandated templates plus the 11 Reverse Formulation templates plus the 6 Phase 8 dossier-expansion templates plus the 2 FVL-04.007/.008 operational templates (inventory_records, exchange_rates)", () => {
    expect(DATA_EXCHANGE_TEMPLATES).toHaveLength(43);
  });

  it("gives every template a unique templateCode", () => {
    const codes = DATA_EXCHANGE_TEMPLATES.map((t) => t.templateCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every template a unique templateId", () => {
    const ids = DATA_EXCHANGE_TEMPLATES.map((t) => t.templateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every template unique, stable column ordering with no duplicate keys", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      const keys = t.columns.map((c) => c.key);
      expect(new Set(keys).size, `${t.templateCode} has duplicate column keys`).toBe(keys.length);
      expect(t.columns.length, `${t.templateCode} has no columns`).toBeGreaterThan(0);
    }
  });

  it("defines a non-empty natural key for every template", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      expect(t.naturalKey.length, `${t.templateCode} has no natural key`).toBeGreaterThan(0);
      for (const key of t.naturalKey) {
        expect(
          t.columns.some((c) => c.key === key),
          `${t.templateCode}'s natural key "${key}" is not a real column`,
        ).toBe(true);
      }
    }
  });

  it("defines a schema version for every template", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      expect(t.schemaVersion).toBe("1.0");
    }
  });

  it("supports both csv and xlsx for every template", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      expect(t.supportedFormats).toContain("csv");
      expect(t.supportedFormats).toContain("xlsx");
    }
  });

  it("gives every template at least one authorized role", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      expect(t.authorization.length, `${t.templateCode} has no authorized role`).toBeGreaterThan(0);
    }
  });

  it("gives every template at least one example row, and every example row only uses real column keys", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      expect(t.exampleRows.length, `${t.templateCode} has no example rows`).toBeGreaterThan(0);
      const keys = new Set(t.columns.map((c) => c.key));
      for (const row of t.exampleRows) {
        for (const rowKey of Object.keys(row)) {
          expect(keys.has(rowKey), `${t.templateCode} example row has unknown key "${rowKey}"`).toBe(true);
        }
      }
    }
  });

  it("fills every required column in at least one example row", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      const requiredKeys = t.columns.filter((c) => c.required).map((c) => c.key);
      for (const key of requiredKeys) {
        const filled = t.exampleRows.some((row) => (row[key] ?? "").trim() !== "");
        expect(filled, `${t.templateCode}'s required column "${key}" is empty in every example row`).toBe(true);
      }
    }
  });

  it("uses clearly synthetic TEST- codes in example rows, never real personal data", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      const codeColumn = t.columns.find((c) => c.key === t.naturalKey[0]);
      if (!codeColumn || codeColumn.dataType !== "code_reference") continue;
      for (const row of t.exampleRows) {
        const value = row[codeColumn.key];
        if (!value) continue;
        expect(value.startsWith("TEST-"), `${t.templateCode} example ${codeColumn.key}="${value}" should start with TEST-`).toBe(true);
      }
    }
  });

  it("never defaults a verification/approval/status field to a verified or approved value", () => {
    const guardedKeys = ["verification_status", "verified_by", "verified_at", "approved_supplier", "approved", "status"];
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      for (const c of t.columns) {
        if (!guardedKeys.includes(c.key)) continue;
        if (c.dataType === "boolean") {
          expect(c.defaultValue === "true", `${t.templateCode}.${c.key} defaults to true`).toBe(false);
        }
        if (c.enumValues) {
          const forbidden = ["verified", "approved", "supported", "prohibited", "reviewed"];
          if (c.defaultValue) {
            expect(forbidden.includes(c.defaultValue), `${t.templateCode}.${c.key} defaults to "${c.defaultValue}"`).toBe(false);
          }
        }
      }
    }
  });

  it("looks up a template by code", () => {
    expect(getDataExchangeTemplate("raw_materials")?.title).toBe("Raw Materials Master");
    expect(getDataExchangeTemplate("does_not_exist")).toBeUndefined();
  });

  it("lists all templates", () => {
    expect(listDataExchangeTemplates().length).toBe(43);
  });

  it("checks role authorization", () => {
    const t = getDataExchangeTemplate("raw_materials")!;
    expect(isDataExchangeRoleAuthorized(t, "administrator")).toBe(true);
    expect(isDataExchangeRoleAuthorized(t, "researcher")).toBe(false);
  });

  // Every template is enabled except the two Phase 8 dossier-expansion
  // templates that are deliberately import-disabled — see their
  // `disabledReason` in the registry: a review's frozen requirement/
  // evidence snapshot, and a manual-requirement-action's atomic pairing
  // with a real requirement mutation, cannot be honestly reconstructed
  // from a flat import row. Both still ship a real export loader.
  const KNOWN_DISABLED_TEMPLATES = ["dossier_reviews", "dossier_manual_requirement_actions"];

  it("marks every template enabled — DOE templates are only registered because Phase 5 is complete", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      if (KNOWN_DISABLED_TEMPLATES.includes(t.templateCode)) continue;
      expect(t.enabled, `${t.templateCode} unexpectedly disabled`).toBe(true);
    }
  });

  it("gives each known-disabled template an honest, non-empty disabledReason", () => {
    for (const code of KNOWN_DISABLED_TEMPLATES) {
      const t = getDataExchangeTemplate(code)!;
      expect(t.enabled).toBe(false);
      expect(t.disabledReason?.length).toBeGreaterThan(0);
    }
  });

  describe("critical-deep-coverage templates", () => {
    const expected: [string, string][] = [
      ["raw_materials", "materials"],
      ["suppliers", "materials"],
      ["material_prices", "materials"],
      ["formula_bom", "formulation"],
      ["lab_results", "laboratory"],
      ["stability_results", "stability"],
      ["regulatory_rules", "regulatory"],
      ["dossier_evidence", "dossier"],
      ["product_claims", "claims_labels"],
      ["label_content", "claims_labels"],
      ["doe_factors_responses", "doe"],
      ["doe_observations", "doe"],
    ];
    for (const [code, module_] of expected) {
      it(`registers "${code}" in module "${module_}"`, () => {
        const t = getDataExchangeTemplate(code);
        expect(t).toBeDefined();
        expect(t?.module).toBe(module_);
      });
    }
  });

  describe("Reverse Formulation templates (25-35)", () => {
    const REVERSE_FORMULATION_TEMPLATE_CODES = [
      "reverse_formulation_studies",
      "benchmark_products",
      "benchmark_evidence_items",
      "ingredient_declaration_lines",
      "analytical_composition_results",
      "target_product_profiles",
      "reverse_constraint_sets",
      "ingredient_mappings",
      "substitution_rules",
      "reverse_formula_candidates",
      "candidate_score_explanations",
    ];

    it("registers all 11 expected Reverse Formulation collections, each exactly once", () => {
      for (const code of REVERSE_FORMULATION_TEMPLATE_CODES) {
        const matches = DATA_EXCHANGE_TEMPLATES.filter((t) => t.templateCode === code);
        expect(matches, `"${code}" should be registered exactly once`).toHaveLength(1);
      }
    });

    it("targets a collection matching the template code, in module reverse_formulation", () => {
      for (const code of REVERSE_FORMULATION_TEMPLATE_CODES) {
        const t = getDataExchangeTemplate(code)!;
        expect(t.targetCollection).toBe(code);
        expect(t.module).toBe("reverse_formulation");
      }
    });

    it("preserves analytical_composition_results.value as an exact decimal column, and defines it required", () => {
      const t = getDataExchangeTemplate("analytical_composition_results")!;
      const value = t.columns.find((c) => c.key === "value")!;
      expect(value.dataType).toBe("decimal");
      expect(value.required).toBe(true);
    });

    it("registers analytical_composition_results and candidate_score_explanations as append-only (new_revision) — never a silent overwrite", () => {
      expect(getDataExchangeTemplate("analytical_composition_results")!.duplicatePolicy).toBe("new_revision");
      expect(getDataExchangeTemplate("candidate_score_explanations")!.duplicatePolicy).toBe("new_revision");
    });

    it("requires a benchmark product reference before evidence/declaration/analytical rows can resolve", () => {
      for (const code of ["benchmark_evidence_items", "ingredient_declaration_lines", "analytical_composition_results"]) {
        const t = getDataExchangeTemplate(code)!;
        const ref = t.columns.find((c) => c.key === "product_code")!;
        expect(ref.dataType).toBe("code_reference");
        expect(ref.referenceTemplate).toBe("benchmark_products");
        expect(ref.required).toBe(true);
      }
    });

    it("restricts every workflow-status column to its safe starting value only — an import can never claim review/selection/validation", () => {
      const studyStatus = getDataExchangeTemplate("reverse_formulation_studies")!.columns.find((c) => c.key === "status")!;
      expect(studyStatus.enumValues).toEqual(["draft"]);
      // ingredient_mappings, substitution_rules and reverse_formula_candidates
      // deliberately expose no importable status column at all — the commit
      // handler always writes the safe starting value.
      for (const code of ["ingredient_mappings", "substitution_rules", "reverse_formula_candidates"]) {
        const t = getDataExchangeTemplate(code)!;
        expect(t.columns.some((c) => c.key === "status")).toBe(false);
      }
    });

    it("scopes ingredient_mappings/reverse_formula_candidates to an existing material via code_reference, never a free-text material id", () => {
      const mappingMaterial = getDataExchangeTemplate("ingredient_mappings")!.columns.find((c) => c.key === "candidate_material_code")!;
      expect(mappingMaterial.dataType).toBe("code_reference");
      expect(mappingMaterial.referenceTemplate).toBe("raw_materials");
      const candidateMaterial = getDataExchangeTemplate("reverse_formula_candidates")!.columns.find((c) => c.key === "material_code")!;
      expect(candidateMaterial.dataType).toBe("code_reference");
      expect(candidateMaterial.referenceTemplate).toBe("raw_materials");
    });
  });

  describe("Phase 8 dossier-expansion templates (30-35)", () => {
    const expectedCodes = [
      "dossier_headers",
      "dossier_reviews",
      "dossier_submissions",
      "dossier_evidence_links",
      "dossier_manual_requirement_actions",
      "dossier_review_revocations",
    ];

    it("registers all 6 expected dossier-expansion templates, each exactly once, in module 'dossier'", () => {
      for (const code of expectedCodes) {
        const matches = DATA_EXCHANGE_TEMPLATES.filter((t) => t.templateCode === code);
        expect(matches, `"${code}" should be registered exactly once`).toHaveLength(1);
        expect(matches[0]!.module).toBe("dossier");
      }
    });

    it("restricts every workflow-status column to its safe starting value only — an import can never approve, verify, submit, or accept", () => {
      expect(getDataExchangeTemplate("dossier_headers")!.columns.find((c) => c.key === "status")!.enumValues).toEqual(["draft"]);
      expect(getDataExchangeTemplate("dossier_submissions")!.columns.find((c) => c.key === "status")!.enumValues).toEqual(["prepared"]);
      expect(getDataExchangeTemplate("dossier_evidence_links")!.columns.find((c) => c.key === "link_status")!.enumValues).toEqual(["proposed"]);
    });

    it("leaves dossier_headers, dossier_submissions, dossier_evidence_links, and dossier_review_revocations enabled for import", () => {
      for (const code of ["dossier_headers", "dossier_submissions", "dossier_evidence_links", "dossier_review_revocations"]) {
        expect(getDataExchangeTemplate(code)!.enabled).toBe(true);
      }
    });

    it("disables import for dossier_reviews and dossier_manual_requirement_actions, each with an honest reason", () => {
      for (const code of ["dossier_reviews", "dossier_manual_requirement_actions"]) {
        const t = getDataExchangeTemplate(code)!;
        expect(t.enabled).toBe(false);
        expect(t.disabledReason?.length).toBeGreaterThan(0);
      }
    });

    it("requires dossier_headers to bind to an already-existing formula via code_reference, never a free-text formula id", () => {
      const formulaCode = getDataExchangeTemplate("dossier_headers")!.columns.find((c) => c.key === "formula_code")!;
      expect(formulaCode.dataType).toBe("code_reference");
      expect(formulaCode.required).toBe(true);
    });

    it("requires dossier_review_revocations to identify the exact review being revoked (dossier, revision, reviewed_at)", () => {
      const t = getDataExchangeTemplate("dossier_review_revocations")!;
      expect(t.naturalKey).toEqual(["dossier_code", "dossier_revision", "reviewed_at"]);
      for (const key of t.naturalKey) {
        expect(t.columns.find((c) => c.key === key)!.required).toBe(true);
      }
    });
  });
});
