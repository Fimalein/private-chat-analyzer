#!/usr/bin/env python3
"""Synthetic-only feasibility spike for tiny Japanese browser-local NER.

No real chat data or public NER corpus is used. The script fine-tunes a small
Japanese DeBERTa token classifier on fabricated examples, checks a browser-like
character tokenizer against the upstream Python tokenizer, exports to ONNX,
quantizes to INT8, and evaluates the held-out synthetic corpus from PR #39.
"""

from __future__ import annotations

import json
import os
import platform
import random
import statistics
import string
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from torch import nn
from torch.optim import AdamW
from torch.utils.data import DataLoader, Dataset
from generate_tiny_ja_ner_adversarial import generate as adversarial_cases
from generate_tiny_ja_address_holdout import generate as address_holdout_cases
from generate_tiny_ja_address_safety_holdout import generate as address_safety_cases
from repair_tiny_ja_address_spans import repair_address_spans
from transformers import (
    AutoModelForTokenClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
)

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_PATH = ROOT / "tests/fixtures/synthetic/doccloak-ja-benchmark.json"
OUTPUT_DIR = ROOT / "benchmark-output/tiny-ja-ner"
BASE_MODEL = "ku-nlp/deberta-v2-tiny-japanese-char-wwm"
SEED = 20261014
TRAIN_N = 960
VALID_N = 192
EPOCHS = 5
BATCH_SIZE = 32
LR = 3e-4
MAX_LENGTH = 96

LABELS = ["O", "B-PERSON", "I-PERSON", "B-ORG", "I-ORG", "B-LOC", "I-LOC"]
L2I = {label: i for i, label in enumerate(LABELS)}
I2L = {i: label for label, i in L2I.items()}
BIO = {
    "PERSON": (L2I["B-PERSON"], L2I["I-PERSON"]),
    "ORG": (L2I["B-ORG"], L2I["I-ORG"]),
    "LOC": (L2I["B-LOC"], L2I["I-LOC"]),
}
OUT_TYPE = {"PERSON": "PERSON", "ORG": "COMPANY", "LOC": "ADDRESS"}

# Fabricated combinatorial lexicons. They were written for this spike and are not
# extracted from a real conversation or identity list.
SURNAME = [
    "春野", "風間", "雪村", "海堂", "藤森", "高瀬", "北原", "南雲",
    "水沢", "桐谷", "神崎", "雨宮", "相原", "黒川", "白河", "東雲",
    "月島", "朝倉", "若月", "星川", "青峰", "霞沢", "波多野", "森宮",
]
GIVEN = [
    "美月", "颯真", "莉子", "悠斗", "紗季", "直人", "琴音", "晴人",
    "結菜", "蒼太", "真帆", "拓海", "千尋", "蓮", "陽葵", "奏",
    "凛", "湊", "杏奈", "大雅", "美琴", "陽向", "一花", "奏太",
]
ORG_STEM = [
    "春風", "銀河", "若葉", "白波", "北斗", "灯台", "青雲", "千景",
    "黎明", "水鏡", "風花", "星雲", "潮見", "翠星", "桜雲", "光輪",
    "雪灯", "霞野", "羽音", "月舟", "天河", "碧海", "朝露", "霧島",
]
ORG_SUFFIX = [
    "電機株式会社", "情報技研", "物流合同会社", "データ株式会社",
    "材料研究所", "システムズ", "エナジー", "開発機構",
]
PLACE_A = ["春風", "銀河", "若葉", "白波", "北斗", "灯台", "青雲", "千景", "黎明", "水鏡", "風花", "星雲"]
PLACE_B = ["ひかり", "みどり", "あさひ", "つばさ", "こもれび", "さざなみ", "ほしみ", "ゆきの", "あおば", "かすみ", "なぎさ", "はるか"]
PLACE_C = ["桜丘", "若竹", "海風", "月見", "青葉", "星丘", "花野", "白浜", "朝露", "雪原", "水辺", "風見"]

