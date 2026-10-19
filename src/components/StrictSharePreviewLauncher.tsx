"use client";

import { useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useLocale } from "@/components/LocaleProvider";
import {
  previewStrictChatGptSharePack,
  selectRecentStrictShareMessages,
  StrictShareBlockedError,
} from "@/lib/export/strict-chatgpt-share";
import type { ChatGptExportFile } from "@/lib/export/chatgpt-pack";
import type { ChatMessage } from "@/lib/chat-types";
import type { EntityMapping } from "@/lib/privacy";

type Preview = {
  messages: readonly ChatMessage[];
  mappings: readonly EntityMapping[];
  limit: 25 | 50 | 100;
  secrets: string;
  files: ChatGptExportFile[];
  selectedCount: number;
};

const LABELS: Record<string, [string, string]> = {
  manual_review_required: ["Manual privacy review is required.", "須先人工審查隱私。"],
  relative_date_required: ["Relative dates are required.", "必須使用相對日期。"],
  known_values_required: ["Enter at least one sensitive name or phrase to protect.", "請填入至少一個需要保護的名字或詞句。"],
  empty_selection: ["No messages selected.", "尚未選取訊息。"],
  unmasked_participant: ["A participant name or sender ID is not pseudonymized. Map every participant in Privacy Review before previewing.", "尚有參與者名稱或發訊者 ID 未使用假名。請先完成隱私映射。"],
  unresolved_structured_pii: ["Unmasked structured identifiers remain. Complete Privacy Review first.", "仍有未遮蔽的識別資訊。請先完成隱私檢查。"],
  invalid_serialized_artifact: ["An export file could not be checked.", "無法檢查匯出檔案。"],
  serialized_structured_pii: ["An identifier remains in a generated file. Preview blocked.", "產生的檔案仍含識別資訊，已封鎖預覽。"],
  known_sensitive_value_survived: ["A listed sensitive phrase remains in a generated file. Preview blocked.", "產生的檔案仍含指定敏感詞句，已封鎖預覽。"],
};

/**
 * Preview only. There is deliberately NO download, share, clipboard, fetch,
 * or API request in this component. A passed scanner is not anonymity proof.
 */
