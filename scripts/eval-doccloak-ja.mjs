import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  GlinerProvider,
  detectEntities,
  detectWithRegex,
  memoryKV,
} from "@doccloak/core";
import {
  DebertaV2Tokenizer,
  PreTrainedTokenizer,
  XLMRobertaTokenizer,
  env as hfEnv,
} from "@huggingface/transformers";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CORPUS_PATH = join(
  ROOT,
  "tests",
  "fixtures",
  "synthetic",
  "doccloak-ja-benchmark.json",
);
const OUTPUT_DIR = join(ROOT, "benchmark-output");
const MODEL_CACHE_DIR = join(
  process.env.RUNNER_TEMP || join(ROOT, ".tmp"),
  "doccloak-ja-model-cache",
);
const THRESHOLDS = [0.25, 0.35, 0.5];
const TARGET_TYPES = new Set(["PERSON", "COMPANY", "ADDRESS"]);

hfEnv.useBrowserCache = false;
hfEnv.allowRemoteModels = false;
hfEnv.allowLocalModels = false;

const TOKENIZER_CLASSES = new Map([
  ["PreTrainedTokenizer", PreTrainedTokenizer],
  ["DebertaV2Tokenizer", DebertaV2Tokenizer],
  ["XLMRobertaTokenizer", XLMRobertaTokenizer],
]);

function buildTokenizer(tokenizerJson, tokenizerConfig) {
  if (!tokenizerJson || typeof tokenizerJson !== "object") {
    throw new Error("Pinned tokenizer.json is not an object");
  }
  if (!tokenizerConfig || typeof tokenizerConfig !== "object") {
    throw new Error("Pinned tokenizer_config.json is not an object");
  }
  const declared = tokenizerConfig.tokenizer_class;
  if (typeof declared !== "string" || !declared) {
    throw new Error("Pinned tokenizer_config.json has no tokenizer_class");
  }
  const ctor = TOKENIZER_CLASSES.get(declared.replace(/Fast$/, ""));
  if (!ctor) throw new Error(`Unsupported tokenizer_class: ${declared}`);
  return new ctor(tokenizerJson, tokenizerConfig);
}

const blobFilePaths = new WeakMap();

function diskBlobCache(dir) {
  mkdirSync(dir, { recursive: true });
  const fileFor = (url) =>
    join(dir, createHash("sha256").update(url).digest("hex"));
  return {
    async match(url) {
      const file = fileFor(url);
      if (!existsSync(file)) return undefined;
      const blob = new Blob([readFileSync(file)]);
      blobFilePaths.set(blob, file);
      return blob;
    },
    async put(url, blob) {
      const file = fileFor(url);
      writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
      blobFilePaths.set(blob, file);
      return true;
    },
    async delete(url) {
      rmSync(fileFor(url), { force: true });
    },
  };
}

