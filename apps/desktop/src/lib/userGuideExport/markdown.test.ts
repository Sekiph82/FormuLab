import { describe, expect, it } from "vitest";
import { parseGuideMarkdown, parseInlineSegments, slugifyHeading } from "./markdown";

describe("slugifyHeading", () => {
  it("matches the guide's own internal anchor convention", () => {
    expect(slugifyHeading("18. Corrective actions")).toBe("18-corrective-actions");
    expect(slugifyHeading("17. Test definitions")).toBe("17-test-definitions");
  });

  it("strips a slash rather than treating it as a word boundary, matching the guide's own PDF/DOCX-style anchors", () => {
    expect(slugifyHeading("21a. Dossier PDF/DOCX export")).toBe("21a-dossier-pdfdocx-export");
  });
});

describe("parseGuideMarkdown — headings", () => {
  it("parses h1/h2/h3 with stripped inline markup and a real slug id", () => {
    const blocks = parseGuideMarkdown("# Title\n\n## 1. Create a **project**\n\n### Sub");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Title", id: "title" },
      { kind: "heading", level: 2, text: "1. Create a project", id: "1-create-a-project" },
      { kind: "heading", level: 3, text: "Sub", id: "sub" },
    ]);
  });
});

describe("parseGuideMarkdown — paragraphs and wrapped lines", () => {
  it("joins wrapped paragraph lines into one block and strips markup", () => {
    const md = "This is a **bold** paragraph\nthat wraps onto a second\nphysical line.";
    const blocks = parseGuideMarkdown(md);
    expect(blocks).toEqual([{ kind: "paragraph", text: "This is a bold paragraph that wraps onto a second physical line." }]);
  });

  it("separates paragraphs on a blank line", () => {
    const blocks = parseGuideMarkdown("First.\n\nSecond.");
    expect(blocks).toEqual([
      { kind: "paragraph", text: "First." },
      { kind: "paragraph", text: "Second." },
    ]);
  });
});

describe("parseGuideMarkdown — lists", () => {
  it("parses an unordered list item, joining its wrapped continuation lines", () => {
    const md = "- **Water q.s.**: mark one line q.s.\n  and it fills automatically to 100%.";
    const blocks = parseGuideMarkdown(md);
    expect(blocks).toEqual([{ kind: "listItem", ordered: false, text: "Water q.s.: mark one line q.s. and it fills automatically to 100%." }]);
  });

  it("parses an ordered list item", () => {
    const blocks = parseGuideMarkdown("1. Pick a product family.\n2. Pick packaging.");
    expect(blocks).toEqual([
      { kind: "listItem", ordered: true, text: "Pick a product family." },
      { kind: "listItem", ordered: true, text: "Pick packaging." },
    ]);
  });

  it("does not merge a new list item into the previous one's continuation", () => {
    const blocks = parseGuideMarkdown("- First item\n- Second item");
    expect(blocks).toEqual([
      { kind: "listItem", ordered: false, text: "First item" },
      { kind: "listItem", ordered: false, text: "Second item" },
    ]);
  });
});

describe("parseGuideMarkdown — callouts", () => {
  it("parses a blockquote as a note callout by default", () => {
    const blocks = parseGuideMarkdown("> This is a plain note.");
    expect(blocks).toEqual([{ kind: "callout", tone: "note", text: "This is a plain note." }]);
  });

  it("recognizes a leading Warning: marker as a warning callout", () => {
    const blocks = parseGuideMarkdown("> **Warning:** approval is irreversible without a new version.");
    expect(blocks).toEqual([{ kind: "callout", tone: "warning", text: "Warning: approval is irreversible without a new version." }]);
  });

  it("joins a multi-line blockquote into one callout", () => {
    const blocks = parseGuideMarkdown("> **Warning:** line one\n> line two continues here.");
    expect(blocks).toEqual([{ kind: "callout", tone: "warning", text: "Warning: line one line two continues here." }]);
  });
});

describe("parseGuideMarkdown — images", () => {
  it("parses a standalone image reference", () => {
    const blocks = parseGuideMarkdown("![Formulation generation](screenshots/formulation-live-generation-light-en.png)");
    expect(blocks).toEqual([{ kind: "image", alt: "Formulation generation", src: "screenshots/formulation-live-generation-light-en.png" }]);
  });
});

describe("parseGuideMarkdown — tables", () => {
  it("parses a GFM pipe table into headers and rows", () => {
    const md = "| Role | Can approve pilot |\n| --- | --- |\n| chemist | yes |\n| researcher | no |";
    const blocks = parseGuideMarkdown(md);
    expect(blocks).toEqual([
      {
        kind: "table",
        headers: ["Role", "Can approve pilot"],
        rows: [
          ["chemist", "yes"],
          ["researcher", "no"],
        ],
      },
    ]);
  });
});

describe("parseGuideMarkdown — code blocks", () => {
  it("parses a fenced code block verbatim (no inline-markup stripping)", () => {
    const blocks = parseGuideMarkdown("```\nconst x = 1;\n```");
    expect(blocks).toEqual([{ kind: "codeBlock", text: "const x = 1;" }]);
  });
});

describe("parseGuideMarkdown — the real guide file parses without throwing", () => {
  it("produces at least one heading and one paragraph for a realistic mixed document", () => {
    const md = [
      "# Guide",
      "",
      "## 1. Section",
      "",
      "Intro paragraph.",
      "",
      "- bullet one",
      "- bullet two",
      "",
      "> **Warning:** be careful.",
      "",
      "![Alt text](screenshots/a-a-a-light-en.png)",
    ].join("\n");
    const blocks = parseGuideMarkdown(md);
    expect(blocks.some((b) => b.kind === "heading")).toBe(true);
    expect(blocks.some((b) => b.kind === "paragraph")).toBe(true);
    expect(blocks.some((b) => b.kind === "listItem")).toBe(true);
    expect(blocks.some((b) => b.kind === "callout")).toBe(true);
    expect(blocks.some((b) => b.kind === "image")).toBe(true);
  });
});

describe("parseInlineSegments", () => {
  it("splits bold runs from plain text, stripping links/code to plain text", () => {
    expect(parseInlineSegments("Plain **bold** plain again")).toEqual([
      { text: "Plain ", bold: false },
      { text: "bold", bold: true },
      { text: " plain again", bold: false },
    ]);
  });

  it("returns a single plain segment for text with no bold", () => {
    expect(parseInlineSegments("just [a link](https://x) and `code`")).toEqual([{ text: "just a link and code", bold: false }]);
  });
});
