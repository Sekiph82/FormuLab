import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RELEASE_METADATA_URL, useUpdateStore } from "@/lib/update";
import { UpdateCheckerCard } from "./UpdateCheckerCard";

const bridge = {
  isTauri: true,
  openExternal: vi.fn(async (_url: string) => {}),
};

vi.mock("@/lib/tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
  openExternal: (url: string) => bridge.openExternal(url),
}));

function resetStore() {
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
    currentVersion: "0.4.0",
    hasUpdate: false,
    showBadge: false,
  });
}

beforeEach(() => {
  bridge.isTauri = true;
  bridge.openExternal.mockReset();
  resetStore();
});

describe("UpdateCheckerCard", () => {
  it("shows the desktop-only fallback when not running in Tauri", () => {
    bridge.isTauri = false;
    render(<UpdateCheckerCard />);
    expect(screen.getByText(/available in the desktop app/i)).toBeInTheDocument();
  });

  it("shows the current version and an idle status with no prior check", () => {
    render(<UpdateCheckerCard />);
    expect(screen.getByText("0.4.0")).toBeInTheDocument();
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(screen.getByText("Never checked")).toBeInTheDocument();
  });

  it("Check for Updates calls the store's manual check", async () => {
    const check = vi.fn(async () => {});
    useUpdateStore.setState({ check });
    render(<UpdateCheckerCard />);
    await userEvent.click(screen.getByRole("button", { name: /Check for Updates/ }));
    expect(check).toHaveBeenCalledWith({ manual: true });
  });

  it("shows a checking state with the button disabled", () => {
    useUpdateStore.setState({ status: "checking" });
    render(<UpdateCheckerCard />);
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check for Updates/ })).toBeDisabled();
  });

  it("shows an up-to-date state", () => {
    useUpdateStore.setState({ status: "upToDate", lastCheckedAt: Date.now() });
    render(<UpdateCheckerCard />);
    expect(screen.getByText("Up to date")).toBeInTheDocument();
  });

  it("shows a failed state with the error message", () => {
    useUpdateStore.setState({ status: "error", error: "could not fetch release metadata: boom" });
    render(<UpdateCheckerCard />);
    expect(screen.getByText("Check failed")).toBeInTheDocument();
    expect(screen.getByText(/could not fetch release metadata: boom/)).toBeInTheDocument();
  });

  it("shows an offline state with the offline hint", () => {
    useUpdateStore.setState({ status: "offline" });
    render(<UpdateCheckerCard />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the update server/)).toBeInTheDocument();
  });

  it("shows the available-version summary, notes, and platform note when an update is available", () => {
    useUpdateStore.setState({
      status: "updateAvailable",
      hasUpdate: true,
      latest: {
        version: "v0.5.0",
        url: "https://github.com/Sekiph82/FormuLab/releases/tag/v0.5.0",
        name: "FormuLab v0.5.0",
        publishedAt: "2026-08-06T10:00:00Z",
        notes: "- Fixed a bug\n- Added a feature",
        platformSupported: true,
        matchedAssetName: "FormuLab_0.5.0_x64-setup.exe",
      },
    });
    render(<UpdateCheckerCard />);
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("FormuLab v0.5.0")).toBeInTheDocument();
    expect(screen.getByText(/A build for your platform was found/)).toBeInTheDocument();
    expect(screen.getByText(/Fixed a bug/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View Release/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ignore This Version/ })).toBeInTheDocument();
  });

  it("shows a platform-missing note when no matching asset was found", () => {
    useUpdateStore.setState({
      status: "updateAvailable",
      hasUpdate: true,
      latest: {
        version: "v0.5.0",
        url: "https://example.com",
        name: null,
        publishedAt: null,
        notes: null,
        platformSupported: false,
        matchedAssetName: null,
      },
    });
    render(<UpdateCheckerCard />);
    expect(screen.getByText(/No build for your platform was found/)).toBeInTheDocument();
  });

  it("View Release / Download opens the release URL externally, never auto-downloading anything", async () => {
    useUpdateStore.setState({
      status: "updateAvailable",
      hasUpdate: true,
      latest: {
        version: "v0.5.0",
        url: "https://github.com/Sekiph82/FormuLab/releases/tag/v0.5.0",
        name: null,
        publishedAt: null,
        notes: null,
        platformSupported: true,
        matchedAssetName: "x",
      },
    });
    render(<UpdateCheckerCard />);
    await userEvent.click(screen.getByRole("button", { name: /View Release/ }));
    await waitFor(() => expect(bridge.openExternal).toHaveBeenCalledWith("https://github.com/Sekiph82/FormuLab/releases/tag/v0.5.0"));
  });

  it("Ignore This Version calls the store action for the latest version", async () => {
    const ignoreVersion = vi.fn();
    useUpdateStore.setState({
      ignoreVersion,
      status: "updateAvailable",
      hasUpdate: true,
      latest: {
        version: "v0.5.0",
        url: "https://example.com",
        name: null,
        publishedAt: null,
        notes: null,
        platformSupported: true,
        matchedAssetName: "x",
      },
    });
    render(<UpdateCheckerCard />);
    await userEvent.click(screen.getByRole("button", { name: /Ignore This Version/ }));
    expect(ignoreVersion).toHaveBeenCalledWith();
  });

  it("shows the ignored-version note and Clear Ignored Version when the available version is ignored", () => {
    useUpdateStore.setState({
      status: "updateAvailable",
      hasUpdate: false, // suppressed by the store's own derive() once ignored
      ignoredVersion: "0.5.0",
      latest: {
        version: "v0.5.0",
        url: "https://example.com",
        name: null,
        publishedAt: null,
        notes: null,
        platformSupported: true,
        matchedAssetName: "x",
      },
    });
    render(<UpdateCheckerCard />);
    expect(screen.getByText(/You're ignoring version/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View Release/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Ignored Version" })).toBeInTheDocument();
  });

  it("Clear Ignored Version calls the store action", async () => {
    const clearIgnoredVersion = vi.fn();
    useUpdateStore.setState({ ignoredVersion: "0.5.0", clearIgnoredVersion });
    render(<UpdateCheckerCard />);
    await userEvent.click(screen.getByRole("button", { name: "Clear Ignored Version" }));
    expect(clearIgnoredVersion).toHaveBeenCalledTimes(1);
  });

  it("toggling automatic check calls setEnabled", async () => {
    const setEnabled = vi.fn();
    useUpdateStore.setState({ setEnabled, enabled: true });
    render(<UpdateCheckerCard />);
    await userEvent.click(screen.getByRole("switch", { name: "Check automatically on launch" }));
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it("the frequency select is enabled when automatic check is on, and calls setFrequencyHours on change", async () => {
    const setFrequencyHours = vi.fn();
    useUpdateStore.setState({ setFrequencyHours, enabled: true, frequencyHours: 24 });
    const view = render(<UpdateCheckerCard />);
    const select = screen.getByRole("combobox", { name: "Check frequency" });
    expect(select).not.toBeDisabled();
    await userEvent.selectOptions(select, "72");
    expect(setFrequencyHours).toHaveBeenCalledWith(72);
    view.unmount();
  });

  it("the frequency select is disabled when automatic check is off", () => {
    useUpdateStore.setState({ enabled: false });
    render(<UpdateCheckerCard />);
    expect(screen.getByRole("combobox", { name: "Check frequency" })).toBeDisabled();
  });

  it("toggling the Settings badge calls setBadgeEnabled", async () => {
    const setBadgeEnabled = vi.fn();
    useUpdateStore.setState({ setBadgeEnabled, badgeEnabled: true });
    render(<UpdateCheckerCard />);
    await userEvent.click(screen.getByRole("switch", { name: "Show Settings badge" }));
    expect(setBadgeEnabled).toHaveBeenCalledWith(false);
  });

  it("always states plainly that FormuLab checks only and does not install updates", () => {
    render(<UpdateCheckerCard />);
    expect(screen.getByText(/checks for updates only/i)).toBeInTheDocument();
    expect(screen.getByText(/does not download or install them/i)).toBeInTheDocument();
  });

  it("release notes are rendered as plain text, never as HTML", () => {
    useUpdateStore.setState({
      status: "updateAvailable",
      hasUpdate: true,
      latest: {
        version: "v0.5.0",
        url: "https://example.com",
        name: null,
        publishedAt: null,
        notes: "<img src=x onerror=alert(1)> plain & <b>not bold</b>",
        platformSupported: true,
        matchedAssetName: "x",
      },
    });
    const { container } = render(<UpdateCheckerCard />);
    // The literal tag text must appear as TEXT, and no actual <img>/<b>
    // element must have been created from it.
    expect(screen.getByText(/plain & <b>not bold<\/b>/)).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("b")).not.toBeInTheDocument();
  });
});
