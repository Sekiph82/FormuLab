"""Tests for the LLM JSON-response parser (stdlib only, no network)."""

import json
import unittest

import llm


class ParseJsonTests(unittest.TestCase):
    def test_parses_clean_json(self):
        self.assertEqual(llm.parse_json('{"a": 1}'), {"a": 1})

    def test_strips_markdown_code_fence(self):
        text = "```json\n{\"a\": 1}\n```"
        self.assertEqual(llm.parse_json(text), {"a": 1})

    def test_strips_code_fence_without_json_tag(self):
        text = "```\n{\"a\": 1}\n```"
        self.assertEqual(llm.parse_json(text), {"a": 1})

    def test_recovers_from_trailing_prose_after_the_json_object(self):
        # Some providers append commentary after the object even with JSON
        # mode requested — this is the real-world "Extra data" failure.
        text = '{"a": 1, "b": [1, 2, 3]}\n\nHope this formula helps!'
        self.assertEqual(llm.parse_json(text), {"a": 1, "b": [1, 2, 3]})

    def test_recovers_from_leading_prose_before_the_json_object(self):
        text = 'Sure, here is the formula:\n{"a": 1}'
        self.assertEqual(llm.parse_json(text), {"a": 1})

    def test_recovers_from_leading_and_trailing_prose(self):
        text = 'Here you go:\n{"a": 1}\nLet me know if you need changes.'
        self.assertEqual(llm.parse_json(text), {"a": 1})

    def test_raises_the_original_error_when_no_object_is_present(self):
        with self.assertRaises(json.JSONDecodeError):
            llm.parse_json("not json at all")

    def test_raises_when_a_brace_appears_but_no_valid_json_follows(self):
        with self.assertRaises(json.JSONDecodeError):
            llm.parse_json("the cost is {approximately} unknown")


if __name__ == "__main__":
    unittest.main()
