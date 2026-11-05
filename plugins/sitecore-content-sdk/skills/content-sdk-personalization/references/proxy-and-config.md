# PersonalizeProxy and `personalize` config: lookup

Verified against `@sitecore-content-sdk/nextjs` 2.4.0 / `content` 2.3.0. Paths are relative to `node_modules/@sitecore-content-sdk/`.

## Skip and execution order

From `nextjs/dist/esm/proxy/personalize-proxy.js` (line refs are the esm build):

| Step | Check | Result | Edge lookup paid? |
|---|---|---|---|
| 1 | `disabled()`: `enabled:false`, no Edge config, a path containing `.`, or `skip(req,res)` true | return untouched | no |
| 2 | Response is a redirect, or the request is preview | return | no |
| 3 | `sc_bot` cookie set and `skipForBot` (default `true`) | return | no |
| 4 | Edge `layout(site, routePath, language){ item { id version personalization { variantIds } } }` within `edgeTimeout`, cached 10 s per instance | | **yes** |
| 5 | No personalize info (route not found, `variantIds` empty) | return ("no personalization configured" / "personalize info not found") | yes |
| 6 | Prefetch request | `Cache-Control: no-store`, `x-proxy-cache: no-cache`, no decision (keeps A/B metrics clean) | yes |
| 7 | `initPersonalizeServer`: `initContentSdk` with `api.edge.contextId`, `enableCookie:true` + `enablePersonalizeCookie:true` hard-coded, cookie domain = request hostname | sets `sc_cid` (`create.json`) and `sc_cid_personalize` (`show.json`). Neither call has a timeout | yes |
| 8 | One `personalize()` per friendlyId, in parallel, within `cdpTimeout` | | yes |
| 9 | Returned id not in that execution's `variantIds` | logged and dropped | yes |
| 10 | No identified variant | return default | yes |
| 11 | Rewrite to `_variantId_…`, `x-proxy-cache: no-cache`, `x-sc-rewrite` header | variant rendered | yes |

**Fail-open is coarse.** A `null` decision (any non-2xx) makes reading `.variantId` throw; `Promise.all` rejects and the whole request falls back to default, including executions that succeeded. A timeout behaves the same.

**Latency is not bounded at 400 + 400 ms**: `create.json` and `show.json` sit in the chain without a timeout and are not configurable without subclassing.

**Locale paths.** The Edge lookup uses the raw `req.nextUrl.pathname`. With a prefixed locale (`/de/about`), the route is probably not found and the default is served silently `[probe-gated: P11]`.

## `sitecore.config.ts → personalize`

Type: `content/types/config/models.d.ts:150-181`. Defaults: `content/dist/cjs/config/define-config.js:53-63`.

| Key | Default | Env var read by `defineConfig` |
|---|---|---|
| `enabled` | `process.env.NODE_ENV !== 'development'` | none |
| `edgeTimeout` | 400 | `PERSONALIZE_MIDDLEWARE_EDGE_TIMEOUT` |
| `cdpTimeout` | 400 | `PERSONALIZE_MIDDLEWARE_CDP_TIMEOUT` |
| `scope` | `''` | `SITECORE_PERSONALIZE_SCOPE` → `CSDK_PUBLIC_PERSONALIZE_SCOPE` → `NEXT_PUBLIC_PERSONALIZE_SCOPE` |
| `channel` | `'WEB'` | none |
| `currency` | `'USD'` (the JSDoc says `'USA'`; the code wins) | none |

- `parseInt(env || '', 10) || 400`: a missing or non-numeric value falls back to 400 silently.
- The template's `sitecore.config.ts.example` reads `PERSONALIZE_PROXY_EDGE_TIMEOUT` for **both** timeouts. The real names are the `PERSONALIZE_MIDDLEWARE_*` ones above.
- An env var like `PERSONALIZE_ENABLED=true` does nothing: `enabled` has no env binding. Without a `personalize` block, `next dev` always runs disabled.
- Scope: prefer the server-only `SITECORE_PERSONALIZE_SCOPE`. If client code also builds a `pageVariantId` (CdpPageView reads `config.personalize.scope`), the `NEXT_PUBLIC_` name must carry the same value.
- `defineConfig` has no analytics or events keys; those are plugin options (see `content-sdk-tracking-consent`).

Related Edge keys: `api.edge.contextId` (server; the proxy), `api.edge.clientContextId` (browser; defaults to `NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID`), `api.edge.edgeUrl` (`NEXT_PUBLIC_SITECORE_EDGE_PLATFORM_HOSTNAME`, default `https://edge-platform.sitecorecloud.io`).

## `PersonalizeProxyConfig` hooks

`nextjs/types/proxy/personalize-proxy.d.ts:27-36` and `proxy/proxy.d.ts:12-18`.

| Hook | Signature | Use |
|---|---|---|
| `skip` | `(req, res) => boolean` | **Consent gate.** Runs in step 1, before the Edge lookup and before any cookie |
| `skipForBot` | `boolean`, default `true` | Keep it. Needs `BotTrackingProxy` earlier in the chain |
| `extractGeoDataCb` | `(req?) => PersonalizeGeoData \| Promise<…>` | `{city?, country?, region?}` merged into `params.geo`. Required for geo conditions on a hosted proxy |
| `getExtraUtmParams` | `(req) => Partial<ExperienceParams['utm']>` | Extra UTM keys beyond campaign/source/medium/content |
| `personalizeService` | `PersonalizeService` | Replace the Edge lookup (for example a different cache than the 10 s in-process one) |

Protected members for a subclass (`personalize-proxy.d.ts:75-98`): `disabled`, `getExperienceParams`, `initPersonalizeServer`, `personalize`, `getPersonalizeExecutions`. Override `getExperienceParams` to add params custom conditions can read; override `getPersonalizeExecutions` to add friendlyIds. The proxy never passes `email` / `identifier`, so identified personalization also needs a subclass.

## Geo: why `extractGeoDataCb` is not optional on a hosted proxy

Observed in the OOTB condition template code (read via the Marketer MCP, 2026-10-01): `country` and `country_region` read `request.params.geo.country|region` first, else `request.requestDetails.headers["cf-ipCountry"]` / `["cf-region-code"]`. The proxy calls the decision endpoint from the server, so those headers describe the server's location. Without the callback, a geo audience matches the hosting region for every visitor. The value form the condition expects (the template's `country(s)` param is a multi-enum of names mapped to codes) is `[probe-gated: P12]`.

## Chain notes

- Scaffold: `defineProxy(preview, botTracking, locale, multisite, redirects, personalize).exec(req)`, built inside the exported `proxy(req, event)` so `BotTrackingProxy` gets `fetchEvent` for `waitUntil`.
- The scaffold matcher excludes `api/`, `_next/`, `sitecore/api/`, `-/`, `healthz`, sitemap and robots, so a Route Handler under `/api` never passes through the proxy.
- `sc_bot` is also set on root `public/` files for bot UAs, because the matcher covers them.
- Bot tracking skips on localhost and in development unless `SITECORE_ENABLE_BOT_TRACKING=true`; a non-localhost Host header also enables it in a local production build.
