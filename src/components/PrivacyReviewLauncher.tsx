"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useLocale } from "@/components/LocaleProvider";
import type { ChatMessage } from "@/lib/chat-types";
import {
  nextStructuredPiiReplacement,
  rawValuesForDetection,
  redactPlaceholder,
  reviewSummary,
  sampleContextsForDetection,
  scanStructuredPii,
  type PrivacyReviewAction,
  type StructuredPiiDetection,
  type StructuredPiiKind,
} from "@/lib/privacy";

const KIND_LABELS: Record<StructuredPiiKind, [string, string]> = {
  credential: ["憑證 / Token", "Credential / token"],
  email: ["電子郵件", "Email"],
  phone: ["電話番号", "Phone"],
  url: ["URL", "URL"],
  ipv4: ["IPv4", "IPv4"],
  postal_code: ["郵遞區號", "Postal code"],
  long_numeric_id: ["長數字 ID", "Long numeric ID"],
};

type ReviewFilter = "all" | "unreviewed" | "reviewed" | "high";

function formatTimestamp(timestamp: number, locale: "zh" | "en") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function PrivacyReviewPanel({
  dashboardId,
  messages,
  onClose,
}: {
  dashboardId: string;
  messages: ChatMessage[];
  onClose: () => void;
}) {
  const {
    activePrivacyMappings,
    activePrivacyReviewDecisions,
    upsertPrivacyMapping,
    removePrivacyMapping,
    setPrivacyReviewDecision,
    removePrivacyReviewDecision,
  } = useChat();
  const { locale } = useLocale();
  const [filter, setFilter] = useState<ReviewFilter>("unreviewed");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const detections = useMemo(() => scanStructuredPii(messages), [messages]);
  const summary = reviewSummary(detections, activePrivacyReviewDecisions);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const text = locale === "en"
    ? {
        title: "Privacy review",
        local: "Candidates and sample context stay in this browser.",
        close: "Close",
        unique: "Unique",
        unreviewed: "Unreviewed",
        reviewed: "Reviewed",
        high: "High-risk unresolved",
        occurrences: "occurrences",
        variants: "raw variants",
        samples: "Show samples",
        hideSamples: "Hide samples",
        field: "field",
        pseudonymize: "Pseudonymize",
        redact: "Redact",
        ignore: "Keep / ignore",
        undo: "Undo decision",
        replacement: "replacement",
        noItems: "No candidates in this view.",
        rawWarning: "Raw local values are shown only so you can decide how to handle them.",
        reviewedAs: "Reviewed as",
        pseudonymized: "pseudonymized",
        redacted: "redacted",
        ignored: "kept / ignored",
        note: "Ignore means reviewed, not removed. Export must rescan transformed output before sharing.",
      }
    : {
        title: "隱私檢查",
        local: "候選值與前後文只在此瀏覽器內處理。",
        close: "關閉",
        unique: "唯一候選",
        unreviewed: "未確認",
        reviewed: "已確認",
        high: "高風險未確認",
        occurrences: "次出現",
        variants: "種原始表記",
        samples: "顯示前後文",
        hideSamples: "隱藏前後文",
        field: "欄位",
        pseudonymize: "假名化",
        redact: "遮蔽",
        ignore: "保留 / 忽略",
        undo: "取消判定",
        replacement: "替換為",
        noItems: "這個分類目前沒有候選。",
        rawWarning: "下方顯示的是本機原始值，僅用於讓你判斷如何處理。",
        reviewedAs: "已處理為",
        pseudonymized: "假名化",
        redacted: "遮蔽",
        ignored: "保留 / 忽略",
        note: "忽略只代表已檢查，不代表已刪除；匯出前仍必須重新掃描輸出。",
      };

  const visible = detections.filter((item) => {
    const reviewed = Boolean(activePrivacyReviewDecisions[item.id]);
    if (filter === "all") return true;
    if (filter === "reviewed") return reviewed;
    if (filter === "high") return item.severity === "high" && !reviewed;
    return !reviewed;
  });

  function decisionLabel(action: PrivacyReviewAction) {
    if (action === "pseudonymize") return text.pseudonymized;
    if (action === "redact") return text.redacted;
    return text.ignored;
  }

  function removeMappings(detection: StructuredPiiDetection) {
    for (const rawValue of rawValuesForDetection(detection, messages)) {
      removePrivacyMapping(dashboardId, rawValue);
    }
  }

  function applyDecision(detection: StructuredPiiDetection, action: PrivacyReviewAction) {
    const rawValues = rawValuesForDetection(detection, messages);
    const existing = activePrivacyReviewDecisions[detection.id];
    if (existing?.action !== "ignore") removeMappings(detection);

    let replacement: string | undefined;
    if (action === "pseudonymize") {
      const rawSet = new Set(rawValues);
      const occupied = [
        ...activePrivacyMappings
          .filter((mapping) => !rawSet.has(mapping.source))
          .map((mapping) => mapping.replacement),
        ...Object.values(activePrivacyReviewDecisions)
          .filter((decision) => decision.detectionId !== detection.id)
          .flatMap((decision) => decision.replacement ? [decision.replacement] : []),
      ];
      replacement = nextStructuredPiiReplacement(detection.kind, occupied);
    } else if (action === "redact") {
      replacement = redactPlaceholder(detection.kind);
    }

    if (replacement) {
      for (const rawValue of rawValues) {
        upsertPrivacyMapping(dashboardId, {
          source: rawValue,
          replacement,
          kind: "secret",
        });
      }
    } else {
      removeMappings(detection);
    }

    setPrivacyReviewDecision(dashboardId, {
      detectionId: detection.id,
      action,
      replacement,
    });
  }

  function undoDecision(detection: StructuredPiiDetection) {
    const existing = activePrivacyReviewDecisions[detection.id];
    if (existing?.action !== "ignore") removeMappings(detection);
    removePrivacyReviewDecision(dashboardId, detection.id);
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/25"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-card-border bg-[#faf8fc] shadow-2xl sm:inset-y-4 sm:right-4 sm:rounded-2xl sm:border">
        <header className="flex items-start justify-between gap-4 border-b border-card-border bg-white px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-serif text-lg font-bold text-accent-deep sm:text-xl">{text.title}</h2>
            <p className="mt-0.5 text-xs text-muted">{text.local}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-card-border px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent-deep">
            {text.close}
          </button>
        </header>

        <div className="border-b border-card-border bg-white p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ["all", summary.total, text.unique],
              ["unreviewed", summary.unreviewed, text.unreviewed],
              ["reviewed", summary.reviewed, text.reviewed],
              ["high", summary.unresolvedHigh, text.high],
            ] as const).map(([key, count, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-xl border p-2 text-left ${filter === key ? "border-accent bg-accent/10" : "border-card-border"}`}
              >
                <span className={`block text-lg font-bold ${key === "high" ? "text-rose-600" : "text-accent-deep"}`}>{count}</span>
                <span className="text-[11px] text-muted">{label}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">{text.note}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">{text.noItems}</p>
          ) : (
            <ol className="space-y-3">
              {visible.map((detection) => {
                const decision = activePrivacyReviewDecisions[detection.id];
                const expanded = expandedId === detection.id;
                const rawValues = rawValuesForDetection(detection, messages);
                const samples = expanded ? sampleContextsForDetection(detection, messages, 3) : [];
                return (
                  <li key={detection.id} className="rounded-2xl border border-card-border bg-white p-3 sm:p-4">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent-deep">
                        {KIND_LABELS[detection.kind][locale === "en" ? 1 : 0]}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${detection.severity === "high" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                        {detection.severity.toUpperCase()}
                      </span>
                      <span className="text-muted">{detection.occurrenceCount.toLocaleString()} {text.occurrences}</span>
                      {rawValues.length > 1 ? <span className="text-muted">{rawValues.length} {text.variants}</span> : null}
                    </div>

                    <p className="mt-2 text-[11px] text-muted">{text.rawWarning}</p>
                    <div className="mt-1 max-h-28 space-y-1 overflow-auto rounded-lg bg-[#f5f1f8] px-2.5 py-2">
                      {rawValues.map((rawValue) => <code key={rawValue} className="block break-all text-xs text-foreground">{rawValue}</code>)}
                    </div>

                    {decision ? (
                      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>{text.reviewedAs}: <strong>{decisionLabel(decision.action)}</strong>{decision.replacement ? <> · {text.replacement} <code>{decision.replacement}</code></> : null}</span>
                          <button type="button" onClick={() => undoDecision(detection)} className="rounded-full border border-emerald-300 px-2.5 py-1 font-medium hover:bg-white">{text.undo}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => applyDecision(detection, "pseudonymize")} className="rounded-full bg-accent-deep px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-dim">{text.pseudonymize}</button>
                        <button type="button" onClick={() => applyDecision(detection, "redact")} className="rounded-full border border-card-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent">{text.redact}</button>
                        <button type="button" onClick={() => applyDecision(detection, "ignore")} className="rounded-full border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent">{text.ignore}</button>
                      </div>
                    )}

                    <button type="button" onClick={() => setExpandedId(expanded ? null : detection.id)} className="mt-3 text-xs font-medium text-accent-deep underline underline-offset-2">
                      {expanded ? text.hideSamples : text.samples}
                    </button>
                    {expanded ? (
                      <ol className="mt-2 space-y-2">
                        {samples.map((sample) => (
                          <li key={`${sample.messageId}:${sample.field}`} className="rounded-xl border border-card-border bg-[#faf8fc] p-2.5">
                            <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted">
                              <strong className="text-accent-deep">{sample.senderName}</strong>
                              <span>{formatTimestamp(sample.timestamp, locale)}</span>
                              <span>{text.field}: {sample.field}</span>
                              <span>#{sample.messageId}</span>
                            </div>
                            <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-foreground">{sample.snippet}</p>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}

export function PrivacyReviewLauncher() {
  const { dashboards, activeId, activePrivacyReviewDecisions } = useChat();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const active = dashboards.find((board) => board.id === activeId);
  const detections = useMemo(
    () => scanStructuredPii(active?.messages ?? []),
    [active],
  );
  const summary = reviewSummary(detections, activePrivacyReviewDecisions);

  if (!active || active.kind === "default" || active.messages.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-16 right-5 z-30 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 ${summary.unresolvedHigh > 0 ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
      >
        {locale === "en" ? "Privacy review" : "隱私檢查"}{summary.unresolvedHigh > 0 ? ` · ${summary.unresolvedHigh}` : " · ✓"}
      </button>
      {open ? <PrivacyReviewPanel dashboardId={active.id} messages={active.messages} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
