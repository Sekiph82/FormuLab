import { describe, expect, it } from "vitest";
import { evaluateMaterialAvailability } from "./inventoryAvailability";
import type { InventoryRecord } from "../schemas/materials";

const NOW = "2026-08-18";

function lot(over: Partial<InventoryRecord> & { code: string; materialCode: string; quantity: string }): InventoryRecord {
  return {
    schemaVersion: "1.0",
    warehouse: "main",
    unit: "kg",
    reservedQuantity: "0",
    coaStatus: "pending",
    quarantined: false,
    released: true,
    updatedAt: NOW,
    ...over,
  };
}

describe("evaluateMaterialAvailability — FVL-03.004", () => {
  it("hasRecords is false when no InventoryRecord exists for the material", () => {
    const r = evaluateMaterialAvailability([], "RM-001", NOW);
    expect(r.hasRecords).toBe(false);
    expect(r.usableQuantity).toBeUndefined();
  });

  it("sums quantity minus reservedQuantity across usable lots sharing a unit", () => {
    const records = [
      lot({ code: "INV-1", materialCode: "RM-001", quantity: "100", reservedQuantity: "20" }),
      lot({ code: "INV-2", materialCode: "RM-001", quantity: "50", reservedQuantity: "0" }),
    ];
    const r = evaluateMaterialAvailability(records, "RM-001", NOW);
    expect(r.hasRecords).toBe(true);
    expect(r.usableQuantity?.toString()).toBe("130");
    expect(r.unit).toBe("kg");
  });

  it("excludes a quarantined lot — a real, known zero, not unknown", () => {
    const records = [
      lot({ code: "INV-1", materialCode: "RM-001", quantity: "100", quarantined: true }),
    ];
    const r = evaluateMaterialAvailability(records, "RM-001", NOW);
    expect(r.hasRecords).toBe(true);
    expect(r.usableQuantity?.toString()).toBe("0");
    expect(r.blockedRecordCodes).toEqual(["INV-1"]);
  });

  it("excludes an unreleased lot — a real, known zero, not unknown", () => {
    const records = [
      lot({ code: "INV-1", materialCode: "RM-001", quantity: "100", released: false }),
    ];
    const r = evaluateMaterialAvailability(records, "RM-001", NOW);
    expect(r.usableQuantity?.toString()).toBe("0");
    expect(r.blockedRecordCodes).toEqual(["INV-1"]);
  });

  it("excludes an expired lot — a real, known zero, not unknown", () => {
    const records = [
      lot({ code: "INV-1", materialCode: "RM-001", quantity: "100", expiresAt: "2026-01-01" }),
    ];
    const r = evaluateMaterialAvailability(records, "RM-001", NOW);
    expect(r.usableQuantity?.toString()).toBe("0");
    expect(r.blockedRecordCodes).toEqual(["INV-1"]);
  });

  it("includes a lot expiring in the future", () => {
    const records = [
      lot({ code: "INV-1", materialCode: "RM-001", quantity: "100", expiresAt: "2027-01-01" }),
    ];
    const r = evaluateMaterialAvailability(records, "RM-001", NOW);
    expect(r.usableQuantity?.toString()).toBe("100");
  });

  it("never lets reservedQuantity push a single lot's net below zero", () => {
    const records = [
      lot({ code: "INV-1", materialCode: "RM-001", quantity: "10", reservedQuantity: "50" }),
    ];
    const r = evaluateMaterialAvailability(records, "RM-001", NOW);
    expect(r.usableQuantity?.toString()).toBe("0");
  });

  it("returns usableQuantity undefined when usable lots use mixed units, never silently summed", () => {
    const records = [
      lot({ code: "INV-1", materialCode: "RM-001", quantity: "100", unit: "kg" }),
      lot({ code: "INV-2", materialCode: "RM-001", quantity: "50", unit: "L" }),
    ];
    const r = evaluateMaterialAvailability(records, "RM-001", NOW);
    expect(r.hasRecords).toBe(true);
    expect(r.usableQuantity).toBeUndefined();
  });

  it("never joins a different material's records", () => {
    const records = [
      lot({ code: "INV-1", materialCode: "RM-OTHER", quantity: "1000" }),
    ];
    const r = evaluateMaterialAvailability(records, "RM-001", NOW);
    expect(r.hasRecords).toBe(false);
  });
});
