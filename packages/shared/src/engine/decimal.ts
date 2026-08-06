/**
 * The one place decimals are parsed, rounded and rendered.
 *
 * Every number a factory or an invoice depends on passes through here. The rule
 * the whole platform rests on: binary floating point cannot represent 0.1, so
 * `0.1 + 0.2 !== 0.3`. A formula that totals 99.99999999999999% is a defect, and
 * at 2000 kg batch scale the same drift is measured in grams of raw material.
 *
 * Precision policy (documented in docs/PRECISION_POLICY.md):
 *
 *   internal arithmetic   28 significant digits (decimal.js default)
 *   formula percentage     4 dp
 *   batch quantity         4 dp  (0.1 g at kg scale — below any factory scale)
 *   unit price             6 dp  (cheap bulk salts are quoted per-gram)
 *   currency total         2 dp by default, per-currency override
 *   density                4 dp
 *
 * Rounding happens ONCE, at the display or storage boundary. Intermediate
 * results are never rounded, because rounding twice is how a total stops
 * matching the sum of the lines shown above it.
 */
import Decimal from "decimal.js";

// 28 significant digits, round-half-up. Half-up rather than banker's rounding
// because that is what a chemist doing the same sum by hand produces, and a
// mismatch between the screen and the bench sheet is a support call.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export const PRECISION = {
  percent: 4,
  quantity: 4,
  unitPrice: 6,
  money: 2,
  density: 4,
  ratio: 6,
  /** Computed laboratory/stability statistics (mean, standard deviation,
   *  deviation-from-target) — generous precision because a raw measurement's
   *  own natural precision varies wildly by test (pH ~2dp, viscosity can be
   *  a large integer, a trace-active weight needs more places than a bulk
   *  one). Entered replicate VALUES are stored exactly as typed
   *  (`decimalString` has no fixed dp); only derived aggregates round here. */
  measurement: 6,
} as const;

export type PrecisionKind = keyof typeof PRECISION;

export const ONE_HUNDRED = new Decimal(100);
export const ZERO = new Decimal(0);

/**
 * Currencies whose smallest unit is not 1/100. KES, USD, EUR, GBP and TRY are
 * all 2 dp; the map exists so adding JPY or a 3 dp currency is a data change,
 * not a code change.
 */
export const CURRENCY_DP: Record<string, number> = {
  KES: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  TRY: 2,
};

export function moneyDp(currency: string): number {
  return CURRENCY_DP[currency.toUpperCase()] ?? PRECISION.money;
}

/** Parse anything user- or file-supplied into a Decimal, or throw with context. */
export function dec(value: string | number | Decimal | null | undefined): Decimal {
  if (value instanceof Decimal) return value;
  if (value === null || value === undefined || value === "") return ZERO;
  const d = new Decimal(typeof value === "number" ? value : String(value).trim());
  if (!d.isFinite()) throw new Error(`not a finite decimal: ${String(value)}`);
  return d;
}

/** Parse without throwing — returns undefined for anything unusable. */
export function tryDec(value: unknown): Decimal | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  try {
    const d = dec(value as string);
    return d.isFinite() ? d : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalize a human-typed number.
 *
 * Spreadsheets exported in Kenya, Turkey and Germany disagree about which
 * separator means what: "1.234,56" and "1,234.56" are the same quantity. The
 * rule used here is positional and safe — whichever separator appears LAST is
 * the decimal point — with the ambiguous single-separator case resolved by
 * digit grouping ("1,234" is one thousand two hundred, "1,23" is 1.23).
 *
 * Returns undefined rather than guessing when the string is not a number at all.
 */
export function parseHumanDecimal(raw: string): Decimal | undefined {
  const s = String(raw).trim().replace(/\s| |'/g, "");
  if (!s) return undefined;
  if (!/^[-+]?[\d.,]+$/.test(s)) return undefined;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;

  if (lastComma === -1 && lastDot === -1) {
    normalized = s;
  } else if (lastComma > lastDot) {
    // Comma is the decimal separator; dots are grouping.
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalized = s.replace(/,/g, "");
  } else {
    normalized = s;
  }

  // A single separator with exactly three trailing digits is grouping, not a
  // decimal: "1,234" is 1234. Two or fewer trailing digits means a decimal.
  const only = s.match(/^[-+]?\d+([.,])(\d+)$/);
  if (only && only[2].length === 3 && !/^0/.test(s.replace(/^[-+]/, ""))) {
    normalized = s.replace(/[.,]/g, "");
  }

  try {
    const d = new Decimal(normalized);
    return d.isFinite() ? d : undefined;
  } catch {
    return undefined;
  }
}

/** Decimal → the exact string the schemas store. Rounds once, here. */
export function fmt(value: Decimal, kind: PrecisionKind = "percent"): string {
  return value.toFixed(PRECISION[kind]);
}

export function fmtMoney(value: Decimal, currency = "KES"): string {
  return value.toFixed(moneyDp(currency));
}

/** Human display with thousands separators — never for storage. */
export function displayMoney(value: Decimal | string, currency = "KES"): string {
  const d = dec(value);
  const parts = d.toFixed(moneyDp(currency)).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${parts.join(".")} ${currency.toUpperCase()}`;
}

/** Sum a list exactly, with no intermediate rounding. */
export function sum(values: (Decimal | string)[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), ZERO);
}

/** `a` and `b` equal to within `tolerance` (default: one unit at 4 dp). */
export function nearlyEqual(a: Decimal, b: Decimal, tolerance = "0.0001"): boolean {
  return a.minus(b).abs().lessThanOrEqualTo(dec(tolerance));
}

export { Decimal };
