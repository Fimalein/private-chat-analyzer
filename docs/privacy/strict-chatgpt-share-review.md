# Strict ChatGPT sharing: human masking and four-file approval (experimental)

Status: **Draft PR #47; not merged, and not proof of anonymity**. The experimental NER in PR #45 is not used as a redaction gate.

## Current local-only sequence

1. Choose a **small, contiguous, purpose-specific excerpt** from the active imported conversation. The experimental UI starts with only the **latest 5 messages**, permits windows of **5, 10 or 25**, and lets the reviewer move backward/forward through earlier windows without exporting the surrounding history. Imported records are sorted chronologically for this view. Switching windows, changing their size, or changing the source invalidates the preview and every approval.
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

## Encoded-leak guards and contextual linkage review (2026-10-19)

The strict preflight's last serialized-artifact scan now tries bounded decoding of **percent-encoded UTF-8, Unicode escape sequences, decimal/hex HTML references and selected named entities**, recursively up to three passes, as well as checking UTF-8 **base64** representations of user-listed values with at least four characters. It continues to normalize NFKC/zero-width formatting and check decoded JSON/JSONL fields and object keys. No decoding is applied to content being exported; these transforms are only for defensive detection. Unsupported formats or oversized files are blocked rather than silently passing inspection. The protection is deliberately **not a general decoder for arbitrary transformations, compression, encryption or creative spelling**, and only works for strings provided in the local denylist, source mappings, or scanner-recognized identifiers.

To reduce social re-identification risk, the local strict-share UI now requires **four distinct contextual review acknowledgements** before the already-required per-file confirmations and final download authorization: (1) school, workplace, organizations and precise places, (2) unique events/achievements, (3) relationship, family, medical or other sensitive narratives, and (4) clues combined across messages, chronology and reply gaps. Each is a human decision, not an algorithmic judgment or evidence of consent from others. All flags and approval are invalidated if review inputs or export preview change.

A newly fabricated regression set deliberately combines a fictional recurring schedule with a fictional unusual achievement. Those clues **can remain in a pack that passes all structured automated scanning**. The test asserts that final approval is refused unless *all four* contextual categories have been explicitly reviewed; it also demonstrates that checking boxes does not actually remove linkable clues. Users should omit or generalize rare details and choose much smaller subsets when possible.

A deeper **nested JSON string containing Unicode escapes** initially bypassed the detector: [failing regression run](https://github.com/Fimalein/private-chat-analyzer/actions/runs/39244261059) (138/139 tests passed). The inspector now recursively parses JSON-as-text to a bounded depth, then performs the same encoded-value inspections; the regression remains mandatory.

[Final verified run](https://github.com/Fimalein/private-chat-analyzer/actions/runs/39244450688): **139/139 tests in 16 test files passed**, production build passed, and the separate dependency audit passed. All cases were fabricated. Passing a finite synthetic suite is **not** proof of anonymity.

**Open security limitations:** the encoded-value checks are finite and input-length bounded; names never listed or recognized remain invisible. False positives are possible, especially for one-character denylist items or common encoded substrings. Manual cross-message review, participant privacy, independent novel leak corpora, UI/browser e2e testing, mobile/network inspection and outside security review remain necessary. Do not represent the results as guaranteed anonymity or general permission to upload private transcripts.

## Smaller explicit disclosure windows (2026-10-24)

The strict-only preview now defaults to five messages instead of 25, with bounded 5/10/25-message pages and explicit older/newer navigation. Only the currently displayed page enters the generator; hidden adjacent messages cannot be serialized into the four-file pack. The scope, offset, source and mappings are bound to the preview key and changing a window resets manual edits and approvals. Synthetic regression tests check out-of-scope content exclusion, page boundaries, malicious offsets, input immutability and cross-window approval invalidation.

This is an engineering minimization improvement **not** an independent privacy validation. A five-message sequence can still reveal a person through relationships or unusual events. The window selection currently uses chronological position, not topic search or arbitrary disjoint excerpt selection; the original human review and four-file gate remain mandatory.

## Remaining gates before recommending full private chat upload

- **Manual/contextual review cannot be automated away.** Unknown names, indirect descriptions, sensitive life events, medical/family/intimate context, and cross-message combinations may identify participants even when no single known secret survives.
- **Timestamp granularity**: relative-day mode preserves local time-of-day and reply-gap information. This can still leak an identifiable timeline; a coarser chronological mode and manual removal of rare timeline events are desirable.
- **Participant consent and minimization**: even the new default last five messages may contain more than necessary. Add an explicit purpose note and optionally disjoint, topic-driven excerpt selection; document the interests and consent of other participants.
- **End-to-end UI interaction tests**: verify all four confirmations and download gating in a browser, UI dismissal/reset behavior, model-assisted reviews and accessibility, malicious imports, unusual JSON and long session performance.
- **Network/privacy audit**: independently verify locally that original chat texts, denylist, mappings, previews and file contents do not leave the browser prior to explicit user handling. Browser extensions, cloud sync of downloaded files and later manual uploads remain user-environment risks.
- **Independent evaluation**: untouched real-world-licensed, privacy-safe examples; targeted novel PII and context leakage suites; multiple runtime/device tests and quantified residual risk. Prior evaluated NER fixtures are no longer unseen.

**Never label a generated pack `anonymous` or `safe to upload` merely because this structured scan and manual confirmation passed.** Continue PR #47 as Draft until the remaining engineering and privacy review requirements in #46 are satisfied.
