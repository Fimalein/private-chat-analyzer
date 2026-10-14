(() => {
  "use strict";

  const OUT_TYPE = { PERSON: "PERSON", ORG: "COMPANY", LOC: "ADDRESS" };

  function codePoints(text) {
    return Array.from(text);
  }

  function findSubarray(haystack, needle, start = 0) {
    outer: for (let i = start; i <= haystack.length - needle.length; i += 1) {
      for (let j = 0; j < needle.length; j += 1) {
        if (haystack[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  function percentile(values, q) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[index];
  }

  function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function makeTokenizer(vocabText, config) {
    const tokens = vocabText.replace(/\r/g, "").split("\n");
    if (tokens.at(-1) === "") tokens.pop();
    const vocab = new Map(tokens.map((token, index) => [token, index]));
    const special = {};
    for (const name of ["[CLS]", "[SEP]", "[PAD]", "[UNK]"]) {
      const id = vocab.get(name);
      if (id === undefined) throw new Error(`Missing tokenizer token ${name}`);
      special[name] = id;
    }

    function encode(text) {
      const ids = [special["[CLS]"]];
      const source = [-1];
      const chars = codePoints(text);
      for (let sourcePos = 0; sourcePos < chars.length; sourcePos += 1) {
        const normalized = chars[sourcePos].normalize("NFKC");
        for (const char of codePoints(normalized)) {
          if (/^\s$/u.test(char)) continue;
          ids.push(vocab.get(char) ?? special["[UNK]"]);
          source.push(sourcePos);
          if (ids.length >= config.maxLength - 1) {
            ids.push(special["[SEP]"]);
            source.push(-1);
            return { ids, mask: ids.map(() => 1), source };
          }
        }
      }
      ids.push(special["[SEP]"]);
      source.push(-1);
      return { ids, mask: ids.map(() => 1), source };
    }

    return { encode, vocabSize: tokens.length, special };
  }

  function decode(text, source, pred, labels) {
    const chars = codePoints(text);
    const out = [];
    let active = null;

    function flush() {
      if (active) {
        const [start, end, kind] = active;
        out.push({
          start,
          end,
          type: OUT_TYPE[kind],
          value: chars.slice(start, end).join(""),
        });
      }
      active = null;
    }

    for (let index = 1; index < source.length - 1; index += 1) {
      const pos = source[index];
      if (pos < 0) continue;
      const label = labels[pred[index]];
      if (!label || label === "O") {
        flush();
        continue;
      }
      const split = label.indexOf("-");
      const prefix = label.slice(0, split);
      const kind = label.slice(split + 1);
      if (!active || prefix === "B" || active[2] !== kind || active[1] !== pos) {
        flush();
        active = [pos, pos + 1, kind];
      } else {
        active[1] = pos + 1;
      }
    }
    flush();
    return out;
  }

  function gold(caseItem) {
    const text = codePoints(caseItem.text);
    const result = [];
    let cursor = 0;
    for (const item of caseItem.gold) {
      const value = codePoints(item.value);
      let start = findSubarray(text, value, cursor);
      if (start < 0) start = findSubarray(text, value, 0);
      if (start < 0) throw new Error(`Synthetic gold not found in ${caseItem.id}`);
      const end = start + value.length;
      result.push({ start, end, type: item.type, value: item.value });
      cursor = end;
    }
    return result;
  }

  function same(a, b) {
    return a.type === b.type && a.start === b.start && a.end === b.end;
  }

  function overlaps(a, b) {
    return a.type === b.type && a.start < b.end && b.start < a.end;
  }

  function matchCount(pred, expected, predicate) {
    const used = new Set();
    let hits = 0;
    for (const p of pred) {
      for (let index = 0; index < expected.length; index += 1) {
        if (!used.has(index) && predicate(p, expected[index])) {
          used.add(index);
          hits += 1;
          break;
        }
      }
    }
    return hits;
  }

  function metrics(predictions, expected) {
    const totalPred = predictions.reduce((sum, rows) => sum + rows.length, 0);
    const totalGold = expected.reduce((sum, rows) => sum + rows.length, 0);

    function block(predicate) {
      let hits = 0;
      for (let i = 0; i < predictions.length; i += 1) {
        hits += matchCount(predictions[i], expected[i], predicate);
      }
      return {
        hits,
        gold: totalGold,
        predicted: totalPred,
        recall: totalGold ? hits / totalGold : null,
        precision: totalPred ? hits / totalPred : null,
      };
    }

    const byType = {};
    for (const kind of ["PERSON", "COMPANY", "ADDRESS"]) {
      const pp = predictions.map((rows) => rows.filter((item) => item.type === kind));
      const gg = expected.map((rows) => rows.filter((item) => item.type === kind));
      const nPred = pp.reduce((sum, rows) => sum + rows.length, 0);
      const nGold = gg.reduce((sum, rows) => sum + rows.length, 0);
      let strictHits = 0;
      let overlapHits = 0;
      for (let i = 0; i < pp.length; i += 1) {
        strictHits += matchCount(pp[i], gg[i], same);
        overlapHits += matchCount(pp[i], gg[i], overlaps);
      }
      byType[kind] = {
        gold: nGold,
        predicted: nPred,
        strictRecall: nGold ? strictHits / nGold : null,
        strictPrecision: nPred ? strictHits / nPred : null,
        overlapRecall: nGold ? overlapHits / nGold : null,
        overlapPrecision: nPred ? overlapHits / nPred : null,
      };
    }
    return { strict: block(same), overlap: block(overlaps), byType };
  }

  function argmaxLabels(logits, sequenceLength, labelCount) {
    const out = new Array(sequenceLength);
    for (let token = 0; token < sequenceLength; token += 1) {
      const offset = token * labelCount;
      let best = 0;
      let bestValue = logits[offset];
      for (let label = 1; label < labelCount; label += 1) {
        const value = logits[offset + label];
        if (value > bestValue) {
          best = label;
          bestValue = value;
        }
      }
      out[token] = best;
    }
    return out;
  }

  function int64Tensor(values) {
    return new ort.Tensor(
      "int64",
      BigInt64Array.from(values.map((value) => BigInt(value))),
      [1, values.length],
    );
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return response.json();
  }

  async function fetchText(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return response.text();
  }

  window.runTinyJaNerBenchmark = async function runTinyJaNerBenchmark() {
    ort.env.wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;

    const [vocabText, config, fixture] = await Promise.all([
      fetchText("/benchmark-output/tiny-ja-ner/vocab.txt"),
      fetchJson("/benchmark-output/tiny-ja-ner/browser-config.json"),
      fetchJson("/tests/fixtures/synthetic/doccloak-ja-benchmark.json"),
    ]);
    if (config.marker !== "SYNTHETIC_FIXTURE" || fixture.marker !== "SYNTHETIC_FIXTURE") {
      throw new Error("Browser benchmark assets must be synthetic-only");
    }

    const tokenizer = makeTokenizer(vocabText, config);
    const heapBefore = performance.memory?.usedJSHeapSize ?? null;
    const loadStarted = performance.now();
    const session = await ort.InferenceSession.create(
      "/benchmark-output/tiny-ja-ner/tiny-ja-ner.int8.onnx",
      { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
    );
    const sessionLoadMs = performance.now() - loadStarted;
    const heapAfterSession = performance.memory?.usedJSHeapSize ?? null;

    async function predict(text) {
      const encoded = tokenizer.encode(text);
      const started = performance.now();
      const outputs = await session.run({
        input_ids: int64Tensor(encoded.ids),
        attention_mask: int64Tensor(encoded.mask),
      });
      const elapsed = performance.now() - started;
      const tensor = outputs.logits ?? Object.values(outputs)[0];
      const sequenceLength = tensor.dims[1];
      const labelCount = tensor.dims[2];
      if (labelCount !== config.labels.length) {
        throw new Error(`Unexpected label dimension ${labelCount}`);
      }
      const pred = argmaxLabels(tensor.data, sequenceLength, labelCount);
      return { entities: decode(text, encoded.source, pred, config.labels), ms: elapsed };
    }

    const firstStarted = performance.now();
    await predict(fixture.cases[0].text);
    const firstInferenceMs = performance.now() - firstStarted;

    const predictions = [];
    const expected = [];
    const accuracyTimings = [];
    const mismatches = [];
    for (const caseItem of fixture.cases) {
      const result = await predict(caseItem.text);
      const wanted = gold(caseItem);
      predictions.push(result.entities);
      expected.push(wanted);
      accuracyTimings.push(result.ms);
      const predKey = result.entities.map((item) => `${item.start}:${item.end}:${item.type}`).sort().join("|");
      const goldKey = wanted.map((item) => `${item.start}:${item.end}:${item.type}`).sort().join("|");
      if (predKey !== goldKey) {
        mismatches.push({
          id: caseItem.id,
          predicted: result.entities.map((item) => ({ value: item.value, type: item.type })),
          gold: wanted.map((item) => ({ value: item.value, type: item.type })),
        });
      }
    }

    const warmTimings = [];
    for (let repeat = 0; repeat < 5; repeat += 1) {
      for (const caseItem of fixture.cases) {
        const result = await predict(caseItem.text);
        warmTimings.push(result.ms);
      }
    }
    const heapAfterInference = performance.memory?.usedJSHeapSize ?? null;
    const benchmark = metrics(predictions, expected);
    await session.release();

    return {
      marker: "SYNTHETIC_FIXTURE",
      scope: "headless Chromium local-asset runtime spike; not end-user hardware or network performance",
      tokenizer: {
        strategy: "per-code-point NFKC + vocab lookup + CLS/SEP",
        vocabSize: tokenizer.vocabSize,
        maxLength: config.maxLength,
      },
      runtime: {
        backend: "onnxruntime-web/wasm",
        wasmThreads: 1,
        localSessionLoadMs: sessionLoadMs,
        firstInferenceMs,
        accuracyPassMeanMs: mean(accuracyTimings),
        warmSamples: warmTimings.length,
        warmMeanMs: mean(warmTimings),
        warmP50Ms: percentile(warmTimings, 0.5),
        warmP95Ms: percentile(warmTimings, 0.95),
        memory: {
          usedJsHeapBeforeBytes: heapBefore,
          usedJsHeapAfterSessionBytes: heapAfterSession,
          usedJsHeapAfterInferenceBytes: heapAfterInference,
          note: "Chromium performance.memory is JS-heap-only and is not a complete process/WASM memory measurement.",
        },
      },
      benchmark: {
        cases: fixture.cases.length,
        ...benchmark,
        mismatches,
      },
    };
  };
})();
