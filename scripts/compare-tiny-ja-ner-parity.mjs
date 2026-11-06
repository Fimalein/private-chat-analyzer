/**
 * Compare native ONNX Runtime and Chromium WASM synthetic-only token traces.
 * The public report includes only case IDs, original code-point offsets,
 * label IDs and rounded top-two decision margins — NO text or token IDs.
 * Strict output parity remains a hard failing CI gate.
 */
export function compareSyntheticParity(native, browser, maxSamples = 40) {
  if (native?.marker !== "SYNTHETIC_FIXTURE" || browser?.marker !== "SYNTHETIC_FIXTURE") {
    throw new Error("Strictly synthetic-only parity traces are required");
  }
  const nativeSuites = native.suites ?? {};
  const browserSuites = browser.suites ?? {};
  if (Object.keys(nativeSuites).sort().join() !== Object.keys(browserSuites).sort().join()) {
    throw new Error("Synthetic suite names do not match");
  }
  const result = { marker: "SYNTHETIC_FIXTURE", note: "No chat text, vocab IDs or logits stored; diagnostics are bounded and synthetic-only.", suites: {} };
  for (const suite of Object.keys(nativeSuites).sort()) {
    const left = nativeSuites[suite], right = browserSuites[suite];
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      throw new Error("Case count mismatch in " + suite);
    }
    const stats = {
      cases: left.length, differingCases: 0,
      sourcePositionMismatches: 0, labelDisagreements: 0,
      checkedTokens: 0, smallMarginDisagreements: 0,
      disagreementsWithLargeMargins: 0, samples: [],
    };
    for (let i = 0; i < left.length; i += 1) {
      const a = left[i], b = right[i];
      if (a.id !== b.id || !Array.isArray(a.tokens) || !Array.isArray(b.tokens)) {
        throw new Error("Unaligned synthetic cases in " + suite);
      }
      let differed = false;
      const length = Math.max(a.tokens.length, b.tokens.length);
      for (let k = 0; k < length; k += 1) {
        const x = a.tokens[k], y = b.tokens[k];
        stats.checkedTokens += 1;
        const positional = !x || !y || x.source !== y.source;
        const label = !positional && x.label !== y.label;
        if (!positional && !label) continue;
        differed = true;
        if (positional) stats.sourcePositionMismatches += 1;
        else {
          stats.labelDisagreements += 1;
          if (Math.min(x.margin, y.margin) <= 0.05) stats.smallMarginDisagreements += 1;
          else stats.disagreementsWithLargeMargins += 1;
        }
        if (stats.samples.length < maxSamples) {
          stats.samples.push({
            caseId: a.id, tokenIndex: k,
            nativeSource: x?.source ?? null, browserSource: y?.source ?? null,
            nativeLabel: x?.label ?? null, browserLabel: y?.label ?? null,
            nativeTopTwoMargin: x?.margin ?? null, browserTopTwoMargin: y?.margin ?? null,
          });
        }
      }
      if (differed) stats.differingCases += 1;
    }
    result.suites[suite] = stats;
  }
  result.totalLabelDisagreements = Object.values(result.suites).reduce((n, s) => n + s.labelDisagreements, 0);
  result.totalSourceMismatches = Object.values(result.suites).reduce((n, s) => n + s.sourcePositionMismatches, 0);
  return result;
}
