import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  buildChatGptExportPack,
  ExportBlockedError,
  type ChatGptExportDateMode,
} from "@/lib/export/chatgpt-pack";
import type { EntityMapping } from "@/lib/privacy";
import { SecretExportBlockedError } from "@/lib/privacy/secret-guard";
import {
  SYNTHETIC_EXPORT_MAPPINGS,
  SYNTHETIC_EXPORT_MESSAGES,
  SYNTHETIC_EXPORT_RAW_VALUES,
  SYNTHETIC_EXPORT_SENSITIVE,
} from "../fixtures/synthetic/export-leak-regression";

function msg(
  id: string,
  timestamp: number,
  senderName: string,
  content: string,
): ChatMessage {
  return {
    id,
    timestamp,
    senderId: senderName,
    senderName,
    content,
    platform: "line",
    type: "text",
  };
}

const messages = [
  msg("raw-1", Date.UTC(2026, 0, 1, 0, 0), "呼び名A", "連絡先は fake.user@example.test"),
  msg("raw-2", Date.UTC(2026, 0, 1, 7, 0), "呼び名B", "了解です"),
];

const mappings: EntityMapping[] = [
  { source: "呼び名A", replacement: "PERSON_A", kind: "person" },
  { source: "呼び名B", replacement: "PERSON_B", kind: "person" },
  {
    source: "fake.user@example.test",
    replacement: "EMAIL_1",
    kind: "secret",
  },
];

function fileContent(
  pack: ReturnType<typeof buildChatGptExportPack>,
  name: string,
) {
  return pack.files.find((file) => file.name === name)!.content;
}

