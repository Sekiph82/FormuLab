import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = { saveBinaryFile: vi.fn(), saveTextFile: vi.fn() };
vi.mock("./tauri", () => ({
  saveBinaryFile: (...a: [string, Uint8Array]) => tauriMocks.saveBinaryFile(...a),
  saveTextFile: (...a: [string, string]) => tauriMocks.saveTextFile(...a),
}));

const toastMocks = { success: vi.fn(), error: vi.fn() };
vi.mock("./toast", () => ({
  toast: { success: (m: string) => toastMocks.success(m), error: (m: string) => toastMocks.error(m) },
}));

import { saveBinaryWithFeedback } from "./download";

describe("saveBinaryWithFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  it("shows a success toast with the saved path on the desktop", async () => {
    tauriMocks.saveBinaryFile.mockResolvedValue({ kind: "saved", path: "C:\\exports\\dossier.pdf" });
    await saveBinaryWithFeedback("dossier.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    expect(toastMocks.success).toHaveBeenCalledWith(expect.stringContaining("C:\\exports\\dossier.pdf"));
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("shows no feedback when the user cancels the dialog", async () => {
    tauriMocks.saveBinaryFile.mockResolvedValue({ kind: "canceled" });
    await saveBinaryWithFeedback("dossier.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("falls back to a browser download outside the desktop app", async () => {
    tauriMocks.saveBinaryFile.mockResolvedValue({ kind: "not-desktop" });
    await saveBinaryWithFeedback("dossier.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(toastMocks.success).toHaveBeenCalledWith(expect.stringContaining("Downloaded"));
  });

  it("shows an error toast and re-throws when the save fails, so a caller can record the outcome", async () => {
    tauriMocks.saveBinaryFile.mockRejectedValue(new Error("disk full"));
    // NOTE: `.rejects.toThrow("disk full")` (async + string-argument form) is
    // broken in this vitest/chai combo — it throws "Cannot read properties
    // of undefined (reading 'indexOf')" even for a trivial, mock-free repro
    // unrelated to this file. Every other form works
    // (`.rejects.toThrow()`, `.rejects.toThrow(Error)`, manual try/catch), so
    // this asserts the exact same thing — rejection with the real error,
    // carrying the real message — via a proven-working combination instead.
    await expect(saveBinaryWithFeedback("dossier.pdf", new Uint8Array([1, 2, 3]), "application/pdf")).rejects.toThrow(Error);
    let caught: unknown;
    try {
      await saveBinaryWithFeedback("dossier.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("disk full");
    expect(toastMocks.error).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("resolves with the underlying SaveResult on success", async () => {
    tauriMocks.saveBinaryFile.mockResolvedValue({ kind: "saved", path: "C:\\exports\\dossier.pdf" });
    const result = await saveBinaryWithFeedback("dossier.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    expect(result).toEqual({ kind: "saved", path: "C:\\exports\\dossier.pdf" });
  });

  it("resolves with the underlying SaveResult on cancellation", async () => {
    tauriMocks.saveBinaryFile.mockResolvedValue({ kind: "canceled" });
    const result = await saveBinaryWithFeedback("dossier.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    expect(result).toEqual({ kind: "canceled" });
  });

  it("passes the exact byte array through to the save call, never a converted string", async () => {
    tauriMocks.saveBinaryFile.mockResolvedValue({ kind: "canceled" });
    const bytes = new Uint8Array([0x00, 0xff, 0x50, 0x44, 0x46]);
    await saveBinaryWithFeedback("dossier.pdf", bytes, "application/pdf");
    expect(tauriMocks.saveBinaryFile).toHaveBeenCalledWith("dossier.pdf", bytes);
  });
});
