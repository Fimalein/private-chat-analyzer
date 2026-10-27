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
let auditStage = "desktop_initial";
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
  // Existing privacy gates run under a stable English locale. The live app now
  // defaults to Japanese, so also verify Japanese switching independently.
  await context.addInitScript(() => {
    window.localStorage.setItem("chatstory-locale", "en");
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
    await page.getByRole("button", { name: "日本語" }).click();
    await page.getByRole("heading", { name: /チャット履歴から/ }).waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "ja",
      "Japanese locale must update the document language");
    await page.getByRole("button", { name: "English" }).click();
    await page.getByRole("heading", { name: /Turn your chats into/ }).waitFor();
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
      name: /下載 4 個檔案|download 4 files/,
    });
    await shareButton.waitFor();
    assert.equal(await shareButton.isDisabled(), true,
      "Ordinary export must be disabled without provider disclosure acknowledgement");
    const acknowledge = page.getByRole("checkbox", {
      name: /我了解本機下載|I understand that downloading/,
    });
    await acknowledge.check();
    assert.equal(await shareButton.isDisabled(), true,
      "Provider consent alone must never unlock the ordinary exporter");
    async function reviewAllFour() {
      await page.getByRole("button", {
        name: /產生 4 份完整檔案的本機預覽|Generate local preview of 4 exact files/,
      }).click();
      await page.getByRole("textbox", { name: "Full selected export file preview" }).waitFor();
      const names = [
        "chat_redacted.txt", "chat_redacted.jsonl",
        "analysis_index.json", "ChatGPT_analysis_instructions.txt",
      ];
      for (const fileName of names) {
        await page.getByRole("button", { name: fileName, exact: true }).click();
        const fileViewer = page.getByRole("textbox", { name: "Full selected export file preview" });
        assert.ok((await fileViewer.inputValue()).length > 0,
          "Each selected file must show its actual full content");
        await page.getByRole("checkbox", {
          name: /我已檢查此檔案的全部內容|I reviewed the entire selected file/,
        }).check();
        assert.equal(await shareButton.isDisabled(), true,
          "Reviewing individual files must not directly authorize sharing");
      }
      await page.getByRole("button", {
        name: /核准這 4 份完全一致的檔案|Approve these 4 exact files/,
      }).click();
      assert.equal(await shareButton.isEnabled(), true,
        "Only four-file review plus explicit authorization may unlock ordinary export");
    }
    await reviewAllFour();
    auditStage = "desktop_scope_change";
    const scopePicker = page.getByLabel("Export message scope");
    await scopePicker.selectOption("dates");
    assert.equal(await shareButton.isDisabled(), true,
      "Switching scope must revoke previous approval");
    const previewButton = page.getByRole("button", {
      name: /產生 4 份完整檔案的本機預覽|Generate local preview of 4 exact files/,
    });
    assert.equal(await previewButton.isDisabled(), true,
      "Empty calendar range must never silently mean all messages");
    await page.getByLabel("Export start date").fill("2026-10-11");
    await page.getByLabel("Export end date").fill("2026-10-11");
    assert.equal(await previewButton.isEnabled(), true,
      "Valid selected calendar range can be previewed");
    await scopePicker.selectOption("recent");
    await page.getByLabel("Recent message count").selectOption("100");
    assert.equal(await shareButton.isDisabled(), true,
      "Changing the recent count must revoke previous approval");
    await reviewAllFour();
    const provider = page.getByLabel(/預定收件方|Intended recipient/);
    await provider.selectOption("other");
    assert.equal(await shareButton.isDisabled(), true,
      "Changing the intended recipient must invalidate acknowledgement");
    await acknowledge.check();
    assert.equal(await shareButton.isDisabled(), true,
      "Changing recipient invalidates even the earlier file-specific review");
    await reviewAllFour();
    // Additional synthetic chat: no native share is possible if a cookie secret
    // remains, even when recipient terms have been acknowledged.
    await page.goto(origin, { waitUntil: "networkidle" });
    const secretFixture = [
      "[LINE] Chat history with Synthetic Person One",
      "Saved at 2026/10/11 20:00",
      "",
      "2026/10/11(日)",
      "9:10\tSynthetic Person One\tCookie: sessionid=FABRICATED_COOKIE_VALUE_FOR_TEST",
      "9:11\tSynthetic Person Two\tSYNTHETIC_FIXTURE, no real conversation",
    ].join("\n");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "SYNTHETIC_FIXTURE-local-secret.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(secretFixture, "utf8"),
    });
    await page.getByRole("heading", { name: /確認這份對話|Check this chat/ }).waitFor();
    await page.getByRole("button", { name: /打開儀表板|Open dashboard/ }).click();
    await page.getByRole("button", { name: /ChatGPT 匯出|Export for ChatGPT/ }).click();
    await page.getByRole("checkbox", {
      name: /我了解本機下載|I understand that downloading/,
    }).check();
    assert.equal(await page.getByRole("button", {
      name: /下載 4 個檔案|download 4 files/,
    }).isDisabled(), true, "Synthetic secret must block ordinary export after provider acknowledgement");
    await page.getByText(/認證秘密資料|Authentication secrets remain/).waitFor();
    // Never trigger native share or a download in this pre-handoff network test.

    auditStage = "mobile_context";
    // Android-like Chromium touch/viewport smoke test, NOT a real Android phone.
    const mobile = await browser.newContext({
      viewport: { width: 393, height: 851 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await mobile.addInitScript(() => {
      window.localStorage.setItem("chatstory-locale", "en");
    });
    const mobilePage = await mobile.newPage();
    let mobileLocalRequests = 0;
    let mobileEgressAttempts = 0;
    let mobileCanaryAttempts = 0;
    await mobile.route("**/*", async route => {
      const request = route.request();
      const address = request.url();
      if ((address + "\n" + (request.postData() || "")).includes("MOBILE_FABRICATED_FIRST_EXCLUDED")) {
        mobileCanaryAttempts++;
      }
      if (address.startsWith("http:") || address.startsWith("https:")) {
        if (new URL(address).origin !== originHost) {
          mobileEgressAttempts++;
          return route.abort("blockedbyclient");
        }
        mobileLocalRequests++;
      }
      return route.continue();
    });
    mobilePage.on("websocket", ws => {
      if (!ws.url().startsWith(originHost)) mobileEgressAttempts++;
    });
    try {
      auditStage = "mobile_import";
      await mobilePage.goto(origin, { waitUntil: "networkidle" });
      const mobileLines = [
        "[LINE] Chat history with Synthetic Person One",
        "Saved at 2026/10/11 20:00",
        "",
        "2026/10/11(日)",
        ...Array.from({ length: 30 }, (_, index) =>
          "9:" + String(index).padStart(2, "0") + "\tSynthetic Person " + (index % 2 ? "Two" : "One") + "\t" +
          (index === 0 ? "MOBILE_FABRICATED_FIRST_EXCLUDED" : "SYNTHETIC_MOBILE_MESSAGE_" + index)),
      ].join("\n");
      await mobilePage.locator('input[type="file"]').first().setInputFiles({
        name: "SYNTHETIC_FIXTURE-mobile-touch-check.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(mobileLines, "utf8"),
      });
      await mobilePage.getByRole("heading", { name: /確認這份對話|Check this chat/ }).waitFor();
      await mobilePage.getByRole("button", { name: /打開儀表板|Open dashboard/ }).click();
      await mobilePage.getByRole("button", { name: /ChatGPT 匯出|Export for ChatGPT/ }).click();
      auditStage = "mobile_recent_selection";
      const mobileScope = mobilePage.getByLabel("Export message scope");
      assert.equal(await mobileScope.inputValue(), "recent", "Touch layout defaults to recent messages");
      assert.equal(await mobilePage.getByLabel("Recent message count").inputValue(), "25");
      await mobilePage.getByRole("button", {
        name: /產生 4 份完整檔案的本機預覽|Generate local preview of 4 exact files/,
      }).click();
      auditStage = "mobile_recent_preview";
      const mobileViewer = mobilePage.getByRole("textbox", { name: "Full selected export file preview" });
      await mobileViewer.waitFor();
      assert.equal((await mobileViewer.inputValue()).includes("MOBILE_FABRICATED_FIRST_EXCLUDED"), false,
        "Mobile preview must exclude a fabricated first message outside the selected last 25");
      const mobileShare = mobilePage.getByRole("button", {
        name: /下載 4 個檔案|download 4 files/,
      });
      assert.equal(await mobileShare.isDisabled(), true, "Mobile preview must not unlock file sharing");
      auditStage = "mobile_expand_all";
      await mobileScope.selectOption("all");
      assert.equal(await mobileShare.isDisabled(), true, "Scope changes revoke touch-layout preview");
      await mobilePage.getByRole("button", {
        name: /產生 4 份完整檔案的本機預覽|Generate local preview of 4 exact files/,
      }).click();
      await mobileViewer.waitFor();
      assert.equal((await mobileViewer.inputValue()).includes("MOBILE_FABRICATED_FIRST_EXCLUDED"), true,
        "Explicit all selection includes the fabricated earliest message");
      assert.equal(mobileEgressAttempts, 0, "No off-origin calls in mobile emulation");
      assert.equal(mobileCanaryAttempts, 0, "No synthetic canary egress in mobile emulation");
    } finally {
      await mobile.close();
    }

    assert.equal(leakedToNetwork.length, 0, "Synthetic content reached a network request");
    assert.equal(deniedExternal.length, 0, "An unexpected external network request was attempted");
    assert.equal(websockets.filter((kind) => kind !== "local").length, 0,
      "An unexpected external WebSocket was opened");
    console.log(JSON.stringify({
      syntheticFixtureOnly: true,
      importAndStrictPreview: "passed",
      ordinaryExportRecipientGate: "passed",
      ordinaryFourFileApproval: "passed",
      scopeResetAndMobileEmulation: "passed",
      mobileSameOriginRequests: mobileLocalRequests,
      mobileExternalRequests: mobileEgressAttempts,
      mobileOutgoingCanaryRequests: mobileCanaryAttempts,
      ordinarySecretGate: "passed",
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
  console.error("Browser privacy audit failed:", error && error.name || "Error", "stage:", auditStage);
  process.exitCode = 1;
});
