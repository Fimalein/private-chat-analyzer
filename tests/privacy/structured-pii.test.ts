import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import {
  hasUnresolvedHighRiskStructuredPii,
  scanStructuredPii,
  scanStructuredPiiText,
  unresolvedHighRiskStructuredPii,
} from "@/lib/privacy/structured-pii";

function message(id: string, content: string): ChatMessage {
  return {
    id,
    timestamp: Number(id.replace(/\D/g, "")) || 1,
    senderId: "PERSON_A",
    senderName: "PERSON_A",
    content,
    platform: "line",
    type: "text",
  };
}

describe("scanStructuredPiiText", () => {
  it("detects supported structured identifier classes", () => {
    const text = [
      "mail test.user@example.com",
      "phone 090-0000-0000",
      "url https://example.com/profile?id=abc",
      "ip 192.0.2.44",
      "postal 000-0000",
      "member 999999999999999",
      "token=TESTTOKEN000000000000",
    ].join(" | ");

    const kinds = scanStructuredPiiText(text).map((item) => item.kind);

    expect(kinds).toContain("email");
    expect(kinds).toContain("phone");
    expect(kinds).toContain("url");
    expect(kinds).toContain("ipv4");
    expect(kinds).toContain("postal_code");
    expect(kinds).toContain("long_numeric_id");
    expect(kinds).toContain("credential");
  });

  it("accepts +81 phone formatting and canonicalizes it to domestic form", () => {
    const results = scanStructuredPiiText("call +81 90 0000 0000 please");
    const phone = results.find((item) => item.kind === "phone");
    expect(phone?.canonicalValue).toBe("09000000000");
  });

  it("does not treat an invalid IPv4 address as IPv4", () => {
    const results = scanStructuredPiiText("host 999.999.999.999");
    expect(results.some((item) => item.kind === "ipv4")).toBe(false);
  });

  it("prefers a phone classification over an overlapping long numeric id", () => {
    const results = scanStructuredPiiText("09000000000");
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("phone");
  });

  it("prioritizes a credential value embedded in a URL query", () => {
    const results = scanStructuredPiiText(
      "https://example.com/callback?token=TESTTOKEN000000000000",
    );
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("credential");
    expect(results[0].severity).toBe("high");
  });

  it("detects bearer, JWT-like, GitHub-like, and AWS-like credential shapes", () => {
    const values = [
      "Bearer SYNTHETICBEARERTOKEN0000",
      "eyJheader00.payload00.signature00",
      "ghp_SYNTHETICTOKEN0000000000000000",
      "AKIA0000000000000000",
    ];

    for (const value of values) {
      expect(
        scanStructuredPiiText(value).some((item) => item.kind === "credential"),
      ).toBe(true);
    }
  });
});

describe("scanStructuredPii", () => {
  it("groups repeated values into one review candidate with occurrence counts", () => {
    const messages = [
      message("m1", "test.user@example.com"),
      message("m2", "again test.user@example.com"),
      message("m3", "nothing sensitive here"),
    ];

    const detections = scanStructuredPii(messages);
    const email = detections.find((item) => item.kind === "email");

    expect(email?.occurrenceCount).toBe(2);
    expect(email?.occurrences.map((item) => item.messageId)).toEqual([
      "m1",
      "m2",
    ]);
    expect(email?.id).not.toContain("test.user@example.com");
  });

  it("does not double count identical senderId and senderName fields", () => {
    const input: ChatMessage = {
      ...message("m1", "hello"),
      senderId: "test.user@example.com",
      senderName: "test.user@example.com",
    };

    const email = scanStructuredPii([input]).find(
      (item) => item.kind === "email",
    );
    expect(email?.occurrenceCount).toBe(1);
    expect(email?.occurrences[0].field).toBe("senderName");
  });

  it("surfaces only unresolved high-risk items for future export gating", () => {
    const detections = scanStructuredPii([
      message("m1", "mail test.user@example.com"),
      message("m2", "postal 000-0000"),
    ]);
    const email = detections.find((item) => item.kind === "email");
    expect(email).toBeDefined();

    expect(unresolvedHighRiskStructuredPii(detections)).toHaveLength(1);
    expect(hasUnresolvedHighRiskStructuredPii(detections)).toBe(true);

    const resolved = new Set([email!.id]);
    expect(unresolvedHighRiskStructuredPii(detections, resolved)).toHaveLength(0);
    expect(hasUnresolvedHighRiskStructuredPii(detections, resolved)).toBe(false);
  });
});
