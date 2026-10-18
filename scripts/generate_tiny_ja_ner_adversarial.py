#!/usr/bin/env python3
"""Deterministic adversarial Japanese NER fixtures. SYNTHETIC_FIXTURE only.

All entity strings are fabricated for this test. Nothing is drawn from chats or
external identity datasets. This file is the ONLY source of adversarial fixtures.
Coordinates use Unicode code-point offsets, matching Python str and JS Array.from.
"""

from __future__ import annotations

import json
import random
import string
from collections import Counter
from pathlib import Path

MARKER = "SYNTHETIC_FIXTURE"
SEED = 20261018
PER_GROUP = 32
GROUPS = {
    "person_particles": [
        "{person}さんは明日いる？", "担当は{person}だから聞いて。",
        "{person}には昨日伝えたよ。", "連絡したのは{person}だよ。",
    ],
    "person_alias": [
        "{person}（{alias}）から連絡きた。", "{alias}こと{person}に頼もう。",
        "今度は「{alias}」って呼ばれてる{person}だね。",
        "{person}、別名{alias}の人が来る。",
    ],
    "person_latin": [
        "{person}（{latin}）と会った。", "参加者は{latin}こと{person}。",
        "{latin}さんにお願い。", "{person}/{latin}から返信。",
    ],
    "address_numbers": [
        "配送先は{numbered}です。", "{numbered}に着いたよ。",
        "地図の{numbered}を確認して。", "現地住所：{numbered}。",
    ],
    "address_chome": [
        "{chome}の角で待つ。", "送り先は{chome}だよ。",
        "住所={chome}、間違いない？", "{chome}から徒歩5分。",
    ],
    "address_building": [
        "会場は{building}です。", "届け先：{building}。",
        "{building}に集合ね。", "部屋番号まで：{building}。",
    ],
    "organization_boundary": [
        "次は{company}の打ち合わせ。", "{company}と共同研究した。",
        "連絡先は{company}だって。", "{company}株式会社ではなく別会社。",
    ],
    "punctuation_emoji": [
        "📍{address}！{person}は来る？", "「{person}」→{address}🚃",
        "…{company}、{person}、どうする？", "🤔{address}／{person}…",
    ],
    "unicode_width": [
        "送り先：{wide_address}", "担当は{wide_person}。",
        "{wide_company}からの案内（２枚）。",
        "{wide_person}さん、{wide_address}で。",
    ],
    "unicode_combining": [
        "連絡は{combined_person}にお願い。", "{combined_person}は来る？",
        "住所は{combined_address}です。", "→{combined_person}／{combined_address}",
    ],
    "whitespace_variants": [
        "{spaced_person}　さんと合流。", "担当：{spaced_person}\n確認した。",
        "住所は{spaced_address}\tです。", "{spaced_person}→{spaced_address}",
    ],
    "repeated_entities": [
        "{person}と{person}で確認した。", "{address}から{address}へ。",
        "{person}の次に{person}が返信した。", "{company}と{company}で相談。",
    ],
    "mixed_entities": [
        "{person}は{company}から{address}へ。",
        "{address}で{person}と{person2}に会う。",
        "{company}の{address}拠点に{person}が来た。",
        "{person}が{company}の{building}を案内。",
    ],
    "difficult_negatives": [
        "「{word}」という映画の話をしてた。",
        "{word}っていう色の名前、好き。",
        "{word}は今日の作業名だよ。",
        "資料の見出しは「{word}」にした。",
    ],
    # These are intentional out-of-window misses at maxLength=96, NOT model
    # correctness cases. They measure the privacy risk from truncation.
    "truncation_tail": [
        "{long_prefix}連絡先は{person}。", "{long_prefix}送り先は{numbered}。",
        "{long_prefix}担当は{company}。", "{long_prefix}{person}と{address}。",
    ],
}
SURNAMES = ("雲雀", "夏凪", "雨音", "白砂", "風乃", "月詠", "星霧", "森澪", "青璃", "霞峰")
GIVENS = ("千景", "澄音", "結羽", "真緒", "綾月", "帆花", "凪紗", "透璃", "雪音", "玲奈")
CITIES = ("雪影", "星舟", "朝露", "青羽", "風見", "灯森", "春霞", "月凪")
TOWNS = ("若波", "青丘", "桜森", "星花", "湖月", "雲庭", "花瀬", "緑羽")
COMPANIES = ("白砂技術研究所", "星舟電力システムズ", "月凪情報機構", "株式会社青羽計算", "春霞エナジー")
NEGATIVES = ("月影", "朝露", "青空", "星花", "春風", "桜色", "花見", "若葉")
LATIN_ALIASES = ("Rina-Q", "Mira-X", "KANA-Z", "Nao-R", "Yui-K")
ALIAS = ("みーちゃん", "あおりん", "ゆきぴ", "なぎさん", "るな")


