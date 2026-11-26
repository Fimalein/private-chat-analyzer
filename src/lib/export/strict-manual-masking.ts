import type { ChatMessage } from "@/lib/chat-types";

/** Explicit local-only human edits, never serialized as a source-to-replacement map. */
export type StrictMessageEdit =
  | { action: "omit" }
  | { action: "mask_all" }
  | { action: "mask_sentences"; indices: readonly number[] };

export type StrictMessageEdits = Readonly<Record<string, StrictMessageEdit>>;

export const STRICT_SENTENCE_PLACEHOLDER = "[REDACTED_SENTENCE]";
export const STRICT_MESSAGE_PLACEHOLDER = "[REDACTED_MESSAGE]";

/**
 * Preserve the original UTF-16 slices, punctuation and newline positions.
 * Punctuation is attached to its preceding text. Line separators are kept as
 * separate non-editable segments to avoid merging two formerly separate lines.
 * This is a mechanical splitter, NOT Japanese sentence understanding.
 */
export function strictReviewSegments(content: string): Array<{
  index: number;
  text: string;
  editable: boolean;
}> {
  const parts = content.match(/[^\r\n。！？!?]+[。！？!?]*|[。！？!?]+|\r\n|\r|\n/gu) ?? [];
  if (parts.join("") !== content) {
    throw new Error("STRICT_SENTENCE_SPLIT_FAILED");
  }
  return parts.map((text, index) => ({
    index,
    text,
    editable: !/^[\r\n]+$/u.test(text),
  }));
}

/** Applies explicit omissions or irreversible placeholder masks before export. */
export function applyStrictMessageEdits(
  messages: readonly ChatMessage[],
  edits: StrictMessageEdits,
): ChatMessage[] {
  const output: ChatMessage[] = [];
  for (const message of messages) {
    // Imported IDs are untrusted: avoid inherited properties on object maps.
    const edit = Object.hasOwn(edits, message.id) ? edits[message.id] : undefined;
    if (!edit) {
      output.push({ ...message });
      continue;
    }
    if (edit.action === "omit") continue;
    if (edit.action === "mask_all") {
      output.push({ ...message, content: STRICT_MESSAGE_PLACEHOLDER });
      continue;
    }
    if (edit.action !== "mask_sentences" || !Array.isArray(edit.indices)) {
      throw new RangeError("invalid strict message edit");
    }
    const segments = strictReviewSegments(message.content);
    const mask = new Set(edit.indices);
    if ([...mask].some((index) =>
      !Number.isSafeInteger(index) || index < 0 || index >= segments.length ||
      !segments[index].editable)) {
      throw new RangeError("invalid strict sentence index");
    }
    output.push({
      ...message,
      content: segments.map((part) => mask.has(part.index)
        ? STRICT_SENTENCE_PLACEHOLDER : part.text).join(""),
    });
  }
  return output;
}
