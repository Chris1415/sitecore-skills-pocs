# List / collection components (the Link List pattern)

Supporting reference for the `content-sdk-create-component` skill. Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the Agent Skills spec's 5,000-token guidance; the heading is kept so `SKILL.md` cross-references still resolve here.

## List / collection components (the Link List pattern)

A **list / collection** component (Link List, Accordion, Tabs, Navigation) is *not* a single datasource item — its rows are **child items** of the datasource. It's the same clone-and-customize, but with **two templates + a branch**, and a couple of extra relinks. Verified read-confirmed against the OOTB SXA **Link List** on a live tenant. The single-vs-list deltas:

1. **Two datasource templates, not one:**
   - **Container** data template (e.g. `Link List`) — list-level fields (OOTB: just `Title <Single-Line Text>`).
   - **Element** data template (e.g. `Link`) — one row's fields (OOTB: `Link <General Link>`, Source `query:$linkableHomes`). Has **no** `__Standard Values` of its own.
2. **Insert options wire container → element** — the load-bearing extra step. The **container template's `__Standard Values.__Masters`** = the **element** template id. This is what lets authors add rows in Pages. (OOTB: Link List SV `__Masters` = the `Link` template id.)
3. **`Datasource Template` can point at a BRANCH or a bare template.** OOTB uses a **branch** (`/sitecore/templates/Branches/.../<Name>`) whose `$name` item (template = the container data template) *also* carries `__Masters` = element **and ships one default element** (`Link 1`), so a freshly created datasource is a non-empty list. **Pointing it straight at the container template also works** (verified) — the only thing lost is the auto-created first row; authors still add rows via the container's insert options. Use the direct template unless you need the default-child nicety.
4. **Children-aware delivery on the rendering** — OOTB uses a dedicated **Rendering Contents Resolver** ("Link List Contents Resolver", `{2EFA6066-AC78-4A36-90D8-7E2885DF474E}`), which serializes the datasource's children. That is the OOTB shape to recognise, not the one to copy: Sitecore documents content resolvers as not supported with Edge runtime publishing. Deliver with Integrated GraphQL (`ComponentQuery`, every field as `jsonValue`); ranking and limits in `content-sdk-list-component` leg 4 and `content-sdk-collection-data-model`. **The OOTB Link List rendering is a `Controller rendering` — it has NO `componentName` field**, so it's unusable as a head-app component as-is. For a headless/Content SDK list, **clone a `Json Rendering`** (e.g. an existing single component like Promo) for the rendering item, clear its `Rendering Contents Resolver` and set its `ComponentQuery`.
5. **Folder template inserts the branch** — the `<Name> Folder` template's `__Standard Values.__Masters` lists the **branch** (+ itself), and the rendering's `Datasource Location` keys on `templatename='<Name> Folder'` (same mechanism as a single component).

**Base templates that "fully support Pages editing" (inherit exactly these):**

| Template | `__Base template` |
|---|---|
| **Container** | `Standard template` + **`_HorizonDatasourceGrouping`** + `_PerSiteStandardValues` + `_PublishingGroupingTemplate` |
| **Element** | `Standard template` + `_PerSiteStandardValues` |

`_HorizonDatasourceGrouping` (Foundation/Experience Accelerator/Horizon) is the one that makes the datasource **and its children** editable inline in Pages/Horizon; the others give per-site standard values + publishing grouping. The element only needs Standard template + per-site SV — the Horizon grouping lives on the **container** (the item the editor targets). These are stable SXA ids but **introspect per tenant** — read them off the OOTB Link List rather than hardcoding. The list **parameters** template inherits `Base Rendering Parameters` + `_PerSiteStandardValues` + `IRenderingId` — **no** `IDynamicPlaceholder` (unlike a standard component's params); see § Base-template inheritance.

**Verified clone recipe (executed end-to-end on a live tenant):**
1. `copyItem` (deepCopy) the **element**, **container**, and **folder** data templates → your module's templates folder, and the **params** template → `Rendering Parameters/`. The copies keep the correct `__Base template` set automatically.
2. For the **rendering**, `copyItem` an existing **Json Rendering** (e.g. Promo) — NOT the OOTB Controller Link List rendering.
3. Relink the rendering: `componentName`, `Datasource Template` = your container template PATH (or the branch path), `Datasource Location` = the `templatename='<Name> Folder'` query, `Parameters Template` = `{new params id}`, `Rendering Contents Resolver` cleared, `ComponentQuery` set with every field as `jsonValue`, `Enable Datasource Query` = `1`. (The live run below set the children resolver `{2EFA6066…}` here; that is not supported with Edge runtime publishing, so do not copy it.)
4. Repoint insert options: container `__Standard Values.__Masters` → `{new element id}` (lets authors add rows); folder `__Standard Values.__Masters` → `{new container id}|{new folder id}` (direct-template) or `{new branch id}|{new folder id}` (branch).
5. `customize` the element template's field set to your row shape (+ the container's list-level fields) — same as the single-component flow.
6. Register: append `{new rendering id}` to the site's `Presentation/Available Renderings/<group>` `Renderings` field.

> **`updateItem` is atomic per call** — a single unknown field name aborts the *whole* `fields:[]` batch (the `componentName`-on-a-Controller-rendering trap above wiped the entire relink). Set risky fields individually, or read the target's field names first. Note `__Masters` is a **standard** field — read it back with `fields(ownFields:false)` / an aliased `field(name:"__Masters")`, not `ownFields:true`.

> **Status: verified live, with the resolver.** Full clone→relink→register: templates + Json rendering created, insert options + resolver + datasource location wired, registered + placeable. The `ComponentQuery` in step 3 replaces that resolver and was not part of this run; its limits are measured in `sitecoreai-edge-graphql-capture` § 2b. Remaining-unverified: the **branch** path (`copyItem` of a branch + its `$name` subtree — the direct-template path was used instead) and the **head-app pairing** (a `.tsx` + component-map entry, needed for it to render rather than show MissingComponent).
