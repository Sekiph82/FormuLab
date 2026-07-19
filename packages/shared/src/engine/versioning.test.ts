import { describe, expect, it } from "vitest";
import {
  cloneToDraft,
  compareVersions,
  createVersion,
  draftDiffersFrom,
  draftFromVersion,
  nextVersionNumber,
  versionLabel,
} from "./versioning";
import { canTransitionTo } from "../schemas/status";
import type {
  Formulation,
  FormulationLine,
  FormulationVersion,
} from "../schemas/formulation";

function line(over: Partial<FormulationLine> & { displayName: string; percent: string }): FormulationLine {
  return {
    id: over.id ?? `line-${over.displayName}`,
    lineNumber: over.lineNumber ?? 1,
    phase: over.phase ?? "A",
    displayName: over.displayName,
    percent: over.percent,
    isQsToHundred: over.isQsToHundred ?? false,
    functions: over.functions ?? [],
    activeMatterPercent: over.activeMatterPercent,
    supplierCode: over.supplierCode,
    unitPrice: over.unitPrice,
    currency: over.currency,
    provenance: over.provenance ?? { origin: "chemist_override", evidenceClaimIds: [] },
  };
}

const LINES: FormulationLine[] = [
  line({ id: "w", displayName: "Water", percent: "0", isQsToHundred: true, functions: ["water"], activeMatterPercent: "0" }),
  line({ id: "s", displayName: "SLES", percent: "12", functions: ["anionic_surfactant"], activeMatterPercent: "70" }),
  line({ id: "p", displayName: "Sodium Benzoate", percent: "0.5", functions: ["preservative"], activeMatterPercent: "100" }),
];

const PROJECT: Formulation = {
  schemaVersion: "1.0",
  id: "f1",
  code: "HC-SHAMPOO-REG-001",
  name: "Shampoo trial",
  productFamilyCode: "HC-SHAMPOO-REG",
  targetSkuCodes: ["HC-SHAMPOO-REG-250ML-BOTTLE"],
  targetMarkets: ["KE"],
  targetClaims: ["gentle daily use"],
  targetBatchKg: "100",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  archived: false,
};

function firstVersion(lines = LINES): FormulationVersion {
  return createVersion({
    formulation: PROJECT,
    draft: {
      schemaVersion: "1.0",
      formulationId: "f1",
      lines,
      basisBatchKg: "100",
      updatedAt: "2026-01-01T00:00:00Z",
      dirty: true,
    },
    changeReason: "initial concept",
    author: "chemist",
    nextVersionNumber: 1,
  });
}

describe("version creation", () => {
  it("creates a first version with a snapshot of its own totals", () => {
    const v = firstVersion();
    expect(v.versionNumber).toBe(1);
    expect(v.versionLabel).toBe("0.1");
    expect(v.totalsSnapshot?.totalPercent).toBe("100.0000");
    // 12% of 70% active SLES = 8.4, plus 0.5 preservative.
    expect(v.totalsSnapshot?.totalActiveMatterPercent).toBe("8.9000");
  });

  it("refuses to save a version without a change reason", () => {
    expect(() =>
      createVersion({
        formulation: PROJECT,
        draft: { schemaVersion: "1.0", formulationId: "f1", lines: LINES, basisBatchKg: "100", updatedAt: "x", dirty: true },
        changeReason: "  ",
        author: "chemist",
        nextVersionNumber: 1,
      }),
    ).toThrow(/change reason/);
  });

  it("captures the project intent as it stood, not as it later becomes", () => {
    const v = firstVersion();
    expect(v.targetClaimsSnapshot).toEqual(["gentle daily use"]);
    // Editing the project afterwards must not rewrite the saved version.
    PROJECT.targetClaims = ["completely different claim"];
    expect(v.targetClaimsSnapshot).toEqual(["gentle daily use"]);
    PROJECT.targetClaims = ["gentle daily use"];
  });

  it("records the parent so lineage is traceable", () => {
    const v1 = firstVersion();
    const draft = draftFromVersion(v1);
    const v2 = createVersion({
      formulation: PROJECT,
      draft,
      changeReason: "lower surfactant",
      author: "chemist",
      nextVersionNumber: nextVersionNumber([v1]),
    });
    expect(v2.versionNumber).toBe(2);
    expect(v2.parentVersionId).toBe(v1.id);
  });

  it("labels versions for display, never by storage id", () => {
    expect(versionLabel(3)).toBe("0.3");
    expect(versionLabel(1, true)).toBe("1.0");
    expect(firstVersion().id).not.toBe(firstVersion().versionLabel);
  });
});

