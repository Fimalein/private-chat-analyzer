import type { ChatMessage } from "@/lib/chat-types";

export type ReplyGap = {
  previousMessageId: string;
  messageId: string;
  fromSenderId: string;
  toSenderId: string;
  gapMs: number;
};

export type ChatMessageWithReplyGap = ChatMessage & {
  replyGapMs?: number;
};

function senderKey(message: ChatMessage) {
  return message.senderId || message.senderName;
}

/**
 * Derive reply gaps from a time-sorted copy of the input.
 *
 * Only the first message after the speaker changes gets a reply gap. Consecutive
 * messages from the same speaker are treated as one burst and are not reported
 * as separate replies.
 */
export function deriveReplyGaps(
  messages: readonly ChatMessage[],
): ReplyGap[] {
  const sorted = [...messages].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  );
  const gaps: ReplyGap[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const fromSenderId = senderKey(previous);
    const toSenderId = senderKey(current);

    if (fromSenderId === toSenderId) continue;

    const gapMs = current.timestamp - previous.timestamp;
    if (gapMs < 0) continue;

    gaps.push({
      previousMessageId: previous.id,
      messageId: current.id,
      fromSenderId,
      toSenderId,
      gapMs,
    });
  }

  return gaps;
}

/**
 * Return a derived copy suitable for filtering/sorting without mutating the raw
 * transcript. Message order is preserved from the caller's input.
 */
export function attachReplyGaps(
  messages: readonly ChatMessage[],
): ChatMessageWithReplyGap[] {
  const gapByMessageId = new Map(
    deriveReplyGaps(messages).map((gap) => [gap.messageId, gap.gapMs]),
  );

  return messages.map((message) => {
    const replyGapMs = gapByMessageId.get(message.id);
    return replyGapMs == null ? { ...message } : { ...message, replyGapMs };
  });
}

export function hasReplyGapAtLeast(
  message: ChatMessageWithReplyGap,
  thresholdMs: number,
) {
  return message.replyGapMs != null && message.replyGapMs >= thresholdMs;
}
