"use client";

import { useMemo, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useLocale } from "@/components/LocaleProvider";
import {
  auditPreparedExport,
  buildChatGptExportPack,
  ExportBlockedError,
  prepareExportMessages,
  type ChatGptExportDateMode,
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
          medium: "未処理の中リスク識別情報",
          blocked: "高リスクの識別情報が匿名化または削除されるまで書き出せません。「プライバシー確認」を完了してください。",
          warning: "中リスク情報は自動的に書き出しを停止しません。URL、IPアドレス、郵便番号、長い識別番号などから個人を特定できないか確認してください。",
          ready: "現在のマスキング設定適用後、対応する高リスクの構造化識別情報は検出されませんでした。",
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
          export: "4ファイルを共有／ダウンロード",
          working: "生成中…",
          done: "ファイルを生成しました。",
          error: "書き出しに失敗しました。ファイルは共有されていません。",
          caveat: "自動検出は完全な匿名化を保証しません。名前・場所・日時・会話の内容から人物が分かる場合があります。必ず目視確認してください。",
        }
      : locale === "en"
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
        };

  async function exportPack() {
    if (!shiftValid) {
      setStatus("error");
      return;
    }

    setStatus("working");
    try {
      const pack = buildChatGptExportPack(activeMessages, activePrivacyMappings, {
        dateMode: selectedDateMode,
      });
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

            <p className={`mt-3 rounded-xl p-3 text-sm leading-6 ${highCount > 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
              {highCount > 0 ? text.blocked : text.ready}
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
                          setStatus("idle");
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
                          setStatus("idle");
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-card-border px-2 py-1.5 font-mono text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setWeekShift(randomWeekShift());
                        setStatus("idle");
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

            <div className="mt-5 flex items-center justify-end gap-3">
              {status === "done" ? (
                <span className="text-xs text-emerald-700">{text.done}</span>
              ) : status === "error" ? (
                <span className="text-xs text-rose-700">{text.error}</span>
              ) : null}
              <button
                type="button"
                disabled={highCount > 0 || !shiftValid || status === "working"}
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
