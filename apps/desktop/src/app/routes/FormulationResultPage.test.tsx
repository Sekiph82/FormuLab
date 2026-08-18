import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readSession = vi.fn();
vi.mock("@/lib/formulationV2", () => ({
  readSession: (id: string) => readSession(id),
}));

import { FormulationResultPage } from "./FormulationResultPage";

const SESSION = {
  status: "ok" as const,
  id: "2026-01-01-1200-test",
  brief: { target: "A sulfate-free anti-dandruff shampoo for a sensitive scalp." },
  cards: [
    {
      version: "v1",
      markdown: "# Formulation Card: Balanced",
      formula: {
        name: "Balanced / Recommended",
        purpose: "Best balance of performance, cost, and robustness.",
        ingredients: [
          { inci: "Water (Aqua)", function: "Solvent", weight_pct: "q.s. 100" },
          { inci: "Cocamidopropyl Betaine", function: "Secondary Surfactant", weight_pct: "5.50" },
        ],
        references: [{ author: "Doe J", year: "2021", doi: "10.1/example" }],
        warnings: ["Confirm preservative efficacy with a challenge test."],
      },
      violations: [],
    },
    {
      version: "v2",
      markdown: "# Formulation Card: Cost Optimized",
      formula: { name: "Cost Optimized", purpose: "Lower cost while preserving performance.", ingredients: [] },
      violations: [],
    },
  ],
  read_only: true as const,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/formulation-result/2026-01-01-1200-test"]}>
      <Routes>
        <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FormulationResultPage", () => {
  beforeEach(() => {
    readSession.mockReset();
    readSession.mockResolvedValue(SESSION);
  });

  it("shows the original request fixed at the top, verbatim", async () => {
    renderPage();
    await screen.findByText(SESSION.brief.target);
    expect(screen.getByText("Original Request (Fixed)")).not.toBeNull();
  });

  it("renders one version card per candidate and the Formula tab's ingredient table for the selected one", async () => {
    renderPage();
    // "Balanced / Recommended" legitimately appears twice — once as the V1
    // version-card label, once as the Formula tab's own header for the
    // selected version — both real, both expected.
    await waitFor(() => expect(screen.getAllByText("Balanced / Recommended").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("Cost Optimized")).not.toBeNull();
    expect(screen.getByText("Cocamidopropyl Betaine")).not.toBeNull();
  });

  it("selecting an ingredient row opens the evidence panel scoped to that ingredient's real concentration", async () => {
    renderPage();
    await screen.findByText("Cocamidopropyl Betaine");
    await userEvent.click(screen.getByText("Cocamidopropyl Betaine"));
    expect(screen.getByText("Selected Concentration")).not.toBeNull();
    // "5.50" appears twice once selected — the table cell and the evidence
    // panel's own concentration display — both real, both expected.
    await waitFor(() => expect(screen.getAllByText("5.50").length).toBeGreaterThanOrEqual(2));
  });

  it("switching versions clears the previously selected ingredient's evidence context", async () => {
    renderPage();
    await screen.findByText("Cocamidopropyl Betaine");
    await userEvent.click(screen.getByText("Cocamidopropyl Betaine"));
    await screen.findByText("Selected Concentration");

    await userEvent.click(screen.getByText("Cost Optimized"));
    await waitFor(() => expect(screen.queryByText("Selected Concentration")).toBeNull());
  });

  it("never fabricates a formula-version score — shows it as not yet available instead", async () => {
    renderPage();
    await screen.findByText("Original Request (Fixed)");
    expect(screen.getAllByText(/not yet available/i).length).toBeGreaterThan(0);
  });
});

// --- Phase 14 Session 3: real strategy metadata, scoring, evidence, failure handling ---

const SESSION_V3 = {
  status: "ok" as const,
  id: "2026-01-01-1300-test",
  brief: { target: "A sulfate-free anti-dandruff shampoo for a sensitive scalp." },
  cards: [
    {
      version: "v1",
      status: "ok" as const,
      markdown: "# Formulation Card: Balanced",
      formula: {
        name: "Balanced",
        purpose: "p",
        ingredients: [
          { inci: "Piroctone Olamine", function: "Active", weight_pct: "1.0" },
        ],
      },
      violations: [],
      strategy: {
        formula_version_id: "v1", label: "V1", strategy_type: "balanced",
        title: "Balanced / Recommended",
        rationale: "Always offered as the baseline strategy.",
        primary_priorities: [], secondary_priorities: [], tradeoffs_accepted: [], tradeoffs_forbidden: [],
      },
      evidence_links: [
        {
          formula_version_id: "v1", ingredient_key: "piroctone-olamine", ingredient_raw: "Piroctone Olamine",
          evidence_class: "A", source_depth: "full_text", paper_doi: "10.1/real-paper",
          paper_title: "t", paper_year: "2021", paper_authors: "Doe J", paper_venue: "J",
          unique_source_count: 1, provenance_sources: ["openalex"],
          evidence_text: "Piroctone Olamine at 1.0% reduced flaking.",
          concentration: { value: 1.0, value_max: null, unit: "%", basis: "" },
          outcome: "reduced flaking significantly",
        },
      ],
      concentration_alignment: { "piroctone-olamine": "evidence_supported" },
      score: { hard_constraint_compliance: 1, evidence_strength: 1, formulation_completeness: 1, evidence_gap_penalty: 0, total: 0.8234 },
    },
    {
      version: "v2",
      status: "generation_failed" as const,
      failure_reason: "the model did not return a formula for this strategy slot",
      strategy: {
        formula_version_id: "v2", label: "V2", strategy_type: "cost_optimized",
        title: "Cost Optimized", rationale: "The request explicitly targets an economy cost level.",
        primary_priorities: [], secondary_priorities: [], tradeoffs_accepted: [], tradeoffs_forbidden: [],
      },
    },
  ],
  read_only: true as const,
};

