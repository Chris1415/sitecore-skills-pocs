# The verified GraphQL sequence

Supporting reference for the `content-sdk-create-component` skill. Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the Agent Skills spec's 5,000-token guidance; the heading is kept so `SKILL.md` cross-references still resolve here.

## The verified GraphQL sequence

Mutation input shapes (introspection-verified):
- `copyItem(input: CopyItemInput!)` — `{ itemId, targetParentId, copyItemName, deepCopy: true }` (deepCopy copies sections/fields/standard-values). Name field is **`copyItemName`**, not `name`.
- `updateItem(input: UpdateItemInput!)` — `{ itemId, language:"en", fields:[{ name, value }] }`.
- `createItem(input: CreateItemInput!)` — `{ name, templateId, parent, language:"en", fields:[{ name, value }] }`.
- `deleteItem(input: DeleteItemInput!)` — `{ itemId, permanently: true }`.

```
# 1. clone the bundle (Make-a-copy mode)
copyItem  <source DS template>      → <Name>           (parent = /templates/Project/<Brand>/<Site>)
copyItem  <source Folder template>  → <Name> Folder     (parent = /templates/Project/<Brand>/<Site>/Folders)
copyItem  <source Params template>  → <Name> Parameters (parent = /templates/Project/<Brand>/<Site>/Rendering Parameters)   # ALWAYS — even if empty
copyItem  <source rendering>        → <Name>           (parent = /layout/Renderings/Project/<Brand>/<Site>)

# 2. relink the rendering definition (updateItem on the new rendering)
componentName       = <Name>
Parameters Template = {NEW-PARAMS-TEMPLATE-ID}              # Droptree: braced, DASHED, uppercase. Content SDK: link it only under SKILL.md's three conditions.
#   An UNDASHED id blanks the WHOLE page on Edge (`rendered: {}`) as soon as the rendering is placed,
#   including on a Partial Design (measured 2026-09-27). The dashed form was linked on datasource renderings
#   throughout one build with no breakage, so an older "leave it unset" rule was working around this defect.
Datasource Template = /sitecore/templates/Project/<Brand>/<Site>/<Name>   # Internal Link, PATH
Datasource Location = query:$site/*[@@name='Data']/*[@@templatename='<Name> Folder']|query:$sharedSites/*[@@name='Data']/*[@@templatename='<Name> Folder']

# 3. RELINK INSERT OPTIONS (the easy-to-miss step)
updateItem  <Name> Folder/__Standard Values  __Masters = {NEW-DS-TEMPLATE-ID}|{NEW-FOLDER-TEMPLATE-ID}
#   copyItem duplicates the folder's __Standard Values verbatim, so its __Masters still
#   points at the SOURCE templates → authors would insert the WRONG datasource type. Repoint it.
#   ⚠️ __Masters GUIDs MUST be DASHED ({XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}) — a dashless
#   GUID does not resolve → the Insert menu shows a "non-existing item" (measured 2026-07-17).

# 3b. INSTANTIATE the global datasource container (Content SDK)
createItem  <Name>  (template = <Name> Folder)  DIRECTLY under /sitecore/content/<Brand>/<Site>/Data
#   → a sibling of the OOTB Images/Promos/Link Lists/Texts containers — NOT under a Data/<Site> subfolder
#   (Pages' Datasource Location points at the Data node, so containers must live directly under it).
#   one container per component so reused (global) datasources have a home. Its insert option
#   (from the folder template's __Masters) offers the component's own datasource type.
#   GLOBAL datasource CONTENT items live INSIDE the container (Data/<Component>/<item>), NEVER a
#   Data/<Site> site subfolder. Name them meaningfully + self-descriptively (e.g. "GT Hero",
#   "Aero Gallery") — the name is all an author sees in a shared picker.
#   Single-page datasources stay LOCAL (under the page); chrome datasources local to the partial design.

# 4. customize the datasource template (optional but usual)
#   delete the copied section (named after the source, e.g. "Promo"), create a clean "Data" section + fields
deleteItem  each child of <Name> template          # the copied section
createItem  "Data" (template = Template section)   under <Name> template
createItem  each field (template = Template field)  under the Data section:
            fields: [{ name:"Type", value:<field type> }, { name:"__Sortorder", value:"100"/"200"/... }, {Source if applicable}]

# 5. register in Available Renderings (so authors can add it in the Pages picker)
updateItem  <site>/Presentation/Available Renderings/<group>  Renderings (TreelistEx, pipe-joined {GUID})
            → append {new rendering id}
#   ⚠️ REQUIRED for authoring — an unregistered rendering cannot be added by an author.
#   At END-OF-BUILD, verify EVERY project rendering appears in some Available Renderings group's
#   Renderings field (one brand shipped 7 of 21 unregistered, 2026-07-18).

# 6. set icons (§ Icons) — __Icon on rendering + datasource + folder + params
#    via content-sdk-icon-chooser (never leave the default document icon)
```

## Write-side wire formats (measured 2026-09-26 → 29)

Authoring GraphQL accepts almost any string for a field value, reads it back unchanged, and reports no error. Each wrong format below was accepted silently and broke something downstream. Validate the value **before** the network call:

| Field / case | Required form | What the wrong form does |
|---|---|---|
| **Every GUID-valued field**: a route's `Page Design`, `Parameters Template`, `__Masters`, `__Standard values`, `Datasource Template` (when an id), a variant's `FieldNames` in `s:par` | `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`: braced, dashed, uppercase | An undashed `Page Design` makes the route's `headless-header` / `headless-footer` resolve as `[]` (no chrome, no error). An undashed `Parameters Template` blanks the whole page. An undashed `__Masters` gives a "non-existing item" insert option. `createItem` returns ids **undashed**, so dash them before reuse. |
| **Multi-value fields**: `__Base template`, `__Masters`, and plain Multilists such as Available Renderings' `Renderings` | `\|`-joined: `{A}\|{B}` | Newline-joined values are accepted and read back looking right. For `__Base template`, the template engine resolves **zero** inherited fields, and a later `__Masters` write fails with *"Cannot find a field with the name __Masters"*, which looks like propagation lag but never resolves. For `Renderings`, the newline-joined tail becomes one malformed token, so those renderings are registered but **not offered in Pages**. |
| **Child order**: rows or items created with `createItem` | Set `__Sortorder` explicitly (steps of 100) | Children come back **alphabetically**, not in creation order. |
| **General Link XML**: `url` / `text` attributes built from a captured href | XML-escape: `&` → `&amp;` (plus `<` `>` `"`) | A raw `&` breaks attribute parsing. The field's `href` resolves to `""` with no error on the write, the `ser pull` or the schema audit. |
| **`mailto:` links** | `linktype="mailto"` | With `linktype="external"`, the resolver prepends a scheme and renders `http://mailto:…`. |
| **`__Display name`** on a multi-language site | Write it on **each language version the site defines**, using the exact codes (`de-DE`, `ja-JP`, `zh-CN`), not bare `de` / `ja` / `zh` | An `en`-only write leaves the other language versions with the source's name. A cloned rendering showed the OOTB name in 3 of 4 languages. |

After any raw write, **read the field back and assert the exact string**. Then check that `ser pull` picks it up (`sitecoreai-cli-cloud-workflow` § "A pull that finds 0 changes").
