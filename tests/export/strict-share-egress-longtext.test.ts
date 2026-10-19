import { describe, expect, it } from "vitest";
import { approveStrictChatGptSharePack, inspectStrictSerializedFiles, previewStrictChatGptSharePack, StrictShareBlockedError } from "@/lib/export/strict-chatgpt-share";
import { SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS, SYNTHETIC_EXPORT_RAW_VALUES } from "../fixtures/synthetic/export-leak-regression";
import type { ChatGptExportFile } from "@/lib/export/chatgpt-pack";

// Fabricated names for local-only output verification.
const madeUpPlace = "架空花霞町";
function testFile(content: string): ChatGptExportFile {
  return { name: "synthetic.txt", type: "text/plain", content };
}

describe("strict synthetic serialized output regression", () => {
  it("blocks a known fictional place appearing late in a long message", () => {
    expect(() => inspectStrictSerializedFiles(
      [testFile("無害な文章".repeat(300) + madeUpPlace)], [madeUpPlace],
    )).toThrow(StrictShareBlockedError);
  });
  it("does not silently ignore a user-listed one-character nickname", () => {
    expect(() => inspectStrictSerializedFiles(
      [testFile("呼び名：柊")], ["柊"],
    )).toThrow(StrictShareBlockedError);
  });
  it("normalizes width variants of user-listed identifiers", () => {
    expect(() => inspectStrictSerializedFiles(
      [testFile("連絡事項：ＡＢＣ")], ["ABC"],
    )).toThrow(StrictShareBlockedError);
  });
  it("checks all serialized file entries, not just the first", () => {
    expect(() => inspectStrictSerializedFiles(
      [testFile("safe"), testFile("合成識別子が残る")], ["合成識別子"],
    )).toThrow(StrictShareBlockedError);
  });
  it("refuses approval when a previously displayed file changed", () => {
    const options = { dateMode: { mode: "relative_day" as const }, knownSensitiveValues: SYNTHETIC_EXPORT_RAW_VALUES };
    const preview = previewStrictChatGptSharePack(SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS, options);
    const updated = SYNTHETIC_EXPORT_MESSAGES.map((message, index) =>
      index === 0 ? { ...message, content: message.content + " 確認済みではない追記" } : message,
    );
    expect(() => approveStrictChatGptSharePack(
      updated, SYNTHETIC_EXPORT_MAPPINGS,
      { ...options, confirmedHumanReview: true },
      preview.files, preview.files.map((file) => file.name),
    )).toThrow(StrictShareBlockedError);
  });
  it("requires the reviewer to confirm every exported file", () => {
    const options = { dateMode: { mode: "relative_day" as const }, knownSensitiveValues: SYNTHETIC_EXPORT_RAW_VALUES };
    const preview = previewStrictChatGptSharePack(SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS, options);
    expect(() => approveStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
      { ...options, confirmedHumanReview: true },
      preview.files, preview.files.slice(0, 3).map((file) => file.name),
    )).toThrow(StrictShareBlockedError);
  });
  it("passes a short fabricated pseudonym-only text", () => {
    expect(() => inspectStrictSerializedFiles(
      [testFile("PERSON_A は LOCATION_1 へ行った")], [madeUpPlace],
    )).not.toThrow();
  });
});
