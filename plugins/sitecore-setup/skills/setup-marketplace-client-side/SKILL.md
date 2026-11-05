---
name: setup-marketplace-client-side
description: "Scaffolds a Sitecore Marketplace client-side app: shadcn quickstart, layout flatten, lint fixes, Vitest, store template, Local Network Access headers, optional OAuth proxy for REST calls. Use after setup-scaffold picked client-side."
license: Apache-2.0
compatibility: "Requires Node 18+ and npx; access to https://blok.sitecore.com/r/marketplace/* via npx shadcn; a registered Marketplace app in Cloud Portal (Org Admin/Owner role) before iframe testing in the real portal. No HTTPS required for Mode A — plain HTTP localhost works once Chrome Local Network Access headers are in place."
metadata:
  author: Christian Hahn
  version: "0.5.4"
---

# Marketplace Client-Side Integration Scaffold

**Use when:** Building a Marketplace integration or SitecoreAI-connected application that is **predominantly client-side** — postMessage-bridge SDK calls (Mode A), no SSR, no Auth0 PKCE. Typically a browser-only widget, UI extension, or embedded app.

**Also use when:** the app needs *one or two* server-side route handlers that proxy a **direct Sitecore REST API call** (Agent / Pages / Publishing / Sites) using OAuth client_credentials, because the SDK has no wrapper for that endpoint. In that case, follow the main scaffold steps below, then apply the **"Optional: server-side OAuth proxy"** section near the end of this skill. **Do not use the full-stack scaffold for this** — its Auth0 PKCE surface is dead weight when there is no logged-in-user-delegated SDK call. (Seen on a screenshot app that picked full-stack, 2026-05-02: it carries this dead weight for good; the client-side + proxy shape is the correct one.)

If you haven't decided yet whether this is the right scaffold, run `setup-scaffold` first.

## SDK-first rule

Before adding the OAuth proxy section: confirm the call you need is **not** in `xmc.*`, `ai.*`, or `application.*`. If it is, use the SDK over the postMessage bridge (Mode A) — no server route, no client_secret, no proxy. The OAuth proxy is **only** for endpoints the SDK does not expose. See `marketplace-sdk-client`, `marketplace-sdk-xmc`, `marketplace-sdk-ai` for what the SDK already covers.

## Canonical command

**Interactive:**

```bash
npx shadcn@latest add https://blok.sitecore.com/r/marketplace/next/quickstart-with-client-side-xmc.json
```

**Non-interactive (agents / CI):**

```bash
yes '' | npx --yes shadcn@latest add https://blok.sitecore.com/r/marketplace/next/quickstart-with-client-side-xmc.json --yes --cwd <absolute-target-path>
```

## Interactive prompts

Answered automatically by the non-interactive form above — defaults are the recommended values:

| Prompt | Default | Recommended |
|--------|---------|-------------|
| Start a new project? (framework) | Next.js | Next.js |
| What is your project named? | `next-app` | Accept default unless renaming |
| Select a component library | Radix | Radix |
| Which preset would you like to use? | Nova (Lucide / Geist) | Nova |

## Output layout — the scaffold creates a `next-app/` subdirectory, not in-place

```
<target>/
└── next-app/
    ├── package.json                           # @sitecore-marketplace-sdk/client + xmc pre-installed
    ├── app/layout.tsx                         # wired to MarketplaceProvider
    ├── app/page.tsx                           # renders the example components
    ├── components/
    │   ├── providers/marketplace.tsx          # ClientSDK.init via React Context (see the marketplace-sdk-client skill, § 2)
    │   ├── examples/built-in-auth/
    │   │   ├── application-context.tsx        # application.context query example
    │   │   └── with-xmc/list-languages.tsx    # xmc.sites.listLanguages example
    │   └── ui/                                # shadcn components
    ├── hooks/
    └── lib/
```

### Flatten the `next-app/` subdirectory (recommended default)

