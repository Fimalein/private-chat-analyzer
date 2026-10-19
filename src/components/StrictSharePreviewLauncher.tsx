"use client";

import { useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useLocale } from "@/components/LocaleProvider";
import {
  approveStrictChatGptSharePack,
  previewStrictChatGptSharePack,
  selectRecentStrictShareMessages,
  StrictShareBlockedError,
} from "@/lib/export/strict-chatgpt-share";
import {
  applyStrictMessageEdits,
  strictReviewSegments,
  type StrictMessageEdit,
  type StrictMessageEdits,
} from "@/lib/export/strict-manual-masking";
import type { ChatGptExportFile } from "@/lib/export/chatgpt-pack";

type Preview = {
  key: string;
  files: ChatGptExportFile[];
  selectedCount: number;
};

const ERRORS: Record<string, [string, string]> = {
  manual_review_required: ["Manual privacy review is required.", "須先人工審查隱私。"],
  file_review_incomplete: ["Inspect and explicitly approve all four files.", "必須逐一審核並同意四份檔案。"],
  preview_changed: ["The export changed. Generate and review it again.", "匯出內容已變更，請重新產生和審核。"],
  relative_date_required: ["Relative dates are required.", "必須使用相對日期。"],
  known_values_required: ["Enter sensitive names or phrases to protect.", "請輸入須保護的敏感名字或詞句。"],
  empty_selection: ["All messages were omitted.", "所有訊息均已排除。"],
  unmasked_participant: ["A sender name or ID remains unmapped. Anonymize all participants first.", "尚有發訊者名稱或 ID 未假名化，請先處理所有參與者。"],
  unresolved_structured_pii: ["Structured identifiers remain. Complete Privacy Review or mask their sentences.", "仍有識別資訊，請完成隱私檢查或遮蔽所屬句子。"],
  invalid_serialized_artifact: ["A file could not be inspected.", "有檔案無法檢查。"],
  serialized_structured_pii: ["A generated file still contains a structured identifier.", "匯出檔案仍有識別資訊。"],
  known_sensitive_value_survived: ["A protected name or phrase still appears in the export.", "保護清單中仍有詞句出現在匯出。"],
};

