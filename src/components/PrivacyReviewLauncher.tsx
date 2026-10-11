"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useLocale } from "@/components/LocaleProvider";
import {
  nextStructuredPiiReplacement,
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

function kindLabel(kind: StructuredPiiKind, locale: "zh" | "en") {
  return KIND_LABELS[kind][locale === "en" ? 1 : 0];
}

function formatTimestamp(timestamp: number, locale: "zh" | "en") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

type ReviewFilter = "all" | "unreviewed" | "reviewed" | "high";

function PrivacyReviewPanel({ onClose }: { onClose: () => void }) {
  const {
    dashboards,
    activeId,
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
  const active = dashboards.find((board) => board.id === activeId);
  const messages = active?.messages ?? [];
  const detections = useMemo(() => scanStructuredPii(messages), [messages]);
  const summary = useMemo(
    () => reviewSummary(detections, activePrivacyReviewDecisions),
    [activePrivacyReviewDecisions, detections],
  );

  const visible = useMemo(() => {
    if (filter === "all") return detections;
    if (filter === "reviewed") {
      return detections.filter((item) => activePrivacyReviewDecisions[item.id]);
    }
    if (filter === "high") {
      return detections.filter(
        (item) =>
          item.severity === "high" && !activePrivacyReviewDecisions[item.id],
      );
    }
    return detections.filter((item) => !activePrivacyReviewDecisions[item.id]);
  }, [activePrivacyReviewDecisions, detections, filter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const text =
    locale === "en"
      ? {
          title: "Privacy review",
          local: "Candidates and sample context stay in this browser.",
          close: "Close",
          unique: "Unique",
          unreviewed: "Unreviewed",
          reviewed: "Reviewed",
          high: "High-risk unresolved",
          all: "All",
          occurrences: "occurrences",
          samples: "Show samples",
          hideSamples: "Hide samples",
          field: "field",
          pseudonymize: "Pseudonymize",
          redact: "Redact",
          ignore: "Keep / ignore",
          undo: "Undo decision",
          replacement: "replacement",
          noItems: "No candidates in this view.",
          rawWarning:
            "The value below is raw local data. It is shown only so you can decide what to do with it.",
          reviewedAs: "Reviewed as",
          statusPseudonymize: "pseudonymized",
          statusRedact: "redacted",
          statusIgnore: "kept / ignored",
          note:
            "Ignore means reviewed, not removed. The export flow must rescan transformed output before sharing.",
        }
      : {
          title: "隱私檢查",
          local: "候選值與前後文只在此瀏覽器內處理。",
          close: "關閉",
          unique: "唯一候選",
          unreviewed: "未確認",
          reviewed: "已確認",
          high: "高風險未確認",
          all: "全部",
          occurrences: "次出現",
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
          statusPseudonymize: "假名化",
          statusRedact: "遮蔽",
          statusIgnore: "保留 / 忽略",
          note: "忽略只代表已檢查，不代表已刪除；匯出前仍必須重新掃描輸出。",
        };

  if (!active || active.kind === "default") return null;

  function decisionLabel(action: PrivacyReviewAction) {
    if (action === "pseudonymize") return text.statusPseudonymize;
    if (action === "redact") return text.statusRedact;
    return text.statusIgnore;
  }

  function applyDecision(
    detection: StructuredPiiDetection,
    action: PrivacyReviewAction,
  ) {
    const existing = activePrivacyReviewDecisions[detection.id];
    if (existing?.action !== "ignore") {
      removePrivacyMapping(active.id, detection.value);
    }

    let replacement: string | undefined;
    if (action === "pseudonymize") {
      const occupied = [
        ...activePrivacyMappings
          .filter((mapping) => mapping.source !== detection.value)
          .map((mapping) => mapping.replacement),
        ...Object.values(activePrivacyReviewDecisions)
          .filter((decision) => decision.detectionId !== detection.id)
          .map((decision) => decision.replacement)
          .filter((value): value is string => Boolean(value)),
      ];
      replacement = nextStructuredPiiReplacement(detection.kind, occupied);
    } else if (action === "redact") {
      replacement = redactPlaceholder(detection.kind);
    }

    if (replacement) {
      upsertPrivacyMapping(active.id, {
        source: detection.value,
        replacement,
        kind: "secret",
      });
    } else {
      removePrivacyMapping(active.id, detection.value);
    }

    setPrivacyReviewDecision(active.id, {
      detectionId: detection.id,
      action,
      replacement,
    });
  }

  function undoDecision(detection: StructuredPiiDetection) {
    const existing = activePrivacyReviewDecisions[detection.id];
    if (existing?.action !== "ignore") {
      removePrivacyMapping(active.id, detection.value);
    }
    removePrivacyReviewDecision(active.id, detection.id);
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-xl border p-2 text-left ${filter === "all" ? "border-accent bg-accent/10" : "border-card-border"}`}
            >
              <span className="block text-lg font-bold text-accent-deep">{summary.total}</span>
              <span className="text-[11px] text-muted">{text.unique}</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter("unreviewed")}
              className={`rounded-xl border p-2 text-left ${filter === "unreviewed" ? "border-accent bg-accent/10" : "border-card-border"}`}
            >
              <span className="block text-lg font-bold text-accent-deep">{summary.unreviewed}</span>
              <span className="text-[11px] text-muted">{text.unreviewed}</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter("reviewed")}
              className={`rounded-xl border p-2 text-left ${filter === "reviewed" ? "border-accent bg-accent/10" : "border-card-border"}`}
            >
              <span className="block text-lg font-bold text-accent-deep">{summary.reviewed}</span>
              <span className="text-[11px] text-muted">{text.reviewed}</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter("high")}
              className={`rounded-xl border p-2 text-left ${filter === "high" ? "border-rose-300 bg-rose-50" : "border-card-border"}`}
            >
              <span className="block text-lg font-bold text-rose-600">{summary.unresolvedHigh}</span>
              <span className="text-[11px] text-muted">{text.high}</span>
            </button>
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
                const samples = expanded
                  ? sampleContextsForDetection(detection, messages, 3)
                  : [];
                return (
                  <li
                    key={detection.id}
                    className="rounded-2xl border border-card-border bg-white p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent-deep">
                        {kindLabel(detection.kind, locale)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold ${
                          detection.severity === "high"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {detection.severity.toUpperCase()}
                      </span>
                      <span className="text-muted">
                        {detection.occurrenceCount.toLocaleString()} {text.occurrences}
                      </span>
                    </div>

                    <p className="mt-2 text-[11px] text-muted">{text.rawWarning}</p>
                    <code className="mt-1 block max-h-24 overflow-auto rounded-lg bg-[#f5f1f8] px-2.5 py-2 text-xs text-foreground">
                      {detection.value}
                    </code>

                    {decision ? (
                      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {text.reviewedAs}: <strong>{decisionLabel(decision.action)}</strong>
                            {decision.replacement ? (
                              <> · {text.replacement} <code>{decision.replacement}</code></>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            onClick={() => undoDecision(detection)}
                            className="rounded-full border border-emerald-300 px-2.5 py-1 font-medium hover:bg-white"
                          >
                            {text.undo}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => applyDecision(detection, "pseudonymize")}
                          className="rounded-full bg-accent-deep px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-dim"
                        >
                          {text.pseudonymize}
                        </button>
                        <button
                          type="button"
                          onClick={() => applyDecision(detection, "redact")}
                          className="rounded-full border border-card-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent"
                        >
                          {text.redact}
                        </button>
                        <button
                          type="button"
                          onClick={() => applyDecision(detection, "ignore")}
                          className="rounded-full border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent"
                        >
                          {text.ignore}
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : detection.id)}
                      className="mt-3 text-xs font-medium text-accent-deep underline underline-offset-2"
                    >
                      {expanded ? text.hideSamples : text.samples}
                    </button>

                    {expanded ? (
                      <ol className="mt-2 space-y-2">
                        {samples.map((sample) => (
                          <li
                            key={`${sample.messageId}:${sample.field}`}
                            className="rounded-xl border border-card-border bg-[#faf8fc] p-2.5"
                          >
                            <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted">
                              <strong className="text-accent-deep">{sample.senderName}</strong>
                              <span>{formatTimestamp(sample.timestamp, locale)}</span>
                              <span>{text.field}: {sample.field}</span>
                              <span>#{sample.messageId}</span>
                            </div>
                            <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
                              {sample.snippet}
                            </p>
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
  const {
    dashboards,
    activeId,
    activePrivacyReviewDecisions,
  } = useChat();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const active = dashboards.find((board) => board.id === activeId);
  const detections = useMemo(
    () => scanStructuredPii(active?.messages ?? []),
    [active?.messages],
  );
  const summary = useMemo(
    () => reviewSummary(detections, activePrivacyReviewDecisions),
    [activePrivacyReviewDecisions, detections],
  );

  if (!active || active.kind === "default" || active.messages.length === 0) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-16 right-5 z-30 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 ${
          summary.unresolvedHigh > 0
            ? "bg-rose-600 hover:bg-rose-700"
            : "bg-emerald-600 hover:bg-emerald-700"
        }`}
      >
        {locale === "en" ? "Privacy review" : "隱私檢查"}
        {summary.unresolvedHigh > 0 ? ` · ${summary.unresolvedHigh}` : " · ✓"}
      </button>
      {open ? <PrivacyReviewPanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}
