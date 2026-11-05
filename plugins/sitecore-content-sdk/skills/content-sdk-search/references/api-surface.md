# API surface: `@sitecore-content-sdk/search` 0.5.0 and the React hooks

Source: the installed packages under `node_modules/@sitecore-content-sdk/` (nextjs 2.4.0, react 2.4.0, search 0.5.0), read 2026-10-02 (cite the `.d.ts`, never prose).

| Symbol | Path |
|---|---|
| `SearchService`, `SearchParameters`, `SearchResponse`, `SuggestParameters`, `SuggestResponse`, `SearchServiceFetchOptions` | `search/types/search-service.d.ts` |
| `SearchDocument`, `FacetRequest`, `FacetField`, `FacetFilter`, `FacetResult`, `FacetValue`, `QuerySuggestionItem` | `search/types/models.d.ts` |
| `useSearch`, `useInfiniteSearch`, `useSuggest`, `SearchStatus` | `react/types/search/*.d.ts`, re-exported by `nextjs/types/search/index.d.ts` (exports map `"./search"`) |
| `useSearchService` (internal) | `react/dist/esm/search/utils.js` |

`SearchService` is **not** exported by `nextjs` or `react`. Import it from `@sitecore-content-sdk/search` (package entry `dist/esm/index.js`, no exports map) and make it a direct dependency.

## SearchService

```ts
new SearchService({ contextId: string, edgeUrl?: string })
// edgeUrl default: explicit → env SITECORE_EDGE_PLATFORM_HOSTNAME → https://edge-platform.sitecorecloud.io

search<T extends SearchDocument>(params: SearchParameters<T>, fetchOptions?: Omit<RequestInit,'method'|'body'|'mode'>): Promise<SearchResponse<T>>
suggest<T>(params: { searchIndexId: string; keyphrase: string; locale?: string }, fetchOptions?): Promise<{ querySuggestions: {text, queryPlusText}[]; previewResults: T[] }>
```

`SearchParameters<T>`: `searchIndexId` (required) · one of `keyphrase | seedItemId | seedItemUrl` (StrictUnion + runtime check) · `sort?: {name: dot.path, order:'asc'|'desc'} | […]` · `limit?` (default 10, max 500) · `offset?` (default 0) · `locale?` · `facet?: { all?: boolean; fields?: [{ name, filters?: [{ operator: 'eq'|'gt'|'lt'|'ge'|'le', value: primitive | primitive[] }] }] }`.

### Wire format

```http
POST {edgeUrl}/v1/search
x-sitecore-contextid: <context id>
Content-Type: application/json

{"config":{"id":"<searchIndexId>"},"limit":10,"offset":0,"query":{"keyphrase":""},
 "sessionId":"<analytics clientId or ''>","sort":{"fields":[]},"locale"?:"…","facet"?:{…}}
```

Response `{ content, total, facet }` is mapped to `{ results: content || [], total: total || 0, facets: facet }`. Suggest posts `{config:{id}, query:{keyphrase}, locale?}` to `/v1/search/suggest` (no `sessionId`, no seed fields).

`fetchOptions` is spread into the global `fetch` (`core/dist/esm/native-fetcher.js` `fetch()` → `getRequestInit`), so `next`, `cache`, `signal` and extra `headers` reach Next's fetch. `Content-Type` is always forced to JSON.

### Validation (client side, before any request)

| Input | Result |
|---|---|
| `limit < 0`, `limit > 500`, `offset < 0` | `RangeError` |
| `limit: 0` | **passes** (the check is `limit && …`) |
| no `searchIndexId` | `TypeError('Search index ID is required')` |
| `sort` not object/array | `TypeError` |
| two of keyphrase / seedItemId / seedItemUrl | `TypeError('Query fields are mutually exclusive…')` |
| empty or whitespace seed | `TypeError` |
| suggest with empty keyphrase | `TypeError('Keyphrase is required')` |
| no query field | sends `{keyphrase:''}` = whole index |

### HTTP errors (measured 2026-10-02, read-only)

| Case | Status | Body |
|---|---|---|
| fake context id, or no header | 404 | problem+json `{"title":"NotFound","detail":"No sitecore context","status":404}` |
| good context, unknown index id | 404 | `{"errors":[{"message":"no search index found for config <id>","code":404}]}` |
| context id as `?sitecoreContextId=` instead of the header | same as header (accepted) | |

In code these throw `Error('HTTP 404 Not Found')` with `e.response.status` and `e.response.data` (P8, server render). The success body of a real index is **[probe-gated: P4]**: capture it with `probe-search.mjs --out` before typing `SearchDocument`.

`sessionId` comes from analytics-core `getClientId()`; when the analytics plugin is not initialized (server, no Bootstrap, consent denied) the SDK swallows the error and sends `''`.

## Hooks

| Hook | Options (beyond `searchIndexId`) | Returns |
|---|---|---|
| `useSearch<T>` | `query, page (1-based), pageSize (10), sort, enabled (true), keepPreviousData, locale, facet, seedItemId, seedItemUrl` | `results, total, totalPages, facets, status, error, isLoading, isSuccess, isError, isPreviousData` |
| `useInfiniteSearch<T>` | `query, pageSize, sort, enabled, locale, facet, seedItemId, seedItemUrl` | `+ loadMore(), hasNextPage (results.length < total), isLoadingMore, isLoadingMoreError` |
| `useSuggest<T>` | `query, enabled, keepPreviousData, locale` (whitespace query stays idle; no debounce) | `querySuggestions, previewResults, status, …` |

`SearchStatus` = `'idle' | 'loading' | 'success' | 'error'`. The service is built by `useSearchService()` from `useSitecore().api.edge.clientContextId` + `api.edge.edgeUrl`; nextjs `defineConfig` fills them from `NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID` and `NEXT_PUBLIC_SITECORE_EDGE_PLATFORM_HOSTNAME` (`nextjs/dist/esm/config/define-config.js`). No client context id → service `null` → `idle` forever.

The `search` callback's dependency list includes `sort` and `facet` by reference; the effect re-runs whenever the callback identity changes. An inline object therefore loops (P8: 6,568 requests in 5 s).
