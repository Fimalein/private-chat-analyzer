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

Transformers.js currently supports token classification / NER and includes DeBERTa-v2 token-classification model support, so ONNX-exported conventional token classifiers are architecturally plausible. Browser compatibility still depends on the exact tokenizer and model files.

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
- Uses `DebertaV2ForTokenClassification`; this architecture is supported by Transformers.js.

Blocking concerns:

- About 0.1B parameters before export / quantization, so still comparatively large for an opt-in browser feature.
- The model card requires SentencePiece and Juman++. Browser compatibility therefore cannot be inferred from architecture support alone.
- There is no existing Transformers.js-tagged browser-ready model repository for this exact Japanese fine-tune.

Decision for this project: **interesting accuracy baseline, but tokenizer compatibility is a hard feasibility gate**. Do not spend time on full accuracy benchmarking until a browser-equivalent tokenizer path is demonstrated.

## Candidate C: tiny Japanese character-level DeBERTa fine-tune

Base model: https://huggingface.co/ku-nlp/deberta-v2-tiny-japanese-char-wwm

This is currently the preferred engineering experiment rather than an already finished NER model.

Why it is interesting:

- 10.1M parameters; safetensors weights are about 40 MB before quantization.
- Character-level Japanese tokenization. The model card states that raw text can be passed directly to the tokenizer and is tokenized at character level.
- Its tokenizer configuration uses `BertJapaneseTokenizer` with `word_tokenizer_type: basic` and `subword_tokenizer_type: character`, avoiding a native morphological analyzer at inference time.
- DeBERTa-v2 token classification is supported by Transformers.js, so a fine-tuned ONNX model has a plausible browser path.

License / data caveat:

- Base model: CC-BY-SA-4.0.
- Stockmark `ner-wikipedia-dataset`: CC-BY-SA-3.0 and commercially usable, with share-alike obligations for modified / redistributed dataset material.
- Before publishing derived weights, explicitly review whether the training-data and base-model share-alike terms impose distribution obligations on the model artifact or accompanying materials. Do not assume that a fine-tuned model can be redistributed under an arbitrary permissive license.

## Recommended next spike

Proceed with Candidate C first because it directly tests the main unresolved engineering question: can a small Japanese-first NER model be accurate enough while remaining practical in-browser?

Suggested steps:

1. Build a synthetic-only training/evaluation set for `PERSON`, `ORG/COMPANY`, and `LOC/ADDRESS`, reusing the #39 evaluation schema.
2. Fine-tune `ku-nlp/deberta-v2-tiny-japanese-char-wwm` for token classification in an isolated experiment; do not add training dependencies to the web app.
3. Export the resulting token-classification model to ONNX and quantize it.
4. Verify that `@huggingface/transformers` can load both tokenizer and model without custom native code.
5. Run strict-span and overlap precision/recall on the synthetic corpus, including ordinary-chat negatives.
6. Only if recall is materially useful, measure cold download/load, warm load, memory, and latency in desktop Chromium, then Android-class hardware.
7. Keep the feature opt-in and preserve the existing deterministic privacy layers regardless of ML quality.

## Stop conditions

Stop the candidate early if any of the following occurs:

- browser tokenizer cannot reproduce training tokenization;
- ONNX export requires unsupported custom operators;
- quantized first-use payload is still unreasonably large for an optional privacy helper;
- Japanese person-name recall remains poor enough that the feature does not materially reduce misses;
- false positives make Privacy Review substantially noisier than the current workflow.

## References

- Japanese PII GLiNER: https://huggingface.co/DataSign/gliner-ja-pii-v1
- Japanese DeBERTa NER: https://huggingface.co/Mizuiro-sakura/deberta-v2-base-japanese-finetuned-ner
- Tiny Japanese character DeBERTa: https://huggingface.co/ku-nlp/deberta-v2-tiny-japanese-char-wwm
- Stockmark NER dataset: https://github.com/stockmarkteam/ner-wikipedia-dataset
- Transformers.js token classification: https://huggingface.co/docs/transformers.js/pipelines
