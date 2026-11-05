---
name: content-sdk-resolver-patterns
description: "Catalog of Content SDK data-delivery patterns and the exact fields payload each returns: SXA content resolvers, resolver GUIDs, item references, empty states. Use when planning a component for an unknown rendering or choosing a resolver."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/react for field components. Pattern identification works against any SitecoreAI tenant ≥ 10.3."
metadata:
  author: Christian Hahn
  version: "0.3.3"
---

# Content SDK — Resolver Patterns

Sitecore can hand the same React component its data in several fundamentally different shapes. The SDL says nothing about which — it just types `LayoutData { item: Item }`. This skill catalogs the patterns, points at the 4 confirmed SXA-foundation resolver GUIDs, and — most importantly — shows that the 4 content-resolver variants only produce **2 distinct React-side shapes**.

> Content resolvers are not supported with Edge runtime publishing (Sitecore docs), and nothing documents their output as editable in Pages. This catalog tells you what a payload is; to choose a delivery for a list, use `content-sdk-collection-data-model`.

## When to use

- Planning a new Sitecore component and asking "what does my React component receive?"
- Reading an unknown rendering item's YAML and trying to figure out which delivery model it uses.
- Reviewing a layout response and trying to classify each rendering's pattern.
- Deciding between writing a Content Resolver in C# vs an Integrated GraphQL query vs auto-serialized fields.
- Onboarding the agent on Sitecore data delivery for the first time.

## The five patterns

### 1. Standard Datasource

**Rendering YAML signals:** `Datasource Template` field set; **no** `ComponentQuery`; **no** `Rendering Contents Resolver` field set; `dataSource` populated on placeholder entry.

**Payload shape:**
```json
{
  "componentName": "Promo_Training",
  "dataSource": "/sitecore/content/.../Data/Promo",
  "params": { "GridParameters": "col-12", "FieldNames": "Default" },
  "fields": {
    "Title": { "value": "..." },
    "Image": { "value": { "src": "...", "alt": "...", "width": "...", "height": "..." } },
    "Link": { "value": { "href": "..." } }
  }
}
```

**React shape:** `<Text field={fields.Title}/>`, `<Image field={fields.Image}/>`, `<Link field={fields.Link}/>`. Zero GraphQL, zero C# — the layout service auto-serializes every field on the datasource template.

### 2. All-Fields Datasource (same as Standard, plus field-type catalog)

Same payload as Standard, but exercises every Sitecore field type. The non-obvious shapes:

| Field type | Shape | Trap |
|---|---|---|
| Single/Multi Line, Rich Text | `{ value: "string" }` | — |
| Image, File | `{ value: { src, alt, width, height, mimeType?, size? } }` | File has richer fields than Image |
| General Link | `{ value: { href, text?, target?, linktype?, ... } }` | — |
| Checkbox | `{ value: boolean }` | — |
| Integer, Number | `{ value: number }` | — |
| Date, Datetime | `{ value: "ISO" }` | — |
| **Droplink, Droptree** | `{ id, url, name, displayName, fields: {...} }` | **No `value` wrapper** — full item inline |
| **Treelist, Multilist, Checklist** | `[ { id, url, name, displayName, fields: {...} }, ... ]` | Array of full items, no `value` wrapper |
| **Droplist** | `{ value: "string" }` | **Looks like Droplink, isn't.** Just a string of the picked option name. |

SDK field components (`<Text>`, `<RichText>`, `<Image>`, `<Link>`, `<DateField>`, `<File>`) consume the `{value:...}` shapes. Lists/refs you render yourself.

### 3. Integrated GraphQL

**Rendering YAML signals:** `ComponentQuery` field populated with a GraphQL query string (using `$datasource: String!` and `$language: String!` variables); `Datasource Template` typically still set; `Rendering Contents Resolver` may be empty.

**Payload shape:**
```json
{
  "componentName": "LinkList_Training",
  "dataSource": "/sitecore/.../Data/LinkList",
  "params": { ... },
  "fields": {
    "data": {
      "datasource": {
        "field": { "title": { "value": "..." } },
        "children": {
          "results": [ { "field": { "link": { "value": { "href": "..." } } } } ]
        }
      }
    }
  }
}
```

The shape of `fields.data` mirrors the GraphQL query's aliased structure. Use when the flat field hash can't express the need (children traversal, filtering, aggregation, cross-item joins). Cost: query lives on the rendering item itself.

**A rejected query does not error; it empties the component.** When Edge refuses a `ComponentQuery` (complexity, depth, or `children` nested two levels deep), the rendering arrives with **`isContentResolved: false`** and no `fields`, and nothing is logged. Treat `isContentResolved: false` on a pattern-3 rendering as a query-budget failure first. Re-run the query directly against Edge to see the error text, and size it with `sitecoreai-edge-graphql-capture` § 2b (measured 2026-09-26 → 28).

### 4. Content Resolvers (.NET) — the 2×2 family

