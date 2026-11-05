---
name: marketplace-sdk-testing-debug
description: "Local dev loop for a Marketplace app: HTTPS with mkcert, test-app registration, Chrome Local Network Access, context ids, iframe sandbox limits, handshake and cookie debugging. Load during development and QA."
license: Apache-2.0
compatibility: "Requires Cloud Portal account with Org Admin/Owner role; HTTPS dev server (Next.js 13.5+ with --experimental-https for full-stack); mkcert for system-trusted local certs; Chrome 2025+ for Local Network Access checks."
metadata:
  author: Christian Hahn
  version: "0.4.3"
---

# Sitecore Marketplace Testing & Debugging

## When to use

- You're setting up local development for a Marketplace app and hitting the Cloud Portal for the first time
- Auth "just isn't working" in the iframe and you need a debugging checklist
- You need to capture runtime values (organization ID, tenant ID, sitecoreContextId) for experimental server-to-server mode
- QA phase — verifying iframe behavior, extension-point constraints, error recovery

For **Client SDK reference** (`ClientSDK.init`, base API patterns, extension points) see the `marketplace-sdk-client` skill.
For **XMC endpoints** see the `marketplace-sdk-xmc` skill.
For **AI skills specifics** see the `marketplace-sdk-ai` skill.
For **auth model background** see the `marketplace-sdk-lifecycle` skill, § 5.

---

## 1. Local development — end-to-end setup

### 1a. Prerequisites

- Node.js 18+ and pnpm/npm
- Sitecore Cloud Portal account with `Organization Admin` or `Organization Owner` role
- A registered SitecoreAI environment to install the test app into
- Ability to run your app on **HTTPS localhost** (see § 3)

### 1b. Six-step setup

```
1. Register a test app in Cloud Portal → App Studio
2. Configure dev URL → https://localhost:3000
3. Enable all extension points + all API access (for dev)
4. Install the test app into your SitecoreAI environment
5. Scaffold and run your app with HTTPS
6. Open from portal shell → your iframe loads the app
```

Detailed walkthrough of each step in the sections below.

---

## 2. Registering a **test** app (distinct from production)

Always register a **separate** app for testing, never repurpose the production app.

### 2a. Naming

Prefix or suffix test apps so they can't be confused:

- `Test application` — docs-recommended plain test app
- `<Project> — DEV` — per-project dev app
- `<Project> — QA` — per-project QA app

### 2b. What to configure for a test app

| Field | Dev/QA value | Production value |
|-------|-------------|------------------|
| App URL | `https://localhost:3000` (or your dev tunnel URL) | Production HTTPS URL |
| Extension points | **All** — easier to switch contexts during dev | Only what you ship |
| API access | **All** — don't let permission errors confuse bug hunts | Minimized to what's used |
| User access | **Only you** — don't grant to org users | As appropriate for the release |
| Environment binding | A sandbox SitecoreAI environment | Production environment |

**Rationale:** a permissive test app removes an entire class of "why doesn't this work" questions. You can tighten permissions later when you register the production app.

### 2c. Cleanup

- Uninstall the test app when you're done with a project
- Don't let stale test apps accumulate — they clutter the org and may outlive their configured users

---

## 3. HTTPS on localhost — mandatory for full-stack, not for client-side

**Scope matters.** HTTPS locally is only required for **Scaffold 3 full-stack** apps (or Mode B `experimental_create*Client` flows) where your app serves auth cookies at its own origin — those cookies carry `SameSite=None; Secure` and `secure` cookies cannot be set over HTTP.

**Scaffold 2 client-side Mode A apps work fine over plain HTTP.** The app sets no cookies at its own origin; auth is portal-brokered via postMessage. All you need on the client-side path is the Chrome Local Network Access headers (see [`references/https-traps.md`](references/https-traps.md) § 3) — no HTTPS, no mkcert, no cert-trust dance.

If you're unsure: start on HTTP. Only flip to HTTPS (and accept the complexity below) when you hit "cookies not being set" in § 4 because your app owns an Auth0 server.

### 3a. Next.js dev server with HTTPS (full-stack / Mode B only)

```bash
# Next.js 13.5+
next dev --experimental-https --turbopack

# Alternatives if you need a stable cert: mkcert, caddy, traefik in front of localhost
```