describe("draft and immutability", () => {
  it("gives a draft its own copy of the lines", () => {
    const v = firstVersion();
    const draft = draftFromVersion(v);
    draft.lines[1].percent = "6";
    // Mutating the draft must not reach into the saved version.
    expect(v.lines[1].percent).toBe("12");
  });

  it("a saved version is not changed by saving a later one", () => {
    const v1 = firstVersion();
    const before = JSON.stringify(v1);
    const draft = draftFromVersion(v1);
    draft.lines[1].percent = "6";
    createVersion({
      formulation: PROJECT,
      draft,
      changeReason: "reduce cost",
      author: "chemist",
      nextVersionNumber: 2,
    });
    expect(JSON.stringify(v1)).toBe(before);
  });

  it("reports a draft as unchanged after an edit is undone", () => {
    const v = firstVersion();
    const draft = draftFromVersion(v);
    expect(draftDiffersFrom(draft, v)).toBe(false);
    draft.lines[1].percent = "6";
    expect(draftDiffersFrom(draft, v)).toBe(true);
    draft.lines[1].percent = "12";
    expect(draftDiffersFrom(draft, v)).toBe(false);
  });

  it("notices a batch-size change as a real change", () => {
    const v = firstVersion();
    const draft = draftFromVersion(v);
    draft.basisBatchKg = "500";
    expect(draftDiffersFrom(draft, v)).toBe(true);
  });
});

