---
name: content-sdk-search
description: "SitecoreAI integrated search in a Content SDK head app: search hooks vs server SearchService, client-only rule, facets and sorting, starter port, consent-gated events. Use when adding search UI. Not Sitecore Search (rfk) or source setup."
license: Apache-2.0
compatibility: "@sitecore-content-sdk/nextjs 2.4.0 (pins @sitecore-content-sdk/search 0.5.0), Next.js 16 App Router, Node 24 (search engines.node >=24). Facets + locale need nextjs 2.3+, suggest + MLT need 2.4+. Scripts: Node 18+, no dependencies."
metadata:
  author: Christian Hahn
  version: "0.1.2"
---

# Content SDK: integrated search (head-app side)

SitecoreAI **Search experiences** ("integrated search") is queried from the head app with ONE public credential, the Edge context id, sent as `x-sitecore-contextid` to `POST https://edge-platform.sitecorecloud.io/v1/search` and `/v1/search/suggest`. No API key, no OAuth, no customer key. The index itself (a *search source*) is configured in the SitecoreAI UI: that half lives in the `sitecoreai-search-sources` skill.

Status markers: **[confirmed]** = measured on 2026-10-02 (live read-only probe or a local Next 16 build); **[source]** = read from the installed SDK; **[probe-gated: Pn]** = not proven yet, named probe closes it.

## Not this

