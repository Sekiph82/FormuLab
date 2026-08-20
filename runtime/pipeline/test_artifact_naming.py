"""FVL-04.026 -- NAME1-NAME12/NAME30 acceptance for the Python literature-
naming adapter (`artifact_naming.py`), proving it agrees EXACTLY with the
TypeScript adapter via the shared golden vectors file -- never a separately
authored/duplicated fixture.
"""

import json
import os
import unittest

import artifact_naming as an

_GOLDEN_VECTORS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "packages", "shared", "src", "engine", "artifactNaming.goldenVectors.json",
)


def _load_vectors():
    with open(_GOLDEN_VECTORS_PATH, encoding="utf-8") as fh:
        return json.load(fh)


class GoldenVectorTests(unittest.TestCase):
    """NAME1-NAME12: every golden vector the TypeScript adapter produced is
    reproduced EXACTLY by this Python adapter -- proves NAME30 (cross-
    language agreement) is real, not asserted."""

    def test_golden_vectors_file_exists_and_is_non_empty(self):
        vectors = _load_vectors()
        self.assertGreater(len(vectors), 10)

    def test_every_golden_vector_matches(self):
        vectors = _load_vectors()
        for v in vectors:
            inp = v["input"]
            with self.subTest(name=v["name"]):
                filename = an.literature_filename(
                    inp.get("firstAuthor"), inp.get("year"), inp.get("title"),
                    inp["stableSourceId"], inp["extension"],
                )
                self.assertEqual(filename, v["expectedFilename"], v["name"])
                display = an.literature_display_title(inp.get("firstAuthor"), inp.get("year"), inp.get("title"))
                self.assertEqual(display, v["expectedDisplayTitle"], v["name"])


class SanitizerUnitTests(unittest.TestCase):
    def test_strips_windows_illegal_and_control_chars(self):
        self.assertEqual(an.sanitize_filename_component('a<b>c:d"e/f\\g|h?i*j\x01k'), "abcdefghijk")

    def test_reserved_device_names_are_disambiguated(self):
        for reserved in ["CON", "con", "PRN", "AUX", "NUL", "COM1", "LPT9"]:
            self.assertNotEqual(an.sanitize_filename_component(reserved).upper(), reserved.upper())

    def test_doi_slashes_become_hyphens_never_empty(self):
        self.assertEqual(an.sanitize_id_component("10.1234/abc/def"), "10.1234-abc-def")
        self.assertEqual(an.sanitize_id_component(""), "UNKNOWN-ID")

    def test_collision_resistance_two_ids_same_title(self):
        a = an.literature_filename("Kumar", 2020, "Identical Title For Collision Test", "10.1111/id-a", "pdf")
        b = an.literature_filename("Kumar", 2020, "Identical Title For Collision Test", "10.2222/id-b", "pdf")
        self.assertNotEqual(a, b)

    def test_deterministic_same_input_same_output(self):
        args = ("Reyes", 2021, "Repeatability Check", "10.1/repeat", "pdf")
        results = {an.literature_filename(*args) for _ in range(5)}
        self.assertEqual(len(results), 1)

    def test_no_llm_reference_in_module(self):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifact_naming.py")
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        for token in ("openai", "anthropic.com", "generativelanguage", "chat/completions"):
            self.assertNotIn(token, src.lower())

    def test_no_second_literature_library_registry(self):
        # literature_cache.py's own library/index.json remains the ONE
        # shared literature index — this naming module declares no
        # competing store of its own.
        this_dir = os.path.dirname(os.path.abspath(__file__))
        for f in ("literature_cache.py", "canonical_paper.py", "provenance.py"):
            with open(os.path.join(this_dir, f), encoding="utf-8") as fh:
                src = fh.read()
            self.assertNotIn("index2.json", src)
        with open(os.path.join(this_dir, "artifact_naming.py"), encoding="utf-8") as fh:
            naming_src = fh.read()
        self.assertNotIn("open(", naming_src)  # pure string transforms only, no file I/O of its own


if __name__ == "__main__":
    unittest.main()