PERSON_T = [
    "{person}さんからメッセージが届いた。", "明日は{person}と駅で合流する。",
    "資料は{person}に渡しておいて。", "担当者が{person}に変わったらしい。",
    "さっき{person}から電話があったよ。", "{person}、今日の予定わかる？",
]
ORG_T = [
    "{org}から案内が届いた。", "来週は{org}の説明会に行く。",
    "この資料は{org}と共同で作った。", "{org}に問い合わせてみるね。",
    "インターン先は{org}に決まった。", "{org}の研究チームと打ち合わせする。",
]
LOC_T = [
    "集合場所は{loc}でどう？", "今度{loc}まで電車で行く。",
    "荷物は{loc}に送ってください。", "{loc}の駅前で待ってる。",
    "来月から{loc}に通う予定。", "会場は{loc}の近くだよ。",
]
MIXED_T = [
    "{person}が{org}の{loc}オフィスに行った。",
    "{person}は{org}から{loc}へ移動中。",
    "{person}と{person2}が{org}の{loc}支店で打ち合わせ。",
    "{loc}で{person}と会ってから{org}に向かう。",
]
NEGATIVE = [
    "今日はラーメン食べたい。", "あと十分くらいで着くよ。", "明日の実験は午後からで大丈夫？",
    "資料の二ページ目を見て。", "眠いから少し休憩する。", "雨が降りそうだから傘を持っていく。",
    "このコードあとで直したい。", "夕飯は家で食べる予定。", "電車が少し遅れているみたい。",
    "宿題終わったら連絡するね。", "今日の会議は長かった。", "新しいイヤホンを試している。",
]


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    kind: str
    value: str


@dataclass(frozen=True)
class Example:
    text: str
    spans: tuple[Span, ...]


def person(rng: random.Random) -> str:
    return rng.choice(SURNAME) + rng.choice(GIVEN)


def org(rng: random.Random) -> str:
    return rng.choice(ORG_STEM) + rng.choice(ORG_SUFFIX)


def loc(rng: random.Random) -> str:
    style = rng.randrange(3)
    if style == 0:
        return f"{rng.choice(PLACE_A)}県{rng.choice(PLACE_B)}市"
    if style == 1:
        return f"{rng.choice(PLACE_B)}市{rng.choice(PLACE_C)}区"
    return f"{rng.choice(PLACE_A)}県{rng.choice(PLACE_B)}市{rng.choice(PLACE_C)}町"


def render(template: str, fields: dict[str, tuple[str, str]]) -> Example:
    text = template.format(**{k: v[0] for k, v in fields.items()})
    spans: list[Span] = []
    cursor = 0
    for literal, field, _, _ in string.Formatter().parse(template):
        cursor += len(literal)
        if field is None:
            continue
        value, kind = fields[field]
        spans.append(Span(cursor, cursor + len(value), kind, value))
        cursor += len(value)
    return Example(text, tuple(spans))


def one_example(rng: random.Random) -> Example:
    x = rng.random()
    if x < 0.22:
        return render(rng.choice(PERSON_T), {"person": (person(rng), "PERSON")})
    if x < 0.44:
        return render(rng.choice(ORG_T), {"org": (org(rng), "ORG")})
    if x < 0.66:
        return render(rng.choice(LOC_T), {"loc": (loc(rng), "LOC")})
    if x < 0.90:
        template = rng.choice(MIXED_T)
        pool = {
            "person": (person(rng), "PERSON"),
            "person2": (person(rng), "PERSON"),
            "org": (org(rng), "ORG"),
            "loc": (loc(rng), "LOC"),
        }
        needed = {f for _, f, _, _ in string.Formatter().parse(template) if f}
        return render(template, {k: v for k, v in pool.items() if k in needed})
    return Example(rng.choice(NEGATIVE), tuple())


def generate(count: int, seed: int) -> list[Example]:
    rng = random.Random(seed)
    out: list[Example] = []
    seen: set[str] = set()
    while len(out) < count:
        item = one_example(rng)
        key = item.text + repr([(s.start, s.end, s.kind) for s in item.spans])
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


