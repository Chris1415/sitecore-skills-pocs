# Spec format

One JSON file per template. `scripts/lib/spec.mjs` validates it, and the build's live lint checks it against the CM. Full example: `assets/example.spec.json`.

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | Dialog title; also names the setup root (`<name> Setup`) and the script module |
| `module` | yes | Lowercase slug `[a-z0-9-]`. Every path is derived from it (see below) |
| `description` | yes | Dialog card subtitle |
| `renderingHost` | yes | Rendering Host item name the new site binds to |
| `contents` | no | `{ "Pages": "Home, About", "Components": "…" }` → the template's Content JSON (dialog detail view) |
| `sortOrder` | no (100) | `__Sortorder`; lower = earlier in the dialog (SYNC/Solterra 10, Alaris 20, Empty 0) |
| `thumbnail` | no | png/jpg/webp path relative to the spec; uploaded to `/sitecore/media library/<Layer>/<module>/` |
| `layer` | no (`Project`) | `Project` · `Feature` · `Foundation` |
| `language` | no (`en`) | Language the smoke test creates its site in |
| `homeType` | when page types exist | Page type Home is re-templated to |
| `pageTypes[]` | no | `{ name, icon?, fields?: [{ name, type, section? }], insertOptions?: [type names] }`. Insert options default to all types |
| `pages[]` | no | `{ path, type, fields?, components? }`. `path` is relative to Home (`""` = Home, `"Services/Strategy"`), and every parent must be declared |
| `partials[]` | no | `{ name, placeholder, components }`. They become Partial Designs linked by a `Default` Page Design (`headless-header`, `headless-footer`) |
| `blueprints[]` | no | `{ name, type, fields?, components }`: page blueprints every new site of the template gets, as branches in its collection's `Branches` folder. `$name` in any value becomes the new page's name, and `Title` defaults to `$name` |
| `dictionary[]` | no | `{ key, phrase }`: a `Dictionary entry` item ({6D1CD897-1936-4A3A-A511-289A94C2A7B1}, fields `Key` + `Phrase`) under `<site>/Dictionary`; the item name is the key with `\ / : ? " < > | * [ ]` replaced by `-`, and two keys that give the same item name (case-insensitive) are an error. Edge `site.siteInfo.dictionary` returns it |
| `settings{}` | no | `{ "FieldName": "value" }` written to the site's `Settings` item with `Set-Fields`; throws on an unknown field. Use it for `RobotsContent`, because an empty value serves `Disallow: /` |
| `availableRenderings[]` | no | `{ name, renderings: [paths] }`: an Available Renderings group, so custom renderings show in the Pages gallery |

An unknown top-level key is not an error, but the lint warns (`unknown top-level key "x" is ignored`), so a typo no longer vanishes silently.

Component:

```json
{ "rendering": "Page Content/Promo",               // relative to /sitecore/layout/Renderings/Feature/JSS Experience Accelerator, or absolute
  "placeholder": "headless-main",                  // default: headless-main on pages, the partial's placeholder on partials; letters, digits, _ { } / - only
  "datasource": { "name": "Hero", "fields": { "PromoText": "<h1>…</h1>" } },  // created under <page>/Data, fields linted
  "variant": "Default",                            // optional: Headless Variant name (FieldNames); created when the site lacks it, including the rendering's Headless Variants folder (a custom rendering has none on a new site); `FieldNames` holds the variant ITEM id
  "params": { "Styles": "…" },                     // optional rendering parameters
  "children": [ … ] }                              // only for Page Structure/Container → /<ph>/container-<n>
```

`datasource.template` (optional) creates the datasource from a template other than the rendering's `Datasource Template`; the extractor sets it when the source item differs. A `params` value may contain `site:<path relative to the site root>` tokens, which resolve to that item in the new site (captured Styles, NavigationRoot).

**Not in a blueprint.** `variant` and `site:` tokens work on pages and partials only. A blueprint is written as layout XML, with no script to create a variant or resolve a token, so both are spec errors there. Use `params.FieldNames` with the variant item id, and an item id instead of a token. `extract-spec --page` warns when a captured page needs them, and `build-blueprint` refuses the spec (exit 2) until it is edited.

