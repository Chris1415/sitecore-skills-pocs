---
name: content-sdk-personalization
description: "Personalization in a Content SDK head app: PersonalizeProxy page and component variants, scope, variant rewrite, editing, calling personalize() yourself. Use when a variant does not show. Not creating variants in SitecoreAI."
license: Apache-2.0
compatibility: "Content SDK 2.x head app on Next.js 16 with src/proxy.ts. Verified against @sitecore-content-sdk/nextjs 2.4.0, content 2.3.0, personalize 2.1.0, analytics-core 2.1.2, core 2.1.4. sc_variant editing needs nextjs/content >= 2.2.0. Needs a SitecoreAI tenant with embedded Personalize and an analytics identifier per site language. App Router examples; Pages Router differs only in where Bootstrap mounts."
metadata:
  author: Christian Hahn
  version: "0.2.3"
---

# Content SDK personalization (head app)

Page-level personalization works out of the box: `PersonalizeProxy` asks for a decision on every request and rewrites to the variant, and `getPage` applies it. This skill covers that path, what breaks it silently, and what the SDK gives you when you **trigger a decision yourself**. The short answer to the second part: you can call `personalize()` from any runtime, but it only reaches flows that Pages or the Agent API created, and on the server a plain `fetch` is safer than the SDK.

Backend setup (analytics identifier, `PAGES_PERSONALIZE_SCOPE`, creating variants and A/B tests, the flow-level checks) belongs to **`sitecoreai-personalization`**. Consent wiring (Bootstrap, CdpPageView, Forms, withdrawal) belongs to **`content-sdk-tracking-consent`**. This skill links to both and does not repeat them.

## When to use

- A personalized variant does not show on the live site, or shows for everyone.
- Wiring or reviewing `PersonalizeProxy` and `sitecore.config.ts → personalize`.
- Calling `personalize()` from a client component, Route Handler, Server Component or a proxy subclass.
- Reusing the proxy's decision in your own code, or applying a decision you made yourself.
- Deciding whether a site needs the proxy at all.

## When NOT to use

- Creating page variants, audiences or A/B tests: `sitecoreai-personalization`.
- Sending page views, custom events or identity, or gating tracking on consent: `content-sdk-tracking-consent`.
- Tag-based cache invalidation in general: `content-sdk-app-router-cache-components-and-osr`.

## 1. The OOTB path

