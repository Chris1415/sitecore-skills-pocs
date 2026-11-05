---
name: content-sdk-analytics-events
description: "Sends Content SDK analytics events: analytics and events plugins, pageView, event, form, identity, field limits, client vs server, bot and editing suppression. Use when adding or debugging tracking calls. Not consent or personalization."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/nextjs 2.4.x with events + analytics-core 2.1.2 and core 2.1.x, Next.js 16 (src/proxy.ts), a SitecoreAI Edge context id, and an analytics identifier on each tracked site language. BotTrackingProxy and botPageView need nextjs/events >= 2.1.0. App Router first; Pages Router deltas noted."
metadata:
  author: Christian Hahn
  version: "0.1.5"
---

# Content SDK analytics events

The Content SDK sends visitor events to SitecoreAI by calling `POST {edgeUrl}/v1/events/v1.2/events?siteId=<site>` with the `x-sitecore-contextid` header. One core singleton (`initContentSdk`) holds two plugins. `analyticsPlugin` owns the visitor id: it calls `create.json` and stores the result in the `sc_cid` cookie. `eventsPlugin` owns the five send functions. Every event function reads that singleton **at call time**, and that one fact explains most of the limits below.

## When to use

- Adding a custom event, a page view, an identity call or a form event to a head app.
- An event "does not show up", Performance → Events is empty, or you need to prove that a beacon fired.
- Deciding whether an event goes from the browser or from the server.
- Reviewing `src/Bootstrap.tsx`, `src/components/content-sdk/CdpPageView.tsx` or any call into `@sitecore-content-sdk/events`.

## When NOT to use

- **Consent.** Use `content-sdk-tracking-consent`. That skill owns the banner wiring, the gates, withdrawal and the cookie categories. This skill assumes the gate exists and never bypasses it.
- **The personalization decision** (PersonalizeProxy, variant ids, `_variantId_` rewrites). Use `content-sdk-personalization`.
- Creating flows, audiences or A/B tests in SitecoreAI. Use `sitecoreai-personalization`.

## Rule zero: every tracking call sits behind the consent gate

The SDK has **no consent API**. A call you add here is consent-safe only if it can run when the visitor has consented and cannot run when they have not. In practice, every helper in this skill goes through the gate that `content-sdk-tracking-consent` defines. That covers Bootstrap's init, `CdpPageView`, your custom helpers, `<Form>` and `PersonalizeProxy.skip`. Do not add a second, local consent check, and do not call `initContentSdk` from anywhere except the place that skill defines.

## 1. Initialization: what the scaffold ships

| Piece | Where (App Router) | What it does |
|---|---|---|
| `Bootstrap` (client) | `src/app/[site]/layout.tsx`, first child before `{children}` | `initContentSdk({config:{contextId: clientContextId, edgeUrl, siteName}, plugins:[analyticsPlugin({options:{enableCookie:true, cookieDomain: hostname without www.}, adapter: analyticsBrowserAdapter()}), eventsPlugin()]})`. Skips `NODE_ENV=development` and draftMode |
| `CdpPageView` (client) | rendered by `Layout` through `Scripts` | `pageView({channel, currency, page, pageVariantId, language})` once per route, only when `mode.isNormal` |
| `BotTrackingProxy` | `src/proxy.ts`, second, after preview | Bot UA → `sc_bot=1` cookie plus a server `botPageView` in `waitUntil` |

- **Plugin order matters.** Plugins initialize in array order, and a missing dependency throws IE-001. Keep `analyticsPlugin` before `eventsPlugin`.
- **Context ids.** The browser uses `config.api.edge.clientContextId`, which defaults to `NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID` and is inlined into the public bundle. The server uses `config.api.edge.contextId` (`SITECORE_EDGE_CONTEXT_ID`). `defineConfig` has **no** analytics or events keys; everything is set through plugin options.
- **A 201 does not prove which context you are on.** A preview context id also gets 201. Read the live value from `window.scContentSDK.analytics_core.options.contextId` and compare it with the context you expect.
- **Ordering holds by tree position only.** Bootstrap's effect commits before the page's effects because Bootstrap renders first. Anything that delays or skips that init (a conditional render, a Suspense boundary, consent granted later) makes every later event reject with `[IE-002] SDK not initialized`, and the scaffold's `.catch(console.debug)` swallows it. Bootstrap's effect depends only on `[siteName, isPreviewMode]`, so it does not re-run on soft navigation. The cache-components template wraps Bootstrap in `<Suspense>`; whether the ordering still holds there is **[probe-gated: P6, cache-components leg not yet run]**.
- **Pages Router delta.** Bootstrap mounts in `src/pages/_app.tsx`, and the proxy chain has no `LocaleProxy`. Otherwise the same rules apply.

