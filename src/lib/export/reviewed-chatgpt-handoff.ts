import type { ChatMessage } from "@/lib/chat-types";
import type { EntityMapping } from "@/lib/privacy";
import {
  buildChatGptExportPack,
  type ChatGptExportDateMode,
  type ChatGptExportFile,
  type ChatGptExportPack,
} from "@/lib/export/chatgpt-pack";

export const STANDARD_HANDOFF_FILE_NAMES = [
  "chat_redacted.txt",
  "chat_redacted.jsonl",
  "analysis_index.json",
  "ChatGPT_analysis_instructions.txt",
] as const;

export type IntendedChatGptRecipient = "temporary" | "regular" | "other";

export type StandardHandoffPreview = {
  /** Local-only snapshot. It includes private input; never export or log it. */
  snapshot: string;
  files: ChatGptExportFile[];
};

export type StandardHandoffBlockedReason =
  | "preview_missing"
  | "preview_stale"
  | "file_review_incomplete"
  | "recipient_not_acknowledged"
  | "preview_changed";

export class StandardHandoffBlockedError extends Error {
  readonly reason: StandardHandoffBlockedReason;
  constructor(reason: StandardHandoffBlockedReason) {
    super("STANDARD_CHATGPT_HANDOFF_BLOCKED");
    this.name = "StandardHandoffBlockedError";
    this.reason = reason;
  }
}

/**
 * Compares the whole selected input, pseudonym mappings, date option, dashboard
 * and recipient, even when a changed input would produce the same output.
 * This raw JSON snapshot is strictly local, never put it in a file or log.
 */
export function standardHandoffSnapshot(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
  dateMode: ChatGptExportDateMode,
  recipient: IntendedChatGptRecipient,
  dashboardId: string,
): string {
  return JSON.stringify({
    dashboardId,
    recipient,
    dateMode,
    messages: rawMessages,
    mappings,
  });
}

export function previewStandardHandoff(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
  dateMode: ChatGptExportDateMode,
  recipient: IntendedChatGptRecipient,
  dashboardId: string,
): StandardHandoffPreview {
  const pack = buildChatGptExportPack(rawMessages, mappings, { dateMode });
  if (pack.files.length !== STANDARD_HANDOFF_FILE_NAMES.length ||
      pack.files.some((file, i) => file.name !== STANDARD_HANDOFF_FILE_NAMES[i])) {
    throw new StandardHandoffBlockedError("preview_changed");
  }
  return {
    snapshot: standardHandoffSnapshot(rawMessages, mappings, dateMode, recipient, dashboardId),
    files: pack.files.map(file => ({ ...file })),
  };
}

export function approveStandardHandoff(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
  dateMode: ChatGptExportDateMode,
  recipient: IntendedChatGptRecipient,
  dashboardId: string,
  preview: StandardHandoffPreview | null,
  reviewedFileNames: readonly string[],
  recipientAcknowledged: boolean,
): ChatGptExportPack {
  if (!preview) throw new StandardHandoffBlockedError("preview_missing");
  if (preview.snapshot !== standardHandoffSnapshot(rawMessages, mappings, dateMode, recipient, dashboardId)) {
    throw new StandardHandoffBlockedError("preview_stale");
  }
  if (!recipientAcknowledged) throw new StandardHandoffBlockedError("recipient_not_acknowledged");
  if (reviewedFileNames.length !== STANDARD_HANDOFF_FILE_NAMES.length ||
      !STANDARD_HANDOFF_FILE_NAMES.every(name => reviewedFileNames.includes(name))) {
    throw new StandardHandoffBlockedError("file_review_incomplete");
  }

  // Important: repeat the complete raw/structured/serialized safety scan at
  // handoff, rather than trusting the pack rendered earlier.
  const pack = buildChatGptExportPack(rawMessages, mappings, { dateMode });
  if (pack.files.length !== STANDARD_HANDOFF_FILE_NAMES.length ||
      pack.files.some((file, i) =>
        file.name !== STANDARD_HANDOFF_FILE_NAMES[i] ||
        preview.files[i]?.name !== file.name ||
        preview.files[i]?.type !== file.type ||
        preview.files[i]?.content !== file.content)) {
    throw new StandardHandoffBlockedError("preview_changed");
  }
  return pack;
}