**Proxy chain** (the scaffold's `src/proxy.ts`, instantiated per request with the `NextFetchEvent`):

```
preview → botTracking → locale → multisite → redirects → personalize
```

`BotTrackingProxy` must run before `PersonalizeProxy`, because personalize skips requests carrying the `sc_bot` cookie (`skipForBot`, default `true`). Sitecore's lightweight-tracking doc says bot tracking "must be the first proxy", but the scaffold puts preview first. Follow the scaffold. Some starter repos still ship a 4- or 5-proxy chain without bot tracking: that is drift, not a different design. `src/proxy.ts` alone is enough on Next 16; there is no `middleware.ts` (measured on Next 16.3.5).

**What `PersonalizeProxy` does** (`nextjs/types/proxy/personalize-proxy.d.ts`; full skip order in `references/proxy-and-config.md`):

1. Returns early when disabled (`enabled:false`, no Edge config, a path containing `.`, or `skip()` returns true), on a redirect, on preview, or on `sc_bot`.
2. Reads the route's `personalization { variantIds }` from Edge (`edgeTimeout`, 10 s in-process cache).
3. Returns on no personalization or on a prefetch (`Cache-Control: no-store`, `x-proxy-cache: no-cache`).
4. Calls `initContentSdk` with the server context id. This sets `sc_cid` and `sc_cid_personalize` **with both cookie flags hard-coded on**. On a personalized route with marketing consent this **is** the guest mint: `Set-Cookie` on the document, and the browser's `create.json` disappears (measured 2026-10-07; tests: `references/verification.md` § Testing notes).
5. Sends one `personalize()` per friendlyId in parallel (`cdpTimeout`), with UTM, referrer, User-Agent and the optional geo.
6. Drops any returned id that is not in the Edge list, then rewrites to `/<path>/_variantId_<page>[/_variantId_<comp>_<var>]`.
7. **Fails open**: any error or timeout serves the default variant and only logs.

**Applying the variant.** `page.tsx` needs nothing special. `client.getPage(path)` parses the `_variantId_` segments and runs `personalizeLayout(layout, variantId, componentVariantIds)` (`content/types/personalize/layout-personalizer.d.ts:14`). That swaps each rendering for `experiences[id]`, removes variants whose `componentName` is null, and writes `layout.sitecore.context.variantId`. **All variants travel in the Edge layout JSON; selection is server-side.** A variant can swap a component's datasource, so a personalizable component must render any datasource of its template.

**Config.** Set the `personalize` block explicitly (keys, env names and the template trap in `references/proxy-and-config.md`):

```ts
// sitecore.config.ts
personalize: {
  enabled: false,           // site has no personalization: say so
  // enabled: process.env.NODE_ENV !== 'development',   // when it does
  scope: process.env.SITECORE_PERSONALIZE_SCOPE,      // must equal the CM's PAGES_PERSONALIZE_SCOPE
},
```

- **`enabled` defaults to `NODE_ENV !== 'development'`**, so every production request the proxy does not skip pays one Edge lookup, even on a site with no personalization. Measured from a client, that lookup costs about 36 ms p50 / 44 ms p95; the figure from a Vercel Node proxy is open `[probe-gated: P13]`. Set `enabled:false` on sites without personalization: it removes the lookup and the noise.
- Timeouts read `PERSONALIZE_MIDDLEWARE_EDGE_TIMEOUT` and `PERSONALIZE_MIDDLEWARE_CDP_TIMEOUT` (400 ms each). The template's `sitecore.config.ts.example` reads `PERSONALIZE_PROXY_EDGE_TIMEOUT` for **both**; a wrong or non-numeric value falls back to 400 silently.
- **Scope** reads `SITECORE_PERSONALIZE_SCOPE` → `CSDK_PUBLIC_PERSONALIZE_SCOPE` → `NEXT_PUBLIC_PERSONALIZE_SCOPE`. It is normalized to alphanumerics and embedded in every friendlyId. A head-app scope that differs from the CM's `PAGES_PERSONALIZE_SCOPE` gives a friendlyId that no flow has. The exact failure response is open `[probe-gated: P5]`.

**Geo on Vercel.** The proxy forwards only the User-Agent. Geo reaches the decision only through `extractGeoDataCb` (commented out in the scaffold with a hard-coded example). Without it, the OOTB `country` / `country_region` condition code falls back to the `cf-ipCountry` / `cf-region-code` request headers. Because the proxy makes the call **server-side**, those headers describe the hosting region, not the visitor, and geo audiences match by data centre, silently.

```ts
// in new PersonalizeProxy({...}). Header names are Vercel's documented geo headers (not in the
// evidence set); the value form the country condition expects (code vs name) is [probe-gated: P12]
extractGeoDataCb: (req) => ({
  country: req?.headers.get('x-vercel-ip-country') ?? undefined,
  region: req?.headers.get('x-vercel-ip-country-region') ?? undefined,
}),
```

**Consent.** The proxy's only consent levers are `enabled` and `skip`, both all-or-nothing. `skip` runs before the Edge lookup and before the cookie writes, so **`skip` must read the visitor's consent state** (a first-party cookie, because the proxy cannot see client state): `skip: (req) => !hasConsent(req)`. A visitor without consent always gets the default variant. A grant does not reload, so the server decision sees it only on the next request: call `router.refresh()` on a denied → granted **marketing** transition (no reload; URL and `utm_*` kept; measured 2026-10-07). The consent cookie, Bootstrap gating and withdrawal live in `content-sdk-tracking-consent`.

## 2. Variant ids in one table

| Thing | Form | Example shape |
|---|---|---|
| Edge page variant id | no `_` | `<v>` |
| Edge component variant id | `<componentId>_<variantId>`; `<componentId>_default` is the control | `<c>_<v>` |
| Page friendlyId | `embedded_[scope_]<pageIdNoDashes>_<lang>` | `CdpHelper.getPageFriendlyId(pageId, lang, scope)` |
| Component friendlyId | `component_[scope_]<pageId>_<componentId>_<lang>*` (`*` = fuzzy match) | `CdpHelper.getComponentFriendlyId(...)` |
| Rewrite path | `/<path>/_variantId_<v>[/_variantId_<c>_<v>]` | `getPersonalizedRewrite(path, ids)` |
| VIEW `pageVariantId` | `[scope_]<pageId>_<lang>_<variantId\|default>` | `CdpHelper.getPageVariantId(...)` |

All lowercased; the language replaces only its **first** hyphen with `_`. Worked examples and edge cases: `references/variant-grammar.md`.

## 3. Editing and preview

- Pages sends `sc_variant`; since nextjs/content **2.2.0** Preview GraphQL resolves the variant server-side. **No decision call is made in editing.**
- In editing, `personalizeLayout` renders a hidden variant as the hidden-rendering placeholder instead of removing it, so the author can still select it.
- `PersonalizeProxy` and `BotTrackingProxy` skip preview; Bootstrap does not init in `draftMode`. A self-invoked browser `personalize()` therefore throws IE-002 in editing: branch on `page.mode.isNormal`.
- `next dev` disables the proxy (`enabled` default) and Bootstrap. **Verify only on a production build against LIVE Edge** (preview is the permissive surface).

## 4. Triggering a decision yourself

The primitive is `personalize(data, { timeout })` from `@sitecore-content-sdk/personalize` (`personalize/types/src/personalization/personalize.d.ts:10`). It needs `initContentSdk` with `analyticsPlugin` **and** a personalize plugin, POSTs `{edgeUrl}/v1/personalize?siteId=<siteName>` with only `x-sitecore-contextid`, and returns the body typed `unknown`. The behaviour that matters:

- **No `timeout` → no timeout at all.** A timeout throws IE-003 but does not abort the fetch.
- Non-2xx, network and JSON errors return `null`. Init missing throws IE-002 / IE-004; blank friendlyId throws MV-004.
- `browserId` (from `sc_cid`) is sent only when you pass no `email` and no `identifier`. Passing one switches to the identified guest and a separate session.
- **No bot check.** Only the proxy honours `sc_bot`; gate your own calls.
- Check the returned `variantId` against the candidates you sent, as the proxy does.

Full wire body, error table and longer code: `references/self-invocation.md`.

| Runtime | How | Verdict |
|---|---|---|
| Client component | Add `personalizeBrowserPlugin` to **Bootstrap's** plugin array; call after init | OK. Never call `initContentSdk` a second time: it replaces Bootstrap's plugins |
| Route Handler | `initContentSdk` + `analyticsProxyAdapter` / `personalizeProxyAdapter` with a carrier response | Works, but **not concurrency-safe** |
| Server Component | Hand-written adapters over `cookies()` / `headers()`; both cookie flags `false` | Possible; same singleton risk; feed UTM from `searchParams` |
| Proxy | Subclass `PersonalizeProxy`; override the protected `getExperienceParams` / `getPersonalizeExecutions` | Best for extra params or extra friendlyIds: reuses init, rewrite and fail-open |
| Any server code | **Plain `fetch` of the wire contract** | **Recommended for server use** |

**Why `fetch` on the server.** `initContentSdk` overwrites one process-global context, and SDK calls read it back after an `await`. Measured with server-side `event()` in a Route Handler under 50 concurrent requests: 24/50 outbound calls carried another visitor's browser id, and 49/50 with 0-200 ms jitter, all accepted with 201, while `Set-Cookie` stayed correct. `personalize()` resolves its adapters the same way; the proxy and Route-Handler legs for `personalize()` specifically are `[probe-gated: P22]`.

```ts
// server-side decision without the SDK singleton
const r = await fetch(`${edgeUrl}/v1/personalize?siteId=${encodeURIComponent(siteName)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-sitecore-contextid': contextId, ...(ua && { 'User-Agent': ua }) },
  body: JSON.stringify({
    friendlyId, channel: 'WEB', currencyCode: 'USD', language, clientKey: '', pointOfSale: '',
    browserId: sc_cid ?? '', guestRef: sc_cid_personalize ?? '',
    params: { utm, referrer, geo }, variants,
  }),
  signal: AbortSignal.timeout(400),   // a real abort, unlike the SDK's race
  cache: 'no-store',                  // a decision is per visitor: never cache it
});
const variantId = r.ok ? ((await r.json()) as { variantId?: string }).variantId : undefined;
const chosen = variantId && variants.includes(variantId) ? variantId : undefined;
```

**Reusing the proxy's decision.**

- In `page.tsx`, the rewrite lands in the `[[...path]]` param: `getPersonalizedRewriteData(path.join('/'))` returns `{ variantId, componentVariantIds }` (default `'_default'`); `normalizePersonalizedRewrite` gives the clean path (`content/types/personalize/utils.d.ts`).
- **Apply your own decision without the proxy:** `client.getPage(path, { site, locale, personalize: { variantId, componentVariantIds } })`. An explicit `personalize` wins over the path (`PageOptions`, `content/types/client/sitecore-client.d.ts:86`).
- In client components only the **page** variant survives: `useSitecore().page.layout.sitecore.context.variantId`. Component variant ids are not kept in the layout; pass them as a prop from `page.tsx`.
- Other proxies can read `SuccessfulPersonalizeProxyExecution` from `proxiesContext`, but only if you pass a `Map` into `exec(req, res, ctx)`. The scaffold calls `.exec(req)`.

**What a self-invoked call can target.** Only friendlyIds that exist in the Personalize tenant behind the context id. On a SitecoreAI embedded-only tenant those are the `embedded_…` and `component_…*` flows that Pages, the Agent API or the Marketer MCP created, and the response is fixed to `{ "variantId": "…" }`. No Agent API, Pages API or MCP operation accepts a friendlyId, a flow type or a response template.

- **Decision-as-data is a named gap.** An arbitrary friendlyId that returns an arbitrary JSON payload is a standalone Sitecore Personalize interactive experience. The SDK would return such a body verbatim, but whether edge-platform `/v1/personalize` forwards a non-embedded flow is `[probe-gated: unscheduled, needs a Personalize-licensed tenant]`.
- **Embedded workaround, the "decision page":** a hidden page whose variants carry the payload. Call its page friendlyId, then read `experiences[variantId]` from its Edge layout (or run `personalizeLayout`). Measured (P7): Edge carries the copied datasource's full `fields` under `experiences[<v>]` for a datasource-only COPY, and the decision ignores URL, `siteId` and body `language` (friendlyId + params decide). So the decision side works from any route. Whether Pages accepts a hidden decision page is not run.
- **`webPersonalization` is not an option on embedded tenants.** On both tenants probed, `/v1/personalize/cdn-url` pointed at a `cloud-version.min.js` that returns 403, so the plugin injects a script that does nothing. Its `defer` and `language` options are ignored, and browser init exposes `window.scContentSDK.personalize` to every script on the page.

**Client-side decisions on a cached or static page** keep one HTML cache entry, but only client components can swap to `experiences[variantId]`; Server Components cannot re-render. Expect flicker: default first, then init, `create.json` on a first visit, and the decision round trip.

## 5. Caching

| Behaviour | Status |
|---|---|
| Personalized responses get `x-proxy-cache: no-cache`; prefetch skips the decision with `Cache-Control: no-store` | code-verified |
| `generateStaticParams` emits base paths only, so variant paths render on demand | code-verified |
| `'use cache'` keyed on `{site, locale, path}` gives one entry per variant path; cache tags strip variant segments, so one revalidate covers all variants | inference from code |
| Vercel CDN / ISR cache key for a rewritten request; audience leakage | `[probe-gated: P17]` |
| A third-party CDN in front sees no `Vary: Cookie` or `Cache-Control: private`; bypass personalized routes there | from code reading, not measured |
| Never cache a self-invoked decision (`fetch` cache, `'use cache'`, CDN) | rule |

## 6. Verify: the head-app layers

The rendered page proves nothing, because the decision fails open. Check each layer separately, each with a control. Layers 1-2 (flow, variant setup) and 7 (analytics) are in `sitecoreai-personalization`. Commands and pass criteria: `references/verification.md`.

| Layer | Pass | Control |
|---|---|---|
| 3 Edge | `personalization.variantIds` non-empty; the rendering has `experiences[<v>]` | A plain page returns `[]` (never null) and has no `experiences` key |
| 4 Decision | Direct `POST /v1/personalize` with a real browser id returns `{ variantId: <v> }` | Same call without the matching condition: `200 {"message":"No matching variant"}`. Unknown or wrongly scoped friendlyId: `404 No experiences found for friendlyId … and clientKey …` (measured P7) |
| 5 Render | Production build, LIVE Edge, **non-headless UA**, consent set, `DEBUG=content-sdk:personalize` shows the `_variantId_` rewrite | Without the condition: the default |
| 6 Beacon | VIEW `ext.pageVariantId` ends `_<v>` | A default visit ends `_default` |

**Never judge from one request.** The proxy's Edge lookup has a 400 ms budget (`PERSONALIZE_MIDDLEWARE_EDGE_TIMEOUT`). The first request after `next start`, and the first after a publish (Edge cache cold), hit `IE-003` (measured: 411 ms, 406 ms) and serve the default as `skipped (personalize info not found)`. Warm the route, or raise the timeout, and repeat. On the deployed CDN (2026-10-07) the first request after publish + redeploy served the default with a live variant, and identical repeats then alternated default / variant for a while: warm, re-read several times. The `content-sdk:personalize` DEBUG log prints the **full context id** in every lookup: do not ship it to a log vendor.

**A headless browser is a bot.** `isbot` classifies `HeadlessChrome` and `curl`, so `sc_bot` is set and the proxy skips. Pin a real Chrome UA and assert a positive control before trusting a zero.

## Hard rules

- Set `personalize.enabled` explicitly; `false` on a site without personalization.
- `skip` reads consent. Never let the proxy run, and set cookies, for a visitor without consent.
- Keep `BotTrackingProxy` before `PersonalizeProxy`.
- Pass a `timeout` to every SDK `personalize()` call, and catch IE-002 / IE-003.
- Server-side self-invocation uses `fetch`, not the SDK, unless the calls are serialized.
- Never treat a rendered page, a quiet console or a zero under a headless UA as proof.

## Stop conditions

- Stop if asked to make decision tables work from the head app: there is no API, and the head-app contract is undocumented `[probe-gated: P9]`. Route to the Pages UI.
- Stop if a fix needs a custom flow type or response template on an embedded-only tenant: that is the decision-as-data gap.
- Stop and probe before relying on locale-prefixed URLs: the proxy looks up the raw pathname, so `/de/about` probably never personalizes `[probe-gated: P11]`.

## References

- `references/proxy-and-config.md`: skip order, config keys, env vars, proxy hooks.
- `references/variant-grammar.md`: id and friendlyId formulas with worked examples.
- `references/self-invocation.md`: wire body, errors, code per runtime.
- `references/verification.md`: the ladder with commands, plus testing notes.
- `references/traps.md`: every known trap with its status.
- Sibling skills: `sitecoreai-personalization`, `content-sdk-tracking-consent`, `content-sdk-app-router-multisite-management`, `content-sdk-app-router-cache-components-and-osr`, `content-sdk-app-router-route-handler-vs-server-action`.
