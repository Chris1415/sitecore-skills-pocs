---
name: setup-content-sdk
description: "Scaffolds a Content SDK head app with npx create-content-sdk-app: pick the template by router first (nextjs-app-router, cache-components variant, or nextjs = Pages Router), failure policy, env setup. Use after setup-scaffold picked Content SDK."
license: Apache-2.0
compatibility: "Requires Node 18+, npx, and access to a SitecoreAI Edge endpoint. Edge context values needed at .env.local: SITECORE_EDGE_CONTEXT_ID, NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID, NEXT_PUBLIC_DEFAULT_SITE_NAME, NEXT_PUBLIC_DEFAULT_LANGUAGE, SITECORE_EDITING_SECRET. Optional: dotnet Sitecore CLI for serialized item push."
metadata:
  author: Christian Hahn
  version: "0.3.5"
---

# Content SDK Head Application Scaffold

**Use when:** Building a standard SitecoreAI headless rendering host (Next.js app that fetches content from SitecoreAI via Content SDK).

> For a **Sitecore-managed existing-site rebuild/rebrand**, the `content-sdk-website-build-flow` skill (baseline-first: copy baseline → token-replace → pull) **GOVERNS** — this skill covers the standalone head-app scaffold step it calls in.

If you haven't decided yet whether this is the right scaffold, run `setup-scaffold` first.

## Canonical command

### STEP 0 — pick the template by ROUTER, before running anything

**The two template ids produce different routers and are NOT interchangeable.** Choosing wrong is not a cosmetic mistake — it silently produces an app in which App-Router requirements (a client component map, a `[site]` catch-all route, the `AppRouterMultisiteProxy` chain) simply do not exist, and any App-Router component you then port is unusable.

| Router needed | Template id | Post-scaffold proof |
|---|---|---|
| **App Router** | **`nextjs-app-router`** | `src/app/` exists, `src/pages/` does **not** |
| App Router + on-demand revalidation (OSR) | `nextjs-app-router-cache-components` | as above, plus `src/app/api/revalidate/route.ts` exists and `next.config.*` sets `cacheComponents: true` |
| Pages Router | `nextjs` | `src/pages/` exists, `src/app/` does **not** |

**Choose App Router unless the user explicitly asks for Pages Router.** It is the default for new work: every head app the authors of these skills have shipped is App Router, the 16 `content-sdk-app-router-*` skills target it, and the `nextjs-app-router` scaffold names its package `content-sdk-nextjs-app-router`.

**App Router — the normal case (agents / CI, non-interactive):**

```bash
npx --yes create-content-sdk-app@latest --yes --template nextjs-app-router --destination <app-folder-path>
```

Interactive equivalent (follow prompts for the destination):

```bash
npx create-content-sdk-app@latest --template nextjs-app-router
```

**Pages Router — only when explicitly requested.** The bare **`nextjs`** token is the **template id** as a first positional, and it yields **Pages Router**:

```bash
npx create-content-sdk-app@latest nextjs
# non-interactive: npx --yes create-content-sdk-app@latest --yes --template nextjs --destination <app-folder-path>
```

> **VERIFY THE ROUTER, do not assume it.** Immediately after the scaffold, check the expected folder from the table above exists and the other does not. **HARD STOP and report** if the CLI produced anything else — do **not** hand-edit `next.config.*`, move files, or otherwise convert routers by hand. A router mismatch discovered later costs far more than a re-scaffold now.
>
> *History: a run took the bare `nextjs` token from this skill's own headline, got a Pages Router app, and only caught it because App-Router requirements were unsatisfiable. That is why the router choice is now STEP 0 rather than a footnote.*

### STEP 0b — App Router: plain or cache-components (publish freshness)

Pick by how a publish must reach the live site. The template is the irreversible half: moving a plain app to OSR later is a porting task (`content-sdk-app-router-cache-components-and-osr` § 8), not a flag.

