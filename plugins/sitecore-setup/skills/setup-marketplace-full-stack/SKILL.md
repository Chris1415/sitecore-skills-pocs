---
name: setup-marketplace-full-stack
description: "Scaffolds a Sitecore Marketplace full-stack app with Auth0 PKCE: API routes, SSR, server-side SDK calls for the logged-in user, HTTPS, CSP and env vars. Use after setup-scaffold picked full-stack. Not server-to-server proxies."
license: Apache-2.0
compatibility: "Requires Node 18+, npx, a registered Marketplace app in Cloud Portal (Org Admin/Owner role), an Auth0 PKCE client id, and HTTPS dev (Next.js 13.5+ with --experimental-https). On Windows: mkcert with elevated install for system-trusted local certs (otherwise iframe rejects with chrome-error://chromewebdata/)."
metadata:
  author: Christian Hahn
  version: "0.4.7"
---

# Marketplace Full-Stack Integration Scaffold

**Use when:** Building a Marketplace app that needs server-side **SDK** calls on behalf of a logged-in Cloud Portal user — typically `experimental_createXMCClient` invoked from SSR, server actions, or API routes that act *as the user*. The auth flow is **Auth0 PKCE (Mode B)**: a real user logs into the portal, the iframe gets an access token, your server calls XMC with that token.

**Do NOT use when:** the app's only server-side need is a **direct Sitecore REST API call** (Agent / Pages / Publishing / Sites) issued with your own automation `client_id` + `client_secret` because the SDK has no wrapper for that endpoint. That is **Mode C — service-to-service**, and the lighter shape is `setup-marketplace-client-side` + its **"Optional: server-side OAuth proxy"** section. Picking this scaffold for that case carries unused Auth0 PKCE / `@auth0/auth0-react` / four-prompt env chain / HTTPS-mkcert into your app forever.

If you haven't decided yet whether this is the right scaffold, run `setup-scaffold` first. The decision tree distinguishes Mode A (no server), Mode B (this skill), and Mode C (client-side + OAuth proxy).

## SDK-first rule

