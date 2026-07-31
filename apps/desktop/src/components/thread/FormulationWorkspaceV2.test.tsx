/**
 * Regression coverage for the candidate-version isolation bug: a single
 * shared `draft` state (seeded only once via `draft.length === 0`) meant
 * opening "Edit formula" always showed whichever candidate was edited
 * first, regardless of which V1/V2/V3 tab was selected. Fixed by keying
 * drafts (and batch size) by the candidate's own stable `version` id.
 *
 * Tests `CardsView` directly (exported for this purpose) rather than the
 * full `FormulationWorkspaceV2` — that avoids mocking the Tauri
 * `generate_formulation`/`read_session` commands and the studio form, and
 * exercises exactly the state ownership this bug was about.
 */
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { CardsView } from "./FormulationWorkspaceV2";
import type { FormulationCard } from "@/lib/formulationV2";

function ingredient(name: string, pct: string, fn: string) {
  return { name, weight_pct: pct, function: fn };
}

const V1: FormulationCard = {
  version: "v1",
  markdown: "# Candidate V1",
  formula: { ingredients: [ingredient("Water V1", "70", "solvent"), ingredient("SLES V1", "12", "anionic surfactant")] },
};
const V2: FormulationCard = {
  version: "v2",
  markdown: "# Candidate V2",
  formula: { ingredients: [ingredient("Water V2", "75", "solvent"), ingredient("CAPB V2", "8", "amphoteric surfactant")] },
};
const V3: FormulationCard = {
  version: "v3",
  markdown: "# Candidate V3",
  formula: { ingredients: [ingredient("Glycerin V3", "3", "humectant")] },
};

function Harness({ cards, initialActive = 0 }: { cards: FormulationCard[]; initialActive?: number }) {
  const { t } = useTranslation(["session", "common"]);
  const [active, setActive] = useState(initialActive);
  return <CardsView view={{ mode: "cards", cards, readOnly: false }} active={active} setActive={setActive} t={t} />;
}

async function openEditTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit formula" }));
}

describe("FormulationWorkspaceV2 CardsView — candidate version isolation", () => {
  it("V1, V2 and V3 fixtures carry different ingredients", () => {
    expect(V1.formula).not.toEqual(V2.formula);
    expect(V2.formula).not.toEqual(V3.formula);
  });

  it("selecting each tab and opening Edit formula loads that candidate's own ingredients", async () => {
    const user = userEvent.setup();
    render(<Harness cards={[V1, V2, V3]} />);
    await openEditTab(user);
    expect(screen.getByDisplayValue("Water V1")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /V2/ }));
    await openEditTab(user);
    expect(screen.getByDisplayValue("Water V2")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Water V1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /V3/ }));
    await openEditTab(user);
    expect(screen.getByDisplayValue("Glycerin V3")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Water V2")).not.toBeInTheDocument();
  });

  it("editing V1's percentage does not change V2 or V3", async () => {
    const user = userEvent.setup();
    render(<Harness cards={[V1, V2, V3]} />);
    await openEditTab(user);
    const v1Percent = screen.getByDisplayValue("70");
    fireEvent.change(v1Percent, { target: { value: "99" } });
    expect(await screen.findByDisplayValue("99")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /V2/ }));
    await openEditTab(user);
    expect(screen.getByDisplayValue("75")).toBeInTheDocument(); // V2's own water %, untouched
    expect(screen.queryByDisplayValue("99")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /V3/ }));
    await openEditTab(user);
    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("99")).not.toBeInTheDocument();
  });

  it("editing V2 does not change V1 or V3", async () => {
    const user = userEvent.setup();
    render(<Harness cards={[V1, V2, V3]} />);
    await user.click(screen.getByRole("tab", { name: /V2/ }));
    await openEditTab(user);
    const v2Percent = screen.getByDisplayValue("8");
    fireEvent.change(v2Percent, { target: { value: "44" } });
    expect(await screen.findByDisplayValue("44")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /V1/ }));
    await openEditTab(user);
    expect(screen.getByDisplayValue("12")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("44")).not.toBeInTheDocument();
  });

  it("unsaved edits in V1 survive switching to V2 and back", async () => {
    const user = userEvent.setup();
    render(<Harness cards={[V1, V2, V3]} />);
    await openEditTab(user);
    const v1Percent = screen.getByDisplayValue("70");
    fireEvent.change(v1Percent, { target: { value: "55" } });
    await screen.findByDisplayValue("55");

    await user.click(screen.getByRole("tab", { name: /V2/ }));
    await openEditTab(user);
    await user.click(screen.getByRole("tab", { name: /V1/ }));
    await openEditTab(user);
    expect(screen.getByDisplayValue("55")).toBeInTheDocument();
  });

  it("switching Card <-> Edit formula preserves the selected version", async () => {
    const user = userEvent.setup();
    render(<Harness cards={[V1, V2, V3]} />);
    await user.click(screen.getByRole("tab", { name: /V2/ }));
    await openEditTab(user);
    expect(screen.getByDisplayValue("Water V2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Card" }));
    expect(await screen.findByText("Candidate V2")).toBeInTheDocument();
    await openEditTab(user);
    expect(screen.getByDisplayValue("Water V2")).toBeInTheDocument();
  });

  it("does not mutate the original candidate's formula object", async () => {
    const original = JSON.parse(JSON.stringify(V2.formula));
    const user = userEvent.setup();
    render(<Harness cards={[V1, V2, V3]} />);
    await user.click(screen.getByRole("tab", { name: /V2/ }));
    await openEditTab(user);
    const v2Percent = screen.getByDisplayValue("8");
    fireEvent.change(v2Percent, { target: { value: "33" } });
    await screen.findByDisplayValue("33");
    expect(V2.formula).toEqual(original);
  });

  it("keyboard navigation (ArrowRight/ArrowLeft) moves between version tabs with correct aria-selected state", async () => {
    const user = userEvent.setup();
    render(<Harness cards={[V1, V2, V3]} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    tabs[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("marks a candidate tab with an unsaved indicator once its draft is seeded", async () => {
    const user = userEvent.setup();
    render(<Harness cards={[V1, V2]} />);
    const v1Tab = screen.getByRole("tab", { name: /V1/ });
    expect(within(v1Tab).queryByTitle("Has unsaved edits")).not.toBeInTheDocument();
    await openEditTab(user);
    expect(within(screen.getByRole("tab", { name: /V1/ })).getByTitle("Has unsaved edits")).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: /V2/ })).queryByTitle("Has unsaved edits")).not.toBeInTheDocument();
  });
});
