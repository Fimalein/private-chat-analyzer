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
import {
  ANALYSIS_SIGNAL_KINDS,
  type AnalysisSignalKind,
} from "@/lib/analysis/analysis-signals";
import { pseudonymizeMessages } from "@/lib/privacy";

const PAGE_SIZE = 100;
const HOUR = 60 * 60 * 1000;

function formatTimestamp(timestamp: number, locale: "zh" | "en" | "ja") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : locale === "ja" ? "ja-JP" : "zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function typeLabel(type: MessageType, locale: "zh" | "en" | "ja") {
  const labels: Record<MessageType, [string, string, string]> = {
    text: ["文字", "Text", "テキスト" ],
    sticker: ["貼圖", "Sticker", "スタンプ" ],
    image: ["照片", "Photo", "写真" ],
    video: ["影片", "Video", "動画" ],
    call: ["通話", "Call", "通話" ],
    system: ["系統", "System", "システム" ],
  };
  return labels[type][locale === "ja" ? 2 : locale === "en" ? 1 : 0];
}

function signalLabel(signal: AnalysisSignalKind, locale: "zh" | "en" | "ja") {
  const labels: Record<AnalysisSignalKind, [string, string, string]> = {
    conflict: ["衝突候選", "Conflict candidate", "衝突の可能性" ],
    repair: ["修復候選", "Repair candidate", "関係修復の可能性" ],
    person_attack: ["人身攻擊候選", "Person-attack candidate", "人格攻撃の可能性" ],
    distance_breakup: ["疏離 / 分手候選", "Distance / breakup candidate", "距離を置く／別れの可能性" ],
  };
  return labels[signal][locale === "ja" ? 2 : locale === "en" ? 1 : 0];
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
  locale: "zh" | "en" | "ja";
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
    locale === "ja"
      ? {
          title: "メッセージ検索",
          local: "検索条件と分析候補の抽出は端末内で行います。",
          search: "メッセージまたは送信者を検索",
          allSenders: "すべての送信者",
          allTypes: "すべての種類",
          replyGap: "返信までの間隔",
          anyGap: "指定なし",
          signal: "分析候補",
          anySignal: "すべて",
          signalDisclaimer: "分析候補は単純なヒューリスティックによる目印です。意図・攻撃性・関係性についての確定的な判定ではありません。",
          sort: "並び順",
          oldest: "古い順",
          newest: "新しい順",
          gapSort: "返信間隔が長い順",
          from: "開始日",
          to: "終了日",
          clear: "クリア",
          results: "件",
          context: "前後の会話",
          back: "検索結果に戻る",
          previous: "前へ",
          next: "次へ",
          close: "閉じる",
          noResults: "条件に一致するメッセージはありません。",
          gap: "間隔",
        }
      : locale === "en"
      ? {
          title: "Message explorer",
          local: "Filters and candidate signals run locally in this browser.",
          search: "Search messages or sender",
          allSenders: "All senders",
          allTypes: "All types",
          replyGap: "Reply gap",
          anyGap: "Any gap",
          signal: "Analysis signal",
          anySignal: "Any signal",
          signalDisclaimer:
            "Signal flags are simple heuristic navigation candidates, not truth labels about intent, abuse, or relationship state.",
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
          local: "所有篩選與候選訊號都只在這個瀏覽器內執行。",
          search: "搜尋訊息或傳送者",
          allSenders: "所有傳送者",
          allTypes: "所有類型",
          replyGap: "回覆間隔",
          anyGap: "不限",
          signal: "分析候選",
          anySignal: "不限候選",
          signalDisclaimer:
            "候選訊號只是簡單的啟發式導覽，不代表對意圖、攻擊或關係狀態的事實判定。",
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
              <span>{text.signal}</span>
              <select
                value={filters.signal}
                onChange={(event) =>
                  patchFilters({
                    signal: event.target.value as MessageExplorerFilters["signal"],
                  })
                }
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground"
              >
                <option value="all">{text.anySignal}</option>
                {ANALYSIS_SIGNAL_KINDS.map((signal) => (
                  <option key={signal} value={signal}>
                    {signalLabel(signal, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-card-border bg-white px-3 py-2 text-xs text-muted sm:col-span-2">
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
          <p className="mt-2 text-[11px] leading-5 text-muted">{text.signalDisclaimer}</p>
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
                      {message.analysisSignals.map((signal) => (
                        <span
                          key={signal}
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800"
                        >
                          {signalLabel(signal, locale)}
                        </span>
                      ))}
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
        {locale === "ja" ? "メッセージ検索" : locale === "en" ? "Explore messages" : "搜尋訊息"}
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
