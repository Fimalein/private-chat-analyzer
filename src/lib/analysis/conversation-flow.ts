import type { ChatMessage } from "@/lib/chat-types";

/** A time-bounded speaker change, not an inference about reading or intent. */
export type ObservedReply = {
  previousMessageId: string;
  messageId: string;
  senderId: string;
  gapMs: number;
  dayKey: string;
};

export type FlowSender = {
  id: string;
  name: string;
  samples: number;
  medianMs: number | null;
  p90Ms: number | null;
  conversationStarts: number;
};

export type FlowWeek = {
  key: string;
  bySender: Record<string, { samples: number; medianMs: number | null }>;
};

export type ConversationFlow = {
  senders: FlowSender[];
  replies: ObservedReply[];
  excludedLongSwitches: number;
  weeks: FlowWeek[];
  highlights: ObservedReply[];
  /** A 1:1 chat with enough valid timestamps, not proof of complete logs. */
  available: boolean;
};

export const MAX_REPLY_GAP_MS = 24 * 60 * 60 * 1000;
const WEEKS_DISPLAYED = 6;

function identity(message: ChatMessage) {
  return message.senderId || message.senderName;
}

function key(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function weekKey(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return key(date);
}

function quantile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * p;
  const lower = Math.floor(at);
  const upper = Math.ceil(at);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (at - lower);
}

function median(values: readonly number[]): number | null {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/**
 * Pure/local chronological metrics. Exclude system events and non-finite
 * timestamps. A different-speaker message within 24 hours is an observed
 * transition, NOT necessarily a reply to the preceding message.
 *
 * The cut-off reduces distortion by next-day conversation restarts, but it
 * does not correct for sleep, offline contact, missing exports or availability.
 */
export function deriveConversationFlow(messages: readonly ChatMessage[]): ConversationFlow {
  const sorted = messages
    .filter(m => m.type !== "system" && Number.isFinite(m.timestamp))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  const unique = [...new Map(sorted.map(m => [identity(m), m.senderName])).entries()];
  if (unique.length !== 2) {
    return { senders: [], replies: [], highlights: [], weeks: [], excludedLongSwitches: 0, available: false };
  }
  const starts = new Map<string, number>(unique.map(([id]) => [id, 0]));
  const responses = new Map<string, number[]>(unique.map(([id]) => [id, []]));
  const replies: ObservedReply[] = [];
  let excludedLongSwitches = 0;

  sorted.forEach((m, index) => {
    const currentId = identity(m);
    const prev = sorted[index - 1];
    if (!prev) {
      starts.set(currentId, (starts.get(currentId) ?? 0) + 1);
      return;
    }
    const gapMs = m.timestamp - prev.timestamp;
    if (gapMs > MAX_REPLY_GAP_MS) {
      starts.set(currentId, (starts.get(currentId) ?? 0) + 1);
      if (identity(prev) !== currentId) excludedLongSwitches += 1;
      return;
    }
    if (identity(prev) === currentId) return;
    const event = {
      previousMessageId: prev.id,
      messageId: m.id,
      senderId: currentId,
      gapMs,
      dayKey: key(new Date(m.timestamp)),
    };
    replies.push(event);
    responses.get(currentId)!.push(gapMs);
  });

  const senders: FlowSender[] = unique.map(([id, name]) => {
    const times = [...responses.get(id)!].sort((a, b) => a - b);
    return {
      id, name,
      samples: times.length,
      medianMs: quantile(times, 0.5),
      p90Ms: quantile(times, 0.9),
      conversationStarts: starts.get(id) ?? 0,
    };
  });
  const weeks: FlowWeek[] = [];
  const timestampById = new Map(sorted.map(m => [m.id, m.timestamp]));
  if (sorted.length) {
    const lastStart = new Date(weekKey(sorted.at(-1)!.timestamp) + "T12:00:00");
    const byWeek = new Map<string, Map<string, number[]>>();
    for (const e of replies) {
      const timestamp = timestampById.get(e.messageId);
      if (timestamp === undefined) continue;
      const week = weekKey(timestamp);
      if (!byWeek.has(week)) byWeek.set(week, new Map());
      const bucket = byWeek.get(week)!;
      if (!bucket.has(e.senderId)) bucket.set(e.senderId, []);
      bucket.get(e.senderId)!.push(e.gapMs);
    }
    for (let i = WEEKS_DISPLAYED - 1; i >= 0; i--) {
      const start = new Date(lastStart);
      start.setDate(start.getDate() - 7 * i);
      const dateKey = key(start);
      const bucket = byWeek.get(dateKey);
      weeks.push({
        key: dateKey,
        bySender: Object.fromEntries(senders.map(person => {
          const times = bucket?.get(person.id) ?? [];
          return [person.id, { samples: times.length, medianMs: median(times) }];
        })),
      });
    }
  }

  // These are navigation examples, not outliers or a diagnosis.
  const highlights = [...replies]
    .sort((a, b) => b.gapMs - a.gapMs || a.messageId.localeCompare(b.messageId))
    .slice(0, 3);
  return { senders, replies, highlights, weeks, excludedLongSwitches, available: true };
}
