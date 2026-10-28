import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { renderFormulationReportPdf } from "./formulationReportPdf";

function extractDrawnText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let text = "";
  for (const match of raw.matchAll(streams)) {
    try {
      const content = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
      for (const drawn of content.matchAll(/<([\da-f]+)>\s*Tj/gi)) {
        text += Buffer.from(drawn[1], "hex").toString("latin1") + "\n";
      }
    } catch {
      // Ignore binary or non-Flate streams such as font data.
    }
  }
  return text;
}

describe("renderFormulationReportPdf", () => {
  it("creates a readable PDF with headings, table headers, and every report row", async () => {
    const html = `<!doctype html><html><body>
      <h1>FormuLab Formulation Report</h1>
      <section><h2>Formula V1</h2><p>Formula state: complete</p>
        <table><thead><tr><th>Ingredient</th><th>Weight %</th></tr></thead>
        <tbody><tr><td>Decyl Glucoside</td><td>10</td></tr><tr><td>Citric Acid</td><td>0.2</td></tr></tbody></table>
      </section>
    </body></html>`;

    const bytes = await renderFormulationReportPdf(html, "session-123");
    const document = await PDFDocument.load(bytes);
    const visibleText = extractDrawnText(bytes);

    expect(document.getTitle()).toBe("FormuLab Formulation Report — session-123");
    expect(document.getPageCount()).toBeGreaterThan(0);
    expect(visibleText).toContain("Formula V1");
    expect(visibleText).toContain("Ingredient: Decyl Glucoside");
    expect(visibleText).toContain("Weight %: 0.2");
  });
});
