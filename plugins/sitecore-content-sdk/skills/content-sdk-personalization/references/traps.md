# Traps

Status: **measured** (live or local production run, 2026-10-01), **code** (read from the installed SDK), **doc** (Sitecore documentation), or `[probe-gated: Pn]`.

| # | Trap | Fix | Status |
|---|---|---|---|
| 1 | `personalize.enabled` defaults to on in production: every non-skipped request pays an Edge lookup, even with no personalization | Set `enabled` explicitly; `false` without personalization | code; cost ≈ 36 ms p50 from a client (measured), Vercel figure `[probe-gated: P13]` |
| 2 | `PERSONALIZE_PROXY_EDGE_TIMEOUT` in the template example; real names are `PERSONALIZE_MIDDLEWARE_EDGE_TIMEOUT` / `_CDP_TIMEOUT`; bad values fall back to 400 silently | Use the real names | code |
| 3 | Head scope ≠ CM `PAGES_PERSONALIZE_SCOPE` → unknown friendlyId → default; changing the CM scope orphans rules | One scope value, set once | code + doc; failure: `404 No experiences found for friendlyId …` at the wire, `null` → default in the SDK (measured P7) |
| 4 | Decision fails open; one failed execution drops every execution in the request | Verify with the ladder, never by looking | code |
| 5 | Proxy sets `sc_cid` and `sc_cid_personalize` with both flags hard-coded on | `skip()` reads consent | measured (P7): with consent, both cookies on match **and** no-match (`Max-Age=63072000; Domain=<hostname>; Secure; SameSite=None`, not HttpOnly); consent denied → no `Set-Cookie`, 0 edge-platform calls |
| 6 | `BotTrackingProxy` after or missing from the chain → bots get decisions and cookies | Keep the scaffold order | code |
| 7 | Geo conditions fall back to `cf-ipCountry` / `cf-region-code`: on a server-side decision that is the hosting region | `extractGeoDataCb` from the host's geo headers | measured in condition code; value form `[probe-gated: P12]` |
| 8 | Locale-prefixed URL: the Edge lookup uses the raw pathname → route not found → default | Probe before relying on prefixed locales | code; `[probe-gated: P11]` |
| 9 | Headless browser and `curl` are bots → no decision, no beacon | Real Chrome UA plus a positive control | measured |
| 10 | Server-side SDK calls share one process-global context → another visitor's browser id goes out, accepted with 201 | `fetch` the wire contract, or serialize | measured for `event()`; `personalize()` legs `[probe-gated: P22]` |
| 11 | `personalize()` without `timeout` has no timeout; a timeout does not abort the fetch | Always pass `timeout`; use `AbortSignal.timeout` with `fetch` | code |
| 12 | Second `initContentSdk` in the browser replaces Bootstrap's plugins | Add the personalize plugin to Bootstrap | code |
| 13 | `enablePersonalizeCookie` ignored unless analytics `enableCookie` is true | Set both, behind consent | code |
| 14 | Passing `email` / `identifier` drops `browserId` → identified guest, separate session | Keep anonymous calls anonymous unless intended | code + doc |
| 15 | Self-invoked `personalize()` has no bot check | Gate on `isBot` yourself | code |
| 16 | Returned id not checked against candidates | Check it, as the proxy does | code |
| 17 | Component variant ids are not kept in the client layout; only `context.variantId` (page) | Pass them as a prop from `page.tsx` | code |
| 18 | Variants are URL-addressable via `/_variantId_<id>`; `x-sc-rewrite` exposes ids | Do not put access control in a variant; exclude `_variantId_` VIEWs from variant analytics | measured (P7): the forced URL renders the variant with no consent and no condition, from ISR even after cleanup, and its VIEW counts as a variant view |
| 19 | A cached decision serves one visitor's variant to everyone | `cache: 'no-store'`; never `'use cache'` a decision | rule |
| 20 | Vercel CDN / ISR key for rewritten requests unknown | Test two audiences on one URL on the deployed CDN | `[probe-gated: P17]` |
| 21 | `webPersonalization` script 403s on embedded tenants; `defer` / `language` ignored | Do not enable it without standalone Personalize | measured on two tenants + code |
| 22 | `www` vs apex: proxy cookie domain = hostname, Bootstrap strips `www.` → duplicate or split `sc_cid` | Redirect to one host before tracking | measured with a simulated proxy writer |
| 23 | Inline edits inside a page variant change the default page | Personalize by assigning a different datasource | doc |
| 24 | A/B tests are refused on a page with personalization; one embedded experience per page; re-running create appends | Plan per page | doc + earlier probe |
| 25 | Decision tables: no API, undocumented head-app contract, shared across page versions including live | Route to the Pages UI | doc; head behaviour `[probe-gated: P9]` |
| 26 | A new site language has no analytics identifier → no personalization in that language | Backend fix: `sitecoreai-personalization` | doc |
| 27 | Stale `__prerender_bypass` / `__next_preview_data` cookies make a live request look like preview, so personalization skips | Clear them when testing after editing | unverified (research gap) |
| 28 | Limits: 10 page variants, 5 conditions per audience; time/history conditions are not Edge-compatible, and mixing one in stops Edge execution | Design audiences within the limits | doc |
| 29 | Cold Edge lookup (first request after start or after a publish) exceeds the 400 ms edge timeout → `IE-003` → default | Warm routes after deploy/publish; consider a higher `PERSONALIZE_MIDDLEWARE_EDGE_TIMEOUT` | measured (P7): 2 cold misses + 6/95 during prefetch bursts |
| 30 | `DEBUG=content-sdk:personalize` logs the full context id on every lookup | Never enable it where logs leave your control | measured (P7) |
| 31 | With variants + marketing consent the proxy mints the guest server-side (`Set-Cookie` on the document); client `create.json` disappears and positive controls that expect it go red | Assert `create.json` OR server `Set-Cookie`, plus VIEW 201; assert no server mint without consent | measured 2026-10-07 (3 specs; no mint without consent) |
| 32 | Deployed CDN: first request after publish + redeploy serves the default; identical repeats alternate default / variant for a while | Warm, then several reads; never judge from one | measured 2026-10-07 |
| 33 | A consent grant does not reload, so the server decision never sees it until the next request | `router.refresh()` on denied → granted marketing (URL and `utm_*` kept) | measured 2026-10-07 |
