import { attachReplyGaps, deriveReplyGaps } from "@/lib/analysis/reply-gaps";
import type { ChatMessage } from "@/lib/chat-types";
import { neutralizeExportSpeakers } from "@/lib/export/observer-speakers";
import { OBSERVER_ANALYSIS_INSTRUCTIONS } from "@/lib/export/observer-instructions";
import { assertNoExportedSecrets, auditUnmaskedSecrets, SecretExportBlockedError } from "@/lib/privacy/secret-guard";
import {
  pseudonymizeMessages,
  scanStructuredPii,
  type EntityMapping,
  type StructuredPiiDetection,
} from "@/lib/privacy";

export type ChatGptExportFile = {
  name: string;
  type: "text/plain" | "application/json" | "application/x-ndjson";
  content: string;
};

export type ChatGptExportAudit = {
  detections: StructuredPiiDetection[];
  highRisk: StructuredPiiDetection[];
  mediumRisk: StructuredPiiDetection[];
};

export type ChatGptExportDateMode =
  | { mode: "exact" }
  | { mode: "shift_weeks"; weeks: number }
  | { mode: "relative_day" };

export type ChatGptExportOptions = {
  dateMode?: ChatGptExportDateMode;
};

export type ChatGptExportPack = {
  files: ChatGptExportFile[];
  audit: ChatGptExportAudit;
};

export class ExportBlockedError extends Error {
  readonly detections: StructuredPiiDetection[];

  constructor(detections: StructuredPiiDetection[]) {
    super("EXPORT_BLOCKED_HIGH_RISK_PII");
    this.name = "ExportBlockedError";
    this.detections = detections;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MAX_SHIFT_WEEKS = 5200;

function sortedMessages(messages: readonly ChatMessage[]) {
  return [...messages].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  );
}

export function prepareExportMessages(
  messages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
) {
  return sortedMessages(pseudonymizeMessages(messages, mappings));
}

export function auditPreparedExport(
  messages: readonly ChatMessage[],
): ChatGptExportAudit {
  const detections = scanStructuredPii(messages);
  return {
    detections,
    highRisk: detections.filter((item) => item.severity === "high"),
    mediumRisk: detections.filter((item) => item.severity === "medium"),
  };
}

function normalizeDateMode(
  dateMode: ChatGptExportDateMode | undefined,
): ChatGptExportDateMode {
  const mode = dateMode ?? { mode: "exact" as const };
  if (mode.mode !== "shift_weeks") return mode;

  if (
    !Number.isSafeInteger(mode.weeks) ||
    mode.weeks === 0 ||
    Math.abs(mode.weeks) > MAX_SHIFT_WEEKS
  ) {
    throw new RangeError(
      `shift_weeks requires a non-zero whole number between -${MAX_SHIFT_WEEKS} and ${MAX_SHIFT_WEEKS}`,
    );
  }
  return mode;
}

function exportMessageId(index: number) {
  return `m_${String(index + 1).padStart(6, "0")}`;
}

function iso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function localDayOrdinal(timestamp: number) {
  const date = new Date(timestamp);
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
  );
}

