/**
 * Phase 10 Session 5 — fixture data correctness. `buildDocsFixturePlan()`
 * already validates every record against its real `@formulab/shared` Zod
 * schema internally (it would throw on `pnpm test` otherwise); these tests
 * cover the properties that matter beyond "it doesn't throw": determinism,
 * the DEMO- prefix discipline, and that no real-looking personal data ever
 * appears in the output.
 */
import { describe, expect, it } from "vitest";
import { buildDocsFixturePlan, DOCS_FIXTURE_PREFIX } from "./build";

describe("buildDocsFixturePlan — determinism", () => {
  it("produces byte-identical output across repeated calls", () => {
    const a = JSON.stringify(buildDocsFixturePlan());
    const b = JSON.stringify(buildDocsFixturePlan());
    expect(a).toBe(b);
  });

  it("never calls Date.now/Math.random-derived values (same output regardless of when it runs)", () => {
    const first = JSON.stringify(buildDocsFixturePlan());
    // Real time has moved between the two calls in this process; the output
    // must not have.
    const second = JSON.stringify(buildDocsFixturePlan());
    expect(first).toBe(second);
  });
});

describe("buildDocsFixturePlan — content shape", () => {
  const plan = buildDocsFixturePlan();

  it("includes the core project, version, and session files", () => {
    const paths = Object.keys(plan.files);
    expect(paths.some((p) => p.endsWith("/formulation.json"))).toBe(true);
    expect(paths.some((p) => p.includes("/versions/") && p.endsWith(".json"))).toBe(true);
    expect(paths.some((p) => p.includes("/approvals/") && p.endsWith(".json"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/audit.jsonl"))).toBe(true);
    expect(paths.some((p) => p.includes("data/sessions/") && p.endsWith("brief.json"))).toBe(true);
    expect(paths.filter((p) => p.includes("data/sessions/") && p.endsWith(".md")).length).toBe(3);
  });

  it("includes every documented master-data collection", () => {
    const paths = Object.keys(plan.files);
    for (const collection of [
      "materials",
      "material_prices",
      "test_definitions",
      "laboratory_standards",
      "laboratory_test_methods",
      "laboratory_trials",
      "stability_studies",
      "stability_samples",
      "regulatory_dossiers",
      "regulatory_dossier_requirements",
      "regulatory_evidence_items",
      "regulatory_requirement_evidence_links",
      "product_claims",
      "product_labels",
      "doe_studies",
      "doe_factors",
      "doe_responses",
      "data_exchange_import_jobs",
    ]) {
      expect(paths).toContain(`data/master/${collection}.json`);
    }
  });

  it("every collection file is a real array (masterdata.rs's one-JSON-array-per-collection convention)", () => {
    for (const [p, content] of Object.entries(plan.files)) {
      if (p.startsWith("data/master/")) expect(Array.isArray(content)).toBe(true);
    }
  });
});

describe("buildDocsFixturePlan — DEMO- prefix discipline", () => {
  const serialized = JSON.stringify(buildDocsFixturePlan());

  it("carries the DEMO- prefix somewhere in the fixture", () => {
    expect(serialized).toContain(DOCS_FIXTURE_PREFIX);
  });

  it("every material/product code minted by this fixture carries DEMO-", () => {
    const plan = buildDocsFixturePlan();
    const materials = plan.files["data/master/materials.json"] as { code: string }[];
    for (const m of materials) expect(m.code.startsWith(DOCS_FIXTURE_PREFIX)).toBe(true);
  });
});

describe("buildDocsFixturePlan — no real/personal data", () => {
  const serialized = JSON.stringify(buildDocsFixturePlan()).toLowerCase();

  it("never contains the real dev machine's username, drive path, or app-data path", () => {
    for (const forbidden of ["sekip", "c:\\users", "c:/users", "appdata", "com.formulab.app"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("never contains an email address", () => {
    expect(serialized).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
