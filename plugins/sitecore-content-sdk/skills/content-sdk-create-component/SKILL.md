---
name: content-sdk-create-component
description: "Creates a component (rendering) on a SitecoreAI tenant via Authoring GraphQL, by cloning an out-of-the-box component and customising templates and available renderings. Use when asked to create, clone or scaffold a rendering."
license: Apache-2.0
metadata:
  author: Christian Hahn
  version: "0.5.3"
---

# Sitecore Create Component (clone an OOTB rendering, then customize — via Authoring+Management GraphQL)

**This skill creates a new component in SitecoreAI.** The canonical method is to **clone an OOTB component and then customize it to match the component you want** — it is more than a plain clone: you copy a wired source, then replace its datasource fields with the new component's field set so the result *is* the target component, not a duplicate. Per Sitecore's own Accelerate guidance, *every* component should start as a clone of an OOTB one, because cloning wires up all the base templates needed for the full authoring feature set. The SPE "Clone Rendering" script does only the clone half in the Content Editor; this skill does the full **clone-and-customize headlessly via the Authoring+Management GraphQL API** so a component can be created end-to-end and automated. (Building a component from scratch with the Marketer MCP is the alternative — see below.)

- Clone **Promo** for a component backed by its own datasource item (the common case).
- Clone **PageContent** for a context-only / no-datasource component.

Verified end-to-end on a live tenant by diffing a real clone against its Promo source (full custom-field clone + derive-clone-shape from any tenant).

## What cloning copies (the bundle)

A faithful clone is **four copied items + relinks**, not a single item copy. **Template folder layout** — everything lives inside the site's own templates folder `/sitecore/templates/Project/<Brand>/<Site>/`:

1. **Datasource template** (`…/<Site>/<Name>`) — the field set. Datasource templates and list **element** (child/row) templates sit at the **root** of the site folder.
2. **Folder template** (`…/<Site>/Folders/<Name> Folder`) — holds datasource items; its `__Standard Values.__Masters` is the insert-options list (= the datasource template, so the component's own datasource is the only thing an author can add under it). **All folder templates live in a `Folders/` subfolder.**
3. **Parameters template** (`…/<Site>/Rendering Parameters/<Name> Parameters`) — rendering params. **All parameters templates live in a `Rendering Parameters/` subfolder.**
4. **Rendering definition** (`/sitecore/layout/Renderings/Project/<Brand>/<Site>/<Name>`, template `Json Rendering`).

> **✅ Content SDK: create the parameters template, LINK it, and FORCE-publish it — works IFF three conditions hold.** Clone the `<Name> Parameters` template into `Rendering Parameters/` and set the rendering's `Parameters Template` field = its `{GUID}`. Reliable delivery through Experience Edge requires ALL of: **(a)** the params template inherits the **4-base HEADLESS** set (clone from *JSS* Experience Accelerator, not the MVC 8-base one — Edge can't serialize `IStyling`/`Grid Parameters`/`IComponentVariant`/`ICacheable`); **(b)** the rendering's **`Datasource Template` is an item PATH**, not `{GUID}`; **(c)** the params templates are **force-republished** to Edge in their current 4-base state (`dotnet sitecore publish item -p {templatesRoot} -sub -rel -r`). Miss any — especially (c): a *smart* publish can leave a stale broken 8-base definition in Edge — and Edge's `layout` query **silently drops the whole route** (`route=undefined`, no error → every page blank). This was the entire "params link breaks the page" saga (one brand, 2026-07-17 → resolved 2026-07-20). *(In classic SXA/Pages authoring — non-Content-SDK — the always-link rule still holds; this carve-out is Experience-Edge/Content-SDK-specific.)*

Two **modes** (independently for parameters and datasource):
- **Make a copy** — full `copyItem` of the template (extend/reorder fields). Recommended default; decouples from the source.
- **Inherit** — create a new template whose `__Base template` points at the source (restyle only).

NOT auto-handled by the clone: **rendering variants** (Headless Variants — create separately) and the **head-app `.tsx` + component-map** registration (componentName must map to a React component or it renders MissingComponent). Available-Renderings registration and **icon assignment** (§ Icons) are explicit steps (below).

## Base-template inheritance (authoritative — verified from OOTB Promo + Link List)

Every created/cloned template MUST end up with exactly these `__Base template` sets. Cloning the matching OOTB source yields them automatically — **read the result back and assert the set** (introspect the exact GUIDs per tenant; never create from scratch inheriting only `Standard template`).

