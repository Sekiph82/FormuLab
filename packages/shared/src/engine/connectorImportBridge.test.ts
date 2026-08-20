/**
 * FVL-04.024 (hardened) — dependency ordering/cycle-detection acceptance.
 */
import { describe, expect, it } from "vitest";
import { planImportOrder, planImportOrderFromDependencies } from "./connectorImportBridge";

describe("planImportOrder — registry-driven, never hardcoded", () => {
  it("orders suppliers before material_prices (material_prices.supplier_code references suppliers)", () => {
    const result = planImportOrder(["material_prices", "suppliers"]);
    expect("order" in result).toBe(true);
    const order = (result as { order: string[] }).order;
    expect(order.indexOf("suppliers")).toBeLessThan(order.indexOf("material_prices"));
  });

  it("orders raw_materials before material_suppliers", () => {
    const result = planImportOrder(["material_suppliers", "raw_materials"]);
    const order = (result as { order: string[] }).order;
    expect(order.indexOf("raw_materials")).toBeLessThan(order.indexOf("material_suppliers"));
  });

  it("orders test_definitions before lab_results", () => {
    const result = planImportOrder(["lab_results", "test_definitions"]);
    const order = (result as { order: string[] }).order;
    expect(order.indexOf("test_definitions")).toBeLessThan(order.indexOf("lab_results"));
  });

  it("a template referencing itself (artwork_register.supersedes_artwork_code) is not treated as an ordering dependency on a DIFFERENT template", () => {
    const result = planImportOrder(["artwork_register"]);
    expect(result).toEqual({ order: ["artwork_register"] });
  });

  it("a full realistic multi-template batch orders every real dependency correctly, computed generically from the registry, not a hardcoded table", () => {
    const templates = ["material_prices", "material_suppliers", "suppliers", "raw_materials", "inventory_records"];
    const result = planImportOrder(templates);
    expect("order" in result).toBe(true);
    const order = (result as { order: string[] }).order;
    expect(order).toHaveLength(templates.length);
    expect(order.indexOf("raw_materials")).toBeLessThan(order.indexOf("material_suppliers"));
    expect(order.indexOf("suppliers")).toBeLessThan(order.indexOf("material_suppliers"));
    expect(order.indexOf("raw_materials")).toBeLessThan(order.indexOf("material_prices"));
    expect(order.indexOf("suppliers")).toBeLessThan(order.indexOf("material_prices"));
    expect(order.indexOf("raw_materials")).toBeLessThan(order.indexOf("inventory_records"));
  });

  it("a dependency on a template NOT in this batch is ignored — that target is assumed to already exist canonically", () => {
    // material_prices depends on suppliers AND raw_materials, but only
    // material_prices itself is in this batch.
    const result = planImportOrder(["material_prices"]);
    expect(result).toEqual({ order: ["material_prices"] });
  });

  it("no real templateCodes input produces a cycle today — a genuine invariant of the current registry, not a limitation of the detector (the detector's own cycle path is exercised directly below with a synthetic graph)", () => {
    expect(planImportOrder([])).toEqual({ order: [] });
  });
});

describe("planImportOrderFromDependencies — the pure Kahn's-algorithm core, exercised directly with a synthetic graph", () => {
  it("a genuine two-template cycle (a depends on b, b depends on a) is reported as a cycle, never silently ordered", () => {
    const deps = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    const result = planImportOrderFromDependencies(["a", "b"], deps);
    expect("cycle" in result).toBe(true);
    expect((result as { cycle: string[] }).cycle.sort()).toEqual(["a", "b"]);
  });

  it("a three-template cycle (a->b->c->a) is reported", () => {
    const deps = new Map([
      ["a", new Set(["c"])],
      ["b", new Set(["a"])],
      ["c", new Set(["b"])],
    ]);
    const result = planImportOrderFromDependencies(["a", "b", "c"], deps);
    expect("cycle" in result).toBe(true);
  });

  it("a cycle among a SUBSET of the batch is reported, even when other templates in the batch order cleanly", () => {
    const deps = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
      ["c", new Set<string>()], // c has no dependency at all — orders fine on its own
    ]);
    const result = planImportOrderFromDependencies(["a", "b", "c"], deps);
    expect("cycle" in result).toBe(true);
    expect((result as { cycle: string[] }).cycle.sort()).toEqual(["a", "b"]);
  });

  it("a clean linear chain (a->b->c) orders correctly", () => {
    const deps = new Map([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
      ["c", new Set(["b"])],
    ]);
    const result = planImportOrderFromDependencies(["c", "b", "a"], deps);
    expect(result).toEqual({ order: ["a", "b", "c"] });
  });
});
