import { describe, expect, it } from "vitest";
import type { RouteObject } from "react-router-dom";
import { routes } from "@/app/router";
import { GLOSSARY_TERMS } from "./glossary";
import { HELP_EXCLUSIONS, HELP_TOPICS, getTopic, isExcludedRoute, topicForRoute } from "./registry";
import { HELP_SCHEMA_VERSION } from "./types";

const SCREENSHOT_ID_PATTERN = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-(light|dark)-[a-z-]+$/;

/** Flatten router.tsx's real route tree into full pathnames, e.g.
 *  "/settings/:section" — the source of truth for coverage checks, so
 *  this test can never drift from the actual app routes. */
function flattenRoutes(nodes: RouteObject[], prefix = ""): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const segment = node.path ?? "";
    const full = node.index
      ? prefix || "/"
      : `${prefix}/${segment}`.replace(/\/+/g, "/");
    if (node.path !== undefined || node.index) out.push(full || "/");
    if (node.children) out.push(...flattenRoutes(node.children, full || prefix));
  }
  return out;
}

/** Router paths use react-router's own `:param`/`*` syntax; replace those
 *  with a concrete sample segment so `topicForRoute` sees a real pathname,
 *  the same shape `useLocation()` would produce at runtime. */
function samplePathname(routePath: string): string {
  return routePath
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "sample-id" : seg === "*" ? "unmatched" : seg))
    .join("/");
}

const ROUTE_PATHS = flattenRoutes(routes);

describe("HELP_TOPICS structure", () => {
  it("every topic has a valid schema version", () => {
    for (const topic of HELP_TOPICS) {
      expect(topic.schemaVersion).toBe(HELP_SCHEMA_VERSION);
    }
  });

  it("has no duplicate topic ids", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate exact-mode route bindings", () => {
    const exactPaths = HELP_TOPICS.flatMap((t) =>
      t.routes.filter((r) => r.mode !== "prefix").map((r) => r.path),
    );
    expect(new Set(exactPaths).size).toBe(exactPaths.length);
  });

  it("every relatedTopicId references an existing topic", () => {
    for (const topic of HELP_TOPICS) {
      for (const relatedId of topic.relatedTopicIds) {
        expect(getTopic(relatedId), `${topic.id} -> relatedTopicIds -> ${relatedId}`).toBeDefined();
      }
    }
  });

  it("every glossaryTermId references an existing glossary term", () => {
    const glossaryIds = new Set(GLOSSARY_TERMS.map((g) => g.id));
    for (const topic of HELP_TOPICS) {
      for (const termId of topic.glossaryTermIds) {
        expect(glossaryIds.has(termId), `${topic.id} -> glossaryTermIds -> ${termId}`).toBe(true);
      }
    }
  });

  it("every non-empty screenshotId follows the naming convention", () => {
    for (const topic of HELP_TOPICS) {
      for (const shot of topic.screenshotIds) {
        expect(shot, `${topic.id} -> screenshotIds`).toMatch(SCREENSHOT_ID_PATTERN);
      }
    }
  });

  it("has no duplicate glossary term ids", () => {
    const ids = GLOSSARY_TERMS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("topicForRoute", () => {
  it.each([
    ["/home", "home"],
    ["/projects", "projects"],
    ["/formulation", "formulation"],
    ["/optimization", "optimization"],
    ["/optimizer", "optimizer"],
    ["/doe", "doe"],
    ["/reverse-formulation", "reverseFormulation"],
    ["/laboratory", "laboratory"],
    ["/stability", "stability"],
    ["/regulatory", "regulatory"],
    ["/dossiers", "dossiers"],
    ["/claims-labels", "claimsLabels"],
    ["/approval", "approval"],
    ["/reports", "reports"],
    ["/data-exchange", "dataExchange"],
    ["/administration", "administration"],
    ["/materials", "materials"],
    ["/notebooks", "notebooks"],
    ["/files", "files"],
    ["/runs", "runs"],
    ["/settings", "settings"],
  ])("resolves %s to the %s topic", (pathname, expectedId) => {
    expect(topicForRoute(pathname)?.id).toBe(expectedId);
  });

  it("resolves /live and /live/:sessionId to the sessions topic via prefix fallback", () => {
    expect(topicForRoute("/live")?.id).toBe("sessions");
    expect(topicForRoute("/live/abc-123")?.id).toBe("sessions");
  });

  it("resolves /example/:sessionId to the sessions topic via an exact parameterized route", () => {
    expect(topicForRoute("/example/abc-123")?.id).toBe("sessions");
  });

  it("resolves nested settings sections to the settings topic via prefix fallback", () => {
    expect(topicForRoute("/settings/appearance")?.id).toBe("settings");
    expect(topicForRoute("/settings/model")?.id).toBe("settings");
  });

  it("returns undefined for a route with no registered topic or exclusion match", () => {
    expect(topicForRoute("/does-not-exist")).toBeUndefined();
  });

  it("link-only routes (optimizer, materials) still resolve directly", () => {
    expect(topicForRoute("/optimizer")?.linkOnly).toBe(true);
    expect(topicForRoute("/materials")?.linkOnly).toBe(true);
  });
});

describe("full router.tsx coverage", () => {
  it("every real route resolves to a help topic or has a documented exclusion", () => {
    const uncovered: string[] = [];
    for (const routePath of ROUTE_PATHS) {
      const pathname = samplePathname(routePath);
      const topic = topicForRoute(pathname);
      const basename = routePath.split("/").pop() ?? "";
      const excluded =
        isExcludedRoute(routePath) || isExcludedRoute(pathname) || (basename === "*" && isExcludedRoute("*"));
      if (!topic && !excluded) uncovered.push(routePath);
    }
    expect(uncovered, `Uncovered routes: ${uncovered.join(", ")}`).toEqual([]);
  });

  it("every HELP_EXCLUSIONS entry corresponds to a real router.tsx route", () => {
    for (const exclusion of HELP_EXCLUSIONS) {
      if (exclusion.route === "*") continue; // catch-all, not a literal path
      expect(ROUTE_PATHS, `exclusion "${exclusion.route}" has no matching route`).toContain(exclusion.route);
    }
  });
});