def make_fields(rng: random.Random) -> dict[str, tuple[str, str | None]]:
    person = rng.choice(SURNAMES) + rng.choice(GIVENS)
    person2 = rng.choice(SURNAMES) + rng.choice(GIVENS)
    city, town = rng.choice(CITIES), rng.choice(TOWNS)
    address = f"{city}市{town}町"
    company = rng.choice(COMPANIES)
    n = rng.randint(1, 8)
    numbered = f"{address}{n}-{rng.randint(1, 9)}-{rng.randint(1, 9)}"
    chome = f"{address}{rng.choice(('二', '四', '六', '７', '3'))}丁目"
    building = f"{numbered} 星雲ビル{rng.randint(101, 509)}号室"
    # Some Unicode characters map to multiple code points under NFKC;
    # offsets must always remain in the ORIGINAL input string.
    return {
        "person": (person, "PERSON"),
        "person2": (person2, "PERSON"),
        "alias": (rng.choice(ALIAS), "PERSON"),
        "latin": (rng.choice(LATIN_ALIASES), "PERSON"),
        "address": (address, "ADDRESS"),
        "numbered": (numbered, "ADDRESS"),
        "chome": (chome, "ADDRESS"),
        "building": (building, "ADDRESS"),
        "company": (company, "COMPANY"),
        "wide_address": (f"{city}市{town}町１２－３－５", "ADDRESS"),
        "wide_person": (person + "Ａ", "PERSON"),
        "wide_company": (company + "㍿", "COMPANY"),
        "combined_person": (person + "か\u3099", "PERSON"),
        "combined_address": (address + "か\u3099", "ADDRESS"),
        "spaced_person": (person[:2] + "　" + person[2:], "PERSON"),
        "spaced_address": (address[:2] + " " + address[2:], "ADDRESS"),
        "word": (rng.choice(NEGATIVES), None),
        "long_prefix": ("あ" * 108, None),
    }


def render(template: str, fields: dict[str, tuple[str, str | None]]) -> tuple[str, list[dict]]:
    chunks: list[str] = []
    gold: list[dict] = []
    offset = 0
    for literal, field, format_spec, conversion in string.Formatter().parse(template):
        if format_spec or conversion:
            raise ValueError("Formatting modifiers are forbidden in synthetic templates")
        chunks.append(literal)
        offset += len(literal)
        if field is None:
            continue
        value, kind = fields[field]
        chunks.append(value)
        if kind is not None:
            gold.append({"start": offset, "end": offset + len(value), "type": kind, "value": value})
        offset += len(value)
    return "".join(chunks), gold


def generate(seed: int = SEED, per_group: int = PER_GROUP) -> dict:
    if per_group < 1:
        raise ValueError("per_group must be positive")
    rng = random.Random(seed)
    cases = []
    for group, templates in GROUPS.items():
        for index in range(per_group):
            text, gold = render(templates[index % len(templates)], make_fields(rng))
            cases.append({
                "id": f"{group}-{index + 1:03d}",
                "group": group,
                "text": text,
                "gold": gold,
            })
    validate(cases)
    return {
        "marker": MARKER,
        "description": "Generated, entirely fabricated Japanese entity-boundary stress cases; never train on these samples.",
        "seed": seed,
        "perGroup": per_group,
        "cases": cases,
    }


def validate(cases: list[dict]) -> None:
    seen: set[str] = set()
    for case in cases:
        cid, text = case["id"], case["text"]
        if cid in seen:
            raise ValueError(f"Duplicate case ID: {cid}")
        seen.add(cid)
        last_end = 0
        for g in case["gold"]:
            start, end = g["start"], g["end"]
            if not 0 <= start < end <= len(text) or text[start:end] != g["value"]:
                raise ValueError(f"Invalid Unicode code-point span in {cid}")
            if start < last_end or g["type"] not in ("PERSON", "COMPANY", "ADDRESS"):
                raise ValueError(f"Overlapping or invalid entity in {cid}")
            last_end = end
    count = Counter(c["group"] for c in cases)
    if set(count) != set(GROUPS) or len(set(count.values())) != 1:
        raise ValueError(f"Unbalanced stress categories: {count}")


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "benchmark-output/tiny-ja-ner/adversarial-cases.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    fixture = generate()
    output.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "marker": MARKER, "cases": len(fixture["cases"]),
        "groups": dict(sorted(Counter(c["group"] for c in fixture["cases"]).items())),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
