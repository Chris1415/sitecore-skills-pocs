---
name: sitecoreai-content-composition
description: "Inventory-first page composition via the Marketer MCP: inventory the site's real components, then compose a page by choosing and ordering them, with the verified add-component recipe. Use when authoring or extending a page, not a single field."
license: Apache-2.0
metadata:
  author: Christian Hahn
  version: "0.6.8"
  validated: "LIVE — Marketer MCP write recipe + Pages API variant-set proven. 0.5.0 adds the Local-vs-global datasource section incl. the create_content_item local-placement trap (measured 2026-08-05: 35 datasources bare under their pages, invisible to build/tests/schema-audit). 0.4.0 drops pipeline agent/command wiring; 0.3.0 added Step 1.5 placeholder-restriction guardrail (get_allowed_comps_by_ph) + enforce/ignore policy."
---

# Sitecore Content Composition — inventory-first, via the Marketer MCP

Filling one field is half of content authoring. To manage content on a page properly, understand the site's **existing components** — what they are, what content they take, and how they look — then **compose**: select and order components for a coherent page structure, fill each from a content POV *and* a visual/structural POV.

## When to use

- Authoring or extending a **Sitecore page** (not a single field edit) via the Marketer MCP.
- Pairs with **`sitecoreai-brand-voice`** (the words / register) — this skill is the **structure** (which components, in what order, with what content shape).

## The principle: inventory BEFORE you compose

Never compose from assumptions about what components exist. Read the live palette first; the field names are case-sensitive and the child shapes are non-obvious.

## Step 1 — Inventory the palette (Marketer MCP)

**Prefer a Components Map if one exists** (a project-local inventory with variants + screenshots + when-to-use). Use the inline inventory below only when no map exists.

1. `list_sites` → the site id + name.
2. `get_all_pages_by_site(siteName)` → the existing page tree (also your structural reference for how real pages are built).
3. For 1–3 representative existing pages: `get_components_on_page(pageId)` → which components exist, their **rendering IDs**, the placeholder (`/headless-main`), and each rendering's **ComponentQuery** (which reveals the datasource + child field names).
4. For every **child-bearing** component, read a sample datasource: `get_content_item_by_path("…/Home/Data/<Component>")` → the **parent template ID**, the **child template ID**, and the exact (case-sensitive) field names. Flat components only need their parent template/fields.
5. Look-and-feel: `get_page_screenshot(pageId, version)` — **note:** the PNG comes back as a large base64 blob that often exceeds tool limits; when it does, fall back to the live **preview URL** (`get_page_preview_url`) for the user to eyeball, and describe look-and-feel from component role + real sample content.
6. Cache the result as a **component catalog** (component → role/when-to-use → parent fields → child template+fields → look&feel). Reuse it for the whole authoring session.

## Step 1.5 — Check what each placeholder ALLOWS (the guardrail)

Sitecore placeholders are governed by **placeholder settings** — each placeholder has an **allowed-renderings** set. The Marketer MCP exposes it directly: **`get_allowed_comps_by_ph(pageId, placeholderPath)`** returns the rendering IDs permitted in that placeholder. Placing a rendering a placeholder does **not** allow either fails or produces an invalid / uneditable layout in Pages — so this is a real guardrail, not a nicety.

