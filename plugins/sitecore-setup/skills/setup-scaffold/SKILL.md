---
name: setup-scaffold
description: "Decision tree for a new Sitecore app: Content SDK head app, Marketplace client-side (optional OAuth proxy) or Marketplace full-stack, SDK-first. Use for any new Content SDK, SitecoreAI or Marketplace project. Never in an existing project."
license: Apache-2.0
compatibility: "Requires Node 18+ and npx. Per-variant requirements are documented in the routed skill (setup-content-sdk, setup-marketplace-client-side, or setup-marketplace-full-stack). Content SDK route verified 2026-09-18 against create-content-sdk-app 2.4.0: the four template ids are angular / nextjs / nextjs-app-router / nextjs-app-router-cache-components, accepted both as `--template <id>` and positionally."
metadata:
  author: Christian Hahn
  version: "0.5.2"
---

# Sitecore Project Scaffolding — Decision Tree

This skill is the **entry point** for any greenfield Sitecore project. It picks the right scaffold variant; the routed `setup-*` skill owns the actual commands, failure policy, and post-scaffold steps.

## When to use

- A greenfield Sitecore project is being started and no rendering host exists yet
- A PRD or design doc identifies that a new head application is needed
- The user asks for a **new project based on Content SDK**, **SitecoreAI**, **SitecoreAI** (head app / headless site / rendering host), **head application**, **editing host**, or related wording
- The project brief mentions Content SDK, SitecoreAI, or a Marketplace integration

Do **not** scaffold into an existing project. If a rendering host is already present, read its structure and extend it — do not re-scaffold.

---

## SDK-first rule (read before the decision tree)

**If the Marketplace SDK exposes the call you need (`xmc.*`, `ai.*`, `application.*`), use the SDK — never reach for a direct Sitecore REST API call.** The SDK runs over the postMessage bridge (Mode A) and handles auth for you; bypassing it for an endpoint that already has a wrapper is a mistake.

A direct REST call against a Sitecore API (Agent / Pages / Publishing / Sites — issued with your own OAuth client_credentials) is only justified when the SDK has **no** wrapper for the endpoint you need. When that happens, you get a `client_id` + `client_secret` from Cloud Portal → Automation Clients and you do the OAuth dance yourself server-side.

**Crucially: needing a direct REST call by itself does NOT push you to the full-stack scaffold.** It only means you need *one* Node-runtime route handler to hold the `client_secret`. The client-side scaffold + a single route handler is the right shape — see the "Optional: server-side OAuth proxy" section in `setup-marketplace-client-side`. The full-stack scaffold is for *user-delegated* server-side SDK calls (Auth0 PKCE + `experimental_createXMCClient`), not for service-to-service REST proxies.

## Decision tree

```text
Is the project a Marketplace integration?
│
├─ NO  → Is it a standard SitecoreAI headless rendering host?
│        └─ YES → use setup-content-sdk
│
└─ YES → Do you need server-side SDK calls (SSR, server actions, experimental_createXMCClient
         on behalf of a logged-in Cloud Portal user)?
         │
         ├─ YES → use setup-marketplace-full-stack
         │        (Auth0 PKCE — user-delegated tokens; Mode B)
         │
         └─ NO  → Will the app call any Sitecore REST API directly (Agent / Pages /
                  Publishing / Sites) because the SDK has no wrapper for it?
                  │
                  ├─ NO  → use setup-marketplace-client-side
                  │        (pure Mode A — postMessage bridge only)
                  │
                  └─ YES → use setup-marketplace-client-side AND add a single
                           Node route handler for the OAuth client-credentials proxy.
                           See its "Optional: server-side OAuth proxy" section, plus
                           sitecoreai-auth for the OAuth flow + token cache.
                           Do NOT use the full-stack scaffold — the Auth0 PKCE surface
                           area is dead weight in this case (one screenshot app carries
                           this for good; the client-side + proxy shape is correct).
```

---

## Routed skills

