// Tauri copies each bundle resource folder whole (tauri.conf.json `bundle.resources`), so Python
// caches left by local test runs would ship in the MSI/NSIS installers. Remove them before a build.
import { readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const folders = ["runtime/skills/core", "runtime/harness", "examples/shampoo-formulation", "examples/surface-cleaner"];
const caches = new Set(["__pycache__", ".pytest_cache"]);
let removed = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (caches.has(entry.name)) {
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    } else {
      walk(path);
    }
  }
}

for (const folder of folders) walk(join(root, folder));
console.log(`bundle resources: removed ${removed} cache folder(s)`);
