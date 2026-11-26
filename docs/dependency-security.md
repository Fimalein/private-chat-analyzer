# Dependency security status

This project separates production-runtime dependency risk from development-tooling risk.

## 2026-10 audit

The initial audit reported 10 findings: 1 critical and 9 high. The production-relevant findings included Next.js plus transitive `sharp` and `source-map-js` advisories.

Remediation applied on the security branch:

- `next` updated from 16.3.2 to 16.4.0.
- `eslint-config-next` aligned to 16.4.0.
- non-breaking `npm audit fix` updates applied to the lockfile.
- `npm audit --omit=dev --audit-level=high` passes after the update.
- the full test suite and production build pass after the update.

## 2026-10-24 production advisory refresh

A new `npm audit --omit=dev --audit-level=high` failure was observed on Next.js `16.4.0` after the earlier remediation. The GitHub advisory feed listed critical Next.js issues in image optimization, Server Actions and `use cache` routes (for example [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw)). This static-export app is not evidence that those server routes were exploitable here, but the vulnerable package still violated our fail-closed dependency release gate.

The PR branch now pins `next` and `eslint-config-next` to **16.4.3**, with the lockfile resolved by `npm install --package-lock-only --ignore-scripts` on the GitHub runner. The read-only probe's **production audit passed**. Final PR CI and the ordinary dependency workflow must also pass before treating the branch as verified. No `npm audit fix --force` or credential-bearing workflow was used.

The full audit separately reported tooling issues in `vitest` / `@vitest/mocker`, `vite`, and a transitive `zod`; these remain to be triaged by reachability and fixed versions. The production high/critical audit remains a mandatory gate, and a passing audit does **not** establish chat anonymization.

## Residual development-only findings

A full `npm audit` still reports high-severity findings through the development-only lint chain:

`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`

At the time of triage, npm's offered automatic remediation was to force-install `eslint-config-next@14.2.35`, which would be a breaking downgrade and would desynchronize it from Next 16.4.0. That forced downgrade was intentionally not applied.

These packages are used for development/linting and are excluded from the production dependency audit. This does not mean they are harmless: malicious or attacker-controlled glob patterns in development tooling should still be avoided, and this residual chain should be rechecked when upstream releases provide a compatible fix.

## Release gate

CI treats high/critical findings in production dependencies as blocking. Full-audit development findings remain visible in logs for follow-up.
