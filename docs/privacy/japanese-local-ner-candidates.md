# Japanese-first local NER candidate screen

Issue: #41

This note follows the DocCloak / GLiNER PII Small spike in #39. That candidate was rejected because synthetic Japanese person-name recall remained zero. The goal here is narrower: identify a Japanese-first NER path that can plausibly run locally in a browser without replacing the existing structured scanner, Privacy Review, or final export rescan.

No real chat content is used in this evaluation.

## Requirements

A candidate must satisfy all of the following before integration work starts:

- useful Japanese recall for `PERSON`, organization/company names, and locations/addresses;
- browser-local inference with no chat text sent to a server;
- a tokenizer that can run in-browser without an external native morphological analyzer;
- manageable first-use download, warm-load time, memory, and per-message latency;
- redistribution / model-license terms that are compatible with this project;
- explicit opt-in status until synthetic accuracy and browser performance are measured.

Transformers.js / ONNX Runtime Web make conventional token classifiers architecturally plausible, but browser compatibility depends on the exact tokenizer and exported graph rather than the model architecture alone.

## Candidate A: DataSign/gliner-ja-pii-v1

Source: https://huggingface.co/DataSign/gliner-ja-pii-v1

Strengths:

- Apache-2.0.
- Fine-tuned specifically for Japanese PII.
- Model card reports, on its synthetic 600-sample / 1,318-span test set at threshold 0.5, overall F1 0.924, person-name F1 0.983, and address F1 0.890.
- Directly targets names, addresses, phone numbers, email addresses, dates, URLs, account numbers, and secrets.

Blocking concerns:

- Repository size is about 1.17 GB; PyTorch weights alone are about 1.16 GB and the tokenizer is about 16 MB.
- Intended Japanese preprocessing uses a custom Janome-based splitter. That is not a drop-in browser tokenizer.
- The model card notes that the standard whitespace splitter is not suitable for Japanese and that the Janome splitter is required for the intended behavior.

Decision for this project: **do not treat this as a production browser candidate in its current form**. It is useful as an accuracy reference / ceiling when comparing smaller local approaches. Reconsider only if a substantially smaller browser-ready export with equivalent Japanese preprocessing becomes available.

## Candidate B: Mizuiro-sakura/deberta-v2-base-japanese-finetuned-ner

Source: https://huggingface.co/Mizuiro-sakura/deberta-v2-base-japanese-finetuned-ner

Strengths:

- MIT.
- Japanese NER fine-tune based on the Stockmark Wikipedia NER dataset.
- Model card reports micro F1 around 0.81. Reported class F1 values include person names around 0.85, place names around 0.83, corporate names around 0.82, and other organization names around 0.74.
- Uses `DebertaV2ForTokenClassification`; this architecture has a plausible ONNX browser path.

Blocking concerns:

- About 0.1B parameters before export / quantization, so still comparatively large for an opt-in browser feature.
- The model card requires SentencePiece and Juman++. Browser compatibility therefore cannot be inferred from architecture support alone.
- There is no existing browser-ready model repository for this exact Japanese fine-tune.

Decision for this project: **interesting accuracy baseline, but tokenizer compatibility is a hard feasibility gate**. Do not spend time on full accuracy benchmarking until a browser-equivalent tokenizer path is demonstrated.

## Candidate C: tiny Japanese character-level DeBERTa fine-tune

Base model: https://huggingface.co/ku-nlp/deberta-v2-tiny-japanese-char-wwm

This is the selected engineering candidate.

Why it is interesting:

- 10.1M parameters; upstream safetensors weights are about 40 MB before export / quantization.
- Character-level Japanese tokenization.
- Its tokenizer configuration uses `BertJapaneseTokenizer` with `word_tokenizer_type: basic` and `subword_tokenizer_type: character`, avoiding a native morphological analyzer at inference time.
- DeBERTa-v2 token classification exports successfully to standard ONNX in the current spike.

The upstream repository does **not** ship `tokenizer.json`, so the production path should not assume that a generic browser tokenizer can load it directly. PR #43 instead tests a small browser-equivalent tokenizer: per-character NFKC normalization, `vocab.txt` lookup, and `[CLS]` / `[SEP]`. That path matched the upstream Python tokenizer on all 124 synthetic strings tested. Broader Unicode parity tests are still required.

### Feasibility result from PR #43

The synthetic-only spike fine-tuned Candidate C and successfully exported and dynamically quantized it:

- float ONNX: about 22.27 MiB;
- INT8 ONNX: about 7.03 MiB;
- quantized ONNX matched PyTorch strict benchmark metrics exactly;
- overall strict recall / precision: 90.0% / 87.1%;
- overall overlap recall / precision: 100% / 96.8%;
- PERSON strict recall / precision: 90.9% / 90.9%;
- COMPANY strict recall: 100%;
- ADDRESS strict recall / precision: 77.8% / 77.8%;
- CI-runner quantized ONNX inference averaged about 1.26 ms per short synthetic message.

These values are encouraging enough to continue, but they are **not production accuracy or browser-performance claims**. The benchmark is small and synthetic, and the remaining failures include incomplete person/address spans. In a privacy workflow, an overlapping but incomplete span can still leak identifying text, so exact-boundary quality is a hard gate.

License / data caveat:

- Base model: CC-BY-SA-4.0.
- Stockmark `ner-wikipedia-dataset`: CC-BY-SA-3.0 and commercially usable, with share-alike obligations for modified / redistributed dataset material.
- PR #43 intentionally uses synthetic-only training and does not distribute fine-tuned model weights.
- Before publishing derived weights, explicitly review whether the base-model and future training-data share-alike terms impose distribution obligations on the model artifact or accompanying materials.

## Decision

Candidate C **passes the first feasibility screen**. It is the current preferred route for a Japanese-first local NER helper, but it should remain research-only / opt-in until the next validation gate is complete.

Next steps:

1. Expand exact-boundary evaluation with a much larger adversarial synthetic corpus, especially suffixes, particles, numerals, punctuation, emoji, mixed scripts, compatibility characters, and ambiguous organization/location phrases.
2. Evaluate and, if justified, fine-tune on an appropriately licensed Japanese NER dataset after license review; keep real private chats out of training and testing.
3. Implement the NFKC + `vocab.txt` tokenizer in TypeScript and add parity fixtures for difficult Unicode cases.
4. Load the quantized model with a browser ONNX runtime and measure cold download/load, warm load, memory, and per-message latency in desktop Chromium.
5. Test Android-class hardware only after exact-boundary accuracy remains useful.
6. Keep the deterministic structured scanner, Privacy Review, and final export rescan independent. ML must not become the sole privacy gate.

## Stop conditions

Stop or redesign the candidate if the browser tokenizer cannot preserve parity, ONNX Web requires unsupported operators, exact person/address recall degrades substantially on broader data, false positives make Privacy Review noisy, or browser/mobile memory and load time are impractical.

## References

- Japanese PII GLiNER: https://huggingface.co/DataSign/gliner-ja-pii-v1
- Japanese DeBERTa NER: https://huggingface.co/Mizuiro-sakura/deberta-v2-base-japanese-finetuned-ner
- Tiny Japanese character DeBERTa: https://huggingface.co/ku-nlp/deberta-v2-tiny-japanese-char-wwm
- Stockmark NER dataset: https://github.com/stockmarkteam/ner-wikipedia-dataset
