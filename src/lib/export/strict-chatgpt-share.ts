import type { ChatMessage } from "@/lib/chat-types";
import {
  auditPreparedExport,
  buildChatGptExportPack,
  prepareExportMessages,
  type ChatGptExportDateMode,
  type ChatGptExportPack,
} from "@/lib/export/chatgpt-pack";
import { scanStructuredPiiText, type EntityMapping } from "@/lib/privacy";

/**
 * An opt-in, fail-closed *structured* sharing preflight, not an anonymity proof.
 * It is not yet exposed in the UI and must not replace manual contextual review.
 */
export type StrictShareOptions = {
  dateMode: Exclude<ChatGptExportDateMode, { mode: "exact" }>;
  confirmedHumanReview: true;
  /**
   * Locally supplied exact strings that must not occur in exported artifacts.
   * Include name variants, aliases, schools, places and other distinctive text.
   * Never write this list into export files or telemetry.
   */
  knownSensitiveValues: readonly string[];
};

export type StrictShareBlockedReason =
  | "manual_review_required"
  | "relative_date_required"
  | "known_values_required"
  | "unresolved_structured_pii"
  | "serialized_structured_pii"
  | "known_sensitive_value_survived";

export class StrictShareBlockedError extends Error {
  readonly reason: StrictShareBlockedReason;

  constructor(reason: StrictShareBlockedReason) {
    super("STRICT_CHATGPT_SHARE_BLOCKED");
    this.name = "StrictShareBlockedError";
    this.reason = reason;
    // Intentionally do not serialize matching source values into exceptions.
  }
}

function nonemptySensitiveValues(
  known: readonly string[],
  mappings: readonly EntityMapping[],
) {
  return [...new Set([...known, ...mappings.map((mapping) => mapping.source)])]
    .filter((value) => typeof value === "string" && value.trim().length >= 2)
    .map((value) => value.normalize("NFKC"));
}

/**
 * A limited defensive building block for a future strictly reviewed share flow.
 * Does not inspect arbitrary freeform names or quasi-identifying contexts.
 * The caller must ensure meaningful, informed, human review and minimization.
 */
export function buildStrictChatGptSharePack(
  rawMessages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
  options: StrictShareOptions,
): ChatGptExportPack {
  if (options?.confirmedHumanReview !== true) {
    throw new StrictShareBlockedError("manual_review_required");
  }
  if (!options.dateMode || !["shift_weeks", "relative_day"].includes(options.dateMode.mode)) {
    throw new StrictShareBlockedError("relative_date_required");
  }
  if (!options.knownSensitiveValues?.some((value) => value.trim().length >= 2)) {
    throw new StrictShareBlockedError("known_values_required");
  }

  const prepared = prepareExportMessages(rawMessages, mappings);
  const audit = auditPreparedExport(prepared);
  if (audit.detections.length > 0) {
    // Unlike the legacy export, strict preflight blocks medium as well as high.
    throw new StrictShareBlockedError("unresolved_structured_pii");
  }

  const pack = buildChatGptExportPack(rawMessages, mappings, {
    dateMode: options.dateMode,
  });
  const sensitiveValues = nonemptySensitiveValues(options.knownSensitiveValues, mappings);

  // Check *serialized* output, not only transformed messages. This includes
  // JSONL, the analysis index, and instructions, where metadata might survive.
  for (const file of pack.files) {
    if (scanStructuredPiiText(file.content).length > 0) {
      throw new StrictShareBlockedError("serialized_structured_pii");
    }
    const serializedNormalized = file.content.normalize("NFKC");
    if (sensitiveValues.some((value) => serializedNormalized.includes(value))) {
      throw new StrictShareBlockedError("known_sensitive_value_survived");
    }
  }
  return pack;
}
