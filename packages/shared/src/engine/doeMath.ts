/**
 * Narrowly-scoped, comprehensively-tested matrix operations backing the
 * DOE statistical-analysis engine (`doeAnalysis.ts`). Plain `number[][]`,
 * not `Decimal` — unlike money/formula percentages, a fitted regression
 * coefficient is an approximation by nature, and IEEE double precision is
 * the standard, well-understood tool for this, not a defect. No external
 * numerical library is added; every function here is small enough to be
 * exhaustively tested against hand-computed and closed-form examples.
 */

export type Matrix = number[][];
export type Vector = number[];

export function transpose(a: Matrix): Matrix {
  if (a.length === 0) return [];
  const rows = a.length;
  const cols = a[0].length;
  const out: Matrix = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = a[i][j];
  return out;
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const aRows = a.length;
  const aCols = a[0]?.length ?? 0;
  const bRows = b.length;
  const bCols = b[0]?.length ?? 0;
  if (aCols !== bRows) throw new Error(`Cannot multiply a ${aRows}x${aCols} matrix by a ${bRows}x${bCols} matrix.`);
  const out: Matrix = Array.from({ length: aRows }, () => new Array(bCols).fill(0));
  for (let i = 0; i < aRows; i++) {
    for (let k = 0; k < aCols; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < bCols; j++) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

export function multiplyVector(a: Matrix, v: Vector): Vector {
  return a.map((row) => row.reduce((sum, val, j) => sum + val * v[j], 0));
}

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

/** Gauss-Jordan elimination with partial pivoting. Returns `null` (never
 *  throws, never fabricates a result) when the matrix is singular or
 *  effectively singular within `tolerance` — the caller (`fitOrdinaryLeastSquares`)
 *  turns that into an explicit "the model is not estimable" analysis
 *  error, per spec §7: "detect singular and ill-conditioned matrices…
 *  never silently return fabricated coefficients." */
export function invert(a: Matrix, tolerance = 1e-10): Matrix | null {
  const n = a.length;
  if (n === 0 || a.some((row) => row.length !== n)) throw new Error("invert() requires a square matrix.");
  // Augmented [A | I]
  const aug: Matrix = a.map((row, i) => [...row, ...identity(n)[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot: find the largest absolute value in this column at or below the diagonal.
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > maxAbs) {
        maxAbs = Math.abs(aug[r][col]);
        pivotRow = r;
      }
    }
    if (maxAbs < tolerance) return null;
    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }
    const pivotVal = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivotVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  return aug.map((row) => row.slice(n));
}

/** 1-norm (max absolute column sum) of a square matrix. */
export function oneNorm(a: Matrix): number {
  const n = a.length;
  let max = 0;
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(a[i][j]);
    if (sum > max) max = sum;
  }
  return max;
}

/** A real, computed 1-norm condition number estimate: `||A||_1 * ||A^-1||_1`.
 *  Returns `undefined` (never a fabricated number) when `A` is singular. */
export function conditionNumber(a: Matrix): number | undefined {
  const inv = invert(a);
  if (!inv) return undefined;
  return oneNorm(a) * oneNorm(inv);
}

export interface OlsResult {
  ok: true;
  /** One coefficient per column of X, in column order. */
  coefficients: Vector;
  fitted: Vector;
  residuals: Vector;
  /** Diagonal of the hat matrix `X (X'X)^-1 X'` — each run's leverage. */
  leverage: Vector;
  /** `(X'X)^-1`, needed for coefficient standard errors. */
  xtxInverse: Matrix;
  /** Residual sum of squares. */
  rss: number;
  /** Residual degrees of freedom: n - rank(X) (rank taken as column count,
   *  since a singular X is refused before reaching this point). */
  residualDegreesOfFreedom: number;
}

export interface OlsFailure {
  ok: false;
  error: string;
}

/** Ordinary least squares via the normal equations: `beta = (X'X)^-1 X'y`.
 *  For the small (typically <= 32 run, <= 12 term) design matrices DOE
 *  produces, this is numerically adequate and simple enough to test
 *  exhaustively — a full QR/SVD implementation would be more robust for
 *  very ill-conditioned problems, which is exactly why `conditionNumber`
 *  and the singularity check below exist: to catch that case explicitly
 *  rather than pretend this method handles it silently. */
export function fitOrdinaryLeastSquares(x: Matrix, y: Vector): OlsResult | OlsFailure {
  const n = x.length;
  const p = x[0]?.length ?? 0;
  if (n === 0 || p === 0) return { ok: false, error: "Design matrix is empty." };
  if (y.length !== n) return { ok: false, error: "Response vector length does not match the number of runs." };
  if (n <= p) return { ok: false, error: `Insufficient degrees of freedom: ${n} run(s) cannot estimate ${p} model term(s).` };

  const xt = transpose(x);
  const xtx = multiply(xt, x);
  const xtxInv = invert(xtx);
  if (!xtxInv) return { ok: false, error: "The design matrix is singular (or numerically indistinguishable from singular) for this model — some term(s) cannot be estimated from these runs." };

  const xty = multiplyVector(xt, y);
  const coefficients = multiplyVector(xtxInv, xty);
  const fitted = multiplyVector(x, coefficients);
  const residuals = y.map((yi, i) => yi - fitted[i]);
  const rss = residuals.reduce((sum, r) => sum + r * r, 0);

  // Leverage: diag(X (X'X)^-1 X').
  const hatHelper = multiply(x, xtxInv); // n x p
  const leverage = hatHelper.map((row, i) => row.reduce((sum, val, j) => sum + val * x[i][j], 0));

  return {
    ok: true,
    coefficients,
    fitted,
    residuals,
    leverage,
    xtxInverse: xtxInv,
    rss,
    residualDegreesOfFreedom: n - p,
  };
}

/** Cook's distance for every observation, given an OLS fit. Requires
 *  `p` (model term count) and mean-squared-error explicitly rather than
 *  recomputing them, so this stays a small, single-purpose function. */
export function cooksDistances(residuals: Vector, leverage: Vector, p: number, mse: number): Vector {
  if (mse === 0) return residuals.map(() => 0);
  return residuals.map((r, i) => {
    const h = leverage[i];
    if (h >= 1) return Infinity;
    const standardizedSq = (r * r) / (mse * p);
    return standardizedSq * (h / Math.pow(1 - h, 2));
  });
}
