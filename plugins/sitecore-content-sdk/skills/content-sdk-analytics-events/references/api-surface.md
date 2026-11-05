# API surface: analytics-core, events, core init

The shapes below come from `node_modules/@sitecore-content-sdk/*/types`. Versions: events 2.1.2, analytics-core 2.1.2, core 2.1.4, nextjs 2.4.0. Re-derive after an upgrade; do not trust this table across versions.

## Package entry points

| Package | Subpaths (`package.json` `exports`) |
|---|---|
| `@sitecore-content-sdk/events` | `.`, `./browser`, `./internal` |
| `@sitecore-content-sdk/analytics-core` | `.`, `./internal`, `./utils` |
| `@sitecore-content-sdk/core` | `.`, `./tools`, `./node-tools` |

`./internal` is not public API. Do not import from it in app code.

## Init

| Symbol | Signature | `.d.ts` |
|---|---|---|
| `initContentSdk` | `(params: InitContentSdkParams) => Promise<void>`. It is re-exported from `@sitecore-content-sdk/nextjs` | `core/types/initialization/init-content-sdk.d.ts:14`; `nextjs/types/index.d.ts:27` |
| `InitContentSdkParams` | `{ config: { contextId: string; edgeUrl?: string; siteName: string }; plugins: Plugin[] }` | `core/types/initialization/types.d.ts:5-23` |
| `analyticsPlugin` | `(params: AnalyticsPluginParams) => AnalyticsPlugin` | `analytics-core/types/src/initialization/plugin.d.ts:45` |
| `AnalyticsPluginParams` | `{ options?: { cookieDomain?; cookieExpiryDays?; cookiePath?; enableCookie?; timeout? }; adapter: AnalyticsAdapter }` | same file `:8-38` |
| `analyticsBrowserAdapter` | `() => AnalyticsBrowserAdapter` (`type: 'browser'`) | `analytics-core/types/src/initialization/browser-adapter.d.ts:19` |
| `analyticsServerAdapter` | `<Req extends IncomingMessage, Res extends OutgoingMessage>(req, res) => AnalyticsServerAdapter` | `analytics-core/types/src/initialization/server-adapter.d.ts:24` |
| `analyticsProxyAdapter` | `(request: NextRequest, response: NextResponse) => AnalyticsProxyAdapter` (`type: 'proxy'`) | `nextjs/types/initialization/proxy/analytics-adapter.d.ts:22`; exported at `nextjs/types/index.d.ts:32` |
| `eventsPlugin` | `() => EventsPlugin` | `events/types/src/initialization/plugin.d.ts:14` |
| `getClientId` | `() => string`: the `sc_cid` value or `''`. It **throws IE-002** if init has not run | `analytics-core/types/src/client-id/get-client-id.d.ts:6` |

Option notes (from the dossier, verified against source):
- `enableCookie` defaults to **false**. The scaffold passes `true`.
- `cookiePath` is ignored; the path is hard-coded to `/`.
- Cookie lifetime is 730 days (`DEFAULT_COOKIE_EXPIRY_DAYS`, `analytics-core/types/src/consts.d.ts:20`).
- `edgeUrl` defaults to `https://edge-platform.sitecorecloud.io`.

## Events

| Function | Signature | `.d.ts` |
|---|---|---|
| `pageView` | `(pageViewData?: PageViewData) => Promise<EPResponse \| null>`; skipped for bots | `events/types/src/events/page-view/page-view.d.ts:11` |
| `event` | `(eventData: EventData) => Promise<EPResponse \| null>` | `events/types/src/events/custom-event/event.d.ts:9` |
| `form` | `(formId: string, interactionType: 'VIEWED' \| 'SUBMITTED', componentInstanceId: string) => Promise<EPResponse \| null>` | `events/types/src/events/custom-event/form.d.ts:10` |
| `identity` | `(identityData: IdentityData) => Promise<EPResponse \| null>` | `events/types/src/events/identity/identity.d.ts:9` |
| `botPageView` | `(pageViewData: BotPageViewData) => Promise<EPResponse \| null>`; channel `bot`, client id derived from the UA | `events/types/src/events/page-view/bot-page-view.d.ts:35` |
| `addToEventQueue` | `(eventData: EventData) => Promise<void>`, from `events/browser` | `events/types/src/eventStorage/addToEventQueue.d.ts:7` |
| `processEventQueue` | `() => Promise<void>`: sends the queue, then clears it | `events/types/src/eventStorage/processEventQueue.d.ts:6` |
| `clearEventQueue` | from `events/browser` | `events/types/src/browser.d.ts:3` |

