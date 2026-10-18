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

  result.environment = {
    chromium: browser.version(),
    playwright: require("playwright/package.json").version,
    onnxruntimeWeb: require("onnxruntime-web/package.json").version,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
  result.generatedAt = new Date().toISOString();

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const output = resolve(OUTPUT_DIR, "browser-results.json");
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  console.log(`Wrote ${output}`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
