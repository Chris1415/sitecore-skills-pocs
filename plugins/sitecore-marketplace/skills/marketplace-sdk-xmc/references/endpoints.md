# XMC endpoint reference

Detailed key tables for every `xmc.*` endpoint surface. The SKILL.md gives you the modes, calling convention, and pitfalls; this file is for resolving "which key, what params, query vs mutation" once you know what you need to call.

All examples use Mode A `params:` wrapping (the most common shape). For Mode B (experimental direct), drop the `params:` wrapper and pass `path` / `query` / `body` at the top level — see SKILL.md § 3.

`sitecoreContextId` is required on essentially every call (SKILL.md § 12a). The SDK types mark it optional; treat it as mandatory.

---

## Sites (`xmc.sites.*`)

### Queries

| Key | Purpose | Key params |
|-----|---------|-----------|
| `'xmc.sites.listSites'` | All sites in environment | `query: { sitecoreContextId }` |
| `'xmc.sites.retrieveSite'` | Single site details | `path: { siteId }`, `query: { sitecoreContextId }` |
| `'xmc.sites.retrieveSiteHierarchy'` | Full page tree for a site | `path: { siteId }`, `query: { sitecoreContextId }` |
| `'xmc.sites.retrievePageHierarchy'` | Page subtree | `path: { siteId, pageId }`, `query: { sitecoreContextId }` |
| `'xmc.sites.listPageChildren'` | Direct children of a page | `path: { siteId, pageId }`, `query: { sitecoreContextId }` |
| `'xmc.sites.listPageAncestors'` | Ancestors of a page | `path: { siteId, pageId }`, `query: { sitecoreContextId }` |
| `'xmc.sites.listCollections'` | Site collections | `query: { sitecoreContextId }` |
| `'xmc.sites.listLanguages'` | Languages in environment | `query: { sitecoreContextId }` |
| `'xmc.sites.listHosts'` | Hosts for a site | `path: { siteId }`, `query: { sitecoreContextId }` |

### Mutations

| Key | Purpose |
|-----|---------|
| `'xmc.sites.createCollection'` | Create site collection |
| `'xmc.sites.addFavoriteSite'` | Add to favorites |
| `'xmc.sites.createLanguage'` | Add language |

---

## Pages (`xmc.pages.*`)

> **Critical practical rule (verified live):** every `xmc.pages.*` call — query AND mutation — must pass `sitecoreContextId` in `query`. The SDK types mark it optional, but without it the call silently lands on the wrong/default environment — mutations resolve `200` and do nothing, queries return empty or wrong data. Always pass it.
>
> **Param-casing trap:** `retrievePageState` uses CAPITALIZED `Site` / `Language` (plus `Version`, `WithWorkflow`, `WithVersions`, `WithLayout`). Every other pages endpoint uses lowercase `site` / `language`. Not documented anywhere in the SDK — verified via `retrievePageStateData` in the generated `.d.ts`. When typecheck yells about `Language` vs `language`, trust the compiler.

### Queries

| Key | Purpose | Key params |
|-----|---------|-----------|
| `'xmc.pages.retrievePage'` | Full page info (template, layout, workflow, publishing) | `path: { pageId }`, `query: { site, language, sitecoreContextId, version? }` |
| `'xmc.pages.retrievePageState'` | Basic page info (id, displayName, revision) | `path: { pageId }`, `query: { Site, Language, sitecoreContextId, Version?, WithWorkflow?, WithVersions?, WithLayout? }` ⚠ capitalized |
| `'xmc.pages.search'` | Search pages by name | `query: { siteId, searchText, language, sitecoreContextId }` |
| `'xmc.pages.retrieveInsertOptions'` | Compatible insert templates | `path: { pageId }`, `query: { site, language, insertOptionKind, sitecoreContextId }` |
| `'xmc.pages.retrievePageVersions'` | Version list | `path: { pageId }`, `query: { site, sitecoreContextId, language? }` |

### Mutations

