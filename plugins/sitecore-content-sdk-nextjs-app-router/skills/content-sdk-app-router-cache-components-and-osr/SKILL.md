---
name: content-sdk-app-router-cache-components-and-osr
description: "On-demand revalidation (OSR) for a Content SDK App Router app: template choice, version floor, /api/revalidate contract, cache tags, cacheProfile. Use when content is stale after publish. Not Edge webhook setup."
license: Apache-2.0
compatibility: "Next.js 16+ App Router with Cache Components ('use cache', cacheTag, revalidateTag) and @sitecore-content-sdk/nextjs >= 2.2.0 (working item-level OSR needs the 2.5.0 line, see Version floor). Node 18+ for scripts/revalidate-controls.mjs. The Pages Router and the plain nextjs-app-router template have no SDK OSR."
metadata:
  author: Christian Hahn
  version: "0.5.4"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 407173b8
  upstream_name: content-sdk-cache-components-and-osr
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router-cache-components/.agents/skills/content-sdk-cache-components-and-osr/SKILL.md
---

# Content SDK OSR (App Router)

Cache Sitecore reads with Next.js Cache Components and invalidate them when Experience Edge reports a publish, instead of waiting for a TTL or redeploying. The mechanism is **deterministic cache tags**: the read path stamps a tag, the webhook route derives the same string from the publish payload, and `revalidateTag` connects them with no shared state.

The Edge side (credential, registering the webhook, `lastRuns`, auto-disable) lives in `sitecoreai-edge-admin-webhooks`. This skill owns the head app.

## 1. Decide first: which template

| | `nextjs-app-router-cache-components` | `nextjs-app-router` (plain, the default) | `nextjs` (Pages Router) |
|---|---|---|---|
| SDK OSR | **Yes**: `src/app/api/revalidate/route.ts` + tagged `'use cache'` helpers in `src/lib/cache/` | **No** route, no `'use cache'` | **No**: time-based `revalidate` only |
| Freshness without OSR | TTL only (Next `default` profile: revalidate 900 s) | Time window + a redeploy after publish | `revalidate: 5` under SSG |
| Trap | The 2.4.0 tag defects (§ 2) | **Per-call `fetch({ next: { tags } })` is dead**: the SDK GraphQL client forwards only headers, so hand-wired fetch tags never reach the cache | No SDK `res.revalidate` helper |

- If "fresh within seconds of publish" is a requirement, scaffold with `--template nextjs-app-router-cache-components` (still App Router: `src/app/` exists, `src/pages/` does not).
- On the plain template the honest choices are: **migrate** (§ 8) or **accept a time window plus a redeploy**. Never hand-wire fetch tags.
- The Angular template also wires an OSR route (`createSitecoreRevalidateMiddleware`). Out of scope here.

## 2. Version floor (hard rule) `[probe-gated: P0]`

| Version | State |
|---|---|
| < 2.2.0 | No `createSitecoreRevalidateRouteHandler`, no cache-components template |
| 2.2.0 – 2.4.x | Route exists. **Item-level OSR cannot match a cached page**, three upstream defects (below) |
| `2.5.0-canary.20261001115411` | All three fixed. Same line **removes `tags[]`** from the request body |
| **2.4.1** (2026-10-12) | **First stable floor.** Release notes list all three fixes, and the shipped handler no longer reads `tags` from the body (code read 2026-10-13; not re-measured live) |

