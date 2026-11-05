---
name: content-sdk-list-component
description: "Decides whether a rendering is a list component and builds it so an author can add rows: datasource grouping, insert options, branch template, children-aware delivery. Use for repeating rows such as nav links, cards, stats, accordions or tabs."
license: Apache-2.0
compatibility: "SitecoreAI Authoring GraphQL v1. Content SDK head apps (App Router and Pages Router). Confirmed live against a SitecoreAI tenant 2026-06-23; re-measured 2026-08-28 (leg 0 confirmed in the Pages canvas); 2026-09-27: `build-list-component.mjs` verify now dashes braced GUIDs read back from live fields, and leg 3 reads `ComponentQuery`."
metadata:
  author: Christian Hahn
  version: "1.7.4"
---

# Sitecore List Components

## The decision, first

Ask one question about every rendering: **would an author ever want to add a row?**

| Answer | Shape |
|---|---|
| No — a fixed set of the datasource's own fields | **Single component.** One datasource template. Done. |
| **Yes** — repeating rows: nav links, cards, stats, entries, panels, tabs | **List component.** Everything below applies. |

Get this wrong and the component still renders perfectly, passes every test, passes the authorability audit, and is **un-editable in the way that matters**: the author can change the rows that exist and cannot create one.

**FOUR legs, and they fail independently — check all four.** Measured on one brand, 2026-08-28, where four renderings displayed repeating rows (`Header`/NavLink, `ServiceTrio`/ServiceItem, `SelectedWork`/WorkEntry, `StatBand`/StatItem) and every one came out identically:

| Leg | What it buys | measured |
|---|---|---|
| **0. `_HorizonDatasourceGrouping` base template** | the **Items** edit section in **Page Builder** — where an author can create a child of the right type | ❌ absent on all four |
| 1. `__Masters` on the container SV | insert options — **which** template a new child uses | ✅ correct on all four |
| 2. `Datasource Template` = a BRANCH | a **new** datasource ships with a row already in it | ❌ bare template |
| 3. children-aware **delivery** | the added child actually **renders** | ❌ Multilist on the container |

**Leg 0 is the one an author notices, and it is the easiest to miss** because the component is otherwise complete. Without it the insert options exist only in the **Content Editor tree** — which is not where authors work. `_PublishingGroupingTemplate` travels with it (11/11 and 6/6 on the two brands of that estate that carried it).

⚠️ **Legs 0 and 1 are independent, not two names for one thing.** Measured across one estate: one brand has **6 templates with Horizon and no `__Masters`**; another has 2 with `__Masters` and no Horizon, and 9 with both. Do not infer one from the other, and do not assume that having one means the author can add a row.

**Leg 1 passing is not evidence for the rest.** All four of that brand's components shipped past 74 unit tests, a 7/7 authorability audit, four code reviews and a full test pass. It was found by a human opening Pages and looking for an add button.

**This is an estate-wide gap, not one build's miss.** `_HorizonDatasourceGrouping` appears on 11/34 and 6/37 templates of two brands, and on **0** of 64, 0 of 32, 0 of 44 and 0 for the other four — so four of six brands shipped with no list-editable component at all.

## Why a Multilist is not a list component

A Multilist (or Treelist / Checklist) field on the parent datasource **references items that already exist somewhere else**. Consequences an author feels:

- **Adding a row is two operations, in two places** — create the item in the content tree, then come back and add it to the field. Miss the second and the item exists and renders nowhere.
- **There is no "add" affordance in the component itself.** The author must know where the items live.
- **You do not control the ordering from the component** — it is the field's order, edited in a picker.

A list component's rows are **children of the datasource**, so adding one is a single action in Pages, in place.

Multilist is still right when the referenced items are **shared across components or pages** (a global set of links, a shared taxonomy). Choose it deliberately, not by default.

## The four deltas vs a single component

Read-confirmed against the OOTB SXA **Link List** on a live tenant, 2026-06-23.

### 0. Base templates on the CONTAINER — the leg that decides whether Pages shows anything

```
<container template> → __Base template =
    Standard template | _PublishingGroupingTemplate | _HorizonDatasourceGrouping | _PerSiteStandardValues
```

| GUID | |
|---|---|
| `{D0F6BE14-2A2D-4C56-ACB5-80CAA573B8E2}` | `_HorizonDatasourceGrouping` |
| `{8BA7DAC6-32ED-4378-BD9E-5DA5B0F9848D}` | `_PublishingGroupingTemplate` |

**`_HorizonDatasourceGrouping` is what gives Page Builder the "Items" edit section**, through which an author creates a new child of the right type. Skip it and everything else can be correct while the author sees no way to add anything — because the affordance the other legs enable lives in the Content Editor tree, not in Pages.

✅ **Confirmed in Page Builder, 2026-08-28.** That brand's four containers had `__Masters` correct and no Horizon: no Items section. Adding `_HorizonDatasourceGrouping` + `_PublishingGroupingTemplate` to the container templates — changing nothing else — made the Items section appear, verified by a person in the canvas. This is a measurement, not an inference from the estate.

Put it on the **container only**. The element template is a row, not a grouping.

### 1. Two datasource templates

- A **container** — the list-level fields (`Title`, `Heading`).
- An **element** — one row's fields (e.g. `Link <General Link>`).

