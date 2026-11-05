---
name: content-sdk-tracking-consent
description: "Consent-gated tracking for a Content SDK App Router app: authorable banner, consent categories mapped to SDK switches, gated tracking, cookie wipe on withdrawal. Use when shipping a head app or touching tracking. Not third-party CMPs."
license: Apache-2.0
compatibility: "@sitecore-content-sdk/nextjs 2.4.0, analytics-core + events 2.1.2, personalize 2.1.0, Next.js 16 (src/proxy.ts), React 18+ (useSyncExternalStore). App Router template; Pages Router uses the same gates at different mount points."
metadata:
  author: Christian Hahn
  version: "0.1.8"
---

# Content SDK: Tracking Consent

A stock Content SDK head app tracks from the first paint. Measured on four live apps (2026-10-01): `create.json` mints a guest at Sitecore, `sc_cid` (Max-Age 730 days, capped to 400 by Chromium) is set by JS, and a VIEW is posted, all before any interaction, with no banner. The SDK has **no consent API**. Consent is built from the levers it does expose, and this skill wires them end to end:

- **No consent** → no tracking cookie, no edge-platform beacon, no proxy decision (default variant).
- **Consent** → tracking, plus personalization if marketing is granted.
- **Withdrawal** → tracking stops and the tracking cookies are deleted.

**Every head app ships this.** Consent is a standard acceptance criterion, not an option.

## When to use

- Scaffolding or shipping any Content SDK head app.
- Touching `src/Bootstrap.tsx`, `CdpPageView.tsx`, the `PersonalizeProxy` in `src/proxy.ts`, or any `event()` / `identity()` call.
- Writing the cookie policy, or a test that asserts "no tracking before consent".

Not for: a third-party CMP adapter (the decision is an own first-party banner only), or the personalization decision itself.

## Category → SDK switch

| Category | What it switches | Lever |
|---|---|---|
| **necessary** (always on) | `site_consent` (this skill), `sc_site` (multisite routing), `sc_bot` (bot UAs only) | none: these never carry a visitor identifier |
| **functional** | app-owned preferences: theme in `localStorage`, a locale preference the app persists | `hasConsentClient('functional')` around each write in store code (theme stores are plain functions, not hooks); `useAllows('functional')` in a component |
| **analytics** | Bootstrap `initContentSdk` (analytics + events plugins → `create.json`, `sc_cid`), `CdpPageView` VIEWs, custom events, `<Form>` events | gate 1 (Bootstrap), gate 2 (CdpPageView + `trackEvent`) |
| **marketing** | `PersonalizeProxy` decision (Edge `variantIds` lookup + `/v1/personalize`), proxy-issued `sc_cid` + `sc_cid_personalize`, `identity()` | gate 3 (`PersonalizeProxy.skip`), `trackIdentity` |

**Marketing requires analytics.** `initPersonalizeServer` hard-codes `enableCookie: true` and `enablePersonalizeCookie: true`. Every personalized decision therefore sets `sc_cid`, the visitor's browser id (not the site's analytics identifier). "Marketing without analytics" cannot be honored, so `normalize()` makes `marketing ⇒ analytics` on parse (fail closed), and the banner toggles the pair together.

## Consent state contract

One first-party cookie, `site_consent`, readable by **both** the proxy (`req.cookies`) and the client (`document.cookie`). A consent signal kept only in JS never reaches the proxy. The format is URL-encoded JSON:

```json
{ "v": 1, "pv": "2026-10", "c": { "functional": false, "analytics": true, "marketing": false }, "t": 1759312345000 }
```

- `v` is the code-level `CONSENT_SCHEMA`. Bump it when the **category set** changes. An old `v` reads as no consent everywhere, the proxy included.
- `pv` is the authored `PolicyVersion` the visitor answered. A mismatch re-prompts on the client; the previous choices hold until the visitor answers.
- `t` is the decision time, kept for the audit trail.
- Attributes: `Path=/; SameSite=Lax; Secure; Domain=<hostname minus www>` (the same rule Bootstrap uses for `sc_cid`), so www and apex share one decision. Not HttpOnly.

