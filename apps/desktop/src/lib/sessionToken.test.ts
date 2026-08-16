import { afterEach, describe, expect, it } from "vitest";
import { currentSessionToken } from "./sessionToken";

const KEY = "formulab.auth.token";

describe("currentSessionToken", () => {
  afterEach(() => {
    window.localStorage.removeItem(KEY);
  });

  it("returns the persisted token", () => {
    window.localStorage.setItem(KEY, "a-real-token");
    expect(currentSessionToken()).toBe("a-real-token");
  });

  it("returns an empty string when nothing is persisted", () => {
    expect(currentSessionToken()).toBe("");
  });

  it("reads the exact key AuthProvider persists to", async () => {
    const { SESSION_TOKEN_KEY } = await import("@/app/providers/AuthProvider");
    expect(SESSION_TOKEN_KEY).toBe(KEY);
  });
});