- **Redeploy after publish, or a revalidate window, is acceptable** → `nextjs-app-router` (the default).
- **Fresh within minutes of a publish, no redeploy** → `nextjs-app-router-cache-components`, then the Edge webhook (`sitecoreai-edge-admin-webhooks`).
- **Version floor.** Up to 2.4.x item-level OSR cannot match a cached page, so every publish purges the whole site. The fix (upstream #619/#620/#623) is only in the 2.5.0 canary as of 2026-10-02. Choosing OSR means choosing explicitly: `@latest` with the sitewide purge, or `@<exact canary version>` from `npm view create-content-sdk-app dist-tags.canary`. Never pin a canary silently, and never use the floating `@canary` tag.

```bash
npx --yes create-content-sdk-app@<latest|exact-canary-version> --yes --template nextjs-app-router-cache-components --destination <app-folder-path>
```

An existing app keeps its template. Never re-scaffold it to change freshness.

Do **not** substitute this step with cloning **SitecoreAI starter** `solo-website`, `degit`, or an empty `npm init` project unless the user **explicitly** requested that starter.

## Failure policy

If the CLI errors (network, permissions, non-empty directory without `--force`), **stop** and report the error. Do **not** recover by hand-assembling a Content SDK app — that breaks the scaffold contract.

## Forbidden shortcuts

| Shortcut | Why |
|----------|-----|
| `solo-website` / SitecoreAI starter clone or `degit` | Not the official Content SDK generator; couples you to starter layout. |
| Copying another local app as a "template" | Drifts from current CLI defaults and hides updates. |
| `npm init` + pasted `@sitecore-content-sdk/*` deps | Easy to miss middleware, proxy, component maps, and config. |

**Exception:** Use SitecoreAI starter or another named starter only when the **user explicitly** asks for that repo or template.

## What the scaffold creates

- Next.js application pre-configured with `@sitecore-content-sdk/*` packages (see generated `package.json` for exact names)
- Component map setup
- Layout data fetching (Experience Edge GraphQL)
- Editing support for SitecoreAI Pages
- Middleware stack (multisite, personalization, redirects)
- Environment variable template (`.env.example`)
- Sitecore CLI configuration (`sitecore.json`)

## Post-scaffold steps

1. **Wire local env — MANDATORY UPFRONT QUESTION before writing `.env.local`.**  
   Ask the user for all five values in a single question before touching `.env.local`. Do NOT invent, guess, or fill placeholders:

   > *"To configure `.env.local` I need these 5 values — please paste them all at once:*
   > - `SITECORE_EDGE_CONTEXT_ID` — Cloud Portal → Environment → Edge Context ID*
   > - `NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID` — same value as above (client-side)*
   > - `NEXT_PUBLIC_DEFAULT_SITE_NAME` — the site name (must match the Sites API name)*
   > - `NEXT_PUBLIC_DEFAULT_LANGUAGE` — usually `en`*
   > - `SITECORE_EDITING_SECRET` — Cloud Portal → SitecoreAI Deploy → Environment → Editing Host → Edit → Editing Secret"*

   Wait for the answer before writing the file. A wrong or invented `SITECORE_EDITING_SECRET` silently breaks preview/editing with confusing 401 errors at the end of the build — this value must come from the user.

2. Run `dotnet sitecore login` to authenticate with SitecoreAI (when using CLI against CM).
3. Run `dotnet sitecore ser push` to push serialized items to CM (when applicable).
4. Run `npm run dev` or `npm run start:connected` in the app directory to start the rendering host.

## When NOT to use this scaffold

- An existing project already has a rendering host (extend it instead — don't re-scaffold)
- The project requires the older JSS API (`@sitecore-jss/*`) — use the SitecoreAI starter JS template instead
- The project is a Marketplace integration rather than a rendering host — use `setup-marketplace-client-side` or `setup-marketplace-full-stack` instead

## Greenfield checklist

- [ ] **Picked the template by router (STEP 0)** — `--template nextjs-app-router` for App Router (the default for new work), bare `nextjs` only if Pages Router was explicitly requested.
- [ ] **Picked plain vs cache-components (STEP 0b)** by publish freshness; under OSR, recorded which version line (stable sitewide purge vs exact canary pin).
- [ ] Ran the CLI **literally**, non-interactive form: `npx --yes create-content-sdk-app@<version> --yes --template <nextjs-app-router|nextjs-app-router-cache-components|nextjs> --destination …`.
- [ ] **Verified the router post-scaffold** — App Router: `src/app/` exists and `src/pages/` does not (Pages Router: the reverse). Cache-components: `src/app/api/revalidate/route.ts` exists and `cacheComponents: true` is set. HARD STOPPED on any other outcome instead of hand-converting.
- [ ] Did not use `solo-website` / starter clone as a silent substitute for the CLI.
- [ ] `.env.local` exists with the required Edge context values so `npm run dev` can resolve Edge context and API key.
- [ ] Post-scaffold: Edge / editing / `sitecore.config.ts` follow the **generated** app — avoid inventing a parallel stack.

## What runs after this skill

For a Content SDK head app, after the scaffold is complete you typically pick from:
- The 17 `content-sdk-app-router-*` skills (component scaffolding, registration, GraphQL fetching, multisite, sitemap, dictionary/i18n, editing-safe rendering, etc.) when the scaffold produced an App Router project
- The 11 `content-sdk-pages-router-*` skills in the `sitecore-content-sdk-nextjs-pages-router` plugin (per-concern mirrors; not every App Router skill has a twin) when the scaffold produced a Pages Router project

Pick per concern as the implementation plan calls for them.