Set env:
```bash
APP_BASE_URL=https://localhost:3000
```

**Post-scaffold dev-script patch (Scaffold 3 only):** the shadcn quickstart ships `next dev --turbopack` without the `--experimental-https` flag. Edit `package.json` → `scripts.dev` to include `--experimental-https` before running against a real portal. Client-side Scaffold 2 apps keep the plain HTTP script and rely on the Chrome Local Network Access headers documented in [`references/https-traps.md`](references/https-traps.md) instead.

### 3a-bis through 3a-quater — three HTTPS-mode traps

Three failure modes bite when running an HTTPS dev server against the real Cloud Portal:

1. **mkcert + the Windows non-interactive trap** (Scaffold 3 only) — Next's `--experimental-https` silently falls back to HTTP if `mkcert -install` can't elevate. Run `mkcert -install` from an elevated PowerShell, or pre-generate the cert manually.
2. **Self-signed cert rejected inside iframe → `chrome-error://chromewebdata/`** (Scaffold 3 only) — Chrome's click-through "Proceed Anyway" grants trust only for the exact top-level navigation, not for iframe subresource loads from a public origin. Either install the mkcert CA into the system trust store, or tunnel via `cloudflared`/`ngrok` for a public-CA-signed URL.
3. **Chrome's Local Network Access block** (both Scaffolds) — public-origin pages loading `localhost:*` iframes are blocked unless the dev server advertises consent via `Access-Control-Allow-Private-Network: true` headers. Add the four-header block to `next.config.mjs`.

For the full diagnostic walkthrough — symptoms, exact error messages in console, headers config, the `*` origin + credentials trap — see [`references/https-traps.md`](references/https-traps.md). The reference is the canonical one-stop debugging doc; the SKILL.md keeps just the rule + the pointer.

### 3b. If you need a proper hostname (not `localhost`)

Add to your hosts file (`/etc/hosts` on Unix, `C:\Windows\System32\drivers\etc\hosts` on Windows):

```
127.0.0.1  myapp.local
```

Then use `https://myapp.local:3000` in both `APP_BASE_URL` and the Cloud Portal dev URL. Certificate must cover the hostname — `mkcert myapp.local` is the quickest path.

### 3c. Verifying HTTPS is really working

In browser devtools → Application → Cookies → your app origin, cookies must have:
- `Secure` column: yes
- `SameSite` column: `None`

If either is missing, the cookie config (see § 4) hasn't been applied.

---

## 4. Iframe cookie configuration — the #1 silent failure

Auth inside the iframe requires **both** session and transaction cookies to be cross-site compatible. Missing this is the most common cause of "login just doesn't work".

**Required on session cookie AND transaction cookie:**
```javascript
{
  sameSite: 'none',   // allow cross-site
  secure: true,       // require HTTPS
}
```

### 4a. Next.js + Auth0 server

```javascript
import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client({
  session: {
    cookie: { sameSite: 'none', secure: true },    // MANDATORY
  },
  transactionCookie: { sameSite: 'none', secure: true },   // MANDATORY — often forgotten
  authorizationParameters: {
    scope: process.env.AUTH0_SCOPE,
    audience: process.env.AUTH0_AUDIENCE,
    organization_id: process.env.SITECORE_ORGANIZATION_ID,
    tenant_id: process.env.SITECORE_TENANT_ID,
  },
});
```

### 4b. Verification symptom table

| Symptom | Likely cause |
|---------|-------------|
| Login redirect loops | `sameSite: 'none'` or `secure: true` missing on session cookie |
| Auth works outside iframe, fails inside | Transaction cookie not configured — only session cookie was set |
| Cookies appear then disappear on navigation | HTTPS not actually active (check cert in devtools) |
| "Organization not found" after login | `organization_id` missing from `authorizationParameters` |
| 401s on `experimental_*` calls even when logged in | Token audience mismatch — `AUTH0_AUDIENCE` must be `https://api-webapp.sitecorecloud.io` |

---

## 5. Capturing runtime values for experimental mode

Mode B (`experimental_createXMCClient` / `experimental_createAIClient` — see the `marketplace-sdk-lifecycle` skill, § 4c) needs three values that aren't available at development time. Capture them post-install.

### 5a. Organization ID