function localClock(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function makeTimeProjection(
  messages: readonly ChatMessage[],
  dateMode: ChatGptExportDateMode,
) {
  const firstTimestamp = messages[0]?.timestamp ?? 0;
  const firstDayOrdinal = messages[0] ? localDayOrdinal(firstTimestamp) : 0;

  function display(timestamp: number) {
    if (dateMode.mode === "exact") return iso(timestamp);
    if (dateMode.mode === "shift_weeks") {
      return iso(timestamp + dateMode.weeks * WEEK_MS);
    }

    const day = localDayOrdinal(timestamp) - firstDayOrdinal + 1;
    return `DAY_${String(day).padStart(4, "0")} ${localClock(timestamp)}`;
  }

  function epochMs(timestamp: number): number | null {
    if (dateMode.mode === "exact") return timestamp;
    if (dateMode.mode === "shift_weeks") {
      return timestamp + dateMode.weeks * WEEK_MS;
    }
    return null;
  }

  function elapsedMs(timestamp: number): number | null {
    return dateMode.mode === "relative_day" ? timestamp - firstTimestamp : null;
  }

  const metadata =
    dateMode.mode === "exact"
      ? {
          mode: "exact" as const,
          originalDatesRetained: true,
          preservesIntervals: true,
        }
      : dateMode.mode === "shift_weeks"
        ? {
            mode: "shift_weeks" as const,
            originalDatesRetained: false,
            preservesIntervals: true,
            preservesWeekday: true,
            shiftOffsetExported: false,
          }
        : {
            mode: "relative_day" as const,
            originalDatesRetained: false,
            preservesIntervals: true,
            format: "DAY_0001 HH:mm:ss",
            clockBasis: "browser_local",
          };

  return { display, epochMs, elapsedMs, metadata };
}

function dateModeHeader(dateMode: ChatGptExportDateMode) {
  if (dateMode.mode === "exact") return "exact (original dates retained)";
  if (dateMode.mode === "shift_weeks") {
    return "shift_weeks (whole-week offset applied; offset intentionally omitted)";
  }
  return "relative_day (original dates omitted; DAY_0001 + local clock time)";
}

function renderTxt(
  messages: readonly ChatMessage[],
  dateMode: ChatGptExportDateMode,
) {
  const time = makeTimeProjection(messages, dateMode);
  const lines: string[] = [
    "# Anonymized chat transcript",
    "# Generated locally. Full transcript is primary evidence for analysis.",
    "# All speaker labels are neutral; which speaker (if any) supplied this transcript is deliberately unspecified.",
    `# Date mode: ${dateModeHeader(dateMode)}`,
    "",
  ];

  messages.forEach((message, index) => {
    const id = exportMessageId(index);
    lines.push(
      `[${id}] ${time.display(message.timestamp)} ${message.senderName} (${message.type})`,
    );
    if (message.content) lines.push(message.content);
    if (message.type === "call" && message.callDurationMs != null) {
      lines.push(`[callDurationMs=${message.callDurationMs}]`);
    }
    lines.push("");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderJsonl(
  messages: readonly ChatMessage[],
  dateMode: ChatGptExportDateMode,
) {
  const time = makeTimeProjection(messages, dateMode);
  const withGaps = attachReplyGaps(messages);
  return `${withGaps
    .map((message, index) => {
      const timestampMs = time.epochMs(message.timestamp);
      const elapsedMs = time.elapsedMs(message.timestamp);
      return JSON.stringify({
        id: exportMessageId(index),
        dateMode: dateMode.mode,
        timestamp: time.display(message.timestamp),
        ...(timestampMs == null ? {} : { timestampMs }),
        ...(elapsedMs == null ? {} : { elapsedMs }),
        sender: message.senderName,
        type: message.type,
        content: message.content,
        ...(message.callDurationMs == null
          ? {}
          : { callDurationMs: message.callDurationMs }),
        ...(message.replyGapMs == null ? {} : { replyGapMs: message.replyGapMs }),
      });
    })
    .join("\n")}\n`;
}

function buildAnalysisIndex(
  messages: readonly ChatMessage[],
  audit: ChatGptExportAudit,
  dateMode: ChatGptExportDateMode,
) {
  const time = makeTimeProjection(messages, dateMode);
  const messageIndex = new Map(messages.map((message, index) => [message.id, index]));
  const senderCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();

  for (const message of messages) {
    senderCounts.set(message.senderName, (senderCounts.get(message.senderName) ?? 0) + 1);
    typeCounts.set(message.type, (typeCounts.get(message.type) ?? 0) + 1);
  }

  const replyGaps = deriveReplyGaps(messages)
    .filter((gap) => gap.gapMs >= 6 * 60 * 60 * 1000)
    .map((gap, index) => {
      const previousIndex = messageIndex.get(gap.previousMessageId) ?? 0;
      const currentIndex = messageIndex.get(gap.messageId) ?? previousIndex;
      return {
        id: `G${String(index + 1).padStart(4, "0")}`,
        kind: "reply_gap",
        previousMessageId: exportMessageId(previousIndex),
        messageId: exportMessageId(currentIndex),
        gapMs: gap.gapMs,
        fromSender: messages[previousIndex]?.senderName ?? "UNKNOWN",
        toSender: messages[currentIndex]?.senderName ?? "UNKNOWN",
      };
    });

  return {
    schema: "private-chat-analyzer.analysis-index.v1",
    generatedLocally: true,
    sourceLabel: "CHAT_EXPORT",
    uploaderSpeaker: "NOT_PROVIDED",
    speakerLabelPolicy: "role_blind",
    primaryEvidence: "chat_redacted.txt",
    navigationOnly: true,
    dateAnonymization: time.metadata,
    stats: {
      messageCount: messages.length,
      senderMessageCounts: Object.fromEntries(senderCounts),
      messageTypeCounts: Object.fromEntries(typeCounts),
      firstTimestamp: messages[0] ? time.display(messages[0].timestamp) : null,
      lastTimestamp: messages.at(-1)
        ? time.display(messages.at(-1)!.timestamp)
        : null,
      exportAudit: {
        unresolvedHighRisk: audit.highRisk.length,
        remainingMediumRisk: audit.mediumRisk.length,
      },
    },
    candidateWindows: replyGaps,
    disclaimer:
      "This index is a navigation aid, not ground truth. Verify claims against the full anonymized transcript and inspect context outside candidate windows when needed.",
  };
}

function renderInstructions(dateMode: ChatGptExportDateMode) {
  return `ChatGPT analysis instructions\n\n${OBSERVER_ANALYSIS_INSTRUCTIONS}\n\nDate anonymization mode: ${dateModeHeader(dateMode)}.\n\n1. Treat chat_redacted.txt as the primary evidence. Read the full anonymized transcript when the task requires relationship, conflict, intent, or chronology analysis.\n2. analysis_index.json is only a navigation aid. Candidate windows and derived gaps are not conclusions or labels of truth.\n3. Verify context around any indexed event before making a claim. Search outside candidate windows when necessary.\n4. Do not infer or attempt to recover real identities behind placeholders such as PERSON_A, EMAIL_1, LOCATION_1, or similar tokens.\n5. State counting/classification criteria explicitly when producing quantitative claims.\n6. Anonymization may remove or generalize context. Distinguish direct evidence from interpretation and mention uncertainty where relevant.\n7. Date anonymization preserves ordering and reply-gap durations, but shifted or relative timestamps must not be interpreted as original calendar dates.\n8. The export was scanned locally for structured high-risk identifiers immediately before generation, but detection is not a guarantee of complete anonymization.\n`;
}

export function buildChatGptExportPack(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
  options: ChatGptExportOptions = {},
): ChatGptExportPack {
  const dateMode = normalizeDateMode(options.dateMode);
  const messages = prepareExportMessages(rawMessages, mappings);
  if (auditUnmaskedSecrets(rawMessages, messages).unmasked > 0) {
    throw new SecretExportBlockedError();
  }
  const audit = auditPreparedExport(messages);

  if (audit.highRisk.length > 0) {
    throw new ExportBlockedError(audit.highRisk);
  }

  const observerMessages = neutralizeExportSpeakers(messages);
  const index = buildAnalysisIndex(observerMessages, audit, dateMode);

  const files: ChatGptExportFile[] = [
      {
        name: "chat_redacted.txt",
        type: "text/plain",
        content: renderTxt(observerMessages, dateMode),
      },
      {
        name: "chat_redacted.jsonl",
        type: "application/x-ndjson",
        content: renderJsonl(observerMessages, dateMode),
      },
      {
        name: "analysis_index.json",
        type: "application/json",
        content: `${JSON.stringify(index, null, 2)}\n`,
      },
      {
        name: "ChatGPT_analysis_instructions.txt",
        type: "text/plain",
        content: renderInstructions(dateMode),
      },
    ];
  assertNoExportedSecrets(rawMessages, messages, files);
  return { audit, files };
}
