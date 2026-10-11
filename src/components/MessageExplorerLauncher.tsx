"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useChat } from "@/components/ChatProvider";
import { useLocale } from "@/components/LocaleProvider";
import { formatDuration } from "@/lib/analyze";
import type { ChatMessage, MessageType } from "@/lib/chat-types";
import {
  DEFAULT_EXPLORER_FILTERS,
  explorerContextWindow,
  filterAndSortExplorerMessages,
  prepareExplorerMessages,
  type MessageExplorerFilters,
} from "@/lib/analysis/message-explorer";
import { pseudonymizeMessages } from "@/lib/privacy";

const PAGE_SIZE = 100;
const HOUR = 60 * 60 * 1000;

function formatTimestamp(timestamp: number, locale: "zh" | "en") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function typeLabel(type: MessageType, locale: "zh" | "en") {
  const labels: Record<MessageType, [string, string]> = {
    text: ["文字", "Text"],
    sticker: ["貼圖", "Sticker"],
    image: ["照片", "Photo"],
    video: ["影片", "Video"],
    call: ["通話", "Call"],
    system: ["系統", "System"],
  };
  return labels[type][locale === "en" ? 1 : 0];
}

function messageText(message: ChatMessage) {
  if (message.type === "call" && message.callDurationMs != null) {
    return `${message.content} (${formatDuration(message.callDurationMs)})`;
  }
  return message.content || `[${message.type}]`;
}