- Visible in Cloud Portal → your organization settings
- Set as env var: `SITECORE_ORGANIZATION_ID=<id>`
- Static per organization — capture once

### 5b. Tenant ID

- Install the test app first
- Open the standalone app from **portal shell** (the top-level portal navigation, not a deep link)
- Read the browser URL — tenant ID appears as a path segment or query param
- Set as env var: `SITECORE_TENANT_ID=<id>`
- Per environment — capture per environment you target

### 5c. `sitecoreContextId`

- Build a tiny Client SDK standalone page that just prints `application.context`
- Run the app once inside the iframe, open devtools, and read `resourceAccess[0].context.live` (or `.preview`)
- Persist in server-side config

```typescript
// One-time capture snippet
const appCtx = await client.query('application.context');
console.log({
  contextLive: appCtx.data?.resourceAccess?.[0]?.context?.live,
  contextPreview: appCtx.data?.resourceAccess?.[0]?.context?.preview,
});
```

**This capture step belongs in the implementation plan** for any app using experimental mode — it is not automatic.

---

## 6. Debugging checklist — "the iframe isn't working"

When something breaks in the iframe and you don't know where to start, work this list **in order**:

### 6a. Is the app actually loading?

- Browser devtools → Network → filter to your app origin
- If zero requests: the portal iframe URL is wrong, or your app is down, or CSP is blocking
- If requests but 4xx/5xx: check app logs

### 6b. Is the iframe allowed to load?

- Devtools → Console → look for `X-Frame-Options` / CSP `frame-ancestors` errors
- Your hosting layer must allow framing from Sitecore portal origins
- Next.js: remove any `X-Frame-Options: DENY` headers; set CSP `frame-ancestors` to include portal origin

### 6c. Is `ClientSDK.init()` handshaking?

- Add logging around `await ClientSDK.init({...})`
- If it hangs > 30 s: handshake timeout — portal doesn't see the app's postMessage
- If it errors with `INVALID_ORIGIN`: you passed a wrong `origin` option or `target` isn't `window.parent`
- If it errors with `HANDSHAKE_FAILED`: app is loaded standalone, not in the portal iframe — open it **from the portal shell**, not directly

### 6d. Are cookies being set?

- Devtools → Application → Cookies → your app origin
- Both session cookie and transaction cookie must have `SameSite=None; Secure`
- Missing = cookie config wrong (§ 4)
- Present but cleared on navigation = HTTPS not active or cert invalid

### 6e. Is auth flowing?

- Devtools → Network → filter `auth0` / `sitecorecloud.io`
- Follow the OAuth redirect chain — it should return to your `APP_BASE_URL/auth/callback`
- If redirect to non-HTTPS: `APP_BASE_URL` misconfigured
- 401 response post-callback: `audience` or `organization_id` wrong

### 6f. Are SDK calls succeeding?

- Log the full result object, not just `.data`:
  ```typescript
  const result = await client.query('xmc.sites.listSites', opts);
  console.log(JSON.stringify(result, null, 2));
  ```
- `isError: true` + `error.code` tells you which error class (see the `marketplace-sdk-client` skill, § 8f)
- `TOKEN_ERROR` — auth config wrong; re-check § 4
- `METHOD_NOT_FOUND` — module not registered; pass `modules: [XMC]` or `[AI]` to init
- `EXECUTION_ERROR` — host-side failure; log `error.message` and contact Sitecore support if reproducible
- `SyntaxError: Unexpected end of JSON input` / `Failed to execute 'json' on 'Response': Unexpected end of JSON input` on `ai.skills.generateBrandReview` → **oversized base64 payload**. Bridge or AI backend returns empty body → SDK JSON.parse throws. See the `marketplace-sdk-ai` skill, § 9f. Shrink or host-externally the uploaded file.

### 6g. Is subscription cleanup happening?

- Watch-mode / hot reload can leak subscriptions
- Wrap `client.subscribe(...)` → always call `unsubscribe()` in React `useEffect` cleanup
- In devtools Performance tab, look for accumulating listeners

---

## 7. Browser-specific notes

| Browser | Gotcha |
|---------|--------|
| Chrome / Edge | Most forgiving; most bugs reproduce here first |
| Firefox | Stricter cookie partitioning — validate here after Chrome works |
| Safari | **Strictest**. Third-party cookies in iframes often blocked by default. If your app must work in Safari, test there explicitly, not just Chrome. |
| Private / Incognito | Third-party cookies usually disabled → auth will fail. Not a bug — document this. |

