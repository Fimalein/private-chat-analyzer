/**
 * Defense-in-depth scanner for credential/secret *values*. This is not a
 * general PII detector or a guarantee of secret recognition.
 *
 * Audit source text as well as what is actually serialized. Never expose a
 * discovered value to console, telemetry, thrown errors, or CI artifacts.
 */
import type { ChatMessage } from "@/lib/chat-types";

const MAX_SCAN_CHARS = 8_000_000;
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/g;
const HTML_NUMERIC = /&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/gi;
const HTML_ENTITY = /&(amp|quot|apos|lt|gt);/gi;
const UNICODE_ESCAPE = /\\u([0-9a-f]{4})/gi;
const VALUE_PLACEHOLDER = /^(?:\[?(?:REDACTED(?:_[A-Z0-9_]+)?|MASKED|REMOVED)\]?|(?:CREDENTIAL|SECRET|TOKEN|PASSWORD)_[0-9]+)$/i;

export type SecretAudit = { unmasked: number };

export class SecretExportBlockedError extends Error {
  constructor() {
    super("EXPORT_BLOCKED_SECRET");
    this.name = "SecretExportBlockedError";
    // No matched strings are exposed through the exception.
  }
}

function inspectionForms(value: string): string[] {
  if (value.length > MAX_SCAN_CHARS) throw new SecretExportBlockedError();
  const found = new Set([value.normalize("NFKC").replace(ZERO_WIDTH, "")]);
  // Bounded decoding, NEVER a transformation of what the user sees/exports.
  for (let round = 0; round < 3; round++) {
    for (const text of [...found]) {
      const variants = [
        text.replace(HTML_NUMERIC, (_, hex: string | undefined, decimal: string | undefined) => {
          const code = parseInt(hex || decimal || "0", hex ? 16 : 10);
          return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
            ? String.fromCodePoint(code) : "";
        }),
        text.replace(HTML_ENTITY, (_, name: string) =>
          ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" })[name.toLowerCase() as "amp" | "quot" | "apos" | "lt" | "gt"]),
        text.replace(UNICODE_ESCAPE, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
      ];
      if (/%[0-9a-f]{2}/i.test(text)) {
        try { variants.push(decodeURIComponent(text)); }
        catch {
          variants.push(text.replace(/(?:%[0-9a-f]{2})+/gi, run => {
            try { return decodeURIComponent(run); } catch { return run; }
          }));
        }
      }
      for (const variant of variants) {
        if (variant.length > MAX_SCAN_CHARS) throw new SecretExportBlockedError();
        found.add(variant.normalize("NFKC").replace(ZERO_WIDTH, ""));
      }
    }
  }
  return [...found];
}

function findValues(text: string): string[] {
  const values: string[] = [];
  function collect(regex: RegExp, group = 1) {
    for (const match of text.matchAll(regex)) {
      const value = match[group]?.trim();
      if (value && !VALUE_PLACEHOLDER.test(value)) values.push(value);
    }
  }

  // Generic assignment and JSON/YAML key-value styles, including tokens in
  // query strings. Only the VALUE is treated as a secret, so mapping a
  // credential value can preserve harmless surrounding conversation context.
  collect(/\b(?:password|passwd|pwd|passphrase|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|token|secret|otp|verification[_-]?code|one[_-]?time[_-]?code|session[_-]?id|session[_-]?token|sessionid|csrftoken|oauth[_-]?code|x-amz-signature|signature)\b["']?\s*[:=]\s*["']?([^\s"'&,;\\#]{4,})/gi);

  // Common Japanese credential labels followed by an explicit ASCII-style
  // value (fabricated examples are regression-tested). This intentionally
  // avoids treating arbitrary Japanese prose as a secret value; users must
  // still inspect unrecognized or non-ASCII credentials manually.
  collect(/(?:パスワード|暗証番号|認証コード|確認コード|ワンタイム(?:パスワード|コード)|APIキー|シークレットキー)[ \\t]*(?:[:：=]|は)[ \\t]*["'「『]?([A-Za-z0-9_@.\\/+=!?#$%-]{4,})/gi);

  // Standalone API/authorization headers and credentials in natural language.
  collect(/\b(?:Bearer|Basic)\s+([a-z0-9._~+\/=-]{8,})\b/gi);
  collect(/(?:^|[\r\n])(?:Cookie|Set-Cookie|Authorization)\s*:\s*([^\r\n]+)/gim);
  collect(/\b(?:session_id|sessionid|connect\.sid|__Host-[A-Za-z-]+|__Secure-[A-Za-z-]+)\s*=\s*([^\s;,]{4,})/gi);

  // Typical opaque credentials and JWTs, with synthetic patterns in tests.
  collect(/\b(eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,})\b/g);
  collect(/\b((?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{28,}|xox[baprs]-[A-Za-z0-9-]{12,}|sk-(?:proj-|live-)[A-Za-z0-9_-]{16,}))\b/g);

  // Check the payload too: replacing only the envelope marker is insufficient.
  const pemPayloads = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----([\s\S]*?)(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)/g;
  for (const block of text.matchAll(pemPayloads)) {
    for (const line of block[1].split(/\r?\n/)) {
      const payload = line.trim();
      if (/^[A-Za-z0-9+/=]{12,}$/.test(payload)) values.push(payload);
    }
  }

  // Even an incomplete pasted PEM key is blocked pending manual redaction.
  collect(/(-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----)/g);
  return values;
}

function messageTexts(messages: readonly ChatMessage[]): string[] {
  return messages.flatMap(m => [m.content, m.senderName, m.senderId]);
}

function secretValues(texts: readonly string[]): string[] {
  const secrets = new Set<string>();
  for (const text of texts) {
    for (const form of inspectionForms(text)) {
      for (const value of findValues(form)) secrets.add(value);
    }
  }
  return [...secrets];
}

/** Source-secrets not properly removed by local masking. No raw values escape. */
export function auditUnmaskedSecrets(
  raw: readonly ChatMessage[],
  prepared: readonly ChatMessage[],
): SecretAudit {
  const sourceValues = secretValues(messageTexts(raw));
  const preparedForms = messageTexts(prepared).flatMap(inspectionForms);
  const remaining = sourceValues.filter(value =>
    preparedForms.some(text => text.includes(value)),
  );
  const transformed = secretValues(messageTexts(prepared));
  return { unmasked: new Set([...remaining, ...transformed]).size };
}

/**
 * Re-inspect EVERY final serialized file, including JSON escaping / URL / HTML
 * forms. The raw values are only in transient memory, not the output or errors.
 */
export function assertNoExportedSecrets(
  raw: readonly ChatMessage[],
  prepared: readonly ChatMessage[],
  files: readonly { name: string; content: string }[],
): void {
  if (auditUnmaskedSecrets(raw, prepared).unmasked) {
    throw new SecretExportBlockedError();
  }
  const source = secretValues(messageTexts(raw));
  for (const file of files) {
    const forms = inspectionForms(file.name + "\n" + file.content);
    if (forms.some(text =>
      findValues(text).length > 0 ||
      source.some(value => text.includes(value))
    )) throw new SecretExportBlockedError();
  }
}
