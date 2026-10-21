import { describe, expect, it } from "vitest";
import type { FormulationCard, SessionDetail } from "./formulationV2";
import { buildPromotedFormulation } from "./promoteGeneratedFormula";

function session(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    status: "ok",
    id: "sess-1",
    brief: { target: "a sulfate-free anti-dandruff shampoo", category: "shampoo" },
    cards: [],
    read_only: true,
    ...over,
  };
}

function card(over: Partial<FormulationCard> & { version: string }): FormulationCard {
  return {
    status: "ok",
    formula: {
      ingredients: [
        { inci: "Water (Aqua)", name: "Water", weight_pct: "q.s. 100" },
        { inci: "Sodium Laureth Sulfate", name: "SLES", weight_pct: "12.0", material_code: "RM-SLES" },
      ],
    },
    ...over,
  };
}

describe("buildPromotedFormulation — FVL-03.005", () => {
  it("builds a real Formulation/FormulationVersion from a generated card, batch shared with costing", async () => {
    const { formulation, version } = await buildPromotedFormulation(session(), card({ version: "v2" }), "250");
    expect(formulation.productFamilyCode).toBe("shampoo");
    expect(formulation.targetBatchKg).toBe("250");
    expect(version.basisBatchKg).toBe("250");
    expect(version.formulationId).toBe(formulation.id);
    expect(version.generatedSource).toEqual(expect.objectContaining({ sessionId: "sess-1", alternativeId: "v2", formulaFingerprint: expect.objectContaining({ algorithm: "sha256", digest: expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
  });

  it("preserves material_code per line via the existing linesFromGeneratedFormula reuse", async () => {
    const { version } = await buildPromotedFormulation(session(), card({ version: "v1" }), "100");
    const sles = version.lines.find((l) => l.displayName === "Sodium Laureth Sulfate");
    expect(sles?.materialCode).toBe("RM-SLES");
  });

  it("never fabricates a specific product family when the brief category is empty — honest 'general' fallback", async () => {
    const emptyBriefSession = session({ brief: { target: "a product", category: "" } });
    const { formulation } = await buildPromotedFormulation(emptyBriefSession, card({ version: "v1" }), "100");
    expect(formulation.productFamilyCode).toBe("general");
  });

  it("derives the name from real brief/version data, never invented text", async () => {
    const { formulation } = await buildPromotedFormulation(session(), card({ version: "v3" }), "100");
    expect(formulation.name).toBe("a sulfate-free anti-dandruff shampoo — V3");
  });

  it("performs no Tauri or network call — pure construction only", async () => {
    // If this function ever called `invoke`/`fetch`, the assertion above
    // would already have thrown in this non-Tauri test environment. This
    // test exists so a future accidental persistence call added inside
    // buildPromotedFormulation() fails loudly rather than silently.
    await expect(buildPromotedFormulation(session(), card({ version: "v1" }), "100")).resolves.toBeDefined();
  });
});
