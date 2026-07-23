/**
 * Attachment-reference coverage (spec §10's "attachment tests" category):
 * a safe reference is accepted with its checksum retained, and finalized
 * (disabled) attachments cannot be added to or removed. The unsafe-path and
 * unsupported-MIME-type rejections themselves are enforced in Rust — see
 * `src-tauri/src/attachments.rs`'s `tests` module — this only mocks that
 * Tauri boundary and checks the React side reacts correctly to it.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentReference } from "@ai4s/shared";
import { AttachmentField } from "./AttachmentField";

const bridge = {
  pickFile: vi.fn(),
  copyAttachmentIntoProject: vi.fn(),
  openAttachment: vi.fn(),
};

vi.mock("@/lib/tauri", () => ({
  pickFile: (...a: [string[]]) => bridge.pickFile(...a),
}));

vi.mock("@/lib/formulations", () => ({
  copyAttachmentIntoProject: (...a: [string, string]) => bridge.copyAttachmentIntoProject(...a),
  openAttachment: (...a: [string, string]) => bridge.openAttachment(...a),
}));

const t = (key: string) => key;

beforeEach(() => {
  vi.clearAllMocks();
  bridge.openAttachment.mockResolvedValue(undefined);
});

describe("AttachmentField — adding", () => {
  it("copies a picked file into the project and reports it with its checksum retained", async () => {
    bridge.pickFile.mockResolvedValue("C:/Users/alice/Desktop/panel.jpg");
    bridge.copyAttachmentIntoProject.mockResolvedValue({
      location: "attachments/att-1.jpg",
      originalFileName: "panel.jpg",
      fileCategory: "image",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      checksumSha256: "deadbeef".repeat(8),
    });
    const onChange = vi.fn();
    render(<AttachmentField formulationId="proj-1" attachments={[]} onChange={onChange} t={t} />);

    await userEvent.setup().click(screen.getByText("attachments.add"));

    expect(bridge.copyAttachmentIntoProject).toHaveBeenCalledWith("proj-1", "C:/Users/alice/Desktop/panel.jpg");
    expect(onChange).toHaveBeenCalledTimes(1);
    const [added]: AttachmentReference[] = onChange.mock.calls[0][0];
    expect(added.location).toBe("attachments/att-1.jpg");
    expect(added.checksumSha256).toBe("deadbeef".repeat(8));
    expect(added.fileCategory).toBe("image");
  });

  it("does nothing when the picker is cancelled", async () => {
    bridge.pickFile.mockResolvedValue(null);
    const onChange = vi.fn();
    render(<AttachmentField formulationId="proj-1" attachments={[]} onChange={onChange} t={t} />);

    await userEvent.setup().click(screen.getByText("attachments.add"));

    expect(bridge.copyAttachmentIntoProject).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("surfaces a rejection from the safe-copy command (e.g. an unsupported extension) as an error, without calling onChange", async () => {
    bridge.pickFile.mockResolvedValue("C:/Users/alice/Desktop/script.exe");
    bridge.copyAttachmentIntoProject.mockRejectedValue(new Error('".exe" is not an allow-listed attachment type'));
    const onChange = vi.fn();
    render(<AttachmentField formulationId="proj-1" attachments={[]} onChange={onChange} t={t} />);

    await userEvent.setup().click(screen.getByText("attachments.add"));

    expect(onChange).not.toHaveBeenCalled();
    expect(await screen.findByText(/not an allow-listed attachment type/)).toBeInTheDocument();
  });
});

const EXISTING: AttachmentReference = {
  id: "att-1",
  kind: "photo",
  title: "panel.jpg",
  location: "attachments/att-1.jpg",
  originalFileName: "panel.jpg",
  fileCategory: "image",
  checksumSha256: "abc123",
};

describe("AttachmentField — existing attachments", () => {
  it("opens an attachment via the safe resolver when its title is clicked", async () => {
    render(<AttachmentField formulationId="proj-1" attachments={[EXISTING]} onChange={vi.fn()} t={t} />);
    await userEvent.setup().click(screen.getByText("panel.jpg"));
    expect(bridge.openAttachment).toHaveBeenCalledWith("proj-1", "attachments/att-1.jpg");
  });

  it("removes an attachment when not disabled", async () => {
    const onChange = vi.fn();
    render(<AttachmentField formulationId="proj-1" attachments={[EXISTING]} onChange={onChange} t={t} />);
    await userEvent.setup().click(screen.getByLabelText("attachments.remove"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("hides add and remove controls once disabled (finalized record)", () => {
    render(<AttachmentField formulationId="proj-1" attachments={[EXISTING]} onChange={vi.fn()} disabled t={t} />);
    expect(screen.queryByText("attachments.add")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("attachments.remove")).not.toBeInTheDocument();
    expect(screen.getByText("panel.jpg")).toBeInTheDocument();
  });
});
