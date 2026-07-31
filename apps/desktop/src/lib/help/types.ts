/**
 * Typed shape for one entry in the in-app help registry. Metadata only —
 * no rendering, no React. Actual copy lives in the `help` i18n namespace
 * (`i18n/locales/<locale>/help.json`), keyed by this topic's `id`; this
 * file only says which fields exist and which route(s)/relationships a
 * topic has. See docs/handoffs/PHASE10_CURRENT.md for the architecture
 * this implements.
 */

/** Bumped only if this shape changes in a way old content can't satisfy —
 *  same convention as every persisted domain schema in this codebase. */
export const HELP_SCHEMA_VERSION = "1.0" as const;

/** Whether a route pattern must match the full pathname ("exact", the
 *  default) or is allowed to match a longer pathname that starts with it
 *  ("prefix" — used for parent-topic fallback on a route this registry
 *  has no dedicated topic for). */
export type RouteMatchMode = "exact" | "prefix";

export interface HelpTopicRoute {
  /** A react-router path pattern, e.g. "/formulation" or "/live/:sessionId" —
   *  matched with react-router's own `matchPath`, never a hand-rolled parser. */
  path: string;
  mode?: RouteMatchMode;
}

/** How trustworthy this topic's content is right now — mirrors the
 *  `docs/PHASE10_COVERAGE_MATRIX.md` "Doc status" column so the registry
 *  and the matrix can never silently disagree. */
export type HelpContentStatus = "current" | "stale" | "missing" | "planned";

export interface HelpTopic {
  schemaVersion: typeof HELP_SCHEMA_VERSION;

  /** Stable, kebab/camelCase id — reuses `Sidebar.tsx`'s own nav-item keys
   *  wherever one exists (e.g. "dataExchange", "claimsLabels"), so a topic
   *  id and its sidebar identity are never two different vocabularies. */
  id: string;

  /** Sidebar group key ("formulation" | "laboratory" | "regulatory" |
   *  "tools") for a grouped child, or the item's own key for a standalone
   *  leaf/link-only route. Purely descriptive — never drives navigation. */
  module: string;

  /** Every route this topic answers "what is this page" for. A topic
   *  reachable only via a link (never a sidebar route) still lists its
   *  real route(s) here — `linkOnly` just means "don't imply this has its
   *  own nav highlight," not "unreachable." */
  routes: HelpTopicRoute[];
  linkOnly?: boolean;

  /** If this exact route has no topic of its own, resolution falls back to
   *  the topic named here — an explicit relationship, never a guess. */
  parentTopicId?: string;

  // ---- i18n keys, resolved against the "help" namespace under this
  // topic's own `id` (e.g. t(`${id}.title`, { ns: "help" })). Content
  // itself never lives in this file. ----
  titleKey: string;
  summaryKey: string;
  purposeKey: string;
  prerequisiteKeys: string[];
  quickStartStepKeys: string[];
  sectionKeys: string[];
  warningKeys: string[];
  roleNoteKeys: string[];
  knownLimitationKeys: string[];

  /** Other topic ids — validated to exist by the registry test, never a
   *  dangling reference. */
  relatedTopicIds: string[];

  /** Glossary term ids this topic uses — validated the same way, against
   *  the glossary topic's own term list (Session 2+ renders the glossary;
   *  this session only requires every reference to resolve). */
  glossaryTermIds: string[];

  /** Screenshot ids, following the naming convention from
   *  docs/handoffs/PHASE10_CURRENT.md's screenshot strategy:
   *  `<module>-<page>-<state>-<theme>-<locale>`. No screenshots are
   *  captured in this session — ids may be empty, but any id present must
   *  already match the convention (tested). */
  screenshotIds: string[];

  /** A guided-tour id (Session 4's job to define/consume) — undefined for
   *  every topic this session, since no tour exists yet. */
  tourId?: string;

  /** English technical search terms — not translated. These are search
   *  aids (module names, synonyms, jargon), not user-facing prose, so they
   *  don't need i18n parity the way titleKey/summaryKey/etc. do. */
  keywords: string[];

  contentStatus: HelpContentStatus;
}
