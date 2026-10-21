/**
 * Spec Part 5 coverage: the Optimization workspace renders the existing
 * AdvancedOptimizerPanel bound to a project's current draft, and links out
 * to the unrelated, pre-existing standalone what-if calculator instead of
 * replacing it.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, FormulationVersion } from "@formulab/shared";
import { createAlternativeRankingRecord, rankAlternatives, type AlternativeRankingCandidate } from "@formulab/shared";
import { OptimizationPage } from "./OptimizationPage";

const masterdataBridge = { listRecords: vi.fn(), listRecordsSeeded: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/masterdata")>();
  return {
    ...actual,
    listRecords: (...a: [string]) => masterdataBridge.listRecords(...a),
    listRecordsSeeded: (...a: [string, unknown[]]) => masterdataBridge.listRecordsSeeded(...a),
    upsertRecords: (...a: [string, unknown[]]) => masterdataBridge.upsertRecords(...a),
  };
});

const formulationsBridge = { listFormulations: vi.fn(), readFormulation: vi.fn(), readDraft: vi.fn(), readAuditLog: vi.fn() };
vi.mock("@/lib/formulations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formulations")>();
  return {
    ...actual,
    listFormulations: (...a: []) => formulationsBridge.listFormulations(...a),
    readFormulation: (...a: [string]) => formulationsBridge.readFormulation(...a),
    readDraft: (...a: [string]) => formulationsBridge.readDraft(...a),
    readAuditLog: (...a: [string]) => formulationsBridge.readAuditLog(...a),
  };
});

const FORMULATION: Formulation = {
  schemaVersion: "1.0",
  id: "proj-1",
  code: "PRJ-1",
  name: "Test Project",
  productFamilyCode: "unmatched-family",
  targetSkuCodes: ["SKU-1"],
  targetMarkets: ["KE"],
  targetClaims: [],
  targetBatchKg: "100",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
};

const LINE: FormulationLine = {
  id: "line-a",
  lineNumber: 1,
  phase: "A",
  materialId: "A",
  materialCode: "A",
  displayName: "Water",
  functions: ["water"],
  percent: "100",
  isQsToHundred: true,
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

const VERSION_1: FormulationVersion = {
  schemaVersion: "1.0",
  id: "version-1",
  formulationId: "proj-1",
  versionNumber: 1,
  status: "chemist_review",
  author: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  lines: [LINE],
  basisBatchKg: "100",
  sourceRunIds: [],
  regulatoryFindingIds: [],
  compatibilityFindingIds: [],
  safetyFindingIds: [],
  approvalRecordIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  masterdataBridge.listRecords.mockResolvedValue([]);
  masterdataBridge.listRecordsSeeded.mockImplementation((_collection: string, seed: unknown[]) => Promise.resolve(seed));
  masterdataBridge.upsertRecords.mockResolvedValue({ inserted: 0, updated: 0, total: 0 });
  formulationsBridge.readFormulation.mockResolvedValue({ formulation: FORMULATION, versions: [VERSION_1] });
  formulationsBridge.listFormulations.mockResolvedValue([FORMULATION]);
  formulationsBridge.readDraft.mockResolvedValue(null);
  formulationsBridge.readAuditLog.mockResolvedValue([]);
});

function renderAtPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OptimizationPage />
    </MemoryRouter>,
  );
}

function rankedSource(safety: "PASS" | "FAIL" = "PASS") {
  const candidate: AlternativeRankingCandidate = {
    candidateId: "session-1:v2", sessionId: "session-1", alternativeId: "session-1:v2", versionLabel: "v2", sourceFormulationVersionId: "version-1", formulaStatus: "VALID",
    dimensions: {
      performance: { status: "UNAVAILABLE_MODEL" }, uncertainty: { status: "UNKNOWN" }, cost: { status: "MISSING" }, availability: { status: "UNKNOWN" },
      compatibility: { status: "PASS" }, safety: { status: safety }, regulatory: { status: "PASS" }, manufacturing: { status: "READY" },
      evidence: { status: "NO_LINKED_EVIDENCE", ingredientCount: 0, linkedIngredientCount: 0, uniqueSourceCount: 0 },
    },
  };
  return createAlternativeRankingRecord({ code: "ranking-1", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00.000Z", context: { batchKg: "100", currency: "KES" }, rankings: rankAlternatives([candidate]) });
}

describe("OptimizationPage", () => {
  it("renders the Advanced Optimizer bound to the selected project's current draft", async () => {
    renderAtPath("/optimization?project=proj-1");
    await screen.findByText("Test Project");
    expect(screen.getByText("Scenarios")).toBeInTheDocument();
  });

  it("retains only a checksum-verified source ranking when opened from a result card", async () => {
    const record = await rankedSource();
    masterdataBridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "alternative_rankings" ? [record] : []));
    renderAtPath("/optimization?project=proj-1&sourceSessionId=session-1&sourceAlternativeId=session-1%3Av2&rankingRecordCode=ranking-1");
    await screen.findByText("Test Project");
    expect(await screen.findByRole("status")).toHaveTextContent("session-1:v2");
    expect(screen.getByRole("status")).toHaveTextContent("ranking-1");
  });

  it("blocks a direct optimizer URL whose immutable ranking source is Safety BLOCKED", async () => {
    const record = await rankedSource("FAIL");
    masterdataBridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "alternative_rankings" ? [record] : []));
    renderAtPath("/optimization?project=proj-1&sourceSessionId=session-1&sourceAlternativeId=session-1%3Av2&rankingRecordCode=ranking-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Safety/i);
    expect(screen.queryByText("Scenarios")).not.toBeInTheDocument();
  });

  it("blocks a valid ranking source when only the project URL parameter is changed", async () => {
    const record = await rankedSource();
    masterdataBridge.listRecords.mockImplementation((collection: string) => Promise.resolve(collection === "alternative_rankings" ? [record] : []));
    renderAtPath("/optimization?project=proj-B&sourceSessionId=session-1&sourceAlternativeId=session-1%3Av2&rankingRecordCode=ranking-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not own/i);
    expect(screen.queryByText("Scenarios")).not.toBeInTheDocument();
  });

  it("fails closed when a ranking-originated URL omits its immutable record", async () => {
    renderAtPath("/optimization?project=proj-1&sourceSessionId=session-1&sourceAlternativeId=session-1%3Av2");
    expect(await screen.findByRole("alert")).toHaveTextContent(/immutable ranking record/i);
    expect(screen.queryByText("Scenarios")).not.toBeInTheDocument();
  });

  it("links out to the standalone what-if calculator instead of replacing it", async () => {
    renderAtPath("/optimization?project=proj-1");
    await screen.findByText("Test Project");
    expect(screen.getByRole("link", { name: /standalone optimizer/i })).toHaveAttribute("href", "/optimizer");
  });

  it("shows a project picker when no project is selected", async () => {
    formulationsBridge.listFormulations.mockResolvedValueOnce([]);
    renderAtPath("/optimization");
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });
});
