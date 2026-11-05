---
name: sitecoreai-auth
description: "OAuth client-credentials auth for the SitecoreAI APIs (Agent, Pages, Publishing, Sites): automation client, token endpoint, scopes, env vars, caching, 401s. Load before the first API call. Not head-app Edge context ids."
license: Apache-2.0
compatibility: "Requires a Sitecore Cloud Portal automation client (Org Admin or Owner role to create) and HTTPS network access to https://auth.sitecorecloud.io."
metadata:
  author: Christian Hahn
  version: "0.3.4"
---

# SitecoreAI API Authentication

All four SitecoreAI APIs use the **same** OAuth 2.0 client-credentials flow. Authenticate once, reuse the pattern everywhere.

---

## 0. Credential-acquisition protocol (MANDATORY before implementing any API call)

Whenever a task involves calling any SitecoreAI API, the agent **must** resolve `client_id` and `client_secret` **before writing implementation code**, in this order:

1. **Ask the user directly, upfront.** One question, offered as a choice:
   > "This app will call the SitecoreAI <API name>. To authenticate I need a `client_id` and `client_secret` from an Automation Client in Cloud Portal. Options:
   > **(a)** paste them now,
   > **(b)** I don't have them — use whatever is in `.env` / `.env.local`,
   > **(c)** leave blank, I'll provide them later."
2. **If (a):** write the values to `.env.local` (never commit) under the three-segment naming pattern below. Do not echo the secret back to chat.
3. **If (b):** read `.env.local` → `.env` in that order. If either variable is present, use it. If both are empty or missing, escalate to step 4.
4. **If (c), or if (b) finds nothing:** leave the variables blank in the env file and **report this as a missing piece** in the final summary / task report. Do not invent placeholder values, do not scaffold fake credentials, do not skip auth silently. The app can still be scaffolded and compiled; the first real API call will 401 until the user supplies credentials — that is the correct failure mode.

This protocol applies to **every** task that touches Agent, Pages, Publishing, or Sites API. Skipping it means the dev loop stalls later on a 401 the user has to diagnose themselves — the exact friction this skill exists to prevent.

### 0a. Env-var naming — three-segment convention

Use **three segments** so a single project can hold multiple, purpose-distinct automation clients without name collisions:

```
SITECORE_<PURPOSE>_CLIENT_ID
SITECORE_<PURPOSE>_CLIENT_SECRET
```

Where `<PURPOSE>` names the scope of calls that credential covers. Common values:

| `<PURPOSE>` | Scope | Example var |
|---|---|---|
| `DEPLOY` | Deployment, screenshot / proxy-to-Agent-API | `SITECORE_DEPLOY_CLIENT_ID` |
| `CM` | Authoring GraphQL and the XM Apps Pages API (the deploy client returns 500 on `GET /pages/{id}/state`, measured 2026-08-12) | `SITECORE_CM_CLIENT_ID` |
| `AI` | AI-driven API calls — Brand Management, Brand Review, Pipeline (future) | `SITECORE_AI_CLIENT_ID` |
| `CDP` | **Standalone** Sitecore CDP / Personalize REST (`api-engage-{region}`), only with a separate CDP/Personalize licence. **Not** needed for SitecoreAI embedded analytics or personalization (see § 0b) | `SITECORE_CDP_CLIENT_ID` |
| `EDGE` | **Edge Admin API** (webhooks, Edge settings, cache clear). Needs an **Edge administration client** (one per environment; created in Deploy or by `POST https://xmclouddeploy-api.sitecorecloud.io/api/clients/v1/edge` with an org automation client, live 2026-10-02), **not** an automation client: org and environment automation clients get **401** `edge.cdn.11 … Failed to find tenant`. See `sitecoreai-edge-admin-webhooks` | `SITECORE_EDGE_CLIENT_ID` (per environment `SITECORE_EDGE_<ENV>_CLIENT_ID`) |
| bespoke | Any other integration with its own automation client | `SITECORE_<SLUG>_CLIENT_ID` |

