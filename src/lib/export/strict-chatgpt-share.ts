import type { ChatMessage } from "@/lib/chat-types";
import {
  auditPreparedExport,
  buildChatGptExportPack,
  prepareExportMessages,
  type ChatGptExportDateMode,
  type ChatGptExportFile,
  type ChatGptExportPack,
} from "@/lib/export/chatgpt-pack";
import { scanStructuredPiiText, type EntityMapping } from "@/lib/privacy";

/**
 * Opt-in local preflight, NOT an anonymity guarantee. Never send source
 * mappings, denylist entries, or messages to a server.
 */
export type StrictSharePreviewOptions = {
  dateMode: Exclude<ChatGptExportDateMode, { mode: "exact" }>;
  knownSensitiveValues: readonly string[];
};

export type StrictShareOptions = StrictSharePreviewOptions & {
  confirmedHumanReview: true;
};

export type StrictShareBlockedReason =
  | "manual_review_required"
  | "context_review_incomplete"
  | "file_review_incomplete"
  | "preview_changed"
  | "relative_date_required"
  | "known_values_required"
  | "empty_selection"
  | "unmasked_participant"
  | "unresolved_structured_pii"
  | "invalid_serialized_artifact"
  | "serialized_structured_pii"
  | "known_sensitive_value_survived";

export class StrictShareBlockedError extends Error {
  readonly reason: StrictShareBlockedReason;

  constructor(reason: StrictShareBlockedReason) {
    super("STRICT_CHATGPT_SHARE_BLOCKED");
    this.name = "StrictShareBlockedError";
    this.reason = reason;
    // Never serialize a matching original value into an error.
  }
}

function normalizeForInspection(value: string) {
  // Zero-width formatting controls must not be a trivial denylist bypass.
  return value.normalize("NFKC").replace(/[\u200b-\u200d\u2060\ufeff]/g, "");
}

function sourceSensitiveValues(
  known: readonly string[],
  mappings: readonly EntityMapping[],
) {
  const values = [...known, ...mappings.map((mapping) => mapping.source)];
  return [...new Set(
    values.filter((value) => typeof value === "string" && value.trim().length >= 1)
      .map(normalizeForInspection)
      .filter((value) => value.trim().length >= 1),
  )];
}

function decodedStrings(value: unknown, depth = 0): string[] {
  if (depth > 5) {
    throw new StrictShareBlockedError("invalid_serialized_artifact");
  }
  if (typeof value === "string") {
    const values = [value];
    // Some exported fields are JSON-as-text. Examine parsed inner content
    // rather than relying only on the literal backslash-escaped bytes.
    const head = value.trimStart()[0];
    if (head === "{" || head === "[") {
      try {
        const parsed: unknown = JSON.parse(value);
        values.push(...decodedStrings(parsed, depth + 1));
      } catch (error) {
        if (error instanceof StrictShareBlockedError) throw error;
        // An ordinary user sentence can begin with "{". Keep scanning it.
      }
    }
    return values;
  }
  if (Array.isArray(value)) return value.flatMap((child) => decodedStrings(child, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      [key, ...decodedStrings(child, depth + 1)]);
  }
  return [];
}

// Best-effort bounded decoding is for *detecting* leaks, never for output.
// If a potential encoded string cannot be safely inspected, block rather than
// claiming a successful inspection. This does not cover arbitrary ciphers.
const MAX_INSPECTION_CHARS = 8_000_000;
const HEX_ESCAPE = /\\u([0-9a-fA-F]{4})/g;
const HTML_CHAR_REF = /&#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}));/gi;
const HTML_NAMED = /&(amp|lt|gt|quot|apos|commat|period|sol|colon|num);/gi;
const NAMED_CHAR: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  commat: "@", period: ".", sol: "/", colon: ":", num: "#",
};

function decodeHtmlReferences(value: string): string {
  return value.replace(HTML_CHAR_REF, (match, hex: string | undefined, decimal: string | undefined) => {
    const point = Number.parseInt(hex ?? decimal ?? "0", hex ? 16 : 10);
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff &&
      !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
  }).replace(HTML_NAMED, (_, name: string) => NAMED_CHAR[name.toLowerCase()] ?? "&" + name + ";");
}

