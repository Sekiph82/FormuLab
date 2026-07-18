import { describe, expect, it } from "vitest";
import type { ArtifactInspector } from "@ai4s/shared";
import {
  artifactBlockToInspector,
  extractArtifactRefs,
  extToKind,
  fileInspectorFromBlock,
  previewKind,
  previewKindForName,
  resolveArtifactContent,
} from "./artifacts";


describe("extToKind", () => {
  it("maps extensions to kinds and defaults unknown to data", () => {
    expect(extToKind("png")).toBe("figure");
    expect(extToKind("PY")).toBe("script");
    expect(extToKind("csv")).toBe("table");
    expect(extToKind("ipynb")).toBe("notebook");
    expect(extToKind("pdf")).toBe("report");
    expect(extToKind("xyz")).toBe("data");
  });
});

describe("resolveArtifactContent", () => {
  const data: ArtifactInspector = {
    variant: "artifact",
    title: "fig.py",
    versions: [
      { label: "v1", code: "old", reviewPassed: false },
      { label: "v2" },
    ],
    activeVersion: "v2",
    reviewPassed: true,
    inputs: [],
    code: "new",
    language: "python",
  };

  it("uses the version override when present", () => {
    const r = resolveArtifactContent(data, "v1");
    expect(r.code).toBe("old");
    expect(r.reviewPassed).toBe(false);
  });

  it("falls back to inspector-level fields when the version omits them", () => {
    const r = resolveArtifactContent(data, "v2");
    expect(r.code).toBe("new");
    expect(r.reviewPassed).toBe(true);
  });
});

describe("extractArtifactRefs", () => {
  it("finds files produced by running code, even in prose/backticks", () => {
    const md = "Generated `canvas-project/canvas.pdf` (A4) and a preview at report/index.html.";
    expect(extractArtifactRefs(md)).toEqual(["canvas-project/canvas.pdf", "report/index.html"]);
  });

  it("dedupes and ignores URLs", () => {
    const md = "See figs/a.png and figs/a.png, not https://example.com/b.png";
    expect(extractArtifactRefs(md)).toEqual(["figs/a.png"]);
  });

  it("returns nothing when no artifact-like paths are present", () => {
    expect(extractArtifactRefs("just a sentence about e.g. things")).toEqual([]);
  });

  it("finds Office documents (docx/xlsx/pptx)", () => {
    const md = "Wrote project.docx, project.xlsx and project.pptx.";
    expect(extractArtifactRefs(md)).toEqual(["project.docx", "project.xlsx", "project.pptx"]);
  });

  it("finds files named in non-ASCII scripts (deliverables are named in the user's language)", () => {
    const md = "已交付：青云录_详细剧情梳理.docx，图在 图表/年度趋势.png。";
    expect(extractArtifactRefs(md)).toEqual(["青云录_详细剧情梳理.docx", "图表/年度趋势.png"]);
  });
});

describe("previewKind", () => {
  it("maps extensions to a preview strategy", () => {
    expect(previewKind("html")).toBe("html");
    expect(previewKind("pdf")).toBe("pdf");
    expect(previewKind("png")).toBe("image");
    expect(previewKind("svg")).toBe("image");
    expect(previewKind("py")).toBe("text");
  });

  it("renders markdown files as a formatted document, not plain code", () => {
    expect(previewKind("md")).toBe("markdown");
    expect(previewKind("markdown")).toBe("markdown");
  });

  it("gives Office documents their own inline preview kinds", () => {
    expect(previewKind("docx")).toBe("docx");
    expect(previewKind("xlsx")).toBe("xlsx");
    expect(previewKind("pptx")).toBe("pptx");
  });

  it("renders 3D mesh/CAD files with the mesh viewer", () => {
    for (const ext of ["stl", "obj", "ply", "gltf", "glb"]) {
      expect(previewKind(ext)).toBe("mesh");
    }
  });

  it("renders chemical structure files as molecules", () => {
    for (const ext of [
      "mol", "mol2", "sdf", "smi", "smiles", "cif", "mcif", "mmcif", "pdb", "pqr", "xyz", "cube",
    ]) {
      expect(previewKind(ext)).toBe("molecule");
    }
  });

  it("renders FITS astronomy files with the FITS viewer", () => {
    for (const ext of ["fits", "fit", "fts"]) expect(previewKind(ext)).toBe("fits");
  });
});

describe("previewKindForName", () => {
  it("recognizes extensionless VASP files by filename", () => {
    expect(previewKindForName("DOSCAR")).toBe("dos");
    expect(previewKindForName("run/DOSCAR")).toBe("dos");
    expect(previewKindForName("DOSCAR.dat")).toBe("dos");
    expect(previewKindForName("nacl.dos")).toBe("dos");
    expect(previewKindForName("EIGENVAL")).toBe("bands");
    expect(previewKindForName("run/EIGENVAL")).toBe("bands");
  });

  it("falls back to the extension registry for everything else", () => {
    expect(previewKindForName("sky.fits")).toBe("fits");
    expect(previewKindForName("plot.png")).toBe("image");
    expect(previewKindForName("notes.md")).toBe("markdown");
    expect(previewKindForName("main.py")).toBe("text");
  });
});

describe("artifactBlockToInspector", () => {


  it("routes .ipynb artifacts to the runnable notebook editor, others to file preview", () => {
    const nb = fileInspectorFromBlock({
      kind: "artifact",
      path: "analysis/run.ipynb",
      filename: "run.ipynb",
      artifact: "notebook",
      tool: "write",
    });
    expect(nb).toEqual({ variant: "notebook-file", path: "analysis/run.ipynb" });

    const file = fileInspectorFromBlock({
      kind: "artifact",
      path: "fig.png",
      filename: "fig.png",
      artifact: "figure",
      tool: "write",
    });
    expect(file.variant).toBe("file");
  });

  it("shows a placeholder for a binary artifact", () => {
    const insp = artifactBlockToInspector({
      kind: "artifact",
      path: "figures/atlas.png",
      filename: "atlas.png",
      artifact: "figure",
      tool: "write",
    });
    expect(insp.code).toContain("Binary artifact");
    expect(insp.code).toContain("figures/atlas.png");
  });
});
