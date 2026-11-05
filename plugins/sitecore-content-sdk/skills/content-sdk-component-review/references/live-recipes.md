# Live leg: read-only Authoring GraphQL recipes

All queries go to the **Authoring** endpoint with a bearer token from a client-credentials automation client (`sitecoreai-auth`). Shapes are from `sitecoreai-graphql-schemas` (`references/authoring-shapes.md`): on Authoring, `item` takes everything inside `where`, and `fields(...)` has three mandatory arguments with no defaults.

**Before any recipe:** bind and control.

1. The expected tenant is passed explicitly. The base-chain script checks the token's tenant claim against `--expect-tenant` and exits 2 on a mismatch; for hand-run queries, decode the token's claims once and compare.
2. Known-good control: a path you know exists (the site's Home) returns an item.
3. Known-bad control: a path you know does not exist returns `null`.

If either control fails, every answer below is UNKNOWN. Send only `query` documents; never a `mutation`.

## R1 Rendering item: datasource and params wiring (A6, A7 leg 2)

```graphql
query Rendering($path: String!) {
  item(where: { path: $path, language: "en" }) {
    itemId(format: D)
    name
    template { name }
    dsTemplate: field(name: "Datasource Template") { value }
    dsLocation: field(name: "Datasource Location") { value }
    params: field(name: "Parameters Template") { value }
    componentName: field(name: "ComponentName") { value }
  }
}
```

- `Datasource Template` should be an item path; for a list component, a path under `/sitecore/templates/Branches/`.
- `Datasource Location` should be a site-relative query (e.g. starting `query:$site`), not a fixed GUID or an absolute path into one site.
- `ComponentName` must equal the component map key exactly. *(unverified: the field name `ComponentName` on a JSON rendering is not in the schema skills; read the rendering's own fields with R4 if it comes back null.)*

## R2 Container Standard Values: insert options (A7 leg 1)

```graphql
query ContainerSV($path: String!) {
  item(where: { path: $path, language: "en" }) {
    path
    masters: field(name: "__Masters") { value }
    insertOptions { name }
  }
}
```

`$path` = `<container template path>/__Standard Values`. `__Masters` must hold the element template id; `insertOptions` is the resolved list an author sees in the tree.

## R3 Template base chain (A7 leg 0, A8)

```graphql
query Bases($id: ID!) {
  itemTemplate(where: { templateId: $id, database: "master" }) {
    name
    baseTemplates { nodes { templateId name } }
  }
}
```

This is the query `scripts/check-template-base-chain.mjs` runs per template. An empty `nodes` on a project template is a P0. For a list container, `_HorizonDatasourceGrouping` must appear in the chain (leg 0).

## R4 Any item's own fields (fallback, A6)

```graphql
query Own($path: String!) {
  item(where: { path: $path, language: "en" }) {
    path
    template { name }
    fields(excludeStandardFields: true, ownFields: true, withLanguageFallback: false) {
      nodes { name value }
    }
  }
}
```

Use it to read a datasource item or a rendering whose field names you are unsure of, instead of guessing a name and reading `null` as "empty".

## R5 Local datasource placement (A6)

```graphql
query PageData($path: String!) {
  item(where: { path: $path, language: "en" }) {
    children(first: 50) { nodes { name path template { name } } }
  }
}
```

`$path` = `<page path>/Data`. Local datasources for the component should be here; one found elsewhere under the page tree is a loose datasource (the schema script reports the same from disk).

## Reading the answers

- A `null` item is "missing" only if the known-bad control also returned `null` and the known-good one did not.
- `field(name:)` returns `null` for a field the template does not have; an existing empty field returns `value: ""`. Do not report one as the other.
- Authoring reads master. It proves the model, not publication; for what is live, see `sitecoreai-health-check`.
