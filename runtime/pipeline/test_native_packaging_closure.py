"""Structural regression test — the embedded native packaging authority
(apps/desktop/src-tauri/src/formulation_v2.rs's `materialize_pipeline()`)
must materialize every first-party Python module actually reachable from
run_cli.py/pipeline.py's own import graph. This is the exact class of
defect that shipped `ModuleNotFoundError: No module named 'artifact_naming'`
to production: literature_cache.py's real `import artifact_naming` was
never added to the Rust materialization list, so the app-private
materialized runtime under %APPDATA%\\com.formulab.app\\runtime\\pipeline
was missing the file even though runtime/pipeline/artifact_naming.py
exists in the repo and its own tests already passed — proving the
source-tree tests alone can never catch this class of packaging defect.

Every helper here parses SOURCE TEXT only (ast.parse on file contents,
regex on formulation_v2.rs) — nothing in this file ever `import`s
pipeline/run_cli/literature_cache/etc., so this test's own correctness
never depends on the developer source tree being importable at native
runtime (PKG5); see test_native_packaging_smoke.py for the isolated
runtime import smoke (PKG6), which is deliberately a separate, heavier
subprocess-based test.
"""

from __future__ import annotations

import ast
import os
import re
import unittest

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(PIPELINE_DIR, "..", ".."))
FORMULATION_V2_RS = os.path.join(
    REPO_ROOT, "apps", "desktop", "src-tauri", "src", "formulation_v2.rs"
)

ENTRY_MODULE = "run_cli"

# Modules that genuinely exist as files in runtime/pipeline/ but are
# NOT reachable from run_cli.py/pipeline.py's own real import graph —
# legacy/retired (safety.py/regulatory.py, FVL-03.009/.010), the
# zero-LLM round's deliberately-unwired llm.py, or standalone CLI/test
# tooling. The embedded native runtime must never be required to carry
# any of these (PKG4) — listed explicitly here so a future session
# cannot "fix" a legitimate absence by silently widening the closure.
KNOWN_UNREACHABLE_LEGACY_MODULES = {"llm", "safety", "regulatory", "materials_cli"}


def first_party_imports(module_name: str) -> set[str]:
    """Direct first-party `import X` / `from X import ...` names inside
    module_name.py, found at ANY nesting depth (top-level OR inside a
    function body) — a real ModuleNotFoundError can come from a lazily
    executed import statement, exactly like run_cli.py's own
    `import pipeline` inside `main()`, not only from the top of a file.
    """
    path = os.path.join(PIPELINE_DIR, module_name + ".py")
    with open(path, "r", encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), filename=path)
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.level == 0:
                names.add(node.module.split(".")[0])
    # Only names that are genuinely part of this package (a real .py file
    # sits beside module_name.py) — never a stdlib/third-party name.
    return {n for n in names if os.path.isfile(os.path.join(PIPELINE_DIR, n + ".py"))}


def reachable_closure(entry: str) -> set[str]:
    seen: set[str] = set()
    frontier = [entry]
    while frontier:
        mod = frontier.pop()
        if mod in seen:
            continue
        seen.add(mod)
        frontier.extend(first_party_imports(mod) - seen)
    return seen


def find_missing(required: set[str], materialized: set[str]) -> set[str]:
    return required - materialized


def materialized_pipeline_files() -> set[str]:
    """The REAL file list `materialize_pipeline()` writes into
    `runtime/pipeline`, parsed directly from formulation_v2.rs's own
    source — never hand-duplicated here, so this test can never drift
    from what the native app actually does."""
    with open(FORMULATION_V2_RS, "r", encoding="utf-8") as fh:
        src = fh.read()
    start = src.index("fn materialize_pipeline")
    body_start = src.index("for (name, src) in [", start)
    body_end = src.index("]", body_start)
    body = src[body_start:body_end]
    names = re.findall(r'\("([a-zA-Z0-9_]+)\.py"', body)
    return set(names)


class NativePackagingClosureTests(unittest.TestCase):
    def test_pkg1_artifact_naming_is_materialized(self):
        self.assertIn(
            "artifact_naming",
            materialized_pipeline_files(),
            "literature_cache.py's real `import artifact_naming` is not "
            "matched by a materialize_pipeline() entry — this is the "
            "exact production ModuleNotFoundError regression.",
        )

    def test_pkg2_full_reachable_closure_is_materialized(self):
        required = reachable_closure(ENTRY_MODULE) | {ENTRY_MODULE}
        materialized = materialized_pipeline_files()
        missing = find_missing(required, materialized)
        self.assertEqual(
            missing,
            set(),
            "Modules reachable from run_cli.py/pipeline.py's real import "
            f"graph but NOT in formulation_v2.rs's materialize_pipeline() "
            f"file list: {sorted(missing)}",
        )

    def test_pkg3_the_checker_itself_fails_on_a_deliberately_missing_module(self):
        # A checker that can never fail proves nothing — this proves
        # find_missing() genuinely WOULD have caught the real
        # artifact_naming regression before it shipped.
        missing = find_missing({"a", "b", "c"}, {"a", "b"})
        self.assertEqual(missing, {"c"})

    def test_pkg4_legacy_unreachable_modules_are_not_required(self):
        required = reachable_closure(ENTRY_MODULE) | {ENTRY_MODULE}
        overlap = required & KNOWN_UNREACHABLE_LEGACY_MODULES
        self.assertEqual(
            overlap,
            set(),
            f"{sorted(overlap)} unexpectedly became reachable from "
            "run_cli.py/pipeline.py — either a real new dependency (fix "
            "materialize_pipeline()) or KNOWN_UNREACHABLE_LEGACY_MODULES "
            "needs updating; the embedded runtime must never silently "
            "drag in a dead module.",
        )

    def test_pkg5_closure_computed_from_source_text_only_never_by_importing(self):
        with open(__file__, "r", encoding="utf-8") as fh:
            own_source = fh.read()
        # Structural proof: nothing in this file imports the pipeline
        # package itself to discover its dependencies — only ast.parse()
        # on file text — so this test's correctness never depends on the
        # developer source tree being importable at native runtime.
        for forbidden in ("\nimport pipeline", "\nimport run_cli", "\nimport literature_cache"):
            self.assertNotIn(forbidden, own_source)


if __name__ == "__main__":
    unittest.main()
