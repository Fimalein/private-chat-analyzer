# Runtime privacy model

This document describes what the application does with imported chat data at runtime. It is separate from the [public-repository privacy policy](public-repository-policy.md), which governs what may be committed to GitHub.

## Local import and analysis

Imported chat files are parsed and analyzed in the browser. The application is built as a static Next.js export and does not use an application API or database for chat contents.

Raw messages are kept in browser/React memory for the active session. The application does not intentionally send imported chat contents to an application backend during import, parsing, dashboard analysis, message exploration, privacy review, or export preparation.

This is an application-level statement, not a claim that a hosted webpage makes literally zero network requests. Hosting, browser features, extensions, linked resources, or other surrounding software may have their own network behavior.

## Privacy mappings

Privacy mappings are source-to-replacement rules such as a name to `PERSON_A` or an email address to `EMAIL_1`.

Mappings are session-local. The application does not include the source-to-replacement mapping table in a ChatGPT export pack.

Pseudonymization is only as complete as the mappings and detectors applied. A name, place, rare event, date, or other contextual clue can remain identifying even when structured identifiers have been replaced.

## Structured PII scan

Privacy Review scans browser-local message data for supported structured patterns, including credentials/tokens, email addresses, phone numbers, URLs, IPv4 addresses, postal codes, and long numeric identifiers.

The scanner is a review aid, not an anonymity proof. It can have false positives and false negatives, and it does not attempt to understand every free-form name, place, relationship, event, or contextual clue.

## Privacy Review actions

Privacy Review offers three actions:

- **Pseudonymize**: adds a replacement mapping and keeps a typed placeholder such as `EMAIL_1`.
- **Redact**: adds a replacement mapping that removes the detected value behind a redaction placeholder.
- **Keep / ignore**: marks the candidate as reviewed but does **not** remove or replace the underlying value.

`Keep / ignore` is therefore not an export approval. A high-risk value that is ignored in Privacy Review can still block export because the exporter independently scans the transformed output immediately before generation.

The review counter describes review state. It must not be interpreted as a guarantee that the resulting transcript is anonymous.

## ChatGPT export pack

The export path applies the current privacy mappings, then rescans the transformed messages for supported structured PII.

- Remaining **high-risk** structured findings block export.
- Remaining **medium-risk** findings are shown as warnings and do not block export.
- The source mapping table is not serialized.
- Internal sender IDs and source-line metadata are not serialized in the JSONL export.
- Export-safe sequential message IDs are generated instead of exposing original internal message IDs.
- The source filename is not included in the generated pack.

The generated pack contains:

- `chat_redacted.txt` — the primary anonymized transcript for analysis;
- `chat_redacted.jsonl` — one structured object per message;
- `analysis_index.json` — navigation/derived metadata, not a substitute for the transcript;
- `ChatGPT_analysis_instructions.txt` — instructions describing how the pack should be interpreted.

Generation happens in the browser. Files leave the application only after the user explicitly invokes sharing/download; the browser may then hand them to the operating system or a selected share target.

## Date privacy modes

Export date handling is explicit and optional. The application does not silently alter dates.

- **Exact** keeps the original timestamps.
- **Shift by whole weeks** moves every timestamp by the same user-selected offset, preserving ordering, weekday, and intervals. The chosen mode is recorded, but the numeric shift offset is intentionally not written into the export pack.
- **Relative day + clock** replaces calendar dates with labels such as `DAY_0001` while preserving chronology and elapsed durations; raw epoch timestamps are omitted from that representation.

Date anonymization reduces one source of temporal identifiability but does not remove contextual clues inside message text.

## What the application cannot guarantee

A successful scan or export does not mean that a conversation is fully anonymous. Manual review may still be required for names, locations, dates mentioned in message content, uncommon events, organizations, schools, medical context, relationship details, screenshots, or combinations of otherwise harmless facts.

In short: **no structured high-risk finding detected does not mean completely anonymized**.
