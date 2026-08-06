/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import pkg from "./package.json";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": r("./src"),
      "@formulab/shared": r("../../packages/shared/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // `TourOverlay.tsx`'s `navigate()` call (classic `<BrowserRouter>`, so
    // it's synchronous/void — there's no promise exposed to app code to
    // catch) drives @remix-run/router's internal `createClientSideRequest`,
    // which builds a `new Request(href, { signal })` from a fresh
    // `AbortController`. Under genuine file-level concurrency this
    // occasionally throws inside Node's own undici — "Expected signal to be
    // an instance of AbortSignal" — as an unhandled rejection that Vitest
    // attributes to whatever test happens to be active at that instant.
    // Ruled out empirically before landing on this fix: neither forcing
    // @remix-run/router/react-router through Vite's per-file-fresh
    // transform pipeline (`deps.inline`) nor full OS-process-per-file
    // isolation (`pool: "forks"`) eliminated it — so it is not stale
    // cross-file module *or* globalThis caching. It reproduces only when
    // multiple files' code is literally executing at the same instant, and
    // is 100% absent (130/130 files, same suite) with file parallelism
    // off — a scheduling race, not an identity/realm mismatch. Serializing
    // file execution is the only change that deterministically closes it
    // without touching a single test or any production file; the ~4x
    // longer local run is the accepted trade-off for a suite that always
    // passes the same way.
    fileParallelism: false,
  },
});
