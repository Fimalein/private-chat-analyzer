import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  attachAnalysisSignals,
  deriveAnalysisSignals,
} from "@/lib/analysis/analysis-signals";

// SYNTHETIC_FIXTURE: all messages below are fabricated for deterministic tests.
function message(id: string, content: string, type: ChatMessage["type"] = "text"): ChatMessage {
  return {
    id,
    timestamp: Date.UTC(2026, 0, 1, 0, Number(id.replace(/\D/g, "")) || 0),
    senderId: "PERSON_A",
    senderName: "PERSON_A",
    content,
    platform: "line",
    type,
  };
}

describe("analysis signals", () => {
  it("flags fabricated conflict, repair, person-attack and distance/breakup candidates", () => {
    expect(deriveAnalysisSignals(message("m1", "信用できない。怒ってる"))).toEqual([
      "conflict",
    ]);
    expect(deriveAnalysisSignals(message("m2", "ごめん、言い過ぎた"))).toEqual([
      "repair",
    ]);
    expect(deriveAnalysisSignals(message("m3", "バカ。最低"))).toEqual([
      "person_attack",
    ]);
    expect(deriveAnalysisSignals(message("m4", "別れたい。距離を置きたい"))).toEqual([
      "distance_breakup",
    ]);
  });

  it("can attach more than one candidate signal without mutating the source", () => {
    const source = [message("m5", "ごめん。でも別れたい")];
    const attached = attachAnalysisSignals(source);

    expect(attached[0].analysisSignals).toEqual(["repair", "distance_breakup"]);
    expect(source[0]).not.toHaveProperty("analysisSignals");
  });

  it("leaves neutral and non-text messages unflagged", () => {
    expect(deriveAnalysisSignals(message("m6", "明日の予定は10時で大丈夫"))).toEqual([]);
    expect(deriveAnalysisSignals(message("m7", "別れたい", "system"))).toEqual([]);
  });

  it("normalizes full-width and case variants before matching", () => {
    expect(deriveAnalysisSignals(message("m8", "ＩＭ ＳＯＲＲＹ"))).toContain("repair");
    expect(deriveAnalysisSignals(message("m9", "BREAK UP"))).toContain(
      "distance_breakup",
    );
  });
});
