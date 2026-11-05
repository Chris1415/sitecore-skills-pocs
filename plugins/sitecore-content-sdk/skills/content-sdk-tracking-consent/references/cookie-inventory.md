# Cookie inventory: Content SDK head app (App Router)

Measured 2026-10-01 on four live head apps and a local production build (`@sitecore-content-sdk/nextjs` 2.4.0, `analytics-core` / `events` 2.1.2, `personalize` 2.1.0, Next.js 16). Every row was taken from a fresh browser context with a **real Chrome UA**. Rows marked *source* come from the SDK `dist` code and were not seen on the wire.

## Cookies, attributes and consent category

| Cookie | Set by | Domain | SameSite | Secure | HttpOnly | Lifetime | Category | Gate |
|---|---|---|---|---|---|---|---|---|
| `site_consent` (this skill) | app JS (`saveConsent`) | apex (`www.` stripped) | Lax | yes | no (the client reads it) | 180 d in the template, a legal decision | necessary | n/a: it stores the decision |
| `sc_site` | server: `AppRouterMultisiteProxy`, on every HTML and RSC response | host-only | None | yes | yes | session | necessary (site resolution) | none, and none is needed. Exclude it from any "zero `sc_*`" assertion |
| `sc_bot` | server: `BotTrackingProxy`, **bot UAs only** (also on static `public/` files) | host-only | Lax | yes | no | session | necessary (bot exclusion) | none. Humans never get it. Not set on `Host: localhost` unless `SITECORE_ENABLE_BOT_TRACKING=true` |
| `sc_cid` | JS: Bootstrap → `analyticsPlugin` (`enableCookie: true`). Value = `create.json` `ref` | `.<hostname minus www>` (domain cookie) | None | yes | **no** (JS can delete it) | **730 d** on the wire (Max-Age 63 072 000); Chromium caps the stored cookie at **400 d** | analytics | Bootstrap gate. **Proxy issuance on personalized routes: marketing gate** (see below) |
| `sc_cid` (proxy writer) | server: `PersonalizeProxy` → `initPersonalizeServer`, hard-coded `enableCookie: true`, `cookieDomain: hostname` (www **not** stripped) | `Domain=<full request hostname>` (wire, P7) | None | yes | **no** | 730 d on the wire (Max-Age 63 072 000; Chromium stores 400 d) | marketing (implies analytics) | `PersonalizeProxy.skip`. **Measured (P7):** set on every non-skipped request to a personalized route, on match and no-match; with consent denied, no `Set-Cookie` |
| `sc_cid_personalize` | server: proxy (`enablePersonalizeCookie: true`, hard-coded). Browser plugin only when the app adds one | as above (wire, P7) | None | yes | **no** | 730 d on the wire (400 d stored) | marketing | `PersonalizeProxy.skip`. **Measured (P7):** issued together with the proxy `sc_cid`; absent when consent is denied |
| legacy `sc_<contextId>`, `sc_<contextId>_personalize` | older SDKs. analytics-core migrates them to `sc_cid` | varies | | | | | analytics / marketing | deleted on withdrawal by `clearCookies(…, contextId)` |
| `__cf_bm` | **third party**: Cloudflare bot management on `*.sitecorecloud.io` responses (Edge media CDN images, edge-platform) | `.sitecorecloud.io` | None | yes | yes | 30 min | necessary-for-delivery (third party) | **none: no SDK lever reaches it.** It is set with or without consent. List it in the cookie policy |
| `bx_bucket_number` | not set | | | | | | | absent from SDK 2.1.2 source and from the wire without `webPersonalization`. Its status with `webPersonalization` is unverified |

## App-owned storage (functional)

These are not SDK cookies. Each app gates its own writes with `hasConsentClient('functional')` (store code) or `useAllows('functional')` (components). Withdrawing functional does not delete what was already stored: remove the app's own keys in `saveConsent` if the policy requires it.
- theme preference in `localStorage` (see `content-sdk-app-router-theme-hydration-pattern`). Without functional consent, keep it in memory for the session;
- any locale-preference cookie the app itself writes.

## Withdrawal delete list

The SDK has no delete or de-init API. On every save without analytics consent (not only a withdrawal), `clearCookies` deletes `sc_cid` and `sc_cid_personalize` (plus the legacy names) for **every domain variant** with `Max-Age=0; Path=/; Secure; SameSite=None`:

| Variant | Why it can exist |
|---|---|
| host-only | defensive |
| `<apex>` | Bootstrap writes `cookieDomain = hostname.replace(/^www\./,'')` |
| `www.<apex>` | the proxy writer uses the full host. Measured: on `www`, Bootstrap-then-server left **two** `sc_cid` (apex + www, same value) |
| `<hostname>` | a sub-domain other than www |

Withdrawing only marketing deletes `sc_cid_personalize` and keeps `sc_cid`.

**Out of reach:** `__cf_bm` (third party), `sc_site` (HttpOnly, necessary), and the guest record that `create.json` already created at Sitecore. Erasing that record needs a support case, because no self-serve API exists.

## www vs apex

Redirect one to the other at the edge **before** any tracking. When both serve, the proxy writer and Bootstrap scope `sc_cid` differently: you get duplicate cookies, or a visitor split between hosts. `initPersonalizeServer` has no config hook for the cookie domain.
