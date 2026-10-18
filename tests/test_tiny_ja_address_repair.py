"""Regression tests for conservative ADDRESS-only span extension.

All names/places here are fabricated. No real chat transcripts.
"""
import unittest

from scripts.repair_tiny_ja_address_spans import repair_address_spans


def entity(text, fragment, kind="ADDRESS", offset=0):
    start = text.index(fragment, offset)
    return {"start": start, "end": start + len(fragment), "value": fragment, "type": kind}


class AddressBoundaryRepairTests(unittest.TestCase):
    def check_repair(self, text, predicted, full):
        raw = entity(text, predicted)
        original = raw.copy()
        repaired = repair_address_spans(text, [raw])
        self.assertEqual(raw, original, "Must not mutate model predictions")
        self.assertEqual(len(repaired), 1)
        self.assertEqual(repaired[0]["value"], full)
        self.assertEqual(text[repaired[0]["start"]:repaired[0]["end"]], full)

    def test_numbered_address(self):
        self.check_repair(
            "配送先は雪影市青丘町1-2-3です。",
            "雪影市青丘町", "雪影市青丘町1-2-3",
        )

    def test_chome_suffix_and_fullwidth(self):
        self.check_repair(
            "送り先：星舟市若波町７丁目の角。",
            "星舟市若波町", "星舟市若波町７丁目",
        )
        self.check_repair(
            "住所は月凪市花瀬町四丁目だよ。",
            "月凪市花瀬町", "月凪市花瀬町四丁目",
        )

    def test_building_room(self):
        self.check_repair(
            "集合は月凪市花瀬町1-2-3 星雲ビル203号室です。",
            "月凪市花瀬町", "月凪市花瀬町1-2-3 星雲ビル203号室",
        )
        self.check_repair(
            "集合は月凪市花瀬町 星雲ビル203号室で。",
            "月凪市花瀬町", "月凪市花瀬町 星雲ビル203号室",
        )

    def test_leading_particle_preserved_not_claimed_exact(self):
        self.check_repair(
            "会場は雪影市青丘町1-2-3です。",
            "は雪影市青丘町", "は雪影市青丘町1-2-3",
        )

    def test_do_not_swallow_following_prose(self):
        text = "雪影市青丘町3丁目の会議、明日ね。"
        self.check_repair(text, "雪影市青丘町", "雪影市青丘町3丁目")
        text = "星舟市若波町1-2-3、そこから右へ。"
        self.check_repair(text, "星舟市若波町", "星舟市若波町1-2-3")

    def test_no_hallucinated_entity_and_no_org_change(self):
        text = "雪影市青丘町1-2-3で待ってる。"
        self.assertEqual(repair_address_spans(text, []), [])
        org = entity(text, "雪影市青丘町", "COMPANY")
        self.assertEqual(repair_address_spans(text, [org]), [org])
        text2 = "月凪市で3分待って。"
        span = entity(text2, "月凪市")
        self.assertEqual(repair_address_spans(text2, [span]), [span])

    def test_preserves_codepoint_offsets_and_repeated_entities(self):
        text = "🚃星舟市若波町1-2-3 → 星舟市若波町4-5-6🚶"
        raw1 = entity(text, "星舟市若波町")
        raw2 = entity(text, "星舟市若波町", offset=raw1["end"])
        out = repair_address_spans(text, [raw1, raw2])
        self.assertEqual([p["value"] for p in out],
                         ["星舟市若波町1-2-3", "星舟市若波町4-5-6"])
        self.assertTrue(all(text[p["start"]:p["end"]] == p["value"] for p in out))


if __name__ == "__main__":
    unittest.main()
