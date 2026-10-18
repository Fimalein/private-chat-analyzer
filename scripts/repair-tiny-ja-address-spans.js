// Experimental address boundary extension. Must remain independent of exports.
// Never creates ADDRESS predictions; only extends existing ADDRESS spans.
(() => {
  "use strict";

  const ADMIN_END = /[都道府県市区郡町村]$/u;
  const ADMIN_NEAR = /[都道府県市区郡町村].{0,16}$/u;
  const NUMBERED = /^(?:[0-9０-９一二三四五六七八九十百千]+丁目|[0-9０-９]+(?:[-－‐‑−][0-9０-９]+){1,4}|[0-9０-９]+番地?(?:[0-9０-９]+号)?)/u;
  const BUILDING = /^[ 　]?[一-龯々ぁ-んァ-ヶーA-Za-z0-9０-９]{1,12}(?:ビル|マンション|ハイツ|コーポ|タワー)(?:[0-9０-９]{1,4}号室)?/u;
  const TAIL_NUMBER = /^[-－‐‑−][0-9０-９]+/u;
  const CHOME_END = /[0-9０-９一二三四五六七八九十百千]$/u;

  const PROSE_NUMBER_END = /^(?:分|秒|時間|日|週間?|年|回|個|件|人|枚|本|ページ|目|番目|km|ｋｍ|m|ｍ|㎞|メートル)/u;
  const TITLE_HINTS = ["映画", "短編", "小説", "漫画", "模型", "作品", "題名", "タイトル"];

  function inQuotedWorkTitle(chars, start, end) {
    // Detect candidates that begin at the opening quote or preceding particle.
    const prefix = chars.slice(0, end).join("");
    for (const [opening, closing] of [["『", "』"], ["「", "」"]]) {
      const left = prefix.lastIndexOf(opening);
      if (left > prefix.lastIndexOf(closing)) {
        const context = Array.from(prefix.slice(0, left)).slice(-16).join("");
        if (TITLE_HINTS.some((hint) => context.includes(hint))) return true;
      }
    }
    return false;
  }

  function safeNumericExtension(rest, candidate) {
    if (candidate && PROSE_NUMBER_END.test(Array.from(rest).slice(Array.from(candidate).length).join(""))) {
      return "";
    }
    return candidate;
  }

  function repairAddressSpans(text, spans) {
    const chars = Array.from(text);
    return spans.map((item) => {
      const span = { ...item };
      const { start, end } = span;
      if (span.type !== "ADDRESS" || !(0 <= start && start < end && end <= chars.length)) {
        return span;
      }
      const original = chars.slice(start, end).join("");
      if (inQuotedWorkTitle(chars, start, end)) return span;
      if (!ADMIN_NEAR.test(original)) return span;

      const rest = chars.slice(end).join("");
      let extension = "";
      if (ADMIN_END.test(original)) {
        extension = safeNumericExtension(rest, rest.match(NUMBERED)?.[0] ?? "");
      } else if (CHOME_END.test(original) && rest.startsWith("丁目")) {
        extension = "丁目";
      } else if (/[0-9０-９]$/u.test(original)) {
        extension = safeNumericExtension(rest, rest.match(TAIL_NUMBER)?.[0] ?? "");
      }
      const next = Array.from(rest).slice(Array.from(extension).length).join("");
      if (ADMIN_END.test(original) || extension) {
        extension += next.match(BUILDING)?.[0] ?? "";
      }
      if (extension) {
        span.end = end + Array.from(extension).length;
        span.value = chars.slice(start, span.end).join("");
      }
      return span;
    });
  }
  window.repairTinyJaAddressSpans = repairAddressSpans;
})();
