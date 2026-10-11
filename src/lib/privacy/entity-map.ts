import type { EntityMapping } from "@/lib/privacy/types";

function assertValidMapping(mapping: EntityMapping) {
  if (!mapping.source.trim()) {
    throw new Error("ENTITY_SOURCE_REQUIRED");
  }
  if (!mapping.replacement.trim()) {
    throw new Error("ENTITY_REPLACEMENT_REQUIRED");
  }
}

/**
 * Keep one rule per exact source string and sort longest-first so aliases such
 * as "呼び名Aさん" are resolved before shorter overlapping aliases.
 *
 * If the same source is added more than once, the most recent rule wins.
 */
export function normalizeEntityMappings(
  mappings: readonly EntityMapping[],
): EntityMapping[] {
  const bySource = new Map<string, EntityMapping>();
  for (const mapping of mappings) {
    assertValidMapping(mapping);
    bySource.set(mapping.source, { ...mapping });
  }

  return [...bySource.values()].sort(
    (a, b) => b.source.length - a.source.length || a.source.localeCompare(b.source),
  );
}

export function upsertEntityMapping(
  mappings: readonly EntityMapping[],
  mapping: EntityMapping,
): EntityMapping[] {
  assertValidMapping(mapping);
  return normalizeEntityMappings([
    ...mappings.filter((item) => item.source !== mapping.source),
    mapping,
  ]);
}

export function removeEntityMapping(
  mappings: readonly EntityMapping[],
  source: string,
): EntityMapping[] {
  return mappings.filter((mapping) => mapping.source !== source).map((item) => ({ ...item }));
}

export function getEntityFamily(
  mappings: readonly EntityMapping[],
  familyId: string,
): EntityMapping[] {
  return mappings
    .filter((mapping) => mapping.familyId === familyId)
    .map((mapping) => ({ ...mapping }));
}

/**
 * Replace only text from the original input. Replacement text is never fed
 * back into later rules, preventing accidental cascading substitutions.
 */
export function applyEntityMappings(
  input: string,
  mappings: readonly EntityMapping[],
): string {
  if (!input || mappings.length === 0) return input;

  const rules = normalizeEntityMappings(mappings);
  let output = "";
  let index = 0;

  while (index < input.length) {
    const match = rules.find((rule) => input.startsWith(rule.source, index));
    if (!match) {
      output += input[index];
      index += 1;
      continue;
    }

    output += match.replacement;
    index += match.source.length;
  }

  return output;
}
