# Verification ladder (head-app layers)

The SDK swallows decision errors and serves the default, so a rendered page never proves personalization works. Every layer is checked on its own, each with a control. Layers 1-2 (the flow and its variant setup) and 7 (analytics) are backend checks: see `sitecoreai-personalization`.

## Preconditions

- **Production build** (`next build && next start`) against the **LIVE** Edge context. `next dev` disables the proxy and Bootstrap; preview is the permissive surface.
- **Non-headless UA.** `isbot` classifies `HeadlessChrome` and `curl` as bots: `BotTrackingProxy` sets `sc_bot`, the proxy skips, the client sends nothing. Pin a real Chrome UA in Playwright, and for `curl` pass `-A` with one.
- **Consent granted** if the site gates `skip()` on consent.
- `DEBUG=content-sdk:personalize` on the server (other namespaces: `content-sdk:{events,init,http,locale,multisite,redirects}`).
- The variant is **published**; `variantIds` stays empty until then.

## Layer 3: Edge projection

The SDK's own query (`content/dist/cjs/personalize/personalize-service.js:25-38`):

```
POST {edgeUrl}/v1/content/api/graphql/v1?sitecoreContextId=<live ctx>
query ($siteName: String!, $language: String!, $itemPath: String!) {
  layout(site: $siteName, routePath: $itemPath, language: $language) {
    item { id version personalization { variantIds } rendered } } }
```

- **Pass:** `variantIds` contains the variant; the personalized rendering in `rendered` has `experiences[<v>]`.
- **Controls (measured):** a plain page returns `variantIds: []` (never null) and `rendered` has **no** `experiences` key at all. A missing route or site returns **HTTP 200 with `layout: null`**, not an error. A bogus context id returns 404 `No sitecore context`.
- Check "is this page personalized" with `variantIds.length > 0`; treat a missing `experiences` as none.

## Layer 4: Decision

1. Mint a browser id: `GET {edgeUrl}/v1/events/v1.2/browser/create.json?client_key=` with `x-sitecore-contextid` → the `ref` field.
2. `POST {edgeUrl}/v1/personalize?siteId=<site>` with the friendlyId (`references/variant-grammar.md`), that `browserId`, the matching condition input (for example `params.utm.campaign`), the candidates in `variants`, and a real UA.

- **Pass:** `{ "variantId": "<v>" }`, and `<v>` is one of the candidates.
- **Control:** the same call without the condition input returns `200 {"message":"No matching variant"}` (measured P7, also for a wrong value and for `utm: {}`). A bogus friendlyId returns `404 {"message":"No experiences found for friendlyId <id> and clientKey <key>"}`. Omitting `channel` returns `400 Missing required parameter: channel`. `browserId: ""`, an omitted `variants`, a wrong `siteId` and a body `language` that differs from the friendlyId all still decide normally.
- **Latency (client → edge-platform, warm):** 31 / 36 / 46 ms min / p50 / max over 10 calls; 0 over 400 ms.
- **Scope control:** a friendlyId built with a different scope should find no flow `[probe-gated: P5]`.
- Whether a decision needs a prior page view depends on the audience: context audiences (UTM, device) are expected to resolve without one, history audiences need prior VIEWs on the same guest. New-visitor determinism, measured for a UTM audience: 5/5 fresh browser ids got the variant on their first call and 5/5 got no match without the UTM. No VIEW is needed and nothing sticks: the same guest without the UTM right after a match gets no match. A UTM condition reads `profile.sessions` only when `params.utm` is **absent**; the proxy always sends `utm` (`{}` when empty).
- **The flow outlives a cleanup.** After `reset_component_variant` and a republish, the decision still returns the variant: the flow stays `PRODUCTION` until it is deleted in Pages. A direct decision call therefore proves the flow, not the page setup. Check layer 3 for that.

## Layer 5: Render

`curl -s -A "<real Chrome UA>" -b "<consent cookie>" "<host>/<path>?utm_campaign=<value>"`

- **Pass:** the HTML carries the variant's content, and the server log shows the rewrite `/_variantId_<v>`.
- **Control:** without the condition input, the default content.
- **Warm first.** A cold Edge lookup (first request after start or after a publish) times out at 400 ms and serves the default. Repeat before concluding anything. Measured on a deployed Vercel app (2026-10-07): the first navigation after publish + redeploy rendered the default (VIEW `pageVariantId …_default`) and the second, same session, the variant; for a while identical requests alternated. Assert "variant within N warm reads", never "variant on read 1".
- **Forced URL control:** `/<path>/_variantId_<v>` renders the variant for any visitor (no consent, no condition) and is served from ISR even after the variant is removed, until revalidation. A VIEW from it reports `pageVariantId …_<v>`.
- If the log says `skipped (personalize proxy is disabled)`: `enabled`, Edge config, a `.` in the path, or `skip()` (consent). `skipped (no personalization configured)`: layer 3 failed. A rewrite with the default content: check `personalizeLayout` input and that the component renders the variant's datasource.

## Layer 6: Beacon

In the browser network panel: `POST {edgeUrl}/v1/events/v1.2/events?siteId=<site>`.

- **Pass:** 2xx, and the body's `ext.pageVariantId` ends `_<v>`.
- **Control:** a default visit ends `_default`.
- The events endpoint ignores `siteId` (any value returns 201) and 404s only on the context (`No sitecore context`) or the browser id (`Invalid browser id/ref specified`). Beacon wiring and consent: `content-sdk-tracking-consent`.

## Testing notes

- Assert the positive control before trusting any zero. **The guest mint has two forms.** Once a page has personalization variants and the visitor has marketing consent, `PersonalizeProxy` mints the guest **server-side**: the document response carries `Set-Cookie: sc_cid` / `sc_cid_personalize` before any client JS, and the browser's `GET …/browser/create.json` never fires (measured 2026-10-07; a positive control expecting `create.json` went red in three specs). Assert **(client `create.json` 201 OR server `Set-Cookie: sc_cid` on the document) AND a VIEW 201**. In the no-consent state also assert **no** server mint: no `Set-Cookie: sc_cid*` on the document (verified live: none).
- **Grant → `router.refresh()`.** The refresh's RSC request URL carries Next's `_rsc=<hash>` in a production build; strip it before matching the expected URL, or the wait times out although the refresh happened (its `next-url` header already shows the `_variantId_` rewrite).
- Concurrency tests must check the **outbound payload's** browser id, not the `Set-Cookie`.
- A www/apex pair can be simulated with Playwright request interception and `x-forwarded-host` (no hosts file). The proxy uses the request hostname as cookie domain while Bootstrap strips `www.`: on www, Bootstrap-first gives **two** `sc_cid` cookies; proxy-first scopes the visitor to www only (measured with a simulated proxy writer). Redirect www↔apex at the edge before any tracking.
