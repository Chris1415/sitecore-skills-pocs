# Config read API (`GET /search/v1/config`)

The only programmatic way to list sources, their ids and their facet display names. Read-only; there is no create/update counterpart.

## Shape (from `@sitecore-marketplace-sdk/xmc` 0.4.3, `dist/xmc/src/client-search/types.gen.d.ts`)

```ts
GET https://edge-platform.sitecorecloud.io/search/v1/config?sitecoreContextId=<id>[&context.<key>=<value>]
200: Config[]
type Config = {
  id?: string; name?: string; description?: string;
  contentType?: string; contentTypes?: string[];
  templateId?: string; templateIds?: string[];
  tenantId?: string; searchClientKey?: string; context?: Record<string, string>;
  fields?: Field[]; searchSettings?: { fuzzySearch?: SearchFeature };
  createdAt?: string; createdBy?: string; updatedAt?: string; updatedBy?: string;
};
type Field = { id?, name?, displayName?, description?, type?,
  key?: SearchFeature; retrieve?: SearchFeature; search?: SearchFeature;
  filter?: SearchFeature; facet?: SearchFeature; sort?: SearchFeature };
type SearchFeature = { enabled?: boolean; name?: string };
```

`facet.name` (or `displayName`) is what the head app passes as a facet `name`. A real 200 body has not been captured yet **[probe-gated: P4]**; type from a capture before relying on optional fields.

## Auth (measured 2026-10-02, read-only, four CM environments of one test org)

| Request | Result |
|---|---|
| fake `sitecoreContextId`, any auth | 404 problem+json `No sitecore context` (context resolved before auth) |
| no `sitecoreContextId`, bearer | 404 `No sitecore context` |
| real context id (preview or live), no `Authorization` | **401** `{"title":"Unauthorized","detail":"Config endpoint requires Authorization"}` |
| real context id, bearer from an org automation client (Deploy scopes + `xmcloud.cm:admin`) | **403** `{"message":"insufficient scopes"}` |
| real context id, bearer from an Edge administration client (`edge.*` scopes) | **403** `{"message":"insufficient scopes"}` |
| context id in `x-sitecore-contextid` header instead of the query | same as above |

So the route exists and authenticates, but neither standard automation credential carries the scope. Paths that work or may work:

1. **Marketplace app** (documented): `client.query("xmc.search.getConfigs", { params: { query: { sitecoreContextId } } })`, context id from `appContext.resourceAccess[0].context.live`. The host proxies the call with the app's token. See `marketplace-sdk-xmc`.
2. A bearer captured from the SitecoreAI UI session (P3 network capture shows which scope the UI's token carries) **[probe-gated: P3]**. Do not automate with a user session token.
3. Requesting a specific scope at token mint with an environment automation client **[probe-gated: P3]** (scope name unknown).

Until one of these is proven, take the source id from the source's Settings tab and the facet names from its Fields tab.

## `scripts/search-config.mjs`

Runs the fake-context control, then the real call with the bearer you supply (`--bearer-env` holding a token, or `--client-prefix` minting client credentials from `<PREFIX>_ID` / `<PREFIX>_SECRET`). On 401/403 it prints the table above and exits 1. On 200 it lists each source with its fields and flags, and `--datasource <id>` prints the datasource JSON stub.
