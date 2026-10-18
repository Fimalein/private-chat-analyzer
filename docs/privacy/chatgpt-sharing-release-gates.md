# ChatGPT-sharing release gates: local-first privacy and evidence

Status: **NOT APPROVED for uploading unreviewed private chat exports**. This is a release rubric and implementation plan, not a statement of anonymity. Related research: #44 / PR #45 and `runtime-privacy-model.md`.

## Goal and threat model

The user wants to analyze their own conversations with ChatGPT without disclosing other participants' or their own identifying details unnecessarily. Threats include direct identifiers, pseudonym reversibility, quasi-identifiers combined across hundreds of messages, attachments and source metadata, secrets in messages, and identifiable event/time/location sequences. A pseudonymized transcript can **still** be personal data and can still enable re-identification.

The assistant cannot prove that an arbitrary conversation is anonymous. A safe release must mean: limited, informed disclosure of the minimum needed content after structured scanning, conservative masking, final artifact inspection, manual privacy review, and user authorization; never an assurance of zero risk.

## Existing implementation, confirmed

- The application imports messages locally and uses a structured PII scanner and Privacy Review.
- The ChatGPT export pack pseudonymizes configured entities, rescans transformed messages, and blocks remaining **high-risk** structured findings. **Medium-risk** findings currently warn but do not block.
- Export currently defaults to **exact dates** unless the user selects a different mode.
- The pack contains text transcript, JSONL, derived analysis index, and instructions; mapping source values are not exported.
- Synthetic export tests already check that configured source literals do not appear in those artifacts.
- The research-only tiny Japanese NER / ADDRESS boundary repair are **not part of export**. Their narrow, previously examined synthetic tests do not warrant deployment. Long text, Unicode alignment, and some identity boundaries remain unresolved.

## Concrete release checklist (all required before recommending a full upload)

1. **Strict sharing profile.** Add a separately labeled “ChatGPT sharing / strict” mode, defaulting to `relative_day` timestamps. Explicitly choose a limited subset/date window instead of automatically shipping the entire chat. Never imply that the existing ordinary export automatically meets this profile.
2. **Fail-closed structured findings.** In strict mode, block on *high and medium* scanner detections until removed or reviewed with explicit confirmation; secrets/credentials may not be overridden as safe. Warn that regex scanning has false negatives.
3. **PII, sensitive context, and quasi-identifier review.** Review every sender's displayed name, nickname, user ID, organization, school, exact address, employer, workplace, social handle, unique incident, family relationship, precise time/place, and medical/intimate or other private context. Support manual span masking and sentence-level removal; do not rely on NER alone.
4. **Export artifact egress test.** Run the final scan on **all files after serialization**, not only the transformed message objects, and compare against a locally supplied denylist of known-sensitive source strings/variants. This includes metadata, JSON keys/values, derived index, and instructions. Do not upload the denylist or mapping source values.
5. **Leak regression matrix.** Synthetic-only tests must include mixed Japanese/Latin names, numerical/chome/building address variants, repeated aliases, emoji/combining marks, escaped JSON sequences, quoted/nested fragments, >96-token messages, rare contextual details, exact dates, and filename/message-id metadata. Include deliberate partial replacement leaks and ensure strict export is blocked.
6. **Quantify residual risk.** Track exact spans, entire-entity coverage, leaked source characters after *actual export*, false positives, and per-category failures on independent, untouched datasets. Report denominators and confidence intervals rather than “100% safe”. Any unaddressed high-risk regression blocks release.
7. **Runtime provenance and privacy.** Verify locally with browser network inspection that raw chats, mapping tables, model inputs, caches, telemetry, debug logs, worker traffic, and crash reports do not leave the device during preparation. Verify browser memory and offline model loading where relevant, on representative mobile hardware. Document model redistribution terms before shipment.
8. **Human confirmation before transfer.** Present a local-only preview of **each export artifact**, remaining warnings and omissions, reversible/identifiable contextual clues, upload destination implications, and an explicit confirmation. Prefer sharing short, purpose-specific excerpts rather than the entire archive.

## Minimum acceptable handoff workflow (once implemented)

Import locally → select necessary messages → pseudonymize or redact → choose relative dates → complete manual review → scan all serialized artifacts → **block if any mandatory gate fails** → inspect full rendered text/JSONL/index → explicitly approve transfer. On unexpected format, truncation, invalid offsets, or conflicting model predictions, surface a non-dismissible manual-review blocker instead of silently treating that text as clean.

**Current decision: no broad sharing recommendation.** This document is the engineering target. The user can still choose to share a carefully edited short excerpt after personally inspecting it; do not label any existing generated pack as automatically anonymous or safe.