The three 2.4.0 defects (fixed upstream in #619, #620, #623):

1. **GUID format.** The webhook builds a dashless GUID, the read side tags a hyphenated one. Item tags never match.
2. **Version segment.** The read side tags `:v<N>` when layout reports `itemVersion`, the webhook tags `:latest`. Never matches.
3. **Dictionary over-invalidation.** With `sites` passed (the template default), every call appends `sc:dict:<site>:<locale>` for every site, and every page carries its site's `sc:dict` tag. So any authorised POST marks every page stale (default locale of each site only). This *masks* 1 and 2: it looks like OSR works. Without `sites`, item OSR is a silent no-op and pages refresh on the 900 s TTL.

   **What 3 does depends on the runtime** (live, 2026-10-02). On a local `next start`, the re-render after the first purge reused the cached layout data, so content stayed stale. **On Vercel the re-render refetched layout, so 2.4.0 + `sites` delivered the new content on every publish** (two of two, plus a direct POST): the cost is that **every authorised POST re-renders every page of every site in `sites.json`** (an unrelated page went `STALE` on an item-only POST; the canary left it `HIT`). A 2.4.0 app on Vercel therefore "works" and hides the defect behind a sitewide purge. Do not read a passing end-to-end test on 2.4.0 as item-level OSR.

Rules:

- **Floor = nextjs 2.4.1**, the first stable release containing #619 + #620 + #623 (2026-10-12). Before a newer claim, run `npm view @sitecore-content-sdk/nextjs dist-tags` and check the release notes. Do not ship the 2.4.0 workaround (strip `itemVersion`, rewrite identifiers to hyphenated GUIDs) unless the floor is unreachable; it is unverified.
- **Pin the SDK exactly** across the boundary. The fix changesets (2.4.1, and the 2.5.0 canary before it) are all `patch` and none flags the `tags[]` removal, so a `^2.4.0` lockfile refresh (which now pulls 2.4.1) silently breaks any caller that posts `{ "tags": [...] }`. Grep for `tags:` callers before upgrading.
- The upgrade also changes template files (`route.ts`, the template's agent docs): route it through `content-sdk-upgrade-assistant`.

## 3. The route contract

```ts
// src/app/api/revalidate/route.ts
import { createSitecoreRevalidateRouteHandler } from '@sitecore-content-sdk/nextjs/route-handler';
import type { SiteInfo } from '@sitecore-content-sdk/nextjs';
import scConfig from 'sitecore.config';
import sites from '.sitecore/sites.json';

export const { POST } = createSitecoreRevalidateRouteHandler({
  defaultLocale: scConfig.defaultLanguage,
  sites: sites as SiteInfo[],
  cacheProfile: { expire: 0 },   // § 5
});
```

| Option | Default | Effect |
|---|---|---|
| `secret` | `SITECORE_REVALIDATE_SECRET` | Compared to the `x-revalidate-secret` header with plain `!==` |
| `cacheProfile` | `'max'` | Passed to `revalidateTag(tag, profile)` |
| `defaultLocale` | `'en'` | Locale for rows without `entity_culture` |
| `sites` | none | 2.4.0: appends every site's `sc:dict` on every call. 2.4.1+: maps `DictionaryEntry` rows to `sc:dict:<site>:<locale>` by longest site-name prefix; an unknown site is skipped with a debug log only (case-sensitive) |

Responses: `200 { revalidated: true, tagsCount, invocation_id, continues }` · `401` secret mismatch · `400` body not JSON, not an object, or **zero resolved tags** · `500` error.

Mapping: strip a `-layout` / `-media` suffix from `updates[].identifier`, lowercase, strip braces, build `sc:item:…`. `entity_definition` and `operation` are ignored, so a `Delete` row (live: no `entity_definition` key at all, `operation: "Delete"`, sent on unpublish and on delete) resolves to the page's `sc:item` tag like an update, and the next read finds Edge's layout `null`, so the route renders not-found (the rows are live; the 404 render was not run end to end). Only the removed page's own rows arrive: pages linking to it are not refreshed (§ 7). 2.4.0 also accepts `tags[]` (an `sc:`-prefixed string verbatim, a bare value as an item id); 2.5.0 does not: **a tags-only body gets `400`** (live, canary), and `tags[]` next to `updates` is silently ignored.

**An OnUpdate Edge webhook is the only caller that gives item precision.** A CM webhook payload has no `updates`, and an OnEnd static body has no rows: on 2.5.0 both resolve zero tags and get `400`. **Edge retries a non-2xx without backoff until the 10-failure auto-disable, so one such publish disables the webhook** (live, with a 401: 10 deliveries in 7 s; with a 400: 10 over 137 s). The same holds for a wrong secret. **So the secret is verified before the webhook can deliver:** run the controls (Verify 2) against the deployed route first, and only then register (or enable) the OnUpdate webhook (`sitecoreai-edge-admin-webhooks` § 5).

## 4. Tag vocabulary

| Tag | 2.4.1+ shape | 2.4.0 (legacy) |
|---|---|---|
| Route | `sc:route:<site>:<locale>:<seg/seg \| _>` | same |
| Item | `sc:item:<hyphenated-lowercase-guid>:<locale>` | `sc:item:<guid>:<locale>:<vN \| latest>` |
| Dictionary | `sc:dict:<site>:<locale>` | same |

- Sanitiser: trim, lowercase, collapse `[/:\s]+` to `_`. Tags are case-sensitive in Next.
- `collectSitecorePageCacheTags({ site, locale, path, route })` returns route + item tag. **Pass `route`**, or the page is reachable by URL only.
- The dictionary helper runs from `src/i18n/request.ts`, so **every page carries `sc:dict`**.
- Next silently drops tags over **256 characters** and keeps at most **128 tags** per entry.
- Public builders: `collectSitecorePageCacheTags`, `buildSitecoreDictionaryCacheTag`. The item / route / webhook builders are `@internal`: do not import them.

## 5. `cacheProfile`: `'max'` vs `{ expire: 0 }`

- `'max'` (SDK default) = **stale-while-revalidate**. The first visitor after a publish gets the old page and triggers the refresh. Fine for low-stakes content.
- `{ expire: 0 }` = **blocking**. The next request refetches from Edge. Recommended for delivery sites, and the shape Next documents for webhook route handlers.
- Cost of `{ expire: 0 }`: a broad purge turns traffic into uncached Edge calls. Edge allows about 80 uncached requests per second, then `429`. Personalized pages multiply this: each variant has its own cache entry.

## 6. Personalization variants

The proxy rewrites variant requests to a `_variantId_` path segment. The route tag strips it, so all variants of a page share route and item tags: **one revalidation reaches every variant**. Do not add per-variant tags. Variant mechanics: `content-sdk-personalization`.

## 7. Coverage gaps (what OSR never reaches)

| Change | Why it is missed | Fallback |
|---|---|---|
| Shared datasource only | The page entry carries only the route-item tag. **Snapshot publishing re-emits the page's `Item` + `LayoutData` rows (live: a datasource-only publish refreshed the page on the 2.5.0 canary)**; runtime publishing does not (doc, not probed) | Snapshot publishing, or sitewide |
| Partial design | Docs disagree on whether dependent pages are re-emitted | Sitewide |
| Template, standard values, language fallback, Multilist targets, integrated GraphQL resolved at publish | Dependents are not re-emitted as rows | Sitewide or TTL |
| A URL cached as 404, then the page is published | A `null` page carries only the route tag; the publish sends the new item id | A short `cacheLife` on misses only (`{ revalidate: 60, expire: 600 }`, keep expire > 300), or a wrapper that also calls `revalidatePath` for new routes |
| `SiteInfo` row (site settings) | Becomes a junk item tag (`sc:item:<sitename>:all…`) | Sitewide |
| A page is unpublished or deleted | Edge sends `Delete` rows for that page only (live); pages whose navigation or lists link to it get no row | Sitewide after removals, or TTL |
| Sites added after build | Not in `.sitecore/sites.json`, so 2.4.1+ skips their dictionary rows | Rebuild |
| A low-code (atoms) Document edited in MMS | The MMS fetch carries no `sc:*` tag `[UNVERIFIED]` | TTL; and on beta.atoms the cache-components template returns **500** on every ComponentRef page (measured), its webhook module equals 2.4.0 (`content-sdk-app-router-atoms`) |
| A second locale | A dictionary fetch nobody reads still tags every page `sc:dict`; per-locale OSR (`sc:dict:<site>:<locale>` for a non-default locale) is still unprobed | Verify per locale (`content-sdk-app-router-dictionary-and-i18n`) |
| Multiple URLs / regions | Live: one revalidation reached both the production alias and the per-deployment URL; each URL is its own CDN entry, so under `'max'` each serves one stale read before refreshing. Multiple regions not tested | Verify live |

**Sitewide fallback:** a separate route (its own secret check) that calls `revalidatePath('/', 'layout')`, called from the pipeline **after** a bulk publish is readable on Edge. **Do not feed it from an OnEnd webhook:** one publish produced three OnEnd deliveries, two before Edge had the content (live), so a purge on those re-caches the old content. The post-publish redeploy stays the last resort. Keep a TTL as a backstop either way: a receiver that is down past Edge's retries (seconds to about 2 minutes) loses the delivery.

## 8. Migrating a plain-template app

Treat it as a porting task, not a one-line change. Scaffold a reference app with `--template nextjs-app-router-cache-components` at the app's exact SDK version and diff against it.

1. `next.config.ts`: `cacheComponents: true`.
2. `sitecore.config.ts`: `dictionary.caching.enabled = false` (the in-process dictionary cache outlives the tags).
3. Add `src/lib/cache/get-sitecore-page.ts`, `get-sitecore-dictionary.ts`, `get-sitecore-error-page.ts` from the reference (each: `'use cache'` as the first statement, fetch through the single client, `cacheTag` every applicable tag).
4. Page and `src/i18n/request.ts` read through the helpers; preview (`draftMode()`) reads stay direct.
5. `generateStaticParams` returns the build-validation placeholder, **never `[]`** (the opposite of the plain template).
6. Remove `export const dynamic = 'force-dynamic'` segments; wrap `cookies()` / `headers()` / `draftMode()` consumers in `<Suspense>`.
7. Port app-specific components the template lacks (for example a partial-design dynamic placeholder).
8. Add the route (§ 3) and `SITECORE_REVALIDATE_SECRET`; delete any hand-written revalidate route and any per-call fetch tags.
9. Error pages: take the reference app's `not-found.tsx`, `layout.tsx` and the `setCachedPageParams` calls before every `notFound()` **verbatim**; keep the authored `/404` a normal page with `noindex` (never `notFound()` for it, never a request API in `not-found.tsx`). Two measured upstream gaps: the error render sees **empty** `getCachedPageParams()` (a non-default-locale 404 shows the default language), and the template `global-error.tsx` pulls the server `Layout` into the client graph. Accept or work around them as `references/migration-traps.md` § 1, 2, 4 and 5 describe.
10. Local e2e on Windows: `experimental.isrFlushToDisk: false`, or a case-variant request half-rewrites a prerendered page on disk (§ 3 there).
11. Prove the migration on a **Vercel Preview** with `scripts/check-served-html.mjs` before anything reaches production (Verify step 0). Every trap in `references/migration-traps.md` passed build, `next start` and a full local e2e.

## Hard rules

- **Unset secret = open endpoint** (live on 2.4.0 **and** the 2.5.0 canary: no header, `200`). When `SITECORE_REVALIDATE_SECRET` is unset or blank, the handler checks nothing and anyone can force invalidation. Set it on **every** deployment target (production, preview, development) and fail closed: `if (!process.env.SITECORE_REVALIDATE_SECRET?.trim()) return new Response(null, { status: 503 })` before delegating to the SDK `POST`. Never weaken the check to "make the webhook work"; fix the caller's header.
- `'use cache'` is the **first statement in the function body**. A helper that fetches before it is not cached and fails silently.
- **Never cache the preview path.** `getPreview` / `getDesignLibraryData` under `draftMode()` stay outside `'use cache'`.
- **Never call `revalidateTag` from a component.** Invalidation belongs to the route handler. A server-to-server webhook calling it from a Route Handler is correct (the exception to `content-sdk-app-router-route-handler-vs-server-action`).
- **Tag completeness is the correctness condition.** A helper that caches but under-tags is unreachable by any publish.
- Never cache personalized, visitor-specific or request-dependent responses under content tags.
- **Never turn an Edge error into `notFound()`** (a `try/catch` around the page read in `page.tsx` or `generateMetadata`): the route cache stores a 404, or title-only metadata, for a real page. Let it throw: a 500 is not cached.
- **Never prerender a `notFound()` param, and never read a request API in `not-found.tsx`.** Together they emptied every page's PPR resume on Vercel (live 2026-10-15: pages cut at ~21 KB, no `</html>`, nothing hydrated) while `next start` was clean; the request API alone makes every unknown path a 500 (`DYNAMIC_SERVER_USAGE`).
- **No Cache Components change reaches production without a served-HTML pass on a Vercel Preview** (Verify step 0), and the same guard against the production deployment before it is promoted.

## Verify against reality

A preview pass and a local `next start` prove nothing about the live cache (preview has no Edge webhook at all).

0. **Served HTML on the deployed origin** (any Cache Components app, OSR or not). `next start` does not run Vercel's separate PPR resume invocation, so a resume that comes back empty is invisible locally. Run against the branch's Vercel Preview, then against the production deployment before it is promoted:
   ```sh
   MSYS_NO_PATHCONV=1 VERCEL_PROTECTION_BYPASS=… node scripts/check-served-html.mjs https://<deployment> \
     / /<locale> /<one-page-per-page-type> --expect-404=/zz-missing,/<locale>/zz-missing,/<page-type>/zz-missing
   ```
   Each path twice (cold resume, then cache HIT): status, `</html>`, flight chunks, size floor. When a known-broken deployment exists, run it there too: the guard must FAIL (negative control). An authored `/404` page is a normal 200 page (`noindex`) in the template shape: list it with the content paths, not under `--expect-404`.
1. **Static:** `npm ls @sitecore-content-sdk/nextjs` meets § 2; the route exists; the secret comes from env; `cacheComponents: true`; no per-call fetch tags (`grep -rn "next: *{" src/`).
2. **Controls** against the deployed URL (never follows redirects, so an SSO `302` is not a false pass; a Vercel Deployment Protection `401` is reported as a FAIL, not as the route's `401`; pass the bypass via `VERCEL_AUTOMATION_BYPASS_SECRET`):
   ```sh
   SITECORE_REVALIDATE_SECRET=… node scripts/revalidate-controls.mjs \
     --url https://<production-domain>/api/revalidate --item <page-item-guid> --site <site> --locale en
   ```
   Expected: no secret `401`, wrong secret `401`, OnUpdate rows `200` with `tagsCount ≥ 1`, `DictionaryEntry` row `200`. A `200` proves tags were accepted, not that a page was purged. The script exits non-zero on any failure. The correct-secret controls really revalidate those tags.
3. **Tag equality** (local): `DEBUG=content-sdk:revalidate` and compare the tag the read helper stamped with the tag the route derived. They must be byte-identical.
4. **End to end** after a real publish (a live-tenant write: get the user's go-ahead first), asserting the **content marker**, never `200`, `tagsCount` or cache headers:
   - Publish **twice** and judge the second: the first authorised POST after a deploy refreshes content even on a broken setup (P0 local; on Vercel 2.4.0 the first publish refreshed too).
   - Wait for the webhook, not for Edge: publish start → webhook took 86–175 s (live), 1–2.5 min after Edge already served the new value (23–60 s). **Budget about 3 minutes** before calling a publish missed. Poll the webhook's newest `lastRuns` entry (`sitecoreai-edge-admin-webhooks`).
   - Under `'max'` the first read after the webhook is `x-vercel-cache: STALE` with the old marker; the next read (5 s later, live) has the new one. Under `{ expire: 0 }` the first read should already be fresh.
   - Known-bad control: a page the publish did not touch must stay `HIT` on 2.5.x. If it goes `STALE`, you are on the 2.4.0 sitewide purge (§ 2).

## References

- `scripts/revalidate-controls.mjs`: the control set above (`--help`, `--dry-run`, `--self-test`). Live-tested 2026-10-02 against Vercel deployments of 2.4.0 and the 2.5.0 canary.
- `scripts/check-served-html.mjs`: the served-HTML guard (Verify step 0; `--help`, `--self-test`). Live 2026-10-16: exit 1 on the broken production deployment, exit 0 on the fixed Preview, 404 paths included.
- `references/migration-traps.md`: the measured traps of a plain-template migration, with the Next.js source behind each.
- `sitecoreai-edge-admin-webhooks`: registering the OnUpdate webhook that calls this route.
- `content-sdk-personalization`, `content-sdk-upgrade-assistant`, `sitecoreai-publishing`.
- [Next.js `revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) · [Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html)