function renderPageV3() {
  readSession.mockReset();
  readSession.mockResolvedValue(SESSION_V3);
  return render(
    <MemoryRouter initialEntries={["/formulation-result/2026-01-01-1300-test"]}>
      <Routes>
        <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FormulationResultPage — Session 3 strategy/score/evidence/failure wiring", () => {
  it("shows the real strategy title and rationale, not the model's own name/purpose", async () => {
    renderPageV3();
    await screen.findByText("Balanced / Recommended");
    expect(screen.getByText("Always offered as the baseline strategy.")).not.toBeNull();
  });

  it("shows a real computed score instead of the not-yet-available placeholder", async () => {
    renderPageV3();
    await screen.findByText("Balanced / Recommended");
    expect(screen.getByText("Score: 82%")).not.toBeNull();
  });

  it("defaults to the first successfully-generated version when v1 failed", async () => {
    // Re-mock with v1 failed, v2 ok, proving the page doesn't open on a dead tab.
    const reordered = {
      ...SESSION_V3,
      cards: [
        { ...SESSION_V3.cards[1], version: "v1" },
        { ...SESSION_V3.cards[0], version: "v2" },
      ],
    };
    readSession.mockReset();
    readSession.mockResolvedValue(reordered);
    render(
      <MemoryRouter initialEntries={["/formulation-result/2026-01-01-1300-test"]}>
        <Routes>
          <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("Balanced / Recommended");
    // The Formula tab must show the real (v2) formula, not a failure notice.
    expect(screen.getByText("Piroctone Olamine")).not.toBeNull();
  });

  it("shows the real failure reason for a failed version instead of a fabricated formula", async () => {
    renderPageV3();
    await screen.findByText("Balanced / Recommended");
    await userEvent.click(screen.getByText("Cost Optimized"));
    expect(screen.getByText("the model did not return a formula for this strategy slot")).not.toBeNull();
  });

  it("evidence panel shows the real linked evidence class and DOI, not a canned insufficient-evidence notice", async () => {
    renderPageV3();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByText("Piroctone Olamine"));
    await waitFor(() => expect(screen.getByText(/Supported by Class A evidence/)).not.toBeNull());
    // The DOI legitimately appears twice — once in the "Why this
    // concentration?" summary line, once in the Supporting Scientific
    // Sources list entry — both real, both expected.
    expect(screen.getAllByText(/10\.1\/real-paper/).length).toBeGreaterThanOrEqual(2);
  });
});

// --- Phase 14 Session 4: mass balance, origin badges, corpus counters, rich stats ---