Template: `assets/lib/consent/consent.ts`. It is runtime-agnostic, so the proxy, server code and the browser all import it. Client store: `assets/lib/consent/consent-store.ts`. It uses `useSyncExternalStore` over the raw cookie string (a stable primitive snapshot), and the server snapshot is `''` (no decision). This is the same hydration-safe shape as `content-sdk-app-router-theme-hydration-pattern`. Place both under `src/lib/consent/`, **never** `src/components/`, which registers everything as a rendering.

## The four implementation points

### 1. Bootstrap: gated init, re-init on grant (`assets/sdk/Bootstrap.tsx`)

- **Gate `initContentSdk`, not only the page view.** Gating `CdpPageView` alone still runs `create.json` and sets `sc_cid`. A shipped "scope gate" did exactly that: a guest and a 730-day cookie per visitor, with zero views.
- Add `analytics` (from `useAllows`) to the effect deps. The scaffold effect depends only on `[siteName, isPreviewMode]`. With a plain gate, a mid-session grant left tracking dead until a hard reload: every soft navigation rejected with `[IE-002] SDK not initialized`, `CdpPageView`'s `.catch` swallowed it, and no VIEW was sent (state D, measured). The dep is load-bearing for state B too: during hydration `useSyncExternalStore` returns the server snapshot (`''`, no consent), so the first effect pass always skips and the init happens on the post-hydration re-render. A `not initialized: no analytics consent` debug line on every cold load, consented or not, is expected.
- Ordering holds by tree position. `<Bootstrap/>` is the first sibling in `src/app/[site]/layout.tsx`, and `initContentSdk` assigns the core context synchronously before its first await. On grant, Bootstrap's effect runs before CdpPageView's effect in the same commit. Keep Bootstrap there, and never under a Suspense boundary.

### 2. CdpPageView + event helpers (`assets/sdk/CdpPageView.tsx`, `assets/lib/consent/track.ts`)

- `disabled()` returns `NODE_ENV === 'development' || !analytics`, and `analytics` is in the deps, so a grant sends the **current** page's VIEW.
- All app code sends custom events through `trackEvent` (analytics) and identity through `trackIdentity` (marketing, because IDENTITY carries PII). Never import `event()` / `identity()` directly in a component.
- That includes the integrated-search starter's `event()` call (`search-experience/search-components/useEvent.tsx`, `content-sdk-search`). With consent denied: no event and `sessionId: ''`; the search itself keeps working.
- `<Form>` (SDK) subscribes to submit and calls `form()` with no consent check and no `.catch`. Without init it raises an unhandled IE-002 and sends nothing; with consent it tracks. The wire behaviour is unmeasured: P7 had no Form component in the test app **[probe-gated: P16]**.

### 3. `PersonalizeProxy.skip` reads the cookie (`assets/sdk/proxy.personalize-skip.ts`)

```ts
skip: (req) => !allows(parseConsent(req.cookies.get(CONSENT_COOKIE)?.value), 'marketing'),
```

`skip` runs in `disabled()` **before** `initPersonalizeServer` and before the Edge `variantIds` lookup. A non-consented request therefore gets the default variant, no proxy cookies, and no Edge call (measured: `skipped (personalize proxy is disabled)` on every request). `skip` and `enabled` are the only consent-capable controls: the proxy's cookie flags are hard-coded. Leave `BotTrackingProxy` ungated, because it acts only on bot UAs.

### 4. Withdrawal clears the cookies (`clearCookies` / `saveConsent` in the store)