class BrowserCharTokenizer:
    """Small browser-equivalent tokenizer for this upstream configuration.

    BertJapaneseTokenizer uses basic word tokenization and a CharacterTokenizer.
    CharacterTokenizer applies Unicode NFKC before vocab lookup, so the browser path
    must do the same (JS has String.prototype.normalize("NFKC")). We map every
    normalized output character back to its original source character for span UI.
    """

    def __init__(self, tokenizer):
        self.py = tokenizer
        self.vocab = tokenizer.get_vocab()
        self.cls = tokenizer.cls_token_id
        self.sep = tokenizer.sep_token_id
        self.pad = tokenizer.pad_token_id
        self.unk = tokenizer.unk_token_id

    def encode(self, text: str, max_len: int = MAX_LENGTH):
        ids = [self.cls]
        source = [-1]
        for source_pos, raw_char in enumerate(text):
            normalized = unicodedata.normalize("NFKC", raw_char)
            for char in normalized:
                if char.isspace():
                    continue
                ids.append(self.vocab.get(char, self.unk))
                source.append(source_pos)
                if len(ids) >= max_len - 1:
                    ids.append(self.sep)
                    source.append(-1)
                    return ids, [1] * len(ids), source
        ids.append(self.sep)
        source.append(-1)
        return ids, [1] * len(ids), source

    def parity(self, text: str) -> tuple[bool, list[int], list[int]]:
        ours, _, _ = self.encode(text, 10000)
        theirs = self.py(text, add_special_tokens=True, truncation=False)["input_ids"]
        return ours == theirs, ours, theirs


def label_at(pos: int, spans: tuple[Span, ...]) -> int:
    for span in spans:
        if span.start <= pos < span.end:
            b, i = BIO[span.kind]
            return b if pos == span.start else i
    return L2I["O"]


def encode_example(tok: BrowserCharTokenizer, ex: Example):
    ids, mask, source = tok.encode(ex.text)
    labels = [-100] + [label_at(pos, ex.spans) for pos in source[1:-1]] + [-100]
    return {"input_ids": ids, "attention_mask": mask, "labels": labels}


class Rows(Dataset):
    def __init__(self, rows):
        self.rows = rows
    def __len__(self):
        return len(self.rows)
    def __getitem__(self, idx):
        return self.rows[idx]


def collate(rows, pad: int):
    width = max(len(r["input_ids"]) for r in rows)
    ids, masks, labels = [], [], []
    for row in rows:
        n = width - len(row["input_ids"])
        ids.append(row["input_ids"] + [pad] * n)
        masks.append(row["attention_mask"] + [0] * n)
        labels.append(row["labels"] + [-100] * n)
    return {
        "input_ids": torch.tensor(ids, dtype=torch.long),
        "attention_mask": torch.tensor(masks, dtype=torch.long),
        "labels": torch.tensor(labels, dtype=torch.long),
    }


