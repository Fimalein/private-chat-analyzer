# Tiny Japanese NER browser-runtime spike

Issue: #44

This follow-up checks the next engineering gate for the synthetic-only tiny Japanese NER candidate from PR #43: can the quantized ONNX model actually run inside Chromium with the browser-equivalent tokenizer, while preserving the held-out strict-span metrics?

## Scope

This is still a research spike, not production integration.

- No real chat text is used.
- The model is retrained from fabricated examples during the workflow.
- Fine-tuned model weights and tokenizer assets are **not uploaded** as artifacts.
- The only uploaded artifacts are metrics JSON files.
- ML remains optional/research-only; the structured scanner, Privacy Review, and export rescan remain independent.

## Browser path under test

The workflow:

1. reruns the deterministic synthetic training/export script from PR #43;
2. produces the same dynamically quantized INT8 ONNX model;
3. exposes the upstream `vocab.txt` plus a minimal label/config file only inside the CI workspace;
4. launches headless Chromium with Playwright;
5. loads `onnxruntime-web` using the WASM execution provider;
6. applies the browser tokenizer strategy: Unicode NFKC per input code point, then `vocab.txt` lookup plus `[CLS]`/`[SEP]`;
7. evaluates the existing 24-case synthetic held-out corpus in the browser;
8. records local session-load time, first inference, repeated warm latency, strict/overlap metrics, and Chromium JS-heap observations;
9. asserts Chromium strict/overlap/by-type metrics and per-case mismatch details match the same run's native Python ONNX INT8 results, failing CI on disagreement.

The browser page and server are local to the GitHub Actions runner. Therefore the measured session-load value is **not** a first-use internet download benchmark. It measures browser/WASM/model initialization using a local HTTP asset. Likewise `performance.memory` only reports Chromium JS heap and is not a complete process or WebAssembly-memory measurement.

## Runtime dependencies

The spike pins:

- `onnxruntime-web@1.22.0`;
- `playwright@1.55.0`;
- the same Python training/export stack used by PR #43.

These are spike-only dependencies and are not added to the application package manifest or lockfile. They are installed under the ignored `benchmark-output/tiny-ja-ner/browser-deps/` directory with an isolated npm prefix to avoid mixing the spike runtime with the Next.js application's dependency tree. The standalone Playwright CLI is run from that prefix.

## Quantization compatibility finding

The initial all-operator dynamic INT8 export loaded in native Python ONNX Runtime but failed inside Chromium WASM because the DeBERTa convolution was converted to a `ConvInteger` node that the pinned browser runtime could not execute. After limiting quantization to matrix operations, Chromium completed the inference stage, but the first run still failed when the Node runner tried to import a package-private `onnxruntime-web/package.json` export; the runner now reads dependency version metadata from the isolated installed file path instead. This is a runtime compatibility failure, not an accuracy result. The follow-up export quantizes only `MatMul`/`Gemm`, leaving convolution in FP32, and asserts that no `ConvInteger` nodes remain. The resulting model size and browser metrics must be measured again; the original ~7 MiB figure does not automatically apply to this revised graph.

## Verified 24-case browser engineering baseline (2026-10-18)

