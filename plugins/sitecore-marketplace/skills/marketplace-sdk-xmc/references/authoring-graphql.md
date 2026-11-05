# Authoring GraphQL — verified write surface (canonical reference)

Sitecore Authoring GraphQL specifics surfaced during real-tenant capture sessions. Verified against a live SitecoreAI tenant while building a redirect-manager app (2026-05-11). This file is the source of truth for mutation shapes; SKILL.md § 6c summarises the envelope quirk, this file holds the full mutation matrix.

For the envelope shape (body inside `params`, double-unwrap `result.data.data`) see SKILL.md § 6c. This reference assumes you already wrap mutations correctly.

---

## 1. CreateItemInput

```graphql
input CreateItemInput {
  name: String!
  templateId: ID!
  parent: ID!
  language: String
  fields: [FieldValueInput]
  database: String
  # NO `id` field — sending one returns EXEC_INVALID_TYPE.
}
```

**Caller-supplied `id` is rejected.** Schema introspection confirms `CreateItemInput` has no `id` field. Cross-environment imports always mint a fresh GUID on `create` actions — import summary screens MUST flag this as "newly minted GUID" per item. The only way to preserve GUIDs across environments is to write directly to the underlying database (out of scope for Marketplace apps).

---

## 2. Response shapes — `{ item { ... } }`, NOT flat

All `*Payload` types wrap the affected item under `item`. Selecting flat fields returns `The field 'itemId' does not exist on the type 'CreateItemPayload'`.

```graphql
createItem(input: $input)  { item { itemId name path } }    # NOT { itemId name }
updateItem(input: $input)  { item { itemId } }              # NOT { itemId }
renameItem(input: $input)  { item { itemId name } }         # NOT { itemId name }
deleteItem(input: $input)  { successful }                   # Boolean, no item wrapper
```

Always wrap your selection set in `{ item { ... } }` for create / update / rename. `deleteItem` returns `Boolean` via `successful`.

---

## 3. Rename — dedicated mutation, NOT `updateItem.name`

`UpdateItemInput` does NOT include a `name` field. Trying `updateItem(input: { itemId, language: 'en', name: '...' })` returns `EXEC_INVALID_TYPE`.

```graphql
renameItem(input: { itemId: $id, newName: $newName }) { item { itemId name } }
```

For any item rename, call `renameItem` with `{ itemId, newName }`. For other field updates, use `updateItem` with `fields: [{ name, value }]`.

---

## 4. Boolean write representation — `'0'` / `'1'` strings

Sitecore boolean fields are wire-format strings, not native booleans. The wire accepts:

- `'0'` / `'1'` — **canonical**, this is what the read path returns
- `'true'` / `'false'` — also tolerated by the resolver

Always send `'0'` / `'1'` on writes — round-trips cleanly with read.

```typescript
const fields = [
  { name: 'PreserveQueryString', value: pq ? '1' : '0' },
  { name: 'PreserveLanguage',    value: pl ? '1' : '0' },
  { name: 'IncludeVirtualFolder', value: iv ? '1' : '0' },
];
```

On read, expect strings: `'1'` (true) and `''` (empty string for false, NOT `'0'`).

---

## 5. `__Updated` field format — Sitecore compact, not ISO-8601

Sitecore date fields use compact format `yyyyMMddTHHmmssZ` (e.g. `20260512T120000Z`), NOT ISO-8601 with hyphens. You need a custom parser:

```typescript
export function parseSitecoreCompactDate(value: string): Date | null {
  // Accepts both Sitecore compact (yyyyMMddTHHmmssZ) and ISO-8601 (yyyy-MM-ddTHH:mm:ssZ)
  if (!value) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (compact) {
    const [, y, m, d, hh, mm, ss] = compact;
    return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
  }
  const iso = Date.parse(value);
  return Number.isNaN(iso) ? null : new Date(iso);
}
```

Confirmed on real-tenant `__Updated` / `__Created` reads. The same parser handles both formats so historical items with either shape work.

---

## 6. Aliased `field(name:)` accessor pattern — ~75% smaller responses

When you know the field set up front, prefer **aliased `field(name:)` accessors** over the `fields(...)` connection. The connection returns metadata for every field (~75% wire overhead); aliased accessors return only the field values you ask for.

**Verbose (avoid for known-set reads):**

```graphql
query {
  item(path: $path, language: "en") {
    name
    fields { name jsonValue }   # returns every field, including ones you don't need
  }
}
```

