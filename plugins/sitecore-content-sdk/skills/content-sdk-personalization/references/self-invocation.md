# Self-invoked decisions: wire contract, errors, code per runtime

Verified against `personalize` 2.1.0, `core` 2.1.4, `analytics-core` 2.1.2, `nextjs` 2.4.0. Paths relative to `node_modules/@sitecore-content-sdk/`.

## Signature

```ts
// personalize/types/src/personalization/personalize.d.ts:10
personalize(personalizeData: PersonalizeData, opts?: { timeout?: number }): Promise<unknown | null | FailedCalledFlowsResponse>
```

## `PersonalizeData` → wire body

`PersonalizeData`: `personalize/types/src/personalization/personalizer.d.ts:80-143`. Wire body `EPCallFlowsBody`: `send-call-flows-request.d.ts:59-72`. Mapping: `personalizer.js:49-92`.

| SDK field | Wire field | Notes |
|---|---|---|
| `friendlyId` (required) | `friendlyId` | Blank throws MV-004. Passed verbatim (the `*` suffix works) |
| `channel` (required by type) | `channel` | Not validated. The proxy sends `'WEB'` |
| `currency` | `currencyCode` | The proxy sends `config.currency ?? 'USD'` |
| `language` | `language` | Browser default = HTML `lang`; server default = `''`. Pass it explicitly so it matches the friendlyId |
| `email` | `email` | Dropped if blank |
| `identifier: {id, provider}` | `identifiers` | A **single object**, despite the plural |
| `geo: {city, country, region}` | `params.geo` | No top-level geo on the wire |
| `params` | `params` | Free-form. UTM is auto-extracted from the adapter's search params into `params.utm` unless you set it |
| `pageVariantIds` | `variants` | The candidates. Omitted when empty |
| — | `browserId` | `sc_cid`, **only when no `email` and no `identifier`**; `''` when the cookie is absent |
| — | `guestRef` | `sc_cid_personalize` or `''` |
| — | `clientKey: ''`, `pointOfSale: ''` | Derived server-side from the context id |

Transport: `POST {edgeUrl}/v1/personalize?siteId={siteName}` with `x-sitecore-contextid`, `x-sc-correlation-id`, `X-Library-Version`, and `User-Agent` when the adapter has one. `siteName` is the `initContentSdk` site name. Response: the parsed body, untouched. For embedded flows `{ "variantId": "…" }`. Measured (P7): no match `200 {"message":"No matching variant"}`; unknown friendlyId `404 {"message":"No experiences found for friendlyId … and clientKey …"}` (the SDK returns `null`); missing `channel` `400`; empty `browserId` decides normally (context audiences need no guest). A "not live" flow cannot be produced by API (no pause verb); a flow whose page variant was reset still answers with its variant id.

## Errors

| Condition | Behaviour |
|---|---|
| `initContentSdk` never ran | throws IE-002 |
| No personalize or analytics plugin registered | throws IE-004 |
| Missing plugin dependency at init | throws IE-001 |
| Blank `friendlyId` | throws MV-004 |
| Timeout elapsed | throws IE-003; the fetch is **not** aborted (`Promise.race`) |
| Invalid timeout | throws IV-002 |
| No `timeout` | no timeout at all |
| Non-2xx, network error, bad JSON | returns `null` |

## Init prerequisites

- Plugins: `analyticsPlugin({ adapter, options })` **and** `personalizeBrowserPlugin({ adapter })` or `personalizeServerPlugin({ adapter })` (`personalize/types/src/initialization/types.d.ts`).
- Context id: browser uses `api.edge.clientContextId`; server and proxy use `api.edge.contextId`.
- `siteName` required (MV-002).
- Cookies are optional for the call. `enablePersonalizeCookie` is ignored unless analytics `enableCookie` is also true. Set it on the browser or the server plugin, not both.
- **One context per JS realm.** `initContentSdk` replaces it on every call (`core/dist/cjs/initialization/init-content-sdk.js:34-44`).

## (a) Client component

Extend Bootstrap's plugin array; do not init again.

