/**
 * Configurable, per-test laboratory standards and methods.
 *
 * Before this file: a `TestDefinition` (schemas/testDefinitions.ts) only
 * carries a free-text `methodReference` ("in-house SOP-014", "ISO 4316" —
 * never invented) with no edition/revision, no active/superseded status, and
 * no way to give one test a primary standard and a different test a
 * different one beyond that single string. `methodReference` is left
 * unmodified — existing definitions and results keep working exactly as
 * before. `LaboratoryStandard`/`LaboratoryTestMethod` below are the
 * structured, per-test-assignable model layered alongside it. See
 * project-control/claude/handoffs/PHASE10_CURRENT.md Session 1A for the before-state
 * assessment.
 *
 * Copyright discipline (non-negotiable): this schema never stores or
 * implies the full text of a copyrighted standard (ISO/ASTM/EN/DIN/AOAC/
 * USP/EP/BS/...). Only identifying metadata, a source reference (URL or
 * document reference), and a user/company-authored summary or procedure —
 * the same "assist, never replace the license" discipline the Regulatory
 * Engine already applies to legislation (see schemas/regulatory.ts).
 *
 * Row identity follows the `regulatory_dossiers`/`dossierCode` convention
 * (see masterdata.rs's `row_key`, which checks a `code` field before `id`):
 * both entities here use `id` as their storage key and a differently-named
 * human code (`standardCode`) so multiple editions of the same standard
 * code can exist as distinct rows without colliding on upsert.
 */
import { z } from "zod";

export const LABORATORY_STANDARD_STATUSES = ["draft", "active", "superseded", "internal"] as const;
export type LaboratoryStandardStatus = (typeof LABORATORY_STANDARD_STATUSES)[number];

export const laboratoryStandardSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  /** Human-readable code, e.g. "ISO-4316" or "FORMULAB-SOP-014" for an
   *  internal method — never the storage key (see file header). Uniqueness
   *  of (standardCode, edition, revision) is validated by
   *  `engine/laboratoryStandards.ts`, not by the storage layer, since two
   *  editions of the same code are two legitimate, distinct rows. */
  standardCode: z.string().min(1),
  title: z.string().min(1),
  issuingOrganization: z.string().min(1),
  /** Free text — "2019", "5th Edition" — never invented; absent is honest
   *  when no edition has been recorded yet. */
  edition: z.string().optional(),
  revision: z.string().optional(),
  status: z.enum(LABORATORY_STANDARD_STATUSES).default("draft"),
  /** Empty means unrestricted. Free-text jurisdiction codes (not
   *  necessarily `REGULATORY_JURISDICTIONS` — a standard's applicability
   *  is broader than the Kenya/EAC regulatory scope). */
  jurisdiction: z.array(z.string()).default([]),
  applicableProductCategories: z.array(z.string()).default([]),
  /** A URL or document reference identifying the standard — never the
   *  standard's own text. */
  sourceReference: z.string().optional(),
  copyrightNote: z.string().optional(),
  /** User/company-authored summary — never copied from the licensed
   *  standard's own text. */
  summary: z.string().optional(),
  knownLimitations: z.string().optional(),
  /** Set when a newer edition/revision row replaces this one — an explicit
   *  pointer, the same "declare via a new record, never rewrite" shape
   *  `RegulatoryRule`/`ApprovalPolicy` use for their own revision chains. */
  supersededByStandardId: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
});
export type LaboratoryStandard = z.infer<typeof laboratoryStandardSchema>;

export const LABORATORY_METHOD_ASSIGNMENT_TYPES = ["primary", "alternative"] as const;
export type LaboratoryMethodAssignmentType = (typeof LABORATORY_METHOD_ASSIGNMENT_TYPES)[number];

export const LABORATORY_METHOD_STATUSES = ["draft", "active", "superseded"] as const;
export type LaboratoryMethodStatus = (typeof LABORATORY_METHOD_STATUSES)[number];

export const instrumentSettingSchema = z.object({
  parameter: z.string().min(1),
  value: z.string().min(1),
});
export type InstrumentSetting = z.infer<typeof instrumentSettingSchema>;

