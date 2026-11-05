---
name: content-sdk-feature-planner
description: "Turns a feature ask for a Content SDK head app into a Sitecore blueprint before code: page, component, setting or dictionary; content model; rendering; data; authorability. Use when a feature must become templates and files. Not implementation."
license: Apache-2.0
compatibility: "Content SDK head apps (App Router default; the decisions are router-agnostic) on SitecoreAI with Experience Edge. Produces a plan only; the specialist skills it routes to carry the procedures."
metadata:
  author: Christian Hahn
  version: "0.1.4"
---

# Content SDK — Feature Planner (feature → Sitecore blueprint)

A feature ask ("team page with filterable cards", "regional promo banner", "FAQ accordion") is cheap to build and expensive to build wrong. The costly defects on this stack **all render correctly**: a component nobody can edit, a datasource written into another site's tree, a list whose rows an author cannot add, a query that degrades silently on Edge. Each comes from a decision made, or skipped, before the first file. This skill makes those decisions explicit, in a fixed order, and writes them down as a one-page blueprint.

**It plans; it does not build.** Every step names the specialist skill that owns the procedure. Load that skill when the step is executed, not while planning, unless a decision depends on its detail.

## When to use

- A feature request must become templates, renderings, datasources and head-app files.
- Before cloning a rendering, adding a component or extending a content model.
- When reviewing someone else's plan for a Sitecore feature ("did they decide authorability?").

