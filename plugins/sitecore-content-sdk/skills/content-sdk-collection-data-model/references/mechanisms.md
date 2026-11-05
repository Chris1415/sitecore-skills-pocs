# Delivery mechanisms for collections

Evidence tags: **[documented]** by Sitecore, **[reported]** by a community source, each listed below; **[measured]** on a tenant; **[inferred]** not yet observed.

| Mechanism | Editable in Pages | Add / reorder rows | Limits | CM change |
|---|---|---|---|---|
| `ComponentQuery` (Integrated GraphQL) with `jsonValue` | Container fields yes [reported]; child-row fields yes [measured 2026-11-04, by hand in Pages] | Through Manage items on the container | One level of `children` in practice (nesting multiplies the budget); rows past `first` dropped silently; over budget → `isContentResolved: false`, no error [measured]; new rows need a page republish [documented] | Rendering `ComponentQuery`; resolver cleared |
| Server-side Edge fetch (`client.getData`) | No metadata | n/a (rows authored at source) | Edge complexity per request; paging with cursor; needs caching and revalidation | None |
| Multilist / Treelist on the datasource | Picking and ordering yes; referenced items' fields not inline [inferred] | Re-point / reorder in the picker | Referenced items arrive whole: cost grows with their fields | Field on the container template |
| Datasource / Context Item Children Resolver | Not documented [inferred: no] | Via Manage items if the container is set up | Not supported with Edge runtime publishing; no filter or paging; drops container fields; republish needed [documented] | Rendering `Rendering Contents Resolver` |
| Custom content resolver | n/a | n/a | Unsupported in SitecoreAI [documented] | Cannot deploy |
| Manage items on the container | Lists the children | Add (insert options), delete, reorder | — | Container bases `_HorizonDatasourceGrouping` `{D0F6BE14-2A2D-4C56-ACB5-80CAA573B8E2}` and `_PublishingGroupingTemplate` `{8BA7DAC6-32ED-4378-BD9E-5DA5B0F9848D}` (ids as asserted live by `content-sdk-list-component`'s build script; never on the row template); `__Masters` on the container's standard values |

## Budget (measured on Edge preview)

- Server fetch of children with `url` plus four named fields: 12 children per request is the ceiling, 10 is safe (measured 2026-11-03); plain `id name` pages at 50 (`sitecoreai-edge-graphql-capture`).
- Server fetch with three `jsonValue` fields and no `url`: 20 per request resolved (measured 2026-11-03).
- `ComponentQuery`: 4-field rows held at `first` 21, 8-field rows at 16, 9-field rows failed at 14. Separately, a query nests at most about 11 `field(...){ jsonValue }` selections in total before Edge rejects it as too deep; that is a ceiling on fields per row times nesting, independent of `first`. Full table: `sitecoreai-edge-graphql-capture` § 2b.
- Nested `children { children }` multiplies the cost: the limit is the product of the `first` values (about 15 passes, 16 fails; § 2b). With real row counts that means one level per request; fetch deeper levels separately.

## `ComponentQuery` template (class A)

```graphql
query ListQuery($datasource: String!, $language: String!) {
  datasource: item(path: $datasource, language: $language) {
    heading: field(name: "Heading") { jsonValue }
    children(first: 13) {            # authored maximum 12; first must exceed it
      results {
        id
        title: field(name: "Title") { jsonValue }
        text: field(name: "Text") { jsonValue }
        image: field(name: "Image") { jsonValue }
      }
    }
  }
}
```

The component reads `fields.data.datasource` and renders each value through `<Text>`, `<RichText>`, `<Image>`, `<Link>`.

## Library sample (class D)

1. Page `children(first: 50, after: $cursor){ pageInfo{ hasNext endCursor } results{ id } }` until done (cache the id list).
2. Choose the ids (random sample, newest by a date field fetched in step 1, tag match).
3. One aliased request for the chosen items: `i0: item(path: "{id0}"){ ... } i1: item(path: "{id1}"){ ... }`.

## Sources

- Content resolvers, SitecoreAI: https://doc.sitecore.com/sai/en/developers/sitecoreai/content-modeling-and-presentation/content-resolvers.html ("Content resolvers are not supported when using Edge runtime publishing"; custom content resolvers listed as not supported).
- Manage items for a custom component: https://doc.sitecore.com/xmc/en/developers/xm-cloud/add-the-manage-items-section-to-pages-for-a-custom-component.html
- Page listing guidance (resolvers and Integrated GraphQL need a page republish for new children; no filtering or pagination): https://developers.sitecore.com/learn/accelerate/xm-cloud/implementation/information-architecture/page-listing
- Community, Integrated GraphQL and `jsonValue`: https://www.getfishtank.com/insights/streamlining-sitecore-xm-cloud-layout-data-with-integrated-graphql
- Component-level GraphQL in a Content SDK app: https://doc.sitecore.com/sai/en/developers/content-sdk/20/use-graphql-to-fetch-component-level-data-in-a-next-js-content-sdk-app.html
