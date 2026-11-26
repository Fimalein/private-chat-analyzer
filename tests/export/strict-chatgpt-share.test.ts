import { describe, expect, it } from "vitest";
import {
  buildStrictChatGptSharePack,
  StrictShareBlockedError,
  type StrictShareOptions,
} from "@/lib/export/strict-chatgpt-share";
import { buildChatGptExportPack } from "@/lib/export/chatgpt-pack";
import {
  SYNTHETIC_EXPORT_MAPPINGS,
  SYNTHETIC_EXPORT_MESSAGES,
  SYNTHETIC_EXPORT_RAW_VALUES,
  SYNTHETIC_EXPORT_SENSITIVE,
} from "../fixtures/synthetic/export-leak-regression";

const strict: StrictShareOptions = {
  dateMode: { mode: "relative_day" },
  confirmedHumanReview: true,
  knownSensitiveValues: SYNTHETIC_EXPORT_RAW_VALUES,
};

function blockedReason(operation: () => unknown) {
  try {
    operation();
    return "not_blocked";
  } catch (error) {
    expect(error).toBeInstanceOf(StrictShareBlockedError);
    return (error as StrictShareBlockedError).reason;
  }
}

describe("buildStrictChatGptSharePack (synthetic-only)", () => {
  it("requires an explicit manual-review signal and non-exact dates", () => {
    expect(blockedReason(() => buildStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
      { ...strict, confirmedHumanReview: false } as unknown as StrictShareOptions,
    ))).toBe("manual_review_required");
    expect(blockedReason(() => buildStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
      { ...strict, dateMode: { mode: "exact" } } as unknown as StrictShareOptions,
    ))).toBe("relative_date_required");
    expect(blockedReason(() => buildStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS,
      { ...strict, knownSensitiveValues: [] },
    ))).toBe("known_values_required");
  });

  it("rejects medium-risk identifiers that the legacy export would permit", () => {
    const withoutPostalMapping = SYNTHETIC_EXPORT_MAPPINGS.filter(
      (mapping) => mapping.source !== SYNTHETIC_EXPORT_SENSITIVE.postalCode,
    );
    const legacy = buildChatGptExportPack(
      SYNTHETIC_EXPORT_MESSAGES, withoutPostalMapping, {
        dateMode: { mode: "relative_day" },
      },
    );
    expect(legacy.audit.mediumRisk.some((finding) => finding.kind === "postal_code")).toBe(true);
    expect(blockedReason(() => buildStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, withoutPostalMapping, strict,
    ))).toBe("unresolved_structured_pii");
  });

  it("blocks a known name or context value missed by the structured scanner", () => {
    const withoutSchoolMapping = SYNTHETIC_EXPORT_MAPPINGS.filter(
      (mapping) => mapping.source !== SYNTHETIC_EXPORT_SENSITIVE.school,
    );
    expect(blockedReason(() => buildStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, withoutSchoolMapping, strict,
    ))).toBe("known_sensitive_value_survived");
  });

  it("builds only after synthetic identifiers are mapped, and never serializes denylist", () => {
    const pack = buildStrictChatGptSharePack(
      SYNTHETIC_EXPORT_MESSAGES, SYNTHETIC_EXPORT_MAPPINGS, strict,
    );
    expect(pack.files.map((f) => f.name)).toEqual([
      "chat_redacted.txt", "chat_redacted.jsonl",
      "analysis_index.json", "ChatGPT_analysis_instructions.txt",
    ]);
    const output = pack.files.map((f) => f.content).join("\n");
    expect(output).toContain("DAY_0001");
    expect(output).not.toContain("2026-01-01");
    for (const value of SYNTHETIC_EXPORT_RAW_VALUES) {
      expect(output).not.toContain(value);
    }
    expect(pack.audit.detections).toHaveLength(0);
  });

  it("rejects a locally supplied sensitive alias unknown to the mappings", () => {
    const rawAlias = "合成だけの私的コードネーム";
    const messages = [{
      ...SYNTHETIC_EXPORT_MESSAGES[0],
      content: SYNTHETIC_EXPORT_MESSAGES[0].content + " " + rawAlias,
    }];
    expect(blockedReason(() => buildStrictChatGptSharePack(
      messages, SYNTHETIC_EXPORT_MAPPINGS,
      { ...strict, knownSensitiveValues: [...strict.knownSensitiveValues, rawAlias] },
    ))).toBe("known_sensitive_value_survived");
  });
});
