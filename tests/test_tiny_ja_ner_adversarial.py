"""Synthetic Japanese NER adversarial corpus contract tests. No private data."""
import json
import unittest
from collections import Counter

from scripts.generate_tiny_ja_ner_adversarial import (
    GROUPS, MARKER, PER_GROUP, SEED, generate, render, validate,
)


class AdversarialFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = generate()

    def test_determinism_and_balance(self):
        self.assertEqual(self.fixture, generate(seed=SEED, per_group=PER_GROUP))
        self.assertEqual(self.fixture["marker"], MARKER)
        self.assertEqual(len(self.fixture["cases"]), len(GROUPS) * PER_GROUP)
        self.assertEqual(
            set(Counter(c["group"] for c in self.fixture["cases"]).values()),
            {PER_GROUP},
        )

    def test_unicode_code_point_spans(self):
        validate(self.fixture["cases"])
        for case in self.fixture["cases"]:
            for item in case["gold"]:
                self.assertEqual(
                    case["text"][item["start"]:item["end"]], item["value"]
                )
        self.assertTrue(any("\u3099" in c["text"] for c in self.fixture["cases"]))
        self.assertTrue(any("１２－３－５" in c["text"] for c in self.fixture["cases"]))

    def test_repeated_values_have_distinct_offsets(self):
        text, gold = render(
            "{person}と{person}。",
            {"person": ("星舟結羽", "PERSON")},
        )
        self.assertEqual(text, "星舟結羽と星舟結羽。")
        self.assertEqual(len(gold), 2)
        self.assertNotEqual(gold[0]["start"], gold[1]["start"])
        self.assertEqual([g["value"] for g in gold], ["星舟結羽"] * 2)

    def test_negatives_and_truncation_are_explicit(self):
        cases = self.fixture["cases"]
        negatives = [c for c in cases if c["group"] == "difficult_negatives"]
        truncated = [c for c in cases if c["group"] == "truncation_tail"]
        self.assertTrue(all(not c["gold"] for c in negatives))
        self.assertTrue(all(c["gold"] for c in truncated))
        # CLS + 94 content tokens + SEP => anything after 108 characters is missed.
        self.assertTrue(all(min(g["start"] for g in c["gold"]) > 94 for c in truncated))

    def test_validation_rejects_bad_or_overlapping_spans(self):
        bad = json.loads(json.dumps(self.fixture["cases"]))
        first = next(c for c in bad if c["gold"])
        first["gold"][0]["end"] += 1
        with self.assertRaises(ValueError):
            validate(bad)
        with self.assertRaises(ValueError):
            generate(per_group=0)


if __name__ == "__main__":
    unittest.main()
