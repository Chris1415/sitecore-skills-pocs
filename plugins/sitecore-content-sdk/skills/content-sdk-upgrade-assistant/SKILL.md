---
name: content-sdk-upgrade-assistant
description: "Upgrades @sitecore-content-sdk packages by cross-checking release notes, the what's-new matrix and a diff of clean reference apps against this app. Use when moving to a newer SDK version or verifying an upgrade. Not first-time scaffolding."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, Node 18+ with npx and registry access (the script scaffolds reference apps), and a SitecoreAI Edge endpoint with valid Edge context values for the post-upgrade editing/preview check."
metadata:
  author: Sitecore
  version: "0.6.6"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-upgrade-assistant
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-upgrade-assistant/SKILL.md
  upstream_note: upstream ships one copy per router template (nextjs and nextjs-app-router); folded here into a single router-agnostic skill, and extended with the three-way reference diff (scripts/upgrade-surface.mjs) which upstream does not carry
---

# Content SDK Upgrade Assistant

Upgrade `@sitecore-content-sdk/*` packages safely. The procedure is the same for App Router and Pages Router apps — the surfaces most likely to break on a bump are router-specific and each has its own skill (see Hard Rules), so defer to those rather than duplicating router detail here.

**Three sources, each seeing what the other two cannot; read all three, in this order.** (1) The **release notes** say what changed *inside the packages* — behaviour, defaults, reverts — which no file diff can show. (2) The **what's-new page** defines which package versions *constitute* "SDK M.m" now that packages version independently. (3) A **clean scaffold at the target version** is the complete list of OOTB *files* that changed, new API routes included — the release notes name some of them and omit others, and an agent's memory of "what 2.4 changed" is worse than both. Measured 2026-09-16 on 2.2 → 2.4: the notes named the `precedence="high"` drop, metadata/OG, the experimental switch and llms.txt, but **not** the `next.config` rewrite, `getPageMetadata`, `RouteFields extends PageMetadataFields` or the `cli` bump — the scaffold diff had all of those (10 changed files + 2 new routes) and could not see the `getComponentList` componentName revert the notes carried.

## When to use

- User asks to upgrade SDK packages, update to a new version, or apply a migration.
- Task involves version bumps, `@sitecore-content-sdk/*` dependencies, or breaking changes.
- User mentions "upgrade," "migration," "new version," or "breaking change."
- An upgrade already landed and someone asks whether it was complete — that is the `--from-git` case below.

## How to perform

1. **Release notes — the primary source, and NOT `CHANGELOG.md`.** The repo's `CHANGELOG.md` stops at **2.1.0**; since 2.2 every package versions independently and its notes are a **GitHub Release per package**, indexed by [release-notes.html](https://doc.sitecore.com/sai/en/developers/content-sdk/20/release-notes.html) (a version table with links and no content of its own). Read, for the target: `create-content-sdk-app@<to>` (template-level changes), `@sitecore-content-sdk/nextjs@<v>`, `@sitecore-content-sdk/content@<v>` and `@sitecore-content-sdk/cli@<v>` (behavioural changes; the `cli` is the component-map generator). URL shape: `https://github.com/Sitecore/content-sdk/releases/tag/<package>%40<version>` (`@` encoded); `gh api repos/Sitecore/content-sdk/releases` lists them. **For a multi-minor jump read every release in between** — a 2.2 → 2.4 move inherits everything 2.3 changed. The bodies echo nested dependency updates and Angular items; filter to the app's framework.
2. **What's new — one page per minor crossed.** `https://doc.sitecore.com/sai/en/developers/content-sdk/20/what-s-new-in-content-sdk-<M>-<m>.html` (deterministic; the page links its siblings). Its value is narrow and real: the **package version matrix** — `core`, `content`, `cli`, `events`, `analytics-core` alongside `nextjs` / `react` / `create-content-sdk-app` — which is the only place "SDK 2.4" is defined as a *set*, and the headline list you hand the user. It carries **no template changes, no breaking changes and no migration steps** (checked 2.3 and 2.4), so it never substitutes for step 1 or 3. Align the app's ranges to that matrix.
3. **Measure the OOTB surface** — before touching `package.json`:
   ```sh
   node scripts/upgrade-surface.mjs --app <head-app>            # from = installed minor, to = latest stable
   node scripts/upgrade-surface.mjs --app <head-app> --to 2.4.0 # pin the target
   ```
   It scaffolds both references (reused across runs; `--fresh` rescaffolds), auto-detects the router (`--template` overrides), and prints one verdict per file on the surface plus the `@sitecore*` range table. Exit 1 = **stale** or **new-absent** findings; exit 2 = the harness could not stand behind a result (scaffold failed, self-check failed).
