import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import synthetic from "../fixtures/synthetic/observer-fairness-cases.json";

const cli = "scripts/observer-counterfactual-eval.mjs";
const cases = synthetic.cases;
type Conclusion = "PERSON_A" | "PERSON_B" | "both" | "undetermined";
function swap(s: Conclusion): Conclusion {
  return s === "PERSON_A" ? "PERSON_B" : s === "PERSON_B" ? "PERSON_A" : s;
}
function runScore(results: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "synthetic-observer-"));
  try {
    const file = join(dir, "synthetic-results.json");
    writeFileSync(file, JSON.stringify({ results }));
    return spawnSync(process.execPath, [cli, "score", file], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function judgment(id: string, higherConcern: Conclusion, swapScores = false) {
  const scores = higherConcern === "PERSON_A" ? [3, 0] :
    higherConcern === "PERSON_B" ? [0, 3] :
      higherConcern === "both" ? [2, 2] : [0, 0];
  const [a, b] = swapScores ? [...scores].reverse() : scores;
  return {
    caseId: id,
    requesterIdentity: "unknown",
    people: {
      PERSON_A: { concernLevel: a, evidenceMessageIds: ["m_000001"] },
      PERSON_B: { concernLevel: b, evidenceMessageIds: ["m_000002"] },
    },
    higherConcern: swapScores ? swap(higherConcern) : higherConcern,
  };
}
function pairedFabricatedResults() {
  return cases.map(testCase => ({
    caseId: testCase.caseId,
    original: judgment(testCase.caseId, testCase.expectedHigherConcern as Conclusion),
    swapped: judgment(testCase.caseId, testCase.expectedHigherConcern as Conclusion, true),
  }));
}

describe("synthetic counterfactual observer CLI", () => {
  it("generates exactly eight paired fake prompts without any answer-key leakage", () => {
    const result = spawnSync(process.execPath, [cli, "prompts"], { encoding: "utf8", maxBuffer: 3e6 });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      SYNTHETIC_FIXTURE: boolean;
      prompts: { caseId: string; variant: string; prompt: string }[];
    };
    expect(parsed.SYNTHETIC_FIXTURE).toBe(true);
    expect(parsed.prompts).toHaveLength(cases.length * 2);
    for (const testCase of cases) {
      const variants = parsed.prompts.filter(item => item.caseId === testCase.caseId);
      expect(variants.map(item => item.variant)).toEqual(["original", "swapped"]);
      expect(variants[0].prompt).toContain("requester");
      expect(variants[1].prompt).toContain("PERSON_A");
      expect(variants[1].prompt).toContain("PERSON_B");
    }
    expect(result.stdout).not.toContain("expectedHigherConcern");
  });

  it("accepts fabricated counterbalanced judgments without demanding equal blame", () => {
    const run = runScore(pairedFabricatedResults());
    expect(run.status).toBe(0);
    const score = JSON.parse(run.stdout);
    expect(score.complete).toBe(true);
    expect(score.flags).toEqual([]);
    expect(score.results.every((item: { labelSwapConclusionConsistent: boolean }) =>
      item.labelSwapConclusionConsistent)).toBe(true);
  });

  it("detects an observer that always chooses the same A/B side after swapping", () => {
    const data = pairedFabricatedResults();
    data[0].swapped = data[0].original;
    const run = runScore(data);
    expect(run.status).toBe(1);
    const score = JSON.parse(run.stdout);
    expect(score.flags).toContain(cases[0].caseId);
  });

  it("rejects source-message-id hallucinations and guessed requester identity", () => {
    const data = pairedFabricatedResults();
    data[1].original.requesterIdentity = "PERSON_A";
    data[2].original.people.PERSON_A.evidenceMessageIds = ["m_999999"];
    const run = runScore(data);
    expect(run.status).toBe(1);
    const score = JSON.parse(run.stdout);
    expect(score.flags).toContain(cases[1].caseId);
    expect(score.flags).toContain(cases[2].caseId);
  });
});
