#!/usr/bin/env python3
"""Synthetic-only feasibility spike for a tiny Japanese local NER model.

This script deliberately avoids real chat data and public NER corpora. It fine-tunes
ku-nlp/deberta-v2-tiny-japanese-char-wwm on fabricated Japanese examples, checks a
browser-equivalent character tokenizer against the upstream Python tokenizer,
exports token classification to ONNX, dynamically quantizes it, and evaluates the
held-out synthetic privacy benchmark used by the previous DocCloak spike.

The result is a feasibility signal, not a production accuracy claim.
"""

from __future__ import annotations

import json
import os
import platform
import random
import statistics
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from torch import nn
from torch.optim import AdamW
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModelForTokenClassification, AutoTokenizer, get_linear_schedule_with_warmup

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_PATH = ROOT / "tests" / "fixtures" / "synthetic" / "doccloak-ja-benchmark.json"
OUTPUT_DIR = ROOT / "benchmark-output" / "tiny-ja-ner"
BASE_MODEL = "ku-nlp/deberta-v2-tiny-japanese-char-wwm"
SEED = 20261014
MAX_LENGTH = 96
TRAIN_EXAMPLES = 960
VALID_EXAMPLES = 192
EPOCHS = 5
BATCH_SIZE = 32
LEARNING_RATE = 3e-4

LABELS = ["O", "B-PERSON", "I-PERSON", "B-ORG", "I-ORG", "B-LOC", "I-LOC"]
LABEL2ID = {label: i for i, label in enumerate(LABELS)}
ID2LABEL = {i: label for label, i in LABEL2ID.items()}
TYPE_TO_BIO = {
    "PERSON": (LABEL2ID["B-PERSON"], LABEL2ID["I-PERSON"]),
    "ORG": (LABEL2ID["B-ORG"], LABEL2ID["I-ORG"]),
    "LOC": (LABEL2ID["B-LOC"], LABEL2ID["I-LOC"]),
}
MODEL_TO_BENCHMARK_TYPE = {"PERSON": "PERSON", "ORG": "COMPANY", "LOC": "ADDRESS"}
BENCHMARK_TO_MODEL_TYPE = {v: k for k, v in MODEL_TO_BENCHMARK_TYPE.items()}

# Fabricated lexicons. Full entities are assembled combinatorially and are not copied
# from a real conversation or identity list.
SURNAME_PARTS = [
    "春野", "風間", "雪村", "海堂", "藤森", "高瀬", "北原", "南雲",
    "水沢", "桐谷", "神崎", "雨宮", "相原", "黒川", "白河", "東雲",
    "月島", "朝倉", "若月", "星川", "青峰", "霞沢", "波多野", "森宮",
]
GIVEN_PARTS = [
    "美月", "颯真", "莉子", "悠斗", "紗季", "直人", "琴音", "晴人",
    "結菜", "蒼太", "真帆", "拓海", "千尋", "蓮", "陽葵", "奏",
    "凛", "湊", "杏奈", "大雅", "美琴", "陽向", "一花", "奏太",
]
ORG_STEMS = [
    "春風", "銀河", "若葉", "白波", "北斗", "灯台", "青雲", "千景",
    "黎明", "水鏡", "風花", "星雲", "潮見", "翠星", "桜雲", "光輪",
    "雪灯", "霞野", "羽音", "月舟", "天河", "碧海", "朝露", "霧島",
]
ORG_SUFFIXES = ["電機株式会社", "情報技研", "物流合同会社", "データ株式会社", "材料研究所", "システムズ", "エナジー", "開発機構"]
PLACE_A = ["春風", "銀河", "若葉", "白波", "北斗", "灯台", "青雲", "千景", "黎明", "水鏡", "風花", "星雲"]
PLACE_B = ["ひかり", "みどり", "あさひ", "つばさ", "こもれび", "さざなみ", "ほしみ", "ゆきの", "あおば", "かすみ", "なぎさ", "はるか"]
PLACE_C = ["桜丘", "若竹", "海風", "月見", "青葉", "星丘", "花野", "白浜", "朝露", "雪原", "水辺", "風見"]

