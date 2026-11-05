---
name: marketplace-sdk-lifecycle
description: "Lifecycle of a Sitecore Marketplace app: custom vs public, Cloud Portal registration, client-side vs full-stack vs server-to-server architecture, Auth0, hosting, Blok, submission. Load before any code when planning a Marketplace app."
license: Apache-2.0
compatibility: "Requires Sitecore Cloud Portal access with Org Admin or Owner role (needed to register the Marketplace app before any code can connect)."
metadata:
  author: Christian Hahn
  version: "0.4.3"
---

# Sitecore Marketplace App Lifecycle

> **This skill is a catalog, not a contract.** It documents lifecycle phases, app-architecture options, and Auth0 model. It does **not** document tenant-side preconditions (e.g. `Sites.Host.targetHostname` must be populated for the Live URL to resolve), nor does it document the runtime availability of any specific SDK call. Verify in a real tenant before declaring shipped.

## When to use

- A project is starting a **new Marketplace integration** and you need to decide custom vs public
- The architecture phase needs to pick an app architecture (client-side iframe, full-stack, standalone with server-to-server)
- You need to know what fields/values to register in **Cloud Portal → App Studio**
- You are configuring Auth0 for iframe compatibility (cookies, scopes, orgId/tenantId)
- You are preparing a public app for submission and need the Sitecore/Blok checklist

For **Client SDK reference** (`ClientSDK.init`, query/mutate/subscribe, extension-point types) see the `marketplace-sdk-client` skill.
For **XMC endpoint keys** (`xmc.*` — sites, pages, agent, GraphQL) see the `marketplace-sdk-xmc` skill.
For **AI skills module** (`@sitecore-marketplace-sdk/ai`) see the `marketplace-sdk-ai` skill.
For **local dev + iframe debugging** see the `marketplace-sdk-testing-debug` skill.

---

## 1. Custom vs public apps

