/**
 * CLI entry point for the Phase 10 documentation fixture — seeds (or
 * resets) a deterministic, DEMO--prefixed profile at `.docs-fixture/`
 * (repo root, gitignored), completely independent of the real
 * `%APPDATA%\com.formulab.app` profile and the real dev checkout's own
 * `data/`/`formulas/`/`.FormuLab/`.
 *
 * Usage (from the repo root):
 *   pnpm exec tsx scripts/dev/seed-docs-fixture.ts            # seed
 *   pnpm exec tsx scripts/dev/seed-docs-fixture.ts --reset    # wipe + reseed
 *   pnpm exec tsx scripts/dev/seed-docs-fixture.ts --root <path>  # override target
 *
 * To actually inspect it in the app, manually point FormuLab's project-root
 * override at the printed path (Settings, or the `formulab-root.txt`
 * pointer under the real app-data `runtime/` folder) — this script never
 * does that itself.
 */
import { defaultDocsFixtureRoot, resetDocsFixture, seedDocsFixture } from "../../apps/desktop/src/lib/docsFixture/fixtureWriter";

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const rootFlagIndex = args.indexOf("--root");
const repoRoot = new URL("../../", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
const root = rootFlagIndex !== -1 ? args[rootFlagIndex + 1] : defaultDocsFixtureRoot(repoRoot);

const plan = reset ? resetDocsFixture(root) : seedDocsFixture(root);
const fileCount = Object.keys(plan.files).length;
console.log(`${reset ? "Reset" : "Seeded"} documentation fixture at ${root} (${fileCount} files).`);
