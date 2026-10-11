export type { EntityKind, EntityMapping } from "@/lib/privacy/types";
export {
  applyEntityMappings,
  getEntityFamily,
  normalizeEntityMappings,
  removeEntityMapping,
  upsertEntityMapping,
} from "@/lib/privacy/entity-map";
export { pseudonymizeMessage, pseudonymizeMessages } from "@/lib/privacy/pseudonymize";
export type {
  StructuredPiiDetection,
  StructuredPiiField,
  StructuredPiiKind,
  StructuredPiiOccurrence,
  StructuredPiiSeverity,
} from "@/lib/privacy/structured-pii";
export {
  hasUnresolvedHighRiskStructuredPii,
  scanStructuredPii,
  scanStructuredPiiText,
  unresolvedHighRiskStructuredPii,
} from "@/lib/privacy/structured-pii";
export type {
  PrivacyReviewAction,
  PrivacyReviewDecision,
  PrivacyReviewDecisionMap,
  PrivacySampleContext,
} from "@/lib/privacy/review";
export {
  nextStructuredPiiReplacement,
  rawValuesForDetection,
  redactPlaceholder,
  reviewSummary,
  sampleContextsForDetection,
  structuredPiiPrefix,
} from "@/lib/privacy/review";