| Key | Purpose | Key params |
|-----|---------|-----------|
| `'xmc.pages.createPage'` | Create new page | `query: { sitecoreContextId }`, `body: { parentId, pageName, templateId, language, displayName? }` |
| `'xmc.pages.deletePage'` | Delete page | `path: { pageId }`, `query: { sitecoreContextId }` |
| `'xmc.pages.renamePage'` | Rename page | `path: { pageId }`, `query: { sitecoreContextId }`, `body: { newName }` — **`sitecoreContextId` is practically mandatory** (without it, mutate resolves 200 but does not rename) |
| `'xmc.pages.duplicatePage'` | Copy page | `path: { pageId }`, `query: { sitecoreContextId }`, `body: { newName, site, language }` |
| `'xmc.pages.updateFields'` | Update field values | `path: { pageId }`, `query: { sitecoreContextId }`, `body: { fields }` |
| `'xmc.pages.saveLayout'` | Update layout | `path: { pageId }`, `query: { sitecoreContextId }`, `body: { layout }` |

---

## Agent (`xmc.agent.*`)

Higher-level convenience endpoints — often simpler than the raw sites/pages equivalents. Useful for graph/visualization apps and bulk data fetches.

### Queries

| Key | Purpose | Key params |
|-----|---------|-----------|
| `'xmc.agent.sitesGetSitesList'` | List sites with config | `query: { sitecoreContextId? }` |
| `'xmc.agent.sitesGetSiteDetails'` | Detailed site info | `path: { siteName }`, `query: { sitecoreContextId? }` |
| `'xmc.agent.sitesGetAllPagesBySite'` | Flat route list for a site | `path: { siteName }`, `query: { language, sitecoreContextId? }` |
| `'xmc.agent.sitesGetSiteIdFromItem'` | Site root by item traversal | `path: { itemId }`, `query: { sitecoreContextId? }` |
| `'xmc.agent.pagesGetComponentsOnPage'` | Components on a page | `path: { pageId }`, `query: { language, sitecoreContextId? }` |
| `'xmc.agent.pagesSearchSite'` | Search pages by title/content | `query: { siteName, searchText, language, sitecoreContextId? }` |
| `'xmc.agent.pagesGetPage'` | Comprehensive page info | `path: { pageId }`, `query: { language, sitecoreContextId? }` |
| `'xmc.agent.pagesGetPagePreviewUrl'` | Preview URL | `path: { pageId }`, `query: { sitecoreContextId? }` |
| `'xmc.agent.pagesGetPageScreenshot'` | Screenshot (base64) | `path: { pageId }`, `query: { sitecoreContextId? }` |
| `'xmc.agent.pagesGetPageHtml'` | Raw HTML content | `path: { pageId }`, `query: { sitecoreContextId? }` |
| `'xmc.agent.pagesGetPageTemplateById'` | Template info | `path: { templateId }`, `query: { sitecoreContextId? }` |
| `'xmc.agent.pagesGetAllowedComponentsByPlaceholder'` | Compatible components | `path: { pageId, placeholderKey }` |
| `'xmc.agent.contentGetContentItemById'` | Content item details | `path: { itemId }`, `query: { language, sitecoreContextId? }` |

---

## Authoring GraphQL (`xmc.authoring.*`)

| Key | Purpose | Params |
|-----|---------|--------|
| `'xmc.authoring.graphql'` | Execute GraphQL against the Authoring API | `query?: { sitecoreContextId }`, `body: { query, variables? }` |

**This is a mutation** (despite running GraphQL queries — POST under the hood):

```typescript
const result = await client.mutate('xmc.authoring.graphql', {
  params: {
    query: { sitecoreContextId: contextId },
  },
  body: {
    query: `query { item(path: "/sitecore/content") { id name } }`,
    variables: {},
  },
});
```

Response wraps the GraphQL result — access `result.data?.item` directly. **Do not read `result.data.data.item`** — that's the rule for `client.query` against XMC keys, not mutations. See the `marketplace-sdk-client` skill, § 8b, for the full unwrap matrix.

### Lazy item-name resolution (worked example)

When a scan returns Sitecore item IDs (datasource refs, layout fields, content links) you'd otherwise display as opaque GUIDs to a non-technical editor, batch-resolve display names via Authoring GraphQL on first visibility (drawer-open, panel-paint), cache process-wide, and fall back to a short-id label when resolution fails.

> **Drop-in copy-pack at `assets/lazy-item-resolution/`** — four `.ts` files (resolver + cache + hook + display-name helper) plus a README with wiring steps and the failure-ladder debugging checklist. Use it as-is for any Marketplace app that surfaces Sitecore items by ID; the README walks through `useItemNames(client, contextId, ids)` integration.