4. **Work the list, by class.**
   - `STALE` — the app still has the old OOTB file byte-for-byte: copy the new reference file over it.
   - `NEW ABSENT` — a route/config the target ships and the app lacks: copy it in, and check for a paired `next.config` rewrite or `.env*.example` entry (the script lists those as their own surface files).
   - `CUSTOMIZED` — the app's copy matches neither reference: the script prints every upstream `+`/`-` line with whether it is present in the app (`?!` marks the unexpected ones). Apply the upstream hunks into the customization by hand, then **state a verdict per file** — *upstream hunks applied* / *deliberately not applied, because …*. `?!` is advisory: `import type { Metadata }` vs `import { Metadata }`, or spreading `...getPageMetadata()` under the app's own `alternates`, are correct and will flag.
   - `REMOVED` / `APP-DROPPED` — upstream deleted a file the app keeps, or the app deleted an OOTB file upstream changed: decide, and record why.
   - `!!` in the range table — bump every `@sitecore-content-sdk/*` package to the template's range together, cross-checked against the what's-new matrix from step 2.
5. Bump, `npm install`, `rm -rf .next`, `npm run build`; then apply the behavioural items from step 1 that no file carries, and re-verify the router-specific surfaces (Hard Rules).
6. **Prove the upgrade landed** — rerun against the pre-upgrade lockfile, which lives in git now that the working tree is on the new version:
   ```sh
   node scripts/upgrade-surface.mjs --app <head-app> --from-git HEAD~1 --quiet   # exit 0, or the list of what is still missing
   ```
   Test editing, preview and the Components Preview page on the editing host after the deploy.

## Hard Rules

- **Never derive the target shape from memory or from the release notes alone.** Run the script; the scaffold is the reference (the CLI is run literally, the reference is never hand-written). If `npx` cannot reach the registry the upgrade is blocked, not estimated.
- **`CHANGELOG.md` is not the changelog.** It ends at 2.1.0. Citing it as read for any version ≥ 2.2 is a false claim of having read the notes — the per-package GitHub Releases are the record.
- **CLI versions are not SDK versions.** There is no `create-content-sdk-app@2.2.1`; `2.3.0`/`2.3.1`/`2.3.2` all pin `^2.3.0`, `2.4.0` pins `^2.4.0`. The script resolves *from* as the newest stable CLI release whose template pins the app's installed **minor** (falling back to the highest release at or below it) and WARNs when the resolved reference does not pin the app's minor — pass `--from` explicitly then. Read the version from `package-lock.json`, never the `^` range.
- **Search rides on `nextjs`:** 2.3 adds facet + locale, 2.4 adds suggest + more-like-this. `upgrade-surface.mjs` does not diff the search API; read `packages/search/CHANGELOG.md` (`content-sdk-search`).
- **`3.0.0-beta.atoms` is a sideways move, not an upgrade:** since the `20261021204512` stamp it is stable 2.4.1 plus atoms (earlier stamps forked pre-2.3 `dev` and lacked the 2.3/2.4 features), without the 2.5.0-canary changes. Moving onto it means exact beta pins on the whole app (`content-sdk-app-router-atoms`).
- Prefer upgrading all `@sitecore-content-sdk/*` packages together to a consistent set unless the user requests a partial upgrade. Check peer dependencies.
- After the bump, re-verify the surfaces most likely to be hit using the skill that matches the app's router — App Router and Pages Router diverge on each: the `src/proxy.ts` chain (`content-sdk-{app,pages}-router-multisite-management`), the editing path (`content-sdk-{app,pages}-router-editing-safe-rendering`), the component map(s) (`content-sdk-{app,pages}-router-component-registration`), and the data flow / static params (`content-sdk-{app,pages}-router-graphql-data-fetching`, `-route-configuration`).
- `.agents/`, `.cursor/`, `AGENTS.md`, `CLAUDE.md`, `Skills.md`, `README.md` are excluded from the surface by default (`--include-docs` re-admits them) — they are the CLI's agent-instruction payload, curated separately, and they dwarf the code surface (14 of 26 changed files on 2.2 → 2.4).
- Do not edit `.next/`, `node_modules/`, or lockfiles by hand. Do not change CI or root tooling unless the task explicitly includes it. Delete `.next/` after the bump before any build-reading check — Next's fetch cache survives incremental builds.

## Stop Conditions

- Stop if the target version is unclear; run the script with no `--to` to see the latest stable and the surface it implies, then ask.
- Stop if a `NEW ABSENT` route or a `CUSTOMIZED` hunk requires a product or deployment decision (new env var, config schema, a route the editing host will call); list the required changes with the script's output and ask the user to confirm.
- Stop if the script exits 2 — a reference that could not be scaffolded is not a reference.

## References

- `scripts/upgrade-surface.mjs` — the three-way OOTB diff (dependency-free Node; `--json` for tooling).
- [Release notes index](https://doc.sitecore.com/sai/en/developers/content-sdk/20/release-notes.html) → [GitHub Releases](https://github.com/Sitecore/content-sdk/releases) — per package since 2.2; the repo `CHANGELOG.md` ends at 2.1.0.
- What's new, one per minor: [2.4](https://doc.sitecore.com/sai/en/developers/content-sdk/20/what-s-new-in-content-sdk-2-4.html) · [2.3](https://doc.sitecore.com/sai/en/developers/content-sdk/20/what-s-new-in-content-sdk-2-3.html) · [2.2](https://doc.sitecore.com/sai/en/developers/content-sdk/20/what-s-new-in-content-sdk-2-2.html) — the version matrix and the headlines.
- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
