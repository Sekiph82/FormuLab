import { describe, expect, it } from "vitest";
import { evaluateDoeExpression, validateDoeExpressionSyntax } from "./doeExpression";

describe("evaluateDoeExpression", () => {
  it("evaluates a plain arithmetic expression with factor codes", () => {
    const r = evaluateDoeExpression("SLES + Salt", { SLES: 12, Salt: 1.5 });
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(13.5, 8);
  });

  it("respects operator precedence and parentheses", () => {
    const r1 = evaluateDoeExpression("2 + 3 * 4", {});
    expect(r1.value).toBe(14);
    const r2 = evaluateDoeExpression("(2 + 3) * 4", {});
    expect(r2.value).toBe(20);
  });

  it("handles unary minus", () => {
    const r = evaluateDoeExpression("-SLES + 20", { SLES: 5 });
    expect(r.value).toBe(15);
  });

  it("evaluates a comparison expression and reports satisfied/not", () => {
    const under = evaluateDoeExpression("SLES + Salt <= 25", { SLES: 12, Salt: 5 });
    expect(under.ok).toBe(true);
    expect(under.satisfied).toBe(true);

    const over = evaluateDoeExpression("SLES + Salt <= 25", { SLES: 20, Salt: 10 });
    expect(over.satisfied).toBe(false);
  });

  it("supports every comparison operator", () => {
    const vars = { X: 10 };
    expect(evaluateDoeExpression("X == 10", vars).satisfied).toBe(true);
    expect(evaluateDoeExpression("X != 10", vars).satisfied).toBe(false);
    expect(evaluateDoeExpression("X < 11", vars).satisfied).toBe(true);
    expect(evaluateDoeExpression("X > 9", vars).satisfied).toBe(true);
    expect(evaluateDoeExpression("X >= 10", vars).satisfied).toBe(true);
    expect(evaluateDoeExpression("X <= 10", vars).satisfied).toBe(true);
  });

  it("returns ok:false (never throws) for an unknown factor code", () => {
    const r = evaluateDoeExpression("Unknown + 1", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown factor code/i);
  });

  it("returns ok:false for division by zero", () => {
    const r = evaluateDoeExpression("10 / X", { X: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/division by zero/i);
  });

  it("returns ok:false for malformed syntax rather than throwing", () => {
    // Unary "+" is not supported (only unary "-" is) — "SLES + + 1" cannot
    // parse: after the binary "+", parsePrimary sees another "+" token,
    // which is neither a number, identifier, nor "(".
    expect(() => evaluateDoeExpression("SLES + + 1", { SLES: 1 })).not.toThrow();
    const r = evaluateDoeExpression("SLES + + 1", { SLES: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("never executes arbitrary code even if the expression looks like an attempt to", () => {
    // These must all fail to parse/evaluate — there is no code path that could
    // execute them, but assert the outcome explicitly for the record.
    const attempts = [
      "require('fs')",
      "process.exit()",
      "(() => 1)()",
      "this.constructor",
      "`${1}`",
      "eval('1')",
    ];
    for (const expr of attempts) {
      const r = evaluateDoeExpression(expr, {});
      // Either it fails outright, or (for bare identifier-looking calls like
      // `eval`) it is treated as an unknown "factor code" and rejected —
      // never executed.
      expect(r.ok).toBe(false);
    }
  });
});

describe("validateDoeExpressionSyntax", () => {
  it("accepts a syntactically valid expression referencing known factor codes", () => {
    const r = validateDoeExpressionSyntax("SLES + Salt <= 25", ["SLES", "Salt"]);
    expect(r.valid).toBe(true);
    expect(r.referencedFactorCodes.sort()).toEqual(["SLES", "Salt"].sort());
  });

  it("rejects an expression referencing an unknown factor code", () => {
    const r = validateDoeExpressionSyntax("SLES + Typo <= 25", ["SLES", "Salt"]);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Typo/);
  });

  it("rejects malformed syntax", () => {
    const r = validateDoeExpressionSyntax("SLES + )", ["SLES"]);
    expect(r.valid).toBe(false);
  });
});