The credential-acquisition protocol above stays the same — just rename the placeholders in your examples to match the purpose of the client. A project that calls both Agent API (for deploy / screenshot) AND, later, the AI-driven APIs will want two separate automation clients with distinct scopes, each under its own `SITECORE_<PURPOSE>_CLIENT_*` pair.

### 0b. Personalization and analytics: which credential (none, usually)

Do not ask for a CDP client for a SitecoreAI site. Embedded personalization and analytics split three ways:

| Need | Credential |
|---|---|
| **Runtime**: page views, events, personalize decisions from the head app (Content SDK proxy, Bootstrap, `CdpPageView`) | **None.** Only the public Edge context id, sent as `x-sitecore-contextid` (`SITECORE_EDGE_CONTEXT_ID` / `NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID`). No OAuth, no client key: `client_key` / point of sale are derived server-side |
| **Management**: create / update variants, audiences, A/B tests | **Agent API** (v2 personalization endpoints) with an **environment-scoped** automation client, token as § 3. An **org-level** client gets 401 on `edge-platform.sitecorecloud.io` and `xmapps-api` endpoints. The Marketer MCP uses the signed-in user's OAuth, no client at all |
| **Standalone CDP / Personalize REST** (`/v3/flowDefinitions` etc.) | A `SITECORE_CDP_*` client, only for customers licensed for standalone CDP / Personalize |

Delegated (authorization-code, § 7) apps that manage personalization through the Agent API need these scopes beyond the default: `personalize.exp:mng`, `personalize.tmpl:r`, `personalize.pos:mng`, `cmp.sites:read`, `platform.tenants:list`. Client-credentials tokens from an environment client already carry what the Agent API needs (`xmcloud.cm:admin` in the token scope).

Backend workflow: `sitecoreai-personalization`. Head-app wiring: `content-sdk-personalization`.

Earlier skill revisions (and some older examples further down this page) used the two-segment `SITECORE_CLIENT_ID` / `SITECORE_CLIENT_SECRET`. Treat those as legacy — new projects should adopt the three-segment pattern from day one.

---

## 1. Prerequisites

- **Role**: Organization Admin or Owner in Sitecore Cloud Portal. Without this role, the automation-client form is hidden.
- **Tenant**: You authenticate against a SitecoreAI tenant. The client is scoped to that tenant.
- **Secure storage**: Prepare a secret store (AWS Secrets Manager, Doppler, Vercel env vars, `.env.local` for dev) before creating the client — the secret is shown **once**.

## 2. Create an automation client

1. Cloud Portal → your tenant → **Settings** → **Automation clients** (sometimes labelled "Application access" / "Client credentials" depending on the portal rev).
2. Click **Create client**, give it a descriptive name (e.g. `myapp-prod-agent-api`).
3. Select **Scopes** required for the APIs you will call. Grant only what you need:
   - Agent API / Pages API / Sites API: generally covered by the default XM Apps scopes granted to automation clients.
   - Publishing API: requires additional `xmcloud.cm:admin` for application tokens. Read vs. write vs. limited-write is differentiated by `:r`, `:w`, `:wl` scope suffixes.
4. Copy **both** the `client_id` and `client_secret` immediately — the secret disappears on refresh.

## 3. Token request

```http
POST https://auth.sitecorecloud.io/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}
&client_secret={CLIENT_SECRET}
&grant_type=client_credentials
&audience=https://api.sitecorecloud.io
```

**Response** (abbrev.):
```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

- **Lifetime**: 24 hours (`expires_in: 86400`).
- **Audience is fixed**: `https://api.sitecorecloud.io` for all four APIs. Do not substitute the API's base URL — it will return `401`.

## 4. Calling an API

```http
GET https://xmapps-api.sitecorecloud.io/api/v1/sites
Authorization: Bearer {access_token}
Accept: application/json
```

`Accept: application/json` is required by the Pages API and is good practice everywhere.

## 5. Token caching (mandatory in production)

A fresh token per request will hit the auth endpoint's own rate limits and add ~200 ms latency. Cache aggressively.

Minimal reference implementation (TypeScript):

