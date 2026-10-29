"use client";

import { useMemo, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useLocale } from "@/components/LocaleProvider";
import { createChatStoryZip } from "@/lib/export/zip-pack";
import {
  auditPreparedExport,
  ExportBlockedError,
  prepareExportMessages,
  type ChatGptExportDateMode,
  type ChatGptExportFile,
} from "@/lib/export/chatgpt-pack";
import { auditUnmaskedSecrets, SecretExportBlockedError } from "@/lib/privacy/secret-guard";
import {
  localHandoffContextId,
  selectChatExportScope,
  type ChatExportScope,
  type RecentExportCount,
} from "@/lib/export/chat-export-scope";
import {
  approveStandardHandoff,
  previewStandardHandoff,
  standardHandoffSnapshot,
  StandardHandoffBlockedError,
  type StandardHandoffPreview,
} from "@/lib/export/reviewed-chatgpt-handoff";

function downloadZip(files: readonly ChatGptExportFile[]) {
  const zip = createChatStoryZip(files);
  const blob = new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ChatStory_analysis_pack.zip";
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
  const [scopeMode, setScopeMode] = useState<ChatExportScope["mode"]>("recent");
  const [recentCount, setRecentCount] = useState<RecentExportCount>(25);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const active = dashboards.find((board) => board.id === activeId);
  const exportScope: ChatExportScope = scopeMode === "recent"
    ? { mode: "recent", count: recentCount }
    : scopeMode === "dates"
      ? { mode: "dates", startDate: rangeStart, endDate: rangeEnd }
      : { mode: "all" };
  const selectedMessages = useMemo(() => {
    if (!active || active.kind === "default") return [];
    try { return selectChatExportScope(active.messages, exportScope); }
    catch { return []; } // Invalid date/empty selection: fail closed.
  }, [active, scopeMode, recentCount, rangeStart, rangeEnd]);
  const prepared = useMemo(
    () => prepareExportMessages(selectedMessages, activePrivacyMappings),
    [selectedMessages, activePrivacyMappings],
  );
  const audit = useMemo(() => auditPreparedExport(prepared), [prepared]);
  const secretAudit = useMemo(() => {
    try { return auditUnmaskedSecrets(selectedMessages, prepared); }
    catch { return { unmasked: 1 }; } // Fail closed on oversized/uninspectable input.
  }, [selectedMessages, prepared]);

  if (!active || active.kind === "default" || active.messages.length === 0) return null;
  const activeMessages = selectedMessages;
  const scopeValid = selectedMessages.length > 0;
  const dashboardId = localHandoffContextId(active.id, active.messages, exportScope);

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
    locale === "ja"
      ? {
          launch: "ChatGPT用に書き出す",
          title: "ChatGPT分析用ファイル",
          local: "ファイルはこのブラウザ内で作成します。",
          close: "閉じる",
          high: "未処理の高リスク識別情報",
          secrets: "認証情報が残っています。共有前に端末内で削除またはマスキングしてください。このブロックは解除できません。",
          medium: "未処理の中リスク識別情報",
          blocked: "高リスクの識別情報が匿名化または削除されるまで書き出せません。「プライバシー確認」を完了してください。",
          warning: "中リスク情報は自動的に書き出しを停止しません。URL、IPアドレス、郵便番号、長い識別番号などから個人を特定できないか確認してください。",
          ready: "現在のマスキング設定適用後、対応する高リスクの構造化識別情報は検出されませんでした。",
          rangeTitle: "共有するメッセージの範囲",
          recentOption: "最新のメッセージ",
          recentCount: "件数",
          datesOption: "日付で指定（両端を含む）",
          startDate: "開始日",
          endDate: "終了日",
          allOption: "読み込んだ全件（明示的な選択が必要）",
          rangeCount: "対象メッセージ数",
          rangeInvalid: "日付が不正か、対象メッセージがありません。書き出しできません。",
          rangeCaution: "選択したメッセージだけが書き出しとプライバシー検査の対象です。全件は初期選択されません。前後の文脈が評価に影響する可能性があります。",
          datePrivacy: "日時の扱い",
          exactTitle: "元の日時を維持",
          exactBody: "時系列の精度を保てますが、実際の日付が書き出されます。",
          shiftTitle: "週単位で日付を移動",
          shiftBody: "すべての日時を同じ週数だけ移動します。順序・曜日・経過時間を保ち、移動量自体は出力しません。",
          relativeTitle: "相対日付と時刻",
          relativeBody: "日付を DAY_0001、DAY_0002 などに置き換えます。時刻と時間間隔は保持します。",
          weeks: "移動する週数",
          random: "ランダム",
          invalidShift: "-5200〜5200の間で、0以外の整数週を指定してください。",
          explicit: "日付の匿名化は任意です。選んだ方式は出力ファイルに記録されます。",
          contents: "出力ファイル",
          export: "承認済み4ファイルを共有／ZIP保存",
          working: "生成中…",
          done: "共有が完了したか、ZIP保存を開始しました。ブラウザのダウンロードを確認してください。",
          error: "書き出しに失敗しました。ファイルは共有されていません。",
          caveat: "自動検出は完全な匿名化を保証しません。名前・場所・日時・会話の内容から人物が分かる場合があります。必ず目視確認してください。",
          providerTitle: "共有先を選択（アプリから自動送信しません）",
          providerTemporary: "ChatGPT 一時チャット",
          providerRegular: "ChatGPT 通常チャット",
          providerOther: "その他の共有先／共有メニュー",
          providerTemporaryNote: "送信を選んだ場合、OpenAIが内容を受信します。一時チャットはモデルの学習に利用されず、安全管理のため最大30日保持される場合があります。このアプリでは実際のChatGPTのモードを確認できません。",
          providerRegularNote: "送信を選んだ場合、OpenAIが内容を受信します。学習に利用されたくない場合はChatGPTのデータコントロールで「すべての人のためにモデルを改善する」をオフにしてください。通常チャットは削除するまで履歴に残ります。",
          providerOtherNote: "共有先のデータ利用・保存期間・学習方針は異なる場合があります。送信前にご確認ください。",
          providerAck: "ダウンロードは端末内の操作ですが、手動で共有すると選択した共有先にファイルの内容が渡ることを理解しました。このアプリは共有先のプライバシー設定を管理できません。",
          previewStart: "4ファイルの全文プレビューを作成",
          previewInfo: "各ファイルを開いて端末内で全文を確認し、個別に承認してください。プレビューだけではダウンロードや送信は行いません。",
          reviewThis: "このファイルの全文を確認しました",
          reviewCount: "確認済みのファイル",
          authorize: "この4ファイルの内容を承認する",
          approved: "確認済みのファイルを承認しました。共有直前に同一内容であることを再検証します。",
          stale: "元データ、マスキング、日時設定または共有先が変わりました。プレビューを再作成して確認してください。",
          previewError: "プレビュー／承認に失敗しました。残っている識別情報と選択範囲を確認してください。",
        }
      : locale === "en"
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
          rangeTitle: "Choose messages to share",
          recentOption: "Most recent messages",
          recentCount: "Messages",
          datesOption: "Local calendar date range (inclusive)",
          startDate: "From",
          endDate: "Through",
          allOption: "Entire imported transcript — explicit choice",
          rangeCount: "Selected messages",
          rangeInvalid: "No messages in this range or invalid dates. Nothing can be exported.",
          rangeCaution: "Only the selected messages enter export and privacy scans. Older messages can contain additional context; the full imported transcript is never selected by default.",
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
          export: "Share or download one ZIP",
          working: "Generating…",
          done: "Sharing finished or ZIP download started. Check browser downloads.",
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
          rangeTitle: "選擇要分享的訊息範圍",
          recentOption: "最近的訊息",
          recentCount: "訊息筆數",
          datesOption: "按本地日期範圍（含首尾）",
          startDate: "從",
          endDate: "至",
          allOption: "整份已匯入對話（必須主動選擇）",
          rangeCount: "已選擇訊息",
          rangeInvalid: "日期無效或範圍內沒有訊息，禁止匯出。",
          rangeCaution: "只有選定訊息會進入分享與隱私掃描；全部訊息並非預設選項，其他內容可能影響分析。",
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
          export: "分享或下載單一 ZIP（內含 4 檔）",
          working: "產生中…",
          done: "已完成分享或啟動 ZIP 下載，請檢查瀏覽器下載。",
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
    activeMessages, activePrivacyMappings, selectedDateMode, intendedReceiver, dashboardId,
  );
  const validPreview = reviewPreview?.snapshot === currentSnapshot ? reviewPreview : null;
  const filesReviewed = Boolean(validPreview &&
    validPreview.files.length === 4 &&
    validPreview.files.every(file => reviewedFileNames.includes(file.name)) &&
    reviewedFileNames.length === 4);
  const canShare = Boolean(approvalEnabled && filesReviewed && providerAcknowledged &&
    shiftValid && scopeValid && audit.highRisk.length === 0 && secretAudit.unmasked === 0 &&
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
    if (!shiftValid || !scopeValid || audit.highRisk.length > 0 || secretAudit.unmasked > 0) {
      setStatus("error");
      return;
    }
    try {
      const next = previewStandardHandoff(
        activeMessages, activePrivacyMappings, selectedDateMode, intendedReceiver, dashboardId,
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
        intendedReceiver, dashboardId, validPreview,
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
        intendedReceiver, dashboardId, validPreview,
        reviewedFileNames, providerAcknowledged,
      );
      const files = pack.files.map(
        (file) => new File([file.content], file.name, { type: file.type }),
      );
      const shareData: ShareData = { files };

      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        // Avoid four sequential downloads being silently blocked by browsers.
        downloadZip(pack.files);
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
          setScopeMode("recent");
          setRecentCount(25);
          setRangeStart("");
          setRangeEnd("");
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

            <div className="mt-4 rounded-xl border border-card-border p-3">
              <h3 className="text-sm font-semibold text-accent-deep">{text.rangeTitle}</h3>
              <p className="mt-1 text-xs leading-5 text-muted">{text.rangeCaution}</p>
              <label className="mt-3 block text-xs font-semibold text-accent-deep">
                {text.rangeTitle}
                <select aria-label="Export message scope" value={scopeMode}
                  className="mt-1 block w-full rounded-lg border border-card-border bg-white p-2 text-sm"
                  onChange={event => {
                    setScopeMode(event.target.value as ChatExportScope["mode"]);
                    resetReview();
                  }}>
                  <option value="recent">{text.recentOption}</option>
                  <option value="dates">{text.datesOption}</option>
                  <option value="all">{text.allOption}</option>
                </select>
              </label>
              {scopeMode === "recent" ? (
                <label className="mt-3 block text-xs font-semibold text-accent-deep">
                  {text.recentCount}
                  <select aria-label="Recent message count" value={recentCount}
                    className="mt-1 block w-full rounded-lg border border-card-border bg-white p-2 text-sm"
                    onChange={event => {
                      setRecentCount(Number(event.target.value) as RecentExportCount);
                      resetReview();
                    }}>
                    {[25, 100, 500, 2000].map(count => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {scopeMode === "dates" ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="text-xs font-semibold text-accent-deep">
                    {text.startDate}
                    <input type="date" aria-label="Export start date" value={rangeStart}
                      className="mt-1 block w-full min-w-0 rounded-lg border border-card-border bg-white p-2 text-sm"
                      onChange={event => { setRangeStart(event.target.value); resetReview(); }} />
                  </label>
                  <label className="text-xs font-semibold text-accent-deep">
                    {text.endDate}
                    <input type="date" aria-label="Export end date" value={rangeEnd}
                      className="mt-1 block w-full min-w-0 rounded-lg border border-card-border bg-white p-2 text-sm"
                      onChange={event => { setRangeEnd(event.target.value); resetReview(); }} />
                  </label>
                </div>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                {text.rangeCount}: {selectedMessages.length} / {active.messages.length}
              </p>
              {!scopeValid ? <p className="mt-2 text-xs text-rose-700">{text.rangeInvalid}</p> : null}
            </div>

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
                disabled={highCount > 0 || secretCount > 0 || !shiftValid || !scopeValid || status === "working"}
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
