/**
 * The agent event protocol.
 *
 * Replaces Markdown-shape detection. Previously the UI decided a run had
 * produced a formulation by testing whether the model's prose contained a
 * "# Formulation Card" heading or an ingredient table — so narration that
 * merely *described* a card could complete a run, and a real card with a
 * different heading could fail to. Completion is now an explicit typed event
 * carrying the ids of the records that were written.
 */
import { z } from "zod";

export const AGENT_EVENT_TYPES = [
  "run.created",
  "run.started",

  "sidecar.starting",
  "sidecar.ready",
  "sidecar.failed",

  "research.started",
  "research.query_created",
  "research.source_found",
  "research.source_rejected",
  "research.completed",

  "evidence.extraction_started",
  "evidence.claim_created",
  "evidence.claim_rejected",
  "evidence.completed",

  "formula.draft_created",
  "formula.validation_started",
  "formula.validation_failed",
  "formula.validation_completed",

  "optimization.started",
  "optimization.progress",
  "optimization.completed",
  "optimization.failed",

  "regulatory_check.started",
  "regulatory_check.completed",
  "compatibility_check.started",
  "compatibility_check.completed",
  "safety_check.started",
  "safety_check.completed",

  "formulation_card.completed",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export const agentEventSchema = z.object({
  type: z.enum(AGENT_EVENT_TYPES),
  version: z.literal("1.0"),
  runId: z.string().min(1),
  /**
   * Monotonic per run. Used to drop duplicates on reconnect and to resume from
   * a last-seen id, so a dropped connection does not replay side effects.
   */
  seq: z.number().int().nonnegative(),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

/** The event that ends a successful formulation run. */
export const formulationCompletedPayloadSchema = z.object({
  formulationId: z.string().min(1),
  versionId: z.string().min(1),
  status: z.string().min(1),
});

/**
 * Connection lifecycle. Kept explicit because "reconnecting" and "waiting for a
 * cold-started sidecar" need different timeouts and different user messaging —
 * conflating them is what made the old runtime look hung.
 */
export const CONNECTION_STATES = [
  "idle",
  "starting_sidecar",
  "waiting_for_health",
  "connecting",
  "streaming",
  "reconnecting",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/**
 * Accepts events in order, discarding duplicates and replays.
 *
 * A reconnect re-delivers events the client may already have applied; applying
 * `evidence.claim_created` twice would duplicate a claim. Sequence numbers make
 * handling idempotent without the caller having to reason about it.
 */
export class EventSequencer {
  private lastSeq = -1;
  private readonly seen = new Set<number>();

  /** True if the event is new and was accepted. */
  accept(event: AgentEvent): boolean {
    if (this.seen.has(event.seq)) return false;
    this.seen.add(event.seq);
    this.lastSeq = Math.max(this.lastSeq, event.seq);
    return true;
  }

  /** Resume token: the highest sequence number applied so far. */
  get lastEventId(): number {
    return this.lastSeq;
  }

  reset(): void {
    this.lastSeq = -1;
    this.seen.clear();
  }
}

/** Parse an untrusted event, returning null rather than throwing on junk. */
export function parseAgentEvent(raw: unknown): AgentEvent | null {
  const result = agentEventSchema.safeParse(raw);
  return result.success ? result.data : null;
}
