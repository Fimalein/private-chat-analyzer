# `@doccloak/core` evaluation for Japanese chat anonymization

Status: **evaluation complete for #8 — do not integrate GLiNER PII Small into the default privacy path**.

This document records the package-level findings and synthetic benchmark used to evaluate `@doccloak/core@0.13.0` for Japanese chat anonymization.

## Why it was evaluated

The current structured scanner is strong at values with recognizable syntax, such as email addresses, phone numbers and credentials. It does not by itself solve free-form Japanese names, organizations and locations. `@doccloak/core` was evaluated as a possible **browser-local NER layer**, not as a replacement for structured scanning or human Privacy Review.

## Package facts verified for this spike

- Evaluated package: `@doccloak/core@0.13.0`.
- License: Apache-2.0 for the engine package. The separate DocCloak web application is AGPL-3.0; this spike does not copy or depend on the web application's UI code.
- The engine is designed for local execution and exposes a host-provided `CoreEnv` for fetch, model cache, key/value storage, tokenizer construction and ONNX WASM paths.
- The default lightweight provider is GLiNER PII Small. Its model is downloaded at runtime rather than bundled with the package and is approximately 83 MB, plus tokenizer/runtime assets.
- Model and tokenizer files are pinned to immutable revisions and verified by SHA-256/size by the core loader before use.
- The GLiNER provider's built-in labels include person name, city/street address and company name. Those map to `PERSON`, `ADDRESS` and `COMPANY` in the engine.
- The provider default confidence threshold is 0.35. The benchmark swept 0.05, 0.10, 0.20, 0.35 and 0.50 so the Japanese result did not depend on the upstream default.
- The reference browser host uses Cache Storage for model bytes and can work offline after a successful verified model/tokenizer download. A first-use network download is therefore still required unless the host self-distributes those assets.

Sources for these facts are the upstream `DocCloak.Core` package metadata, README, GLiNER provider implementation and the reference DocCloak browser environment. Re-check them before any future evaluation because the upstream package can change.

## Synthetic Japanese benchmark

The corpus lives at:

`tests/fixtures/synthetic/doccloak-ja-benchmark.json`

Every sentence and entity was written for this benchmark and is not copied or transformed from a real chat. The final corpus contains 24 short Japanese chat-like cases with 30 gold entities:

- 11 `PERSON`
- 10 `COMPANY`
- 9 `ADDRESS`
- three negative conversational cases with no expected entity

The benchmark runs both raw GLiNER predictions and the product-style `detectEntities(ML, regex)` pipeline. It reports strict span/type precision and recall plus overlap-based precision and recall, per type and overall. Exact-span scoring is deliberately retained because detecting only part of an identifier can still leak the remainder.

Run locally after installing spike-only dependencies:

```bash
npm install --no-save @doccloak/core@0.13.0 @huggingface/transformers@4.2.0
node scripts/eval-doccloak-ja.mjs
```

The PR workflow runs the same benchmark and uploads `benchmark-output/doccloak-ja-results.json` as a short-lived artifact. The spike does not commit DocCloak or Transformers to the application's package manifest or lockfile.

## Results

Reference run: GitHub Actions run `38482739363` on 2026-10-14 JST.

| Threshold | Raw ML target overlap recall | Raw ML PERSON recall | Product-pipeline overlap recall | Product PERSON recall |
| ---: | ---: | ---: | ---: | ---: |
| 0.05 | 3/30 (10.0%) | 0/11 (0%) | 5/30 (16.7%) | 0/11 (0%) |
| 0.10 | 2/30 (6.7%) | 0/11 (0%) | 4/30 (13.3%) | 0/11 (0%) |
| 0.20 | 1/30 (3.3%) | 0/11 (0%) | 10/30 (33.3%) | 0/11 (0%) |
| 0.35 | 0/30 (0%) | 0/11 (0%) | 11/30 (36.7%) | 0/11 (0%) |
| 0.50 | 0/30 (0%) | 0/11 (0%) | 11/30 (36.7%) | 0/11 (0%) |

The decisive result is `PERSON`: **GLiNER PII Small detected none of the 11 Japanese person-name instances at any tested threshold**, including 0.05. This directly fails the main reason for evaluating the package.

At threshold 0.05, raw ML emitted 27 entities, but only three were target types (`COMPANY` ×1 and `ADDRESS` ×2). The other 24 were classifications such as `CURRENCY` ×13, `IBAN` ×6 and `DATE` ×5. Lowering the threshold therefore did not recover Japanese person names; it mainly introduced unrelated classifications.

At the upstream default threshold 0.35, raw ML emitted only three entities and **none** were `PERSON`, `COMPANY` or `ADDRESS`. The product pipeline nevertheless reached 90% overlap recall for `COMPANY` (9/10) and 22.2% for `ADDRESS` (2/9), because its regex layer contributes detections independently of GLiNER. Those results do not demonstrate useful Japanese NER from the ML model. Product-pipeline `PERSON` recall remained 0%.

Strict-span performance was also weak. At threshold 0.35 the combined product pipeline had strict recall 3/30 (10.0%) despite overlap recall 11/30 (36.7%). Partial-span matches are not sufficient evidence for automatic anonymization.

## Performance observation

On the GitHub-hosted Node runner, verified model download/load took about 5.7 seconds and the short-message inference loop averaged roughly 187–200 ms per case across thresholds. These are only CI baselines, not browser/mobile measurements.

A production candidate would normally also be tested on Android-class hardware, desktop Chromium, cold/warm cache, offline-after-cache and large synthetic histories. **Those measurements are intentionally not pursued for this candidate because the Japanese accuracy gate failed first.** Performance work cannot compensate for zero person-name recall in the tested corpus.

The spike-only install reported more npm audit findings in the temporary benchmark environment than the base application install. This evaluation did not isolate those findings by dependency provenance, so they are not attributed to DocCloak here. Any future integration attempt would need a separate dependency/security review.

## Decision

`@doccloak/core@0.13.0` with GLiNER PII Small is **not recommended for default or opt-in integration in this project at this time**. The blocker is Japanese free-form entity recall, especially `PERSON`, rather than licensing or ability to execute locally.

The existing structured scanner, pseudonymization/review flow and export rescan remain the supported privacy path. The useful organization-pattern behavior seen in the combined pipeline can be pursued separately with explicit deterministic rules if needed; importing an ~83 MB ML model is not justified by this benchmark.

A future re-evaluation is reasonable only if the upstream model/provider materially changes or a Japanese-focused local NER candidate becomes available. Any replacement should be judged against the same synthetic benchmark principles and must never be treated as proof of anonymity.
