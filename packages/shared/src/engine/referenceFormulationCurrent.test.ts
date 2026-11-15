import { describe, expect, it } from "vitest";
import { currentReferenceFormulations } from "./referenceFormulationCurrent";

const record = (id: string, hash: string, parserVersion: string) => ({ id, sourceDocumentHash: hash, source: { parserVersion } });

describe("currentReferenceFormulations", () => {
  it("keeps only the newest layout parse of each source document, including all its formula variants", () => {
    const records = [
      record("old", "AA", "formulab-reference-formulation-layout-v1"),
      record("new-v1", "aa", "formulab-reference-formulation-layout-v3-multi-supplier-tables"),
      record("new-v2", "aa", "formulab-reference-formulation-layout-v3-multi-supplier-tables"),
      record("only", "bb", "formulab-reference-formulation-layout-v1"),
    ];
    expect(currentReferenceFormulations(records).map((item) => item.id)).toEqual(["new-v1", "new-v2", "only"]);
  });
});
