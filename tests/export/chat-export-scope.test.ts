import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  InvalidChatExportScopeError,
  localHandoffContextId,
  selectChatExportScope,
} from "@/lib/export/chat-export-scope";
import {
  previewStandardHandoff,
  approveStandardHandoff,
  StandardHandoffBlockedError,
  STANDARD_HANDOFF_FILE_NAMES,
} from "@/lib/export/reviewed-chatgpt-handoff";

const day0 = new Date(2026, 9, 5, 12, 0, 0).getTime();
const input: ChatMessage[] = Array.from({ length: 33 }, (_, index) => ({
  id: "synthetic-" + index,
  senderId: "PERSON_A",
  senderName: "PERSON_A",
  timestamp: day0 + index * 86400000,
  content: "FABRICATED_MESSAGE_" + index,
  type: "text",
  platform: "line",
}));

describe("deterministic local export scope", () => {
  it("defaults can be restricted to 25, 100, 500, or 2000 most recent", () => {
    const shuffled = [...input].reverse();
    const recent = selectChatExportScope(shuffled, { mode: "recent", count: 25 });
    expect(recent).toHaveLength(25);
    expect(recent[0].id).toBe("synthetic-8");
    expect(recent.at(-1)?.id).toBe("synthetic-32");
    expect(recent.every(m => !m.content.includes("FABRICATED_MESSAGE_0"))).toBe(true);
    expect(selectChatExportScope(shuffled, { mode: "recent", count: 100 })).toHaveLength(33);
    expect(selectChatExportScope(shuffled, { mode: "recent", count: 500 })).toHaveLength(33);
    expect(selectChatExportScope(shuffled, { mode: "recent", count: 2000 })).toHaveLength(33);
  });

  it("selects an inclusive local calendar range without exporting adjacent days", () => {
    const beginning = new Date(day0);
    const day = (offset: number) => {
      const date = new Date(beginning);
      date.setDate(date.getDate() + offset);
      const y = date.getFullYear();
      return `${y}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    const result = selectChatExportScope(input, {
      mode: "dates", startDate: day(4), endDate: day(6),
    });
    expect(result.map(m => m.id)).toEqual(["synthetic-4", "synthetic-5", "synthetic-6"]);
  });

  it("fails closed on invalid dates, empty selection, inverted dates and unsupported counts", () => {
    const invalid = [
      { mode: "dates", startDate: "2026-02-30", endDate: "2026-03-01" },
      { mode: "dates", startDate: "2026-11-05", endDate: "2026-10-01" },
      { mode: "dates", startDate: "2025-01-01", endDate: "2025-02-01" },
      { mode: "dates", startDate: "", endDate: "2026-10-01" },
      { mode: "recent", count: 900000 },
      { mode: "totally_unknown" },
    ];
    for (const scope of invalid) {
      expect(() => selectChatExportScope(input, scope as Parameters<typeof selectChatExportScope>[1]))
        .toThrow(InvalidChatExportScopeError);
    }
    expect(() => selectChatExportScope([], { mode: "all" })).toThrow(InvalidChatExportScopeError);
  });

  it("explicit all is the only scope that includes the complete imported transcript", () => {
    expect(selectChatExportScope(input, { mode: "recent", count: 25 })).toHaveLength(25);
    expect(selectChatExportScope(input, { mode: "all" })).toHaveLength(33);
  });

  it("binds approval to scope and even changes outside the selected excerpt", () => {
    const scope = { mode: "recent" as const, count: 25 as const };
    const selected = selectChatExportScope(input, scope);
    const context = localHandoffContextId("FABRICATED_BOARD", input, scope);
    const dateMode = { mode: "relative_day" as const };
    const preview = previewStandardHandoff(selected, [], dateMode, "temporary", context);
    expect(preview.files.find(f => f.name === "chat_redacted.txt")?.content)
      .not.toContain("FABRICATED_MESSAGE_0");
    const reviewed = [...STANDARD_HANDOFF_FILE_NAMES];
    expect(approveStandardHandoff(selected, [], dateMode, "temporary",
      context, preview, reviewed, true).files).toEqual(preview.files);

    const widened = { mode: "all" as const };
    const differentContext = localHandoffContextId("FABRICATED_BOARD", input, widened);
    expect(() => approveStandardHandoff(input, [], dateMode, "temporary",
      differentContext, preview, reviewed, true)).toThrow(StandardHandoffBlockedError);

    const changedOutside = input.map((m, i) => i === 0
      ? { ...m, content: "SYNTHETIC_CHANGED_ONLY_OUTSIDE_SCOPE" } : m);
    const stillSelected = selectChatExportScope(changedOutside, scope);
    expect(stillSelected).toEqual(selected);
    const staleContext = localHandoffContextId("FABRICATED_BOARD", changedOutside, scope);
    expect(() => approveStandardHandoff(stillSelected, [], dateMode, "temporary",
      staleContext, preview, reviewed, true)).toThrow(StandardHandoffBlockedError);
  });
});
