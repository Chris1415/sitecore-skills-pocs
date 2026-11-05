# Standard structure components: what the CM holds and what Edge delivers

Measured read-only on a SitecoreAI tenant on 2026-10-15 (Authoring GraphQL on a six-site headless SXA estate, and Edge preview on a CM holding four migrated XM/XP sites: 232 routes, 223 of them with structure, 2,898 Container, 866 Column Splitter and 9 Row Splitter placements). The item ids below are platform items (the same on every SitecoreAI CM), not tenant data.

## 1. The renderings

Two sets sit under `/sitecore/layout/Renderings/Feature/`. **Use the JSS set.** The MVC set (`Experience Accelerator/Page Structure`: Container, Divider, EditModePanel, IFrame, Column Splitter, Row Splitter, Toggle) is controller renderings with no `componentName`, unusable by a head app. There is **no JSS Divider and no JSS Toggle**.

`JSS Experience Accelerator/Page Structure`:

| Rendering | Item id | `componentName` | Parameters Template | Placeholders field | Other Properties |
|---|---|---|---|---|---|
| Container | `7a1d9a21b8d742f99b0b92abf8d1974f` | `Container` | `{45130BDB-BAE3-4EDC-AEA8-7B68B9D94C7F}` | 1 setting: `container-{*}` | `IsRenderingsWithDynamicPlaceholders=true&UsePlaceholderDatasourceContext=true` |
| Column Splitter | `15cabdffffd948f4826da4c3d7868d3a` | `ColumnSplitter` | `{181740EA-A7AE-4799-A649-A75917570E38}` | 8 settings: `column-1-{*}` .. `column-8-{*}` | `IsRenderingsWithDynamicPlaceholders=true&IsColumnSplitterRendering=true` |
| Row Splitter | `5f6bf7c9c80c4bbdad788da749b35206` | `RowSplitter` | `{DB88EFA8-E015-4B96-BA0E-348D8B510563}` | 8 settings: `row-1-{*}` .. `row-8-{*}` | `IsRenderingsWithDynamicPlaceholders=true&IsRowSplitterRendering=true` |

All three have no Datasource Template and no Datasource Location: structure has no content of its own. `UsePlaceholderDatasourceContext` lets a Container's children inherit a datasource context. The ceiling is **8** columns or rows (eight placeholder settings, and the Pages "Manage columns" UI stops there).

The head app needs one file per `componentName`, in a folder of the same name: `src/components/Container/Container.tsx`, `ColumnSplitter/ColumnSplitter.tsx`, `RowSplitter/RowSplitter.tsx`. A placement without that file shows "<X> — Content SDK component is missing React implementation" in Pages.

## 2. Parameters templates

| Template | Own fields | Bases |
|---|---|---|
| Container | `BackgroundImage` (Image, source `query:$siteMedia`) | `BaseRenderingParameters`, `IDynamicPlaceholder`, `_PerSiteStandardValues`, `IRenderingId`, `IStyling`, `IComponentVariant`, `Grid Parameters`, `JSON-LD`, `Standard Rendering Parameters` |
| Column Splitter | `ColumnWidth1..8` (field type **Grid Parameters**), `Styles1..8` (Styling Parameters) | the same, plus `ISplitter` |
| Row Splitter | `Styles1..8` | the same, plus `ISplitter` |

What the bases contribute:

