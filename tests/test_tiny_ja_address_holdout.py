"""Independent synthetic ADDRESS holdout generator contract tests."""
import json
import unittest
from collections import Counter

from scripts.generate_tiny_ja_address_holdout import (
    GROUPS, NEGATIVE_GROUPS, PARTIAL_GROUPS, PER_GROUP, SEED, generate, validate,
)
from scripts.repair_tiny_ja_address_spans import repair_address_spans


class AddressHoldoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = generate()
        cls.cases = cls.data["cases"]

    def test_reproducible_and_balanced(self):
        self.assertEqual(self.data, generate())
        self.assertEqual(self.data["marker"], "SYNTHETIC_FIXTURE")
        self.assertEqual(self.data["seed"], SEED)
        self.assertEqual(len(self.cases), len(GROUPS) * PER_GROUP)
        counts = Counter(item["group"] for item in self.cases)
        self.assertEqual(set(counts), set(GROUPS))
        self.assertEqual(set(counts.values()), {PER_GROUP})

    def test_original_unicode_offsets_and_seed_immutability(self):
        validate(self.cases)
        for row in self.cases:
            for span in row["gold"] + row["seedCandidates"]:
                self.assertEqual(row["text"][span["start"]:span["end"]], span["value"])
            candidate = json.loads(json.dumps(row["seedCandidates"]))
            repair_address_spans(row["text"], row["seedCandidates"])
            self.assertEqual(row["seedCandidates"], candidate)

    def test_negative_and_partial_examples_are_distinct(self):
        for row in self.cases:
            if row["group"] in NEGATIVE_GROUPS:
                self.assertEqual(row["gold"], [], row["id"])
            elif row["group"] in PARTIAL_GROUPS:
                self.assertEqual(row["gold"][0]["value"],
                                 row["seedCandidates"][0]["value"])
            else:
                self.assertGreater(row["gold"][0]["end"],
                                   row["seedCandidates"][0]["end"])

    def test_known_false_positive_titles_are_no_longer_extended(self):
        # This previously exposed over-extension. Keep it as a regression
        # case after the title-context guard is introduced.
        rows = [r for r in self.cases
                if r["group"] in {"title_with_numbers", "title_with_building"}]
        self.assertTrue(rows)
        for row in rows:
            self.assertEqual(
                repair_address_spans(row["text"], row["seedCandidates"]),
                row["seedCandidates"], row["id"],
            )

    def test_malformed_span_rejected(self):
        rows = json.loads(json.dumps(self.cases))
        rows[0]["seedCandidates"][0]["end"] = len(rows[0]["text"]) + 1
        with self.assertRaises(ValueError):
            validate(rows)


if __name__ == "__main__":
    unittest.main()
