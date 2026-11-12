import { beforeEach, describe, expect, it } from "vitest";
import { loadProviderConfig } from "./formulationV2";

describe("provider config", () => {
  beforeEach(() => window.localStorage.clear());

  it("removes provider API keys left in localStorage by earlier builds", () => {
    window.localStorage.setItem("formulab.v2.key.gemini", "sk-leftover");
    window.localStorage.setItem("formulab.v2.key.openai", "sk-other");
    window.localStorage.setItem("formulab.v2.provider", "gemini");
    const cfg = loadProviderConfig();
    expect(cfg).not.toHaveProperty("apiKey");
    expect(cfg.provider).toBe("gemini");
    expect(window.localStorage.getItem("formulab.v2.key.gemini")).toBeNull();
    expect(window.localStorage.getItem("formulab.v2.key.openai")).toBeNull();
    expect(window.localStorage.getItem("formulab.v2.provider")).toBe("gemini");
  });
});
