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
      unique_source_count: 2, provenance_sources: ["openalex", "crossref"],
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

  it("Summary tab shows the real decomposed score factors and quality notes", async () => {
    renderPageV4();
    await screen.findByText("Piroctone Olamine");
    await userEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getByText(/no evidence support/)).not.toBeNull();
  });
});
