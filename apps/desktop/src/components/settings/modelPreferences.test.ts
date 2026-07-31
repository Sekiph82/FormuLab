import { beforeEach, describe, expect, it } from "vitest";
import {
  FAVORITES_KEY,
  RECENT_KEY,
  loadModelPreferences,
  recordRecent,
  saveModelPreferences,
  toggleFavorite,
} from "./modelPreferences";

describe("model preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("falls back safely when stored JSON is invalid", () => {
    window.localStorage.setItem(FAVORITES_KEY, "not-json");
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(["openai/gpt-5", 7]));
    expect(loadModelPreferences()).toEqual({ favorites: [], recent: ["openai/gpt-5"] });
  });

  it("toggles a favorite without duplicates", () => {
    const added = toggleFavorite({ favorites: [], recent: [] }, "openai/gpt-5");
    expect(added.favorites).toEqual(["openai/gpt-5"]);
    expect(toggleFavorite(added, "openai/gpt-5").favorites).toEqual([]);
  });

  it("records recent models newest-first, deduplicated, and capped at eight", () => {
    const seed = { favorites: [], recent: Array.from({ length: 8 }, (_, i) => `p/m${i}`) };
    expect(recordRecent(seed, "p/m3").recent).toEqual([
      "p/m3", "p/m0", "p/m1", "p/m2", "p/m4", "p/m5", "p/m6", "p/m7",
    ]);
    expect(recordRecent(seed, "p/new").recent).toHaveLength(8);
    expect(recordRecent(seed, "p/new").recent[0]).toBe("p/new");
  });

  it("round-trips preferences through localStorage", () => {
    saveModelPreferences({ favorites: ["openai/o3"], recent: ["ollama/qwen"] });
    expect(loadModelPreferences()).toEqual({
      favorites: ["openai/o3"],
      recent: ["ollama/qwen"],
    });
  });
});

describe("model preferences key migration (formulab.models.* <- ai4s.models.*)", () => {
  beforeEach(() => window.localStorage.clear());
  const LEGACY_FAVORITES_KEY = "ai4s.models.favorites.v1";
  const LEGACY_RECENT_KEY = "ai4s.models.recent.v1";

  it("prefers the new key's value when both new and legacy keys exist", () => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(["new/model"]));
    window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(["legacy/model"]));
    expect(loadModelPreferences().favorites).toEqual(["new/model"]);
    expect(window.localStorage.getItem(LEGACY_FAVORITES_KEY)).toBe(JSON.stringify(["legacy/model"]));
  });

  it("migrates a legacy-only favorites value and writes it once to the new key", () => {
    window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(["legacy/model"]));
    expect(loadModelPreferences().favorites).toEqual(["legacy/model"]);
    expect(window.localStorage.getItem(FAVORITES_KEY)).toBe(JSON.stringify(["legacy/model"]));
    expect(window.localStorage.getItem(LEGACY_FAVORITES_KEY)).toBe(JSON.stringify(["legacy/model"]));
  });

  it("migrates a legacy-only recent value", () => {
    window.localStorage.setItem(LEGACY_RECENT_KEY, JSON.stringify(["legacy/recent"]));
    expect(loadModelPreferences().recent).toEqual(["legacy/recent"]);
    expect(window.localStorage.getItem(RECENT_KEY)).toBe(JSON.stringify(["legacy/recent"]));
  });

  it("falls back to an empty array without crashing when the legacy value is malformed JSON", () => {
    window.localStorage.setItem(LEGACY_FAVORITES_KEY, "not-json");
    expect(() => loadModelPreferences()).not.toThrow();
    expect(loadModelPreferences().favorites).toEqual([]);
    // The malformed legacy string is still copied over (harmless: every read
    // path safely re-parses it to [] regardless of which key holds it).
    expect(window.localStorage.getItem(FAVORITES_KEY)).toBe("not-json");
  });

  it("writes only to the new key going forward, never resurrecting the legacy key", () => {
    window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(["legacy/model"]));
    loadModelPreferences();
    saveModelPreferences({ favorites: ["new/model"], recent: [] });
    expect(window.localStorage.getItem(FAVORITES_KEY)).toBe(JSON.stringify(["new/model"]));
    expect(window.localStorage.getItem(LEGACY_FAVORITES_KEY)).toBe(JSON.stringify(["legacy/model"]));
  });

  it("does not delete either legacy key after migrating", () => {
    window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(["a"]));
    window.localStorage.setItem(LEGACY_RECENT_KEY, JSON.stringify(["b"]));
    loadModelPreferences();
    expect(window.localStorage.getItem(LEGACY_FAVORITES_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(LEGACY_RECENT_KEY)).not.toBeNull();
  });
});
