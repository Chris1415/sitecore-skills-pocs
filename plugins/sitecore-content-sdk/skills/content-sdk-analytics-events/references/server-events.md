# Server-side events (App Router Route Handler)

Status: **verified working (201)** in a local production build (Next 16.3.5, nextjs 2.4.0, events 2.1.2), with three conditions:
- use a carrier response and copy its cookies;
- bot UAs fail silently;
- **it is not safe under concurrency (T15).**

The decision rule is in SKILL.md § 4. This file holds the code and the evidence.

## 1. Carrier-pattern Route Handler (serialized use only)

```ts
// src/app/api/track/route.ts. Server-only conversions. Behind the consent gate (content-sdk-tracking-consent).
import { NextRequest, NextResponse } from 'next/server';
import { initContentSdk, analyticsProxyAdapter } from '@sitecore-content-sdk/nextjs';
import { analyticsPlugin } from '@sitecore-content-sdk/analytics-core';
import { eventsPlugin, event } from '@sitecore-content-sdk/events';
import scConfig from 'sitecore.config';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const carrier = new NextResponse(null);          // NOT NextResponse.next(): HTTP 500 in a Route Handler
  const edge = scConfig.api.edge!;
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(':')[0];

  await initContentSdk({                            // overwrites a PROCESS-GLOBAL singleton (T15)
    config: { contextId: edge.contextId, edgeUrl: edge.edgeUrl, siteName: scConfig.defaultSite },
    plugins: [
      analyticsPlugin({
        options: { enableCookie: true, cookieDomain: host.replace(/^www\./, '') },
        adapter: analyticsProxyAdapter(req, carrier),
      }),
      eventsPlugin(),
    ],
  });

  const result = await event({
    type: 'ACME_ORDER_CONFIRMED',
    channel: 'WEB',
    page: '/checkout/confirmation',                 // server defaults are '' — pass explicitly
    language: 'en',
    currency: 'EUR',
    extensionData: { orderValueBand: 'M' },
  });                                               // null = rejected or failed; check DEBUG=content-sdk:events

  const out = NextResponse.json({ ok: result !== null });
  for (const c of carrier.cookies.getAll()) out.cookies.set(c); // without this a fresh visitor's sc_cid is lost
  return out;
}
```

Types: `analyticsProxyAdapter(request: NextRequest, response: NextResponse)`, from `nextjs/types/initialization/proxy/analytics-adapter.d.ts:22`. `initContentSdk(params): Promise<void>`, from `core/types/initialization/init-content-sdk.d.ts:14`. `event(eventData: EventData)`, from `events/types/src/events/custom-event/event.d.ts:9`.

Notes:
- `cookieDomain` above strips `www.`, matching Bootstrap. `PersonalizeProxy` uses the raw host and has no hook to change it. Redirect `www` to apex (or the reverse) at the edge **before** any tracking, or one visitor becomes two.
- When the request has no `sc_cid`, the adapter calls `create.json` and mints a new guest. That only makes sense for a real visitor who has given consent.
- **Bot UA:** `setClientId` is skipped, the event goes out with `browser_id: ""`, the endpoint returns 400 `Invalid UUID string`, and `event()` resolves `null` without throwing.
- **RSC cannot set cookies.** Never run this from a Server Component. At best it could reuse an existing `sc_cid`, and it would still hit T15.
- Pushing the send off the critical path with `after()` / `waitUntil` is not probed.

## 2. T15: cross-visitor attribution under concurrency (live limitation)

**Mechanism.** `initContentSdk` assigns a module-level `let coreContext` (`core/dist/esm/initialization/init-content-sdk.js:4,27`). `event()` resolves `getAnalyticsPlugin()` and `adapter.getClientId()` **at call time** (`events/dist/esm/src/events/custom-event/event.js`). Whichever request initialized last therefore owns every in-flight event.

**Measured (50 parallel requests: 25 with their own `sc_cid`, 25 fresh):**

| Run | Events with their own `browser_id` | Distinct ids sent | edge-platform status | `Set-Cookie` correct |
|---|---|---|---|---|
| Serial control, n=1 | 1/1 | 1 | 201 | 1/1 |
| n=50, no jitter | 26/50 | 26 | 201 ×50 | 50/50 |
| n=50, 0–200 ms jitter after init | **1/50** | **1** | 201 ×50 | 50/50 |

The cookies are right and the payload is wrong. No status code, header or log line reveals it. A test that checks only `Set-Cookie` passes while the data is corrupt. **Assert the outbound `browser_id`.**

Whether `PersonalizeProxy` / `BotTrackingProxy` (which also call `initContentSdk`) share the module instance with Route Handlers in the Next 16 proxy bundle is [probe-gated: P22].

## 3. Escape hatch: direct POST with the request's own id (no SDK state)

When server events must run concurrently, skip the SDK singleton and POST the documented wire shape yourself. Use it only for visitors who already have an `sc_cid`, and never mint one here.

```ts
// src/lib/server-track.ts. Stateless: safe to call concurrently. Bypasses SDK validation, so validate yourself.
import 'server-only';
import type { NextRequest } from 'next/server';
import scConfig from 'sitecore.config';

export async function serverTrack(req: NextRequest, type: string, ext: Record<string, string | number | boolean>, page: string, language: string) {
  const browserId = req.cookies.get('sc_cid')?.value;
  if (!browserId) return null;                                  // no visitor id: do not mint server-side
  if (Object.keys(ext).length > 50) throw new Error('max 50 ext attributes');
  const edge = scConfig.api.edge!;
  const base = edge.edgeUrl || 'https://edge-platform.sitecorecloud.io';
  const res = await fetch(`${base}/v1/events/v1.2/events?siteId=${encodeURIComponent(scConfig.defaultSite)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sitecore-contextid': edge.contextId },
    body: JSON.stringify({
      browser_id: browserId, client_key: '', pos: '', channel: 'WEB', type, page, language,
      requested_at: new Date().toISOString(), ext,
    }),
    signal: AbortSignal.timeout(2000),                          // the SDK has no timeout; you should
  });
  return res.status;                                            // 201 expected; read the body on 4xx
}
```

Evidence level: the request shape matches the captured SDK request, and hand-built replays of it got **201** (wire-format.md § 2). A load test of this helper has not been run [probe-gated: P22]. It is concurrency-safe by construction, because it shares no module state. The `encodeURIComponent` on `siteId` deliberately differs from the SDK, which does not encode it. `siteId` is not validated at ingress either way.

## 4. Identity server-side

Sending `identity()` from the browser exposes PII in the network panel. Whether a server-side IDENTITY that reuses the visitor's `sc_cid` lands on the same guest is [probe-gated: P14]. Until then, send IDENTITY from the client after login, through the gated helper.
