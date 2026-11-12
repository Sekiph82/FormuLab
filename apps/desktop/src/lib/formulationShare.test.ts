import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyText: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./clipboard", () => ({ copyText: mocks.copyText }));
vi.mock("./toast", () => ({ toast: { success: mocks.success, error: mocks.error } }));

import { shareFormulationResult } from "./formulationShare";

describe("shareFormulationResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    mocks.copyText.mockResolvedValue(undefined);
  });

  it("copies the current result link when the platform share sheet is unavailable", async () => {
    await shareFormulationResult("session-123");
    expect(mocks.copyText).toHaveBeenCalledWith(window.location.href);
    expect(mocks.success).toHaveBeenCalledWith("Session link copied to clipboard.");
  });

  it("uses the platform share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    await shareFormulationResult("session-123");
    expect(share).toHaveBeenCalledWith({
      title: "FormuLab formulation result",
      text: "Formulation session session-123",
      url: window.location.href,
    });
    expect(mocks.copyText).not.toHaveBeenCalled();
  });

  it("falls back to copying the link when the platform share sheet fails", async () => {
    Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn().mockRejectedValue(new Error("unsupported")) });
    await shareFormulationResult("session-123");
    expect(mocks.copyText).toHaveBeenCalledWith(window.location.href);
    expect(mocks.success).toHaveBeenCalledWith("Session link copied to clipboard.");
  });

  it("reports clipboard failures to the user", async () => {
    mocks.copyText.mockRejectedValue(new Error("clipboard denied"));
    await shareFormulationResult("session-123");
    expect(mocks.error).toHaveBeenCalledWith("Could not share this session: clipboard denied");
  });
});