> **⚠️ Clone from the HEADLESS SXA tree — `/sitecore/templates/Feature/JSS Experience Accelerator/…` — NOT the classic `/sitecore/templates/Feature/Experience Accelerator/…` (MVC).** The MVC **Promo Parameters** carries **8** bases (`Standard Rendering Parameters`+`IStyling`+`Grid Parameters`+`IComponentVariant`+`IDynamicPlaceholder`+`IRenderingId`+`ICacheable`+`_PerSiteStandardValues`); the headless **JSS Promo Parameters** carries the **4-base** set in the table below. Cloning the MVC source gives bloated, wrong inheritance that headless doesn't use (measured 2026-07-17). This matters most for the **Rendering Parameters** rows; assert the exact set after cloning.

| Template kind | Clone source (JSS Experience Accelerator) | `__Base template` (exact) |
|---|---|---|
| **Standard datasource** | Promo | `Standard template` + `_PerSiteStandardValues` |
| **Standard datasource — Rendering Parameters** | Promo Parameters | `Base Rendering Parameters` + `IDynamicPlaceholder` + `_PerSiteStandardValues` + `IRenderingId` |
| **List / collection container** (Link List / IGQL children) | Link List | `Standard template` + `_PublishingGroupingTemplate` + `_HorizonDatasourceGrouping` + `_PerSiteStandardValues` |
| **List / collection element** (child / row) | Link (element) | `Standard template` + `_PerSiteStandardValues` |
| **List / collection — Rendering Parameters** | LinkList Parameters | `Base Rendering Parameters` + `_PerSiteStandardValues` + `IRenderingId` |

**The asymmetry is intentional:** the **standard** params template includes `IDynamicPlaceholder`; the **list** params template does **not**. `_HorizonDatasourceGrouping` (on the *container*, never the element) is what makes a list + its children inline-editable in Pages/Horizon. `Base Rendering Parameters` is what makes Page Builder recognize the template as rendering parameters at all — a params template on only `Standard template` is invisible in Page Builder.

## List / collection components (the Link List pattern)

The full Link List pattern — element template, container→element insert options, branch datasource, children-aware delivery (`ComponentQuery`) — is in `references/list-components.md`. Decide first whether the rendering IS a list (the `content-sdk-list-component` skill carries the four legs); open the reference only when it is.

## Endpoint + auth

`POST https://<tenant-cm-host>/sitecore/api/authoring/graphql/v1`, `Authorization: Bearer <JWT>`. OAuth client-credentials, audience `https://api.sitecorecloud.io`, scope incl. `xmcloud.cm:admin` (see `sitecoreai-auth`). **No publish needed for the component to appear in Pages** — Pages reads the authoring DB. Publish only for delivery.

## The verified GraphQL sequence

The copy-ready mutation sequence (clone templates → relink → register in Available Renderings → swap the field set) is in `references/graphql-sequence.md`. Read it when executing; the sections around this one carry the decisions the sequence assumes.

**Before any raw field write, read that file's § "Write-side wire formats".** Authoring GraphQL accepts a wrong value silently. Every GUID must be braced, dashed and uppercase. Multi-value fields must be `|`-joined, never newline-joined. Children created over AGQL need `__Sortorder`. General Link XML needs `&amp;`, and `mailto:` links need `linktype="mailto"`. Each wrong form breaks the page, the Pages picker or inheritance without an error.

## Standard Source settings by field type (apply by default)

When creating **datasource** fields, set the field's **`Source`** to the standard SXA data-grab query for its type, unless told otherwise. For any **picker/list** field the `Source` is REQUIRED — it defines the available choices, and it only accepts items or (fast/relative) queries that resolve to items.

| Field type | `Source` |
|---|---|
| Rich Text | `query:$xaRichTextProfile` |
| Image | `query:$siteMedia` |
| General Link | `query:$linkableHomes` |
| Single-Line / Multi-Line Text | (none) |
| Checkbox | (none) |
| Multilist / Treelist / Droplink / Droptree (list of pages / items) | a query resolving to the choices — `query:$linkableHomes` for pages, or a relative template-filtered `query:./*[@@templatename='<ChildTemplate>']` for the datasource's own children. NEVER leave it unset or a fixed root path (the Pages picker then lists content-tree roots instead of the real choices). |

## Rendering-parameter Source rules

