import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyPermissionRequest, notifyUpdateAvailable } from "./systemNotification";

const notificationPlugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => notificationPlugin);

describe("notifyPermissionRequest", () => {
  afterEach(() => {
    vi.clearAllMocks();
    notificationPlugin.isPermissionGranted.mockResolvedValue(true);
    notificationPlugin.requestPermission.mockResolvedValue("granted");
  });

  it("sends a native Tauri notification when permission is already granted", async () => {
    await expect(
      notifyPermissionRequest({ action: "bash", resources: ["npm install"] }),
    ).resolves.toBe(true);

    expect(notificationPlugin.requestPermission).not.toHaveBeenCalled();
    expect(notificationPlugin.sendNotification).toHaveBeenCalledWith({
      title: "FormuLab needs your approval",
      body: "bash\nnpm install",
    });
  });

  it("requests native notification permission before sending", async () => {
    notificationPlugin.isPermissionGranted.mockResolvedValue(false);
    notificationPlugin.requestPermission.mockResolvedValue("granted");

    await expect(
      notifyPermissionRequest({ action: "webfetch", resources: ["https://example.com"] }),
    ).resolves.toBe(true);

    expect(notificationPlugin.requestPermission).toHaveBeenCalledTimes(1);
    expect(notificationPlugin.sendNotification).toHaveBeenCalledWith({
      title: "FormuLab needs your approval",
      body: "webfetch\nhttps://example.com",
    });
  });

  it("does not notify when native notification permission is denied", async () => {
    notificationPlugin.isPermissionGranted.mockResolvedValue(false);
    notificationPlugin.requestPermission.mockResolvedValue("denied");

    await expect(
      notifyPermissionRequest({ action: "bash", resources: ["rm -rf build/"] }),
    ).resolves.toBe(false);

    expect(notificationPlugin.sendNotification).not.toHaveBeenCalled();
  });
});

describe("notifyUpdateAvailable", () => {
  afterEach(() => {
    vi.clearAllMocks();
    notificationPlugin.isPermissionGranted.mockResolvedValue(true);
  });

  it("sends a native notification with the version and release URL when permission is already granted", async () => {
    await expect(
      notifyUpdateAvailable("v0.5.0", "https://github.com/Sekiph82/FormuLab/releases/tag/v0.5.0"),
    ).resolves.toBe(true);

    expect(notificationPlugin.requestPermission).not.toHaveBeenCalled();
    expect(notificationPlugin.sendNotification).toHaveBeenCalledWith({
      title: "FormuLab update available",
      body: "Version v0.5.0 is available.\nhttps://github.com/Sekiph82/FormuLab/releases/tag/v0.5.0",
    });
  });

  it("never requests permission proactively — does nothing when it was never granted", async () => {
    notificationPlugin.isPermissionGranted.mockResolvedValue(false);

    await expect(notifyUpdateAvailable("v0.5.0", "https://example.com")).resolves.toBe(false);

    expect(notificationPlugin.requestPermission).not.toHaveBeenCalled();
    expect(notificationPlugin.sendNotification).not.toHaveBeenCalled();
  });
});
