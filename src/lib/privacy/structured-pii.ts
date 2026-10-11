import type { ChatMessage } from "@/lib/chat-types";

export type StructuredPiiKind =
  | "credential"
  | "email"
  | "phone"
  | "url"
  | "ipv4"
  | "postal_code"
  | "long_numeric_id";

export type StructuredPiiSeverity = "high" | "medium";

export type StructuredPiiField = "content" | "senderName" | "senderId";

export type StructuredPiiOccurrence = {
  messageId: string;
  field: StructuredPiiField;
  start: number;
  end: number;
};

export type StructuredPiiDetection = {
  id: string;
  kind: StructuredPiiKind;
  severity: StructuredPiiSeverity;
  value: string;
  canonicalValue: string;
  occurrenceCount: number;
  occurrences: StructuredPiiOccurrence[];
};

type Candidate = {
  kind: StructuredPiiKind;
  severity: StructuredPiiSeverity;
  value: string;
  canonicalValue: string;
  start: number;
  end: number;
};

const PRIORITY: Record<StructuredPiiKind, number> = {
  credential: 100,
  email: 90,
  url: 80,
  ipv4: 70,
  phone: 60,
  postal_code: 50,
  long_numeric_id: 10,
};

function stableId(kind: StructuredPiiKind, canonicalValue: string) {
  const input = `${kind}\0${canonicalValue}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${kind}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function candidate(
  kind: StructuredPiiKind,
  severity: StructuredPiiSeverity,
  value: string,
  canonicalValue: string,
  start: number,
): Candidate {
  return {
    kind,
    severity,
    value,
    canonicalValue,
    start,
    end: start + value.length,
  };
}

function emailCandidates(text: string): Candidate[] {
  const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  return [...text.matchAll(regex)].map((match) =>
    candidate(
      "email",
      "high",
      match[0],
      match[0].toLowerCase(),
      match.index ?? 0,
    ),
  );
}

function trimUrl(value: string) {
  return value.replace(/[.,!?;:)}\]}>。、，！？；：」』】）]+$/u, "");
}

function urlCandidates(text: string): Candidate[] {
  const regex = /https?:\/\/[^\s<>"']+/gi;
  const sensitiveParam = /[?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd)=/i;
  return [...text.matchAll(regex)]
    .map((match) => {
      const value = trimUrl(match[0]);
      if (!value) return null;
      const severity: StructuredPiiSeverity = sensitiveParam.test(value)
        ? "high"
        : "medium";
      return candidate(
        "url",
        severity,
        value,
        value,
        match.index ?? 0,
      );
    })
    .filter((item): item is Candidate => item != null);
}

function ipv4Candidates(text: string): Candidate[] {
  const regex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  return [...text.matchAll(regex)]
    .filter((match) =>
      match[0]
        .split(".")
        .every((part) => Number(part) >= 0 && Number(part) <= 255),
    )
    .map((match) =>
      candidate("ipv4", "medium", match[0], match[0], match.index ?? 0),
    );
}

function canonicalPhone(value: string) {
  let compact = value.replace(/[\s()-]/g, "");
  if (compact.startsWith("+81")) compact = `0${compact.slice(3)}`;
  return compact.replace(/-/g, "");
}

function phoneCandidates(text: string): Candidate[] {
  // Intentionally conservative: Japanese domestic numbers and +81 variants.
  const regex = /(?:^|[^\d])((?:\+81[\s-]?(?:\d[\s-]?){9,10}|0\d{1,4}[\s-]?\d{1,4}[\s-]?\d{4}))(?!\d)/g;
  const found: Candidate[] = [];

  for (const match of text.matchAll(regex)) {
    const value = match[1]?.replace(/[\s-]+$/g, "");
    if (!value) continue;
    const canonicalValue = canonicalPhone(value);
    if (!/^0\d{9,10}$/.test(canonicalValue)) continue;
    const withinMatch = match[0].indexOf(match[1]);
    const start = (match.index ?? 0) + Math.max(0, withinMatch);
    found.push(candidate("phone", "high", value, canonicalValue, start));
  }

  return found;
}

function postalCandidates(text: string): Candidate[] {
  const regex = /(?:〒\s*(\d{3}-?\d{4})|\b(\d{3}-\d{4})\b)/g;
  const found: Candidate[] = [];

  for (const match of text.matchAll(regex)) {
    const value = match[1] ?? match[2];
    if (!value) continue;
    const withinMatch = match[0].indexOf(value);
    const start = (match.index ?? 0) + Math.max(0, withinMatch);
    found.push(
      candidate(
        "postal_code",
        "medium",
        value,
        value.replace(/-/g, ""),
        start,
      ),
    );
  }

  return found;
}

function longNumericIdCandidates(text: string): Candidate[] {
  const regex = /(?:^|[^\d])(\d{10,})(?!\d)/g;
  const found: Candidate[] = [];
  for (const match of text.matchAll(regex)) {
    const value = match[1];
    if (!value) continue;
    const withinMatch = match[0].indexOf(value);
    const start = (match.index ?? 0) + Math.max(0, withinMatch);
    found.push(candidate("long_numeric_id", "medium", value, value, start));
  }
  return found;
}

function credentialCandidates(text: string): Candidate[] {
  const found: Candidate[] = [];
  const keyValue = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{12,})["']?/gi;
  const bearer = /\bbearer\s+([A-Za-z0-9._~+/=-]{12,})/gi;
  const jwt = /\b(eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,})\b/g;
  const knownPrefix = /\b((?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}))\b/g;

  for (const regex of [keyValue, bearer, jwt, knownPrefix]) {
    for (const match of text.matchAll(regex)) {
      const value = match[1];
      if (!value) continue;
      const withinMatch = match[0].indexOf(value);
      const start = (match.index ?? 0) + Math.max(0, withinMatch);
      found.push(candidate("credential", "high", value, value, start));
    }
  }

  return found;
}

function overlaps(a: Candidate, b: Candidate) {
  return a.start < b.end && b.start < a.end;
}

function resolveOverlaps(candidates: Candidate[]) {
  const accepted: Candidate[] = [];
  const ranked = [...candidates].sort((a, b) => {
    const priority = PRIORITY[b.kind] - PRIORITY[a.kind];
    if (priority !== 0) return priority;
    const length = b.value.length - a.value.length;
    if (length !== 0) return length;
    return a.start - b.start;
  });

  for (const item of ranked) {
    if (accepted.some((existing) => overlaps(existing, item))) continue;
    accepted.push(item);
  }

  return accepted.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function scanStructuredPiiText(text: string): Candidate[] {
  if (!text) return [];
  return resolveOverlaps([
    ...credentialCandidates(text),
    ...emailCandidates(text),
    ...urlCandidates(text),
    ...ipv4Candidates(text),
    ...phoneCandidates(text),
    ...postalCandidates(text),
    ...longNumericIdCandidates(text),
  ]);
}

function fieldsForMessage(message: ChatMessage) {
  const fields: Array<[StructuredPiiField, string]> = [
    ["content", message.content],
    ["senderName", message.senderName],
  ];
  if (message.senderId !== message.senderName) {
    fields.push(["senderId", message.senderId]);
  }
  return fields;
}

/**
 * Scan messages locally and group repeated values into one review candidate.
 * The raw value remains in memory so the later review UI can show what needs to
 * be replaced, but the deterministic detection id never embeds that raw value.
 */
export function scanStructuredPii(
  messages: readonly ChatMessage[],
): StructuredPiiDetection[] {
  const grouped = new Map<
    string,
    Omit<StructuredPiiDetection, "occurrenceCount"> & {
      occurrences: StructuredPiiOccurrence[];
    }
  >();

  for (const message of messages) {
    for (const [field, text] of fieldsForMessage(message)) {
      for (const item of scanStructuredPiiText(text)) {
        const key = `${item.kind}\0${item.canonicalValue}`;
        const occurrence: StructuredPiiOccurrence = {
          messageId: message.id,
          field,
          start: item.start,
          end: item.end,
        };
        const current = grouped.get(key);
        if (current) {
          current.occurrences.push(occurrence);
          if (item.severity === "high") current.severity = "high";
          continue;
        }
        grouped.set(key, {
          id: stableId(item.kind, item.canonicalValue),
          kind: item.kind,
          severity: item.severity,
          value: item.value,
          canonicalValue: item.canonicalValue,
          occurrences: [occurrence],
        });
      }
    }
  }

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      occurrenceCount: item.occurrences.length,
    }))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return b.occurrenceCount - a.occurrenceCount || a.value.localeCompare(b.value);
    });
}

export function unresolvedHighRiskStructuredPii(
  detections: readonly StructuredPiiDetection[],
  resolvedDetectionIds: ReadonlySet<string> = new Set(),
) {
  return detections.filter(
    (item) => item.severity === "high" && !resolvedDetectionIds.has(item.id),
  );
}

export function hasUnresolvedHighRiskStructuredPii(
  detections: readonly StructuredPiiDetection[],
  resolvedDetectionIds: ReadonlySet<string> = new Set(),
) {
  return unresolvedHighRiskStructuredPii(detections, resolvedDetectionIds).length > 0;
}