describe("approval cannot be inherited or automated", () => {
  const approved: FormulationVersion = { ...firstVersion(), status: "production_approved", approvalRecordIds: ["ap-1"] };

  it("a clone of an approved version starts unapproved", () => {
    const draft = cloneToDraft(approved);
    const child = createVersion({
      formulation: PROJECT,
      draft,
      changeReason: "variant for sachet fill",
      author: "chemist",
      nextVersionNumber: 2,
    });
    expect(child.status).toBe("concept");
    expect(child.approvalRecordIds).toEqual([]);
  });

  it("a restored version produces an unapproved draft", () => {
    const child = createVersion({
      formulation: PROJECT,
      draft: cloneToDraft(approved),
      changeReason: "restore 0.1",
      author: "chemist",
      nextVersionNumber: 3,
    });
    expect(child.status).toBe("concept");
  });

  it("AI cannot approve for production, even holding an approval record", () => {
    const r = canTransitionTo(
      "pilot_approved",
      "production_approved",
      { kind: "agent", runId: "run-1" },
      { hasApprovalRecord: true },
    );
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("AI cannot grant pilot approval either", () => {
    const r = canTransitionTo(
      "pilot_candidate",
      "pilot_approved",
      { kind: "agent", runId: "run-1" },
      { hasApprovalRecord: true },
    );
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("the system cannot approve for production", () => {
    const r = canTransitionTo(
      "pilot_approved",
      "production_approved",
      { kind: "system", reason: "batch job" },
      { hasApprovalRecord: true },
    );
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("an import cannot approve, whatever the source file claims", () => {
    const r = canTransitionTo(
      "pilot_approved",
      "production_approved",
      { kind: "import", source: "legacy-erp.xlsx" },
      { hasApprovalRecord: true },
    );
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("a human still needs an approval record", () => {
    const r = canTransitionTo(
      "pilot_approved",
      "production_approved",
      { kind: "human", role: "quality", userId: "u1" },
      { hasApprovalRecord: false },
    );
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_RECORD_REQUIRED");
  });

  it("a human with the wrong role cannot approve", () => {
    const r = canTransitionTo(
      "pilot_approved",
      "production_approved",
      { kind: "human", role: "researcher", userId: "u1" },
      { hasApprovalRecord: true },
    );
    expect(r.code).toBe("ROLE_NOT_AUTHORIZED");
  });

  it("an authorized human with a record may approve", () => {
    const r = canTransitionTo(
      "pilot_approved",
      "production_approved",
      { kind: "human", role: "quality", userId: "u1" },
      { hasApprovalRecord: true },
    );
    expect(r.allowed).toBe(true);
  });
});

describe("version comparison", () => {
  it("reports added, removed and changed lines with field detail", () => {
    const v1 = firstVersion();
    const v2 = createVersion({
      formulation: PROJECT,
      draft: {
        schemaVersion: "1.0",
        formulationId: "f1",
        lines: [
          LINES[0],
          { ...LINES[1], percent: "10", supplierCode: "SUP-NEW", unitPrice: "180", currency: "KES" },
          line({ id: "c", displayName: "CAPB", percent: "4", functions: ["amphoteric_surfactant"], activeMatterPercent: "30" }),
        ],
        basisBatchKg: "100",
        updatedAt: "x",
        dirty: true,
      },
      changeReason: "swap preservative for CAPB trial",
      author: "chemist",
      nextVersionNumber: 2,
    });

    const c = compareVersions(v1, v2);
    const by = (n: string) => c.lines.find((l) => l.displayName === n)!;

    expect(by("Sodium Benzoate").kind).toBe("removed");
    expect(by("CAPB").kind).toBe("added");
    expect(by("SLES").kind).toBe("changed");
    expect(by("SLES").percentDelta).toBe("-2.0000");
    expect(by("SLES").changes.some((x) => x.kind === "supplier")).toBe(true);
    expect(by("SLES").changes.some((x) => x.kind === "unitPrice")).toBe(true);
    expect(c.added).toBe(1);
    expect(c.removed).toBe(1);
    // Water is reported as changed too, and correctly so: it is the q.s. line,
    // so every change to the others moves it. A diff that hid that would be
    // lying about what an operator will weigh out.
    expect(by("Water").kind).toBe("changed");
    expect(c.changed).toBe(2);
  });

  it("reports batch quantity changes when the batch size changes", () => {
    const v1 = firstVersion();
    const v2 = createVersion({
      formulation: PROJECT,
      draft: { schemaVersion: "1.0", formulationId: "f1", lines: LINES, basisBatchKg: "1000", updatedAt: "x", dirty: true },
      changeReason: "scale up",
      author: "chemist",
      nextVersionNumber: 2,
    });
    const sles = compareVersions(v1, v2).lines.find((l) => l.displayName === "SLES")!;
    expect(sles.beforeQuantity).toBe("12.0000");
    expect(sles.afterQuantity).toBe("120.0000");
  });

  it("renders a readable diff", () => {
    const v1 = firstVersion();
    const v2 = createVersion({
      formulation: PROJECT,
      draft: {
        schemaVersion: "1.0",
        formulationId: "f1",
        lines: [LINES[0], { ...LINES[1], percent: "10" }, LINES[2]],
        basisBatchKg: "100",
        updatedAt: "x",
        dirty: true,
      },
      changeReason: "cost down",
      author: "chemist",
      nextVersionNumber: 2,
    });
    const text = compareVersions(v1, v2).diffText;
    expect(text).toContain("- SLES");
    expect(text).toContain("+ SLES");
    expect(text).toContain("12.0000%");
    expect(text).toContain("10.0000%");
  });
});