function jsonlRecords(pack: ReturnType<typeof buildChatGptExportPack>) {
  return fileContent(pack, "chat_redacted.jsonl")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("buildChatGptExportPack", () => {
  it("blocks export when transformed output still contains high-risk PII", () => {
    expect(() => buildChatGptExportPack(messages, mappings.slice(0, 2))).toThrow(
      ExportBlockedError,
    );
  });

  it("generates the four expected artifacts after high-risk PII is removed", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    expect(pack.audit.highRisk).toHaveLength(0);
    expect(pack.files.map((file) => file.name)).toEqual([
      "chat_redacted.txt",
      "chat_redacted.jsonl",
      "analysis_index.json",
      "ChatGPT_analysis_instructions.txt",
    ]);
  });

  it("never serializes source mapping values when those values were replaced", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    const serialized = pack.files.map((file) => file.content).join("\n");

    expect(serialized).not.toContain("呼び名A");
    expect(serialized).not.toContain("呼び名B");
    expect(serialized).not.toContain("fake.user@example.test");
    expect(serialized).toContain("PERSON_A");
    expect(serialized).toContain("EMAIL_1");
  });

  it("emits one valid JSON object per message with export-safe sequential ids", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    const records = jsonlRecords(pack);

    expect(records).toHaveLength(2);
    expect(records[0].id).toBe("m_000001");
    expect(records[1].id).toBe("m_000002");
    expect(records[0]).not.toHaveProperty("sourceLine");
    expect(records[0]).not.toHaveProperty("senderId");
  });

  it("keeps the analysis index metadata-only and points back to the full transcript", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    const indexFile = pack.files.find((file) => file.name === "analysis_index.json")!;
    const index = JSON.parse(indexFile.content);

    expect(index.navigationOnly).toBe(true);
    expect(index.primaryEvidence).toBe("chat_redacted.txt");
    expect(index.sourceLabel).toBe("CHAT_EXPORT");
    expect(index.candidateWindows).toHaveLength(1);
    expect(index.candidateWindows[0].kind).toBe("reply_gap");
    expect(indexFile.content).not.toContain("了解です");
    expect(indexFile.content).not.toContain("連絡先は");
  });

  it("states that the transcript is primary evidence and the index is only navigation", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    const instructions = pack.files.find(
      (file) => file.name === "ChatGPT_analysis_instructions.txt",
    )!;
    expect(instructions.content).toContain("primary evidence");
    expect(instructions.content).toContain("only a navigation aid");
  });

  it("keeps exact timestamps by default and records that choice", () => {
    const pack = buildChatGptExportPack(messages, mappings);
    const records = jsonlRecords(pack);
    const index = JSON.parse(fileContent(pack, "analysis_index.json"));
    const txt = fileContent(pack, "chat_redacted.txt");

    expect(records[0].dateMode).toBe("exact");
    expect(records[0].timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(records[0].timestampMs).toBe(Date.UTC(2026, 0, 1, 0, 0));
    expect(index.dateAnonymization.mode).toBe("exact");
    expect(index.dateAnonymization.originalDatesRetained).toBe(true);
    expect(txt).toContain("Date mode: exact");
  });

  it("shifts dates by a fixed whole-week offset without changing ordering or reply gaps", () => {
    const pack = buildChatGptExportPack(messages, mappings, {
      dateMode: { mode: "shift_weeks", weeks: 8 },
    });
    const records = jsonlRecords(pack);
    const indexFile = fileContent(pack, "analysis_index.json");
    const index = JSON.parse(indexFile);
    const txt = fileContent(pack, "chat_redacted.txt");
    const instructions = fileContent(pack, "ChatGPT_analysis_instructions.txt");

    expect(records[0].dateMode).toBe("shift_weeks");
    expect(records[0].timestamp).toBe("2026-02-26T00:00:00.000Z");
    expect(records[1].timestamp).toBe("2026-02-26T07:00:00.000Z");
    expect(records[1].replyGapMs).toBe(7 * 60 * 60 * 1000);
    expect(records.map((record) => record.id)).toEqual(["m_000001", "m_000002"]);
    expect(index.dateAnonymization).toEqual({
      mode: "shift_weeks",
      originalDatesRetained: false,
      preservesIntervals: true,
      preservesWeekday: true,
      shiftOffsetExported: false,
    });
    expect(index.dateAnonymization).not.toHaveProperty("weeks");
    expect(index.stats.firstTimestamp).toBe("2026-02-26T00:00:00.000Z");
    expect(txt).not.toContain("2026-01-01T00:00:00.000Z");
    expect(indexFile).not.toContain("2026-01-01T00:00:00.000Z");
    expect(instructions).not.toContain("8 weeks");
  });

  it("can omit original calendar dates with relative-day timestamps while preserving elapsed durations", () => {
    const relativeMessages = [
      ...messages,
      msg(
        "raw-3",
        Date.UTC(2026, 0, 2, 1, 30),
        "呼び名A",
        "翌日のメッセージ",
      ),
    ];
    const pack = buildChatGptExportPack(relativeMessages, mappings, {
      dateMode: { mode: "relative_day" },
    });
    const records = jsonlRecords(pack);
    const protectedContents = [
      fileContent(pack, "chat_redacted.txt"),
      fileContent(pack, "chat_redacted.jsonl"),
      fileContent(pack, "analysis_index.json"),
    ].join("\n");
    const index = JSON.parse(fileContent(pack, "analysis_index.json"));

    expect(records[0].dateMode).toBe("relative_day");
    expect(records[0].timestamp).toMatch(/^DAY_0001 /);
    expect(records[2].timestamp).toMatch(/^DAY_0002 /);
    expect(records[0]).not.toHaveProperty("timestampMs");
    expect(records[0].elapsedMs).toBe(0);
    expect(records[1].elapsedMs).toBe(7 * 60 * 60 * 1000);
    expect(records[1].replyGapMs).toBe(7 * 60 * 60 * 1000);
    expect(index.dateAnonymization.mode).toBe("relative_day");
    expect(index.dateAnonymization.originalDatesRetained).toBe(false);
    expect(index.stats.firstTimestamp).toMatch(/^DAY_0001 /);
    expect(index.stats.lastTimestamp).toMatch(/^DAY_0002 /);
    expect(protectedContents).not.toContain("2026-01-01");
    expect(protectedContents).not.toContain("2026-01-02");
    expect(protectedContents).not.toContain(String(Date.UTC(2026, 0, 1, 0, 0)));
  });

  it.each([
    { mode: "shift_weeks", weeks: 0 },
    { mode: "shift_weeks", weeks: 1.5 },
    { mode: "shift_weeks", weeks: 5201 },
  ] as ChatGptExportDateMode[])(
    "rejects invalid whole-week shift configuration %#",
    (dateMode) => {
      expect(() =>
        buildChatGptExportPack(messages, mappings, { dateMode }),
      ).toThrow(RangeError);
    },
  );

  it("removes every configured synthetic sensitive source from every export artifact", () => {
    const pack = buildChatGptExportPack(
      SYNTHETIC_EXPORT_MESSAGES,
      SYNTHETIC_EXPORT_MAPPINGS,
    );
    const protectedArtifacts = pack.files.filter((file) =>
      ["chat_redacted.txt", "chat_redacted.jsonl", "analysis_index.json"].includes(
        file.name,
      ),
    );

    expect(pack.audit.highRisk).toHaveLength(0);

    for (const file of protectedArtifacts) {
      for (const rawValue of SYNTHETIC_EXPORT_RAW_VALUES) {
        expect(
          file.content,
          `${file.name} leaked configured synthetic source value: ${rawValue}`,
        ).not.toContain(rawValue);
      }

      for (const mapping of SYNTHETIC_EXPORT_MAPPINGS) {
        expect(
          file.content,
          `${file.name} serialized source side of entity mapping: ${mapping.source}`,
        ).not.toContain(mapping.source);
      }
    }

    const allArtifacts = pack.files.map((file) => file.content).join("\n");
    expect(allArtifacts).not.toContain("synthetic-raw-1");
    expect(allArtifacts).not.toContain("synthetic-raw-2");

    for (const mapping of SYNTHETIC_EXPORT_MAPPINGS) {
      expect(allArtifacts).toContain(mapping.replacement);
    }
  });

  it("fails loudly when the configured synthetic credential survives anonymization", () => {
    const mappingsWithoutCredential = SYNTHETIC_EXPORT_MAPPINGS.filter(
      (mapping) => mapping.source !== SYNTHETIC_EXPORT_SENSITIVE.secret,
    );

    expect(() => buildChatGptExportPack(
      SYNTHETIC_EXPORT_MESSAGES, mappingsWithoutCredential,
    )).toThrow(SecretExportBlockedError);
  });
});
