import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  buildStrictChatGptSharePack,
  inspectStrictSerializedFiles,
  previewStrictChatGptSharePack,
  selectRecentStrictShareMessages,
  StrictShareBlockedError,
  type StrictShareBlockedReason,
} from "@/lib/export/strict-chatgpt-share";
import type { ChatGptExportFile } from "@/lib/export/chatgpt-pack";
import {
  SYNTHETIC_EXPORT_MAPPINGS,
  SYNTHETIC_EXPORT_MESSAGES,
  SYNTHETIC_EXPORT_RAW_VALUES,
} from "../fixtures/synthetic/export-leak-regression";

const options = {
  dateMode: { mode: "relative_day" as const },
  knownSensitiveValues: SYNTHETIC_EXPORT_RAW_VALUES,
};

function blocked(fn: () => unknown, reason: StrictShareBlockedReason) {
  try {
    fn();
    throw new Error("Expected strict sharing to block");
  } catch (error) {
    expect(error).toBeInstanceOf(StrictShareBlockedError);
    const blockedError = error as StrictShareBlockedError;
    expect(blockedError.reason).toBe(reason);
    expect(blockedError.message).toBe("STRICT_CHATGPT_SHARE_BLOCKED");
    expect(JSON.stringify(blockedError)).not.toContain("秘密");
  }
}

const syntheticFile = (
  name: string, type: ChatGptExportFile["type"], content: string,
): ChatGptExportFile => ({ name, type, content });

describe("strict sharing serialized leak matrix (SYNTHETIC_FIXTURE)", () => {
  it.each([
    ["plain transcript", syntheticFile("chat_redacted.txt", "text/plain", "姓: 架空波音"), "架空波音"],
    ["escaped JSONL multiline", syntheticFile(
      "chat_redacted.jsonl", "application/x-ndjson",
      JSON.stringify({ sender: "PERSON_A", content: "秘密の\n合成通路" }) + "\n",
    ), "秘密の\n合成通路"],
    ["JSONL escaped quote", syntheticFile(
      "chat_redacted.jsonl", "application/x-ndjson",
      JSON.stringify({ content: '合成「関係者」' }) + "\n",
    ), '合成「関係者」'],
    ["nested JSON-derived field", syntheticFile(
      "analysis_index.json", "application/json",
      JSON.stringify({ candidateWindows: [{ details: { alias: "架空波音" } }] }),
    ), "架空波音"],
    ["instruction file", syntheticFile(
      "ChatGPT_analysis_instructions.txt", "text/plain",
      "Please describe 架空波音",
    ), "架空波音"],
  ])("blocks synthetic known value in %s", (_, file, secret) => {
    blocked(
      () => inspectStrictSerializedFiles([file], [secret]),
      "known_sensitive_value_survived",
    );
  });

  it("blocks NFKC and zero-width disguise against a locally configured denylist", () => {
    blocked(() => inspectStrictSerializedFiles([
      syntheticFile("chat_redacted.txt", "text/plain", "送信者：ＳＥＣＲＥＴＡＬＩＡＳ"),
    ], ["SECRETALIAS"]), "known_sensitive_value_survived");
    blocked(() => inspectStrictSerializedFiles([
      syntheticFile("chat_redacted.txt", "text/plain", "架空\u200b地名を含む"),
    ], ["架空地名"]), "known_sensitive_value_survived");
  });

  it("scans decoded JSON strings for structured identifiers", () => {
    const escaped = JSON.stringify({ contact: "合成メール@example.test" });
    blocked(() => inspectStrictSerializedFiles([
      syntheticFile("chat_redacted.jsonl", "application/x-ndjson", escaped + "\n"),
    ], ["irrelevant-local-secret"]), "serialized_structured_pii");
    blocked(() => inspectStrictSerializedFiles([
      syntheticFile("analysis_index.json", "application/json", JSON.stringify({
        identifier: "123" + "-4567", // synthetic, assembled at test runtime
      })),
    ], ["irrelevant-local-secret"]), "serialized_structured_pii");
  });

  it("fails closed for corrupt or unsupported file serialization", () => {
    blocked(() => inspectStrictSerializedFiles([
      syntheticFile("analysis_index.json", "application/json", "{"),
    ], ["fake"]), "invalid_serialized_artifact");
    blocked(() => inspectStrictSerializedFiles([
      syntheticFile("chat_redacted.jsonl", "application/x-ndjson", "{\"a\":1}\nnot json\n"),
    ], ["fake"]), "invalid_serialized_artifact");
    blocked(() => inspectStrictSerializedFiles([
      syntheticFile("unknown.bin", "application/zip" as ChatGptExportFile["type"], "..."),
    ], ["fake"]), "invalid_serialized_artifact");
  });

  it("checks entire generated pack and strips source IDs, line numbers and exact dates", () => {
    const longText = "合成の無意味な文を繰り返します。".repeat(100);
    const msgs: ChatMessage[] = [
      ...SYNTHETIC_EXPORT_MESSAGES,
      {
        ...SYNTHETIC_EXPORT_MESSAGES[0],
        id: "synthetic-hidden-source-id",
        sourceLine: 999,
        sourceEndLine: 1000,
        timestamp: Date.UTC(2026, 0, 3, 0, 0),
        content: longText + "架空姓テスト子 は学校で話をした。",
      },
    ];
    const pack = buildStrictChatGptSharePack(msgs, SYNTHETIC_EXPORT_MAPPINGS, {
      ...options, confirmedHumanReview: true,
    });
    expect(pack.files).toHaveLength(4);
    const serialized = pack.files.map((f) => f.content).join("\n");
    expect(serialized).toContain("PERSON_A");
    expect(serialized).toContain("DAY_0003");
    expect(serialized).not.toContain("synthetic-hidden-source-id");
    expect(serialized).not.toContain("sourceLine");
    expect(serialized).not.toContain("2026-01-03");
    for (const raw of SYNTHETIC_EXPORT_RAW_VALUES) expect(serialized).not.toContain(raw);
    inspectStrictSerializedFiles(pack.files, SYNTHETIC_EXPORT_RAW_VALUES);
  });

  it("preview is separate from explicit final human review", () => {
    const preview = previewStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS, options,
    );
    blocked(
      () => buildStrictChatGptSharePack(
        SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
        { ...options, confirmedHumanReview: false } as never,
      ),
      "manual_review_required",
    );
    const approved = buildStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
      { ...options, confirmedHumanReview: true },
    );
    expect(preview.files).toEqual(approved.files);
  });

  it("limits selection to bounded recent messages, not whole history by default", () => {
    const base = SYNTHETIC_EXPORT_MESSAGES[0];
    const msgs = Array.from({ length: 145 }, (_, n): ChatMessage => ({
      ...base, id: "faked-" + String(n).padStart(3, "0"),
      timestamp: Date.UTC(2026, 0, 1) + (144 - n) * 60_000,
    }));
    const limited = selectRecentStrictShareMessages(msgs, 25);
    expect(limited).toHaveLength(25);
    expect(limited[0].timestamp).toBe(Date.UTC(2026, 0, 1) + 120 * 60_000);
    expect(selectRecentStrictShareMessages(msgs, 100)).toHaveLength(100);
    expect(() => selectRecentStrictShareMessages(msgs, 145 as never)).toThrow(RangeError);
    blocked(() => previewStrictChatGptSharePack([], SYNTHETIC_EXPORT_MAPPINGS, options),
      "empty_selection");
  });
});