**Rendering YAML signals:** `Rendering Contents Resolver` field set to a resolver GUID; `dataSource` typically populated (even when the resolver ignores it — SXA requires it for Pages chrome).

The SXA Headless foundation ships **four resolver classes** that form a 2×2 matrix on two axes — **source** (where the data comes from) and **cardinality** (item or its children):

|  | **Datasource** (read from `dataSource` field) | **Context** (read from current page item) |
|---|---|---|
| **Single item** | `{3DF775BF-3F56-446F-9D81-43DE64DA4DDA}` Datasource Content Resolver | `{6CCCBCDE-5E95-44E4-AE66-CFE7D3A0589E}` Context Item Resolver |
| **Children list** | `{2F5C334E-5615-423C-8281-9FC180191302}` Datasource Children (the standard SXA "Datasource Resolver") | `{207769CC-38C0-4DE1-B893-A6B037B3AEC4}` Context Children Resolver |

(GUIDs verified against a real SitecoreAI tenant on 2026-05-27. They are SXA foundation items, not project-specific.)

The Navigation Content Resolver is a separate, non-2×2 resolver — see the `## Navigation` section below (open question; not yet fully verified).

### 5. Custom .NET resolvers (anything outside the 2×2 family)

`Rendering Contents Resolver` set to a GUID NOT in the table above → custom resolver class. Shape is opaque from outside — **probe with the `content-sdk-debug-layout-probe` toolkit before writing the component.**

## React-side reality: only 2 shapes to code against

Despite the 2×2 of resolvers, the React side only sees **two distinct payload shapes**:

### Shape A — Single-item

```ts
type SingleItemPayload = {
  [FieldName: string]: SitecoreField;  // { value: ... } or full item ref shape
};
```

**Produced by:** Datasource Content Resolver, Context Item Resolver, Standard Datasource pattern (1), All-Fields Datasource pattern (2).

**Read with:** SDK field components (`<Text>`, `<RichText>`, `<Image>`, `<Link>`, `<DateField>`, `<File>`).

### Shape B — Children list

```ts
type ChildrenPayload = {
  items: Array<{
    id: string;
    url: string;
    name: string;
    displayName: string;
    fields: Record<string, SitecoreField>;
  }>;
};
```

**Produced by:** ChildrenContentResolver, Context Children Resolver.

**Read with:** custom rendering (no SDK component is "list-shaped"). Each `items[i].fields` is itself shape A — recurse with the SDK field components per item.

**Consequence:** **one React component can serve both members of each pair** (Datasource ↔ Context). The only difference is the source, which doesn't affect how you render — the shape is identical. So `ContentResolverProbe` and `ChildrenResolverProbe` are the only two probes you actually need; the 4-file split is over-specified.

## The universal item-reference shape

```json
{ "id": "...", "url": "...", "name": "...", "displayName": "...", "fields": { ... } }
```

This shape appears in **three places**:

1. Droplink / Droptree fields (All-Fields pattern, single)
2. Treelist / Multilist / Checklist field values (All-Fields pattern, array)
3. `items[i]` in any Children-resolver payload (Shape B above)

**Practical implication:** the rendering code for "an item reference" is reusable across all three. Write one `<ItemCard>` and reuse.

## Empty-state field shapes (defensive reads required)

A new content item with no values populated produces these — they are **NOT** the typed defaults you might expect:

| Field type | Empty-state shape | Defensive read |
|---|---|---|
| Single Line / Multi Line / Rich Text | `{ value: "" }` | `fields.Title?.value` (will be empty string, not null) |
| Image | `{ value: {} }` (empty object, NOT `{src:"", alt:"", width:"", height:""}`) | `fields.PromoIcon?.value?.src` |
| General Link | `{ value: { href: "" } }` (only `href`, missing other props) | `fields.PromoLink?.value?.href` |
| Checkbox | `{ value: false }` | `fields.Active?.value` |
| Date / Datetime | `{ value: "" }` or `{ value: "0001-01-01T00:00:00Z" }` | `fields.PublishDate?.value` |
| Item references (Droplink, Treelist, etc.) | `null` or `[]` | `fields.Related?.id ?? ''` / `(fields.Items ?? []).map(...)` |

**Always optional-chain to the deepest leaf.** Don't assume `value` is always defined on the inner object.

## How to identify the pattern (from rendering YAML)

```
inspect rendering item under /sitecore/layout/Renderings/.../<Name>.yml

  Has ComponentQuery field populated AND no Rendering Contents Resolver?
    → Pattern 3 (Integrated GraphQL)
  Has Rendering Contents Resolver GUID populated?
    Match against the 2×2 table?
      → Pattern 4 (Content Resolver, one of the 4 known) — use Shape A or B
    Else
      → Pattern 5 (Custom resolver) — probe to learn shape
  Else dataSource on placeholder is non-empty + no resolver?
    → Pattern 1 or 2 (Standard / All-Fields Datasource) — Shape A
  Else
    → Likely buggy / unfinished — probe to confirm
```

