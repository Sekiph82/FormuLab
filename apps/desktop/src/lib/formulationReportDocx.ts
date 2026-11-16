import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const HEADINGS = {
  h1: HeadingLevel.TITLE,
  h2: HeadingLevel.HEADING_1,
  h3: HeadingLevel.HEADING_2,
  h4: HeadingLevel.HEADING_3,
  h5: HeadingLevel.HEADING_4,
} as const;

function text(node: Element): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

function tableOf(element: Element): Table {
  const rows = Array.from(element.querySelectorAll("tr"));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, index) => new TableRow({
      tableHeader: index === 0 && row.querySelector("th") !== null,
      children: Array.from(row.querySelectorAll("th,td")).map((cell) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: text(cell), bold: cell.tagName === "TH", size: 18 })] })],
      })),
    })),
  });
}

/** Word blocks for the report HTML: headings, paragraphs and real tables, in document order. */
function blocksOf(parent: Element): Array<Paragraph | Table> {
  const blocks: Array<Paragraph | Table> = [];
  for (const element of Array.from(parent.children)) {
    const tag = element.tagName.toLowerCase();
    if (tag in HEADINGS) {
      blocks.push(new Paragraph({ text: text(element), heading: HEADINGS[tag as keyof typeof HEADINGS] }));
    } else if (tag === "table") {
      blocks.push(tableOf(element), new Paragraph({ text: "" }));
    } else if (tag === "p" || tag === "li") {
      const value = text(element);
      if (value) blocks.push(new Paragraph({ children: [new TextRun({ text: value, size: element.classList.contains("muted") ? 18 : 20 })] }));
    } else if (element.children.length) {
      blocks.push(...blocksOf(element));
    } else if (text(element)) {
      blocks.push(new Paragraph({ text: text(element) }));
    }
  }
  return blocks;
}

/** Render the same complete report HTML as an editable Word document. */
export async function renderFormulationReportDocx(html: string, sessionId: string): Promise<Uint8Array> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const document = new Document({
    creator: "FormuLab",
    title: `FormuLab Report — ${sessionId}`,
    sections: [{
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `FormuLab — ${sessionId} — page `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 })],
          })],
        }),
      },
      children: blocksOf(parsed.body),
    }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}
