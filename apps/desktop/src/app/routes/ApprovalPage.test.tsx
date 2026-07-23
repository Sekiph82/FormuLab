/**
 * Spec Part 5 coverage: "Approval blocker navigation reaches the correct
 * workspace" — always carrying the project id, never guessing one (spec
 * 4.12). Pure-function test; the full ApprovalPanel is already covered by
 * ApprovalPanel.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { mapApprovalNavTargetToPath } from "./ApprovalPage";

describe("mapApprovalNavTargetToPath", () => {
  it("routes formula-editing blockers back to Formulation, preserving the project id and naming the exact tab", () => {
    expect(mapApprovalNavTargetToPath("builder", "proj-1")).toBe("/formulation?project=proj-1&tab=builder");
    expect(mapApprovalNavTargetToPath("compatibility", "proj-1")).toBe("/formulation?project=proj-1&tab=compatibility");
    expect(mapApprovalNavTargetToPath("safety", "proj-1")).toBe("/formulation?project=proj-1&tab=safety");
    expect(mapApprovalNavTargetToPath("cost", "proj-1")).toBe("/formulation?project=proj-1&tab=cost");
  });

  it("routes laboratory-shaped blockers to the Laboratory workspace with the right section", () => {
    expect(mapApprovalNavTargetToPath("trials", "proj-1")).toBe("/laboratory?project=proj-1&section=trials");
    expect(mapApprovalNavTargetToPath("tests", "proj-1")).toBe("/laboratory?project=proj-1&section=tests");
    expect(mapApprovalNavTargetToPath("correctiveActions", "proj-1")).toBe("/laboratory?project=proj-1&section=correctiveActions");
  });

  it("routes stability and regulatory blockers to their own workspaces", () => {
    expect(mapApprovalNavTargetToPath("stability", "proj-1")).toBe("/stability?project=proj-1");
    expect(mapApprovalNavTargetToPath("regulatory", "proj-1")).toBe("/regulatory?project=proj-1");
  });

  it("routes optimizer blockers to the Optimization workspace", () => {
    expect(mapApprovalNavTargetToPath("optimizer", "proj-1")).toBe("/optimization?project=proj-1");
  });

  it("never drops the project id, whatever the target", () => {
    const targets = ["builder", "compatibility", "safety", "optimizer", "trials", "tests", "stability", "correctiveActions", "cost", "regulatory"] as const;
    for (const target of targets) {
      expect(mapApprovalNavTargetToPath(target, "proj-42")).toContain("project=proj-42");
    }
  });
});
