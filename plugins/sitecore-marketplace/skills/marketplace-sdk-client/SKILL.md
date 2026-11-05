---
name: marketplace-sdk-client
description: "API reference for @sitecore-marketplace-sdk/client: ClientSDK.init, provider patterns, query, mutate, subscribe, extension points, custom-field values, errors, test stubs. Entry point for any Marketplace app talking to the Cloud Portal."
license: Apache-2.0
compatibility: "Requires @sitecore-marketplace-sdk/client; runs inside a browser iframe with postMessage access to window.parent (Cloud Portal / Pages / Dashboard host)."
metadata:
  author: Christian Hahn
  version: "0.6.3"
---

# Sitecore Marketplace Client SDK

> **This skill is a catalog, not a contract.** It documents `ClientSDK.init` options and the `query`/`mutate`/`subscribe` verb shapes. It does **not** document the response envelope of any specific module (`xmc.*`, `ai.*`) — those are determined by the module's generated types in `node_modules`. Before writing `client.query(...)`, open the relevant `*.d.ts` and cite the path inline. Mock fixtures must match the declared types.

## When to use

- The project uses `@sitecore-marketplace-sdk/client` (required for all Marketplace apps)
- The PRD or architecture mentions Marketplace integration, SitecoreAI extension, or embedded app
- The scaffold decision (the `setup-scaffold` skill) chose Scaffold 2 (Client-Side) or Scaffold 3 (Full-Stack)
- The project identifies extension points like Full Screen, Pages Context Panel, or Dashboard Blocks

For **XMC endpoints** (`xmc.*` keys, GraphQL, content-transfer) see the `marketplace-sdk-xmc` skill.
For **AI skills module** see the `marketplace-sdk-ai` skill.
For **app lifecycle, auth model, architectures** (including experimental server-to-server mode) see the `marketplace-sdk-lifecycle` skill.
For **local dev loop, iframe auth debugging** see the `marketplace-sdk-testing-debug` skill.

---

## 1. Package overview

| Package | Purpose |
|---------|---------|
| `@sitecore-marketplace-sdk/core` | PostMessage bridge, handshake, event emitter (internal) |
| `@sitecore-marketplace-sdk/client` | High-level query/mutate/subscribe API — **this skill** |
| `@sitecore-marketplace-sdk/xmc` | XMC module — see the `marketplace-sdk-xmc` skill |
| `@sitecore-marketplace-sdk/ai` | AI skills module — see the `marketplace-sdk-ai` skill |

The **client** package is what you import. The **core** package is an internal dependency. The **xmc** and **ai** modules plug into the client via the module system and extend its type maps.

**Install (always latest):** `npm install @sitecore-marketplace-sdk/client@latest @sitecore-marketplace-sdk/xmc@latest @sitecore-marketplace-sdk/ai@latest` — pick only the modules the app actually uses.

**Scope of this file:** client-side iframe integration (`ClientSDK.init()` + base query/mutate/subscribe). Module-specific keys live in their own files.

---

## 2. Initialization

```typescript
import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';
import { AI } from '@sitecore-marketplace-sdk/ai';

const client = await ClientSDK.init({
  target: window.parent,       // REQUIRED — the host window (always window.parent in iframe)
  modules: [XMC, AI],          // Register zero or more modules
  origin?: string,             // Host origin — auto-detected if omitted
  timeout?: number,            // Handshake timeout in ms (default: 30000)
});
```

### Critical rules

- **`target: window.parent`** — Marketplace apps always run in an iframe. The target is the host window.
- **Call `ClientSDK.init()` only once.** Both patterns below enforce this: the Provider via `useEffect` + state, the singleton via a module-level promise.
- **Client-side only.** The SDK uses `postMessage` — it cannot run during SSR. Always guard with `'use client'` and dynamic imports.
- **`client.destroy()`** — Call on unmount to clean up subscriptions and message listeners.

### Provider pattern — scaffold default

The shadcn quickstart (the `setup-marketplace-client-side` skill) ships a React Context pattern in `components/providers/marketplace.tsx` — `MarketplaceProvider` wraps the app at `app/layout.tsx`, exposes `client` + `applicationContext` via context, renders children only after both resolve, and provides `useMarketplaceClient()` / `useAppContext()` hooks for consumers.