- The SDK never deletes `sc_cid`. Measured: after withdrawal it survived soft navigations and a hard reload, with its full Max-Age (730 d on the wire, 400 d in Chromium's jar). It also outlives the 180-day `site_consent`.
- On every save **without** analytics (not only on a granted → denied transition), delete `sc_cid` + `sc_cid_personalize` (and the legacy `sc_<contextId>[_personalize]`) for host-only, apex, `www.<apex>` and the full host. Both cookies are JS-set or non-HttpOnly. On `www`, Bootstrap and a proxy-style writer produced **two** `sc_cid` (apex + www), so a single-domain delete misses one. A transition-only delete misses the visitor whose consent cookie expired, or whose old-schema cookie now parses as null, while `sc_cid` lives on (measured: it survived Reject all).
- On a granted → denied transition, then **reload**. The core exposes only `initContentSdk`, with no teardown: an initialized context stays live for `<Form>` and for the Events module the BYOC bridge hands to components. After the reload, Bootstrap stays gated.
- Withdrawing marketing only: delete `sc_cid_personalize`, keep `sc_cid`, no reload. The proxy gate applies on the next request.
- Out of reach: the guest already created at Sitecore (erasure goes through a support case), `__cf_bm`, `sc_site`.

## The banner (`assets/consent-banner/ConsentBanner.tsx`)

**A Sitecore rendering with one shared datasource, not dictionary entries.** Every authored value must arrive on `fields`, rendered through SDK field components. Dictionary phrases arrive as plain strings, which an author cannot select in Pages. Full content model, placement and comparison: `references/banner-content-model.md`.

- **Fields:** Title, Body (Rich Text), PolicyLink, a label and a description for each of the four categories, Accept / Reject / Customize / Save labels, ReopenLabel, and PolicyVersion (shared, not per language).
- **Tenant items:** clone the JSS Promo bundle (`content-sdk-create-component`) into `Consent Banner`, `Folders/Consent Banner Folder`, `Rendering Parameters/ConsentBanner Parameters` and the rendering `ConsentBanner`, plus a `Data/Consent Banner` container holding the one shared item. Names, field sources, the `__Standard Values` the clone lacks, the "Promo" display-name trap and the MCP placement recipe: `references/banner-content-model.md` § "Building it on the tenant".
- **Placement:** once, in the footer Partial Design. It renders the "Cookie settings" reopen trigger in place and portals the dialog to `document.body`.
- **Default: necessary-only.** Nothing is pre-ticked. Reject all is one click, with the same element and style as Accept all.
- **Accessible:** `role="dialog"` with `aria-modal="false"` on first visit (no trap), labelled by Title and described by Body. Native checkboxes in a `fieldset`. On reopen, focus goes to the heading, `Escape` closes, and focus returns to the trigger.
- **Versioning:** bump `PolicyVersion` to re-prompt. Bump `CONSENT_SCHEMA` (code) when categories change.
- **Hydration:** the dialog renders only after hydration (a `useSyncExternalStore` hydrated flag). A cached page never ships a server-rendered banner to a visitor who already decided.

## Editing and preview

- **Pages editing and Design Library:** no overlay, no store and no cookie write. The rendering shows a static inline panel with **every** field, including PolicyVersion, so all of it stays authorable.
- **No datasource:** the placement arrives with `fields` **absent**. The asset is wrapped in the SDK's `withDatasourceCheck`, so editing shows a visible "choose its datasource" placeholder instead of nothing, and normal mode renders nothing. Never ship a bare `if (!fields) return null`.
- **Styling:** the asset ships no CSS. Unstyled, the dialog is plain flow content, not a banner. The app styles `.consent-banner` with its own tokens.
- **Preview:** it renders nothing. Bootstrap already skips init when `draftMode()` is on, and `CdpPageView` skips when `!mode.isNormal`.

## Acceptance test (`references/acceptance-test.md`, `assets/tests/consent-acceptance.spec.ts`)

Playwright against `next build && next start`, with a **real Chrome UA**. A headless UA is a bot: it sees zero tracking even with the gate removed, so its zero proves nothing. B runs before A (serial pair: A's zero is trusted only after B passed); D and C carry their own positive control, so one failure does not hide the next:

| State | Pass |
|---|---|
| **B** consent before load | `create.json` **201** + VIEW **201**, then a VIEW 201 per soft navigation |
| **A** no consent | **0** `/v1/events*` and `/v1/personalize*` calls. No `sc_cid` / `sc_cid_personalize`. Banner visible |
| **D** grant mid-session | `create.json` 201 + VIEW 201 for the current page, **with no new document request** |
| **C** withdraw | tracking cookies gone on every domain, then 0 beacons across soft navigations and a reload |
| **C2** stale `sc_cid`, no readable consent | Reject all deletes it (no network) |

On a route with personalization variants and marketing consent the guest is minted **server-side** (`Set-Cookie: sc_cid` on the document) instead of `create.json`: assert either, plus VIEW 201 (`content-sdk-personalization` § verification).

Assert on the tracking names only. `sc_site`, `sc_bot`, `__cf_bm` and `site_consent` exist regardless, and a literal "zero `sc_*`" can never pass.

## Cookie policy: what the gate cannot reach

`references/cookie-inventory.md` has the full measured table. Declare these, because no gate fixes them:
- `__cf_bm`: third-party Cloudflare bot management on `.sitecorecloud.io`, set by Edge media and edge-platform responses, 30 minutes, set with or without consent.
- `sc_site`: necessary, HttpOnly, session.
- `sc_bot`: bots only.

## Hard rules

- **Gate init, not just events.** No `initContentSdk` without analytics consent.
- **Consent lives in a cookie** that the proxy can read. localStorage alone is invisible to `PersonalizeProxy.skip`.
- **A grant re-inits without a reload. A withdrawal deletes, then reloads.**
- **Marketing ⇒ analytics**, enforced in the parser, not only in the UI.
- **Never trust a zero** from a headless UA, a `next dev` server, or a run whose positive control (B) did not pass.
- **Redirect www↔apex at the edge** before any tracking. Otherwise the proxy and Bootstrap scope `sc_cid` differently.
- Server-side events from a Route Handler need the same cookie check, and must not call the SDK `event()` concurrently: measured, 49 of 50 events went out under another visitor's id.

## [probe-gated]

| Item | Gate |
|---|---|
| Proxy-issued `sc_cid` / `sc_cid_personalize` on a **personalized route** | **MEASURED** (P7, `probe-findings-s1-p7-2026-10-01.md`). With marketing consent, both are set on match and no-match: `Max-Age=63072000; Domain=<request hostname>; Secure; SameSite=None`, not HttpOnly. Consent denied or no consent cookie: no `Set-Cookie`, 0 edge-platform calls, default variant. Open: the www-scoped variant on a real www host |
| `<Form>` events: unhandled IE-002 without consent, beacon with consent | P16 (P7 had no Form component) |
| States A–D with **these** templates: **PASS** on localhost, production build, the author's own tenant, LIVE context, 2026-10-01. Not yet run on a real www/apex host pair or a deployed app | a deployed run |
| Banner from a real Sitecore datasource: template, rendering, Available Renderings, shared datasource, placement, all 17 fields on `fields` on Edge **preview**, rendered with authored copy in a production build (real Chrome UA, 0 beacons before consent) | **PASS** on the author's own tenant, throwaway page, 2026-10-01 |
| Footer **Partial Design** placement; inline editing in Pages; Design Library mock; the no-datasource placeholder inside Pages | an editing host serving this code (the tenant's editing host does not) |
| Bootstrap ordering under the cache-components template (Suspense around the page) | unresolved |

## Related

- `content-sdk-app-router-theme-hydration-pattern`: the `useSyncExternalStore` store shape.
- `content-sdk-app-router-multisite-management`: proxy chain order.
- `content-sdk-app-router-editing-safe-rendering`, `content-sdk-field-usage-image-link-text`: banner rendering.
- `content-sdk-component-naming-traps`: why helpers stay out of `src/components/`.