| If the answer is… | Invoke this skill | Canonical command |
|---|---|---|
| Content SDK head app (SitecoreAI rendering host) | `setup-content-sdk` | `npx create-content-sdk-app@latest --template nextjs-app-router` (**App Router — the default**; the bare `nextjs` token gives **Pages Router** and is NOT interchangeable — see `setup-content-sdk` STEP 0, then verify `src/app/` exists; `--template nextjs-app-router-cache-components` when publishes must go live without a redeploy — STEP 0b) |
| Marketplace Client-Side (browser-only widget / UI extension / embedded app) | `setup-marketplace-client-side` | `npx shadcn@latest add https://blok.sitecore.com/r/marketplace/next/quickstart-with-client-side-xmc.json` |
| Marketplace Client-Side **+ OAuth proxy** for direct Sitecore REST calls | `setup-marketplace-client-side` (same scaffold) + its "Optional: server-side OAuth proxy" section | Client-side quickstart above + one hand-written `app/api/<purpose>/route.ts` |
| Marketplace Full-Stack (server-side SDK calls on behalf of a logged-in user — Auth0 PKCE + `experimental_createXMCClient`) | `setup-marketplace-full-stack` | `npx shadcn@latest add https://blok.sitecore.com/r/marketplace/next/quickstart-with-full-stack-xmc.json` |

Each routed skill carries the canonical command, failure policy, forbidden shortcuts, and the full post-scaffold step list. Do not run the commands from this skill — invoke the routed skill so the consumer receives the up-to-date post-scaffold guidance for the variant they picked.

---

## How to disambiguate the user's intent (when the brief is vague)

If the brief says "new Sitecore app" without naming a variant, ask **one** clarifying question before routing:

```
Which kind of Sitecore app are you building?
  (a) A SitecoreAI rendering host (a public-facing headless website driven by SitecoreAI)
  (b) A Marketplace app — embedded inside the Sitecore Cloud Portal as a widget / panel / full-screen tool
      (b1) Client-side only — postMessage SDK only (Mode A); no server routes
      (b2) Client-side + OAuth proxy — Mode A SDK + ONE Node route handler that calls
           a Sitecore REST API directly (Agent / Pages / Publishing / Sites) using your
           own client_id + client_secret, because the SDK has no wrapper for that endpoint
      (b3) Full-stack — server-side SDK calls on behalf of a logged-in Cloud Portal user
           (Auth0 PKCE + experimental_createXMCClient; e.g. SSR or server actions that
           act as the logged-in user)
```

The answer maps 1:1 to the routed skills (b2 routes to the same scaffold as b1 — just with the optional OAuth-proxy section applied). Do not guess — getting this wrong forces a re-scaffold later.

**Heuristic for b2 vs b3:** if the user mentions "automation client", "client_id + client_secret", "service-to-service", "webhook handler", "scheduled job", or names a SitecoreAI REST endpoint (Agent `/screenshot`, Pages, Publishing, Sites) — that's b2, not b3. b3 is for apps where a real human is logged in and the server makes SDK calls *as them*.

---

## Forbidden across all three variants

These shortcuts produce drift, so they are forbidden by every routed skill:

| Shortcut | Why it's forbidden |
|---|---|
| Cloning **`solo-website`** / SitecoreAI starter as a substitute | Not the official generator; couples you to starter layout instead of CLI defaults. |
| Copying another local app as a "template" | Drifts from current CLI defaults and hides updates. |
| `npm init` + pasted `@sitecore-content-sdk/*` or `@sitecore-marketplace-sdk/*` deps | Easy to miss middleware, proxy, component maps, and config the CLI sets up. |
| Hand-assembling the Auth0 / Cloud Portal registration values | The full-stack variant has a documented prompt chain — using it prevents AUTH-APL50-56 redirect loops. |

**Exception:** Only when the user **explicitly** asks for a named starter (e.g. "use the SitecoreAI starter `solo-website` repo because…"). Document the override in the project's ADR.

---

## Agent guidance

When a PRD or architecture calls for a new Sitecore rendering host or Marketplace integration:

1. **Run this skill first** to identify which scaffold applies. Record the choice as an architectural commitment (e.g. an ADR).
2. **Invoke the routed `setup-*` skill** for the actual scaffold command and post-scaffold steps.
3. **Reference the routed skill in the implementation plan's stack/tooling section** so the implementing agent has the exact command without having to re-run the decision tree.
4. **Run the scaffold as the first implementation step.** Do not scaffold if a rendering host already exists.

For **any** greenfield Sitecore app, this is the entry skill — the routed skill carries the variant-specific detail.
