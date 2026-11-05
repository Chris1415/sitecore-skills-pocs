---
name: marketplace-sdk-xmc
description: "API reference for @sitecore-marketplace-sdk/xmc: SitecoreAI endpoints (sites, pages, agent, authoring, preview, live, search), client modes, context id rules, response unwrapping. Load when a Marketplace app reads or writes SitecoreAI data."
license: Apache-2.0
compatibility: "Requires @sitecore-marketplace-sdk/xmc, a registered Marketplace app, and a sitecoreContextId obtained from application.context.resourceAccess[]."
metadata:
  author: Christian Hahn
  version: "0.5.5"
---

# Sitecore Marketplace XMC Module

> **This skill is a catalog, not a contract.** It documents which `xmc.*` keys exist and what request params they accept. It does **not** document response envelopes (`@hey-api/client-fetch` wrappers, `Sites.Host`/`Pages`/`Agent` field shapes), runtime availability per tenant, or tenant-side preconditions. Before writing `client.query("xmc.…")`, open the SDK's declared types in `node_modules/@sitecore-marketplace-sdk/xmc/dist/.../types.gen.d.ts` and cite the `.d.ts` path inline. Mock fixtures must match the declared types. Verify in a real tenant before declaring shipped.

## When to use

- The project uses `@sitecore-marketplace-sdk/xmc`
- The PRD calls for any SitecoreAI data operation (read sites/pages, run GraphQL, create/update content, move content between environments)
- Architect needs to select between module mode and experimental server-to-server mode for XMC calls

For **Client SDK base** (init, query/mutate/subscribe patterns) see the `marketplace-sdk-client` skill.
For **auth & lifecycle** (including experimental mode architecture decision) see the `marketplace-sdk-lifecycle` skill.
For **AI skills module** see the `marketplace-sdk-ai` skill.
For **testing / debugging** see the `marketplace-sdk-testing-debug` skill.

---

## 1. Package overview

| Package | Purpose |
|---------|---------|
| `@sitecore-marketplace-sdk/xmc` | Type-safe access to SitecoreAI APIs — sites, pages, agent, authoring, preview, live, content-transfer, search |

**Install (always latest):** `npm install @sitecore-marketplace-sdk/xmc@latest`

The XMC module plugs into the Client SDK via `modules: [XMC]`, extending its type maps with `xmc.*` keys. It can also be used standalone via `experimental_createXMCClient` (see § 2).

---

## 2. Two usage modes

| Mode | When | Init | Call shape | Token handling |
|------|------|------|-----------|---------------|
| **A. Module mode** | Inside a Client SDK iframe app (architectures 4a/4b in the `marketplace-sdk-lifecycle` skill) | `ClientSDK.init({ modules: [XMC] })` | `client.query('xmc.*', …)` / `client.mutate('xmc.*', …)` | Portal-brokered via postMessage — no token in your code |
| **B. Experimental direct** | Standalone / server-to-server (architecture 4c in the `marketplace-sdk-lifecycle` skill) | `experimental_createXMCClient({ getAccessToken })` | `xmc.sites.*(…)` etc. | You supply an Auth0 access token via `getAccessToken` |

**Default: Mode A.** Use Mode B only when the iframe path can't satisfy the requirement (cron jobs, microservices, server routes that need direct XMC access).

### 2a. Mode A — module registration

```typescript
import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';

const client = await ClientSDK.init({
  target: window.parent,
  modules: [XMC],
});

const result = await client.query('xmc.sites.listSites', {
  params: { query: { sitecoreContextId } },
});
```

### 2b. Mode B — experimental direct client

```typescript
import { experimental_createXMCClient } from '@sitecore-marketplace-sdk/xmc';

const xmc = await experimental_createXMCClient({
  getAccessToken: async () => await getUserAccessToken(),
});

const languages = await xmc.sites.listLanguages({
  query: { sitecoreContextId: 'your-context-id' },   // REQUIRED in Mode B
});
```

Full Auth0 config, iframe cookie requirements, and orgId/tenantId/contextId capture: see the `marketplace-sdk-lifecycle` skill, § 5. The same `experimental_createAIClient` pattern applies to the AI package — see the `marketplace-sdk-ai` skill, § 4.

### 2c. Multi-install / umbrella pattern (Standalone extension point)

The `standalone` extension point is bound to the **organisation**, not a single tenant. `application.context.resourceAccess[]` returns **one entry per installation of this app** across every SitecoreAI instance in the organisation — each entry carries its own `live` + `preview` `sitecoreContextId`. XMC calls in Mode A scope to whichever install you pass. This is the **Cloud Portal umbrella pattern**: one installed app reading/writing across many environments.

