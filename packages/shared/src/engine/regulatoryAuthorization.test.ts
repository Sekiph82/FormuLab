import { describe, expect, it } from "vitest";
import { AUTHORIZED_REGULATORY_ROLES, isAuthorizedRegulatoryActor, requireAuthorizedRegulatoryActor } from "./regulatoryAuthorization";
import type { Actor } from "../schemas/status";

const humans = {
  regulatory: { kind: "human", role: "regulatory", userId: "alice" } satisfies Actor,
  quality: { kind: "human", role: "quality", userId: "quinn" } satisfies Actor,
  administrator: { kind: "human", role: "administrator", userId: "root" } satisfies Actor,
  chemist: { kind: "human", role: "chemist", userId: "bob" } satisfies Actor,
  researcher: { kind: "human", role: "researcher", userId: "rae" } satisfies Actor,
  production: { kind: "human", role: "production", userId: "pat" } satisfies Actor,
};
const agent: Actor = { kind: "agent", runId: "run-1" };
const system: Actor = { kind: "system", reason: "scheduled sync" };
const importActor: Actor = { kind: "import", source: "spreadsheet.csv" };

describe("AUTHORIZED_REGULATORY_ROLES", () => {
  it("is exactly regulatory, quality, administrator", () => {
    expect(AUTHORIZED_REGULATORY_ROLES).toEqual(["regulatory", "quality", "administrator"]);
  });
});

describe("isAuthorizedRegulatoryActor", () => {
  it("accepts regulatory, quality and administrator humans", () => {
    expect(isAuthorizedRegulatoryActor(humans.regulatory)).toBe(true);
    expect(isAuthorizedRegulatoryActor(humans.quality)).toBe(true);
    expect(isAuthorizedRegulatoryActor(humans.administrator)).toBe(true);
  });

  it("rejects every other human role", () => {
    expect(isAuthorizedRegulatoryActor(humans.chemist)).toBe(false);
    expect(isAuthorizedRegulatoryActor(humans.researcher)).toBe(false);
    expect(isAuthorizedRegulatoryActor(humans.production)).toBe(false);
  });

  it("rejects every non-human actor kind", () => {
    expect(isAuthorizedRegulatoryActor(agent)).toBe(false);
    expect(isAuthorizedRegulatoryActor(system)).toBe(false);
    expect(isAuthorizedRegulatoryActor(importActor)).toBe(false);
  });
});

describe("requireAuthorizedRegulatoryActor", () => {
  it("does not throw for an authorized human", () => {
    expect(() => requireAuthorizedRegulatoryActor(humans.regulatory, "do the thing")).not.toThrow();
  });

  it("throws an explanatory error naming the required roles for every unauthorized actor", () => {
    for (const actor of [humans.chemist, humans.researcher, humans.production, agent, system, importActor]) {
      expect(() => requireAuthorizedRegulatoryActor(actor, "do the thing")).toThrow(/Only an authorized regulatory, quality or administrator role may/);
    }
  });
});
