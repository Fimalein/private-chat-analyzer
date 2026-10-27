# GitHub Pages synthetic-only preview setup (Draft PR #47)

This is a **public URL** to a **test-only** copy of the browser application. No imported chat transcript is committed, stored or intentionally uploaded by this deployment workflow. The static site files are publicly served, but the runtime and browser/provider privacy guarantees are incomplete. **Use only fabricated fixtures while this PR remains Draft**.

## One-time activation (requires repository administrator)

1. Open https://github.com/Fimalein/private-chat-analyzer/settings/pages
2. Under **Build and deployment → Source**, select **GitHub Actions**. Leave branch-source publishing OFF. GitHub Pages was not enabled when these instructions were written.
3. Open https://github.com/Fimalein/private-chat-analyzer/actions/workflows/pages.yml
4. Click **Run workflow**; choose branch `feat/strict-chatgpt-sharing-preflight`, then click **Run workflow**. If the initial feature-branch push run failed because Pages was disabled, rerun it instead.
5. Confirm the **Deploy ChatStory synthetic-only preview (GitHub Pages)** run has a successful build and deploy job. Use the **page_url** shown by that deployment job; for the `Fimalein/private-chat-analyzer` project Pages, the *expected* URL structure is `https://fimalein.github.io/private-chat-analyzer/`. This is not proof the address is currently live.
6. Save the verified URL in browser bookmarks. Future pushes on that feature branch trigger preview deployment without local npm/git work. This URL serves **code** publicly; imported messages must stay local in browser memory.

## Verified design / protections

- Uses the existing app and its genuine LINE parser/Privacy Review/four-file export gates, not a fake hosted backend.
- Build uses `GITHUB_PAGES=true`; `next.config.ts` derives basePath from `GITHUB_REPOSITORY` rather than hard-coding the upstream `/ChatStory` path.
- Build compiles `NEXT_PUBLIC_PREVIEW_ONLY=true` so all pages display a visible warning not to import authentic private conversations.
- GitHub workflow runs synthetic tests, repository privacy guard, production dependency audit and static Next.js build **before** publishing.
- No automatic application-initiated upload. This claim is limited by test and browser/runtime boundaries. Optional GitHub-hosted third-party scripts, browser extensions, downloaded JavaScript and platform policies must still be considered.

## Important boundaries

- Pages activation changes the **repository's single public Pages site**; GitHub Pages is not a private/password-protected preview. Both main and this feature branch can have deployment workflows. The most recent successful deployment controls what appears at the Pages URL. If the default-branch main workflow deploys later, the preview may be replaced. Do not present the URL as stable production until release.
- Running the workflow on `main` may publish the old app. Choose the **feature branch** in the Run workflow dropdown.
- If build/deploy fails, inspect the exact Actions run and page deployment logs; do not claim a working link until it returns HTTP success and the test-preview warning visibly appears.
- Loading a hosted site necessarily contacts the host to fetch page assets. A deliberate ChatGPT share sends approved data to the chosen provider; neither is equivalent to automatic upload of imported source data.
- Do not commit real chat logs, names, identity maps or screenshots to this repository or workflow artifacts.
