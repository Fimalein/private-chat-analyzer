import { attachReplyGaps, deriveReplyGaps } from "@/lib/analysis/reply-gaps";
import type { ChatMessage } from "@/lib/chat-types";
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

function exportMessageId(index: number) {
  return `m_${String(index + 1).padStart(6, "0")}`;
}

function iso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function renderTxt(messages: readonly ChatMessage[]) {
  const lines: string[] = [
    "# Anonymized chat transcript",
    "# Generated locally. Full transcript is primary evidence for analysis.",
    "",
  ];

  messages.forEach((message, index) => {
    const id = exportMessageId(index);
    lines.push(`[${id}] ${iso(message.timestamp)} ${message.senderName} (${message.type})`);
    if (message.content) lines.push(message.content);
    if (message.type === "call" && message.callDurationMs != null) {
      lines.push(`[callDurationMs=${message.callDurationMs}]`);
    }
    lines.push("");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderJsonl(messages: readonly ChatMessage[]) {
  const withGaps = attachReplyGaps(messages);
  return `${withGaps
    .map((message, index) =>
      JSON.stringify({
        id: exportMessageId(index),
        timestamp: iso(message.timestamp),
        timestampMs: message.timestamp,
        sender: message.senderName,
        type: message.type,
        content: message.content,
        ...(message.callDurationMs == null
          ? {}
          : { callDurationMs: message.callDurationMs }),
        ...(message.replyGapMs == null ? {} : { replyGapMs: message.replyGapMs }),
      }),
    )
    .join("\n")}\n`;
}

function buildAnalysisIndex(
  messages: readonly ChatMessage[],
  audit: ChatGptExportAudit,
) {
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
        fromSender: gap.fromSenderId,
        toSender: gap.toSenderId,
      };
    });

  return {
    schema: "private-chat-analyzer.analysis-index.v1",
    generatedLocally: true,
    sourceLabel: "CHAT_EXPORT",
    primaryEvidence: "chat_redacted.txt",
    navigationOnly: true,
    stats: {
      messageCount: messages.length,
      senderMessageCounts: Object.fromEntries(senderCounts),
      messageTypeCounts: Object.fromEntries(typeCounts),
      firstTimestamp: messages[0] ? iso(messages[0].timestamp) : null,
      lastTimestamp: messages.at(-1) ? iso(messages.at(-1)!.timestamp) : null,
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

function renderInstructions() {
  return `ChatGPT analysis instructions\n\n1. Treat chat_redacted.txt as the primary evidence. Read the full anonymized transcript when the task requires relationship, conflict, intent, or chronology analysis.\n2. analysis_index.json is only a navigation aid. Candidate windows and derived gaps are not conclusions or labels of truth.\n3. Verify context around any indexed event before making a claim. Search outside candidate windows when necessary.\n4. Do not infer or attempt to recover real identities behind placeholders such as PERSON_A, EMAIL_1, LOCATION_1, or similar tokens.\n5. State counting/classification criteria explicitly when producing quantitative claims.\n6. Anonymization may remove or generalize context. Distinguish direct evidence from interpretation and mention uncertainty where relevant.\n7. The export was scanned locally for structured high-risk identifiers immediately before generation, but detection is not a guarantee of complete anonymization.\n`;
}

export function buildChatGptExportPack(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
): ChatGptExportPack {
  const messages = prepareExportMessages(rawMessages, mappings);
  const audit = auditPreparedExport(messages);

  if (audit.highRisk.length > 0) {
    throw new ExportBlockedError(audit.highRisk);
  }

  const index = buildAnalysisIndex(messages, audit);

  return {
    audit,
    files: [
      {
        name: "chat_redacted.txt",
        type: "text/plain",
        content: renderTxt(messages),
      },
      {
        name: "chat_redacted.jsonl",
        type: "application/x-ndjson",
        content: renderJsonl(messages),
      },
      {
        name: "analysis_index.json",
        type: "application/json",
        content: `${JSON.stringify(index, null, 2)}\n`,
      },
      {
        name: "ChatGPT_analysis_instructions.txt",
        type: "text/plain",
        content: renderInstructions(),
      },
    ],
  };
}
