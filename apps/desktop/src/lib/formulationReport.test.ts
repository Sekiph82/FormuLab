import { describe, expect, it } from "vitest";
import { buildReportHtml } from "./formulationReport";
import type { SessionDetail } from "./formulationV2";

function card(version: string, inci: string) {
  return {
    version, status: "ok" as const,
    formula: { name: version, purpose: "p", ingredients: [{ inci, function: "Primary Surfactant", weight_pct: "10" }] },
    violations: [],
    strategy: {
      formula_version_id: version, label: version.toUpperCase(), strategy_type: "balanced",
      title: `${version} strategy`, rationale: "r",
      primary_priorities: [], secondary_priorities: [], tradeoffs_accepted: [], tradeoffs_forbidden: [],
    },
    formula_state: "complete" as const,
    mass_balance: { explicit_subtotal: 10, qs_ingredient_keys: [], qs_amount: 90, final_total: 100, status: "complete" as const, issues: [] },
    ingredient_origins: { [inci.toLowerCase()]: ["scientific_evidence"] },
    manufacturing: {
      ready: true, not_ready_reason: "",
      steps: [{ order: 1, phase: "Surfactant Addition", role: "primary_surfactant", ingredients: [inci], instruction: "Add.", equipment: "", mixing_method: "", temperature_c: null, time_minutes: null, endpoint: "", basis: "deterministic_rule", evidence_doi: "", confidence: "not_established" as const }],
      critical_parameters: [{ parameter: "pH", param_type: "target" as const, range_or_limit: "5-6", source_type: "user_required", why_it_matters: "x", consequence_if_violated: "y", confidence: "established" as const, evidence_doi: "" }],
      equipment: [{ equipment: "Main Vessel", purpose: "mix", requirement_level: "required" as const, suggested_capacity: "lab", key_capabilities: [], used_in_steps: [], available_in_facility: "yes" as const, basis: "deterministic_rule", confidence: "established" as const }],
      batch_scale: "laboratory" as const,
    },
    safety: { overall_status: "PASS" as const, findings: [] },
    regulatory: { target_market: "kenya", jurisdiction: "KE", coverage: "partial" as const, overall_status: "COMPLIANT_WITH_CONDITIONS" as const, findings: [], claims: [], missing_coverage_note: "note" },
    evidence_gaps: [{ category: "test_gap", gap: "a real gap" }],
    validation_plan: [{ check: "Laboratory batch", rule_id: "VAL-010", reason: "baseline" }],
    quality_gate: [],
  };
}

const SESSION: SessionDetail = {
  status: "ok", id: "2026-01-01-test",
  brief: { target: "hand soap with rosemary scent" },
  cards: [card("v1", "Decyl Glucoside"), card("v2", "Cocamidopropyl Betaine"), card("v3", "Sodium Cocoyl Isethionate")],
  literature: Array.from({ length: 15 }, (_, i) => ({
    source_db: "openalex", title: `Source ${i}`, year: "2021", authors: "A", venue: "J",
    doi: `10.1/${i}`, is_oa: true, oa_url: "", cited_by: 0,
    pdf_file: i < 5 ? `${i}.pdf` : undefined, provenance_sources: ["openalex", "crossref"],
    resolved_via: i < 5 ? "unpaywall" : undefined,
  })),
  read_only: true,
};

describe("buildReportHtml", () => {
  it("includes all three formula versions, independent of any current UI tab", () => {
    const html = buildReportHtml(SESSION, "2026-01-01-test");
    expect(html).toContain("V1");
    expect(html).toContain("V2");
    expect(html).toContain("V3");
    expect(html).toContain("Decyl Glucoside");
    expect(html).toContain("Cocamidopropyl Betaine");
    expect(html).toContain("Sodium Cocoyl Isethionate");
  });

  it("includes all 15 sources", () => {
    const html = buildReportHtml(SESSION, "2026-01-01-test");
    for (let i = 0; i < 15; i++) {
      expect(html).toContain(`Source ${i}`);
    }
  });

  it("includes manufacturing, critical parameters, and equipment for every version", () => {
    const html = buildReportHtml(SESSION, "2026-01-01-test");
    expect((html.match(/Manufacturing Procedure/g) ?? []).length).toBe(3);
    expect((html.match(/Critical Parameters/g) ?? []).length).toBe(3);
    expect((html.match(/Equipment/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("includes safety, regulatory, evidence gaps, and validation plan sections", () => {
    const html = buildReportHtml(SESSION, "2026-01-01-test");
    expect(html).toContain("Safety");
    expect(html).toContain("Regulatory");
    expect(html).toContain("Evidence Gaps");
    expect(html).toContain("a real gap");
    expect(html).toContain("Validation Plan");
    expect(html).toContain("Laboratory batch");
  });

  it("uses print-safe CSS with no fixed-height/clipped containers, real page breaks", () => {
    const html = buildReportHtml(SESSION, "2026-01-01-test");
    expect(html).toContain("page-break-before");
    expect(html).not.toMatch(/overflow:\s*hidden/);
    expect(html).not.toMatch(/height:\s*\d+px/);
  });

  it("original request and research summary are present", () => {
    const html = buildReportHtml(SESSION, "2026-01-01-test");
    expect(html).toContain("hand soap with rosemary scent");
  });

  it("discloses a partial research-corpus status explicitly (2026-08-17 correction)", () => {
    const partialCard = card("v1", "Decyl Glucoside");
    (partialCard as unknown as { research_corpus: Record<string, unknown> }).research_corpus = {
      raw_candidate_count: 120, qualifying_count: 21, target_count: 15,
      full_text_count: 14, abstract_only_count: 7, metadata_only_count: 0,
      evidence_record_count: 10, unique_evidence_study_count: 5,
      full_text_gate_met: false, status: "partial",
    };
    const session: SessionDetail = { ...SESSION, cards: [partialCard, card("v2", "b"), card("v3", "c")] };
    const html = buildReportHtml(session, "2026-01-01-test");
    expect(html).toContain("Research Corpus Status");
    expect(html).toContain("partial");
    expect(html).toContain("Successful Full Texts: 14");
    expect(html).toContain("Preferred Target: 15");
    expect(html).toContain("search budget was exhausted");
  });
});
