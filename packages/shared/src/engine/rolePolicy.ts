/**
 * Phase 13 Session 3 — the canonical fixed-role authorization *policy*:
 * "may this role ever perform this category of action?" This module
 * answers only that question (architecture doc §14's item #2). It is
 * deliberately silent on the other three layers that gate a real action:
 * visibility (#1, N/A per Phase 13 — every authenticated user sees every
 * project), workflow state (#3, `status.ts`'s `ALLOWED_NEXT`/
 * `canTransitionTo` and the laboratory/stability lifecycle modules), and
 * required-approval-gate state (#4, `ApprovalRecord`/the future workflow
 * engine). `can(role, area, capability) === true` never by itself means an
 * action is currently executable — Session 4 is where role capability,
 * workflow state, and gate state are combined at an actual privileged-
 * action boundary. See docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md §7.
 *
 * Default-deny by construction: `can()` looks a role/area/capability triple
 * up in a fixed, fully-enumerated table and returns `false` for anything
 * not explicitly present — an unknown area, an unsupported capability, or
 * a role string that isn't one of the 12 fixed roles all fall through the
 * same `undefined` lookup path to `false`. There is no "if not explicitly
 * denied, allow" branch anywhere in this file.
 *
 * `Role` is a re-export of `status.ts`'s `ApprovalRole` — deliberately not
 * a second, independently-declared string union. `identity.rs` (Rust) is
 * the storage-layer mirror of the same 12 strings; the parity mechanism
 * (`rolePolicy.roleVocabularyParity.test.ts` + `identity.rs`'s own
 * `role_vocabulary_matches_the_shared_json_fixture` test) is a shared JSON
 * fixture (`roleVocabulary.json`) both languages check *themselves*
 * against, not a third hand-copied list either language trusts the other
 * to keep in sync.
 */
import { APPROVAL_AUTHORITY, APPROVAL_ROLES, type ApprovalRole } from "../schemas/status";
import { AUTHORIZED_REGULATORY_ROLES } from "./regulatoryAuthorization";
import { LABORATORY_METHOD_MANAGER_ROLES } from "./laboratoryStandards";

/** The canonical role vocabulary — imported, not re-declared. */
export type Role = ApprovalRole;
export const ROLES = APPROVAL_ROLES;

/**
 * The real FormuLab workspaces/domains, one per row of the architecture
 * doc's §6 matrix (`pilot_approved`/`production_approved` kept as two
 * distinct areas, `approvalPilot`/`approvalProduction`, exactly mirroring
 * the two separate table rows — they have different worker/approver role
 * sets and must not be merged into one generic "approval" bucket).
 * Deliberately does **not** add a separate "Dossier / Evidence" area: the
 * approved §6 matrix models dossier/claims/labels work as part of the
 * `regulatory` row (see its own header, "Regulatory (dossier, claims/
 * labels)"), and splitting it here would be redesigning the approved
 * matrix rather than transcribing it — flagged, not silently changed
 * (architecture doc §6's own "not yet domain-expert-reviewed" caveat
 * still applies to this grouping).
 */
export const POLICY_AREAS = [
  "home",
  "projects",
  "formulation",
  "laboratory",
  "stability",
  "optimization",
  "rawMaterials",
  "supplierDocuments",
  "regulatory",
  "approvalPilot",
  "approvalProduction",
  "productionEngineering",
  "production",
  "documentControl",
  "reports",
  "dataExchange",
  "administrationUsers",
  "administrationSecurity",
  "administrationSettings",
  "systemAdministration",
] as const;
export type PolicyArea = (typeof POLICY_AREAS)[number];

/** Human-readable labels for the areas above — for a future read-only
 *  "role capabilities" view (Administration → Users, Session 5), never a
 *  second permission source: always generated from `capabilitiesFor`,
 *  never hand-maintained in parallel. */
export const POLICY_AREA_LABELS: Record<PolicyArea, string> = {
  home: "Home",
  projects: "Projects",
  formulation: "Formulation",
  laboratory: "Laboratory (trials, methods, corrective actions)",
  stability: "Stability",
  optimization: "Optimization",
  rawMaterials: "Raw material records (SDS/TDS/COA/specs)",
  supplierDocuments: "Supplier/procurement documentation",
  regulatory: "Regulatory (dossier, claims/labels)",
  approvalPilot: "Approval — pilot_approved",
  approvalProduction: "Approval — production_approved",
  productionEngineering: "Production engineering (scale-up, process prep)",
  production: "Production (batch/process records)",
  documentControl: "Document control (publication, revision, export)",
  reports: "Reports",
  dataExchange: "Data Exchange (import/commit masterdata)",
  administrationUsers: "Administration → Users",
  administrationSecurity: "Administration → Security history",
  administrationSettings: "Administration → App settings",
  systemAdministration:
    "System administration (backup, restore, schema migration, data-location changes)",
};

