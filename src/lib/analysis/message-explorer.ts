import type { ChatMessage, MessageType } from "@/lib/chat-types";
import {
  attachReplyGaps,
  type ChatMessageWithReplyGap,
} from "@/lib/analysis/reply-gaps";

export type MessageExplorerSort = "oldest" | "newest" | "reply-gap";

export type MessageExplorerFilters = {
  query: string;
  sender: string;
  type: MessageType | "all";
  dateFrom: string;
  dateTo: string;
  minReplyGapMs: number;
  sort: MessageExplorerSort;
};

export type ExplorerMessage = ChatMessageWithReplyGap;

export const DEFAULT_EXPLORER_FILTERS: MessageExplorerFilters = {
  query: "",
  sender: "all",
  type: "all",
  dateFrom: "",
  dateTo: "",
  minReplyGapMs: 0,
  sort: "oldest",
};

function parseLocalDateBoundary(value: string, endOfDay: boolean) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

export function prepareExplorerMessages(
  messages: readonly ChatMessage[],
): ExplorerMessage[] {
  return attachReplyGaps(messages);
}

export function filterAndSortExplorerMessages(
  messages: readonly ExplorerMessage[],
  filters: MessageExplorerFilters,
): ExplorerMessage[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const from = parseLocalDateBoundary(filters.dateFrom, false);
  const to = parseLocalDateBoundary(filters.dateTo, true);

  const filtered = messages.filter((message) => {
    if (
      query &&
      !message.content.toLocaleLowerCase().includes(query) &&
      !message.senderName.toLocaleLowerCase().includes(query)
    ) {
      return false;
    }
    if (
      filters.sender !== "all" &&
      message.senderName !== filters.sender &&
      message.senderId !== filters.sender
    ) {
      return false;
    }
    if (filters.type !== "all" && message.type !== filters.type) return false;
    if (from != null && message.timestamp < from) return false;
    if (to != null && message.timestamp > to) return false;
    if (
      filters.minReplyGapMs > 0 &&
      (message.replyGapMs == null || message.replyGapMs < filters.minReplyGapMs)
    ) {
      return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (filters.sort === "newest") {
      return b.timestamp - a.timestamp || b.id.localeCompare(a.id);
    }
    if (filters.sort === "reply-gap") {
      const gapA = a.replyGapMs ?? -1;
      const gapB = b.replyGapMs ?? -1;
      return gapB - gapA || b.timestamp - a.timestamp || b.id.localeCompare(a.id);
    }
    return a.timestamp - b.timestamp || a.id.localeCompare(b.id);
  });
}

export function explorerContextWindow(
  messages: readonly ExplorerMessage[],
  targetMessageId: string,
  radius: number,
): ExplorerMessage[] {
  const safeRadius = Math.max(0, Math.floor(radius));
  const sorted = [...messages].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  );
  const index = sorted.findIndex((message) => message.id === targetMessageId);
  if (index < 0) return [];
  return sorted.slice(
    Math.max(0, index - safeRadius),
    Math.min(sorted.length, index + safeRadius + 1),
  );
}
