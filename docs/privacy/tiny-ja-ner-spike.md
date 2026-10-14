# Tiny Japanese NER feasibility spike

Issue: #41

This spike tests whether `ku-nlp/deberta-v2-tiny-japanese-char-wwm` can become a practical **optional browser-local** NER helper for Japanese chat. It is intentionally synthetic-only: no real chat content and no public NER corpus are used for training or evaluation in this phase.

## What is measured

- browser-equivalent tokenizer parity against the upstream Python tokenizer;
- synthetic token-classification fine-tuning for `PERSON`, `ORG`, and `LOC`;
- strict-span and overlap precision/recall on the held-out synthetic corpus from the DocCloak spike;
- ONNX export feasibility;
- dynamic INT8 quantization feasibility;
- PyTorch vs quantized-ONNX metric parity;
- model payload size and CPU timing on the GitHub-hosted runner.

The training generator uses fabricated compositional names, organizations, locations, templates, and ordinary-chat negatives. The fixed evaluation corpus is also synthetic and is kept separate from the generated training examples.

## Important tokenizer detail

The upstream repository does **not** ship a `tokenizer.json`. Its configuration names `BertJapaneseTokenizer` with `word_tokenizer_type: basic` and `subword_tokenizer_type: character`. Therefore this spike does not assume that Transformers.js can instantiate the upstream tokenizer directly.

Instead it tests a browser-equivalent path: per-character Unicode NFKC normalization, then `vocab.txt` lookup for each non-whitespace character, plus `[CLS]` / `[SEP]`. This can be reproduced in JavaScript with `String.prototype.normalize("NFKC")` and does not require Juman++, MeCab, Sudachi, or Janome.

The parity gate passed for all **124 synthetic strings** checked by this spike. That is evidence for the tested input class, not a claim of universal tokenizer equivalence. A production implementation still needs dedicated parity tests for punctuation, emoji, combining marks, unusual whitespace, compatibility characters, and long messages.

## Result

The candidate **passes the engineering-feasibility gate** and is worth further evaluation. It does **not** yet pass the production-integration gate.

The successful GitHub-hosted CPU run used 960 generated training examples, 192 generated validation examples, five epochs, and 150 optimization steps. Training took about **30.4 seconds** on that runner. These timings are runner-specific and are not browser or mobile measurements.

The fixed held-out synthetic benchmark contains 24 messages and 30 gold entities. PyTorch and the quantized ONNX model produced identical strict metrics:

| Metric | Result |
| --- | ---: |
| Overall strict recall | 27 / 30 = **90.0%** |
| Overall strict precision | 27 / 31 = **87.1%** |
| Overall overlap recall | 30 / 30 = **100%** |
| Overall overlap precision | 30 / 31 = **96.8%** |
| PERSON strict recall / precision | 10 / 11 = **90.9% / 90.9%** |
| COMPANY strict recall | 10 / 10 = **100%** |
| COMPANY strict precision | 10 / 11 = **90.9%** |
| ADDRESS strict recall / precision | 7 / 9 = **77.8% / 77.8%** |

The remaining errors are mainly boundary quality rather than complete misses: one synthetic person name was truncated, two address spans overlapped the correct address but included or omitted boundary text, and one spurious one-character company prediction appeared. For a privacy feature, overlap recall is encouraging but **partial spans are still unsafe** because the uncovered suffix or prefix can leak identifying text. Exact-span performance therefore remains a required gate.

Export and quantization also succeeded:

- float ONNX: about **22.27 MiB**;
- dynamic INT8 ONNX: about **7.03 MiB**;
- quantized ONNX session load: about **94 ms** on the CI runner;
- mean short-message inference: about **5.40 ms** in PyTorch and **1.26 ms** in quantized ONNX on the CI runner.

The 7 MiB model size is small enough to justify a real browser experiment. The timing numbers should not be used as browser/mobile claims until Chromium and Android-class measurements exist.

## Interpretation limits

This result is deliberately a feasibility signal, **not production privacy accuracy**. The synthetic generator uses compositional templates, so it can make generalization look better than it will be on natural Japanese conversation. The held-out corpus is separate from generated training examples, but it is still small and synthetic.

A later phase needs a larger adversarial synthetic set and evaluation on an appropriately licensed Japanese NER dataset. Before distributing fine-tuned weights, the CC-BY-SA-4.0 base-model obligations and any training-data share-alike obligations also need explicit review.

The existing deterministic structured scanner, Privacy Review, and export rescan remain independent layers regardless of ML quality. ML remains opt-in.

## Decision

Continue with this candidate, but **do not integrate it into the application yet**. The next gate is broader exact-boundary validation plus an actual TypeScript tokenizer / ONNX Runtime Web prototype in desktop Chromium, followed by Android-class testing only if accuracy remains useful.

The workflow uploads **metrics only** for seven days. It does not upload the fine-tuned model weights.
