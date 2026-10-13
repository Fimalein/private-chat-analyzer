# `@doccloak/core` evaluation for Japanese chat anonymization

Status: spike in progress for #8. This document records package-level findings and the reproducible synthetic benchmark used to decide whether the detector belongs in the default privacy path.

## Why evaluate it

The current structured scanner is strong at values with recognizable syntax, such as email addresses, phone numbers and credentials. It does not by itself solve free-form Japanese names, organizations and locations. `@doccloak/core` is being evaluated as an **optional browser-local NER layer**, not as a replacement for structured scanning or human Privacy Review.

## Package facts verified for this spike

- Evaluated package: `@doccloak/core@0.13.0`.
- License: Apache-2.0 for the engine package. The separate DocCloak web application is AGPL-3.0; this spike does not copy or depend on the web application's UI code.
- The engine is designed for local execution and exposes a host-provided `CoreEnv` for fetch, model cache, key/value storage, tokenizer construction and ONNX WASM paths.
- The default lightweight provider is GLiNER PII Small. Its model is downloaded at runtime rather than bundled with the package and is approximately 83 MB, plus tokenizer/runtime assets.
- Model and tokenizer files are pinned to immutable revisions and verified by SHA-256/size by the core loader before use.
- The GLiNER provider's built-in labels include person name, city/street address and company name. Those map to `PERSON`, `ADDRESS` and `COMPANY` in the engine.
- The provider default confidence threshold is 0.35. This spike also evaluates 0.25 and 0.50 to expose the precision/recall trade-off instead of assuming the default is suitable for Japanese LINE text.
- The reference browser host uses Cache Storage for model bytes and can work offline after a successful verified model/tokenizer download. A first-use network download is therefore still required unless the host self-distributes those assets.

Sources for these facts are the upstream `DocCloak.Core` package metadata, README, GLiNER provider implementation and the reference DocCloak browser environment. Re-check them before a future production integration because the upstream package can change.

## Synthetic Japanese benchmark

The corpus lives at:

`tests/fixtures/synthetic/doccloak-ja-benchmark.json`

Every sentence and entity is fabricated. Nothing is copied or transformed from a real chat. The initial corpus intentionally focuses on the gap we care about:

- `PERSON`
- `COMPANY`
- `ADDRESS` (used by DocCloak for city/street-address labels)
- negative conversational messages with no expected entity

The benchmark runs both the raw GLiNER predictions and the product-style `detectEntities(ML, regex)` pipeline. It reports strict span/type precision and recall plus overlap-based precision and recall, per type and overall. Exact-span scoring is deliberately kept because a detector that catches only part of a person's name can still leak the rest.

Run locally after installing spike-only dependencies:

```bash
npm install --no-save --package-lock=false @doccloak/core@0.13.0 @huggingface/transformers@4.2.0
node scripts/eval-doccloak-ja.mjs
```

The PR workflow runs the same benchmark and uploads `benchmark-output/doccloak-ja-results.json` as a short-lived artifact. The dependencies are not added to the application lockfile during the spike.

## Performance interpretation

The automated workflow is a GitHub-hosted Node baseline. It records first model load and mean detection time per synthetic case, but **it is not a representative browser or mobile measurement**.

A production decision still needs at least one real browser check on:

- Android-class mobile hardware;
- a desktop Chromium browser;
- cold first-use download/load;
- warm cached load;
- memory behavior on a long history;
- offline detection after the cache is populated.

No real chat should be used for those checks. Generate a larger synthetic history instead.

## Decision gate

Do not make ML detection default merely because the package runs successfully. Integration should require all of the following:

1. Japanese `PERSON` / `COMPANY` / `ADDRESS` recall is high enough that the feature materially reduces missed free-form identifiers.
2. False positives are manageable in Privacy Review and do not turn ordinary chat text into unusable redaction noise.
3. Mobile load time and memory are acceptable for an optional local feature.
4. Model download is explicit to the user; no sensitive text is sent during model acquisition or inference.
5. The existing structured scanner and final export rescan remain independent safety layers.
6. The UI continues to state that successful detection is not proof of anonymity.

Until those conditions are measured, the recommended status is **experimental / opt-in only**.