function encodedInspectionVariants(value: string): string[] {
  const seen = new Set<string>([normalizeForInspection(value)]);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const input of [...seen]) {
      const candidates: string[] = [
        input.replace(HEX_ESCAPE, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
        decodeHtmlReferences(input),
      ];
      if (/%[0-9a-f]{2}/i.test(input)) {
        try { candidates.push(decodeURIComponent(input)); } catch {
          // Decode URI-encoded runs embedded in otherwise ordinary prose.
          candidates.push(input.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
            try { return decodeURIComponent(run); } catch { return run; }
          }));
        }
      }
      for (const candidate of candidates) {
        const normalized = normalizeForInspection(candidate);
        if (normalized.length > MAX_INSPECTION_CHARS) {
          throw new StrictShareBlockedError("invalid_serialized_artifact");
        }
        seen.add(normalized);
      }
    }
  }
  return [...seen];
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Inspect BOTH literal bytes and decoded serialized string values. */
export function inspectStrictSerializedFiles(
  files: readonly ChatGptExportFile[],
  sensitiveValues: readonly string[],
): void {
  const sensitive = [...new Set(sensitiveValues.map(normalizeForInspection))]
    .filter((value) => value.length >= 1);
  const encodedSensitive = sensitive.filter((value) => value.length >= 4)
    .map(base64Utf8);
  for (const file of files) {
    if (file.content.length > MAX_INSPECTION_CHARS) {
      throw new StrictShareBlockedError("invalid_serialized_artifact");
    }
    let strings = [file.content];
    try {
      if (file.type === "application/json") {
        strings = [file.content, ...decodedStrings(JSON.parse(file.content))];
      } else if (file.type === "application/x-ndjson") {
        const records = file.content.split(/\r?\n/).filter((line) => line.trim());
        strings = [file.content, ...records.flatMap((record) => decodedStrings(JSON.parse(record)))];
      } else if (file.type !== "text/plain") {
        throw new StrictShareBlockedError("invalid_serialized_artifact");
      }
    } catch (error) {
      if (error instanceof StrictShareBlockedError) throw error;
      throw new StrictShareBlockedError("invalid_serialized_artifact");
    }
    for (const string of strings) {
      for (const normalized of encodedInspectionVariants(string)) {
        if (scanStructuredPiiText(normalized).length > 0) {
          throw new StrictShareBlockedError("serialized_structured_pii");
        }
        if (sensitive.some((value) => normalized.includes(value)) ||
            encodedSensitive.some((value) => normalized.includes(value))) {
          throw new StrictShareBlockedError("known_sensitive_value_survived");
        }
      }
    }
  }
}

function inspectPack(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
  options: StrictSharePreviewOptions,
): ChatGptExportPack {
  if (!options?.dateMode || !["shift_weeks", "relative_day"].includes(options.dateMode.mode)) {
    throw new StrictShareBlockedError("relative_date_required");
  }
  if (!rawMessages.length) {
    throw new StrictShareBlockedError("empty_selection");
  }
  if (!options.knownSensitiveValues?.some((value) => typeof value === "string" && value.trim().length >= 1)) {
    throw new StrictShareBlockedError("known_values_required");
  }

  const prepared = prepareExportMessages(rawMessages, mappings);
  const preparedById = new Map(prepared.map((message) => [message.id, message]));
  for (const raw of rawMessages) {
    const safe = preparedById.get(raw.id);
    // Sender information is repeated across every exported message and index.
    // Treat unchanged imported participant names or IDs as a hard blocker,
    // even if the structured scanner finds no obvious phone/email/address.
    if (!safe || !raw.senderName.trim() || !raw.senderId.trim() ||
        safe.senderName === raw.senderName || safe.senderId === raw.senderId) {
      throw new StrictShareBlockedError("unmasked_participant");
    }
  }
  if (auditPreparedExport(prepared).detections.length > 0) {
    throw new StrictShareBlockedError("unresolved_structured_pii");
  }
  const pack = buildChatGptExportPack(rawMessages, mappings, {
    dateMode: options.dateMode,
  });
  inspectStrictSerializedFiles(pack.files, sourceSensitiveValues(options.knownSensitiveValues, mappings));
  return pack;
}

