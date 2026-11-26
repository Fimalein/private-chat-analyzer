import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import { buildChatGptExportPack } from "@/lib/export/chatgpt-pack";
import { previewStandardHandoff, approveStandardHandoff, STANDARD_HANDOFF_FILE_NAMES } from "@/lib/export/reviewed-chatgpt-handoff";
import { compareObserverJudgments } from "@/lib/export/observer-comparison";

const raw: ChatMessage[] = [
  { id: "fake-1", senderId: "PERSON_A", senderName: "PERSON_A", timestamp: 1000, platform: "line", type: "text", content: "PERSON_Bへ。休みたい。" },
  { id: "fake-2", senderId: "PERSON_B", senderName: "PERSON_B", timestamp: 25000000, platform: "line", type: "text", content: "PERSON_Aへ。今すぐ返事して。" },
];
const date = { mode: "relative_day" } as const;
const ids = ["m_000001", "m_000002"];
function answer(a: number, b: number, higherConcern: string, swapped = false) {
  return JSON.stringify({ caseId: "observer-review", requesterIdentity: "unknown",
    people: { PERSON_A: { concernLevel: a, evidenceMessageIds: a ? [ids[swapped ? 1 : 0]] : [] },
      PERSON_B: { concernLevel: b, evidenceMessageIds: b ? [ids[swapped ? 0 : 1]] : [] } }, higherConcern });
}
describe("observer comparison (fabricated only)", () => {
  it("swaps metadata and body references while keeping IDs, timestamps and instructions identical", () => {
    const a = buildChatGptExportPack(raw, [], {dateMode: date, observerVariant: "original"});
    const b = buildChatGptExportPack(raw, [], {dateMode: date, observerVariant: "swapped"});
    const rows = (pack: typeof a) => pack.files[1].content.trim().split("\n").map(line => JSON.parse(line));
    expect(rows(b).map(r => r.sender)).toEqual(["PERSON_B", "PERSON_A"]);
    expect(rows(b)[0].content).toBe("PERSON_Aへ。休みたい。");
    expect(rows(b).map(r => r.id)).toEqual(rows(a).map(r => r.id));
    expect(rows(b).map(r => r.timestamp)).toEqual(rows(a).map(r => r.timestamp));
    expect(b.files[0].content).toContain("PERSON_Aへ。休みたい。");
    expect(JSON.parse(b.files[2].content).candidateWindows[0].fromSender).toBe("PERSON_B");
    expect(a.files[3].content).toBe(b.files[3].content);
    expect(a.files[3].content).toContain("observer-review");
    expect(raw[0].content).toBe("PERSON_Bへ。休みたい。");
  });
  it("requires exactly two A/B speakers and separate approval for each variant", () => {
    expect(() => buildChatGptExportPack(raw.slice(0,1), [], {observerVariant: "swapped"})).toThrow();
    const preview = previewStandardHandoff(raw, [], date, "temporary", "fake", "original");
    expect(() => approveStandardHandoff(raw, [], date, "temporary", "fake", preview, STANDARD_HANDOFF_FILE_NAMES, true, "swapped")).toThrow();
    const swapped = previewStandardHandoff(raw, [], date, "temporary", "fake", "swapped");
    expect(approveStandardHandoff(raw, [], date, "temporary", "fake", swapped, STANDARD_HANDOFF_FILE_NAMES, true, "swapped").files).toEqual(swapped.files);
  });
  it("accepts role-mapped agreement, but flags conclusion and evidence differences", () => {
    expect(compareObserverJudgments(answer(0,3,"PERSON_B"),answer(4,0,"PERSON_A",true),ids).consistent).toBe(true);
    expect(compareObserverJudgments(answer(1,2,"PERSON_B"),answer(2,2,"undetermined",true),ids).flags).toContain("label_sensitive_conclusion");
    expect(compareObserverJudgments(answer(0,3,"PERSON_B"),answer(3,0,"PERSON_A",false),ids).flags).toContain("evidence_selection_differs");
    expect(compareObserverJudgments(answer(3,0,"PERSON_B"),answer(0,3,"PERSON_A",true),ids).flags).toContain("conclusion_score_contradiction");
    expect(compareObserverJudgments(answer(0,3,"PERSON_B"),answer(3,0,"PERSON_A",true),ids.slice(0,1)).flags).toContain("unsupported_evidence_ids");
    expect(() => compareObserverJudgments("{}", "{}", ids)).toThrow();
  });
});
