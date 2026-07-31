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

  it("cycles theme and persists to the FormuLab key only", () => {
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("dark");
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("dark");
    expect(window.localStorage.getItem("ai4s.theme.v2")).toBeNull();
    expect(window.localStorage.getItem("ai4s.theme")).toBeNull();

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("light");
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("light");

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("warm");
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("warm");
  });
});

describe("theme key migration (formulab.theme.v2 <- ai4s.theme.v2 <- ai4s.theme)", () => {
  beforeEach(() => window.localStorage.clear());

  it("prefers the new key when both new and legacy v2 keys exist", () => {
    window.localStorage.setItem("formulab.theme.v2", "dark");
    window.localStorage.setItem("ai4s.theme.v2", "light");
    expect(initialTheme()).toBe("dark");
    expect(window.localStorage.getItem("ai4s.theme.v2")).toBe("light");
  });

  it("migrates a legacy-v2-only value verbatim (no remap)", () => {
    window.localStorage.setItem("ai4s.theme.v2", "dark");
    expect(initialTheme()).toBe("dark");
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("dark");
    expect(window.localStorage.getItem("ai4s.theme.v2")).toBe("dark");
  });

  it("migrates a pre-v2-only legacy value with the light->warm remap", () => {
    window.localStorage.setItem("ai4s.theme", "light");
    expect(initialTheme()).toBe("warm");
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("warm");
    expect(window.localStorage.getItem("ai4s.theme")).toBe("light");
  });

  it("migrates a pre-v2-only legacy dark value unchanged", () => {
    window.localStorage.setItem("ai4s.theme", "dark");
    expect(initialTheme()).toBe("dark");
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("dark");
  });

  it("falls back safely (system preference, no crash) when every stored value is malformed", () => {
    window.localStorage.setItem("formulab.theme.v2", "not-a-theme");
    window.localStorage.setItem("ai4s.theme.v2", "also-invalid");
    window.localStorage.setItem("ai4s.theme", "still-invalid");
    expect(() => initialTheme()).not.toThrow();
    expect(["light", "dark"]).toContain(initialTheme());
    // Malformed values are never migrated or overwritten.
    expect(window.localStorage.getItem("formulab.theme.v2")).toBe("not-a-theme");
  });

  it("does not delete either legacy key after migrating", () => {
    window.localStorage.setItem("ai4s.theme", "dark");
    initialTheme();
    expect(window.localStorage.getItem("ai4s.theme")).toBe("dark");
  });
});

describe("sidebar width key migration (formulab.sidebar.width <- ai4s.sidebar.width)", () => {
  beforeEach(() => window.localStorage.clear());

  it("prefers the new key when both exist", () => {
    window.localStorage.setItem("formulab.sidebar.width", "260");
    window.localStorage.setItem("ai4s.sidebar.width", "300");
    expect(initialSidebarWidth()).toBe(260);
    expect(window.localStorage.getItem("ai4s.sidebar.width")).toBe("300");
  });

  it("migrates a legacy-only value and writes it once to the new key", () => {
    window.localStorage.setItem("ai4s.sidebar.width", "260");
    expect(initialSidebarWidth()).toBe(260);
    expect(window.localStorage.getItem("formulab.sidebar.width")).toBe("260");
    expect(window.localStorage.getItem("ai4s.sidebar.width")).toBe("260");
  });

  it("falls back to the default without crashing when the legacy value is malformed", () => {
    window.localStorage.setItem("ai4s.sidebar.width", "not-a-number");
    expect(() => initialSidebarWidth()).not.toThrow();
    expect(initialSidebarWidth()).toBe(SIDEBAR_DEFAULT);
  });

  it("writes only to the new key after migration, never back to the legacy key", () => {
    window.localStorage.setItem("ai4s.sidebar.width", "260");
    initialSidebarWidth();
    useUiStore.getState().setSidebarWidth(300);
    expect(window.localStorage.getItem("formulab.sidebar.width")).toBe("300");
    expect(window.localStorage.getItem("ai4s.sidebar.width")).toBe("260");
  });

  it("preserves the exact legacy value with no rounding or transformation", () => {
    window.localStorage.setItem("ai4s.sidebar.width", "199");
    expect(initialSidebarWidth()).toBe(199);
  });
});

