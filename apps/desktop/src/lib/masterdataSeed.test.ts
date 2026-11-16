import { describe, expect, it } from "vitest";
import { staleSeedRows } from "./masterdata";

describe("staleSeedRows", () => {
  const seed = [{ id: "rule-1", updatedAt: "2026-01-01", conditions: [{ nameKeywordsAny: ["ethanol"] }] }];

  it("refreshes an unedited stored seed row whose shipped seed changed, whatever its key order", () => {
    const stored = [{ conditions: [{ nameKeywordsAny: ["alcohol"] }], updatedAt: "2026-01-01", id: "rule-1", extraDefault: true }];
    expect(staleSeedRows(stored, seed)).toEqual(seed);
  });

  it("leaves an edited row and an unchanged row alone", () => {
    expect(staleSeedRows([{ id: "rule-1", updatedAt: "2026-05-05", conditions: [] }], seed)).toEqual([]);
    expect(staleSeedRows([{ updatedAt: "2026-01-01", id: "rule-1", conditions: [{ nameKeywordsAny: ["ethanol"] }], extraDefault: 1 }], seed)).toEqual([]);
  });
});