def train(model, train_rows, valid_rows, pad: int):
    train_loader = DataLoader(Rows(train_rows), batch_size=BATCH_SIZE, shuffle=True,
                              collate_fn=lambda x: collate(x, pad),
                              generator=torch.Generator().manual_seed(SEED))
    valid_loader = DataLoader(Rows(valid_rows), batch_size=BATCH_SIZE, shuffle=False,
                              collate_fn=lambda x: collate(x, pad))
    opt = AdamW(model.parameters(), lr=LR, weight_decay=0.01)
    steps = len(train_loader) * EPOCHS
    sched = get_linear_schedule_with_warmup(opt, max(1, steps // 10), steps)
    history = []
    started = time.perf_counter()
    for epoch in range(EPOCHS):
        model.train()
        losses = []
        for batch in train_loader:
            opt.zero_grad(set_to_none=True)
            loss = model(**batch).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step()
            losses.append(float(loss.detach()))
        model.eval()
        with torch.no_grad():
            valid_losses = [float(model(**batch).loss) for batch in valid_loader]
        history.append({"epoch": epoch + 1, "trainLoss": statistics.mean(losses),
                        "validLoss": statistics.mean(valid_losses)})
    model.eval()
    return {"seconds": time.perf_counter() - started, "steps": steps, "history": history}


def decode(text: str, source: list[int], pred: list[int]):
    out = []
    active = None

    def flush():
        nonlocal active
        if active:
            start, end, kind = active
            out.append({"start": start, "end": end, "type": OUT_TYPE[kind], "value": text[start:end]})
        active = None

    for pos, label_id in zip(source[1:-1], pred[1:-1]):
        if pos < 0:
            continue
        label = I2L[int(label_id)]
        if label == "O":
            flush(); continue
        prefix, kind = label.split("-", 1)
        if active is None or prefix == "B" or active[2] != kind or active[1] != pos:
            flush(); active = [pos, pos + 1, kind]
        else:
            active[1] = pos + 1
    flush()
    return out


def gold(case):
    text = case["text"]
    result = []
    cursor = 0
    for item in case["gold"]:
        if "start" in item and "end" in item:
            start, end = item["start"], item["end"]
        else:
            start = text.find(item["value"], cursor)
            if start < 0:
                start = text.find(item["value"])
            end = start + len(item["value"])
        if start < 0 or text[start:end] != item["value"]:
            raise RuntimeError(f"Synthetic gold span invalid in {case['id']}")
        result.append({"start": start, "end": end, "type": item["type"], "value": item["value"]})
        cursor = end
    return result


def same(a, b):
    return a["type"] == b["type"] and a["start"] == b["start"] and a["end"] == b["end"]


def overlaps(a, b):
    return a["type"] == b["type"] and a["start"] < b["end"] and b["start"] < a["end"]


def match_count(pred, expected, predicate):
    used = set(); hits = 0
    for p in pred:
        for idx, g in enumerate(expected):
            if idx not in used and predicate(p, g):
                used.add(idx); hits += 1; break
    return hits


def metrics(predictions, expected):
    total_pred = sum(map(len, predictions)); total_gold = sum(map(len, expected))
    def block(predicate):
        hits = sum(match_count(p, g, predicate) for p, g in zip(predictions, expected))
        return {"hits": hits, "gold": total_gold, "predicted": total_pred,
                "recall": hits / total_gold if total_gold else None,
                "precision": hits / total_pred if total_pred else None}
    by_type = {}
    for kind in ["PERSON", "COMPANY", "ADDRESS"]:
        pp = [[x for x in xs if x["type"] == kind] for xs in predictions]
        gg = [[x for x in xs if x["type"] == kind] for xs in expected]
        npred, ngold = sum(map(len, pp)), sum(map(len, gg))
        hs = sum(match_count(p, g, same) for p, g in zip(pp, gg))
        ho = sum(match_count(p, g, overlaps) for p, g in zip(pp, gg))
        by_type[kind] = {"gold": ngold, "predicted": npred,
                         "strictRecall": hs / ngold if ngold else None,
                         "strictPrecision": hs / npred if npred else None,
                         "overlapRecall": ho / ngold if ngold else None,
                         "overlapPrecision": ho / npred if npred else None}
    return {"strict": block(same), "overlap": block(overlaps), "byType": by_type}


def evaluate(cases, predictor):
    predictions, expected, timings, mismatches = [], [], [], []
    for case in cases:
        pred, ms = predictor(case["text"])
        exp = gold(case)
        predictions.append(pred); expected.append(exp); timings.append(ms)
        if {(x["start"], x["end"], x["type"]) for x in pred} != {(x["start"], x["end"], x["type"]) for x in exp}:
            mismatches.append({"id": case["id"],
                               "predicted": [{"value": x["value"], "type": x["type"]} for x in pred],
                               "gold": [{"value": x["value"], "type": x["type"]} for x in exp]})
    return metrics(predictions, expected), timings, mismatches


def coverage(predictions, expected):
    """Union of same-type prediction spans; uncovered code points are leak candidates."""
    n = 0
    covered = 0
    total_chars = 0
    uncovered_chars = 0
    for preds, golds in zip(predictions, expected):
        for g in golds:
            n += 1
            full = True
            for pos in range(g["start"], g["end"]):
                total_chars += 1
                if not any(p["type"] == g["type"] and p["start"] <= pos < p["end"] for p in preds):
                    uncovered_chars += 1
                    full = False
            covered += int(full)
    return {"gold": n, "covered": covered, "recall": covered / n if n else None,
            "totalCharacters": total_chars, "uncoveredCharacters": uncovered_chars}


def adversarial_evaluate(cases, predictions, transform=None):
    if len(cases) != len(predictions):
        raise ValueError("Adversarial predictions must match case count")
    if transform is not None:
        predictions = [transform(c["text"], p) for c, p in zip(cases, predictions)]
    expected = [gold(c) for c in cases]

    def summary(subset):
        pp = [predictions[i] for i in subset]
        gg = [expected[i] for i in subset]
        m = metrics(pp, gg)
        return {
            "cases": len(subset),
            "strict": m["strict"],
            "overlap": m["overlap"],
            "byType": m["byType"],
            "fullCoverage": coverage(pp, gg),
            "negativeCasesWithPredictions": sum(1 for p, g in zip(pp, gg) if not g and p),
        }

    overall = summary(list(range(len(cases))))
    overall["byGroup"] = {
        group: summary([i for i, c in enumerate(cases) if c["group"] == group])
        for group in sorted({c["group"] for c in cases})
    }
    mismatches = [
        c["id"] for c, p, g in zip(cases, predictions, expected)
        if {(x["start"], x["end"], x["type"]) for x in p}
           != {(x["start"], x["end"], x["type"]) for x in g}
    ]
    overall["mismatchCount"] = len(mismatches)
    overall["mismatchSampleIds"] = mismatches[:12]
    return overall


def address_overextension(cases, before, after):
    """Only newly added ADDRESS code points outside gold are overreach."""
    added = 0
    outside = 0
    affected = []
    for case, raw, repaired in zip(cases, before, after):
        old_points = {pos for item in raw if item["type"] == "ADDRESS"
                      for pos in range(item["start"], item["end"])}
        new_points = {pos for item in repaired if item["type"] == "ADDRESS"
                      for pos in range(item["start"], item["end"])}
        gold_points = {pos for item in gold(case) if item["type"] == "ADDRESS"
                       for pos in range(item["start"], item["end"])}
        extra = new_points - old_points
        wrong = extra - gold_points
        added += len(extra)
        outside += len(wrong)
        if wrong:
            affected.append(case["id"])
    return {
        "addedCharacters": added,
        "overExtendedCharacters": outside,
        "casesWithOverExtension": len(affected),
        "sampleIds": affected[:12],
    }


def evaluate_address_holdout(cases, predictions):
    expected = [gold(c) for c in cases]
    repaired = [repair_address_spans(c["text"], p) for c, p in zip(cases, predictions)]
    return {
        "raw": adversarial_evaluate(cases, predictions),
        "repaired": adversarial_evaluate(cases, repaired),
        "overExtension": address_overextension(cases, predictions, repaired),
    }


def torch_predict(model, tok, text):
    ids, mask, source = tok.encode(text)
    started = time.perf_counter()
    with torch.no_grad():
        logits = model(input_ids=torch.tensor([ids]), attention_mask=torch.tensor([mask])).logits
    return decode(text, source, logits.argmax(-1)[0].tolist()), (time.perf_counter() - started) * 1000


def export_and_quantize(model, tok):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fp = OUTPUT_DIR / "tiny-ja-ner.onnx"
    int8 = OUTPUT_DIR / "tiny-ja-ner.int8.onnx"

    class Wrapper(nn.Module):
        def __init__(self, inner):
            super().__init__(); self.inner = inner
        def forward(self, input_ids, attention_mask):
            return self.inner(input_ids=input_ids, attention_mask=attention_mask).logits

    ids, mask, _ = tok.encode("これは合成データだけを使うテストです。")
    started = time.perf_counter()
    torch.onnx.export(
        Wrapper(model).eval(),
        (torch.tensor([ids]), torch.tensor([mask])),
        fp,
        input_names=["input_ids", "attention_mask"], output_names=["logits"],
        dynamic_axes={"input_ids": {0: "batch", 1: "sequence"},
                      "attention_mask": {0: "batch", 1: "sequence"},
                      "logits": {0: "batch", 1: "sequence"}},
        opset_version=17, dynamo=False,
    )
    # Keep DeBERTa's convolution in FP32: dynamic ConvInteger has no kernel
    # in the pinned browser WASM runtime (observed in Chromium CI).
    quantize_dynamic(fp, int8, weight_type=QuantType.QInt8,
                     op_types_to_quantize=["MatMul", "Gemm"])
    unsupported = [node.name for node in onnx.load(int8).graph.node
                   if node.op_type == "ConvInteger"]
    if unsupported:
        raise RuntimeError(f"Browser-incompatible ConvInteger nodes: {len(unsupported)}")
    return fp, int8, time.perf_counter() - started


def ort_predict(session, tok, text):
    ids, mask, source = tok.encode(text)
    started = time.perf_counter()
    logits = session.run(["logits"], {
        "input_ids": np.asarray([ids], dtype=np.int64),
        "attention_mask": np.asarray([mask], dtype=np.int64),
    })[0]
    return decode(text, source, logits.argmax(-1)[0].tolist()), (time.perf_counter() - started) * 1000


def main():
    random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    started = time.perf_counter()
    py_tok = AutoTokenizer.from_pretrained(BASE_MODEL, use_fast=False)
    model = AutoModelForTokenClassification.from_pretrained(
        BASE_MODEL, num_labels=len(LABELS), id2label=I2L, label2id=L2I,
        ignore_mismatched_sizes=True,
    )
    load_seconds = time.perf_counter() - started
    tok = BrowserCharTokenizer(py_tok)

    train_examples = generate(TRAIN_N, SEED + 1)
    valid_examples = generate(VALID_N, SEED + 2)
    fixture = json.loads(BENCHMARK_PATH.read_text(encoding="utf-8"))
    if fixture.get("marker") != "SYNTHETIC_FIXTURE":
        raise RuntimeError("Benchmark fixture must declare SYNTHETIC_FIXTURE")
    cases = fixture["cases"]
    adversarial_fixture = adversarial_cases()
    adversarial_rows = adversarial_fixture["cases"]
    holdout_fixture = address_holdout_cases()
    holdout_rows = holdout_fixture["cases"]
    safety_fixture = address_safety_cases()
    safety_rows = safety_fixture["cases"]
    # A generated fixture is ignored by git and used only inside this run.
    (OUTPUT_DIR / "adversarial-cases.json").write_text(
        json.dumps(adversarial_fixture, ensure_ascii=False), encoding="utf-8",
    )
    (OUTPUT_DIR / "address-holdout.json").write_text(
        json.dumps(holdout_fixture, ensure_ascii=False), encoding="utf-8",
    )
    (OUTPUT_DIR / "address-safety-holdout.json").write_text(
        json.dumps(safety_fixture, ensure_ascii=False), encoding="utf-8",
    )

    parity_texts = [x.text for x in train_examples[:100]] + [x["text"] for x in cases]
    parity_failures = []
    for text in parity_texts:
        ok, ours, theirs = tok.parity(text)
        if not ok:
            parity_failures.append({"text": text, "ours": ours, "theirs": theirs})
    if parity_failures:
        print(json.dumps({"tokenizerParityFailures": parity_failures[:5]}, ensure_ascii=False, indent=2))
        raise RuntimeError(f"Browser tokenizer parity failed for {len(parity_failures)}/{len(parity_texts)} synthetic texts")

    training = train(
        model,
        [encode_example(tok, x) for x in train_examples],
        [encode_example(tok, x) for x in valid_examples],
        tok.pad,
    )

    torch_metrics, torch_times, torch_misses = evaluate(cases, lambda text: torch_predict(model, tok, text))
    fp, int8, export_seconds = export_and_quantize(model, tok)
    session_started = time.perf_counter()
    session = ort.InferenceSession(str(int8), providers=["CPUExecutionProvider"])
    session_load = time.perf_counter() - session_started
    onnx_metrics, onnx_times, onnx_misses = evaluate(cases, lambda text: ort_predict(session, tok, text))

    # Record difficult upstream-tokenizer incompatibilities as findings rather
    # than silently dropping stress cases from this evaluation.
    parity_adversarial_failures = [
        c["id"] for c in adversarial_rows
        if not tok.parity(c["text"])[0]
    ]
    # Evaluate native ONNX inference only once per adversarial case: repair is
    # computed separately from those identical predictions, not a retraining.
    adversarial_predictions = [
        ort_predict(session, tok, c["text"])[0] for c in adversarial_rows
    ]
    adversarial_onnx = adversarial_evaluate(adversarial_rows, adversarial_predictions)
    repaired_onnx = adversarial_evaluate(
        adversarial_rows, adversarial_predictions, transform=repair_address_spans
    )
    holdout_predictions = [
        ort_predict(session, tok, c["text"])[0] for c in holdout_rows
    ]
    holdout_results = {
        "marker": "SYNTHETIC_FIXTURE",
        "seed": holdout_fixture["seed"],
        "cases": len(holdout_rows),
        "oraclePrefix": evaluate_address_holdout(
            holdout_rows, [c["seedCandidates"] for c in holdout_rows]
        ),
        "model": evaluate_address_holdout(holdout_rows, holdout_predictions),
    }

    safety_predictions = [
        ort_predict(session, tok, c["text"])[0] for c in safety_rows
    ]
    safety_results = {
        "marker": "SYNTHETIC_FIXTURE",
        "seed": safety_fixture["seed"],
        "cases": len(safety_rows),
        "oraclePrefix": evaluate_address_holdout(
            safety_rows, [c["seedCandidates"] for c in safety_rows]
        ),
        "model": evaluate_address_holdout(safety_rows, safety_predictions),
    }

    result = {
        "marker": "SYNTHETIC_FIXTURE",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scope": "synthetic-only feasibility spike; not production accuracy",
        "baseModel": BASE_MODEL,
        "seed": SEED,
        "tokenizerParity": {"checked": len(parity_texts), "failures": 0,
                            "upstreamClass": py_tok.__class__.__name__,
                            "browserStrategy": "per-character NFKC + vocab lookup + CLS/SEP"},
        "training": {"examples": TRAIN_N, "validationExamples": VALID_N,
                     "epochs": EPOCHS, "batchSize": BATCH_SIZE, "learningRate": LR, **training},
        "environment": {"python": platform.python_version(), "platform": platform.platform(),
                        "torch": torch.__version__, "onnxruntime": ort.__version__,
                        "cpuThreads": torch.get_num_threads()},
        "timing": {"modelLoadSeconds": load_seconds,
                   "onnxExportAndQuantizeSeconds": export_seconds,
                   "quantizedSessionLoadSeconds": session_load,
                   "torchMeanPerCaseMs": statistics.mean(torch_times),
                   "onnxInt8MeanPerCaseMs": statistics.mean(onnx_times)},
        "artifacts": {"onnxBytes": fp.stat().st_size, "onnxInt8Bytes": int8.stat().st_size,
                      "onnxMiB": fp.stat().st_size / (1024 * 1024),
                      "onnxInt8MiB": int8.stat().st_size / (1024 * 1024)},
        "benchmark": {"cases": len(cases), "torch": torch_metrics, "onnxInt8": onnx_metrics,
                      "onnxMatchesTorchStrict": onnx_metrics["strict"] == torch_metrics["strict"],
                      "torchMismatches": torch_misses, "onnxMismatches": onnx_misses},
        "addressHoldout": holdout_results,
        "addressSafetyHoldout": safety_results,
        "adversarial": {
            "marker": "SYNTHETIC_FIXTURE",
            "seed": adversarial_fixture["seed"],
            "tokenizerParity": {
                "checked": len(adversarial_rows),
                "failureCount": len(parity_adversarial_failures),
                "sampleIds": parity_adversarial_failures[:12],
            },
            "onnxInt8": adversarial_onnx,
            "addressRepair": repaired_onnx,
        },
    }
    path = OUTPUT_DIR / "results.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