Every *other* extension point (`xmc:fullscreen`, `xmc:pages:*`, `xmc:dashboardblocks`) is bound to the single tenant the editor is operating in — `resourceAccess[]` typically has one entry (the current tenant) and there is no picker UX.

```typescript
// 1. Enumerate installs (Standalone only exposes >1 in practice)
const appCtx = (await client.query('application.context')).data;
const installs = appCtx?.resourceAccess ?? [];
// installs[i] => {
//   resourceId, tenantId, tenantName, tenantDisplayName?,
//   context: { live, preview }, …extra portal-specific fields…
// }

// 2. Pick one (user dropdown, app logic, or fan-out)
const picked = installs[0];
const contextId = picked.context.live;               // or .preview, per policy

// 3. XMC calls scope to the picked install's environment
const languages = await client.query('xmc.sites.listLanguages', {
  params: { query: { sitecoreContextId: contextId } },
});

// 4. Fan-out across every install (umbrella probe)
const perInstall = await Promise.all(
  installs.flatMap((i) =>
    ([i.context.live, i.context.preview].filter(Boolean) as string[]).map(
      async (ctxId) => ({
        tenant: i.tenantDisplayName ?? i.tenantName ?? i.tenantId,
        contextId: ctxId,
        result: await client.query('xmc.sites.listLanguages', {
          params: { query: { sitecoreContextId: ctxId } },
        }),
      }),
    ),
  ),
);
```

**Display names:** prefer `tenantDisplayName` → `tenantName` → `tenantId`. The SDK type carries a `[key: string]: any` escape hatch, so portals may include richer fields (project name, region, environment kind). A single JSON dump of the raw entry during discovery is worth it — don't assume the minimal documented shape is the whole story.

**Do not reach for `experimental_createXMCClient` at Standalone scope** — Mode A works fine; experimental client is only for genuinely non-iframe contexts (cron jobs, server routes, microservices).

---

## 3. Calling convention

All XMC options use a consistent structure (hey-api client convention):

### Mode A — options wrapped in `params:`

```typescript
await client.query('xmc.sites.listSites', {
  params: {
    path: { siteId: '...' },              // URL path parameters
    query: { sitecoreContextId: '...' },  // Query string parameters
  },
});

await client.mutate('xmc.pages.createPage', {
  params: {
    query: { sitecoreContextId: '...' },
  },
  body: {                                 // Request body
    parentId: '...',
    pageName: '...',
    templateId: '...',
    language: 'en',
  },
});
```

### Mode B — options at top level, no `params:` wrapper

```typescript
await xmc.sites.retrieveSite({
  path: { siteId: '...' },
  query: { sitecoreContextId: '...' },
});

await xmc.pages.createPage({
  body: { parentId, pageName, templateId, language: 'en' },
  query: { sitecoreContextId },
});
```

**Do not mix mode signatures in the same file.** Pick a mode at architecture time and stick with it throughout.

---

## 4. Endpoint surfaces

XMC exposes seven endpoint groups — full key tables, params, and worked examples are in [`references/endpoints.md`](references/endpoints.md). Quick map of which group covers what:

| Group | What it covers | Verbs |
|---|---|---|
| `xmc.sites.*` | Site listings, hierarchy, collections, languages, hosts | queries + a few mutations |
| `xmc.pages.*` | Page CRUD, search, insert options, versions | queries + mutations (⚠ `retrievePageState` uses capitalized params; everything else lowercase) |
| `xmc.agent.*` | High-level convenience endpoints — flat lists, screenshots, comprehensive page info | queries only |
| `xmc.authoring.graphql` | GraphQL against the Authoring API | **mutation** (POST). Worked example: lazy item-name resolution at `assets/lazy-item-resolution/` |
| `xmc.preview.graphql` / `xmc.live.graphql` | GraphQL against Preview / Delivery edges | **mutations** (POST) |
| `xmc.contentTransfer.*` | Cross-environment content migration | mutations — rarely used outside migration tools |
| `xmc.search.getConfigs` | Search configurations | query |

**Critical practical rule:** every `xmc.pages.*` call — query AND mutation — must pass `sitecoreContextId` in `query`. The SDK types mark it optional; treat it as mandatory or mutations silently 200-and-do-nothing. Use the `requireContextId()` helper from § 6a.

For full key tables, the param-casing trap on `retrievePageState`, the GraphQL-is-a-mutation trap, and the lazy item-name-resolution worked example, see [`references/endpoints.md`](references/endpoints.md).

---

## 5. Type imports

