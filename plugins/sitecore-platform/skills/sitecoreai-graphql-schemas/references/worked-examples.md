# SitecoreAI GraphQL — worked examples (§ 4 · § 5 · § 6 · § 6b)

Supporting reference for the `sitecoreai-graphql-schemas` skill. Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the 500-line guidance; section numbers are kept so `SKILL.md` cross-references (e.g. `uploadMedia` → § 6b) still resolve here. Shapes cited in these queries are the verified ones in `SKILL.md` § 1–2.

## 4. Worked example — fetch two versions of an item with all field values + types in one query

**Use case:** a compare view that diffs a page's fields between two versions.

### Single batched query (preferred — one round trip, one item lookup)

```graphql
query ItemAllVersions($path: String!, $language: String!) {
  item(where: { path: $path, language: $language }) {
    itemId(format: D)
    name
    template { name templateId(format: D) }
    versions(allLanguages: false) {
      version
      versionName
      fields(excludeStandardFields: true, ownFields: false, withLanguageFallback: false) {
        nodes {
          name
          value
          templateField {
            type      # human-readable: "Single-Line Text", "Rich Text", "Image", ...
            typeKey   # slug: "text", "rich text", "image", ...
          }
        }
      }
    }
  }
}
```

Variables:
```json
{ "path": "/sitecore/content/MySite/Home", "language": "en" }
```

**Client-side:** filter `versions[]` to V_a and V_b, build the field map for each. Diff client-side.

### Alias-per-version variant (if `versions()` is unavailable for any reason)

```graphql
query TwoVersions($path: String!, $language: String!, $verA: Int!, $verB: Int!) {
  versionA: item(where: { path: $path, language: $language, version: $verA }) {
    name version versionName
    fields(excludeStandardFields: true, ownFields: false, withLanguageFallback: false) {
      nodes { name value templateField { type typeKey } }
    }
  }
  versionB: item(where: { path: $path, language: $language, version: $verB }) {
    name version versionName
    fields(excludeStandardFields: true, ownFields: false, withLanguageFallback: false) {
      nodes { name value templateField { type typeKey } }
    }
  }
}
```

### SDK call wrapper

```typescript
// inside a Marketplace app, with @sitecore-marketplace-sdk/client
const result = await client.mutate('xmc.authoring.graphql', {
  body: {
    query: ITEM_ALL_VERSIONS_QUERY,        // imported string
    variables: { path: itemPath, language: 'en' },
  },
});

// Unwrap: xmc.authoring.graphql is a MUTATION → SINGLE .data unwrap (per marketplace-sdk-xmc § 8b).
// Then dot into the GraphQL response root.
const item = result.data?.item;            // NOT result.data.data.item
```

⚠️ **One Marketplace app lost a week** on this exact unwrap. Mutations on the XMC module are SINGLE-unwrap. Queries (`xmc.pages.retrievePageVersions`, `xmc.pages.retrievePageState`) are DOUBLE-unwrap. The skill `marketplace-sdk-xmc` § 8b has the canonical unwrap matrix.

---

## 5. Worked example — fetch item template field metadata (fallback for field-type detection)

**Use case:** a fallback for when `ItemField.templateField.type` isn't enough.

```graphql
query ItemTemplate($templateId: ID!) {
  itemTemplate(where: { templateId: $templateId }) {
    name
    templateId(format: D)
    fullName
    fields {
      nodes {
        name
        type
        typeKey
        templateFieldId(format: D)
        section { name }
        versioning   # VERSIONED | UNVERSIONED | SHARED
        source       # for Multilist / Droplink data-source query
      }
    }
  }
}
```

