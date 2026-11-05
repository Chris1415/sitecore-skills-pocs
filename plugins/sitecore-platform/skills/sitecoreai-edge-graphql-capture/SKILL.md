---
name: sitecoreai-edge-graphql-capture
description: "curl recipes for Experience Edge GraphQL: endpoint, introspection depth trap, complexity vs pagination, ComponentQuery budget, site, route and layout queries. Use to capture a snapshot, probe live data without the SDK or debug Edge queries."
license: Apache-2.0
compatibility: "Requires Node 18+ (for the bundled script) or curl, and a valid `SITECORE_EDGE_CONTEXT_ID` from `.env.local`. No Sitecore CLI / auth flow needed — Edge Delivery is unauthenticated (the contextId in the URL IS the access control)."
metadata:
  author: Christian Hahn
  version: "0.4.3"
---

# Sitecore Edge GraphQL — Capture Recipe

How to talk directly to Sitecore Experience Edge with `curl` and produce an `edge-snapshot/` folder (introspection + per-pattern layout JSON) for a playground or a product. No SDK, no CLI, no auth header — just POST + GraphQL.

## When to use

- Initializing the `edge-snapshot/` of a new playground (per `content-sdk-playground-pattern`).
- Capturing per-type introspection to pin Sitecore types as a reference fixture.
- Probing live layout / sites / routes without booting the head app.
- Debugging Edge errors (depth-limit, complexity-limit, unknown-arg) seen from the SDK.
- Reproducing a layout response from the command line for sharing in a bug report.

## Endpoint and auth

```
POST https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1?sitecoreContextId=<CONTEXT_ID>
Content-Type: application/json
```

- **No `Authorization` header.** The `sitecoreContextId` in the query string IS the access control. Treat it like a public-ish API key — anyone with it can read your Edge data, but they can't write.
- **Two distinct Edge URLs.** Don't confuse:
  - `https://edge-platform.sitecorecloud.io` — service endpoints incl. GraphQL (this skill).
  - `https://edge.sitecorecloud.io` — media URL replacement only (legacy / asset CDN).
- **POST is required.** GET is not accepted. There is NO `/schema` URL that returns SDL — you must POST a query.

## The Edge limits to plan around

### 1. Query depth limit: **15 levels**

The standard GraphQL "full IntrospectionQuery" (the one every GraphiQL ships with) is 26 levels deep. It will fail with:

```json
{"errors":[{"message":"Query is too nested to execute. Depth is 26 levels, maximum allowed on this endpoint is 15.","extensions":{"code":"INVALID_OPERATION"}}]}
```

**Workaround:** use per-type introspection (see § Workaround below). Do NOT try to fetch the whole schema in one shot.

### 2. Query complexity limit (no published number — scales with page size + nesting)

A wide pagination (`first: 100`) with a moderately nested selection will be rejected as too complex:

```json
{"errors":[{"message":"Query is too complex to execute. The field with the highest complexity is: ...","extensions":{"code":"INVALID_OPERATION"}}]}
```

**Empirical rule of thumb (verified on the training tenant 2026-05-27):**
- `routes(first: 4, …)` with selection `{ routePath route { id name } }` → too complex
- `routes(first: 100, …)` with selection `{ routePath }` → too complex
- `routes(first: 10, …)` with selection `{ routePath }` → works

So: **shrink page size first, then shrink selection set.** Paginate with `after` cursor across multiple requests rather than fetching everything in one call.

**A literal `first:` costs more than a variable** (preview, measured 2026-10-02): `siteInfo.dictionary(first: 61){ results{ key value } }` is too complex, while `first: $f` with `f = 1000` resolves. Pass page sizes as variables, as the SDK does. `first: 1001` is a warning plus clamp on live and a hard error on preview. The `language` argument is case-insensitive.

**Measured on a real preview endpoint, 2026-08-11** (a 7-item `children` connection —
so this is the SELECTION cost, not a data-volume effect):

| Query | Result |
|---|---|
| `children(first:20)` each with a nested `units(first:30)` connection + one field | **refused** |
| `children(first:50)` selecting `name displayName` + two `field(...)` | **refused** |
| `children(first:50)` selecting two `field(...)` only | ok |
| `children(first:30)` selecting `name` + two `field(...)` | ok |
| `children(first:50)` selecting `id name` (no `field(...)`) | ok |

Two things that table shows and prose does not:

1. **`field(name:"X"){ value }` selections are expensive** — far more than plain `name`/`id`.
   Dropping one redundant scalar (`displayName`) was enough to bring a refused query back
   under budget at the same page size.
2. **A connection INSIDE a connection is the reliable way to exceed it.** No reduction of the
   outer `first:` rescued a "developments each with their units" aggregate. Fetch the parents
   in one flat query and the children per-parent (deliberate N+1), deduplicated with
   `React.cache()` so components on one page share the fan-out.