function ExplorerPanel({
  messages,
  locale,
  onClose,
}: {
  messages: ChatMessage[];
  locale: "zh" | "en";
  onClose: () => void;
}) {
  const [filters, setFilters] = useState<MessageExplorerFilters>(
    DEFAULT_EXPLORER_FILTERS,
  );
  const [page, setPage] = useState(0);
  const [context, setContext] = useState<{
    targetId: string;
    radius: 20 | 50;
  } | null>(null);
  const deferredQuery = useDeferredValue(filters.query);

  const prepared = useMemo(() => prepareExplorerMessages(messages), [messages]);
  const senders = useMemo(
    () => [...new Set(prepared.map((message) => message.senderName))].sort(),
    [prepared],
  );
  const results = useMemo(
    () =>
      filterAndSortExplorerMessages(prepared, {
        ...filters,
        query: deferredQuery,
      }),
    [deferredQuery, filters, prepared],
  );
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = context
    ? explorerContextWindow(prepared, context.targetId, context.radius)
    : results.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function patchFilters(patch: Partial<MessageExplorerFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(0);
    setContext(null);
  }

  const text =
    locale === "en"
      ? {
          title: "Message explorer",
          local: "Filters run locally in this browser.",
          search: "Search messages or sender",
          allSenders: "All senders",
          allTypes: "All types",
          replyGap: "Reply gap",
          anyGap: "Any gap",
          sort: "Sort",
          oldest: "Oldest first",
          newest: "Newest first",
          gapSort: "Longest reply gap",
          from: "From",
          to: "To",
          clear: "Clear",
          results: "results",
          context: "Context",
          back: "Back to results",
          previous: "Previous",
          next: "Next",
          close: "Close",
          noResults: "No messages match these filters.",
          gap: "gap",
        }
      : {
          title: "訊息搜尋",
          local: "所有篩選都只在這個瀏覽器內執行。",
          search: "搜尋訊息或傳送者",
          allSenders: "所有傳送者",
          allTypes: "所有類型",
          replyGap: "回覆間隔",
          anyGap: "不限",
          sort: "排序",
          oldest: "舊到新",
          newest: "新到舊",
          gapSort: "回覆間隔最長",
          from: "開始日期",
          to: "結束日期",
          clear: "清除",
          results: "筆結果",
          context: "前後文",
          back: "返回搜尋結果",
          previous: "上一頁",
          next: "下一頁",
          close: "關閉",
          noResults: "沒有符合條件的訊息。",
          gap: "間隔",
        };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/25"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-card-border bg-[#faf8fc] shadow-2xl sm:inset-y-4 sm:right-4 sm:rounded-2xl sm:border">
        <header className="flex items-start justify-between gap-4 border-b border-card-border bg-white px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-serif text-lg font-bold text-accent-deep sm:text-xl">
              {text.title}
            </h2>
            <p className="mt-0.5 text-xs text-muted">{text.local}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-card-border px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent-deep"
          >
            {text.close}
          </button>
        </header>

        <div className="border-b border-card-border bg-white p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={filters.query}
              onChange={(event) => patchFilters({ query: event.target.value })}
              placeholder={text.search}
              className="sm:col-span-2 rounded-xl border border-card-border bg-white px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <select
              value={filters.sender}
              onChange={(event) => patchFilters({ sender: event.target.value })}
              className="rounded-xl border border-card-border bg-white px-3 py-2 text-sm"
            >
              <option value="all">{text.allSenders}</option>
              {senders.map((sender) => (
                <option key={sender} value={sender}>
                  {sender}
                </option>
              ))}
            </select>
            <select
              value={filters.type}
              onChange={(event) =>
                patchFilters({
                  type: event.target.value as MessageExplorerFilters["type"],
                })
              }
              className="rounded-xl border border-card-border bg-white px-3 py-2 text-sm"
            >
              <option value="all">{text.allTypes}</option>
              {(["text", "sticker", "image", "video", "call", "system"] as MessageType[]).map(
                (type) => (
                  <option key={type} value={type}>
                    {typeLabel(type, locale)}
                  </option>
                ),
              )}
            </select>
            <label className="flex items-center gap-2 rounded-xl border border-card-border bg-white px-3 py-2 text-xs text-muted">
              <span className="shrink-0">{text.from}</span>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(event) => patchFilters({ dateFrom: event.target.value })}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-card-border bg-white px-3 py-2 text-xs text-muted">
              <span className="shrink-0">{text.to}</span>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(event) => patchFilters({ dateTo: event.target.value })}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-card-border bg-white px-3 py-2 text-xs text-muted">
              <span>{text.replyGap}</span>
              <select
                value={filters.minReplyGapMs}
                onChange={(event) =>
                  patchFilters({ minReplyGapMs: Number(event.target.value) })
                }
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground"
              >
                <option value={0}>{text.anyGap}</option>
                <option value={HOUR}>1h+</option>
                <option value={6 * HOUR}>6h+</option>
                <option value={24 * HOUR}>24h+</option>
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-card-border bg-white px-3 py-2 text-xs text-muted">
              <span>{text.sort}</span>
              <select
                value={filters.sort}
                onChange={(event) =>
                  patchFilters({
                    sort: event.target.value as MessageExplorerFilters["sort"],
                  })
                }
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground"
              >
                <option value="oldest">{text.oldest}</option>
                <option value="newest">{text.newest}</option>
                <option value="reply-gap">{text.gapSort}</option>
              </select>
            </label>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
            <span>{results.length.toLocaleString()} {text.results}</span>
            <button
              type="button"
              onClick={() => {
                setFilters(DEFAULT_EXPLORER_FILTERS);
                setPage(0);
                setContext(null);
              }}
              className="rounded-full px-2.5 py-1 hover:bg-accent/10 hover:text-accent-deep"
            >
              {text.clear}
            </button>
          </div>
        </div>

        {context ? (
          <div className="flex items-center justify-between gap-3 border-b border-card-border bg-accent/10 px-4 py-2 text-xs text-accent-deep">
            <span>{text.context} ±{context.radius}</span>
            <button type="button" className="font-medium underline" onClick={() => setContext(null)}>
              {text.back}
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">{text.noResults}</p>
          ) : (
            <ol className="space-y-2">
              {visible.map((message) => {
                const isTarget = context?.targetId === message.id;
                return (
                  <li
                    key={message.id}
                    className={`rounded-xl border bg-white p-3 ${
                      isTarget ? "border-accent ring-2 ring-accent/20" : "border-card-border"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                      <strong className="text-xs text-accent-deep">{message.senderName}</strong>
                      <span>{formatTimestamp(message.timestamp, locale)}</span>
                      <span>{typeLabel(message.type, locale)}</span>
                      {message.replyGapMs != null ? (
                        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent-deep">
                          {text.gap} {formatDuration(message.replyGapMs)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-5 text-foreground">
                      {messageText(message)}
                    </p>
                    {!context ? (
                      <div className="mt-2 flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setContext({ targetId: message.id, radius: 20 })}
                          className="rounded-full border border-card-border px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-accent-deep"
                        >
                          ±20
                        </button>
                        <button
                          type="button"
                          onClick={() => setContext({ targetId: message.id, radius: 50 })}
                          className="rounded-full border border-card-border px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-accent-deep"
                        >
                          ±50
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {!context && results.length > PAGE_SIZE ? (
          <footer className="flex items-center justify-between gap-3 border-t border-card-border bg-white px-4 py-3 text-sm">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="rounded-full border border-card-border px-3 py-1.5 text-muted disabled:opacity-40"
            >
              {text.previous}
            </button>
            <span className="text-xs text-muted">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              className="rounded-full border border-card-border px-3 py-1.5 text-muted disabled:opacity-40"
            >
              {text.next}
            </button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

export function MessageExplorerLauncher() {
  const { dashboards, activeId, activePrivacyMappings } = useChat();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const active = dashboards.find((board) => board.id === activeId);
  const messages = useMemo(
    () =>
      active?.messages.length
        ? pseudonymizeMessages(active.messages, activePrivacyMappings)
        : [],
    [active?.messages, activePrivacyMappings],
  );

  if (!active || active.kind === "default" || messages.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 rounded-full bg-accent-deep px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-accent-dim"
      >
        {locale === "en" ? "Explore messages" : "搜尋訊息"}
      </button>
      {open ? (
        <ExplorerPanel
          key={active.id}
          messages={messages}
          locale={locale}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
