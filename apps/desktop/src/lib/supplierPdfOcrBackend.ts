import { createWorker, OEM } from "tesseract.js";
import type { PDFPageProxy, PageViewport } from "pdfjs-dist";
import type { SupplierPdfOcrBackend } from "./supplierPdfOcr";

interface LoadedPdf {
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  destroy(): Promise<void>;
}

interface LocalOcrWorker {
  recognize(image: Blob): Promise<{ data: { lines: Array<{ text: string; confidence: number }> } }>;
  terminate(): Promise<unknown>;
}

export interface SupplierPdfOcrBackendDependencies {
  loadPdf(bytes: Uint8Array): Promise<LoadedPdf>;
  createWorker(languages: string[]): Promise<LocalOcrWorker>;
}

async function loadBundledPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes).buffer });
  const document = await loadingTask.promise;
  return { getPage: (pageNumber: number) => document.getPage(pageNumber), destroy: () => loadingTask.destroy() };
}

async function createBundledWorker(languages: string[]) {
  const worker = await createWorker(languages, OEM.LSTM_ONLY, {
    workerPath: `${import.meta.env.BASE_URL}formulab-ocr/worker.min.js`,
    corePath: `${import.meta.env.BASE_URL}formulab-ocr/core`,
    langPath: `${import.meta.env.BASE_URL}formulab-ocr/lang`,
    gzip: true,
    cacheMethod: "none",
    workerBlobURL: false,
    logger: () => undefined,
  });
  return worker as unknown as LocalOcrWorker;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("OCR operation cancelled.", "AbortError");
}

export function createSupplierPdfOcrBackend(
  pdfBytes: Uint8Array,
  dependencies: SupplierPdfOcrBackendDependencies = { loadPdf: loadBundledPdf, createWorker: createBundledWorker },
): SupplierPdfOcrBackend {
  let pdfPromise: ReturnType<SupplierPdfOcrBackendDependencies["loadPdf"]> | undefined;
  let workerPromise: ReturnType<SupplierPdfOcrBackendDependencies["createWorker"]> | undefined;
  let disposed = false;
  let activeRender: { cancel(): void } | undefined;
  const getPdf = () => (pdfPromise ??= dependencies.loadPdf(pdfBytes));
  const getWorker = (languages: string[]) => (workerPromise ??= dependencies.createWorker(languages));

  return {
    async renderPage({ pageNumber, scale, maxPixels, signal }) {
      throwIfAborted(signal);
      const pdfDocument = await getPdf();
      const page: PDFPageProxy = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
        || viewport.width <= 0 || viewport.height <= 0 || viewport.width * viewport.height > maxPixels) {
        const error = new Error("Supplier PDF page exceeds the OCR raster pixel limit.");
        error.name = "SupplierPdfOcrRasterLimitError";
        throw error;
      }
      const canvas = Object.assign(globalThis.document.createElement("canvas"), {
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height),
      });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable.");
      const task = page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context as CanvasRenderingContext2D, viewport: viewport as PageViewport });
      activeRender = task;
      const cancel = () => task.cancel();
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        await task.promise;
        throwIfAborted(signal);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PDF page rasterization failed.")), "image/png"));
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: "image/png" as const };
      } finally {
        signal?.removeEventListener("abort", cancel);
        activeRender = undefined;
        canvas.width = 0;
      }
    },
    async recognize({ bytes, mimeType, languages, signal }) {
      throwIfAborted(signal);
      if (languages.some((language) => !["eng", "deu", "tur"].includes(language))) {
        throw new RangeError("The requested OCR language is not bundled for offline use.");
      }
      const worker = await getWorker(languages);
      throwIfAborted(signal);
      const result = await worker.recognize(new Blob([Uint8Array.from(bytes).buffer], { type: mimeType }));
      throwIfAborted(signal);
      return result.data.lines.map((line) => ({ text: line.text, confidence: line.confidence / 100 }));
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      activeRender?.cancel();
      const [document, worker] = await Promise.allSettled([
        pdfPromise ?? Promise.resolve(undefined),
        workerPromise ?? Promise.resolve(undefined),
      ]);
      if (document.status === "fulfilled" && document.value) await document.value.destroy();
      if (worker.status === "fulfilled" && worker.value) await worker.value.terminate();
    },
  };
}
