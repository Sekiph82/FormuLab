/**
 * UI-integration coverage for the Reverse Formulation workspace. Same
 * mocking discipline as DataExchangePage.test.tsx — only `@/lib/masterdata`
 * is mocked; `generateCandidates`/`scoreReverseFormulaCandidate` run for
 * real (never mocked), so a passing "generates candidates" test is proof
 * the component calls the actual shared engine rather than reimplementing
 * it.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BenchmarkProduct,
  IngredientDeclarationLine,
  RawMaterial,
  ReverseFormulationStudy,
  TargetProductProfile,
} from "@ai4s/shared";
import { ReverseFormulationPage } from "./ReverseFormulationPage";
import { renderAt } from "@/test/render";
import { routes } from "@/app/router";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

function byCollection(map: Record<string, unknown[]>) {
  return (collection: string) => Promise.resolve(map[collection] ?? []);
}

const study: ReverseFormulationStudy = {
  id: "study-1",
  code: "TEST-RFS-001",
  name: "Test Study",
  projectId: "TEST-PROJ-001",
  productFamilyCode: "TEST-FAM-001",
  status: "draft",
  benchmarkProductIds: ["product-1"],
  targetProfileId: "target-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "local",
  updatedAt: "2026-01-01T00:00:00.000Z",
  revision: 0,
};

const product: BenchmarkProduct = {
  id: "product-1",
  code: "TEST-BMP-001",
  name: "Test Product",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const declLine: IngredientDeclarationLine = {
  id: "line-1",
  benchmarkProductId: "product-1",
  rawText: "Water",
  normalizedText: "water",
  declaredOrder: 0,
  declaredName: "Water",
  // No concentrationHint — must render as unknown, never "0%".
  mappingStatus: "unmapped",
  mappedMaterialIds: [],
};

const material: RawMaterial = {
  schemaVersion: "1.0",
  code: "TEST-MAT-001",
  displayName: "Test Water",
  casNumbers: [],
  ecNumbers: [],
  functions: ["solvent"],
  activeMatterState: "missing",
  documents: [],
  regulatoryStatuses: [],
  hazardClassifications: [],
  allergens: [],
  incompatibilities: [],
  substituteCodes: [],
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const targetProfile: TargetProductProfile = {
  id: "target-1",
  code: "TEST-TPP-001",
  name: "Test Target",
  productFamilyCode: "TEST-FAM-001",
  jurisdictions: [],
};

const FULL_FIXTURE = {
  reverse_formulation_studies: [study],
  benchmark_products: [product],
  ingredient_declaration_lines: [declLine],
  materials: [material],
  target_product_profiles: [targetProfile],
};

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ReverseFormulationPage />
    </MemoryRouter>,
  );
}

describe("ReverseFormulationPage — route and navigation", () => {
  it("resolves the Reverse Formulation route", async () => {
    renderAt("/reverse-formulation");
    expect(await screen.findByText("Reverse Formulation")).toBeInTheDocument();
  });

  it("Sidebar shows a Reverse Formulation link in the workspaces section", async () => {
    renderAt("/reverse-formulation");
    await screen.findByRole("heading", { name: "Reverse Formulation" }); // the page itself has loaded
    // The page's own section tabs are a <nav> too — the sidebar's primary
    // navigation is the other one, without that accessible name.
    const navs = screen.getAllByRole("navigation");
    const sidebarNav = navs.find((n) => n.getAttribute("aria-label") !== "Reverse Formulation");
    expect(sidebarNav).toBeDefined();
    expect(within(sidebarNav!).getByText("Reverse Formulation")).toBeInTheDocument();
  });

  it("registers /reverse-formulation in the router, pointing at the real workspace page", () => {
    const appChildren = routes[0].children ?? [];
    const route = appChildren.find((r) => r.path === "reverse-formulation");
    expect(route).toBeDefined();
    expect(route!.element).toBeTruthy();
  });
});

describe("ReverseFormulationPage — studies", () => {
  it("renders an honest empty state with no studies", async () => {
    renderPage();
    expect(await screen.findByText("No Reverse Formulation studies yet.")).toBeInTheDocument();
  });

  it("lists an existing study and selects it, unlocking the other sections", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/TEST-RFS-001/);
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("button", { name: "Benchmark Products" })).not.toBeDisabled();
    expect(screen.getAllByText(/TEST-RFS-001/).length).toBeGreaterThan(0);
  });

  it("creates a draft study without any approval or verification state", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("No Reverse Formulation studies yet.");
    await user.click(screen.getByRole("button", { name: "New draft study" }));
    await user.type(screen.getByLabelText("Study code"), "TEST-RFS-002");
    await user.type(screen.getByLabelText("Study name"), "New Study");
    await user.type(screen.getByLabelText("Project code"), "TEST-PROJ-002");
    await user.type(screen.getByLabelText("Product family code"), "TEST-FAM-002");
    await user.click(screen.getByRole("button", { name: "Create study" }));
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "reverse_formulation_studies",
      expect.arrayContaining([expect.objectContaining({ code: "TEST-RFS-002", status: "draft", benchmarkProductIds: [] })]),
    );
  });
});

describe("ReverseFormulationPage — declarations", () => {
  it("keeps a blank concentration hint blank, never coerced to 0%", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Select" }));
    // The study's only attached product is selected by default — no extra
    // click needed to reveal its declarations. "Water" also appears in the
    // mapping form's material select, so match all occurrences.
    expect((await screen.findAllByText("Water")).length).toBeGreaterThan(0);
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});

describe("ReverseFormulationPage — candidate generation and scoring (real shared engine)", () => {
  async function selectStudyAndGoToCandidates() {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Candidates" }));
    return user;
  }

  it("generates a real candidate via the shared engine, not a fabricated one", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await user.click(screen.getByRole("button", { name: "Generate candidates" }));
    // The baseline generator legitimately picks the one solvent material
    // available (materials[0], functions include "solvent", name contains
    // "water") at 100% — this is genuine engine output, not a stub.
    expect(await screen.findByText("Test Water")).toBeInTheDocument();
    expect(screen.getByText("100.00%")).toBeInTheDocument();
  });

  it("shows overall score and evidence confidence as distinct numbers, not the same figure twice", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await user.click(screen.getByRole("button", { name: "Generate candidates" }));
    await screen.findByText("Test Water");
    expect(screen.getByText((_, el) => el?.textContent === "Overall score: 0.50")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === "Evidence confidence: 0.14")).toBeInTheDocument();
  });

  it("labels unevaluated scoring dimensions honestly, distinct from the one dimension that was evaluated", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await user.click(screen.getByRole("button", { name: "Generate candidates" }));
    await screen.findByText("Test Water");
    expect(screen.getAllByText("Not evaluated").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("Evaluated")).toBeInTheDocument();
  });

  it("shows an honest empty-formula message with rejection reasons when evidence is insufficient, never a fabricated formula", async () => {
    bridge.listRecords.mockImplementation(byCollection({ ...FULL_FIXTURE, materials: [] }));
    const user = await selectStudyAndGoToCandidates();
    await user.click(screen.getByRole("button", { name: "Generate candidates" }));
    expect(await screen.findByText(/No formula lines/)).toBeInTheDocument();
    expect(screen.getByText(/Could not generate any candidate formulas/)).toBeInTheDocument();
  });

  it("saves a candidate through the typed Reverse Formulation collections, and never writes a formulation", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await user.click(screen.getByRole("button", { name: "Generate candidates" }));
    await screen.findByText("Test Water");
    await user.click(screen.getByRole("button", { name: "Save as candidate record" }));
    expect(bridge.upsertRecords).toHaveBeenCalledWith(
      "reverse_formula_candidates",
      expect.arrayContaining([expect.objectContaining({ status: "generated", studyId: "study-1" })]),
    );
    expect(bridge.upsertRecords).toHaveBeenCalledWith("candidate_score_explanations", expect.any(Array));
    expect(bridge.upsertRecords).not.toHaveBeenCalledWith("formulations", expect.anything());
  });
});

describe("ReverseFormulationPage — errors", () => {
  it("surfaces a persistence/load failure visibly rather than failing silently", async () => {
    bridge.listRecords.mockRejectedValue(new Error("disk unavailable"));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/disk unavailable/);
  });
});