| Dimension | Custom app | Public app |
|-----------|------------|-----------|
| Availability | Your organization + any organizations you whitelist | All Sitecore organizations via public Marketplace listing |
| Approval | None — self-serve | **Sitecore review required** before publication |
| Hosting | **Self-hosted** (your infra / cloud) | Self-hosted, but discoverable via public Marketplace |
| Listing | Private — not in public Marketplace | Public Marketplace listing (https://portal.sitecorecloud.io/marketplace) |
| Blok compliance | Recommended | Effectively required for submission approval |
| Typical use | Internal tools, customer-specific integrations, prototypes | Reusable integrations distributed to the ecosystem |

**Decision rule:** If the integration is for a single customer or internal use, build a **custom app**. Only target **public** if the integration is reusable across organizations and you accept the review/compliance overhead.

---

## 2. Lifecycle phases

### 2a. Custom app — 5 phases

```
1. Register   → Create the app in Cloud Portal → App Studio
2. Configure  → Set extension points, API access, dev URL, authorization
3. Install    → Install into one or more organizations
4. Build      → Implement with Marketplace SDK (client / xmc / ai)
5. Finish     → Post-build configuration (prod URL, access grants, updates)
```

Build (phase 4) and Install (phase 3) can be iterative — install early with a localhost dev URL, then iterate on code.

### 2b. Public app — 9 phases

```
1. Register   → Same as custom
2. Configure  → Same as custom
3. Install    → Internal install for testing
4. Build      → Implement with Marketplace SDK
5. Finish     → Post-build configuration
6. Test       → End-to-end verification in real portal
7. Prepare    → Marketing materials, icons, descriptions, Blok review
8. Submit     → Submit for Sitecore approval
9. Publish    → Appears in public Marketplace after approval
```

Phases 7–9 are **unique to public apps**. Phases 1–6 are shared with custom apps.

---

## 3. What you register in Cloud Portal → App Studio

**Required role:** You must be `Organization Admin` or `Organization Owner` in the target Sitecore Cloud Portal organization.

**What's configured during Register + Configure phases:**

| Field / concept | Notes |
|-----------------|-------|
| App name | Distinct, descriptive. Use `Test application` suffix for throwaway test apps. |
| App URL (development) | `https://localhost:3000` for local dev (must be HTTPS — see § 5). |
| App URL (production) | Set during Finish phase once hosting is live. |
| Extension points | One or more of `standalone`, `xmc:fullscreen`, `xmc:pages:contextpanel`, `xmc:pages:customfield`, `xmc:dashboardblocks`. See the `marketplace-sdk-client` skill, § 7, for capabilities per point. For Route URL per extension point (including multi-route Dashboard widgets) run the `marketplace-sdk-extension-routes` skill after scaffold. |
| API access | Which XMC/Authoring/Preview/Live/AI APIs the app may call. Enable only what's needed; for local dev enable all. |
| Authorization type | Determines whether Auth0 flow is iframe-embedded vs server-to-server (see § 5). |
| Environment binding | Which SitecoreAI environment(s) the app is installed against. |
| Access grants | Which users / groups in the organization may see the app (leave minimal during dev). |

**Sub-pages that document each phase:**
- `register-a-custom-app.html` — app name, URL, extension points
- `configure-and-activate-a-custom-app.html` — API access, authorization, environments
- `install-an-activated-custom-app.html` — install into org
- `finish-configuration.html` — prod URL, access grants
- `update-an-installed-app.html` — version updates

---

## 4. App architectures

Three architectures are viable. Pick one at architecture time — **do not plan "we'll try both as fallbacks"**.

### 4a. Client-side iframe (most common)

```
Browser
  └─ Sitecore portal (parent window)
        └─ <iframe src="https://your-app.example.com">
              └─ Your Next.js app
                    └─ ClientSDK.init({ target: window.parent, modules: [XMC, AI?] })
                    └─ client.query('xmc.sites.listSites', …)
```

- App communicates with XMC/AI **only via the postMessage bridge** to the portal.
- No direct XMC/AI API calls from the app — the portal brokers them.
- Auth is handled entirely by the portal; the app has no tokens of its own.
- **Scaffold:** the `setup-marketplace-client-side` skill, or `setup-marketplace-full-stack` if you want SSR routes for your own UI only.
- **SDK reference:** the `marketplace-sdk-client` skill for Client SDK base, the `marketplace-sdk-xmc` skill for XMC endpoints, the `marketplace-sdk-ai` skill for AI skills — all assume this architecture.

### 4b. Full-stack (iframe + own server routes)

Same as 4a, but the Next.js app has its own API routes for **non-XMC** server logic (your own DB, third-party APIs). XMC/AI calls still go through the Client SDK via postMessage.

- Use when the app has its own backend concerns (webhooks, scheduled jobs, your own data layer).
- Does **not** bypass the portal for XMC/AI calls.
- **Scaffold:** the `setup-marketplace-full-stack` skill.

### 4c. Standalone + experimental server-to-server (direct XMC/AI)

```
Browser  ←→  Your Next.js app  ←→  Auth0  ←→  Sitecore XMC/AI APIs (direct)
              (iframe or standalone)
```

- Uses `experimental_createXMCClient` and/or `experimental_createAIClient` with an Auth0 access token.
- Calls go directly to XMC/AI APIs from your server, **not** through the portal postMessage bridge.
- Required for scenarios where the app runs **outside** the iframe (background jobs, microservices, CLI) **or** when you need the full XMC/AI API surface without portal brokering.
- **Status: experimental.** Subject to breaking changes. Only use when the iframe path is insufficient.
- You still register the app in Cloud Portal with a `standalone` extension point.

**When to use 4c:**
- Background jobs / cron / webhooks that need XMC access
- AI skills that process content out-of-band from user interaction
- Server-side rendering where the client bundle can't hold an iframe SDK

**When NOT to use 4c:**
- The app runs inside the portal iframe and needs live page context (use 4a/4b)
- You just want to avoid learning the Client SDK (use 4a — it's the supported path)

### 4d. Hybrid: postMessage subscribe + client-credentials proxy

```
Browser
  └─ Sitecore portal (parent window)
        └─ <iframe src="https://your-app.example.com">
              └─ Your Next.js app
                    ├─ Client side: ClientSDK.init() — subscribes to pages.context, application.context
                    │                (Mode A — same as 4a/4b)
                    └─ Server side: app/api/<route>/route.ts
                                     └─ uses OAuth 2.0 client-credentials (machine-to-machine)
                                        to call SitecoreAI Agent / Pages / Publishing / Sites APIs
                                        on behalf of an automation client
```

A hybrid that doesn't fit 4a/4b/4c cleanly. The app runs in the portal iframe (so the user sees `pageId`, `siteName` from `pages.context`) **and** has Next.js API routes that call SitecoreAI APIs server-to-server using **OAuth 2.0 client-credentials** — *not* Auth0 PKCE. The two halves talk to two different auth systems:

- **Client (Mode A):** postMessage to portal → iframe-brokered XMC calls. No tokens in browser.
- **Server (custom):** Next.js route handler → OAuth client-credentials → SitecoreAI Agent/Pages/Publishing/Sites APIs. Token cached in server memory; tenant identity comes from the `sub` claim, not from a logged-in user.

**Use when:**
- The app needs an SDK call that has no SDK wrapper (e.g. Agent `/screenshot`, Publishing job creation) — the only way to make that call is server-to-server against the underlying REST API.
- The app is a service-to-service proxy with no logged-in Cloud Portal user (the automation client *is* the principal).
- You want both sides at once: subscribe to live page context **and** make backend calls without a PKCE login flow.

**Don't use when:**
- The call has an SDK wrapper (`xmc.*`) — use 4a or 4b instead. Don't reinvent.
- The app needs the user's identity / org / tenant in the access token — use 4c (Auth0 PKCE).
- The call must be made client-side from the iframe — Mode A only, see 4a.

**Auth model:**
- Client: portal-brokered (nothing to configure beyond Cloud Portal app registration).
- Server: OAuth 2.0 client-credentials per the `sitecoreai-auth` skill. Three-segment env vars (`SITECORE_<API>_CLIENT_ID/SECRET`, server-only — NOT `NEXT_PUBLIC_*`).

**Scaffold:** start from `setup-marketplace-full-stack` (you need the API routes), then **skip the Auth0 PKCE post-scaffold steps** — see that skill's "Auth modes" section for the exact substitution. Optionally remove the `@auth0/auth0-react` dep + `components/providers/auth.tsx` + `custom-auth/` examples if you don't need PKCE at all.

**Example:** a Pages Context Panel screenshot app that subscribes to `pages.context`, sends the resulting `pageId` to its own `app/api/screenshot/[pageId]/route.ts`, which holds OAuth client-credentials server-side and proxies to the SitecoreAI Agent API `/screenshot` endpoint. Discovered as a real architecture while rebuilding that app (2026-05-02), not previously named in this taxonomy.

---

## 5. Authorization model (Auth0)

All Marketplace apps authenticate via Sitecore's Auth0 tenant. The auth model differs by architecture.

### 5a. Architecture 4a/4b (iframe) — portal-brokered

The portal handles auth. Your app does **not** configure Auth0 directly. Tokens never reach your app code — the postMessage bridge uses the portal's session.

**What you do:** nothing beyond registering the app in Cloud Portal with the right API access scopes. The Client SDK handles the rest.

### 5b. Architecture 4c (experimental server-to-server) — app-owned Auth0

You integrate Auth0 directly in your Next.js app.

**Sitecore Auth0 tenant + required env vars:**

```bash
AUTH0_DOMAIN=https://auth.sitecorecloud.io
AUTH0_AUDIENCE=https://api-webapp.sitecorecloud.io
AUTH0_SCOPE='openid profile email offline_access'
SITECORE_ORGANIZATION_ID=<from Cloud Portal>
SITECORE_TENANT_ID=<from standalone app URL after install — see the marketplace-sdk-testing-debug skill, § 5b>
```

**Client-side example (Auth0 React):**
```typescript
import { useUser } from '@auth0/nextjs-auth0';

const { user } = useUser();
const xmc = await experimental_createXMCClient({
  getAccessToken: () => getAccessTokenSilently(),
});
```

**Server-side `Auth0Client` config (cookies + authorizationParameters):** lives in the `marketplace-sdk-testing-debug` skill, § 4a. Do not reproduce here — it drifts.

### 5c. Required values (experimental)

| Value | What it's for | Where to capture |
|-------|--------------|-----------------|
| `organization_id` | `authorizationParameters.organization_id` + env var `SITECORE_ORGANIZATION_ID` | Cloud Portal → your organization |
| `tenant_id` | `authorizationParameters.tenant_id` + env var `SITECORE_TENANT_ID` | Standalone app URL after install (post-install step) |
| `sitecoreContextId` | Every `query:` param of `experimental_*` calls | `client.query('application.context')` once from a Client-SDK page |

Capture procedures for each: the `marketplace-sdk-testing-debug` skill, § 5. The `sitecoreContextId` capture is a chicken-and-egg step — a small Client-SDK page reads `application.context` once, then you wire the value into the server-to-server flow.

### 5d. Iframe compatibility — mandatory

Iframe login under server-to-server enforces strict cookie policies: HTTPS, `sameSite: 'none'` + `secure: true` on session **and** transaction cookies, cross-origin third-party cookie rules. Full block + symptom table: the `marketplace-sdk-testing-debug` skill, § 4. Missing any rule makes auth "just not work" with no clear error.

---

## 6. Hosting

| App type | Who hosts | Requirements |
|----------|-----------|--------------|
| Custom | **You** — any HTTPS-reachable host (Vercel, Azure, AWS, self-managed) | HTTPS, stable URL, matches the URL registered in Cloud Portal |
| Public (post-approval) | You still host — Marketplace listing points at your URL | Same + production-grade SLA expected |

**Requirements (both):**
- HTTPS with valid certificate — no self-signed certs for production
- Stable URL — URL changes require re-registering or updating the app in Cloud Portal
- CSP / cookie headers compatible with iframe embedding (sameSite, secure — see § 5d)
- Source lives in a **public or private GitHub repo** (Sitecore docs call this out for both custom and public apps)

---

## 7. Blok design system

Sitecore expects Marketplace apps to match the **Blok** design system (https://blok.sitecore.com/) for look-and-feel consistency.

- **Custom apps:** recommended but not enforced
- **Public apps:** effectively required for approval

**What this means in practice:**
- Use Blok tokens (colors, spacing, typography) rather than inventing a custom design language
- Match the portal's shell chrome where your app sits next to native panels
- Follow Blok accessibility conventions (WCAG AA minimum)

**Integration:** shadcn/ui scaffolds from the `setup-scaffold` skill ship with Blok-compatible defaults. If you diverge from shadcn, verify the chrome against Blok tokens before submission. See the `blok-setup`, `blok-components`, and `blok-marketplace-integration` skills for full guidance.

---

## 8. Public app submission checklist

Only required for phase 7–9 of the public-app lifecycle. From `prepare-to-submit-a-public-app-for-approval.html`:

- [ ] App name and description match Marketplace listing requirements (unique, descriptive, no trademark conflicts)
- [ ] Icon assets at required sizes
- [ ] Screenshots / walkthrough videos
- [ ] Privacy policy URL
- [ ] Support contact (email or URL)
- [ ] Blok compliance review passed
- [ ] Accessibility audit (WCAG AA)
- [ ] Production hosting live at stable URL
- [ ] All API access scopes minimized to what's actually used
- [ ] Tested in all registered extension points

**Submission flow:** Cloud Portal → App Studio → your app → Submit for approval. Sitecore reviews; approval can take days to weeks.

---

## 9. Common lifecycle pitfalls

### 9a. Starting to code before registering the app

Client SDK `ClientSDK.init()` **handshakes with the portal** and fails if the app isn't registered. Register in Cloud Portal first (step 1), then scaffold the code (step 4).

### 9b. Confusing architecture choice with scaffold choice

- Architecture 4a/4b **scaffold decision:** the `setup-scaffold` skill, § 2 vs § 3 (client-side-xmc.json vs full-stack-xmc.json)
- Architecture 4c **scaffold decision:** typically a plain Next.js app with Auth0 + `experimental_*` clients — no shadcn quickstart covers this yet

ADR the architecture decision before picking the scaffold.

### 9c. Treating experimental server-to-server as the "easier" path

It is not. You own the Auth0 integration, token refresh, iframe cookie config, and orgId/tenantId wiring. The iframe Client SDK path is significantly simpler. Only reach for experimental when the iframe model genuinely can't satisfy the requirement.

### 9d. Blok-compliance-as-afterthought

If you're building a public app, evaluate Blok from day one. Swapping out a custom design system at submission time is expensive. Use shadcn defaults or Blok-native components from the start.

### 9e. Missing orgId / tenantId for experimental mode

Both are required. `tenantId` is only visible **after install** — you open the standalone app from the portal shell and read the URL. Plan this as an explicit post-install step in your implementation plan.

---

## 10. Agent guidance

**During discovery:** Identify custom vs public during discovery. Public apps add 3–4 weeks of submission/Blok work — surface this in the requirements. Ask about target audience (internal-only vs ecosystem distribution) to decide.

**During architecture:** Produce an ADR covering (1) custom vs public, (2) architecture 4a/4b/4c, (3) auth model decision, (4) hosting. Record the registration values (app name, extension points, API scopes) as a planning artifact — they drive Cloud Portal setup. Do not plan both client-side iframe and server-to-server paths "for flexibility" — pick one.

**During implementation planning:** the plan's stack/dependencies section must include: (a) the exact Cloud Portal registration steps with required role, (b) the scaffold command from the `setup-scaffold` skill matching the chosen architecture, (c) required env vars (AUTH0_*, SITECORE_ORGANIZATION_ID, SITECORE_TENANT_ID if experimental), (d) HTTPS requirement for local dev (`next dev --experimental-https`), (e) the mandatory Auth0 cookie config if experimental mode is chosen. Reference the `marketplace-sdk-testing-debug` skill for the local dev loop.

**During testing:** Add a validation spike for iframe cookie flow — this is the single highest-impact silent failure in Marketplace apps. All verification runs in the real portal against a registered test app.

**During implementation:** Follow the architecture decision in the ADR. Do not cast between architectures mid-implementation. If you hit an auth error, check § 5d (HTTPS + cookie config) before debugging anywhere else.
