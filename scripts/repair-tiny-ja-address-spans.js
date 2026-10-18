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

  function repairAddressSpans(text, spans) {
    const chars = Array.from(text);
    return spans.map((item) => {
      const span = { ...item };
      const { start, end } = span;
      if (span.type !== "ADDRESS" || !(0 <= start && start < end && end <= chars.length)) {
        return span;
      }
      const original = chars.slice(start, end).join("");
      if (!ADMIN_NEAR.test(original)) return span;

      const rest = chars.slice(end).join("");
      let extension = "";
      if (ADMIN_END.test(original)) {
        extension = rest.match(NUMBERED)?.[0] ?? "";
      } else if (CHOME_END.test(original) && rest.startsWith("丁目")) {
        extension = "丁目";
      } else if (/[0-9０-９]$/u.test(original)) {
        extension = rest.match(TAIL_NUMBER)?.[0] ?? "";
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