PERSON_TEMPLATES = [
    "{person}さんからメッセージが届いた。",
    "明日は{person}と駅で合流する。",
    "資料は{person}に渡しておいて。",
    "担当者が{person}に変わったらしい。",
    "さっき{person}から電話があったよ。",
    "{person}、今日の予定わかる？",
]
ORG_TEMPLATES = [
    "{org}から案内が届いた。",
    "来週は{org}の説明会に行く。",
    "この資料は{org}と共同で作った。",
    "{org}に問い合わせてみるね。",
    "インターン先は{org}に決まった。",
    "{org}の研究チームと打ち合わせする。",
]
LOC_TEMPLATES = [
    "集合場所は{loc}でどう？",
    "今度{loc}まで電車で行く。",
    "荷物は{loc}に送ってください。",
    "{loc}の駅前で待ってる。",
    "来月から{loc}に通う予定。",
    "会場は{loc}の近くだよ。",
]
MIXED_TEMPLATES = [
    "{person}が{org}の{loc}オフィスに行った。",
    "{person}は{org}から{loc}へ移動中。",
    "{person}と{person2}が{org}の{loc}支店で打ち合わせ。",
    "{loc}で{person}と会ってから{org}に向かう。",
]
NEGATIVE_TEMPLATES = [
    "今日はラーメン食べたい。", "あと十分くらいで着くよ。", "明日の実験は午後からで大丈夫？",
    "資料の二ページ目を見て。", "眠いから少し休憩する。", "雨が降りそうだから傘を持っていく。",
    "このコードあとで直したい。", "夕飯は家で食べる予定。", "電車が少し遅れているみたい。",
    "宿題終わったら連絡するね。", "今日の会議は長かった。", "新しいイヤホンを試している。",
]


@dataclass(frozen=True)
class EntitySpan:
    start: int
    end: int
    type: str
    value: str


@dataclass(frozen=True)
class Example:
    text: str
    spans: tuple[EntitySpan, ...]


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def assemble_person(rng: random.Random) -> str:
    return rng.choice(SURNAME_PARTS) + rng.choice(GIVEN_PARTS)


def assemble_org(rng: random.Random) -> str:
    return rng.choice(ORG_STEMS) + rng.choice(ORG_SUFFIXES)


def assemble_loc(rng: random.Random) -> str:
    style = rng.randrange(3)
    if style == 0:
        return f"{rng.choice(PLACE_A)}県{rng.choice(PLACE_B)}市"
    if style == 1:
        return f"{rng.choice(PLACE_B)}市{rng.choice(PLACE_C)}区"
    return f"{rng.choice(PLACE_A)}県{rng.choice(PLACE_B)}市{rng.choice(PLACE_C)}町"


def render(template: str, values: dict[str, tuple[str, str]]) -> Example:
    text_values = {key: value for key, (value, _) in values.items()}
    text = template.format(**text_values)
    spans: list[EntitySpan] = []
    cursor = 0
    for literal, field_name, _, _ in __import__("string").Formatter().parse(template):
        cursor += len(literal)
        if field_name is None:
            continue
        value, entity_type = values[field_name]
        spans.append(EntitySpan(cursor, cursor + len(value), entity_type, value))
        cursor += len(value)
    return Example(text=text, spans=tuple(spans))


def make_example(rng: random.Random) -> Example:
    bucket = rng.random()
    if bucket < 0.22:
        person = assemble_person(rng)
        return render(rng.choice(PERSON_TEMPLATES), {"person": (person, "PERSON")})
    if bucket < 0.44:
        org = assemble_org(rng)
        return render(rng.choice(ORG_TEMPLATES), {"org": (org, "ORG")})
    if bucket < 0.66:
        loc = assemble_loc(rng)
        return render(rng.choice(LOC_TEMPLATES), {"loc": (loc, "LOC")})
    if bucket < 0.90:
        person = assemble_person(rng)
        person2 = assemble_person(rng)
        org = assemble_org(rng)
        loc = assemble_loc(rng)
        template = rng.choice(MIXED_TEMPLATES)
        values = {
            "person": (person, "PERSON"),
            "person2": (person2, "PERSON"),
            "org": (org, "ORG"),
            "loc": (loc, "LOC"),
        }
        required = {field for _, field, _, _ in __import__("string").Formatter().parse(template) if field}
        return render(template, {key: value for key, value in values.items() if key in required})
    return Example(text=rng.choice(NEGATIVE_TEMPLATES), spans=tuple())


