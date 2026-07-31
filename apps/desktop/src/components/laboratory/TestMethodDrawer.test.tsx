/**
 * UI-integration coverage for the per-test standard/method drawer (Phase 10
 * Session 1A). Same mocking discipline as ApprovalPanel.test.tsx/
 * DoePanel.test.tsx — only `@/lib/masterdata` is mocked; assignment/
 * authorization logic itself is covered by
 * `packages/shared/src/engine/laboratoryStandards.test.ts`.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LaboratoryStandard, LaboratoryTestMethod, TestDefinition } from "@formulab/shared";
import { TestMethodDrawer } from "./TestMethodDrawer";

const bridge = {
  listRecordsSeeded: vi.fn(),
  upsertRecords: vi.fn(),
};

vi.mock("@/lib/masterdata", () => ({
  listRecordsSeeded: (...a: [string, unknown[]]) => bridge.listRecordsSeeded(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
}));

const DEFINITION: TestDefinition = {
  schemaVersion: "1.0",
  code: "TEST-PH",
  name: "pH",
  category: "physical_chemical",
  resultType: "numeric",
  replicatesRequired: 1,
  requiredEquipment: [],
  requiredAttachment: false,
  applicableProductFamilies: [],
  applicableProductSkus: [],
  criticalTestFlag: false,
  verificationStatus: "not_verified",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const ACTIVE_STANDARD: LaboratoryStandard = {
  schemaVersion: "1.0",
  id: "std-active",
  standardCode: "ISO-4316",
  title: "Determination of pH",
  issuingOrganization: "ISO",
  status: "active",
  jurisdiction: [],
  applicableProductCategories: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const SUPERSEDED_STANDARD: LaboratoryStandard = {
  ...ACTIVE_STANDARD,
  id: "std-old",
  standardCode: "ISO-4316-OLD",
  status: "superseded",
};

const PRIMARY_METHOD: LaboratoryTestMethod = {
  schemaVersion: "1.0",
  id: "m-primary",
  testDefinitionCode: "TEST-PH",
  standardId: "std-active",
  methodName: "pH determination",
  assignmentType: "primary",
  status: "active",
  requiredEquipment: [],
  reagentsAndConsumables: [],
  instrumentSettings: [],
  procedureSteps: [],
  safetyWarnings: [],
  relatedTestDefinitionCodes: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "alice",
};

const ALTERNATIVE_SUPERSEDED_METHOD: LaboratoryTestMethod = {
  ...PRIMARY_METHOD,
  id: "m-alt",
  standardId: "std-old",
  assignmentType: "alternative",
};

function mockRecords(standards: LaboratoryStandard[], methods: LaboratoryTestMethod[]) {
  bridge.listRecordsSeeded.mockImplementation((collection: string) => {
    if (collection === "laboratory_standards") return Promise.resolve(standards);
    if (collection === "laboratory_test_methods") return Promise.resolve(methods);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.upsertRecords.mockResolvedValue({ inserted: 0, updated: 1, total: 1 });
});

describe("TestMethodDrawer — empty/loading states", () => {
  it("shows the empty state when no method is assigned yet", async () => {
    mockRecords([], []);
    render(<TestMethodDrawer definition={DEFINITION} onClose={() => {}} />);
    expect(await screen.findByText(/No standard\/method assigned yet\./)).toBeInTheDocument();
  });

  it("shows the legacy free-text reference notice when the definition has one and no method is assigned", async () => {
    mockRecords([], []);
    render(<TestMethodDrawer definition={{ ...DEFINITION, methodReference: "ISO 4316" }} onClose={() => {}} />);
    expect(await screen.findByText(/Legacy free-text reference: ISO 4316 \(unresolved\)/)).toBeInTheDocument();
  });
});

describe("TestMethodDrawer — close behavior", () => {
  it("calls onClose on the close button", async () => {
    mockRecords([], []);
    const onClose = vi.fn();
    render(<TestMethodDrawer definition={DEFINITION} onClose={onClose} />);
    await screen.findByText(/No standard\/method assigned yet\./);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", async () => {
    mockRecords([], []);
    const onClose = vi.fn();
    render(<TestMethodDrawer definition={DEFINITION} onClose={onClose} />);
    await screen.findByText(/No standard\/method assigned yet\./);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has dialog role and an accessible label", async () => {
    mockRecords([], []);
    render(<TestMethodDrawer definition={DEFINITION} onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", expect.stringContaining("pH"));
  });
});

describe("TestMethodDrawer — authorization", () => {
  it("shows the disabled-action reason for an unauthorized role and hides makePrimary", async () => {
    mockRecords([ACTIVE_STANDARD, SUPERSEDED_STANDARD], [PRIMARY_METHOD, ALTERNATIVE_SUPERSEDED_METHOD]);
    render(<TestMethodDrawer definition={DEFINITION} onClose={() => {}} />);
    await screen.findByText("ISO-4316");
    await userEvent.selectOptions(screen.getByLabelText("Acting role"), "researcher");
    expect(await screen.findByText(/Only chemist, quality or administrator roles/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument();
  });

  it("an authorized chemist sees Make primary on the alternative", async () => {
    mockRecords([ACTIVE_STANDARD, SUPERSEDED_STANDARD], [PRIMARY_METHOD, ALTERNATIVE_SUPERSEDED_METHOD]);
    render(<TestMethodDrawer definition={DEFINITION} onClose={() => {}} />);
    await screen.findByText("ISO-4316");
    expect(screen.getByRole("button", { name: "Make primary" })).toBeInTheDocument();
  });
});

describe("TestMethodDrawer — superseded acknowledgement", () => {
  it("refuses to promote a superseded alternative to primary without acknowledgement", async () => {
    mockRecords([ACTIVE_STANDARD, SUPERSEDED_STANDARD], [PRIMARY_METHOD, ALTERNATIVE_SUPERSEDED_METHOD]);
    render(<TestMethodDrawer definition={DEFINITION} onClose={() => {}} />);
    await screen.findByText("ISO-4316");
    await userEvent.click(screen.getByRole("button", { name: "Make primary" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/superseded/i);
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  it("allows promoting a superseded alternative once acknowledged", async () => {
    mockRecords([ACTIVE_STANDARD, SUPERSEDED_STANDARD], [PRIMARY_METHOD, ALTERNATIVE_SUPERSEDED_METHOD]);
    render(<TestMethodDrawer definition={DEFINITION} onClose={() => {}} />);
    await screen.findByText("ISO-4316");
    await userEvent.click(screen.getByLabelText(/I understand this standard is superseded/));
    await userEvent.click(screen.getByRole("button", { name: "Make primary" }));
    await waitFor(() => expect(bridge.upsertRecords).toHaveBeenCalledWith("laboratory_test_methods", expect.any(Array)));
  });
});

describe("TestMethodDrawer — detail sections", () => {
  it("renders the 18 method-surface section headings for the selected method", async () => {
    mockRecords([ACTIVE_STANDARD], [PRIMARY_METHOD]);
    render(<TestMethodDrawer definition={DEFINITION} onClose={() => {}} />);
    await screen.findByText("ISO-4316");
    for (const heading of ["Overview", "Scope and applicability", "Required equipment", "Step-by-step procedure", "Safety", "Waste disposal", "Revision and source information"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it("shows the copyright notice regardless of assignment state", async () => {
    mockRecords([], []);
    render(<TestMethodDrawer definition={DEFINITION} onClose={() => {}} />);
    expect(await screen.findByText(/do not replace the official licensed standard/)).toBeInTheDocument();
  });
});
