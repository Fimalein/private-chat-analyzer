import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  buildChatGptExportPack,
  ExportBlockedError,
} from "@/lib/export/chatgpt-pack";
import type { EntityMapping } from "@/lib/privacy";

function msg(
  id: string,
  timestamp: number,
  senderName: string,
  content: string,
): ChatMessage {
  return {
    id,
    timestamp,
    senderId: senderName,
    senderName,
    content,
    platform: "line",
    type: "text",
  };
}

const messages = [
  msg("raw-1", Date.UTC(2026, 0, 1, 0, 0), "呼び名A", "連絡先は fake.user@example.test"),
  msg("raw-2", Date.UTC(2026, 0, 1, 7, 0), "呼び名B", "了解です"),
];

const mappings: EntityMapping[] = [
  { source: "呼び名A", replacement: "PERSON_A", kind: "person" },
  { source: "呼び名B", replacement: "PERSON_B", kind: "person" },
  {
    source: "fake.user@example.test",
    replacement: "EMAIL_1",
    kind: "secret",
  },
];

describe("buildChatGptExportPack", () => {
  it("blocks export when transformed output still contains high-risk PII", () => {
    expect(() => buildChatGptExportPack(messages, mappings.slice(0, 2))).toThrow(
      ExportBlockedError,
    );
  });

  it("generates the four expected artifacts after high-risk PII is removed", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    expect(pack.audit.highRisk).toHaveLength(0);
    expect(pack.files.map((file) => file.name)).toEqual([
      "chat_redacted.txt",
      "chat_redacted.jsonl",
      "analysis_index.json",
      "ChatGPT_analysis_instructions.txt",
    ]);
  });

  it("never serializes source mapping values when those values were replaced", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    const serialized = pack.files.map((file) => file.content).join("\n");

    expect(serialized).not.toContain("呼び名A");
    expect(serialized).not.toContain("呼び名B");
    expect(serialized).not.toContain("fake.user@example.test");
    expect(serialized).toContain("PERSON_A");
    expect(serialized).toContain("EMAIL_1");
  });

  it("emits one valid JSON object per message with export-safe sequential ids", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    const jsonl = pack.files.find((file) => file.name === "chat_redacted.jsonl")!;
    const records = jsonl.content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(records).toHaveLength(2);
    expect(records[0].id).toBe("m_000001");
    expect(records[1].id).toBe("m_000002");
    expect(records[0]).not.toHaveProperty("sourceLine");
    expect(records[0]).not.toHaveProperty("senderId");
  });

  it("keeps the analysis index metadata-only and points back to the full transcript", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    const indexFile = pack.files.find((file) => file.name === "analysis_index.json")!;
    const index = JSON.parse(indexFile.content);

    expect(index.navigationOnly).toBe(true);
    expect(index.primaryEvidence).toBe("chat_redacted.txt");
    expect(index.sourceLabel).toBe("CHAT_EXPORT");
    expect(index.candidateWindows).toHaveLength(1);
    expect(index.candidateWindows[0].kind).toBe("reply_gap");
    expect(indexFile.content).not.toContain("了解です");
    expect(indexFile.content).not.toContain("連絡先は");
  });

  it("states that the transcript is primary evidence and the index is only navigation", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    const instructions = pack.files.find(
      (file) => file.name === "ChatGPT_analysis_instructions.txt",
    )!;
    expect(instructions.content).toContain("primary evidence");
    expect(instructions.content).toContain("only a navigation aid");
  });
});
