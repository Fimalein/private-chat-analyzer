import { describe, expect, it } from "vitest";
import { deriveConversationFlow, MAX_REPLY_GAP_MS } from "@/lib/analysis/conversation-flow";
import type { ChatMessage } from "@/lib/chat-types";

const MIN = 60000;
function make(id: string, sender: "a" | "b", stamp: number, type: ChatMessage["type"] = "text"): ChatMessage {
  return { id, senderId: sender, senderName: sender === "a" ? "架空のA" : "架空のB", timestamp: stamp, type, content: "架空会話", platform: "line" };
}

describe("conversation flow: objective observations only", () => {
  const base = new Date(2026, 9, 1, 9).getTime();
  const source = [
    make("m1", "a", base),
    make("m2", "a", base + 5 * MIN),
    make("m3", "b", base + 10 * MIN),
    make("m4", "a", base + 20 * MIN),
    make("m5", "b", base + 25 * 60 * MIN + 20 * MIN),
    make("m6", "b", base + 25 * 60 * MIN + 25 * MIN),
    make("m7", "a", base + 25 * 60 * MIN + 30 * MIN),
  ];

  it("measures cross-speaker gaps, not same-speaker messages or >24h switches", () => {
    const original = structuredClone(source);
    const result = deriveConversationFlow(source);
    expect(result.available).toBe(true);
    expect(result.replies.map(r => [r.previousMessageId, r.messageId, r.gapMs])).toEqual([
      ["m2", "m3", 5 * MIN], ["m3", "m4", 10 * MIN], ["m6", "m7", 5 * MIN],
    ]);
    expect(result.excludedLongSwitches).toBe(1);
    expect(result.senders.map(p => [p.id, p.samples, p.conversationStarts])).toEqual([
      ["a", 2, 1], ["b", 1, 1],
    ]);
    expect(result.senders[0].medianMs).toBe(7.5 * MIN);
    expect(result.senders[0].p90Ms).toBe(9.5 * MIN);
    expect(result.senders[1].medianMs).toBe(5 * MIN);
    expect(source).toEqual(original);
  });

  it("preserves reply counts and chronology regardless of input order", () => {
    const shuffled = [source[5], source[2], source[0], source[6], source[3], source[4], source[1]];
    expect(deriveConversationFlow(shuffled)).toEqual(deriveConversationFlow(source));
  });

  it("does not treat system notices as a third speaker or response", () => {
    const withSystem = [...source, make("system-notice", "a", base + 6 * MIN, "system")];
    expect(deriveConversationFlow(withSystem)).toEqual(deriveConversationFlow(source));
  });

  it("marks insufficient one-to-one data as unavailable and avoids fake metrics", () => {
    expect(deriveConversationFlow([]).available).toBe(false);
    expect(deriveConversationFlow([source[0]]).available).toBe(false);
    const third = { ...source[0], id: "third", senderId: "c", senderName: "架空のC" };
    expect(deriveConversationFlow([...source, third]).available).toBe(false);
  });

  it("counts the exact 24h boundary but excludes anything above it", () => {
    const eligible = deriveConversationFlow([make("one", "a", base), make("two", "b", base + MAX_REPLY_GAP_MS)]);
    expect(eligible.replies).toHaveLength(1);
    const excluded = deriveConversationFlow([make("one", "a", base), make("two", "b", base + MAX_REPLY_GAP_MS + 1)]);
    expect(excluded.replies).toHaveLength(0);
    expect(excluded.excludedLongSwitches).toBe(1);
  });

  it("keeps local calendar week buckets, including zero-sample weeks", () => {
    const flow = deriveConversationFlow(source);
    expect(flow.weeks).toHaveLength(6);
    expect(flow.weeks.at(-1)?.key).toBe("2026-09-28");
    const bucket = flow.weeks.at(-1)!;
    expect(bucket.bySender.a.samples).toBe(2);
    expect(bucket.bySender.b.samples).toBe(1);
    expect(flow.weeks[0].bySender.a.medianMs).toBeNull();
    expect(flow.highlights[0].messageId).toBe("m4");
    expect(flow.highlights[0].dayKey).toBe("2026-10-01");
  });

  it("is invariant to identity labels when preserved across messages", () => {
    const renamed = source.map(m => ({ ...m, senderId: m.senderId === "a" ? "b" : "a", senderName: m.senderName === "架空のA" ? "架空のB" : "架空のA" }));
    const before = deriveConversationFlow(source);
    const after = deriveConversationFlow(renamed);
    expect(before.replies.map(r => r.gapMs)).toEqual(after.replies.map(r => r.gapMs));
    expect(before.senders[0].medianMs).toBe(after.senders[0].medianMs);
    expect(before.senders[1].medianMs).toBe(after.senders[1].medianMs);
    expect(before.excludedLongSwitches).toBe(after.excludedLongSwitches);
  });

  it("handles large synthetic histories without person- or content-level scoring", () => {
    const many = Array.from({length: 20000}, (_, i) => make("synthetic-" + i, i % 2 ? "b" : "a", base + i * MIN));
    const flow = deriveConversationFlow(many);
    expect(flow.replies).toHaveLength(19999);
    expect(flow.senders[0].medianMs).toBe(MIN);
    expect(flow.senders[1].medianMs).toBe(MIN);
  });
});