const SESSION_V4 = {
  status: "ok" as const,
  id: "2026-01-01-1400-test",
  brief: { target: "A sulfate-free anti-dandruff shampoo for a sensitive scalp." },
  cards: [
    {
      version: "v1",
      status: "ok" as const,
      markdown: "# Formulation Card: Balanced",
      formula: {
        name: "Balanced",
        purpose: "p",
        ingredients: [
          { inci: "Water (Aqua)", function: "Solvent", weight_pct: "q.s. 100" },
          { inci: "Sodium Laureth Sulfate", function: "Surfactant", weight_pct: "20.0" },
          { inci: "Piroctone Olamine", function: "Active", weight_pct: "1.0" },
        ],
      },
      violations: [],
      strategy: {
        formula_version_id: "v1", label: "V1", strategy_type: "balanced",
        title: "Balanced", rationale: "r",
        primary_priorities: [], secondary_priorities: [], tradeoffs_accepted: [], tradeoffs_forbidden: [],
      },
      mass_balance: {
        explicit_subtotal: 21.0, qs_ingredient_keys: ["Water (Aqua)"], qs_amount: 79.0,
        final_total: 100.0, status: "complete", issues: [],
      },
      ingredient_origins: {
        "water-aqua": ["ai_formulation_inference"],
        "sodium-laureth-sulfate": ["ai_formulation_inference"],
        "piroctone-olamine": ["scientific_evidence"],
      },
      comparable_stats: {
        "piroctone-olamine": {
          observed_min: 0.8, observed_max: 1.2, median: 1.0,
          unique_study_count: 3, unit: "%", basis: "", confidence: "medium",
        },
      },
      quality_gate: [
        { factor: "unusual_concentration_no_evidence", severity: "info", message: "Sodium Laureth Sulfate at 20.0 has no evidence support." },
      ],
      research_corpus: {
        raw_candidate_count: 120, qualifying_count: 12, target_count: 15,
        full_text_count: 8, abstract_only_count: 4, metadata_only_count: 0,
        evidence_record_count: 22, unique_evidence_study_count: 9,
      },
      evidence_links: [
        {
          formula_version_id: "v1", ingredient_key: "piroctone-olamine", ingredient_raw: "Piroctone Olamine",
          evidence_class: "A", source_depth: "full_text", paper_doi: "10.1/corpus-paper",
          paper_title: "A real corpus paper", paper_year: "2021", paper_authors: "Doe J", paper_venue: "J",
          unique_source_count: 2, provenance_sources: ["openalex", "crossref"],
          evidence_text: "text", concentration: { value: 1.0, value_max: null, unit: "%", basis: "" },
        },
      ],
    },
  ],
  literature: [
    {
      source_db: "openalex", title: "A real corpus paper", year: "2021", authors: "Doe J", venue: "J",
      doi: "10.1/corpus-paper", is_oa: true, oa_url: "", cited_by: 3, pdf_file: "corpus-paper.md",
      unique_source_count: 2, provenance_sources: ["openalex", "crossref"], resolved_via: "unpaywall",
    },
    {
      source_db: "europepmc", title: "Another corpus paper, abstract only", year: "2020", authors: "Smith A",
      venue: "J2", doi: "10.1/abstract-only", is_oa: true, oa_url: "", cited_by: 1,
      fulltext: "open access but no file link published", unique_source_count: 1, provenance_sources: ["europepmc"],
    },
  ],
  read_only: true as const,
};

function renderPageV4() {
  readSession.mockReset();
  readSession.mockResolvedValue(SESSION_V4);
  return render(
    <MemoryRouter initialEntries={["/formulation-result/2026-01-01-1400-test"]}>
      <Routes>
        <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FormulationResultPage — Session 4 provenance/origin/mass-balance/corpus wiring", () => {
  it("shows the deterministic mass-balance total, never the double-counted q.s. bug", async () => {
    renderPageV4();
    await screen.findByText("Piroctone Olamine");
    // 100% (Session 4's real mass_balance.final_total), never 121% (21 + 100 q.s. bug).
    expect(screen.getByText("100% w/w accounted for")).not.toBeNull();
  });

  it("shows an origin badge per ingredient, distinguishing evidence-backed from AI-only", async () => {
    renderPageV4();
    await screen.findByText("Piroctone Olamine");
    expect(screen.getAllByText("Evidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI Inference").length).toBeGreaterThan(0);
  });

  it("selecting an AI-only ingredient discloses the explicit AI-inference warning", async () => {
    renderPageV4();
    await screen.findByText("Sodium Laureth Sulfate");
    await userEvent.click(screen.getByText("Sodium Laureth Sulfate"));
    // The warning legitimately appears twice — once as the panel's own
    // dedicated AI-inference banner, once in the Decision Factors list
    // (both real, both expected, since this ingredient's only origin is
    // ai_formulation_inference).
    await waitFor(() =>
      expect(screen.getAllByText(/AI formulation inference — no direct supporting evidence found/).length).toBeGreaterThanOrEqual(2),
    );
  });

  it("selecting an evidence-backed ingredient shows the real observed range/median/confidence", async () => {
    renderPageV4();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByText("Piroctone Olamine"));
    await waitFor(() => expect(screen.getByText("0.8–1.2%")).not.toBeNull());
    expect(screen.getByText("1%")).not.toBeNull();
  });

  it("Evidence & Sources tab shows real, separate corpus counters — never conflating corpus size with evidence-record count", async () => {
    renderPageV4();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByRole("tab", { name: "Evidence & Sources" }));
    expect(screen.getByText("12 / 15")).not.toBeNull(); // research sources
    expect(screen.getByText("9")).not.toBeNull(); // unique studies
    expect(screen.getByText("22")).not.toBeNull(); // evidence records — a DIFFERENT number
  });

  it("Evidence & Sources tab lists the full research corpus, not just formula-linked papers", async () => {
    renderPageV4();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByRole("tab", { name: "Evidence & Sources" }));
    expect(screen.getByText("A real corpus paper")).not.toBeNull();
    expect(screen.getByText("Another corpus paper, abstract only")).not.toBeNull();
  });

  it("Evidence & Sources tab shows discovered-via and resolved-via provenance in the expanded source detail", async () => {
    renderPageV4();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByRole("tab", { name: "Evidence & Sources" }));
    await userEvent.click(screen.getByText("A real corpus paper"));
    expect(screen.getAllByText("A real corpus paper").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("openalex + crossref")).not.toBeNull();
    expect(screen.getByText("unpaywall")).not.toBeNull();
  });

  it("Summary tab shows the real decomposed score factors and quality notes", async () => {
    renderPageV4();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getByText(/no evidence support/)).not.toBeNull();
  });
});

