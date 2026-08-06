import { describe, expect, it } from "vitest";
import { TOURS, getTour } from "./tours";
import { HELP_TOPICS, getTopic } from "./registry";

describe("tours registry — schema and cross-reference validity", () => {
  it("has no duplicate tour ids", () => {
    const ids = TOURS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every tour has at least one step", () => {
    for (const tour of TOURS) {
      expect(tour.steps.length).toBeGreaterThan(0);
    }
  });

  it("every step has a non-empty titleKey and bodyKey, and a target (when present) is non-empty", () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        expect(step.titleKey.length).toBeGreaterThan(0);
        expect(step.bodyKey.length).toBeGreaterThan(0);
        if (step.target !== undefined) expect(step.target.length).toBeGreaterThan(0);
      }
    }
  });

  it("every tour's route starts with a leading slash", () => {
    for (const tour of TOURS) {
      expect(tour.route.startsWith("/")).toBe(true);
    }
  });

  it("every tour's topicId resolves to a real HELP_TOPICS entry", () => {
    for (const tour of TOURS) {
      expect(getTopic(tour.topicId)).toBeDefined();
    }
  });

  it("every tour's own topic points back at it (no drift between Tour.topicId and HelpTopic.tourId)", () => {
    for (const tour of TOURS) {
      const topic = getTopic(tour.topicId);
      expect(topic?.tourId).toBe(tour.id);
    }
  });

  it("every HELP_TOPICS entry with a tourId references a real tour", () => {
    for (const topic of HELP_TOPICS) {
      if (topic.tourId) expect(getTour(topic.tourId)).toBeDefined();
    }
  });

  it("getTour resolves a known id and returns undefined for an unknown one", () => {
    expect(getTour("formulation")?.id).toBe("formulation");
    expect(getTour("doe")?.id).toBe("doe");
    expect(getTour("dossiers")?.id).toBe("dossiers");
    expect(getTour("does-not-exist")).toBeUndefined();
  });

  it("has exactly the three tours the session objective scoped (Formulation, DoE, Dossiers)", () => {
    expect(TOURS.map((t) => t.id).sort()).toEqual(["doe", "dossiers", "formulation"]);
  });
});