## 2. Pick the event

| Event | API (`@sitecore-content-sdk/events`) | Wire `type` | Send from | Use it for |
|---|---|---|---|---|
| Page view | `pageView(data?: PageViewData)` | `VIEW` (the dashboard shows it as **"pageView"**) | Client, through the scaffold's `CdpPageView` only | Every normal page render. `pageVariantId` ties the view to a personalization or A/B variant |
| Custom | `event(data: EventData)` | your `type` string | Client by default | Interactions and conversions |
| Form | `form(formId, 'VIEWED' \| 'SUBMITTED', componentInstanceId)` | `FORM` | Client, **automatic** through the SDK `<Form>` component | Sitecore Forms. Never hand-wire it |
| Identity | `identity(data: IdentityData)` | `IDENTITY` | Client today. Server-side is **[probe-gated: P14]** | Login or a known-visitor form submit. It is the input to identity resolution, which is off until an org identity rule exists |
| Bot view | `botPageView({page, language, userAgent})` | `VIEW`, `channel:'bot'` | Server, inside `BotTrackingProxy` only | Crawler traffic. Never call it yourself |

Field limits are enforced client-side, and a violation **throws** (the promise rejects) rather than being swallowed:
- `extensionData`: at most **50** attributes after flattening (IV-006). It applies to `pageView`, `event` and `identity`.
- `identity`: `identifiers: [{id, provider}]` is **required** (MV-003). `dob` is **date-only `YYYY-MM-DD`** (IV-003) from events 2.1.2 on. `identifier.expiryDate` must be a full ISO date-time (IV-005). `email` is validated (IV-004). The `beta.atoms` builds predate 2.1.2 and reject a date-only `dob`.
- `pageView` reads the referrer only on the **first** view per page load (`static isFirstPageView`). `includeUTMParameters` defaults to `true`.
- Set `currency` from the site's real currency. The scaffold hard-codes `'USD'`.

Minimal calls, with full typed signatures in `references/api-surface.md`:

```ts
await event({ type: 'ACME_NEWSLETTER_SIGNUP', channel: 'WEB', page: route.name, language, extensionData: { list: 'weekly' } });
await identity({ identifiers: [{ id: crmId, provider: 'acme-crm' }], email, dob: '1990-04-15', channel: 'WEB' });
// pageView and form: leave them to CdpPageView and <Form>
```

## 3. The client-side custom event helper (the default path)

Put one helper in `src/lib/tracking.ts` and make every component call it. Never call `event()` directly from a component.

```ts
'use client';
import { event, type EventData } from '@sitecore-content-sdk/events';
import { getClientId } from '@sitecore-content-sdk/analytics-core';

const SITE_PREFIX = 'ACME'; // one per site; see § 5

export async function track(action: string, extensionData?: EventData['extensionData'], page?: string) {
  try {
    getClientId(); // throws IE-002 when Bootstrap did not init: dev, editing/preview, no consent
  } catch {
    return null;
  }
  if (document.cookie.split('; ').some((c) => c.startsWith('sc_bot='))) return null; // event() does not skip bots
  return event({
    type: `${SITE_PREFIX}_${action}`,
    channel: 'WEB',
    page,
    language: document.documentElement.lang || undefined,
    extensionData,
  }).catch((e) => { console.debug('[track]', e); return null; }); // validation errors reject
}
```

Why each guard exists:
- **IE-002 guard.** If init never ran, `event()` rejects. The `getClientId()` probe turns "no init" (dev, draftMode, no consent) into a silent no-op, so the helper inherits the suppression that Bootstrap and the consent gate already apply.
- **Bot guard.** `pageView` skips bots, but `event()` and `identity()` do not. A bot has no `sc_cid`, so the event goes out with `browser_id: ""` and is rejected (404 or 400 observed), swallowed as `null`. `sc_bot` is set server-side and is readable from JS.
- **Editing.** Bootstrap does not init in draftMode, so the IE-002 guard covers Pages editing and preview. In a component, also check `useSitecore().page.mode.isNormal` before calling, as `CdpPageView` does.
- **Exit clicks.** `sendEvent` uses `fetch` with no `keepalive`, so an event fired on a click that navigates to **another site** is lost: measured 2026-10-05 on a production build (real Chrome UA), the POST stayed `pending` when the cross-origin navigation replaced the page. A same-origin hard navigation (a plain `<a>` to the same site) is safe: the event and the next page's VIEW both returned 201. For outbound links either accept the undercount and document it, delay-then-navigate (await `trackEvent` with a ~300 ms timeout, then `location.assign`), or queue via `@sitecore-content-sdk/events/browser` and flush on the visitor's next page (only if they return). A redirecting form submit is unmeasured **[probe-gated: P16]**.
- **The `./browser` queue.** `addToEventQueue` / `processEventQueue` from `@sitecore-content-sdk/events/browser` batch events in sessionStorage across navigations. They still await init, so they are not a way to buffer events before init.
- **BYOC.** The scaffold's `src/byoc/index.tsx` passes the whole events module to BYOC components (`FEAAS.setContextProperties({ eventsSDK: Events })`). A BYOC component's `eventsSDK.event(...)` uses the same singleton and the same rules. Route it through the same naming convention, and make the BYOC author aware of the consent gate.