// --- Phase 14 Session 5 (Phase 15 zero-LLM round): manufacturing wiring ---

const SESSION_V5 = {
  status: "ok" as const,
  id: "2026-01-01-1500-test",
  brief: { target: "A sulfate-free anti-dandruff shampoo for a sensitive scalp." },
  cards: [
    {
      version: "v1",
      status: "ok" as const,
      markdown: "# Formulation Card: Balanced",
      formula: {
        name: "Balanced", purpose: "p",
        ingredients: [{ inci: "Water (Aqua)", function: "Solvent", weight_pct: "q.s. 100" }],
      },
      violations: [],
      strategy: {
        formula_version_id: "v1", label: "V1", strategy_type: "balanced",
        title: "Balanced", rationale: "r",
        primary_priorities: [], secondary_priorities: [], tradeoffs_accepted: [], tradeoffs_forbidden: [],
      },
      manufacturing: {
        ready: true, not_ready_reason: "",
        batch_scale: "pilot" as const,
        steps: [
          {
            order: 1, phase: "Aqueous Phase Preparation", role: "solvent", ingredients: ["Water (Aqua)"],
            instruction: "Charge the solvent (water) to the main mixing vessel first.",
            equipment: "", mixing_method: "Not established — laboratory validation required",
            temperature_c: null, time_minutes: null,
            endpoint: "Uniform dispersion, no visible undissolved material.",
            basis: "deterministic_rule", evidence_doi: "", confidence: "not_established" as const,
          },
          {
            order: 2, phase: "Surfactant Addition", role: "primary_surfactant", ingredients: ["Decyl Glucoside"],
            instruction: "Add the primary surfactant under moderate agitation.",
            equipment: "", mixing_method: "homogenized", temperature_c: 40, time_minutes: 15,
            endpoint: "Per reported method: homogenized.",
            basis: "scientific_evidence", evidence_doi: "10.1/real-process-paper", confidence: "established" as const,
          },
        ],
        critical_parameters: [
          {
            parameter: "Total batch mass balance", param_type: "critical_limit" as const,
            range_or_limit: "100.0% w/w", source_type: "deterministic_rule",
            why_it_matters: "Batch quantities and ingredient ratios are only correct if the formula sums to 100% w/w.",
            consequence_if_violated: "Under- or over-filled batch; every ingredient's real proportion is wrong.",
            confidence: "established" as const, evidence_doi: "",
          },
          {
            parameter: "pH", param_type: "target" as const,
            range_or_limit: "5.0-5.5", source_type: "user_required",
            why_it_matters: "Affects skin/scalp compatibility, active/surfactant stability, and preservative efficacy.",
            consequence_if_violated: "Irritation risk, reduced preservative efficacy, potential instability.",
            confidence: "established" as const, evidence_doi: "",
          },
        ],
        equipment: [
          {
            equipment: "Main Mixing Vessel", purpose: "Hold and mix the aqueous base and the finished batch.",
            requirement_level: "required" as const, suggested_capacity: "Pilot scale — exact capacity depends on the facility's own pilot vessel.",
            key_capabilities: ["agitation"], used_in_steps: ["Aqueous Phase Preparation"],
            available_in_facility: "yes" as const, basis: "deterministic_rule", confidence: "established" as const,
          },
          {
            equipment: "Calibrated pH Meter", purpose: "Verify and adjust pH against the target range.",
            requirement_level: "required" as const, suggested_capacity: "Pilot scale — exact capacity depends on the facility's own pilot vessel.",
            key_capabilities: ["pH measurement"], used_in_steps: ["pH Adjustment"],
            available_in_facility: "missing" as const, basis: "deterministic_rule", confidence: "established" as const,
          },
        ],
      },
    },
    {
      version: "v2",
      status: "ok" as const,
      markdown: "# Formulation Card: Invalid",
      formula: {
        name: "Invalid", purpose: "p",
        ingredients: [{ inci: "Water (Aqua)", function: "Solvent", weight_pct: "150.0" }],
      },
      violations: [],
      strategy: {
        formula_version_id: "v2", label: "V2", strategy_type: "cost_optimized",
        title: "Cost Optimized", rationale: "r",
        primary_priorities: [], secondary_priorities: [], tradeoffs_accepted: [], tradeoffs_forbidden: [],
      },
      manufacturing: {
        ready: false,
        not_ready_reason: "This formula version's state is 'invalid_mass_balance' — manufacturing process planning requires a valid formula first.",
        steps: [], critical_parameters: [], equipment: [], batch_scale: "not_specified" as const,
      },
    },
  ],
  read_only: true as const,
};

