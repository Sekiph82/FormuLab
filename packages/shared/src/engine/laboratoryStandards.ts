/**
 * Configurable per-test laboratory standards and methods — assignment,
 * authorization, supersession handling, and the immutable snapshot a test
 * result carries forward. See schemas/laboratoryStandards.ts for the domain
 * model this operates on.
 */
import type { Actor } from "../schemas/status";
import { requireHumanActor } from "./regulatoryAuthorization";
import { newId } from "./versioning";
import type {
  LaboratoryMethodAssignmentType,
  LaboratoryStandard,
  LaboratoryTestMethod,
  TestMethodSnapshot,
} from "../schemas/laboratoryStandards";
import type { TestDefinition } from "../schemas/testDefinitions";

/**
 * Assigning/activating/superseding a standard or method is gated the same
 * way approving a formula's `pilot_approved` status is (`APPROVAL_AUTHORITY`
 * in schemas/status.ts) — manager-tier only (Phase 13 Session 1's 12-role
 * model: `research_manager`/`quality_manager` own lab method decisions,
 * `administrator` can too — the plain `researcher`/`quality` employee tiers
 * cannot, same reasoning as pilot approval). Any human may still VIEW, and
 * any human may create or edit a DRAFT method (preparation work), mirroring
 * the `requireHumanActor`/`requireAuthorizedRegulatoryActor` two-tier split
 * `regulatoryAuthorization.ts` already established. No second role system.
 */
export const LABORATORY_METHOD_MANAGER_ROLES = ["research_manager", "quality_manager", "administrator"] as const;
export type LaboratoryMethodManagerRole = (typeof LABORATORY_METHOD_MANAGER_ROLES)[number];

export function isAuthorizedLaboratoryMethodActor(
  actor: Actor,
): actor is Extract<Actor, { kind: "human" }> & { role: LaboratoryMethodManagerRole } {
  return actor.kind === "human" && (LABORATORY_METHOD_MANAGER_ROLES as readonly string[]).includes(actor.role);
}

export function requireAuthorizedLaboratoryMethodActor(
  actor: Actor,
  action: string,
): asserts actor is Extract<Actor, { kind: "human" }> & { role: LaboratoryMethodManagerRole } {
  if (!isAuthorizedLaboratoryMethodActor(actor)) {
    throw new Error(`Only an authorized research manager, quality manager, or administrator role may ${action}.`);
  }
}

function actorLabel(actor: Extract<Actor, { kind: "human" }>): string {
  return actor.userId;
}

// ---------------------------------------------------------------------------
// Standard code/edition/revision uniqueness
// ---------------------------------------------------------------------------

/** Throws if another standard already has the same (standardCode, edition,
 *  revision) — two distinct editions of the same code are fine; a literal
 *  duplicate is not. `excludeId` lets an in-place edit check against every
 *  OTHER row without tripping on itself. */
