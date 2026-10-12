"use client";

import { useMemo, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useLocale } from "@/components/LocaleProvider";
import {
  auditPreparedExport,
  buildChatGptExportPack,
  ExportBlockedError,
  prepareExportMessages,
  type ChatGptExportFile,
} from "@/lib/export/chatgpt-pack";

function downloadFile(file: ChatGptExportFile) {
  const blob = new Blob([file.content], { type: `${file.type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ChatGptExportLauncher() {
  const { dashboards, activeId, activePrivacyMappings } = useChat();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const active = dashboards.find((board) => board.id === activeId);
  const prepared = useMemo(
    () =>
      active && active.kind !== "default"
        ? prepareExportMessages(active.messages, activePrivacyMappings)
        : [],
    [active, activePrivacyMappings],
  );
  const audit = useMemo(() => auditPreparedExport(prepared), [prepared]);

  if (!active || active.kind === "default" || active.messages.length === 0) return null;
  const activeMessages = active.messages;

  const text =
    locale === "en"
      ? {
          launch: "Export for ChatGPT",
          title: "ChatGPT analysis pack",
          local: "The pack is generated locally in this browser.",
          close: "Close",
          high: "High-risk identifiers remaining",
          medium: "Medium-risk identifiers remaining",
          blocked:
            "Export is blocked until high-risk identifiers are pseudonymized or redacted in Privacy review.",
          warning:
            "Medium-risk items do not block export. Review them if URLs, IP addresses, postal codes, or long IDs could identify someone.",
          ready:
            "No structured high-risk identifiers were found after applying the current privacy mappings.",
          contents: "Files",
          export: "Share / download 4 files",
          working: "Generating…",
          done: "Pack generated.",
          error: "Export failed. Nothing was shared.",
          caveat:
            "Detection is not a guarantee of complete anonymization. Names, places, dates, and contextual clues may still need manual review.",
        }
      : {
          launch: "ChatGPT 匯出",
          title: "ChatGPT 分析套件",
          local: "套件只在此瀏覽器內產生。",
          close: "關閉",
          high: "仍有高風險識別資訊",
          medium: "仍有中風險識別資訊",
          blocked: "高風險資訊完成假名化或遮蔽前，匯出會被阻止。請先使用隱私檢查。",
          warning: "中風險項目不會阻止匯出；若 URL、IP、郵遞區號或長 ID 可能識別個人，請先檢查。",
          ready: "套用目前的隱私規則後，未偵測到結構化高風險識別資訊。",
          contents: "檔案",
          export: "分享 / 下載 4 個檔案",
          working: "產生中…",
          done: "套件已產生。",
          error: "匯出失敗，沒有分享任何資料。",
          caveat: "偵測不到不等於完全匿名。姓名、地點、日期與上下文線索仍可能需要人工檢查。",
        };

  async function exportPack() {
    setStatus("working");
    try {
      const pack = buildChatGptExportPack(activeMessages, activePrivacyMappings);
      const files = pack.files.map(
        (file) => new File([file.content], file.name, { type: file.type }),
      );
      const shareData: ShareData = { files };

      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        for (const file of pack.files) downloadFile(file);
      }
      setStatus("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("idle");
        return;
      }
      if (error instanceof ExportBlockedError) {
        setStatus("idle");
        return;
      }
      console.error("[ChatGptExportLauncher] export failed", error);
      setStatus("error");
    }
  }

  const highCount = audit.highRisk.length;
  const mediumCount = audit.mediumRisk.length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStatus("idle");
          setOpen(true);
        }}
        className={`fixed bottom-28 right-5 z-30 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 ${
          highCount > 0
            ? "bg-rose-600 hover:bg-rose-700"
            : mediumCount > 0
              ? "bg-amber-600 hover:bg-amber-700"
              : "bg-sky-700 hover:bg-sky-800"
        }`}
      >
        {text.launch}{highCount > 0 ? ` · ${highCount}` : ""}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-3 sm:p-6"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="w-full max-w-lg rounded-2xl border border-card-border bg-white p-4 shadow-2xl sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-xl font-bold text-accent-deep">
                  {text.title}
                </h2>
                <p className="mt-1 text-xs text-muted">{text.local}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-card-border px-3 py-1.5 text-sm text-muted hover:border-accent"
              >
                {text.close}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className={`rounded-xl border p-3 ${highCount > 0 ? "border-rose-300 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
                <div className={`text-2xl font-bold ${highCount > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                  {highCount}
                </div>
                <div className="mt-1 text-xs text-muted">{text.high}</div>
              </div>
              <div className={`rounded-xl border p-3 ${mediumCount > 0 ? "border-amber-300 bg-amber-50" : "border-card-border bg-[#faf8fc]"}`}>
                <div className={`text-2xl font-bold ${mediumCount > 0 ? "text-amber-700" : "text-accent-deep"}`}>
                  {mediumCount}
                </div>
                <div className="mt-1 text-xs text-muted">{text.medium}</div>
              </div>
            </div>

            <p className={`mt-3 rounded-xl p-3 text-sm leading-6 ${highCount > 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
              {highCount > 0 ? text.blocked : text.ready}
            </p>
            {mediumCount > 0 ? (
              <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                {text.warning}
              </p>
            ) : null}

            <div className="mt-4">
              <h3 className="text-sm font-semibold text-accent-deep">{text.contents}</h3>
              <ul className="mt-2 space-y-1 rounded-xl border border-card-border bg-[#faf8fc] p-3 font-mono text-xs text-foreground">
                <li>chat_redacted.txt</li>
                <li>chat_redacted.jsonl</li>
                <li>analysis_index.json</li>
                <li>ChatGPT_analysis_instructions.txt</li>
              </ul>
            </div>

            <p className="mt-3 text-[11px] leading-5 text-muted">{text.caveat}</p>

            <div className="mt-5 flex items-center justify-end gap-3">
              {status === "done" ? (
                <span className="text-xs text-emerald-700">{text.done}</span>
              ) : status === "error" ? (
                <span className="text-xs text-rose-700">{text.error}</span>
              ) : null}
              <button
                type="button"
                disabled={highCount > 0 || status === "working"}
                onClick={exportPack}
                className="rounded-full bg-accent-deep px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === "working" ? text.working : text.export}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