| Base | Field(s) |
|---|---|
| `IDynamicPlaceholder` | `DynamicPlaceholderId` |
| `ISplitter` | `SplitterSize` (Number), `EnabledPlaceholders` (text, e.g. `1,2`) |
| `IRenderingId` | `RenderingIdentifier` (becomes the root element `id`) |
| `IStyling` | `Styles` (Styling Parameters, from the site's Presentation/Styles) |
| `IComponentVariant` | `FieldNames` (the headless variant) |
| `Grid Parameters` | `GridParameters` (field type Grid Parameters, **empty source**: the grid comes from the site, see `grid-and-css.md`) |

`IComponentVariant` means a structure component can carry variants like any other rendering (`content-sdk-variants-vs-siblings`).

## 3. Placeholder settings

`/sitecore/layout/Placeholder Settings/Feature/JSS Experience Accelerator/Page Structure` holds the 17 structure keys: `container-{*}`, `column-1-{*}`..`column-8-{*}`, `row-1-{*}`..`row-8-{*}`. Their ids are exactly the ids in the renderings' Placeholders field. `headless-header`, `headless-main` and `headless-footer` live under `Foundation/JSS Experience Accelerator/Placeholder Settings`.

**None of them sets Allowed Controls** (3 of 78 placeholder settings on the measured CM did, none of them structure or headless keys), so any rendering may be dropped into a column. Restricting is a CM decision per key; see `custom-layout-component.md` § 3.

## 4. What Edge delivers

A Container holding a Column Splitter, from a real page (trimmed):

```
[headless-main] PartialDesignDynamicPlaceholder  params { sid, ph: "headless-main", sig: "sxa-article-content" }
  [sxa-article-content]
    Container       params { GridParameters: "col-sm-12", DynamicPlaceholderId: "1" }
      [container-{*}]
        ColumnSplitter  params { ColumnWidth1: "col-sm-8", ColumnWidth2: "col-sm-4",
                                 SplitterSize: "2", EnabledPlaceholders: "1,2", DynamicPlaceholderId: "2" }
          [column-1-{*}]  PageContent
          [column-2-{*}]  Container { DynamicPlaceholderId: "4" } > [container-{*}] AuthorTeaser, LinkList
          [column-3-{*}] .. [column-8-{*}]   empty
```

Facts that matter for the code:

- **Edge keys are the wildcard form** (`container-{*}`, `column-N-{*}`, `row-N-{*}`). The instance id travels only in `params.DynamicPlaceholderId`.
- **The raw layout stores the concrete key**: `/headless-main/sxa-article-content/container-1/column-2-2/container-4`. Formula: `container-<id>`, `column-<n>-<id>`, `row-<n>-<id>`.
- **`DynamicPlaceholderId` is a per-page counter shared across kinds.** A Container and a Column Splitter can both be `2` on one page; the prefix disambiguates.
- **All eight column or row keys are always emitted**, used or not. `EnabledPlaceholders` is the only record of which are active, and it is **not necessarily sorted** (`1,3,2,4` was observed).
- `GridParameters` and `Styles` are delivered as **class names**; the raw layout stores the option or style item GUIDs and Edge resolves them.
- A Container with no `GridParameters` still carries `DynamicPlaceholderId`.
- `CacheClearingBehavior` sometimes appears in `params` (`Clear on publish` or `Clear+on+publish`): ignore it.
- A Style item arrives as its **`Value`** (a class token), never its GUID; a slot component's `Styles` preset reads directly.
- Pages writes `GridParameters=col-12` and `FieldNames=Default` on every structure rendering it places.

## 4a. Writing a layout programmatically

Measured 2026-10-15 while composing test pages through Authoring GraphQL (`updateItem` on `__Final Renderings`). Two traps, both silent:

1. **Only Pages' delta form renders.** A plain full layout in `<d>` is accepted and ignored (`headless-main` stays empty); a `<d>` without the layout id makes Edge return `layout: null`. The form Pages writes:
   `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{device}">` then one `<r uid="{…}" p:before="*" s:id="{rendering}" s:par="…" s:ph="/headless-main" />` for the first rendering and `p:after="r[@uid='{previous uid}']"` for every later one; no `l=` on `<d>` (the layout id stays in `__Renderings`).
2. **`updateItem` without `version: 1` reports success and persists nothing** on a versioned field.

Write params the way Pages does, so the page behaves as if authored there: every key listed, empty ones as bare keys, values URL-encoded, multi-device widths as pipe-joined option GUIDs. A Column Splitter Pages wrote:

```
ColumnWidth1={col-6 xs}|{col-xxl-4}&ColumnWidth2=…&ColumnWidth3=…&ColumnWidth4&…&ColumnWidth8
&GridParameters={col-12 xs}&SplitterSize=3&EnabledPlaceholders=1,2,3&FieldNames
&Styles1&…&Styles7&Styles&Styles8&RenderingIdentifier&CSSStyles&DynamicPlaceholderId=3&Include in schema
```

The placeholder path of a child is the parent's concrete key: `/headless-main/container-1/row-1-2` for row 1 of the Row Splitter whose `DynamicPlaceholderId` is 2. Prefer authoring in Pages; write programmatically only for test or migration pages, and read the result back on Edge preview every time.

## 5. How the SDK resolves a placeholder name

Read in `@sitecore-content-sdk/react` 2.4.0 (`dist/esm/components/Placeholder/placeholder-utils.js`, `getPlaceholderRenderings`; helpers in `@sitecore-content-sdk/content` `dist/esm/layout/utils.js`, `isDynamicPlaceholder` / `getDynamicPlaceholderPattern`):

1. For each key in `rendering.placeholders` that contains `{*}`, build `^<key with {*} replaced by \d+>$`.
2. If the **requested** name matches (e.g. `column-1-2` against `^column-1-\d+$`), use that key. Outside editing the SDK renames the key in the layout data; in editing the metadata keeps the `{*}` form.
3. Otherwise, look the name up exactly. So the literal `column-1-{*}` also works.
4. No match: `console.warn("Placeholder 'X' was not found in the current rendering data")` and nothing renders.

So **both** `column-${n}-${DynamicPlaceholderId}` (Sitecore's documented form) and the literal `column-${n}-{*}` (what the upstream starter's splitters use) resolve. The regex is `\d+`, so a non-numeric id only works with the literal form. `assets/layout-params.ts` → `slotName()` uses the concrete id and falls back to the literal.

**`params.styles` (lowercase) is computed by the SDK** (`getSXAParams`: `[GridParameters, Styles].filter(Boolean).join(' ')`) and is **absent when both are empty**. Upstream Row and Column Splitters interpolate `${styles}` and print the class `undefined`. `styleClasses()` merges and de-duplicates all three.

**`AppPlaceholder` injects `page` and `componentMap` into every child it renders.** Upstream imports `.sitecore/component-map` (the SERVER map) directly and passes it on, which is equivalent. What is never right is the bare `Placeholder`, which resolves the CLIENT map from context and renders "Placeholder X contains unknown component".

## 6. Where the upstream source lives

`Sitecore/xmcloud-starter-js`, `examples/kit-nextjs-article-starter/src/components/sxa/` (`Container.tsx`, `RowSplitter.tsx`, `ColumnSplitter.tsx`, `PartialDesignDynamicPlaceholder.tsx`), also in the location-finder, product-listing and skate-park kits. **`create-content-sdk-app --template nextjs-app-router` ships only `PartialDesignDynamicPlaceholder`**: no Container, no splitters, no grid CSS. The kit's grid styling depends on the npm `tailwind-bootstrap-grid` plugin plus two CSS files (`grid-and-css.md` § 3); copying only the `.tsx` gives unstyled, stacked columns.

The `assets/components/` copies differ from upstream in three ways, each a defect fix: no `undefined` class, slots in `EnabledPlaceholders` order with a fallback when it is empty, and a placeholder name that survives a non-numeric id. They keep upstream's markup (`component`, `component-content`, the inner `.row`), because the site's SXA styles and the grid CSS select on it.
