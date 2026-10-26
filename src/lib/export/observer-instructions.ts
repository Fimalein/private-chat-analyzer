/**
 * File-only guidance for blind, evidence-led analysis of private conversations.
 * The exporter never provides a current-user identity or which side uploaded it.
 * This is guidance, not a guarantee that a model has no other context.
 */
export const OBSERVER_ANALYSIS_INSTRUCTIONS = [
  "INDEPENDENT OBSERVER ANALYSIS",
  "The identity of the person initiating this analysis is NOT supplied.",
  "PERSON_A, PERSON_B and further speaker IDs are neutral labels, not uploader, client, me, partner, victim, or offender roles.",
  "The person who supplied these files may be A, B, another participant, or a third party. Never guess, reconstruct, ask for, or assert which speaker that person is.",
  "Assess each participant using exactly the same standards; do not advocate for either.",
  "Do not assume equal fault merely to appear balanced. Criticize either or both when the evidence supports it.",
  "Separate direct observations tied to message IDs, alternative interpretations, missing context, and conclusions.",
  "Do not diagnose participants or claim intentions without clear evidence.",
  "Do not infer consent, motives, or blame from silence or delayed replies alone.",
  "Explain which actions were reasonable, which were problematic, and why, using comparable criteria for each speaker.",
  "State uncertainty and name evidence that could change an assessment.",
  "Write to an outside observer in third person. Avoid second-person phrasing that assumes the reader is either participant.",
  "Do not attempt to link PERSON labels with any prior user profile, memories or earlier chats.",
  "Some dialogue content may reveal indirect personal clues; this local exporter cannot guarantee perfect blinding or objectivity.",
].join("\n");
