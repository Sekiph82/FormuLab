"""Tests for the Phase 14 Session 0 CanonicalPaper schema, deduplication
algorithm, and adapter-boundary contract (`canonical_paper.py`) — a dormant
module not yet wired into the live pipeline, directly testable on its own."""

import unittest

from canonical_paper import (
    SOURCE_AVAILABILITY,
    CanonicalPaper,
    LiteratureAdapter,
    ProvenanceEntry,
    author_surnames,
    deduplicate,
    normalize_doi,
    normalize_title,
)


def row(source_db, title, doi="", authors="", abstract="", is_oa=False, oa_url="", year="2020", venue=""):
    return {
        "source_db": source_db, "title": title, "year": year, "authors": authors,
        "venue": venue, "doi": doi, "is_oa": is_oa, "oa_url": oa_url,
        "cited_by": 0, "concepts": "", "abstract": abstract,
    }


class NormalizationTests(unittest.TestCase):
    def test_normalize_doi_strips_prefix_case_and_whitespace(self):
        self.assertEqual(normalize_doi("https://doi.org/10.1234/ABC.2020"), "10.1234/abc.2020")
        self.assertEqual(normalize_doi("  10.1/X  "), "10.1/x")
        self.assertEqual(normalize_doi(None), "")
        self.assertEqual(normalize_doi(""), "")

    def test_normalize_title_strips_punctuation_and_case(self):
        self.assertEqual(normalize_title("Shampoo: A Study (2020)!"), "shampoo a study 2020")
        self.assertEqual(normalize_title(None), "")

    def test_author_surnames_handles_semicolon_separated_full_names(self):
        # OpenAlex-style "Given Surname" — the last token is genuinely the
        # surname, exactly the format this deliberately simple heuristic is
        # designed for.
        self.assertEqual(author_surnames("Jane Doe; John A. Smith"), {"doe", "smith"})

    def test_author_surnames_on_comma_separated_surname_first_input_is_non_empty_not_crashing(self):
        # Europe-PMC-style "Surname Initials" is comma-separated and
        # surname-FIRST — this heuristic doesn't detect that (documented in
        # its own doc comment: a wrong single-name extraction only costs a
        # missed merge, never a wrong one). The contract under test here is
        # only "never crashes, never returns empty for real input" — exact
        # per-name correctness on this format is deliberately out of scope.
        result = author_surnames("Doe J, Smith JA")
        self.assertEqual(len(result), 2)

    def test_author_surnames_empty_input(self):
        self.assertEqual(author_surnames(""), set())
        self.assertEqual(author_surnames(None), set())


class DeduplicateDoiTierTests(unittest.TestCase):
    def test_same_doi_from_two_sources_merges_into_one_canonical_paper(self):
        rows = [
            row("openalex", "Shampoo Formulation Study", doi="10.1/x", abstract="short"),
            row("crossref", "Shampoo Formulation Study", doi="https://doi.org/10.1/X", abstract="a much longer richer abstract with more detail"),
        ]
        result = deduplicate(rows)
        self.assertEqual(len(result), 1)
        paper = result[0]
        self.assertEqual(paper.doi, "10.1/x")
        self.assertEqual(len(paper.sources), 2, "both contributing rows must be preserved as provenance")
        self.assertEqual(paper.unique_source_count, 2)
        self.assertEqual({s.source for s in paper.sources}, {"openalex", "crossref"})

    def test_representative_record_prefers_the_longest_abstract(self):
        rows = [
            row("openalex", "T", doi="10.1/x", abstract="short"),
            row("crossref", "T", doi="10.1/x", abstract="a much longer richer abstract with more detail"),
        ]
        paper = deduplicate(rows)[0]
        self.assertEqual(paper.abstract, "a much longer richer abstract with more detail")

    def test_provenance_raw_row_is_preserved_verbatim(self):
        original = row("openalex", "T", doi="10.1/x", abstract="x")
        result = deduplicate([original])
        self.assertEqual(result[0].sources[0].raw, original)
        self.assertIsNot(result[0].sources[0].raw, None)

    def test_different_doi_never_merges(self):
        rows = [row("openalex", "T", doi="10.1/x"), row("crossref", "T", doi="10.1/y")]
        result = deduplicate(rows)
        self.assertEqual(len(result), 2)

    def test_oa_url_prefers_an_actually_open_access_link(self):
        rows = [
            row("crossref", "T", doi="10.1/x", is_oa=False, oa_url="https://publisher.example/landing"),
            row("openalex", "T", doi="10.1/x", is_oa=True, oa_url="https://repo.example/paper.pdf"),
        ]
        paper = deduplicate(rows)[0]
        self.assertTrue(paper.is_oa, "OA status merges to true if ANY contributing source marks it OA")
        self.assertEqual(paper.oa_url, "https://repo.example/paper.pdf")


