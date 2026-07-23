/**
 * Spec Part 5 coverage: "Stability workspace opens correct study context" —
 * StabilityPanel receives the selected project's real version/lines, and
 * the version selector lets a reviewer switch which saved version's
 * stability studies they're looking at.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, FormulationVersion } from "@ai4s/shared";
import { StabilityPage } from "./StabilityPage";

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

const VERSION_2: FormulationVersion = { ...VERSION_1, id: "version-2", versionNumber: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  masterdataBridge.listRecords.mockResolvedValue([]);
  masterdataBridge.listRecordsSeeded.mockImplementation((_collection: string, seed: unknown[]) => Promise.resolve(seed));
  masterdataBridge.upsertRecords.mockResolvedValue({ inserted: 0, updated: 0, total: 0 });
  formulationsBridge.readFormulation.mockResolvedValue({ formulation: FORMULATION, versions: [VERSION_2, VERSION_1] });
  formulationsBridge.readDraft.mockResolvedValue(null);
  formulationsBridge.readAuditLog.mockResolvedValue([]);
});

function renderAtPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StabilityPage />
    </MemoryRouter>,
  );
}

describe("StabilityPage — study context", () => {
  it("renders the Stability panel bound to the selected project, with a version selector to pick which saved version's studies to view", async () => {
    renderAtPath("/stability?project=proj-1");
    await screen.findByText("Test Project");
    expect(screen.getByText(/no stability studies/i)).toBeInTheDocument();
    // Both saved versions are offered — context can be switched, not fixed.
    expect(screen.getByRole("option", { name: "0.1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "0.2" })).toBeInTheDocument();
  });

  it("shows a project picker when no project is selected", async () => {
    renderAtPath("/stability");
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });
});
