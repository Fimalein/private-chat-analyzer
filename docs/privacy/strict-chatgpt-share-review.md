# Strict ChatGPT sharing: human masking and four-file approval (experimental)

Status: **Draft PR #47; not merged, and not proof of anonymity**. The experimental NER in PR #45 is not used as a redaction gate.

## Current local-only sequence

1. Choose only the most recent **25, 50 or 100 messages** from the active imported conversation.
2. Enter names, nicknames, places, schools, organizations, rare-event phrases and other **known private values**, one per line. This list is kept locally and is **not** included in exported files.
3. Review the raw selected messages *on device*. For each message, choose **omit entire message**, **mask all content**, or **mask individual sentence segments**. The mechanical splitter preserves line breaks and punctuation; it is not reliable linguistic sentence segmentation. Sensitive text can span segments, so review surrounding context.
4. Generate a fresh local preview. The strict API rejects missing pseudonym mappings for any selected sender display name or sender ID, **all** structured PII (including medium findings), and original exact dates. It runs the existing pseudonymization/mapping stage, builds the four actual serialized files, then independently scans the literal bytes and JSON/JSONL decoded values for structured detections and locally listed source strings.
5. Inspect each **entire** serialized file in its own scrollable viewer, and explicitly check *that file's* review confirmation: `chat_redacted.txt`, `chat_redacted.jsonl`, `analysis_index.json`, and `ChatGPT_analysis_instructions.txt`.
6. Only after all four confirmations and a separate residual-risk acknowledgement may the user **explicitly unlock local download**. Each file has its own user-triggered download button; **no automatic share/upload to ChatGPT** is performed.
7. At **every** actual download, run the full strict preflight **again** and verify that all four regenerated artifacts are byte-for-byte equal to the previously reviewed files. If the source conversation, message editing choices, sensitive-values list, or mappings change, the UI invalidates its preview and approval. A mismatch or remaining structured identifier is blocked rather than downloaded.

This approval is a human acknowledgement, **not a mathematical guarantee** or proof the user read the file. The app cannot verify that a human recognized all quasi-identifiers. The existing **legacy** ChatGPT export remains a separate, less strict path; do not confuse its availability with approval of these strict controls.

## Verified fabricated-only regression coverage

Unit tests test Japanese text segmentation with emoji and CRLF; sentence, message and whole-message omissions; immutable source data; invalid indices and imported key names; actual four-artifact leak blocking and post-serialization scanning; source IDs, metadata and dates; all four review flags; and content/date/file changes after approval. The tests use exclusively fabricated fixture conversations.

CI reference: [Actions run 39219529462](https://github.com/Fimalein/private-chat-analyzer/actions/runs/39219529462), **121 tests / 13 test files passed**, including Next.js production typecheck/build. Dependency audit: [run 39219529524](https://github.com/Fimalein/private-chat-analyzer/actions/runs/39219529524), passed.

## Remaining gates before recommending full private chat upload

- **Manual/contextual review cannot be automated away.** Unknown names, indirect descriptions, sensitive life events, medical/family/intimate context, and cross-message combinations may identify participants even when no single known secret survives.
- **Timestamp granularity**: relative-day mode preserves local time-of-day and reply-gap information. This can still leak an identifiable timeline; a coarser chronological mode and manual removal of rare timeline events are desirable.
- **Participant consent and minimization**: defaulting to last 25 still may include more than needed. Support a purpose-specific message/window selection and document other parties' interests.
- **End-to-end UI interaction tests**: verify all four confirmations and download gating in a browser, UI dismissal/reset behavior, model-assisted reviews and accessibility, malicious imports, unusual JSON and long session performance.
- **Network/privacy audit**: independently verify locally that original chat texts, denylist, mappings, previews and file contents do not leave the browser prior to explicit user handling. Browser extensions, cloud sync of downloaded files and later manual uploads remain user-environment risks.
- **Independent evaluation**: untouched real-world-licensed, privacy-safe examples; targeted novel PII and context leakage suites; multiple runtime/device tests and quantified residual risk. Prior evaluated NER fixtures are no longer unseen.

**Never label a generated pack `anonymous` or `safe to upload` merely because this structured scan and manual confirmation passed.** Continue PR #47 as Draft until the remaining engineering and privacy review requirements in #46 are satisfied.
