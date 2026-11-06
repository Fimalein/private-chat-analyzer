"use strict";

// Synthetic-only end-to-end check. Never run with real chat files.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const target = process.env.CHATSTORY_TEST_ORIGIN || "http://127.0.0.1:4173/private-chat-analyzer/";
const origin = new URL(target).origin;
const marker = "SYNTHETIC_CHAT_NETWORK_CANARY_20261106";
const syntheticChat = [
  "[LINE] Chat history with Alice",
  "Saved at 2026/10/11 20:00",
  "",
  "2026/10/11(日)",
  "9:10\tAlice\tSYNTHETIC_FIXTURE " + marker + " おはよう",
  "9:11\tBob\tSYNTHETIC_FIXTURE こんにちは",
  "9:12\tAlice\tSYNTHETIC_FIXTURE 解析テストです",
].join("\n");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  let checkedRequests = 0;

  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: true,
    });
    const page = await context.newPage();

    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      const outbound = [url, request.postData() || "", JSON.stringify(request.headers())].join("\n");
      if (outbound.includes(marker)) failures.push("synthetic chat marker appeared in a network request");
      if (/^https?:/i.test(url)) {
        checkedRequests += 1;
        if (new URL(url).origin !== origin) {
          failures.push("unexpected off-origin HTTP request");
          return route.abort("blockedbyclient");
        }
      }
      return route.continue();
    });

    page.on("websocket", (socket) => {
      const u = socket.url();
      if (!/^wss?:/i.test(u) || new URL(u).host !== new URL(origin).host) {
        failures.push("unexpected WebSocket destination");
      }
      socket.on("framesent", (frame) => {
        if (String(frame.payload).includes(marker)) {
          failures.push("synthetic chat marker appeared in a WebSocket frame");
        }
      });
    });

    await page.goto(target, { waitUntil: "networkidle" });

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "SYNTHETIC_FIXTURE-egress-audit.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(syntheticChat, "utf8"),
    });

    await page.getByRole("heading", { name: "読み込み内容を確認" }).waitFor();
    await page.getByRole("button", { name: "ダッシュボードを開く" }).click();
    await page.getByRole("button", { name: "メッセージ検索" }).waitFor();

    // Exercise privacy review, then verify the explicitly requested ZIP stays local.
    await page.getByRole("button", { name: /プライバシー確認/ }).click();
    await page.getByRole("heading", { name: "プライバシー確認" }).waitFor();
    await page.getByRole("button", { name: "閉じる" }).last().click();

    await page.getByRole("button", { name: /ChatGPT用に書き出す/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "4ファイルをZIPで保存" }).click(),
    ]);
    assert.equal(download.suggestedFilename(), "ChatStory_analysis_pack.zip");
    await page.getByRole("button", { name: "閉じる" }).last().click();

    await page.getByRole("button", { name: "メッセージ検索" }).click();
    await page.getByText(marker, { exact: false }).first().waitFor();
    await page.waitForLoadState("networkidle");

    assert.ok(checkedRequests > 0, "No page network requests were observed");
    assert.deepEqual(failures, [], "Unexpected data egress or third-party request detected");
    console.log("Synthetic browser egress audit passed (import, review, ZIP and explorer).");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  // Do not print file contents, network URLs, or request headers.
  console.error("Synthetic browser egress audit failed:", error.name || "Error");
  process.exitCode = 1;
});
