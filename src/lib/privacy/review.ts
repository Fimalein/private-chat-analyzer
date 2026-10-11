import type { ChatMessage } from "@/lib/chat-types";
import type {
  StructuredPiiDetection,
  StructuredPiiField,
  StructuredPiiKind,
} from "@/lib/privacy/structured-pii";

export type PrivacyReviewAction = "pseudonymize" | "redact" | "ignore";

export type PrivacyReviewDecision = {
  detectionId: string;
  action: PrivacyReviewAction;
  replacement?: string;
};

export type PrivacyReviewDecisionMap = Record<string, PrivacyReviewDecision>;

export type PrivacySampleContext = {
  messageId: string;
  field: StructuredPiiField;
  senderName: string;
  timestamp: number;
  snippet: string;
};

const PREFIX_BY_KIND: Record<StructuredPiiKind, string> = {
  credential: "CREDENTIAL",
  email: "EMAIL",
  phone: "PHONE",
  url: "URL",
  ipv4: "IP",
  postal_code: "POSTAL",
  long_numeric_id: "ID",
};

export function structuredPiiPrefix(kind: StructuredPiiKind) {
  return PREFIX_BY_KIND[kind];
}

export function redactPlaceholder(kind: StructuredPiiKind) {
  return `[REDACTED_${PREFIX_BY_KIND[kind]}]`;
}

export function nextStructuredPiiReplacement(
  kind: StructuredPiiKind,
  occupiedReplacements: Iterable<string>,
) {
  const prefix = PREFIX_BY_KIND[kind];
  const occupied = new Set(occupiedReplacements);
  let index = 1;
  while (occupied.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

function fieldText(message: ChatMessage, field: StructuredPiiField) {
  if (field === "content") return message.content;
  if (field === "senderName") return message.senderName;
  return message.senderId;
}

export function sampleContextsForDetection(
  detection: StructuredPiiDetection,
  messages: readonly ChatMessage[],
  maxSamples = 3,
  radius = 48,
): PrivacySampleContext[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const samples: PrivacySampleContext[] = [];
  const seen = new Set<string>();

  for (const occurrence of detection.occurrences) {
    if (samples.length >= maxSamples) break;
    const message = byId.get(occurrence.messageId);
    if (!message) continue;
    const dedupeKey = `${message.id}\0${occurrence.field}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const text = fieldText(message, occurrence.field);
    const start = Math.max(0, occurrence.start - radius);
    const end = Math.min(text.length, occurrence.end + radius);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < text.length ? "…" : "";

    samples.push({
      messageId: message.id,
      field: occurrence.field,
      senderName: message.senderName,
      timestamp: message.timestamp,
      snippet: `${prefix}${text.slice(start, end)}${suffix}`,
    });
  }

  return samples;
}

export function reviewSummary(
  detections: readonly StructuredPiiDetection[],
  decisions: PrivacyReviewDecisionMap,
) {
  let reviewed = 0;
  let unresolvedHigh = 0;

  for (const detection of detections) {
    if (decisions[detection.id]) reviewed += 1;
    else if (detection.severity === "high") unresolvedHigh += 1;
  }

  return {
    total: detections.length,
    reviewed,
    unreviewed: detections.length - reviewed,
    unresolvedHigh,
  };
}
