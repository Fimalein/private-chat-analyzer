"use client";

import { useMemo } from "react";
import type { ChatMessage } from "@/lib/chat-types";
import {
  deriveConversationFlow,
  MAX_REPLY_GAP_MS,
} from "@/lib/analysis/conversation-flow";

type Locale = "ja" | "en" | "zh";
type Props = {
  messages: readonly ChatMessage[];
  locale: Locale;
  anonymous: boolean;
  usernameA: string | null;
  usernameB: string | null;
  onJumpDay: (dayKey: string) => void;
};

const COPY = {
  ja: {
    title: "会話の往復と返信の傾向",
    desc: "発言者が交代した場合のみ計測。24時間超の間隔は別の会話開始として扱います。",
    warning: "返信の速さは好意・責任・思いやりを示す指標ではありません。睡眠、仕事、別アプリ、履歴の欠落は考慮できません。",
    noData: "2人の会話が読み込まれたときに表示します。",
    samples: "応答の観測件数",
    median: "中央値",
    p90: "90パーセンタイル",
    restarts: "会話開始（初回＋24時間超の空白後）",
    week: "週の開始日",
    recent: "直近6週間の応答中央値",
    sparse: "週の中央値は3件以上ある場合のみ表示（括弧内は件数）。",
    examples: "間隔が長い応答の例",
    jump: "この日の会話を確認",
    excluded: "24時間超の交代は応答時間の集計から除外",
    you: "自分",
    other: "相手",
    a: "人物A",
    b: "人物B",
    notAvailable: "—",
  },
  en: {
    title: "Conversation turns and response timing",
    desc: "Counts only changes of speaker; gaps over 24 hours count as new conversation starts.",
    warning: "Timing is not evidence of care, blame or intent. Sleep, work, other channels and missing history are not modeled.",
    noData: "Available for imported conversations between two speakers.",
    samples: "Observed switches",
    median: "Median",
    p90: "90th percentile",
    restarts: "Starts (first + gaps over 24h)",
    week: "Week beginning",
    recent: "Last six weeks: median switch interval",
    sparse: "Weekly medians require at least three samples (counts in parentheses).",
    examples: "Examples of longer observed intervals",
    jump: "View this day's messages",
    excluded: "Changes after 24h excluded from response timing",
    you: "Me",
    other: "Other",
    a: "Person A",
    b: "Person B",
    notAvailable: "—",
  },
  zh: {
    title: "對話往返與回覆間隔",
    desc: "只計算不同發話者之間的交替；超過24小時視為新對話開始。",
    warning: "時間間隔不能代表關心、責任或意圖。睡眠、工作、其他平台及缺失對話未納入考量。",
    noData: "匯入雙人對話後顯示。",
    samples: "交替樣本",
    median: "中位數",
    p90: "第90百分位",
    restarts: "對話開始（首則及逾24小時間隔後）",
    week: "每週起始",
    recent: "最近6週：交替間隔中位數",
    sparse: "每週需至少3個樣本才顯示中位數（括號為件數）。",
    examples: "較長交替間隔的例子",
    jump: "查看當日訊息",
    excluded: "逾24小時的交替不計入間隔統計",
    you: "自己",
    other: "對方",
    a: "人物A",
    b: "人物B",
    notAvailable: "—",
  },
} as const;

function duration(ms: number | null, locale: Locale) {
  if (ms == null) return "—";
  if (ms < 60 * 1000) {
    const seconds = Math.round(ms / 1000);
    return locale === "ja" ? `${seconds}秒` : locale === "zh" ? `${seconds}秒` : `${seconds}s`;
  }
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) {
    return locale === "en" ? `${minutes}m` : locale === "ja" ? `${minutes}分` : `${minutes}分鐘`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return locale === "en" ? `${h}h ${m}m` : locale === "ja" ? `${h}時間${m}分` : `${h}小時${m}分`;
}

export function ConversationFlowCard({
  messages, locale, anonymous, usernameA, usernameB, onJumpDay,
}: Props) {
  const flow = useMemo(() => deriveConversationFlow(messages), [messages]);
  const copy = COPY[locale];
  const numbers = locale === "en" ? "en-US" : locale === "zh" ? "zh-TW" : "ja-JP";
  const displayName = (sender: { id: string; name: string }, index: number) => {
    if (!anonymous) return sender.name;
    if (sender.name === usernameA || sender.id === usernameA) return copy.you;
    if (sender.name === usernameB || sender.id === usernameB) return copy.other;
    return index === 0 ? copy.a : copy.b;
  };

  return (
    <section aria-label={copy.title} className="mt-3 rounded-2xl border border-card-border bg-card p-4 sm:mt-4 sm:p-5">
      <h2 className="font-serif text-lg font-bold text-accent-deep sm:text-xl">{copy.title}</h2>
      <p className="mt-1 text-xs leading-5 text-muted">{copy.desc}</p>
      {!flow.available ? (
        <p className="mt-4 text-sm text-muted">{copy.noData}</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {flow.senders.map((person, i) => (
              <div key={person.id} className="min-w-0 rounded-xl border border-card-border bg-[#faf8fc] p-3.5">
                <h3 className="truncate text-sm font-semibold text-accent-deep" title={anonymous ? undefined : person.name}>{displayName(person, i)}</h3>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
                  <div>
                    <p className="text-[11px] text-muted">{copy.median}</p>
                    <p className="text-lg font-bold tabular-nums">{duration(person.medianMs, locale)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted">{copy.p90}</p>
                    <p className="text-lg font-bold tabular-nums">{duration(person.p90Ms, locale)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted">{copy.samples}</p>
                    <p className="text-base font-semibold tabular-nums">{person.samples.toLocaleString(numbers)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted">{copy.restarts}</p>
                    <p className="text-base font-semibold tabular-nums">{person.conversationStarts.toLocaleString(numbers)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">{copy.excluded}: {flow.excludedLongSwitches.toLocaleString(numbers)} ({MAX_REPLY_GAP_MS / 3600000}h)</p>
          <h3 className="mt-5 text-sm font-semibold text-accent-deep">{copy.recent}</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[390px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-card-border text-muted">
                  <th scope="col" className="p-2 font-medium">{copy.week}</th>
                  {flow.senders.map((person, i) => (
                    <th key={person.id} scope="col" className="p-2 font-medium">{displayName(person, i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flow.weeks.map((week) => (
                  <tr key={week.key} className="border-b border-card-border/50 last:border-0">
                    <th scope="row" className="p-2 font-normal tabular-nums text-muted">{week.key}</th>
                    {flow.senders.map(person => {
                      const entry = week.bySender[person.id];
                      return <td key={person.id} className="p-2 tabular-nums">{entry.samples >= 3 ? duration(entry.medianMs, locale) : copy.notAvailable} <span className="text-muted">({entry.samples})</span></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-muted">{copy.sparse}</p>
          {flow.highlights.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold text-accent-deep">{copy.examples}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {flow.highlights.map(event => (
                  <button key={event.messageId} type="button" onClick={() => onJumpDay(event.dayKey)}
                    className="rounded-lg border border-card-border bg-white px-3 py-2 text-left text-xs transition hover:border-accent hover:text-accent-deep"
                    title={copy.jump}>
                    <span className="font-semibold tabular-nums">{event.dayKey}</span>
                    <span className="ml-2 tabular-nums text-muted">{duration(event.gapMs, locale)}</span>
                    <span className="ml-1" aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <p className="mt-4 border-t border-card-border pt-3 text-xs leading-5 text-muted">{copy.warning}</p>
    </section>
  );
}
