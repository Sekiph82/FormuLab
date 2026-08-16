import { describe, expect, it } from "vitest";
import {
  can,
  capabilitiesFor,
  areasFor,
  rolesWithCapability,
  ROLES,
  POLICY_AREAS,
  CAPABILITIES,
  type Role,
} from "./rolePolicy";
import { APPROVAL_AUTHORITY } from "../schemas/status";

describe("rolePolicy — canonical model", () => {
  it("supports exactly 12 roles", () => {
    expect(ROLES.length).toBe(12);
  });

  it("does not accept chemist", () => {
    expect(ROLES).not.toContain("chemist");
    expect(can("chemist", "laboratory", "view")).toBe(false);
  });

  it("does not accept a packaging role", () => {
    expect(ROLES).not.toContain("packaging");
    expect(can("packaging", "formulation", "view")).toBe(false);
  });

  it("does not accept an unknown/custom role", () => {
    for (const bogus of ["site_admin", "supervisor", "guest", "", "Researcher", "RESEARCHER"]) {
      expect(can(bogus, "home", "view")).toBe(false);
    }
  });
});

describe("rolePolicy — default deny", () => {
  it("denies an unknown area for an otherwise-valid role", () => {
    expect(can("administrator", "not_a_real_area", "view")).toBe(false);
  });

  it("denies an unsupported/unknown capability", () => {
    expect(can("administrator", "home", "not_a_real_capability")).toBe(false);
    expect(can("administrator", "administrationUsers", "delete")).toBe(false);
  });

  it("denies combinations not explicitly granted, for every role, on a locked-down area", () => {
    for (const role of ROLES) {
      if (role === "administrator") continue;
      expect(can(role, "administrationUsers", "view")).toBe(false);
      expect(can(role, "administrationUsers", "administer")).toBe(false);
    }
  });

  it("never authorizes via an implicit fallback — every PolicyArea x Role pair is a real, finite array", () => {
    for (const area of POLICY_AREAS) {
      for (const role of ROLES) {
        expect(Array.isArray(capabilitiesFor(role, area))).toBe(true);
      }
    }
  });
});

describe("rolePolicy — worker/manager separation", () => {
  it("researcher cannot perform research-manager approval (pilot_approved)", () => {
    expect(can("researcher", "approvalPilot", "approve")).toBe(false);
    expect(can("researcher", "approvalPilot", "reject")).toBe(false);
    expect(can("researcher", "approvalPilot", "submit")).toBe(true);
  });

  it("quality cannot perform quality-manager approval", () => {
    expect(can("quality", "approvalPilot", "approve")).toBe(false);
    expect(can("quality", "approvalProduction", "approve")).toBe(false);
    expect(can("quality", "approvalProduction", "submit")).toBe(true);
  });

  it("production cannot perform production-manager approval/release", () => {
    expect(can("production", "approvalProduction", "approve")).toBe(false);
    expect(can("production", "production", "approve")).toBe(false);
    expect(can("production", "production", "release")).toBe(false);
    expect(can("production", "production", "edit")).toBe(true);
  });

  it("raw_material cannot perform its Production Manager verification gate", () => {
    expect(can("raw_material", "rawMaterials", "verify")).toBe(false);
    expect(can("raw_material", "rawMaterials", "edit")).toBe(true);
  });

  it("procurement cannot perform the supplier-document Production Manager verification gate", () => {
    expect(can("procurement", "supplierDocuments", "verify")).toBe(false);
    expect(can("procurement", "supplierDocuments", "edit")).toBe(true);
  });

  it("production_engineering cannot perform the downstream handoff Production Manager approval", () => {
    expect(can("production_engineering", "productionEngineering", "approve")).toBe(false);
    expect(can("production_engineering", "productionEngineering", "edit")).toBe(true);
  });

  it("quality cannot perform the raw-material Production Manager verification gate (Phase 13 closure-session correction)", () => {
    // production_manager (plus administrator) is the gate's *sole*
    // decide authority — §6's literal `quality` cell here predated the
    // gate and quietly granted a second one; see rolePolicy.ts's own
    // "Correction #4" doc comment for the full finding.
    expect(can("quality", "rawMaterials", "verify")).toBe(false);
    expect(can("quality", "rawMaterials", "view")).toBe(true);
  });
});

describe("rolePolicy — manager authority", () => {
  it("research_manager has research/lab manager capabilities", () => {
    expect(can("research_manager", "formulation", "approve")).toBe(true);
    expect(can("research_manager", "formulation", "reject")).toBe(true);
    expect(can("research_manager", "laboratory", "approve")).toBe(true);
    expect(can("research_manager", "laboratory", "supersede")).toBe(true);
    expect(can("research_manager", "approvalPilot", "approve")).toBe(true);
  });

  it("quality_manager has quality manager capabilities", () => {
    expect(can("quality_manager", "laboratory", "approve")).toBe(true);
    expect(can("quality_manager", "approvalPilot", "approve")).toBe(true);
    expect(can("quality_manager", "approvalProduction", "approve")).toBe(true);
    expect(can("quality_manager", "rawMaterials", "approve")).toBe(true);
  });

  it("production_manager has the four §15.4 gate approvals plus the existing production_approved gate", () => {
    expect(can("production_manager", "rawMaterials", "verify")).toBe(true);
    expect(can("production_manager", "supplierDocuments", "verify")).toBe(true);
    expect(can("production_manager", "productionEngineering", "approve")).toBe(true);
    expect(can("production_manager", "production", "approve")).toBe(true);
    expect(can("production_manager", "production", "release")).toBe(true);
    expect(can("production_manager", "approvalProduction", "approve")).toBe(true);
  });

  it("production_manager's raw-material/supplier verification is narrow — no view/create/edit on the underlying records", () => {
    expect(can("production_manager", "rawMaterials", "view")).toBe(true); // the verify capability implies read access to what it verifies
    expect(can("production_manager", "rawMaterials", "create")).toBe(false);
    expect(can("production_manager", "rawMaterials", "edit")).toBe(false);
    expect(can("production_manager", "supplierDocuments", "create")).toBe(false);
    expect(can("production_manager", "supplierDocuments", "edit")).toBe(false);
  });
});

