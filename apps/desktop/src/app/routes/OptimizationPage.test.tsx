/**
 * Spec Part 5 coverage: the Optimization workspace renders the existing
 * AdvancedOptimizerPanel bound to a project's current draft, and links out
 * to the unrelated, pre-existing standalone what-if calculator instead of
 * replacing it.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, FormulationVersion } from "@ai4s/shared";
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

const formulationsBridge = { readFormulation: vi.fn(), readDraft: vi.fn(), readAuditLog: vi.fn() };
vi.mock("@/lib/formulations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formulations")>();
  return {
    ...actual,
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

describe("OptimizationPage", () => {
  it("renders the Advanced Optimizer bound to the selected project's current draft", async () => {
    renderAtPath("/optimization?project=proj-1");
    await screen.findByText("Test Project");
    expect(screen.getByText("Scenarios")).toBeInTheDocument();
  });

  it("links out to the standalone what-if calculator instead of replacing it", async () => {
    renderAtPath("/optimization?project=proj-1");
    await screen.findByText("Test Project");
    expect(screen.getByRole("link", { name: /standalone optimizer/i })).toHaveAttribute("href", "/optimizer");
  });

  it("shows a project picker when no project is selected", async () => {
    renderAtPath("/optimization");
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });
});