> ⚠️ **THE FAILURE IS LOUD AT THE ENDPOINT AND SILENT IN THE UI.** Every sensible consumer
> catches the rejection and degrades — so an over-budget query shows up as an empty select, a
> missing count, or a section that vanished, none of which look like a query error. One
> instance shipped this way and was found by reading the rendered page, not by a test.
> **Probe the budget with a single POST whenever a query grows a field or raises `first:`.**

### 2b. A rendering's `ComponentQuery` budget (measured 2026-09-26 → 28, preview Edge)

A `ComponentQuery` runs through the same limits, and one build hit them on six of about twenty
renderings. The numbers below are one tenant's ceilings. They tell you what to probe first; they never
replace the probe:

| Shape | Measured |
|---|---|
| Depth 1: `children(first:50)`, 2 row fields + `template{name}` | too complex. `first:10` resolves. |
| Depth 3, three nested `children(first:N)` | The limit is the **product** of the three `first` values: about 15 passes (5·1·3), 16 fails (4·2·2), whichever level carries the weight. |
| Rows at real counts | Complexity tracks **row fields × `first`**. A 9-field row union failed at `first:14`; 8 selections held at `first:16`. Field types weigh differently: a 7-field row topped out at 14, a 4-field row at 21. |
| `field(name:){jsonValue}` selections | About **11** per query (11 passes, 12 fails) before *"Query is too nested … Depth is 17"*, whatever `first` is. |
| Three sibling `children` connections | *"Depth is 18 … maximum 15"*, whatever the field count. The depth ceiling is 15. |
| `children` nested **two levels** inside a `ComponentQuery` | **Fails silently.** The rendering arrives with `isContentResolved: false`, no fields and no error, because the SDK swallows it. The same query succeeds as a standalone `client.getData`. |
| A standalone 2-level `getData` (groups × links) | Groups × links up to about **22** passed (1×22, 2×11, 3×7, 4×5); 2×12, 3×8 and 4×6 failed. |

What follows from the table:

- **Keep a `ComponentQuery` to one level of `children`.** Fetch deeper rows server-side with `client.getData`, one call per parent, in parallel.
- **`first` must be strictly greater than the authored row count.** Edge returns the first N rows with no error, so a row an author adds past `first` is **silently dropped** from the page. When the budget cannot hold that headroom, move secondary fields (images, logos, labels) to a server-side fetch. If the field set cannot shrink further, record the ceiling as the list's maximum authorable row count.
- **Probe from a file with a direct POST, never through the app.** The app turns a rejection into an empty component, and the error text naming the limit is visible only at the endpoint.

### 3. No GET schema retrieval

Endpoints like `/v1/content/api/graphql/v1/schema` and `?query=schema` both return `{"errors":[{"message":"No query was provided!"}]}`. The only way to get type info is per-type introspection via POST.

## Workaround: per-type introspection (one POST per type)

```bash
# Single type (e.g., Item)
curl -s -X POST "$EDGE_URL?sitecoreContextId=$CTX" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ __type(name: \"Item\") { name kind fields { name description args { name type { name kind } } type { name kind ofType { name kind } } } } }"}'
```

**The canonical type list to capture for an `edge-snapshot/`:**

| File | Type |
|---|---|
| `type-LayoutData.json` | `LayoutData` |
| `type-Item.json` | `Item` |
| `type-ItemField.json` | `ItemField` |
| `type-RoutesResult.json` | `RoutesResult` |
| `type-SearchPredicate.json` | `SearchPredicate` |
| `type-SiteData.json` | `SiteData` |
| `type-SiteInfo.json` | `SiteInfo` |

These cover the head-app-relevant surface. Add others (`ItemTemplate`, `ItemLanguage`, `ItemUrl`, etc.) if your work needs them.

## Sites + routes discovery (two queries — don't combine)

### All sites
```bash
curl -s -X POST "$EDGE_URL?sitecoreContextId=$CTX" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ site { allSiteInfo { total results { name hostname language rootPath } } } }"}'
```

### Routes for one site (paginate with `first: 10`)
```bash
curl -s -X POST "$EDGE_URL?sitecoreContextId=$CTX" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ site { siteInfo(site: \"<siteName>\") { name rootPath routes(first: 10, language: \"en\") { total results { routePath } } } } }"}'
```

**Argument gotchas (will silently confuse you if you guess):**
- `siteInfo` takes `site: String!` (NOT `name: String!`).
- `routes` takes `language: String!` REQUIRED (omitting it returns an error).
- For sites with >10 routes, paginate with `after: "<cursor>"` from the previous page's `pageInfo.endCursor`.

