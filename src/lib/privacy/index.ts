export type { EntityKind, EntityMapping } from "@/lib/privacy/types";
export {
  applyEntityMappings,
  getEntityFamily,
  normalizeEntityMappings,
  removeEntityMapping,
  upsertEntityMapping,
} from "@/lib/privacy/entity-map";
export { pseudonymizeMessage, pseudonymizeMessages } from "@/lib/privacy/pseudonymize";
