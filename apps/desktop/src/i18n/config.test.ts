import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  detectInitialLocale,
  LOCALE_KEY,
  LOCALES,
  localeMeta,
  resolveLocale,
  shippedLocales,
} from "./config";

describe("locale registry", () => {
  it("ships exactly the 8 first-batch locales, in order", () => {
    expect(shippedLocales().map((l) => l.code)).toEqual([
      "en", "zh-Hans", "ja", "es", "de", "fr", "ko", "tr",
    ]);
  });

  it("registers pt-BR and ar but does not ship them", () => {
    expect(localeMeta("pt-BR")?.shipped).toBe(false);
    expect(localeMeta("ar")?.shipped).toBe(false);
  });

  it("marks ar as right-to-left and the rest left-to-right", () => {
    expect(localeMeta("ar")?.dir).toBe("rtl");
    for (const l of LOCALES.filter((x) => x.code !== "ar")) {
      expect(l.dir).toBe("ltr");
    }
  });

  it("has a native name for every locale", () => {
    for (const l of LOCALES) expect(l.nativeName.length).toBeGreaterThan(0);
  });
});

describe("resolveLocale", () => {
  it("returns an exact shipped match (case-insensitive)", () => {
    expect(resolveLocale("ja")).toBe("ja");
    expect(resolveLocale("JA")).toBe("ja");
    expect(resolveLocale("zh-Hans")).toBe("zh-Hans");
  });

  it("falls back to a base-language match", () => {
    expect(resolveLocale("en-GB")).toBe("en");
    expect(resolveLocale("zh-CN")).toBe("zh-Hans");
    expect(resolveLocale("fr-CA")).toBe("fr");
  });

  it("never resolves to an unshipped locale", () => {
    expect(resolveLocale("pt-BR")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("ar")).toBe(DEFAULT_LOCALE);
  });

  it("falls back to the default for unknown or empty input", () => {
    expect(resolveLocale("xx")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });
});

describe("locale key migration (formulab.locale <- ai4s.locale)", () => {
  const LEGACY_LOCALE_KEY = "ai4s.locale";

  beforeEach(() => window.localStorage.clear());

  it("prefers the new key when both new and legacy keys exist", () => {
    window.localStorage.setItem(LOCALE_KEY, "ja");
    window.localStorage.setItem(LEGACY_LOCALE_KEY, "de");
    expect(detectInitialLocale()).toBe("ja");
    expect(window.localStorage.getItem(LEGACY_LOCALE_KEY)).toBe("de");
  });

  it("migrates a legacy-only value and writes it once to the new key", () => {
    window.localStorage.setItem(LEGACY_LOCALE_KEY, "fr");
    expect(detectInitialLocale()).toBe("fr");
    expect(window.localStorage.getItem(LOCALE_KEY)).toBe("fr");
    expect(window.localStorage.getItem(LEGACY_LOCALE_KEY)).toBe("fr");
  });

  it("falls back to the default without crashing when the legacy value is an unshipped/unknown locale", () => {
    window.localStorage.setItem(LEGACY_LOCALE_KEY, "not-a-real-locale");
    expect(() => detectInitialLocale()).not.toThrow();
    expect(detectInitialLocale()).toBe(DEFAULT_LOCALE);
  });

  it("does not delete the legacy key after migrating", () => {
    window.localStorage.setItem(LEGACY_LOCALE_KEY, "es");
    detectInitialLocale();
    expect(window.localStorage.getItem(LEGACY_LOCALE_KEY)).toBe("es");
  });
});
