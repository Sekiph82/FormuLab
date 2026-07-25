import { describe, expect, it } from "vitest";
import { DATA_EXCHANGE_TEMPLATES, getDataExchangeTemplate, isDataExchangeRoleAuthorized, listDataExchangeTemplates } from "./dataExchangeRegistry";

describe("Data Exchange template registry", () => {
  it("registers exactly the 24 mandated templates", () => {
    expect(DATA_EXCHANGE_TEMPLATES).toHaveLength(24);
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
    expect(listDataExchangeTemplates().length).toBe(24);
  });

  it("checks role authorization", () => {
    const t = getDataExchangeTemplate("raw_materials")!;
    expect(isDataExchangeRoleAuthorized(t, "administrator")).toBe(true);
    expect(isDataExchangeRoleAuthorized(t, "researcher")).toBe(false);
  });

  it("marks every template enabled — DOE templates are only registered because Phase 5 is complete", () => {
    for (const t of DATA_EXCHANGE_TEMPLATES) {
      expect(t.enabled, `${t.templateCode} unexpectedly disabled`).toBe(true);
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
});
