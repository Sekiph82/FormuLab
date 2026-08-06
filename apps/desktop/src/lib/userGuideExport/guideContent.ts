/**
 * Phase 10 Session 6 — pure content-quality checks against
 * `docs/USER_GUIDE.md`'s real text: required-topic coverage and stale-claim
 * detection. Both lists are grounded in this session's own verified
 * findings (see `docs/handoffs/PHASE10_CURRENT.md`'s Session 6 summary for
 * why each stale pattern was stale and what replaced it) — never a vague
 * "looks complete" heuristic.
 */
import { parseGuideMarkdown } from "./markdown";

/** Case-insensitive substrings expected to appear in at least one real
 *  heading — one per topic the session objective's "Guide content" list
 *  named. A substring, not an exact heading string, so a heading can be
 *  reworded slightly without this check needing a matching edit. */
export const REQUIRED_GUIDE_TOPICS: readonly string[] = [
  "navigating formulab",
  "getting help",
  "generate a starting formulation",
  "create a formula project",
  "advanced optimization",
  "design of experiments",
  "reverse formulation",
  "laboratory trials",
  "test standards and methods",
  "stability studies",
  "regulatory",
  "dossiers and claims",
  "approval",
  "reports",
  "data exchange",
  "administration",
  "notebooks, files, and runs",
  "settings",
  "in-app guide",
  "roles, safety, and auditability",
  "known limitations",
];

/** Each entry: a pattern that must NOT match, and why it's stale (surfaced
 *  in the failure message so a future false-positive is easy to diagnose,
 *  not a bare regex dump). */
export const STALE_CLAIM_CHECKS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /24 templates/i, reason: "Data Exchange has 41 templates as of Phase 10 Session 6 — 24 was the pre-expansion count." },
  { pattern: /does not generate a final formatted PDF\/DOCX/i, reason: "Phase 8 added real Dossier PDF/DOCX export — this claim predates it." },
  { pattern: /neither generates a final formatted PDF\/DOCX/i, reason: "Phase 8 added real Dossier PDF/DOCX export — this claim predates it." },
  { pattern: /reverse-formulation module described in the full[\s\S]{0,40}is designed but not implemented/i, reason: "Reverse Formulation shipped and is documented in this guide — it is implemented, not merely designed." },
  { pattern: /\(Phase 6\)/i, reason: "Reverse Formulation (Phase 6) is implemented; a lingering '(Phase 6)' not-yet-built marker is stale." },
  { pattern: /zero in-app help/i, reason: "In-app help (Help panel, Help Center, tooltips, disabled-action reasons, guided tours, onboarding) shipped in Phase 10 Sessions 1-4." },
  { pattern: /guided tours are planned for a later session and do not\s+exist yet/i, reason: "Guided tours shipped in Phase 10 Session 4." },
  { pattern: /this guide does not yet embed screenshots/i, reason: "Superseded by Session 6's honest per-item screenshot status once real capture starts; kept accurate to Session 6's own actual state." },
];

export function findMissingRequiredTopics(markdown: string): string[] {
  const headingText = parseGuideMarkdown(markdown)
    .filter((b) => b.kind === "heading")
    .map((b) => (b as Extract<typeof b, { kind: "heading" }>).text.toLowerCase())
    .join(" \n ");
  return REQUIRED_GUIDE_TOPICS.filter((topic) => !headingText.includes(topic.toLowerCase()));
}

export function findStaleClaims(markdown: string): { pattern: string; reason: string }[] {
  return STALE_CLAIM_CHECKS.filter((c) => c.pattern.test(markdown)).map((c) => ({ pattern: c.pattern.source, reason: c.reason }));
}
