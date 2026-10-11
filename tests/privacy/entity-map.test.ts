import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  applyEntityMappings,
  getEntityFamily,
  normalizeEntityMappings,
  pseudonymizeMessage,
  upsertEntityMapping,
  type EntityMapping,
} from "@/lib/privacy";

const mappings: EntityMapping[] = [
  {
    source: "呼び名Aさん",
    replacement: "PERSON_A",
    kind: "person",
    familyId: "PERSON_A",
  },
  {
    source: "呼び名A",
    replacement: "PERSON_A-1",
    kind: "person",
    familyId: "PERSON_A",
  },
  {
    source: "学校A",
    replacement: "SCHOOL_1",
    kind: "school",
  },
];

describe("entity mappings", () => {
  it("applies the longest overlapping source first", () => {
    expect(applyEntityMappings("呼び名Aさんと呼び名A", mappings)).toBe(
      "PERSON_AとPERSON_A-1",
    );
  });

  it("does not cascade replacement text into later mappings", () => {
    const rules: EntityMapping[] = [
      { source: "呼び名A", replacement: "PERSON_A", kind: "person" },
      { source: "PERSON_A", replacement: "SHOULD_NOT_APPEAR", kind: "other" },
    ];
    expect(applyEntityMappings("呼び名A", rules)).toBe("PERSON_A");
  });

  it("lets the newest exact-source rule win", () => {
    const normalized = normalizeEntityMappings([
      { source: "場所A", replacement: "LOCATION_1", kind: "location" },
      { source: "場所A", replacement: "LOCATION_2", kind: "location" },
    ]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].replacement).toBe("LOCATION_2");
  });

  it("groups aliases without storing any special raw identity object", () => {
    const family = getEntityFamily(mappings, "PERSON_A");
    expect(family.map((item) => item.replacement).sort()).toEqual([
      "PERSON_A",
      "PERSON_A-1",
    ]);
  });

  it("upserts a rule deterministically", () => {
    const next = upsertEntityMapping(mappings, {
      source: "学校A",
      replacement: "SCHOOL_2",
      kind: "school",
    });
    expect(next.find((item) => item.source === "学校A")?.replacement).toBe(
      "SCHOOL_2",
    );
  });

  it("rejects empty source or replacement values", () => {
    expect(() =>
      normalizeEntityMappings([
        { source: "", replacement: "PERSON_A", kind: "person" },
      ]),
    ).toThrow("ENTITY_SOURCE_REQUIRED");
    expect(() =>
      normalizeEntityMappings([
        { source: "呼び名A", replacement: "", kind: "person" },
      ]),
    ).toThrow("ENTITY_REPLACEMENT_REQUIRED");
  });
});

describe("pseudonymizeMessage", () => {
  it("returns a derived message and leaves the raw message unchanged", () => {
    const raw: ChatMessage = {
      id: "line-1",
      timestamp: 1,
      senderId: "呼び名A",
      senderName: "呼び名A",
      content: "学校Aで呼び名Aさんに会った",
      platform: "line",
      type: "text",
    };

    const result = pseudonymizeMessage(raw, mappings);

    expect(result).not.toBe(raw);
    expect(result.senderName).toBe("PERSON_A-1");
    expect(result.content).toBe("SCHOOL_1でPERSON_Aに会った");
    expect(raw.senderName).toBe("呼び名A");
    expect(raw.content).toBe("学校Aで呼び名Aさんに会った");
  });
});