| You want | Use | Not |
|---|---|---|
| Site/product search with marketer-tuned boost, pin, facets | **this skill** + `sitecoreai-search-sources` | Edge GraphQL `search(where:)` (filters an item's own fields only) |
| Exact structural queries (children of X, by template) inside a data fetch | Edge GraphQL / ComponentQuery (`sitecoreai-graphql-schemas`) | integrated search (index lags until a manual reindex) |
| Recommendations, widgets, `rfk_id`, customer key, `discover.sitecorecloud.io` | standalone Sitecore Search (CEC) | this skill |
| CM item lookup during authoring automation | Authoring GraphQL `search(query:)` | either search product |

## Preflight (all must pass before UI code)

1. **A source id exists.** Read it from the source's Settings tab (the "ID" is the `searchIndexId`), or list sources with the search-config script of `sitecoreai-search-sources` (needs a credential with the search-config scope). No source, no search: an unknown id answers 404 `no search index found for config <id>` **[confirmed]**.
2. **SDK floor:** `npm ls @sitecore-content-sdk/search`. Search rides on nextjs (nextjs → react → search). 0.4 (nextjs 2.3) adds `locale` + `facet`; 0.5 (nextjs 2.4) adds `suggest()` + MLT. Table: `references/version-matrix.md`.
3. **`NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID` is set** (`api.edge.clientContextId`). Without it `useSearchService()` returns `null` and every hook stays **`status: 'idle'` forever with zero requests and no error** **[confirmed: P8, 0 requests in 5 s]**. A missing `searchIndexId` instead gives `status: 'error'`.
4. **Live probe passes:** `node scripts/probe-search.mjs --context-env NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID --env-file .env.local --index <id>`. It runs a fake-context control first (must be 404 `No sitecore context`), then a fake-index control (must be 404 `no search index found`), then your query.

## Choose the surface

| Situation | Use |
|---|---|
| Interactive search box, pagination | `useSearch` / `useInfiniteSearch` from **`@sitecore-content-sdk/nextjs/search`**, in a `'use client'` component, inside a component-local `<Suspense>` |
| Typeahead | `useSuggest` (no built-in debounce: debounce the input yourself) |
| SEO-visible results, a "related content" block, a route handler | `new SearchService({ contextId })` on the server |
| Related items | MLT: `seedItemId` or `seedItemUrl` (site indexes only) instead of `keyphrase`; mutually exclusive **[source]**. GUID form **[probe-gated: P4]** |

**Import paths [source].** Hooks come only from the `/search` subpath; the docs' root-path import does not exist. `SearchService` is **not** re-exported by `nextjs` or `react`: import it from `@sitecore-content-sdk/search` and add that package as a **direct dependency pinned to the version `npm ls` shows** (it is only transitive, so strict package managers will not resolve it).

**Client-only rule [confirmed].** The hook dist files carry no `'use client'`. A Server Component calling `useSearch` **compiles fine** and then fails at prerender with `TypeError: (0 , c.useState) is not a function` (a dynamic route would fail at request time instead). Put the directive on the file that calls the hook.

## Server-side SearchService [confirmed: P8, Next 16.3.5]

- Works in a Server Component. `fetchOptions` is spread into the global `fetch`, so Next caching applies: with `{ next: { revalidate: 60 } }` the page prerenders at build (one upstream POST) and repeat requests inside the TTL cause **zero** upstream calls; under `dynamic = 'force-dynamic'` the same option still dedupes through the data cache (1 upstream call for 3 requests); `{ cache: 'no-store' }` calls every time.
- On the server `sessionId` is `''` (no analytics init): search works but is not tied to a CDP session.
- Errors throw `Error('HTTP 404 Not Found')` with `e.response.status` and `e.response.data` (`{ errors: [{ message, code }] }`). Catch it and render an empty state; do not let a missing index 500 the page.
- Type the call: `search<MyDoc>(…)`. The default `SearchDocument` value type is not a `ReactNode`, so `{r.results[0].title}` fails type-check.
- Whether a preview context returns different (draft) content than live **[probe-gated: P4]**. Both ids are accepted by the search plane **[confirmed]**.

## Hooks: the rules that bite

- **Memoize every `sort` and `facet` object [confirmed: P8].** They are `useCallback` dependencies compared by reference. An inline `facet={{ all: true }}` produced **6,568 requests in 5 s, 6,600 renders, status stuck at `loading`** (each render aborts the previous request). The `useMemo` version sent exactly 1. `check-search-wiring.mjs` fails the inline form.
- `limit` max 500 (RangeError); `limit: 0` passes validation **[source]**. An empty keyphrase returns the **whole index**.
- `page` is 1-based; `useInfiniteSearch.hasNextPage = results.length < total`.
- Each new request aborts the previous; aborted errors are suppressed.
- Hooks do **not** pass `locale` for you. Pass the route locale explicitly on a multi-language site; the accepted format (`en` vs `en-US`) **[probe-gated: P4]**.
- **Facet `name` is the facet's display name from the source config**, not the raw field name (SDK JSDoc). Operators `eq|gt|lt|ge|le`; string/boolean fields `eq` only; an array value means OR. Server behaviour **[probe-gated: P4]**. Discover names with `search-config.mjs`.

## Recipe: port the starter `SearchExperience`

The only official consumer is the SYNC starter (`xmcloud-starter-js/examples/kit-nextjs-product-listing/src/components/search-experience/`). Copy it, then fix these on the way in (diffs in `references/starter-port.md`):

1. **Encode `?q=`.** `useRouter.tsx` builds `` `?q=${value}` ``; `&`, `#`, `+` corrupt the URL. Use `encodeURIComponent(value)`.
2. **Compute `nullResults`.** `useEvent.tsx` hard-codes `nullResults: false`, so the dashboard's *Null searches* KPI can never fire. Pass `total === 0`.
3. **Gate the event on consent.** The starter calls `event()` directly. Route it through `trackEvent()` from `content-sdk-tracking-consent` (analytics category). Consent denied: no event, and `sessionId` is `''`, but search itself keeps working.
4. **Keep `<Suspense>` local.** `useSearchParams` needs a boundary for `next build`; the starter wraps all of `Providers`, which makes the whole tree client-rendered. Wrap only the search component.
5. **Type `SearchDocument` from your source's real fields** (the starter hard-codes SYNC product fields). Capture a response with `probe-search.mjs --out` first.
6. **Fail loudly on bad config.** `useSearchField` falls back silently on an empty value, `console.warn`s on invalid JSON, and casts valid JSON without validation (missing `searchIndex` → `undefined`). In editing, render an author-visible notice instead.
7. Also: the starter omits `componentInstanceId` from the event (A/B/n attribution); its `md:${baseClass}` grid class is built at runtime and is invisible to Tailwind's scanner, so safelist the three `md:grid-cols-*` classes.

CM side: the datasource template has ONE field `search` of type **Plugin** (Source = the Search Configuration Manager app) holding JSON `{ "searchIndex": "<source id>", "fieldsMapping": { title, description, type, link, images, tags } }`. Rendering `SearchExperience`, variants `Default` (`useSearch`, pages) and `LoadMore` (`useInfiniteSearch`), rendering parameter `columns` 1-3, dictionary keys `SearchExperience_*`. Item inventory: `references/starter-port.md`. The exact JSON the app writes **[probe-gated: P7]**.

## Editing, preview and verification

- **Search is disabled in Page Builder and Preview by design** ("available only on published pages"). Run the hooks only when `!isEditing && !isPreview`; render skeletons otherwise.
- So **a preview pass proves nothing**: verify on a **published** page or with `probe-search.mjs` against the live context. A test pass must list "search returns results" as unverifiable until the source is indexed and the page published.
- Content sources do not refresh on publish: a new item appears only after a manual *Reindex content* (`sitecoreai-search-sources`).

## Authorability

Results are index documents wrapped into fake `{ value }` fields; they are not Sitecore fields and not editable. Record a **per-field** waiver for the result fields in `.authorability-ignore.json` with that reason. The `search` config field *is* authorable (Plugin field, Search Configuration tab).

## Analytics

The starter's event is `event({ type: 'search', siteId, channel: 'web', name, language, core: { componentId, interactionType: 'viewed' | 'clicked', keyword, nullResults } })`, needing `analyticsPlugin` + `eventsPlugin` (`content-sdk-analytics-events`). `type: 'search'` is a documented SitecoreAI event, distinct from standalone Search's `SC_SEARCH_WIDGET_*`. Whether these events reach *Performance > Search*, and whether a debounced `viewed` per keystroke inflates the counts **[probe-gated: P7]**. `keyword` is user input: treat it as potentially personal data.

## Scripts

- `scripts/probe-search.mjs --context-env <VAR> [--env-file <f>] [--index <id>] [--keyphrase <q>] [--facet-all] [--suggest <q>] [--locale <l>] [--expect-results] [--out <file>]` — read-only; controls first; never prints the context id. Exit 1 when a control or the query fails.
- `scripts/check-search-wiring.mjs --app <dir> [--json]` — static gate. FAIL: hook file without `'use client'`, hooks imported from the package root, inline `sort`/`facet` literal or one built in the render body without `useMemo`, unencoded `?q=`, `nullResults: false` literal, `type: 'search'` event with no consent guard. WARN: `SearchService` without a direct `@sitecore-content-sdk/search` dependency, no client context id in env files, hook call without `locale`, search event without `componentInstanceId`, `<Suspense>` wrapping `Providers`, runtime-built Tailwind classes.
- Both: `--self-test` runs fixtures plus a mutation sweep that disables each guard in turn and fails if no case notices.

## Traps index

1. Bad context id → **404 `No sitecore context`** (problem+json), not 401; the same for no header at all. Do not read it as "endpoint missing".
2. Unknown index with a good context → **404 `{"errors":[{"message":"no search index found for config <id>","code":404}]}`**.
3. Missing client context id → hooks idle forever, silently.
4. Inline `sort`/`facet` → request storm.
5. Hook in a Server Component → prerender `useState is not a function`.
6. `SearchService` needs a direct `@sitecore-content-sdk/search` dependency.
7. Empty keyphrase returns everything; `limit: 0` is accepted.
8. Search does not run in Page Builder or Preview.
9. Starter: unencoded `?q=`, `nullResults: false`, ungated `event()`, Suspense around Providers, no `componentInstanceId`, runtime Tailwind class.
10. Do not confuse CM Solr `search(...)`, Edge `search(where:)`, standalone Search and integrated search.

## Related

`sitecoreai-search-sources` (sources, reindex, push, config read) · `content-sdk-tracking-consent` (`trackEvent`) · `content-sdk-analytics-events` · `content-sdk-app-router-editing-safe-rendering` · `content-sdk-variants-vs-siblings` (Default / LoadMore) · `content-sdk-component-naming-traps` (support files under `src/components/` auto-register) · `content-sdk-upgrade-assistant`.
