import { describe, expect, it } from "vitest";
import { optimizationRunSchema } from "./optimization";

describe("optimization run ranking lineage compatibility", () => {
  const sourceAlternativeSchema = optimizationRunSchema.shape.sourceAlternative;

  it("preserves historical ranking-origin lineage without inventing a source version", () => {
    const historical = {
      origin: "ranking",
      sessionId: "session-1",
      alternativeId: "alternative-1",
      rankingRecordCode: "rank-1",
    };

    expect(sourceAlternativeSchema.parse(historical)).toEqual(historical);
  });

  it("accepts exact source version identity for strict ranking-origin runs", () => {
    const strict = {
      origin: "ranking",
      sessionId: "session-1",
      alternativeId: "alternative-1",
      sourceFormulationVersionId: "version-1",
      rankingRecordCode: "rank-1",
    };

    expect(sourceAlternativeSchema.parse(strict)).toEqual(strict);
  });
});