`datasource.children` and `datasource.insertOptions` (list rows, gallery frames, finishes):

```json
{ "rendering": "/sitecore/layout/Renderings/Project/Brand/MediaGallery",
  "datasource": {
    "name": "Gallery",
    "fields": { "Heading": "Frames" },
    "insertOptions": ["/sitecore/templates/Project/Brand/Components/Gallery Tile"],   // -> datasource item __Masters
    "children": [
      { "name": "Frame 1", "fields": { "Caption": "Front" } },                       // template defaults to the single insertOptions entry
      { "name": "Frame 2", "template": "/sitecore/templates/Project/Brand/Components/Finish",
        "sortOrder": 250, "fields": { "Caption": "Rear" },
        "children": [{ "name": "Detail", "fields": { "Caption": "Close-up" } }] }
    ] } }
```

- A child is `{ name, template?, fields?, sortOrder?, children? }`. `template` (path or id) is required unless `insertOptions` has exactly one entry. Sibling names are unique and item-safe (letters, digits, space, `-`, `_`).
- Children are created in array order with `__Sortorder` 100, 200, ... per level; `sortOrder` (or `fields.__Sortorder`) overrides. Fields are linted against the child's template (`__` fields always pass): an unknown field is an error, an unknown key warns.
- `insertOptions` are template paths or ids, resolved to ids at build time; each must be a data template (a branch is refused). They overwrite the datasource item's `__Masters`.
- Pages, partials and blueprints all take them. In a blueprint they live inside the branch and copy with each new page. A rebuild is idempotent: existing children are updated, not duplicated.
- `verify-template --smoke` asserts the descendant count under each datasource and that `__Masters` equals the resolved insert options; `build-blueprint --smoke` does the same on its test page.
- `remove-template` is unaffected: children live inside the created sites, never under the module roots it deletes.

A `datasource` may also be a string (an existing path or `local:/Data/x`) when the rendering has no `Datasource Template`.

Field types for `pageTypes[].fields[].type` are Sitecore field type names: `Single-Line Text`, `Multi-Line Text`, `Rich Text`, `Image`, `General Link`, `Checkbox`, `Date`, `Droplink`, `Multilist`, `Number`.

Derived paths (`paths()` in build-template.mjs):

```
/sitecore/system/Settings/<Layer>/<module>/Templates/<name>      Solution template
/sitecore/system/Settings/<Layer>/<module>/<name> Setup          setup root + 2 actions
/sitecore/system/Modules/PowerShell/Script Library/<name>/Functions/{<name> Site Setup, <name> Configure Rendering Host}
/sitecore/templates/<Layer>/<module>/<Type>                     module page types
/sitecore/media library/<Layer>/<module>/<name> Site Preview    thumbnail
```

Example of the newer keys:

```json
{ "dictionary": [{ "key": "brand.cta.book", "phrase": "Book a demo" }],
  "settings": { "RobotsContent": "User-agent: *\nAllow: /" } }
```

Writing a spec from requirements: list the pages and their purpose, and give each distinct page purpose a page type. Pick components from the renderings the target head app registers (`--component-map`). Put the copy into datasource fields, and only fixed chrome into partials. Keep datasource names unique per page.

## Standalone page-blueprint spec (`build-blueprint.mjs`)

```json
{ "site": "skate-campaigns",            // existing site the blueprint is offered in
  "name": "Campaign Landing",           // branch name = what "Create a page" shows
  "pageTemplate": "Page",               // collection page template the page is created from (default "Page")
  "offerOn": ["Page"],                  // templates whose insert options offer it (default: pageTemplate); Home is handled automatically
  "fields": { },                        // page field values; Title defaults to "$name"
  "components": [ { "rendering": "Page Content/Promo", "datasource": { "name": "Hero", "fields": { "PromoText": "<h1>$name</h1>" } } } ] }
```
