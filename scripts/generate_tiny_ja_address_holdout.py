#!/usr/bin/env python3
"""A second, independently authored synthetic-only address challenge.

Do NOT feed this corpus to training or use gold prefixes in a real detector.
Unlike the NER adversarial generator, this has new lexicons, templates and
address formats, plus seeded false-positive candidates to measure overreach.
"""
from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path

MARKER = "SYNTHETIC_FIXTURE"
SEED = 20261018 + 47
PER_GROUP = 12

# Entirely fictional names, not mined from users or real address registers.
PREFECTURES = ("鈴ノ瀬", "璃星", "夕音", "遥波", "琴霞", "霧灯")
CITIES = ("天弓", "紺凪", "蜜羽", "秋琴", "虹瀬", "雫音")
TOWNS = ("青翡翠", "白雲", "虹浜", "秋灯", "夕燕", "朝羽")
BUILDINGS = ("夕雲プラザ", "翡翠レジデンス", "三日月荘", "羽根テラス")

# The content of templates and ground truth is deliberately independent of
# the previous ADDRESS repair implementation. The seed is a simulated
# *already existing* ADDRESS prediction, never given to the actual model.
GROUPS = {
    "chain_chome_bango": "集合場所は{address}、入口右です。",
    "kanji_chome_bango": "こちらへ：{address}（玄関前）。",
    "lot_no": "宛先：{address}。宛名不要。",
    "prolonged_dash": "ピンは{address}です。",
    "em_dash": "荷物は{address}にお願い。",
    "mixed_block": "📍住所：{address}。",
    "unknown_building": "部屋は{address}に変更された。",
    "building_without_number": "会場：{address}で開催。",
    "subdistrict_aza": "送付先は{address}になります。",
    "floor_marker": "待ち合わせは{address}。",
    "postal_prefix": "〒９９９ー１２３４　{address}まで送って。",
    "room_chome": "連絡事項：{address}に移った。",
    "prose_suffix": "{address}3-5分で着くはず。",
    "title_with_numbers": "タイトルは『{address}』です。",
    "title_with_building": "映画『{address}』を観た。",
    "nonaddress_counter": "{address}3番目の案を選ぼう。",
}

NEGATIVE_GROUPS = {"title_with_numbers", "title_with_building"}
# Only the existing base town is a location in these examples: following
# numbers describe a duration or an ordinal, not a street-number extension.
PARTIAL_GROUPS = {"prose_suffix", "nonaddress_counter"}


def build_fields(rng: random.Random):
    root = (
        f"{rng.choice(PREFECTURES)}県"
        f"{rng.choice(CITIES)}市"
        f"{rng.choice(TOWNS)}町"
    )
    a, b, c = [rng.randint(1, 9) for _ in range(3)]
    kanji = rng.choice(("一", "三", "五", "九"))
    return root, a, b, c, kanji


def render_group(group: str, rng: random.Random, index: int) -> dict:
    root, a, b, c, kanji = build_fields(rng)
    forms = {
        "chain_chome_bango": f"{root}{a}丁目{b}番{c}号",
        "kanji_chome_bango": f"{root}{kanji}丁目{b}番{c}号",
        "lot_no": f"{root}{a}番地の{b}",
        "prolonged_dash": f"{root}４ー{b}ー{c}",
        "em_dash": f"{root}{a}―{b}―{c}",
        "mixed_block": f"{root}{a}－{b}番{c}号",
        "unknown_building": f"{root}{a}-{b} {rng.choice(BUILDINGS)}B棟{c}02号室",
        "building_without_number": f"{root} {rng.choice(BUILDINGS)}",
        "subdistrict_aza": f"{root}字風待{a}番地",
        "floor_marker": f"{root}{a}-{b} {rng.choice(BUILDINGS)}{c}F",
        "postal_prefix": f"{root}{a}丁目{b}-{c}",
        "room_chome": f"{root}{kanji}丁目{b}号棟{c}02号室",
        "prose_suffix": root,
        "title_with_numbers": f"{root}{a}-{b}",
        "title_with_building": f"{root}銀河ビル",
        "nonaddress_counter": root,
    }
    value = forms[group]
    text = GROUPS[group].format(address=value)
    start = text.index(value)
    gold = [] if group in NEGATIVE_GROUPS else [
        {"start": start, "end": start + len(value),
         "type": "ADDRESS", "value": value}
    ]
    # A perfect prefix detector: this is an upper bound on what boundary-only
    # postprocessing could do, not an actual model prediction.
    seed = [{"start": start, "end": start + len(root),
             "type": "ADDRESS", "value": root}]
    return {"id": f"holdout-{group}-{index + 1:03d}",
            "group": group, "text": text, "gold": gold,
            "seedCandidates": seed}


def validate(cases: list[dict]) -> None:
    seen = set()
    for row in cases:
        if row["id"] in seen:
            raise ValueError(f"duplicate case {row['id']}")
        seen.add(row["id"])
        text = row["text"]
        for item in row["gold"] + row["seedCandidates"]:
            if (item["type"] != "ADDRESS" or
                not 0 <= item["start"] < item["end"] <= len(text) or
                text[item["start"]:item["end"]] != item["value"]):
                raise ValueError(f"bad synthetic code-point offset: {row['id']}")
        if row["group"] in NEGATIVE_GROUPS and row["gold"]:
            raise ValueError(f"negative example has labeled PII: {row['id']}")
    counts = Counter(c["group"] for c in cases)
    if set(counts) != set(GROUPS) or set(counts.values()) != {PER_GROUP}:
        raise ValueError(f"unexpected holdout categories/counts: {counts}")


def generate():
    rng = random.Random(SEED)
    rows = [
        render_group(group, rng, i)
        for group in GROUPS for i in range(PER_GROUP)
    ]
    validate(rows)
    return {
        "marker": MARKER, "seed": SEED,
        "description": "Independent fabricated holdout for boundary repair and over-extension; NOT training data or population accuracy",
        "cases": rows,
    }


def main():
    fixture = generate()
    path = Path(__file__).resolve().parents[1] / "benchmark-output/tiny-ja-ner/address-holdout.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"marker": MARKER, "cases": len(fixture["cases"]),
                      "groups": len(GROUPS), "seed": SEED}, ensure_ascii=False))


if __name__ == "__main__":
    main()