## 4. Server-side events: only with the carrier pattern, and not under concurrency

**Decision rule: send from the client by default.** Use a server event only when the action exists only on the server (a webhook or a server-validated conversion), and only if all of the following hold:

1. **It runs in a Route Handler, with the carrier pattern.** Give `analyticsProxyAdapter(req, carrier)` a `new NextResponse(null)` as the carrier, then copy `carrier.cookies.getAll()` onto the response you return. `return NextResponse.next()` from a Route Handler is **HTTP 500** ("not supported"). Without the cookie copy, a fresh visitor's `sc_cid` is lost. RSC cannot set cookies at all. The full code is in `references/server-events.md`.
2. **Pass `page`, `language` and `referrer` explicitly.** Server-side they default to an empty string or null.
3. **Bot UAs fail silently.** The adapter skips `create.json` for bots, so the event goes out with `browser_id: ""`, gets a **400**, and `event()` resolves `null` without throwing.
4. **No concurrency. This is a live limitation (T15).** `initContentSdk` overwrites a process-global singleton, and `event()` reads it at call time. In a measured run, 50 parallel requests with 0–200 ms jitter sent **49 of 50 events under another visitor's `browser_id`**, and edge-platform answered **201 to all 50**. Without jitter it was 24 of 50. `Set-Cookie` stayed correct per request, so nothing in the response reveals the mis-attribution. Until Sitecore fixes the singleton, a per-request `initContentSdk` on the server is safe only when calls are serialized per process. The escape hatch is a direct POST with the request's own `sc_cid` and no SDK state (`references/server-events.md`). The same singleton runs inside `PersonalizeProxy` and `BotTrackingProxy`; whether the proxy path cross-contaminates is **[probe-gated: P22]**.
5. **Geo.** A server event comes from the server's IP. Whether the endpoint accepts a geo or IP override is **[probe-gated: P12]**.

Pages Router: `analyticsServerAdapter(req, res)` takes Node `IncomingMessage` / `OutgoingMessage` and has the same singleton problem. Its API-route behaviour has not been probed. Treat it as **[probe-gated: not yet in the probe plan]**.

## 5. Name custom events: the endpoint validates nothing

The ingress accepts **any** `type` string with 201. That includes typos, lowercase strings and the legacy reserved `SC_` prefix. The Performance → Events dashboard lists custom events **by their exact `type`**, next to `pageView`. Naming discipline is therefore the only control.

- **Prefix with the site:** `<SITE>_<OBJECT>_<ACTION>`, upper snake case, for example `ACME_NEWSLETTER_SIGNUP` or `ACME_PDP_ADD_TO_CART`. The SDK's own JSDoc suggests `site:ACTION`. Pick one form per estate and never mix them.
- **Never reuse reserved or standard names:** `VIEW`, `IDENTITY`, `FORM`, the legacy CDP names `ADD`, `SEARCH`, `TRACKING`, `INTERACTION`, anything starting `SC_` (`SC_SEARCH_WIDGET_VIEW` / `_CLICK` belong to Sitecore Search), and the display label `pageView`. Ingress does not reject them. How the dashboard and Profiles treat them downstream is **[probe-gated: P10]**.
- **Integrated search has its own event:** `type: 'search'` with `core: { componentId, componentInstanceId, interactionType, keyword, nullResults }` feeds the search dashboard (`content-sdk-search`). It is distinct from standalone Search's `SC_SEARCH_WIDGET_*` and from the reserved uppercase legacy `SEARCH`. Case sensitivity **[probe-gated: P7]**.
- **Keep `type` stable.** The dashboard groups by the string, so a rename starts a new row. Put variable data in `extensionData`, never in `type`.
- **Tag synthetic traffic.** Probes and tests use a `<SITE>_PROBE_*` type or `extensionData.probe_tag`, so they can be filtered out of live dashboards.

## 6. Suppression: who sends nothing, and why

