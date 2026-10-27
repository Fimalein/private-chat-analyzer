import { describe, expect, it } from "vitest";
import { messages } from "@/lib/messages";
import { parseLocale } from "@/lib/locale";
import { LINE_GUIDE, META_GUIDE, TELEGRAM_GUIDE } from "@/lib/guides";
import { CHANGELOG } from "@/lib/changelog";

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)]
    .map(m => m[1]).sort();
}

describe("Japanese ChatStory localization", () => {
  it("has a Japanese string for every existing English and Chinese message key", () => {
    expect(Object.keys(messages.ja).sort()).toEqual(Object.keys(messages.en).sort());
    expect(Object.keys(messages.ja).sort()).toEqual(Object.keys(messages.zh).sort());
    expect(Object.keys(messages.ja).length).toBeGreaterThan(160);
  });

  it("preserves dynamic template placeholders and literal substitutions", () => {
    for (const [key, value] of Object.entries(messages.en)) {
      expect(interpolationTokens(messages.ja[key as keyof typeof messages.ja]))
        .toEqual(interpolationTokens(value));
    }
  });

  it("allows Japanese to persist through locale parsing and becomes the default", () => {
    expect(parseLocale("ja")).toBe("ja");
    expect(parseLocale("zh")).toBe("zh");
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale(null)).toBe("ja");
    expect(parseLocale("unknown")).toBe("ja");
  });

  it("contains complete Japanese import guides and change history", () => {
    for (const pair of [
      [LINE_GUIDE.ja, LINE_GUIDE.en],
      [META_GUIDE.ja, META_GUIDE.en],
      [TELEGRAM_GUIDE.ja, TELEGRAM_GUIDE.en],
    ]) {
      expect(Object.keys(pair[0]).sort()).toEqual(Object.keys(pair[1]).sort());
    }
    expect(CHANGELOG.length).toBeGreaterThan(5);
    expect(CHANGELOG.every(entry => entry.ja.length === entry.en.length)).toBe(true);
  });

  it("states essential privacy limitations in Japanese", () => {
    expect(messages.ja.faqSecurityA).toContain("自動アップロードしません");
    expect(messages.ja.faqGroupA).toContain("2人");
    expect(messages.ja.importReviewConfirm).toContain("ダッシュボード");
  });
});
