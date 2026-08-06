import { describe, expect, it } from "vitest";
import { conditionNumber, cooksDistances, fitOrdinaryLeastSquares, identity, invert, multiply, multiplyVector, oneNorm, transpose } from "./doeMath";

describe("transpose / multiply / multiplyVector", () => {
  it("transposes a rectangular matrix", () => {
    expect(transpose([[1, 2, 3], [4, 5, 6]])).toEqual([[1, 4], [2, 5], [3, 6]]);
  });

  it("multiplies two matrices correctly", () => {
    const a = [[1, 2], [3, 4]];
    const b = [[5, 6], [7, 8]];
    expect(multiply(a, b)).toEqual([[19, 22], [43, 50]]);
  });

  it("throws on incompatible dimensions", () => {
    expect(() => multiply([[1, 2]], [[1, 2]])).toThrow();
  });

  it("multiplies a matrix by a vector", () => {
    expect(multiplyVector([[1, 2], [3, 4]], [5, 6])).toEqual([17, 39]);
  });
});

describe("invert", () => {
  it("inverts a known 2x2 matrix exactly", () => {
    const a = [[4, 7], [2, 6]];
    const inv = invert(a);
    expect(inv).not.toBeNull();
    // Known inverse of [[4,7],[2,6]] is [[0.6,-0.7],[-0.2,0.4]] (det = 10).
    expect(inv![0][0]).toBeCloseTo(0.6, 8);
    expect(inv![0][1]).toBeCloseTo(-0.7, 8);
    expect(inv![1][0]).toBeCloseTo(-0.2, 8);
    expect(inv![1][1]).toBeCloseTo(0.4, 8);
  });

  it("A * A^-1 is the identity for a well-conditioned matrix", () => {
    const a = [[3, 0, 2], [2, 0, -2], [0, 1, 1]];
    const inv = invert(a)!;
    const product = multiply(a, inv);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(product[i][j]).toBeCloseTo(identity(3)[i][j], 6);
      }
    }
  });

  it("returns null for a singular matrix rather than a fabricated inverse", () => {
    const singular = [[1, 2], [2, 4]]; // row 2 = 2 * row 1
    expect(invert(singular)).toBeNull();
  });

  it("returns null for an all-zero matrix", () => {
    expect(invert([[0, 0], [0, 0]])).toBeNull();
  });
});

describe("oneNorm / conditionNumber", () => {
  it("computes the 1-norm as the max absolute column sum", () => {
    const a = [[1, -7], [-2, 3]];
    // column sums: |1|+|-2|=3, |-7|+|3|=10
    expect(oneNorm(a)).toBe(10);
  });

  it("returns a finite condition number for a well-conditioned matrix", () => {
    const cn = conditionNumber(identity(3));
    // ||I||_1 = 1 (each column sums to 1), ||I^-1||_1 = ||I||_1 = 1, so cond = 1 * 1 = 1 — the best possible condition number.
    expect(cn).toBeCloseTo(1, 6);
  });

  it("returns undefined for a singular matrix", () => {
    expect(conditionNumber([[1, 2], [2, 4]])).toBeUndefined();
  });
});

