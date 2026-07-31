import { beforeEach, describe, expect, it } from "vitest";
import { useTourStore } from "./tourStore";

function reset() {
  useTourStore.setState({ activeTourId: null, stepIndex: 0, openerElement: null });
}

beforeEach(() => {
  reset();
  document.body.innerHTML = "";
});

describe("useTourStore — tour state machine", () => {
  it("startTour activates the tour at step 0 and captures the currently focused element", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    useTourStore.getState().startTour("formulation");
    expect(useTourStore.getState().activeTourId).toBe("formulation");
    expect(useTourStore.getState().stepIndex).toBe(0);
    expect(useTourStore.getState().openerElement).toBe(button);
  });

  it("next advances the step index", () => {
    useTourStore.getState().startTour("doe");
    useTourStore.getState().next(5);
    expect(useTourStore.getState().stepIndex).toBe(1);
  });

  it("next on the last step finishes the tour instead of overrunning the step count", () => {
    useTourStore.getState().startTour("doe");
    useTourStore.setState({ stepIndex: 4 });
    useTourStore.getState().next(5);
    expect(useTourStore.getState().activeTourId).toBeNull();
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it("back moves to the previous step and never goes below 0", () => {
    useTourStore.getState().startTour("doe");
    useTourStore.setState({ stepIndex: 2 });
    useTourStore.getState().back();
    expect(useTourStore.getState().stepIndex).toBe(1);
    useTourStore.getState().back();
    useTourStore.getState().back();
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it("skip closes the tour and restores focus to the captured opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    useTourStore.getState().startTour("dossiers");
    useTourStore.setState({ stepIndex: 2 });

    const somewhereElse = document.createElement("button");
    document.body.appendChild(somewhereElse);
    somewhereElse.focus();

    useTourStore.getState().skip();
    expect(useTourStore.getState().activeTourId).toBeNull();
    expect(useTourStore.getState().stepIndex).toBe(0);
    expect(useTourStore.getState().openerElement).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("finish closes the tour the same way skip does", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    useTourStore.getState().startTour("formulation");
    useTourStore.getState().finish();
    expect(useTourStore.getState().activeTourId).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("goToStep clamps to a non-negative index", () => {
    useTourStore.getState().startTour("doe");
    useTourStore.getState().goToStep(-3);
    expect(useTourStore.getState().stepIndex).toBe(0);
    useTourStore.getState().goToStep(3);
    expect(useTourStore.getState().stepIndex).toBe(3);
  });
});
