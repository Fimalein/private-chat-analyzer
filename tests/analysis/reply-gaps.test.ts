import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  attachReplyGaps,
  deriveReplyGaps,
  hasReplyGapAtLeast,
} from "@/lib/analysis/reply-gaps";

function message(
  id: string,
  senderId: string,
  timestamp: number,
): ChatMessage {
  return {
    id,
    senderId,
    senderName: senderId,
    timestamp,
    content: id,
    platform: "line",
    type: "text",
  };
}

describe("deriveReplyGaps", () => {
  it("records a gap only when the speaker changes", () => {
    const messages = [
      message("a1", "PERSON_A", 0),
      message("a2", "PERSON_A", 60_000),
      message("b1", "PERSON_B", 10 * 60_000),
      message("b2", "PERSON_B", 11 * 60_000),
      message("a3", "PERSON_A", 20 * 60_000),
    ];

    expect(deriveReplyGaps(messages)).toEqual([
      {
        previousMessageId: "a2",
        messageId: "b1",
        fromSenderId: "PERSON_A",
        toSenderId: "PERSON_B",
        gapMs: 9 * 60_000,
      },
      {
        previousMessageId: "b2",
        messageId: "a3",
        fromSenderId: "PERSON_B",
        toSenderId: "PERSON_A",
        gapMs: 9 * 60_000,
      },
    ]);
  });

  it("handles reply gaps across day boundaries", () => {
    const beforeMidnight = new Date(2026, 9, 10, 23, 30).getTime();
    const afterMidnight = new Date(2026, 9, 11, 8, 0).getTime();

    const gaps = deriveReplyGaps([
      message("a", "PERSON_A", beforeMidnight),
      message("b", "PERSON_B", afterMidnight),
    ]);

    expect(gaps[0].gapMs).toBe(8.5 * 60 * 60 * 1000);
  });

  it("sorts a copy and leaves the source array unchanged", () => {
    const input = [
      message("later", "PERSON_B", 2_000),
      message("earlier", "PERSON_A", 1_000),
    ];
    const originalOrder = input.map((item) => item.id);

    expect(deriveReplyGaps(input)[0]).toMatchObject({
      previousMessageId: "earlier",
      messageId: "later",
      gapMs: 1_000,
    });
    expect(input.map((item) => item.id)).toEqual(originalOrder);
  });
});

describe("attachReplyGaps", () => {
  it("returns derived copies without modifying raw messages", () => {
    const raw = [
      message("a", "PERSON_A", 0),
      message("b", "PERSON_B", 6 * 60 * 60 * 1000),
    ];

    const derived = attachReplyGaps(raw);

    expect(derived[0]).not.toBe(raw[0]);
    expect(derived[1].replyGapMs).toBe(6 * 60 * 60 * 1000);
    expect("replyGapMs" in raw[1]).toBe(false);
    expect(hasReplyGapAtLeast(derived[1], 6 * 60 * 60 * 1000)).toBe(true);
    expect(hasReplyGapAtLeast(derived[1], 24 * 60 * 60 * 1000)).toBe(false);
  });
});