function renderPageV5() {
  readSession.mockReset();
  readSession.mockResolvedValue(SESSION_V5);
  return render(
    <MemoryRouter initialEntries={["/formulation-result/2026-01-01-1500-test"]}>
      <Routes>
        <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FormulationResultPage — Session 5 manufacturing wiring", () => {
  it("Manufacturing Procedure tab shows real, role-ordered steps with their real basis", async () => {
    renderPageV5();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Manufacturing Procedure" }));
    expect(screen.getByText("Charge the solvent (water) to the main mixing vessel first.")).not.toBeNull();
    expect(screen.getByText("Add the primary surfactant under moderate agitation.")).not.toBeNull();
    expect(screen.getByText("40°C")).not.toBeNull();
  });

  it("Critical Parameters tab distinguishes Target from Critical Limit", async () => {
    renderPageV5();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Critical Parameters" }));
    expect(screen.getByText("Total batch mass balance")).not.toBeNull();
    expect(screen.getByText("Critical Limit")).not.toBeNull();
    expect(screen.getByText("Target")).not.toBeNull();
  });

  it("Equipment tab shows real availability against the user's own equipment text", async () => {
    renderPageV5();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Equipment" }));
    expect(screen.getByText("Main Mixing Vessel")).not.toBeNull();
    expect(screen.getByText("Available")).not.toBeNull();
    expect(screen.getByText("Missing")).not.toBeNull();
  });

  it("shows a not-ready notice instead of a fabricated plan for an invalid formula version", async () => {
    renderPageV5();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByText("Cost Optimized"));
    await userEvent.click(screen.getByRole("tab", { name: "Manufacturing Procedure" }));
    expect(screen.getByText(/requires a valid formula/)).not.toBeNull();
  });
});

// --- Phase 14 Session 6: Safety / Regulatory / evidence-gap wiring ---

const SESSION_V6 = {
  status: "ok" as const,
  id: "2026-01-01-1600-test",
  brief: { target: "Hand soap with rosemary scent" },
  cards: [
    {
      version: "v1",
      status: "ok" as const,
      markdown: "# Formulation Card: Balanced",
      formula: {
        name: "Balanced", purpose: "p",
        ingredients: [{ inci: "Water (Aqua)", function: "Solvent", weight_pct: "q.s. 100" }],
      },
      violations: [],
      strategy: {
        formula_version_id: "v1", label: "V1", strategy_type: "balanced",
        title: "Balanced", rationale: "r",
        primary_priorities: [], secondary_priorities: [], tradeoffs_accepted: [], tradeoffs_forbidden: [],
      },
      formula_state: "complete_with_validation_required" as const,
      safety: {
        overall_status: "PASS_WITH_CONDITIONS" as const,
        findings: [
          {
            subject_type: "ingredient" as const, subject: "Sodium Hydroxide",
            status: "PASS_WITH_CONDITIONS" as const, rule_id: "SAFETY-CORR-001",
            source_type: "deterministic_rule", condition: "corrosive in concentrate form",
            actual_value: "0.1", rationale: "Corrosive in concentrate form.",
            required_action: "Use PPE.",
          },
        ],
      },
      regulatory: {
        target_market: "kenya", jurisdiction: "KE", coverage: "partial" as const,
        overall_status: "COMPLIANT_WITH_CONDITIONS" as const,
        findings: [
          {
            subject_type: "label" as const, subject: "required label elements",
            status: "COMPLIANT_WITH_CONDITIONS" as const, rule_id: "KE-REG-003", jurisdiction: "KE",
            condition: "net content, batch code", actual_value: "", rationale: "KEBS label requirement.",
            required_action: "Ensure label carries these elements.",
          },
        ],
        claims: [
          { claim: "rosemary", check_type: "formulation_condition" as const, status: "DATA_INCOMPLETE" as const, rationale: "not checked" },
        ],
        missing_coverage_note: "FormuLab has real but draft/not-yet-verified regulatory rule data for KE.",
      },
      evidence_gaps: [
        { category: "missing_functional_role", gap: "Primary Surfactant: no non-excluded candidate in the pool fills this required role" },
      ],
      validation_plan: [
        { check: "Laboratory batch", rule_id: "VAL-010", reason: "Baseline requirement for any newly generated formula." },
      ],
      trace_events: [
        {
          decision_id: "trace-v1-0001", formula_version_id: "v1", decision_type: "ingredient_rejected",
          subject_type: "ingredient" as const, subject: "Sodium Laureth Sulfate", result: "rejected" as const,
          rationale: "Excluded: user requested sulfate-free.", source_type: "deterministic_rule",
        },
      ],
    },
  ],
  read_only: true as const,
};

function renderPageV6() {
  readSession.mockReset();
  readSession.mockResolvedValue(SESSION_V6);
  return render(
    <MemoryRouter initialEntries={["/formulation-result/2026-01-01-1600-test"]}>
      <Routes>
        <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FormulationResultPage — Session 6 Safety/Regulatory/evidence-gap wiring", () => {
  it("Safety tab shows real findings with a visible status and rule id", async () => {
    renderPageV6();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Safety" }));
    expect(screen.getByText("Sodium Hydroxide")).not.toBeNull();
    expect(screen.getByText(/SAFETY-CORR-001/)).not.toBeNull();
  });

  it("Regulatory tab shows the real target market and coverage", async () => {
    renderPageV6();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Regulatory" }));
    expect(screen.getByText("kenya")).not.toBeNull();
    expect(screen.getByText(/KE-REG-003/)).not.toBeNull();
  });

  it("Regulatory tab claim review shows the real check type", async () => {
    renderPageV6();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Regulatory" }));
    expect(screen.getByText("rosemary")).not.toBeNull();
  });

  it("Summary tab shows real evidence gaps, never generic filler text", async () => {
    renderPageV6();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getByText(/no non-excluded candidate/)).not.toBeNull();
  });

  it("Summary tab shows real safety/regulatory/formula-state readiness badges", async () => {
    renderPageV6();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getAllByText("PASS WITH CONDITIONS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("COMPLIANT WITH CONDITIONS").length).toBeGreaterThan(0);
  });

  it("Summary tab shows real decision-traceability events, including rejected candidates", async () => {
    renderPageV6();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getByText("Sodium Laureth Sulfate")).not.toBeNull();
    expect(screen.getByText(/user requested sulfate-free/)).not.toBeNull();
  });
});

