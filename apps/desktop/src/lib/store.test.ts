import { beforeEach, describe, expect, it } from "vitest";
import {
  initialInspectorWidth,
  initialSidebarCollapsed,
  initialSidebarWidth,
  initialTheme,
  initialZoom,
  INSPECTOR_DEFAULT,
  SIDEBAR_DEFAULT,
  useUiStore,
} from "./store";

describe("uiStore theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({ theme: "warm" });
  });

  it("cycles theme and persists to the FormuLab key", () => {
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("dark");
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("dark");

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("light");
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("light");

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("warm");
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("warm");
  });
});

describe("uiStore persisted-preference defaults", () => {
  beforeEach(() => window.localStorage.clear());

  it("falls back safely (system preference, no crash) when the theme value is malformed", () => {
    window.localStorage.setItem("formulab.theme.v2", "not-a-theme");
    expect(() => initialTheme()).not.toThrow();
    expect(["light", "dark"]).toContain(initialTheme());
  });

  it("falls back to the default sidebar width without crashing when malformed", () => {
    window.localStorage.setItem("formulab.sidebar.width", "not-a-number");
    expect(() => initialSidebarWidth()).not.toThrow();
    expect(initialSidebarWidth()).toBe(SIDEBAR_DEFAULT);
  });

  it("treats any non-'1' sidebar-collapsed value as false", () => {
    window.localStorage.setItem("formulab.sidebar.collapsed", "garbage");
    expect(() => initialSidebarCollapsed()).not.toThrow();
    expect(initialSidebarCollapsed()).toBe(false);
  });

  it("falls back to the default inspector width without crashing when malformed", () => {
    window.localStorage.setItem("formulab.inspector.width", "NaN-ish");
    expect(() => initialInspectorWidth()).not.toThrow();
    expect(initialInspectorWidth()).toBe(INSPECTOR_DEFAULT);
  });

  it("falls back to 1 without crashing when the zoom value is malformed", () => {
    window.localStorage.setItem("formulab.zoom", "not-a-zoom");
    expect(() => initialZoom()).not.toThrow();
    expect(initialZoom()).toBe(1);
  });
});
