/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pkg from "./package.json";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function stageOfflineOcrAssets() {
  const publicRoot = r("./public/formulab-ocr");
  const assets = [
    ["tesseract.js/dist/worker.min.js", "worker.min.js"],
    ["tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
    ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
    ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
    ...["eng", "deu", "tur"].map((language) => [
      `@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`,
      `lang/${language}.traineddata.gz`,
    ]),
  ];
  for (const [source, target] of assets) {
    const destination = resolve(publicRoot, target);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(dirname(r("./package.json")), "node_modules", source), destination);
  }
  const licenseRoot = resolve(publicRoot, "licenses");
  mkdirSync(licenseRoot, { recursive: true });
  const modulesRoot = resolve(dirname(r("./package.json")), "node_modules");
  copyFileSync(resolve(modulesRoot, "pdfjs-dist/LICENSE"), resolve(licenseRoot, "PDF.js-LICENSE.txt"));
  copyFileSync(resolve(modulesRoot, "tesseract.js/LICENSE.md"), resolve(licenseRoot, "Tesseract.js-LICENSE.txt"));
  copyFileSync(resolve(modulesRoot, "tesseract.js-core/LICENSE"), resolve(licenseRoot, "Tesseract.js-core-LICENSE.txt"));
  copyFileSync(resolve(modulesRoot, "tesseract.js-core/LICENSE"), resolve(licenseRoot, "Tessdata-best-LICENSE.txt"));
  writeFileSync(resolve(publicRoot, "THIRD_PARTY_NOTICES.txt"), [
    "Bundled offline OCR components:",
    "- PDF.js 6.3.289 (Apache-2.0)",
    "- Tesseract.js 7.0.0 and tesseract.js-core 7.0.0 (Apache-2.0)",
    "- English, German, and Turkish 4.0.0_best_int OCR models from tessdata_best (Apache-2.0)",
    "Apache-2.0 license texts are included in the licenses/ folder.",
    "Model source: https://github.com/tesseract-ocr/tessdata_best",
    "PDF.js source: https://github.com/mozilla/pdf.js",
    "Tesseract.js source: https://github.com/naptha/tesseract.js",
    "",
  ].join("\n"));
}

stageOfflineOcrAssets();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": r("./src"),
      "@formulab/shared/testing": r("../../packages/shared/src/engine/sqliteTestAdapter.ts"),
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
