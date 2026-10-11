export type EntityKind =
  | "person"
  | "location"
  | "school"
  | "company"
  | "medical"
  | "event"
  | "secret"
  | "other";

/**
 * A source-to-placeholder rule that exists only in the local browser session.
 *
 * `familyId` groups aliases that refer to the same logical entity without
 * requiring the aliases to share an identical replacement. For example,
 * PERSON_A and PERSON_A-1 may both use familyId "PERSON_A".
 */
export type EntityMapping = {
  source: string;
  replacement: string;
  kind: EntityKind;
  familyId?: string;
};
