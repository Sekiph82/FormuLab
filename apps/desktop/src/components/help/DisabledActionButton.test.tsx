/**
 * Coverage for the reusable disabled-action explanation pattern (Phase 10
 * Session 3).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHelpStore } from "@/lib/help/store";
import { DisabledActionButton } from "./DisabledActionButton";
import type { DisabledReason } from "@/lib/help/disabledReason";

beforeEach(() => {
  useHelpStore.setState({ panelOpen: false, centerOpen: false, target: null });
});

const REASON: DisabledReason = {
  code: "test_reason",
  messageKey: "ui.close", // any real, resolvable key — exact text isn't the point here
  requiredRole: "chemist, quality or administrator",
  prerequisite: "a saved formula version",
  relatedTopicId: "approval",
  resolvable: true,
};

describe("DisabledActionButton — enabled behavior unchanged", () => {
  it("calls onClick and has no explanation block when reason is null", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DisabledActionButton reason={null} onClick={onClick}>
        Approve
      </DisabledActionButton>,
    );
    const button = screen.getByRole("button", { name: "Approve" });
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("DisabledActionButton — disabled explanation", () => {
  it("is a real disabled control and never calls onClick on click", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DisabledActionButton reason={REASON} onClick={onClick}>
        Approve
      </DisabledActionButton>,
    );
    const button = screen.getByRole("button", { name: "Approve" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("never calls onClick via keyboard activation (Enter/Space) either", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DisabledActionButton reason={REASON} onClick={onClick}>
        Approve
      </DisabledActionButton>,
    );
    screen.getByRole("button", { name: "Approve" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows the resolved reason message", () => {
    render(
      <DisabledActionButton reason={REASON} onClick={() => {}}>
        Approve
      </DisabledActionButton>,
    );
    // messageKey "ui.close" resolves to "Close" in the help namespace.
    expect(screen.getByRole("note")).toHaveTextContent("Close");
  });

  it("shows the required role", () => {
    render(
      <DisabledActionButton reason={REASON} onClick={() => {}}>
        Approve
      </DisabledActionButton>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("chemist, quality or administrator");
  });

  it("shows the prerequisite", () => {
    render(
      <DisabledActionButton reason={REASON} onClick={() => {}}>
        Approve
      </DisabledActionButton>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("a saved formula version");
  });

  it("distinguishes resolvable from unresolvable", () => {
    const { rerender } = render(
      <DisabledActionButton reason={{ ...REASON, resolvable: true }} onClick={() => {}}>
        Approve
      </DisabledActionButton>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("You can resolve this yourself.");

    rerender(
      <DisabledActionButton reason={{ ...REASON, resolvable: false }} onClick={() => {}}>
        Approve
      </DisabledActionButton>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("Someone with the required role must resolve this.");
  });

  it("the related help topic opens when its link is clicked", async () => {
    const user = userEvent.setup();
    render(
      <DisabledActionButton reason={REASON} onClick={() => {}}>
        Approve
      </DisabledActionButton>,
    );
    await user.click(screen.getByRole("button", { name: "Learn more" }));
    expect(useHelpStore.getState().panelOpen).toBe(true);
    expect(useHelpStore.getState().target).toEqual({ kind: "topic", id: "approval" });
  });

  it("the disabled button remains describedby the explanation for accessibility", () => {
    render(
      <DisabledActionButton reason={REASON} onClick={() => {}}>
        Approve
      </DisabledActionButton>,
    );
    const button = screen.getByRole("button", { name: "Approve" });
    const note = screen.getByRole("note");
    expect(button).toHaveAttribute("aria-describedby", note.id);
  });
});
