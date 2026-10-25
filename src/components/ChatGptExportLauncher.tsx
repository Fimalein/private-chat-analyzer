"use client";

import { useMemo, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useLocale } from "@/components/LocaleProvider";
import {
  auditPreparedExport,
  ExportBlockedError,
  prepareExportMessages,
  type ChatGptExportDateMode,
  type ChatGptExportFile,
} from "@/lib/export/chatgpt-pack";
import { auditUnmaskedSecrets, SecretExportBlockedError } from "@/lib/privacy/secret-guard";
import {
  approveStandardHandoff,
  previewStandardHandoff,
  standardHandoffSnapshot,
  StandardHandoffBlockedError,
  type StandardHandoffPreview,
} from "@/lib/export/reviewed-chatgpt-handoff";

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

function randomWeekShift() {
  const values = new Uint32Array(1);
  window.crypto.getRandomValues(values);
  const magnitude = (values[0] % 260) + 1;
  return values[0] % 2 === 0 ? magnitude : -magnitude;
}

export function ChatGptExportLauncher() {
  const { dashboards, activeId, activePrivacyMappings } = useChat();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [dateModeKind, setDateModeKind] = useState<
    ChatGptExportDateMode["mode"]
  >("exact");
  const [weekShift, setWeekShift] = useState(52);
  const [intendedReceiver, setIntendedReceiver] = useState<"temporary" | "regular" | "other">("temporary");
  const [providerAcknowledged, setProviderAcknowledged] = useState(false);
  const [reviewPreview, setReviewPreview] = useState<StandardHandoffPreview | null>(null);
  const [reviewedFileNames, setReviewedFileNames] = useState<string[]>([]);
  const [reviewFileIndex, setReviewFileIndex] = useState(0);
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const active = dashboards.find((board) => board.id === activeId);
  const prepared = useMemo(
    () =>
      active && active.kind !== "default"
        ? prepareExportMessages(active.messages, activePrivacyMappings)
        : [],
    [active, activePrivacyMappings],
  );
  const audit = useMemo(() => auditPreparedExport(prepared), [prepared]);
  const secretAudit = useMemo(() => {
    if (!active || active.kind === "default") return { unmasked: 0 };
    try { return auditUnmaskedSecrets(active.messages, prepared); }
    catch { return { unmasked: 1 }; } // Fail closed on oversized/uninspectable input.
  }, [active, prepared]);

  if (!active || active.kind === "default" || active.messages.length === 0) return null;
  const activeMessages = active.messages;

  const shiftValid =
    dateModeKind !== "shift_weeks" ||
    (Number.isSafeInteger(weekShift) &&
      weekShift !== 0 &&
      Math.abs(weekShift) <= 5200);
  const selectedDateMode: ChatGptExportDateMode =
    dateModeKind === "shift_weeks"
      ? { mode: "shift_weeks", weeks: weekShift }
      : dateModeKind === "relative_day"
        ? { mode: "relative_day" }
        : { mode: "exact" };

  const text =
    locale === "en"
      ? {
          launch: "Export for ChatGPT",
          title: "ChatGPT analysis pack",
          local: "The pack is generated locally in this browser.",
          close: "Close",
          high: "High-risk identifiers remaining",
          secrets: "Authentication secrets remain: remove or mask them locally before sharing. This block cannot be overridden.",
          medium: "Medium-risk identifiers remaining",
          blocked:
            "Export is blocked until high-risk identifiers are pseudonymized or redacted in Privacy review.",
          warning:
            "Medium-risk items do not block export. Review them if URLs, IP addresses, postal codes, or long IDs could identify someone.",
          ready:
            "No structured high-risk identifiers were found after applying the current privacy mappings.",
          datePrivacy: "Date privacy",
          exactTitle: "Keep exact timestamps",
          exactBody:
            "Current behavior. Best chronology fidelity, but original calendar dates remain in the export.",
          shiftTitle: "Shift by whole weeks",
          shiftBody:
            "Moves every timestamp by the same whole-week offset. Ordering, weekdays, and intervals are preserved. The offset itself is not exported.",
          relativeTitle: "Relative day + local clock",
          relativeBody:
            "Replaces calendar dates with DAY_0001, DAY_0002, and so on while keeping local clock time and elapsed durations.",
          weeks: "Week offset",
          random: "Randomize",
          invalidShift: "Use a non-zero whole number of weeks between -5200 and 5200.",
          explicit:
            "Date anonymization is optional and never enabled silently. The selected mode is recorded in every export pack.",
          contents: "Files",
          export: "Share / download 4 files",
          working: "Generating…",
          done: "Pack generated.",
          error: "Export failed. Nothing was shared.",
          caveat:
            "Detection is not a guarantee of complete anonymization. Names, places, dates, and contextual clues may still need manual review.",
          providerTitle: "Intended recipient (the app does not send files automatically)",
          providerTemporary: "ChatGPT Temporary Chat",
          providerRegular: "ChatGPT regular chat",
          providerOther: "Other recipient / native share target",
          providerTemporaryNote: "OpenAI receives the content if you choose to send it. Temporary Chats are not used for model training and may be retained up to 30 days for safety. This app cannot verify which ChatGPT mode is active.",
          providerRegularNote: "OpenAI receives the content if you choose to send it. Turn off 'Improve the model for everyone' in ChatGPT Data Controls if training is unwanted. Regular chats stay in account history until deleted.",
          providerOtherNote: "The receiving app's data use, retention, and training policies may differ. Review them before selecting a destination.",
          providerAck: "I understand that downloading is local but manually sharing these files exposes their content to my selected recipient. This app cannot enforce recipient privacy settings.",
          previewStart: "Generate local preview of 4 exact files",
          previewInfo: "Open each file, inspect its full content locally, and confirm each file. No file is transferred or downloaded by preview.",
          reviewThis: "I reviewed the entire selected file",
          reviewCount: "Files confirmed",
          authorize: "Approve these 4 exact files",
          approved: "Reviewed files approved. Export rechecks the exact output before sharing.",
          stale: "The source, mappings, date mode or intended recipient changed. Generate and review a new preview.",
          previewError: "Preview/review failed: remove remaining sensitive information or revisit the selection.",
        }
      : {
          launch: "ChatGPT 匯出",
          title: "ChatGPT 分析套件",
          local: "套件只在此瀏覽器內產生。",
          close: "關閉",
          high: "仍有高風險識別資訊",
          secrets: "仍有認證秘密資料，請先在本機刪除或遮蔽。這項限制不可略過。",
          medium: "仍有中風險識別資訊",
          blocked: "高風險資訊完成假名化或遮蔽前，匯出會被阻止。請先使用隱私檢查。",
          warning: "中風險項目不會阻止匯出；若 URL、IP、郵遞區號或長 ID 可能識別個人，請先檢查。",
          ready: "套用目前的隱私規則後，未偵測到結構化高風險識別資訊。",
          datePrivacy: "日期隱私",
          exactTitle: "保留精確時間",
          exactBody: "目前的行為。時間序列最完整，但原始日曆日期會保留在匯出中。",
          shiftTitle: "整週平移",
          shiftBody: "所有時間套用相同的整週位移；順序、星期與時間間隔保持不變，位移量不會寫入匯出檔。",
          relativeTitle: "相對日 + 本地時間",
          relativeBody: "將日曆日期替換為 DAY_0001、DAY_0002…，保留本地時鐘與經過時間。",
          weeks: "週數位移",
          random: "隨機",
          invalidShift: "請使用 -5200 到 5200 之間、非 0 的整數週數。",
          explicit: "日期匿名化是選用功能，不會默默啟用；所選模式會記錄在匯出套件中。",
          contents: "檔案",
          export: "分享 / 下載 4 個檔案",
          working: "產生中…",
          done: "套件已產生。",
          error: "匯出失敗，沒有分享任何資料。",
          caveat: "偵測不到不等於完全匿名。姓名、地點、日期與上下文線索仍可能需要人工檢查。",
          providerTitle: "預定收件方（本工具不會自動傳送）",
          providerTemporary: "ChatGPT 臨時對話",
          providerRegular: "ChatGPT 一般對話",
          providerOther: "其他服務／系統分享目標",
          providerTemporaryNote: "若你選擇送出，OpenAI 會收到內容。臨時對話不會用於模型訓練，但可能為安全目的保留最長 30 天。本工具無法確認 ChatGPT 實際模式。",
          providerRegularNote: "若你選擇送出，OpenAI 會收到內容。如不想用於訓練，請先在資料控制關閉「為所有人改善模型」。一般對話會留在帳戶記錄中直到刪除。",
          providerOtherNote: "其他接收服務的資料使用、保留與模型訓練規則可能不同，請在分享前確認。",
          providerAck: "我了解本機下載不代表外部傳送；自行分享檔案會讓接收方取得內容，而本工具無法替我設定接收方的隱私選項。",
          previewStart: "產生 4 份完整檔案的本機預覽",
          previewInfo: "逐份開啟並檢查完整內容，再分別確認。本機預覽不會下載或傳送檔案。",
          reviewThis: "我已檢查此檔案的全部內容",
          reviewCount: "已確認檔案",
          authorize: "核准這 4 份完全一致的檔案",
          approved: "已核准檔案；正式分享前會重新產生並核對內容。",
          stale: "原文、遮蔽規則、日期或收件方有變更，請重新產生預覽並確認。",
          previewError: "預覽／審核失敗，請再確認敏感資訊及檔案內容。",
        };

  const currentSnapshot = standardHandoffSnapshot(
    activeMessages, activePrivacyMappings, selectedDateMode, intendedReceiver, active.id,
  );
  const validPreview = reviewPreview?.snapshot === currentSnapshot ? reviewPreview : null;
  const filesReviewed = Boolean(validPreview &&
    validPreview.files.length === 4 &&
    validPreview.files.every(file => reviewedFileNames.includes(file.name)) &&
    reviewedFileNames.length === 4);
  const canShare = Boolean(approvalEnabled && filesReviewed && providerAcknowledged &&
    shiftValid && audit.highRisk.length === 0 && secretAudit.unmasked === 0 &&
    status !== "working");

  function resetReview() {
    setReviewPreview(null);
    setReviewedFileNames([]);
    setReviewFileIndex(0);
    setApprovalEnabled(false);
    setStatus("idle");
  }

  function generatePreview() {
    resetReview();
    if (!shiftValid || audit.highRisk.length > 0 || secretAudit.unmasked > 0) {
      setStatus("error");
      return;
    }
    try {
      const next = previewStandardHandoff(
        activeMessages, activePrivacyMappings, selectedDateMode, intendedReceiver, active.id,
      );
      setReviewPreview(next);
    } catch {
      // Raw chats/failed matches must never be written to console or telemetry.
      setStatus("error");
    }
  }

  function toggleFileReview(name: string, reviewed: boolean) {
    setApprovalEnabled(false);
    setReviewedFileNames(current => reviewed
      ? [...new Set([...current, name])]
      : current.filter(item => item !== name));
  }

  function authorizeReviewedFiles() {
    setApprovalEnabled(false);
    try {
      approveStandardHandoff(
        activeMessages, activePrivacyMappings, selectedDateMode,
        intendedReceiver, active.id, validPreview,
        reviewedFileNames, providerAcknowledged,
      );
      setApprovalEnabled(true);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function exportPack() {
    if (!canShare || !validPreview) {
      setStatus("error");
      return;
    }

    setStatus("working");
    try {
      const pack = approveStandardHandoff(
        activeMessages, activePrivacyMappings, selectedDateMode,
        intendedReceiver, active.id, validPreview,
        reviewedFileNames, providerAcknowledged,
      );
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
      if (error instanceof StandardHandoffBlockedError) {
        setApprovalEnabled(false);
        setStatus("error");
        return;
      }
      if (error instanceof SecretExportBlockedError) {
        setStatus("error");
        return;
      }
      if (error instanceof ExportBlockedError) {
        setStatus("idle");
        return;
      }
      setStatus("error");
    }
  }

  const highCount = audit.highRisk.length;
  const secretCount = secretAudit.unmasked;
  const mediumCount = audit.mediumRisk.length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStatus("idle");
          setProviderAcknowledged(false);
          resetReview();
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
          <section className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-card-border bg-white p-4 shadow-2xl sm:p-5">
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

            <p className={`mt-3 rounded-xl p-3 text-sm leading-6 ${highCount > 0 || secretCount > 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
              {secretCount > 0 ? text.secrets : highCount > 0 ? text.blocked : text.ready}
            </p>
            {mediumCount > 0 ? (
              <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                {text.warning}
              </p>
            ) : null}

            <div className="mt-4">
              <h3 className="text-sm font-semibold text-accent-deep">
                {text.datePrivacy}
              </h3>
              <p className="mt-1 text-[11px] leading-5 text-muted">{text.explicit}</p>
              <div className="mt-2 space-y-2">
                {(
                  [
                    ["exact", text.exactTitle, text.exactBody],
                    ["shift_weeks", text.shiftTitle, text.shiftBody],
                    ["relative_day", text.relativeTitle, text.relativeBody],
                  ] as const
                ).map(([mode, title, body]) => (
                  <label
                    key={mode}
                    className={`block cursor-pointer rounded-xl border p-3 ${
                      dateModeKind === mode
                        ? "border-accent bg-[#faf5ff]"
                        : "border-card-border bg-[#faf8fc]"
                    }`}
                  >
                    <span className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="export-date-mode"
                        value={mode}
                        checked={dateModeKind === mode}
                        onChange={() => {
                          setDateModeKind(mode);
                          resetReview();
                        }}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-accent-deep">
                          {title}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted">
                          {body}
                        </span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {dateModeKind === "shift_weeks" ? (
                <div className="mt-2 rounded-xl border border-card-border bg-white p-3">
                  <div className="flex items-center gap-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-accent-deep">
                      <span>{text.weeks}</span>
                      <input
                        type="number"
                        min={-5200}
                        max={5200}
                        step={1}
                        value={weekShift}
                        onChange={(event) => {
                          setWeekShift(Number(event.target.value));
                          resetReview();
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-card-border px-2 py-1.5 font-mono text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setWeekShift(randomWeekShift());
                        resetReview();
                      }}
                      className="rounded-full border border-card-border px-3 py-1.5 text-xs font-semibold text-accent-deep hover:border-accent"
                    >
                      {text.random}
                    </button>
                  </div>
                  {!shiftValid ? (
                    <p className="mt-2 text-xs text-rose-700">{text.invalidShift}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

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
            <div className="mt-4 rounded-xl border border-card-border p-3 text-xs">
              <label className="block font-semibold text-accent-deep">
                {text.providerTitle}
                <select value={intendedReceiver}
                  onChange={(event) => {
                    setIntendedReceiver(event.target.value as typeof intendedReceiver);
                    setProviderAcknowledged(false);
                    resetReview();
                  }}
                  className="mt-2 block w-full rounded border border-card-border bg-white p-2 text-sm">
                  <option value="temporary">{text.providerTemporary}</option>
                  <option value="regular">{text.providerRegular}</option>
                  <option value="other">{text.providerOther}</option>
                </select>
              </label>
              <p className="mt-2 leading-5 text-muted">
                {intendedReceiver === "temporary" ? text.providerTemporaryNote :
                  intendedReceiver === "regular" ? text.providerRegularNote : text.providerOtherNote}
              </p>
              <a className="mt-1 inline-block underline" target="_blank" rel="noopener noreferrer"
                href="https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt">OpenAI Data Controls</a>
              <label className="mt-3 flex items-start gap-2 leading-5">
                <input type="checkbox" className="mt-1" checked={providerAcknowledged}
                  onChange={(event) => {
                    setProviderAcknowledged(event.target.checked);
                    setApprovalEnabled(false);
                  }} />
                <span>{text.providerAck}</span>
              </label>
            </div>

            <div className="mt-4 space-y-3 rounded-xl border border-card-border p-3">
              <p className="text-xs leading-5 text-muted">{text.previewInfo}</p>
              <button type="button" onClick={generatePreview}
                disabled={highCount > 0 || secretCount > 0 || !shiftValid || status === "working"}
                className="rounded-full border border-accent px-4 py-2 text-sm font-semibold text-accent-deep disabled:opacity-40">
                {text.previewStart}
              </button>
              {reviewPreview && !validPreview ? (
                <p className="text-xs text-rose-700">{text.stale}</p>
              ) : null}
              {validPreview ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {validPreview.files.map((file, index) => (
                      <button key={file.name} type="button" onClick={() => setReviewFileIndex(index)}
                        aria-pressed={reviewFileIndex === index}
                        className={`break-all rounded-lg border p-2 text-left text-[11px] ${reviewFileIndex === index ? "border-accent bg-[#faf5ff]" : "border-card-border"}`}>
                        {file.name} {reviewedFileNames.includes(file.name) ? "✓" : ""}
                      </button>
                    ))}
                  </div>
                  <label className="block text-xs font-semibold text-accent-deep">
                    {validPreview.files[reviewFileIndex].name}
                    <textarea aria-label="Full selected export file preview" readOnly
                      spellCheck={false} value={validPreview.files[reviewFileIndex].content}
                      className="mt-2 h-64 w-full resize-y rounded-lg border border-card-border bg-[#faf8fc] p-3 font-mono text-xs leading-5"
                    />
                  </label>
                  <label className="flex items-start gap-2 text-xs leading-5">
                    <input type="checkbox" className="mt-1"
                      checked={reviewedFileNames.includes(validPreview.files[reviewFileIndex].name)}
                      onChange={(event) =>
                        toggleFileReview(validPreview.files[reviewFileIndex].name, event.target.checked)}
                    />
                    <span>{text.reviewThis}</span>
                  </label>
                  <p className="text-xs text-muted">{text.reviewCount}: {reviewedFileNames.length}/4</p>
                  <button type="button" onClick={authorizeReviewedFiles}
                    disabled={!filesReviewed || !providerAcknowledged || approvalEnabled}
                    className="rounded-full border border-accent px-4 py-2 text-sm font-semibold text-accent-deep disabled:opacity-40">
                    {text.authorize}
                  </button>
                  {approvalEnabled && canShare ? (
                    <p className="text-xs text-emerald-700">{text.approved}</p>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              {status === "done" ? (
                <span className="text-xs text-emerald-700">{text.done}</span>
              ) : status === "error" ? (
                <span className="text-xs text-rose-700">{text.error}</span>
              ) : null}
              <button
                type="button"
                disabled={!canShare}
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
