<div align="center">
  <p>
    <img src="src/app/icon.svg" alt="" height="50" valign="middle" />
    <img src="docs/wordmark.svg" alt="ChatStory" title="ChatStory" height="48" valign="middle" />
  </p>

Turn your chats into stories you can explore — with browser-local privacy review and export tooling.

[![Upstream demo](https://img.shields.io/badge/Upstream_demo-live-7c5cbf)](https://f964966828.github.io/ChatStory/)
[![License: MIT](https://img.shields.io/badge/License-MIT-a78bd9)](LICENSE)
[![Language](https://img.shields.io/badge/Language-TypeScript-9b7ed4)](#deploy-locally)

</div>

This repository is a privacy-focused fork of [ChatStory](https://github.com/f964966828/ChatStory). It currently supports **LINE**, **Telegram**, plus **Meta** (Messenger, Instagram, and Threads).

> **Public-repository privacy rule:** never commit real chat logs, identifiers, mappings, screenshots, or examples derived from real conversations. Tests and examples must be fabricated. See the [public repository privacy policy](docs/privacy/public-repository-policy.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

<div align="center">
  <img src="docs/preview.png" alt="ChatStory dashboard" />
</div>

## Privacy model

Imported chat contents are parsed and analyzed in the browser. The application does not intentionally send imported chat contents to an application backend during import, analysis, Privacy Review, or export preparation. This is an application-level statement, not a promise that a hosted webpage or browser environment makes literally zero network requests.

Privacy Review can pseudonymize or redact supported structured identifiers. **Keep / ignore only marks a candidate as reviewed; it does not remove the value.** ChatGPT export independently rescans the transformed output and blocks remaining high-risk structured findings before generation.

A successful scan is not proof of complete anonymization. Names, places, dates, rare events, organizations, relationship details, and combinations of contextual clues can still identify people.

For the exact runtime behavior, review actions, export gate, and date-anonymization modes, see the [runtime privacy model](docs/privacy/runtime-privacy-model.md).

## Features

- **Browser-local import and analysis**: parsing, charts, message exploration, privacy mappings, and export preparation operate on the client side.
- **Privacy Review**: scan supported structured PII and choose pseudonymize, redact, or keep / ignore.
- **Privacy-audited ChatGPT export pack**: generate anonymized TXT, JSONL, a navigation-only analysis index, and model instructions; remaining high-risk structured findings block export.
- **Optional date anonymization**: keep exact timestamps, shift all dates by whole weeks, or export relative `DAY_0001`-style chronology.
- **Message explorer**: search/filter/sort structured messages and inspect nearby context.
- **Interactive charts**: explore message volume, activity patterns, initiative, words, and other chat statistics.
- **Side chat panel**: inspect chronological messages next to the dashboard.
- **Share a snapshot**: export the dashboard as a PNG.
- **Responsive UI**: designed for both phones and computers.
- **Chinese and English UI**: switch language without leaving the page.

## Architecture

The app uses the Next.js App Router with a static export (`output: "export"`). There is no application API or database for chat contents.

The main data flow is:

`local file → browser parser → in-memory structured messages → local analysis/privacy transforms → explicit share/download`

| Layer | Path | Role |
| --- | --- | --- |
| Routes | `src/app/` | Home, changelog, import guides |
| Shell | `src/components/` | Landing, dashboard layout, message/privacy/export panels, i18n |
| Charts | `src/components/dashboard/` | Visualizations and snapshot export |
| Domain | `src/lib/` | Import, parsers, analysis, privacy logic, ChatGPT export pack |
| Tests | `tests/` | Parser, analysis, privacy, export, and synthetic regression tests |

Privacy mappings and review decisions are browser-session state. Raw source-to-pseudonym mappings are not included in the ChatGPT export pack. Export files are generated only after an explicit user action; after that, browser/OS sharing behavior is outside the application boundary.

## Deploy locally

### Requirements

- Node.js 22
- npm

### Deploy

```bash
# Clone this fork
git clone https://github.com/Fimalein/private-chat-analyzer.git

# Change directory
cd private-chat-analyzer

# Install dependencies
npm install

# Start the dev server
npm run dev

# Open localhost:3000
```

### Test

After `npm install`:

```bash
# Guard the public repository against obvious real-data mistakes
npm run privacy:guard

# Run all tests
npm test

# Build the static app
npm run build
```

The privacy guard is a tripwire, not an anonymity proof. See [docs/privacy/public-repository-policy.md](docs/privacy/public-repository-policy.md).

## Contributing

Pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before adding fixtures, examples, screenshots, or privacy-related changes.

<table>
  <thead>
    <tr>
      <th nowrap>Type</th>
      <th nowrap>Start with</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td nowrap>Functionality issue</td>
      <td nowrap>Issue or PR</td>
      <td>A bug in import, charts, or display. Say what broke and how you checked the fix.</td>
    </tr>
    <tr>
      <td nowrap>Typos and wording</td>
      <td nowrap>Issue or PR</td>
      <td>README, UI text, import guides, or Chinese / English phrasing.</td>
    </tr>
    <tr>
      <td nowrap>New feature</td>
      <td nowrap>Issue first</td>
      <td>New chart, group chats, another platform, or a large UI / data-flow change.</td>
    </tr>
  </tbody>
</table>

Share a proposal on the issue first. A pull request opened before discussion will not be approved.
