"use client";

import { useState } from "react";
import type { ChatGptExportFile } from "@/lib/export/chatgpt-pack";
import { compareObserverJudgments } from "@/lib/export/observer-comparison";

const flagLabels: Record<string, string> = {
  invalid_response_shape: "JSON形式が不正",
  requester_side_inferred: "依頼者を断定",
  unsupported_evidence_ids: "根拠IDが不正または不足",
  label_sensitive_scores: "懸念度の差が2点以上",
  label_sensitive_conclusion: "話者入替後の結論が不一致",
  conclusion_score_contradiction: "点数と結論が矛盾",
  evidence_selection_differs: "引用した根拠が不一致",
};

export function ObserverComparisonPanel({ locale, files }: {
  locale: string; files: readonly ChatGptExportFile[];
}) {
  const ja = locale === "ja";
  const [original, setOriginal] = useState("");
  const [swapped, setSwapped] = useState("");
  const [result, setResult] = useState<ReturnType<typeof compareObserverJudgments> | null>(null);
  const [error, setError] = useState(false);
  function compare() {
    setError(false);
    setResult(null);
    try {
      const jsonl = files.find(file => file.name === "chat_redacted.jsonl");
      if (!jsonl) throw new Error("MISSING_JSONL");
      const ids = jsonl.content.trim().split("\n").map(line => {
        const row = JSON.parse(line);
        if (typeof row.id !== "string" || !/^m_\d{6,}$/.test(row.id)) throw new Error("INVALID_ID");
        return row.id as string;
      });
      setResult(compareObserverJudgments(original, swapped, ids));
    } catch { setError(true); }
  }
  return (
    <section className="mt-4 space-y-3 rounded-xl border border-card-border p-3 text-xs">
      <h3 className="font-semibold text-accent-deep">{ja ? "2つの分析結果を端末内で比較" : "Compare two judgments locally"}</h3>
      <p className="leading-5 text-muted">{ja ? "同じ範囲・設定の通常版と入替版を別々のチャットで分析したJSONを貼り付けてください。入力は保存・送信されません。別の会話や設定の回答は自動判別できません。一致しても中立性や事実の正しさを保証しません。" : "Paste JSON from separate sessions for the same scope and settings. Nothing is saved or sent. This cannot verify provenance, impartiality or factual correctness."}</p>
      {([[original, setOriginal, ja ? "通常版のJSON" : "Original JSON"], [swapped, setSwapped, ja ? "入替版のJSON" : "Swapped JSON"]] as const).map(([value, setter, label], i) => (
        <label key={i} className="block">{label}
          <textarea autoComplete="off" spellCheck={false} maxLength={1000000} value={value} onChange={e => {
            setter(e.target.value); setResult(null); setError(false);
          }} className="mt-1 h-24 w-full rounded border border-card-border p-2 font-mono" />
        </label>
      ))}
      <button type="button" disabled={!original.trim() || !swapped.trim()} onClick={compare} className="rounded-full border border-accent px-3 py-2 disabled:opacity-40">{ja ? "比較する" : "Compare"}</button>
      {error && <p role="alert" className="text-rose-700">{ja ? "比較できません。指定のJSON形式を確認してください。" : "Cannot compare: check the required JSON format."}</p>}
      {result && <div role="status" className="space-y-2">
        <p className={result.consistent ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>{result.consistent ? (ja ? "比較基準内で一致（正しさの保証ではない）" : "Within comparison criteria (not a guarantee of correctness)") : (ja ? "不一致・不正な回答あり。優劣の断定を保留してください。" : "Disagreement or invalid evidence: withhold ranking.")}</p>
        {result.rows.map(row => <p key={row.role}>{row.role}: {row.original} / {row.swapped} {ja ? "（元の役割で比較）" : "(role-mapped)"}</p>)}
        {result.flags.map(flag => <p key={flag}>{ja ? (flagLabels[flag] ?? flag) : flag}</p>)}
      </div>}
    </section>
  );
}
