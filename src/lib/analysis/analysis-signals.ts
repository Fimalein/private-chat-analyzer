import type { ChatMessage } from "@/lib/chat-types";

export const ANALYSIS_SIGNAL_KINDS = [
  "conflict",
  "repair",
  "person_attack",
  "distance_breakup",
] as const;

export type AnalysisSignalKind = (typeof ANALYSIS_SIGNAL_KINDS)[number];

export type MessageWithAnalysisSignals<T extends ChatMessage = ChatMessage> = T & {
  analysisSignals: AnalysisSignalKind[];
};

const PHRASES: Record<AnalysisSignalKind, readonly string[]> = {
  conflict: [
    "喧嘩",
    "けんか",
    "怒ってる",
    "怒った",
    "腹立つ",
    "むかつく",
    "ムカつく",
    "許せない",
    "信用できない",
    "嘘つき",
    "なんで無視",
    "無視しないで",
    "we're fighting",
    "we are fighting",
    "i'm angry",
    "im angry",
    "mad at you",
    "can't trust you",
    "cannot trust you",
    "you lied",
    "stop ignoring",
    "吵架",
    "我很生氣",
    "不能相信你",
    "你騙我",
    "不要無視",
  ],
  repair: [
    "ごめん",
    "ごめんなさい",
    "すみません",
    "悪かった",
    "言いすぎた",
    "言い過ぎた",
    "仲直り",
    "許して",
    "i'm sorry",
    "im sorry",
    "sorry about",
    "i apologize",
    "apologize",
    "forgive me",
    "make up",
    "對不起",
    "抱歉",
    "我錯了",
    "原諒我",
    "和好",
  ],
  person_attack: [
    "バカ",
    "ばか",
    "アホ",
    "クズ",
    "最低",
    "うざい",
    "きもい",
    "気持ち悪い",
    "死ね",
    "idiot",
    "stupid",
    "loser",
    "jerk",
    "pathetic",
    "笨蛋",
    "白痴",
    "垃圾",
    "噁心",
    "去死",
  ],
  distance_breakup: [
    "別れよう",
    "別れたい",
    "別れる",
    "距離を置きたい",
    "距離を置こう",
    "もう会わない",
    "連絡しないで",
    "終わりにしよう",
    "一人になりたい",
    "break up",
    "need some space",
    "need space",
    "don't contact me",
    "do not contact me",
    "relationship is over",
    "we're over",
    "we are over",
    "分手",
    "保持距離",
    "需要一點空間",
    "不要聯絡我",
    "別再聯絡",
    "關係結束",
  ],
};

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

const NORMALIZED_PHRASES = Object.fromEntries(
  ANALYSIS_SIGNAL_KINDS.map((kind) => [
    kind,
    PHRASES[kind].map((phrase) => normalize(phrase)),
  ]),
) as Record<AnalysisSignalKind, string[]>;

/**
 * Returns heuristic navigation candidates only. These flags are not labels of
 * intent, abuse, relationship state, or ground truth, and they never call a
 * network service or model.
 */
export function deriveAnalysisSignals(
  message: Pick<ChatMessage, "type" | "content">,
): AnalysisSignalKind[] {
  if (message.type !== "text" || !message.content.trim()) return [];
  const text = normalize(message.content);

  return ANALYSIS_SIGNAL_KINDS.filter((kind) =>
    NORMALIZED_PHRASES[kind].some((phrase) => text.includes(phrase)),
  );
}

export function attachAnalysisSignals<T extends ChatMessage>(
  messages: readonly T[],
): MessageWithAnalysisSignals<T>[] {
  return messages.map((message) => ({
    ...message,
    analysisSignals: deriveAnalysisSignals(message),
  }));
}