Before committing to this scaffold: confirm the call you need on the server is **not** already covered by a non-server SDK path. If `xmc.*` / `ai.*` / `application.*` over the postMessage bridge can do the job from the browser (Mode A), do that — `setup-marketplace-client-side` is the right scaffold and you avoid the entire Auth0 / HTTPS / mkcert chain. The full-stack scaffold only earns its keep when the server **must** be the one calling SDK endpoints (typically because the call needs to happen during SSR, in a Server Action, or via `experimental_createXMCClient` with a user's token).

## Canonical command

**Interactive:**

```bash
npx shadcn@latest add https://blok.sitecore.com/r/marketplace/next/quickstart-with-full-stack-xmc.json
```

**Non-interactive (agents / CI):**

```bash
yes '' | npx --yes shadcn@latest add https://blok.sitecore.com/r/marketplace/next/quickstart-with-full-stack-xmc.json --yes --cwd <absolute-target-path>
```

## Interactive prompts

Identical to the client-side variant — same four, same defaults Next.js / `next-app` / Radix / Nova. The non-interactive form above works unchanged.

## Output layout — the scaffold creates a `next-app/` subdirectory, not in-place

```
<target>/
└── next-app/
    ├── package.json                           # + @auth0/auth0-react added (Mode B dep)
    ├── .env.local                             # NEXT_PUBLIC_AUTH0_* + SITECORE_* placeholders populated
    ├── next.config.ts                         # CSP frame-ancestors allowlist (populated)
    ├── next.config.mjs                        # ⚠ empty leftover from the template — DELETE
    ├── app/
    │   ├── layout.tsx                         # wraps MarketplaceProvider + AuthProvider
    │   ├── page.tsx                           # demo landing
    │   └── api/sites/languages/route.ts       # Mode B Route Handler worked example
    ├── components/
    │   ├── providers/
    │   │   ├── marketplace.tsx                # Mode A provider (still ships — Mode A + B coexist)
    │   │   └── auth.tsx                       # NEW — Auth0 React provider + useAuth() helper
    │   └── examples/
    │       ├── built-in-auth/                 # Mode A examples (same as the client-side variant)
    │       └── custom-auth/                   # NEW — Mode B examples
    │           ├── with-api-route/list-languages.tsx
    │           └── with-server-action/
    │               ├── list-languages.tsx
    │               └── action.ts
    ├── hooks/
    └── lib/
```

The `next-app/` flatten guidance from the client-side variant applies here too — see the `setup-marketplace-client-side` skill for the flatten command and rationale; the trade-off is identical.

## What it creates

- Everything the client-side variant creates PLUS:
- `@auth0/auth0-react` added to deps — PKCE public-client OAuth, no client secret needed
- `AuthProvider` wrapping `Auth0Provider` + `withAuthenticationRequired`; `useAuth()` hook augments `getAccessTokenSilently` with org/tenant authorization params
- Pre-written Mode B worked examples — `experimental_createXMCClient` calls via both API Route Handler and Server Action
- `next.config.ts` with `Content-Security-Policy: frame-ancestors 'self' https://marketplace-app.sitecorecloud.io https://pages.sitecorecloud.io https://xmapps.sitecorecloud.io` — good security default the client-side variant doesn't have

## Characteristics

- Mode B (Auth0 PKCE — user-delegated tokens on the server) for secure server-side XMC calls
- Mode A (portal-brokered iframe SDK) still available via `MarketplaceProvider` — both can be used in the same app
- Suited for: full applications, portals with auth, integrations requiring secure server-side XMC access, management tools that need to call XMC with a user's access token

## Auth modes — confirm Mode B before running this scaffold

This scaffold is the **Mode B (Auth0 PKCE)** path. Below is the full picture; only the middle row belongs in this skill.

| Auth flow | Scaffold | Use when |
|---|---|---|
| **Mode A — portal-brokered postMessage** | `setup-marketplace-client-side` | All needed calls live in the SDK (`xmc.*`, `ai.*`, `application.*`); no server side at all |
| **Mode B — Auth0 PKCE (user-delegated server SDK calls)** | **This skill** | Logged-in Cloud Portal user; server makes SDK calls *as them* via `experimental_createXMCClient` (SSR / server actions / API routes that act on the user's behalf) |
| **Mode C — OAuth 2.0 client-credentials (server-to-server REST proxy)** | `setup-marketplace-client-side` + its **"Optional: server-side OAuth proxy"** section | Server-to-server calls to a Sitecore REST API (Agent / Pages / Publishing / Sites) with your own `client_id` + `client_secret`, because the SDK has no wrapper for that endpoint. No logged-in user in the loop. |

### Mode C does NOT belong in this scaffold — redirect

If your only server-side need is a Sitecore REST proxy with client_credentials, **stop and switch to `setup-marketplace-client-side`**. Apply its "Optional: server-side OAuth proxy" section: one Node-runtime route handler, two server-only env vars (`SITECORE_<PURPOSE>_CLIENT_ID/SECRET`), no PKCE, no HTTPS-mkcert, no four-prompt env chain. Reference `sitecoreai-auth` for the OAuth flow.

**A cautionary example (a page-screenshot app, 2026-05-02).** It picked this scaffold (full-stack) just to land one Node route for the SitecoreAI Agent `/screenshot` REST proxy — and now carries the unused Auth0 PKCE / `@auth0/auth0-react` / `custom-auth/` examples / four-prompt env chain forever. The correct shape would have been `setup-marketplace-client-side` + the OAuth proxy section.

### Hybrid (Mode B + Mode C in one app)

If you genuinely need **both** user-delegated server SDK calls *and* server-to-server REST proxies (e.g. a portal-with-auth that also runs background SitecoreAI REST jobs): use **this** scaffold for Mode B and *also* apply the OAuth-proxy steps from `setup-marketplace-client-side`'s optional section for the Mode C routes. Auth0 PKCE for the user-facing routes; client-credentials for the background/proxy routes. Two token caches, two sets of env vars, no overlap. This is the only case where mixing belongs in the full-stack scaffold.

## Post-scaffold steps

1. `cd <target>/next-app` — all subsequent commands run inside the `next-app/` subdirectory.

2. **Delete the leftover empty `next.config.mjs`** — the scaffold ships BOTH `next.config.mjs` (empty) and `next.config.ts` (populated with CSP). Next 15+ picks up `.ts`, so the `.mjs` is dead weight; first-time builder patching the empty `.mjs` thinking it's authoritative will scratch their head when headers don't land. `rm next-app/next.config.mjs`.

3. **Apply the same lint fixes to `components/providers/marketplace.tsx`** — this scaffold ships the same provider file as the client-side variant with the same `extention` typo + unescaped-apostrophe lint failures. Fix both before `npm run lint`: (a) `extention` → `extension`, (b) `your app's` → `your app&apos;s`.

4. **Install the test stack** — Vitest + testing-library + jsdom + plugin-react + the `tsconfig.json` types patch (`"types": ["vitest/globals", "@testing-library/jest-dom"]`). The quickstart doesn't ship a test runner. Drop-in templates (`vitest.config.ts`, `vitest.setup.ts`, install command, scripts, types patch) live at the `setup-marketplace-client-side` skill's `assets/test-stack/` — same files apply here unchanged.

5a. **If you kept the nested `next-app/` layout (skipped the flatten) — pin `turbopack.root` in `next.config.ts`.** Same Next 16 workspace-root inference bug as the client-side variant: Turbopack picks `app/` as the project root and CSS resolution for `@import "tailwindcss"` walks up from `site/`, missing `next-app/node_modules/`. Symptom: `Error: Can't resolve 'tailwindcss' in 'C:\...\<repo>\site'`. Fix in `next.config.ts`:

   ```ts
   const config: NextConfig = {
     turbopack: {
       root: import.meta.dirname,
     },
     // ...rest
   };
   ```

   Discovered while rebuilding a Marketplace app (2026-05-02); see also the parallel section in `setup-marketplace-client-side` step 8. If you applied the flatten (so the app root IS `site/`), this pin is not needed.

5. **Merge Chrome PNA headers into `next.config.ts` alongside the shipped CSP `frame-ancestors` allowlist.** This scaffold ships the CSP but not the Local Network Access consent — without the PNA headers Chrome will still block public-origin iframes (portal → `localhost`) even over HTTPS. The four-header block lives at the `setup-marketplace-client-side` skill's `assets/next-config-pna-headers.mjs`; never combine `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` (the spec forbids it and browsers silently reject the response; iframe navigation needs no credentials header). Keep your existing CSP `headers` entry — append the four PNA headers to the same `headers` array of the same `source: "/(.*)"` rule.

6. **Flip the dev script to HTTPS.** This scaffold is full-stack Mode B: the app sets `Secure; SameSite=None` cookies at its own origin during the Auth0 flow, which requires HTTPS locally. Edit `package.json` → `scripts.dev` to `next dev --experimental-https --turbopack`. On Windows, also run `mkcert -install` once from an elevated PowerShell so the cert is system-trusted — otherwise iframe cert rejection produces `chrome-error://chromewebdata/` in the portal. Without admin rights, pre-generate the cert instead (`mkcert -key-file certificates/localhost-key.pem -cert-file certificates/localhost.pem localhost 127.0.0.1 ::1`; Next reuses it and skips `-install`) — but an untrusted cert still fails inside the portal iframe, so either get the CA trusted or tunnel (`cloudflared` / `ngrok`) and register the tunnel URL. After regenerating a cert, fully restart Chrome: it caches trust per process. Deeper debugging: the `marketplace-sdk-testing-debug` skill.

7. **Populate `.env.local` — interactive prompt chain (do not leave placeholders).** The scaffold pre-adds eight `NEXT_PUBLIC_*` vars. Four already have correct defaults (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_SCOPE`, `APP_BASE_URL`) — leave them alone. Four need real values. **Ask the user for each one verbatim — do not assume or skip.** Leaving placeholders produces a silent `access_denied` redirect loop the first time the app loads in the portal iframe, with error `Product codes in request do not match client Product codes. (AUTH-APL50-56)`.

   **Before prompting — offer the "use defaults" shortcut.** If a project-local `.env` ships working Marketplace-app defaults (matching `.env.local` names one-to-one), ask the user first:

   > Do you want to provide the four Marketplace values yourself, or use the defaults from the project's root `.env`? (type `use default` to copy them automatically, or `provide` to enter each one)

   If the user answers **`use default`** (or equivalent: "default", "defaults", "yes use defaults"): read the root `.env`, copy the values for `NEXT_PUBLIC_AUTH0_CLIENT_ID`, `NEXT_PUBLIC_SITECORE_APP_ID`, `NEXT_PUBLIC_SITECORE_ORGANIZATION_ID`, and `NEXT_PUBLIC_SITECORE_TENANT_ID` into the new app's `.env.local`, and skip prompts 7a–7d. Report which values were copied (mask nothing — these are public PKCE identifiers, see note at end of this step).

   If the user answers **`provide`** (or anything other than a clear "use default"): continue with prompts 7a–7d below.

   Prompt the user for these four values, in this order, with these exact questions:

   **Prompt 7a — `NEXT_PUBLIC_AUTH0_CLIENT_ID`**
   > What is your Auth0 **Client ID** for this Marketplace app?
   > Where to find: Cloud Portal → App Studio → your app → General / Auth0 section. Looks like a 32-char alphanumeric string (e.g. `AbCdEfGhIjKlMnOpQrStUvWxYz012345`). This identifies the OAuth client registered for your app; wrong value causes Auth0 to reject with `unauthorized_client`.

   **Prompt 7b — `NEXT_PUBLIC_SITECORE_APP_ID`**
   > What is your **Sitecore App ID** for this Marketplace app?
   > Where to find: Cloud Portal → App Studio → your app → Overview (labelled "App ID" or "Client ID"). A UUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. The `AuthProvider` derives `product_codes: mkp_${APP_ID}`; if this value doesn't match the app Auth0 has registered, every authorization request fails with error **AUTH-APL50-56 "Product codes in request do not match client Product codes"** and `withAuthenticationRequired` loops. This is the #1 silent-failure trap.

   **Prompt 7c — `NEXT_PUBLIC_SITECORE_ORGANIZATION_ID`**
   > What is your Cloud Portal **Organization ID**?
   > Where to find (two easy paths):
   > - **Portal iframe URL (fastest):** once the app is installed and the portal loads the iframe, the iframe `src=` includes `?organizationId=org_…` as a query parameter. Copy that exact value (starts with `org_`, ~20 chars, e.g. `org_<your-org-id>`).
   > - **Cloud Portal UI:** organization switcher → Settings → Organization → Organization ID.

   **Prompt 7d — `NEXT_PUBLIC_SITECORE_TENANT_ID`**
   > What is your **Marketplace app tenant ID** (assigned after install)?
   > Where to find: the same portal iframe URL from 7c also includes `?marketplaceAppTenantId=…` — a UUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. That's this value. If the app is not yet installed into a SitecoreAI environment, this value doesn't exist yet — install first, then grab it from the iframe URL after reload.

   After the four prompts: write the values into `.env.local`, preserving the four defaults, save, hard-reload the portal tab.

   **Why all vars are `NEXT_PUBLIC_*`** — PKCE public-client OAuth means there is no client secret. Identifiers (domain, audience, client ID, org/tenant, app ID) are public by design; they're embedded in the client bundle because the authorization flow happens browser-side. This is not a secret-leak, it's the PKCE flow. Background in the `marketplace-sdk-lifecycle` skill, § 5b + § 5c.

   **If the user can't find a value** — do NOT guess or substitute; ask them to open App Studio / the portal iframe URL and report what they see. Wrong values here create failure modes that look like configuration bugs elsewhere (iframe hangs, Auth0 redirects, CSP errors) and waste hours to diagnose.

8. **Pick a canonical response-unwrap convention for your Mode B examples.** The two shipped examples are inconsistent: the Server Action unwraps at the server (`return languages?.data ?? []` → client receives `Xmapp.Language[]`), while the API Route passes the full SDK wrapper (`NextResponse.json(languages)`) and the client unwraps (`setLanguages(data.data)`). Same backend call, two client contracts. **Recommendation: unwrap at the server boundary always** — Server Action and Route Handler both do `return languages?.data ?? []` so consumers always receive `Xmapp.Language[]`. Pick one and commit; document the choice in the ADR.

9. `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test` to validate the scaffold's own code + your patches.

10. `npm run dev` to start locally (HTTPS on port 3000 after step 6).

## Forbidden shortcuts

| Shortcut | Why |
|---|---|
| Hand-assembling Auth0 + PKCE config without the shadcn quickstart | Easy to misconfigure `product_codes` / `audience` / `tenant_id` and trip AUTH-APL50-56. |
| Skipping the `next.config.mjs` deletion | First-time builders patch the empty `.mjs` thinking it's authoritative; headers don't land. |
| Skipping the HTTPS dev-script flip | Auth0 cookies (`Secure; SameSite=None`) cannot be set over HTTP; auth silently fails. |
| Skipping `mkcert -install` on Windows | Self-signed cert rejected inside iframe → `chrome-error://chromewebdata/`. |
| Leaving `.env.local` placeholders | Silent `access_denied` redirect loop with AUTH-APL50-56 on first portal load. |
| Mixing the two response-unwrap conventions | Same backend call returns different shapes to different consumers. |

## What runs after this skill

- `marketplace-sdk-extension-routes` — pick Cloud Portal extension points and generate route files
- `marketplace-sdk-lifecycle` — Auth0 model, hosting, custom-vs-public app
- `marketplace-sdk-client` — Client SDK API reference (Mode A coexists with Mode B in this app)
- `marketplace-sdk-xmc` — XMC endpoints in both Mode A and Mode B (`experimental_createXMCClient`)
- `marketplace-sdk-ai` — AI skills if the app uses brand review
- `marketplace-sdk-testing-debug` — local dev loop, iframe cookie config, mkcert traps, debugging checklist
- `blok-setup` + `blok-components` + `blok-marketplace-integration` — Blok design system