**Policy — enforce vs ignore** (the user's call; **default = enforce**). Persist the choice with the authoring session:

- **Enforce (default — "follow the rules"):** for every rendering you plan to place, resolve its **target placeholder** and call `get_allowed_comps_by_ph`; place the rendering **only if it is in the allowed set**. If a component you wanted is not allowed there, do **not** force it — pick an **allowed alternative** that serves the same intent, or **surface it to the user** (never silently drop the section). For **structural** components, re-check the **inner** placeholder's allowed set before filling it.
- **Ignore ("add renderings as you think"):** the user has waived the rule — compose by best-fit judgement regardless of the allowed set, but **still record each placement that falls outside `get_allowed_comps_by_ph`** as a deviation in your report.

Resolve the allowed set **per placeholder** (the body placeholder is usually `/headless-main`; structural components expose their own inner placeholders with their own allowed sets) and cache it alongside the component catalog for the session.

## Step 2 — Compose for structure + look-and-feel

- Pick components by **intent**, and order them into a page arc: **opener** (Hero) → **substance** (prose / grids) → **proof** (stats / testimonials) → **close** (CTA).
- Mirror the site's **heading pattern**. Many marketing sites use an **Eyebrow** (small kicker) + a **Heading** whose tail is split into **HeadingAccent** (the emphasized/colored continuation) — e.g. *"Obsession you can "* + *"taste."* Read a real page first; do not invent the field split.
- Match the words to the brand: `sitecoreai-brand-voice` takes the voice from the PRD or spec, and sets the register.

## Step 3 — Author each component (the write recipe)

- **Before each `add_component_on_page`, apply the Step 1.5 policy.** In **enforce** mode, confirm `componentRenderingId` is in `get_allowed_comps_by_ph(pageId, placeholderPath)` for the target placeholder; if it is not, substitute an allowed component or surface it to the user — never force-place it. In **ignore** mode, place it but **log the deviation** (rendering + placeholder + "outside allowed set") in your report.
- `add_component_on_page(pageId, componentRenderingId, placeholderPath: "/headless-main", componentItemName, fields)` → adds the rendering **and creates a local parent datasource** with the flat `fields`. Returns the `datasourceId`. The MCP auto-sets `GridParameters` + `DynamicPlaceholderId` to match siblings. **Read back WHERE the datasource landed** (`datasourceLocation` on the response / `get_content_item_by_path`) — do not assume it matched your local-vs-global intent (next section).
- For **child-bearing** components: per child, `create_content_item(name, templateId: <child template>, parentId: <datasourceId>, fields)`.
- **Verify** (integration boundary): `get_components_on_page` (component set + order) and `get_content_item_by_path` (parent fields + children landed). Re-read; don't trust the write call.
- Publishing is a **separate** explicit step (Publishing REST / `sitecoreai-publishing`); Preview renders unpublished.

## Local vs global datasources — the reuse check (WHERE the datasource item lives)

Every datasource-backed rendering can store its content in **either** home, and Sitecore offers both:

- the page's **own `./Data` folder** — always available, for every such rendering;
- the **global per-component container** under the site `Data` node — available because the rendering's `Datasource Location` field lists it as an **additional root**. That field *adds* roots; it does not remove the local one or pick a winner.

So placement is **your decision, per datasource** — make it deliberately, not by accepting whatever the write produced.

| Content | Home | Where |
|---------|------|-------|
| Page-specific (**default**) | **LOCAL** | `<Page>/Data/<Component>` — folder template `Page Data` `{1C82E550-EBCD-4E5D-8ABD-D50D0809541E}`, created on demand under the page |
| Genuinely reused on **≥2 pages** | **GLOBAL** | `/<COLLECTION>/<SITE>/Data/<Component Folder>/<Item>` — the folder **item** built from that component's folder template (insert options allow only its datasource). Author **once**, bind each placement with `set_component_datasource` |
| Partial-design chrome (Header, Footer, promo/utility bars) | **ALWAYS LOCAL** | under the Partial Design item — it is chrome inherited via the Page Design, not reused content |

**Decide in the PLAN, not mid-write.** The Marketer MCP has **no move/rename primitive**, so promoting later means re-creating the item. After composing the page set, run a **cross-page reuse pass** over the planned datasources: anything the plan places on ≥2 pages becomes one global item; everything else stays local. When unsure, stay local — a single-page datasource is cheap to promote, a wrongly-global one clutters the shared `Data` folder and invites accidental edits across pages.

### The two recipes (verified live, 2026-07-27)

**LOCAL — one call, no cleanup:**

```
add_component_on_page(pageId, renderingId, "/headless-main", componentItemName, fields)
```

It **always** writes `<Page>/Data/<componentItemName>` (`local:/Data/X` in the layout) and auto-creates the page's `Data` folder if absent. It **ignores** the rendering's global `Datasource Location`. Spaces in `componentItemName` become underscores.

**GLOBAL — create in the container, rebind, delete the stray:**

```
1. create_content_item(name, templateId: <DS template>, parentId: <component's global container>)
2. add_component_on_page(...)                      // still makes a local datasource
3. set_component_datasource(pageId, componentId, datasourceId)
4. delete_content(<the local datasource step 2 created>)
```

**Step 4 is mandatory, not tidy-up:** there is no way to place a component without producing a local datasource — omitting `fields` still creates an empty one.

**Reuse on page 2..n:** `search_component_ds(component_id, term)` to find the shared item, then the same add → rebind → delete-stray sequence. **Filter the hits by path** — the search matches on the datasource *template*, so it returns page-local items from other pages too, not just shared ones.

**LOCAL when `add_component_on_page` is NOT the creator — you must build `Data` yourself:**

```
1. ensure <Page>/Data exists   // createItem(name:"Data", templateId:{1C82E550-EBCD-4E5D-8ABD-D50D0809541E}, parent:<pageId>)
2. create_content_item(name, templateId: <DS template>, parentId: <that Data item>)   // NOT the page
```

**`create_content_item` does NOT auto-create the `Data` folder** — only `add_component_on_page` does. It parents exactly where you point it, so `parentId: <the PAGE>` drops the datasource **bare under the page** and nothing complains. You land on this path whenever `set_component_datasource` is unavailable — it **422s on renderings created via raw AGQL** (measured 2026-07-06: setting the rendering's `Datasource Template` does NOT fix it; the Agent API does not read that field), so the flow degrades to `create_content_item` + a raw layout-level attach.

**This is not hypothetical — one brand shipped 35 datasources bare under their pages** (2026-08-05). Every page rendered, build and tests were green, and a rendering-level schema audit scored 15/15 clean, because each rendering's `Datasource Location` read the literal `./Data` — pointing at a folder that never existed. Only a person reading the content tree caught it.

**MOVING a datasource to local page level** (global → local, or re-homing between pages): the target parent is `<Page>/Data`, created on demand — never the page item. `moveItem` preserves the item GUID and layout references are by GUID, so relocation is safe; but it is a live content mutation, so canary one page and re-assert the route before rolling.

**Two traps:**

- `set_component_datasource`'s `componentId` is the rendering **instance** id (`components[].id` from `get_components_on_page`) — **not** the rendering id (`components[].componentId`). Both sit in the same payload.
- `create_component_ds(siteName, componentId, dataFields)` *does* place globally (resolving `Datasource Location`) and helpfully returns `datasourceLocation` — but it takes **no name** and auto-names the item `<Component>_<32-hex>`. Unusable for something whose whole purpose is being picked by name from a shared list. Use `create_content_item` with an explicit `parentId` instead; keep `create_component_ds` for the case where its one-call `children[]` support outweighs the name.

**Then verify — assert the PARENT, not just existence.** Re-read the created/moved item's path and confirm the home you chose: a local datasource's parent segment must be `Data` (`…/<Page>/Data/<Item>`), a global one must sit in its component container. "The item exists" and "the field is non-empty" both pass on the broken placement, which is exactly how 35 misplaced items survived a full build. Global items need **self-descriptive names** (`GT Hero`, `Brand Heritage Timeline`) — the name is all an author sees in a shared picker.

## Derive or author? Decide per field, before you type a number

Every number or list on a page is either **derived at render time** or **authored as content**.
Getting it wrong is invisible until it is embarrassing, so decide deliberately:

> **Derive it if the CM can know the answer. Author it if the CM cannot.
> NEVER author a value whose wording asserts liveness.**

| Value | Decision | Why |
|---|---|---|
| "7 developments · 29 residences **available today**" | derive | CM knows it, and *today* asserts liveness |
| "**Six residences remain** at X." | derive | Same — and it is the largest claim on the page at the point of conversion |
| a `<select>` of the developments | derive | An authored list drifts the moment a building is added or renamed |
| "17 completed · 143 sold since 2011" | **author** | Nothing in the CM knows these — facts about the business, not the content |
| budget bands | **author** | Not derivable without inventing a bucketing rule |

**The liveness test is the sharp edge.** "143 sold since 2011" ages gracefully; "six remain" is
false the day after the next reservation and **nothing about the page changes to reveal it**.
If the copy contains *remain*, *available*, *today*, *now*, *left* — it cannot be authored text.

Three obligations that come with deriving:

1. **Degrade honestly, never to a number.** Unreadable data, a zero result and a missing link
   must each fall back to authored copy or render nothing — never "Zero residences remain",
   never a partial sum. A truncated **count** is a false claim; a truncated **list** (a picker)
   is merely degraded — so those two degrade differently.
2. **One fetch, or two surfaces will disagree.** Wrap the resolver in `React.cache()` so every
   component on the page shares it. Two independent counts is exactly how "6 of 14 remaining"
   and "Sold out" end up in the same viewport.
3. **Do not offer an inline editor for a computed string.** Render derived text as plain text,
   not `<Text field=…>` — otherwise Pages offers an editor writing to a value nothing reads.

**Corollary — never derive a URL.** A route slugified from an item name is syntactically valid
and silently wrong. Add an explicit link field so Sitecore resolves the real route and "no page
yet" becomes a representable state that renders non-interactively.

## Gotchas — live-proven

- **Emoji: BMP-safe only.** The Marketer MCP write **corrupts 4-byte supplementary-plane emoji** (😉 U+1F609, 🌱 U+1F331, 🔥 U+1F525) to `����`. **3-byte BMP symbols survive** (☕ U+2615, ⏳ U+23F3, ♨ U+2668, em-dash U+2014). For **HTML** fields (RichText `Body`) use HTML hex entities (`&#x1F609;`) — they round-trip and render. For **plain-text** fields (e.g. ValueCard `Icon`) entities render literally, so use a **BMP** symbol or leave it empty.
- **Creation order is not sort order — set `__Sortorder` on every list row.** Children with an empty or equal `__Sortorder` resolve in item-**NAME** order, however (and in whatever sequence) they were created; correct-looking order is often an alphabetical coincidence. Give every row an explicit, distinct value (100, 200, 300 …) in `create_content_item` `fields` or via `update_fields_on_item`, which writes it but omits system fields from its `updatedFields` reply. Verify the **rendered order**, not the write response.
- **`add_component_on_page` creates the PARENT datasource only** — never the children. Children are separate `create_content_item` calls under the returned `datasourceId`.
- **Field names are case-sensitive** and must match the datasource template exactly — read a real sample, never paraphrase.
- **Sanitize item names.** Sitecore's default `ItemNameValidation` is `^[\w\*\$][\w\s\-\$]*(\(\d{1,}\)){0,1}$`: parentheses are only allowed at the end and only around digits, so `Foo (2)` passes and `Foo (draft)` is rejected.
- **Per-language composition** (measured 2026-10-02). `__Final Renderings` is versioned, so a new language starts with an **empty** layout. Version each datasource with `update_content(language, createNewVersion: true)`. **Always pass `language`**: omitted means `en`, and with `createNewVersion` that silently adds en v2. `update_fields_on_item` takes no language. `create_page` `fields` is `[{"Title":"…"}]` (key = field name), unlike `update_content`'s `{name, value}`. Never `delete_content` to drop one language: it deletes the whole item. Runbook: `sitecoreai-localization`.

## Variants — set them per page via the Pages API (the MCP can't)

A Headless rendering variant is **code-driven** (`<Component>.<Variant>.tsx` export + a `Variant Definition` item + a deploy — see `content-sdk-variants-vs-siblings`). The **Marketer MCP cannot select a variant** on a page (`set_component_variant` is A/B-test / personalization, not Headless). Use the **Pages API**:

- Host `https://xmapps-api.sitecorecloud.io`, header `Accept: application/json`. Token = the **CM automation client** (`SITECORE_CM_CLIENT_ID/SECRET` → client_credentials, `audience=https://api.sitecorecloud.io`). The deploy client 500s on `state` (measured 2026-08-12).
- **READ:** `GET /api/v1/pages/{pageId}/state?site=<site>&language=en&withLayout=true` → `finalLayout` is the layout **body JSON string** (`{ devices:[{ renderings:[{ id, instanceId, placeholderKey, dataSource, parameters:{ FieldNames, GridParameters, … } }] }] }`) plus a `revision`.
- **WRITE (total replace — fetch → modify → write back):** set `renderings[n].parameters.FieldNames` to the **variant item GUID** (`""` = Default; it stores the GUID, not the export name — the layout service resolves it), then `POST /api/v1/pages/{pageId}/layout` with `{ layout:{kind:"Final",body:<modified string>}, originalLayout:{kind:"Final",body:<original string>}, language, site, pageVersion, revision }`. No `pageVersion` in state (single version): send 1.
- **GOTCHA — the editing/render endpoint CACHES.** A `FieldNames` change is confirmed in the data immediately (re-read), but the *rendered* page lags; **bust the cache / wait / republish before screenshotting** a changed variant.

## Worked example — anonymized catalog (shape only; resolve real IDs from the live tenant)

Placeholder for all: `/headless-main`. *Flat* = single datasource; *List* = heading + child items. **IDs below are illustrative placeholders** — always read the live palette (Step 1); never copy these GUIDs into a real tenant.

| Component | Kind | Parent fields | Child template → child fields |
|---|---|---|---|
| PageHero | flat | Title, Subtitle, HeroImage | — |
| RichTextSection | flat | SectionHeading, Body (HTML) | — |
| ValueProps | list | Heading, Eyebrow, HeadingAccent | **ValueCard** → Icon, CardTitle, Body |
| StatsBand | list | BandHeading | **Stat** → StatValue, StatLabel |
| DestinationsGrid | list | Heading, Eyebrow, HeadingAccent, Intro | card → Name, Tagline, Distance, Detail, CardImage, CardLink |
| ExperienceShowcase | list | Heading, Eyebrow, HeadingAccent | item → ItemTitle, Summary, ItemImage, Duration, Cta |
| Testimonials | list | Heading, Eyebrow, HeadingAccent | quote → Quote, Author, Role, Avatar |
| JourneySteps | list | Title, Intro | step → StepTitle, Description, StepImage |
| Promo | flat | (fixed FieldNames) | — |
| NewsletterCTA | flat | Heading, HeadingAccent, TitleAccent, Body, Placeholder, ButtonLabel | — |

Resolve rendering IDs + template IDs on demand by reading a sample datasource / `get_components_on_page`.

**Worked composition** (sample journal-style page): PageHero → RichTextSection → StatsBand (4× Stat) → ValueProps (3× ValueCard) → NewsletterCTA — opener → prose → proof → benefits → close.

## Relationship to other skills

- **`sitecoreai-brand-voice`** — the words/register (load for the copy inside each field).
- **`content-sdk-resolver-patterns`** — the *build-side* view (how these renderings resolve data in the head app). This skill is the *authoring-side* view (filling them via the Marketer MCP).
- **`sitecoreai-agent`** and **`sitecoreai-publishing`** — the lower-level API behind the Marketer MCP, and the Publishing REST contract.
