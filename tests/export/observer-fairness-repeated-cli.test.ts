import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fixtures from "../fixtures/synthetic/observer-fairness-cases.json";

type Variant = "original" | "swapped";
type Conclusion = "PERSON_A" | "PERSON_B" | "both" | "undetermined";
type Trial = { trialId: string; caseId: string; repeat: number; variant: Variant; prompt: string };
const cli = "scripts/observer-counterfactual-eval.mjs";
const flip = (v: Conclusion): Conclusion => v === "PERSON_A" ? "PERSON_B" : v === "PERSON_B" ? "PERSON_A" : v;
const call = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  encoding: "utf8", maxBuffer: 4e6,
});
const prompts = () => {
  const run = call("prompts", "--repeats", "3", "--seed", "20261029");
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout) as { prompts: Trial[]; experiment: { repeats: number; seed: number } };
};
function fakeJudgment(caseId: string, variant: Variant) {
  const item = fixtures.cases.find(c => c.caseId === caseId)!;
  const expected = item.expectedHigherConcern as Conclusion;
  const higherConcern = variant === "swapped" ? flip(expected) : expected;
  const scores: Record<Conclusion, number[]> = {
    PERSON_A: [3, 0], PERSON_B: [0, 3], both: [2, 2], undetermined: [0, 0],
  };
  const [a, b] = scores[higherConcern];
  return {
    caseId, requesterIdentity: "unknown",
    people: {
      PERSON_A: { concernLevel: a, evidenceMessageIds: ["m_000001"] },
      PERSON_B: { concernLevel: b, evidenceMessageIds: ["m_000002"] },
    },
    higherConcern,
  };
}
function score(results: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "observer-repeated-synthetic-"));
  try {
    const file = join(dir, "fabricated-results.json");
    writeFileSync(file, JSON.stringify({
      protocol: { repeats: 3, seed: 20261029, modelId: "FAKE_NOT_A_MODEL" },
      results,
    }));
    return call("score", file);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function collected() {
  return prompts().prompts.map(({ prompt: _prompt, ...trial }) => ({
    ...trial, judgment: fakeJudgment(trial.caseId, trial.variant),
  }));
}

describe("repeated randomized observer evaluator — synthetic only", () => {
  it("generates exactly 24 reproducibly shuffled independent trial IDs", () => {
    const first = prompts();
    expect(first).toEqual(prompts());
    expect(first.prompts).toHaveLength(24);
    expect(new Set(first.prompts.map(p => p.trialId)).size).toBe(24);
    expect(first.prompts.every(p => !p.prompt.includes("expectedHigherConcern"))).toBe(true);
    const canonical = fixtures.cases.flatMap(tc => [1, 2, 3].flatMap(repeat =>
      (["original", "swapped"] as const).map(variant =>
        tc.caseId + "/r" + repeat + "/" + variant)));
    expect(new Set(first.prompts.map(p => p.trialId))).toEqual(new Set(canonical));
    expect(first.prompts.map(p => p.trialId)).not.toEqual(canonical);
    const other = JSON.parse(call("prompts", "--repeats", "3", "--seed", "20261030").stdout);
    expect(other.prompts.map((p: Trial) => p.trialId)).not.toEqual(first.prompts.map(p => p.trialId));
  });

  it("scores 12 fabricated pairs with explicit denominator and no false model claim", () => {
    const run = score(collected());
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout);
    expect(report.complete).toBe(true);
    expect(report.pairsExpected).toBe(12);
    expect(report.pairsScored).toBe(12);
    expect(report.judgmentsReceived).toBe(24);
    expect(report.summary.swappedConclusionConsistencyRate).toBe(1);
    expect(report.flags).toEqual([]);
    expect(report.evaluationPerformedByThisTool).toBe(false);
  });

  it("does not accept incomplete, duplicate, or inconsistent trial IDs", () => {
    const data = collected();
    const missing = score(data.slice(1));
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).complete).toBe(false);
    expect(score([...data, data[0]]).status).toBe(2);
    expect(score([{ ...data[0], trialId: "wrong" }]).status).toBe(2);
  });

  it("flags scores that directly contradict a decisive higherConcern verdict", () => {
    const data = collected();
    const row = data.find(x => x.caseId === "boundary-and-pressure" &&
      x.repeat === 1 && x.variant === "original")!;
    row.judgment.higherConcern = "PERSON_A";
    const report = JSON.parse(score(data).stdout);
    const result = report.results.find((r: { caseId: string; repeat: number }) =>
      r.caseId === "boundary-and-pressure" && r.repeat === 1);
    expect(result.flags).toContain("conclusion_score_contradiction");
    expect(result.flags).toContain("label_sensitive_conclusion");
  });

  it("does not echo untrusted free-text fields from local model output", () => {
    const data = collected();
    (data[0] as Record<string, unknown>).rawModelReply = "PRIVATE_SYNTHETIC_CANARY_NEVER_PRINT";
    const run = score(data);
    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).not.toContain("PRIVATE_SYNTHETIC_CANARY_NEVER_PRINT");
  });

  it("rejects invalid repeat count and seed without any model call", () => {
    expect(call("prompts", "--repeats", "0").status).toBe(2);
    expect(call("prompts", "--repeats", "31").status).toBe(2);
    expect(call("prompts", "--seed", "Infinity").status).toBe(2);
    expect(call("prompts", "--seed", "-1").status).toBe(2);
  });
});