[Chromium CI run #7](https://github.com/Fimalein/private-chat-analyzer/actions/runs/39098278684) passed with a 19.43 MiB matrix-quantized ONNX model: strict-span recall 27/30 = 90.0%, precision 27/31 = 87.1%, ADDRESS strict recall 7/9 = 77.8%. Browser/native ONNX parity passed. Local session init ~1,165 ms; warm mean ~10.5 ms (p95 ~14.3 ms). These are **24 fabricated cases on an x64 CI runner**, not representative production accuracy or mobile performance.

## Adversarial boundary suite (in progress)

The separate `scripts/generate_tiny_ja_ner_adversarial.py` produces a deterministic **480-case / 15-category**, synthetic-only, strictly held-out set. The original 24-case fixture remains unchanged for direct comparison. Cases include particles, aliases, Latin names, numbered addresses, `丁目`, building/room suffixes, organization suffix ambiguity, emoji/punctuation, Unicode width/NFKC and combining marks, whitespace, repeated values, mixed multiple entities, difficult negatives, and deliberately out-of-window entities. Exact Unicode code-point span offsets are stored in the generated fixture to avoid accidental first-occurrence matching when names repeat.

The browser workflow validates generator invariants using stdlib unit tests before running training. The fixture is generated only inside ignored `benchmark-output/`, **never trained on**, and excluded from uploaded artifacts. Native Python ONNX and Chromium independently evaluate identical generated cases. CI checks that the complete adversarial summary matches across runtimes: overall and per-category strict/overlap results, false-positive negative cases, mismatch counts and IDs, and privacy-coverage metrics.

### Interpretation

- **Strict span**: both entity type and entire start/end boundary match.
- **Overlap**: any same-type overlap; useful for debugging but is *not* enough for anonymization.
- **Full coverage**: the union of same-type predicted spans covers *every code point* of each labeled sensitive entity. `uncoveredCharacters` counts remaining labeled code points. This is an optimistic detection-side proxy, **not** a guarantee that the actual export transformation removes those characters.
- **Negatives**: `negativeCasesWithPredictions` counts entity-free messages that got any candidate; these become extra Privacy Review burden.
- **Truncation-tail**: the gold entity is intentionally outside the 94-content-token window; failures are expected and should motivate chunking/overlap before shipping, not be misattributed solely to model weights.
- **Tokenizer parity**: upstream Python-tokenizer mismatches on adversarial Unicode are reported as a separate engineering gate; the original 124-case check remains a hard gate. Passing native/browser prediction agreement does not prove agreement with the upstream tokenizer.

This is a **synthetic stress test**, not an independently sampled Japanese chat dataset. Training still uses a narrow synthetic distribution, so even high scores would not substantiate complete privacy.

## Verified adversarial findings (2026-10-18)

[Headless Chromium run](https://github.com/Fimalein/private-chat-analyzer/actions/runs/39100498946) completed successfully, including native-Python/Chromium parity on the complete adversarial summary. This is an **evaluation of the unmodified synthetic-only trained model**, not a privacy capability claim.

| Synthetic test (15 x 32 = 480 cases) | Observed |
| --- | ---: |
| Labeled entities / model predictions | 664 / 779 |
| Exact-span recall | **294/664 = 44.3%** |
| Exact-span precision | **294/779 = 37.7%** |
| Any-overlap recall | 571/664 = 86.0% |
| Every labeled code point covered (full entity) | **342/664 = 51.5%** |
| Labeled entity characters not covered | **1,599 / 4,596 = 34.8%** |
| Address exact-span recall | **36/232 = 15.5%** |
| Numbered address full coverage | **0/32** |
| Building/room address full coverage | **0/32** |
| `丁目` address full coverage | **1/32** |
| Ordinary-word negative cases with false detections | **18/32 = 56.3%** |
| Upstream tokenizer mismatches in adversarial corpus | **32/480** (all combining-mark group) |

The intentionally out-of-window `truncation_tail` group explains **40** of the entity misses and **254** uncovered characters. Even *excluding this group*, exact-span recall is just **294/624 = 47.1%** and complete-coverage recall is **342/624 = 54.8%**. The difference between strong overlap recall and poor full coverage makes this model unsafe to rely on for anonymization.

The CI used headless desktop Chromium on Linux/x64 with locally hosted benchmark assets. No Android or network-cold-load results were collected. The metrics artifact contains synthetic-only summaries; model weights and individual private chat samples were not uploaded.

### Interpretation / next fixes

1. **Fix span coverage first**, especially numeric street, `丁目`, and building/room suffixes; rule-assisted expansion must be conservatively tested against difficult negatives and must not silently count as safe anonymization.
2. **Handle long messages** with overlapping chunk windows and original-code-point remapping; the current 96-token input maximum loses all tail entities by design.
3. **Resolve upstream tokenizer incompatibility** for combining marks and inspect unnormalized/normalized character alignment. Native/Chromium parity merely confirms the two custom implementations match each other.
4. **Evaluate false positives and distribution shift** on more varied fabricated negatives and an appropriately licensed independent Japanese NER benchmark.
5. Keep ML as an **explicitly opt-in supplementary reviewer**, never a replacement for structured high-risk scanning or final export rescan.

## Experimental ADDRESS suffix repair (2026-10-18)

This branch now includes an **optional comparison-only** address post-processor in `scripts/repair_tiny_ja_address_spans.py` and the corresponding browser helper `scripts/repair-tiny-ja-address-spans.js`. It operates exclusively on *existing* ADDRESS predictions and may extend an administrative-place span into a following address numeral, `丁目`, or building/room suffix. It never invents detections, never touches other entity types, never alters the base model's predictions in-place, and is **not integrated with Privacy Review or export**.

The [verified headless Chromium benchmark run](https://github.com/Fimalein/private-chat-analyzer/actions/runs/39102361576) used the same original 480 entirely fabricated held-out cases for raw and repaired scoring, and matched Python ONNX metrics exactly. All 4 CI workflows passed for commit `c342121cb01a750f03f65cea1ef3a543dac9904e`.

| Metric (synthetic only) | Raw NER | With ADDRESS suffix repair |
| --- | ---: | ---: |
| Overall exact-span recall | 294/664 = **44.3%** | 361/664 = **54.4%** |
| Overall exact-span precision | 294/779 = 37.7% | 361/779 = 46.3% |
| Fully covered labeled entities | 342/664 = **51.5%** | 459/664 = **69.1%** |
| Uncovered labeled characters | **1,599** / 4,596 | **674** / 4,596 |
| Numbered address full coverage | 0/32 | **32/32** |
| `丁目` address full coverage | 1/32 | **30/32** |
| Building/room address full coverage | 0/32 | **32/32** |
| Mixed entities full coverage | 88/96 | **96/96** |
| Entity-free negative messages with any prediction | 18/32 | 18/32 |
| Explicit tail-truncation entities covered | 0/40 | 0/40 |

The model itself has **not** improved: these are downstream candidate-span changes, not an increase in model recognition capability. Raw-model metrics are always retained. This synthetic suite contains construction patterns similar to the repair patterns, so these numbers do **not** establish effectiveness on independent Japanese addresses. Also, `fullCoverage` is an optimistic detection-side measure: it is not a real export redaction test. Residual failures (674 labeled characters plus other unsampled possibilities) rule out automated safe release.

**Next gates:** independent unseen address forms and difficult negatives, no over-redaction of neighboring content, leading-particle and Unicode-safe alignment if wanted for exact spans, proper long-message windowing, and export rescanning. Maintain manual review and all existing structured-scanner checks.

## Independent-format synthetic ADDRESS holdout: failure to generalize (2026-10-18)

A second, separately authored generator, `scripts/generate_tiny_ja_address_holdout.py`, creates **192 fabricated cases across 16 previously absent format/semantic categories** (12 each). It does not import any vocabulary or templates from the initial 480-case adversarial generator. It contains chained `丁目…番…号`, `番地の…`, nonstandard long-vowel/em-dash separators, unfamiliar building names, `字` subdistricts, floors and building blocks, postal prefixes, fullwidth numbers, and **four contexts in which extending an apparent address would be erroneous**.

Each case has original Unicode code-point gold spans and separately labeled `seedCandidates`. The seeded-prefix evaluation **simulates an oracle detector which returns an address prefix**, including 24 intentionally false-prefix candidates in two non-address title groups; these are not trained-model predictions. A second, separate evaluation uses the actual trained synthetic NER model. Both paths compare unchanged raw and repaired spans, with `overExtension` defined as newly added ADDRESS code points outside any labeled true ADDRESS, counted once per original-text code point.

[First evidence-generating CI run](https://github.com/Fimalein/private-chat-analyzer/actions/runs/39121346382) **failed** because the expanded cases exposed native ONNX-vs-Chromium prediction differences. The original 24-case native/browser parity still passed, but adversarial parity and the model-driven holdout parity did not; the seeded-prefix (model-independent) holdout result **did** match across Python/JS. Treat backend disagreement as an unresolved research/blocking finding, not as a CI success.

| Holdout metric (192 synthetic cases, 168 true ADDRESS entities) | Raw | Suffix repair |
| --- | ---: | ---: |
| Oracle-prefix exact match | **24/168 (14.3%)** | **0/168 (0%)** |
| Oracle-prefix fully covered entities | 24/168 (14.3%) | **24/168 (14.3%)** |
| Oracle-prefix uncovered labeled characters | 1,095 | 807 |
| Actual NER full-entity coverage (Chromium) | 24/168 (14.3%) | **24/168 (14.3%)** |
| Actual NER uncovered labeled characters (Chromium) | 969 | 789 |
| Oracle-prefix newly over-extended characters | — | **144** |
| Oracle-prefix cases with over-extension | — | **48/192** |
| Model-driven newly over-extended characters (Chromium) | — | **144** |
| Model-driven cases with over-extension (Chromium) | — | **48/192** |

**Interpretation:** the suffix repair frequently extends only part of a novel structured address, or expands an ambiguous numeric range/counter or a fabricated work title as if it were a location. It can decrease uncovered *characters* without improving **any** fully covered entity, and can worsen exact boundaries by swallowing ordinary prose. The initially promising 480-case gains were not independently replicated. No claim of population-level privacy performance can be made from either synthetic set.

A separate app CI job for this same revision failed at the pre-existing Next.js `next/font/google` / Turbopack build path; there is no evidence that the new standalone address generator changed the app build. The Python-only NER spike and dependency audit passed. The benchmark workflow now always uploads **metrics-only** artifacts even if the stricter parity gate fails, and logs a compact summary rather than flooding the job log.

**Decision: block release.** Do not tune on this frozen holdout and continue calling it unseen; subsequent fixes need a fresh third evaluation set. Prioritize (1) over-extension safety gates for duration/ordinal/quoted title contexts, (2) address segmentation with explicit confidence and safe fallback, (3) true independent data and native/browser mismatch diagnosis, then (4) long-message chunking and Unicode alignment. Keep the model, postprocessor, and export scanner independent until each gate is verified.

## Numeric prose and quoted-work-title guards: regression results (2026-10-18)

The experimental postprocessor now declines number extensions when immediately followed by a duration, counter, or ordinal (e.g. 3-5分 or 3番目). It also declines candidates inside explicitly indicated quoted work titles, including predictions that start at the opening quote or preceding text. Python and JavaScript regression tests cover these changes. No application Privacy Review or export behavior was changed.

The third, separately generated 256-case / 16-group synthetic set has 208 labeled ADDRESS spans. Its **initial** run exposed 48 model-driven title over-extensions (200 new non-gold characters) despite zero oracle-prefix over-extensions. The guard was modified after examining that result. **This third suite is now a development regression set, NOT an untouched independent holdout.** Both the older 192-case suite and the original 480-case test are also already examined. The data is fictional and never used for model training.

[Verified final Chromium CI run](https://github.com/Fimalein/private-chat-analyzer/actions/runs/39123393006) passed with Python/native ONNX vs Chromium parity on all four suites (24, 480, 192 and 256 cases); the app CI, Python-only NER and dependency audit passed too.

| Detection-side result on synthetic cases | Raw model or oracle seed | Guarded repair |
| --- | ---: | ---: |
| Third suite: full-entity coverage of 208 labeled ADDRESS spans, oracle-prefix seeds | 112/208 (53.8%) | **208/208 (100%)** |
| Third suite: full-entity coverage, actual Chromium NER | 112/208 (53.8%) | **208/208 (100%)** |
| Third suite: added characters outside ADDRESS gold, actual Chromium NER | — | **0** (initial unguarded overlap case: 200) |
| Previous 192-case suite: full-entity coverage of 168 addresses, oracle-prefix seeds | 24/168 (14.3%) | **24/168 (14.3%)** |
| Previous 192-case suite: added characters outside ADDRESS gold | — | **0** (before guards: 144) |
| Original 480 stress cases: full-entity coverage across all classes | 342/664 (51.5%) | **459/664 (69.1%)** |

**Privacy decision remains BLOCKED:** the third set was used to fix a guard and cannot support an independent generalization claim. The previous more varied 192-case suite remains weak at full-address coverage, and the first 480-case suite still has 674 uncovered labeled characters after repair. Very long inputs, nonstandard Japanese Unicode, harder ordinary-text negatives, mobile memory, model redistribution and **end-to-end actual export leak testing** are separate gates. A perfect development regression score never establishes production anonymization safety.

## Decision gate

Keep the PR in draft and the ML path unintegrated. Before any opt-in application use, require stronger exact-boundary/coverage performance, a plan for >94 content tokens (chunking or explicit detection failure), Unicode tokenizer remediation if parity breaks, difficult-negative review burden, browser offline/cache and Android-class tests, and a documented license/distribution decision. The structured scanner, Privacy Review and final export rescan must remain independent.
