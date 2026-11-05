# Wire format: what goes over the network

Everything below was captured from live Content SDK 2.1.2 sites on 2026-10-01. Context ids and visitor ids are redacted.

## 1. Visitor id: `create.json`

```
GET https://edge-platform.sitecorecloud.io/v1/events/v1.2/browser/create.json?client_key=
x-sitecore-contextid: <context id>
→ 201 { "ref": "<uuid>", "customer_ref": "<uuid>", "client_key": "<tenant hex32>" }
```

- `ref` becomes the `sc_cid` cookie value.
- `customer_ref` is the guest (profile) id, which is created server-side at Sitecore on this call.
- `analyticsPlugin.init` calls it **only when there is no `sc_cid` and the visitor is not a bot**. An existing cookie is never re-checked, so a stale or foreign `sc_cid` stays in place.

## 2. Events: `POST /v1/events/v1.2/events`

A page view, exactly as the browser sent it:

```
POST https://edge-platform.sitecorecloud.io/v1/events/v1.2/events?siteId=<siteName>
content-type: application/json
x-client-software-id: @sitecore-content-sdk/events 2.1.2
x-library-version: 2.1.2
x-sitecore-contextid: <context id>

{"browser_id":"<sc_cid>","channel":"WEB","client_key":"","currency":"USD","language":"en",
 "page":"Home","pos":"","requested_at":"2026-10-01T12:00:49.513Z","type":"VIEW",
 "ext":{"pageVariantId":"<pageidnodashes>_en_default"}}

→ 201 {"status":"OK","version":"1.2","client_key":"<tenant hex32>","ref":"<uuid>"}
```

- **Base payload** (`events/types/src/events/base-event.d.ts:23-32`): `browser_id`, `client_key` (sent empty), `pos` (sent empty), `requested_at`, and optional `channel`, `currency`, `language`, `page`.
- **Custom event:** `type` is your string. `extensionData` is flattened into `ext`, and any other top-level keys are sent as given.
- **FORM:** `type:"FORM"`, `ext:{componentInstanceId, formId, interactionType}`.
- **IDENTITY:** `type:"IDENTITY"`, with snake_case fields (`firstname`, `postal_code`, `identifiers:[{id, provider, expiry_date?}]`).
- **Bot view:** `type:"VIEW"`, `channel:"bot"`, `ext.sourceUserAgent`.
- **`siteId` is not URL-encoded by the SDK.** Whether a site name with a space breaks it is [probe-gated: P15].

### Status classes (measured)

| Request | Status | Body |
|---|---|---|
| Valid context + known `browser_id` | **201** | `{"status":"OK",…}` |
| **Any `type`**, including `SC_PROBE` and lowercase | **201** | no type validation at ingress |
| **Any `siteId`**, including bogus, empty or absent | **201** | `siteId` is not validated |
| A never-issued random UUID as `browser_id`, sent server-side | **201** | ingress does not check that the id was CDP-issued |
| A browser id minted under tenant A, sent with tenant B's context | **201** | tenant isolation of browser refs is unclear |
| Bogus or missing `x-sitecore-contextid` | **404** | `{"title":"NotFound","detail":"No sitecore context"}` |
| `browser_id: ""` (browser replay) | **404** | `{"status":"NOT_FOUND","error_msg":"Invalid browser id/ref specified"}` |
| `browser_id: ""` (server SDK call, bot UA) | **400** | `"Invalid UUID string: "` |
| `browser_id: null` | 400 | `"No customer ref specified"` |

Consequences:
- **The only useful negative control is a bogus context id.** A bogus `siteId` passes.
- **A 404 on every page** means the context is wrong or the `browser_id` is missing or unknown. The leading local-dev cause is a stale foreign `sc_cid` on `localhost`, shared by every app on that host and never replaced.
- **201 is not ingestion.** Downstream handling of reserved or unknown types is [probe-gated: P10].

## 3. Cookies that tracking touches

Observed on a fresh visit with a real Chrome UA. The consent categories and the deletion procedure belong to `content-sdk-tracking-consent`.

| Cookie | Set by | Attributes | Notes |
|---|---|---|---|
| `sc_cid` | Bootstrap, from JS (`enableCookie:true`) | Domain = hostname without `www.`, `/`, `SameSite=None; Secure`, JS-readable, Max-Age 63 072 000 s (730 d) | The visitor id. Also set by `PersonalizeProxy` on personalized routes, with the raw Host as domain. On `www` that can create a **second** `sc_cid` (measured with a simulated proxy writer) |
| `sc_cid_personalize` | `PersonalizeProxy`, personalized routes only | — | Not observed on non-personalized sites. See `content-sdk-personalization` |
| `sc_bot` | `BotTrackingProxy`, server, bot UAs only | host-only, `SameSite=Lax`, Secure, **not** HttpOnly, session | Also set on static `public/` files the proxy matcher covers |
| `sc_site` | `AppRouterMultisiteProxy` | HttpOnly, `SameSite=None`, session | Routing, not tracking |
| `__cf_bm` | Cloudflare on `*.sitecorecloud.io` | third party, 30 min | Outside any SDK lever |

`bx_bucket_number` is **not** set by Content SDK 2.1.2 / nextjs 2.4.0 without `webPersonalization`.

## 4. CSP

- `connect-src https://edge-platform.sitecorecloud.io` is needed for events, `create.json` and decisions.
- `script-src https://d35vb5cccm4xzp.cloudfront.net` is needed only with `webPersonalization`. The path is keyed by the tenant `client_key`.
