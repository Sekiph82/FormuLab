/**
 * The single authorization gate for every regulatory action that must be
 * a genuine human sign-off — recording or revoking a final regulatory
 * review, confirming or revoking an evidence confirmation, declaring or
 * revoking a review equivalence, and verifying/rejecting/superseding a
 * rule's source. Previously duplicated as three near-identical
 * assertions (`regulatoryReviews.ts`'s `requireHuman`/
 * `requireRegulatoryRole`, `regulatoryRules.ts`'s
 * `requireRegulatoryReviewer`) — consolidated here so every regulatory
 * action shares one rule, one error message and one place to change it.
 *
 * An AI (`kind: "agent"`), a system process, or an import can never
 * satisfy this — see `schemas/status.ts`'s `Actor` union. Only a human
 * whose `role` is `regulatory`, `quality` or `administrator` passes;
 * every other human role (`researcher`, `chemist`, `production`) is
 * rejected exactly like a non-human actor. Throws before any record is
 * built, so a caller that checks this first can never end up with a
 * partial write or an audit event for a rejected attempt.
 */
import type { Actor } from "../schemas/status";

export const AUTHORIZED_REGULATORY_ROLES = ["regulatory", "quality", "administrator"] as const;
export type AuthorizedRegulatoryRole = (typeof AUTHORIZED_REGULATORY_ROLES)[number];

export function isAuthorizedRegulatoryActor(actor: Actor): actor is Extract<Actor, { kind: "human" }> & { role: AuthorizedRegulatoryRole } {
  return actor.kind === "human" && (AUTHORIZED_REGULATORY_ROLES as readonly string[]).includes(actor.role);
}

export function requireAuthorizedRegulatoryActor(
  actor: Actor,
  action: string,
): asserts actor is Extract<Actor, { kind: "human" }> & { role: AuthorizedRegulatoryRole } {
  if (!isAuthorizedRegulatoryActor(actor)) {
    throw new Error(`Only an authorized regulatory, quality or administrator role may ${action}.`);
  }
}