The element has **no `__Standard Values`** in the OOTB pattern.

### 2. Insert options wire container → element

```
<container template>/__Standard Values → __Masters = <element template id>
```

`__Masters` decides **which template** a new child is created from. OOTB Link List's SV carries `__Masters = {E24E0789-A058-48BF-ABB6-C69C0E60B6B7}` (the `Link` template).

⚠️ **This is not the same thing as leg 0 and does not substitute for it.** An earlier version of this skill claimed `__Masters` "is what puts the add affordance in Pages" — that is wrong, or at best true only in the Content Editor. The estate disproves the conflation directly: one brand carries Horizon on six templates that have **no** `__Masters` at all.

### 3. The rendering’s `Datasource Template` points at a BRANCH, not a bare template

```
/sitecore/templates/Branches/Project/<Brand>/<Site>/<Component>
```

The branch's `$name` item uses the container template, **also** carries `__Masters`, and **ships one default element** (`Link 1`) — so a newly created datasource is a non-empty list rather than an empty box the author has to guess at.

Pointing at the bare container template instead gives the author an empty list on every new datasource.

### 4. Children-aware delivery

The rows are children, so the payload must carry them. The mechanisms are **ranked**. First check the list really is owned rows: `content-sdk-collection-data-model` decides that.

| Rank | Mechanism | Note |
|---|---|---|
| 1 | **Integrated GraphQL (`ComponentQuery`)** with every field as `jsonValue` | Expresses container fields **and** children in one query. Marketer-friendly, one write operation per row, and go-live is controlled by workflow. A new row reaches the page after the page is republished. Row fields edit inline and rows reorder in Pages (confirmed by hand 2026-11-04). |
| 2 | **Component-level fetch** | A server fetch in the head app. Pages freely and has no republish dependency, but carries no editing metadata: right for rows authored elsewhere, not for owned rows. |
| avoid | **Children content resolver** | Delivers Shape B `{ items: [...] }` and nothing else, so the container's own fields (`Heading`) are lost. Sitecore documents content resolvers as **not supported with Edge runtime publishing**, with no filtering or paging, and nothing documents their output as editable. |

⚠️ **`ComponentQuery` replaces the ENTIRE `fields` payload**, taking inline-editing metadata with it for every field not selected as `jsonValue` (the authorability principle: a component is done when an author can find its content and change it, not when it renders). That is a reason to design the query to return everything the component renders — **not** a reason to ban the mechanism. A blanket "no ComponentQuery" rule pushes every list onto Multilist and produces the un-extendable shape above.

⚠️ **A `ComponentQuery` list has two silent failure modes** (measured 2026-09-26 → 28; the full budget table is in `sitecoreai-edge-graphql-capture` § 2b):

- **`children` nested two levels deep inside a `ComponentQuery` breaks resolution.** The rendering arrives with `isContentResolved: false` and no error. Keep the query to one level of `children`, and fetch deeper rows server-side with `client.getData`.
- **A row past `children(first: N)` is silently dropped.** `first` must be **strictly greater than** the authored row count, or the row an author adds in Pages never reaches the page. Size `first` to the real row count plus headroom, not a blanket 50, because `first:50` alone can exceed Edge's complexity budget. Record each list's maximum authorable row count next to its query.

## Build order

1. Create the **element** template (row fields). Icon it.
2. Create the **container** template (list-level fields). Icon it. Add `__Standard Values`.
3. Set the container SV's **`__Masters`** to the element template id. ← the step that is easy to skip and defines the outcome
4. Create the **branch** under `/sitecore/templates/Branches/…`, `$name` on the container template, carrying `__Masters` and **one** default element.
5. Point the rendering's **`Datasource Template`** at the **branch**.
6. Wire delivery: a `ComponentQuery` with `jsonValue` fields, the resolver cleared (ranking in leg 4).
6a. **Set `__Sortorder` on every row you seed over Authoring GraphQL** (steps of 100, in the intended order). Without it the rows come back **alphabetically**, not in creation order. One build shipped 5 nav sections and 63 links in the wrong order this way (2026-09-27).
7. Icons on every item and every `__Standard Values` (`content-sdk-icon-chooser`).

## Verify in the authoring UI, not in the tree

`scripts/build-list-component.mjs` does the mechanical half: `verify --rendering <path>` reads all four legs of an existing rendering off the live tenant (exit 1 on a missing leg), and `build … ` prints the plan for a new one and only writes with `--apply`. It asserts the seven system GUIDs it relies on before judging anything, so a wrong host or token exits 2 rather than reporting a component as broken.

The tree looks correct at step 2. **Open Pages, select the component, and confirm you can add a row.** Nothing short of that proves `__Masters` and the branch are wired — no test, no schema audit and no authorability audit reaches this, because the component renders correctly either way.

## Cross-references

- `content-sdk-create-component` — base-template inheritance, template folder layout, the `copyItem` recipe
- `content-sdk-collection-data-model` — whether a list is owned rows at all (derived views, curated references and large libraries are built differently)
- `content-sdk-resolver-patterns` — the 2×2 of resolvers and the two React-side payload shapes
- `content-sdk-icon-chooser` — the `__Icon` step in build order
- The authorability principle — *renders ≠ authorable*: a component is done when an author can find its content and change it; this skill is the list-shaped case of it
