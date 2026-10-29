import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import { selectChatExportScope, localHandoffContextId } from "@/lib/export/chat-export-scope";
import {
  approveStandardHandoff,
  previewStandardHandoff,
  STANDARD_HANDOFF_FILE_NAMES,
  StandardHandoffBlockedError,
} from "@/lib/export/reviewed-chatgpt-handoff";
import { createChatStoryZip } from "@/lib/export/zip-pack";
import { crc32Zip } from "@/lib/export/zip-crc";
import { SecretExportBlockedError } from "@/lib/privacy/secret-guard";

const dateMode = { mode: "relative_day" } as const;
const scope = { mode: "recent", count: 25 } as const;
const messages: ChatMessage[] = Array.from({ length: 40 }, (_, i) => ({
  id: `fake-${i}`,
  timestamp: Date.UTC(2026, 8, 1, 12, 0) + i * 60_000,
  senderId: i % 2 ? "invented-b" : "invented-a",
  senderName: i % 2 ? "人物乙" : "人物甲",
  platform: "line",
  type: "text",
  content: i < 15
    ? `SYNTHETIC_EXCLUDED_MESSAGE_${i}`
    : `SYNTHETIC_INCLUDED_${i}\n\t全角と絵文字🌸。\n日本語の複数行テスト。`,
}));
const selected = selectChatExportScope(messages, scope);
const context = localHandoffContextId("fake-board", messages, scope);

function approvedFiles() {
  const preview = previewStandardHandoff(selected, [], dateMode, "temporary", context);
  const approved = approveStandardHandoff(
    selected, [], dateMode, "temporary", context,
    preview, STANDARD_HANDOFF_FILE_NAMES, true,
  );
  return { preview, approved };
}

function verifyZip(files: readonly { name: string; content: string }[], bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let cursor = 0;
  for (const file of files) {
    expect(view.getUint32(cursor, true)).toBe(0x04034b50);
    const nameSize = view.getUint16(cursor + 26, true);
    const extraSize = view.getUint16(cursor + 28, true);
    const payloadSize = view.getUint32(cursor + 18, true);
    const nameStart = cursor + 30;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameSize));
    const payloadStart = nameStart + nameSize + extraSize;
    const payload = bytes.subarray(payloadStart, payloadStart + payloadSize);
    expect(name).toBe(file.name);
    expect(decoder.decode(payload)).toBe(file.content);
    expect(view.getUint32(cursor + 14, true)).toBe(crc32Zip(payload));
    cursor = payloadStart + payloadSize;
  }
  expect(view.getUint32(cursor, true)).toBe(0x02014b50);
  expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
  expect(view.getUint16(bytes.length - 12, true)).toBe(4);
}

describe("reviewed four-file ZIP handoff (fabricated only)", () => {
  it("zips exactly the bytes approved in the full previews, including UTF-8 and multiline messages", () => {
    const { preview, approved } = approvedFiles();
    expect(approved.files).toEqual(preview.files);
    expect(approved.files.map(f => f.name)).toEqual([...STANDARD_HANDOFF_FILE_NAMES]);
    const bytes = createChatStoryZip(approved.files);
    verifyZip(preview.files, bytes);
    const zipText = new TextDecoder().decode(bytes);
    expect(zipText).toContain("SYNTHETIC_INCLUDED_39");
    expect(zipText).not.toContain("SYNTHETIC_EXCLUDED_MESSAGE_0");
    expect(zipText).not.toContain("SYNTHETIC_EXCLUDED_MESSAGE_14");
  });

  it("rejects missing checks, changed exported bytes and a changed recipient", () => {
    const { preview } = approvedFiles();
    const approve = (p = preview, names: readonly string[] = STANDARD_HANDOFF_FILE_NAMES, recipient: "temporary" | "other" = "temporary") =>
      approveStandardHandoff(selected, [], dateMode, recipient, context, p, names, true);
    expect(() => approve(preview, STANDARD_HANDOFF_FILE_NAMES.slice(0, 3)))
      .toThrow(StandardHandoffBlockedError);
    expect(() => approve(preview, STANDARD_HANDOFF_FILE_NAMES, "other"))
      .toThrow(StandardHandoffBlockedError);
    const tampered = { ...preview, files: preview.files.map((f, i) => i === 0 ? { ...f, content: f.content + "DIFFERENT" } : f) };
    expect(() => approve(tampered)).toThrow(StandardHandoffBlockedError);
  });

  it("revokes a previous approval after editing an excluded original message", () => {
    const { preview } = approvedFiles();
    const editedAll = messages.map((m, i) => i === 0 ? { ...m, content: m.content + "_EDITED" } : m);
    const editedChosen = selectChatExportScope(editedAll, scope);
    expect(editedChosen).toEqual(selected);
    const editedContext = localHandoffContextId("fake-board", editedAll, scope);
    expect(() => approveStandardHandoff(
      editedChosen, [], dateMode, "temporary", editedContext,
      preview, STANDARD_HANDOFF_FILE_NAMES, true,
    )).toThrow(StandardHandoffBlockedError);
  });

  it("fails before any ZIP is constructed when an unmasked fabricated credential is present", () => {
    const injected = selected.map((m, i) => i === 0
      ? { ...m, content: m.content + "\npassword=FABRICATED_ONLY_9876543210" } : m);
    expect(() => previewStandardHandoff(injected, [], dateMode, "temporary", context))
      .toThrow(SecretExportBlockedError);
  });
});
