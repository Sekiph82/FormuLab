import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  dec,
  displayMoney,
  fmt,
  fmtMoney,
  moneyDp,
  nearlyEqual,
  parseHumanDecimal,
  sum,
  tryDec,
} from "./decimal";

describe("decimal parsing", () => {
  it("keeps exactness where binary floats lose it", () => {
    // The reason this module exists at all.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
  });

  it("treats blank as zero rather than NaN", () => {
    expect(dec("").toString()).toBe("0");
    expect(dec(null).toString()).toBe("0");
  });

  it("refuses non-numbers instead of guessing", () => {
    expect(() => dec("about 5%")).toThrow();
    expect(tryDec("about 5%")).toBeUndefined();
    expect(tryDec("5.5")?.toString()).toBe("5.5");
  });
});

describe("human decimal conventions", () => {
  it("reads a comma decimal separator", () => {
    expect(parseHumanDecimal("12,5")?.toString()).toBe("12.5");
  });

  it("reads a dot decimal separator", () => {
    expect(parseHumanDecimal("12.5")?.toString()).toBe("12.5");
  });

  it("reads European grouping: 1.234,56", () => {
    expect(parseHumanDecimal("1.234,56")?.toString()).toBe("1234.56");
  });

  it("reads Anglo grouping: 1,234.56", () => {
    expect(parseHumanDecimal("1,234.56")?.toString()).toBe("1234.56");
  });

  it("treats a lone three-digit group as grouping, not a decimal", () => {
    // "1,234" is one thousand two hundred and thirty-four in every convention
    // that writes it that way.
    expect(parseHumanDecimal("1,234")?.toString()).toBe("1234");
    expect(parseHumanDecimal("1.234")?.toString()).toBe("1234");
  });

  it("still reads two-digit decimals after a lone separator", () => {
    expect(parseHumanDecimal("1,23")?.toString()).toBe("1.23");
  });

  it("rejects text rather than returning a wrong number", () => {
    expect(parseHumanDecimal("n/a")).toBeUndefined();
    expect(parseHumanDecimal("")).toBeUndefined();
    expect(parseHumanDecimal("12 kg")).toBeUndefined();
  });
});

describe("formatting", () => {
  it("rounds percentages to the documented 4 dp", () => {
    expect(fmt(new Decimal("12.345678"))).toBe("12.3457");
  });

  it("rounds money to the currency's dp", () => {
    expect(moneyDp("KES")).toBe(2);
    expect(fmtMoney(new Decimal("1447.005"), "KES")).toBe("1447.01");
  });

  it("renders large money readably instead of in exponent form", () => {
    // A cost of 1.447e+04 on a screen is a defect, not a number.
    expect(displayMoney("14470.5", "KES")).toBe("14,470.50 KES");
  });

  it("compares within tolerance", () => {
    expect(nearlyEqual(new Decimal("100.00005"), new Decimal("100"))).toBe(true);
    expect(nearlyEqual(new Decimal("100.01"), new Decimal("100"))).toBe(false);
  });
});