// 2026-08-17 correction: a partial research corpus (10-14 full texts) no
// longer blocks formulation — the result screen opens normally, never the
// error page, with a visible disclosure.
const SESSION_PARTIAL_RESEARCH = {
  status: "ok" as const,
  id: "2026-01-02-0900-test",
  brief: { target: "Anti-dandruff shampoo" },
  cards: [
    {
      version: "v1",
      status: "ok" as const,
      markdown: "# Formulation Card: Balanced",
      formula: {
        name: "Balanced", purpose: "p",
        ingredients: [{ inci: "Water (Aqua)", function: "Solvent", weight_pct: "q.s. 100" }],
      },
      violations: [],
      strategy: {
        formula_version_id: "v1", label: "V1", strategy_type: "balanced",
        title: "Balanced", rationale: "r",
        primary_priorities: [], secondary_priorities: [], tradeoffs_accepted: [], tradeoffs_forbidden: [],
      },
      formula_state: "complete" as const,
      research_corpus: {
        raw_candidate_count: 120, qualifying_count: 21, target_count: 15,
        full_text_count: 14, abstract_only_count: 7, metadata_only_count: 0,
        evidence_record_count: 10, unique_evidence_study_count: 5,
        full_text_gate_met: false, status: "partial" as const,
      },
      evidence_gaps: [
        { category: "insufficient_full_text", gap: "Full-text sources: 14/15 target — 7 abstract-only, 0 metadata-only." },
      ],
    },
  ],
  read_only: true as const,
};

function renderPagePartial() {
  readSession.mockReset();
  readSession.mockResolvedValue(SESSION_PARTIAL_RESEARCH);
  return render(
    <MemoryRouter initialEntries={["/formulation-result/2026-01-02-0900-test"]}>
      <Routes>
        <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FormulationResultPage — partial research corpus (2026-08-17 correction)", () => {
  it("opens the real formula result, never the error page, for a partial-corpus session", async () => {
    renderPagePartial();
    await screen.findByText("Water (Aqua)");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a visible partial-research-corpus notice with the real counter", async () => {
    renderPagePartial();
    await screen.findByText("Water (Aqua)");
    expect(screen.getByText("Partial research corpus")).not.toBeNull();
    expect(screen.getByText(/14 \/ 15/)).not.toBeNull();
  });

  it("still shows the real insufficient_full_text evidence gap alongside the notice", async () => {
    renderPagePartial();
    await screen.findByText("Water (Aqua)");
    await userEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getByText(/14\/15 target/)).not.toBeNull();
  });
});

// FormuLab v1 correction (FVL-03): scientific formulation architecture
// priority, adaptation traceability, and the redesigned Evidence &
// Sources UI (compact primary table + full-width detail panel).
const LONG_TITLE = "Formulation and Evaluation of a Real, Genuinely Long Academic Paper Title That Must Never Be Ellipsized Beyond Recognition in the Primary Sources Table";

