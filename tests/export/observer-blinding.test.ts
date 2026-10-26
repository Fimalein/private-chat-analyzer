import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import { buildChatGptExportPack } from "@/lib/export/chatgpt-pack";
import { neutralizeExportSpeakers } from "@/lib/export/observer-speakers";
import { OBSERVER_ANALYSIS_INSTRUCTIONS } from "@/lib/export/observer-instructions";
import type { EntityMapping } from "@/lib/privacy";

const make = (senderId: string, senderName: string, content: string, timestamp: number): ChatMessage => ({
  id: "synthetic-" + String(timestamp),
  timestamp,
  senderId,
  senderName,
  content,
  platform: "line",
  type: "text",
});

const source = [
  make("local-owner-id", "自分の表示名", "ご相談ではなく架空の会話1", 1),
  make("remote-party-id", "相手の表示名", "架空の会話2", 2),
  make("local-owner-id", "自分の表示名", "架空の会話3", 3),
];

describe("observer-blind ChatGPT export (synthetic only)", () => {
  it("uses equal, stable, neutral labels for all sender metadata and index", () => {
    const pack = buildChatGptExportPack(source, [], { dateMode: { mode: "relative_day" } });
    const jsonl = pack.files.find(f => f.name === "chat_redacted.jsonl")!.content
      .trim().split("\n").map(line => JSON.parse(line));
    expect(jsonl.map(record => record.sender)).toEqual(["PERSON_A", "PERSON_B", "PERSON_A"]);
    const index = JSON.parse(pack.files.find(f => f.name === "analysis_index.json")!.content);
    expect(index.stats.senderMessageCounts).toEqual({ PERSON_A: 2, PERSON_B: 1 });
    for (const file of pack.files) {
      for (const sourceValue of ["local-owner-id", "remote-party-id", "自分の表示名", "相手の表示名"]) {
        expect(file.content).not.toContain(sourceValue);
      }
    }
  });

  it("does not change results when local-side name and counterparty name are swapped", () => {
    const swapped = source.map(m => ({
      ...m, senderName: m.senderName === "自分の表示名" ? "相手の表示名" : "自分の表示名",
    }));
    const left = buildChatGptExportPack(source, [], { dateMode: { mode: "relative_day" } });
    const right = buildChatGptExportPack(swapped, [], { dateMode: { mode: "relative_day" } });
    expect(right.files).toEqual(left.files);
  });

  it("preserves explicit neutral aliases when dialogue references those same placeholders", () => {
    const msgs = [
      make("src-1", "架空の名前1", "PERSON_Bには確認しました。", 1),
      make("src-2", "架空の名前2", "PERSON_Aも確認しました。", 2),
    ];
    const mappings: EntityMapping[] = [
      { source: "架空の名前1", replacement: "PERSON_B", kind: "person" },
      { source: "架空の名前2", replacement: "PERSON_A", kind: "person" },
      { source: "src-1", replacement: "PERSON_B", kind: "person" },
      { source: "src-2", replacement: "PERSON_A", kind: "person" },
    ];
    const pack = buildChatGptExportPack(msgs, mappings, { dateMode: { mode: "relative_day" } });
    const records = pack.files.find(f => f.name === "chat_redacted.jsonl")!.content
      .trim().split("\n").map(line => JSON.parse(line));
    expect(records.map(record => record.sender)).toEqual(["PERSON_B", "PERSON_A"]);
    expect(records[0].content).toContain("PERSON_B");
  });

  it("never infers identities from literal role-like names", () => {
    const labeled = [
      make("me", "SELF", "Example greeting", 1),
      make("you", "OTHER", "Example answer", 2),
    ];
    const safe = neutralizeExportSpeakers(labeled);
    expect(safe.map(m => m.senderName)).toEqual(["PERSON_A", "PERSON_B"]);
    expect(safe.map(m => m.senderId)).toEqual(["PERSON_A", "PERSON_B"]);
  });

  it("includes instructions to assess all participants without knowing who submitted", () => {
    expect(OBSERVER_ANALYSIS_INSTRUCTIONS).toMatch(/identity.*NOT supplied/i);
    expect(OBSERVER_ANALYSIS_INSTRUCTIONS).toMatch(/Never guess/);
    expect(OBSERVER_ANALYSIS_INSTRUCTIONS).toMatch(/same standards/);
    const pack = buildChatGptExportPack(source, [], { dateMode: { mode: "relative_day" } });
    const guidance = pack.files.find(f => f.name === "ChatGPT_analysis_instructions.txt")!.content;
    expect(guidance).toContain(OBSERVER_ANALYSIS_INSTRUCTIONS);
    expect(guidance).toContain("message IDs");
    expect(guidance).not.toContain("local-owner-id");
  });
});