The pack handles three things the snippet below leaves out:
- **Resolution caching** — module-level singleton survives surface remounts inside one iframe lifetime
- **Failure ladder** — three named warnings (`mutate-threw`, `graphql-errors`, `zero-resolved-in-batch`) so silent fallbacks become visible
- **Fallback labels** — `Item · ${shortHex}` (first 8 hex chars) over generic "Unnamed item"

A minimal inline version (no caching, no failure ladder) for one-shot resolution:

```typescript
// Build one multi-aliased query per batch so N IDs resolve in one round-trip.
function buildQuery(count: number): string {
  const varDecls = Array.from({ length: count }, (_, i) => `$id${i}: String`).join(', ');
  const aliases = Array.from(
    { length: count },
    (_, i) => `i${i}: item(path: $id${i}) { name displayName itemId }`,
  ).join('\n  ');
  return `query Resolve(${varDecls}) {\n  ${aliases}\n}`;
}

// Wrap bare GUIDs with curly braces — Authoring `item(path:)` accepts both,
// but the canonical Sitecore convention is the braced form.
const BARE_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toItemPath = (id: string) => (BARE_GUID_RE.test(id) ? `{${id}}` : id);

async function resolveItemNames(
  client: ClientSDK,
  contextId: string,
  ids: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  const variables: Record<string, string> = {};
  ids.forEach((id, i) => { variables[`id${i}`] = toItemPath(id); });

  const result = await client.mutate('xmc.authoring.graphql', {
    body: { query: buildQuery(ids.length), variables },
    params: { query: { sitecoreContextId: contextId } },
  } as Parameters<typeof client.mutate>[1]);

  // SINGLE unwrap — mutation returns the GraphQL body directly.
  // Reading `result.data.data.iN` (the query rule) silently returns undefined.
  const envelope = result as {
    data?: Record<string, { name?: string; displayName?: string } | null>;
    errors?: Array<{ message?: string }>;
  };
  if (envelope.errors?.length) console.warn('[itemResolve] graphql-errors', envelope.errors);
  const data = envelope.data;
  if (!data) { console.warn('[itemResolve] no-data', envelope); return out; }

  ids.forEach((id, i) => {
    const item = data[`i${i}`];
    const name = item?.displayName ?? item?.name;
    if (name) out.set(id, name);
  });
  return out;
}
```

For production use, prefer the copy-pack — it adds the cache, hook, and failure-ladder warnings.

---

## Preview / Live GraphQL

| Key | Purpose | Params |
|-----|---------|--------|
| `'xmc.preview.graphql'` | GraphQL against Preview API | `body: { query, variables? }` |
| `'xmc.live.graphql'` | GraphQL against Delivery (Live) API | `body: { query, variables? }` |

Also mutations (POST). Use for read paths that benefit from the GraphQL edge (e.g. rendering previews).

```typescript
// Mode B variant
const preview = await xmc.preview.graphql({
  body: {
    query: `query { item(path: "/sitecore/content/Home", language: "en") { id name } }`,
  },
  query: { sitecoreContextId },
});
```

---

## Content Transfer (`xmc.contentTransfer.*`)

For migrating content between environments. Rarely needed in typical Marketplace apps — use when building migration tools or cross-environment sync.

```typescript
// Create a transfer (Mode B signature shown)
const transfer = await xmc.contentTransfer.createContentTransfer({
  body: {
    configuration: {
      dataTrees: [
        {
          itemPath: '/sitecore/content/Home',
          scope: 'SingleItem',
          mergeStrategy: 'OverrideExistingItem',
        },
      ],
    },
    transferId: crypto.randomUUID(),
  },
  query: { sitecoreContextId: 'your-context-id' },
});

// Delete
await xmc.contentTransfer.deleteContentTransfer({
  path: { transferId: transfer.data!.transferId },
  query: { sitecoreContextId: 'your-context-id' },
});
```

---

## Search (`xmc.search.*`)

| Key | Purpose |
|-----|---------|
| `'xmc.search.getConfigs'` | `GET /search/v1/config?sitecoreContextId=<live id>` → `Config[]` (`id`, `name`, `templateIds`, `fields: Field[]` with `search` / `filter` / `facet` / `sort` `{ enabled, name }`; the facet `name` is what a head app passes). **Inside Marketplace only:** outside it the route answers 401 without auth and **403 `insufficient scopes`** for org automation and Edge administration bearers (measured 2026-10-02). Shapes and the auth matrix: `sitecoreai-search-sources/references/config-api.md` |