export function StrictSharePreviewLauncher() {
  const { dashboards, activeId, activePrivacyMappings } = useChat();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState<25 | 50 | 100>(25);
  const [sensitiveText, setSensitiveText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const board = dashboards.find((item) => item.id === activeId);
  if (!board || board.kind === "default" || board.messages.length === 0) return null;

  const validPreview =
    preview?.messages === board.messages &&
    preview.mappings.length === activePrivacyMappings.length &&
    preview.mappings.every((mapping, index) => {
      const current = activePrivacyMappings[index];
      return Boolean(current &&
        mapping.source === current.source &&
        mapping.replacement === current.replacement &&
        mapping.kind === current.kind);
    }) &&
    preview.limit === limit &&
    preview.secrets === sensitiveText ? preview : null;

  const zh = locale !== "en";
  const copy = zh ? {
    button: "ChatGPT 隱私預覽（實驗）",
    title: "ChatGPT 分享前檢查",
    close: "關閉",
    experimental: "僅限本機預覽。不會上傳、分享、複製或下載。通過掃描不代表完全匿名。",
    count: "僅選取最近訊息數量",
    sensitive: "必須隱藏的名稱、暱稱、學校、地點、獨特事件（每行一項）",
    sensitiveHint: "只存在此視窗的記憶體中，不會寫入匯出檔案。請自行加入所有已知的敏感詞變體。",
    preview: "在本機產生四份檔案預覽",
    files: "逐一檢查生成的四份檔案",
    selected: "預覽訊息",
    caution: "仍需檢查人名、上下文、罕見事件、日期和關係線索。此實驗預覽沒有對外傳送功能。",
  } : {
    button: "ChatGPT private preview (experimental)",
    title: "Review before sharing with ChatGPT",
    close: "Close",
    experimental: "LOCAL PREVIEW ONLY. No upload, sharing, copying or download. A passed scan is not proof of anonymity.",
    count: "Only include the most recent messages",
    sensitive: "Names, aliases, schools, places or unique events to protect (one per line)",
    sensitiveHint: "These stay in this browser window's memory and are not included in files. List every known sensitive wording.",
    preview: "Generate a local preview of all four files",
    files: "Inspect each of the four generated files",
    selected: "Messages in preview",
    caution: "Manually inspect names, contextual clues, rare events, dates and relationships. This experimental preview cannot transfer data.",
  };

  function prepare() {
    setPreview(null);
    setError(null);
    try {
      const selected = selectRecentStrictShareMessages(board!.messages, limit);
      const known = sensitiveText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      const pack = previewStrictChatGptSharePack(selected, activePrivacyMappings, {
        dateMode: { mode: "relative_day" },
        knownSensitiveValues: known,
      });
      setPreview({
        messages: board!.messages,
        mappings: activePrivacyMappings,
        limit,
        secrets: sensitiveText,
        files: pack.files,
        selectedCount: selected.length,
      });
      setFileIndex(0);
    } catch (cause) {
      const reason = cause instanceof StrictShareBlockedError ? cause.reason : "invalid_serialized_artifact";
      setError((LABELS[reason] ?? LABELS.invalid_serialized_artifact)[zh ? 1 : 0]);
    }
  }

  return (
    <>
      <button
        type="button"
        className="fixed bottom-40 right-5 z-30 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-900 shadow-lg"
        onClick={() => { setOpen(true); setPreview(null); setError(null); }}
      >
        {copy.button}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3 sm:p-6">
          <section role="dialog" aria-modal="true" aria-label={copy.title} className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-card-border bg-white p-4 shadow-xl sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-accent-deep">{copy.title}</h2>
              <button type="button" onClick={() => { setOpen(false); setPreview(null); setSensitiveText(""); }} className="rounded-lg border px-3 py-1 text-xs">{copy.close}</button>
            </div>
            <p className="mt-2 text-xs font-medium leading-5 text-rose-800">{copy.experimental}</p>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              <label className="block text-xs font-semibold text-accent-deep">
                {copy.count}
                <select className="mt-1 block w-full rounded-lg border border-card-border p-2 text-sm" value={limit} onChange={(event) => { setLimit(Number(event.target.value) as 25 | 50 | 100); setPreview(null); }}>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <label className="mt-3 block text-xs font-semibold text-accent-deep">
                {copy.sensitive}
                <textarea className="mt-1 block min-h-20 w-full resize-y rounded-lg border border-card-border p-2 text-sm" value={sensitiveText} onChange={(event) => { setSensitiveText(event.target.value); setPreview(null); }} spellCheck={false} autoComplete="off" />
              </label>
              <p className="mt-1 text-xs leading-5 text-muted">{copy.sensitiveHint}</p>
              <button type="button" className="mt-3 rounded-lg bg-accent-deep px-4 py-2 text-sm font-semibold text-white" onClick={prepare}>{copy.preview}</button>
              {error ? <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
              {validPreview ? (
                <div className="mt-4 border-t border-card-border pt-3">
                  <p className="text-xs font-semibold text-accent-deep">{copy.selected}: {validPreview.selectedCount}</p>
                  <p className="mt-1 text-xs text-rose-800">{copy.caution}</p>
                  <h3 className="mt-3 text-sm font-semibold text-accent-deep">{copy.files}</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {validPreview.files.map((file, index) => (
                      <button key={file.name} type="button" className={"rounded-lg border px-2 py-1 text-[11px] " + (fileIndex === index ? "border-accent bg-purple-50 font-semibold" : "border-card-border")} onClick={() => setFileIndex(index)}>{file.name}</button>
                    ))}
                  </div>
                  <pre tabIndex={0} className="mt-2 max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-card-border bg-[#faf8fc] p-3 text-xs leading-5">{validPreview.files[fileIndex]?.content ?? ""}</pre>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
