/**
 * Dedicated coverage for the result-history browser (spec §2.7): the full
 * revision chain, retest lineage, revision comparison, and attachment
 * replacement history — the parts `TrialsPanel.test.tsx`'s/
 * `StabilityPanel.test.tsx`'s thin "View history opens" checks don't
 * exercise. Only `@/lib/formulations`'s `openAttachment` Tauri boundary is
 * mocked; every chain/comparison/warning shown here is the real
 * `resultHistory.ts` engine.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoricalResult } from "@ai4s/shared";
import i18n from "@/i18n";
import { ResultHistoryBrowser } from "./ResultHistoryBrowser";

const bridge = { openAttachment: vi.fn() };
vi.mock("@/lib/formulations", () => ({
  openAttachment: (...a: [string, string]) => bridge.openAttachment(...a),
}));

const t = i18n.getFixedT("en", "session") as (key: string, opts?: Record<string, unknown>) => string;

const NOW = "2026-01-01T00:00:00.000Z";

function result(over: Partial<HistoricalResult> = {}): HistoricalResult {
  return {
    id: "r1",
    attachments: [],
    performedBy: "alice",
    performedAt: NOW,
    passFail: "pass",
    replicates: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.openAttachment.mockResolvedValue(undefined);
});

describe("ResultHistoryBrowser — revision chain", () => {
  it("renders a single unrevised result as the current revision", () => {
    const r = result();
    render(<ResultHistoryBrowser formulationId="proj-1" pool={[r]} startResultId="r1" onClose={vi.fn()} t={t} />);
    const dialog = screen.getByRole("dialog");
    const revisionRow = within(dialog).getByText("Revision 1").closest("div")!;
    expect(within(revisionRow).getByText("Current")).toBeInTheDocument();
  });

  it("renders a multi-revision chain oldest-first, marking only the last as current", () => {
    const r1 = result({ id: "r1" });
    const r2 = result({ id: "r2", revisesResultId: "r1" });
    render(<ResultHistoryBrowser formulationId="proj-1" pool={[r2, r1]} startResultId="r1" onClose={vi.fn()} t={t} />);
    const dialog = screen.getByRole("dialog");
    const rev1Row = within(dialog).getByText("Revision 1").closest("div")!;
    const rev2Row = within(dialog).getByText("Revision 2").closest("div")!;
    expect(within(rev1Row).queryByText("Current")).not.toBeInTheDocument();
    expect(within(rev2Row).getByText("Current")).toBeInTheDocument();
  });

  it("surfaces a missing-parent warning instead of crashing", () => {
    const r2 = result({ id: "r2", revisesResultId: "ghost" });
    render(<ResultHistoryBrowser formulationId="proj-1" pool={[r2]} startResultId="r2" onClose={vi.fn()} t={t} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not found/);
    expect(screen.getByText("Revision 1")).toBeInTheDocument();
  });

  it("shows a human override's reason and reviewer on the overridden revision", () => {
    const r = result({
      override: { reviewerId: "qa-1", reason: "Outlier excluded per SOP.", at: NOW, originalEvaluation: "fail", overriddenEvaluation: "pass" },
    });
    render(<ResultHistoryBrowser formulationId="proj-1" pool={[r]} startResultId="r1" onClose={vi.fn()} t={t} />);
    expect(screen.getByText("Overridden")).toBeInTheDocument();
    expect(screen.getByText(/Outlier excluded per SOP\./)).toBeInTheDocument();
  });
});

describe("ResultHistoryBrowser — retest lineage", () => {
  it("lists a retest under the Retests filter, separate from the revision chain", async () => {
    const original = result({ id: "r1" });
    const retest = result({ id: "r2", retestOf: "r1" });
    const user = userEvent.setup();
    render(<ResultHistoryBrowser formulationId="proj-1" pool={[original, retest]} startResultId="r1" onClose={vi.fn()} t={t} />);

    await user.click(screen.getByRole("button", { name: "Retests" }));
    expect(screen.getByText(/retest of r1/)).toBeInTheDocument();
  });
});

describe("ResultHistoryBrowser — revision comparison", () => {
  it("highlights a changed mean between two selected revisions without inferring why", async () => {
    const r1 = result({ id: "r1", stats: { count: 2, mean: "7.0" } });
    const r2 = result({ id: "r2", revisesResultId: "r1", stats: { count: 2, mean: "7.5" } });
    const user = userEvent.setup();
    render(<ResultHistoryBrowser formulationId="proj-1" pool={[r1, r2]} startResultId="r1" onClose={vi.fn()} t={t} />);

    const [selectA, selectB] = screen.getAllByRole("combobox").slice(-2);
    await user.selectOptions(selectA, "r1");
    await user.selectOptions(selectB, "r2");

    expect(screen.getByText("7.0")).toBeInTheDocument();
    expect(screen.getByText("7.5")).toBeInTheDocument();
  });
});

describe("ResultHistoryBrowser — attachment history", () => {
  it("shows a superseded-attachment replacement chain and opens a historical attachment", async () => {
    const original = { id: "a1", kind: "document" as const, title: "cert-v1.pdf", location: "attachments/a1.pdf" };
    const replacement = { id: "a2", kind: "document" as const, title: "cert-v2.pdf", location: "attachments/a2.pdf", replacesAttachmentId: "a1" };
    const r = result({ attachments: [original, replacement] });
    const user = userEvent.setup();
    render(<ResultHistoryBrowser formulationId="proj-1" pool={[r]} startResultId="r1" onClose={vi.fn()} t={t} />);

    expect(screen.getByText("cert-v1.pdf → cert-v2.pdf")).toBeInTheDocument();
    expect(screen.getByText("Superseded")).toBeInTheDocument();

    await user.click(screen.getByText("cert-v1.pdf"));
    expect(bridge.openAttachment).toHaveBeenCalledWith("proj-1", "attachments/a1.pdf");
  });
});

describe("ResultHistoryBrowser — close", () => {
  it("calls onClose from the dialog's close control", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ResultHistoryBrowser formulationId="proj-1" pool={[result()]} startResultId="r1" onClose={onClose} t={t} />);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
