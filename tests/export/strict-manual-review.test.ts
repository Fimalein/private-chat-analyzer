import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  applyStrictMessageEdits,
  strictReviewSegments,
} from "@/lib/export/strict-manual-masking";
import {
  approveStrictChatGptSharePack,
  previewStrictChatGptSharePack,
  StrictShareBlockedError,
} from "@/lib/export/strict-chatgpt-share";
import {
  SYNTHETIC_EXPORT_MAPPINGS,
  SYNTHETIC_EXPORT_MESSAGES,
  SYNTHETIC_EXPORT_RAW_VALUES,
} from "../fixtures/synthetic/export-leak-regression";

const options = {
  dateMode: { mode: "relative_day" as const },
  knownSensitiveValues: SYNTHETIC_EXPORT_RAW_VALUES,
};
const reviewed = [
  "chat_redacted.txt", "chat_redacted.jsonl",
  "analysis_index.json", "ChatGPT_analysis_instructions.txt",
];

function expectBlock(fn: () => unknown, reason: string) {
  try {
    fn();
    throw new Error("SHOULD_HAVE_BLOCKED");
  } catch (error) {
    expect(error).toBeInstanceOf(StrictShareBlockedError);
    expect((error as StrictShareBlockedError).reason).toBe(reason);
  }
}

describe("synthetic local manual sentence masking", () => {
  it("preserves Unicode code units, punctuation and original line breaks", () => {
    const source = "🚄架空の約束。\n秘密の駅名！\r\nもう一つの文章？";
    const parts = strictReviewSegments(source);
    expect(parts.map((part) => part.text).join("")).toBe(source);
    expect(parts.filter((part) => part.editable).map((part) => part.text)).toEqual([
      "🚄架空の約束。", "秘密の駅名！", "もう一つの文章？",
    ]);
    const msg = { ...SYNTHETIC_EXPORT_MESSAGES[0], content: source };
    const secondIndex = parts.find((part) => part.text === "秘密の駅名！")!.index;
    const output = applyStrictMessageEdits([msg], {
      [msg.id]: { action: "mask_sentences", indices: [secondIndex] },
    });
    expect(output[0].content).toBe(
      "🚄架空の約束。\n[REDACTED_SENTENCE]\r\nもう一つの文章？",
    );
    expect(msg.content).toBe(source);
    expect(output[0].sourceLine).toBe(msg.sourceLine);
  });

  it("supports omitting individual messages or replacing whole content", () => {
    const messages = SYNTHETIC_EXPORT_MESSAGES;
    const onlyMasked = applyStrictMessageEdits(messages, {
      [messages[0].id]: { action: "omit" },
      [messages[1].id]: { action: "mask_all" },
    });
    expect(onlyMasked).toHaveLength(1);
    expect(onlyMasked[0].content).toBe("[REDACTED_MESSAGE]");
    expect(onlyMasked[0].senderName).toBe(messages[1].senderName);
    expect(messages[1].content).not.toBe("[REDACTED_MESSAGE]");
  });

  it("rejects invalid masked indices, newline masking and unknown edit modes", () => {
    const msg = SYNTHETIC_EXPORT_MESSAGES[0];
    expect(() => applyStrictMessageEdits([msg], {
      [msg.id]: { action: "mask_sentences", indices: [999] },
    })).toThrow(RangeError);
    const multiline = { ...msg, content: "前半\n後半" };
    const newline = strictReviewSegments(multiline.content).find((part) => !part.editable)!.index;
    expect(() => applyStrictMessageEdits([multiline], {
      [msg.id]: { action: "mask_sentences", indices: [newline] },
    })).toThrow(RangeError);
    expect(() => applyStrictMessageEdits([msg], {
      [msg.id]: { action: "invalid" } as never,
    })).toThrow(RangeError);
  });

  it("does not treat inherited prototype properties as imported message edits", () => {
    const msg = { ...SYNTHETIC_EXPORT_MESSAGES[0], id: "toString" };
    expect(applyStrictMessageEdits([msg], {})).toEqual([msg]);
  });

  it("manually masking a distinct contextual sentence prevents export leakage in all 4 artifacts", () => {
    const privatePhrase = "唯一の架空イベントの呼称";
    const source: ChatMessage[] = [
      ...SYNTHETIC_EXPORT_MESSAGES,
      {
        ...SYNTHETIC_EXPORT_MESSAGES[0],
        id: "synthetic-extra-message",
        timestamp: Date.UTC(2026, 0, 2),
        content: "今日は楽しかった。 " + privatePhrase + "に行った！\n良い日でした。",
      },
    ];
    const originalContent = source[2].content;
    const index = strictReviewSegments(originalContent)
      .find((part) => part.text.includes(privatePhrase))!.index;
    const masked = applyStrictMessageEdits(source, {
      [source[2].id]: { action: "mask_sentences", indices: [index] },
    });
    const preview = previewStrictChatGptSharePack(masked, SYNTHETIC_EXPORT_MAPPINGS, {
      ...options,
      knownSensitiveValues: [...options.knownSensitiveValues, privatePhrase],
    });
    const all = preview.files.map((file) => file.content).join("\n");
    expect(all).not.toContain(privatePhrase);
    expect(all).toContain("[REDACTED_SENTENCE]");
    expect(all).toContain("今日は楽しかった。");
    expect(all).toContain("良い日でした。");
    expect(source[2].content).toBe(originalContent);
    expect(preview.files).toHaveLength(4);
  });

  it("fails if any of four files were not individually reviewed", () => {
    const pack = previewStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS, options,
    );
    expectBlock(() => approveStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
      { ...options, confirmedHumanReview: true }, pack.files, reviewed.slice(0, 3),
    ), "file_review_incomplete");
  });

  it("requires a new review if content, mapping, date or preview files change", () => {
    const before = previewStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS, options,
    );
    const approved = approveStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
      { ...options, confirmedHumanReview: true }, before.files, reviewed,
    );
    expect(approved.files).toEqual(before.files);

    const newMessage = [{
      ...SYNTHETIC_EXPORT_MESSAGES[0],
      content: SYNTHETIC_EXPORT_MESSAGES[0].content + " 文面変更。",
    }];
    expectBlock(() => approveStrictChatGptSharePack(
      newMessage, SYNTHETIC_EXPORT_MAPPINGS,
      { ...options, confirmedHumanReview: true }, before.files, reviewed,
    ), "preview_changed");

    expectBlock(() => approveStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
      { ...options, dateMode: { mode: "shift_weeks", weeks: 3 },
        confirmedHumanReview: true }, before.files, reviewed,
    ), "serialized_structured_pii"); // shifted mode also serializes numeric epoch timestampMs;
                                  // strict post-serialization scan blocks it before snapshot comparison.

    const altered = before.files.map((file) => ({ ...file }));
    altered[1].content += " extra";
    expectBlock(() => approveStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
      { ...options, confirmedHumanReview: true }, altered, reviewed,
    ), "preview_changed");
  });

  it("fails closed if every selected message was manually omitted", () => {
    const masked = applyStrictMessageEdits(SYNTHETIC_EXPORT_MESSAGES,
      Object.fromEntries(SYNTHETIC_EXPORT_MESSAGES.map(
        (msg) => [msg.id, { action: "omit" }],
      )));
    expect(masked).toHaveLength(0);
    expectBlock(() => previewStrictChatGptSharePack(
      masked, SYNTHETIC_EXPORT_MAPPINGS, options,
    ), "empty_selection");
  });
});
