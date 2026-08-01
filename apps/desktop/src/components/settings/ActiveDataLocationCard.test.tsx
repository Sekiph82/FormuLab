import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataRootStatus } from "@/lib/tauri";
import { ActiveDataLocationCard } from "./ActiveDataLocationCard";

const bridge = {
  isTauri: true,
  activeDataRootStatus: vi.fn<() => Promise<DataRootStatus | null>>(),
  openActiveDataRoot: vi.fn<() => Promise<void>>(),
};

vi.mock("@/lib/tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
  activeDataRootStatus: () => bridge.activeDataRootStatus(),
  openActiveDataRoot: () => bridge.openActiveDataRoot(),
}));

function status(overrides: Partial<DataRootStatus> = {}): DataRootStatus {
  return {
    path: "C:\\Users\\test\\Documents\\FormuLab",
    source: "default",
    writable: true,
    warnings: [],
    conflictingRoots: [],
    ...overrides,
  };
}

beforeEach(() => {
  bridge.isTauri = true;
  bridge.activeDataRootStatus.mockReset();
  bridge.openActiveDataRoot.mockReset();
  bridge.activeDataRootStatus.mockResolvedValue(status());
});

describe("ActiveDataLocationCard", () => {
  it("shows the desktop-only fallback when not running in Tauri", async () => {
    bridge.isTauri = false;
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText(/available in the desktop app/i)).toBeInTheDocument();
  });

  it("shows the real resolved path and default source label", async () => {
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText("C:\\Users\\test\\Documents\\FormuLab")).toBeInTheDocument();
    expect(screen.getByText(/Default \(~\/Documents\/FormuLab\)/)).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("shows the formulab-root.txt override source label", async () => {
    bridge.activeDataRootStatus.mockResolvedValue(status({ source: "formulabRootOverride", path: "D:\\CustomRoot" }));
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText(/Manual override \(formulab-root\.txt\)/)).toBeInTheDocument();
  });

  it("shows the active-workspace override source label", async () => {
    bridge.activeDataRootStatus.mockResolvedValue(status({ source: "activeWorkspaceOverride" }));
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText(/Active workspace override/)).toBeInTheDocument();
  });

  it("shows the base-workspace override source label", async () => {
    bridge.activeDataRootStatus.mockResolvedValue(status({ source: "baseWorkspaceOverride" }));
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText(/Workspace folder \(Settings\)/)).toBeInTheDocument();
  });

  it("shows a not-writable status", async () => {
    bridge.activeDataRootStatus.mockResolvedValue(status({ writable: false }));
    render(<ActiveDataLocationCard />);
    await screen.findByText("C:\\Users\\test\\Documents\\FormuLab");
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("shows every warning returned, including a conflict warning", async () => {
    bridge.activeDataRootStatus.mockResolvedValue(
      status({
        warnings: [
          "active-workspace.txt is set but invalid (the pointer file is empty) — ignored, falling back",
          "D:\\OtherRoot (baseWorkspaceOverride) also contains real project data but is not the active root — nothing was merged",
        ],
        conflictingRoots: [{ source: "baseWorkspaceOverride", path: "D:\\OtherRoot" }],
      }),
    );
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText(/active-workspace\.txt is set but invalid/)).toBeInTheDocument();
    expect(screen.getByText(/also contains real project data/)).toBeInTheDocument();
  });

  it("shows no warning panel when there is nothing to warn about", async () => {
    render(<ActiveDataLocationCard />);
    await screen.findByText("C:\\Users\\test\\Documents\\FormuLab");
    expect(screen.queryByText(/ignored, falling back/)).not.toBeInTheDocument();
  });

  it("opens the resolved folder without invoking any restore/write command", async () => {
    render(<ActiveDataLocationCard />);
    await screen.findByText("C:\\Users\\test\\Documents\\FormuLab");
    await userEvent.click(screen.getByRole("button", { name: /Open Folder/ }));
    await waitFor(() => expect(bridge.openActiveDataRoot).toHaveBeenCalledTimes(1));
  });

  it("refreshes on demand and reflects a changed status", async () => {
    render(<ActiveDataLocationCard />);
    await screen.findByText(/Default/);
    bridge.activeDataRootStatus.mockResolvedValue(status({ source: "baseWorkspaceOverride", path: "E:\\NewBase" }));
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("E:\\NewBase")).toBeInTheDocument();
    expect(bridge.activeDataRootStatus).toHaveBeenCalledTimes(2);
  });

  it("shows an error state when the status check itself fails", async () => {
    bridge.activeDataRootStatus.mockRejectedValue(new Error("could not resolve a documents directory"));
    render(<ActiveDataLocationCard />);
    expect(await screen.findByText(/could not resolve a documents directory/)).toBeInTheDocument();
  });
});
