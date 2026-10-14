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

Instead it tests a browser-equivalent path: one `vocab.txt` lookup per non-whitespace character, plus `[CLS]` / `[SEP]`. The spike compares those IDs to the upstream Python tokenizer for synthetic chat strings and fails if they differ. If parity holds, a small TypeScript tokenizer can be implemented without Juman++, MeCab, Sudachi, or Janome.

## Interpretation limits

Passing this spike would show engineering feasibility, **not production privacy accuracy**. Synthetic template data can overstate generalization. A later phase would still need a carefully licensed Japanese NER corpus and a larger synthetic adversarial set before ML could be considered useful beyond an experimental opt-in helper.

The existing deterministic structured scanner, Privacy Review, and export rescan remain independent layers regardless of the result.

## Stop conditions

Stop this candidate if tokenizer parity fails, ONNX export/quantization fails, quantized payload is not meaningfully smaller, person-name recall remains poor, or false positives make review impractical.

The workflow uploads **metrics only** for seven days. It does not upload the fine-tuned model weights.