The import paths for every request / response type the package exports are in `references/type-imports.md`. Derive shapes from the installed `.d.ts`; the reference tells you where each lives.

## 6. Common pitfalls

### 6a. `sitecoreContextId` is required for most XMC calls

Almost every XMC endpoint needs `sitecoreContextId` in `params.query` (Mode A) or `query` (Mode B). Get it from `application.context`:

```typescript
const appCtx = await client.query('application.context');
const contextId = appCtx.data?.resourceAccess?.[0]?.context?.live;
// contextId is typed: string | undefined
```

`context.live` / `context.preview` are `string | undefined` in the generated types — the resulting `contextId` is `string | undefined`, never plain `string`.

**Do NOT cast with `as string`.** The shadcn quickstart (`components/examples/built-in-auth/with-xmc/list-languages.tsx`) ships `const contextId = appCtx?.resourceAccess?.[0]?.context?.preview as string;` — that's the Marketplace-rule anti-pattern. Calling an XMC endpoint with `undefined` cast to `string` sends `sitecoreContextId=undefined` on the wire; the API returns 401/403 and the cast hides the actual cause at compile time. Treat the cast as a post-scaffold edit, not a template.

**Correct pattern — guard clause:**

```typescript
const appCtx = await client.query('application.context');
const contextId = appCtx.data?.resourceAccess?.[0]?.context?.live;
if (!contextId) {
  throw new Error('Sitecore context unavailable — app not bound to a resource');
  // or: setError('…'); return;
}
// contextId is narrowed to string from here on
await client.query('xmc.sites.listLanguages', {
  params: { query: { sitecoreContextId: contextId } },
});
```

For a reusable helper, see the `marketplace-sdk-client` skill, § 4 "Getting sitecoreContextId" — the `requireContextId()` typed helper avoids repeating the guard across components.

**`.live` vs `.preview` policy:** `.live` is the delivery/published context; `.preview` is the editor/unpublished context. Use `.live` for production reads; use `.preview` when the app edits content the user hasn't published yet (typical for Pages Context Panel / Custom Field extension points). The quickstart picks `.preview` — replace with `.live` if the app reads published content.

Without this, calls fail with auth/permission errors. See the `marketplace-sdk-lifecycle` skill, § 5c, for the capture strategy (especially for Mode B where it must be persisted server-side).

### 6b. Multiple fetch strategies are a code smell

If your code tries 3+ different endpoints to get the same data:
- You don't know which endpoint is correct — check the tables above
- The correct endpoint requires `sitecoreContextId` and you're not passing it
- The endpoint doesn't exist for your extension point type

Pick one endpoint per data need. Don't plan "fallback strategies" mixing agent + sites + raw GraphQL in the same function.

### 6c. GraphQL endpoints are mutations — AND the envelope is non-obvious

`'xmc.authoring.graphql'`, `'xmc.preview.graphql'`, and `'xmc.live.graphql'` are all **`client.mutate`**, not `client.query` — they're POST requests. TypeScript will reject them as queries; don't cast around this.

**The envelope shape is the trap.** The SDK's generated type declares `body` as a top-level field, but `client.mutate(key, options)`'s `options` parameter is a hey-api / openapi-fetch wrapper that nests `body`, `query`, and any path params under a single `params` key. **`body` must live INSIDE `params`.** And the response **double-unwraps** to `result.data.data` (outer = SDK wrapper, inner = GraphQL response body) — not single `.data` like other XMC mutations.

```typescript
// CORRECT — body inside params, double-unwrap, no `as never` cast
const result = await client.mutate('xmc.authoring.graphql', {
  params: {
    query: { sitecoreContextId },
    body: { query: GRAPHQL_QUERY, variables },
  },
});
const root = result.data?.data as MyGraphqlResponse | undefined;

// WRONG — body at top level + single unwrap + `as never` cast hides the type error
const result = await client.mutate('xmc.authoring.graphql', {
  params: { query: { sitecoreContextId } },
  body: { query, variables },                  // sends HTTP 400 with empty response body
} as never);
const data = (result as { data?: MyGraphqlResponse })?.data;
```

The wrong shape sends a malformed request to `https://edge-platform.sitecorecloud.io/v1/authoring/graphql?sitecoreContextId=...` and returns **HTTP 400 with an empty body** — no GraphQL `errors` payload to help diagnose. Two earlier apps shipped with this wrong shape before the issue was caught in a real-tenant capture. Verified against a real tenant on 2026-05-11.

Full reference: the `marketplace-sdk-client` skill's `references/response-unwrap-matrix.md` (and its § 8b).

