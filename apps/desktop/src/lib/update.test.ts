import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseMetadata } from "./tauri";

const bridge = {
  checkForUpdate: vi.fn<(endpoint: string) => Promise<ReleaseMetadata>>(),
};

vi.mock("./tauri", () => ({
  checkForUpdate: (endpoint: string) => bridge.checkForUpdate(endpoint),
}));

const notifyMock = vi.fn<(version: string, url: string) => Promise<boolean>>();
vi.mock("./systemNotification", () => ({
  notifyUpdateAvailable: (version: string, url: string) => notifyMock(version, url),
}));

import {
  DEFAULT_RELEASE_METADATA_URL,
  compareVersions,
  isHttpsUrl,
  isIgnoredVersion,
  isNewerVersion,
  isValidSemver,
  shouldAutoCheck,
  shouldShowUpdateBadge,
  useUpdateStore,
} from "./update";

function release(overrides: Partial<ReleaseMetadata> = {}): ReleaseMetadata {
  return {
    version: "v0.1.8",
    url: "https://github.com/Sekiph82/FormuLab/releases/tag/v0.1.8",
    name: "v0.1.8",
    publishedAt: "2026-07-09T00:00:00Z",
    notes: "Fixed things.",
    platformSupported: true,
    matchedAssetName: "FormuLab_0.1.8_x64-setup.exe",
    ...overrides,
  };
}

