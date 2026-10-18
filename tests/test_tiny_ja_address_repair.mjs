// Node-only parity regression for browser ADDRESS span repair; fabricated text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const scope = { window: {} };
runInNewContext(
  readFileSync(new URL("../scripts/repair-tiny-ja-address-spans.js", import.meta.url), "utf8"),
  scope,
);
const repair = scope.window.repairTinyJaAddressSpans;
assert.equal(typeof repair, "function");

function check(text, predicted, expected) {
  const points = Array.from(text);
  const length = Array.from(predicted).length;
  const start = points.findIndex((_, index) =>
    points.slice(index, index + length).join("") === predicted);
  assert.ok(start >= 0);
  const span = { start, end: start + Array.from(predicted).length, type: "ADDRESS", value: predicted };
  const before = JSON.stringify(span);
  const result = repair(text, [span]);
  assert.equal(JSON.stringify(span), before, "input predictions must remain immutable");
  assert.equal(result[0].value, expected);
  assert.equal(points.slice(result[0].start, result[0].end).join(""), expected);
}

check("🚃雪影市青丘町1-2-3へ", "雪影市青丘町", "雪影市青丘町1-2-3");
check("送り先：星舟市若波町７丁目の角", "星舟市若波町", "星舟市若波町７丁目");
check("月凪市花瀬町四丁目だよ", "月凪市花瀬町", "月凪市花瀬町四丁目");
check("月凪市花瀬町1-2-3 星雲ビル203号室です",
  "月凪市花瀬町", "月凪市花瀬町1-2-3 星雲ビル203号室");
check("会場は雪影市青丘町1-2-3です",
  "は雪影市青丘町", "は雪影市青丘町1-2-3");
check("星舟市若波町1-2-3、そこから右へ",
  "星舟市若波町", "星舟市若波町1-2-3");

const text = "月凪市で3分待って";
const unmodified = [{ start: 0, end: 3, type: "ADDRESS", value: "月凪市" }];
assert.equal(JSON.stringify(repair(text, unmodified)), JSON.stringify(unmodified));
assert.equal(repair(text, []).length, 0);
const org = [{ start: 0, end: 3, type: "COMPANY", value: "月凪市" }];
assert.equal(JSON.stringify(repair(text, org)), JSON.stringify(org));
console.log("Address repair JS regressions PASS");
