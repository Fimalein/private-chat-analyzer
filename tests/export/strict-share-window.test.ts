import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  approveStrictChatGptSharePack,
  previewStrictChatGptSharePack,
  selectStrictShareWindowMessages,
  STRICT_CONTEXT_REVIEW_CATEGORIES,
  StrictShareBlockedError,
} from "@/lib/export/strict-chatgpt-share";
import {
  SYNTHETIC_EXPORT_MAPPINGS,
  SYNTHETIC_EXPORT_MESSAGES,
  SYNTHETIC_EXPORT_RAW_VALUES,
} from "../fixtures/synthetic/export-leak-regression";

// SYNTHETIC_FIXTURE — all conversation content and participants are fabricated.
const messages: ChatMessage[] = Array.from({ length: 12 }, (_, index) => ({
  ...SYNTHETIC_EXPORT_MESSAGES[index % SYNTHETIC_EXPORT_MESSAGES.length],
  id: `synthetic-window-${String(index).padStart(2, "0")}`,
  timestamp: Date.UTC(2026, 0, 1, 12, index),
  content: `SYNTHETIC_WINDOW_${String(index).padStart(2, "0")}`,
}));

describe("strict local disclosure window (synthetic-only)", () => {
  it("defaults to a bounded newest excerpt and can move to older pages", () => {
    const reverse = [...messages].reverse();
    expect(selectStrictShareWindowMessages(reverse, 5, 0).map((m) => m.id))
      .toEqual(messages.slice(7).map((m) => m.id));
    expect(selectStrictShareWindowMessages(reverse, 5, 5).map((m) => m.id))
      .toEqual(messages.slice(2, 7).map((m) => m.id));
    expect(selectStrictShareWindowMessages(reverse, 5, 10).map((m) => m.id))
      .toEqual(messages.slice(0, 2).map((m) => m.id));
    expect(reverse).toEqual([...messages].reverse());
    expect(selectStrictShareWindowMessages([], 5, 0)).toEqual([]);
  });

  it("does not widen a share on invalid or malicious input", () => {
    for (const offset of [-1, 12, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => selectStrictShareWindowMessages(messages, 5, offset)).toThrow(RangeError);
    }
    expect(() => selectStrictShareWindowMessages(messages, 100 as 5, 0)).toThrow(RangeError);
    expect(() => selectStrictShareWindowMessages([], 5, 1)).toThrow(RangeError);
  });

  it("exports only the selected window, never any out-of-scope messages", () => {
    const selected = selectStrictShareWindowMessages(messages, 5, 0);
    const options = {
      dateMode: { mode: "relative_day" as const },
      knownSensitiveValues: SYNTHETIC_EXPORT_RAW_VALUES,
    };
    const pack = previewStrictChatGptSharePack(selected, SYNTHETIC_EXPORT_MAPPINGS, options);
    const contents = pack.files.map((file) => file.content).join("\n");
    for (let index = 0; index < 12; index += 1) {
      const marker = `SYNTHETIC_WINDOW_${String(index).padStart(2, "0")}`;
      expect(contents.includes(marker)).toBe(index >= 7);
    }
    const previousPage = selectStrictShareWindowMessages(messages, 5, 5);
    try {
      approveStrictChatGptSharePack(previousPage, SYNTHETIC_EXPORT_MAPPINGS,
        { ...options, confirmedHumanReview: true }, pack.files,
        pack.files.map((file) => file.name), STRICT_CONTEXT_REVIEW_CATEGORIES);
      throw new Error("approval should have been invalidated");
    } catch (error) {
      expect(error).toBeInstanceOf(StrictShareBlockedError);
      expect((error as StrictShareBlockedError).reason).toBe("preview_changed");
    }
  });
});
