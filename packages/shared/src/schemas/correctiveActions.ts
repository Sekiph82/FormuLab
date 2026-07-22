/**
 * Corrective actions — shared by Laboratory Trials and Stability Studies.
 *
 * One model, not two, because "what do we do about a deviation/failure" is
 * the same question whether it came from a trial or a stability sample: a
 * problem statement, an owner, a due date, and a real closure that requires
 * a human to actually verify the fix worked, not just mark it done.
 */
import { z } from "zod";

export const CORRECTIVE_ACTION_SOURCE_TYPES = ["trial_deviation", "trial_failure", "stability_failure", "manual"] as const;
export type CorrectiveActionSourceType = (typeof CORRECTIVE_ACTION_SOURCE_TYPES)[number];

export const CORRECTIVE_ACTION_TYPES = [
  "reformulation",
  "process_change",
  "supplier_change",
  "packaging_change",
  "specification_change",
  "retest",
  "documentation",
  "other",
] as const;
export type CorrectiveActionType = (typeof CORRECTIVE_ACTION_TYPES)[number];

/**
 * `effective`/`ineffective` are only reachable through a recorded
 * effectiveness check — never set directly, the same way `resolved` on a
 * deviation requires a resolution record. See `engine/correctiveActions.ts`.
 */
export const CORRECTIVE_ACTION_STATUSES = [
  "open",
  "in_progress",
  "awaiting_verification",
  "effective",
  "ineffective",
  "cancelled",
] as const;
export type CorrectiveActionStatus = (typeof CORRECTIVE_ACTION_STATUSES)[number];

export const correctiveActionAuditEventSchema = z.object({
  action: z.string().min(1),
  actorId: z.string().min(1),
  actorKind: z.enum(["human", "agent", "system", "import"]),
  at: z.string(),
  detail: z.string().optional(),
});
export type CorrectiveActionAuditEvent = z.infer<typeof correctiveActionAuditEventSchema>;

export const correctiveActionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  projectId: z.string().min(1),

  sourceType: z.enum(CORRECTIVE_ACTION_SOURCE_TYPES),
  /** The trial or stability study id this action belongs to. */
  sourceRecordId: z.string().min(1),
  /** The specific `TrialDeviation`/`StabilityFailure` id, when the source
   *  type is one of those two — absent for a `manual` corrective action not
   *  tied to a single logged deviation/failure. */
  deviationOrFailureId: z.string().optional(),

  title: z.string().min(1),
  problemStatement: z.string().min(1),
  rootCauseNotes: z.string().optional(),
  actionType: z.enum(CORRECTIVE_ACTION_TYPES),

  owner: z.string().min(1),
  dueDate: z.string().optional(),
  status: z.enum(CORRECTIVE_ACTION_STATUSES).default("open"),

  resolution: z.string().optional(),
  /** Set only once a named human records that the action actually fixed the
   *  problem — this is what moves status to `effective`/`ineffective`, never
   *  the act of writing a resolution alone. */
  effectivenessCheck: z
    .object({
      checkedBy: z.string().min(1),
      checkedAt: z.string(),
      effective: z.boolean(),
      notes: z.string().optional(),
    })
    .optional(),

  closedBy: z.string().optional(),
  closedAt: z.string().optional(),

  /** A new formula draft this action produced, if any — see
   *  `engine/correctiveActions.ts`'s `createDraftFromCorrectiveAction`. Never
   *  set until that draft actually exists, and never implies the action
   *  itself approved anything. */
  createdDraftId: z.string().optional(),

  auditHistory: z.array(correctiveActionAuditEventSchema).default([]),

  createdAt: z.string(),
  createdBy: z.string().default("local"),
  updatedAt: z.string(),
});
export type CorrectiveAction = z.infer<typeof correctiveActionSchema>;
