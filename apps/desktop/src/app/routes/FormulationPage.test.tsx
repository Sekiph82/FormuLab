/**
 * Spec Part 5 coverage: "Formula workspace no longer shows downstream
 * modules as crowded tabs" and "Context survives navigation" (a `?tab=`/
 * `?focusLine=` query param, the way a cross-workspace link from Approval
 * arrives, opens the right tab). Same mocking discipline as
 * ApprovalPanel.test.tsx — only the Tauri-backed modules are mocked.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation, FormulationLine, FormulationVersion } from "@ai4s/shared";
import { FormulationPage } from "./FormulationPage";

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

const formulationsBridge = {
  readFormulation: vi.fn(),
  readDraft: vi.fn(),
  readAuditLog: vi.fn(),
};
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
      <FormulationPage />
    </MemoryRouter>,
  );
}

describe("FormulationPage — simplified tab strip", () => {
  it("shows only Builder/Versions/Cost/Compatibility/Safety/Packaging, never the downstream modules", async () => {
    renderAtPath("/formulation?project=proj-1");
    await screen.findByText("Test Project");

    const nav = screen.getByRole("navigation", { name: "Project sections" });
    expect(nav).toHaveTextContent("Builder");
    expect(nav).toHaveTextContent(/Versions/);
    expect(nav).toHaveTextContent("Cost");
    expect(nav).toHaveTextContent("Compatibility");
    expect(nav).toHaveTextContent("Safety");
    expect(nav).toHaveTextContent("Packaging");

    // The modules moved to their own workspaces must never appear as tabs here.
    expect(nav).not.toHaveTextContent("Trials");
    expect(nav).not.toHaveTextContent(/^Tests$/);
    expect(nav).not.toHaveTextContent("Stability");
    expect(nav).not.toHaveTextContent("Corrective actions");
    expect(nav).not.toHaveTextContent("Regulatory");
    expect(nav).not.toHaveTextContent("Approval");
    expect(nav).not.toHaveTextContent("Optimizer");
  });

  it("links out to Laboratory, Stability, Regulatory and Approval instead of hosting them as tabs", async () => {
    renderAtPath("/formulation?project=proj-1");
    await screen.findByText("Test Project");
    expect(screen.getByRole("link", { name: "Open in Laboratory" })).toHaveAttribute("href", "/laboratory?project=proj-1");
    expect(screen.getByRole("link", { name: "Open in Stability" })).toHaveAttribute("href", "/stability?project=proj-1");
    expect(screen.getByRole("link", { name: "Open in Regulatory" })).toHaveAttribute("href", "/regulatory?project=proj-1");
    expect(screen.getByRole("link", { name: "Open in Approval" })).toHaveAttribute("href", "/approval?project=proj-1");
  });

  it("opens the tab named by a `?tab=` query param — the context an Approval-blocker link carries", async () => {
    renderAtPath("/formulation?project=proj-1&tab=compatibility");
    await screen.findByText("Test Project");
    expect(screen.getByRole("button", { name: "Compatibility" })).toHaveAttribute("aria-current", "page");
  });

  it("shows a project picker when no project is selected", async () => {
    renderAtPath("/formulation");
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });
});
