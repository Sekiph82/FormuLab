import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "formulab.onboarding.dismissed.v1";

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("useOnboardingStore — first-use persistence", () => {
  it("is not dismissed by default (no prior localStorage value)", async () => {
    const { useOnboardingStore } = await import("./onboardingStore");
    expect(useOnboardingStore.getState().dismissed).toBe(false);
  });

  it("dismiss() persists the flag and flips the in-memory state", async () => {
    const { useOnboardingStore } = await import("./onboardingStore");
    useOnboardingStore.getState().dismiss();
    expect(useOnboardingStore.getState().dismissed).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("1");
  });

  it("a fresh module load reads the persisted dismissal back (stays dismissed across reloads)", async () => {
    window.localStorage.setItem(KEY, "1");
    const { useOnboardingStore } = await import("./onboardingStore");
    expect(useOnboardingStore.getState().dismissed).toBe(true);
  });

  it("only writes '1' — never a value that could be misread as anything else", async () => {
    const { useOnboardingStore } = await import("./onboardingStore");
    useOnboardingStore.getState().dismiss();
    expect(window.localStorage.getItem(KEY)).toBe("1");
  });
});