Variables: `{ "templateId": "{12345678-...}" }` (use D-format from the Item's `template.templateId(format: D)`).

---

## 6. Worked example — fetch published content via Edge

```graphql
query EdgeItem($path: String!, $language: String!, $version: String) {
  item(path: $path, language: $language, version: $version) {
    id(format: "D")
    name
    template { name }
    fields(ownFields: false) {
      name
      value
    }
  }
}
```

Variables: `{ "path": "/sitecore/content/MySite/Home", "language": "en", "version": "1" }` — note `version` is a **String** for Edge.

For the layout / rendering tree:

```graphql
query EdgeLayout($site: String!, $routePath: String!, $language: String!) {
  layout(site: $site, routePath: $routePath, language: $language) {
    item {
      rendered     # JSON-rendered output for the route
    }
  }
}
```

---

## 6b. Worked example — upload a media item + link it onto a field (Authoring, 2-STEP)

`uploadMedia` does **not** take the binary in the GraphQL call — it returns a **presigned upload URL** you then POST the file to. Verified live 2026-06 on the source tenant.

**Step 1 — create the media item, get the presigned URL:**

```graphql
mutation($input: UploadMediaInput!) { uploadMedia(input: $input) { presignedUploadUrl } }
```
```jsonc
{ "input": {
  "itemPath": "Project/acme/site/my-image",  // ⚠️ media-library-RELATIVE — NO leading slash (a leading "/" errors)
  "alt": "…", "database": "master", "language": "en",
  "includeExtensionInItemName": false, "overwriteExisting": true, "versioned": false
} }
```

`UploadMediaInput` = `{ itemPath: String! (relative to /sitecore/media library), alt, database, language, includeExtensionInItemName, overwriteExisting, versioned }`. `UploadMediaPayload` = `{ presignedUploadUrl: String! }`.

**Step 2 — POST the binary** to the presigned URL (`…/sitecore/api/v1/authoring/media/upload?token=…`):

```ts
const fd = new FormData();
fd.append("file", new Blob([bytes], { type: "image/png" }), "my-image.png");
const res = await fetch(presignedUploadUrl, {
  method: "POST",                                 // ⚠️ POST multipart — a PUT returns 405
  headers: { Authorization: `Bearer ${token}` },  // ⚠️ Bearer STILL required (no-auth → HTML login page, not an upload)
  body: fd,                                        // 'file' field; fetch sets the multipart boundary
});
const media = await res.json();   // { Id, Name, ItemPath } — Id is the media GUID (D-format), use it directly
```

**Step 3 — link it onto a content field** via `updateItem` (Image field raw value is `<image>` XML):

```graphql
mutation($input: UpdateItemInput!) { updateItem(input: $input) { item { itemId(format: D) } } }
```
```jsonc
{ "input": { "itemId": "<target item GUID>", "language": "en",
  "fields": [{ "name": "CardImage", "value": "<image mediaid=\"<media Id>\" alt=\"…\" />" }] } }
```

**Then publish** (`sitecoreai-publishing`) — **for the LIVE surface only.**

⚠️ **Publish is LIVE-scoped, not a precondition for rendering.** On **preview**, uploaded media resolves straight from the CM with **no publish at all** — measured on one brand 2026-08-09: 9 hero images uploaded, linked via `updateItem`, and confirmed rendering on preview with `publishItem` **never called**. On **live**, an unpublished media item's `<img src>` is well-formed but the delivery handler 404s — that is where the publish is required. *(Corrected 2026-08-09; this previously read "media renders only AFTER publish", stated universally.)*

Why the distinction is worth the extra sentence: the universal form pushes a build to **publish early — a live-tenant write — purely to audit imagery**, or to skip the imagery audit as unverifiable. Audit on preview; publish when the build is genuinely going live.

⚠️ **A direct CLI GET of a media URL returns a ~2818B HTML stub even for working media** (it's auth/referer-gated), so curl is a false negative — **verify image loading in a real browser, never `curl`/`Invoke-WebRequest`.** And in the browser, a present `<img>` is not proof either: assert `naturalWidth > 0` (the bitmap decoded — a 404 leaves a correctly-sized element at `0`) alongside a non-zero rendered box and no `display:none`/`visibility:hidden`/`opacity:0`.

> When INSIDE a Marketplace app, prefer the SDK envelope (`client.mutate('xmc.authoring.graphql', …)`); the direct-`fetch` form above is for server-to-server automation (own automation client) where the SDK isn't in play — e.g. a head-app content-seeding script. Auth host + endpoint per the Endpoints table; token per `sitecoreai-auth`.