```tsx
// src/Bootstrap.tsx, inside the existing initContentSdk plugins array
personalizeBrowserPlugin({
  adapter: personalizeBrowserAdapter(),
  options: { enablePersonalizeCookie: hasConsent },
}),
```

```tsx
'use client';
import { useEffect, useState } from 'react';
import { personalize } from '@sitecore-content-sdk/personalize';
import { CdpHelper, useSitecore } from '@sitecore-content-sdk/nextjs';
import config from 'sitecore.config';

export function DecisionSlot({ pageId, variants }: { pageId: string; variants: string[] }) {
  const { page } = useSitecore();
  const [variantId, setVariantId] = useState<string | null>(null);
  useEffect(() => {
    if (!page.mode.isNormal) return;                 // editing: Bootstrap never inits → IE-002
    personalize(
      { friendlyId: CdpHelper.getPageFriendlyId(pageId, page.locale, config.personalize?.scope),
        channel: 'WEB', language: page.locale, pageVariantIds: variants },
      { timeout: 800 })
      .then((r) => {
        const id = (r as { variantId?: string } | null)?.variantId;
        setVariantId(id && variants.includes(id) ? id : null);
      })
      .catch(() => setVariantId(null));              // IE-002 not initialised / IE-003 timeout
  }, [page.mode.isNormal, page.locale, pageId, variants]);
  return variantId ? <Variant id={variantId} /> : <Default />;
}
```

- Ordering inside `app/[site]` holds: Bootstrap renders before `{children}`, and `initContentSdk` assigns the context synchronously before its first `await` (measured: 0 IE-002 in 6 runs, CPU-throttled included).
- IE-002 still happens above `app/[site]/layout.tsx`, in development, without `clientContextId`, or when Bootstrap's init was skipped (consent). Under the cache-components template (Suspense around the page) the ordering is unmeasured.
- Browser init sets `window.scContentSDK.personalize`, callable by any script on the page (consent and CSP).
- Gate on bots yourself: `personalize()` has no bot check, and a bot gets no `sc_cid`.

## (b1) Route Handler

```ts
// app/api/decide/route.ts  (the scaffold matcher excludes /api from the proxy)
import { NextRequest, NextResponse } from 'next/server';
import { initContentSdk, analyticsProxyAdapter, personalizeProxyAdapter } from '@sitecore-content-sdk/nextjs';
import { analyticsPlugin } from '@sitecore-content-sdk/analytics-core';
import { personalizeServerPlugin, personalize } from '@sitecore-content-sdk/personalize';
import config from 'sitecore.config';

export async function POST(req: NextRequest) {
  const { friendlyId, site, language, variants } = await req.json();
  const carrier = new NextResponse(null);           // never NextResponse.next() here: HTTP 500
  await initContentSdk({
    config: { contextId: config.api.edge.contextId!, edgeUrl: config.api.edge.edgeUrl, siteName: site },
    plugins: [
      analyticsPlugin({ options: { enableCookie: false }, adapter: analyticsProxyAdapter(req, carrier) }),
      personalizeServerPlugin({ options: { enablePersonalizeCookie: false }, adapter: personalizeProxyAdapter(req, carrier) }),
    ],
  });
  const decision = await personalize({ friendlyId, channel: 'WEB', language, pageVariantIds: variants }, { timeout: 400 })
    .catch(() => null);
  const res = NextResponse.json({ decision });
  carrier.cookies.getAll().forEach((c) => res.cookies.set(c));   // copy anything the adapters set
  return res;
}
```

Adapters: `nextjs/types/initialization/proxy/analytics-adapter.d.ts:22`, exported at `nextjs/types/index.d.ts:30,32`. The carrier-plus-copy pattern and the `NextResponse.next()` failure were measured with server `event()` (201). **Not concurrency-safe** (below). Call it from a client component with `fetch`, never through a Server Action (it triggers `router.refresh()`; see `content-sdk-app-router-route-handler-vs-server-action`).

## (b2) Server Component

App Router exposes no `IncomingMessage`, so `personalizeServerAdapter(req, res)` does not fit. Implement the public interfaces over `cookies()` / `headers()`:

- `AnalyticsAdapter`: `{ type, getClientId, setClientId, isBot?, location.getSearchParams }` (`analytics-core/types/src/initialization/types.d.ts:8-34`).
- `PersonalizeAdapter`: `{ type, getProfileId, setProfileId, getUserAgent? }` (`personalize/types/src/initialization/types.d.ts:151-167`).

Set both cookie flags to `false` (an RSC cannot set cookies), and feed `getSearchParams` from the page's `searchParams`, or UTM capture is empty. Same singleton risk as (b1). Prefer (b3).

## (b3) Plain `fetch`: recommended on the server

See the snippet in `SKILL.md` § 4. No singleton, no adapters, no cookie side effects, a real abort. Read `sc_cid` / `sc_cid_personalize` from the request cookies; without the visitor's `sc_cid`, history-based audiences (visits, page views) can never match. Never cache the response.

## (c) Proxy

- **Subclass `PersonalizeProxy`** and override `getExperienceParams` (extra params such as a logged-in flag from a cookie, readable by custom conditions) or `getPersonalizeExecutions` (extra friendlyIds). Reuses the already-initialised plugin set, the rewrite and fail-open.
- **A custom `ProxyBase` after `personalize`** in `defineProxy(...)` that calls (b3). Do not call `initContentSdk` again in the same request: it overwrites the context `PersonalizeProxy` just set.

## The singleton measurement

Route Handler calling `initContentSdk` + server `event()`, 50 parallel requests, each with its own `sc_cid` (P6, 2026-10-01):

| Run | Outbound browser id = own visitor | `Set-Cookie` correct | edge-platform status |
|---|---|---|---|
| serial control | 1/1 | 1/1 | 201 |
| n=50, no jitter | 26/50 | 50/50 | 201 × 50 |
| n=50, 0-200 ms jitter | 1/50 (one id for all) | 50/50 | 201 × 50 |

`personalize()` resolves adapters the same way; its proxy and Route-Handler legs are `[probe-gated: P22]`. A concurrency test must assert the outbound payload's browser id; checking the cookie passes while the data is wrong.

## What can be targeted

| friendlyId | Created by | Response |
|---|---|---|
| `embedded_[scope_]<pageId>_<lang>` | Pages, Agent API v2 personalization versions, Marketer MCP `create_perso_version*` | `{variantId}`; pass the page's Edge ids without `_` as candidates |
| `component_[scope_]<pageId>_<compId>_<lang>*` | Pages A/B/n, Agent API experiments | `{variantId}` as `<compId>_<varId>` or `<compId>_default` |
| anything else | nothing in SitecoreAI | only if a standalone Personalize user created it |

No Agent API, Pages API or MCP request takes a friendlyId, a flow `type` or a response template; flow `type` (`EMBEDDED`, `INTERACTIVE_API_FLOW`) appears in responses only. `GET /api/v1/flows/by-page/{pageId}` lists per page; there is no tenant-wide listing.

**Decision-as-data** (an arbitrary JSON response) is a standalone Personalize interactive experience. Pass-through via edge-platform `/v1/personalize` is `[probe-gated: unscheduled, needs a Personalize-licensed tenant]`.

**Decision page** (embedded workaround): a hidden page whose variants' datasources carry the payload. Call `getPageFriendlyId(decisionPageId, lang, scope)`, then read `experiences[variantId]` from its Edge layout or run `personalizeLayout(layout, variantId)`. Measured (P7): Edge carries `experiences[<v>]` with the copy's full `fields` for a datasource-only COPY, and the decision depends only on friendlyId + params (URL, `siteId`, body `language` are ignored), so a call from another URL is honoured. Whether Pages accepts a hidden decision page: not run.

## `webPersonalization`

`personalizeBrowserPlugin({ options: { webPersonalization: true | { async } } })` fetches `{edgeUrl}/v1/personalize/cdn-url` and appends that script. On both embedded tenants probed (2026-10-01) the returned `…/web-flow-libs/<clientKey>/cloud-version.min.js` answered 403 (the object does not exist), and the only published loader was the legacy Engage one, which expects `window.Engage`. `defer` and `language` are accepted and ignored; there is no error handling and no re-run API. The CSP origin would be `https://d35vb5cccm4xzp.cloudfront.net`. Web experiences need standalone Personalize.