**Not for:** writing the code (use the skills named per step), early idea exploration, or the architecture stage of a delivery pipeline that already owns ADRs and a blueprint (feed it this skill's decision order instead of running both).

## Step 0: inventory what exists

Reuse beats creation. Before deciding anything, list the site's real component palette and content model: renderings, their datasource templates, Headless Variants, list containers, the `/Data` folders. A new presentation of an existing component is usually a skin or a variant, not a new rendering.
→ `sitecoreai-content-composition` (inventory recipe), `sitecoreai-graphql-schemas` (template reads), `content-sdk-debug-layout-probe` (what a page actually delivers).

## The decision sequence

Decide in this order; later steps depend on earlier answers. Record each as **chosen option + one-line why** in the blueprint (`references/blueprint-template.md`).

### 1. What kind of thing is it?

| If the value… | It is a… |
|---|---|
| is the page's own subject (article body, product facts) | **page field** on the page template, read from the context item |
| differs per placement, authored in Pages | **component** with a datasource |
| is shared by every page of the site (logo, social links, legal line) | **site-level setting** item, read server-side, or chrome in a Partial Design |
| belongs to the component, not the instance (aria-labels, "Show more", empty-state lines) | **Sitecore Dictionary** entry, with a literal code default |
| is computable from the CM (counts, "available now", option lists) | **derived** at render time, never authored |

**The liveness test:** copy containing *remain, available, today, now, left* cannot be authored text; derive it. A historical fact ("143 sold since 2011") can be authored.
→ `content-sdk-app-router-dictionary-and-i18n` (dictionary keys; Edge returns the **key itself** for an untranslated phrase, so treat `value === key` as missing).

### 2. Content model

Name every template, its fields with types, base templates, `__Standard Values` defaults, insert options and **where datasources live**.

- **Scope:** renderings and datasource templates are **collection-scoped**; Available Renderings, Headless Variants, Page / Partial Designs, Placeholder Settings and Styles are **site-scoped**. A second site in a collection reuses the model for free.
- **Datasource Location must be site-relative** (`query:$site/...`). A hard GUID pins every future site to the first site's `/Data`: authors of site B silently write into site A. Nothing catches it; audit it in the plan.
- **Local datasources live in `<Page>/Data`**, never bare under the page.
- **Per-instance knobs** (layout style, tone) go on the datasource template as **Shared** fields, not on a linked Parameters Template; a linked params template on a datasource-backed rendering can drop the whole route on Edge.
- Fields that must not differ per language: mark them **Shared** at creation.
→ `content-sdk-create-component` (templates, relinks), `sitecoreai-localization` (versioned vs shared).

### 3. Rendering

| Question | Owner |
|---|---|
| New rendering, or **clone an OOTB one** (Promo, PageContent, Link List)? Default: clone a JSON rendering; a Controller rendering has no `componentName`. | `content-sdk-create-component` |
| A **variant** of an existing rendering (same component, different field arrangement) or a **sibling** with its own rendering? Cheapest first: skin → Headless Variant → new rendering. | `content-sdk-variants-vs-siblings`, `content-sdk-app-router-component-variants` |
| Does it show **repeating rows**? Then it is a list component: container + element template, `__Masters`, a branch as Datasource Template, children-aware delivery. A Multilist is not a list (rows can be re-pointed, never added). | `content-sdk-list-component` |
| Is it a **layout** (columns, rows, a split or bento section) the author arranges? Cheapest first: grid params on ordinary components → Container + splitters → a custom slot component with presets → a fixed-layout component with no placeholders. | `content-sdk-layout-composition` |
| Is it **navigation**? Decide the data source first: derived from the tree vs an authored link list. | `content-sdk-navigation-component`, `content-sdk-app-router-component-level-navigation` |
| Does a live site already use the rendering you want to change? **Fork, don't mutate.** | (plan a new name-prefixed rendering) |

### 4. Data strategy

| Shape | Use when | Watch |
|---|---|---|
| Plain datasource fields | one item, flat fields | the default; cheapest |
| SXA content resolver (e.g. datasource children) | container + children | children come back in **item-name order** unless `__Sortorder` is set |
| Integrated GraphQL (`ComponentQuery`) | nested or cross-item data, list rows | it **replaces** `fields` wholesale; request every rendered field **with metadata**; text as `{ value }` (or `{ value jsonValue }`), image/link as `{ jsonValue }`; no `orderBy` on `children`; Edge has a silent depth budget and a default page size of 10 |
| Component-level fetch (route handler) | genuinely non-authored data: live feeds, search, lazy branches | an exception **per field**, never per component |

Then: **Server or Client component?** Server by default; Client only for interaction state, and pass SDK field objects through, not plain strings.
→ `content-sdk-resolver-patterns`, `content-sdk-app-router-component-data-strategy`, `content-sdk-app-router-graphql-data-fetching`, `sitecoreai-edge-graphql-capture` (query budget), `content-sdk-app-router-route-handler-vs-server-action`.

**Multilist vs Integrated GraphQL for a list is a question for the user**, not an architecture default: add-a-row ergonomics vs one fewer moving part. Ask it.

### 5. Authorability (the acceptance bar)

A component is done when **an author can find every value and change it**, not when it renders.
- Every authored, human-readable value arrives on `fields` and renders through an SDK field component (`Text`, `RichText`, `Image`, `Link`).
- Empty fields stay selectable while editing: guard with `(isEditing || hasValue)`, never unmount on empty; set `renderChildrenWhenEmpty` on a `Link` that wraps children (its default is `false`).
- A component that swaps fields on runtime state renders **all** of them while editing.
- A value that legitimately comes from elsewhere names its source in the rendering's description; a rendering never carries a Datasource Template it ignores.
→ `content-sdk-field-usage-image-link-text`, `content-sdk-app-router-editing-safe-rendering`, `content-sdk-component-naming-traps` (map key must equal `componentName`).

### 6. Cross-cutting impact

Answer each with "none" or a named consequence. Silence is not "none".

| Concern | Question | Owner |
|---|---|---|
| i18n | Which fields are versioned, which Shared? New dictionary keys? Per-language routes? | `sitecoreai-localization`, `content-sdk-app-router-dictionary-and-i18n` |
| Personalization / A-B | Will marketers vary it? Then it must be a component with a datasource (variants swap datasources or hide components). | `sitecoreai-personalization`, `content-sdk-personalization` |
| Search | Indexed? Which fields searchable / facetable? Reference fields are not indexed. | `sitecoreai-search-sources`, `content-sdk-search` |
| Analytics + consent | New events? Gated by consent category? | `content-sdk-analytics-events`, `content-sdk-tracking-consent` |
| Caching / freshness | Which revalidation tags must a publish hit? Does the Edge webhook cover it? | `content-sdk-app-router-cache-components-and-osr` |
| SEO | New routes in the sitemap? Metadata fields? robots impact? | `content-sdk-app-router-sitemap-robots` |
| Multisite | Reused on another site? Datasource Location site-relative? Per-site `<X> Folder` needed? | `content-sdk-app-router-multisite-management` |
| URLs | Does code build path segments from item names? Live Edge indexes only the slugified path. | (assert on live, step 7) |

### 7. Delivery

- **Serialization:** which module owns the new templates, renderings and site items; serialization grain is the collection, so a new site gets an include in the collection's module, never a second module on the same paths. → `sitecoreai-serialization`, `sitecoreai-cli-cloud-workflow`.
- **Publish scope:** templates, renderings, datasources, media, dictionary folder (a dictionary change needs the folder published with children).
- **Preview ≠ live.** Preview is the permissive runtime (resolves both URL forms, serves media without a publish, single-process caches). Name **one assertion against live** for every contract that can differ: route form, media, revalidation, variant selection (verify Headless Variants at Edge, never by a CM read-back).
→ `content-sdk-website-build-flow` (CM-then-Edge-then-deploy order), `sitecoreai-publishing`.

## Output

Fill `references/blueprint-template.md`, one page. It is complete when every decision has an option and a why, every item and file to create is listed, each step names the skill to load, and the acceptance tests include "an author can find and change every value in Pages". Two worked examples: `references/worked-examples.md`. Patterns that look reasonable and fail silently: `references/anti-patterns.md`; check the finished blueprint against it.

## Stop and ask

- The plan needs a change to a rendering a live site uses, and forking is not acceptable.
- A list's storage (Multilist vs child items via Integrated GraphQL) is undecided.
- "Everything is derived": a component with no authored value is a finding, not a design.
- A cross-cutting row cannot be answered from the ask.
