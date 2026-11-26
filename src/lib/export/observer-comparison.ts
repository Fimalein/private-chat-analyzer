import { measureObserverPair, type ObserverJudgment } from "@/lib/export/observer-fairness-eval";

export const OBSERVER_COMPARISON_CASE_ID = "observer-review";
export const OBSERVER_COMPARISON_INSTRUCTIONS = [
  "STRUCTURED OBSERVER RESULT (use the JSONL as primary evidence).",
  "Assess only observable behaviour. Use the same scale for both speakers: 0 no supported concern; 1 minor; 2 moderate; 3 serious; 4 severe supported concern.",
  "Every nonzero concern must cite at least one existing top-level message ID. Do not invent evidence or infer who requested analysis.",
  "Use higherConcern PERSON_A or PERSON_B only if that person's rating is strictly higher and evidence supports the distinction; use both if both have supported concerns without choosing a higher one, or undetermined if evidence is insufficient.",
  "Return only one JSON object, with the exact keys shown below and no markdown. Do not include source text or additional fields.",
  '{"caseId":"observer-review","requesterIdentity":"unknown","people":{"PERSON_A":{"concernLevel":0,"evidenceMessageIds":[]},"PERSON_B":{"concernLevel":0,"evidenceMessageIds":[]}},"higherConcern":"undetermined"}',
].join("\n");

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function readJudgment(text: string): ObserverJudgment {
  if (text.length > 1000000) throw new Error("INVALID_OBSERVER_JSON");
  const v: unknown = JSON.parse(text);
  if (!exactKeys(v, ["caseId", "requesterIdentity", "people", "higherConcern"]) ||
      v.caseId !== OBSERVER_COMPARISON_CASE_ID || typeof v.higherConcern !== "string" ||
      !["PERSON_A", "PERSON_B", "both", "undetermined"].includes(v.higherConcern) ||
      !exactKeys(v.people, ["PERSON_A", "PERSON_B"])) throw new Error("INVALID_OBSERVER_JSON");
  for (const f of Object.values(v.people)) {
    if (!exactKeys(f, ["concernLevel", "evidenceMessageIds"]) ||
        typeof f.concernLevel !== "number" || !Number.isInteger(f.concernLevel) ||
        f.concernLevel < 0 || f.concernLevel > 4 || !Array.isArray(f.evidenceMessageIds) ||
        !f.evidenceMessageIds.every(id => typeof id === "string")) throw new Error("INVALID_OBSERVER_JSON");
  }
  return v as unknown as ObserverJudgment;
}

const coherent = (j: ObserverJudgment) =>
  (j.higherConcern !== "PERSON_A" || j.people.PERSON_A.concernLevel > j.people.PERSON_B.concernLevel) &&
  (j.higherConcern !== "PERSON_B" || j.people.PERSON_B.concernLevel > j.people.PERSON_A.concernLevel);
const sameIds = (a: string[], b: string[]) => {
  const x = new Set(a), y = new Set(b);
  return x.size === y.size && [...x].every(id => y.has(id));
};

/** Local comparison only; no model calls, no identity inference, no persistence. */
export function compareObserverJudgments(originalText: string, swappedText: string, allowedIds: readonly string[]) {
  if (allowedIds.length === 0 || new Set(allowedIds).size !== allowedIds.length) throw new Error("INVALID_OBSERVER_IDS");
  const original = readJudgment(originalText);
  const swapped = readJudgment(swappedText);
  const measurement = measureObserverPair(OBSERVER_COMPARISON_CASE_ID, allowedIds, original, swapped, 1);
  const internallyCoherent = coherent(original) && coherent(swapped);
  const sameEvidence = sameIds(original.people.PERSON_A.evidenceMessageIds, swapped.people.PERSON_B.evidenceMessageIds) &&
    sameIds(original.people.PERSON_B.evidenceMessageIds, swapped.people.PERSON_A.evidenceMessageIds);
  const flags = [...measurement.flags];
  if (!internallyCoherent) flags.push("conclusion_score_contradiction");
  if (!sameEvidence) flags.push("evidence_selection_differs");
  return { consistent: flags.length === 0, flags, maxDelta: measurement.maxRoleMappedConcernDelta,
    rows: (["PERSON_A", "PERSON_B"] as const).map(role => ({
      role, original: original.people[role].concernLevel,
      swapped: swapped.people[role === "PERSON_A" ? "PERSON_B" : "PERSON_A"].concernLevel,
    })),
  };
}
