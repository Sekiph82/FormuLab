"""Tests for reading downloaded full texts (JATS XML)."""

import os
import tempfile
import unittest

import fulltext

JATS = """<?xml version="1.0"?>
<article>
  <front><article-meta>
    <abstract><p>A toothpaste with 1400 ppm fluoride at pH 4.5 was evaluated.</p></abstract>
  </article-meta></front>
  <body>
    <sec><title>Introduction</title><p>Dental caries is common.</p></sec>
    <sec><title>Materials and methods</title>
      <p>The paste contained 0.5% chitosan and 20% hydrated silica, adjusted to pH 5.5.</p>
    </sec>
    <sec><title>Results</title><p>Fluoride retention rose to 4.33 ppm after one hour.</p></sec>
  </body>
</article>
"""


class FullTextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "paper.xml")
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(JATS)

    def tearDown(self):
        self.tmp.cleanup()

    def test_extracts_abstract_and_composition(self):
        ex = fulltext.excerpt(self.path)
        self.assertIn("1400 ppm fluoride", ex)      # abstract
        self.assertIn("0.5% chitosan", ex)          # methods: what was mixed
        self.assertIn("hydrated silica", ex)

    def test_methods_outrank_introduction(self):
        # What was actually made matters more than background prose.
        ex = fulltext.excerpt(self.path)
        self.assertLess(ex.index("chitosan"), ex.index("Dental caries is common"))

    def test_respects_the_budget(self):
        self.assertLessEqual(len(fulltext.excerpt(self.path, 120)), 120)

    def test_only_reads_xml_we_actually_downloaded(self):
        d = os.path.dirname(self.path)
        self.assertTrue(fulltext.excerpt_for({"pdf_file": "paper.xml"}, d))
        # A PDF needs a parser we do not ship; fall back to the abstract.
        self.assertEqual(fulltext.excerpt_for({"pdf_file": "paper.pdf"}, d), "")
        self.assertEqual(fulltext.excerpt_for({}, d), "")
        self.assertEqual(fulltext.excerpt_for({"pdf_file": "missing.xml"}, d), "")

    def test_unreadable_file_is_not_fatal(self):
        bad = os.path.join(self.tmp.name, "broken.xml")
        with open(bad, "w", encoding="utf-8") as fh:
            fh.write("<article><body><sec>unclosed")
        self.assertEqual(fulltext.excerpt(bad), "")


if __name__ == "__main__":
    unittest.main()
