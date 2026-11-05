---
name: sitecoreai-graphql-schemas
description: "Introspection-verified reference for the SitecoreAI GraphQL endpoints (Authoring; Edge, Preview, Live): root queries, item, field and template shapes, mutations, pitfalls. Load before writing a GraphQL query, so shapes are cited."
license: Apache-2.0
compatibility: "Schemas captured 2026-05-05 via live introspection of a SitecoreAI tenant. Sitecore evolves the schemas; if a real-tenant call surprises a developer, re-introspect using references/introspection-query.graphql and update."
metadata:
  author: Christian Hahn
  version: "0.6.5"
  schema_capture_date: "2026-05-05"
  source_tenant: "a live SitecoreAI tenant (Authoring GraphQL v1 + Experience Edge); hostname withheld"
---

# SitecoreAI GraphQL schemas — Authoring + Edge

> **This skill is the schema reference; it is NOT the SDK call reference.** Use this with `marketplace-sdk-xmc` (which documents the SDK envelope: `xmc.authoring.graphql` is a `client.mutate`, `xmc.preview.graphql` is a `client.query`, response unwrap rules, etc.). This skill answers "what GraphQL fields actually exist on the server?"

## When to load

- Before writing or reviewing any `xmc.authoring.graphql` body (any item read or write, item template introspection, search, publishing, language management, role/user management).
- Before writing or reviewing any `xmc.preview.graphql` / `xmc.live.graphql` body (read-only published-content access — Edge endpoint).
- When the `.d.ts` for `xmc.*.graphql` shows `data: [key: string]: unknown` and you need to know what shape to expect underneath.
- When porting a query that worked in MVC/JSS days — the parameter names and where-clause shapes have changed.

## Endpoints at a glance

| Endpoint | URL pattern | Auth | Schema flavor | Use for |
|---|---|---|---|---|
| **Authoring** | `https://<tenant>.sitecorecloud.io/sitecore/api/authoring/graphql/v1` | `Authorization: Bearer <OAuth-JWT>` | Generic — `Item`/`ItemField`/`ItemTemplate` work for any template | Read **unpublished** content, mutate items, manage versions, publishing, sites, roles, users |
| **Edge / Preview / Live** | `https://<tenant>.sitecorecloud.io/sitecore/api/graph/edge` | `sc_apikey: <api-key>` | Concrete-types-per-template — every Sitecore template gets its own GraphQL type (Edge schema introspected with 872 types in the test tenant) | Read **published** content via typed queries; layout / route resolution; Pages-app preview rendering |

The SDK calls map onto these endpoints:

- `xmc.authoring.graphql` → Authoring endpoint (via the portal's bearer-token bridge).
- `xmc.preview.graphql` → Edge endpoint, preview variant. (Confirm via `node_modules/@sitecore-marketplace-sdk/xmc/dist/...client-authoring/types.gen.d.ts` and `client-pages-or-equivalent` / preview module's `.d.ts`.)
- `xmc.live.graphql` → Edge endpoint, live variant.

When **inside a Marketplace app**, use the SDK call (the portal handles auth). The direct-curl form documented below is for introspection / spike work.

---

## 1. Authoring schema — verified shapes

The verified Authoring shapes — root `Query`, `ItemQueryInput`, `Item`, `ItemField`, `ItemTemplateField`, the connection types and the mutation surface — are in `references/authoring-shapes.md` (distilled JSON in `references/authoring-types.json`). **Open it before writing any `xmc.authoring.graphql` query** — citing a verified shape is the whole point of this skill.

## 2. Edge / Preview / Live schema — verified shapes

**872 types total.** Edge schema is **dramatically different** from Authoring — it's a "concrete-types-per-template" model. Every Sitecore template (Accordion, ArticlePage, BrandList, ...) becomes its own GraphQL type with strongly-typed fields. The 14-type distilled subset for the generic `Item` lives at `references/edge-types.json`.

### 2.1 Root `Query`

```graphql
type Query {
  item(path: String, language: String!, version: String): Item
  layout(site: String!, routePath: String!, language: String!): LayoutData
  search(where: ItemSearchPredicateInput!, after: String, first: Int, orderBy: ItemSearchOrderByInput): ItemSearchResults
  site: SiteData
}
```

That's it — **only 4 root queries on Edge.** No mutations (Edge is read-only).

### 2.2 ⚠️ Trap — `version` is `String` on Edge, `Int` on Authoring

```graphql
# Edge:
item(path: $path, language: $lang, version: "5") { ... }       # String!

# Authoring:
item(where: { path: $path, language: $lang, version: 5 }) { ... }   # Int!
```

When porting between endpoints, this trips up implementations. The `$version` variable type must match the endpoint.

### 2.3 Edge `Item` (generic; concrete templates inherit)

```graphql
type Item {
  id(format: String): ID!
  name: String!
  displayName: String
  path: String!
  url: ItemUrl!
  language: ItemLanguage!
  languages: [Item]!
  version: Int!                       # the resolved version (always Int on output)
  template: ItemTemplate!
  parent: Item
  ancestors(hasLayout: Boolean, includeTemplateIDs: [String]): [Item]!
  children(hasLayout: Boolean, includeTemplateIDs: [String], first: Int, after: String): ItemSearchResults
  hasChildren(...): Boolean!
  fields(ownFields: Boolean): [ItemField]!
  field(name: String!): ItemField
  rendered: JSON!                     # JSON-rendered form for headless heads
  personalization: ItemPersonalization
}
```

Key differences vs Authoring:

- No `versions(allLanguages: ...)` — Edge serves one version at a time.
- `fields` returns `[ItemField]!` directly, not a Connection. `ownFields: Boolean` is the only arg.
- `rendered: JSON!` — gives back the headless rendering shape (used by Content SDK heads).
- `id(format: String)` (lowercase, takes a String) vs Authoring's `itemId(format: IdFormat)` (typed enum).

### 2.4 Concrete template types

For any template the tenant uses — say, `ArticlePage` — Edge exposes a typed object:

```graphql
type ArticlePage {
  ... # specific fields per template
  ... # plus all the generic Item fields
}
```

This means a Pages-aware client can write strongly-typed queries. For a generic content diff (no template-specific knowledge), use the generic `Item` interface paths.

### 2.5 `LayoutData` (the layout query)

```graphql
type Query {
  layout(site: String!, routePath: String!, language: String!): LayoutData
}
```

Returns a typed layout/rendering tree for a route. **Used by Content SDK** for headless rendering. Useful for Marketplace apps that want to inspect the rendered layout per route — though for per-version layout, the Authoring endpoint's `Item.field(name: "__Final Renderings")` is more direct.

### 2.6 `ItemSearchResults` and search

Edge `search(where: ItemSearchPredicateInput!, ...)` returns:

```graphql
type ItemSearchResults {
  total: Int!
  pageInfo: PageInfo!
  results: [Item]
  facets: [ItemSearchFacet]!
}
```

`ItemSearchPredicateInput` supports faceted queries; useful for content-discovery apps.

Edge `search(where:)` and Authoring `search(query:)` are **item search over CM / Edge**, not SitecoreAI integrated search sources (`sitecoreai-search-sources`, `content-sdk-search`).

---

## 3. Auth — verified

| Endpoint | Header | Source |
|---|---|---|
| **Authoring** | `Authorization: Bearer <OAuth2-JWT>` | OAuth2 client-credentials grant (per `sitecoreai-auth`); Marketplace SDK manages this internally for `xmc.authoring.graphql`. |
| **Edge / Preview / Live** | `sc_apikey: <API-KEY>` | Per-environment Edge API key from Cloud Portal. |

⚠️ The API key header for Edge is named `sc_apikey` (lowercase, with underscore) — **not** `Authorization`, **not** `X-API-Key`, **not** `apiKey`. Confirmed via 200-vs-403 test on the introspected tenant.

⚠️ The Authoring header is `Authorization: Bearer <token>` — **not** `sc_apikey: bearer <token>`. The latter returns HTTP 200 with a GraphQL `errors` array (`"The current user is not authorized to access this resource"`), which is misleading because it looks like a successful HTTP exchange.

---

## 4–6b. Worked examples

Four copy-ready examples live in **`references/worked-examples.md`**, section numbers kept:

- **§ 4** — fetch two versions of an item with all field values + types in one query (batched `versions()` form, alias-per-version fallback, SDK call wrapper).
- **§ 5** — fetch item template field metadata (fallback for field-type detection).
- **§ 6** — fetch published content via Edge.
- **§ 6b** — upload a media item and link it onto a field (Authoring, 2-STEP `uploadMedia` → POST binary).

## 7. Pitfalls and gotchas

1. **`version` arg type differs.** Authoring `Int!`, Edge `String`. Mismatched variable type → cryptic GraphQL validation error.
2. **`where:` is mandatory on Authoring.** No `item(path: ..., language: ...)` shortcut — wrap in `where: { ... }`.
3. **Authoring `fields(...)` connection requires three args with no defaults.** `excludeStandardFields: Boolean!`, `ownFields: Boolean!`, `withLanguageFallback: Boolean!` — all marked NON_NULL, so omitting them errors out.
4. **`ItemField.value` is always `String!`.** Image fields return XML strings (e.g. `<image mediaid="{...}" alt="..."/>`); Link fields return XML; multilist returns pipe-separated GUIDs. Parse client-side per field type.
5. **`ItemPublish` and `ItemAccess` are nested objects, not booleans.** `Item.publish.published` (or similar) — verify the exact subfield via introspection.
6. **`xmc.authoring.graphql` is a MUTATION on the SDK.** Single `.data` unwrap, not double. The schema underneath has a `Query` root, but the SDK call signature is `client.mutate(...)` because the SDK wraps both reads and writes through the same POST endpoint. See `marketplace-sdk-xmc` § 8b for the unwrap matrix.
7. **Edge schema is huge** (872 types in this tenant) because every Sitecore template gets a generated GraphQL type. Trying to search the type list by name is faster than reading the introspection JSON top-to-bottom.
8. **Edge `Item.fields: [ItemField]!` is plain list, not a Connection.** No pagination, no `nodes` wrapper — just access the array.
9. **The "`/ide/`" suffix is a 404 on the Edge endpoint** — drop it. The base URL is `/sitecore/api/graph/edge` (no trailing path).
10. **JWT bearer tokens expire.** The OAuth client-credentials token typical lifetime is 24h; re-acquire per `sitecoreai-auth`. The Marketplace SDK handles this internally for in-app calls.
11. **A write is validated as a string, never as the field type** (measured 2026-09-26 → 29). `updateItem` / `createItem` accept a newline-joined multi-value field, an undashed GUID or an unescaped `&` in Link XML. They read it back unchanged and report success. Then inheritance resolves zero fields, the page loses its layout, or the link renders empty. Multi-value fields are `|`-joined on **write** as well as read, and GUIDs are braced, dashed and uppercase. The full table is in the `content-sdk-create-component` skill, section "Write-side wire formats" of its GraphQL sequence reference (install `sitecore-content-sdk` to get it).
12. **Language reads lie in two ways** (measured 2026-10-02). Authoring `language(name:)` returns a value for any valid culture, so it is no existence check (use `languageItem`). Edge preview counts a **literal** `first:` toward complexity: `siteInfo.dictionary(first: 61){ results{ key value } }` is "Query is too complex", while the same value passed as a variable works up to 1000. `first: 1001` is a warning plus clamp on live and a hard error on preview. The Edge `language` argument is case-insensitive. Shapes: `references/authoring-shapes.md` § 1.8.

---

## 8. Re-introspecting the schemas

The schemas WILL evolve. When in doubt, re-introspect:

```bash
# Edge / Preview
curl -sS -X POST 'https://<tenant>/sitecore/api/graph/edge' \
  -H 'Content-Type: application/json' \
  -H 'sc_apikey: <YOUR-EDGE-KEY>' \
  --data-binary @references/introspection-query.graphql.json \
  -o edge-schema.json

# Authoring
curl -sS -X POST 'https://<tenant>/sitecore/api/authoring/graphql/v1' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <YOUR-OAUTH-JWT>' \
  --data-binary @references/introspection-query.graphql.json \
  -o authoring-schema.json
```

(The `.json` form is the introspection query wrapped as `{"query": "..."}` per GraphQL POST convention. References ship the query in `.graphql` form for human reading; wrap before posting.)

After re-introspecting, `python -m json.tool < schema.json | grep '"name"' | sort -u` to spot newly-added types or removed ones, and update `references/{authoring,edge}-types.json` here if the changes affect any of the documented types.

---

## 9. Cross-references

- `marketplace-sdk-xmc` — SDK envelope, `xmc.authoring.graphql` / `xmc.preview.graphql` call signatures, module-vs-experimental modes, response unwrap matrix.
- `marketplace-sdk-client` — `client.query` vs `client.mutate`, params-wrapper behavior (Mode A wraps body under `params`, Mode B doesn't), error codes.
- `sitecoreai-auth` — OAuth2 client-credentials grant for Authoring header.
- `sitecoreai-pages` / `sitecoreai-publishing` / `sitecoreai-sites` — REST equivalents (when the SDK has no GraphQL surface).

---

## 10. Files in this skill

- `SKILL.md` — this file.
- `references/worked-examples.md` — the four worked examples (§ 4 two-version fetch, § 5 template field metadata, § 6 Edge fetch, § 6b media upload + link).
- `references/introspection-query.graphql` — the introspection query used.
- `references/authoring-types.json` — distilled subset of the Authoring schema (37 types most relevant to content reads/writes/templates/publishing).
- `references/edge-types.json` — distilled subset of the Edge schema (14 types covering generic `Item`, search, layout).

The full introspection results (5.4 MB Edge + 3.5 MB Authoring) are intentionally NOT shipped with the skill — re-introspect against your own tenant to capture template-specific Edge types.