describe("rolePolicy — regulatory", () => {
  it("regulatory retains its own review/verify/approve/reject capability", () => {
    expect(can("regulatory", "regulatory", "verify")).toBe(true);
    expect(can("regulatory", "regulatory", "approve")).toBe(true);
    expect(can("regulatory", "regulatory", "reject")).toBe(true);
    expect(can("regulatory", "approvalProduction", "approve")).toBe(true);
  });

  it("regulatory does not acquire unrelated system administration", () => {
    expect(can("regulatory", "administrationUsers", "administer")).toBe(false);
    expect(can("regulatory", "administrationSettings", "administer")).toBe(false);
  });

  it("is not split into employee/manager tiers", () => {
    expect(ROLES).toContain("regulatory");
    expect(ROLES).not.toContain("regulatory_manager");
  });
});

describe("rolePolicy — document control", () => {
  it("document_control can perform the document lifecycle operations", () => {
    expect(can("document_control", "documentControl", "create")).toBe(true);
    expect(can("document_control", "documentControl", "edit")).toBe(true);
    expect(can("document_control", "documentControl", "export")).toBe(true);
    expect(can("document_control", "documentControl", "administer")).toBe(true);
  });

  it("document_control does not gain scientific approval authority by default", () => {
    expect(can("document_control", "approvalPilot", "approve")).toBe(false);
    expect(can("document_control", "approvalProduction", "approve")).toBe(false);
    expect(can("document_control", "laboratory", "approve")).toBe(false);
    expect(can("document_control", "regulatory", "approve")).toBe(false);
    expect(can("document_control", "production", "approve")).toBe(false);
  });
});

describe("rolePolicy — administrator", () => {
  it("has system administration", () => {
    expect(can("administrator", "administrationUsers", "administer")).toBe(true);
    expect(can("administrator", "administrationSecurity", "administer")).toBe(true);
    expect(can("administrator", "administrationSettings", "administer")).toBe(true);
  });

  it("retains the approved scientific approval/testing capabilities", () => {
    expect(can("administrator", "approvalPilot", "approve")).toBe(true);
    expect(can("administrator", "approvalProduction", "approve")).toBe(true);
  });

  it("does not silently gain create/edit on scientific content beyond the approved matrix (view-only)", () => {
    for (const area of ["formulation", "laboratory", "stability", "optimization", "regulatory"] as const) {
      expect(can("administrator", area, "view")).toBe(true);
      expect(can("administrator", area, "create")).toBe(false);
      expect(can("administrator", area, "edit")).toBe(false);
    }
  });
});

describe("rolePolicy — approval-authority parity", () => {
  it("agrees with APPROVAL_AUTHORITY.pilot_approved exactly", () => {
    for (const role of ROLES) {
      const expected = (APPROVAL_AUTHORITY.pilot_approved as readonly Role[]).includes(role);
      expect(can(role, "approvalPilot", "approve")).toBe(expected);
      expect(can(role, "approvalPilot", "reject")).toBe(expected);
    }
  });

  it("agrees with APPROVAL_AUTHORITY.production_approved exactly", () => {
    for (const role of ROLES) {
      const expected = (APPROVAL_AUTHORITY.production_approved as readonly Role[]).includes(role);
      expect(can(role, "approvalProduction", "approve")).toBe(expected);
      expect(can(role, "approvalProduction", "reject")).toBe(expected);
    }
  });
});

describe("rolePolicy — introspection", () => {
  it("capabilitiesFor returns the same result can() would for every capability", () => {
    for (const area of POLICY_AREAS) {
      for (const role of ROLES) {
        const caps = capabilitiesFor(role, area);
        for (const capability of CAPABILITIES) {
          expect(caps.includes(capability)).toBe(can(role, area, capability));
        }
      }
    }
  });

  it("areasFor(administrator) includes administration areas and excludes nothing it has a grant on", () => {
    const areas = areasFor("administrator");
    expect(areas).toContain("administrationUsers");
    expect(areas).toContain("home");
    for (const area of POLICY_AREAS) {
      const hasAny = capabilitiesFor("administrator", area).length > 0;
      expect(areas.includes(area)).toBe(hasAny);
    }
  });

  it("rolesWithCapability(production, release) is exactly production_manager", () => {
    expect(rolesWithCapability("production", "release")).toEqual(["production_manager"]);
  });

  it("rolesWithCapability(administrationUsers, administer) is exactly administrator", () => {
    expect(rolesWithCapability("administrationUsers", "administer")).toEqual(["administrator"]);
  });
});