def generate_examples(count: int, seed: int) -> list[Example]:
    rng = random.Random(seed)
    examples: list[Example] = []
    seen: set[tuple[str, tuple[tuple[int, int, str], ...]]] = set()
    while len(examples) < count:
        example = make_example(rng)
        key = (example.text, tuple((span.start, span.end, span.type) for span in example.spans))
        if key in seen:
            continue
        seen.add(key)
        examples.append(example)
    return examples


class CharTokenizerAdapter:
    """Browser-equivalent tokenizer using only vocab.txt semantics.

    The upstream tokenizer is BertJapaneseTokenizer configured as basic word
    tokenization + character subword tokenization. For the chat-like strings used
    by this spike, its token IDs should equal one vocab lookup per non-whitespace
    character, wrapped in CLS/SEP. This assertion is treated as a hard feasibility
    gate and is reported rather than assumed.
    """

    def __init__(self, tokenizer):
        self.tokenizer = tokenizer
        self.vocab = tokenizer.get_vocab()
        self.cls_id = tokenizer.cls_token_id
        self.sep_id = tokenizer.sep_token_id
        self.pad_id = tokenizer.pad_token_id
        self.unk_id = tokenizer.unk_token_id

    def encode(self, text: str, max_length: int = MAX_LENGTH) -> tuple[list[int], list[int], list[int]]:
        ids = [self.cls_id]
        source_positions = [-1]
        for pos, char in enumerate(text):
            if char.isspace():
                continue
            ids.append(self.vocab.get(char, self.unk_id))
            source_positions.append(pos)
            if len(ids) >= max_length - 1:
                break
        ids.append(self.sep_id)
        source_positions.append(-1)
        return ids, [1] * len(ids), source_positions

    def parity(self, text: str) -> bool:
        browser_ids, _, _ = self.encode(text, max_length=10_000)
        python_ids = self.tokenizer(text, add_special_tokens=True, truncation=False)["input_ids"]
        return browser_ids == python_ids


def label_for_position(pos: int, spans: Iterable[EntitySpan]) -> int:
    for span in spans:
        if span.start <= pos < span.end:
            begin, inside = TYPE_TO_BIO[span.type]
            return begin if pos == span.start else inside
    return LABEL2ID["O"]


def encode_example(adapter: CharTokenizerAdapter, example: Example) -> dict[str, list[int]]:
    input_ids, attention_mask, source_positions = adapter.encode(example.text)
    labels = [-100]
    for pos in source_positions[1:-1]:
        labels.append(label_for_position(pos, example.spans))
    labels.append(-100)
    return {
        "input_ids": input_ids,
        "attention_mask": attention_mask,
        "labels": labels,
    }


class EncodedDataset(Dataset):
    def __init__(self, rows: list[dict[str, list[int]]]):
        self.rows = rows

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, list[int]]:
        return self.rows[index]


def collate(rows: list[dict[str, list[int]]], pad_id: int) -> dict[str, torch.Tensor]:
    max_len = max(len(row["input_ids"]) for row in rows)
    batch = {"input_ids": [], "attention_mask": [], "labels": []}
    for row in rows:
        padding = max_len - len(row["input_ids"])
        batch["input_ids"].append(row["input_ids"] + [pad_id] * padding)
        batch["attention_mask"].append(row["attention_mask"] + [0] * padding)
        batch["labels"].append(row["labels"] + [-100] * padding)
    return {key: torch.tensor(value, dtype=torch.long) for key, value in batch.items()}


