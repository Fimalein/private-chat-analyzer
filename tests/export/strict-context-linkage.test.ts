import { describe, expect, it } from "vitest";
import { approveStrictChatGptSharePack, previewStrictChatGptSharePack, StrictShareBlockedError,
  STRICT_CONTEXT_REVIEW_CATEGORIES } from "@/lib/export/strict-chatgpt-share";
import { SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
  SYNTHETIC_EXPORT_RAW_VALUES } from "../fixtures/synthetic/export-leak-regression";

// The combination of a made-up award, school and schedule can reveal a
// pseudonymized participant even when none is separately recognized as PII.
const linkedMessages = SYNTHETIC_EXPORT_MESSAGES.map((m, i) => ({
  ...m, content: m.content + (i ?
    " 架空青雲クラブで星空賞を受賞した。" :
    " 毎週火曜夜に架空青雲クラブへ行く。"),
}));
const opts = { dateMode: { mode: "relative_day" as const },
  knownSensitiveValues: SYNTHETIC_EXPORT_RAW_VALUES, confirmedHumanReview: true as const };
const preview = previewStrictChatGptSharePack(linkedMessages, SYNTHETIC_EXPORT_MAPPINGS, opts);
const files = preview.files.map((f) => f.name);
describe("manual contextual linkage review (synthetic-only)", () => {
  it("requires manual review of all four contextual categories", () => {
    for (const incomplete of [[], STRICT_CONTEXT_REVIEW_CATEGORIES.slice(0, 3)]) {
      try {
        approveStrictChatGptSharePack(linkedMessages, SYNTHETIC_EXPORT_MAPPINGS,
          opts, preview.files, files, incomplete);
        throw new Error("expected blocked");
      } catch (error) {
        expect(error).toBeInstanceOf(StrictShareBlockedError);
        expect((error as StrictShareBlockedError).reason).toBe("context_review_incomplete");
      }
    }
  });
  it("regenerates the same four files only after all explicit reviews", () => {
    const pack = approveStrictChatGptSharePack(linkedMessages, SYNTHETIC_EXPORT_MAPPINGS,
      opts, preview.files, files, STRICT_CONTEXT_REVIEW_CATEGORIES);
    expect(pack.files).toEqual(preview.files);
    // This passing check is NOT an anonymity guarantee: the output
    // deliberately still contains the fictitious cross-message clues.
    expect(pack.files[0].content).toContain("架空青雲クラブ");
  });
});