The full template (drop-in `marketplace.tsx`) lives at [`assets/marketplace-provider.tsx`](assets/marketplace-provider.tsx). Copy it verbatim if your scaffold doesn't already ship it; extend `modules: [XMC]` to `[XMC, AI]` when the app uses AI skills.

### Singleton pattern — alternative for non-React consumers

Use a module-level singleton promise when the SDK is consumed outside the React tree (library exports, utility modules, top-level scripts). Same init contract as the Provider, different consumption shape — `getSDKClient()` returns the resolved client and ensures `ClientSDK.init()` runs only once. The dynamic-imports inside the singleton avoid the SSR crash that bites if you statically import `@sitecore-marketplace-sdk/client` in a server component.

Drop-in template at [`assets/sdk-client-singleton.ts`](assets/sdk-client-singleton.ts).

**Do not mix both patterns in the same app** — that creates two parallel init paths and risks duplicate handshakes. Pick one based on whether the SDK is consumed primarily inside or outside React.

### Alternative: experimental server-to-server mode

For apps running **outside** the iframe (standalone, cron jobs, microservices, server routes that need XMC/AI without portal brokering), both the XMC and AI packages offer experimental direct clients (`experimental_createXMCClient`, `experimental_createAIClient`). These bypass the postMessage bridge and call XMC/AI APIs directly with an Auth0 access token you supply.

**Experimental — subject to breaking changes.** Only use when the iframe Client SDK path can't satisfy the requirement. For the architecture decision and Auth0 config, see the `marketplace-sdk-lifecycle` skill, § 4c + § 5. For the per-package API: the `marketplace-sdk-xmc` skill, § 2b, and the `marketplace-sdk-ai` skill, § 4.

---

## 3. Core API patterns

The SDK exposes three verbs: **query**, **mutate**, **subscribe**. Each verb is fully typed via mapped types — the key string determines parameter and response types at compile time.

### 3a. query

```typescript
const result = await client.query(key, options?);
// result: { data, error, status, isLoading, isError, isSuccess, refetch, unsubscribe? }
```

- Returns a result object, not raw data. Access `.data` for the payload.
- Some queries support live subscriptions (see `subscribe` field in QueryMap).

### 3b. mutate

```typescript
const response = await client.mutate(key, options?);
// response is the direct return value (typed per MutationMap)
```

- Triggers state changes on the host.
- The options object shape varies per key — check the relevant module file (the `marketplace-sdk-xmc` or `marketplace-sdk-ai` skills) for its MutationMap.

### 3c. subscribe

```typescript
const unsubscribe = client.subscribe(eventKey, {
  onData: (data) => { ... },
  onError?: (error) => { ... },
});
// Call unsubscribe() to stop listening
```

- Event-based subscriptions for real-time updates.
- Always store and call the returned `unsubscribe` function on cleanup.

### 3d. Utility methods

```typescript
client.logout(): Promise<void>
client.openProfile(): Promise<void>
client.navigateToExternalUrl(url: string, newTab?: boolean): Promise<void>
client.emitRouteEvent(route: string): Promise<void>
client.getValue(): Promise<any>
client.setValue(value: string, canvasReload?: boolean): Promise<void>
client.closeApp(): Promise<void>
client.destroy(): void
```

### 3e. `getValue` / `setValue` — the Custom Field read/write surface

`getValue` / `setValue` are the **primary read/write surface for the `xmc:pages:customfield` extension point** (§ 7 → `references/extension-points.md`). There is no dedicated `QueryMap` / `MutationMap` key for custom-field values — these utility methods are the contract.

**Runtime shape.** At runtime the value is a **string** — typically JSON, but the SDK contract is "opaque string". `setValue` enforces this (`value: string`). `getValue` currently returns `Promise<any>` (upstream type sloppiness; in the meantime treat the return as `Promise<string>` in your own code).

```typescript
async function readFieldValue(client: ClientSDK): Promise<unknown> {
  const raw = await client.getValue();
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // plain string — field wasn't JSON-shaped
  }
}

async function writeFieldValue(
  client: ClientSDK,
  value: unknown,
  canvasReload = true,
): Promise<void> {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  await client.setValue(payload, canvasReload);
}
```

**`canvasReload` parameter.** Passing `true` tells Pages to re-render the canvas after the write — use this when the field change should be visible in the preview immediately (most common). Pass `false` for background writes where the canvas shouldn't flicker.