describe("fitOrdinaryLeastSquares", () => {
  it("recovers an exact linear model y = 2 + 3*x1 with no noise", () => {
    // X columns: [intercept, x1]
    const x = [
      [1, -1],
      [1, 0],
      [1, 1],
      [1, 2],
    ];
    const y = x.map((row) => 2 + 3 * row[1]);
    const result = fitOrdinaryLeastSquares(x, y);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coefficients[0]).toBeCloseTo(2, 8);
    expect(result.coefficients[1]).toBeCloseTo(3, 8);
    expect(result.rss).toBeCloseTo(0, 8);
    expect(result.residualDegreesOfFreedom).toBe(2);
  });

  it("recovers exact two-factor coefficients plus an interaction term with no noise", () => {
    // y = 5 + 2*x1 - 1*x2 + 4*x1*x2, X columns: [intercept, x1, x2, x1*x2]
    const points: [number, number][] = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    const x = points.map(([x1, x2]) => [1, x1, x2, x1 * x2]);
    const y = points.map(([x1, x2]) => 5 + 2 * x1 - 1 * x2 + 4 * x1 * x2);
    const result = fitOrdinaryLeastSquares(x, y);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coefficients[0]).toBeCloseTo(5, 6);
    expect(result.coefficients[1]).toBeCloseTo(2, 6);
    expect(result.coefficients[2]).toBeCloseTo(-1, 6);
    expect(result.coefficients[3]).toBeCloseTo(4, 6);
  });

  it("recovers a known quadratic model exactly", () => {
    // y = 1 - 2*x + 3*x^2, X columns: [intercept, x, x^2]
    const xs = [-2, -1, 0, 1, 2, 3];
    const x = xs.map((v) => [1, v, v * v]);
    const y = xs.map((v) => 1 - 2 * v + 3 * v * v);
    const result = fitOrdinaryLeastSquares(x, y);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coefficients[0]).toBeCloseTo(1, 6);
    expect(result.coefficients[1]).toBeCloseTo(-2, 6);
    expect(result.coefficients[2]).toBeCloseTo(3, 6);
  });

  it("fails honestly (does not fabricate coefficients) when degrees of freedom are insufficient", () => {
    const x = [
      [1, -1],
      [1, 1],
    ];
    const y = [1, 3];
    // 2 runs, 2 terms -> 0 residual df, should be refused (n <= p check).
    const result = fitOrdinaryLeastSquares(x, y);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/insufficient degrees of freedom/i);
  });

  it("fails honestly when the design matrix is singular for the requested model", () => {
    // x1 and x2 are perfectly collinear (x2 = 2*x1), so [intercept, x1, x2] is singular.
    const x1s = [-1, 0, 1, 2];
    const x = x1s.map((v) => [1, v, 2 * v]);
    const y = x1s.map((v) => 1 + v);
    const result = fitOrdinaryLeastSquares(x, y);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/singular/i);
  });

  it("rejects a response vector of the wrong length rather than guessing", () => {
    const x = [[1, -1], [1, 0], [1, 1]];
    const result = fitOrdinaryLeastSquares(x, [1, 2]);
    expect(result.ok).toBe(false);
  });

  it("computes non-trivial leverage values that sum to the number of model terms", () => {
    const x = [
      [1, -1],
      [1, 0],
      [1, 1],
      [1, 2],
    ];
    const y = [1, 2, 3, 4];
    const result = fitOrdinaryLeastSquares(x, y);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sumLeverage = result.leverage.reduce((s, h) => s + h, 0);
    expect(sumLeverage).toBeCloseTo(2, 6); // trace(hat matrix) == p == 2 model terms
    result.leverage.forEach((h) => {
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThanOrEqual(1);
    });
  });
});

describe("cooksDistances", () => {
  it("gives near-zero influence to a point that fits the model well", () => {
    const x = [
      [1, -2],
      [1, -1],
      [1, 0],
      [1, 1],
      [1, 2],
    ];
    const y = [1 - 4, 1 - 2, 1, 1 + 2, 1 + 4]; // exact y = 1 + 2x
    const fit = fitOrdinaryLeastSquares(x, y);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const mse = fit.rss / fit.residualDegreesOfFreedom;
    const distances = cooksDistances(fit.residuals, fit.leverage, 2, mse || 1e-12);
    distances.forEach((d) => expect(d).toBeCloseTo(0, 4));
  });

  it("flags a genuine outlier with a Cook's distance far above the standard influence threshold", () => {
    const x = [
      [1, -2],
      [1, -1],
      [1, 0],
      [1, 1],
      [1, 2],
    ];
    const y = [1 - 4, 1 - 2, 1, 1 + 2, 1 + 4 + 20]; // last point is a big outlier
    const fit = fitOrdinaryLeastSquares(x, y);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const mse = fit.rss / fit.residualDegreesOfFreedom;
    const distances = cooksDistances(fit.residuals, fit.leverage, 2, mse);
    const maxIdx = distances.indexOf(Math.max(...distances));
    expect(maxIdx).toBe(4);
    // A commonly used Cook's distance influence threshold is 1 (or 4/n); the
    // planted outlier should clear it by a wide margin.
    expect(distances[4]).toBeGreaterThan(1);
  });
});