describe("version comparison", () => {
  it("compares v-prefixed semver versions", () => {
    expect(compareVersions("v0.1.8", "0.1.7")).toBe(1);
    expect(compareVersions("0.1.7", "v0.1.7")).toBe(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
  });

  it("detects strictly newer versions only (never same or older)", () => {
    expect(isNewerVersion("v0.1.8", "0.1.7")).toBe(true);
    expect(isNewerVersion("v0.1.7", "0.1.7")).toBe(false); // same version
    expect(isNewerVersion("v0.1.6", "0.1.7")).toBe(false); // older (downgrade)
  });
});

describe("isValidSemver", () => {
  it("accepts well-formed versions, with or without a leading v and a suffix", () => {
    expect(isValidSemver("1.2.3")).toBe(true);
    expect(isValidSemver("v1.2.3")).toBe(true);
    expect(isValidSemver("1.2.3-beta.1")).toBe(true);
    expect(isValidSemver("1.2.3+build.5")).toBe(true);
  });

  it("rejects malformed versions", () => {
    expect(isValidSemver("")).toBe(false);
    expect(isValidSemver("abc")).toBe(false);
    expect(isValidSemver("1.2")).toBe(false);
    expect(isValidSemver("1.2.x")).toBe(false);
    expect(isValidSemver("v1")).toBe(false);
  });
});

describe("isHttpsUrl", () => {
  it("accepts only https URLs", () => {
    expect(isHttpsUrl("https://example.com/releases.json")).toBe(true);
    expect(isHttpsUrl("http://example.com/releases.json")).toBe(false);
    expect(isHttpsUrl("ftp://example.com")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
  });
});

describe("isIgnoredVersion", () => {
  it("matches normalized versions and treats no ignored version as never-ignored", () => {
    expect(isIgnoredVersion("v0.1.8", "0.1.8")).toBe(true);
    expect(isIgnoredVersion("0.1.8", null)).toBe(false);
    expect(isIgnoredVersion("0.1.9", "0.1.8")).toBe(false);
  });
});

describe("shouldAutoCheck (launch/scheduled-check eligibility)", () => {
  it("respects a configurable frequency, not a fixed interval", () => {
    const now = 1_000_000_000_000;
    expect(shouldAutoCheck(null, now, 24)).toBe(true);
    expect(shouldAutoCheck(now - 23 * 60 * 60 * 1000, now, 24)).toBe(false);
    expect(shouldAutoCheck(now - 24 * 60 * 60 * 1000, now, 24)).toBe(true);
    // A shorter configured frequency (6h) makes the same elapsed time eligible.
    expect(shouldAutoCheck(now - 23 * 60 * 60 * 1000, now, 6)).toBe(true);
    // A longer one (168h/weekly) keeps it ineligible.
    expect(shouldAutoCheck(now - 23 * 60 * 60 * 1000, now, 168)).toBe(false);
  });
});

describe("shouldShowUpdateBadge", () => {
  const latest = release();

  it("shows the badge only when enabled, newer, and not ignored", () => {
    expect(shouldShowUpdateBadge({ enabled: true, badgeEnabled: true, latest, currentVersion: "0.1.7", ignoredVersion: null })).toBe(true);
    expect(shouldShowUpdateBadge({ enabled: true, badgeEnabled: false, latest, currentVersion: "0.1.7", ignoredVersion: null })).toBe(false);
    expect(shouldShowUpdateBadge({ enabled: true, badgeEnabled: true, latest, currentVersion: "0.1.7", ignoredVersion: "0.1.8" })).toBe(false);
    expect(shouldShowUpdateBadge({ enabled: true, badgeEnabled: true, latest, currentVersion: "0.1.8", ignoredVersion: null })).toBe(false);
  });
});

describe("update store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    bridge.checkForUpdate.mockReset();
    notifyMock.mockReset();
    notifyMock.mockResolvedValue(true);
    vi.stubGlobal("navigator", { onLine: true });
    useUpdateStore.setState({
      endpointUrl: DEFAULT_RELEASE_METADATA_URL,
      enabled: true,
      badgeEnabled: true,
      frequencyHours: 24,
      ignoredVersion: null,
      notifiedVersion: null,
      lastCheckedAt: null,
      latest: null,
      status: "idle",
      error: null,
      currentVersion: "0.1.7",
      hasUpdate: false,
      showBadge: false,
    });
  });

  it("manual checks bypass the configured frequency", async () => {
    bridge.checkForUpdate.mockResolvedValue(release());
    useUpdateStore.setState({ lastCheckedAt: 1000, frequencyHours: 24 });
    await useUpdateStore.getState().check({ manual: true, now: 2000 });

    expect(bridge.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().status).toBe("updateAvailable");
    expect(useUpdateStore.getState().hasUpdate).toBe(true);
    expect(useUpdateStore.getState().showBadge).toBe(true);
  });

  it("an automatic check is skipped when disabled", async () => {
    useUpdateStore.setState({ enabled: false });
    await useUpdateStore.getState().check({ manual: false });
    expect(bridge.checkForUpdate).not.toHaveBeenCalled();
  });

  it("an automatic check is skipped when not yet due, per the configured frequency", async () => {
    const now = 2_000_000_000_000;
    useUpdateStore.setState({ lastCheckedAt: now - 1000, frequencyHours: 24 });
    await useUpdateStore.getState().check({ manual: false, now });
    expect(bridge.checkForUpdate).not.toHaveBeenCalled();
  });

  it("a same-version response is reported as up to date, not an error or available (same-version rejection)", async () => {
    bridge.checkForUpdate.mockResolvedValue(release({ version: "0.1.7" }));
    await useUpdateStore.getState().check({ manual: true });
    expect(useUpdateStore.getState().status).toBe("upToDate");
    expect(useUpdateStore.getState().hasUpdate).toBe(false);
  });

  it("an older-version response (a downgrade) is reported as up to date, never as available (downgrade rejection)", async () => {
    bridge.checkForUpdate.mockResolvedValue(release({ version: "0.1.0" }));
    await useUpdateStore.getState().check({ manual: true });
    expect(useUpdateStore.getState().status).toBe("upToDate");
    expect(useUpdateStore.getState().hasUpdate).toBe(false);
  });

  it("a malformed version in the response is reported as an error, not silently coerced", async () => {
    bridge.checkForUpdate.mockResolvedValue(release({ version: "not-a-version" }));
    await useUpdateStore.getState().check({ manual: true });
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().error).toMatch(/invalid version/);
  });

  it("enforces HTTPS on the configured endpoint before ever calling through", async () => {
    useUpdateStore.setState({ endpointUrl: "http://example.com/releases.json" });
    await useUpdateStore.getState().check({ manual: true });
    expect(bridge.checkForUpdate).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().error).toMatch(/HTTPS/);
  });

  it("setEndpointUrl rejects a non-HTTPS URL and never writes it", () => {
    const result = useUpdateStore.getState().setEndpointUrl("http://example.com/releases.json");
    expect(result.ok).toBe(false);
    expect(useUpdateStore.getState().endpointUrl).toBe(DEFAULT_RELEASE_METADATA_URL);
  });

  it("setEndpointUrl accepts a valid HTTPS URL", () => {
    const result = useUpdateStore.getState().setEndpointUrl("https://example.com/releases.json");
    expect(result.ok).toBe(true);
    expect(useUpdateStore.getState().endpointUrl).toBe("https://example.com/releases.json");
  });

  it("reports offline immediately (without calling through) when the browser reports no connectivity", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await useUpdateStore.getState().check({ manual: true });
    expect(bridge.checkForUpdate).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("offline");
  });

  it("classifies a timeout/connect-shaped Rust error as offline, not a generic error", async () => {
    bridge.checkForUpdate.mockRejectedValue(new Error("timed out contacting the update server — you may be offline"));
    await useUpdateStore.getState().check({ manual: true });
    expect(useUpdateStore.getState().status).toBe("offline");
  });

  it("classifies an oversized/malformed-response error (from Rust) as a generic error", async () => {
    bridge.checkForUpdate.mockRejectedValue(new Error("release metadata response too large (5000000 bytes, limit 1048576)"));
    await useUpdateStore.getState().check({ manual: true });
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().error).toMatch(/too large/);
  });

  it("keeps and surfaces the platform-support fields from a well-formed response", async () => {
    bridge.checkForUpdate.mockResolvedValue(release({ platformSupported: false, matchedAssetName: null }));
    await useUpdateStore.getState().check({ manual: true });
    expect(useUpdateStore.getState().latest?.platformSupported).toBe(false);
    expect(useUpdateStore.getState().latest?.matchedAssetName).toBeNull();
  });

  it("ignoreVersion suppresses hasUpdate/showBadge for that exact version", async () => {
    bridge.checkForUpdate.mockResolvedValue(release());
    await useUpdateStore.getState().check({ manual: true });
    expect(useUpdateStore.getState().hasUpdate).toBe(true);

    useUpdateStore.getState().ignoreVersion();
    expect(useUpdateStore.getState().ignoredVersion).toBe("v0.1.8");
    expect(useUpdateStore.getState().hasUpdate).toBe(false);
    expect(useUpdateStore.getState().showBadge).toBe(false);
    // Status itself still reports the raw check result — ignoring hides
    // the CTA, it doesn't pretend the check found nothing.
    expect(useUpdateStore.getState().status).toBe("updateAvailable");
  });

  it("clearIgnoredVersion restores hasUpdate for the still-newer version", async () => {
    bridge.checkForUpdate.mockResolvedValue(release());
    await useUpdateStore.getState().check({ manual: true });
    useUpdateStore.getState().ignoreVersion();
    expect(useUpdateStore.getState().hasUpdate).toBe(false);

    useUpdateStore.getState().clearIgnoredVersion();
    expect(useUpdateStore.getState().ignoredVersion).toBeNull();
    expect(useUpdateStore.getState().hasUpdate).toBe(true);
  });

  it("a newer version found later is not suppressed by an older ignored version", async () => {
    useUpdateStore.getState().ignoreVersion("0.1.8");
    bridge.checkForUpdate.mockResolvedValue(release({ version: "0.2.0" }));
    await useUpdateStore.getState().check({ manual: true });
    expect(useUpdateStore.getState().hasUpdate).toBe(true);
  });

  it("notifies once for a newly detected update version", async () => {
    bridge.checkForUpdate.mockResolvedValue(release());
    await useUpdateStore.getState().check({ manual: true });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith("v0.1.8", release().url);
  });

  it("never notifies twice for the same version across repeated checks (duplicate-notification prevention)", async () => {
    bridge.checkForUpdate.mockResolvedValue(release());
    await useUpdateStore.getState().check({ manual: true });
    await useUpdateStore.getState().check({ manual: true });
    await useUpdateStore.getState().check({ manual: true });
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("notifies again once a genuinely newer version appears after the first", async () => {
    bridge.checkForUpdate.mockResolvedValue(release({ version: "0.1.8" }));
    await useUpdateStore.getState().check({ manual: true });
    bridge.checkForUpdate.mockResolvedValue(release({ version: "0.2.0" }));
    await useUpdateStore.getState().check({ manual: true });
    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(notifyMock).toHaveBeenLastCalledWith("0.2.0", release().url);
  });

  it("never notifies for an ignored version", async () => {
    useUpdateStore.getState().ignoreVersion("0.1.8");
    bridge.checkForUpdate.mockResolvedValue(release());
    await useUpdateStore.getState().check({ manual: true });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("never notifies when the response is not actually newer", async () => {
    bridge.checkForUpdate.mockResolvedValue(release({ version: "0.1.7" }));
    await useUpdateStore.getState().check({ manual: true });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("setFrequencyHours clamps to a minimum of 1", () => {
    useUpdateStore.getState().setFrequencyHours(0);
    expect(useUpdateStore.getState().frequencyHours).toBe(1);
    useUpdateStore.getState().setFrequencyHours(72);
    expect(useUpdateStore.getState().frequencyHours).toBe(72);
  });
});
