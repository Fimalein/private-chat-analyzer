# LLM provider disclosure: confidentiality rather than public anonymity

Status: design clarification (2026-10-24). This document does **not** authorize automatic upload or guarantee confidentiality.

## User goal and trust boundary

The user wants a chosen LLM service (e.g. ChatGPT) to analyze private conversations. **The intended recipient is that service, not the public internet, GitHub, or an anonymous dataset release.** After the user deliberately supplies an excerpt, the provider necessarily receives readable content. Encryption in transit protects against interception but does not conceal text from the provider.

The main threat is therefore unwanted *provider-side* use or exposure: model-training eligibility, retention and deletion, provider/operator/service-provider access under policies, third-party tools/actions, account or service compromise, and accidental onward sharing. A separate threat is local or application-origin exfiltration before approval.

A public **source-code** repository is compatible with this goal, but source chats, source-to-pseudonym maps and real fixture data must never be committed. A public repository does not mean chat content is meant to be public.

## Concrete provider choices to disclose, not imply

| Recipient/workflow | Model training | Retention | Important qualification |
| --- | --- | --- | --- |
| Personal ChatGPT, regular chat | Disable **Settings > Data controls > Improve the model for everyone** before sending if training is unwanted | Regular chat generally remains in account until deleted | Turning off training is not deletion. Account settings cannot be verified by this locally hosted app. Response feedback may have separate training implications. |
| Personal ChatGPT, Temporary Chat | Not used for model improvement while temporary | May be kept for **up to 30 days** for safety | Not in chat history and creates no new memories while temporary. Saving as a regular chat changes the handling. Personalized temporary chats can use existing memory/plugins. |
| OpenAI API | Not used for model training by default, subject to organization sharing settings | Inputs/outputs may be kept up to **30 days** for abuse monitoring, with endpoint exceptions | Zero Data Retention is an eligibility-dependent arrangement, not assumed for a personal API key. |
| Other LLM providers / external GPT actions | **Provider-specific** | **Provider-specific** | Read the *actual receiving service's* current terms and data controls. External actions may transfer data to another company. |

Sources (checked 2026-10-24):
- [ChatGPT Data controls](https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt)
- [Temporary chat](https://help.openai.com/en/articles/8914046-temporary-chat-in-chatgpt)
- [Chat and file retention](https://help.openai.com/en/articles/8983778-chat-and-file-retention-in-chatgpt)
- [Enterprise/API privacy and retention](https://openai.com/enterprise-privacy/)
- [Privacy/security and encryption](https://openai.com/security-and-privacy/)

## Defenses proportional to the intended disclosure

**Hard blockers before any provider upload:** any password, API token, auth secret, session cookie or private key recognized or supplied to the system; unexpected network transfer; failure to inspect the exact outgoing files; unapproved export; unsupported output format; exposed source-to-pseudonym mapping. The scanning remains imperfect, so human inspection is still required.

**Strong defaults with contextual choice:** mask phone numbers, email addresses, addresses and direct identity markers of participants. Preserve stable **pseudonyms** across the excerpt, because relationships, chronology and exact wording often matter to analysis. Permit the user to deliberately keep non-secret, contextually useful facts after a clear warning, rather than requiring *proof of irreversibility or anonymity*. Rare events, affiliations and the ability to infer identity are **residual disclosure risks**, not equivalent to automatically posting the content publicly.

**Purpose-driven minimization, not arbitrary tiny transcript limits:** use a locally selected message interval or topic-relevant excerpts. More context may be necessary for longitudinal relationship analysis. Selection size is a *privacy/utility trade-off*, not a security guarantee. The 5/10/25-window preview in Draft PR #47 is only a first-step UI and may be inadequate for actual analysis; do not claim the entire user's goal is supported yet.

**Provider handoff UI:** show a concise receiver-specific notice at the moment of download/share: where it goes, whether the app is uploading automatically, training opt-out guidance, retention, third-party-action caution and links to current policy. The app must not claim to have verified the user's ChatGPT account settings or Temporary Chat status; it has no access to those controls. The user must actively choose any subsequent transfer.

**Local runtime assurance:** inspect browser network/worker/cache/analytics behavior with synthetic data and real browser/device tests. Explicitly distinguish "the app does not automatically upload" from "the external provider stores nothing". Monitor for regressions without ever using real chat logs in CI.

## Suggested product structure

1. **Local analysis**: no LLM transfer, no provider exposure.
2. **Reviewed LLM handoff** (goal-aligned): local review; secrets hard-block; direct identifiers masked by default; useful context preserved with user-visible warnings; explicit final transfer.
3. **Extra-strict pseudonymization** (optional): conservatively reject both medium/high structured PII and require context checklist/four-file approval, as in Draft PR #47. It is an optional risk-reduction profile, not a general prerequisite to sending any useful excerpt.
4. **Fully local LLM** (optional future): no remote provider transfer when inference truly runs offline; must separately review local logs and tooling.

The app cannot certify arbitrary messages as anonymous, calculate a trustworthy probability of provider breach, or enforce provider retention policies from the browser. Its responsibility is safe local preparation, meaningful disclosure choices and never claiming stronger guarantees than it can demonstrate.