## Layout capture (the actual rendered tree)

```bash
curl -s -X POST "$EDGE_URL?sitecoreContextId=$CTX" \
  -H "Content-Type: application/json" \
  --data '{
    "query": "query ($routePath: String!, $language: String!, $siteName: String!) { layout(routePath: $routePath, language: $language, site: $siteName) { item { rendered } } }",
    "variables": { "routePath": "/", "language": "en", "siteName": "training" }
  }'
```

`item.rendered` is opaque JSON (no GraphQL type — see `content-sdk-resolver-patterns` for what's inside). Save the raw response to `layouts/<page-or-pattern>.json`.

**For probing multiple patterns**, capture one layout per page that demonstrates a distinct delivery model:
- `layouts/components-standard-datasource.json` (a page using a standard datasource rendering)
- `layouts/components-all-fields-datasource.json` (a page using the field-type-catalog rendering)
- `layouts/components-integratedgraphql.json` (a page using an Integrated GraphQL rendering)
- `layouts/components-content-resolvers.json` (a page using one or more content resolvers)

## Capture script (bundled, one-shot)

`scripts/capture-edge.mjs` writes the canonical `edge-snapshot/` layout — per-type introspection, `sites.json`, `routes.json` (every page, paginated with `after`), one `layouts/<route>.json` per route — with no dependencies beyond Node 18:

```bash
SITECORE_EDGE_CONTEXT_ID=… node scripts/capture-edge.mjs --site <siteName> [--language en] [--out edge-snapshot] [--max-routes 50]
```

It pages routes **10 at a time**: on its first live run `first: 50` + `pageInfo` was rejected as *"Query is too complex to execute"* (2026-09-16) — the § 2 limit, reproduced. Exit 1 on any Edge error; the erroring response is still written so the limit that fired is inspectable.

## Hard Rules

- **Always POST.** GET isn't supported; there's no `/schema` URL.
- **No auth header** — the `sitecoreContextId` in the query string IS the auth. Putting `Authorization: Bearer …` is silently ignored.
- **Never run the standard "full IntrospectionQuery"** — it's >15 levels deep and Edge will reject it. Use per-type introspection.
- **Shrink page size before shrinking selection** when hitting complexity limits — `first: 10` is the safe default for `routes`.
- **`siteInfo(site: …)`, not `siteInfo(name: …)`.** Easy to misremember from the response shape.
- **`routes(…, language: "<lang>")` is REQUIRED.** Omitting it returns a missing-arg error, not an empty result.
- **`item.rendered` is opaque JSON** — there's no GraphQL type for what's inside. Use `content-sdk-resolver-patterns` to interpret.
- **Don't commit `.env.local`** — the contextId there is project-specific. Document only in `.env.example`.

## Stop Conditions

- **Don't try to scrape the full schema in one query.** The depth limit ensures this will always fail; per-type is the only path.
- **Don't combine `allSiteInfo` and `siteInfo.routes` in one query** — both work alone, together they trip complexity limits. Split into two POSTs.
- **Don't paginate routes with `first: 100`** even if the site has 4 routes — the complexity calculation is based on the cap, not the actual count.
- **Don't capture and commit a Layout JSON containing real PII** — these snapshots end up in `edge-snapshot/` which IS committed; treat them as public-visible content.

## Verification

- The endpoint should return `{"data":{"__schema":{"queryType":{"name":"Query"}}}}` for the smoke query `{ __schema { queryType { name } } }`.
- Per-type introspection responses should have shape `{"data":{"__type":{"name":"<Type>","kind":"OBJECT|INTERFACE","fields":[...]}}}`. An empty `__type` (`null`) means the type doesn't exist on this tenant.
- Layout query should return `{"data":{"layout":{"item":{"rendered":{"sitecore":{"context":...,"route":...}}}}}}`. An empty `route` means the path doesn't exist or isn't published.

## Related

- `content-sdk-playground-pattern` — the workspace layout that consumes `edge-snapshot/`.
- `content-sdk-debug-layout-probe` — for capturing layout responses through the head app's `/api/layout-debug` route (alternative to direct curl when the SDK's pre-processing matters).
- `content-sdk-resolver-patterns` — for interpreting `item.rendered` once you have it.
- `sitecoreai-graphql-schemas` — the broader catalog of types across Authoring + Edge endpoints.

## References

- Endpoint default: `@sitecore-content-sdk/core/dist/cjs/constants.js` → `SITECORE_EDGE_PLATFORM_URL_DEFAULT = 'https://edge-platform.sitecorecloud.io'`.
- The 15-depth limit was captured as the actual error response of a full introspection (2026-05-27); the per-type workaround above is the measured way around it.
- Live-tested 2026-05-27 against a live SitecoreAI tenant.
