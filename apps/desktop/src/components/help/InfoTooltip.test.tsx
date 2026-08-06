/**
 * Coverage for the reusable contextual-help disclosure (Phase 10 Session 3).
 *
 * Opens exclusively via hover or keyboard focus in these tests, not click:
 * `Popover.Trigger`'s own default behavior toggles open state on click, and
 * `userEvent.click` always synthesizes a hover-then-click sequence — so
 * clicking the trigger in a test opens it via the synthesized hover, then
 * immediately closes it again via Radix's own toggle, regardless of
 * anything this component does. That is real, expected Radix behavior for
 * a controlled Popover trigger, not something this suite needs to pin down
 * beyond it not throwing.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useHelpStore } from "@/lib/help/store";
import { InfoTooltip } from "./InfoTooltip";

beforeEach(() => {
  useHelpStore.setState({ panelOpen: false, centerOpen: false, target: null });
});

describe("InfoTooltip — opening", () => {
  it("opens on mouse hover", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip title="Total percent" body="Should read 100%." />);
    expect(screen.queryByText("Should read 100%.")).not.toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "Total percent" }));
    expect(await screen.findByText("Should read 100%.")).toBeInTheDocument();
  });

  it("opens on keyboard focus (Tab)", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip title="Total percent" body="Should read 100%." />);
    await user.tab();
    expect(await screen.findByText("Should read 100%.")).toBeInTheDocument();
  });

  it("closes on Escape once open via hover", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip title="Total percent" body="Should read 100%." />);
    await user.hover(screen.getByRole("button", { name: "Total percent" }));
    await screen.findByText("Should read 100%.");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Should read 100%.")).not.toBeInTheDocument());
  });

  it("a fresh (unhovered) click opens it", async () => {
    render(<InfoTooltip title="Total percent" body="Should read 100%." />);
    // Click via fireEvent-equivalent single action, not userEvent.click's
    // synthesized hover-then-click, to isolate the click path itself.
    screen.getByRole("button", { name: "Total percent" }).click();
    expect(await screen.findByText("Should read 100%.")).toBeInTheDocument();
  });
});

describe("InfoTooltip — accessibility and content", () => {
  it("has an accessible name on the trigger", () => {
    render(<InfoTooltip title="Total percent" body="Body" ariaLabel="About total percent" />);
    expect(screen.getByRole("button", { name: "About total percent" })).toBeInTheDocument();
  });

  it("falls back to the title as the accessible name when ariaLabel is omitted", () => {
    render(<InfoTooltip title="Total percent" body="Body" />);
    expect(screen.getByRole("button", { name: "Total percent" })).toBeInTheDocument();
  });

  it("renders localized title and body content passed as props", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip title="Titre" body="Corps du texte" />);
    await user.hover(screen.getByRole("button", { name: "Titre" }));
    expect(await screen.findByText("Titre")).toBeInTheDocument();
    expect(screen.getByText("Corps du texte")).toBeInTheDocument();
  });

  it("does not render a Learn more action when no topic id is given", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip title="Total percent" body="Body" />);
    await user.hover(screen.getByRole("button", { name: "Total percent" }));
    await screen.findByText("Body");
    expect(screen.queryByText("Learn more")).not.toBeInTheDocument();
  });
});

describe("InfoTooltip — Learn more", () => {
  it("opens the given help topic and closes the tooltip", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip title="Total percent" body="Body" learnMoreTopicId="formulation" />);
    await user.hover(screen.getByRole("button", { name: "Total percent" }));
    await user.click(await screen.findByText("Learn more"));
    await waitFor(() => expect(useHelpStore.getState().target).toEqual({ kind: "topic", id: "formulation" }));
    expect(useHelpStore.getState().panelOpen).toBe(true);
  });

  it("hovering the trigger alone never opens help or navigates — only Learn more does", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip title="Total percent" body="Body" learnMoreTopicId="formulation" />);
    await user.hover(screen.getByRole("button", { name: "Total percent" }));
    await screen.findByText("Body");
    expect(useHelpStore.getState().panelOpen).toBe(false);
    expect(useHelpStore.getState().target).toBeNull();
  });
});
