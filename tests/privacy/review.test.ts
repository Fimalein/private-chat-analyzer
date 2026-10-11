import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  nextStructuredPiiReplacement,
  redactPlaceholder,
  reviewSummary,
  sampleContextsForDetection,
  type PrivacyReviewDecisionMap,
} from "@/lib/privacy/review";
import type { StructuredPiiDetection } from "@/lib/privacy/structured-pii";

function message(id: string, content: string, timestamp: number): ChatMessage {
  return {
    id,
    timestamp,
    senderId: "PERSON_A",
    senderName: "PERSON_A",
    content,
    platform: "line",
    type: "text",
  };
}

const detection: StructuredPiiDetection = {
  id: "email-deadbeef",
  kind: "email",
  severity: "high",
  value: "fake.user@example.test",
  canonicalValue: "fake.user@example.test",
  occurrenceCount: 4,
  occurrences: [
    { messageId: "m1", field: "content", start: 7, end: 29 },
    { messageId: "m2", field: "content", start: 6, end: 28 },
    { messageId: "m3", field: "content", start: 6, end: 28 },
    { messageId: "m4", field: "content", start: 6, end: 28 },
  ],
};

describe("privacy review helpers", () => {
  it("caps sample contexts instead of expanding every occurrence", () => {
    const messages = [
      message("m1", "email: fake.user@example.test one", 1),
      message("m2", "again fake.user@example.test two", 2),
      message("m3", "again fake.user@example.test three", 3),
      message("m4", "again fake.user@example.test four", 4),
    ];

    const samples = sampleContextsForDetection(detection, messages, 3);
    expect(samples).toHaveLength(3);
    expect(samples.map((sample) => sample.messageId)).toEqual(["m1", "m2", "m3"]);
    expect(samples[0].snippet).toContain("fake.user@example.test");
  });

  it("allocates the first unused typed placeholder", () => {
    expect(
      nextStructuredPiiReplacement("email", ["EMAIL_1", "PHONE_1", "EMAIL_3"]),
    ).toBe("EMAIL_2");
    expect(redactPlaceholder("credential")).toBe("[REDACTED_CREDENTIAL]");
  });

  it("distinguishes reviewed candidates from unresolved high-risk ones", () => {
    const medium: StructuredPiiDetection = {
      ...detection,
      id: "postal-cafe1234",
      kind: "postal_code",
      severity: "medium",
      value: "000-0000",
      canonicalValue: "0000000",
    };
    const decisions: PrivacyReviewDecisionMap = {
      [detection.id]: {
        detectionId: detection.id,
        action: "pseudonymize",
        replacement: "EMAIL_1",
      },
    };

    expect(reviewSummary([detection, medium], decisions)).toEqual({
      total: 2,
      reviewed: 1,
      unreviewed: 1,
      unresolvedHigh: 0,
    });
  });
});
