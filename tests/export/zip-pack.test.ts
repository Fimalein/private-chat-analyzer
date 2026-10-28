import { describe, expect, it } from "vitest";
import { buildChatGptExportPack, ExportBlockedError } from "@/lib/export/chatgpt-pack";
import { createChatStoryZip } from "@/lib/export/zip-pack";
import { crc32Zip } from "@/lib/export/zip-crc";
import type { ChatMessage } from "@/lib/chat-types";

describe("local ZIP export", () => {
  it("uses a known CRC32 checksum", () => {
    expect(crc32Zip(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("stores all UTF-8 files intact with a valid ZIP directory", () => {
    const files = [
      { name: "chat_redacted.txt", content: "こんにちは\n絵文字🌸" },
      { name: "analysis_index.json", content: "{\"ok\":true}" },
    ];
    const bytes = createChatStoryZip(files);
    const view = new DataView(bytes.buffer);
    const decoder = new TextDecoder();
    let p = 0;
    for (const file of files) {
      expect(view.getUint32(p, true)).toBe(0x04034b50);
      expect(view.getUint16(p + 6, true)).toBe(0x0800);
      expect(view.getUint16(p + 8, true)).toBe(0);
      const nameLength = view.getUint16(p + 26, true);
      const extraLength = view.getUint16(p + 28, true);
      const size = view.getUint32(p + 18, true);
      const nameStart = p + 30;
      expect(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength))).toBe(file.name);
      const dataStart = nameStart + nameLength + extraLength;
      const data = bytes.subarray(dataStart, dataStart + size);
      expect(decoder.decode(data)).toBe(file.content);
      expect(view.getUint32(p + 14, true)).toBe(crc32Zip(data));
      p = dataStart + size;
    }
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(files.length);
    expect(view.getUint32(end + 16, true)).toBe(p);
  });

  it("does not accept unsafe names or empty packs", () => {
    expect(() => createChatStoryZip([])).toThrow("ZIP_FILE_COUNT");
    expect(() => createChatStoryZip([{name: "../a.txt", content: "x"}])).toThrow("ZIP_NAME");
  });

  it("respects the existing high-risk PII blocker", () => {
    const message: ChatMessage = {
      id: "synthetic-1",
      senderName: "架空の人A",
      senderId: "架空の人A",
      timestamp: Date.UTC(2026, 0, 1),
      content: "連絡用は example+synthetic@example.test",
      type: "text",
      platform: "line",
    };
    expect(() => buildChatGptExportPack([message], [])).toThrow(ExportBlockedError);
    const pack = buildChatGptExportPack([message], [{
      source: "example+synthetic@example.test",
      replacement: "EMAIL_1",
      kind: "secret",
    }]);
    const zip = createChatStoryZip(pack.files);
    expect(zip.byteLength).toBeGreaterThan(200);
    const text = new TextDecoder().decode(zip);
    expect(text).not.toContain("example+synthetic@example.test");
  });
});