def train_model(model, train_rows, valid_rows, pad_id: int) -> dict[str, object]:
    train_loader = DataLoader(
        EncodedDataset(train_rows),
        batch_size=BATCH_SIZE,
        shuffle=True,
        collate_fn=lambda rows: collate(rows, pad_id),
        generator=torch.Generator().manual_seed(SEED),
    )
    valid_loader = DataLoader(
        EncodedDataset(valid_rows),
        batch_size=BATCH_SIZE,
        shuffle=False,
        collate_fn=lambda rows: collate(rows, pad_id),
    )
    optimizer = AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=0.01)
    total_steps = len(train_loader) * EPOCHS
    scheduler = get_linear_schedule_with_warmup(
        optimizer,
        num_warmup_steps=max(1, total_steps // 10),
        num_training_steps=total_steps,
    )
    history = []
    started = time.perf_counter()
    model.train()
    for epoch in range(EPOCHS):
        losses = []
        for batch in train_loader:
            optimizer.zero_grad(set_to_none=True)
            output = model(**batch)
            output.loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            losses.append(float(output.loss.detach()))
        model.eval()
        valid_losses = []
        with torch.no_grad():
            for batch in valid_loader:
                valid_losses.append(float(model(**batch).loss.detach()))
        history.append(
            {
                "epoch": epoch + 1,
                "trainLoss": statistics.mean(losses),
                "validLoss": statistics.mean(valid_losses),
            }
        )
        model.train()
    model.eval()
    return {"seconds": time.perf_counter() - started, "history": history, "steps": total_steps}


def load_benchmark() -> list[dict[str, object]]:
    data = json.loads(BENCHMARK_PATH.read_text(encoding="utf-8"))
    if data.get("marker") != "SYNTHETIC_FIXTURE":
        raise RuntimeError("Benchmark fixture must declare SYNTHETIC_FIXTURE")
    return data["cases"]


def decode_entities(text: str, source_positions: list[int], label_ids: list[int]) -> list[dict[str, object]]:
    entities: list[dict[str, object]] = []
    active_type: str | None = None
    active_start: int | None = None
    active_end: int | None = None

    def flush() -> None:
        nonlocal active_type, active_start, active_end
        if active_type is not None and active_start is not None and active_end is not None:
            entities.append(
                {
                    "start": active_start,
                    "end": active_end,
                    "type": MODEL_TO_BENCHMARK_TYPE[active_type],
                    "value": text[active_start:active_end],
                }
            )
        active_type = None
        active_start = None
        active_end = None

    for pos, label_id in zip(source_positions[1:-1], label_ids[1:-1]):
        if pos < 0:
            continue
        label = ID2LABEL[int(label_id)]
        if label == "O":
            flush()
            continue
        prefix, entity_type = label.split("-", 1)
        contiguous = active_end == pos
        if prefix == "B" or active_type != entity_type or not contiguous:
            flush()
            active_type = entity_type
            active_start = pos
            active_end = pos + 1
        else:
            active_end = pos + 1
    flush()
    return entities


def gold_with_offsets(case: dict[str, object]) -> list[dict[str, object]]:
    text = str(case["text"])
    result = []
    search_from = 0
    for item in case["gold"]:
        value = str(item["value"])
        start = text.find(value, search_from)
        if start < 0:
            start = text.find(value)
        if start < 0:
            raise RuntimeError(f"Gold value not found in synthetic case {case['id']}")
        end = start + len(value)
        result.append({"start": start, "end": end, "type": item["type"], "value": value})
        search_from = end
    return result


def strict_equal(a: dict[str, object], b: dict[str, object]) -> bool:
    return a["type"] == b["type"] and a["start"] == b["start"] and a["end"] == b["end"]


def overlap(a: dict[str, object], b: dict[str, object]) -> bool:
    return a["type"] == b["type"] and int(a["start"]) < int(b["end"]) and int(b["start"]) < int(a["end"])


def maximum_greedy_matches(pred: list[dict[str, object]], gold: list[dict[str, object]], predicate) -> int:
    used: set[int] = set()
    hits = 0
    for prediction in pred:
        for index, expected in enumerate(gold):
            if index not in used and predicate(prediction, expected):
                used.add(index)
                hits += 1
                break
    return hits


def metric_block(predictions: list[list[dict[str, object]]], golds: list[list[dict[str, object]]]) -> dict[str, object]:
    pred_flat = [item for group in predictions for item in group]
    gold_flat = [item for group in golds for item in group]

    def summarize(predicate) -> dict[str, object]:
        hits = sum(maximum_greedy_matches(p, g, predicate) for p, g in zip(predictions, golds))
        return {
            "hits": hits,
            "gold": len(gold_flat),
            "predicted": len(pred_flat),
            "recall": hits / len(gold_flat) if gold_flat else None,
            "precision": hits / len(pred_flat) if pred_flat else None,
        }

    per_type = {}
    for entity_type in ["PERSON", "COMPANY", "ADDRESS"]:
        typed_predictions = [[item for item in group if item["type"] == entity_type] for group in predictions]
        typed_golds = [[item for item in group if item["type"] == entity_type] for group in golds]
        strict = sum(maximum_greedy_matches(p, g, strict_equal) for p, g in zip(typed_predictions, typed_golds))
        overlap_hits = sum(maximum_greedy_matches(p, g, overlap) for p, g in zip(typed_predictions, typed_golds))
        pred_count = sum(len(group) for group in typed_predictions)
        gold_count = sum(len(group) for group in typed_golds)
        per_type[entity_type] = {
            "gold": gold_count,
            "predicted": pred_count,
            "strictRecall": strict / gold_count if gold_count else None,
            "strictPrecision": strict / pred_count if pred_count else None,
            "overlapRecall": overlap_hits / gold_count if gold_count else None,
            "overlapPrecision": overlap_hits / pred_count if pred_count else None,
        }
    return {"strict": summarize(strict_equal), "overlap": summarize(overlap), "byType": per_type}


def torch_predict(model, adapter: CharTokenizerAdapter, text: str) -> tuple[list[dict[str, object]], float]:
    input_ids, attention_mask, source_positions = adapter.encode(text)
    ids = torch.tensor([input_ids], dtype=torch.long)
    mask = torch.tensor([attention_mask], dtype=torch.long)
    started = time.perf_counter()
    with torch.no_grad():
        logits = model(input_ids=ids, attention_mask=mask).logits
    elapsed = (time.perf_counter() - started) * 1000
    labels = logits.argmax(dim=-1)[0].tolist()
    return decode_entities(text, source_positions, labels), elapsed


def export_onnx(model, adapter: CharTokenizerAdapter) -> tuple[Path, Path, float]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    onnx_path = OUTPUT_DIR / "tiny-ja-ner.onnx"
    quantized_path = OUTPUT_DIR / "tiny-ja-ner.int8.onnx"

    class Wrapper(nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, input_ids, attention_mask):
            return self.inner(input_ids=input_ids, attention_mask=attention_mask).logits

    wrapper = Wrapper(model).eval()
    sample_ids, sample_mask, _ = adapter.encode("これは合成データだけを使うテストです。")
    input_ids = torch.tensor([sample_ids], dtype=torch.long)
    attention_mask = torch.tensor([sample_mask], dtype=torch.long)
    started = time.perf_counter()
    torch.onnx.export(
        wrapper,
        (input_ids, attention_mask),
        onnx_path,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "logits": {0: "batch", 1: "sequence"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )
    quantize_dynamic(onnx_path, quantized_path, weight_type=QuantType.QInt8)
    return onnx_path, quantized_path, time.perf_counter() - started


def ort_predict(session: ort.InferenceSession, adapter: CharTokenizerAdapter, text: str) -> tuple[list[dict[str, object]], float]:
    input_ids, attention_mask, source_positions = adapter.encode(text)
    feed = {
        "input_ids": np.asarray([input_ids], dtype=np.int64),
        "attention_mask": np.asarray([attention_mask], dtype=np.int64),
    }
    started = time.perf_counter()
    logits = session.run(["logits"], feed)[0]
    elapsed = (time.perf_counter() - started) * 1000
    labels = logits.argmax(axis=-1)[0].tolist()
    return decode_entities(text, source_positions, labels), elapsed


def evaluate(predictor, cases: list[dict[str, object]]) -> tuple[dict[str, object], list[dict[str, object]], list[float]]:
    predictions = []
    golds = []
    timings = []
    observations = []
    for case in cases:
        predicted, elapsed = predictor(str(case["text"]))
        gold = gold_with_offsets(case)
        predictions.append(predicted)
        golds.append(gold)
        timings.append(elapsed)
        if set((p["start"], p["end"], p["type"]) for p in predicted) != set((g["start"], g["end"], g["type"]) for g in gold):
            observations.append({
                "id": case["id"],
                "predicted": [{"value": p["value"], "type": p["type"]} for p in predicted],
                "gold": [{"value": g["value"], "type": g["type"]} for g in gold],
            })
    metrics = metric_block(predictions, golds)
    return metrics, observations, timings


def main() -> None:
    seed_everything(SEED)
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    load_started = time.perf_counter()
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, use_fast=False)
    model = AutoModelForTokenClassification.from_pretrained(
        BASE_MODEL,
        num_labels=len(LABELS),
        id2label=ID2LABEL,
        label2id=LABEL2ID,
        ignore_mismatched_sizes=True,
    )
    model.config.problem_type = "single_label_classification"
    model_load_seconds = time.perf_counter() - load_started
    adapter = CharTokenizerAdapter(tokenizer)

    train_examples = generate_examples(TRAIN_EXAMPLES, SEED + 1)
    valid_examples = generate_examples(VALID_EXAMPLES, SEED + 2)
    benchmark = load_benchmark()
    parity_texts = [e.text for e in train_examples[:100]] + [str(case["text"]) for case in benchmark]
    parity_failures = [text for text in parity_texts if not adapter.parity(text)]
    if parity_failures:
        raise RuntimeError(
            f"Browser-equivalent char tokenizer parity failed for {len(parity_failures)}/{len(parity_texts)} synthetic texts"
        )

    train_rows = [encode_example(adapter, example) for example in train_examples]
    valid_rows = [encode_example(adapter, example) for example in valid_examples]
    training = train_model(model, train_rows, valid_rows, adapter.pad_id)

    torch_metrics, torch_observations, torch_timings = evaluate(
        lambda text: torch_predict(model, adapter, text), benchmark
    )

    onnx_path, quantized_path, export_seconds = export_onnx(model, adapter)
    session_started = time.perf_counter()
    session = ort.InferenceSession(str(quantized_path), providers=["CPUExecutionProvider"])
    session_load_seconds = time.perf_counter() - session_started
    onnx_metrics, onnx_observations, onnx_timings = evaluate(
        lambda text: ort_predict(session, adapter, text), benchmark
    )

    result = {
        "marker": "SYNTHETIC_FIXTURE",
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "scope": "synthetic-only feasibility spike; not production accuracy",
        "baseModel": BASE_MODEL,
        "seed": SEED,
        "labels": LABELS,
        "training": {
            "examples": TRAIN_EXAMPLES,
            "validationExamples": VALID_EXAMPLES,
            "epochs": EPOCHS,
            "batchSize": BATCH_SIZE,
            "learningRate": LEARNING_RATE,
            **training,
        },
        "tokenizerParity": {
            "checked": len(parity_texts),
            "failures": 0,
            "strategy": "one vocab lookup per non-whitespace Unicode character + CLS/SEP",
            "upstreamClass": tokenizer.__class__.__name__,
        },
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "torch": torch.__version__,
            "onnxruntime": ort.__version__,
            "cpuThreads": torch.get_num_threads(),
        },
        "timing": {
            "modelLoadSeconds": model_load_seconds,
            "onnxExportAndQuantizeSeconds": export_seconds,
            "quantizedSessionLoadSeconds": session_load_seconds,
            "torchMeanPerCaseMs": statistics.mean(torch_timings),
            "onnxInt8MeanPerCaseMs": statistics.mean(onnx_timings),
        },
        "artifacts": {
            "onnxBytes": onnx_path.stat().st_size,
            "onnxInt8Bytes": quantized_path.stat().st_size,
            "onnxMiB": onnx_path.stat().st_size / (1024 * 1024),
            "onnxInt8MiB": quantized_path.stat().st_size / (1024 * 1024),
        },
        "benchmark": {
            "cases": len(benchmark),
            "torch": torch_metrics,
            "onnxInt8": onnx_metrics,
            "onnxMatchesTorchStrict": onnx_metrics["strict"] == torch_metrics["strict"],
            "torchMismatches": torch_observations,
            "onnxMismatches": onnx_observations,
        },
    }

    result_path = OUTPUT_DIR / "results.json"
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"Wrote {result_path}")


if __name__ == "__main__":
    main()