---

## 7a. iframe sandbox — downloads, popups, clipboard (2026-04-22)

Sitecore's Pages editor hosts Marketplace Context Panels inside an iframe with a restrictive `sandbox=` attribute. Know what is and isn't permitted before designing a capture / export / share flow.

### Downloads are NOT allowed (pending upstream fix)

The Pages iframe sandbox **currently does not include `allow-downloads`**. Any client-side download attempt from inside the panel will silently fail:

- `<a href="blob:..." download="file.png">` — the browser blocks the navigation triggered by the click; no file is saved, no error surfaces in the console.
- `window.open(blobUrl)` from inside the sandbox — same block.
- Programmatic `a.click()` after constructing an anchor — same block.

**Sitecore has committed to adding `allow-downloads` soon.** Expect this constraint to lift in a near-term Pages update. Until then:

**Recommended workaround — escape the sandbox to a top-level tab:**

```ts
window.open(blobUrl, '_blank', 'noopener,noreferrer');
```

This opens the blob URL in a top-level browser tab, outside the sandboxed iframe. The browser renders the PNG (or other resource) in the new tab and the user can right-click → **Save Image As** to disk. Requires `allow-popups` in the iframe sandbox — which **IS** present.

This is not a polished UX, but it's the only currently-working path to deliver a file from the panel to the user's disk. Track progress on the upstream sandbox fix and remove the workaround once `allow-downloads` ships.

### Popups are allowed

`allow-popups` is present. `window.open(url, '_blank', ...)` works for:

- Escaping to a top-level tab (download workaround above).
- Opening help / docs URLs in a new tab.
- Auth popup flows if ever needed (not the current Marketplace auth model).

### Clipboard requires the Permissions Policy, not the sandbox

Clipboard reads/writes (`navigator.clipboard.writeText`, `navigator.clipboard.write(...)` for binary blobs) are governed by the **Permissions Policy** (a separate browser gating mechanism), not the iframe sandbox. They require explicit user consent via the browser's permission prompt on first use, and they work **independently** of the download gate.

In practice this means: **Copy** (to clipboard) works inside the Sitecore Pages iframe today, even though **Download** (to disk) does not. A "Copy as PNG" or "Copy image to clipboard" button is a first-class path for moving content out of the panel until `allow-downloads` lands.

---

## 8. Pitfalls specific to testing

### 8a. Testing on HTTP localhost

The browser silently drops `Secure` cookies. Symptoms look like "login doesn't persist" with no console errors. **Always HTTPS from day one.**

### 8b. Running multiple dev apps on the same port

Browser caches cookies per origin. Two apps on `https://localhost:3000` can interfere. Use different ports or hostnames (`myapp-a.local`, `myapp-b.local`) for parallel work.

### 8c. Stale test installs

Uninstall and reinstall when you change extension points or API access in Cloud Portal. The running iframe snapshots permissions at install time.

### 8d. Testing in the wrong environment

SitecoreAI environments aren't interchangeable. An app installed into `dev-env-1` won't see content from `dev-env-2`. Verify the `environment` binding on the test app before blaming code.

---

## 9. Agent guidance

**During implementation planning:** the plan must include: (a) HTTPS dev command (`next dev --experimental-https`), (b) full Auth0 cookie config block (§ 4a), (c) test-app registration values (name, URL, extension points, API access), (d) a runtime-value capture task if experimental mode is used (orgId, tenantId, contextId — § 5). All dev and validation runs against the registered Cloud Portal test app — there is no mock path. Do not treat HTTPS / cookies as "obvious" — they are commonly missed.

**During testing:** Test scenarios must cover (a) fresh install in a clean org, (b) re-install after extension-point changes, (c) login flow in Chrome **and** Safari, (d) Private/Incognito as a "should show clear error" scenario, (e) subscription cleanup on navigation. All tests run against the real portal. Add a validation spike if the app uses WebGL, eval, or any iframe-sensitive feature.

**During implementation:** Before reporting "it's not working", walk § 6 in order. Most iframe/auth failures are caught at steps 6b–6d — a 10-minute devtools check beats hours of trial-and-error.
