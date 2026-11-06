"""Frozen third synthetic ADDRESS safety holdout shape/integrity contracts."""
import json
import unittest
from collections import Counter

from scripts.generate_tiny_ja_address_safety_holdout import (
    generate, validate, GROUPS, MARKER, PER_GROUP, SEED, NOT_ADDRESSES,
    PREFIX_ONLY,
)


class AddressSafetyHoldoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = generate()
        cls.cases = cls.fixture["cases"]

    def test_deterministic_and_balanced(self):
        self.assertEqual(self.fixture, generate())
        self.assertEqual(self.fixture["marker"], MARKER)
        self.assertEqual(self.fixture["seed"], SEED)
        self.assertEqual(len(self.cases), PER_GROUP * len(GROUPS))
        self.assertEqual(set(Counter(c["group"] for c in self.cases).values()),
                         {PER_GROUP})

    def test_gold_offsets(self):
        validate(self.cases)
        for c in self.cases:
            for g in c["gold"] + c["seedCandidates"]:
                self.assertEqual(c["text"][g["start"]:g["end"]], g["value"])

    def test_false_candidates_distinguished_from_gold(self):
        for case in self.cases:
            if case["group"] in NOT_ADDRESSES:
                self.assertEqual(case["gold"], [])
                self.assertEqual(len(case["seedCandidates"]), 1)
            elif case["group"] in PREFIX_ONLY:
                self.assertEqual(case["gold"], case["seedCandidates"])
            else:
                self.assertTrue(case["gold"])
                self.assertGreaterEqual(
                    case["gold"][0]["end"], case["seedCandidates"][0]["end"]
                )

    def test_reject_invalid_spans(self):
        invalid = json.loads(json.dumps(self.cases))
        invalid[0]["gold"][0]["start"] += 1
        with self.assertRaises(ValueError):
            validate(invalid)


if __name__ == "__main__":
    unittest.main()
