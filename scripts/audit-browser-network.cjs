"use strict";

/**
 * SYNTHETIC_FIXTURE ONLY. Real chats must never enter CI.
 * Audits the real static app in Chromium from import through strict preview.
 * Any off-origin request is aborted and makes the job fail, even without a
 * synthetic canary. Do not log raw URL/query/body/header values.
 */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const origin = process.env.CHATSTORY_TEST_ORIGIN || "http://127.0.0.1:4173";
const canaries = [
  "network-sentinel-chat-418",
  "sender-one@example.test",
  "sender-two@example.test",
];
const fixture = [
  "[LINE] Chat history with sender-one@example.test",
  "Saved at 2026/10/11 20:00",
  "",
  "2026/10/11(日)",
  "9:10\tsender-one@example.test\tSYNTHETIC_FIXTURE network-sentinel-chat-418: 最近はどう？",
  "9:11\tsender-two@example.test\tSYNTHETIC_FIXTURE 今日の話題を分析したい。",
  "9:12\tsender-one@example.test\tSYNTHETIC_FIXTURE これは架空の内容。",
].join("\n");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  const page = await context.newPage();
  const deniedExternal = [];
  const leakedToNetwork = [];
  const websockets = [];
  let localRequests = 0;
  const originHost = new URL(origin).origin;

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    // Include both URL and outgoing request body, but never echo any values.
    const outbound = url + "\n" + (request.postData() || "");
    if (canaries.some((v) => outbound.includes(v))) {
      leakedToNetwork.push(request.method());
    }
    if (!url.startsWith("http:") && !url.startsWith("https:")) {
      return route.continue();
    }
    if (new URL(url).origin !== originHost) {
      deniedExternal.push({
        method: request.method(),
        kind: request.resourceType(),
      });
      return route.abort("blockedbyclient");
    }
    localRequests += 1;
    return route.continue();
  });

  page.on("websocket", (ws) => {
    websockets.push(ws.url().startsWith(originHost) ? "local" : "external");
  });

  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({
      name: "SYNTHETIC_FIXTURE-network-audit.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(fixture, "utf8"),
    });
    await page.getByRole("heading", { name: /確認這份對話|Check this chat/ }).waitFor();
    await page.getByRole("button", { name: /打開儀表板|Open dashboard/ }).click();
    await page.getByRole("button", { name: /ChatGPT 隱私預覽|ChatGPT private review/ }).waitFor();
    // Run both the local privacy reviewer and strict preview, not just landing.
    await page.getByRole("button", { name: /隱私檢查|Privacy review/ }).first().click();
    const anonButtons = page.getByRole("button", { name: /^(假名化|Pseudonymize)$/ });
    await anonButtons.first().waitFor();
    assert.equal(await anonButtons.count(), 2, "Two synthetic sender emails must be detected");
    await anonButtons.first().click();
    await anonButtons.first().click();
    await page.getByRole("button", { name: /^(關閉|Close)$/ }).last().click();
    await page.getByRole("button", { name: /ChatGPT 隱私預覽|ChatGPT private review/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const sensitive = dialog.locator("textarea").first();
    await sensitive.fill(canaries.slice(1).join("\n"));
    await dialog.getByRole("button", { name: /產生四份本機預覽|Generate local preview of 4 files/ }).click();
    await dialog.getByText("chat_redacted.txt", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: /下載這份已審核檔案|Download this reviewed file/ }).count(),
      0, "No download should be exposed prior to review/approval");
    // The ordinary export must also show the receiving-provider implications.
    await dialog.getByRole("button", { name: /^(關閉|Close)$/ }).click();
    await page.getByRole("button", { name: /ChatGPT 匯出|Export for ChatGPT/ }).click();
    const shareButton = page.getByRole("button", {
      name: /分享 \\/ 下載 4 個檔案|Share \\/ download 4 files/,
    });
    await shareButton.waitFor();
    assert.equal(await shareButton.isDisabled(), true,
      "Ordinary export must be disabled without provider disclosure acknowledgement");
    const acknowledge = page.getByRole("checkbox", {
      name: /我了解本機下載|I understand that downloading/,
    });
    await acknowledge.check();
    assert.equal(await shareButton.isEnabled(), true,
      "Explicit provider acknowledgement should unlock a non-secret export");
    const provider = page.getByLabel(/預定收件方|Intended recipient/);
    await provider.selectOption("other");
    assert.equal(await shareButton.isDisabled(), true,
      "Changing the intended recipient must invalidate acknowledgement");
    await acknowledge.check();
    assert.equal(await shareButton.isEnabled(), true,
      "Recipient-specific re-acknowledgement must be possible");
    // Never trigger native share or a download in this pre-handoff network test.

    assert.equal(leakedToNetwork.length, 0, "Synthetic content reached a network request");
    assert.equal(deniedExternal.length, 0, "An unexpected external network request was attempted");
    assert.equal(websockets.filter((kind) => kind !== "local").length, 0,
      "An unexpected external WebSocket was opened");
    console.log(JSON.stringify({
      syntheticFixtureOnly: true,
      importAndStrictPreview: "passed",
      ordinaryExportRecipientGate: "passed",
      localRequestCount: localRequests,
      attemptedExternalRequests: deniedExternal.length,
      outgoingCanaryRequests: leakedToNetwork.length,
      externalWebsockets: 0,
      note: "Chromium audit; does not prove absence of every possible leak or extension/device risk.",
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  // Never echo a URL/body containing synthetic (or future accidental) private data.
  console.error("Browser privacy audit failed:", error && error.name || "Error");
  process.exitCode = 1;
});