const SESSION_SCIENTIFIC = {
  status: "ok" as const,
  id: "2026-08-17-1800-test",
  brief: { target: "anti-dandruff shampoo" },
  cards: [
    {
      version: "v1",
      status: "ok" as const,
      markdown: "# Formulation Card",
      formula: {
        name: "Adapted", purpose: "p",
        ingredients: [
          { inci: "Water (Aqua)", function: "Solvent", weight_pct: "q.s. 100" },
          { inci: "Piroctone Olamine", function: "Active Treatment", weight_pct: "1.0" },
        ],
      },
      violations: [],
      strategy: {
        formula_version_id: "v1", label: "V1", strategy_type: "balanced",
        title: "Adapted", rationale: "r",
        primary_priorities: [], secondary_priorities: [], tradeoffs_accepted: [], tradeoffs_forbidden: [],
      },
      formula_state: "complete" as const,
      architecture_basis: {
        origin: "scientific_formulation_adapted" as const,
        reason: "", source_paper_doi: "10.20431/2455-1538.0402005", source_title: LONG_TITLE,
        source_formulation_id: "F1", retained: 3, modified: 1, added: 2, removed: 1,
      },
      trace_events: [
        {
          decision_id: "trace-v1-0001", formula_version_id: "v1", decision_type: "ingredient_rejected",
          subject_type: "ingredient" as const, subject: "Sodium Lauryl Sulfate", result: "rejected" as const,
          rationale: "excluded: matches a deterministically excluded ingredient — removed from the scientific formulation architecture F1 (10.20431/2455-1538.0402005)",
          source_type: "deterministic_rule",
        },
      ],
    },
  ],
  literature: [{
    source_db: "openalex", title: LONG_TITLE, year: "2017", authors: "A. Author",
    venue: "ARC Journal", doi: "10.20431/2455-1538.0402005", is_oa: true, oa_url: "",
    cited_by: 3, pdf_file: "10.20431_2455-1538.0402005.pdf", provenance_sources: ["openalex"],
  }],
  scientific_formulations: {
    formulations: [{
      id: "cp1:F1", canonical_paper_id: "cp1", doi: "10.20431/2455-1538.0402005",
      source_title: LONG_TITLE, source_year: "2017", source_authors: "A. Author",
      table_reference: "Table1. Formulation of Herbal Anti-Dandruff Shampoo",
      source_formulation_id: "F1", product_type: "shampoo", formulation_title: "",
      ingredients: [
        { source_name: "Neem oil", value: 0.5, value_text: "0.5", unit: "", qs: false, order: 0, normalized_key: null, material_id: null, identity_status: "unresolved_material_identity" as const },
        { source_name: "Sodium Lauryl Sulfate", value: 20, value_text: "20", unit: "g", qs: false, order: 1, normalized_key: "sodium-lauryl-sulfate", material_id: null, identity_status: "resolved_known_ingredient" as const },
      ],
      total_declared: "100ml", evidence_class: "A" as const, extraction_confidence: "high" as const,
      missing_fields: [], unresolved_rows: [],
    }],
    outcomes: [
      { source_formulation_id: "F1", metric: "viscosity_cp", value: 95733.33, unit: "", condition: "0.3", raw_text: "0.3 95733.33" },
    ],
    summary: {
      extracted_count: 5, with_outcomes_count: 5,
      architectures_used: [{ doi: "10.20431/2455-1538.0402005", source_title: LONG_TITLE, source_formulation_id: "F1" }],
      architectures_rejected: [],
      all_selected_versions_rule_only: false,
      rule_only_despite_applicable_scientific_formulation: false,
    },
  },
  read_only: true as const,
};

function renderPageScientific() {
  readSession.mockReset();
  readSession.mockResolvedValue(SESSION_SCIENTIFIC);
  return render(
    <MemoryRouter initialEntries={["/formulation-result/2026-08-17-1800-test"]}>
      <Routes>
        <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FormulationResultPage — scientific formulation architecture (FVL-03)", () => {
  it("Formula tab shows the real architecture basis: source, formulation ID, and adaptation counts", async () => {
    renderPageScientific();
    await screen.findByText("Piroctone Olamine");
    expect(screen.getByText("Scientific Formulation (Adapted)")).not.toBeNull();
    expect(screen.getByText(/10.20431\/2455-1538.0402005/)).not.toBeNull();
    expect(screen.getByText(/F1/)).not.toBeNull();
    expect(screen.getByText("Retained: 3")).not.toBeNull();
    expect(screen.getByText("Modified: 1")).not.toBeNull();
    expect(screen.getByText("Added: 2")).not.toBeNull();
    expect(screen.getByText("Removed: 1")).not.toBeNull();
  });

  it("Summary tab traceability shows the real adaptation rejection referencing the source architecture", async () => {
    renderPageScientific();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getByText(/removed from the scientific formulation architecture F1/)).not.toBeNull();
  });

  it("Evidence & Sources primary table never ellipsizes a long real title", async () => {
    renderPageScientific();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByRole("tab", { name: "Evidence & Sources" }));
    const titleEl = screen.getByText(LONG_TITLE);
    expect(titleEl).not.toBeNull();
    expect(titleEl.className).not.toMatch(/truncate/);
  });

  it("Alternatives tab shows the real selected architecture, never the not-yet-available placeholder", async () => {
    renderPageScientific();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByRole("tab", { name: "Alternatives" }));
    expect(screen.getByText("Selected Architectures")).not.toBeNull();
    expect(screen.getAllByText("Scientific Formulation (Adapted)").length).toBeGreaterThan(0);
    expect(screen.queryByText(/not yet generated/)).toBeNull();
  });

  it("Evidence & Sources source detail shows extracted scientific formulations with ingredients and results", async () => {
    renderPageScientific();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByRole("tab", { name: "Evidence & Sources" }));
    await userEvent.click(screen.getByText(LONG_TITLE));
    expect(screen.getByText("Extracted Formulations")).not.toBeNull();
    await userEvent.click(screen.getByText("F1"));
    expect(screen.getByText("Neem oil")).not.toBeNull();
    expect(screen.getByText("Sodium Lauryl Sulfate")).not.toBeNull();
    expect(screen.getByText(/viscosity_cp/)).not.toBeNull();
  });
});

// --- FormuLab v1 (FVL-02): dynamic 3-7 result version selector ---

