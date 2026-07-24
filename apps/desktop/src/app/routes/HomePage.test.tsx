/**
 * Spec Part 5 coverage: "Home uses real persisted records" and "Empty
 * states do not show fabricated metrics" — every section reads from
 * `listFormulations`/`listRecords`, and an empty result renders the honest
 * empty-state copy, never an invented number.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Formulation } from "@ai4s/shared";
import { HomePage } from "./HomePage";

const masterdataBridge = { listRecords: vi.fn() };
vi.mock("@/lib/masterdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/masterdata")>();
  return { ...actual, listRecords: (...a: [string]) => masterdataBridge.listRecords(...a) };
});

const formulationsBridge = { listFormulations: vi.fn(), readFormulation: vi.fn(), readAuditLog: vi.fn() };
vi.mock("@/lib/formulations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formulations")>();
  return {
    ...actual,
    listFormulations: (...a: []) => formulationsBridge.listFormulations(...a),
    readFormulation: (...a: [string]) => formulationsBridge.readFormulation(...a),
    readAuditLog: (...a: [string]) => formulationsBridge.readAuditLog(...a),
  };
});

const PROJECT: Formulation = {
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
  updatedAt: "2026-01-02T00:00:00.000Z",
  archived: false,
};

describe("HomePage — real data, honest empty states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    masterdataBridge.listRecords.mockResolvedValue([]);
  });

  it("shows honest empty states everywhere when nothing is persisted yet — never a fabricated metric", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
    expect(screen.getByText("No recent activity.")).toBeInTheDocument();
    expect(screen.getByText("No open trials right now.")).toBeInTheDocument();
    expect(screen.getByText("No stability samples due soon.")).toBeInTheDocument();
    expect(screen.getByText("Nothing awaiting an approval decision.")).toBeInTheDocument();
    expect(screen.getByText("No dossiers among your recent projects.")).toBeInTheDocument();
    expect(screen.getByText("No dossier evidence expiring soon.")).toBeInTheDocument();
    expect(screen.getByText("No dossiers waiting on a review.")).toBeInTheDocument();
    // No numeric metric is rendered when there is nothing to count.
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("lists a real persisted project by name and code, not a placeholder", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([PROJECT]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: PROJECT, versions: [] });
    formulationsBridge.readAuditLog.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Test Project")).toBeInTheDocument();
    expect(screen.getByText("PRJ-1")).toBeInTheDocument();
  });

  it("shows a dossier with no requirements as in-preparation, scoped to a real project", async () => {
    formulationsBridge.listFormulations.mockResolvedValue([PROJECT]);
    formulationsBridge.readFormulation.mockResolvedValue({ formulation: PROJECT, versions: [] });
    formulationsBridge.readAuditLog.mockResolvedValue([]);
    masterdataBridge.listRecords.mockImplementation((collection: string) => {
      if (collection === "regulatory_dossiers") {
        return Promise.resolve([
          {
            schemaVersion: "1.0",
            id: "dossier-1",
            dossierCode: "DOS-1",
            title: "Test dossier",
            formulationId: "proj-1",
            formulaVersionId: "version-1",
            jurisdictions: ["KE"],
            productFamilyCode: "unmatched-family",
            targetMarkets: ["KE"],
            status: "draft",
            revision: 1,
            createdBy: "local",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("1 in preparation")).toBeInTheDocument();
    expect(screen.getByText("0 ready for review")).toBeInTheDocument();
    expect(screen.getByText("0 blocked")).toBeInTheDocument();
  });
});
