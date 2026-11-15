import { describe, expect, it } from "vitest";
import { buildReferenceMaterialCandidates, referenceMaterialCandidatesCsv } from "./referenceMaterialCandidates";

const cell = (rawValue: string) => ({ rawValue }) as never;
const record = (id: string, supplierId: string, lines: Array<{ name?: string; inci?: string }>) => ({
  id, source: { supplierId },
  ingredientLines: lines.map((line, index) => ({ id: `${id}:${index}`, ...(line.name ? { ingredientName: cell(line.name) } : {}), ...(line.inci ? { inciOrChemicalName: cell(line.inci) } : {}) })),
}) as never;

describe("material candidates from supplier formulas", () => {
  const records = [
    record("f1", "croda", [{ name: "Brij CS20", inci: "Ceteareth-20" }, { name: "Water", inci: "Aqua" }, { name: "10.0" }]),
    record("f2", "basf", [{ name: "Eumulgin B2", inci: "Ceteareth-20" }, { name: "Dehyton PK 45" }]),
  ];
  const productDocuments = [{ code: "acq-sds-brij", supplierId: "croda", documentType: "SDS", sourceProduct: { tradeName: "Brij CS20" } }];

  it("groups lines by printed INCI chemistry, else by trade name, and links the product's documents", () => {
    const candidates = buildReferenceMaterialCandidates({ records, productDocuments, existingMaterials: [{ code: "MAT-WATER", displayName: "Water", inciName: "Aqua" }] });
    expect(candidates.map((candidate) => candidate.materialCode)).toEqual(["REF-INCI-CETEARETH-20", "REF-TRADE-DEHYTON-PK-45"]);
    expect(candidates[0]).toMatchObject({
      materialName: "Ceteareth-20", canonicalChemistryId: "inci:ceteareth-20", tradeNames: ["Brij CS20", "Eumulgin B2"],
      supplierIds: ["croda", "basf"], sourceRecordIds: ["f1", "f2"], documentAcquisitionCodes: ["acq-sds-brij"],
    });
  });

  it("writes Data Exchange raw_materials rows that say they are unverified", () => {
    const csv = referenceMaterialCandidatesCsv(buildReferenceMaterialCandidates({ records, productDocuments, existingMaterials: [] }));
    const [header, first] = csv.split("\n");
    expect(header!.startsWith("material_code,material_name,inci_name")).toBe(true);
    expect(first).toContain("REF-INCI-CETEARETH-20,Ceteareth-20,Ceteareth-20");
    expect(first).toContain("Unverified candidate from 2 supplier formula(s)");
  });
});
