# Migration traps: measured on a live plain-template → Cache Components migration (2026-10-15/16)

Every trap below passed `next build`, `next start`, the unit suite and a full local e2e. Three of them only showed on a deployed origin.

## 1. A prerendered `notFound()` param empties every page's PPR resume (Vercel only)

**Shape.** `generateStaticParams` returned the authored `/404` page as a param, and that page calls `notFound()`. `not-found.tsx` read a request API (`connection()` under `<Suspense>`) so its body could pick the visitor's language per request.

**What production served.** Every catch-all page: HTTP 200, `x-nextjs-prerender: 1`, about 21 KB, no `</html>`, no `self.__next_f.push` flight chunks. The browser logged "Connection closed.", nothing hydrated, and no analytics fired. The page *looked* rendered: the static shell is real HTML.

**Why local passed.** Vercel serves the cached shell and then calls a separate resume invocation (`pprState: resuming`) to fill the postponed holes; that resume came back empty. `next start` renders in one pass and never takes that path.

**Fix.** Filter every `notFound()` param out of `generateStaticParams`, and keep `not-found.tsx` free of request APIs (trap 2). Proven with diagnostic Preview deployments, one variable per deploy.

## 2. A request API in `not-found.tsx` turns every unknown path into a 500

Once the 404 param is no longer prerendered, Next generates it on demand. The `notFound()` throw is then caught and the error payload is rendered under a `prerender-legacy` work store. In that store `connection()`, `headers()`, `cookies()` and `draftMode()` call `throwToInterruptStaticGeneration`, which throws `DynamicServerError` with digest `DYNAMIC_SERVER_USAGE`. The catch re-throws it, and the response is a 500 that renders Next's generic error page. A provider that reads `headers()` (for example `NextIntlClientProvider` without `setRequestLocale`) fails the same way.

Sources (Next 16.2.10): `server/app-render/app-render.js` (the catch that switches to `prerender-legacy`), `server/request/connection.js` (case `prerender-legacy`), `server/app-render/dynamic-rendering.js` (`throwToInterruptStaticGeneration`).

**Error pages: follow the template shape (SDK-first).** Take the reference app's `[[...path]]/not-found.tsx` (`getCachedPageParams()` + the cached, tagged `getSitecoreErrorPage`), its `layout.tsx`, and `setCachedPageParams({ site, locale })` before **every** `notFound()` in `page.tsx`. Keep the authored `/404` a normal page with `noindex` metadata (and out of the sitemap); calling `notFound()` for it is what built trap 1. Deviate only with a measured reason.

**Measured limitation (upstream defect, 2026-10-16):** in the not-found error render `getCachedPageParams()` is **empty**, on local `next start` and on Vercel. The render has its own React `cache()` scope and the page layout does not run there, so the `setCachedPageParams` calls never reach it. The template then falls back to `defaultLanguage`: an unknown path under a non-default locale gets the default-language 404. Two honest choices:

- **Accept it** (status, completeness and theme are right; only the language is wrong) until the SDK passes route params into the not-found render.
- **Work around it:** render one body per routed locale statically and pick the visible one on the client from `useParams().locale`; keep that tree in its own `'use cache'` scope with a short `cacheLife` (never `'days'`: a child that degrades silently, such as an empty nav after an Edge blip, is cached too and a failed read stamps no tag). Cost: more code you own, and the tree must stay out of page payloads (next point).

**Keep the 404 tree out of every page's payload.** `not-found.tsx` (segment and root) is evaluated in every page render although it is never shown there, so an authored 404 tree travels in each page's flight data: measured +25 KB per page (+30 KB and +0.8 s hydration at 6x CPU for a multi-locale tree). Guard it: when `getCachedPageParams()` is **filled**, you are in a page render, so return short static text; the empty-params error render keeps the authored body. Make the root `app/not-found.tsx` static text (it renders before any layout stores params). Retire the guard once the upstream fix fills the params in the error render.

## 3. Windows local e2e: case-insensitive disk aliases ISR entries