/**
 * A compact, fixed capability vocabulary (architecture doc §6's legend).
 * `release` is not its own matrix cell — it is the `production` area's
 * `approve` grant under its workflow name (`production_manager`'s
 * batch-release sign-off, §15.4 gate #4); wherever `approve` is granted on
 * `production`, `release` is granted alongside it, from the same cell, not
 * a second hand-typed list (see the `production` row below).
 */
export const CAPABILITIES = [
  "view",
  "create",
  "edit",
  "delete",
  "submit",
  "approve",
  "reject",
  "verify",
  "supersede",
  "release",
  "export",
  "administer",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

type CapabilityGrid = Record<PolicyArea, Record<Role, readonly Capability[]>>;

/** Zips a 12-cell row (in `ROLES`'/`APPROVAL_ROLES`' exact column order —
 *  researcher, research_manager, quality, quality_manager, regulatory,
 *  raw_material, procurement, production_engineering, production,
 *  production_manager, document_control, administrator) into a
 *  `Record<Role, Capability[]>`, so each matrix row below reads as one
 *  line per role in the architecture doc's own column order instead of a
 *  hand-built object literal that could silently transpose two roles. */
function row(cells: readonly (readonly Capability[])[]): Record<Role, readonly Capability[]> {
  if (cells.length !== ROLES.length) {
    throw new Error(`rolePolicy row() expected ${ROLES.length} cells, got ${cells.length}`);
  }
  const out = {} as Record<Role, readonly Capability[]>;
  ROLES.forEach((role, i) => {
    out[role] = cells[i];
  });
  return out;
}

const V: Capability[] = ["view"];
const NONE: Capability[] = [];

/**
 * The full role/area/capability matrix — a direct, cell-by-cell
 * transcription of architecture doc §6's table (Session 1's first full
 * draft, "not yet domain-expert-reviewed" per that doc's own flag,
 * carried forward unchanged here) with two explicit, documented additions
 * beyond the literal §6 cells, both directly instructed by this Session 3
 * brief and by the later, user-approved §15.4/§25 gate-authority decision
 * §6's table itself predates:
 *
 * 1. `production_manager` gains `verify` on `rawMaterials` and
 *    `supplierDocuments` — §6's literal cells for `production_manager` on
 *    those two rows are both "—" (no access at all), which contradicts
 *    §15.4's later, explicit, user-approved decision that
 *    `production_manager` is the sole approval authority for the
 *    raw-material-verification and supplier-document-verification gates.
 *    §15.4 is chronologically later and explicitly user-approved, so it
 *    wins; §6's stale cells are the discrepancy, not this addition — see
 *    docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md §6.3 for the recorded
 *    discrepancy. This grants only `verify` (the gate-approval action),
 *    not `view`/`create`/`edit` — `production_manager` still cannot see or
 *    modify the underlying raw-material/supplier records themselves,
 *    exactly as §6 restricts, only the verification gate decision.
 * 2. `quality` and `administrator` gain `verify` on `regulatory` in addition
 *    to §6's literal "V"-only cells for those two roles —
 *    `regulatoryAuthorization.ts`'s `AUTHORIZED_REGULATORY_ROLES`
 *    (imported below, not re-typed) already, deliberately, grants all
 *    three of `regulatory`/`quality`/`administrator` regulatory-evidence-
 *    confirmation authority today (architecture doc §8: "unchanged...
 *    because that's what the existing, working code already granted").
 *    §6's matrix simply never had this fully reflected in its own cells
 *    (only `regulatory`'s own cell already listed `Vf`); this fixes that
 *    omission against the real, already-enforced authority, it does not
 *    add new authority the app doesn't already have.
 *
 * No other cell deviates from §6's literal table. Everywhere §6 shows "—"
 * (and neither addition above applies), the role has zero capabilities on
 * that area — `can()` returns `false`, not "if not denied, allow".
 */
const MATRIX: CapabilityGrid = {
  home: row([V, V, V, V, V, V, V, V, V, V, V, V]),

  projects: row([
    ["view", "create"],
    ["view", "create", "edit"],
    V,
    V,
    V,
    V,
    V,
    V,
    V,
    V,
    V,
    ["view", "create", "edit", "delete"],
  ]),

  formulation: row([
    ["view", "create", "edit", "submit"],
    ["view", "approve", "reject"],
    V,
    V,
    V,
    V,
    NONE,
    V,
    V,
    V,
    V,
    V,
  ]),

  // `supersede` is added below via a derivation loop from
  // `LABORATORY_METHOD_MANAGER_ROLES` (imported below), not hand-typed
  // into these cells — see the loop after this literal.
  laboratory: row([
    ["view", "create", "edit", "submit"],
    ["view", "approve", "reject"],
    ["view", "create"],
    ["view", "approve", "reject"],
    V,
    V,
    NONE,
    V,
    V,
    V,
    V,
    V,
  ]),

  stability: row([
    ["view", "create", "edit", "submit"],
    ["view", "approve", "reject"],
    ["view", "create"],
    ["view", "approve", "reject"],
    V,
    NONE,
    NONE,
    V,
    NONE,
    V,
    V,
    V,
  ]),

  optimization: row([
    ["view", "create", "edit"],
    V,
    V,
    V,
    V,
    NONE,
    NONE,
    V,
    NONE,
    NONE,
    NONE,
    V,
  ]),

  // Addition #1 (see module doc comment): production_manager -> ["view", "verify"] instead of §6's literal [].
  rawMaterials: row([
    V,
    V,
    ["view", "verify"],
    ["view", "approve"],
    V,
    ["view", "create", "edit"],
    ["view", "create"],
    V,
    NONE,
    ["view", "verify"],
    V,
    V,
  ]),

  // Addition #1 (see module doc comment): production_manager -> ["view", "verify"] instead of §6's literal [].
  supplierDocuments: row([
    NONE,
    NONE,
    V,
    V,
    V,
    V,
    ["view", "create", "edit"],
    NONE,
    NONE,
    ["view", "verify"],
    V,
    V,
  ]),

  // Addition #2 (see module doc comment): `verify` is added below via a
  // derivation loop from `AUTHORIZED_REGULATORY_ROLES` (regulatory,
  // quality, administrator), not hand-typed into these cells.
  regulatory: row([
    V,
    V,
    V,
    V,
    ["view", "create", "edit", "approve", "reject"],
    V,
    V,
    V,
    NONE,
    NONE,
    V,
    V,
  ]),

  // Derived from APPROVAL_AUTHORITY.pilot_approved below, not hand-typed
  // for the approve/reject columns — see the Object.assign block after
  // this literal. "submit" (the preparer/employee tier) has no equivalent
  // in APPROVAL_AUTHORITY (a target-status-keyed approver list only), so
  // it stays a direct §6 transcription.
  approvalPilot: row([
    ["submit"],
    NONE,
    ["submit"],
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
  ]),

  approvalProduction: row([
    NONE,
    NONE,
    ["submit"],
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    ["submit"],
    NONE,
    NONE,
    NONE,
  ]),

  productionEngineering: row([
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    ["view", "create", "edit"],
    V,
    ["view", "approve", "reject"],
    V,
    V,
  ]),

  // `release` rides along with `approve` here — see CAPABILITIES' doc
  // comment: production_manager's batch-release sign-off (§15.4 gate #4)
  // is this cell's `approve`, not a separate grant.
  production: row([
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    V,
    ["view", "create", "edit"],
    ["view", "approve", "reject", "release"],
    V,
    V,
  ]),

  documentControl: row([
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    ["view", "create", "edit", "export", "administer"],
    V,
  ]),

  reports: row([
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
    ["view", "export"],
  ]),

  dataExchange: row([
    ["view", "create"],
    ["view", "create"],
    ["view", "create"],
    ["view", "create"],
    ["view", "create"],
    ["view", "create"],
    ["view", "create"],
    NONE,
    NONE,
    NONE,
    NONE,
    ["view", "create", "administer"],
  ]),

  administrationUsers: row([
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    ["view", "create", "edit", "administer"],
  ]),

  administrationSecurity: row([
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    ["view", "administer"],
  ]),

  administrationSettings: row([
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    ["view", "edit", "administer"],
  ]),

  // Phase 13 Session 4 addition (architecture doc §9.2/§9.3): §6's original
  // table has no System-Administration row at all — Session 3's privileged-
  // command inventory found backup/restore/migration/data-location commands
  // with nothing to enforce against. Per explicit Session 4 instruction,
  // "system-level destructive/configuration mutations should be
  // Administrator-only unless the current approved architecture proves
  // otherwise" — nothing in the approved architecture grants any other role
  // this authority, so `administrator` is the only role with any capability
  // here, exactly like `administrationUsers`/`administrationSecurity` above.
  systemAdministration: row([
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    NONE,
    ["view", "administer"],
  ]),
};

// Every grant below is derived from an existing, independent authority
// source (`LABORATORY_METHOD_MANAGER_ROLES`, `AUTHORIZED_REGULATORY_ROLES`,
// `APPROVAL_AUTHORITY`) instead of re-typing its role list — this is the
// mechanism that makes "approval parity" (architecture doc §19) structural
// rather than a hoped-for convention: change one of those source lists and
// this grid changes with it in the same build, nothing to remember to keep
// in sync by hand.
for (const role of LABORATORY_METHOD_MANAGER_ROLES) {
  MATRIX.laboratory[role] = [...MATRIX.laboratory[role], "supersede"];
}
for (const role of AUTHORIZED_REGULATORY_ROLES) {
  if (!MATRIX.regulatory[role].includes("verify")) {
    MATRIX.regulatory[role] = [...MATRIX.regulatory[role], "verify"];
  }
}
for (const role of APPROVAL_AUTHORITY.pilot_approved) {
  MATRIX.approvalPilot[role] = [...MATRIX.approvalPilot[role], "approve", "reject"];
}
for (const role of APPROVAL_AUTHORITY.production_approved) {
  MATRIX.approvalProduction[role] = [...MATRIX.approvalProduction[role], "approve", "reject"];
}

/**
 * May `role` ever perform `capability` in `area`? Default-deny: an
 * unrecognized area, capability, or role string all fall through the same
 * `undefined` lookup to `false` — there is no "allow unless denied" path.
 *
 * Deliberately typed with plain `string` parameters, not the narrower
 * `Role`/`PolicyArea`/`Capability` unions: real callers usually hold a
 * `SafeUser.role` (`auth.ts`, wire-typed `string` since it crosses the
 * Tauri IPC boundary) or a value from user input/tests, and forcing a cast
 * at every call site would be friction for no safety benefit — the
 * default-deny behavior below is exactly as strict either way. Use the
 * typed `POLICY_AREAS`/`CAPABILITIES`/`ROLES` arrays (or the introspection
 * helpers below, which *are* narrowly typed) when you want compile-time
 * checking of a literal area/capability/role.
 */
export function can(role: string, area: string, capability: string): boolean {
  const areaGrants = (MATRIX as unknown as Record<string, Record<string, readonly string[]> | undefined>)[area];
  if (!areaGrants) return false;
  const roleGrants = areaGrants[role];
  if (!roleGrants) return false;
  return roleGrants.includes(capability);
}

/** Every capability `role` has in `area` — always a real (possibly empty)
 *  array, never `undefined`, since `MATRIX` is exhaustive over every
 *  `PolicyArea` x `Role` pair by construction (`row()` throws at module
 *  load if a row is missing a cell). */
export function capabilitiesFor(role: Role, area: PolicyArea): readonly Capability[] {
  return MATRIX[area][role];
}

/** Every area where `role` has at least one capability — the input a
 *  future read-only "what can this role do" view (Administration → Users,
 *  Session 5) needs, generated from the same canonical policy, never a
 *  second display-only matrix. */
export function areasFor(role: Role): readonly PolicyArea[] {
  return POLICY_AREAS.filter((area) => MATRIX[area][role].length > 0);
}

/** Every role that has `capability` in `area` — e.g. "who can approve
 *  production_approved" for an audit/introspection view. */
export function rolesWithCapability(area: PolicyArea, capability: Capability): readonly Role[] {
  return ROLES.filter((role) => MATRIX[area][role].includes(capability));
}

/**
 * Phase 13 Session 4 — the full, fully-resolved (post-derivation-loop)
 * matrix as a plain, JSON-serializable object: `{ [area]: { [role]:
 * capability[] } }`. This is the one function that turns `MATRIX` — an
 * internal, TypeScript-typed data structure — into the shared contract
 * `scripts/generate-role-policy-matrix.ts` serializes to
 * `rolePolicyMatrix.generated.json`, which `role_policy.rs` (Rust) then
 * reads via `include_str!` to implement its own `can()`. Rust holds no
 * hand-typed permission matrix of its own; this snapshot, generated from
 * this file, is Rust's only source for one. See architecture doc §7/§9.3.
 */
export function fullMatrixSnapshot(): Record<PolicyArea, Record<Role, readonly Capability[]>> {
  const out = {} as Record<PolicyArea, Record<Role, readonly Capability[]>>;
  for (const area of POLICY_AREAS) {
    const roleGrants = {} as Record<Role, readonly Capability[]>;
    for (const role of ROLES) {
      roleGrants[role] = MATRIX[area][role];
    }
    out[area] = roleGrants;
  }
  return out;
}
