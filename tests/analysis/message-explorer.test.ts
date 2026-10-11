import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  DEFAULT_EXPLORER_FILTERS,
  explorerContextWindow,
  filterAndSortExplorerMessages,
  prepareExplorerMessages,
} from "@/lib/analysis/message-explorer";

function message(
  id: string,
  timestamp: string,
  senderName: string,
  content: string,
  type: ChatMessage["type"] = "text",
): ChatMessage {
  return {
    id,
    timestamp: new Date(timestamp).getTime(),
    senderId: senderName,
    senderName,
    content,
    platform: "line",
    type,
  };
}

const raw = [
  message("m1", "2026-10-01T09:00:00", "PERSON_A", "morning note"),
  message("m2", "2026-10-01T09:05:00", "PERSON_A", "same burst"),
  message("m3", "2026-10-01T15:30:00", "PERSON_B", "reply keyword"),
  message("m4", "2026-10-02T08:00:00", "PERSON_A", "photo keyword", "image"),
  message("m5", "2026-10-03T20:00:00", "PERSON_B", "late reply"),
];

describe("message explorer", () => {
  it("composes keyword, sender, date, type and reply-gap filters", () => {
    const prepared = prepareExplorerMessages(raw);
    const result = filterAndSortExplorerMessages(prepared, {
      ...DEFAULT_EXPLORER_FILTERS,
      query: "keyword",
      sender: "PERSON_B",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-02",
      type: "text",
      minReplyGapMs: 6 * 60 * 60 * 1000,
    });

    expect(result.map((item) => item.id)).toEqual(["m3"]);
    expect(result[0].replyGapMs).toBe(6 * 60 * 60 * 1000 + 25 * 60 * 1000);
  });

  it("sorts newest first", () => {
    const result = filterAndSortExplorerMessages(prepareExplorerMessages(raw), {
      ...DEFAULT_EXPLORER_FILTERS,
      sort: "newest",
    });

    expect(result.map((item) => item.id)).toEqual(["m5", "m4", "m3", "m2", "m1"]);
  });

  it("sorts reply gaps descending and keeps messages without gaps last", () => {
    const result = filterAndSortExplorerMessages(prepareExplorerMessages(raw), {
      ...DEFAULT_EXPLORER_FILTERS,
      sort: "reply-gap",
    });

    expect(result.slice(0, 3).map((item) => item.id)).toEqual(["m5", "m4", "m3"]);
    expect(result.slice(3).every((item) => item.replyGapMs == null)).toBe(true);
  });

  it("returns chronological context around a target", () => {
    const context = explorerContextWindow(prepareExplorerMessages(raw), "m3", 1);
    expect(context.map((item) => item.id)).toEqual(["m2", "m3", "m4"]);
  });
});
