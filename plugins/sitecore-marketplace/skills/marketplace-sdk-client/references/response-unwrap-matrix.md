# Response unwrap matrix — single vs double `.data` (canonical reference)

This file is the single source of truth for "how deep do I unwrap the result?" across the Marketplace SDK. The SKILL.md § 8b summarises the rule; this reference holds the full matrix, the mutation-vs-query distinction, and the failure ladder. Other skills (`marketplace-sdk-xmc`, `marketplace-sdk-ai`) link here to avoid duplicating the matrix three times.

## The rule

Query results are always wrapped. There are **two unwrap levels** depending on which map the key comes from, plus a **separate rule for mutations**:

| Call | Key family | Payload location |
|---|---|---|
| `client.query` | Base map (`application.context`, `pages.context`, `host.*`, `site.context`) | `result.data` (single) |
| `client.query` | XMC / AI module (`xmc.*`, `ai.*`) | `result.data.data` (double — outer = SDK wrapper, inner = hey-api envelope) |
| `client.mutate` | XMC GraphQL passthroughs (`xmc.authoring.graphql`, `xmc.preview.graphql`, `xmc.live.graphql`) | **`result.data.data`** (double — outer = SDK wrapper, inner = GraphQL response body). **Body MUST live INSIDE `params`, not top-level.** See "The Authoring GraphQL envelope" section below. |
| `client.mutate` | XMC REST-style mutations (`xmc.pages.createPage`, `xmc.sites.*` mutations, `xmc.contentTransfer.*`) + AI skills (`ai.skills.*`) | `result.data` (single — mutation returns the response body directly) |

### Worked examples

```typescript
// Base-map query — single unwrap
const appCtx = await client.query('application.context');
const context = appCtx.data;                              // ApplicationContext
const contextId = context?.resourceAccess?.[0]?.context?.live;

// XMC module query — double unwrap
const result = await client.query('xmc.sites.listLanguages', {
  params: { query: { sitecoreContextId: contextId } },
});
const languages = result.data?.data ?? [];               // Xmapp.Language[]
```

Verified against the shadcn quickstart at `components/examples/built-in-auth/with-xmc/list-languages.tsx`. The double `.data` is load-bearing — a single unwrap on an XMC query returns the envelope object, not the payload array.

## The Authoring GraphQL envelope (and `.preview.graphql` / `.live.graphql`)

**The XMC GraphQL passthroughs are different from the other mutation keys** — and the SDK's generated type signature misleads. Verified against a live SitecoreAI tenant on 2026-05-11.

**Correct envelope:**

```typescript
const result = await client.mutate('xmc.authoring.graphql', {
  params: {
    query: { sitecoreContextId },                  //  ┐ both live INSIDE params
    body: { query: GRAPHQL_QUERY, variables },     //  ┘
  },
});
// Double unwrap — outer `.data` is SDK wrapper, inner `.data` is GraphQL response body
const root = result.data?.data as MyGraphqlResponse | undefined;
const item = root?.item;
```

No `as never` / `as unknown as` cast is needed — the SDK type signature accepts this shape natively.

**The wrong shape (silently HTTP-400s with empty body):**

```typescript
// WRONG — body at top level, response single-unwrap, `as never` cast hides the type error
const result = await client.mutate('xmc.authoring.graphql', {
  params: { query: { sitecoreContextId } },
  body: { query, variables },                       // WRONG — body must be inside params
} as never);                                        // WRONG — cast hides the real type error
const data = (result as { data?: MyGraphqlResponse })?.data;  // WRONG — single .data
```

This shape sends a malformed request to `https://edge-platform.sitecorecloud.io/v1/authoring/graphql?sitecoreContextId=...` and gets back **HTTP 400 with an empty response body** (no GraphQL `errors` payload), making the failure hard to diagnose.

**Why the SDK type misleads:** `Authoring.GraphqlData` declares `body` as a top-level field, but `client.mutate(key, options)`'s `options` parameter is `Options<GraphqlData>` — a hey-api / openapi-fetch wrapper that nests `body`, `query`, and any path params under a single `params` key. The `as never` cast bypasses the TypeScript error that would otherwise surface this.

**Field note (2026-05-11):** two earlier Marketplace apps used the WRONG shape (top-level `body` + `as never` + single `.data` unwrap). They worked at the time but may break on the newer gateway / newer tenant config. If your code has that shape, fix the envelope to match this reference.

## The other mutations rule

For XMC REST-style mutations (`xmc.pages.createPage`, `xmc.sites.*` mutations, `xmc.contentTransfer.*`) and AI skills (`ai.skills.*`), the rule is the original "single-unwrap" one — `body` at the top level, `result.data` directly:

```typescript
const result = await client.mutate('xmc.pages.createPage', {
  params: { query: { sitecoreContextId } },
  body: { parentId, pageName, templateId, language: 'en' },
});
const newPage = result.data;                       // single .data
```

This is the SDK pattern hey-api generates for REST endpoints. Only the `*.graphql` keys (which proxy GraphQL through a fetch wrapper) need the body-inside-params + double-unwrap shape.

## Failure ladder for graph endpoints

When the call doesn't return what you expect, log explicitly to surface the shape — silent fallbacks are why these bugs survive into production:

```typescript
if (envelope?.errors?.length) console.warn('[mySkill] graphql-errors', envelope.errors);
if (!envelope?.data)         console.warn('[mySkill] no-data-in-response', envelope);
if (resolvedThisBatch === 0) console.warn('[mySkill] zero-resolved-in-batch', { sample, data });
```

Three named warnings cover the three plausible failure modes:
- **`mutate-threw`** (or equivalent) — the call rejected (network / auth / type error)
- **`graphql-errors`** — the call resolved 200 with a non-empty `errors` array (permissions, bad path, schema mismatch)
- **`zero-resolved-in-batch`** — the call resolved 200 with empty data (the items genuinely don't exist, or the unwrap is wrong)

Without these warnings the UI silently shows fallbacks forever and you can't tell which failure mode you're in. Add them to every graph-endpoint call site.

## Why the asymmetry

`client.query` was designed before the XMC / AI modules existed — its result wrapper (`{ data, error?, status?, isLoading?, ... }`) holds metadata about the SDK call itself (was it loading? did it error? what was the HTTP status?). When module keys (`xmc.*`, `ai.*`) were added, their backend already wraps the response in a hey-api `{ data, error, response }` shape, so you get two wrappers stacked.

`client.mutate` was added later and skips the outer wrapper — it returns the response body directly so consumers don't have to remember "is this a query or a mutation?" at unwrap time. Unfortunately the rule is the inverse of what the query world taught you, and TypeScript can't catch the mismatch.

The matrix above is the canonical decision table. When in doubt, log the full result object once at the call site and inspect the shape.

---

## 8b. Response unwrapping (from SKILL.md § 8b)


The unwrap depth depends on which call you used and which map the key comes from. The **rule in four lines:**

- `client.query` against base-map keys (`application.context`, `pages.context`, `host.*`, `site.context`) → payload at `result.data` (single).
- `client.query` against module keys (`xmc.*`, `ai.*`) → payload at `result.data.data` (double — outer is the SDK wrapper, inner is the hey-api envelope).
- `client.mutate` against **XMC GraphQL passthroughs** (`xmc.authoring.graphql`, `xmc.preview.graphql`, `xmc.live.graphql`) → payload at **`result.data.data` (double)** AND **body MUST live INSIDE `params`**, not at the top level. The SDK's generated type lies — it declares `body` as top-level but the runtime wraps it under `params`. Don't reach for `as never` — that cast hides the type error.
- `client.mutate` against XMC REST-style mutations (`xmc.pages.createPage`, `xmc.sites.*` mutations, `xmc.contentTransfer.*`) and AI skills (`ai.skills.*`) → payload at `result.data` (single), body at top level.

```typescript
// Base-map query — single unwrap
const context = (await client.query('application.context')).data;

// XMC module query — double unwrap
const result = await client.query('xmc.sites.listLanguages', { params: { query: { sitecoreContextId } } });
const languages = result.data?.data ?? [];

// XMC GraphQL passthrough — body INSIDE params, DOUBLE unwrap
const r = await client.mutate('xmc.authoring.graphql', {
  params: {
    query: { sitecoreContextId },
    body: { query: GRAPHQL_QUERY, variables },   // <-- INSIDE params
  },
});
const root = r.data?.data as MyGraphqlResponse | undefined;   // <-- DOUBLE .data
const item = root?.item;

// XMC REST mutation — body at top level, SINGLE unwrap
const c = await client.mutate('xmc.pages.createPage', {
  params: { query: { sitecoreContextId } },
  body: { parentId, pageName, templateId, language: 'en' },
});
const newPage = c.data;
```

**Why the GraphQL passthroughs differ:** the `xmc.*.graphql` keys proxy GraphQL through a hey-api / openapi-fetch wrapper that nests `body`, `query`, and any path params under a single `params` key. The other XMC mutations are direct REST endpoints — they don't go through the GraphQL fetch wrapper, so `body` stays top-level. Verified against a real tenant 2026-05-11.

This file holds the full matrix, the failure ladder for graph endpoints (three named warnings to add at every call site) and the field note above (two earlier apps shipped with the wrong shape). Other skills (`marketplace-sdk-xmc`, `marketplace-sdk-ai`) point here too: it's the canonical doc.
