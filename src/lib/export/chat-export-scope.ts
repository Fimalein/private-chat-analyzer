import type { ChatMessage } from "@/lib/chat-types";

export const RECENT_EXPORT_COUNTS = [25, 100, 500, 2000] as const;
export type RecentExportCount = typeof RECENT_EXPORT_COUNTS[number];

/**
 * Explicitly selected subset of a private transcript. No implicit "all".
 * Date labels are interpreted in the *local browser timezone*.
 */
export type ChatExportScope =
  | { mode: "recent"; count: RecentExportCount }
  | { mode: "dates"; startDate: string; endDate: string }
  | { mode: "all" };

export class InvalidChatExportScopeError extends Error {
  constructor() {
    super("INVALID_CHAT_EXPORT_SCOPE");
    this.name = "InvalidChatExportScopeError";
  }
}

function localDayStart(day: string): number {
  if (!/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(day)) throw new InvalidChatExportScopeError();
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(year, month - 1, date);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== date) {
    throw new InvalidChatExportScopeError();
  }
  return parsed.getTime();
}

/** Select only the specified portion, sorted by time and stable imported ID. */
export function selectChatExportScope(
  messages: readonly ChatMessage[],
  scope: ChatExportScope,
): ChatMessage[] {
  if (!scope || !Array.isArray(messages) || messages.length === 0) {
    throw new InvalidChatExportScopeError();
  }
  const sorted = [...messages].sort((a, b) =>
    a.timestamp - b.timestamp || a.id.localeCompare(b.id));

  let chosen: ChatMessage[];
  if (scope.mode === "recent") {
    if (!RECENT_EXPORT_COUNTS.includes(scope.count)) throw new InvalidChatExportScopeError();
    chosen = sorted.slice(-scope.count);
  } else if (scope.mode === "dates") {
    const start = localDayStart(scope.startDate);
    const endStart = localDayStart(scope.endDate);
    if (endStart < start) throw new InvalidChatExportScopeError();
    const endDate = new Date(endStart);
    endDate.setDate(endDate.getDate() + 1); // DST-safe inclusive calendar end
    const endExclusive = endDate.getTime();
    chosen = sorted.filter(m => m.timestamp >= start && m.timestamp < endExclusive);
  } else if (scope.mode === "all") {
    chosen = sorted;
  } else {
    throw new InvalidChatExportScopeError();
  }
  if (!chosen.length) throw new InvalidChatExportScopeError();
  return chosen;
}

/**
 * Does not leave the device, and deliberately includes the complete imported
 * source to invalidate a previous review when *any* source message changes.
 * The selected scope and actual approved files are separately compared.
 */
export function localHandoffContextId(
  dashboardId: string,
  allMessages: readonly ChatMessage[],
  scope: ChatExportScope,
): string {
  return JSON.stringify({ dashboardId, allMessages, scope });
}