> **Rule of thumb — rendering parameter vs datasource field.** A **rendering parameter** controls **styling / behavior** (color, size, alignment, on/off) and is a **Single-Line Text**, **Checkbox**, or **Droplink** over a fixed choice set. A **datasource field** holds **content** (text, image, link, child items). A param that needs a fixed list of choices → a **Droplink** + the option-items pattern below; never a datasource field, and never the literal value in `Source`.

Parameter fields obey the SAME `Source` law as datasource fields: **the `Source` only accepts items or (fast/relative) queries that resolve to a list of items** — it is NOT a slot for a literal flag value. Pick the field TYPE for the interaction, and the `Source` to match:

| Param intent | Field type | `Source` |
|---|---|---|
| **Boolean flag** (e.g. sort **Ascending** — unchecked = descending) | Checkbox | (none) |
| Free text / numeric token | Single-Line Text | (none) |
| **Enumerated choice** (sort order as a dropdown, colors, sizes) | Droplink / Droplist | a folder of option **items** (below) |

**Never encode a boolean or enumeration in the `Source` field.** A `Source` of `Ascending`/`Descending` is invalid — Sitecore tries to resolve those as item paths and the field renders no usable options. For a true on/off flag use a **Checkbox** (default unchecked = the "off" / descending state).

**Enumerated parameters — the option-items pattern (reusable for sort order, colors, sizes, alignment…):**
1. Under the site's `Rendering Parameters/` folder, create a **`Content`** folder, and inside it **one folder per list** — e.g. `Rendering Parameters/Content/Colors`, `…/Sizes`, `…/Alignments`.
2. Create one item per choice inside that list folder, from a small **`Rendering Parameter Entry`** template that carries a `Value` field (e.g. `Left` → `Value` `left`, `Center` → `center`; or `Ascending` → `asc`).
3. On the params template, make the field a **Droplink / Droplist** whose `Source` = `query:`/path to that list folder (e.g. `…/Rendering Parameters/Content/Alignments`).

The head app reads the *selected item's* `Value`. **One list folder is reusable across components** (a shared `Alignments` serves every component's alignment param). This is how you offer any fixed choice set without abusing the `Source` field.

## Tenant-specific ids — introspect, don't hardcode

These vary per tenant; resolve them on the target before cloning:
- **"Template section"** template id — often `{E269FBB5-3750-427A-9149-7AA950B49301}` (stable Sitecore id, but verify per tenant).
- **"Template field"** template id — often `{455A3E98-A627-4B40-8035-E683A0331AC7}`, which **can differ from the textbook `{455A3E98-…-58A708D5E84B}`** — so read it off an existing field item (`item(...Promo/Promo/Title).template.templateId`), never assume.
- The source rendering + its DS/folder/params templates, the project module's template + renderings folders, and the Available-Renderings group id — discover via `item(where:{path})` + `children`.
- Field `Type` is set by the field value **"Type"** = `"Single-Line Text"` / `"Rich Text"` / `"Image"` / `"General Link"` / … (the human-readable type name).

## Cleanup-order gotcha (deleting a clone)

You **cannot** delete a cloned template while items are based on it or link to it. Delete **bottom-up**:
1. the **rendering** (also de-register it from Available Renderings; this drops its `Datasource Template` Internal Link),
2. **every item based on the datasource template** — its own `__Standard Values`, any authored datasources, **and the Design Library `Mock-<ComponentName>` datasource** (see below). The reliable way to find them all is an Authoring `search` on `_template` = the template id (32-hex, no braces/dashes) and delete each hit,
3. the **folder template**, then the **datasource template** (sections/fields cascade),
4. the **parameters template**.

Skipping step 2 yields `"The '<id>' template is used by at least one item. Delete all the items that are based on this template first."`

> **The Design Library auto-creates a mock datasource.** When a component is registered in Available Renderings, SitecoreAI's Design Library generates a `Mock-<ComponentName>-<guid>` item **based on the datasource template** under `/sitecore/system/Settings/Foundation/Design Library/Data Sources/`. It is invisible as a *child* of the template (it lives elsewhere) but blocks the template delete — `deleteItem` keeps returning "used by at least one item" with no obvious culprit. Search `_template` to find it. (This is also why a freshly created component already previews with sample content in the Design Library.)

## The Marketer MCP CAN build a component too — it just has no clone primitive

Tested empirically by building + configuring + registering a working rendering end-to-end with **only** Marketer MCP tools:

- **`create_content_item(name, templateId, parentId, fields)` is generic** — it creates ANY item: a rendering definition (`Json Rendering`), a datasource template (`Template`), a `Template section`, and `Template field` items (with `Type` + `Source` set via `fields`). All verified on the tenant.
- **`update_fields_on_item(itemId, fields)` is generic** — it writes ANY field on ANY item: the rendering's `componentName` / `Datasource Template` / `Datasource Location` / `Parameters Template`, **and the Available Renderings group's `Renderings` field** → the rendering became placeable in the Pages picker (confirmed via `get_allowed_comps_by_ph`).
- **`delete_content(itemId)`** removes items.

So the MCP can construct + configure + register the **entire bundle from scratch**. The single thing it **lacks is a clone/copy primitive** (no `copyItem`): it cannot duplicate an OOTB component's already-wired template subtree in one shot, so you build each item and set each field individually — and you must supply the correct base-template ids / field types yourself (which a clone inherits for free).

**When to use which:**
- **GraphQL `copyItem`** (this skill) — true *Clone Rendering*: copy a wired OOTB component (Promo / PageContent) + relink. Fewest calls, inherits the correct base templates, highest fidelity. Best for **"clone an existing component."**
- **Marketer MCP** (`create_content_item` + `update_fields_on_item`) — build a component piece-by-piece + register it. Best when you're already in an MCP/agent context. Best for **"create a component"** from a known field spec.

**MCP quirks (verified):** `update_fields_on_item` (and the Available-Renderings write) return misleading/empty `updatedFields` payloads even on success — **always verify via a read, not the response**. `get_content_item_by_path` returns `fields: {}` (no raw field values), so read-modify-write of a multilist (e.g. appending to `Renderings`) needs the current value from GraphQL or another source.

Either way, `get_allowed_comps_by_ph(pageId, placeholderName)` is the **placeability verifier**.

## Icons

**Pick ONE icon per component and apply it CONSISTENTLY to every item the component owns** — the **rendering**, the **datasource template** (+ its `__Standard Values`), each **list-element template** (+ SV), the **folder template** (+ SV), and the **parameters template** (+ SV). One component = one icon everywhere (a `Timeline` shows `calendar` on its rendering, datasource, folder, and params alike) → the Pages palette + content tree read cleanly. Setting the icon on each template's `__Standard Values` too is what makes the **instances** (datasource content items, global containers) inherit it. Use **`content-sdk-icon-chooser`**: tokenize the component name → semantic category → `updateItem __Icon`. Required Definition-of-Done step, not a nicety — a wall of identical default icons makes the Pages palette unreadable.

> **⚠️ Verify the icon name EXISTS in this tenant's icon set — a missing name renders BLANK (looks like "no icon"), not an error (measured 2026-07-17).** The `Office/32x32/` set is missing many common names (`document`, `video`, `contact`, `navigate`, `flag`, `code`, `spotlight`, `billboard` all render blank). The reliable, tenant-confirmed set is **`SXA/16x16/`** (used by OOTB SXA renderings): `promo`, `rich-text`, `image`, `video`, `gallery`, `navigation`, `link`, `link-list`, `title`, `page-content`, `page-list`, `pagination`, `breadcrumb`, `playlist`, `media-link`, `file-list`. Harvest the valid palette by reading `__Icon` off OOTB renderings under `/sitecore/layout/Renderings/Feature/Experience Accelerator/*`, then map to those (or a confirmed `Office/` name). Renderings under `Feature/Experience Accelerator/` may prefer the `SXA_MDI` set.

## Head-app pairing (to actually render)

The Sitecore-side clone makes the component **available + authorable** in Pages. For it to render (not show a MissingComponent box), pair it head-app-side: duplicate the source's `.tsx` → `<Name>.tsx`, register in `.sitecore/component-map.ts` (or `.client.ts`), deploy. See `content-sdk-website-build-flow` (per-component port) + `content-sdk-app-router-component-registration`.

**Never clone `Foundation/JavaScript Services/HostedJsonRendering`** for a code component. The CM ships it (base `Json Rendering`, a `ComponentRef` field); a `ComponentRef` value diverts the rendering to the beta atoms runtime (`content-sdk-app-router-atoms`).

## Related

- `sitecoreai-auth` — the client-credentials token.
- `sitecoreai-graphql-schemas` — Authoring+Management schema (createItem/copyItem/updateItem/deleteItem, ItemQueryInput).
- `content-sdk-website-build-flow` — the per-component build/port loop this plugs into.
- `content-sdk-icon-chooser` — pick + set the `__Icon` on every created rendering / template.
- Sitecore docs: "Copy and customize a component" (SitecoreAI), "Creating New Components" (Sitecore Accelerate — clone Promo/PageContent).