export function assertUniqueStandardCode(standards: LaboratoryStandard[], candidate: Pick<LaboratoryStandard, "id" | "standardCode" | "edition" | "revision">): void {
  const clash = standards.find(
    (s) =>
      s.id !== candidate.id &&
      s.standardCode === candidate.standardCode &&
      (s.edition ?? "") === (candidate.edition ?? "") &&
      (s.revision ?? "") === (candidate.revision ?? ""),
  );
  if (clash) {
    throw new Error(
      `Standard ${candidate.standardCode}${candidate.edition ? ` (${candidate.edition})` : ""}${
        candidate.revision ? ` rev. ${candidate.revision}` : ""
      } already exists (id ${clash.id}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal methods (a standard row with status "internal" + its method row)
// ---------------------------------------------------------------------------

export function createInternalStandard(
  actor: Actor,
  input: { standardCode: string; title: string; issuingOrganization: string; summary?: string },
  existing: LaboratoryStandard[],
): LaboratoryStandard {
  requireAuthorizedLaboratoryMethodActor(actor, "create an internal company method");
  const now = new Date().toISOString();
  const draft: LaboratoryStandard = {
    schemaVersion: "1.0",
    id: newId("labstd"),
    standardCode: input.standardCode,
    title: input.title,
    issuingOrganization: input.issuingOrganization,
    status: "internal",
    jurisdiction: [],
    applicableProductCategories: [],
    summary: input.summary,
    createdBy: actorLabel(actor as Extract<Actor, { kind: "human" }>),
    createdAt: now,
    updatedBy: actorLabel(actor as Extract<Actor, { kind: "human" }>),
    updatedAt: now,
  };
  assertUniqueStandardCode(existing, draft);
  return draft;
}

// ---------------------------------------------------------------------------
// Per-test assignment
// ---------------------------------------------------------------------------

/**
 * Assigns (or re-assigns) one method's `assignmentType` for its own test.
 * Only rows sharing the SAME `testDefinitionCode` as the target method are
 * ever touched — every other test's rows pass through unchanged, which is
 * the "changing one test does not change another" guarantee. Promoting a
 * method to `"primary"` demotes whatever was previously primary for that
 * same test to `"alternative"` rather than leaving two primaries.
 */
export function assignMethodToTest(
  methods: LaboratoryTestMethod[],
  methodId: string,
  assignmentType: LaboratoryMethodAssignmentType,
  actor: Actor,
): LaboratoryTestMethod[] {
  requireAuthorizedLaboratoryMethodActor(actor, "assign a standard/method to a test");
  const target = methods.find((m) => m.id === methodId);
  if (!target) throw new Error(`Unknown laboratory test method id: ${methodId}`);
  const now = new Date().toISOString();
  const who = actorLabel(actor as Extract<Actor, { kind: "human" }>);
  return methods.map((m) => {
    if (m.testDefinitionCode !== target.testDefinitionCode) return m;
    if (m.id === methodId) return { ...m, assignmentType, updatedBy: who, updatedAt: now };
    if (assignmentType === "primary" && m.assignmentType === "primary") {
      return { ...m, assignmentType: "alternative", updatedBy: who, updatedAt: now };
    }
    return m;
  });
}

/** Refuses assigning the same (testDefinitionCode, standardId) pair twice —
 *  a test may have many methods, but never two rows for the identical
 *  standard. Call before inserting a new `LaboratoryTestMethod` row. */
export function assertNoDuplicateAssignment(
  methods: LaboratoryTestMethod[],
  candidate: Pick<LaboratoryTestMethod, "id" | "testDefinitionCode" | "standardId">,
): void {
  const clash = methods.find(
    (m) => m.id !== candidate.id && m.testDefinitionCode === candidate.testDefinitionCode && m.standardId === candidate.standardId,
  );
  if (clash) {
    throw new Error(`Test ${candidate.testDefinitionCode} already has a method for standard ${candidate.standardId} (method ${clash.id}).`);
  }
}

/** A superseded standard requires the caller to have passed `acknowledged:
 *  true` — never silently selectable. */
export function assertSupersededAcknowledged(standard: LaboratoryStandard, acknowledged: boolean): void {
  if (standard.status === "superseded" && !acknowledged) {
    throw new Error(`Standard ${standard.standardCode} is superseded. Acknowledge before selecting it.`);
  }
}

// ---------------------------------------------------------------------------
// Mutation guards
// ---------------------------------------------------------------------------

/** Active/approved methods are not silently editable — supersede instead
 *  (create a new revision row and point `supersededByMethodId` at it),
 *  the same discipline `RegulatoryRule`/`ApprovalPolicy` already apply to
 *  their own active rows. Draft rows may be freely edited by any human. */
export function assertMethodEditable(method: LaboratoryTestMethod, actor: Actor): void {
  if (method.status === "draft") {
    requireHumanActor(actor, "edit a draft laboratory test method");
    return;
  }
  requireAuthorizedLaboratoryMethodActor(actor, `edit an active/superseded laboratory test method (status: ${method.status})`);
}

/** Refuses a hard delete when the method is referenced — by any current
 *  assignment row (itself) or by a historical `TestMethodSnapshot`. Callers
 *  should supersede instead. */
export function assertMethodDeletable(method: LaboratoryTestMethod, referencedByResults: boolean): void {
  if (referencedByResults) {
    throw new Error(`Laboratory test method ${method.id} is referenced by a historical test result and cannot be deleted.`);
  }
  if (method.status === "active") {
    throw new Error(`Laboratory test method ${method.id} is active and cannot be silently deleted — supersede it instead.`);
  }
}

// ---------------------------------------------------------------------------
// Immutable historical snapshot
// ---------------------------------------------------------------------------

/** Captures the method actually used, once, at result-creation time. Never
 *  called again for an existing result — a later edit to the standard or
 *  method must not change what already happened. */
export function buildTestMethodSnapshot(method: LaboratoryTestMethod, standard: LaboratoryStandard): TestMethodSnapshot {
  return {
    standardId: standard.id,
    standardCode: standard.standardCode,
    standardEdition: standard.edition,
    standardRevision: standard.revision,
    methodId: method.id,
    methodName: method.methodName,
    methodVersion: method.methodVersion,
    instrumentSettings: method.instrumentSettings,
    environmentalConditions: method.environmentalConditions,
    unit: method.unit,
    acceptanceCriteria: method.acceptanceCriteria,
    calculationMethod: method.calculationMethod,
    capturedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Migration — legacy free-text `methodReference`
// ---------------------------------------------------------------------------

export interface LegacyMethodReferenceReport {
  testDefinitionCode: string;
  testDefinitionName: string;
  legacyReference: string;
}

/**
 * Every `TestDefinition.methodReference` that is set becomes a reported,
 * unresolved legacy reference — never auto-converted into a
 * `LaboratoryStandard` row. A free-text string like "ISO 4316" does not
 * reliably carry an edition/revision/issuing-organization split, and
 * guessing one would violate "never invent a standard code." A human
 * reviews each entry in this report and creates the real structured
 * `LaboratoryStandard`/`LaboratoryTestMethod` rows themselves when ready.
 * Idempotent: re-running produces the same report until a definition's
 * `methodReference` changes.
 */
export function findLegacyMethodReferences(definitions: TestDefinition[]): LegacyMethodReferenceReport[] {
  return definitions
    .filter((d) => (d.methodReference ?? "").trim().length > 0)
    .map((d) => ({ testDefinitionCode: d.code, testDefinitionName: d.name, legacyReference: d.methodReference! }));
}
