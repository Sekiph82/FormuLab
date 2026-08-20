/**
 * FVL-04.026 (B6) — a REAL integration test for the actual formulation
 * export path: mounts the real `ExportMenu`, clicks the real "Formula
 * (Excel)" action, and asserts the file the browser would actually save
 * carries the new deterministic FORM_... filename — never a standalone
 * unit test of `formulationExportFilename()` alone that production never
 * calls.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { newFormulation, newVersion } from "@/lib/formulations";
import { ExportMenu } from "./ExportMenu";

describe("ExportMenu — real production formulation export naming (FVL-04.026)", () => {
  it("the real XLSX export click produces the new FORM_<ProductFamily>_<ShortFormulaName>_<FormulaCode>_V<Version>_Formula.xlsx filename", async () => {
    const formulation = newFormulation("Anti-Dandruff Shampoo", "Shampoo", { code: "FML-0042" });
    const version = newVersion(formulation.id, [], { versionNumber: 3 });

    let capturedDownload = "";
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      capturedDownload = this.download;
    });
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();

    render(<ExportMenu formulation={formulation} version={version} effectiveStatus={version.status} />);
    await userEvent.click(screen.getByRole("button", { name: /export/i }));
    await userEvent.click(screen.getByText("Excel formula sheet"));

    await waitFor(() => expect(capturedDownload).not.toBe(""));
    expect(capturedDownload).toBe("FORM_Shampoo_Anti-Dandruff-Shampoo_FML-0042_V03_Formula.xlsx");
    clickSpy.mockRestore();
  });

  it("every export action in the menu uses the new naming convention, never the old formulation-code-only pattern", async () => {
    const formulation = newFormulation('Extra "Strong" Formula', "Bath & Body", { code: "FML-0099" });
    const version = newVersion(formulation.id, [], { versionNumber: 1 });

    const downloads: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();

    render(<ExportMenu formulation={formulation} version={version} effectiveStatus={version.status} />);
    const labels = ["JSON formulation package", "CSV formula", "Excel formula sheet", "ERP draft BOM (CSV)", "ERP draft recipe (CSV)"];
    for (let i = 0; i < labels.length; i++) {
      await userEvent.click(screen.getByRole("button", { name: /export/i }));
      await userEvent.click(screen.getByText(labels[i]));
      await waitFor(() => expect(downloads).toHaveLength(i + 1));
      // The menu closes itself asynchronously after each export — wait for
      // that before opening it again, or the next open click would instead
      // toggle a still-open menu shut.
      await waitFor(() => expect(screen.queryByText(labels[i])).not.toBeInTheDocument());
    }

    expect(downloads).toHaveLength(5);
    for (const name of downloads) {
      expect(name.startsWith("FORM_Bath-&-Body_Extra-Strong-Formula_FML-0099_V01_")).toBe(true);
      expect(name).not.toMatch(/[<>:"/\\|?*]/);
    }
    clickSpy.mockRestore();
  });
});
