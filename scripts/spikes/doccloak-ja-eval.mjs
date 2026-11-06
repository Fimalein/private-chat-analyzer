import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  GlinerProvider,
  memoryKV,
} from "@doccloak/core";
import {
  DebertaV2Tokenizer,
  PreTrainedTokenizer,
  XLMRobertaTokenizer,
  env as hfEnv,
} from "@huggingface/transformers";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CORPUS_PATH = join(ROOT, "tests", "fixtures", "synthetic", "doccloak-ja-eval.json");
const CACHE_DIR = join(ROOT, ".tmp-doccloak-model-cache");
const blobPaths = new WeakMap();

hfEnv.useBrowserCache = false;
hfEnv.allowRemoteModels = false;
hfEnv.allowLocalModels = false;

function buildTokenizer(tokenizerJson, tokenizerConfig) {
  const declared = tokenizerConfig?.tokenizer_class;
  const classes = new Map([
    ["PreTrainedTokenizer", PreTrainedTokenizer],
    ["DebertaV2Tokenizer", DebertaV2Tokenizer],
    ["XLMRobertaTokenizer", XLMRobertaTokenizer],
  ]);
  if (typeof declared !== "string") throw new Error("Tokenizer class is missing");
  const Ctor = classes.get(declared.replace(/Fast$/, ""));
  if (!Ctor) throw new Error(`Unsupported tokenizer class: ${declared}`);
  return new Ctor(tokenizerJson, tokenizerConfig);
}

function diskBlobCache(dir) {
  mkdirSync(dir, { recursive: true });
  const fileFor = (url) => join(dir, createHash("sha256").update(url).digest("hex"));
  return {
    async match(url) {
      const path = fileFor(url);
      if (!existsSync(path)) return undefined;
      const blob = new Blob([readFileSync(path)]);
      blobPaths.set(blob, path);
      return blob;
    },
    async put(url, blob) {
      const path = fileFor(url);
      writeFileSync(path, Buffer.from(await blob.arrayBuffer()));
      blobPaths.set(blob, path);
      return true;
    },
    async delete(url) {
      rmSync(fileFor(url), { force: true });
    },
  };
}

function installNodeBlobShim() {
  const originalCreate = URL.createObjectURL?.bind(URL);
  const originalRevoke = URL.revokeObjectURL?.bind(URL);
  URL.createObjectURL = ((blob) => {
    const path = blobPaths.get(blob);
    if (path) return pathToFileURL(path).href;
    return originalCreate(blob);
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("file://")) {
      const bytes = readFileSync(fileURLToPath(url));
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "Content-Length": String(bytes.length) },
      });
    }
    return realFetch(input, init);
  };
  URL.revokeObjectURL = ((url) => {
    if (url.startsWith("blob:") && originalRevoke) originalRevoke(url);
  });
}

function expectedSpans(testCase) {
  const used = new Map();
  return testCase.expected.map((item) => {
    const from = used.get(item.value) ?? 0;
    const start = testCase.text.indexOf(item.value, from);
    if (start < 0) throw new Error(`${testCase.id}: expected value not found: ${item.value}`);
    used.set(item.value, start + item.value.length);
    return { ...item, start, end: start + item.value.length };
  });
}

function overlap(a, b) {
  return a.start < b.end && a.end > b.start;
}

function score(cases, predictions, times) {
  let gold = 0;
  let strictHits = 0;
  let lenientHits = 0;
  let typeAwareHits = 0;
  let predicted = 0;
  let precisionHits = 0;
  const byType = {};

  for (const testCase of cases) {
    const expected = expectedSpans(testCase);
    const preds = predictions.get(testCase.id) ?? [];
    gold += expected.length;
    predicted += preds.length;

    for (const exp of expected) {
      const lenient = preds.some((pred) => overlap(exp, pred));
      const strict = preds.some((pred) => pred.start === exp.start && pred.end === exp.end);
      const typed = preds.some((pred) => pred.start === exp.start && pred.end === exp.end && pred.type === exp.type);
      if (lenient) lenientHits += 1;
      if (strict) strictHits += 1;
      if (typed) typeAwareHits += 1;
      const row = byType[exp.type] ?? { gold: 0, lenientHits: 0, typeAwareHits: 0 };
      row.gold += 1;
      if (lenient) row.lenientHits += 1;
      if (typed) row.typeAwareHits += 1;
      byType[exp.type] = row;
    }

    for (const pred of preds) {
      if (expected.some((exp) => overlap(exp, pred))) precisionHits += 1;
    }
  }

  const meanMs = times.reduce((sum, value) => sum + value, 0) / Math.max(times.length, 1);
  return {
    cases: cases.length,
    gold,
    predicted,
    recallStrict: gold ? strictHits / gold : 1,
    recallLenient: gold ? lenientHits / gold : 1,
    recallTypeAwareStrict: gold ? typeAwareHits / gold : 1,
    precisionLenient: predicted ? precisionHits / predicted : 1,
    meanMs,
    byType: Object.fromEntries(Object.entries(byType).map(([type, row]) => [type, {
      ...row,
      recallLenient: row.gold ? row.lenientHits / row.gold : 1,
      recallTypeAwareStrict: row.gold ? row.typeAwareHits / row.gold : 1,
    }])),
  };
}

installNodeBlobShim();
const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
if (corpus.marker !== "SYNTHETIC_FIXTURE") throw new Error("Synthetic corpus marker missing");

const env = {
  kv: memoryKV(),
  modelCache: diskBlobCache(CACHE_DIR),
  fetch: (...args) => fetch(...args),
  wasm: { paths: `${join(ROOT, "node_modules", "onnxruntime-web", "dist")}/`, numThreads: 1 },
  buildTokenizer,
  hardware: { isMobile: false, deviceMemoryGB: 16 },
};

const provider = new GlinerProvider(env);
provider.onProgress((downloaded, total) => {
  if (total > 0 && downloaded === total) console.log(`[download] ${(total / 1e6).toFixed(1)} MB verified`);
});

console.log(`Loading @doccloak/core GLiNER model; threshold default=${provider.getThreshold()}`);
const loadStart = performance.now();
await provider.load();
const loadMs = performance.now() - loadStart;
console.log(`Model loaded in ${loadMs.toFixed(0)} ms`);

const modes = [
  { id: "builtin", labels: [] },
  { id: "custom-org", labels: ["school name", "organization name"] },
];
const thresholds = [0.25, 0.35, 0.5];
const results = [];

for (const mode of modes) {
  await provider.setCustomLabels(mode.labels);
  for (const threshold of thresholds) {
    provider.setThreshold(threshold);
    const predictions = new Map();
    const times = [];
    for (const testCase of corpus.cases) {
      const started = performance.now();
      const detected = await provider.detect(testCase.text);
      times.push(performance.now() - started);
      predictions.set(testCase.id, detected);
    }
    results.push({ mode: mode.id, threshold, ...score(corpus.cases, predictions, times) });
  }
}

provider.release();
console.log("DOCLOAK_JA_EVAL_RESULT=" + JSON.stringify({ package: "@doccloak/core@0.13.0", model: "gliner", loadMs, results }));
