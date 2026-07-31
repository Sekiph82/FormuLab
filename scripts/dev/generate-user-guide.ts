/**
 * CLI entry point: regenerates `docs/generated/FormuLab-User-Guide.{pdf,docx}`
 * from `docs/USER_GUIDE.md` (the single source of truth — see
 * `apps/desktop/src/lib/userGuideExport/`).
 *
 * Usage (from the repo root):
 *   pnpm exec tsx scripts/dev/generate-user-guide.ts
 */
import { generateUserGuideDocuments } from "../../apps/desktop/src/lib/userGuideExport/generate";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");

void (async () => {
  const result = await generateUserGuideDocuments({
    repoRoot,
    // Fixed, not `new Date()` — deterministic regeneration for identical
    // source content (see `generate.ts`'s own doc comment).
    generationTimestamp: "2026-01-01T00:00:00.000Z",
  });

  console.log(`PDF:  ${result.pdfPath} (${result.pdfBytes.length} bytes)`);
  console.log(`DOCX: ${result.docxPath} (${result.docxBytes.length} bytes)`);
})();