function downloadReviewedFile(file: ChatGptExportFile) {
  // User-triggered local download ONLY; never network upload or clipboard.
  const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Experimental, local-only sharing workflow. No automatic external transfer.
 * All four generated artifacts require an individual confirmation AND final
 * contextual-risk acknowledgement before local downloads are unlocked.
 */
export function StrictSharePreviewLauncher() {
  const { dashboards, activeId, activePrivacyMappings } = useChat();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState<25 | 50 | 100>(25);
  const [sensitiveText, setSensitiveText] = useState("");
  const [edits, setEdits] = useState<StrictMessageEdits>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  const [reviewedFiles, setReviewedFiles] = useState<string[]>([]);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const board = dashboards.find((item) => item.id === activeId);
  const source = board && board.kind !== "default"
    ? selectRecentStrictShareMessages(board.messages, limit) : [];
  const sourceKey = JSON.stringify({
    dashboardId: board?.id, source, mappings: activePrivacyMappings,
    limit, sensitiveText, edits,
  });
  const validPreview = preview?.key === sourceKey ? preview : null;
  const allReviewed = Boolean(validPreview &&
    validPreview.files.length === 4 &&
    validPreview.files.every((file) => reviewedFiles.includes(file.name)));
  const canDownload = allReviewed && approvalEnabled && riskAccepted;

  if (!board || board.kind === "default" || board.messages.length === 0) return null;

  const zh = locale !== "en";
  const copy = zh ? {
    launch: "ChatGPT 隱私預覽（實驗）", title: "手動遮蔽與分享前審核",
    close: "關閉", info: "僅於本機處理。未授權前不能下載，絕不會自動上傳或傳送到 ChatGPT。檢查通過不代表完全匿名。",
    selection: "最近訊息數量", sensitivity: "須保護的名稱、暱稱、學校、地點及獨特事件（每行一項）",
    hint: "列表只留在此頁記憶體；未列出的敏感背景可能仍可識別。",
    mask: "逐句遮蔽／排除訊息（原文只在本機顯示）",
    action: "訊息處理", keep: "保留並逐句檢查", omit: "完全排除此則", all: "遮蔽整則內容",
    segment: "遮蔽這一句", generate: "產生四份本機預覽",
    files: "逐一審核每份完整檔案", reviewed: "我已檢查這份檔案的全部內容",
    risk: "我理解仍有姓名變體、罕見事件、關係及其他重新識別風險；我已手動審核四份檔案。",
    authorize: "明確批准本機下載", download: "下載這份已審核檔案",
    confirmed: "可逐份下載。這並非完全匿名的保證，也不會直接送往 ChatGPT。",
    selected: "實際保留訊息", missing: "請先完成四份檔案的確認和風險同意。",
  } : {
    launch: "ChatGPT private review (experimental)", title: "Mask and review before sharing",
    close: "Close", info: "LOCAL ONLY. Files cannot be downloaded before approval. Nothing is automatically uploaded or sent to ChatGPT. Passing scans does not prove anonymity.",
    selection: "Maximum recent messages", sensitivity: "Sensitive names, aliases, schools, places, unique events (one per line)",
    hint: "This list stays in this page's memory. Unlisted contextual clues may still be identifying.",
    mask: "Mask sentences / omit messages (raw text shown locally)",
    action: "Message action", keep: "Keep; mask individual sentences", omit: "Omit this message entirely", all: "Mask entire message content",
    segment: "Mask this sentence", generate: "Generate local preview of 4 files",
    files: "Review all four final files individually", reviewed: "I inspected this entire file",
    risk: "I understand names, rare events, relationships and combinations of clues may still identify people. I reviewed all four files manually.",
    authorize: "Explicitly authorize local downloads", download: "Download this reviewed file",
    confirmed: "You may download each reviewed file. This is not an anonymity guarantee and does not send anything to ChatGPT.",
    selected: "Messages kept", missing: "Review every file and acknowledge the residual risks first.",
  };

  function clearApproval() {
    setPreview(null);
    setReviewedFiles([]);
    setRiskAccepted(false);
    setApprovalEnabled(false);
    setError(null);
  }

  function updateEdit(id: string, next: StrictMessageEdit | null) {
    const updated = { ...edits };
    if (next) Object.defineProperty(updated, id, {
      value: next, enumerable: true, writable: true, configurable: true,
    });
    else delete updated[id];
    setEdits(updated);
    clearApproval();
  }

  function changeMask(id: string, index: number, checked: boolean) {
    const existing = Object.hasOwn(edits, id) ? edits[id] : undefined;
    const indices = existing?.action === "mask_sentences" ? [...existing.indices] : [];
    const next = checked ? [...new Set([...indices, index])] : indices.filter((i) => i !== index);
    updateEdit(id, next.length ? { action: "mask_sentences", indices: next } : null);
  }

  function preparedMessages() {
    return applyStrictMessageEdits(source, edits);
  }

  function sensitiveValues() {
    return sensitiveText.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  }

  function prepare() {
    clearApproval();
    try {
      const selected = preparedMessages();
      const pack = previewStrictChatGptSharePack(selected, activePrivacyMappings, {
        dateMode: { mode: "relative_day" }, knownSensitiveValues: sensitiveValues(),
      });
      setPreview({ key: sourceKey, files: pack.files, selectedCount: selected.length });
      setFileIndex(0);
    } catch (cause) {
      const code = cause instanceof StrictShareBlockedError ? cause.reason : "invalid_serialized_artifact";
      setError((ERRORS[code] ?? ERRORS.invalid_serialized_artifact)[zh ? 1 : 0]);
    }
  }

  function verifyApproval() {
    if (!validPreview) throw new StrictShareBlockedError("preview_changed");
    return approveStrictChatGptSharePack(
      preparedMessages(), activePrivacyMappings,
      { dateMode: { mode: "relative_day" },
        knownSensitiveValues: sensitiveValues(), confirmedHumanReview: true },
      validPreview.files, reviewedFiles,
    );
  }

  function authorize() {
    setError(null);
    if (!allReviewed || !riskAccepted) {
      setError(copy.missing);
      return;
    }
    try {
      verifyApproval();
      setApprovalEnabled(true);
    } catch (cause) {
      const code = cause instanceof StrictShareBlockedError ? cause.reason : "invalid_serialized_artifact";
      setApprovalEnabled(false);
      setError((ERRORS[code] ?? ERRORS.invalid_serialized_artifact)[zh ? 1 : 0]);
    }
  }

  function download(index: number) {
    setError(null);
    if (!canDownload) {
      setError(copy.missing);
      return;
    }
    try {
      // Repeat every check at the actual handoff, not only at preview time.
      const pack = verifyApproval();
      const file = pack.files[index];
      if (!file) throw new StrictShareBlockedError("preview_changed");
      downloadReviewedFile(file);
    } catch (cause) {
      const code = cause instanceof StrictShareBlockedError ? cause.reason : "invalid_serialized_artifact";
      setApprovalEnabled(false);
      setError((ERRORS[code] ?? ERRORS.invalid_serialized_artifact)[zh ? 1 : 0]);
    }
  }

  return (
    <>
      <button type="button"
        className="fixed bottom-40 right-5 z-30 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-900 shadow-lg"
        onClick={() => { clearApproval(); setOpen(true); }}>{copy.launch}</button>
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3 sm:p-6">
          <section role="dialog" aria-modal="true" aria-label={copy.title}
            className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-card-border bg-white p-4 shadow-xl sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-accent-deep">{copy.title}</h2>
              <button type="button" className="rounded-lg border px-3 py-1 text-xs" onClick={() => {
                clearApproval(); setOpen(false); setSensitiveText(""); setEdits({});
              }}>{copy.close}</button>
            </div>
            <p className="mt-2 text-xs font-medium leading-5 text-rose-800">{copy.info}</p>
            <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
              <label className="block text-xs font-semibold text-accent-deep">
                {copy.selection}
                <select className="mt-1 block w-full rounded-lg border border-card-border p-2 text-sm"
                  value={limit} onChange={(event) => {
                    setLimit(Number(event.target.value) as 25 | 50 | 100);
                    setEdits({}); clearApproval();
                  }}>
                  <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-accent-deep">
                {copy.sensitivity}
                <textarea className="mt-1 block min-h-20 w-full resize-y rounded-lg border border-card-border p-2 text-sm"
                  value={sensitiveText} spellCheck={false} autoComplete="off"
                  onChange={(event) => { setSensitiveText(event.target.value); clearApproval(); }} />
              </label>
              <p className="text-xs text-muted">{copy.hint}</p>
              <div>
                <h3 className="text-sm font-semibold text-accent-deep">{copy.mask}</h3>
                <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-card-border p-2">
                  {source.map((message, position) => {
                    const edit = Object.hasOwn(edits, message.id) ? edits[message.id] : undefined;
                    const segments = strictReviewSegments(message.content);
                    const mode = edit?.action === "omit" ? "omit" :
                      edit?.action === "mask_all" ? "mask_all" : "mask_sentences";
                    const indices = edit?.action === "mask_sentences" ? edit.indices : [];
                    return (
                      <details key={message.id + ":" + String(position)} className="rounded-lg border border-card-border p-2">
                        <summary className="cursor-pointer text-xs font-semibold">
                          {position + 1}. {message.senderName} — {message.content.slice(0, 65)}
                        </summary>
                        <label className="mt-2 block text-xs">{copy.action}
                          <select className="mt-1 block w-full rounded border border-card-border p-1 text-xs"
                            value={mode} onChange={(event) => {
                              const next = event.target.value;
                              updateEdit(message.id, next === "omit" ? { action: "omit" } :
                                next === "mask_all" ? { action: "mask_all" } : null);
                            }}>
                            <option value="mask_sentences">{copy.keep}</option>
                            <option value="mask_all">{copy.all}</option>
                            <option value="omit">{copy.omit}</option>
                          </select>
                        </label>
                        {mode === "mask_sentences" ? (
                          <div className="mt-2 space-y-1">
                            {segments.filter((part) => part.editable).map((part) => (
                              <label key={part.index} className="flex items-start gap-2 rounded bg-[#faf8fc] p-2 text-xs">
                                <input type="checkbox" checked={indices.includes(part.index)}
                                  onChange={(event) => changeMask(message.id, part.index, event.target.checked)} />
                                <span><strong>{copy.segment}</strong>
                                  <span className="mt-1 block whitespace-pre-wrap break-all font-normal">{part.text}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </details>
                    );
                  })}
                </div>
              </div>
              <button type="button" className="rounded-lg bg-accent-deep px-4 py-2 text-sm font-semibold text-white"
                onClick={prepare}>{copy.generate}</button>
              {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
              {validPreview ? (
                <div className="space-y-3 border-t border-card-border pt-3">
                  <p className="text-xs font-semibold text-accent-deep">{copy.selected}: {validPreview.selectedCount}</p>
                  <h3 className="text-sm font-semibold text-accent-deep">{copy.files}</h3>
                  <div className="flex flex-wrap gap-2">
                    {validPreview.files.map((file, index) => (
                      <button key={file.name} type="button"
                        className={"rounded-lg border px-2 py-1 text-[11px] " +
                          (fileIndex === index ? "border-accent bg-purple-50 font-semibold" : "border-card-border")}
                        onClick={() => setFileIndex(index)}>{file.name}
                        {reviewedFiles.includes(file.name) ? " ✓" : ""}</button>
                    ))}
                  </div>
                  <pre tabIndex={0} className="max-h-[36vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-card-border bg-[#faf8fc] p-3 text-xs leading-5">{validPreview.files[fileIndex]?.content ?? ""}</pre>
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={reviewedFiles.includes(validPreview.files[fileIndex].name)}
                      onChange={(event) => {
                        const name = validPreview.files[fileIndex].name;
                        setReviewedFiles((current) => event.target.checked
                          ? [...new Set([...current, name])] : current.filter((item) => item !== name));
                        setApprovalEnabled(false);
                      }} />
                    {copy.reviewed}
                  </label>
                  <label className="flex items-start gap-2 border-t border-card-border pt-2 text-xs leading-5">
                    <input type="checkbox" checked={riskAccepted}
                      onChange={(event) => { setRiskAccepted(event.target.checked); setApprovalEnabled(false); }} />
                    {copy.risk}
                  </label>
                  <button type="button" disabled={!allReviewed || !riskAccepted || approvalEnabled}
                    onClick={authorize}
                    className="rounded-lg bg-accent-deep px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{copy.authorize}</button>
                  {canDownload ? (
                    <div className="space-y-2 border-t border-card-border pt-2">
                      <p className="text-xs text-rose-800">{copy.confirmed}</p>
                      {validPreview.files.map((file, index) => (
                        <button key={file.name} type="button"
                          className="mr-2 rounded-lg border border-card-border px-3 py-1.5 text-xs"
                          onClick={() => download(index)}>{copy.download}: {file.name}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