**Note:** When BOTH `ComponentQuery` AND `Rendering Contents Resolver` are set on a rendering, **the resolver wins** — `fields` carries the resolver's shape, not the GraphQL shape. The query is dormant. Verified on Context Children Resolver during the 2026-05-27 capture.

## Navigation (open question — parked)

`Navigation_Training` uses a navigation-specific resolver (NOT one of the 4 in the 2×2). Behavior depends on `LevelFrom` / `LevelTo` / `Filter` / `AddRoot` params. As of 2026-05-27 the current state returns `fields: [<single root item>]` (with `AddRoot=1`), but the full multi-level tree behavior isn't fully verified. Approach for now: build navigation with **component-level data fetching using a custom GraphQL query** rather than fighting the resolver, and treat the resolver as "use it when behavior matches; otherwise replace with a query."

## Hard Rules

- **The SDL only types `LayoutData { item: Item }`.** Everything inside `rendered.sitecore.{context,route}` is untyped JSON. There is no schema-level type safety for `fields`. Patterns are runtime contracts, not type contracts.
- **Identify the pattern BEFORE writing the React component.** Wrong assumption = empty render at best, runtime crash at worst.
- **For unknown resolvers, ALWAYS scaffold a `ResolverProbe` dummy first** (see `content-sdk-debug-layout-probe`). Capture the shape, then write the real component.
- **Two probes are enough, not four** — one for Shape A (single-item) and one for Shape B (children-list) cover the entire 2×2 of content resolvers.
- **SDK field components (`<Text>`, `<RichText>`, `<Image>`, `<Link>`) only consume `{value:...}` shapes.** For Droplink/Droptree/Treelist/Multilist/Checklist and Children-resolver `items[i].fields`, render manually using `item.fields.<FieldName>.value`.
- **Droplist is a string, not an item reference**, despite its name suggesting Droplink kinship. Don't try to render `Droplist.id` — it doesn't exist.
- **Always optional-chain to the deepest leaf.** Empty-state shapes are NOT the populated shape with empty strings — they're often missing inner keys entirely (`{value: {}}` for an empty Image).
- **`dataSource` is always populated on Context-resolver renderings even though the resolver ignores it** — SXA requires it for Pages chrome. Don't try to "fix" the apparent disconnect.
- **Resolver GUID wins over ComponentQuery** when both are set. The query is dormant; the resolver's shape comes through. To switch to GraphQL, clear the resolver field.
- **Integrated GraphQL queries run on every layout fetch** — keep them lean. They cost more than auto-serialized fields.
- **Content Resolvers can fall back to defaults silently** — if `dataSource` is empty AND the resolver auto-resolves to the site root, you might see results from a different item than you expect. Verify with the layout probe.
- **Empty `fields: []` from a Content Resolver is NOT a bug** — it means the resolver ran successfully and found nothing. Check the resolver's required params and the source items.

## Stop Conditions

- **Don't infer the pattern from the rendering's NAME alone.** Read the YAML — the name can lie (e.g., "Context Children Resolver" could in principle use Integrated GraphQL; only the rendering item tells you which it actually is).
- **Don't assume a shape from one capture.** Resolvers may behave differently based on params, page context, or content tree state. Capture multiple states (different pages, different params) before locking in a TypeScript type.
- **Don't write a TypeScript type from prose docs.** Capture from a real Edge response. The doc shape and the runtime shape drift.

## Verification

- For any new rendering, the React component should render correctly against the live layout response (use `content-sdk-debug-layout-probe` to capture).
- For Children-resolver renderings, verify the `items[i].fields` shape against your expected per-item field set. The wrapper is always `{items:[...]}`; only the inner `fields` varies.
- The InstrumentedFrame `tone` should match the identified pattern (accent / ok / warn / ink) — that's a visual sanity check.
- If `fields` is undefined/null/empty when it shouldn't be, return to the rendering YAML and re-verify the pattern (especially the resolver-GUID-vs-ComponentQuery precedence).

## Related

- `content-sdk-debug-layout-probe` — the probe toolkit for discovering payload shapes.
- `content-sdk-component-naming-traps` — for getting the file structure right once the shape is known.
- `content-sdk-field-usage-image-link-text` — SDK field components for Shape A.
- `content-sdk-app-router-graphql-data-fetching` — for Integrated GraphQL (pattern 3) and the recommended approach for Navigation (component-level queries).

## References

- [SXA Headless Content Resolvers overview](https://doc.sitecore.com/xmc/en/developers/xm-cloud/rendering-contents-resolver.html)
- [Integrated GraphQL on rendering items](https://doc.sitecore.com/xmc/en/developers/xm-cloud/integrated-graphql.html)
- Evidence: four base-pattern layout captures plus the four content-resolver variants captured live through `/api/layout-debug?path=/Components/Content-Resolvers` (`content-sdk-debug-layout-probe`) on 2026-05-27; the payload shapes in this skill are transcribed from those captures.
