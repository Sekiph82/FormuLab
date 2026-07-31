/**
 * Phase 10 Session 6 — orchestrates reading `docs/USER_GUIDE.md` and
 * writing real `docs/generated/FormuLab-User-Guide.{pdf,docx}` files.
 * The single call site both `scripts/dev/generate-user-guide.ts` (CLI) and
 * `generate.test.ts` use — never two independent write paths.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { renderGuideDocx } from "./docx";
import { renderGuidePdf } from "./pdf";

export const GUIDE_COPYRIGHT_NOTICE =
  "Copyright FormuLab contributors. Licensed under the MIT License (see LICENSE).\n" +
  "This guide describes FormuLab's own software behavior only. It does not reproduce, " +
  "summarize, or replace any external regulatory or standards-body publication " +
  "(ISO, ASTM, EN, DIN, AOAC, USP, EP, BS, or similar) — consult the current official " +
  "publication for regulated testing or submissions. FormuLab is decision-support " +
  "software; it is not a source of legal or regulatory compliance, and no output " +
  "described here constitutes regulatory approval.";

export interface GenerateGuideOptions {
  repoRoot: string;
  /** ISO instant, fixed by the caller — never `new Date()` internally, so
   *  the PDF's own creation/modification dates stay deterministic across
   *  regenerations of the same source content. */
  generationTimestamp: string;
}

export interface GenerateGuideResult {
  markdown: string;
  pdfPath: string;
  pdfBytes: Uint8Array;
  docxPath: string;
  docxBytes: Uint8Array;
}

export async function generateUserGuideDocuments(options: GenerateGuideOptions): Promise<GenerateGuideResult> {
  const docsDir = path.join(options.repoRoot, "docs");
  const markdown = fs.readFileSync(path.join(docsDir, "USER_GUIDE.md"), "utf8");

  const pdfBytes = await renderGuidePdf(markdown, {
    docsDir,
    generationTimestamp: options.generationTimestamp,
    copyrightNotice: GUIDE_COPYRIGHT_NOTICE,
    title: "FormuLab User Guide",
  });
  const docxBytes = await renderGuideDocx(markdown, {
    docsDir,
    copyrightNotice: GUIDE_COPYRIGHT_NOTICE,
    title: "FormuLab User Guide",
  });

  const outDir = path.join(docsDir, "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, "FormuLab-User-Guide.pdf");
  const docxPath = path.join(outDir, "FormuLab-User-Guide.docx");
  fs.writeFileSync(pdfPath, pdfBytes);
  fs.writeFileSync(docxPath, docxBytes);

  return { markdown, pdfPath, pdfBytes, docxPath, docxBytes };
}