/**
 * A test's method for one linked standard. Rows with `assignmentType:
 * "primary"` are the test's current default; a test may also have zero or
 * more `"alternative"` rows for the same or a different standard. Two rows
 * can share a `testDefinitionCode` (different standards/assignment types)
 * or a `standardId` (same standard, different test) freely — what
 * `engine/laboratoryStandards.ts` refuses is two rows with the SAME
 * (testDefinitionCode, standardId) pair (duplicate assignment) or two
 * `"primary"` rows for the same test.
 */
export const laboratoryTestMethodSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  /** Links to `TestDefinition.code` — a definition has no separate `id`
   *  (see schemas/testDefinitions.ts), `code` is its stable identity. */
  testDefinitionCode: z.string().min(1),
  /** Links to `LaboratoryStandard.id`. An "internal company method" is
   *  simply a method whose linked standard has `status: "internal"` —
   *  no second entity needed. */
  standardId: z.string().min(1),
  methodName: z.string().min(1),
  methodVersion: z.string().optional(),
  assignmentType: z.enum(LABORATORY_METHOD_ASSIGNMENT_TYPES),
  status: z.enum(LABORATORY_METHOD_STATUSES).default("draft"),
  samplePreparation: z.string().optional(),
  conditioningRequirements: z.string().optional(),
  requiredEquipment: z.array(z.string()).default([]),
  calibrationRequirements: z.string().optional(),
  reagentsAndConsumables: z.array(z.string()).default([]),
  environmentalConditions: z.string().optional(),
  /** Free text ("30 minutes", "24 h at 40degC") — durations in this domain
   *  are not always a single decimal quantity, so this stays a string
   *  rather than forcing a unit split that would not fit every method. */
  duration: z.string().optional(),
  instrumentSettings: z.array(instrumentSettingSchema).default([]),
  /** Measurement unit reported by this method — informational; the
   *  authoritative unit a result is recorded/evaluated against remains
   *  `TestDefinition.unit`, never duplicated as a second source of truth. */
  unit: z.string().optional(),
  procedureSteps: z.array(z.string()).default([]),
  calculationMethod: z.string().optional(),
  /** Descriptive, procedural notes on how the pass/fail criteria in
   *  `TestDefinition.passFailLogic`/`minimum`/`maximum` are actually
   *  applied — not a second numeric threshold. */
  acceptanceCriteria: z.string().optional(),
  reportingRequirements: z.string().optional(),
  resultInterpretation: z.string().optional(),
  repeatTestRules: z.string().optional(),
  safetyWarnings: z.array(z.string()).default([]),
  wasteDisposalNotes: z.string().optional(),
  troubleshootingNotes: z.string().optional(),
  relatedTestDefinitionCodes: z.array(z.string()).default([]),
  supersededByMethodId: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
});
export type LaboratoryTestMethod = z.infer<typeof laboratoryTestMethodSchema>;

/**
 * An immutable copy of the method actually used, captured once when a test
 * result is created — see `engine/laboratoryStandards.ts`'s
 * `buildTestMethodSnapshot`. A later edit to the `LaboratoryStandard` or
 * `LaboratoryTestMethod` row (including superseding or deleting it) must
 * never retroactively change what this snapshot says was used, the same
 * "already required" discipline `TestRequirementSnapshot` applies to
 * applicability.
 */
export const testMethodSnapshotSchema = z.object({
  standardId: z.string().min(1),
  standardCode: z.string().min(1),
  standardEdition: z.string().optional(),
  standardRevision: z.string().optional(),
  methodId: z.string().min(1),
  methodName: z.string().min(1),
  methodVersion: z.string().optional(),
  instrumentSettings: z.array(instrumentSettingSchema).default([]),
  environmentalConditions: z.string().optional(),
  unit: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  calculationMethod: z.string().optional(),
  capturedAt: z.string(),
});
export type TestMethodSnapshot = z.infer<typeof testMethodSnapshotSchema>;
