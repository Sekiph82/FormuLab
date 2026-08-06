// xlsx is installed from a direct CDN tarball URL (see apps/desktop's
// package.json), not the npm registry — pnpm 9.4.0's `pnpm patch` command
// cannot resolve a version for it ("No matching version found for
// xlsx@0.20.3", even though that is exactly the version pnpm's own lockfile
// resolved and installed), so it cannot use the same `pnpm.patchedDependencies`
// mechanism every other stripped-sourcemap dependency in this repo uses.
// This script achieves the identical outcome (no .map files shipped in the
// installed package) the only reproducible way available for a tarball-URL
// dependency: delete them after every install, via this postinstall hook.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

function findXlsxDistDirs(root) {
  const pnpmDir = join(root, "node_modules", ".pnpm");
  let entries;
  try {
    entries = readdirSync(pnpmDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith("xlsx@"))
    .map((name) => join(pnpmDir, name, "node_modules", "xlsx", "dist"))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

const distDirs = findXlsxDistDirs(new URL("../..", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1"));
let removed = 0;
for (const dir of distDirs) {
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".map")) {
      rmSync(join(dir, file));
      removed++;
    }
  }
}
if (removed > 0) {
  console.log(`strip-xlsx-sourcemaps: removed ${removed} .map file(s) from the installed xlsx package.`);
}