**Do NOT** propagate `any` out of your read wrapper — narrow it to `string` / `unknown` at the boundary. Downstream code that types its field shape should parse into a Zod / io-ts schema or a hand-rolled type guard, not a cast.

---

## 4. Base QueryMap (built into client — no module needed)

| Key | Params | Response | Subscribable |
|-----|--------|----------|-------------|
| `'host.user'` | void | `UserInfo` `{ id, name, email }` — **at runtime the full Auth0 claim set** (see § 8h) | no |
| `'host.state'` | void | `HostState` | yes |
| `'host.route'` | void | `string` | no |
| `'application.context'` | void | `ApplicationContext` | no |
| `'site.context'` | void | `SiteContext` | no |
| `'pages.context'` | void | `PagesContext` | yes |

For the full **`ApplicationContext` and `PagesContext` interface shapes**, plus the canonical `sitecoreContextId` extraction pattern (with the cast-vs-guard discussion and the `requireContextId()` typed helper), see [`references/base-maps.md`](references/base-maps.md).

---

## 5. Base MutationMap (built into client)

| Key | Params | Response |
|-----|--------|----------|
| `'pages.reloadCanvas'` | void | void |
| `'pages.context'` | `{ itemId?, language?, itemVersion? }` | void |

**Navigate to a page in Pages editor:**
```typescript
await client.mutate('pages.context', {
  params: { itemId: 'GUID-HERE' },
});
```

---

## 6. Subscriptions — two distinct code paths

The SDK exposes **two different mechanisms** for receiving live updates. They are **not interchangeable** — picking the wrong one is a typecheck error.

| Path | Trigger | Used for | Returns |
|------|---------|----------|---------|
| **A. Subscribe-via-query** | `client.query(K, { subscribe: true, onSuccess })` | `QueryMap` keys with `subscribable: yes` (e.g. `pages.context`, `host.state`) | `QueryResult` with optional `unsubscribe` |
| **B. Subscribe-verb** | `client.subscribe(K, { onData, onError? })` | `SubscribeMap` keys — event-only firehoses (e.g. `pages.content.fieldsUpdated`) | `() => void` teardown |

**How to pick:** look up the key. `QueryMap` (§ 4) with `subscribable: yes` → path A. `SubscribeMap` events → path B. A key never lives in both maps; the wrong call won't typecheck.

For full mechanics — both code patterns, the `SubscribeMap` event table, the client-side filter trap on `pages.content.fieldsUpdated`, and the rationale for two paths — see [`references/subscriptions.md`](references/subscriptions.md).

---

## 7. Extension points

The per-extension-point table — which queries are available, iframe viewport constraints, what the host injects — is in `references/extension-points.md`. Open it when picking or wiring an extension point; `getValue` / `setValue` (§ 3) is the contract for `xmc:pages:customfield`.

## 8. Common pitfalls

### 8a. TypeScript — do NOT use `as never` or `as any`

The SDK is fully typed. If TypeScript complains about a query key, the cause is one of:
- The relevant module wasn't registered (`modules: [XMC]` or `modules: [AI]` missing from init)
- The key string is wrong (case-sensitive — check the reference files)
- You're passing params in the wrong structure

**Fix:** import the module, pass it to init, and use exact key strings. The TypeScript compiler will validate params and response types automatically.

### 8b. Response unwrapping

Single vs double `.data` depends on the call family and on Mode A vs Mode B — the full matrix with worked examples is in `references/response-unwrap-matrix.md`. Never guess the depth; look it up.

### 8c. WebGL in iframes

SitecoreAI may set `sandbox` attributes on the iframe. Check `application.context` → `permissions.iframe.sandbox` to see what's allowed. If WebGL is blocked:
- The `<canvas>` element will render but `getContext('webgl')` or `getContext('webgl2')` returns `null`
- Detect this early and fall back to 2D rendering
- Do NOT plan a full 3D rendering path without a validation spike first

### 8d. SSR and the SDK

The SDK uses `window.parent` and `postMessage` — it cannot run server-side.

**Rules:**
1. Mark all SDK-using files with `'use client'`
2. Use `next/dynamic` with `{ ssr: false }` for components that call the SDK
3. Never import SDK modules in server components, API routes, or middleware
4. The singleton init pattern (§ 2) handles this correctly with dynamic imports

### 8e. Subscription cleanup

Always clean up subscriptions:

```typescript
useEffect(() => {
  const unsub = client.subscribe('pages.content.layoutUpdated', {
    onData: (data) => { ... },
  });
  return () => unsub();
}, [client]);
```

Failing to clean up causes memory leaks and orphaned event listeners in the PostMessage bridge.

### 8f. Error codes

The error-code table (`code` → meaning → what to do) is in `references/error-codes.md`. Check it when a call rejects; the codes are stable across SDK versions.

### 8g. Iframe auth silently fails on HTTP or wrong cookie config

Running over HTTP or with misconfigured session/transaction cookies makes iframe login fail with no clear error. See the `marketplace-sdk-testing-debug` skill, § 4 for the mandatory cookie block + symptom table, § 6 for the step-by-step debugging checklist. Do not reproduce the config here — it drifts.

---

### 8h. `tenantName` is ABSENT on `resourceAccess[]` for a full-screen app — read the `host.user` claim

`ApplicationResourceContext.tenantName` is declared **optional** (`core/dist/shared-types.d.ts:77`), and
for an `xmc:fullscreen` app the host really leaves it out. Measured 2026-09-12 (a full-screen app on a live
org): `resourceAccess[0]` = `{ resourceId, tenantId, tenantDisplayName: "<org> / <environment>",
context: { live, preview } }` — **no `tenantName`**. Anything that needs the SitecoreAI tenant name — the
Page Builder deep link `https://pages.sitecorecloud.io/editor?organization=&tenantName=&sc_site=&sc_itemid=&sc_lang=`
above all — therefore read `undefined` and rendered a dead control, with every gate green.

The value IS on `host.user`. The SDK types the response as `UserInfo { id, name, email }`, but at
runtime it is the **Auth0 claim set**: `https://auth.sitecorecloud.io/claims/tenant_name` (also
`…/tenant_id`, `…/org_id`, `…/org_name`, `…/roles`, `sc_org_region`, `sub`, `email`). Resolve in order,
and keep the source:

```ts
const TENANT_NAME_CLAIM = "https://auth.sitecorecloud.io/claims/tenant_name";
const fromAccess = appCtx.resourceAccess?.find((r) => r.tenantName)?.tenantName;
const user = (await client.query("host.user")).data as Record<string, unknown>;
const tenantName = fromAccess ?? (user?.[TENANT_NAME_CLAIM] as string | undefined) ?? null;
```

Two consequences. **(1)** Do not build a half-address — a link with an empty `tenantName` opens Page
Builder on nothing, which reads as the app being broken; return `null` and say which part is missing.
**(2)** `pages.context` (the mutation) does **not** navigate from a full-screen app; the deep link in a
new tab is the working shape.

## 9. Testing — typed Vitest stubs for the SDK surface

Unit-testing harness code that calls `client.query` / `mutate` / `subscribe` / `destroy` requires a stubbed `ClientSDK`. The SDK's call signatures are overloaded and generic, so **naked `vi.fn()` will fail `tsc --noEmit`** with `TS2348: Value of type 'Mock<Procedure | Constructable>' is not callable.` — always pass the call signature as a generic: `vi.fn<ClientSDK['query']>()`.

For the full pattern — typed stubs per verb, default return values, call-shape assertions for query/mutate, and subscribe-lifecycle assertions — see [`references/vitest-stubs.md`](references/vitest-stubs.md).

---

## 10. Agent guidance

**During architecture:** When the architecture involves the Marketplace Client SDK, document the extension-point choice (§ 7 → `references/extension-points.md`) and whether modules (XMC, AI) are needed in the init. Record the handshake constraint (iframe-only) as an ADR if the app scope includes anything non-iframe.

**During implementation planning:** Specify (a) the singleton init pattern (§ 2), (b) which modules to register, (c) which extension points the app targets. All dev and validation runs against a registered test app in Cloud Portal — there is no mock-client path. For module-specific keys and params, defer to the `marketplace-sdk-xmc` or `marketplace-sdk-ai` skills.

**During testing:** Verify test scenarios for SDK error states (§ 8f: timeout, not connected, token error, handshake failed). Add a validation spike for iframe constraints if the app uses canvas/WebGL (§ 8c).

**During implementation:** Use the exact key strings documented here and in the module-specific files. Do not cast `as never` or `as any` — if TypeScript errors on a key, check that the right module is in `modules: [...]`. Unwrap results with `.data`. Always clean up subscriptions.