function makeCard(version: string, name: string) {
  return {
    version,
    markdown: `# Formulation Card: ${name}`,
    formula: {
      name,
      purpose: `${name} purpose.`,
      ingredients: [
        { inci: "Water (Aqua)", function: "Solvent", weight_pct: "q.s. 100" },
        { inci: `${name} Active`, function: "Active", weight_pct: "1.00" },
      ],
    },
    violations: [],
  };
}

function sessionWithCards(count: number) {
  return {
    status: "ok" as const,
    id: "2026-01-01-1300-test",
    brief: { target: "A test request for dynamic version rendering." },
    cards: Array.from({ length: count }, (_, i) => makeCard(`v${i + 1}`, `Version ${i + 1}`)),
    read_only: true as const,
  };
}

function renderResultPage() {
  return render(
    <MemoryRouter initialEntries={["/formulation-result/2026-01-01-1300-test"]}>
      <Routes>
        <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// --- FVL-03.007: system substitution multi-select entry point ---

describe("FormulationResultPage — FVL-03.007 system substitution selection", () => {
  beforeEach(() => {
    readSession.mockReset();
    readSession.mockResolvedValue(SESSION);
  });

  it("shows a selection checkbox per ingredient row, and a disabled action until 2+ are selected", async () => {
    renderPage();
    await screen.findByText("Cocamidopropyl Betaine");
    const checkboxes = screen.getAllByRole("checkbox", { name: "System substitution" });
    expect(checkboxes.length).toBe(2); // Water + Cocamidopropyl Betaine

    const action = screen.getByRole("button", { name: "System substitution" });
    expect(action).toBeDisabled();

    await userEvent.click(checkboxes[0]);
    expect(action).toBeDisabled(); // still only one selected — a one-material problem must not reach system mode

    await userEvent.click(checkboxes[1]);
    expect(action).toBeEnabled();
  });

  it("unchecking a selected ingredient drops back below the 2-ingredient minimum and disables the action again", async () => {
    renderPage();
    await screen.findByText("Cocamidopropyl Betaine");
    const checkboxes = screen.getAllByRole("checkbox", { name: "System substitution" });
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);
    expect(screen.getByRole("button", { name: "System substitution" })).toBeEnabled();

    await userEvent.click(checkboxes[0]);
    expect(screen.getByRole("button", { name: "System substitution" })).toBeDisabled();
  });

  it("clicking an ingredient row's checkbox never also opens that ingredient's evidence panel", async () => {
    renderPage();
    await screen.findByText("Cocamidopropyl Betaine");
    const checkboxes = screen.getAllByRole("checkbox", { name: "System substitution" });
    await userEvent.click(checkboxes[1]);
    expect(screen.queryByText("Selected Concentration")).toBeNull();
  });

  it("selecting ingredients on one version and switching versions never leaks the selection into another version", async () => {
    renderPage();
    await screen.findByText("Cocamidopropyl Betaine");
    const checkboxes = screen.getAllByRole("checkbox", { name: "System substitution" });
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);
    expect(screen.getByRole("button", { name: "System substitution" })).toBeEnabled();

    // V2 in this fixture has zero ingredients — its own fresh (empty)
    // selection state means the action is disabled again, proving V1's
    // selection never carried across.
    await userEvent.click(screen.getByText("Cost Optimized"));
    expect(screen.getByRole("button", { name: "System substitution" })).toBeDisabled();
    expect(screen.queryAllByRole("checkbox", { name: "System substitution" }).length).toBe(0);
  });
});

describe("FormulationResultPage — dynamic 3-7 version selector", () => {
  beforeEach(() => {
    readSession.mockReset();
  });

  it.each([3, 4, 5, 6, 7])("renders exactly %i version cards, each showing its own formula", async (count) => {
    readSession.mockResolvedValue(sessionWithCards(count));
    renderResultPage();
    await waitFor(() => expect(screen.getAllByText("Version 1").length).toBeGreaterThanOrEqual(2));
    for (let i = 1; i <= count; i++) {
      expect(screen.getAllByText(`Version ${i}`).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("switching from V1 to V7 updates the active formula and clears stale selected-ingredient state", async () => {
    readSession.mockResolvedValue(sessionWithCards(7));
    renderResultPage();
    await waitFor(() => expect(screen.getAllByText("Version 1").length).toBeGreaterThanOrEqual(2));
    await userEvent.click(screen.getByText("Version 1 Active"));
    await screen.findByText("Selected Concentration");

    await userEvent.click(screen.getAllByText("Version 7")[0]);
    await waitFor(() => expect(screen.queryByText("Selected Concentration")).toBeNull());
    await waitFor(() => expect(screen.getAllByText("Version 7").length).toBeGreaterThanOrEqual(2));
  });

  it("keeps exactly one version active at a time for a 7-version session", async () => {
    readSession.mockResolvedValue(sessionWithCards(7));
    renderResultPage();
    await waitFor(() => expect(screen.getAllByText("Version 1").length).toBeGreaterThanOrEqual(2));
    const selectedBadges = screen.getAllByText("Selected");
    expect(selectedBadges.length).toBe(1);
  });
});