### Input types

`EventAttributesInput` (`events/types/src/events/common-interfaces.d.ts:6-47`) is the base of every input type:
- `language?`: browser default is the `<html lang>`; server default is `''`.
- `page?`: browser default is "Home Page" or the pathname; server default is `''`.
- `channel?` (uppercase) and `currency?` (ISO 4217): left out of the payload when unset.

`EventData` (`custom-event.d.ts:56-78`) extends it with:
- `type: string`. JSDoc: "Do not set type to a reserved event name… Include the name of the site, for example `myretailsite:CLICKED_PROMO`".
- `searchData?`: only for `SC_SEARCH_WIDGET_VIEW` / `SC_SEARCH_WIDGET_CLICK`.
- `extensionData?: NestedObject`.
- Any extra keys (`NestedObject`).

`PageViewData` (`page-view-event.d.ts:70-99`) adds:
- `pageVariantId?`: build it with `CdpHelper.getPageVariantId(pageId, language, variantId, scope?)` (`content/types/personalize/utils.d.ts:52`).
- `referrer?`.
- `includeUTMParameters?`, default `true`.
- `extensionData?`, `searchData?`.

`IdentityData` (`identity-event.d.ts:50-129`):
- **`identifiers: Identifier[]`**, required.
- Optional: `email`, `firstName`, `lastName`, `dob` (**date only, `YYYY-MM-DD`**), `gender`, `mobile`, `phone`, `city`, `state`, `country` (ISO-3166 alpha-2), `postalCode`, `street: string[]`, `title`, `extensionData`.

`Identifier` (`identity-event.d.ts:134-149`) is `{ id: string; provider: string; expiryDate?: string /* ISO 8601 date-time */ }`.

`BotPageViewData` (`bot-page-view.d.ts:11-26`) is `{ page: string; language: string; userAgent: string }`. `userAgent` is sent as `ext.sourceUserAgent`.

`MAX_EXT_ATTRIBUTES = 50` (`events/types/src/events/consts.d.ts:1`).

### What `form()` sends

`form()` sends `type: 'FORM'` with `extensionData: { componentInstanceId, formId, interactionType }`, and it clears `page` (`events/dist/esm/src/events/custom-event/form.js`). The React `<Form>` (`react/types/components/Form.d.ts`, props `{ rendering, params: { FormId, styles?, RenderingIdentifier? } }`) subscribes to the submit event only when `!isEditing && !isBotClientSide()` (`react/dist/esm/components/Form.js:73-74`).

## Error codes you will meet

Thrown errors reject the promise. They are not swallowed. The messages are in `core/dist/esm/constants.js`.

| Code | Meaning | Thrown by |
|---|---|---|
| IE-001 | A plugin's dependency is missing from `plugins` | `initContentSdk` |
| IE-002 | SDK not initialized | every event function, `getClientId` |
| IE-004 | A plugin is not registered | event functions when `eventsPlugin` is missing |
| IE-005 | `sc_cid` could not be set (`create.json` failed) | `analyticsPlugin` init |
| IV-003 | `dob` is not date-only | `identity` |
| IV-004 | Invalid `email` | `identity` |
| IV-005 | `expiryDate` is not an ISO date-time | `identity` |
| IV-006 | More than 50 `extensionData` attributes | `pageView`, `event`, `identity` |
| MV-003 | `identifiers` is missing | `identity` |

**Transport errors are swallowed.** `sendEvent` (`events/dist/esm/src/events/send-event/sendEvent.js:11-33`) has `.catch(() => null)`. It sets no timeout, no `keepalive` and no retry. A 4xx or 5xx resolves to `null`.

## Version notes

- events **2.1.2** introduced the date-only `dob` check. 2.1.1 and the `beta.atoms` builds use `YYYY-MM-DDThh:mm` and throw IV-003 on a date-only value.
- `BotTrackingProxy`, `botPageView` and `pageView` skipping bots arrived in **2.1.0**.
- Content SDK 1.x uses `@sitecore-cloudsdk/*`, which is not covered here.
