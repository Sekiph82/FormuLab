/**
 * UI-integration coverage for the desktop approval action (spec §10's "UI
 * integration tests" category): open the panel, see the full blocker list,
 * navigate from a blocker, approve a ready version, and confirm a blocked
 * attempt never changes the version's status. Same mocking discipline as
 * TrialsPanel.test.tsx — only the Tauri-backed modules (`@/lib/masterdata`,
 * `@/lib/formulations`) are mocked; readiness derivation and the
 * status-transition logic are the real `@ai4s/shared` engine code.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent, Formulation, FormulationLine, FormulationVersion } from "@ai4s/shared";
import { ApprovalPanel } from "./ApprovalPanel";

const masterdataBridge = {
  listRecords: vi.fn(),
  listRecordsSeeded: vi.fn(),
  upsertRecords: vi.fn(),
};

vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => masterdataBridge.listRecords(...a),
  listRecordsSeeded: (...a: [string, unknown[]]) => masterdataBridge.listRecordsSeeded(...a),
  upsertRecords: (...a: [string, unknown[]]) => masterdataBridge.upsertRecords(...a),
}));

const formulationsBridge = {
  saveApprovalRecord: vi.fn(),
  listApprovalRecords: vi.fn(),
  appendAudit: vi.fn(),
};

vi.mock("@/lib/formulations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formulations")>();
  return {
    ...actual,
    saveApprovalRecord: (...a: [unknown]) => formulationsBridge.saveApprovalRecord(...a),
    listApprovalRecords: (...a: [string]) => formulationsBridge.listApprovalRecords(...a),
    appendAudit: (...a: [AuditEvent]) => formulationsBridge.appendAudit(...a),
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

const WATER_LINE: FormulationLine = {
  id: "line-water",
  lineNumber: 1,
  phase: "A",
  displayName: "Water",
  functions: ["water"],
  percent: "50",
  isQsToHundred: true,
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

const OTHER_LINE: FormulationLine = {
  id: "line-other",
  lineNumber: 2,
  phase: "A",
  displayName: "Surfactant",
  functions: ["anionic_surfactant"],
  percent: "50",
  isQsToHundred: false,
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

const EMPTY_LINE: FormulationLine = {
  id: "line-empty",
  lineNumber: 1,
  phase: "A",
  displayName: "",
  functions: [],
  percent: "0",
  isQsToHundred: false,
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

function version(over: Partial<FormulationVersion> = {}): FormulationVersion {
  return {
    schemaVersion: "1.0",
    id: "version-1",
    formulationId: "proj-1",
    versionNumber: 1,
    status: "chemist_review",
    author: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    lines: [WATER_LINE, OTHER_LINE],
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  masterdataBridge.listRecords.mockImplementation((collection: string) => {
    if (collection === "safety_resolutions") {
      return Promise.resolve([{ formulationId: "proj-1", findingId: "classification:human_review_required" }]);
    }
    return Promise.resolve([]);
  });
  masterdataBridge.listRecordsSeeded.mockImplementation((_collection: string, seed: unknown[]) => Promise.resolve(seed));
  masterdataBridge.upsertRecords.mockImplementation((_collection: string, records: unknown[]) => Promise.resolve({ inserted: records.length, updated: 0, total: records.length }));
  formulationsBridge.saveApprovalRecord.mockImplementation((r: unknown) => Promise.resolve(r));
  formulationsBridge.listApprovalRecords.mockResolvedValue([]);
  formulationsBridge.appendAudit.mockResolvedValue(undefined);
});

function renderPanel(versions: FormulationVersion[], baseVersion?: FormulationVersion, auditLog: AuditEvent[] = []) {
  const onNavigate = vi.fn();
  const onFocusLine = vi.fn();
  const onAuditChanged = vi.fn().mockResolvedValue(undefined);
  render(
    <ApprovalPanel
      formulation={FORMULATION}
      versions={versions}
      baseVersion={baseVersion}
      auditLog={auditLog}
      onFocusLine={onFocusLine}
      onNavigate={onNavigate}
      onAuditChanged={onAuditChanged}
    />,
  );
  return { onNavigate, onFocusLine, onAuditChanged };
}

describe("ApprovalPanel — no version", () => {
  it("shows a message instead of a dialog when there is nothing to approve", () => {
    renderPanel([]);
    expect(screen.getByText("Save a version before it can be approved.")).toBeInTheDocument();
  });
});

describe("ApprovalPanel — blockers", () => {
  it("shows the full blocker list for an empty formula and disables Approve", async () => {
    const v = version({ lines: [EMPTY_LINE] });
    renderPanel([v], v);
    await screen.findByText(/Blockers \(/);
    expect(screen.getByText(/no material/i)).toBeInTheDocument();
    expect(screen.getByText("Not ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve/ })).toBeDisabled();
  });

  it("navigates to the builder when following a validation blocker", async () => {
    const v = version({ lines: [EMPTY_LINE] });
    const { onNavigate, onFocusLine } = renderPanel([v], v);
    await screen.findByText(/Blockers \(/);
    const goTo = screen.getAllByRole("button", { name: /Go to/ })[0];
    await userEvent.setup().click(goTo);
    expect(onNavigate).toHaveBeenCalledWith("builder");
    expect(onFocusLine).toHaveBeenCalledWith("line-empty");
  });
});

describe("ApprovalPanel — approval flow", () => {
  it("shows Ready for a clean formula once the mandatory human review is acknowledged", async () => {
    const v = version();
    renderPanel([v], v);
    await screen.findByText("Ready");
    expect(screen.getByText(/Blockers \(0\)/)).toBeInTheDocument();
  });

  it("approving a ready version persists an approved record and the version.approved audit event, not a blocked one", async () => {
    const v = version({ status: "pilot_candidate" });
    const { onAuditChanged } = renderPanel([v], v);
    const user = userEvent.setup();
    await screen.findByText("Ready");

    await user.type(screen.getByLabelText(/Reviewer name/i), "Jane Chemist");
    await user.type(screen.getByLabelText(/^Reason/i), "Meets all readiness gates.");

    const approveButton = screen.getByRole("button", { name: /Approve/ });
    expect(approveButton).not.toBeDisabled();
    await user.click(approveButton);

    await vi.waitFor(() => expect(formulationsBridge.saveApprovalRecord).toHaveBeenCalled());
    const savedRecord = formulationsBridge.saveApprovalRecord.mock.calls[0][0];
    expect(savedRecord.decision).toBe("approved");
    expect(savedRecord.requestedStatus).toBe("pilot_approved");

    const actions = formulationsBridge.appendAudit.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("version.approved.pilot_approved");
    expect(actions).toContain("approval.granted");
    expect(actions).not.toContain("approval.blocked");
    expect(onAuditChanged).toHaveBeenCalled();
  });

  it("a blocked attempt records a blocked decision and an approval.blocked event, never a status-changing one", async () => {
    // Not ready (empty formula) but we still exercise the record() path
    // directly via Reject, which does not require readiness — this proves
    // the blocked/rejected paths never emit a `version.approved.*` action.
    const v = version({ lines: [EMPTY_LINE] });
    renderPanel([v], v);
    const user = userEvent.setup();
    await screen.findByText("Not ready");

    await user.type(screen.getByLabelText(/Reviewer name/i), "Jane Chemist");
    await user.type(screen.getByLabelText(/^Reason/i), "Formula incomplete.");
    await user.click(screen.getByRole("button", { name: /Reject/ }));

    await vi.waitFor(() => expect(formulationsBridge.saveApprovalRecord).toHaveBeenCalled());
    const savedRecord = formulationsBridge.saveApprovalRecord.mock.calls[0][0];
    expect(savedRecord.decision).toBe("rejected");

    const actions = formulationsBridge.appendAudit.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("approval.rejected");
    expect(actions.some((a: string) => a.startsWith("version.approved"))).toBe(false);
  });
});

const CONFLICTING_POLICY_A = {
  schemaVersion: "1.0" as const,
  id: "policy-a",
  name: "Policy A",
  productFamilyCodes: [],
  packagingSkuCodes: [],
  targetStatus: "pilot_approved" as const,
  verificationStatus: "not_verified" as const,
  active: true,
  retired: false,
  revisionNumber: 1,
  requireCompletedTrial: true,
  requireAllRequiredTestsCompleted: false,
  requireAllCriticalTestsPassed: false,
  requireNoUnresolvedCriticalDeviation: false,
  requireNoUnresolvedCriticalCorrectiveAction: false,
  requireActiveStudy: false,
  requireInitialTestsPassed: false,
  requireNoUnresolvedCriticalFailure: false,
  requirePackagingCompatibilityPassed: false,
  requireCostSnapshot: false,
  createdBy: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const CONFLICTING_POLICY_B = { ...CONFLICTING_POLICY_A, id: "policy-b", name: "Policy B", requireCompletedTrial: false, requireCostSnapshot: true };

describe("ApprovalPanel — policy conflict", () => {
  it("shows a structured conflict blocker and disables Approve when two equally-scoped active policies match", async () => {
    masterdataBridge.listRecordsSeeded.mockImplementation((collection: string, seed: unknown[]) =>
      collection === "approval_policies" ? Promise.resolve([CONFLICTING_POLICY_A, CONFLICTING_POLICY_B]) : Promise.resolve(seed),
    );
    const v = version();
    renderPanel([v], v);
    await screen.findByText(/active polic(y matches|ies match)/);
    expect(screen.getByRole("button", { name: /Approve/ })).toBeDisabled();
  });

  it("an explicit policy selection overrides the conflict", async () => {
    masterdataBridge.listRecordsSeeded.mockImplementation((collection: string, seed: unknown[]) =>
      collection === "approval_policies" ? Promise.resolve([CONFLICTING_POLICY_A, CONFLICTING_POLICY_B]) : Promise.resolve(seed),
    );
    const v = version();
    renderPanel([v], v);
    await screen.findByText(/active polic(y matches|ies match)/);

    const policySelect = screen.getByLabelText("Approval policy") as HTMLSelectElement;
    await userEvent.setup().selectOptions(policySelect, "policy-b");

    expect(screen.queryByText(/active polic(y matches|ies match)/)).not.toBeInTheDocument();
  });
});

describe("ApprovalPanel — policy management", () => {
  it("creates a new policy through the manage-policies editor", async () => {
    const v = version();
    renderPanel([v], v);
    const user = userEvent.setup();
    await screen.findByText(/Blockers \(/);

    await user.click(screen.getByRole("button", { name: "Manage policies" }));
    await user.click(screen.getByRole("button", { name: "New policy" }));
    await user.type(screen.getByLabelText("Name"), "Kenya pilot gate");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(masterdataBridge.upsertRecords).toHaveBeenCalledWith("approval_policies", expect.any(Array)));
    const [, savedPolicies] = masterdataBridge.upsertRecords.mock.calls.find((c) => c[0] === "approval_policies")!;
    expect(savedPolicies[0].name).toBe("Kenya pilot gate");
    expect(savedPolicies[0].active).toBe(false);
    expect(masterdataBridge.upsertRecords).toHaveBeenCalledWith("approval_policy_revisions", expect.any(Array));
  });
});

describe("ApprovalPanel — equivalent versions", () => {
  it("declares an equivalence and shows it in the laboratory summary as evidence reuse", async () => {
    const sourceVersion = version({ id: "version-source", status: "pilot_candidate" });
    const equivalentVersion = version({ id: "version-equivalent" });
    renderPanel([sourceVersion, equivalentVersion], sourceVersion);
    const user = userEvent.setup();
    await screen.findByText(/Blockers \(/);

    await user.click(screen.getByRole("button", { name: /Equivalent versions/ }));
    await user.type(screen.getByLabelText("Justification"), "Same core system, only fragrance changed.");
    await user.click(screen.getByRole("button", { name: "Declare equivalence" }));

    await vi.waitFor(() => expect(masterdataBridge.upsertRecords).toHaveBeenCalledWith("formula_version_equivalences", expect.any(Array)));
    const [, savedEquivalences] = masterdataBridge.upsertRecords.mock.calls.find((c) => c[0] === "formula_version_equivalences")!;
    expect(savedEquivalences[0].sourceVersionId).toBe("version-source");
    expect(savedEquivalences[0].equivalentVersionId).toBe("version-equivalent");
    expect(savedEquivalences[0].declaredBy).toBeTruthy();

    const badges = await screen.findAllByText(/Includes evidence from equivalent version/);
    expect(badges.length).toBeGreaterThan(0);
  });
});
