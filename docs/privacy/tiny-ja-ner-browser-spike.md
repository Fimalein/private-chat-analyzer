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

## Decision gate

Keep the PR in draft and the ML path unintegrated. Before any opt-in application use, require stronger exact-boundary/coverage performance, a plan for >94 content tokens (chunking or explicit detection failure), Unicode tokenizer remediation if parity breaks, difficult-negative review burden, browser offline/cache and Android-class tests, and a documented license/distribution decision. The structured scanner, Privacy Review and final export rescan must remain independent.
