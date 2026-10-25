import { describe, expect, it } from "vitest";
import {
  approveStandardHandoff,
  previewStandardHandoff,
  STANDARD_HANDOFF_FILE_NAMES,
  StandardHandoffBlockedError,
} from "@/lib/export/reviewed-chatgpt-handoff";
import type { ChatGptExportDateMode } from "@/lib/export/chatgpt-pack";
import { SecretExportBlockedError } from "@/lib/privacy/secret-guard";
import {
  SYNTHETIC_EXPORT_MESSAGES,
  SYNTHETIC_EXPORT_MAPPINGS,
} from "../fixtures/synthetic/export-leak-regression";

const raw = SYNTHETIC_EXPORT_MESSAGES;
const mapping = SYNTHETIC_EXPORT_MAPPINGS;
const dateMode: ChatGptExportDateMode = { mode: "relative_day" };
const recipient = "temporary" as const;
const boardId = "synthetic-test-dashboard";

function approvalOptions() {
  const preview = previewStandardHandoff(raw, mapping, dateMode, recipient, boardId);
  return {
    preview,
    reviewed: [...STANDARD_HANDOFF_FILE_NAMES],
  };
}

function approve(
  preview: ReturnType<typeof previewStandardHandoff> | null,
  reviewed: readonly string[],
  opts: {
    messages?: typeof raw;
    mappings?: typeof mapping;
    mode?: ChatGptExportDateMode;
    recipient?: "temporary" | "regular" | "other";
    boardId?: string;
    acknowledged?: boolean;
  } = {},
) {
  return approveStandardHandoff(
    opts.messages ?? raw, opts.mappings ?? mapping, opts.mode ?? dateMode,
    opts.recipient ?? recipient, opts.boardId ?? boardId,
    preview, reviewed, opts.acknowledged ?? true,
  );
}

function reason(run: () => unknown) {
  try {
    run();
    return "NOT_BLOCKED";
  } catch (err) {
    expect(err).toBeInstanceOf(StandardHandoffBlockedError);
    return (err as StandardHandoffBlockedError).reason;
  }
}

describe("standard reviewed LLM handoff (fabricated-only)", () => {
  it("previews all four actual files and allows explicit fully reviewed handoff", () => {
    const { preview, reviewed } = approvalOptions();
    expect(preview.files.map(file => file.name)).toEqual([...STANDARD_HANDOFF_FILE_NAMES]);
    const result = approve(preview, reviewed);
    expect(result.files).toEqual(preview.files);
    expect(result.files.map(file => file.content).join("\n")).not.toContain("TESTTOKEN000000000000");
  });

  it("does not allow a missing preview, partial review, or skipped provider acknowledgement", () => {
    const { preview, reviewed } = approvalOptions();
    expect(reason(() => approve(null, reviewed))).toBe("preview_missing");
    expect(reason(() => approve(preview, reviewed.slice(0, 3)))).toBe("file_review_incomplete");
    expect(reason(() => approve(preview, [...reviewed, reviewed[0]]))).toBe("file_review_incomplete");
    expect(reason(() => approve(preview, reviewed, { acknowledged: false }))).toBe("recipient_not_acknowledged");
  });

  it("invalidates approval on changed recipient, date mode, source dashboard, and mappings", () => {
    const { preview, reviewed } = approvalOptions();
    expect(reason(() => approve(preview, reviewed, { recipient: "regular" }))).toBe("preview_stale");
    expect(reason(() => approve(preview, reviewed, { mode: { mode: "exact" } }))).toBe("preview_stale");
    expect(reason(() => approve(preview, reviewed, { boardId: "different-board" }))).toBe("preview_stale");
    const changedMapping = mapping.map((item, i) =>
      i === 0 ? { ...item, replacement: "PERSON_CHANGED" } : item);
    expect(reason(() => approve(preview, reviewed, { mappings: changedMapping }))).toBe("preview_stale");
    expect(reason(() => approve(preview, reviewed, {
      messages: raw.map((item, i) => i === 0 ? { ...item, content: item.content + " hello" } : item),
    }))).toBe("preview_stale");
  });

  it("rebuilds the four files at authorization and detects a tampered preview", () => {
    const { preview, reviewed } = approvalOptions();
    const tampered = {
      ...preview,
      files: preview.files.map((file, index) =>
        index === 2 ? { ...file, content: file.content + " " } : file),
    };
    expect(reason(() => approve(tampered, reviewed))).toBe("preview_changed");
    expect(reason(() => approve({ ...preview, files: preview.files.slice(0, 3) }, reviewed)))
      .toBe("preview_changed");
  });

  it("uses the shared credential blocker rather than bypassing it for preview", () => {
    const unmasked = raw.map((item, i) => i === 0 ? {
      ...item, content: item.content + "\nCookie: sessionid=FABRICATED_SESSION_987654321",
    } : item);
    expect(() => previewStandardHandoff(unmasked, mapping, dateMode, recipient, boardId))
      .toThrow(SecretExportBlockedError);
  });
});
