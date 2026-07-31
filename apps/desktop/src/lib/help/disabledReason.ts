/**
 * A structured, factual explanation for why an action control is disabled —
 * built directly from an existing guard/boolean (authorization, readiness,
 * approval, validation, status), never invented by reading a button's own
 * label. `DisabledActionButton` renders this; nothing here decides
 * permissions — it only describes a decision already made elsewhere.
 */
export interface DisabledReason {
  /** A short, stable identifier for the reason — not shown directly, used
   *  by tests and for grouping/analytics if ever needed. */
  code: string;
  /** i18n key (any namespace-qualified or bound-namespace key), resolved by
   *  the consuming component's own `t()` — kept as a key, not pre-resolved
   *  text, since a reason can be built far from where it is rendered. */
  messageKey: string;
  /** Interpolation values for `messageKey`, if it needs any. */
  messageValues?: Record<string, unknown>;
  /** A role name/label, shown verbatim if present (e.g. "chemist, quality
   *  or administrator") — never a second role system, just a display of
   *  what an existing authorization function already required. */
  requiredRole?: string;
  /** A short description of the missing prerequisite, if any. */
  prerequisite?: string;
  /** An existing `HELP_TOPICS` id explaining the workflow this action
   *  belongs to — never free text, never a new topic. */
  relatedTopicId?: string;
  /** Whether the current user can plausibly resolve this themselves (e.g.
   *  "fill in the missing field") vs. needing someone else (e.g. "needs an
   *  authorized role"). Purely descriptive framing for the explanation. */
  resolvable: boolean;
}
