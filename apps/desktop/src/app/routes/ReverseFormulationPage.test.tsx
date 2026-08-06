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
} from "@formulab/shared";
import { ReverseFormulationPage } from "./ReverseFormulationPage";
import { renderAt } from "@/test/render";
import { routes } from "@/app/router";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

// Same mocking discipline as DataExchangePage.test.tsx's commitFormulaBom
// coverage: only the persistence boundary is mocked, so `newFormulation`/
// `newVersion` shape and the "always concept, empty approvalRecordIds"
// invariant are real, asserted against the actual mock call arguments.
let versionCounter = 0;
const formulationsBridge = {
  listFormulations: vi.fn(),
  readFormulation: vi.fn(),
  saveFormulation: vi.fn(),
  saveFormulationVersion: vi.fn(),
  appendAudit: vi.fn(),
};
vi.mock("@/lib/formulations", () => ({
  listFormulations: (...a: []) => formulationsBridge.listFormulations(...a),
  readFormulation: (...a: [string]) => formulationsBridge.readFormulation(...a),
  saveFormulation: (...a: [unknown]) => formulationsBridge.saveFormulation(...a),
  saveFormulationVersion: (...a: [unknown]) => formulationsBridge.saveFormulationVersion(...a),
  appendAudit: (...a: [unknown]) => formulationsBridge.appendAudit(...a),
  auditEvent: (formulationId: string, action: string, opts: Record<string, unknown> = {}) => ({
    id: "audit-1",
    formulationId,
    at: "2026-01-01T00:00:00.000Z",
    actor: "local",
    actorKind: "human",
    action,
    ...opts,
  }),
  newFormulation: (name: string, family: string, opts: { code?: string } = {}) => ({
    schemaVersion: "1.0",
    id: "formulation-new-1",
    code: opts.code ?? "RF-GEN-1",
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
  newVersion: (
    formulationId: string,
    lines: unknown[],
    opts: { versionNumber: number; parentVersionId?: string; changeReason?: string },
  ) => ({
    schemaVersion: "1.0",
    id: `version-${++versionCounter}`,
    formulationId,
    versionNumber: opts.versionNumber,
    parentVersionId: opts.parentVersionId,
    versionLabel: `0.${opts.versionNumber}`,
    status: "concept",
    author: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    changeReason: opts.changeReason,
    lines,
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
  }),
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
  versionCounter = 0;
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
  formulationsBridge.listFormulations.mockResolvedValue([]);
  formulationsBridge.readFormulation.mockResolvedValue({ formulation: undefined, versions: [] });
  formulationsBridge.saveFormulation.mockImplementation((f: unknown) => Promise.resolve(f));
  formulationsBridge.saveFormulationVersion.mockImplementation((v: unknown) => Promise.resolve(v));
  formulationsBridge.appendAudit.mockResolvedValue(undefined);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ReverseFormulationPage />
    </MemoryRouter>,
  );
}

async function selectStudyAndGoToCandidates() {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("button", { name: "Candidates" }));
  return user;
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

describe("ReverseFormulationPage — candidate-to-formula conversion", () => {
  async function generateSaveAndSelect(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Generate candidates" }));
    await screen.findByText("Test Water");
    await user.click(screen.getByRole("button", { name: "Save as candidate record" }));
    await user.click(await screen.findByRole("button", { name: "Select for review" }));
  }

  it("shows no conversion action for an unselected candidate, even once saved", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await user.click(screen.getByRole("button", { name: "Generate candidates" }));
    await screen.findByText("Test Water");
    await user.click(screen.getByRole("button", { name: "Save as candidate record" }));
    // Saved, but never explicitly selected for review.
    expect(screen.queryByRole("button", { name: "Create formulation draft" })).not.toBeInTheDocument();
  });

  it("blocks creation and shows a clear error when a candidate's material has left the catalog, without fabricating a placeholder material", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await user.click(screen.getByRole("button", { name: "Generate candidates" }));
    await screen.findByText("Test Water");
    // The material disappears from the catalog by the time the page
    // refreshes after saving the candidate.
    bridge.listRecords.mockImplementation(byCollection({ ...FULL_FIXTURE, materials: [] }));
    await user.click(screen.getByRole("button", { name: "Save as candidate record" }));
    await user.click(await screen.findByRole("button", { name: "Select for review" }));
    expect(await screen.findByText(/material\(s\) not in the catalog/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create formulation draft" })).not.toBeInTheDocument();
    expect(formulationsBridge.saveFormulationVersion).not.toHaveBeenCalled();
  });

  it("creates a new draft formulation through the existing formulation workflow, starting unapproved/unverified with no inherited approval metadata", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await generateSaveAndSelect(user);
    await user.click(screen.getByRole("button", { name: "Create formulation draft" }));
    expect(await screen.findByText(/Created RF-GEN-1/)).toBeInTheDocument();
    expect(formulationsBridge.saveFormulation).toHaveBeenCalledWith(expect.objectContaining({ code: "RF-GEN-1" }));
    expect(formulationsBridge.saveFormulationVersion).toHaveBeenCalledWith(
      expect.objectContaining({ status: "concept", versionNumber: 1, approvalRecordIds: [], regulatoryFindingIds: [], safetyFindingIds: [] }),
    );
  });

  it("preserves formula-line order, exact material identifiers and percentages, and leaves unsupplied fields blank rather than fabricated", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await generateSaveAndSelect(user);
    await user.click(screen.getByRole("button", { name: "Create formulation draft" }));
    await screen.findByText(/Created RF-GEN-1/);
    const version = formulationsBridge.saveFormulationVersion.mock.calls[0][0] as { lines: { materialCode: string; percent: string; lineNumber: number; inciName?: string }[] };
    expect(version.lines).toHaveLength(1);
    expect(version.lines[0]).toMatchObject({ materialCode: "TEST-MAT-001", percent: "100", lineNumber: 1 });
    // The fixture material has no inciName — must stay undefined, never "".
    expect(version.lines[0].inciName).toBeUndefined();
  });

  it("prevents duplicate creation from repeated clicks: the action disappears after one success", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await generateSaveAndSelect(user);
    await user.click(screen.getByRole("button", { name: "Create formulation draft" }));
    await screen.findByText(/Created RF-GEN-1/);
    expect(formulationsBridge.saveFormulationVersion).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Create formulation draft" })).not.toBeInTheDocument();
  });

  it("creates a new version on an explicitly chosen existing formulation, appending rather than overwriting its prior version", async () => {
    const existingFormulation = { schemaVersion: "1.0", id: "form-existing-1", code: "EXIST-1", name: "Existing Formulation", productFamilyCode: "TEST-FAM-001", targetSkuCodes: [], targetMarkets: ["KE"], targetClaims: [], targetBatchKg: "100", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archived: false };
    const priorVersion = { id: "version-old-1", versionNumber: 1 };
    formulationsBridge.listFormulations.mockResolvedValue([existingFormulation]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: existingFormulation, versions: [priorVersion] });
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await generateSaveAndSelect(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Target formulation" }), "form-existing-1");
    await user.click(screen.getByRole("button", { name: "Create new version" }));
    await screen.findByText(/Created EXIST-1/);
    const version = formulationsBridge.saveFormulationVersion.mock.calls[0][0] as { id: string; versionNumber: number; parentVersionId?: string };
    expect(version.id).not.toBe(priorVersion.id);
    expect(version.versionNumber).toBe(2);
    expect(version.parentVersionId).toBe(priorVersion.id);
  });

  it("surfaces a visible error when the persistence layer rejects the creation", async () => {
    formulationsBridge.saveFormulation.mockRejectedValue(new Error("disk unavailable"));
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await generateSaveAndSelect(user);
    await user.click(screen.getByRole("button", { name: "Create formulation draft" }));
    expect(await screen.findByText(/disk unavailable/)).toBeInTheDocument();
  });

  it("shows a low-evidence-confidence warning alongside a decision-support notice, never an approval claim", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await generateSaveAndSelect(user);
    expect(screen.getByText(/Low evidence confidence/)).toBeInTheDocument();
    expect(screen.getByText(/decision support, not approval/)).toBeInTheDocument();
    // Honest disclaimer text ("unapproved") is fine; a fabricated success
    // claim ("Approved"/"Created ...") must not appear before any creation
    // action was taken.
    expect(screen.queryByText(/^Approved$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Created/)).not.toBeInTheDocument();
  });

  it("keeps candidate save and formulation creation as distinct actions", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await user.click(screen.getByRole("button", { name: "Generate candidates" }));
    await screen.findByText("Test Water");
    await user.click(screen.getByRole("button", { name: "Save as candidate record" }));
    // Saving never touches the formulation persistence layer.
    expect(formulationsBridge.saveFormulationVersion).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Select for review" }));
    // The save action is now disabled and relabeled "Saved" — a genuinely
    // separate control from the newly-revealed creation action.
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create formulation draft" })).toBeInTheDocument();
  });

  it("never mutates the source saved candidate record while converting it", async () => {
    bridge.listRecords.mockImplementation(byCollection(FULL_FIXTURE));
    const user = await selectStudyAndGoToCandidates();
    await generateSaveAndSelect(user);
    await user.click(screen.getByRole("button", { name: "Create formulation draft" }));
    await screen.findByText(/Created RF-GEN-1/);
    const candidateWrites = bridge.upsertRecords.mock.calls.filter((c) => c[0] === "reverse_formula_candidates");
    expect(candidateWrites).toHaveLength(1); // only the original save, never touched again
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
