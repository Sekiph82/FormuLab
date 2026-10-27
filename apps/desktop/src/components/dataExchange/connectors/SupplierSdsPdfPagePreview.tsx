import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";

export function SupplierSdsPdfPagePreview({ bytes, pageNumber, lineNumber, documentLabel = "Supplier SDS" }: { bytes: Uint8Array; pageNumber: number; lineNumber: number; documentLabel?: string }) {
  const { t } = useTranslation("session");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let renderTask: RenderTask | undefined;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    setError(false);

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const task = pdfjs.getDocument({ data: Uint8Array.from(bytes).buffer });
        loadingTask = task;
        const pdf = await task.promise;
        if (disposed) return;
        if (pageNumber < 1 || pageNumber > pdf.numPages) throw new Error("page out of range");
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const pixelLimit = 16_000_000;
        const scale = Math.min(1.25, Math.sqrt(pixelLimit / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("PDF canvas is unavailable");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
        if (disposed) canvas.width = 0;
      } catch {
        if (!disposed) setError(true);
      }
    })();

    return () => {
      disposed = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
      if (canvasRef.current) canvasRef.current.width = 0;
    };
  }, [bytes, pageNumber]);

  return (
    <section className="rounded-input border border-accent/40 bg-surface-1 p-3">
      <h4 className="mb-2 text-[11px] font-semibold text-text">{t("dataExchange.connectors.sdsReview.pagePreview", { page: pageNumber, line: lineNumber })}</h4>
      {error ? <p role="alert" className="text-[10px] text-error">{t("dataExchange.connectors.sdsReview.renderError")}</p>
        : <canvas ref={canvasRef} aria-label={`${documentLabel} PDF page ${pageNumber}`} className="mx-auto block max-h-[70vh] max-w-full border border-border-faint" />}
    </section>
  );
}