/**
 * Local-only preview. Caller MUST NOT share/download its output. Every file
 * needs a subsequent human check and fresh preflight before any transfer.
 */
export function previewStrictChatGptSharePack(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
  options: StrictSharePreviewOptions,
): ChatGptExportPack {
  return inspectPack(rawMessages, mappings, options);
}

/**
 * Final strict API requires an explicit user review decision. A boolean is not
 * cryptographic proof; caller must show the COMPLETE files for human review.
 */
export function buildStrictChatGptSharePack(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
  options: StrictShareOptions,
): ChatGptExportPack {
  if (options?.confirmedHumanReview !== true) {
    throw new StrictShareBlockedError("manual_review_required");
  }
  return inspectPack(rawMessages, mappings, options);
}

export const STRICT_CONTEXT_REVIEW_CATEGORIES = [
  "places_education_work",
  "rare_events",
  "relationships_sensitive_context",
  "cross_message_timing_linkage",
] as const;
export type StrictContextReviewCategory = typeof STRICT_CONTEXT_REVIEW_CATEGORIES[number];
/**
 * A release decision is bound to the exact files displayed to the reviewer.
 * Any change in messages, sentence masking, mapping, denylist, or dates must
 * cause the regenerated output to differ and therefore fail closed.
 *
 * Reviewing files here is an explicit user action, not a proof of anonymity.
 */
export function approveStrictChatGptSharePack(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
  options: StrictShareOptions,
  previewFiles: readonly ChatGptExportFile[],
  reviewedFileNames: readonly string[],
  reviewedContextCategories: readonly StrictContextReviewCategory[] = [],
): ChatGptExportPack {
  if (!STRICT_CONTEXT_REVIEW_CATEGORIES.every((category) =>
    reviewedContextCategories.includes(category)
  )) {
    throw new StrictShareBlockedError("context_review_incomplete");
  }
  const expected = [
    "chat_redacted.txt",
    "chat_redacted.jsonl",
    "analysis_index.json",
    "ChatGPT_analysis_instructions.txt",
  ];
  if (expected.some((name) => !reviewedFileNames.includes(name)) ||
      reviewedFileNames.length !== expected.length) {
    throw new StrictShareBlockedError("file_review_incomplete");
  }
  const pack = buildStrictChatGptSharePack(rawMessages, mappings, options);
  if (pack.files.length !== expected.length ||
      previewFiles.length !== expected.length ||
      pack.files.some((file, index) =>
        file.name !== expected[index] ||
        previewFiles[index].name !== file.name ||
        previewFiles[index].type !== file.type ||
        previewFiles[index].content !== file.content)) {
    throw new StrictShareBlockedError("preview_changed");
  }
  return pack;
}

/** Explicit minimization: only a bounded trailing subset, never all by default. */
export function selectRecentStrictShareMessages(
  messages: readonly ChatMessage[],
  limit: 25 | 50 | 100,
): ChatMessage[] {
  if (![25, 50, 100].includes(limit)) throw new RangeError("invalid strict selection");
  return [...messages].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  ).slice(-limit);
}

/**
 * The strict UI shares a small contiguous excerpt, not the whole transcript.
 * offset=0 selects the newest page; a positive offset moves back in history.
 * Every value is validated, so malformed UI inputs cannot widen disclosure.
 */
export function selectStrictShareWindowMessages(
  messages: readonly ChatMessage[],
  limit: 5 | 10 | 25,
  offset: number,
): ChatMessage[] {
  if (![5, 10, 25].includes(limit) || !Number.isSafeInteger(offset) || offset < 0 ||
      (messages.length > 0 && offset >= messages.length) ||
      (messages.length === 0 && offset !== 0)) {
    throw new RangeError("invalid strict selection window");
  }
  const sorted = [...messages].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  );
  const end = sorted.length - offset;
  return sorted.slice(Math.max(0, end - limit), end);
}
