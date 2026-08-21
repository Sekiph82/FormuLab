"""PKG6 — isolated embedded-runtime import smoke test.

Materializes the SAME files the native Rust `materialize_pipeline()`
(apps/desktop/src-tauri/src/formulation_v2.rs) writes into a disposable
temp directory containing ONLY those files (never the full repository
tree), then imports `pipeline` from there as a subprocess with a
PYTHONPATH restricted to that directory — proving the exact import
chain (run_cli -> pipeline -> literature_cache -> artifact_naming, and
every other reachable first-party module) loads without relying on the
repository root being importable.

Running `python runtime/pipeline/run_cli.py` from the repo root would
NOT prove this: the repo root already has every module importable
regardless of what `materialize_pipeline()` actually copies, so it can
never reproduce a materialization gap the way the real native app can.

Deliberately import-only (never calls `pipeline.run()`/network
literature retrieval) — the import boundary alone is exactly where the
real production defect (`ModuleNotFoundError: No module named
'artifact_naming'`) occurred, and this keeps the regression test fast,
deterministic, and offline.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(PIPELINE_DIR, "..", ".."))
FORMULATION_V2_RS = os.path.join(
    REPO_ROOT, "apps", "desktop", "src-tauri", "src", "formulation_v2.rs"
)
DISCOVER_SRC = os.path.join(
    REPO_ROOT, "runtime", "skills", "core", "formulation-discovery", "discover.py"
)


def materialized_pipeline_files() -> list[str]:
    with open(FORMULATION_V2_RS, "r", encoding="utf-8") as fh:
        src = fh.read()
    start = src.index("fn materialize_pipeline")
    body_start = src.index("for (name, src) in [", start)
    body_end = src.index("]", body_start)
    body = src[body_start:body_end]
    return [f"{m}.py" for m in re.findall(r'\("([a-zA-Z0-9_]+)\.py"', body)]


class IsolatedMaterializedRuntimeImportSmokeTest(unittest.TestCase):
    def test_pkg6_isolated_materialized_runtime_import_succeeds(self):
        files = materialized_pipeline_files()
        self.assertIn("artifact_naming.py", files)

        with tempfile.TemporaryDirectory(prefix="formulab-native-pkg-smoke-") as tmp:
            pipe_dir = os.path.join(tmp, "runtime", "pipeline")
            os.makedirs(pipe_dir, exist_ok=True)
            for name in files:
                shutil.copyfile(os.path.join(PIPELINE_DIR, name), os.path.join(pipe_dir, name))

            # literature_cache.py expects discover.py at the sibling
            # ../skills/core/formulation-discovery/ location — the exact
            # layout the real Rust materialize_pipeline() produces.
            disc_dir = os.path.join(
                tmp, "runtime", "skills", "core", "formulation-discovery"
            )
            os.makedirs(disc_dir, exist_ok=True)
            shutil.copyfile(DISCOVER_SRC, os.path.join(disc_dir, "discover.py"))

            env = dict(os.environ)
            env.pop("PYTHONPATH", None)
            proc = subprocess.run(
                [sys.executable, "-c", "import pipeline; print('IMPORT_OK')"],
                capture_output=True,
                text=True,
                cwd=pipe_dir,
                env=env,
                timeout=30,
            )

            self.assertNotIn(
                "ModuleNotFoundError",
                proc.stderr,
                "Isolated materialized runtime failed to import a "
                f"required module.\nstderr:\n{proc.stderr}",
            )
            self.assertEqual(
                proc.returncode,
                0,
                f"Isolated import failed.\nstdout: {proc.stdout}\nstderr:\n{proc.stderr}",
            )
            self.assertIn("IMPORT_OK", proc.stdout)


if __name__ == "__main__":
    unittest.main()
