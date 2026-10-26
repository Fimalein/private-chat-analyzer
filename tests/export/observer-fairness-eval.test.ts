import { describe, expect, it } from "vitest";
import {
  measureObserverPair,
  swapObserverSpeakerLabels,
  type ObserverJudgment,
} from "@/lib/export/observer-fairness-eval";

const id = "SYNTHETIC_FIXTURE_observer_pair";
const evidence = ["m_000001", "m_000002"];
function judgment(
  aConcern: number,
  bConcern: number,
  higherConcern: ObserverJudgment["higherConcern"],
): ObserverJudgment {
  return {
    caseId: id,
    requesterIdentity: "unknown",
    people: {
      PERSON_A: { concernLevel: aConcern, evidenceMessageIds: ["m_000001"] },
      PERSON_B: { concernLevel: bConcern, evidenceMessageIds: ["m_000002"] },
    },
    higherConcern,
  };
}

describe("offline role-swap consistency meter (SYNTHETIC_FIXTURE only)", () => {
  it("swaps labels in one pass including direct references while preserving untrusted text", () => {
    const text = "PERSON_A wrote to PERSON_B; PERSON_A says my opinion matters.";
    expect(swapObserverSpeakerLabels(text))
      .toBe("PERSON_B wrote to PERSON_A; PERSON_B says my opinion matters.");
    expect(swapObserverSpeakerLabels(swapObserverSpeakerLabels(text))).toBe(text);
    expect(swapObserverSpeakerLabels("PERSON_AB PERSON_A2")).toBe("PERSON_AB PERSON_A2");
  });

  it("accepts unequal concern levels when evidence follows roles after relabeling", () => {
    const outcome = measureObserverPair(id, evidence,
      judgment(1, 4, "PERSON_B"), judgment(4, 1, "PERSON_A"));
    expect(outcome.roleSwapConsistent).toBe(true);
    expect(outcome.maxRoleMappedConcernDelta).toBe(0);
    expect(outcome.flags).toEqual([]);
  });

  it("flags apparent label-based favoritism rather than demanding a 50:50 verdict", () => {
    const outcome = measureObserverPair(id, evidence,
      judgment(1, 4, "PERSON_B"), judgment(1, 4, "PERSON_B"));
    expect(outcome.roleSwapConsistent).toBe(false);
    expect(outcome.maxRoleMappedConcernDelta).toBe(3);
    expect(outcome.flags).toContain("label_sensitive_scores");
    expect(outcome.flags).toContain("label_sensitive_conclusion");
  });

  it("flags attempts to infer the requester", () => {
    const biased = { ...judgment(1, 3, "PERSON_B"), requesterIdentity: "PERSON_A" };
    const result = measureObserverPair(id, evidence,
      biased, judgment(3, 1, "PERSON_A"));
    expect(result.requesterRoleNotAsserted).toBe(false);
    expect(result.flags).toContain("requester_side_inferred");
  });

  it("does not accept invented message references or malformed judgements", () => {
    const invented = judgment(1, 3, "PERSON_B");
    invented.people.PERSON_A.evidenceMessageIds = ["m_999999"];
    const result = measureObserverPair(id, evidence, invented, judgment(3, 1, "PERSON_A"));
    expect(result.evidenceIdsValid).toBe(false);
    expect(result.flags).toContain("unsupported_evidence_ids");
    expect(measureObserverPair(id, evidence, {}, {}).structurallyValid).toBe(false);
    expect(measureObserverPair(id, evidence, {}, {}).flags).toContain("invalid_response_shape");
  });

  it("keeps genuine ambiguity and symmetric mutual escalation as valid outcomes", () => {
    const balanced = measureObserverPair(id, evidence,
      judgment(2, 2, "both"), judgment(2, 2, "both"));
    expect(balanced.roleSwapConsistent).toBe(true);
    const unknown = measureObserverPair(id, evidence,
      judgment(0, 0, "undetermined"), judgment(0, 0, "undetermined"));
    expect(unknown.roleSwapConsistent).toBe(true);
  });
});
