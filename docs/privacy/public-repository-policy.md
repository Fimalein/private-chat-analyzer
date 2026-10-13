# Public repository privacy policy

This repository must be safe to publish. Repository privacy must not depend on the GitHub visibility setting.

## Never commit real chat data

Do not commit any material derived from a real person's chat history, even if it looks partially anonymized. This includes:

- raw LINE, Telegram, Messenger, Instagram, Threads, or other chat exports;
- real names, handles, email addresses, phone numbers, postal addresses, account IDs, URLs that identify a person, or credentials;
- source-to-pseudonym / identity mapping files;
- screenshots containing real messages, names, avatars, timestamps, locations, or other personal context;
- generated redacted transcripts, JSONL exports, analysis indexes, or model handoff files produced from real conversations;
- examples created by taking a real message and only changing the obvious name.

If an example is needed, write it from scratch with fabricated entities and fabricated events.

## Synthetic fixtures only

Tests and examples must use obviously fabricated values such as `PERSON_A`, `SCHOOL_A`, `LOCATION_A`, `test.user@example.com`, `090-0000-0000`, `000-0000`, documentation IP ranges, and credentials containing markers such as `TEST`, `FAKE`, `SYNTHETIC`, or `EXAMPLE`.

External chat-like fixture files are allowed only under `tests/fixtures/synthetic/`. Text fixtures there must contain `SYNTHETIC_FIXTURE` near the top so reviewers can tell that the file was intentionally fabricated. Binary archive fixtures are not allowed.

Synthetic screenshots, when needed for documentation, belong under `docs/synthetic/`. The automated guard cannot inspect image pixels, so reviewers must verify that every visible value is fabricated.

## Local working data

Keep personal working files outside the repository. For convenience, these root directories are ignored by Git:

- `raw-chat/`
- `private-data/`
- `local-imports/`
- `local-exports/`
- `scratch-chat/`

Do not rely on `.gitignore` as the only protection. Check `git status` before committing.

## Automated public-repository guard

`npm run privacy:guard` checks tracked files for several high-risk mistakes, including:

- chat-like data files outside the explicit synthetic fixture directory;
- standalone identity / pseudonym mapping data;
- generated redacted-export artifacts outside synthetic fixtures;
- real-looking email addresses, Japanese mobile numbers, postal codes, and credential-like values in tests/examples;
- risky screenshot filenames outside the synthetic documentation area.

The guard runs in CI and is intentionally conservative. **A passing guard does not prove that content is anonymous or safe.** Names, free-form text, rare events, dates, locations, screenshots, and contextual clues still require human review.

## If real data is committed

Treat it as a repository incident. Do not assume that deleting the file in a later commit removes the exposure, because Git history and cached copies may retain it. Stop further sharing, identify what was exposed, rotate any credentials, remove the material from history using an appropriate history-rewrite process, and verify the remote repository afterward.

## Review rule

A pull request that adds or changes fixtures, examples, screenshots, export samples, or privacy-related documentation must be reviewed with this policy in mind. Public-safe-by-construction is the requirement; repository secrecy is not a mitigation.
