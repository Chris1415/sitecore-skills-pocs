---
name: content-sdk-navigation-component
description: "Decides how to build navigation on a Sitecore head app: derived from the content tree vs an authored link list, plus the traps that make nav fail silently. Use when adding a site nav, jump bar, footer links or breadcrumb."
license: Apache-2.0
compatibility: "SitecoreAI. Content SDK head apps (App Router and Pages Router). Derived from a one-pager build and two multi-page brands on one SitecoreAI estate, 2026-08-28; the list-component leg corrected 2026-09-18 to match content-sdk-list-component 1.2."
metadata:
  author: Christian Hahn
  version: "1.3.1"
---

# Sitecore Navigation Components

## The decision, first

Navigation looks like one problem and is two. **The markup is nearly identical; the data source is not.**

| Question | Shape |
|---|---|
| Should the nav change when someone adds a page? | **Derived.** Walk the content tree. |
| Is this a curated set of destinations an editor decides? | **Authored.** A list of link items. |
| One page, jumping to sections on it? | **Authored**, with anchor links. A derived nav has nothing to walk. |

**Default to two renderings, not one with a mode switch.** They share a presentation layer and
nothing else — different fields, different fetch, different failure modes, different editor
experience. One rendering that branches on a parameter has to satisfy both contracts at once, and
the trap in § "Do not fetch instead of `fields`" is exactly where that goes wrong.

Use **one rendering with a `Source` rendering parameter** only when you genuinely need an author to
flip an existing placement between modes without re-placing it. That is rarer than it sounds.

**Both on one page is normal and correct** — a derived site nav in the header, an authored section
jump-bar under it. They are different renderings doing different jobs, not a duplication.

---

## Derived navigation

Walks the tree from a root, to a bounded depth, through a filter.

### `rootPath` is the SITE node, not Home

The single most common mistake. The site item and the home page are different items — point at the
site node and append `/Home` (or whichever child is the actual home) to get the level you mean.
Aiming at the site node and rendering its children gives you *Home, Data, Media, Settings*, i.e.
the site's plumbing in the navigation bar.

### Bound the depth explicitly — Edge degrades SILENTLY

**Sitecore Edge has a query depth budget, and exceeding it does not error.** It returns a truncated
result. A three-level nav built against a small tree works, ships, and then quietly loses its third
level when the tree grows — with a green build, a 200, and no console warning.

So: state the depth as an explicit number (a rendering parameter or a field), never "walk all
children". And when you test it, **test against a tree deeper than the one you designed for** — a
nav that is correct on a 6-page site proves nothing about a 200-page one.

### Filter deliberately

A `Navigation Filters` item (the SXA-shaped hook) or an explicit "show in navigation" checkbox on
the page template. Without one, every scaffolding page — `Components Preview`, test pages, staging
drafts — appears in the public nav the moment someone creates it. That is a content-authoring
accident waiting to happen, not a hypothetical.

### The stock headless Navigation resolver: set its parameters, know its limits

Measured on SitecoreAI preview, 2026-10-29. With only the variant (`FieldNames`) on the placement, the
stock Navigation rendering returns level 1 below Home, no children, hidden pages included. Its
headless parameters template shows no navigation fields, yet the resolver reads SXA's Foundation
ones from the placement: `Filter` (a Navigation Filter item: Main / Sidebar / Breadcrumb Navigation),
`LevelFrom` and `LevelTo` (items under `Navigation/Enums/Navigation Level`), `NavigationRoot`,
`Flattened`, `AddRoot`. With a filter and levels set it drops filtered pages, nests `Children` and
marks the context page `active`; `LevelFrom` = `LevelTo` = 2 is a section menu of the current
level-1 ancestor. Every entry carries only `Id`, `Href`, `NavigationTitle`, `Styles`, `Querystring`.

Two things it cannot do: expand only the active trail (it returns the full level range for every
branch), and list an item whose template does not derive from `_Navigable`. A "link in the menu"
item (an external URL at a position in the tree) is skipped, and even on `_Navigable` it would get
its own URL, not the link. A menu that needs either keeps its own walk (component-level GraphQL),
reading the stock `NavigationFilter` so hiding a page still works the stock way.

---

## Authored navigation

A curated list of links. **This is a list component** — an author must be able to *add a row*, not
merely re-point rows that already exist.

**Load `content-sdk-list-component` and follow it.** The short version: a Multilist alone is the
wrong shape, because it only lets an author choose among items that already exist. You need a
container template that carries **`_HorizonDatasourceGrouping`** as a base template (that is what
gives Pages its **Items** section, i.e. the "add a link" affordance), an element template, insert
options via the container's `__Standard Values.__Masters` (which only decides *which* template a new
row uses), and a **branch** as the rendering's Datasource Template. The four legs fail
independently — an earlier version of this paragraph credited `__Masters` with the Pages affordance,
and that was wrong: a template can carry `__Masters` and still give an author no way to add a row.

### In-page anchors (the one-pager case)

Each link item carries a General Link field whose **`linktype` is `anchor`**, with the target
section id as the anchor value. Two things to get right:

- The target `id` must exist in the rendered DOM. Assert it — an anchor pointing at a section that
  was renamed scrolls nowhere and returns HTTP 200 while doing it.
- **Never write `href={link?.value?.href || '/'}`.** A fail-open fallback turns a missing link into
  a silent dead link that every crawler and every smoke test reports as fine. Render nothing, or
  render the item unlinked, but do not invent a destination.

---

## Do not fetch instead of `fields` — the trap that survives every gate

The authorability trap in its purest shape — a component that renders perfectly and cannot be
edited — and navigation is where it bites hardest.

A derived nav is fetched, so it is tempting to fetch the authored one too — or to write one
component that fetches in both modes. **`ComponentQuery` REPLACES the entire `fields` payload.** A
component whose data arrives that way has no `fields` for the editor to click, so it renders
perfectly and cannot be edited in Pages. That is how a previous build shipped 17 of 21 renderings
un-editable past 704 tests, 88 e2e tests and four reviews.

The rule is narrow and worth stating precisely: **"derive your TYPES from the SDK's `.d.ts`" is a
rule about typing what you fetch. It does not license fetching instead of `fields`.**

- **Authored nav:** every link arrives on `fields` and renders through an SDK field component.
- **Derived nav:** the *tree walk* is a fetch, necessarily — but any authored chrome on the same
  rendering (a heading, a CTA) still arrives on `fields`. Do not let the fetch swallow the
  authorable parts.

Verify by opening the Pages canvas and clicking the thing. `audit-component-authorability.mjs` is a
floor: it cannot tell whether the fields a component renders are the *right* ones.

---

## Checklist

- [ ] Decided **derived vs authored** from the data source, not from how it looks.
- [ ] Two renderings unless an author genuinely needs to flip modes in place.
- [ ] Derived: `rootPath` resolves to the **site node**, with the home child appended.
- [ ] Derived: depth is an **explicit bound**, and was tested against a deeper tree than designed for.
- [ ] Derived: a filter exists, so scaffolding pages cannot appear in the public nav.
- [ ] Authored: built as a **list component** (`content-sdk-list-component`) — an author can ADD a row.
- [ ] Anchors: `linktype: anchor`, and every target id asserted present in the DOM.
- [ ] **No fail-open `|| '/'` href anywhere.**
- [ ] Authored values arrive on `fields`, not via a `ComponentQuery` that replaces the payload.
- [ ] Opened Pages and edited one link by hand. The audit is a floor, not proof.
