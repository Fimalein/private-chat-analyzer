import assert from "node:assert/strict";
import { compareSyntheticParity } from "../scripts/compare-tiny-ja-ner-parity.mjs";

const base = {
  marker: "SYNTHETIC_FIXTURE",
  suites: {
    baseline: [
      { id: "fake-001", tokens: [
        { source: 0, label: 0, margin: 1.2 },
        { source: 1, label: 1, margin: 0.003 },
      ] },
      { id: "fake-002", tokens: [{ source: 0, label: 0, margin: 3.4 }] },
    ],
  },
};
const same = JSON.parse(JSON.stringify(base));
const allGood = compareSyntheticParity(base, same);
assert.equal(allGood.totalLabelDisagreements, 0);
assert.equal(allGood.suites.baseline.differingCases, 0);
assert.equal(allGood.suites.baseline.checkedTokens, 3);
same.suites.baseline[0].tokens[1].label = 2;
same.suites.baseline[0].tokens[1].margin = 0.006;
const disagreement = compareSyntheticParity(base, same);
assert.equal(disagreement.totalLabelDisagreements, 1);
assert.equal(disagreement.suites.baseline.differingCases, 1);
assert.equal(disagreement.suites.baseline.smallMarginDisagreements, 1);
assert.equal(disagreement.suites.baseline.samples[0].caseId, "fake-001");
assert.equal(disagreement.suites.baseline.samples[0].source, undefined);
assert.equal(disagreement.suites.baseline.samples[0].nativeSource, 1);
same.suites.baseline[0].tokens[0].source = 2;
const positional = compareSyntheticParity(base, same, 1);
assert.equal(positional.totalSourceMismatches, 1);
assert.equal(positional.suites.baseline.samples.length, 1);
assert.throws(() => compareSyntheticParity({ ...base, marker: "REAL_CHAT" }, same));
assert.throws(() => compareSyntheticParity(base, { marker: "SYNTHETIC_FIXTURE", suites: { other: [] } }));
assert.throws(() => compareSyntheticParity(base, { ...same, suites: { baseline: [] } }));
console.log("Synthetic-only NER token diagnostic tests PASS");