Routing is case-exact, so `/contact` is a separate on-demand ISR entry from the prerendered `/Contact`. With the default `isrFlushToDisk`, Next writes `<key>.html` (and `.meta`, segments) for the runtime entry, but writes `.rsc` only when the route is not PPR, and Cache Components routes are PPR. On NTFS `contact.html` **is** `Contact.html`, so one lower-case request rewrites the prerendered HTML and leaves the prerendered RSC. After a server restart the pair disagrees on the catch-all `path` segment key; after a server action the router refetches, sees a different key, and `<Activity>` keeps both trees: the old one visible and pristine, the new one (with the action's result) `display:none`. A form "does nothing".

**Fix.** `experimental: { isrFlushToDisk: false }` in `next.config.ts`. Runtime entries stay in the in-memory LRU, keyed case-exactly; prerendered files are only read. A no-op on Vercel (`next-server.js`: `!minimalMode && flag`). Trade-off on a long-lived self-hosted `next start`: a regenerated entry no longer survives a restart, so the build-time file is served until it goes stale again.

Related: a proxy that sets a cookie on every response makes every server action report `x-action-revalidated`, so each submit costs an extra RSC refetch of the page.

## 4. Error handling that caches the wrong answer

- **A `try/catch` around the page read that falls through to `notFound()`** turns any Edge failure (5xx, timeout, rate limit) into a 404 that the route cache **stores for a real page**; the not-found render then reads the same failing Edge and some paths become 500s. Measured on a fresh Vercel deployment: real pages served as cached 404 `HIT`s until they revalidated. The template has no such catch. Let the read throw: a `'use cache'` throw is an errored stream that the cache handler does not store, so the page is an uncached 500 and the next request recovers.
- **The same catch in `generateMetadata`** returns fallback metadata (title only, no canonical, no hreflang) that is cached for the route while the body renders fine. Remove it too.
- **Unknown site or locale:** with the catch gone, Edge throws for an unrouted locale (500). Answer `notFound()` before any Edge read when the site is not served or the locale is not routed (exempt draft mode).
- **Cached misses:** a `null` page carries only an `sc:route` tag, and the webhook purges item tags, so a page requested before its first publish stays 404 for the whole cache life (`'days'` = up to a day). On a miss also call `cacheLife({ revalidate: 60, expire: 600 })`; Next keeps the shortest, and expire must stay above 300 s or the entry turns dynamic. Do not shorten the error-page helper: it sits in every render and would shorten every route.

## 5. Platform side of the 404

- **LIVE Edge `errorHandling`** is projected once per site in the Site Grouping language, while PREVIEW resolves per request (the usual preview-versus-live divergence). A 404 page that exists only in a non-default language is never returned on LIVE. Fix order (measured): give the 404 page a version in the site language (copy its `__Final Renderings`: the new version came back empty), publish it, **then** republish the site's Settings + Site Grouping items. Within about 2 minutes every language resolved its own version. Republishing without the site-language version changes nothing. The settings republish reported 82 `additionalItemsSent` with children and related off: expect a wider scope than requested.
- **Template `global-error.tsx`** is `'use client'` and imports the server `Layout`. The build fails (Turbopack: inline `'use cache'` in a Client Component) as soon as any component reachable from `Layout` imports a `'use cache'` helper, for example a footer reading the dictionary. Use a client-safe error layout there.

## 6. Smaller traps from the same migration

- A provider that changes its context value after hydration (a theme provider) makes React discard the hydrated tree.
- Motion code that mutates streamed DOM before hydration raises React #418; "hydrates clean" specs on harness pages missed it, a real-route spec caught it.
- Navigation has no SDK tag: request-time nav under `<Suspense>` broke soft navigation; cache it per linked item (`sc:item` per locale) with a short `cacheLife` fallback.
- On a shared Edge context every brand's publish reaches the webhook; wrap the route so a zero-tag batch answers 2xx, or ten 400s auto-disable it.
