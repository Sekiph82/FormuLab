"""Tests for the new Phase 14 Session 1 native fetchers/resolver added to
`discover.py` (DOAJ, Semantic Scholar, Unpaywall) — mocked HTTP, no network,
same style as the rest of this suite. `discover.py` lives one level up +
sideways (`runtime/skills/core/formulation-discovery/`), so it is imported
the same way `literature_cache._load_fetchers()` already does at runtime.
"""

import json
import os
import sys
import unittest
from unittest import mock

_DISCOVERY = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "skills", "core", "formulation-discovery",
)
if _DISCOVERY not in sys.path:
    sys.path.insert(0, _DISCOVERY)

import discover  # noqa: E402


DOAJ_RESPONSE = {
    "results": [
        {
            "bibjson": {
                "title": "A sulfate-free shampoo study",
                "year": "2021",
                "author": [{"name": "Jane Doe"}, {"name": "John Smith"}],
                "journal": {"title": "J. Cosmetic Sci."},
                "identifier": [
                    {"id": "2314-8535", "type": "pissn"},
                    {"id": "10.1/doaj-example", "type": "doi"},
                ],
                "link": [{"type": "fulltext", "url": "https://example.org/doaj.pdf"}],
                "abstract": "An abstract about a sulfate-free shampoo.",
            }
        }
    ]
}

S2_RESPONSE = {
    "data": [
        {
            "title": "A betaine surfactant study",
            "year": 2019,
            "authors": [{"name": "A. Author"}, {"name": "B. Author"}],
            "venue": "Journal of Surfactants",
            "externalIds": {"DOI": "10.1/s2-example"},
            "abstract": "An abstract about betaine surfactants.",
            "openAccessPdf": {"url": "https://example.org/s2.pdf"},
        }
    ]
}

UNPAYWALL_OA_RESPONSE = {
    "is_oa": True,
    "best_oa_location": {
        "url_for_pdf": "https://example.org/unpaywall.pdf",
        "url": "https://example.org/unpaywall-landing",
    },
}


class DoajFetcherTests(unittest.TestCase):
    def test_parses_real_response_shape(self):
        with mock.patch.object(discover, "_get", return_value=json.dumps(DOAJ_RESPONSE).encode()):
            rows = discover.fetch_doaj("shampoo", 5)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["source_db"], "doaj")
        self.assertEqual(r["title"], "A sulfate-free shampoo study")
        self.assertEqual(r["doi"], "10.1/doaj-example")
        self.assertIn("Jane Doe", r["authors"])
        self.assertIn("John Smith", r["authors"])
        self.assertTrue(r["is_oa"])
        self.assertEqual(r["oa_url"], "https://example.org/doaj.pdf")

    def test_missing_doi_and_link_do_not_crash(self):
        thin = {"results": [{"bibjson": {"title": "No DOI here", "year": "2020"}}]}
        with mock.patch.object(discover, "_get", return_value=json.dumps(thin).encode()):
            rows = discover.fetch_doaj("x", 5)
        self.assertEqual(rows[0]["doi"], "")
        self.assertEqual(rows[0]["oa_url"], "")


class SemanticScholarFetcherTests(unittest.TestCase):
    def test_parses_real_response_shape(self):
        with mock.patch.object(discover, "_get", return_value=json.dumps(S2_RESPONSE).encode()):
            rows = discover.fetch_semantic_scholar("betaine", 5)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["source_db"], "semantic_scholar")
        self.assertEqual(r["doi"], "10.1/s2-example")
        self.assertTrue(r["is_oa"])
        self.assertEqual(r["oa_url"], "https://example.org/s2.pdf")

    def test_no_open_access_pdf_means_not_oa(self):
        no_oa = {"data": [{"title": "Paywalled", "year": 2020, "authors": [],
                            "externalIds": {}, "abstract": "", "openAccessPdf": None}]}
        with mock.patch.object(discover, "_get", return_value=json.dumps(no_oa).encode()):
            rows = discover.fetch_semantic_scholar("x", 5)
        self.assertFalse(rows[0]["is_oa"])
        self.assertEqual(rows[0]["oa_url"], "")


class UnpaywallResolverTests(unittest.TestCase):
    def test_resolves_a_known_doi(self):
        with mock.patch.object(discover, "_get", return_value=json.dumps(UNPAYWALL_OA_RESPONSE).encode()):
            result = discover.resolve_unpaywall_oa("10.1/example")
        self.assertEqual(result, {"is_oa": True, "oa_url": "https://example.org/unpaywall.pdf"})

    def test_empty_doi_returns_none_without_a_network_call(self):
        with mock.patch.object(discover, "_get") as m:
            result = discover.resolve_unpaywall_oa("")
        m.assert_not_called()
        self.assertIsNone(result)

    def test_network_or_parse_failure_returns_none_not_an_exception(self):
        with mock.patch.object(discover, "_get", side_effect=RuntimeError("boom")):
            result = discover.resolve_unpaywall_oa("10.1/example")
        self.assertIsNone(result)

    def test_no_better_location_falls_back_to_url(self):
        resp = {"is_oa": True, "best_oa_location": {"url": "https://example.org/landing"}}
        with mock.patch.object(discover, "_get", return_value=json.dumps(resp).encode()):
            result = discover.resolve_unpaywall_oa("10.1/example")
        self.assertEqual(result["oa_url"], "https://example.org/landing")


class FetchersRegistryTests(unittest.TestCase):
    def test_new_sources_are_registered(self):
        self.assertIn("doaj", discover.FETCHERS)
        self.assertIn("semantic_scholar", discover.FETCHERS)
        # Unpaywall is a resolver, never a query-based FETCHERS entry
        # (Session 1 brief: "Unpaywall is primarily an OA-location resolver,
        # not a normal search index").
        self.assertNotIn("unpaywall", discover.FETCHERS)


if __name__ == "__main__":
    unittest.main()
