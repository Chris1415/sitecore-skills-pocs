# Consent acceptance test

Script: `assets/tests/consent-acceptance.spec.ts` (Playwright). Copy it to `<head-app>/e2e/`; its `../src/lib/consent/consent` import assumes that depth. A scaffolded or shipped app usually already has a `playwright.config.ts` with another `testDir`: add a dedicated `playwright.consent.config.ts` (fragment below) instead of editing the app's own config.

## Preconditions (each was measured to matter)

| Precondition | Why |
|---|---|
| **Production build**: `next build && next start` | under `next dev`, Bootstrap skips init ("not initialized in development environment") and the proxy reports "personalize proxy is disabled globally". Every state then reads zero |
| **Real Chrome UA** pinned (`test.use({ userAgent })`) | `isbot()` classifies `HeadlessChrome` as a bot: no `create.json`, no VIEW, no `sc_cid`. Default-UA Playwright passes state A **with the gate removed** |
| **Positive control first** (state B, serial mode) | a zero in A, C or D is trusted only after B has shown `create.json` 201 and VIEW 201 in the same run |
| A context id that accepts events (`NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID`) | the events endpoint 404s on a bad context (`No sitecore context`) or an unknown browser id (`Invalid browser id/ref specified`). The body names which one |
| `SOFT_NAV_PATHS` = at least 2 hrefs that exist as `<a>` on `/` | soft navigation is where the IE-002 failure hides |
| `CONSENT_POLICY_VERSION` = the authored `PolicyVersion` | otherwise a seeded consent re-prompts |
| Windows Git Bash: `MSYS_NO_PATHCONV=1` | MSYS rewrites `SOFT_NAV_PATHS=/adventures` to `C:/Program Files/Git/adventures`; the soft navigation then waits out the test timeout. The spec's `beforeAll` now fails fast on a non-root-relative path |

**Real-tenant mutation:** each run creates 3 guests and 5 VIEWs (C2 sends nothing) on the configured context. Run it against a non-production context where you can. On a live context, get the user's go-ahead first.

## States and pass criteria

| State | Steps | Pass |
|---|---|---|
| **B** granted before load | seed `site_consent` (all) → cold `/` → 1 soft navigation | `create.json` **201** ×1, VIEW **201** on the cold load and on the soft navigation, `sc_cid` present |
| **A** no consent | cold `/` → soft-navigate every path | **0** requests to `/v1/events*` or `/v1/personalize*`. No `sc_cid` / `sc_cid_personalize` on any domain. Banner visible. No `Set-Cookie: sc_cid` on the document |
| **D** grant mid-session | cold `/` (0 calls) → click Accept all → 1 soft navigation | `create.json` 201 and VIEW 201 for the **current** page **with no new document request**, then VIEW 201 on the soft navigation |
| **C** withdraw | seed (all) → cold `/` (`sc_cid` exists) → reopen → Reject all (the page reloads) → soft navigations → reload | `sc_cid` and `sc_cid_personalize` **gone on every domain**, then **0** edge-platform calls |
| **C2** stale identifier | `sc_cid` present, no readable consent (expired / old schema) → Reject all | `sc_cid` gone, 0 calls |

Only B → A runs serially (A's zero needs B's positive control). D and C carry their own control (the 201s after the grant, the `sc_cid` precondition), so a D failure no longer skips C: under file-level serial mode a mutation that broke D hid the C failure.

Cookies **excluded** from the "no tracking cookie" assertions: `sc_site` (routing, HttpOnly, always set), `sc_bot` (bots only), `__cf_bm` (third-party Cloudflare on `.sitecorecloud.io`, from Edge media) and `site_consent`. The spec asserts only on the tracking names, so the exclusion is structural.

## What the stock scaffold scores (baseline, measured 2026-10-01)

| State | Stock | With only the scaffold-style gate (Bootstrap + CdpPageView + skip, no store) |
|---|---|---|
| A | FAIL: `create.json` + VIEW + `sc_cid` before any interaction | PASS |
| B | PASS | PASS |
| C | n/a | beacons stop, but **`sc_cid` stays for 730 d** → FAIL |
| D | n/a | **0 calls until a hard reload**, with IE-002 swallowed on each navigation → FAIL |

This skill's store, re-init and delete list close C and D. **Run 2026-10-01 against these templates** (localhost production build, the author's own tenant, LIVE context): A–D and C2 PASS; stock FAILS A on 1 `create.json` + 3 VIEWs; a scaffold-style gate (consent read once inside the effect, no `analytics` dep) FAILS D (0 VIEWs in 10 s); a withdrawal without the delete FAILS C (`sc_cid` left).

## Optional: www vs apex withdrawal (no hosts file)

Measured technique: route `https://www.<test-domain>/*` and `https://<test-domain>/*` to the local server with `context.route`, passing `x-forwarded-host: <original host>` (the SDK proxy reads it first). Run state C on `www.` and assert that `sc_cid` is absent for both `.<apex>` and `.www.<apex>`. The proxy-written `www` variant appears only on a personalized route. P7 measured that the proxy writes `Domain=<full request hostname>` there; the www/apex pair itself is not run yet.

## Playwright config fragment

```ts
// playwright.config.ts
// playwright.consent.config.ts: testDir './e2e', workers 1
webServer: {
  command: 'npm run build && npx next start -p 3000', // or build once and start by hand to keep the server log
  url: 'http://localhost:3000',
  reuseExistingServer: false, // an adopted foreign server on :3000 produced a fictional report once
  timeout: 600_000,
},
use: { baseURL: 'http://localhost:3000' },
```