describe("sidebar collapsed key migration (formulab.sidebar.collapsed <- ai4s.sidebar.collapsed)", () => {
  beforeEach(() => window.localStorage.clear());

  it("prefers the new key when both exist", () => {
    window.localStorage.setItem("formulab.sidebar.collapsed", "0");
    window.localStorage.setItem("ai4s.sidebar.collapsed", "1");
    expect(initialSidebarCollapsed()).toBe(false);
  });

  it("migrates a legacy-only value and does not delete it", () => {
    window.localStorage.setItem("ai4s.sidebar.collapsed", "1");
    expect(initialSidebarCollapsed()).toBe(true);
    expect(window.localStorage.getItem("formulab.sidebar.collapsed")).toBe("1");
    expect(window.localStorage.getItem("ai4s.sidebar.collapsed")).toBe("1");
  });

  it("treats any non-'1' legacy value as false, same as pre-migration behavior", () => {
    window.localStorage.setItem("ai4s.sidebar.collapsed", "garbage");
    expect(() => initialSidebarCollapsed()).not.toThrow();
    expect(initialSidebarCollapsed()).toBe(false);
  });
});

describe("inspector width key migration (formulab.inspector.width <- ai4s.inspector.width)", () => {
  beforeEach(() => window.localStorage.clear());

  it("prefers the new key when both exist", () => {
    window.localStorage.setItem("formulab.inspector.width", "600");
    window.localStorage.setItem("ai4s.inspector.width", "700");
    expect(initialInspectorWidth()).toBe(600);
  });

  it("migrates a legacy-only value", () => {
    window.localStorage.setItem("ai4s.inspector.width", "600");
    expect(initialInspectorWidth()).toBe(600);
    expect(window.localStorage.getItem("formulab.inspector.width")).toBe("600");
    expect(window.localStorage.getItem("ai4s.inspector.width")).toBe("600");
  });

  it("falls back to the default without crashing when malformed", () => {
    window.localStorage.setItem("ai4s.inspector.width", "NaN-ish");
    expect(() => initialInspectorWidth()).not.toThrow();
    expect(initialInspectorWidth()).toBe(INSPECTOR_DEFAULT);
  });
});

describe("zoom key migration (formulab.zoom <- ai4s.zoom)", () => {
  beforeEach(() => window.localStorage.clear());

  it("prefers the new key when both exist", () => {
    window.localStorage.setItem("formulab.zoom", "1.5");
    window.localStorage.setItem("ai4s.zoom", "2");
    expect(initialZoom()).toBe(1.5);
  });

  it("migrates a legacy-only value", () => {
    window.localStorage.setItem("ai4s.zoom", "1.2");
    expect(initialZoom()).toBe(1.2);
    expect(window.localStorage.getItem("formulab.zoom")).toBe("1.2");
    expect(window.localStorage.getItem("ai4s.zoom")).toBe("1.2");
  });

  it("falls back to 1 without crashing when the legacy value is malformed", () => {
    window.localStorage.setItem("ai4s.zoom", "not-a-zoom");
    expect(() => initialZoom()).not.toThrow();
    expect(initialZoom()).toBe(1);
  });

  it("writes only to the new key going forward", () => {
    window.localStorage.setItem("ai4s.zoom", "1.2");
    initialZoom();
    useUiStore.getState().setZoom(1.8);
    expect(window.localStorage.getItem("formulab.zoom")).toBe("1.8");
    expect(window.localStorage.getItem("ai4s.zoom")).toBe("1.2");
  });
});
