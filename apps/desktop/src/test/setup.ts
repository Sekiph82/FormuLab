import "@testing-library/jest-dom/vitest";
import "@/i18n";

// DOM stubs — only in a browser-like (jsdom) environment. The node-env tests
// (e.g. the OpenCode integration test) skip these.
if (typeof window !== "undefined") {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // jsdom's File/Blob lack `arrayBuffer()`/`text()` (standard Web APIs every
  // real target — Chromium/WebView2, browsers — implements). Polyfilled via
  // FileReader so upload-driven tests (Data Exchange import, etc.) work the
  // same way the real app does.
  if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
  if (typeof Blob !== "undefined" && !Blob.prototype.text) {
    Blob.prototype.text = function text(this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  // Web Storage stub. jsdom (25) under Node (>=25) exposes window.localStorage
  // but its methods are not functions, so reads at module init — e.g. the theme
  // and runtime stores — throw "getItem is not a function". Shim an in-memory
  // store so importing those modules doesn't break the suites that touch them.
  if (typeof window.localStorage?.getItem !== "function") {
    const store = new Map<string, string>();
    const shim: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => {
        store.delete(k);
      },
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: shim,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "sessionStorage", {
      value: shim,
      configurable: true,
      writable: true,
    });
  }

  // The guided-tour onboarding prompt (Phase 10 Session 4) is globally
  // mounted in AppShell and shows on a genuinely fresh profile. Defaulting
  // it to "already dismissed" here keeps every unrelated `renderAt()`-based
  // test from suddenly growing a second `role="dialog"` element that has
  // nothing to do with what that test is checking. Tests that specifically
  // cover onboarding (`OnboardingPrompt.test.tsx`, `onboardingStore.test.ts`)
  // clear localStorage themselves before exercising the real first-use case.
  if (window.localStorage.getItem("formulab.onboarding.dismissed.v1") === null) {
    window.localStorage.setItem("formulab.onboarding.dismissed.v1", "1");
  }
}
