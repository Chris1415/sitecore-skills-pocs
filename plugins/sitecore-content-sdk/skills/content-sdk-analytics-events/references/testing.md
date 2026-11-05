# Testing and verifying events

The core rule: **a zero is evidence only after a positive control.** The SDK swallows transport errors, and a headless browser is a bot.

## 1. Surface

- Run a **production build against the LIVE context**: `next build && next start`, or the deployment. `next dev` initializes nothing ("Browser Events SDK is not initialized in development environment"). Preview and editing skip Bootstrap.
- To exercise `BotTrackingProxy` locally, either set `SITECORE_ENABLE_BOT_TRACKING=true` or send a non-localhost `Host`. On `localhost` it logs `bot tracking proxy skipped (local environment)`.

## 2. Playwright: pin a human UA, capture the beacons

```ts
import { chromium } from 'playwright';

const HUMAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: HUMAN_UA });     // default UA = HeadlessChrome = bot
const page = await ctx.newPage();
const hits: { url: string; status: number; type?: string }[] = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!u.includes('edge-platform.sitecorecloud.io')) return;
  let type: string | undefined;
  try { type = JSON.parse(r.request().postData() || '{}').type; } catch {}
  hits.push({ url: u, status: r.status(), type });
});
await page.goto(BASE_URL);
await page.waitForTimeout(3000);

const created = hits.find((h) => h.url.includes('/browser/create.json'));
if (created?.status !== 201) throw new Error('positive control failed: no create.json 201, so any zero below is meaningless');
const views = hits.filter((h) => h.url.includes('/v1/events/') && h.type === 'VIEW');
if (!views.every((v) => v.status === 201)) throw new Error('VIEW beacon not 201');
```

To check a custom event, trigger the interaction, then assert a hit with `type === '<SITE>_<ACTION>'` and status 201.

**Blindness control.** Run the same script with the default UA. You should see 0 `create.json`, 0 VIEW and no `sc_cid`. If the headless run shows traffic, bot detection is not running. If the human run shows none, tracking is broken.

## 3. Controls

| Control | Expected |
|---|---|
| Known-good: real Chrome UA, production build, live context | `create.json` 201, then VIEW 201 per navigation (one per soft navigation, with no extra `create.json`) |
| Known-bad: bogus `x-sitecore-contextid` (replay) | 404 `No sitecore context` |
| **Not** a control: bogus `siteId` | 201. `siteId` is not validated |
| Known-bad: `next dev` | 0 edge-platform requests |
| Bot: Googlebot UA on a non-localhost host | `Set-Cookie: sc_bot=1`, no `create.json`, no client VIEW |

## 4. Server-side observability

- `DEBUG=content-sdk:events` logs each send with its response status. Other namespaces: `content-sdk:{init,http,personalize,form}`.
- To capture what the SDK swallowed, use a fetch tap. Patch `globalThis.fetch` once (guarded by a `globalThis` flag), record the status, the `browser_id` and the `type` for URLs that contain `/v1/events/`, and expose the records from a throwaway route. Throwaway builds only.

## 5. Concurrency check (for any server-side event path)

Fire N parallel requests (≥ 50, half with a preset `sc_cid` cookie, half fresh, random 0–200 ms delay after init). Each request tags its event, for example with `extensionData.probe_tag`. Assert, **per request**, that the outbound `browser_id` equals that request's own `sc_cid` (or the one it was just issued). Asserting `Set-Cookie` alone passes while the payload is cross-attributed (T15).

## 6. www vs apex duplicate cookies, without a hosts file

Use Playwright `page.route('https://www.<test-domain>/**')` and `page.route('https://<test-domain>/**')` and fulfil both from the local production server, setting `x-forwarded-host` to the original host. Then count `sc_cid` entries in `context.cookies()` after Bootstrap and a server writer have both run. Two entries means one visitor has become two.

## 7. Ingestion

Open Performance → Events in SitecoreAI. Custom events appear by `type`, with event and session counts, next to `pageView`, which is the wire `VIEW`. Use a `<SITE>_PROBE_*` type for test traffic so it can be told apart. The latency until a row appears, and whether IDENTITY and FORM appear there and in Profiles, are [probe-gated: P10].
