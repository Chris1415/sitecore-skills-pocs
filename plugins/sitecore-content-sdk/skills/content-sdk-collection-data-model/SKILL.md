---
name: content-sdk-collection-data-model
description: "Picks the data model for a component that shows many items: owned rows, derived view, curated list or shared library, and how each is delivered. Use when migrating a tree-walking list or a list is not editable in Pages. Not row templates."
license: Apache-2.0
compatibility: "SitecoreAI with Experience Edge, Content SDK head apps (App Router and Pages Router). Mechanism facts from Sitecore docs (2026-11-03); collection shapes observed on Edge preview during a legacy migration (2026-11-03). Inline editing and reordering of rows delivered through ComponentQuery confirmed in Pages by hand (2026-11-04)."
metadata:
  author: Christian Hahn
  version: "0.1.4"
---

# Collection data models

A component that shows many items is not one problem. The question that decides everything is **who authors the rows, and where**. Answer it before choosing a template, a query or a resolver.

## The four classes

| Class | Who authors the rows, where | Examples | Shape | Delivery | Editable in Pages |
|---|---|---|---|---|---|
| **A. Owned rows** | The author of this component, here | tabs, accordion panels, stats, a hand-made card row | Container datasource with row children | Rendering `ComponentQuery`, every field as `jsonValue` | Yes: row fields inline and reorder (confirmed in Pages 2026-11-04); add and delete through Manage items |
| **B. Derived view** | Someone else, on other pages | latest news, child-page lists, sibling menus | No datasource rows; the source pages | Server-side Edge fetch, cached, revalidated on publish | No, by design: an "edit at source" link in editing mode |
| **C. Curated reference** | This author picks; the items live elsewhere | featured products, shared slides | Multilist / Treelist field on the datasource | The field itself (items arrive in layout data) | Picking and ordering yes; the picked items' fields are edited at their source |
| **D. Shared library** | A team, in one folder, used by many components | client logos, team members, 100+ items | Folder with insert options, no rows in layout data | Ids first, then fetch the subset shown | Through Manage items on the folder, not inline |

Tie-breakers:
- Rows that exist only for this one placement are **A**. Rows that are pages in their own right are **B**.
- More rows than the query budget allows (a `ComponentQuery` holds about 14 to 21 rows by field count; a server fetch with `url` about 10 to 12 per request) cannot be **A**: choose **C** (curate a few) or **D**.
- "Show N random" or "newest N" is a selection over a set, so the set is **B** or **D**, never **A**.

## Delivery, ranked

1. **`ComponentQuery` on the rendering with `jsonValue` fields** (class A). It returns the container fields and the children in one payload; `jsonValue` keeps them editable. It replaces the whole `fields` payload, so select everything the component renders. Clear the rendering's resolver: a resolver set alongside a query won in our projects [measured, not documented].
2. **Server-side Edge fetch** (classes B and D) through the SDK client (`client.getData`) in a server component. It pages freely (cursor, variable `first`), has no republish dependency and needs caching plus revalidation. No editing metadata, so it is only for rows authored elsewhere.
3. **Multilist / Treelist field** (class C). The picked items arrive whole in layout data, so cost grows with their fields.
4. **Content resolvers: avoid.** Sitecore documents that content resolvers are not supported with Edge runtime publishing, custom resolvers are unsupported in SitecoreAI, the children resolvers have no filtering or paging and drop the container's own fields, and nothing documents their output as editable.

Mechanism details, the measured budget and the republish rule: `references/mechanisms.md`.

## Rules that decide the outcome

- **The budget is per request.** Edge prices `url` and every named field per child. A `ComponentQuery` row past `children(first: N)` is dropped without an error; a query over budget arrives as `isContentResolved: false`. Size `first` above the authored row count and record that maximum next to the query; the probe sees only delivered < total, so it cannot enforce this headroom.
- **Freshness differs by delivery.** A row added to a resolver or `ComponentQuery` list reaches the page only after the page is republished. A server fetch sees it after the item is published and the cache revalidates.
- **Never the whole library in layout data.** For class D, page the cheap `id name` selection, choose the ids (sample, newest, tag), then fetch only those items' fields.
- **Filters live on the container.** A tag filter is a Multilist of tags on the datasource (class A) or a parameter of the fetch (B, D); filter in code. A legacy "tag folder" read by id becomes that field.
- **Order is authored.** Seed rows with `__Sortorder` in steps of 100; Edge returns children in sort order, alphabetical without it [measured 2026-09-27].
- **Derived views show the way to their source.** In editing mode render an "Edit source" link per row (the item's page), so authors are never stuck on content they cannot change here.

## Migrating a legacy list

Most XSLT, WebForms and MVC lists walked the content tree. Translate each by who authors the rows: `references/legacy-translation.md` (`./item` loops, `sc:item(id)` reads, child folders of a page, tag-filtered galleries, "N random").

## Verification

1. Run `scripts/probe-list-delivery.mjs --context <id> --site <site> --route <path>` on every route with lists. It classifies each placement's payload, compares delivered rows with the datasource's `children.total` (silent drop), flags rows not selected as `jsonValue` and any resolver payload, and reports a datasource with children but empty fields (read elsewhere, not editable). The drop check compares only rows under `datasource.children` with the datasource's own children; a query that reads another path is reported as not checked. Exit 1 on a drop, non-`jsonValue` rows or a rejected query; exit 2 when the route does not resolve or not one row count could be verified. A resolver payload is a WARN: the tool reports, the stop condition below decides.
2. For class A, open Pages, select the component, add a row in Manage items, reorder it, edit a row field inline. **This by-hand check is the proof** (done on a tabs list 2026-11-04: inline edit and reorder worked; adding a row was not separately reported). To see the evidence, inspect a row field in the canvas and look for the field chrome. An App Router app fetches layout data on the server, so the layout JSON is not in the browser's network tab; `--editing-layout <file>` is for a layout logged server-side in editing mode. Expect the edit to write to the CM [measured 2026-11-04, from the pull diff]: reordering sets `__Sortorder`, a rich text edit wraps the value in `<div class="ck-content">`, and Pages adds a thumbnail under the media `System` folder. `ser pull` afterwards, or the next push overwrites them.
3. For class B and D, confirm the "Edit source" link in editing mode and that a newly published item appears after revalidation.

## Stop conditions

- The component must show more rows than the budget allows **and** each row must be editable inline: that is two components (a curated class C surface over a class D library), not one.
- The probe warns of a resolver payload on a tenant that uses Edge runtime publishing: treat that warning as a blocker and replace the resolver before anything else.
- A row field cannot be edited inline in Pages: check it is selected as `jsonValue` and rendered through an SDK field component with no `editable={false}`, then fall back to Manage items plus the source item.

## Cross-references

- `content-sdk-list-component`: building a class A component (templates, `__Masters`, branch, Manage items bases, verify script).
- `content-sdk-resolver-patterns`: payload shapes a component receives.
- `content-sdk-navigation-component`, `content-sdk-app-router-component-level-navigation`: menus and other tree-derived navigation.
- `sitecoreai-edge-graphql-capture` § 2b: the measured `ComponentQuery` budget table.
- `content-sdk-app-router-cache-components-and-osr`: revalidating server-fetched lists on publish.