function installNodeBlobUrlShim() {
  const originalCreate = URL.createObjectURL?.bind(URL);
  const originalRevoke = URL.revokeObjectURL?.bind(URL);
  const realFetch = globalThis.fetch;

  URL.createObjectURL = ((blob) => {
    const file = blobFilePaths.get(blob);
    if (file) return pathToFileURL(file).href;
    return originalCreate ? originalCreate(blob) : "blob:unsupported";
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
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

function loadCorpus() {
  const parsed = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
  if (parsed.marker !== "SYNTHETIC_FIXTURE") {
    throw new Error("Benchmark corpus must declare SYNTHETIC_FIXTURE");
  }
  return parsed.cases;
}

function goldSpans(testCase) {
  return testCase.gold.map((gold) => {
    const start = testCase.text.indexOf(gold.value);
    if (start < 0) {
      throw new Error(`${testCase.id}: gold value not found in text`);
    }
    return { ...gold, start, end: start + gold.value.length };
  });
}

function overlaps(a, b) {
  return a.start < b.end && a.end > b.start;
}

function metricRow(hits, total) {
  return { hits, total, ratio: total ? hits / total : null };
}

function evaluate(cases, predictionsById) {
  const gold = [];
  const predictions = [];

  for (const testCase of cases) {
    const spans = goldSpans(testCase).map((item) => ({
      ...item,
      caseId: testCase.id,
    }));
    gold.push(...spans);
    for (const prediction of predictionsById.get(testCase.id) || []) {
      if (!TARGET_TYPES.has(prediction.type)) continue;
      predictions.push({ ...prediction, caseId: testCase.id });
    }
  }

  const strictGoldHit = (g) =>
    predictions.some(
      (p) =>
        p.caseId === g.caseId &&
        p.type === g.type &&
        p.start === g.start &&
        p.end === g.end,
    );
  const overlapGoldHit = (g) =>
    predictions.some(
      (p) => p.caseId === g.caseId && p.type === g.type && overlaps(p, g),
    );
  const strictPredictionHit = (p) =>
    gold.some(
      (g) =>
        g.caseId === p.caseId &&
        g.type === p.type &&
        g.start === p.start &&
        g.end === p.end,
    );
  const overlapPredictionHit = (p) =>
    gold.some(
      (g) => g.caseId === p.caseId && g.type === p.type && overlaps(p, g),
    );

  const byType = {};
  for (const type of TARGET_TYPES) {
    const typeGold = gold.filter((item) => item.type === type);
    const typePredictions = predictions.filter((item) => item.type === type);
    byType[type] = {
      recallStrict: metricRow(
        typeGold.filter(strictGoldHit).length,
        typeGold.length,
      ),
      recallOverlap: metricRow(
        typeGold.filter(overlapGoldHit).length,
        typeGold.length,
      ),
      precisionStrict: metricRow(
        typePredictions.filter(strictPredictionHit).length,
        typePredictions.length,
      ),
      precisionOverlap: metricRow(
        typePredictions.filter(overlapPredictionHit).length,
        typePredictions.length,
      ),
    };
  }

  return {
    goldEntities: gold.length,
    predictedEntities: predictions.length,
    recallStrict: metricRow(gold.filter(strictGoldHit).length, gold.length),
    recallOverlap: metricRow(gold.filter(overlapGoldHit).length, gold.length),
    precisionStrict: metricRow(
      predictions.filter(strictPredictionHit).length,
      predictions.length,
    ),
    precisionOverlap: metricRow(
      predictions.filter(overlapPredictionHit).length,
      predictions.length,
    ),
    byType,
  };
}

function summarizeFindings(cases, predictionsById) {
  const rows = [];
  for (const testCase of cases) {
    const gold = goldSpans(testCase);
    const predicted = (predictionsById.get(testCase.id) || []).filter((item) =>
      TARGET_TYPES.has(item.type),
    );
    const missed = gold.filter(
      (g) => !predicted.some((p) => p.type === g.type && overlaps(p, g)),
    );
    const spurious = predicted.filter(
      (p) => !gold.some((g) => p.type === g.type && overlaps(p, g)),
    );
    if (missed.length || spurious.length) {
      rows.push({
        id: testCase.id,
        missed: missed.map((item) => ({ value: item.value, type: item.type })),
        spurious: spurious.map((item) => ({
          value: item.value,
          type: item.type,
          confidence: item.confidence,
        })),
      });
    }
  }
  return rows;
}

installNodeBlobUrlShim();
mkdirSync(OUTPUT_DIR, { recursive: true });

const ortEntry = fileURLToPath(import.meta.resolve("onnxruntime-web"));
const wasmDir = `${dirname(ortEntry)}/`;
const env = {
  kv: memoryKV(),
  modelCache: diskBlobCache(MODEL_CACHE_DIR),
  fetch: (...args) => fetch(...args),
  wasm: { paths: wasmDir, numThreads: 1 },
  buildTokenizer,
  hardware: { isMobile: false, deviceMemoryGB: 16 },
};

const provider = new GlinerProvider(env);
let lastDownloadPercent = -1;
provider.onProgress((downloaded, total) => {
  if (!total) return;
  const percent = Math.floor((100 * downloaded) / total);
  if (percent >= lastDownloadPercent + 10 || percent === 100) {
    lastDownloadPercent = percent;
    console.log(`[download] ${percent}%`);
  }
});

const cases = loadCorpus();
const preloadStart = performance.now();
await provider.load();
const preloadMs = performance.now() - preloadStart;
const results = [];

for (const threshold of THRESHOLDS) {
  provider.setThreshold(threshold);
  const mlPredictions = new Map();
  const productPredictions = new Map();
  let detectMs = 0;

  for (const testCase of cases) {
    const started = performance.now();
    const ml = await provider.detect(testCase.text);
    detectMs += performance.now() - started;
    const regex = detectWithRegex(testCase.text, "all");
    mlPredictions.set(testCase.id, ml);
    productPredictions.set(testCase.id, detectEntities(testCase.text, ml, regex));
  }

  results.push({
    threshold,
    mlOnly: evaluate(cases, mlPredictions),
    productPipeline: evaluate(cases, productPredictions),
    observations: summarizeFindings(cases, productPredictions),
    timing: {
      totalDetectionMs: detectMs,
      meanPerCaseMs: detectMs / cases.length,
    },
  });
}

provider.release();

const report = {
  marker: "SYNTHETIC_FIXTURE",
  generatedAt: new Date().toISOString(),
  package: "@doccloak/core@0.13.0",
  provider: "GLiNER PII Small",
  corpusCases: cases.length,
  targetTypes: [...TARGET_TYPES],
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    note: "GitHub-hosted Node runner baseline; not a browser or mobile performance measurement.",
  },
  preloadMs,
  results,
};

const outputPath = join(OUTPUT_DIR, "doccloak-ja-results.json");
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`\nWrote ${outputPath}`);
