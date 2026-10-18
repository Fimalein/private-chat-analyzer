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
8. records local session-load time, first inference, repeated warm latency, strict/overlap metrics, and Chromium JS-heap observations.

The browser page and server are local to the GitHub Actions runner. Therefore the measured session-load value is **not** a first-use internet download benchmark. It measures browser/WASM/model initialization using a local HTTP asset. Likewise `performance.memory` only reports Chromium JS heap and is not a complete process or WebAssembly-memory measurement.

## Runtime dependencies

The spike pins:

- `onnxruntime-web@1.22.0`;
- `playwright@1.55.0`;
- the same Python training/export stack used by PR #43.

These are spike-only dependencies and are not added to the application package manifest or lockfile. They are installed under the ignored `benchmark-output/tiny-ja-ner/browser-deps/` directory with an isolated npm prefix to avoid mixing the spike runtime with the Next.js application's dependency tree. The standalone Playwright CLI is run from that prefix.

## Quantization compatibility finding

The initial all-operator dynamic INT8 export loaded in native Python ONNX Runtime but failed inside Chromium WASM because the DeBERTa convolution was converted to a `ConvInteger` node that the pinned browser runtime could not execute. This is a runtime compatibility failure, not an accuracy result. The follow-up export quantizes only `MatMul`/`Gemm`, leaving convolution in FP32, and asserts that no `ConvInteger` nodes remain. The resulting model size and browser metrics must be measured again; the original ~7 MiB figure does not automatically apply to this revised graph.

## Decision gate

A successful browser run is necessary but not sufficient for shipping. Before integration, #44 still requires broader adversarial exact-boundary testing, especially PERSON and ADDRESS boundaries, difficult Unicode/tokenizer parity cases, realistic memory measurements, and a documented distribution/license decision for any model artifact that would be shipped.

Status: benchmark implementation added; measured Chromium results should only be recorded here after the CI run completes successfully.
