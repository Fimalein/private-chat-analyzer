#!/usr/bin/env python3
"""Fresh, independently generated, entirely fictional ADDRESS safety holdout.

Third suite: do not use to train or select post-processor patterns. This has
distinct vocab/templates from the earlier boundary and address-format suites.
A synthetic prefix-only ADDRESS candidate is provided to isolate the effect of
the rule from NER detection; it is NOT an actual model output.
"""
from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path

SEED = 20261103
PER_GROUP = 16
MARKER = "SYNTHETIC_FIXTURE"
CITIES = ("曙璃", "紫朧", "羽澄", "碧紗", "雲花", "琥琴", "柚霞", "水琴")
WARDS = ("夜凪", "雪琴", "晴雫", "春柚", "灯月", "柊乃", "花燈", "雲碧")
BUILDINGS = ("蒼夜コーポ", "鈴羽タワー", "椿音ハイツ", "白灯マンション")

# Each case intentionally uses a different sentence surrounding the ADDRESS
# candidate. Five groups contain out-of-address material. Gold is *only* the
# true sensitive part, and gold=[] for wholly metaphorical/title contexts.
GROUPS = {
    "block_three": "新しい届け先は{place}{a}-{b}-{c}になります。",
    "width_three": "ナビの行き先：{place}{fa}－{fb}－{fc}。",
    "chome_only": "受付は{place}{kanji}丁目でお願いします。",
    "building_tail": "集合場所を{place} {building}{room}号室に変更。",
    "banchi_literal": "あて先は{place}{a}番地に決まった。",
    "no_address_duration": "地名だけなら{place}、所要時間は{a}-{b}分。",
    "attached_duration": "例文では{place}{a}-{b}分以内と書く。",
    "attached_seconds": "メモには{place}{a}-{b}秒と書いてあった。",
    "attached_ordinal": "文章の例は{place}{a}番目になっている。",
    "attached_counter": "欄には{place}{a}-{b}個と表示された。",
    "work_title_kakko": "短編『{place}{a}-{b}』という題名を考えた。",
    "work_title_quotes": "小説「{place}{a}番地」を読んだ。",
    "product_title_building": "模型『{place} {building}』を組み立てた。",
    "name_inside_quote": "住所そのものを「{place}{kanji}丁目」と書いた。",
    "separated_number": "住所は{place}、暗証番号は{a}-{b}。",
    "nearby_hyphen_time": "{place}の話が終わり、{a}-{b}時間かかった。",
}
# These groups have no real address, but an erroneous model seed intentionally
# points to a matching place-name prefix (simulating an NER false positive).
NOT_ADDRESSES = {"work_title_kakko", "work_title_quotes", "product_title_building"}
# These groups only label the prefix: trailing numeric expressions are prose.
PREFIX_ONLY = {
    "attached_duration", "attached_seconds", "attached_ordinal", "attached_counter"
}


def make_case(group: str, rng: random.Random, index: int) -> dict:
    place = f"{rng.choice(CITIES)}市{rng.choice(WARDS)}町"
    a, b, c = (rng.randint(1, 9) for _ in range(3))
    kanji = rng.choice(("三", "五", "八", "九"))
    building = rng.choice(BUILDINGS)
    room = rng.randint(201, 909)
    replacements = dict(
        place=place, a=str(a), b=str(b), c=str(c), kanji=kanji,
        fa="０１２３４５６７８９"[a], fb="０１２３４５６７８９"[b],
        fc="０１２３４５６７８９"[c], building=building, room=str(room),
    )
    text = GROUPS[group].format(**replacements)
    start = text.index(place)
    initial = {
        "start": start, "end": start + len(place), "type": "ADDRESS", "value": place,
    }
    if group in NOT_ADDRESSES:
        gold = []
    elif group in PREFIX_ONLY:
        gold = [dict(initial)]
    else:
        # Positive examples with the suffix adjacent to the fictional place.
        suffix = {
            "block_three": f"{a}-{b}-{c}",
            "width_three": f"{replacements['fa']}－{replacements['fb']}－{replacements['fc']}",
            "chome_only": f"{kanji}丁目",
            "building_tail": f" {building}{room}号室",
            "banchi_literal": f"{a}番地",
            "name_inside_quote": f"{kanji}丁目",
        }.get(group, "")
        gold = [{
            **initial, "end": initial["end"] + len(suffix), "value": place + suffix,
        }]
    return {"id": f"safety-{group}-{index + 1:03d}",
            "group": group, "text": text,
            "gold": gold, "seedCandidates": [initial]}


def validate(cases: list[dict]) -> None:
    ids = set()
    for case in cases:
        if case["id"] in ids:
            raise ValueError("duplicate safety case ID")
        ids.add(case["id"])
        for item in case["gold"] + case["seedCandidates"]:
            if not 0 <= item["start"] < item["end"] <= len(case["text"]):
                raise ValueError("invalid code-point range")
            if case["text"][item["start"]:item["end"]] != item["value"]:
                raise ValueError("invalid gold text slice")
        if case["group"] in NOT_ADDRESSES and case["gold"]:
            raise ValueError("synthetic title incorrectly labeled address")
    counts = Counter(c["group"] for c in cases)
    if set(counts) != set(GROUPS) or set(counts.values()) != {PER_GROUP}:
        raise ValueError("safety suite missing categories")


def generate() -> dict:
    rng = random.Random(SEED)
    cases = [make_case(group, rng, i) for group in GROUPS for i in range(PER_GROUP)]
    validate(cases)
    return {
        "marker": MARKER,
        "description": "Independent fictional ADDRESS safety holdout; no personal data; never train on these cases",
        "seed": SEED,
        "cases": cases,
    }


def main() -> None:
    path = Path(__file__).resolve().parents[1] / "benchmark-output/tiny-ja-ner/address-safety-holdout.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    obj = generate()
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"marker": MARKER, "seed": SEED,
                      "cases": len(obj["cases"]), "groups": len(GROUPS)},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
