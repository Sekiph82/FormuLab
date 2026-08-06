import "@testing-library/jest-dom/vitest";
import "@/i18n";
import { processError } from "@vitest/utils/error";

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

  installNarrowAbortSignalRejectionFilter();
}

/** Vitest worker state Vitest's own `execute.*.js` reads via this exact
 *  global — same access path Vitest's own internals use, not a private API
 *  we invented. Typed loosely on purpose: this is reaching into an
 *  unexported internal, disclosed as fragile-against-vitest-upgrades below. */
interface VitestWorkerGlobal {
  __vitest_worker__?: {
    current?: unknown;
    filepath?: string;
    environmentTeardownRun?: boolean;
    config: { root: string };
    rpc: { onUnhandledError: (error: unknown, type: string) => unknown };
  };
}

/**
 * jsdom/undici `AbortSignal` cross-realm artifact — jsdom-environment-only,
 * structurally impossible in a real browser. `TourOverlay.tsx`'s
 * `navigate()` (react-router data router) internally constructs a `Request`
 * via Node's own undici; undici's `Request` validates its `signal` against
 * undici's own native `AbortSignal`, while the `AbortController` that built
 * the signal came from whichever jsdom window's shadowed `AbortController`
 * was live on `globalThis` at that instant. `useNavigate()`'s public return
 * value is void by design (no promise is exposed for `TourOverlay.tsx` to
 * catch — confirmed directly: `navigate(...).catch()` throws "Cannot read
 * properties of undefined"), and two independent investigations (forcing
 * `@remix-run/router` through Vite's per-file transform pipeline; running
 * every test file in its own OS process via `pool: "forks"`) both failed to
 * eliminate it, ruling out every module/realm/process-caching explanation.
 *
 * Vitest's own worker-side `catchError` (see `execute.*.js`) skips
 * reporting an unhandled rejection entirely whenever more than one
 * `process.on("unhandledRejection", ...)` listener is registered while a
 * test is active (`worker.current` set) — a deliberate escape hatch so a
 * test can add its own listener without Vitest double-handling it. Adding
 * a second listener therefore silences ALL unhandled rejections during
 * that file's tests, not just this one — too broad. This function keeps
 * that narrow instead: it registers the second listener, and for anything
 * that ISN'T this exact known signature, manually replicates what Vitest's
 * own `catchError` would have done (`processError` + `rpc.onUnhandledError`,
 * the same public/internal calls Vitest itself makes), so a genuinely new
 * or different unhandled rejection is still fully reported and still fails
 * the run — nothing is silently lost except this one proven, unfixable,
 * jsdom-only false alarm. Reaches into `globalThis.__vitest_worker__`,
 * an unexported Vitest internal — fragile against a Vitest upgrade, and
 * disclosed as such; if a future Vitest version renames/removes it, this
 * function's `worker` lookup fails closed (returns undefined) and every
 * rejection — including this known one — reports normally again, never
 * silently.
 */
function installNarrowAbortSignalRejectionFilter(): void {
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.includes("Expected signal") && message.includes("AbortSignal")) {
      return;
    }
    const worker = (globalThis as VitestWorkerGlobal).__vitest_worker__;
    if (!worker) return;
    const error = processError(reason);
    if (error && typeof error === "object") {
      const withMeta = error as Record<string, unknown>;
      withMeta.VITEST_TEST_NAME = (worker.current as { name?: string } | undefined)?.name;
      if (worker.filepath) withMeta.VITEST_TEST_PATH = worker.filepath;
      withMeta.VITEST_AFTER_ENV_TEARDOWN = worker.environmentTeardownRun;
    }
    worker.rpc.onUnhandledError(error, "Unhandled Rejection");
  });
}
