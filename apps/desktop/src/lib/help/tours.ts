/**
 * Guided-tour content registry (Phase 10 Session 4) — metadata only, same
 * discipline as `registry.ts`'s `HELP_TOPICS`: no React, no rendering.
 * Copy lives in the `help` namespace under `tours.<tourId>.*`
 * (`i18n/locales/<locale>/help.json`); this file only says which steps
 * exist and which real DOM element (if any) each one points at.
 *
 * A step's `target`, when present, is the value of a `data-tour="<target>"`
 * attribute already wired onto a real, currently-rendered element in the
 * app (never a selector invented for the tour alone) — `TourOverlay`
 * resolves it via `document.querySelector`. A step with no `target` is a
 * deliberate informational step (no single UI element to point at, e.g.
 * "export is not approval") — never a placeholder for a missing feature.
 */

export const TOUR_SCHEMA_VERSION = "1.0" as const;

export interface TourStep {
  /** Stable within its tour; not globally unique. */
  id: string;
  titleKey: string;
  bodyKey: string;
  target?: string;
}

export interface Tour {
  schemaVersion: typeof TOUR_SCHEMA_VERSION;
  id: string;
  /** The route this tour's elements live on. Starting the tour navigates
   *  here first if the user isn't already on it (or a nested path under
   *  it, e.g. "/live/:sessionId" for the "/live" tour). */
  route: string;
  /** The `HELP_TOPICS` id whose Help panel offers "Start tour" for this
   *  tour — that topic's own `tourId` must equal this tour's `id`
   *  (cross-checked by tours.test.ts, never allowed to drift). */
  topicId: string;
  titleKey: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    schemaVersion: TOUR_SCHEMA_VERSION,
    id: "formulation",
    route: "/live",
    topicId: "formulation",
    titleKey: "tours.formulation.title",
    steps: [
      { id: "target", titleKey: "tours.formulation.steps.target.title", bodyKey: "tours.formulation.steps.target.body", target: "formulation.target" },
      { id: "categoryMarket", titleKey: "tours.formulation.steps.categoryMarket.title", bodyKey: "tours.formulation.steps.categoryMarket.body", target: "formulation.categoryMarket" },
      { id: "generate", titleKey: "tours.formulation.steps.generate.title", bodyKey: "tours.formulation.steps.generate.body", target: "formulation.generate" },
      { id: "candidates", titleKey: "tours.formulation.steps.candidates.title", bodyKey: "tours.formulation.steps.candidates.body", target: "formulation.candidateTabs" },
      { id: "cardEdit", titleKey: "tours.formulation.steps.cardEdit.title", bodyKey: "tours.formulation.steps.cardEdit.body", target: "formulation.cardEditTabs" },
      { id: "functionTotals", titleKey: "tours.formulation.steps.functionTotals.title", bodyKey: "tours.formulation.steps.functionTotals.body", target: "formulation.functionTotals" },
      { id: "warnings", titleKey: "tours.formulation.steps.warnings.title", bodyKey: "tours.formulation.steps.warnings.body", target: "formulation.warnings" },
    ],
  },
  {
    schemaVersion: TOUR_SCHEMA_VERSION,
    id: "doe",
    route: "/doe",
    topicId: "doe",
    titleKey: "tours.doe.title",
    steps: [
      { id: "factors", titleKey: "tours.doe.steps.factors.title", bodyKey: "tours.doe.steps.factors.body", target: "doe.tab.design" },
      { id: "levels", titleKey: "tours.doe.steps.levels.title", bodyKey: "tours.doe.steps.levels.body", target: "doe.tab.design" },
      { id: "responses", titleKey: "tours.doe.steps.responses.title", bodyKey: "tours.doe.steps.responses.body", target: "doe.tab.responses" },
      { id: "runGeneration", titleKey: "tours.doe.steps.runGeneration.title", bodyKey: "tours.doe.steps.runGeneration.body", target: "doe.tab.runs" },
      { id: "interpretation", titleKey: "tours.doe.steps.interpretation.title", bodyKey: "tours.doe.steps.interpretation.body", target: "doe.tab.analysis" },
    ],
  },
  {
    schemaVersion: TOUR_SCHEMA_VERSION,
    id: "dossiers",
    route: "/dossiers",
    topicId: "dossiers",
    titleKey: "tours.dossiers.title",
    steps: [
      { id: "requirements", titleKey: "tours.dossiers.steps.requirements.title", bodyKey: "tours.dossiers.steps.requirements.body", target: "dossiers.tab.requirements" },
      { id: "evidence", titleKey: "tours.dossiers.steps.evidence.title", bodyKey: "tours.dossiers.steps.evidence.body", target: "dossiers.tab.evidence" },
      { id: "readiness", titleKey: "tours.dossiers.steps.readiness.title", bodyKey: "tours.dossiers.steps.readiness.body", target: "dossiers.readinessSummary" },
      { id: "review", titleKey: "tours.dossiers.steps.review.title", bodyKey: "tours.dossiers.steps.review.body", target: "dossiers.tab.reviews" },
      { id: "export", titleKey: "tours.dossiers.steps.export.title", bodyKey: "tours.dossiers.steps.export.body", target: "dossiers.exportButtons" },
      { id: "notApproval", titleKey: "tours.dossiers.steps.notApproval.title", bodyKey: "tours.dossiers.steps.notApproval.body" },
    ],
  },
];

export function getTour(id: string): Tour | undefined {
  return TOURS.find((tour) => tour.id === id);
}