For Authoring GraphQL mutation specifics (`createItem` rejects caller-supplied `id`, mutations wrap responses under `{ item { ... } }`, rename requires dedicated `renameItem`, boolean wire format, aliased `field(name:)` accessor pattern), see [`references/authoring-graphql.md`](references/authoring-graphql.md).

### 6d. Agent endpoints vs Sites/Pages endpoints

| Need | Use | Not |
|------|-----|-----|
| List all pages for a site | `xmc.agent.sitesGetAllPagesBySite` (flat list) | `xmc.sites.retrieveSiteHierarchy` (tree, more complex) |
| Components on a page | `xmc.agent.pagesGetComponentsOnPage` | Manual GraphQL layout parsing |
| Site list | `xmc.agent.sitesGetSitesList` (simple) | `xmc.sites.listSites` (also works, more params) |

Agent endpoints are generally the fastest path when they cover the use case. Drop to sites/pages for operations the agent layer doesn't expose.

### 6e. Mode A vs Mode B signatures are not interchangeable

Mode A wraps options in `params:` (e.g. `{ params: { path, query }, body }`). Mode B puts them at the top level (e.g. `{ path, query, body }`). Mixing will produce either TypeScript errors or silent runtime bugs.

### 6f. Mode B requires `sitecoreContextId` in every call

Mode A lets the portal supply context; Mode B does not. Every `experimental_createXMCClient` call must include `query: { sitecoreContextId }`. Missing it returns 401/403 even when the Auth0 token is valid.

### 6g. TypeScript — do NOT use `as never` / `as any`

The SDK is fully typed. If TypeScript complains about an `xmc.*` key, the cause is one of:
- `modules: [XMC]` missing from `ClientSDK.init()` (Mode A)
- Key string mistyped (case-sensitive)
- Wrong call verb (`query` vs `mutate`) for the endpoint

Fix the underlying issue. See the `marketplace-sdk-client` skill, § 8a, for the shared typing rule.

---

## 7. Recommended data-fetching pattern for graph/visualization apps

For apps that need to build a graph/tree of sites → pages → components:

```typescript
// 1. Get context (guard before use — § 6a)
const appCtx = await client.query('application.context');
const contextId = appCtx.data?.resourceAccess?.[0]?.context?.live;
if (!contextId) throw new Error('Sitecore context unavailable');

// 2. Get sites (agent endpoint is simplest)
const sitesResult = await client.query('xmc.agent.sitesGetSitesList', {
  params: { query: { sitecoreContextId: contextId } },
});

// 3. Get pages for a site
const pagesResult = await client.query('xmc.agent.sitesGetAllPagesBySite', {
  params: {
    path: { siteName },
    query: { language: 'en', sitecoreContextId: contextId },
  },
});

// 4. Get components per page (batch with Promise.allSettled)
const componentResults = await Promise.allSettled(
  pages.map(page =>
    client.query('xmc.agent.pagesGetComponentsOnPage', {
      params: {
        path: { pageId: page.id },
        query: { language: 'en', sitecoreContextId: contextId },
      },
    })
  )
);
```

**Do not** mix agent endpoints with raw GraphQL as fallback strategies in the same function. Pick one approach and commit to it.

---

## 8. Agent guidance

**During architecture:** When the architecture involves XMC data operations, select the correct endpoint namespace (agent / sites+pages / graphql) and document in an ADR. Do not plan "fallback" combinations. Pick Mode A unless the architecture requires server-to-server (see the `marketplace-sdk-lifecycle` skill, § 4c).

**During implementation planning:** Specify (a) which XMC keys, (b) exact param structures (`params: { path, query }, body` for Mode A; top-level for Mode B), (c) `sitecoreContextId` capture plan, (d) which mode. For Mode B, include tasks for Auth0 integration and token handling.

**During testing:** Test scenarios must cover each used endpoint: success, 404, auth error (missing `sitecoreContextId`), token expiry in Mode B. Verify pagination/batch limits on list endpoints. Test Authoring GraphQL specifically with a real schema — the mutation vs query distinction is a common miss.

**During implementation:** Use exact key strings. Wrap Mode A options in `params:`, don't wrap for Mode B. Unwrap Mode A responses with `.data` — **except** for module-key queries (`xmc.*`, `ai.*`) which double-unwrap `.data.data`, AND for GraphQL passthroughs (`xmc.authoring.graphql`, `xmc.preview.graphql`, `xmc.live.graphql`) which require body INSIDE `params` AND double-unwrap `.data.data`. See § 6c. For Authoring/Preview/Live GraphQL, use `client.mutate`, not `client.query`.