| Context | Bootstrap init | `CdpPageView` | Custom helper (§ 3) | `<Form>` | `BotTrackingProxy` |
|---|---|---|---|---|---|
| `next dev` | off | off | no-op (IE-002) | fires, unhandled IE-002 **[probe-gated: P16]** | off |
| Pages editing / preview (draftMode) | off | off (`!mode.isNormal`) | no-op | off in editing | skips preview |
| Bot UA (`isbot`) | inits, but no `sc_cid` | skipped ("visitor is a bot") | no-op (`sc_bot`) | skipped | sets `sc_bot`, sends `botPageView` |
| **Headless browser** (Playwright default, `HeadlessChrome`, curl) | **treated as a bot** | skipped | no-op | skipped | `sc_bot` (not on localhost) |
| `localhost` production build | on | on | on | on | **skipped**, unless `SITECORE_ENABLE_BOT_TRACKING=true` |
| No consent | off (via the consent skill) | off | no-op | see the consent skill | unaffected (sets only `sc_bot`) |

The editing host is a production build. Whether it leaks events on direct, non-preview hits is **[probe-gated: P21]**.

## 7. Verify that an event really fired

Errors are swallowed, and there is no timeout. `sendEvent` catches every transport failure and resolves `null`, so a console with no output proves nothing.

1. **Use a production build against the LIVE context** (`next build && next start`, or the deployment). Dev and preview send nothing.
2. **Pin a real Chrome UA** in any automated browser, for example `…Chrome/141.0.0.0 Safari/537.36`. A default headless UA is a bot, and every "0 events" assertion run with one passes even when tracking is broken.
3. **Assert the positive control first:** `GET …/browser/create.json` returns **201** and `sc_cid` is set. Only then trust a count.
4. **Assert the beacon:** `POST …/v1/events/v1.2/events` returns **201** `{"status":"OK","ref":…}`, and the request body `type` is your name.
5. **Read a failure from its body.** A 404 is either `No sitecore context` (wrong or missing context id) or `Invalid browser id/ref specified` (missing or unknown `sc_cid`). `siteId` is **not** validated: a bogus site also gets 201, so it is not a negative control. Use a bogus context id instead.
6. **Check the server side.** Run with `DEBUG=content-sdk:events` (or the fetch tap in `references/testing.md`); the events log includes the response status.
7. **Check ingestion.** In SitecoreAI, open **Performance → Events**. Custom events are listed by `type`, with event and session counts, next to `pageView`. Ingestion latency, and whether IDENTITY and FORM show up there and in Profiles, are **[probe-gated: P10]**.
8. **Check the site has an analytics identifier** for the language you track. A 201 proves the call was accepted, not that it is attributed (step 5: `siteId` is not validated). Sitecore's site analytics need one identifier per site language, and a site created by serialization push or a newly added language has none (`sitecoreai-sites` § Pitfalls). Whether events sent without one are kept, dropped, or attributed later is **[probe-gated]**.

Recipes, Playwright code and controls: `references/testing.md`. Wire shapes and the 404/400 table: `references/wire-format.md`.

## Hard rules

- Every call goes through the consent gate in `content-sdk-tracking-consent`. Never add an ungated `initContentSdk` or a direct `event()` call.
- Send from the client by default. Server events use the carrier pattern, never `NextResponse.next()`, and are never concurrent until T15 is fixed.
- Leave page views to `CdpPageView`, form events to `<Form>` and bot views to `BotTrackingProxy`. Do not double-send them.
- Validate locally what the SDK validates: 50 `ext` attributes, `identifiers` present, date-only `dob`.
- Never treat console silence, a rendered page or a headless "zero" as proof. Proof is a 201 on the wire, plus the dashboard row.

## Stop conditions

- Stop if a change would initialize the SDK, set `sc_cid` or send any event without going through the consent gate.
- Stop if asked to send server-side events from a concurrent context (Route Handler under load, RSC, proxy) without serialization or the direct-POST escape hatch. Cite T15.
- Stop if `identity()` would carry restricted data (health, payment, government ids). SitecoreAI forbids it, and deletion needs a support case.
- Stop if an e2e check of tracking runs with a headless UA and no positive control.

## References

- `references/api-surface.md`: exports, typed signatures, `.d.ts` paths, error codes.
- `references/wire-format.md`: `create.json`, the events request and response, the 404/400 classes, the cookies tracking sets.
- `references/server-events.md`: the carrier-pattern Route Handler, the direct-POST escape hatch, the T15 evidence.
- `references/testing.md`: Playwright UA pinning, network assertions, controls, the concurrency check.
- Related skills: `content-sdk-tracking-consent`, `content-sdk-personalization`, `content-sdk-app-router-multisite-management` (proxy chain order).
- [Content SDK 2.0: tracking, events and personalization](https://doc.sitecore.com/sai/en/developers/content-sdk/20/initializing-tracking-events-and-personalization-in-the-content-sdk.html).