class DeduplicateNoDoiTierTests(unittest.TestCase):
    def test_matching_title_and_overlapping_author_merges_without_a_doi(self):
        rows = [
            row("arxiv", "Novel Gel Thickener System", authors="Jane Doe; Ali Yilmaz"),
            row("openaire", "Novel Gel Thickener System", authors="J. Doe"),
        ]
        result = deduplicate(rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(len(result[0].sources), 2)

    def test_matching_title_but_no_author_overlap_stays_distinct(self):
        # Same generic title, genuinely different authors/studies — the weak
        # single signal (title alone) must NOT be enough to merge.
        rows = [
            row("arxiv", "A Review of Surfactants", authors="Jane Doe"),
            row("openaire", "A Review of Surfactants", authors="Ali Yilmaz"),
        ]
        result = deduplicate(rows)
        self.assertEqual(len(result), 2, "title match alone must never merge two different studies")

    def test_overlapping_author_but_different_title_stays_distinct(self):
        rows = [
            row("arxiv", "Gel Thickener Study", authors="Jane Doe"),
            row("openaire", "Completely Different Topic", authors="Jane Doe"),
        ]
        result = deduplicate(rows)
        self.assertEqual(len(result), 2)

    def test_blank_title_rows_never_mass_merge(self):
        rows = [row("arxiv", "", authors="Jane Doe"), row("openaire", "", authors="Jane Doe")]
        result = deduplicate(rows)
        self.assertEqual(len(result), 2, "an empty title must never become a wildcard merge key")

    def test_single_no_doi_row_survives_as_its_own_canonical_paper(self):
        result = deduplicate([row("arxiv", "Solo Paper", authors="Jane Doe")])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].unique_source_count, 1)


class DeduplicateMixedTests(unittest.TestCase):
    def test_a_realistic_mixed_batch_produces_the_expected_canonical_count(self):
        rows = [
            row("openalex", "Shampoo A", doi="10.1/a"),
            row("crossref", "Shampoo A", doi="10.1/a"),
            row("europepmc", "Shampoo B", doi="10.1/b"),
            row("arxiv", "Unrelated Preprint", authors="X Y"),
            row("openaire", "Unrelated Preprint", authors="X Y"),
        ]
        result = deduplicate(rows)
        self.assertEqual(len(result), 3, "two DOI groups + one no-DOI title/author match = 3 canonical papers")
        total_provenance = sum(len(p.sources) for p in result)
        self.assertEqual(total_provenance, len(rows), "no row is ever dropped, only grouped")

    def test_result_order_is_deterministic_for_the_same_input(self):
        rows = [row("openalex", "A", doi="10.1/a"), row("crossref", "B", doi="10.1/b")]
        first = [p.doi for p in deduplicate(rows)]
        second = [p.doi for p in deduplicate(rows)]
        self.assertEqual(first, second)


class SourceAvailabilityTests(unittest.TestCase):
    def test_institutional_and_scraping_sources_are_marked_unavailable_with_a_reason(self):
        for name in ("ieee_xplore", "scopus", "web_of_science", "google_scholar"):
            entry = SOURCE_AVAILABILITY[name]
            self.assertEqual(entry["status"], "unavailable", name)
            self.assertTrue(entry["note"], f"{name} must record WHY it's unavailable, not just that it is")

    def test_currently_live_default_sources_are_marked_existing(self):
        for name in ("openalex", "openaire", "europepmc", "crossref"):
            self.assertEqual(SOURCE_AVAILABILITY[name]["status"], "existing", name)

    def test_arxiv_is_recorded_as_existing_but_not_default(self):
        self.assertEqual(SOURCE_AVAILABILITY["arxiv"]["status"], "existing_not_default")


class AdapterBoundaryTests(unittest.TestCase):
    def test_a_conforming_adapter_satisfies_the_protocol(self):
        class FakeAdapter:
            def search(self, query, max_results):
                return []

        self.assertIsInstance(FakeAdapter(), LiteratureAdapter)

    def test_a_non_conforming_object_does_not_satisfy_the_protocol(self):
        class NotAnAdapter:
            pass

        self.assertNotIsInstance(NotAnAdapter(), LiteratureAdapter)


class SchemaShapeTests(unittest.TestCase):
    def test_canonical_paper_and_provenance_entry_hold_the_documented_fields(self):
        entry = ProvenanceEntry(source="openalex", source_id="10.1/x", retrieved_at="2026-01-01T00:00:00Z", raw={"k": "v"})
        paper = CanonicalPaper(
            title="T", year="2020", authors="A", venue="V", doi="10.1/x",
            is_oa=True, oa_url="https://x", abstract="abs", sources=[entry],
        )
        self.assertEqual(paper.source_names, ["openalex"])
        self.assertEqual(paper.unique_source_count, 1)


if __name__ == "__main__":
    unittest.main()