The quickstart always lands in a nested `next-app/` subdir. When you scaffold into a project where the app root is meant to be a `site/` folder, the nested layout duplicates a level of path and forces every downstream implementation plan, test runner, Vercel project root, and doc reference to carry a `site/next-app/` prefix. Flatten immediately after the scaffold completes so the Next.js app root IS `<your-app-root>/`:

```bash
# from your project root
mv site/next-app/* site/next-app/.* site/ 2>/dev/null
rmdir site/next-app
```

Verify the flatten worked: `site/package.json` must exist at the top level and `site/next-app` must no longer exist. From this point on the canonical app root is `<your-app-root>/site/` — all downstream paths, tests, Vercel project settings, and documentation reference `site/`, NOT `site/next-app/`.

If the flatten is NOT applied (e.g. when scaffolding multiple sibling apps under the same parent), every implementation-plan path must include the `next-app/` prefix and every downstream reference must match.

## What it creates

- Next.js 16+ app with `@sitecore-marketplace-sdk/client` + `@sitecore-marketplace-sdk/xmc` pre-installed
- `components/providers/marketplace.tsx` — `MarketplaceProvider` + `useMarketplaceClient` + `useAppContext` hooks (React Context pattern — the scaffold's canonical SDK init shape, see the `marketplace-sdk-client` skill, § 2)
- `components/examples/built-in-auth/` — working example components for `application.context` query + XMC `listLanguages` query (covers the typical first SDK call for a Mode A app)
- shadcn/ui component setup with Radix + Nova preset (configurable via prompts)

## Characteristics

- No server-side rendering or API routes
- Communicates with SitecoreAI APIs via the portal postMessage bridge (Mode A, portal-brokered auth — see the `marketplace-sdk-lifecycle` skill, § 5a)
- Suited for: dashboards, editors, lightweight portals, UI extensions

## Post-scaffold steps

1. `cd <target>/next-app` — all subsequent commands run inside the `next-app/` subdirectory.
2. Verify `npm install` completed (shadcn runs it automatically; confirm `package-lock.json` exists).
3. Review the scaffolded components under `components/` (NOT `src/components/` — Next.js 16 quickstart has no `src/` dir).
4. **Fix scaffold lint nits** — the quickstart ships `components/providers/marketplace.tsx` with two small errors that make `npm run lint` fail out of the box: (a) typo `extention` → `extension`; (b) unescaped apostrophe `your app's` → `your app&apos;s` (or switch to double-quoted string). Apply both before running lint. Upstream Blok fix is pending; re-check on SDK/quickstart bumps.

   **Nova preset Badge API drift** — the Nova preset's `components/ui/badge.tsx` does **not** use the standard shadcn variant union. Its `variant` is `'default' | 'bold'` (typography); status/intent is expressed through a separate `colorScheme` prop taking `'neutral' | 'primary' | 'success' | 'danger' | 'warning' | …`. Code copied from generic shadcn examples (e.g. `<Badge variant="destructive">`, `<Badge variant="secondary">`) will fail `tsc --noEmit` with `Type '"destructive"' is not assignable …`. Use `colorScheme="danger"` / `"success"` / `"neutral"` etc. instead. If a different preset was chosen, check `components/ui/badge.tsx` before assuming the variant contract.

5. **Install the test stack** (required for every harness run — the quickstart does not ship a test runner). Drop-in templates live at [`assets/test-stack/`](assets/test-stack/):

   ```bash
   npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
   ```

   Copy `assets/test-stack/vitest.config.ts` and `assets/test-stack/vitest.setup.ts` into the project root next to `package.json`. Add scripts to `package.json` and the `tsconfig.json` `types` patch — both documented in `assets/test-stack/README.md`. The `tsconfig.json` types patch is non-optional: without it `tsc --noEmit` fails on every test file with `Cannot find name 'expect' / 'vi' / 'describe'`.

   For typed SDK stubs (`client.query` / `mutate` / `subscribe` / `destroy`), follow the `vi.fn<Signature>()` pattern in the `marketplace-sdk-client` skill, § 9 — naked `vi.fn()` fails `tsc --noEmit`.

   **Next 16 client-only value detection** — the scaffold targets Next 16, which ships a new `react-hooks/set-state-in-effect` lint rule. Patterns like `useEffect(() => setFoo(detect()), [])` (a common way to fetch client-only values such as `window.parent !== window.self` after hydration) now fail lint. Use `useSyncExternalStore` instead. A drop-in template — with the two non-obvious rules baked in (referentially-stable snapshots cached at module scope, no-op `subscribe`) — lives at [`assets/use-sync-external-store-template.tsx`](assets/use-sync-external-store-template.tsx). Copy it into `lib/embedding.ts` (or equivalent) and use the exported `useEmbedding()` hook from any component. Load-bearing for any harness that needs to distinguish "iframed in portal" vs "top-level browser" at runtime. Live-verified 2026-04-21.

6. `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test` to validate the scaffold's own code + test stack wiring.
7. **Map extension points to routes** — invoke the `marketplace-sdk-extension-routes` skill interactively with the user. The scaffold ships only `app/page.tsx`; each extension point the app exposes (Standalone / Full screen / Dashboard widgets / Page context panel / Custom field) needs its own `app/<route>/page.tsx`. Dashboard widgets may have multiple routes.
8. **If you kept the nested `next-app/` layout (skipped the flatten in step "Flatten the `next-app/` subdirectory" above) — pin `turbopack.root` in `next.config.mjs`.** Next 16's Turbopack auto-infers the project root by walking up from the route file (`app/...`); in a nested `<repo>/site/next-app/` layout it picks `app/` as the workspace root, which makes CSS resolution for `@import "tailwindcss"` (and `tw-animate-css`) walk up from `site/` and miss `next-app/node_modules/`. Symptom in the dev console:

   ```
   Error: Can't resolve 'tailwindcss' in 'C:\...\<repo>\site'
   Next.js inferred your workspace root, but it may not be correct.
   ```

   Fix in `next.config.mjs`:

   ```js
   const nextConfig = {
     turbopack: {
       root: import.meta.dirname,
     },
     // ...rest
   };
   ```

   Discovered while rebuilding a Marketplace app (2026-05-02). If you applied the flatten (so the app root IS `site/`), this pin is not needed.

9. **Before portal install (real iframe testing) — add Chrome Local Network Access headers to the Next config.** The portal is served from a public origin (`https://app.sitecorecloud.io`); Chrome's **Local Network Access** policy blocks public-origin iframes from loading `localhost` URLs unless the target advertises consent. A drop-in config lives at [`assets/next-config-pna-headers.mjs`](assets/next-config-pna-headers.mjs) — copy it verbatim, or merge its `headers()` block into the config you already have.

   **⚠️ The quickstart now emits `next.config.ts`, not `next.config.mjs`, and it is EMPTY** apart from `import type { NextConfig }` (verified against the live registry 2026-08-23). So there is nothing to merge into — but do **not** drop the `.mjs` asset in alongside it, because Next resolves only one config file and the two silently compete. Port the `headers()` block into the existing `.ts`:

   ```ts
   import type { NextConfig } from "next"

   const nextConfig: NextConfig = {
     async headers() {
       return [{
         source: "/:path*",
         headers: [
           { key: "Access-Control-Allow-Private-Network", value: "true" },
           { key: "Access-Control-Allow-Origin", value: "*" },
           { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
           { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, Access-Control-Request-Private-Network" },
         ],
       }]
     },
   }

   export default nextConfig
   ```

   **Verify it rather than assuming** — a missing header presents as a blank iframe, which is indistinguishable from a crashed app and from an app that was registered but never installed:

   ```bash
   curl -sD - -o /dev/null http://localhost:3000/ | grep -i access-control-allow-private-network
   ```

   **Do not combine `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`** — the spec forbids that combo; browsers silently reject the response. For iframe-embed navigation, credentials aren't needed (cookie credentialing uses `SameSite` / `Secure` on the cookies themselves, not CORS). The asset file documents this trap inline.

   **HTTP is fine for Mode A** — the app sets no cookies at its own origin; auth is portal-brokered via postMessage. No HTTPS, no mkcert, no cert-trust dance required for client-side apps. HTTPS + mkcert applies only to the full-stack variant (cookies at the app origin) — see `setup-marketplace-full-stack`.

   Mode A apps need no `.env.local` — portal brokers auth. Env vars enter the picture only for Mode B experimental server-to-server (see the `marketplace-sdk-lifecycle` skill, § 5b).

10. `npm run dev` to start locally (HTTP is fine — see step 9).

## Optional: server-side OAuth proxy for direct Sitecore REST calls

**Apply this section if** the app needs to call a Sitecore REST API directly (Agent `/screenshot`, Pages, Publishing, Sites) because the Marketplace SDK has no wrapper for the endpoint you need. **Do not apply** if the SDK already exposes the call — see the "SDK-first rule" above.

This is the lean alternative to the full-stack scaffold for service-to-service REST proxies. You keep the client-side scaffold (Mode A postMessage bridge for the SDK side) and add **one** Node-runtime route handler that holds the `client_secret` and brokers the OAuth client_credentials flow.

### When this is correct (vs full-stack scaffold)

| You have… | Use this section | Use full-stack scaffold |
|---|---|---|
| A Sitecore REST endpoint with no SDK wrapper, called server-to-server with your own client_id/client_secret | ✅ | ❌ (dead Auth0 weight) |
| A logged-in Cloud Portal user; server makes XMC calls via `experimental_createXMCClient` on their behalf | ❌ | ✅ |
| Both of the above in one app | ✅ apply both | ✅ (Auth0 PKCE for user routes + this proxy for server-to-server routes) |
| Webhook handler / scheduled job / no logged-in user in the loop | ✅ | ❌ |

A page-screenshot app is the typical example of the proxy pattern: postMessage subscribe (Mode A) for page-context awareness + a single OAuth client_credentials proxy for the SitecoreAI Agent `/screenshot` REST call.

### Steps

1. **Get an automation client from Cloud Portal.** Cloud Portal → Settings → Automation Clients → New. Pick the API the client should authorize against (Agent, Pages, Publishing, Sites). You receive a `client_id` and a `client_secret`. Treat the secret like a password — never commit, never `NEXT_PUBLIC_*`.

2. **Add server-only env vars to `.env.local`** using the three-segment naming convention from `sitecoreai-auth` § 0a:

   ```bash
   # .env.local — server-only (NO NEXT_PUBLIC_ prefix)
   SITECORE_<PURPOSE>_CLIENT_ID=...
   SITECORE_<PURPOSE>_CLIENT_SECRET=...
   ```

   `<PURPOSE>` is a short uppercase token describing why this client exists in your app (e.g. `DEPLOY` for general Agent automation, `AI` for brand-review skills, `PUBLISH` for publishing jobs). The convention lets one app carry multiple automation clients side-by-side without collision.

3. **Add a Node-runtime route handler** at `app/api/<purpose>/route.ts` (or `app/api/<purpose>/[param]/route.ts` for parameterized endpoints). Mandatory:

   ```ts
   export const runtime = "nodejs"; // Edge cannot reliably hold the token cache;
                                    // SitecoreAI auth + REST endpoints live outside the Edge network
   ```

   The route is the single chokepoint for: token acquisition + cache, OAuth retry/backoff, error normalization. The browser calls the same-origin path (`fetch('/api/<purpose>/...')`) — never `auth.sitecorecloud.io` or `edge-platform.sitecorecloud.io` directly.

4. **Implement the OAuth client_credentials flow inside the route** following `sitecoreai-auth`:
   - § 0 — credential-acquisition protocol
   - § 0a — three-segment env-var naming
   - § 5 — token cache pattern (in-memory; cache by `sub` claim if you carry multiple clients)
   - § 6 — header format (`Authorization: Bearer <jwt>`)
   - § 7 — 401 handling (invalidate + retry once)

   For Agent-API specifics use `sitecoreai-agent`; for Pages, Publishing, Sites use the corresponding `sitecoreai-*` skill.

5. **Return a uniform JSON envelope.** Recommended shape: `{ ok: true, data }` or `{ ok: false, error: { code, message } }` at HTTP 200 in both cases (so the browser fetch never throws on `!response.ok`). A route such as `app/api/screenshot/[pageId]/route.ts` is the typical place for it.

6. **Do NOT flip the dev script to HTTPS, do NOT install Auth0 PKCE.** This proxy sets no cookies at the app origin (the browser does not authenticate to *your* server — your server authenticates to Sitecore). HTTP localhost remains fine, the Chrome PNA header block from step 9 of the main scaffold is sufficient. No `mkcert -install` needed for this pattern alone.

7. **Browser caller pattern.** From any client component:

   ```ts
   const res = await fetch(`/api/<purpose>/${param}`);
   const envelope = await res.json();
   if (envelope.ok) { /* use envelope.data */ } else { /* surface envelope.error */ }
   ```

### Forbidden in the proxy pattern

| Shortcut | Why |
|---|---|
| Putting `client_id` / `client_secret` under `NEXT_PUBLIC_*` | Inlines the secret into the client bundle; full credential leak. |
| Calling `auth.sitecorecloud.io` from the browser | Same — exposes the secret. The browser must call your same-origin route, full stop. |
| Using Edge runtime for the route | Edge cannot reliably hold the in-memory token cache; refresh storms result. Stick with `runtime = "nodejs"`. |
| Reaching for full-stack scaffold to "get the route capability" | The route capability is one file plus an env var; you do not need Auth0 PKCE, `@auth0/auth0-react`, the four-prompt env chain, or HTTPS-mkcert. Adopting them anyway carries unused surface area into code review forever. |
| Hand-rolling a second OAuth flow when SDK already exposes the call | Re-read the SDK-first rule. If `xmc.*` / `ai.*` covers it, use the SDK over postMessage. The proxy is only for genuinely SDK-less endpoints. |

## Forbidden shortcuts

| Shortcut | Why |
|---|---|
| Hand-installing `@sitecore-marketplace-sdk/*` deps without the shadcn quickstart | Misses the MarketplaceProvider, hooks, and example components — re-creating them by hand drifts from the canonical shape. |
| Skipping the `next-app/` flatten when the project's app root is meant to be `site/` | Forces a `site/next-app/` prefix on every downstream path; pure overhead. |
| Skipping the lint fixes (P-019 typo + apostrophe) | `npm run lint` fails out of the box; CI breaks before any feature work. |
| Skipping the Vitest config + tsconfig types patch | RED tests can't compile; harness runs are blocked. |
| Trying HTTPS-mkcert flow for Mode A | Unnecessary complexity; HTTP + PNA headers are sufficient. The HTTPS flow exists for the full-stack variant only. |
| Picking the full-stack scaffold just to add a single OAuth REST proxy | Carries unused Auth0 PKCE / `@auth0/auth0-react` / four-prompt env chain / HTTPS-mkcert. Use the "Optional: server-side OAuth proxy" section above instead. |

## What runs after this skill

- `marketplace-sdk-extension-routes` — pick Cloud Portal extension points and generate route files
- `marketplace-sdk-client` — Client SDK API reference (init, query/mutate/subscribe)
- `marketplace-sdk-xmc` — XMC endpoints if the app reads/writes SitecoreAI data
- `sitecoreai-auth` (only if applying the "Optional: server-side OAuth proxy" section) — credential acquisition, three-segment env-var naming, token cache, header format, 401 handling
- `sitecoreai-agent` / `sitecoreai-pages` / `sitecoreai-publishing` / `sitecoreai-sites` — endpoint reference for whichever Sitecore REST API the proxy calls
- `marketplace-sdk-testing-debug` — local dev loop, iframe debugging, runtime-value capture
- `blok-setup` + `blok-components` — Blok design system (default UI layer for Marketplace apps)
