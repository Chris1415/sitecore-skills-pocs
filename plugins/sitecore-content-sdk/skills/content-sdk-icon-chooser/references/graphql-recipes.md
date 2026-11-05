# 5. GraphQL recipes

Supporting reference for the `content-sdk-icon-chooser` skill. Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the Agent Skills spec's 5,000-token guidance; the heading is kept so `SKILL.md` cross-references still resolve here.

## 5. GraphQL recipes

**Authoring endpoint:**
```
POST https://<tenant>.sitecorecloud.io/sitecore/api/authoring/graphql/v1
Authorization: Bearer <OAuth2-JWT>
Content-Type: application/json
```

For Marketplace apps: `client.mutate('xmc.authoring.graphql', { body: { query, variables } })` — portal manages auth.
For direct/server calls: obtain JWT via `sitecoreai-auth` OAuth2 client-credentials.

---

### 5a. Find a rendering item by path

```graphql
query FindRendering($path: String!) {
  item(where: { path: $path, language: "en" }) {
    itemId(format: D)
    name
    path
    field(name: "__Icon") { value }
    template { name }
  }
}
```

```json
{ "path": "/sitecore/layout/Renderings/Project/acme/DesignManifesto" }
```

---

### 5b. Browse all renderings under a folder (for bulk audit)

```graphql
query BrowseRenderings($folderPath: String!) {
  item(where: { path: $folderPath, language: "en" }) {
    name
    path
    children {
      nodes {
        itemId(format: D)
        name
        path
        field(name: "__Icon") { value }
        template { name }
      }
    }
  }
}
```

```json
{ "folderPath": "/sitecore/layout/Renderings/Project/acme" }
```

Common paths to audit:
- `/sitecore/layout/Renderings/Project/<project-name>`
- `/sitecore/layout/Renderings/Feature/<feature-name>`
- `/sitecore/layout/Renderings/Foundation`

---

### 5c. Update the icon on a rendering (single)

```graphql
mutation SetRenderingIcon($itemId: ID!, $iconPath: String!) {
  updateItem(input: {
    itemId: $itemId
    fields: [
      { name: "__Icon", value: $iconPath }
    ]
  }) {
    item {
      itemId(format: D)
      name
      field(name: "__Icon") { value }
    }
  }
}
```

```json
{
  "itemId": "11111111-2222-3333-4444-555555555555",
  "iconPath": "office/16x16/document_text.png"
}
```

`__Icon` is a **shared field** — language and version in the input are ignored for it but must still be valid if the mutation input type requires them. Use `language: "en"` as a safe default.

---

### 5d. Batch update — multiple renderings in one GraphQL request

Use GraphQL operation aliases to update up to ~20 renderings per request:

```graphql
mutation BatchIconUpdate {
  r1: updateItem(input: {
    itemId: "guid-of-ContactDetailItem"
    fields: [{ name: "__Icon", value: "office/16x16/telephone.png" }]
  }) { item { name field(name: "__Icon") { value } } }

  r2: updateItem(input: {
    itemId: "guid-of-ContactForm"
    fields: [{ name: "__Icon", value: "office/16x16/checkbox_group.png" }]
  }) { item { name field(name: "__Icon") { value } } }

  r3: updateItem(input: {
    itemId: "guid-of-DestinationCard"
    fields: [{ name: "__Icon", value: "office/16x16/map.png" }]
  }) { item { name field(name: "__Icon") { value } } }
}
```