**Concise (use this):**

```graphql
query {
  item(path: $path, language: "en") {
    name
    itemId
    redirectType:         field(name: "RedirectType")         { jsonValue }
    urlMapping:           field(name: "UrlMapping")           { jsonValue }
    preserveQueryString:  field(name: "PreserveQueryString")  { jsonValue }
    preserveLanguage:     field(name: "PreserveLanguage")     { jsonValue }
    includeVirtualFolder: field(name: "IncludeVirtualFolder") { jsonValue }
    updated:              field(name: "__Updated")            { jsonValue }
  }
}
```

The aliased shape parses cleanly:

```typescript
type ItemRead = {
  name: string;
  itemId: string;
  redirectType:         { jsonValue: { value: string } };
  urlMapping:           { jsonValue: { value: string } };
  preserveQueryString:  { jsonValue: { value: string } };  // '1' or ''
  preserveLanguage:     { jsonValue: { value: string } };
  includeVirtualFolder: { jsonValue: { value: string } };
  updated:              { jsonValue: { value: string } };  // compact format
};
```

Use the `fields(...)` connection only when you genuinely need the full set (debugging, dynamic field enumeration).

---

## 7. Worked envelope — create Redirect Map

Full round-trip example showing the envelope, mutation body, and response shape. Lifted from a write-capture session against the real tenant.

**Request:**

```typescript
const result = await client.mutate('xmc.authoring.graphql', {
  params: {
    query: { sitecoreContextId },
    body: {
      query: `
        mutation ($input: CreateItemInput!) {
          createItem(input: $input) {
            item { itemId name path }
          }
        }
      `,
      variables: {
        input: {
          name: 'My Redirect Map',
          templateId: 'f4fb6125f11343738aa24648c2c1960e',  // Redirect Map template
          parent: '<redirects-parent-item-id>',      // Settings/Redirects parent
          language: 'en',
          fields: [
            { name: 'RedirectType',         value: 'ServerTransfer' },
            { name: 'UrlMapping',           value: '%2ftest=%2FnewTest&%2fhello=%2Fworld' },
            { name: 'PreserveQueryString',  value: '0' },
            { name: 'PreserveLanguage',     value: '0' },
            { name: 'IncludeVirtualFolder', value: '0' },
          ],
        },
      },
    },
  },
});
```

**Response (double-unwrapped):**

```json
{
  "data": {
    "data": {
      "createItem": {
        "item": {
          "itemId": "<new-item-id>",
          "name": "_capture_test",
          "path": "/sitecore/content/<COLLECTION>/<SITE>/Settings/Redirects/_capture_test"
        }
      }
    }
  }
}
```

**TypeScript unwrap:**

```typescript
type CreateRedirectMapResponse = {
  createItem: {
    item: { itemId: string; name: string; path: string };
  };
};

const payload = result.data?.data as CreateRedirectMapResponse | undefined;
const created = payload?.createItem?.item;
if (!created) throw new Error('createItem returned no item');
```

---

## 8. Verified template-GUID example values (illustrative — do NOT copy)

These were the template GUIDs in the test tenant at capture time. **Template GUIDs are per-tenant** — discover them at runtime (see the repository named below for the pattern: resolve template by walking the templates tree).

| Item type | Template GUID (test tenant) | Notes |
|---|---|---|
| Redirect Map | `<template GUID>` | (Sitecore Redirect Map) — per-tenant; discover at runtime |
| Settings/Redirects folder parent | `<folder GUID>` | — also per-tenant; resolve by path before any `create` |

For runtime discovery patterns (`resolveItemIdByPath`, `discoverRedirectMapTemplateId`), see `site/lib/sdk/redirects-discover.ts` in the open-source redirect manager MVP at `Chris1415/Sitecore.Plugin.EnhancedRedirectManager`.

---

## 9. Field note: the wrong envelope (as of 2026-05-11)

Two Marketplace apps shipped with the WRONG envelope shape (top-level `body` + `as never` + single `.data` unwrap), worked at the time, and may break on newer gateway versions.

If your code has that shape, fix it on next touch — match the envelope in this file. The wrong shape sends a malformed request to `https://edge-platform.sitecorecloud.io/v1/authoring/graphql?sitecoreContextId=...` and returns HTTP 400 with empty body (no GraphQL `errors` payload to diagnose).
