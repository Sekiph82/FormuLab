"""Tests for the Findpapers-wrapping adapter (Phase 14 Session 1). `findpapers`
itself is not installed in this environment (confirmed: `import findpapers`
raises `ModuleNotFoundError`) — these tests prove the adapter degrades
cleanly without it, conforms to the `LiteratureAdapter` protocol boundary,
and correctly maps a `findpapers`-shaped result when one IS available
(simulated via a fake module injected into `sys.modules`, since installing
the real third-party package is out of scope for this test environment).
"""

import sys
import types
import unittest
from unittest import mock

import canonical_paper
import findpapers_adapter as fa


class AvailabilityTests(unittest.TestCase):
    def test_unavailable_when_findpapers_is_not_installed(self):
        # The real state of this test environment.
        self.assertFalse(fa.findpapers_available())

    def test_search_returns_empty_list_not_an_exception_when_unavailable(self):
        self.assertEqual(fa.FindpapersAdapter().search("shampoo", 5), [])

    def test_conforms_to_the_literature_adapter_protocol(self):
        self.assertIsInstance(fa.FindpapersAdapter(), canonical_paper.LiteratureAdapter)

    def test_source_availability_records_the_not_bundled_status(self):
        entry = canonical_paper.SOURCE_AVAILABILITY["findpapers"]
        self.assertEqual(entry["status"], "existing_not_bundled")


class MappingTests(unittest.TestCase):
    """Simulates `findpapers` being installed, to prove the row-mapping logic
    itself is correct — without depending on the real third-party package."""

    def test_maps_a_findpapers_shaped_result_to_row_shape(self):
        fake_pub = {
            "title": "A betaine surfactant study",
            "authors": ["Jane Doe", "John Smith"],
            "doi": "https://doi.org/10.1/example",
            "year": 2019,
            "urls": ["https://example.org/paper.pdf"],
            "is_open_access": True,
            "abstract": "An abstract.",
            "citations": 4,
        }
        fake_search_result = types.SimpleNamespace(papers=[fake_pub])
        fake_module = types.SimpleNamespace(
            search=lambda outfile, query, limit, databases: None,
            load_search_results=lambda outfile: fake_search_result,
        )
        with mock.patch.dict(sys.modules, {"findpapers": fake_module}):
            with mock.patch.object(fa, "findpapers_available", return_value=True):
                rows = fa.FindpapersAdapter().search("betaine surfactant", 5)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["source_db"], "findpapers")
        self.assertEqual(r["title"], "A betaine surfactant study")
        self.assertEqual(r["doi"], "10.1/example")
        self.assertIn("Jane Doe", r["authors"])
        self.assertTrue(r["is_oa"])
        self.assertEqual(r["oa_url"], "https://example.org/paper.pdf")
        self.assertEqual(r["cited_by"], 4)

    def test_a_findpapers_internal_failure_returns_empty_not_an_exception(self):
        def boom(*a, **k):
            raise RuntimeError("findpapers internal error")
        fake_module = types.SimpleNamespace(search=boom, load_search_results=lambda outfile: None)
        with mock.patch.dict(sys.modules, {"findpapers": fake_module}):
            with mock.patch.object(fa, "findpapers_available", return_value=True):
                rows = fa.FindpapersAdapter().search("x", 5)
        self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