```ts
// token-cache.ts — reusable across all four SitecoreAI APIs
type Cached = { token: string; expiresAt: number };
let cached: Cached | null = null;

async function fetchFreshToken(): Promise<string> {
  const res = await fetch("https://auth.sitecorecloud.io/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SITECORE_DEPLOY_CLIENT_ID!,
      client_secret: process.env.SITECORE_DEPLOY_CLIENT_SECRET!,
      grant_type: "client_credentials",
      audience: "https://api.sitecorecloud.io",
    }),
  });
  if (!res.ok) throw new Error(`Sitecore auth failed: ${res.status}`);

  const { access_token, expires_in } = await res.json() as { access_token: string; expires_in: number };
  cached = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };

  // Log the tenant identifier on every cold-cache fetch. This must live
  // INSIDE fetchFreshToken — NOT at the route-handler call site, which has
  // no observable signal to distinguish cold-cache from warm-cache hits
  // and would therefore log on every request.
  const sub = decodeJwtSub(access_token); // Auth0 client-credentials puts
                                          // the client_id in `sub` with the
                                          // `@clients` suffix, e.g.
                                          // `<client_id>@clients`
  if (sub) console.log(`[app-name] tenant=${sub}`);

  return access_token;
}

export async function getSitecoreToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt - now > 60_000) return cached.token;  // 1-min safety margin
  return fetchFreshToken();
}
```

**Tenant-id logging placement (a Marketplace app build, 2026-04-22).** If you emit structured logs tagging each request with the tenant identifier on first successful auth, the log call belongs **inside `fetchFreshToken()`** — not at the route-handler call site. The route handler cannot distinguish a cold-cache fetch from a warm-cache hit, so logging there fires on every request (noisy + gives a false impression of per-request auth).

**Which claim carries the tenant id?** Sitecore's Auth0 tenant follows the Auth0 client-credentials convention: the **`sub` claim** of the access-token JWT contains the automation client's `client_id` with a `@clients` suffix (e.g. `<client_id>@clients`). Decode `sub` (no signature verification needed — the cache trusts the JWT because it just came back from the token endpoint). If `sub` is empty or missing, fall back to `tid` if present; otherwise skip the log. Never log the bearer token or the full JWT — only the `sub` claim.

For multi-instance deployments, promote the cache to Redis / a KV store keyed by `client_id` to avoid one token-refresh per instance.

## 6. Handling 401

A `401 Unauthorized` on a previously-working request almost always means the token expired **between** the cache-check and the upstream call (clock skew, long-running request). Strategy:

1. Invalidate the cache.
2. Retry the original request **once** with a fresh token.
3. If the second call also 401s, fail loudly — credentials or scopes are wrong.

Do not retry more than once. A persistent 401 is a configuration bug, not a transient fault.

## 7. Alternative: OAuth 2.0 authorization code flow (Agent API only)

The Agent API also supports user-delegated access via the authorization-code flow, registered through Sitecore Support. Use this when the caller needs to act *as a user* (audit trail, per-user permissions) rather than as a service principal. For most Marketplace apps and backend automations, the client-credentials flow above is correct and simpler.

## 8. Pitfalls

- **Environment client, not org client.** Agent, Pages and Sites APIs reject an org-level automation client with 401; create the client on the environment.

- **Secrets viewable once.** Creating a second secret without storing the first means creating a third client.
- **Audience must be literal.** `https://api.sitecorecloud.io` — not `.com`, not trailing slash, not the API base URL.
- **Token is tenant-scoped.** A token from tenant A cannot read tenant B.
- **Production only.** No sandbox audience. Destructive endpoints (e.g. `DELETE /collections/{id}`) affect live content immediately.
- **`Accept: application/json`** is required by Pages API; omitting it returns 406.
- **Clock skew** on the caller can make the cache think the token is valid when Sitecore rejects it. Always keep a 60 s safety margin as in the snippet above.

## Sources

- [Create an automation client](https://api-docs.sitecore.com/xmc/xm-apps-api/section/authorization/create-an-automation-client)
- [Authorization section — Pages API](https://api-docs.sitecore.com/xmc/pages-api/section/authorization)
