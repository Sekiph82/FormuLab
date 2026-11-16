import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { renderFormulationReportDocx } from "./formulationReportDocx";

describe("renderFormulationReportDocx", () => {
  it("creates a Word document with the report's headings, paragraphs and a real table", async () => {
    const html = `<!doctype html><html><body>
      <h1>FormuLab — Formulation Report</h1>
      <p class="muted">Generated 2026-11-16 — Session s-1</p>
      <div class="report-section"><h2>Formula V1</h2>
        <table><thead><tr><th>#</th><th>Ingredient (INCI)</th><th>% w/w</th></tr></thead>
        <tbody><tr><td>1</td><td>Water (Aqua)</td><td>q.s. 100</td></tr><tr><td>2</td><td>Sodium Cocoyl Isethionate</td><td>20.5</td></tr></tbody></table>
      </div></body></html>`;
    const bytes = await renderFormulationReportDocx(html, "s-1");
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(xml).toContain("FormuLab — Formulation Report");
    expect(xml).toContain("Formula V1");
    expect((xml.match(/<w:tr[ >]/g) ?? []).length).toBe(3);
    expect(xml).toContain("Sodium Cocoyl Isethionate");
    expect(xml).toContain("q.s. 100");
  });
});
