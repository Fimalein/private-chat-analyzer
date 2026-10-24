import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-types";
import { auditUnmaskedSecrets, assertNoExportedSecrets, SecretExportBlockedError } from "@/lib/privacy/secret-guard";
import { buildChatGptExportPack } from "@/lib/export/chatgpt-pack";
import type { EntityMapping } from "@/lib/privacy/types";

const dummy = (content: string): ChatMessage => ({
  id: "synthetic-1",
  platform: "line",
  timestamp: Date.UTC(2026, 0, 1),
  senderId: "PERSON_A",
  senderName: "PERSON_A",
  content,
  type: "text",
});
const onlyFabricated = [
  "password=FABRICATEDPassword099",
  "token=FabricatedStandaloneToken543210",
  "Authorization: Bearer FabricatedBearerExample09876",
  "Cookie: sessionid=FabSessionValue0987654321",
  "api_key=FABRICATED_API_KEY_56789",
  "https://example.test/callback?access_token=FakeAccessToken543210",
  "-----BEGIN PRIVATE KEY-----",
  "github_pat_FABRICATEDTESTTOKENABCDEF01234567890",
] as const;

describe("local credential export blocker (synthetic only)", () => {
  it.each(onlyFabricated)("blocks an unmasked fabricated secret candidate %#", content => {
    const source = [dummy(content)];
    expect(auditUnmaskedSecrets(source, source).unmasked).toBeGreaterThan(0);
    expect(() => buildChatGptExportPack(source, [])).toThrow(SecretExportBlockedError);
  });

  it("allows mapped secret values only after rescanning all export artifacts", () => {
    const source = [dummy("password=FABRICATEDPassword099")];
    const mappings: EntityMapping[] = [
      { source: "FABRICATEDPassword099", replacement: "[REDACTED_CREDENTIAL]", kind: "secret" },
    ];
    const pack = buildChatGptExportPack(source, mappings, { dateMode: { mode: "relative_day" } });
    expect(pack.files).toHaveLength(4);
    for (const file of pack.files) {
      expect(file.content).not.toContain("FABRICATEDPassword099");
    }
    expect(auditUnmaskedSecrets(source, [dummy("password=[REDACTED_CREDENTIAL]")]).unmasked).toBe(0);
  });

  it("fails closed when a final sidecar unexpectedly reintroduces the secret", () => {
    const source = [dummy("password=FABRICATEDPassword099")];
    const safe = [dummy("password=[REDACTED_CREDENTIAL]")];
    const files = [
      { name: "chat_redacted.txt", content: "Synthetic, safe text only" },
      { name: "chat_redacted.jsonl", content: "{}" },
      { name: "analysis_index.json", content: JSON.stringify({ note: "FABRICATEDPassword099" }) },
      { name: "ChatGPT_analysis_instructions.txt", content: "Please analyze dialogue" },
    ];
    expect(() => assertNoExportedSecrets(source, safe, files)).toThrow(SecretExportBlockedError);
  });

  it("detects percent-encoded and unicode-escaped secret syntax in final files", () => {
    const raw = [dummy("No personal data")];
    const probes = [
      "password%3DFABRICATEDPassword099",
      "password\\u003dFABRICATEDPassword099",
      "password&#61;FABRICATEDPassword099",
    ];
    for (const content of probes) {
      expect(() => assertNoExportedSecrets(raw, raw, [{ name: "chat_redacted.txt", content }]))
        .toThrow(SecretExportBlockedError);
    }
  });

  it("refuses partial masking of a fabricated private-key block", () => {
    const payload = "FABRICATEDKEYBODYABCDEF00000000";
    const raw = [dummy("-----BEGIN PRIVATE KEY-----\n" + payload + "\n-----END PRIVATE KEY-----")];
    const incomplete = [dummy("[REDACTED_CREDENTIAL]\n" + payload + "\n-----END PRIVATE KEY-----")];
    expect(auditUnmaskedSecrets(raw, incomplete).unmasked).toBeGreaterThan(0);
    expect(() => assertNoExportedSecrets(raw, incomplete, [])).toThrow(SecretExportBlockedError);
    expect(() => assertNoExportedSecrets(raw, [dummy("[REDACTED_CREDENTIAL]")], [])).not.toThrow();
  });

  it("only reveals a constant error code, not the detected credential", () => {
    const raw = [dummy("password=FABRICATEDPassword099")];
    try {
      assertNoExportedSecrets(raw, raw, [{ name: "chat_redacted.txt", content: raw[0].content }]);
      throw new Error("Expected secret guard to block");
    } catch (err) {
      expect(err).toBeInstanceOf(SecretExportBlockedError);
      expect(String(err)).toContain("EXPORT_BLOCKED_SECRET");
      expect(String(err)).not.toContain("FABRICATEDPassword099");
    }
  });
});
