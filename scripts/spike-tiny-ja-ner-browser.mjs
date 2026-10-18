import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";


const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUTPUT_DIR = resolve(ROOT, "benchmark-output", "tiny-ja-ner");
const HTML_PATH = "scripts/spike-tiny-ja-ner-browser.html";
// Resolve spike-only packages from the ignored, isolated benchmark directory.
const require = createRequire(resolve(OUTPUT_DIR, "browser-deps", "package.json"));
const { chromium } = require("playwright");

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".onnx", "application/octet-stream"],
  [".wasm", "application/wasm"],
]);

function safeFile(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || HTML_PATH;
  const file = resolve(ROOT, rel);
  if (file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) return null;
  return file;
}

const server = createServer((req, res) => {
  const file = safeFile(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  if (!file) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const stat = statSync(file);
    if (!stat.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "Content-Type": MIME.get(extname(file)) ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((resolvePromise, rejectPromise) => {
  server.once("error", rejectPromise);
  server.listen(0, "127.0.0.1", resolvePromise);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to determine benchmark server port");
const origin = `http://127.0.0.1:${address.port}`;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-precise-memory-info"],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(`${origin}/${HTML_PATH}`, { waitUntil: "load" });
  const result = await page.evaluate(() => window.runTinyJaNerBenchmark());
  if (pageErrors.length) {
    throw new Error(`Browser page error: ${pageErrors[0]}`);
  }

  // Compare browser predictions with the native Python ONNX INT8 run from this same CI job.
  const reference = JSON.parse(readFileSync(resolve(OUTPUT_DIR, "results.json"), "utf8"));
  if (reference.marker !== "SYNTHETIC_FIXTURE" || result.marker !== "SYNTHETIC_FIXTURE") {
    throw new Error("Benchmark comparison requires synthetic-only results");
  }
  function equivalent(actual, expected) {
    if (typeof actual === "number" && typeof expected === "number") {
      return Math.abs(actual - expected) <= 1e-12;
    }
    if (Array.isArray(actual) || Array.isArray(expected)) {
      return Array.isArray(actual) && Array.isArray(expected)
        && actual.length === expected.length
        && actual.every((value, index) => equivalent(value, expected[index]));
    }
    if (actual && expected && typeof actual === "object" && typeof expected === "object") {
      const keys = Object.keys(expected);
      return Object.keys(actual).length === keys.length
        && keys.every((key) => Object.hasOwn(actual, key) && equivalent(actual[key], expected[key]));
    }
    return actual === expected;
  }
  const parity = {
    cases: result.benchmark.cases === reference.benchmark.cases,
    strict: equivalent(result.benchmark.strict, reference.benchmark.onnxInt8.strict),
    overlap: equivalent(result.benchmark.overlap, reference.benchmark.onnxInt8.overlap),
    byType: equivalent(result.benchmark.byType, reference.benchmark.onnxInt8.byType),
    mismatches: equivalent(result.benchmark.mismatches, reference.benchmark.onnxMismatches),
  };
  result.benchmark.pythonOnnxParity = parity;
  const adversarialParity = {
    seed: result.adversarial.seed === reference.adversarial.seed,
    cases: result.adversarial.onnxInt8.cases === reference.adversarial.onnxInt8.cases,
    summary: equivalent(result.adversarial.onnxInt8, reference.adversarial.onnxInt8),
    addressRepair: equivalent(result.adversarial.addressRepair, reference.adversarial.addressRepair),
  };
  result.adversarial.pythonOnnxParity = adversarialParity;
  const holdoutParity = {
    seed: result.addressHoldout.seed === reference.addressHoldout.seed,
    cases: result.addressHoldout.cases === reference.addressHoldout.cases,
    oraclePrefix: equivalent(result.addressHoldout.oraclePrefix, reference.addressHoldout.oraclePrefix),
    model: equivalent(result.addressHoldout.model, reference.addressHoldout.model),
  };
  result.addressHoldout.pythonOnnxParity = holdoutParity;

  // Read package metadata directly: onnxruntime-web does not export ./package.json.
  const dependencyVersion = (name) => JSON.parse(readFileSync(
    resolve(OUTPUT_DIR, "browser-deps", "node_modules", name, "package.json"), "utf8",
  )).version;
  result.environment = {
    chromium: browser.version(),
    playwright: dependencyVersion("playwright"),
    onnxruntimeWeb: dependencyVersion("onnxruntime-web"),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
  result.generatedAt = new Date().toISOString();

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const output = resolve(OUTPUT_DIR, "browser-results.json");
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  // Keep the job log readable even on failure; the full synthetic-only
  // result, including per-category scores, is saved as an Actions artifact.
  console.log(JSON.stringify({
    marker: result.marker,
    benchmark: {
      cases: result.benchmark.cases,
      strict: result.benchmark.strict,
      pythonOnnxParity: result.benchmark.pythonOnnxParity,
    },
    adversarial: {
      cases: result.adversarial.onnxInt8.cases,
      strict: result.adversarial.onnxInt8.strict,
      fullCoverage: result.adversarial.addressRepair.fullCoverage,
      pythonOnnxParity: result.adversarial.pythonOnnxParity,
    },
    addressHoldout: {
      cases: result.addressHoldout.cases,
      oraclePrefix: {
        raw: result.addressHoldout.oraclePrefix.raw.fullCoverage,
        repaired: result.addressHoldout.oraclePrefix.repaired.fullCoverage,
        overExtension: result.addressHoldout.oraclePrefix.overExtension,
      },
      model: {
        raw: result.addressHoldout.model.raw.fullCoverage,
        repaired: result.addressHoldout.model.repaired.fullCoverage,
        overExtension: result.addressHoldout.model.overExtension,
      },
      pythonOnnxParity: result.addressHoldout.pythonOnnxParity,
    },
  }, null, 2));
  console.log(`Wrote ${output}`);
  if (!Object.values(parity).every(Boolean) ||
      !Object.values(adversarialParity).every(Boolean) ||
      !Object.values(holdoutParity).every(Boolean)) {
    throw new Error(`Browser/Python INT8 parity failed: ${JSON.stringify({ parity, adversarialParity, holdoutParity })}`);
  }
} finally {
  if (browser) await browser.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
